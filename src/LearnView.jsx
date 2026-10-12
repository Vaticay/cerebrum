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
    if (a.includes(",")) name = a.split(",")[0].split(" ").pop() + " et al.";
    else if (/et al/.test(a)) name = a.replace(/\s*et al\.?.*$/, "") + " et al.";
    else {
      const words = a.split(/\s+/);
      name = words.length > 2 ? words[words.length - 1] + " et al." : a;
    }
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
  const distract = seededShuffle(
    allClaims.filter((c) => c.sourceIdx !== claim.sourceIdx && c.text !== claim.text),
    hashStr(claim.text)
  ).slice(0, 3).map((c) => c.text);
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
  const claims = extractClaims(answerMd);
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
.lv-btn { transition: transform 80ms linear, box-shadow 80ms linear, background .15s; }
.lv-btn-primary { box-shadow: 0 4px 0 rgba(0,0,0,.38); }
.lv-btn-primary:active { transform: translateY(4px); box-shadow: 0 0 0 rgba(0,0,0,0); }
.lv-opt { transition: border-color .15s, background .15s, transform .15s; }
.lv-opt:not(:disabled):hover { transform: translateY(-1px); }
.lv-shake { animation: lvShake .4s ease both; }
@keyframes lvShake { 0%,100% { transform: translateX(0); } 20% { transform: translateX(-6px); } 40% { transform: translateX(6px); } 60% { transform: translateX(-4px); } 80% { transform: translateX(4px); } }
.lv-pop { animation: lvPop .3s cubic-bezier(.2,1.4,.4,1) both; }
@keyframes lvPop { from { transform: scale(0); } to { transform: scale(1); } }
.lv-fill { transition: width .5s cubic-bezier(.05,.7,.1,1); }
`;

/* ── lesson player ───────────────────────────────────────────────── */
function Player({ course, startLesson, P, accent, at, soundOn, onExit, onProgress }) {
  const [lessonIdx, setLessonIdx] = useState(startLesson || 0);
  const [cardIdx, setCardIdx] = useState(0);
  const [picked, setPicked] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [sessionXp, setSessionXp] = useState(0);
  const [answered, setAnswered] = useState(0);
  const [right, setRight] = useState(0);
  const [finished, setFinished] = useState(false);
  const claimsRef = useRef(null);
  if (!claimsRef.current) claimsRef.current = loadClaims();

  const lesson = course.lessons[lessonIdx];
  const card = lesson ? lesson.cards[cardIdx] : null;
  const totalCards = course.lessons.reduce((n, l) => n + l.cards.length, 0);
  const doneCards = course.lessons.slice(0, lessonIdx).reduce((n, l) => n + l.cards.length, 0) + cardIdx;
  const interactive = card && (card.kind === "quiz" || card.kind === "cloze" || card.kind === "battle");
  const isRight = interactive && card.kind !== "battle" && picked === card.correct;

  const award = (xp) => { setSessionXp((x) => x + xp); };

  const pick = (i) => {
    if (revealed || !interactive) return;
    setPicked(i);
    setRevealed(true);
    setAnswered((n) => n + 1);
    if (card.kind === "battle") {
      award(6);
      playSound("tick", soundOn);
      return;
    }
    const correct = i === card.correct;
    if (correct) setRight((n) => n + 1);
    award(correct ? 10 : 4);
    playSound(correct ? "correct" : "wrong", soundOn);
    if (card.claimId && claimsRef.current[card.claimId]) {
      gradeClaim(claimsRef.current, card.claimId, correct);
      saveClaims(claimsRef.current);
    }
    onProgress && onProgress(correct ? 10 : 4, course);
  };

  const advance = () => {
    if (interactive && !revealed) return;
    if (!interactive) { award(2); onProgress && onProgress(2, course); }
    setPicked(null); setRevealed(false);
    if (cardIdx < lesson.cards.length - 1) { setCardIdx(cardIdx + 1); return; }
    const done = [...new Set([...(course.doneLessons || []), lesson.id])];
    onProgress && onProgress(20, course, done);
    if (lessonIdx < course.lessons.length - 1) {
      setLessonIdx(lessonIdx + 1); setCardIdx(0);
    } else {
      setFinished(true);
      playSound("complete", soundOn);
    }
  };

  const btnPrimary = {
    background: accent, color: at, border: "none", borderRadius: 12,
    padding: "14px 28px", fontSize: 15.5, fontWeight: 700, cursor: "pointer",
    fontFamily: "var(--cb-font)", minHeight: 52,
  };
  const btnGhost = {
    background: "transparent", color: P.ink, border: "1px solid " + P.line, borderRadius: 12,
    padding: "14px 22px", fontSize: 15, cursor: "pointer", fontFamily: "var(--cb-font)", minHeight: 52,
  };

  if (finished) {
    return (
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "56px 24px", textAlign: "center", fontFamily: "var(--cb-font)" }}>
        <style>{CSS}</style>
        <div className="lv-rise">
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ margin: "0 auto 18px" }}>
            <circle cx="12" cy="12" r="11" stroke={accent} strokeWidth="1.6" />
            <path d="M7 12.5 L10.5 16 L17 8.5" stroke={accent} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="lv-pop" />
          </svg>
          <h2 style={{ fontFamily: SERIF, fontSize: 30, fontWeight: 600, color: P.ink, margin: "0 0 10px" }}>{course.title}</h2>
          <p style={{ color: P.muted, fontSize: 15.5, lineHeight: 1.6, margin: "0 auto 28px", maxWidth: 440 }}>
            Course finished. Every finding you answered is on your review schedule now. It comes back when it starts to fade, not before.
          </p>
          <div style={{ display: "flex", gap: 14, justifyContent: "center", marginBottom: 34 }}>
            <div style={{ background: P.card, border: "1px solid " + P.line, borderRadius: 14, padding: "14px 22px" }}>
              <div style={{ fontSize: 26, fontWeight: 700, color: accent }}>+{sessionXp}</div>
              <div style={{ fontSize: 12, color: P.muted }}>XP this session</div>
            </div>
            <div style={{ background: P.card, border: "1px solid " + P.line, borderRadius: 14, padding: "14px 22px" }}>
              <div style={{ fontSize: 26, fontWeight: 700, color: P.ink }}>{answered ? Math.round((right / answered) * 100) + "%" : "·"}</div>
              <div style={{ fontSize: 12, color: P.muted }}>First try accuracy</div>
            </div>
          </div>
          <button className="lv-btn lv-btn-primary" style={btnPrimary} onClick={onExit}>Back to Learn</button>
        </div>
      </div>
    );
  }
  if (!card) return null;

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "28px 24px 40px", fontFamily: "var(--cb-font)" }}>
      <style>{CSS}</style>
      {/* header: lesson position, overall progress */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <span style={{ fontSize: 12.5, color: P.muted, letterSpacing: "0.04em" }}>
          {lesson.title.toUpperCase()} · {cardIdx + 1} OF {lesson.cards.length}
        </span>
        <button onClick={onExit} aria-label="Close lesson" style={{ background: "none", border: "none", color: P.muted, cursor: "pointer", fontSize: 20, lineHeight: 1, padding: 6 }}>✕</button>
      </div>
      <div style={{ height: 12, borderRadius: 999, background: P.line, overflow: "hidden", marginBottom: 34 }}>
        <div className="lv-fill" style={{
          width: ((doneCards / totalCards) * 100) + "%", height: "100%", borderRadius: 999,
          background: "linear-gradient(rgba(255,255,255,.38), rgba(255,255,255,0) 48%), " + accent,
        }} />
      </div>

      <div key={lessonIdx + "-" + cardIdx} className="lv-rise">
        {card.kind === "note" && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", color: accent, marginBottom: 12 }}>{(card.kicker || "").toUpperCase()}</div>
            <h2 style={{ fontFamily: SERIF, fontSize: 29, fontWeight: 600, color: P.ink, lineHeight: 1.25, margin: "0 0 14px" }}>{card.title}</h2>
            <p style={{ fontSize: 17, color: P.ink2 || P.muted, lineHeight: 1.65, margin: 0 }}>{card.text}</p>
            {card.cite && <p style={{ fontSize: 13, color: P.muted, marginTop: 14 }}>{card.cite}</p>}
          </div>
        )}

        {card.kind === "paper" && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", color: accent, marginBottom: 12 }}>FROM THE LITERATURE</div>
            <h2 style={{ fontFamily: SERIF, fontSize: 24, fontWeight: 600, color: P.ink, lineHeight: 1.35, margin: "0 0 8px" }}>{card.title}</h2>
            <p style={{ fontSize: 13.5, color: P.muted, margin: "0 0 20px" }}>
              {card.meta}{card.citations != null ? " · " + card.citations + " citations" : ""}
            </p>
            {card.text && (
              <p style={{ fontFamily: SERIF, fontSize: 19.5, color: P.ink, lineHeight: 1.6, margin: 0, borderLeft: "3px solid " + accent, paddingLeft: 18 }}>
                {card.text}
              </p>
            )}
          </div>
        )}

        {(card.kind === "quiz" || card.kind === "cloze") && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", color: accent, marginBottom: 12 }}>
              {card.pretest ? "PRETEST · GUESS FIRST" : card.kind === "cloze" ? "PREDICT THE RESULT" : "RECALL"}
            </div>
            <h2 style={{ fontFamily: SERIF, fontSize: 23, fontWeight: 600, color: P.ink, lineHeight: 1.4, margin: "0 0 8px" }}>{card.question}</h2>
            {card.kind === "cloze" && card.prompt && (
              <p style={{ fontFamily: SERIF, fontSize: 18.5, color: P.ink, lineHeight: 1.6, margin: "0 0 6px" }}>{card.prompt}</p>
            )}
            {card.pretest && !revealed && (
              <p style={{ fontSize: 14, color: P.muted, margin: "0 0 4px" }}>You have not been taught this yet. That is the point. A real guess now makes the finding stick later.</p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 18 }}>
              {card.options.map((opt, i) => {
                let bg = P.card, border = P.line, color = P.ink;
                if (revealed && i === card.correct) { bg = "#D7FFB8"; border = "#58CC02"; color = "#224d00"; }
                else if (revealed && i === picked) { bg = "#FFDFE0"; border = "#FF4B4B"; color = "#6e0f13"; }
                else if (!revealed && picked === i) { bg = "#DDF4FF"; border = "#84D8FF"; color = P.ink; }
                return (
                  <button key={i} className={"lv-opt" + (revealed && picked === i && i !== card.correct ? " lv-shake" : "")}
                    onClick={() => pick(i)} disabled={revealed}
                    style={{
                      background: bg, border: "2px solid " + border, borderRadius: 14,
                      padding: "15px 18px", fontSize: card.kind === "cloze" ? 17 : 15.5, lineHeight: 1.5,
                      color, cursor: revealed ? "default" : "pointer", textAlign: "left",
                      fontFamily: "var(--cb-font)", minHeight: 52, display: "flex", gap: 12, alignItems: "flex-start",
                    }}>
                    {revealed && i === card.correct && (
                      <svg className="lv-pop" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }}>
                        <circle cx="12" cy="12" r="11" fill="#58CC02" />
                        <path d="M7 12.5 L10.5 16 L17 8.5" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                    <span>{opt}</span>
                  </button>
                );
              })}
            </div>
            {revealed && (
              <div className="lv-rise" style={{
                marginTop: 16, padding: "16px 18px", borderRadius: 14,
                background: card.kind !== "battle" && !isRight ? "#FFDFE055" : "#D7FFB833",
                border: "1px solid " + (card.kind !== "battle" && !isRight ? "#FF4B4B55" : "#58CC0255"),
              }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: P.ink, marginBottom: 6 }}>
                  {card.pretest
                    ? "Remember your guess. Here is what the paper actually says."
                    : isRight ? "Right. Here is the finding in the paper's own words." : "Not quite. Here is what the paper actually says."}
                </div>
                <p style={{ fontFamily: SERIF, fontSize: 16.5, color: P.ink, lineHeight: 1.6, margin: 0 }}>{card.why}</p>
                <p style={{ fontSize: 12.5, color: P.muted, margin: "10px 0 0" }}>{card.cite}{card.paperTitle ? " · " + card.paperTitle : ""}</p>
                <p style={{ fontSize: 12.5, color: accent, fontWeight: 700, margin: "8px 0 0" }}>
                  {isRight ? "+10 XP" : "+4 XP for the attempt"}. This finding is on your review schedule now.
                </p>
              </div>
            )}
          </div>
        )}

        {card.kind === "battle" && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", color: accent, marginBottom: 12 }}>CLAIM BATTLE · REAL FINDINGS</div>
            <h2 style={{ fontFamily: SERIF, fontSize: 23, fontWeight: 600, color: P.ink, lineHeight: 1.4, margin: "0 0 18px" }}>{card.question}</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
              {[{ claim: card.claimA, src: card.sourceA, tag: "POSITION A" }, { claim: card.claimB, src: card.sourceB, tag: "POSITION B" }].map((side, i) => (
                <button key={i} onClick={() => pick(i)} disabled={revealed}
                  className="lv-opt"
                  style={{
                    background: revealed && picked === i ? (P.card) : P.card,
                    border: "2px solid " + (revealed && picked === i ? accent : P.line), borderRadius: 14,
                    padding: "16px 18px", textAlign: "left", cursor: revealed ? "default" : "pointer", fontFamily: "var(--cb-font)",
                  }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.1em", color: accent, marginBottom: 8 }}>{side.tag}</div>
                  <p style={{ fontFamily: SERIF, fontSize: 17, color: P.ink, lineHeight: 1.55, margin: 0 }}>{side.claim}</p>
                  <p style={{ fontSize: 12.5, color: P.muted, margin: "10px 0 0" }}>{side.src}</p>
                </button>
              ))}
            </div>
            {revealed && (
              <div className="lv-rise" style={{ marginTop: 16, padding: "16px 18px", borderRadius: 14, background: P.card, border: "1px solid " + P.line }}>
                <p style={{ fontSize: 15, color: P.ink, lineHeight: 1.6, margin: 0 }}>
                  Both of these are real published findings, and they do not agree. There is no correct side to pick here. Disagreement at this level usually means the answer depends on conditions neither study fully controlled. +6 XP for weighing in.
                </p>
              </div>
            )}
          </div>
        )}

        {card.kind === "summary" && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", color: accent, marginBottom: 12 }}>WRAP UP</div>
            <h2 style={{ fontFamily: SERIF, fontSize: 29, fontWeight: 600, color: P.ink, lineHeight: 1.25, margin: "0 0 14px" }}>{card.title}</h2>
            <p style={{ fontSize: 17, color: P.ink2 || P.muted, lineHeight: 1.65, margin: 0 }}>{card.text}</p>
          </div>
        )}
      </div>

      {/* footer nav */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 36 }}>
        <span style={{ fontSize: 13, color: P.muted }}>{sessionXp > 0 ? "+" + sessionXp + " XP this lesson run" : ""}</span>
        <button className="lv-btn lv-btn-primary" style={{ ...btnPrimary, opacity: interactive && !revealed ? 0.45 : 1 }}
          onClick={advance} disabled={interactive && !revealed}>
          {cardIdx === lesson.cards.length - 1
            ? lessonIdx === course.lessons.length - 1 ? "Finish course" : "Finish lesson"
            : "Continue"}
        </button>
      </div>
    </div>
  );
}

/* ── home ────────────────────────────────────────────────────────── */
function memoryState(course, claims) {
  const mine = Object.values(claims).filter((c) => c.courseId === course.id && c.reps > 0);
  if (mine.length === 0) return { label: "Not started", pct: 0 };
  const now = Date.now();
  const avg = mine.reduce((sum, c) => sum + retrievability(c, now), 0) / mine.length;
  const due = mine.filter((c) => c.due <= now).length;
  if (due > 0) return { label: due + " fading", pct: Math.round(avg * 100) };
  return { label: "Holding", pct: Math.round(avg * 100) };
}

export default function LearnView({ P, accent, at, onNavigate }) {
  const [courses, setCourses] = useState([]);
  const [claims, setClaims] = useState({});
  const [profile, setProfile] = useState(null);
  const [active, setActive] = useState(null); // { course, startLesson } or { review: true }
  const [topic, setTopic] = useState("");
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState("");
  const [soundOn, setSoundOn] = useState(() => loadJSON(SOUND_KEY, true));
  const [confirmDelete, setConfirmDelete] = useState(null);

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
      setActive({ course, startLesson: 0 });
    } catch {
      setBuildError("The search did not come back. Check your connection and try again.");
    } finally {
      setBuilding(false);
    }
  };

  const startReview = () => {
    const cards = due.slice(0, 12).map((c) => ({ ...c.card, claimId: c.id, kind: c.card.kind || "quiz" }));
    if (!cards.length) return;
    const reviewCourse = {
      id: "review",
      title: "Review: findings that are fading",
      lessons: [{ id: "review", title: "Review", subtitle: "", cards }],
      doneLessons: [],
    };
    setActive({ course: reviewCourse, startLesson: 0 });
  };

  const removeCourse = (id) => {
    const all = loadLearnCourses().filter((c) => c.id !== id);
    saveJSON(COURSES_KEY, all);
    const store = loadClaims();
    for (const k of Object.keys(store)) if (store[k].courseId === id) delete store[k];
    saveClaims(store);
    setConfirmDelete(null);
    refresh();
  };

  if (active) {
    return (
      <Player
        course={active.course}
        startLesson={active.startLesson}
        P={P} accent={accent} at={at || "#101408"}
        soundOn={soundOn}
        onExit={() => { setActive(null); refresh(); setProfile(touchStreak(loadProfile())); }}
        onProgress={handleProgress}
      />
    );
  }

  const statBox = (value, label) => (
    <div style={{ background: P.card, border: "1px solid " + P.line, borderRadius: 14, padding: "14px 20px", minWidth: 104 }}>
      <div style={{ fontSize: 25, fontWeight: 700, color: P.ink, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 12, color: P.muted, marginTop: 2 }}>{label}</div>
    </div>
  );

  return (
    <div style={{ maxWidth: 880, margin: "0 auto", padding: "30px 24px 56px", fontFamily: "var(--cb-font)" }}>
      <style>{CSS}</style>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          <h1 style={{ fontFamily: SERIF, fontSize: 34, fontWeight: 600, color: P.ink, margin: "0 0 8px" }}>Learn</h1>
          <p style={{ color: P.muted, fontSize: 15.5, lineHeight: 1.55, margin: 0, maxWidth: 520 }}>
            Courses built from the papers themselves. Every question is a real finding, every debate is a real disagreement, and reviews come back when your memory starts to fade.
          </p>
        </div>
        <button onClick={() => { const v = !soundOn; setSoundOn(v); saveJSON(SOUND_KEY, v); }}
          aria-label={soundOn ? "Mute lesson sounds" : "Unmute lesson sounds"}
          style={{ background: "transparent", border: "1px solid " + P.line, borderRadius: 10, color: P.muted, cursor: "pointer", padding: "8px 12px", fontSize: 13, fontFamily: "var(--cb-font)" }}>
          Sound {soundOn ? "on" : "off"}
        </button>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "22px 0 30px" }}>
        {statBox(profile ? profile.xp : 0, "Total XP")}
        {statBox(profile ? profile.streak || 0 : 0, "Day streak" + (profile && profile.freezes ? " · " + profile.freezes + " freeze" + (profile.freezes === 1 ? "" : "s") + " left" : ""))}
        {statBox(due.length, "Findings due")}
        {statBox(courses.length, "Courses")}
      </div>

      {/* topic builder */}
      <div style={{ background: P.card, border: "1px solid " + P.line, borderRadius: 16, padding: 20, marginBottom: 26 }}>
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
              flex: "1 1 320px", background: P.bg, border: "1px solid " + P.line, borderRadius: 12,
              padding: "13px 16px", fontSize: 15.5, color: P.ink, fontFamily: "var(--cb-font)", minHeight: 52,
            }}
          />
          <button className="lv-btn lv-btn-primary" onClick={buildCourse} disabled={building || !topic.trim()}
            style={{
              background: accent, color: at || "#101408", border: "none", borderRadius: 12,
              padding: "13px 24px", fontSize: 15.5, fontWeight: 700, cursor: building ? "wait" : "pointer",
              fontFamily: "var(--cb-font)", minHeight: 52, opacity: building || !topic.trim() ? 0.55 : 1,
            }}>
            {building ? "Searching the literature..." : "Build course"}
          </button>
        </div>
        {buildError && <p style={{ color: "#FF8A8A", fontSize: 14, margin: "12px 0 0" }}>{buildError}</p>}
      </div>

      {/* review queue */}
      {due.length > 0 && (
        <div style={{ border: "1px solid " + accent, borderRadius: 16, padding: 20, marginBottom: 26, background: P.card }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", color: accent, marginBottom: 8 }}>DUE FOR REVIEW</div>
          <p style={{ fontSize: 15, color: P.ink, lineHeight: 1.55, margin: "0 0 14px" }}>
            {due.length} finding{due.length === 1 ? " is" : "s are"} starting to fade. Reviewing now, while they are cheap to relearn, is what makes them permanent.
          </p>
          <button className="lv-btn lv-btn-primary" onClick={startReview}
            style={{ background: accent, color: at || "#101408", border: "none", borderRadius: 12, padding: "12px 22px", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "var(--cb-font)" }}>
            Start review
          </button>
        </div>
      )}

      {/* courses */}
      {courses.length === 0 ? (
        <div style={{ border: "1px dashed " + P.line, borderRadius: 16, padding: "36px 28px", textAlign: "center" }}>
          <h3 style={{ fontFamily: SERIF, color: P.ink, fontSize: 21, fontWeight: 600, margin: "0 0 8px" }}>No courses yet</h3>
          <p style={{ color: P.muted, fontSize: 14.5, lineHeight: 1.6, margin: "0 auto 20px", maxWidth: 420 }}>
            Build one above, or open any answer in Search and choose Turn into course. Either way, the course is made from the papers that search found.
          </p>
          <button onClick={() => onNavigate && onNavigate("search")}
            style={{ background: "transparent", border: "1px solid " + P.line, borderRadius: 12, padding: "12px 22px", color: P.ink, fontSize: 15, cursor: "pointer", fontFamily: "var(--cb-font)" }}>
            Go to Search
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {courses.map((course) => {
            const mem = memoryState(course, claims);
            const doneCount = (course.doneLessons || []).length;
            return (
              <div key={course.id} style={{ background: P.card, border: "1px solid " + P.line, borderRadius: 16, padding: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "flex-start" }}>
                  <div style={{ minWidth: 0 }}>
                    <h3 style={{ fontFamily: SERIF, color: P.ink, fontSize: 20, fontWeight: 600, margin: "0 0 4px", lineHeight: 1.3 }}>{course.title}</h3>
                    <p style={{ color: P.muted, fontSize: 13, margin: 0 }}>
                      {course.lessons.length} lessons · {course.sourceCount || 0} papers · {doneCount} of {course.lessons.length} lessons done
                    </p>
                  </div>
                  {confirmDelete === course.id ? (
                    <span style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                      <button onClick={() => removeCourse(course.id)} style={{ background: "#FF4B4B", color: "#fff", border: "none", borderRadius: 8, padding: "7px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--cb-font)" }}>Delete</button>
                      <button onClick={() => setConfirmDelete(null)} style={{ background: "transparent", color: P.muted, border: "1px solid " + P.line, borderRadius: 8, padding: "7px 12px", fontSize: 13, cursor: "pointer", fontFamily: "var(--cb-font)" }}>Keep</button>
                    </span>
                  ) : (
                    <button onClick={() => setConfirmDelete(course.id)} aria-label="Delete course"
                      style={{ background: "none", border: "none", color: P.muted, cursor: "pointer", fontSize: 16, padding: 4, flexShrink: 0 }}>✕</button>
                  )}
                </div>
                <div style={{ marginTop: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: P.muted, marginBottom: 6 }}>
                    <span>Memory strength</span><span>{mem.label}</span>
                  </div>
                  <div style={{ height: 8, borderRadius: 999, background: P.line, overflow: "hidden" }}>
                    <div className="lv-fill" style={{ width: mem.pct + "%", height: "100%", background: accent, borderRadius: 999 }} />
                  </div>
                </div>
                <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
                  <button className="lv-btn lv-btn-primary"
                    onClick={() => {
                      const nextIdx = course.lessons.findIndex((l) => !(course.doneLessons || []).includes(l.id));
                      setActive({ course, startLesson: nextIdx < 0 ? 0 : nextIdx });
                    }}
                    style={{ background: accent, color: at || "#101408", border: "none", borderRadius: 10, padding: "11px 20px", fontSize: 14.5, fontWeight: 700, cursor: "pointer", fontFamily: "var(--cb-font)" }}>
                    {doneCount >= course.lessons.length ? "Replay course" : doneCount > 0 ? "Continue" : "Start course"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
