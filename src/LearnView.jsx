/* Cerebrum Learn. Short taught courses: lessons first, quizzes after.
 *
 * Every course teaches its topic in plain language, in small steps,
 * then quizzes what it just taught. The catalog topics and the
 * learning paths are authored curriculum: standard textbook
 * knowledge written for Cortex, with questions a real quiz would
 * ask about the ideas themselves. A course built from a search
 * teaches the same way: the retrieved material is background for
 * plain teaching statements, and the checks quiz the concepts.
 * Nothing in the learning flow displays papers, findings, or
 * citations; the papers live in Search, where they belong.
 *
 * Learning mechanics:
 * - Teach, then check. A short reading step gives the idea, then
 *   the checks ask about exactly that idea, nothing untaught.
 * - Retrieval, not rereading. Lessons ask; they do not only lecture.
 * - Predict the number. Statements with a result in them become
 *   cloze cards: guess the value before you see it.
 * - Spaced review. Answered questions in search built courses go on
 *   an FSRS style schedule and resurface as they start to fade;
 *   path and catalog lessons stay fresh through daily practice.
 * - Forgiving streaks. Two freezes, no hearts, no energy limits.
 *
 * Presentation (v3): an Imprint grade lesson experience. A library
 * of course covers, a lesson path inside each course, and a full
 * screen player with one idea per card, a check step before
 * feedback, and a feedback sheet that explains why in plain words.
 */

import React, { useState, useEffect, useMemo, useRef } from "react";
import { Icon, STATUS, FONT_SIZES, RADIUS, withAlpha, accentText } from "./designSystem.jsx";

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
  return { xp, days: [], bridged: [], freezes: 2, freezeMilestone: 0, sparks: 0, loopDay: "", loop: null, reminderHour: null, leaguesOptIn: false };
}
function saveProfile(p) { saveJSON(PROFILE_KEY, p); }

/* ── progress export and import ────────────────────────────────────
   Progress lives only in this browser's local storage, so clearing
   the browser erases the whole learning record. The escape hatch is
   a file the learner keeps: one JSON document carrying every Cortex
   key, with a format marker and a version, so an import can refuse
   files it cannot read instead of guessing at them. This is a
   backup file the learner holds, not cloud sync, and the words on
   screen say exactly that. The builder and the parser are pure so
   the round trip can be pinned without a DOM. */
export const CORTEX_EXPORT_FORMAT = "cerebrum-cortex-progress";
export const CORTEX_EXPORT_VERSION = 1;

/* The Cortex tagline (redesign, 2026-10-14). The old line, "Where
   papers become memory.", described a product that referenced
   papers in its learning flow; that flow was removed by the
   owner's own order, so the line now promises what Cortex does:
   taught science that stays with the learner. */
export const CORTEX_TAGLINE = "Science you will actually remember.";

function cortexIsPlainObject(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
function cortexIsFiniteNumber(v) { return typeof v === "number" && Number.isFinite(v); }
function cortexIsStringArray(v) { return Array.isArray(v) && v.every((x) => typeof x === "string"); }
function cortexEmptyProfile() { return { xp: 0, days: [], bridged: [], freezes: 2, freezeMilestone: 0, sparks: 0, loopDay: "", loop: null, reminderHour: null, leaguesOptIn: false }; }
function cortexEmptyBuiltinProgress() { return { lessons: {}, lastPathId: "", lastLessonId: "" }; }
function cortexImportFailure(error) { return { ok: false, error }; }

export function buildCortexExport(state, now = new Date()) {
  const s = cortexIsPlainObject(state) ? state : {};
  const when = now instanceof Date ? now : new Date(now);
  return {
    format: CORTEX_EXPORT_FORMAT,
    version: CORTEX_EXPORT_VERSION,
    exportedAt: when.toISOString(),
    courses: Array.isArray(s.courses) ? s.courses : [],
    claims: cortexIsPlainObject(s.claims) ? s.claims : {},
    profile: cortexIsPlainObject(s.profile) ? s.profile : cortexEmptyProfile(),
    builtinProgress: cortexIsPlainObject(s.builtinProgress) && cortexIsPlainObject(s.builtinProgress.lessons)
      ? s.builtinProgress : cortexEmptyBuiltinProgress(),
    sound: typeof s.sound === "boolean" ? s.sound : false,
  };
}

/* Deep shape checks, one per section, against the fields the
   loaders and the Player actually read. Top level types alone are
   not enough: the home library reads course.lessons.length and the
   Player reads lesson.cards on sight, so a course whose lessons
   are missing or a lesson whose cards are missing would corrupt
   the library the moment it rendered. Every check names its
   section in plain words. A field a real export always writes is
   required; a field the readers only touch when present is type
   checked when present. */
function cortexCourseProblem(course) {
  if (!cortexIsPlainObject(course)) return "That file's courses section holds an entry that is not a course. Nothing was imported.";
  if (course.id != null && typeof course.id !== "string") return "That file's courses section holds a course whose id is not readable. Nothing was imported.";
  if (course.title != null && typeof course.title !== "string") return "That file's courses section holds a course whose title is not readable. Nothing was imported.";
  if (!Array.isArray(course.lessons)) return "That file's courses section holds a course with no lessons list. Nothing was imported.";
  for (const lesson of course.lessons) {
    if (!cortexIsPlainObject(lesson)) return "That file's courses section holds a lesson that is not readable. Nothing was imported.";
    if (lesson.id != null && typeof lesson.id !== "string") return "That file's courses section holds a lesson whose id is not readable. Nothing was imported.";
    if (lesson.title != null && typeof lesson.title !== "string") return "That file's courses section holds a lesson whose title is not readable. Nothing was imported.";
    if (lesson.subtitle != null && typeof lesson.subtitle !== "string") return "That file's courses section holds a lesson whose subtitle is not readable. Nothing was imported.";
    if (!Array.isArray(lesson.cards)) return "That file's courses section holds a lesson with no cards list. Nothing was imported.";
    for (const card of lesson.cards) {
      if (!cortexIsPlainObject(card) || typeof card.kind !== "string") return "That file's courses section holds a card with no kind. Nothing was imported.";
      if ((card.kind === "quiz" || card.kind === "cloze" || card.kind === "visualq" || card.kind === "predict")
        && (!Array.isArray(card.options) || card.options.length < 2
          || !Number.isInteger(card.correct) || card.correct < 0 || card.correct >= card.options.length)) {
        return "That file's courses section holds a question card whose answers are not readable. Nothing was imported.";
      }
      if (card.kind === "match" && !Array.isArray(card.pairs)) return "That file's courses section holds a matching card with no pairs list. Nothing was imported.";
      if ((card.kind === "order" || card.kind === "build") && !Array.isArray(card.items)) return "That file's courses section holds an ordering card with no items list. Nothing was imported.";
      if (card.kind === "spoterror" && (!Array.isArray(card.parts)
        || !Number.isInteger(card.wrong) || card.wrong < 0 || card.wrong >= card.parts.length)) {
        return "That file's courses section holds a spot the error card whose pieces are not readable. Nothing was imported.";
      }
      if (card.kind === "truefalse" && typeof card.answer !== "boolean") return "That file's courses section holds a true or false card with no answer. Nothing was imported.";
    }
  }
  if (course.doneLessons != null && !cortexIsStringArray(course.doneLessons)) return "That file's courses section holds a course whose finished lessons list is not readable. Nothing was imported.";
  if (course.xpEarned != null && !cortexIsFiniteNumber(course.xpEarned)) return "That file's courses section holds a course whose earned XP is not a number. Nothing was imported.";
  if (course.vocab != null && !Array.isArray(course.vocab)) return "That file's courses section holds a course whose word list is not readable. Nothing was imported.";
  return null;
}

function cortexClaimProblem(claim) {
  if (!cortexIsPlainObject(claim)) return "That file's review claims section holds an entry that is not a claim. Nothing was imported.";
  for (const field of ["reps", "lapses", "stability", "due", "last"]) {
    if (claim[field] != null && !cortexIsFiniteNumber(claim[field])) {
      return "That file's review claims section holds a claim whose schedule is not readable. Nothing was imported.";
    }
  }
  /* The review Player plays the stored card, so a claim without a
     readable card is a claim that cannot be reviewed. */
  if (!cortexIsPlainObject(claim.card)) return "That file's review claims section holds a claim with no review card. Nothing was imported.";
  if (claim.card.options != null && !Array.isArray(claim.card.options)) return "That file's review claims section holds a review card whose answers are not readable. Nothing was imported.";
  if (claim.card.correct != null && !cortexIsFiniteNumber(claim.card.correct)) return "That file's review claims section holds a review card whose answer is not readable. Nothing was imported.";
  return null;
}

function cortexProgressRecordProblem(rec) {
  if (!cortexIsPlainObject(rec)) return "That file's path progress section holds a lesson record that is not readable. Nothing was imported.";
  if (rec.done != null && typeof rec.done !== "boolean") return "That file's path progress section holds a lesson record whose done mark is not readable. Nothing was imported.";
  if (rec.best != null && !cortexIsFiniteNumber(rec.best)) return "That file's path progress section holds a lesson record whose best score is not a number. Nothing was imported.";
  if (rec.completions != null && !cortexIsFiniteNumber(rec.completions)) return "That file's path progress section holds a lesson record whose completion count is not a number. Nothing was imported.";
  if ((rec.mastered != null && typeof rec.mastered !== "boolean")
    || (rec.reviewMastered != null && typeof rec.reviewMastered !== "boolean")) {
    return "That file's path progress section holds a lesson record whose mastery marks are not readable. Nothing was imported.";
  }
  if (rec.completedAt != null && typeof rec.completedAt !== "string") return "That file's path progress section holds a lesson record whose date is not readable. Nothing was imported.";
  if (rec.lastAt != null && typeof rec.lastAt !== "string") return "That file's path progress section holds a lesson record whose last study date is not readable. Nothing was imported.";
  return null;
}

export function cortexLoopProblem(loop) {
  if (loop == null) return null;
  if (!cortexIsPlainObject(loop)) return "That file's profile section holds a daily loop record that is not readable. Nothing was imported.";
  if (loop.plan != null) {
    if (!cortexIsPlainObject(loop.plan) && !Array.isArray(loop.plan)) return "That file's profile section holds a daily plan that is not readable. Nothing was imported.";
    const descriptors = Array.isArray(loop.plan) ? loop.plan : Object.values(loop.plan);
    for (const q of descriptors) {
      if (q == null) continue;
      if (!cortexIsPlainObject(q) || typeof q.title !== "string") return "That file's profile section holds a daily quest that is not readable. Nothing was imported.";
    }
  }
  if (loop.sessionDone != null && typeof loop.sessionDone !== "boolean") return "That file's profile section holds a daily loop record that is not readable. Nothing was imported.";
  if (loop.sessionPaid != null && typeof loop.sessionPaid !== "boolean") return "That file's profile section holds a daily loop record that is not readable. Nothing was imported.";
  if (loop.done != null && !cortexIsPlainObject(loop.done)) return "That file's profile section holds a daily loop record that is not readable. Nothing was imported.";
  if (loop.paid != null && !cortexIsPlainObject(loop.paid)) return "That file's profile section holds a daily loop record that is not readable. Nothing was imported.";
  if (loop.events != null) {
    if (!cortexIsPlainObject(loop.events)) return "That file's profile section holds daily loop events that are not readable. Nothing was imported.";
    for (const key of ["lessons", "perfect", "checkpoints", "paidPerfect", "paidCheckpoints"]) {
      if (loop.events[key] != null && !cortexIsStringArray(loop.events[key])) return "That file's profile section holds daily loop events that are not readable. Nothing was imported.";
    }
  }
  if (loop.dueAtStart != null && !cortexIsFiniteNumber(loop.dueAtStart)) return "That file's profile section holds a daily loop record that is not readable. Nothing was imported.";
  return null;
}

/* Validate a whole export file before anything is restored. Any
   problem returns a failure with plain words and no partial state,
   so a malformed or foreign file provably changes nothing. A file
   from a newer Cortex is refused rather than guessed at. */
export function parseCortexImport(text) {
  let data;
  try { data = JSON.parse(String(text == null ? "" : text)); }
  catch { return cortexImportFailure("That file could not be read. It is not valid JSON."); }
  if (!cortexIsPlainObject(data) || data.format !== CORTEX_EXPORT_FORMAT) {
    return cortexImportFailure("That file is not a Cortex progress file. Nothing was imported.");
  }
  if (typeof data.version !== "number" || data.version < 1) {
    return cortexImportFailure("That Cortex progress file has no readable version. Nothing was imported.");
  }
  if (data.version > CORTEX_EXPORT_VERSION) {
    return cortexImportFailure("That file was made by a newer version of Cortex. Update Cerebrum, then import it again.");
  }
  if (!Array.isArray(data.courses)) {
    return cortexImportFailure("That file is missing its courses section. Nothing was imported.");
  }
  for (const course of data.courses) {
    const problem = cortexCourseProblem(course);
    if (problem) return cortexImportFailure(problem);
  }
  if (!cortexIsPlainObject(data.claims)) {
    return cortexImportFailure("That file is missing its review claims section. Nothing was imported.");
  }
  for (const claim of Object.values(data.claims)) {
    const problem = cortexClaimProblem(claim);
    if (problem) return cortexImportFailure(problem);
  }
  if (!cortexIsPlainObject(data.profile)) {
    return cortexImportFailure("That file is missing its profile section. Nothing was imported.");
  }
  /* The profile is small and every real export writes all of it,
     so an empty or partial profile is a corrupt one: touchStreak
     iterates profile.days on the next load and the XP total is
     read as a number everywhere it shows. */
  if (!cortexIsFiniteNumber(data.profile.xp) || data.profile.xp < 0
    || !cortexIsStringArray(data.profile.days)
    || (data.profile.bridged != null && !cortexIsStringArray(data.profile.bridged))
    || (data.profile.freezes != null && !cortexIsFiniteNumber(data.profile.freezes))
    || (data.profile.freezeMilestone != null && !cortexIsFiniteNumber(data.profile.freezeMilestone))) {
    return cortexImportFailure("That file's profile section is not shaped like a Cortex profile. Nothing was imported.");
  }
  if ((data.profile.sparks != null && (!cortexIsFiniteNumber(data.profile.sparks) || data.profile.sparks < 0))
    || (data.profile.loopDay != null && typeof data.profile.loopDay !== "string")
    || (data.profile.reminderHour != null && (!Number.isInteger(data.profile.reminderHour) || data.profile.reminderHour < 0 || data.profile.reminderHour > 23))
    || (data.profile.leaguesOptIn != null && typeof data.profile.leaguesOptIn !== "boolean")) {
    return cortexImportFailure("That file's profile section is not shaped like a Cortex profile. Nothing was imported.");
  }
  if (data.profile.loop != null) {
    const loopProblem = cortexLoopProblem(data.profile.loop);
    if (loopProblem) return cortexImportFailure(loopProblem);
  }
  if (!cortexIsPlainObject(data.builtinProgress) || !cortexIsPlainObject(data.builtinProgress.lessons)) {
    return cortexImportFailure("That file is missing its path progress section. Nothing was imported.");
  }
  for (const rec of Object.values(data.builtinProgress.lessons)) {
    const problem = cortexProgressRecordProblem(rec);
    if (problem) return cortexImportFailure(problem);
  }
  if ((data.builtinProgress.lastPathId != null && typeof data.builtinProgress.lastPathId !== "string")
    || (data.builtinProgress.lastLessonId != null && typeof data.builtinProgress.lastLessonId !== "string")) {
    return cortexImportFailure("That file's path progress section has a continue pointer that is not readable. Nothing was imported.");
  }
  if (data.sound != null && typeof data.sound !== "boolean") {
    return cortexImportFailure("That file's sound setting is not readable. Nothing was imported.");
  }
  return {
    ok: true,
    state: {
      courses: data.courses,
      claims: data.claims,
      profile: data.profile,
      builtinProgress: data.builtinProgress,
      sound: data.sound === true,
    },
  };
}

/* Write a validated import, all five keys or none of them. The
   save helpers used elsewhere swallow storage errors on purpose
   (a failed routine save must never break a lesson), but an import
   announces success out loud, so it may only do so after every
   section is verifiably stored. The pre import value of every key
   is snapshotted first; any write or read back failure restores
   all five, so a half written record is never reported as
   imported. Storage is any localStorage shaped object, which
   keeps the whole transaction testable without a DOM. */
export function applyCortexImport(state, storage) {
  const store = storage || (typeof localStorage !== "undefined" ? localStorage : null);
  if (!store || typeof store.getItem !== "function" || typeof store.setItem !== "function") {
    return cortexImportFailure("This browser would not store the import. Nothing was imported.");
  }
  const s = cortexIsPlainObject(state) ? state : {};
  const entries = [
    [COURSES_KEY, Array.isArray(s.courses) ? s.courses : []],
    [CLAIMS_KEY, cortexIsPlainObject(s.claims) ? s.claims : {}],
    [PROFILE_KEY, cortexIsPlainObject(s.profile) ? s.profile : cortexEmptyProfile()],
    [BUILTIN_PROGRESS_KEY, cortexIsPlainObject(s.builtinProgress) ? s.builtinProgress : cortexEmptyBuiltinProgress()],
    [SOUND_KEY, s.sound === true],
  ];
  let prior;
  try { prior = entries.map(([key]) => [key, store.getItem(key)]); }
  catch { return cortexImportFailure("This browser would not store the import. Nothing was imported."); }
  const rollback = () => {
    for (const [key, raw] of prior) {
      try {
        if (raw == null) { if (typeof store.removeItem === "function") store.removeItem(key); }
        else store.setItem(key, raw);
      } catch { /* rollback is best effort; the failure is reported either way */ }
    }
  };
  for (const [key, value] of entries) {
    const raw = JSON.stringify(value);
    try {
      store.setItem(key, raw);
      if (store.getItem(key) !== raw) throw new Error("stored value did not read back");
    } catch {
      rollback();
      return cortexImportFailure("The import could not be fully saved in this browser, so nothing was changed. Your existing progress is untouched.");
    }
  }
  return { ok: true };
}

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
  /* Citation markers and stray whitespace go; emphasis stays. The
     answers mark key terms with **pairs** and species names with
     *pairs* or _pairs_, and the card renderers format those marks
     through parseRichText, the same conventions the answer itself
     renders with. Stripping the marks here used to flatten every
     finding to plain text, species names included. Logic that
     compares claim text (normKey, hashes, dedupe) is unaffected:
     it already ignores punctuation. */
  return String(s || "")
    .replace(/\[(\d+)\]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();
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
/* Authored quiz options used to render in authored order, and the
   authored sets park the correct answer at index 1 almost every
   time (37 of 45 path quizzes, 183 of 192 topic quizzes, never at
   index 3), so position alone named the answer. The Player now
   shuffles the options of every option card it renders (quiz,
   cloze, and true or false, authored and generated alike) per
   attempt, through this helper: the seeded shuffle above applied
   to the option indices, with the correct marker remapped to the
   correct option's new home. The authored data itself is never
   rewritten; the display order is a Player concern, salted per
   mount and per attempt like the match and order shuffles, so a
   retry never repeats the layout just memorised. Returns null for
   cards that carry no readable option set, so callers fall back
   to the card as written. */
export function shuffledOptionsForCard(card, seed) {
  if (!card || !Array.isArray(card.options) || card.options.length < 2) return null;
  if (!Number.isInteger(card.correct) || card.correct < 0 || card.correct >= card.options.length) return null;
  const indices = seededShuffle(card.options.map((_, i) => i), seed);
  return {
    options: indices.map((i) => card.options[i]),
    correct: indices.indexOf(card.correct),
    indices,
  };
}
/* The lesson Player is a modal layer, so Tab must cycle inside it
   instead of leaking to the page behind. Given how many focusable
   controls the shell holds, which one currently has focus (its index
   in the list, or a negative number when focus sits on the shell
   itself), and whether Shift is held, decide where Tab goes next.
   Returns the index to focus, "hold" when nothing inside can take
   focus yet (keep focus on the shell), or null when the browser's
   natural move already lands inside the shell. */
export function focusTrapStep(count, activeIndex, shiftKey) {
  if (!count || count <= 0) return "hold";
  if (activeIndex < 0 || activeIndex >= count) return shiftKey ? count - 1 : 0;
  if (!shiftKey && activeIndex === count - 1) return 0;
  if (shiftKey && activeIndex === 0) return count - 1;
  return null;
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

/* A sentence can be a clean, complete finding and still carry its
   citation on its face: "Smith et al. (2023) found...", "Jones and
   Lee (2021) reported...", "(Garcia, 2020)", and the yearless
   shapes "Smith found that...", "According to Smith, ...",
   "Smith claimed that...", "Smith's study found that...", and
   "Darwin (1859) proposed...". Taught text states
   ideas in plain words; it never names who reported them, so any
   sentence wearing an author citation shape is screened out of the
   claim pool entirely, not trimmed. Taught text also carries no
   years at all, the same rule the authored courses follow, so a
   bare year token from 1500 to 2099 screens a sentence out as
   well. The claim then
   either stands as a plain statement without attribution, in some
   other sentence of the answer, or it is not taught. */
function hasAttributionShape(text) {
  if (/\bet al\.?\b/i.test(text)) return true;
  // Name directly before a parenthesised year: "Smith (2023)",
  // "Smith and Jones (2023)", "Smith, Jones (2023)", and the same
  // shape in any century a citation can carry, "Darwin (1859)".
  if (/\b[A-Z][A-Za-z'’-]+(?:\s*(?:,|and|&)\s*[A-Z][A-Za-z'’-]+)*\s*\(\s*(?:15|16|17|18|19|20)\d{2}/.test(text)) return true;
  // Parenthetical citation: "(Smith, 2023)", "(Smith et al., 2023)",
  // "(Darwin, 1859)".
  if (/\(\s*[A-Z][A-Za-z .&'’-]*,?\s*(?:15|16|17|18|19|20)\d{2}[a-z]?\s*\)/.test(text)) return true;
  // "According to <Name>" openers, with or without a year anywhere:
  // "According to Smith, short sleep doubles infection rates."
  if (/\bAccording to\s+[A-Z][A-Za-z'’-]+(?:\s*(?:,|and|&)\s*[A-Z][A-Za-z'’-]+)*/.test(text)) return true;
  // A name, or a name pair joined by &, "and", or a comma, directly
  // governing a speech or discovery verb, with no year needed:
  // "Smith found that...", "Smith & Jones found that...",
  // "Darwin proposed that...", "Smith claimed that...", "Darwin
  // wrote that...". A single capitalised word that is a
  // common sentence opening noun (Sleep, Results, Adults, and the
  // like) governing the same verb is plain teaching, not a named
  // attribution, and stays admitted; the guard list below is what
  // holds that line. A bare name used as a topic word, with no
  // such verb, no year, and no According opener, is also admitted:
  // teaching may name a topic ("Darwin's finches live on islands")
  // without attributing a finding to anyone.
  const ATTRIBUTION_VERBS = "found|showed|reported|proposed|discovered|demonstrated|argued|concluded|observed|noted|claimed|stated|suggested|estimated|published|wrote";
  const NAME_SEQ = "[A-Z][A-Za-z'’-]+(?:\\s*(?:,|and|&)\\s*[A-Z][A-Za-z'’-]+)*";
  const nameVerbRe = new RegExp("\\b(" + NAME_SEQ + ")\\s+(?:" + ATTRIBUTION_VERBS + ")\\b", "g");
  const COMMON_SUBJECTS = new Set([
    "the", "this", "that", "these", "those", "it", "they", "we", "he", "she", "there",
    "sleep", "results", "result", "findings", "data", "studies", "study", "adults", "children",
    "volunteers", "participants", "patients", "people", "research", "evidence", "treatment",
    "exercise", "memory", "attention", "light", "water", "air", "blood", "pain", "dreams", "dream",
    "smell", "taste", "gravity", "heat", "cold", "music", "reading", "practice", "training",
    "fasting", "diet", "work", "play", "rest", "stress", "illness", "disease", "infection",
    "temperature", "pressure", "weight", "growth", "time", "cells", "genes", "bacteria",
    "plants", "animals", "students", "teachers", "doctors", "parents", "men", "women",
    "group", "groups", "team", "teams", "analysis", "trial", "experiment", "review",
  ]);
  let nv;
  while ((nv = nameVerbRe.exec(text)) !== null) {
    const parts = nv[1].split(/\s*(?:,|&|\band\b)\s*/).filter(Boolean);
    if (parts.length === 1 && COMMON_SUBJECTS.has(parts[0].toLowerCase())) continue;
    return true;
  }
  // A possessive name owning a research noun that governs one of
  // the same verbs: "Smith's study found that...", "Darwin's work
  // suggested that...". The namesake line still holds: a possessive
  // name with no research noun after it ("Darwin's finches") names
  // a topic, not the owner of a finding, and stays admitted.
  const possRe = new RegExp("\\b(" + NAME_SEQ + ")(?:['’]s|['’])\\s+(?:study|paper|work|research|experiment|trial)\\s+(?:" + ATTRIBUTION_VERBS + ")\\b");
  const pm = text.match(possRe);
  if (pm) {
    const first = pm[1].split(/\s*(?:,|&|\band\b)\s*/).filter(Boolean)[0];
    if (!COMMON_SUBJECTS.has(String(first || "").toLowerCase())) return true;
  }
  // Any remaining year token from 1500 to 2099: taught text states
  // no years. The pre 1900 range matters because a bare early year
  // attached to a study reference ("a widely repeated study in
  // 1859") is a citation wearing no other citation shape.
  if (/\b(?:15|16|17|18|19|20)\d{2}\b/.test(text)) return true;
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
      if (/sources|references|try asking|related topics|where researchers disagree|how solid is the evidence/i.test(headWords)) { skip = true; continue; }
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
      if (hasAttributionShape(text)) continue;
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

/* ── restatement: quiz options are paraphrases, never lifts ──────
   Quiz options used to be the finding's own sentence, word for
   word, and the distractors were that sentence with one fact
   changed or another paper's sentence untouched. The player had
   just read the finding (on the paper card before the check, or
   in the search answer the course was built from), so the right
   option could be picked by matching its opening words against
   text already on screen: a surface game, not recall. Every
   option is now a restatement of its claim, produced by small
   deterministic transforms: report frames are stripped ("We
   investigated how X alters Y" becomes the claim itself, "X
   alters Y"), a curated set of verbs and terms is swapped for
   plain equivalents, and a leading or middle clause is moved
   when the opening would otherwise survive untouched. The
   distractors get the same treatment and are held to the
   answer's length band, so no surface cue (verbatim overlap,
   a lone long option, a unique specificity) singles the answer
   out. The finding itself still appears word for word after
   answering, in the feedback sheet and the review schedule,
   where quoting it is the point. */
const RESTATE_WORDS = {
  investigated: "examined", evaluated: "assessed", demonstrated: "showed",
  observed: "noted", reported: "stated", conducted: "carried out",
  performed: "carried out", selected: "chosen", recruited: "enrolled",
  altered: "changed", alters: "changes", alter: "change",
  insufficient: "too little", sufficient: "enough", adults: "people",
  raised: "increased", reduced: "lowered",
};
function firstWordsOf(text, n) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean).slice(0, n).join(" ");
}
function swapRestateWords(text) {
  const keys = Object.keys(RESTATE_WORDS).sort((a, b) => b.length - a.length);
  const re = new RegExp("\\b(" + keys.join("|") + ")\\b", "gi");
  return text.replace(re, (m) => {
    const repl = RESTATE_WORDS[m.toLowerCase()];
    return m[0] === m[0].toUpperCase() ? repl[0].toUpperCase() + repl.slice(1) : repl;
  });
}
function stripReportFrame(text) {
  const verbs = "investigated|examined|assessed|evaluated|explored|tested|found|showed|demonstrated|reported|observed|noted|asked";
  const m = text.match(new RegExp("^(?:(?:the\\s+)?(?:study|trial|experiment|analysis|authors|researchers|team)|we)\\s+(?:" + verbs + ")\\s+(?:how|that|whether)\\s+", "i"))
    || text.match(/^(?:the\s+)?(?:results|findings|data)\s+(?:showed|show|indicated|suggested|demonstrated|revealed)\s+(?:that\s+)?/i)
    || text.match(/^it\s+(?:was|is)\s+(?:found|shown|reported|observed|noted)\s+that\s+/i);
  if (!m) return text;
  const rest = text.slice(m[0].length).trim();
  if (rest.length < 24) return text;
  return rest[0].toUpperCase() + rest.slice(1);
}
function moveFrontClause(text) {
  const m = text.match(/^((?:In|Among|Across|During|After|Before|Over|Within|Using|For|Compared with|Compared to)\b[^,]{3,70}),\s+(.+)$/s);
  if (!m) return null;
  const main = m[2].trim();
  if (main.length < 24) return null;
  const front = m[1][0].toLowerCase() + m[1].slice(1);
  return (main[0].toUpperCase() + main.slice(1)).replace(/[.!?]+$/, "") + ", " + front + ".";
}
function rotateMidClause(text) {
  const parts = text.split(", ");
  if (parts.length < 3) return null;
  const mid = parts[1].trim();
  if (!/^(compared|using|including|based|with|involving)\b/i.test(mid)) return null;
  const head = parts[0].trim();
  const tail = parts.slice(2).join(", ");
  if (head.length < 12 || tail.length < 12) return null;
  return mid[0].toUpperCase() + mid.slice(1) + ", " + head[0].toLowerCase() + head.slice(1) + ", " + tail;
}
function restateClaim(text) {
  const orig = String(text || "").trim();
  if (!orig) return orig;
  let out = stripReportFrame(orig);
  out = swapRestateWords(out);
  if (firstWordsOf(out, 3) === firstWordsOf(orig, 3)) {
    out = moveFrontClause(out) || rotateMidClause(out) || out;
  }
  return out;
}
/* Options live in one length band around the answer, so the
   answer is never the lone long (or lone short) sentence on the
   card. The band is half to double, the same rule the fixtures
   assert. */
function withinOptionBand(len, ref) {
  return len >= Math.ceil(ref * 0.5) && len <= Math.floor(ref * 2);
}
function quizCard(claim, allClaims, sources, opts = {}) {
  const salt = hashStr(claim.text);
  const answer = restateClaim(claim.text);
  /* Distractor candidates: fact mutations of the claim itself
     first (same claim, one fact wrong), then the course's other
     claims. Every candidate is restated and held to the answer's
     length band, with no relaxed second pass: an out of band
     option is a length tell that names the answer, so when the
     pool cannot fill the card inside the band the card is dropped
     (null) rather than shipped gameable. Callers count the drop
     on the course they are building. */
  const pool = [...mutatedVariants(claim, allClaims), ...nearestClaims(claim, allClaims, 6)];
  const seenOpt = new Set([normKey(answer)]);
  const distract = [];
  for (const cand of pool) {
    if (distract.length >= 3) break;
    const r = restateClaim(cand);
    const k = normKey(r);
    if (!r || seenOpt.has(k)) continue;
    if (!withinOptionBand(r.length, answer.length)) continue;
    seenOpt.add(k);
    distract.push(r);
  }
  if (distract.length < 3) return null;
  const options = seededShuffle([answer, ...distract], salt + 7);
  return {
    kind: "quiz",
    claimId: "cl" + salt + "-" + (claimSeq++),
    question: opts.question || "Which of these statements is correct?",
    options,
    correct: options.indexOf(answer),
    /* Feedback is the taught statement itself, in plain words. The
       flow shows no citation and no paper: the statement was the
       lesson, and the explanation is the lesson said again. */
    why: claim.text,
  };
}
function clozeCard(claim, allClaims, sources) {
  const m = claim.text.match(NUMBER_RE);
  if (!m) return null;
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
    question: "Predict the result: what value completes this statement?",
    options,
    correct: options.indexOf(value),
    why: claim.text,
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
    question: "Which term completes this statement?",
    prompt: blanked,
    options,
    correct: options.indexOf(entry.term),
    why: claim.text,
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
   eye should land on them while reading. The words between the
   numbers go through parseRichText, so a finding keeps the
   formatting it had in the answer: species names in italics, key
   terms in bold. */
function emphasizeFinding(text, accent) {
  const parts = String(text || "").split(NUMBER_RE);
  return parts.map((part, i) => {
    if (i % 2 === 1) return <strong key={i} style={{ color: accent, fontWeight: 800 }}>{part}</strong>;
    return parseRichText(part).map((seg, j) => {
      if (seg.bold && seg.italic) return <strong key={j}><em>{seg.text}</em></strong>;
      if (seg.bold) return <strong key={j}>{seg.text}</strong>;
      if (seg.italic) return <em key={j}>{seg.text}</em>;
      return seg.text;
    });
  });
}

/* Minimal rich text for every card surface. The conventions mirror
   renderInlineMdLite in CerebrumApp.jsx, the helper the answers
   themselves render with: **pairs** are bold (the answer's key
   terms), *pairs* and _pairs_ are italic (authored copy marks
   species names with asterisks, the answers wrap them in
   underscores). That helper is not exported from the app module,
   so the rules are reimplemented here and must be kept in step
   with it. Everything else is plain text, a lone asterisk glued
   to a word stays the main app's dangling asterisk case and is
   dropped the same way it drops it, and the segments render as
   React text, so nothing authored can inject markup. Returns
   segments of { text, italic } with bold segments carrying
   bold: true for the renderers. */
export function parseRichText(text) {
  const s = String(text || "").replace(/\*\*[^*\n]+\*\*|\*[^*\n]+\*|(\w)\*(?![\w*])/g,
    (m, dangling) => (dangling ? dangling : m));
  const out = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_/g;
  let last = 0;
  let m;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out.push({ text: s.slice(last, m.index), italic: false });
    if (m[1] != null) out.push({ text: m[1], italic: false, bold: true });
    else out.push({ text: m[2] != null ? m[2] : m[3], italic: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last), italic: false });
  return out;
}

function RichText({ text }) {
  return parseRichText(text).map((seg, i) => {
    if (seg.bold && seg.italic) return <strong key={i}><em>{seg.text}</em></strong>;
    if (seg.bold) return <strong key={i}>{seg.text}</strong>;
    if (seg.italic) return <em key={i}>{seg.text}</em>;
    return seg.text;
  });
}

/* Build a course from a finished search. The retrieved material is
   background only: the answer's statements become plain teaching
   text, the lessons read them first and then quiz the concepts, and
   nothing in the flow displays a paper, a finding, or a citation.
   Returns null when the search did not produce enough statements
   to teach from honestly. The conflicts argument is still accepted
   for caller compatibility; the old claim battle lesson quoted two
   papers against each other, which is paper referencing inside the
   learning flow, so battles are no longer generated. */
export function createCourseFromResults(query, sources, answerMd, conflicts) {
  const srcs = (sources || []).filter((s) => s && s.title);
  if (srcs.length < 2) return null;
  // A paper's own title is not a teaching statement. Answers
  // sometimes restate a title as a cited sentence, and it reads as
  // nonsense when it turns up as a quiz option, so title matches
  // never become statements.
  const titleKeys = new Set(srcs.map((s) => normKey(s.title)).filter((t) => t.length > 12));
  const claims = extractClaims(answerMd).filter((c) => {
    const k = normKey(c.text);
    if (titleKeys.has(k)) return false;
    for (const t of titleKeys) if (k.length > 12 && t.includes(k)) return false;
    return true;
  });
  if (claims.length < 3) return null;

  const vocab = extractVocab(claims);
  const lessons = [];
  const clozed = new Set();
  /* Checks quizCard dropped because no in band option set could
     be built for the statement. The statement is still taught in
     the lesson's reading passage; it simply gets no check. The
     count rides on the course record (droppedChecks below) so a
     drop is visible, never silent. */
  let droppedChecks = 0;
  /* One check per taught statement: a cloze when the statement
     carries a value worth predicting, a quiz otherwise. */
  const checkFor = (c) => {
    const cz = !clozed.has(c.text) ? clozeCard(c, claims, srcs) : null;
    if (cz) { clozed.add(c.text); return cz; }
    const q = quizCard(c, claims, srcs);
    if (!q) droppedChecks++;
    return q;
  };
  /* A teaching lesson: one reading passage that states the ideas
     in plain words, then one check per idea, in the same order. */
  const teachLesson = (id, title, subtitle, kicker, heading, chunk) => ({
    id, title, subtitle,
    cards: [
      { kind: "note", kicker, title: heading, text: chunk.map((c) => c.text).join(" ") },
      ...chunk.map(checkFor).filter(Boolean),
    ],
  });

  const first = claims.slice(0, 3);
  const second = claims.slice(3, 6);
  lessons.push(teachLesson("basics", "The Basics", "The core ideas, in plain statements",
    "Start here", "The ideas, in plain words", first));
  if (second.length >= 2) {
    lessons.push(teachLesson("deeper", "Going Deeper", "More of the topic, the same plain way",
      "Going deeper", "More ideas, in plain words", second));
  }

  // Vocabulary lesson: the topic's terms, inside the statements
  // that use them.
  if (vocab.length >= 3) {
    const cards = [{ kind: "note", kicker: "Vocabulary", title: "The language of the field", text: "Every field has words that carry whole ideas. These are this course's terms, each one inside a statement that uses it. Fill in the term from the sense of the sentence." }];
    for (const entry of vocab.slice(0, 4)) {
      const vc = vocabCard(entry, vocab, srcs);
      if (vc) cards.push(vc);
    }
    if (cards.length > 1) lessons.push({ id: "vocab", title: "Vocabulary", subtitle: "Terms in context", cards });
  }

  // Final lesson: every taught idea asked again, then the wrap.
  {
    const taught = [...first, ...second];
    const picks = seededShuffle(taught, hashStr(query || "") + 31).slice(0, 4);
    const cards = [];
    for (const c of picks) {
      const q = quizCard(c, claims, srcs);
      if (q) cards.push(q); else droppedChecks++;
    }
    cards.push({
      kind: "summary",
      title: "Course complete",
      text: "That is the whole course: " + (lessons.length + 1) + " lessons" +
        (vocab.length ? " and " + vocab.length + " terms from the field" : "") +
        ". The questions you answered are now on a review schedule. They will come back as they start to fade, which is when review does the most good.",
    });
    lessons.push({ id: "review", title: "Review", subtitle: "Every idea, asked again", cards });
  }

  const course = {
    id: "course-" + Date.now(),
    query: query || "",
    title: query || "Course",
    createdAt: new Date().toISOString(),
    /* Kept on the record for compatibility with courses already
       stored; no surface displays it any more. Course stats are
       lessons and terms now. */
    sourceCount: srcs.length,
    /* How many checks were dropped at build time because no in
       band option set could be built for their statement. */
    droppedChecks,
    lessons,
    doneLessons: [],
    xpEarned: 0,
    vocab: vocab.map((v) => ({ term: v.term, text: v.claim.text })),
  };

  // Register every interactive card's question for spaced review.
  const claimsStore = loadClaims();
  for (const lesson of lessons) {
    for (const card of lesson.cards) {
      if (card.claimId && (card.kind === "quiz" || card.kind === "cloze")) {
        claimsStore[card.claimId] = {
          id: card.claimId, courseId: course.id, courseTitle: course.title,
          card: { kind: card.kind, question: card.question, prompt: card.prompt, options: card.options, correct: card.correct, why: card.why },
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
@media (prefers-reduced-motion: reduce) {
  .lv-rise, .lv-sheet, .lv-shake, .lv-pop, .lv-pulse { animation: none !important; }
  .lv-btn, .lv-opt, .lv-fill, .lv-node, .lv-topic, .lv-chip { transition: none !important; }
}
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
        position: "absolute", left: 16, bottom: 12, width: 34, height: 3, borderRadius: RADIUS.pill,
        background: "rgba(255,255,255,.55)",
      }} />
    </div>
  );
}

/* ── the catalog ─────────────────────────────────────────────────────
   Shelves of science a visitor can start without inventing a query.
   Every course on the shelves is authored curriculum (TOPIC_COURSES
   below): lessons that teach the topic in plain words, then quiz
   what they taught. Art is a small flat illustration system drawn
   in SVG, one motif per shelf, in the shelf's own deep tones. */
/* ── visual slots (redesign, 2026-10-14) ───────────────────────────
   Teach cards and checks declare visuals by asset path (the art
   wave delivers the files under public/cortex/). A slot whose
   asset has not arrived renders nothing at all: no broken image,
   no reserved box, no layout shift, so a card without its art is
   exactly the card as it renders today. The character slot is the
   same idea at feedback and win screens: one small reaction image
   of the guide, present only when the art exists. */
function CardVisual({ src, P, accent, height = 190 }) {
  const [state, setState] = useState("loading");
  useEffect(() => { setState("loading"); }, [src]);
  if (!src || state === "error") return null;
  return (
    <div aria-hidden="true" style={{
      display: state === "ok" ? "block" : "none",
      borderRadius: 18, overflow: "hidden", border: "1px solid " + P.line,
      background: P.raised, marginBottom: 20,
    }}>
      <img src={src} alt="" loading="lazy"
        onLoad={() => setState("ok")} onError={() => setState("error")}
        style={{ width: "100%", height, objectFit: "cover", display: "block" }} />
    </div>
  );
}

const CHARACTER_POSES = {
  wave: "/cortex/character/pip-greeting.webp",
  cheer: "/cortex/character/pip-celebrating.webp",
  think: "/cortex/character/pip-thinking.webp",
  celebrate: "/cortex/character/pip-celebrating.webp",
};

function CharacterPose({ pose, size = 54 }) {
  const [ok, setOk] = useState(false);
  const src = CHARACTER_POSES[pose] || null;
  useEffect(() => { setOk(false); }, [src]);
  if (!src) return null;
  return (
    <img src={src} alt="" aria-hidden="true" loading="lazy"
      onLoad={() => setOk(true)} onError={() => setOk(false)}
      style={{ display: ok ? "block" : "none", width: size, height: size, objectFit: "contain", flexShrink: 0 }} />
  );
}

/* A labelled diagram drawn from card data: the steps of a system
   as chips joined by arrows, with a caption. This is the teaching
   visual a lesson carries before any art file exists, and the same
   diagram a visual question is answered from. Words stay in the
   page, where they can be read, resized, and tested. */
function DiagramArt({ diagram, P, accent }) {
  if (!diagram || !Array.isArray(diagram.steps) || !diagram.steps.length) return null;
  return (
    <div style={{ background: P.raised, border: "1px solid " + P.line, borderRadius: 18, padding: "18px 18px 14px", marginBottom: 20 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch", gap: 8 }}>
        {diagram.steps.map((step, i) => (
          <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span style={{
              fontSize: FONT_SIZES.label, fontWeight: 700, color: P.ink, lineHeight: 1.4,
              background: P.bg, border: "1.5px solid " + accent, borderRadius: RADIUS.pill, padding: "8px 13px",
            }}>{step}</span>
            {i < diagram.steps.length - 1 && <span aria-hidden="true" style={{ color: accent, fontWeight: 800 }}>→</span>}
          </span>
        ))}
      </div>
      {diagram.caption && (
        <p style={{ fontSize: FONT_SIZES.label, color: P.ink2, lineHeight: 1.55, margin: "12px 0 2px" }}>{diagram.caption}</p>
      )}
    </div>
  );
}

const CATALOG = [
  { name: "Mind and Brain", motif: "brain", pair: ["#27354d", "#131e30"], topics: [
    { t: "Sleep and Memory", q: "sleep memory consolidation", b: "What sleep does to the memories you formed that day, and how the studies measure it.", img: "/assets/cortex/sleep-memory.jpg" },
    { t: "The Predicting Brain", q: "predictive processing brain perception", b: "How the brain predicts what it is about to sense, and how it corrects itself.", img: "/assets/cortex/predicting-brain.jpg" },
    { t: "Attention Under Siege", q: "attention focus distraction cognition", b: "What focus is, and what pulls it away.", img: "/assets/cortex/attention.jpg" },
    { t: "Why We Dream", q: "dreaming REM sleep function", b: "Why we dream at all, and the explanations researchers are still testing.", img: "/assets/cortex/dreams.jpg" },
  ]},
  { name: "Body and Health", motif: "pulse", pair: ["#42252b", "#281116"], topics: [
    { t: "Exercise and Longevity", q: "exercise longevity mortality", b: "What the research measures about movement, aging, and how much is enough.", img: "/assets/cortex/exercise-longevity.jpg" },
    { t: "The Gut Immune Alliance", q: "gut microbiome immune system", b: "How gut microbes and the immune system shape each other, study by study.", img: "/assets/cortex/gut-immune.jpg" },
    { t: "Fasting and Metabolism", q: "intermittent fasting metabolism", b: "What skipping meals does, and what it does not.", img: "/assets/cortex/fasting.jpg" },
    { t: "Pain, Explained", q: "pain perception neuroscience", b: "How the brain builds pain, and why the same injury can hurt more or less.", img: "/assets/cortex/pain.jpg" },
  ]},
  { name: "Life and Evolution", motif: "helix", pair: ["#1d3b2a", "#0e2417"], topics: [
    { t: "Editing the Code of Life", q: "CRISPR gene editing", b: "Gene editing, from the first tools to the big arguments.", img: "/assets/cortex/crispr.jpg" },
    { t: "Why We Age", q: "cellular aging senescence", b: "How cells age, and the clocks researchers use to measure it.", img: "/assets/cortex/aging.jpg" },
    { t: "Minds of Other Animals", q: "animal cognition consciousness", b: "Which animals know what, and how we can tell.", img: "/assets/cortex/animal-minds.jpg" },
    { t: "The First Life", q: "origin of life abiogenesis", b: "The experiments and arguments about how life first started copying itself.", img: "/assets/cortex/first-life.jpg" },
  ]},
  { name: "Earth and Climate", motif: "earth", pair: ["#173d3a", "#0a2422"], topics: [
    { t: "Oceans in Motion", q: "ocean currents climate", b: "How ocean currents move heat around the planet, and what researchers watch for as they change.", img: "/assets/cortex/oceans.jpg" },
    { t: "The Soil Beneath Us", q: "soil microbiome carbon", b: "The living world inside soil, and the carbon it holds or releases.", img: "/assets/cortex/soil.jpg" },
    { t: "Forests and Carbon", q: "forests carbon sequestration", b: "What forests do with carbon, and how it is measured.", img: "/assets/cortex/forests.jpg" },
    { t: "Extreme Weather", q: "extreme weather attribution climate change", b: "How scientists pin a storm to a warming world.", img: "/assets/cortex/extreme-weather.jpg" },
  ]},
  { name: "Space and Physics", motif: "orbit", pair: ["#33233f", "#1c1226"], topics: [
    { t: "Black Holes", q: "black hole event horizon", b: "Black holes and the edge where the known rules stop working.", img: "/assets/cortex/black-holes.jpg" },
    { t: "The Shape of Spacetime", q: "space time general relativity", b: "Gravity as geometry, and the tests that checked it.", img: "/assets/cortex/spacetime.jpg" },
    { t: "Quantum Machines", q: "quantum computing error correction", b: "How quantum computers work, and the errors they have to outrun.", img: "/assets/cortex/quantum.jpg" },
    { t: "Worlds Around Other Stars", q: "exoplanet atmospheres habitability", b: "Reading the air of planets we will never touch.", img: "/assets/cortex/exoplanets.jpg" },
  ]},
  { name: "The Living World", motif: "microbe", pair: ["#2c3a1c", "#18230c"], topics: [
    { t: "The Insect Gut", q: "insect gut microbiome", b: "The microbes inside insect guts, and the chemistry they do there.", img: "/assets/cortex/insect-gut.jpg" },
    { t: "Fermentation", q: "fermentation microbes food", b: "Fermentation, the food technology that stays alive in the jar.", img: "/assets/cortex/fermentation.jpg" },
    { t: "Microbes and Crops", q: "plant microbiome agriculture", b: "How the microbes around roots and the crops above them affect each other.", img: "/assets/cortex/crops.jpg" },
    { t: "The Ocean's Smallest", q: "marine microbes phytoplankton", b: "Marine microbes and phytoplankton, the smallest life in the sea.", img: "/assets/cortex/ocean-smallest.jpg" },
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
      <div style={{ position: "absolute", left: 16, bottom: 12, width: 34, height: 3, borderRadius: RADIUS.pill, background: "rgba(255,255,255,.55)" }} />
    </div>
  );
}

/* ── built in curriculum ───────────────────────────────────────────
   Paths a visitor can learn from with no search and no papers: the
   concepts are taught directly, in small steps, with activities.
   A lesson may end with a deepen card that opens the topic itself
   wider, in plain words. Nothing in a path references a paper, a
   finding, or a search. Content is standard textbook knowledge,
   written for a curious twelve year old, in plain words. Card
   factories keep the data compact; the validators below keep it
   honest. */

const BUILTIN_PROGRESS_KEY = "cerebrum-learn2-progress";

function loadBuiltinProgress() {
  const p = loadJSON(BUILTIN_PROGRESS_KEY, null);
  if (p && p.lessons) return p;
  return { lessons: {}, lastPathId: "", lastLessonId: "" };
}
function saveBuiltinProgress(p) { saveJSON(BUILTIN_PROGRESS_KEY, p); }

const mkNote = (kicker, title, text, extra) => ({ kind: "note", kicker, title, text, ...(extra || {}) });
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

/* ── second version card kinds (redesign, 2026-10-14) ─────────────
   Four kinds join the Player. Each is a check on something an
   earlier card in the same lesson taught, each answers through the
   same feedback sheet, and each obeys the quiz fairness laws:
   options are restatements in one length band, no position or
   length giveaway, and the Player, never the data, decides where
   options sit. A visual question is answered from a picture or
   diagram the lesson taught with (the card carries the same visual
   or diagram as the teach card). Spot the error shows a worked
   claim as tappable pieces, exactly one of them wrong. Predict
   asks the learner to commit to an outcome before the card reveals
   what happens and why. Build assembles a small system from its
   parts in the right order, scored like an order card. */
/* visual/ diagram are declared in the card data: visual is an asset
   path under public/cortex/ delivered by the art wave; when the
   asset is absent the Player renders the card exactly as it renders
   today, with no broken image and no reserved space. */
const mkVisualQ = (question, visual, diagram, options, correct, why) => ({ kind: "visualq", question, visual, diagram, options, correct, why });
const mkSpotError = (prompt, parts, wrong, fix, why) => ({ kind: "spoterror", prompt, parts, wrong, fix, why });
const mkPredict = (question, outcome, options, correct, why) => ({ kind: "predict", question, outcome, options, correct, why });
const mkBuild = (prompt, items, why) => ({ kind: "build", question: prompt, prompt, items, why });

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
                "Science begins when someone asks a question the world can answer. Not every question works. A good science question points at something you can observe, count, or measure, so the answer can be checked by anyone who repeats the work.",
                { visual: "/cortex/paths/path-science.webp" }),
              mkQuiz("Which of these questions can science test directly?",
                ["Which song is the most beautiful ever written?", "Do plants grow faster in sunlight or in shade?", "What is the meaning of life and why are we all here?", "Which color is the luckiest?"],
                1,
                "Growth can be measured, so the plant question can be tested. Beauty, meaning, and luck rest on opinion, so no test can settle them."),
              mkMatch("Match each word to what it means.",
                [["Observe", "Watch or measure something carefully"], ["Evidence", "Facts that support an idea"], ["Test", "A check that can be repeated"], ["Question", "Something you want to find out"]],
                "These four words run the whole of science: a question, a test, careful observing, and the evidence that comes back."),
              mkTrueFalse("A scientific test only counts if it works one time.",
                false,
                "A result you can trust can be repeated. If a test works once and never again, scientists suspect luck, an error, or a hidden difference in how it was done."),
              mkQuiz("A claim is testable when...",
                ["everyone already agrees with it", "an observation could show it is wrong", "it sounds impressive", "it has been believed for a very long time by many people"],
                1,
                "If nothing you could observe would ever count against a claim, there is no way to test it. Testable claims stick their neck out."),
              mkDeepen("Go deeper: guessing before you study is not wasted effort. A committed guess primes your brain to notice the real answer when it arrives, and the correction sticks far better than a fact you only read. Try it on the next thing you learn: say your guess out loud first, then check how close you came."),
            ],
          },
          {
            id: "sci-hypothesis", title: "Guesses You Can Check", subtitle: "What a hypothesis really is",
            cards: [
              mkNote("Key idea", "A hypothesis is a careful guess",
                "A hypothesis is a possible answer stated clearly enough to be tested. It is more than a hunch. It says what you expect to happen, and what you expect not to happen, before the test begins."),
              mkQuiz("Which of these is a hypothesis?",
                ["Plants are wonderful to look at in spring.", "Fertilizer will make these tomato plants grow taller than plants without it.", "Maybe something interesting will happen at some point soon, though nobody can say what", "Science is hard for everyone at first."],
                1,
                "The fertilizer statement predicts a result that a test can confirm or rule out. The others are feelings or maybes, and a test cannot touch them."),
              mkOrder("Put the steps of a simple investigation in order.",
                ["Ask a question", "Make a hypothesis", "Run a test", "Compare the result with the hypothesis", "Share what you found"],
                "Question first, then a guess, then a test, then a comparison, then sharing, so other people can check the work for themselves."),
              mkTrueFalse("A hypothesis that turns out to be wrong was a waste of time.",
                false,
                "A wrong hypothesis still teaches something real: that explanation is not the one. Ruling out wrong answers is progress, not failure."),
              mkQuiz("Why do scientists write the hypothesis down before the test?",
                ["To make the report much longer", "So the prediction cannot be quietly changed after the results arrive", "Because journals like long and detailed documents full of careful formal writing", "To impress other scientists with careful work"],
                1,
                "Writing it first keeps everyone honest. A prediction invented after seeing the results is not a prediction at all."),
              mkDeepen("Go deeper: a strong hypothesis is written down before the test begins, in words sharp enough to be proven wrong. A guess that can survive every possible result predicts nothing at all. The sharper the prediction, the more a passing test actually teaches you."),
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
                ["A famous actor says it helped him feel much better", "One patient felt better after taking it for a week, and told all his friends about it again and again for months afterward", "A large study where similar patients took the medicine or a dummy pill, and more of the medicine group recovered", "The company that sells it says it works very well"],
                2,
                "Big groups and fair comparisons win. A single story can be luck, and a seller has a reason to praise the product."),
              mkTrueFalse("One personal story can be true and still be weak evidence.",
                true,
                "Both can hold at once. One story might be exactly what happened, but a single case cannot show what usually happens."),
              mkQuiz("Two friends disagree about whether it rained more this year than last year. What settles it?",
                ["Whoever argues loudest and longest of everyone", "Rainfall records for both years", "Whoever is older", "A coin toss watched by both of them"],
                1,
                "Records beat memories. Measurements written down at the time do not depend on who remembers best."),
              mkDeepen("Go deeper: evidence comes in strengths. One person noticing one thing once is a whisper. The same result showing up again and again, measured in different ways by different people, is a shout. Learning to hear the difference is most of what thinking like a scientist means."),
            ],
          },
          {
            id: "sci-repeat", title: "Why Scientists Repeat Tests", subtitle: "Once is a hint, twice is a pattern",
            cards: [
              mkNote("Key idea", "Once is a hint, twice is a pattern",
                "A single study can be a fluke, a mistake, or plain luck. When other scientists repeat the test and get the same result, confidence grows. Science trusts results that survive repetition, not results that happened once."),
              mkQuiz("A study finds a surprising result. What should happen next?",
                ["It becomes fact forever", "Other scientists try to repeat it and check the result", "It is kept secret from everyone", "The scientists celebrate and stop working on it altogether"],
                1,
                "Surprising results get the most checking, not the least. Repetition by other teams is how a result earns trust."),
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
              mkDeepen("Go deeper: even famous results sometimes fail when careful people try to repeat them, and those failures are not embarrassments. They are the system working. A result you can trust is one that survives being checked by someone who would be happy to prove it wrong."),
            ],
          },
        ],
      },
      {
        id: "sci-fair-honest", title: "Fair Tests and Honest Answers", subtitle: "One change at a time",
        lessons: [
          {
            id: "sci-controls", title: "Change One Thing at a Time", subtitle: "Fair tests change a single variable",
            cards: [
              mkNote("Key idea", "Fair tests change one thing",
                "A fair test changes exactly one thing and keeps everything else the same. Suppose you test a new plant food, but the fed plants sit in a sunny window while the unfed ones sit in a dark corner. If the sunny plants grow taller, you cannot tell whether the food or the light did it. Change one thing at a time, and the result can speak clearly."),
              mkQuiz("Two gardens get the same soil, water, and sunlight. One gets fertilizer and grows taller. What can you conclude?",
                ["Nothing, because gardens are unpredictable in every single way there is", "The fertilizer is the likely reason, since it was the only difference", "Sunlight must have done it", "The taller garden was just lucky"],
                1,
                "Only one thing differed between the gardens, so only that thing can explain the difference in growth. A fair setup is what makes a conclusion possible."),
              mkMatch("Match each word to what it means.",
                [["Variable", "The one thing you change in a test"], ["Control group", "The group that gets no change, for comparison"], ["Constant", "Something kept the same for every group"], ["Fair test", "A test where only the variable differs"]],
                "Variables change, constants stay put, and the control group shows what happens without the change. That trio makes results readable."),
              mkTrueFalse("If two things change at once in a test, you can usually still tell which one caused the result.",
                false,
                "Usually you cannot. When two things change together, either one could explain the outcome, and the test cannot separate them. That is why scientists change one thing at a time."),
              mkQuiz("Why do scientists keep a control group in a test?",
                ["To use up extra materials", "To see what happens when the one change is missing", "To make the test take much longer than it really needs to take", "To impress the reviewers"],
                1,
                "The control group is the comparison. Without it, there is nothing to measure the changed group against, and any result could have happened anyway."),
              mkDeepen("Go deeper: the control group is where fair tests are won or lost. Change one thing, keep everything else the same, and any difference in the outcome points at your one change. Let two things change at once and you will never know which one did the work."),
            ],
          },
          {
            id: "sci-blind", title: "Not Fooling Yourself", subtitle: "Blind tests and the power of expecting",
            cards: [
              mkNote("The big idea", "Expecting can change what you see",
                "People tend to notice what they expect to notice. If you believe a medicine works, you may feel better and report feeling better, even if the pill did nothing at all. Scientists guard against this self trickery with blind tests, where the people taking part do not know who got the real treatment and who got a harmless stand in."),
              mkQuiz("In a blind test of a new medicine, the volunteers do not know...",
                ["whether the study will be published in a journal or kept private forever", "whether they got the real medicine or a dummy pill", "the name of the lead scientist", "how long the study will last"],
                1,
                "Hiding who got what keeps expectations from bending the results. Feelings and reports stay honest because nobody knows which group they are in."),
              mkOrder("Put the steps of a blind medicine test in order.",
                ["Volunteers are split into two groups", "One group gets the real medicine, the other a dummy pill", "Nobody is told which group is which", "Both groups are measured the same way", "The results are compared and the code is revealed"],
                "Splitting comes first and revealing comes last. In between, the hiding does its work: expectations cannot steer what people report."),
              mkTrueFalse("A person can feel real relief from a dummy pill, just from expecting it to work.",
                true,
                "This is called the placebo effect, and it is real relief, not pretending. Expecting help can change pain and other feelings, which is exactly why dummy pills are needed to test medicines fairly."),
              mkQuiz("Why do scientists bother with dummy pills at all?",
                ["To save money on medicine", "To separate what the medicine does from what expecting does", "To make the study more confusing", "To give everyone in the study something to swallow each morning"],
                1,
                "If the real medicine beats the dummy pill, the medicine itself is doing something beyond expectation. If both groups improve equally, expectation was the active ingredient."),
              mkDeepen("Go deeper: the placebo effect shows how much expectation alone can do. People can feel genuinely better after a treatment with nothing active in it, simply because they believed it would help. That is why good tests hide who got the real thing, sometimes from the testers as well as the tested."),
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
        id: "body-cells",
        title: "Cells",
        subtitle: "The smallest living thing",
        lessons: [
          {
            id: "body-cells-smallest",
            title: "The smallest living thing",
            subtitle: "One cell, or trillions of them",
            cards: [
              mkPredict("How many cells are you made of?",
                "You are made of trillions of cells. One cell is the smallest living unit there is.",
                ["Only one, in total", "More than one", "Only the skin has cells", "A body holds no cells at all"],
                1,
                "A body is not one cell. It is trillions of cells working together."),
              mkNote("The big idea", "The smallest living unit",
                "A cell is the smallest living unit. Every living thing is made of one cell or many cells, and you are made of trillions of them. A single cell is too small to see with the eye alone, but a microscope makes cells visible. No cell works alone, and each cell carries a control center holding a full instruction book.",
                { visual: "/cortex/lessons/body/u1-l1-cell.webp" }),
              mkNote("Key idea", "The line between living and not",
                "Things that are not alive, like a rock or a spoon, have no cells at all. Cells are the line between living and not living. Your cells come in many kinds, but every one is a complete tiny living unit."),
              mkNote("How it works", "From one cell to a whole body",
                "One cell can divide and make copies of itself. The copies group together and build bigger and bigger parts. Step by step, a single starting cell becomes a whole body.",
                { diagram: { steps: ["A single cell", "Cells divide and make copies", "Copies group into tissues", "Tissues build organs", "Organs work together in one body"], caption: "Starting from one cell and arriving at a whole body." } }),
              mkVisualQ("Look at the picture. What is the big round shape?",
                "/cortex/lessons/body/u1-l1-cell.webp", null,
                ["A rock with no living parts inside it", "A cell, the smallest living unit", "A spoon seen very close up", "A whole body in one piece"],
                1,
                "The picture shows one cell. A cell is the smallest living unit, and trillions of them build a body."),
              mkMatch("Match each word to its meaning.",
                [["Cell", "The smallest living unit"], ["Microscope", "A tool that makes tiny cells visible"], ["Tissue", "Cells of one kind grouped together"], ["Organ", "A body part built from tissues"]],
                "Cells group into tissues, and tissues build organs like the heart."),
              mkTrueFalse("You are made of trillions of cells.",
                true,
                "One cell is far too small to build a body. Trillions of cells together make you."),
              mkTrueFalse("A rock is made of cells, like every other thing.",
                false,
                "A rock is not alive and has no cells at all. Cells belong only to living things."),
              mkQuiz("A drop of pond water under a microscope holds a creature made of one cell. What is true of it?",
                ["It is not alive until it joins a body", "It is a tiny piece broken off a rock", "It is a whole living thing in a single cell", "It needs many cells before it can live and feed and grow on its own at all"],
                2,
                "One cell can be a whole living thing. Size and cell count do not decide whether something is alive."),
              mkNote("The payoff", "Cells build everything",
                "You are trillions of cells, and each one is a complete tiny living unit. Together they build tissues, organs, and a whole body. Tomorrow: what runs a cell?")
            ]
          },
          {
            id: "body-cells-inside",
            title: "Inside a cell",
            subtitle: "A skin, a control center, and tiny power stations",
            cards: [
              mkPredict("What runs a cell?",
                "A control center inside the cell holds a full instruction book. It directs what the cell builds and when it divides.",
                ["The power stations, burning food through the day and night", "A control center holding a full instruction book", "A tiny stomach that chews food for the cell", "The outer skin, pulling every string alone"],
                1,
                "The control center holds the instructions. The other parts do other jobs, like releasing energy or holding the cell together."),
              mkNote("The big idea", "A skin called the membrane",
                "Every cell is wrapped in a skin called the membrane. The membrane holds the cell together and controls what enters and what leaves. Inside the cell is a soft jelly like filling where the real work happens.",
                { visual: "/cortex/lessons/body/u1-l2-cell.webp" }),
              mkNote("Key idea", "The control center",
                "Near the center sits the control center, called the nucleus. It holds the instruction book that tells the cell what to build and when to divide. The instructions are complete in every cell, not shared out in pieces."),
              mkNote("How it works", "Tiny power stations",
                "Tiny power stations called mitochondria release energy from food. The control center directs the work while waste waits to leave. The cell is a tiny workshop that never fully closes.",
                { visual: "/cortex/lessons/body/u1-l2-inside.webp", diagram: { steps: ["Food and oxygen enter", "The power stations release energy", "The control center directs the work", "Waste leaves through the membrane"], caption: "Food comes in, energy is released, and waste goes out." } }),
              mkVisualQ("Look at the picture. What sits at the center of the cell in the picture?",
                "/cortex/lessons/body/u1-l2-inside.webp", null,
                ["The control center, which holds the instructions", "A power station, burning food for the whole cell", "The membrane, wrapped around the outside edge", "A store of food waiting unused in a corner by itself"],
                0,
                "The control center sits near the middle and holds the instruction book. The power stations sit around it."),
              mkOrder("Put the journey of food energy inside a cell in order.",
                ["Food enters the cell", "The power stations release its energy", "The control center directs the work", "Waste leaves through the membrane"],
                "Food comes in first and waste goes out last. Energy is released in between, under the control center."),
              mkTrueFalse("The membrane controls what enters and leaves the cell.",
                true,
                "The membrane is the cell skin and its gate at once. It holds the cell together while letting the right things pass."),
              mkTrueFalse("The power stations hold the instruction book of the cell.",
                false,
                "The power stations release energy. The instruction book sits in the control center."),
              mkQuiz("A cell has a damaged membrane that leaks. What goes wrong for that cell?",
                ["Its power stations stop making food from air", "Its control center moves out into the blood", "It cannot control what enters and leaves the cell", "Its instruction book turns into a second cell with a full set of working power stations"],
                2,
                "The membrane is the gate of the cell. When it leaks, the cell cannot control its inside, and the inside falls into disorder."),
              mkNote("The payoff", "A workshop that never closes",
                "Each cell is a tiny workshop with a skin, a control center, and power stations. The control center directs the work and the membrane guards the gate. Tomorrow: why do you have to keep eating and breathing?")
            ]
          },
          {
            id: "body-cells-eat-breathe",
            title: "How cells eat and breathe",
            subtitle: "Why you eat and breathe at all",
            cards: [
              mkPredict("Why do you have to keep eating and breathing?",
                "Your cells release energy from food using oxygen, all day and all night. Eating and breathing keep that release going.",
                ["Your stomach gets bored and asks for company", "Breathing is a habit you could drop any day", "Your cells use food and oxygen to release energy, all the time", "Food sits in the body unused until you sleep and dream through the whole long night"],
                2,
                "Food and oxygen are the supplies. Without a steady supply, cells cannot release the energy they run on."),
              mkNote("The big idea", "Delivered to every cell",
                "Cells cannot go shopping, so everything they need is delivered. Blood brings food and oxygen to every cell and carries waste away, which is why the blood never stops moving. The carrying protein in the red cells is called hemoglobin, rich in iron, and it turns bright red when it carries oxygen.",
                { visual: "/cortex/lessons/body/u1-l3-delivery.webp" }),
              mkNote("Key idea", "Food and oxygen at work",
                "Inside the cell, food and oxygen are used together to release energy. The waste of that work is carbon dioxide and water. You breathe out the carbon dioxide your cells made."),
              mkNote("How it works", "One job, two ends",
                "Eating brings the food and breathing brings the oxygen. The cell does the rest, releasing energy and handing back waste. From the outside it looks like two jobs, but the cell sees one.",
                { diagram: { steps: ["Food and oxygen arrive by blood", "The cell releases energy from them", "Carbon dioxide is the waste", "Blood carries the waste away"], caption: "Eating and breathing are one job seen from two ends." } }),
              mkVisualQ("Look at the diagram. What does the cell make as waste?",
                null,
                { steps: ["Food and oxygen arrive by blood", "The cell releases energy from them", "Carbon dioxide is the waste", "Blood carries the waste away"], caption: "Eating and breathing are one job seen from two ends." },
                ["Oxygen, which the lungs must breathe out fast", "Carbon dioxide, which the blood carries away", "Fresh food, ready for the next cell in line", "Extra energy, stored in the blood for the night ahead"],
                1,
                "Releasing energy leaves carbon dioxide behind as waste. The blood carries that waste away from the cell."),
              mkBuild("Build the delivery round in order.",
                ["Blood brings food and oxygen", "The cell releases energy", "Waste enters the blood", "The blood carries it away"],
                "Deliveries arrive first and waste leaves last. Energy is released in the middle of the round."),
              mkTrueFalse("You breathe out carbon dioxide that your cells made.",
                true,
                "Cells make carbon dioxide as waste when they release energy. Breathing out clears it from the body."),
              mkTrueFalse("Cells get their food by chewing it themselves.",
                false,
                "Cells cannot chew or shop. Blood delivers food to them and carries their waste away."),
              mkQuiz("A muscle cell is working much harder than a resting cell nearby. Why does it need more deliveries?",
                ["It has grown too big for its membrane to hold", "It uses more food and oxygen and makes more waste", "It has lost its control center during the work", "It needs a second instruction book to keep up with all the extra work it is doing now"],
                1,
                "Hard work burns through food and oxygen faster. More deliveries in means more waste out."),
              mkNote("The payoff", "Why meals and breaths matter",
                "You eat and breathe for your cells, not just for your stomach and lungs. Blood delivers food and oxygen, and cells turn them into energy and waste. Tomorrow: what closes a scrape on your knee?")
            ]
          },
          {
            id: "body-cells-divide",
            title: "How cells divide",
            subtitle: "One becomes two, and a scrape closes",
            cards: [
              mkPredict("What closes a scrape on your knee?",
                "Cells beside the scrape divide and make new cells. The new cells fill the gap until the skin is whole again.",
                ["Blood delivers new cells ready made to the scrape", "The skin stretches thin to cover the gap at once", "Cells near the scrape divide and make new cells", "A scab alone fills the whole gap with living skin that grows and divides like the cells beside it"],
                2,
                "Division makes the new cells a scrape needs. The blood helps, but it does not deliver cells ready made."),
              mkNote("The big idea", "One cell becomes two",
                "When a cell divides, one cell becomes two. First the instruction book is copied, so each new cell holds the full set of instructions. Division is how a body grows bigger and how damage gets filled in.",
                { visual: "/cortex/lessons/body/u1-l4-divide.webp" }),
              mkNote("Key idea", "Different cells, different pace",
                "Cells do not all divide at the same pace. Skin cells divide often, which is why skin heals quickly after a scrape. Some cells, once formed, divide rarely or never, and the body guards those cells instead."),
              mkNote("How it works", "Copied first, then split",
                "The copying comes first, before any split begins. Then the cell stretches and pinches in the middle. Two cells form where one cell stood.",
                { visual: "/cortex/lessons/body/u1-l4-splitting.webp", diagram: { steps: ["The instruction book is copied", "The cell stretches and pinches in the middle", "Two cells form", "Each holds the full instruction book"], caption: "Two cells form, and each one holds the full instructions." } }),
              mkVisualQ("Look at the picture. What is happening to the cells in the picture?",
                "/cortex/lessons/body/u1-l4-splitting.webp", null,
                ["Two cells are joining into one big cell", "A cell is shrinking as its food runs out", "One cell is dividing into two cells", "Cells are grouping into a tissue for the first time in the body of a growing child"],
                2,
                "The picture shows division finished, with two cells where one stood. Each holds a full instruction book."),
              mkSpotError("One piece of this claim is wrong. Tap the piece that does not belong.",
                ["Before a cell divides, its instruction book is copied.", "The cell stretches and pinches in the middle.", "Each new cell gets only half of the instructions.", "Two new cells form, each ready to work."],
                2,
                "Each new cell gets a full copy of the instruction book.",
                "The book is copied in full before the split. Half a book would leave a new cell unable to do its work."),
              mkTrueFalse("Before a cell divides, its instruction book is copied in full.",
                true,
                "Copying comes first, so both new cells start with the complete set of instructions."),
              mkTrueFalse("New cells are delivered ready made by the blood.",
                false,
                "The blood delivers food and oxygen, not finished cells. New cells come from cells dividing."),
              mkQuiz("A cut in the skin heals faster than a broken bone mends. Why?",
                ["Skin sits closer to the air than bone does", "Blood reaches skin but never reaches bone", "Skin cells divide often, so new skin cells fill the cut quickly", "Bone cells refuse to divide after any injury at all, so a break can never mend on its own"],
                2,
                "Skin is rebuilt by cells that divide often. That fast supply of new cells closes a cut quickly."),
              mkNote("The payoff", "Splitting builds and repairs",
                "Division grows the body and fills in damage, one copied instruction book at a time. Skin does it often, which is why scrapes close fast. Tomorrow: what is a muscle actually made of?")
            ]
          },
          {
            id: "body-cells-tissues",
            title: "How cells team up",
            subtitle: "From cells to tissues to organs",
            cards: [
              mkPredict("What is a muscle actually made of?",
                "A muscle is muscle cells of one kind working together as a tissue. Tissues are crews of cells, not single cells.",
                ["One giant cell that stretches and pulls", "Tiny ropes with no living cells in them", "Cells of one kind, teamed up as a tissue", "Bones ground down into a soft and stretchy paste that the body shapes into working parts"],
                2,
                "Muscle tissue is many muscle cells teamed up. One cell alone could not pull the way a muscle pulls."),
              mkNote("The big idea", "Crews, not crowds",
                "Cells of one kind working together form a tissue. Muscle tissue shortens, nerve tissue carries messages, and skin tissue covers and protects. A tissue is a crew of cells with one shared job, not a crowd that happens to sit together.",
                { visual: "/cortex/lessons/body/u1-l5-tissues.webp" }),
              mkNote("Key idea", "Tissues join into organs",
                "Tissues join together to build organs. The heart is an organ built from muscle tissue, nerve tissue, and covering tissue, all working as one part. Organs then work together in systems, like the delivery system of heart and blood."),
              mkNote("How it works", "The same pattern, bigger and bigger",
                "Cells build tissues, and tissues build organs. Organs build systems, and systems build you. Each level does work that the level below cannot do alone.",
                { diagram: { steps: ["Cells of one kind", "A tissue working together", "Tissues joined in an organ", "Organs working as a system"], caption: "The same pattern at every size." } }),
              mkVisualQ("Look at the diagram. What do tissues join together to build?",
                null,
                { steps: ["Cells of one kind", "A tissue working together", "Tissues joined in an organ", "Organs working as a system"], caption: "The same pattern at every size." },
                ["A single cell, smaller than before", "An organ, like the heart", "A system of many organs", "A loose crowd of mixed cells"],
                1,
                "Tissues join to build an organ. Organs working together make a system, which is the next level up."),
              mkMatch("Match each level to its meaning.",
                [["Cell", "The smallest living unit"], ["Tissue", "Cells of one kind working together"], ["Organ", "A part built from joined tissues"], ["System", "Organs working together as one team"]],
                "Each level is built from the one below it. Cells, then tissues, then organs, then systems."),
              mkTrueFalse("An organ is built from more than one kind of tissue.",
                true,
                "The heart alone uses muscle tissue, nerve tissue, and covering tissue. One kind of tissue is not enough."),
              mkTrueFalse("A tissue is one single cell working alone.",
                false,
                "A tissue is many cells of one kind working together. A single cell working alone is just a cell."),
              mkQuiz("Why could a lump of muscle tissue alone never do the job of a heart?",
                ["Muscle tissue is always too weak to squeeze", "The heart sits too far from the blood supply", "The heart needs nerve and covering tissue working with its muscle", "A lump of muscle would float away inside the chest before it could settle into place and start"],
                2,
                "An organ is tissues working as one part. The heart needs its nerve tissue and covering tissue alongside the muscle."),
              mkNote("The payoff", "From cells to systems",
                "Cells team into tissues, tissues join into organs, and organs work as systems. That pattern builds everything in you, from skin to heart. Tomorrow: can you prove the whole unit, start to finish?")
            ]
          },
          {
            id: "body-cells-checkpoint",
            title: "Checkpoint: Cells",
            subtitle: "Eight mixed questions on the whole unit. Nothing new, just proof.",
            checkpoint: true,
            cards: [
              mkQuiz("What is the smallest living unit there is?",
                ["One whole tissue", "One single cell", "A small organ like the heart", "A drop of blood on its own"],
                1,
                "Every living thing is built from cells. A single cell is the smallest unit that is alive."),
              mkMatch("Match each part of a cell to its job.",
                [["Membrane", "The skin that controls what enters and leaves"], ["Control center", "The part that directs the work of the cell"], ["Power stations", "The parts that release energy from food"], ["Instruction book", "The full set of directions inside the center"]],
                "Each part has its own job. Skin, director, power, and directions are four different roles."),
              mkVisualQ("Look at the picture. Which part directs the work of the cell?",
                "/cortex/lessons/body/u1-l2-inside.webp", null,
                ["The membrane around the outside", "A power station near the edge", "The control center in the middle", "The jelly like filling that holds every part in place inside the cell"],
                2,
                "The control center holds the instruction book and directs the work. The parts around it do other jobs."),
              mkTrueFalse("The body is made of trillions of cells.",
                true,
                "You are not one cell or a few cells. Trillions of cells build your tissues and organs."),
              mkTrueFalse("A rock is made of cells, like a living thing.",
                false,
                "A rock is not alive and has no cells. Cells are found only in living things."),
              mkOrder("Put these levels in order, from smallest to largest.",
                ["A single cell", "Cells of one kind as a tissue", "Tissues joined in an organ", "Organs working as a system"],
                "The order never changes. Each level is built from the level before it."),
              mkQuiz("Which gas do cells make as waste when they release energy?",
                ["Oxygen from the air", "Water vapor only", "Carbon dioxide", "Fresh food sugar"],
                2,
                "Cells use oxygen and food to release energy. Carbon dioxide is the waste gas left over."),
              mkSpotError("One piece of this claim is wrong. Tap the piece that does not belong.",
                ["The membrane controls what enters the cell.", "The power stations release energy from food.", "The power stations hold the instruction book.", "Waste leaves through the membrane."],
                2,
                "The control center holds the instruction book.",
                "Power stations release energy and nothing else. Holding the instructions is the job of the control center.")
            ]
          }
        ]
      },
      {
        id: "body-fuel",
        title: "Fuel",
        subtitle: "Air in, food down, energy out",
        lessons: [
          {
            id: "body-breathing",
            title: "Breathing and the lungs",
            subtitle: "Air in, waste gas out",
            cards: [
              mkPredict("What does your body take from the air?",
                "Your body takes oxygen from the air. It gives back carbon dioxide, the waste gas your cells make.",
                ["Carbon dioxide in, and oxygen out", "Oxygen in, and carbon dioxide out", "Oxygen and food, with nothing given back", "Only water, taken in as a fine mist"],
                1,
                "Breathing is a trade. Oxygen crosses into the blood and carbon dioxide crosses out to leave."),
              mkNote("The big idea", "Two sponges full of air sacs",
                "Your lungs are like two soft sponges filled with millions of tiny air sacs. A sheet of muscle under them, the diaphragm, flattens when you breathe in and pulls air down into the sacs. There, oxygen slips through thin walls into the blood, and carbon dioxide slips the other way, ready to be breathed out.",
                { visual: "/cortex/lessons/body/u2-l1-lungs.webp" }),
              mkNote("Key idea", "The trade at the air sacs",
                "At the air sacs, oxygen slips through thin walls into the blood. Carbon dioxide slips out of the blood at the same time, and the trade repeats with every breath. The air you breathe out is used air, changed by the trade."),
              mkNote("How it works", "The muscle under the lungs",
                "The diaphragm is a wide sheet of muscle stretched under the lungs. When it flattens, it pulls air down into the air sacs. When it relaxes, air flows back out.",
                { visual: "/cortex/lessons/body/u2-l1-diaphragm.webp", diagram: { steps: ["The diaphragm flattens", "Air flows down to the air sacs", "Oxygen slips into the blood", "Carbon dioxide slips out to be breathed away"], caption: "One breath in is the diaphragm at work." } }),
              mkVisualQ("Look at the picture. What is the wide sheet of muscle under the lungs?",
                "/cortex/lessons/body/u2-l1-diaphragm.webp", null,
                ["The heart, squeezing blood out to the body", "A stomach muscle that churns food below", "The diaphragm, which flattens to pull air in", "The covering skin that holds the lungs in place while you breathe in and out each day"],
                2,
                "The diaphragm sits under the lungs and does most of the work of breathing in. Flattening pulls air down."),
              mkOrder("Put the journey of one breath in order.",
                ["The diaphragm flattens", "Air flows down to the air sacs", "Oxygen crosses into the blood", "Carbon dioxide crosses out of the blood", "The used breath leaves the body"],
                "Air moves only after the diaphragm pulls it in. The gas trade happens at the sacs, before the breath leaves."),
              mkTrueFalse("The diaphragm does most of the work of breathing in.",
                true,
                "It flattens with every breath in and pulls air into the lungs. Other muscles help, but it leads."),
              mkTrueFalse("The air you breathe out is exactly the air you breathed in.",
                false,
                "The body keeps some oxygen and adds carbon dioxide. Breathed out air is used air, changed by the trade."),
              mkQuiz("You run hard and start breathing much faster. Why?",
                ["Your lungs grow larger each time you run", "The air near the ground turns thin as you run", "Hard working muscles use more oxygen and make more carbon dioxide to clear", "Your heart needs the lungs to entertain it while it works much harder than usual"],
                2,
                "Working muscles burn oxygen faster and make waste gas faster. Faster breathing speeds up both sides of the trade."),
              mkNote("The payoff", "Every breath is a trade",
                "Breathing trades oxygen for carbon dioxide at the air sacs, breath after breath. The diaphragm does the pulling and the blood does the carrying. Tomorrow: why does blood look red?")
            ]
          },
          {
            id: "body-blood",
            title: "Blood as a delivery system",
            subtitle: "What is actually in the red stuff",
            cards: [
              mkPredict("Why does blood look red?",
                "Blood looks red because of hemoglobin, a protein rich in iron inside red cells. It turns bright red when it carries oxygen.",
                ["The skin colors the blood as light shines through it", "Food dyes the blood red after every meal you eat", "Hemoglobin in red cells turns bright red as it carries oxygen", "The heart heats the blood until it glows a deep red color in the dark of the chest"],
                2,
                "Hemoglobin is the reason. Loaded with oxygen, it is bright red, and red cells are packed with it."),
              mkNote("The big idea", "A fleet floating in plasma",
                "Blood is mostly a pale liquid called plasma, with cells floating in it. Red cells carry oxygen using hemoglobin, white cells hunt germs, and tiny platelets help seal leaks. The heart pumps this fleet without rest, driven by its own pace setter, a patch that fires the signal for each beat.",
                { visual: "/cortex/lessons/body/u2-l2-blood.webp" }),
              mkNote("Key idea", "Each part has one job",
                "Red cells carry oxygen, white cells hunt germs, and platelets gather to seal leaks when a vessel is cut. Plasma carries food, warmth, and messages around the body, and food passes into the blood in the small intestine. Plasma also carries food to cells to be used now or stored for later. At a cut, the blood clots to seal the leak, and the dry top of the clot becomes the scab."),
              mkNote("How it works", "One loop around the body",
                "Blood leaves the heart carrying oxygen and food for the cells. Cells take what they need and hand back waste. The blood then returns to the heart to load up and go out again. Outward roads are called arteries, and returning roads are called veins.",
                { diagram: { steps: ["The heart pushes blood out", "Red cells carry oxygen to the body", "Cells take oxygen and hand back waste", "Blood returns to the heart"], caption: "One loop, never parked." } }),
              mkVisualQ("Look at the picture. What do the red shapes in the picture carry?",
                "/cortex/lessons/body/u2-l2-blood.webp", null,
                ["Germs, hunted down by the white cells", "Oxygen, held by the protein hemoglobin", "Messages, sealed inside tiny bottles", "Food sugar, dissolved in the pale plasma that fills most of the stream in the picture"],
                1,
                "The red shapes are red blood cells. Their hemoglobin grabs oxygen in the lungs and lets go where cells need it."),
              mkBuild("Build a clot at a cut, step by step.",
                ["A vessel is cut and blood leaks", "Platelets gather at the leak", "The blood clots and seals it", "A scab covers the repair"],
                "A leak comes first and the scab comes last. Platelets and the clot do the sealing in between."),
              mkTrueFalse("Platelets help the blood clot when you are cut.",
                true,
                "Platelets gather at a leak and help build the clot. The clot plugs the leak while the skin heals."),
              mkTrueFalse("White blood cells carry oxygen around the body.",
                false,
                "White cells hunt germs. Carrying oxygen is the job of the red cells and their hemoglobin."),
              mkQuiz("Why can a doctor learn so much about your whole body from one small tube of blood?",
                ["Blood stays in one place and reports on it", "A tube of blood holds a tiny map of the body", "Blood carries cells, food, waste, and messages from everywhere", "Doctors can hear the heart beating inside a tube of blood if they listen very closely at night"],
                2,
                "Blood visits every part of you and picks up a little of everything. Its load tells the story of the whole body."),
              mkNote("The payoff", "One fleet, many jobs",
                "Blood is a fleet with carriers, guards, and a repair crew, all floating in plasma. It delivers oxygen and food and carries waste and messages back. Tomorrow: who tells your heart to beat?")
            ]
          },
          {
            id: "body-heart",
            title: "The heartbeat nobody orders",
            subtitle: "A fist sized muscle with a nonstop job",
            cards: [
              mkPredict("Who tells your heart to beat?",
                "Nobody tells the heart to beat. A small patch inside it, its pace setter, fires the signal for every beat on its own.",
                ["Your brain, sending an order for every beat", "Your lungs, each time you take a breath in", "Its own pace setter, inside the heart itself", "No part at all, since the heart beats only when you are awake and moving around the room"],
                2,
                "The pace setter is built into the heart. The beat goes on day and night without waiting for orders."),
              mkNote("The big idea", "A fist sized pump",
                "Your heart is a muscle about the size of your fist. It squeezes about once a second, all day and all night, pushing blood around your body. That adds up to about 100,000 beats a day, each one sending blood out and welcoming blood back.",
                { visual: "/cortex/paths/path-body-heart-blood.webp" }),
              mkNote("Key idea", "Its own pace setter",
                "The heart has its own pace setter, a small patch of cells that fires the signal for each beat. That is why the beat goes on while you sleep and never waits for orders from you. When you run, the pace setter answers the need of your muscles, and the beat speeds up. A trained heart grows stronger and moves more blood with each beat."),
              mkNote("How it works", "How one beat runs",
                "Each beat begins with a signal, not with an order from outside. The squeeze pushes blood out to the body. Then the heart fills again, ready for the next signal.",
                { diagram: { steps: ["The pace setter fires", "The heart squeezes", "Blood rushes out to the body", "Blood returns and the heart fills again"], caption: "Every beat starts the same way, about once a second." } }),
              mkVisualQ("Look at the diagram. Where does each beat begin?",
                null,
                { steps: ["The pace setter fires", "The heart squeezes", "Blood rushes out to the body", "Blood returns and the heart fills again"], caption: "Every beat starts the same way, about once a second." },
                ["In the brain, which orders each single beat", "In the lungs, when air flows down into them", "At the pace setter, the patch that fires the signal", "At the muscles, which squeeze the heart from outside each time blood needs to move around"],
                2,
                "The diagram starts with the pace setter firing. No outside order appears anywhere in the loop."),
              mkSpotError("One piece of this claim is wrong. Tap the piece that does not belong.",
                ["The pace setter fires a signal.", "The heart squeezes and pushes blood out.", "The brain orders every single beat.", "Blood returns and the heart fills again."],
                2,
                "The pace setter of the heart fires each beat on its own.",
                "The brain can speed the heart or slow it, but it does not order each beat. The pace setter inside the heart does that."),
              mkTrueFalse("Your heart keeps beating while you sleep, with no orders from you.",
                true,
                "The pace setter fires on its own, awake or asleep. Sleep never pauses the beat."),
              mkTrueFalse("The heart rests for most of the day between beats.",
                false,
                "The heart rests only in the short pauses between beats. It beats about 100,000 times a day without a real break."),
              mkQuiz("A trained athlete has a slow resting heartbeat. Why?",
                ["Training teaches the heart to skip beats safely", "The pace setter slows down for good after training", "A stronger pump moves more blood with every beat, so it needs fewer beats at rest", "A stronger heart holds blood back and releases it slowly through the day and night at rest"],
                2,
                "Fitness makes the pump stronger. A stronger pump delivers what the body needs in fewer, bigger beats."),
              mkNote("The payoff", "The beat that never waits",
                "Your heart beats about 100,000 times a day, fired by its own pace setter. It speeds up when muscles call for more and settles when they rest. Tomorrow: where does a meal become part of you?")
            ]
          },
          {
            id: "body-digestion",
            title: "Digestion",
            subtitle: "The long way down",
            cards: [
              mkPredict("Where does a meal become part of you?",
                "A meal becomes part of you in the small intestine. There its useful pieces pass into the blood, and the blood carries them everywhere.",
                ["In the mouth, the moment you chew a bite", "In the stomach, as juices churn the meal", "In the small intestine, where food passes into the blood", "In the large intestine, where water is taken back and the last useful pieces are gathered in"],
                2,
                "Chopping and churning only prepare the meal. Passing into the blood is the step that makes it part of you."),
              mkNote("The big idea", "A disassembly line inside you",
                "Digestion takes food apart until the pieces are small enough to pass into your blood. It starts in the mouth, where teeth chop food and saliva begins the work. The stomach churns the pieces with strong juices, and the small intestine finishes the job, soaking the useful pieces into the blood for delivery.",
                { visual: "/cortex/lessons/body/u2-l4-digestion.webp" }),
              mkNote("Key idea", "Small pieces, more surface",
                "Chewing helps because smaller pieces give the juices far more surface to work on. The large intestine then reclaims water, and what is left over leaves the body. Helpful bacteria in the gut finish jobs your own juices cannot do alone."),
              mkNote("How it works", "The long way down",
                "Each stop on the line does a job the others cannot do. The mouth starts, the stomach churns, and the small intestine absorbs the nutrients. Nothing is skipped and the order never changes.",
                { diagram: { steps: ["Chewing starts the breaking down", "The stomach churns food with juices", "The small intestine absorbs the useful pieces", "The large intestine reclaims water"], caption: "Chop first, churn second, absorb third." } }),
              mkVisualQ("Look at the diagram. Where do most nutrients pass into the blood?",
                null,
                { steps: ["Chewing starts the breaking down", "The stomach churns food with juices", "The small intestine absorbs the useful pieces", "The large intestine reclaims water"], caption: "Chop first, churn second, absorb third." },
                ["In the stomach, while churning", "In the mouth, while chewing", "In the small intestine", "In the large intestine"],
                2,
                "The small intestine absorbs most of the useful pieces from food. The other stops prepare the food or reclaim water."),
              mkMatch("Match each stop to its job.",
                [["Mouth", "Chops food and starts the work with saliva"], ["Stomach", "Churns food with strong juices"], ["Small intestine", "Absorbs most of the useful pieces into the blood"], ["Large intestine", "Reclaims water from what is left"]],
                "Each stop has one main job. Together they take a meal apart and take in what the body can use."),
              mkTrueFalse("The small intestine absorbs most of the nutrients from food.",
                true,
                "Its inner surface is huge, and across it the useful pieces slip into the blood."),
              mkTrueFalse("The stomach does the whole job of digestion alone.",
                false,
                "The stomach is one stop on the line. The mouth starts the work and the small intestine absorbs most nutrients."),
              mkQuiz("Why does chewing well make the job of the stomach easier?",
                ["Chewing warms the food so juices can rest", "Chewing removes the need for juices at all", "Smaller pieces give the juices far more surface to work on", "Well chewed food skips the stomach and floats straight to the blood through the small intestine walls"],
                2,
                "Juices can only work on the surface they touch. More surface means the churning and soaking run faster."),
              mkNote("The payoff", "Meals become you in stages",
                "Digestion chops, churns, and absorbs a meal until its useful pieces ride the blood. Chewing well starts the whole line off right. Tomorrow: you eat a big lunch, then sit still all afternoon. Where does the energy go?")
            ]
          },
          {
            id: "body-energy",
            title: "Where your energy actually comes from",
            subtitle: "Food is fuel, and the body keeps stores",
            cards: [
              mkPredict("You eat a big lunch, then sit still all afternoon. Where does the energy go?",
                "Some lunch energy is used right away for sitting, thinking, and staying warm. The rest is stored in the body for later.",
                ["It all vanishes the moment you stop moving", "It stays in the stomach until the next meal", "Some is used at once, and the rest is stored for later", "It leaves the body as heat at once, every last bit of it, before the afternoon is even over"],
                2,
                "Energy is not lost when you rest. What the cells do not spend, the body keeps in its stores."),
              mkNote("The big idea", "Food is fuel",
                "Food is fuel for the body. Its energy is released inside cells, using oxygen, and it powers movement, warmth, growth, and repair. This is the same release you met inside the cell, now seen starting from your plate.",
                { visual: "/cortex/lessons/body/u2-l5-energy.webp" }),
              mkNote("Key idea", "The store cupboard",
                "Energy you do not use at once is stored, mostly as fat, the store cupboard of the body. Using more than you eat draws the stores down, and eating more than you use builds them up. The stores are why you can skip a meal and still have energy to run."),
              mkNote("How it works", "From plate to power",
                "A meal is broken down until its sugar can ride the blood to the cells. Cells release its energy with oxygen. Anything left over goes into the stores for a hungrier hour.",
                { diagram: { steps: ["Food is broken down", "Blood carries food sugar to the cells", "Cells release energy with oxygen", "What is left over is stored for later"], caption: "Used now or stored for later, nothing is wasted." } }),
              mkVisualQ("Look at the diagram. What happens to energy the body does not use at once?",
                null,
                { steps: ["Food is broken down", "Blood carries food sugar to the cells", "Cells release energy with oxygen", "What is left over is stored for later"], caption: "Used now or stored for later, nothing is wasted." },
                ["It vanishes into the air", "It turns back into food", "It is stored for later", "It waits in the stomach until the next meal arrives"],
                2,
                "The diagram ends with storage. Leftover energy is kept, not thrown away."),
              mkOrder("Put the journey of a sandwich and its energy in order.",
                ["The sandwich is broken down", "Its sugar rides the blood to the cells", "Cells release the energy with oxygen", "The leftover energy is stored"],
                "Breaking down comes first and storing comes last. Release happens inside the cells, in the middle."),
              mkTrueFalse("Unused food energy is stored in the body for later.",
                true,
                "The body keeps a store cupboard for lean hours. Stored energy is spent when food is scarce or work is hard."),
              mkTrueFalse("Energy you do not use at once simply vanishes.",
                false,
                "Nothing vanishes. Unused energy is stored, and the stores are drawn down when you work or skip a meal."),
              mkQuiz("A long hike leaves you hungry again by evening. Why?",
                ["Hiking uses up the air around the trail", "Your stomach shrinks during a long hike", "Hours of work spent the stores, and the body asks for more fuel", "The stores refuse to open while you are outdoors in the light of day and the wind"],
                2,
                "A hike spends energy for hours without a break. Emptying stores is the body signal that more fuel is due."),
              mkNote("The payoff", "Fuel in, fuel stored",
                "Food is fuel, cells release its energy, and leftovers fill the stores. That is how one lunch can power an afternoon and part of an evening too. Tomorrow: can you prove the whole unit, start to finish?")
            ]
          },
          {
            id: "body-fuel-checkpoint",
            title: "Checkpoint: Fuel",
            subtitle: "Eight mixed questions on the whole unit. Nothing new, just proof.",
            checkpoint: true,
            cards: [
              mkQuiz("Which muscle does most of the work of breathing in?",
                ["The heart inside the chest", "The stomach below the ribs", "The diaphragm under the lungs", "The tongue at the back of the mouth"],
                2,
                "The diaphragm flattens under the lungs and pulls air in. It repeats that work with every breath."),
              mkMatch("Match each part to its job.",
                [["Artery", "A vessel that carries blood away from the heart"], ["Vein", "A vessel that carries blood back to the heart"], ["Platelets", "Tiny pieces that help seal leaks and clot blood"], ["Plasma", "The pale liquid that carries food and messages"]],
                "Arteries head out and veins head back. Platelets seal leaks while plasma carries the load."),
              mkVisualQ("Look at the picture. Which muscle pulls air into the lungs?",
                "/cortex/lessons/body/u2-l1-diaphragm.webp", null,
                ["The heart, squeezed tight between the lungs", "A rib muscle along the side", "The diaphragm, stretched under the lungs", "The stomach, churning below"],
                2,
                "The wide sheet under the lungs is the diaphragm. Its flattening is what pulls air down."),
              mkTrueFalse("The heart beats on its own, with no orders from you.",
                true,
                "Its pace setter fires each beat by itself. The beat continues through sleep and rest alike."),
              mkTrueFalse("Veins carry blood away from the heart.",
                false,
                "Veins carry blood back to the heart. Arteries are the vessels that carry blood away."),
              mkOrder("Put the journey of a bite of food in order.",
                ["Chewing in the mouth", "Churning in the stomach with juices", "Absorbing in the small intestine", "Reclaiming water in the large intestine"],
                "Chop, churn, absorb, reclaim. Each stop comes after the one before it."),
              mkQuiz("Why do you breathe faster when you run?",
                ["The lungs need practice at moving fast", "Running shakes extra air loose in the chest", "Working muscles use more oxygen and make more carbon dioxide", "The heart asks the lungs for company on the road while both of them work through the run"],
                2,
                "Faster breathing moves more oxygen in and more waste gas out. It matches what hard working muscles demand."),
              mkSpotError("One piece of this claim is wrong. Tap the piece that does not belong.",
                ["Chewing breaks food into smaller pieces.", "The stomach churns food with strong juices.", "The stomach absorbs most of the nutrients from food.", "The large intestine reclaims water."],
                2,
                "The small intestine absorbs most of the nutrients from food.",
                "The stomach churns, but absorption is the job of the small intestine. That is where nutrients pass into the blood.")
            ]
          }
        ]
      },
      {
        id: "body-control",
        title: "Control",
        subtitle: "Messages, shortcuts, and the control room",
        lessons: [
          {
            id: "body-nerves",
            title: "Neurons",
            subtitle: "The wiring inside you",
            cards: [
              mkPredict("How do messages travel around your body?",
                "Messages travel as tiny electrical signals along nerve cells called neurons. The signals race from cell to cell, all the way to the brain and back out again.",
                ["As messages floating inside the blood", "As signals traveling along nerve cells", "Through the bones, carried by the heart", "Along fine hairs, waving out into the air"],
                1,
                "The wiring of the body is made of nerve cells, and what travels along them is signals, not blood or bone."),
              mkNote("The big idea", "Long thin cells that carry signals",
                "Neurons are nerve cells, and they are long and thin like tiny wires. Each neuron carries a tiny electrical signal along its length. When a signal reaches the end of one neuron, chemical messages carry it across the gap to the next cell.",
                { visual: "/cortex/paths/path-body-senses-nerves.webp" }),
              mkNote("Key idea", "The round trip to the brain",
                "Your senses gather signals from the world and send them along neurons toward the brain. Many of those signals travel through the spinal cord, a thick cable of neurons running inside your backbone, on their way to the brain. The brain decides what to do, and signals travel back out through the cord to your muscles. That loop is how you catch a ball you barely saw."),
              mkNote("How it works", "Catching a ball, step by step",
                "The diagram shows one round trip from the eyes to the hands, as a chain of five fast steps. Each link in the chain hands the signal to the next part, and the whole trip takes a fraction of a second. Practice makes each link in this chain faster.",
                { diagram: { steps: ["Your eyes spot the ball", "Signals race to the brain", "The brain works out where it will land", "Signals race to your arm muscles", "Your hands close on the ball"], caption: "Catching looks simple, but five fast steps happen in less than a blink." } }),
              mkVisualQ("Look at the diagram. Which step comes right after your eyes spot the ball?",
                null,
                { steps: ["Your eyes spot the ball", "Signals race to the brain", "The brain works out where it will land", "Signals race to your arm muscles", "Your hands close on the ball"], caption: "Catching looks simple, but five fast steps happen in less than a blink." },
                ["Your hands close on the ball", "Signals race to your arm muscles", "Signals race to the brain", "Your eyes spot the ball itself"],
                2,
                "The eyes spot the ball first, and the very next step is the signals racing to the brain, which works out where the ball will land."),
              mkMatch("Match each part to its job.",
                [["Neuron", "A long thin cell that carries signals"], ["Signal", "A tiny pulse that travels along a neuron"], ["Brain", "The control room that decides what to do"], ["Muscle", "A tissue that moves a part of the body"]],
                "Neurons carry the signals, the brain decides, and the muscles do the moving."),
              mkTrueFalse("Signals travel along neurons as tiny pulses of electricity.",
                true,
                "Neurons carry tiny electrical signals, and each pulse moves along the cell before jumping to the next one."),
              mkTrueFalse("Messages travel around the body inside the blood.",
                false,
                "Nerve messages race along neurons, not inside the blood. The blood does carry a different and slower kind of message, and one of them is the rush message that speeds the heart when you are frightened."),
              mkQuiz("You practice catching every day for a month. Why do your catches get faster?",
                ["Your eyes grow larger and spot the ball sooner", "Each link in the chain gets faster with practice", "The ball learns to fly slower toward you", "Your muscles move without waiting for any signals at all"],
                1,
                "Practice trains the whole chain, and the brain's regions share the work with the senses and the muscles, link by link."),
              mkNote("The payoff", "You are wired for speed",
                "Messages race along neurons from your senses to your brain and back out to your muscles. The spinal cord is the main cable on that trip, and practice makes the whole chain faster. Tomorrow: why does your hand leave a hot pan before you feel the heat?")
            ]
          },
          {
            id: "body-reflexes",
            title: "Reflexes",
            subtitle: "The shortcut that skips the brain",
            cards: [
              mkPredict("Why does your hand leave a hot pan before you feel the heat?",
                "In a reflex, the signal loops through the spinal cord and heads straight back to the muscle. The brain hears about it a moment later, after the hand is already safe.",
                ["The brain decides before the heat is felt", "The heat pushes the hand away by itself", "The spinal cord moves the hand first", "The muscles guess what is coming next"],
                2,
                "The turn happens in the spinal cord, so the hand moves before the feeling of heat reaches the brain."),
              mkNote("The big idea", "A signal that takes a shortcut",
                "A reflex is a signal that takes a shortcut. Heat sensors in your skin fire, and the signal races to the spinal cord. The cord sends an order straight back to the muscle, and the hand pulls away. The brain hears about it a moment later.",
                { visual: "/cortex/lessons/body/u3-l2-reflex.webp" }),
              mkNote("Key idea", "Guards you never have to order",
                "Reflexes guard you all day long. You blink when something flies at your eye, and you cough when crumbs go down the wrong way. You do not choose these moves, and that is the point. Choosing would take time you do not have."),
              mkNote("How it works", "The loop that turns in the cord",
                "Follow the loop in the picture and the diagram. The signal never climbs all the way to the brain before the hand moves, which is why the move beats the feeling to the finish. It turns around in the spinal cord instead.",
                { visual: "/cortex/lessons/body/u3-l2-arc.webp", diagram: { steps: ["Heat sensors fire in the skin", "The signal races to the spinal cord", "The cord sends the order straight back", "The muscle pulls the hand away"], caption: "The turn happens in the cord, not in the brain." } }),
              mkVisualQ("Look at the picture. Where does the reflex signal turn around?",
                "/cortex/lessons/body/u3-l2-arc.webp",
                null,
                ["In the brain, after a slow and careful decision is made", "In the spinal cord, without waiting for the brain", "In the hand, before the heat is ever felt at all", "In the muscle, where the signal simply stops"],
                1,
                "The signal turns around in the spinal cord and heads straight back to the muscle, without waiting for the brain."),
              mkOrder("Put the reflex round trip in order.",
                ["Heat sensors fire in your skin", "A signal races to the spinal cord", "The cord sends an order straight back", "Your muscle pulls your hand away"],
                "Sensors first, the cord second, the order back third, and the muscle last of all."),
              mkTrueFalse("A reflex can move your hand before you feel the heat.",
                true,
                "The reflex loop finishes in the spinal cord, so the pulling away happens before the feeling catches up."),
              mkTrueFalse("Every reflex signal waits for the brain to decide.",
                false,
                "Reflex signals turn around in the spinal cord and never wait for the brain, which only learns about the move a moment later."),
              mkQuiz("A ball flies straight at your face and you blink before you can think. Why?",
                ["Your brain planned the blink hours earlier", "The ball slows down to give you more time", "Blinking is a reflex run by the shortcut", "Your eyes close whenever the light changes"],
                2,
                "Blinking at danger is a reflex. The shortcut through the cord runs it, not a decision you stopped to make."),
              mkNote("The payoff", "Fast because it skips a step",
                "A reflex is the same signal loop as catching, with the brain left out until later. The spinal cord turns the signal around at once, so the muscle moves before you feel a thing. Tomorrow: is one part of your brain in charge of everything?")
            ]
          },
          {
            id: "body-brain",
            title: "The brain's regions",
            subtitle: "One control room, many desks",
            cards: [
              mkPredict("Is one part of your brain in charge of everything?",
                "The brain is not one worker doing everything. It is many regions side by side, each handling its own kind of work and sharing what it finds with the others.",
                ["Yes. One region runs every single job", "No. Regions share the work between them", "Yes. The front region gives all the orders", "No. One muscle outside the brain runs it"],
                1,
                "No single region runs the whole brain. The regions share the work, and each one handles its own jobs."),
              mkNote("The big idea", "Many regions, one control room",
                "The brain is the control room of the body, sitting at the top of the spinal cord. It is not one single worker. Many regions sit side by side inside it, each handling its own kind of work. The regions report to each other all the time, so the whole brain knows what its parts are doing.",
                { visual: "/cortex/lessons/body/u3-l3-brain.webp" }),
              mkNote("Key idea", "Each region has its own jobs",
                "Some regions handle the senses and some handle movement, while a region at the back keeps your balance and the front regions handle planning and choices. Damage to one region harms its own jobs most, which is how anyone knows the map at all. Brain tissue itself has no pain sensors at all. That is why the brain cannot feel pain, even though the parts around it can."),
              mkNote("How it works", "Signals in, orders out",
                "A signal arriving in the brain does not go to one boss. It reaches the region built for that kind of work, and that region shares its news with the others. Orders then travel back down the spinal cord to the muscles.",
                { diagram: { steps: ["Signals arrive from the senses", "Each region does its own work", "Regions share what they find", "Orders travel back down the cord"], caption: "Many desks, one control room, and every desk shares its news." } }),
              mkVisualQ("Look at the diagram. What does each region do with the signals it gets?",
                null,
                { steps: ["Signals arrive from the senses", "Each region does its own work", "Regions share what they find", "Orders travel back down the cord"], caption: "Many desks, one control room, and every desk shares its news." },
                ["It sends every signal to one single boss", "It keeps every signal a secret from others", "It does its own work, then shares the news", "It turns signals into blood and stores them"],
                2,
                "Each region does its own kind of work first, then shares its news with the other regions."),
              mkBuild("Build the control loop in order.",
                ["Signals arrive from the senses", "Regions do their own work", "Regions share what they find", "Orders travel to the muscles"],
                "Signals arrive, regions work on them and share, and only then do orders travel out to the muscles."),
              mkTrueFalse("Different regions of the brain handle different jobs.",
                true,
                "The senses, movement, balance, and planning each belong mostly to their own regions of the brain."),
              mkTrueFalse("The brain itself feels pain when it is hurt.",
                false,
                "Brain tissue has no pain sensors of its own, so the brain cannot feel pain. Pain near the head comes from the parts around the brain."),
              mkQuiz("An injury at the back of the brain troubles a person's balance and sight. Why those jobs first?",
                ["The back regions handle balance and sight", "The back regions handle planning and choices", "The whole brain stops working at once", "The spinal cord runs balance and sight"],
                0,
                "The regions at the back keep your balance and do the first handling of sight, so an injury there harms those jobs first."),
              mkNote("The payoff", "A team, not a boss",
                "The brain is a control room of many regions, each with its own jobs, all sharing their news. No region works alone, and no region does everything. Tomorrow: why does your heart race when you are suddenly frightened?")
            ]
          },
          {
            id: "body-hormones",
            title: "Hormones",
            subtitle: "Messages that travel by blood",
            cards: [
              mkPredict("Why does your heart race when you are suddenly frightened?",
                "When you are frightened, a gland releases a rush message into the blood. It reaches the heart and speeds it up, readying the whole body for action.",
                ["The brain shakes the heart with its hands", "Cold air rushes into the lungs and pushes on the heart", "A rush message in the blood speeds the heart", "The muscles squeeze the heart from outside"],
                2,
                "The rush message is a hormone. It rides the blood to the heart and speeds the heart up."),
              mkNote("The big idea", "Chemical messages in the blood",
                "Hormones are chemical messages released into the blood by small organs called glands. The blood carries a hormone everywhere it goes. Only the cells with the right receiver for that message answer it. Hormones are slower than nerve signals, and their effects last far longer.",
                { visual: "/cortex/lessons/body/u3-l4-hormones.webp" }),
              mkNote("Key idea", "Three messages you already use",
                "One hormone is a growth message that tells the body to grow, and it works strongest while you sleep. Another is insulin, a sugar message that tells cells to take in sugar after a meal. The rush message readies the body when you are frightened, speeding the heart and freeing stored energy for action."),
              mkNote("How it works", "Heard only by the right cells",
                "A hormone does not travel to one address. It rides the blood past every cell in the body, and only the cells built to hear it respond. The change it brings lasts as long as the message keeps arriving.",
                { diagram: { steps: ["A gland releases a message into the blood", "The blood carries it everywhere", "Cells with the right receiver answer", "The change lasts while the message lasts"], caption: "Slow to arrive, slow to fade, and heard only by the right cells." } }),
              mkVisualQ("Look at the diagram. Which cells answer a hormone?",
                null,
                { steps: ["A gland releases a message into the blood", "The blood carries it everywhere", "Cells with the right receiver answer", "The change lasts while the message lasts"], caption: "Slow to arrive, slow to fade, and heard only by the right cells." },
                ["Every single cell in the body answers it at once", "Only cells with the right receiver for it", "The cells that happen to sit closest to the gland", "Only cells that ask for it by name, one by one"],
                1,
                "The blood carries the message everywhere, but only the cells with the right receiver for it answer."),
              mkSpotError("One piece of this claim is wrong. Tap the piece that does not belong.",
                ["Hormones are chemical messages", "They are released by glands into the blood", "They travel along neurons to one muscle", "Only cells with the right receiver answer them"],
                2,
                "They travel in the blood, and cells with the right receiver answer them",
                "Hormones never travel along neurons at all. They ride the blood, and the cells with the right receiver are the ones that answer."),
              mkTrueFalse("Hormones are messages carried by the blood.",
                true,
                "Glands release hormones into the blood, and the blood carries them to cells all over the body."),
              mkTrueFalse("Hormones act faster than nerve signals.",
                false,
                "Hormones act slowly, riding the blood to their cells, while nerve signals race along neurons in a fraction of a second. That slow ride is why hormone changes last longer."),
              mkQuiz("The danger passes, but your heart keeps racing for a while. Why does the feeling fade slowly?",
                ["The heart forgets how to slow down again", "The rush message fades slowly in the blood", "Nerve signals keep firing at full speed for many hours", "The blood stops moving until you rest"],
                1,
                "The rush message rides the blood and fades slowly, so the heart and the whole body settle slowly too."),
              mkNote("The payoff", "The slow road for messages",
                "Hormones are the slow road for messages, carried by the blood and heard only by cells with the right receiver. The rush message speeds your heart, insulin handles sugar, and the growth message works while you sleep. Tomorrow: why do you think badly after a short night?")
            ]
          },
          {
            id: "body-sleep",
            title: "Sleep",
            subtitle: "The night shift",
            cards: [
              mkPredict("Why do you think badly after a short night?",
                "While you sleep, the brain sorts the memories of the day and clears away the clutter of the day. A short night cuts that sorting and clearing short, so thinking feels muddy the next day.",
                ["The brain gets bored and stops trying", "Sleep gives the brain time to do its work", "Your eyes rest all night, so your thoughts slow down too", "Dreams use up all the thinking power"],
                1,
                "Sleep is when the brain does its sorting work. Cut the sleep short and the work is left half done."),
              mkNote("The big idea", "Sleep is work, not absence",
                "Sleep is work, not absence. While you sleep, your brain sorts the memories of the day, keeping what matters and letting the rest fade. At the same time, your body repairs the wear of the day and grows. Wake too soon and both jobs are left half done.",
                { visual: "/cortex/lessons/body/u3-l5-sleep.webp" }),
              mkNote("Key idea", "Two kinds of sleep take turns",
                "During the deepest sleep, the body does most of its repairing and growing, helped by the growth message from the glands. In another, busier stage of sleep, you dream, and the brain is nearly as busy as when you are awake. The stages take turns all through the night, and each one has its own job."),
              mkNote("How it works", "One night, two shifts",
                "One night is not one long blank. Deep sleep and busy sleep trade places again and again, mending the body in one stage and sorting memories in the other. Miss the later rounds and the sorting suffers most.",
                { diagram: { steps: ["You fall asleep", "Deep sleep repairs and grows the body", "Busy sleep dreams and sorts memories", "You wake with the work done"], caption: "Two kinds of sleep, taking turns, each with its own work." } }),
              mkVisualQ("Look at the diagram. What is the busiest stage of sleep for?",
                null,
                { steps: ["You fall asleep", "Deep sleep repairs and grows the body", "Busy sleep dreams and sorts memories", "You wake with the work done"], caption: "Two kinds of sleep, taking turns, each with its own work." },
                ["Repairing wear and growing the whole body taller", "Dreaming and sorting the day's memories", "Resting the eyes until morning comes", "Clearing the stomach after a big meal"],
                1,
                "Busy sleep is the dreaming stage, and while you dream the brain sorts the memories of the day."),
              mkMatch("Match each part of the night to its job.",
                [["Deep sleep", "When the body repairs and grows most"], ["Busy sleep", "When you dream and the brain stays busy"], ["Growth message", "The hormone that helps the body grow"], ["Memory sorting", "Keeping what matters from the day"]],
                "Deep sleep mends and grows the body, busy sleep dreams and sorts, and the growth message helps with the growing."),
              mkTrueFalse("Your brain sorts memories while you sleep.",
                true,
                "That sorting is why sleep after learning helps keep new memories. The brain keeps what matters and lets the rest fade."),
              mkTrueFalse("Sleeping is the brain switching off completely.",
                false,
                "The sleeping brain stays busy. It dreams, sorts memories, and directs the repair work going on in the body."),
              mkQuiz("Why does a little study each day beat studying all night before a test?",
                ["Studying all night makes the brain stronger for tests", "Sleep after learning keeps the memories", "Tests are always easier in the morning", "Studying at night harms the eyes badly"],
                1,
                "Each day of study is followed by sleep, and sleep sorts and keeps the new memories. Studying all night skips the keeping."),
              mkNote("The payoff", "The night shift earns its keep",
                "Sleep is the night shift of the body. Deep sleep repairs and grows you, busy sleep dreams and sorts your memories, and a short night leaves both jobs half done. Tomorrow: can you prove the whole unit, start to finish?")
            ]
          },
          {
            id: "body-control-checkpoint",
            title: "Checkpoint: Control",
            subtitle: "Eight mixed questions on the whole unit. Nothing new, just proof.",
            checkpoint: true,
            cards: [
              mkQuiz("What carries messages around your body?",
                ["The blood, in its round red cells", "Neurons, the long thin nerve cells", "The bones, through their hard outer shells", "The skin, across its outer surface"],
                1,
                "Neurons are the wiring of the body. Signals travel along them to the brain and back out to the muscles."),
              mkMatch("Match each word to what it means.",
                [["Neuron", "A long thin cell that carries signals"], ["Spinal cord", "The cable of neurons inside the backbone"], ["Hormone", "A message that travels in the blood"], ["Gland", "The small organ that releases a hormone"]],
                "Neurons and the cord carry the fast messages, while glands and hormones work through the blood."),
              mkVisualQ("Look at the picture. Where does the reflex signal turn around?",
                "/cortex/lessons/body/u3-l2-arc.webp",
                null,
                ["In the brain, after it slowly weighs every possible choice", "In the spinal cord, without waiting for the brain", "In the skin, at the place where the heat lands", "In the muscle, at the very end of the trip"],
                1,
                "The reflex signal turns around in the spinal cord and heads straight back to the muscle."),
              mkTrueFalse("A reflex moves your hand without waiting for the brain.",
                true,
                "The reflex loop finishes in the spinal cord, so the hand moves before the brain has decided anything."),
              mkTrueFalse("Hormones travel along neurons to reach their cells.",
                false,
                "Hormones travel in the blood. Neurons carry the fast electrical signals instead."),
              mkOrder("Put the steps of catching a ball in order.",
                ["Your eyes spot the ball", "Signals race to the brain", "The brain works out where it will land", "Signals race to your arm muscles", "Your hands close on the ball"],
                "Seeing comes first and grabbing comes last, with the brain working out the landing place in the middle."),
              mkQuiz("A hormone rides the blood past every cell. Which cells answer it?",
                ["Every cell that the passing blood touches on its way", "Only cells with the right receiver", "Cells in the gland that released it", "Cells that are awake at the time"],
                1,
                "Only the cells with the right receiver for a hormone answer it, even though the blood carries it everywhere."),
              mkSpotError("One piece of this claim is wrong. Tap the piece that does not belong.",
                ["The brain is the control room of the body", "One region of the brain does every job alone", "Regions handle the senses, movement, and choices", "Orders travel back down the spinal cord"],
                1,
                "Regions share the work, each handling its own jobs",
                "No region does every job alone. The regions share the work, and each one handles its own kind of job.")
            ]
          }
        ]
      },
      {
        id: "body-defense",
        title: "Defense",
        subtitle: "Barriers first, then the guards",
        lessons: [
          {
            id: "body-skin",
            title: "Skin and barriers",
            subtitle: "The wall that is alive",
            cards: [
              mkPredict("What is your body's largest organ?",
                "Your skin is your largest organ. It is a living wall that covers the whole body, keeping water in and germs out.",
                ["Your heart, the pump in your chest", "Your skin, the wall you live inside", "Your brain, the control room above", "Your blood, spread through every part of the body"],
                1,
                "Skin covers more of you than any other organ, and it works as a living wall, not a dead covering."),
              mkNote("The big idea", "A living wall around you",
                "Skin is a living wall and your largest organ. It keeps water inside the body and keeps most germs out. Touch, heat, and cold are first sensed in the skin. The wall renews itself as surface cells shed and new cells rise from below.",
                { visual: "/cortex/lessons/body/u4-l1-skin.webp" }),
              mkNote("Key idea", "Skin is not the only barrier",
                "Skin is not the only barrier. Mucus in your nose and air roads traps dust, pollen, and germs before they travel deeper. Tears wash the eyes clean, and the strong juices in your stomach kill many germs that arrive in food. Barriers are the first defense because they stop trouble before it starts."),
              mkNote("How it works", "A wall that renews itself",
                "Skin looks still, but its cells keep rising toward the surface as they age, and the oldest cells shed away. Because the supply from below never stops, the wall can shed without ever opening.",
                { visual: "/cortex/lessons/body/u4-l1-layers.webp", diagram: { steps: ["New cells form below", "They rise as they age", "The surface sheds and renews", "The wall never opens"], caption: "The surface leaves, the wall stays, because new cells keep rising." } }),
              mkVisualQ("Look at the picture. How does the skin wall stay whole while its surface sheds?",
                "/cortex/lessons/body/u4-l1-layers.webp",
                null,
                ["The shed cells climb back into place", "A layer of oil glues the surface down", "New cells keep rising from below", "The wall stops shedding while you sleep"],
                2,
                "New cells form below and keep rising, so every shed cell is replaced and the wall never opens."),
              mkMatch("Match each barrier to its job.",
                [["Skin", "Keeps water in and most germs out"], ["Mucus", "Traps dust, pollen, and germs in the nose"], ["Tears", "Wash the eyes clean"], ["Stomach juices", "Kill many germs that arrive in food"]],
                "Each barrier guards a different opening, and together they stop most trouble before it starts."),
              mkTrueFalse("Skin keeps water in and most germs out.",
                true,
                "The skin is a living wall. It holds the body's water in and blocks most germs from getting in."),
              mkTrueFalse("Skin is a dead covering, like a coat you wear.",
                false,
                "Skin is alive. It senses touch, heat, and cold, and it renews itself as new cells rise and old cells shed."),
              mkQuiz("A graze breaks the skin on your knee. Why does the graze need covering while it heals?",
                ["The blood needs darkness to do its work", "Germs can enter until new skin closes it", "Covering the graze helps the knee bend more easily all day", "Fresh air makes the new skin grow crooked"],
                1,
                "A graze opens the wall, so germs can enter there until new skin grows and closes the gap."),
              mkNote("The payoff", "The wall comes first",
                "Skin is your largest organ and your first defense, a living wall that renews itself from below. Mucus, tears, and stomach juices guard the other openings the same way, by stopping trouble early. Tomorrow: a germ slips past your skin. What happens next?")
            ]
          },
          {
            id: "body-immune",
            title: "Immune cells",
            subtitle: "The guards inside",
            cards: [
              mkPredict("A germ slips past your skin. What happens next?",
                "White blood cells, the guards of the body, hunt the germ down. Some swallow it whole, and others sound the alarm and call for help.",
                ["Nothing at all, if it stays quiet", "It rides the blood with no trouble", "White blood cells hunt it down", "The skin grows over the spot at once"],
                2,
                "The guards are white blood cells, and hunting germs that get inside is their whole job."),
              mkNote("The big idea", "The guard force inside you",
                "The immune system is the guard force of the body, and its soldiers are white blood cells. Some guards patrol the body and swallow germs whole. Others sound the alarm and call for more help. The fight happens wherever germs manage to get in.",
                { visual: "/cortex/lessons/body/u4-l2-immune.webp" }),
              mkNote("Key idea", "Weapons that fit, and a memory",
                "Some guards make weapons called antibodies, shapes built to fit one kind of invader exactly. A guard that has met an invader keeps its pattern, so the next meeting can end before the invader does much harm. Guards that keep the pattern are called memory cells, and a vaccine later uses this same keeping to train the guards safely."),
              mkNote("How it works", "The guard response, in stages",
                "The response builds in stages. The first guards on the scene hold the line and call for help, and later guards arrive with weapons made to fit the invader. That fitting takes time the first time, which is why first fights are the slowest.",
                { diagram: { steps: ["A germ gets past the barrier", "Patrol guards find it and sound the alarm", "More guards arrive and swallow the germs", "Weapons are made that fit this invader"], caption: "First the alarm, then the crowd, then weapons built for one invader." } }),
              mkVisualQ("Look at the diagram. What are the fitted weapons called?",
                null,
                { steps: ["A germ gets past the barrier", "Patrol guards find it and sound the alarm", "More guards arrive and swallow the germs", "Weapons are made that fit this invader"], caption: "First the alarm, then the crowd, then weapons built for one invader." },
                ["Platelets, built to seal a leak", "Antibodies, built to fit one invader", "Neurons, built to carry a signal", "Hormones, built to ride the blood to every cell"],
                1,
                "The fitted weapons are antibodies, and each shape is built to fit one kind of invader."),
              mkOrder("Put the guard response in order.",
                ["A germ slips past the barrier", "Patrol guards find it and raise the alarm", "More guards arrive and swallow germs", "Fitted weapons are made for this invader"],
                "The germ gets in first, the alarm goes up second, more guards arrive third, and the fitted weapons come last."),
              mkTrueFalse("Some white blood cells swallow germs whole.",
                true,
                "Patrol guards really do swallow germs whole. That is one of the main ways germs are cleared from the body."),
              mkTrueFalse("Antibodies are made by red blood cells.",
                false,
                "Antibodies are made by guards, which are white blood cells. Red blood cells carry oxygen and make no weapons at all."),
              mkQuiz("The same germ enters your body a second time. Why does the fight usually end faster than the first time?",
                ["The germ is older, weaker, and far too tired to fight back", "Guards kept the pattern and the weapons ready", "The skin lets it in without a struggle", "Red blood cells learned to swallow it"],
                1,
                "Memory cells kept the pattern from the first meeting, and the guards learned from it, so the fitting weapons are ready at once."),
              mkNote("The payoff", "Guards that remember",
                "White blood cells patrol, swallow germs, sound the alarm, and build antibodies that fit one invader. Memory cells keep the pattern, so a second meeting ends faster than the first. Tomorrow: why does your body heat up when you are ill?")
            ]
          },
          {
            id: "body-fever",
            title: "Fever and infection",
            subtitle: "Turning up the heat",
            cards: [
              mkPredict("Why does your body heat up when you are ill?",
                "An infection is germs multiplying inside you, and the body answers with a fever. The extra heat slows many germs while the guards work faster in it.",
                ["The germs set the body on fire themselves", "The heat helps the guards beat the germs", "The heart works harder and warms the skin", "The body is broken and cannot cool down"],
                1,
                "The heat is raised on purpose. It works against the germs and for the guards at the same time."),
              mkNote("The big idea", "Heat raised on purpose",
                "An infection is germs multiplying inside the body. The body answers by raising its temperature on purpose, and that raised temperature is a fever. Many germs grow poorly in the extra heat. Your guards work faster in it, so the heat helps both ways.",
                { visual: "/cortex/lessons/body/u4-l3-fever.webp" }),
              mkNote("Key idea", "Signs of the fight",
                "Swelling, redness, and soreness near an infected cut are signs of the fight, as more blood and more guards arrive there. Resting saves energy, and that saved energy is what the guards spend on the fight. Most infections end with your own guards winning."),
              mkNote("How it works", "The fever response",
                "A fever is not the illness itself. It is the answer to the illness, timed to the fight. When the guards clear the germs, the body lets its heat fall back to normal.",
                { diagram: { steps: ["Germs multiply in the body", "The body raises its heat", "Germs slow and guards speed up", "The guards clear the infection"], caption: "Heat up, germs down, guards up, infection cleared." } }),
              mkVisualQ("Look at the diagram. What does the raised heat do to the germs?",
                null,
                { steps: ["Germs multiply in the body", "The body raises its heat", "Germs slow and guards speed up", "The guards clear the infection"], caption: "Heat up, germs down, guards up, infection cleared." },
                ["It feeds them, so they multiply faster", "It slows them, while the guards speed up", "It hides them from the patrolling guards", "It turns them into harmless memory cells for later"],
                1,
                "The raised heat slows the germs down, and at the same time the guards speed up in it."),
              mkBuild("Build the fever response in order.",
                ["Germs multiply inside the body", "The body raises its heat on purpose", "Germs slow down and guards speed up", "The guards clear the infection"],
                "Germs multiply first, the heat rises second, the fight turns third, and the guards clear the infection last."),
              mkTrueFalse("A fever is the body raising its heat on purpose.",
                true,
                "The body sets the fever itself, because the extra heat slows germs and speeds the guards."),
              mkTrueFalse("A fever means the germs have already won.",
                false,
                "A fever is a weapon in the fight, not a sign of defeat. Most fevers end with the guards clearing the infection."),
              mkQuiz("You are ill with an infection. Why are you told to rest?",
                ["Resting turns the fever off at once", "The guards can only do their fighting while you are dreaming", "Rest saves energy for the guards to fight", "Lying still hides you from the germs"],
                2,
                "Resting saves energy, and the saved energy is what the guards spend on clearing the infection."),
              mkNote("The payoff", "Heat as a weapon",
                "An infection is germs multiplying, and a fever is the body turning its own heat into a weapon. Germs slow, guards speed up, and rest gives the fight the energy it needs. Tomorrow: how can a practice run protect you from a real germ?")
            ]
          },
          {
            id: "body-vaccines",
            title: "Vaccines",
            subtitle: "Practice before the real thing",
            cards: [
              mkPredict("How can a practice run protect you from a real germ?",
                "A vaccine shows the guards a harmless version of an invader, or just a piece of it, that cannot make you ill. The guards learn its pattern in safety, so they are ready for the real one.",
                ["A strong medicine inside it kills every germ in the body at once", "Your guards learn its pattern before it can harm you", "It gives you a short illness to practice on", "The real germ sees it and stays away"],
                1,
                "The practice teaches the guards the pattern of the invader before the real one can do any harm."),
              mkNote("The big idea", "A harmless version, shown on purpose",
                "A vaccine shows the guards a harmless version of an invader, or just a piece of one. That version cannot make you ill. The guards treat the showing as practice, learn the pattern, and make weapons that fit it. They also keep memory cells, so the lesson stays.",
                { visual: "/cortex/lessons/body/u4-l4-vaccine.webp" }),
              mkNote("Key idea", "Ready before the real thing",
                "When the real invader arrives later, the memory cells answer at once. The fight is usually over before you feel ill at all. A vaccine cannot give you the illness it practices against, because what it carries is harmless, or only a piece of the invader."),
              mkNote("How it works", "Practice first, memory kept",
                "The order is the whole trick. Practice has to come before the real meeting, while there is time to learn. After the practice, the pattern sits stored in memory cells, waiting.",
                { diagram: { steps: ["A harmless version is shown to the guards", "The guards learn its pattern and store it", "The real invader arrives later", "Memory cells answer at once"], caption: "Practice first, memory kept, and the real fight ends early." } }),
              mkVisualQ("Look at the diagram. What do the guards meet first?",
                null,
                { steps: ["A harmless version is shown to the guards", "The guards learn its pattern and store it", "The real invader arrives later", "Memory cells answer at once"], caption: "Practice first, memory kept, and the real fight ends early." },
                ["The real invader, at full strength", "A medicine that kills germs directly", "A harmless version of the invader", "A fever that raises the body heat"],
                2,
                "First the guards meet a harmless version of the invader, purely as practice, and the real one only arrives later."),
              mkSpotError("One piece of this claim is wrong. Tap the piece that does not belong.",
                ["A vaccine shows the guards a harmless version", "The guards learn the pattern in practice", "The vaccine kills germs directly, like a medicine", "Memory cells keep the pattern for later"],
                2,
                "A vaccine teaches the guards the pattern before the real invader arrives",
                "Calling a vaccine a germ killer is the mistake in this claim. It kills nothing itself, and instead it teaches the guards, whose memory cells keep the pattern."),
              mkTrueFalse("A vaccine trains your guards before the real invader arrives.",
                true,
                "The harmless version is the training. Memory cells keep its pattern, ready for the real invader."),
              mkTrueFalse("A vaccine gives you a short dose of the real illness.",
                false,
                "What a vaccine carries is harmless, or only a piece of the invader, so it cannot give you the illness it practices against."),
              mkQuiz("Many people around a baby have had their vaccine practice, but the baby is too young for it. How is the baby still safer?",
                ["The baby learns the whole pattern just by watching others", "Guards in other people stop the germ early", "Vaccines make the air clean around babies", "The germ avoids houses with babies in them"],
                1,
                "When many people can stop the germ, fewer carriers pass it on, so it rarely reaches a baby who cannot practice yet."),
              mkNote("The payoff", "Practice that protects",
                "A vaccine is a practice run with a harmless version, and the guards keep its pattern in memory cells. When the real invader arrives, the answer comes at once, often before you feel ill at all. Tomorrow: why do some people sneeze at flowers?")
            ]
          },
          {
            id: "body-allergies",
            title: "When defense goes wrong",
            subtitle: "Allergies: guards fighting the harmless",
            cards: [
              mkPredict("Why do some people sneeze at flowers?",
                "For some people, the guards mistake harmless pollen for a dangerous invader. That mistake is an allergy, and its tools are sneezing, itching, and watering eyes, all aimed at something that was never a danger.",
                ["Flowers release germs that infect the nose", "Their guards mistake harmless pollen for an invader", "Pollen carries a strong poison that harms every person it touches", "Their noses are broken by the spring air"],
                1,
                "The pollen is harmless. The sneezing comes from guards mistaking it for an invader and firing their weapons at it."),
              mkNote("The big idea", "Real weapons, wrong target",
                "An allergy is the guard force attacking something harmless, like pollen or certain foods. The weapons it fires are real, but the target is no danger at all. Sneezing, itching, and watering eyes are defense tools aimed at the wrong thing.",
                { visual: "/cortex/lessons/body/u4-l5-allergy.webp" }),
              mkNote("Key idea", "The mistake is in the aiming",
                "The first meeting teaches the guards the wrong pattern, and later meetings with the same harmless thing trigger the full response at once. Allergies are not infections, and nothing is multiplying inside you. The mistake is in the aiming, not in the strength of the guards."),
              mkNote("How it works", "A normal response to a harmless thing",
                "Every step in the diagram is a normal defense step. Only the first step is wrong, because the thing that arrived was harmless. After that error, the rest of the response runs exactly as it would for a real invader.",
                { diagram: { steps: ["A harmless thing like pollen arrives", "Guards mistake it for an invader", "Weapons fire and vessels swell", "You sneeze and itch at the harmless thing"], caption: "Real weapons, real swelling, and a target that never was a danger." } }),
              mkVisualQ("Look at the diagram. What do the guards get wrong?",
                null,
                { steps: ["A harmless thing like pollen arrives", "Guards mistake it for an invader", "Weapons fire and vessels swell", "You sneeze and itch at the harmless thing"], caption: "Real weapons, real swelling, and a target that never was a danger." },
                ["They forget how to make any fitting weapons at all", "They mistake something harmless for an invader", "They arrive too late to help at all", "They mistake a real invader for a friend"],
                1,
                "The guards mistake something harmless, like pollen, for an invader, and the whole response follows from that one mistake."),
              mkMatch("Match each part of an allergy to its role.",
                [["Pollen", "The harmless trigger that starts it"], ["Sneezing", "A defense tool that blasts air out"], ["Itching", "A warning feeling in the skin"], ["Watering eyes", "A defense tool that washes the eyes"]],
                "Pollen is the harmless trigger, and sneezing, itching, and watering eyes are defense tools aimed at it by mistake."),
              mkTrueFalse("In an allergy, the guards attack something harmless.",
                true,
                "That is what an allergy is. The weapons are real, but the thing they attack, like pollen, is no danger."),
              mkTrueFalse("An allergy is an infection by pollen.",
                false,
                "Pollen is not a germ, and in an allergy nothing is multiplying inside you. The guards are simply aiming at the wrong thing."),
              mkQuiz("A person with a pollen allergy sneezes within minutes of stepping into a flowery field. Why so fast?",
                ["The pollen multiplies inside the nose first", "Brand new guards must be made from scratch every single time", "The guards learned the pattern and answer at once", "The field is full of germs in the spring"],
                2,
                "The guards learned the wrong pattern at an earlier meeting, so like a memory response, the answer fires at once."),
              mkNote("The payoff", "Strong guards, wrong aim",
                "An allergy is defense aimed at the harmless, with real weapons fired at pollen or certain foods. Nothing is infecting you, and the guards are not weak. Their aim is simply wrong. Tomorrow: can you prove the whole unit, start to finish?")
            ]
          },
          {
            id: "body-defense-checkpoint",
            title: "Checkpoint: Defense",
            subtitle: "Eight mixed questions on the whole unit. Nothing new, just proof.",
            checkpoint: true,
            cards: [
              mkQuiz("What is the largest organ in your body?",
                ["Your heart, the pump in the chest", "Your skin, the living wall around you", "Your brain, the busy control room of the body", "Your blood, spread through it all"],
                1,
                "Skin covers the whole body and works as a living wall, which makes it the largest organ you have."),
              mkMatch("Match each word to what it means.",
                [["Skin", "The living wall that keeps germs out"], ["Mucus", "The trap for dust, pollen, and germs"], ["Antibodies", "Weapons built to fit one invader"], ["Memory cells", "Guards that keep a pattern for later"]],
                "Skin and mucus are barriers, while antibodies and memory cells belong to the guards inside."),
              mkVisualQ("Look at the picture. How does the skin wall stay whole while its surface sheds?",
                "/cortex/lessons/body/u4-l1-layers.webp",
                null,
                ["The shed cells climb back into place", "A layer of oil glues the surface down", "New cells keep rising from below", "The wall stops shedding while you sleep"],
                2,
                "New cells form below and keep rising to replace the shed ones, so the wall stays whole."),
              mkTrueFalse("A fever slows germs and speeds up the guards.",
                true,
                "That is why the body raises its heat on purpose during an infection."),
              mkTrueFalse("A vaccine gives you the illness it protects against.",
                false,
                "A vaccine carries a harmless version, or only a piece, so it teaches the guards without giving you the illness."),
              mkOrder("Put the guard response in order.",
                ["A germ slips past the barrier", "Patrol guards find it and raise the alarm", "More guards arrive and swallow germs", "Fitted weapons are made for this invader"],
                "Barrier first, alarm second, more guards third, and fitted weapons last."),
              mkQuiz("Antibodies are built to fit what?",
                ["Every germ in the body at once", "One kind of invader, exactly", "The shape of the skin barrier", "Any cell that needs protection"],
                1,
                "Each antibody shape is built to fit one kind of invader exactly, not germs in general."),
              mkSpotError("One piece of this claim is wrong. Tap the piece that does not belong.",
                ["Pollen arrives on a breeze", "Allergies are infections caused by pollen", "Guards fire weapons at the pollen", "You sneeze and your eyes water"],
                1,
                "Allergies are guards mistaking something harmless for an invader",
                "Pollen causes no infection, and nothing multiplies in an allergy. The guards mistake something harmless for an invader and fire at it.")
            ]
          }
        ]
      },
      {
        id: "body-movement",
        title: "Movement",
        subtitle: "Scaffolding, cranes, and levers",
        lessons: [
          {
            id: "body-bones",
            title: "Bones",
            subtitle: "Living scaffolding",
            cards: [
              mkPredict("Are your bones alive?",
                "Your bones are alive. Living bone tissue grows as you grow and repairs itself after damage, just like other living tissue in your body.",
                ["No, they are dead stone with no living cells inside", "Yes, living tissue that grows and repairs", "Yes, but only while you are still quite young", "No, they are hollow tubes full of moving air"],
                1,
                "Bones look like stone, but they are living tissue. Their cells keep them growing, strong, and able to repair damage."),
              mkNote("The big idea", "Living scaffolding, not stone",
                "Your bones are living tissue, not stone. Together they hold you up like scaffolding holds up a building, giving your body its shape and strength. The skull and ribs form strong cages that protect soft parts inside, like the brain, the heart, and the lungs.",
                { visual: "/cortex/lessons/body/u5-l1-bones.webp" }),
              mkNote("More of the story", "Soft centers and stored minerals",
                "Inside many bones sits marrow, a soft tissue where new blood cells are made. A bone is built with a hard outer shell and a lighter spongy inside, so it stays strong without being heavy. Bones also store minerals the body can draw on later, a quiet store kept inside the scaffolding."),
              mkNote("Step by step", "One bone, layer by layer",
                "Look at how one bone is put together, from its tough outside to its busy center. Each part does a different job, and the whole bone stays alive while it works.",
                { diagram: { steps: ["Hard shell on the outside", "Spongy lightness inside", "Marrow making blood cells", "The whole bone alive and repairing"], caption: "One living bone, built light and strong, with marrow working at its center." } }),
              mkVisualQ("In the diagram, where are new blood cells made?",
                null,
                { steps: ["Hard shell on the outside", "Spongy lightness inside", "Marrow making blood cells", "The whole bone alive and repairing"], caption: "One living bone, built light and strong, with marrow working at its center." },
                ["In the hard shell on the outside", "In the marrow inside the bone", "In the lungs, before blood flows on", "In the muscles that pull the bone"],
                1,
                "The marrow is the soft tissue inside many bones, and making new blood cells is its main job."),
              mkMatch("Match each bone part to its job.",
                [["Skull", "The cage that protects the brain"], ["Ribs", "The cage that protects the heart and lungs"], ["Marrow", "The soft tissue that makes new blood cells"], ["Shell", "The hard outside that keeps the bone strong"]],
                "Each part of the scaffolding has its own job, from guarding soft organs to making fresh blood cells."),
              mkTrueFalse("New blood cells are made inside bones.",
                true,
                "Marrow inside many bones makes new blood cells all through your life."),
              mkTrueFalse("Bones are dead stone inside you.",
                false,
                "Bones are living tissue. Their cells grow, repair damage, and keep the bone strong."),
              mkQuiz("A broken bone slowly mends itself in the weeks after a fall, but a broken stone never does. Why the difference?",
                ["The blood glues both ends back within a day", "Stone is far too heavy for cells to lift and fix", "Bone is living tissue whose cells repair it", "Marrow hardens and turns the break into stone"],
                2,
                "Only living tissue can repair itself. Bone cells divide, fill the break, and rebuild the bone until it is whole again."),
              mkNote("The payoff", "The scaffolding is alive",
                "Your bones are living scaffolding that holds you up, guards your soft organs, and makes fresh blood cells in the marrow. They grow with you and repair themselves when they break, which no dead stone could ever do. Tomorrow: can a muscle push?")
            ]
          },
          {
            id: "body-muscles",
            title: "Muscles",
            subtitle: "They only pull",
            cards: [
              mkPredict("Can a muscle push?",
                "A muscle can only pull. Because it cannot push, your body pairs muscles up, so one pulls a bone one way and its partner pulls it back.",
                ["Yes, any muscle can push as well as it can pull", "No, muscles only pull, so they work in pairs", "Yes, but only the muscles in your arms and legs", "No, muscles do nothing until the bones move first"],
                1,
                "A muscle shortens and pulls, and that is all it can do. Pushing a bone back takes a second muscle pulling from the other side."),
              mkNote("The big idea", "Bundles that shorten and pull",
                "A muscle is a bundle of fibers that can shorten. When the fibers shorten, the muscle pulls on the bone it is tied to, and the bone moves. A muscle cannot push, so straightening a limb takes a partner muscle pulling the other way.",
                { visual: "/cortex/lessons/body/u5-l2-muscles.webp" }),
              mkNote("More of the story", "Pairs at work, growth at rest",
                "Muscle pairs cover your whole body. One muscle bends your elbow while its partner straightens it, each pulling in turn. The heart is also a muscle, but it squeezes instead of pulling on bones, and using any muscle is what makes it grow stronger, while the growing itself happens when you rest."),
              mkNote("Step by step", "Bending an arm",
                "Watch an arm bend, step by step. A signal from the brain starts the pull, the fibers do the shortening, and the partner muscle is ready to pull the bone back again.",
                { visual: "/cortex/lessons/body/u5-l2-lever.webp", diagram: { steps: ["A signal arrives from the brain", "The fibers shorten", "The muscle pulls the bone", "The partner muscle pulls it back"], caption: "One pull bends the arm, and the partner pull straightens it again." } }),
              mkVisualQ("In the picture, what does the muscle do to the bone?",
                "/cortex/lessons/body/u5-l2-lever.webp",
                null,
                ["It pushes the bone away hard", "It holds the bone fully still", "It pulls the bone toward it", "It lifts the bone with no pull"],
                2,
                "A muscle only pulls. When its fibers shorten, it drags the bone it is tied to toward itself."),
              mkOrder("Put the steps of bending and straightening an arm in order.",
                ["A signal arrives from the brain", "The front muscle shortens and pulls", "The elbow bends as the bone moves", "The partner muscle pulls it straight again"],
                "Bending takes one pull and straightening takes the partner pull, in that order every time."),
              mkTrueFalse("Muscles work in pairs because they can only pull.",
                true,
                "One muscle pulls a bone one way, and its partner pulls the bone back. No single muscle can do both jobs."),
              mkTrueFalse("One muscle both bends and straightens your arm.",
                false,
                "A muscle cannot push a bone back into place. Straightening needs the partner muscle pulling the other way."),
              mkQuiz("Rowers end up with strong backs as well as strong arms. Why?",
                ["Rowing shares the pulling work between back and arm muscles", "The moving water pushes on their backs and builds the muscle there", "Water flowing past the seat does most of the pulling work for them", "Sitting in a boat builds strong back muscles with no pulling at all"],
                0,
                "Pulling the oars is shared work. The back and arm muscles pull together, and muscles that work hard grow stronger."),
              mkNote("The payoff", "Pull, in pairs",
                "Muscles are bundles of fibers that only know how to pull, so your body runs them in pairs to bend and straighten every limb. Work a muscle and it grows stronger, then does its growing while you rest. Tomorrow: what lets a stiff scaffold bend?")
            ]
          },
          {
            id: "body-joints",
            title: "Joints",
            subtitle: "Where the scaffolding bends",
            cards: [
              mkPredict("What lets a stiff scaffold bend?",
                "Joints are the meeting places of your scaffolding. Where two bones meet at a joint, the bones can move instead of standing stiff.",
                ["Muscles, growing longer every single night", "Marrow, making fresh blood cells every day", "Joints, where two bones meet and move", "The hard shell on the end of each bone"],
                2,
                "A scaffold of bone alone would stand stiff. Joints are the places where bones meet, and meeting places are where movement happens."),
              mkNote("The big idea", "Where two bones meet",
                "A joint is where two bones meet. The bones do not grind directly against each other, because smooth caps cover their ends and a slippery fluid keeps the meeting slick. That slick meeting is why movement stays smooth and quiet instead of rough and sore.",
                { visual: "/cortex/lessons/body/u5-l3-joints.webp" }),
              mkNote("More of the story", "Hinges and balls",
                "Joints come in different kinds, and the kind sets what movement is possible. A hinge joint, like your knee or elbow, bends mostly one way, the way a door swings on its hinge. A ball joint, like your shoulder or hip, lets the bone swing in wide circles."),
              mkNote("Step by step", "Inside a working joint",
                "A joint looks simple, but every part of it protects the movement. Follow the steps and notice how the bones never have to rub raw against each other.",
                { diagram: { steps: ["Two bones meet", "Smooth caps cover the ends", "Fluid keeps the meeting slick", "Muscles pull the bones around the joint"], caption: "A slick, capped meeting lets stiff bones move freely." } }),
              mkVisualQ("In the diagram, what keeps the bone ends from grinding?",
                null,
                { steps: ["Two bones meet", "Smooth caps cover the ends", "Fluid keeps the meeting slick", "Muscles pull the bones around the joint"], caption: "A slick, capped meeting lets stiff bones move freely." },
                ["Smooth caps and slippery fluid", "A thick layer of marrow inside it", "The hard shell of the whole bone", "Muscles holding the bones apart"],
                0,
                "The caps cushion the ends and the fluid keeps the meeting slick, so the bones glide instead of grinding."),
              mkBuild("Build a working joint, step by step.",
                ["Two bone ends meet at one place", "Smooth caps cover both bone ends", "Fluid slicks the meeting between them", "Muscles attach so they can pull"],
                "A joint needs the meeting, the caps, and the slick fluid before any muscle pull can move it smoothly."),
              mkTrueFalse("A hinge joint bends mostly one way, like a door.",
                true,
                "Your knee and elbow are hinges. They swing back and forth, but they do not swing in circles."),
              mkTrueFalse("Bones rub directly against each other at a joint.",
                false,
                "Smooth caps cover the bone ends and slippery fluid keeps them apart, so healthy bones glide without grinding."),
              mkQuiz("A shoulder can swing a throwing arm in a full circle, but a knee cannot swing the lower leg that way. Why?",
                ["The knee has no muscles near it to pull the leg around", "Arm bones are softer and bend more easily than leg bones", "The shoulder holds more fluid, so it slips in circles", "The shoulder is a ball joint, while the knee is a hinge"],
                3,
                "Joint kind sets the movement. Ball joints swing in wide circles, and hinge joints bend mostly one way."),
              mkNote("The payoff", "Where the frame bends",
                "Joints are the bending places of the scaffolding, protected by smooth caps and slippery fluid so bones glide instead of grinding. Hinges bend one way and ball joints swing wide, and together they give a stiff frame its movement. Tomorrow: where does a taller you come from?")
            ]
          },
          {
            id: "body-growth",
            title: "Growth",
            subtitle: "Built taller, cell by cell",
            cards: [
              mkPredict("Where does a taller you come from?",
                "A taller you is built slowly. Cells divide to make new cells, and long bones lengthen a little at a time at their ends.",
                ["From each cell swelling larger and larger", "From the marrow stretching every bone out", "From new cells, as bones grow longer", "From muscles pulling bones to full length"],
                2,
                "Growth is building, not swelling. New cells add material, and bones grow longer at their ends, a little at a time."),
              mkNote("The big idea", "New cells, longer bones",
                "You grow because your cells divide and because your bones lengthen. Near the ends of long bones sit growth zones, patches of soft and busy tissue where new bone is added. Legs and arms get longer from those zones, a little at a time.",
                { visual: "/cortex/lessons/body/u5-l4-growth.webp" }),
              mkNote("More of the story", "Spurts, sleep, and supplies",
                "Growth comes in spurts, fast at some ages and slow at others, never in one steady line. Much of the growth message from the glands does its work while you sleep, which is one reason sleep matters so much while you are growing. Food, movement, and sleep are the supplies that growth builds with."),
              mkNote("Step by step", "Taller, in small steps",
                "Growth is building work carried out in small steps. New cells add numbers, growth zones add bone, and the whole body rises a little at a time.",
                { diagram: { steps: ["Cells divide and multiply", "Growth zones add new bone", "Bones lengthen a little at a time", "The whole body grows taller"], caption: "Taller, built slowly from dividing cells and lengthening bones." } }),
              mkVisualQ("In the diagram, where is new bone added?",
                null,
                { steps: ["Cells divide and multiply", "Growth zones add new bone", "Bones lengthen a little at a time", "The whole body grows taller"], caption: "Taller, built slowly from dividing cells and lengthening bones." },
                ["In growth zones near the ends of long bones", "In the marrow at the center of each bone", "Along the whole outside shell of every bone in the body", "Under the scab that covers healing skin"],
                0,
                "New bone is added in the soft growth zones near the ends of long bones, and that is what lengthens them."),
              mkSpotError("One piece of this claim about growth is wrong. Spot it.",
                ["You grow taller slowly as childhood passes", "Your cells swell bigger and bigger to make you taller", "Bones lengthen at growth zones near their ends", "Sleep helps the growth message do its work"],
                1,
                "You grow because cells divide and bones lengthen at their growth zones",
                "Cells do not simply swell. Dividing cells add numbers and growth zones add new bone, so the body gets taller."),
              mkTrueFalse("Bones lengthen at growth zones near their ends.",
                true,
                "The growth zones are soft, busy tissue near the ends of long bones, and new bone is added there."),
              mkTrueFalse("You grow taller because each of your cells gets bigger.",
                false,
                "Your cells stay about the same size. You grow because cells divide and bones lengthen, adding more and longer material."),
              mkQuiz("Two children eat well, but one sleeps badly night after night and grows more slowly. What best explains it?",
                ["Much growth work happens in sleep, so poor sleep cuts it short", "The growth message stops working for good after a few short nights", "Sleeping badly makes the growth zones close up for the whole night", "Bones only lengthen while a child is wide awake and moving about"],
                0,
                "The glands send much of the growth message during sleep. Short nights give that message less time to do its building work."),
              mkNote("The payoff", "Built taller, slowly",
                "You grow taller because cells divide and growth zones add new bone at the ends of long bones, a little at a time. Sleep, food, and movement supply the work, and the growth message does much of its building while you sleep. Tomorrow: what does your body do the moment you cut yourself, before you even look?")
            ]
          },
          {
            id: "body-healing",
            title: "Healing",
            subtitle: "The repair crews at work",
            cards: [
              mkPredict("What does your body do the moment you cut yourself, before you even look?",
                "The repair starts at once, before you even look down. Platelets gather at the leak, the blood clots to seal it, and new cells begin filling the gap.",
                ["White blood cells arrive and carry the cut edges together", "Platelets rush in to seal the leak and start repair", "Blood flows faster to wash the cut fully clean", "New bone grows over the cut to close it at once"],
                1,
                "Platelets are the first repair crew at any cut. They help the blood clot at the leak, sealing it so the slower repair work can begin."),
              mkNote("The big idea", "Seal first, then fill",
                "Healing starts with the seal. Platelets help the blood clot at the leak, a scab covers the clot, and under the scab new cells divide to fill the gap. It is the same division that grows you, now working as repair instead of growth.",
                { visual: "/cortex/lessons/body/u5-l5-healing.webp" }),
              mkNote("More of the story", "Bridges, bones, and scars",
                "Broken bones heal in stages too. Blood gathers at the break, new tissue bridges the gap, and true bone slowly replaces the bridge until the bone is whole again. A scar is different: it is a quick patch the body lays down when speed matters more than a perfect finish."),
              mkNote("Step by step", "Repair, in order",
                "Repair follows an order, and skipping a step would leave the gap open. Watch how the seal comes first and the covering comes last.",
                { diagram: { steps: ["The leak is sealed by a clot", "New cells divide to fill the gap", "Fresh tissue knits the edges together", "A scar or new skin covers the repair"], caption: "Seal first, fill second, cover last: repair in order." } }),
              mkVisualQ("In the diagram, what covers the repair while it knits together?",
                null,
                { steps: ["The leak is sealed by a clot", "New cells divide to fill the gap", "Fresh tissue knits the edges together", "A scar or new skin covers the repair"], caption: "Seal first, fill second, cover last: repair in order." },
                ["A thick scar, laid down before any clot", "A scab, over new cells filling the gap", "The hard shell from a nearby bone end", "A layer of marrow spread across the skin"],
                1,
                "The clot seals the leak and its dry top is the scab. Under that cover, new cells divide and fill the gap in safety."),
              mkMatch("Match each repair word to its job.",
                [["Clot", "The seal that plugs a leak in a vessel"], ["Scab", "The dry cover over a healing cut"], ["Scar", "The quick patch left by deep damage"], ["Marrow", "The tissue that makes new blood cells for repairs"]],
                "Each repair word names a different stage or helper, from the first seal to the lasting patch."),
              mkTrueFalse("A scar is the body's quick patch over a repair.",
                true,
                "When damage is deep, the body patches fast with scar tissue, trading a perfect finish for speed and safety."),
              mkTrueFalse("Healing is done by cells arriving from outside the body.",
                false,
                "Every repair cell is your own. Your cells divide at the damage, fill the gap, and knit the edges together themselves."),
              mkQuiz("A deep cut usually leaves a scar, but a shallow scrape often heals with no scar at all. Why?",
                ["Deep damage gets a fast scar patch, shallow damage rebuilds exactly", "Shallow scrapes are covered by new bone, so the skin returns fully smooth", "Scrapes heal from the marrow outward, so they never need any patch at all", "Deep cuts heal slowly because the blood cannot reach them in any way"],
                0,
                "Depth decides the method. Shallow damage is small enough to rebuild as it was, but deep damage is closed fast with a scar patch."),
              mkNote("The payoff", "Growth, turned to repair",
                "Healing is growth turned toward repair: platelets seal the leak, new cells fill the gap, and fresh tissue knits the edges back together. Deep damage gets a quick scar patch, while shallow damage can be rebuilt as it was. Tomorrow: can you prove the whole unit, start to finish?")
            ]
          },
          {
            id: "body-movement-checkpoint",
            title: "Checkpoint: Movement",
            subtitle: "Eight mixed questions on the whole unit. Nothing new, just proof.",
            checkpoint: true,
            cards: [
              mkQuiz("Where are new blood cells made in your body?",
                ["In the fluid inside each joint you bend", "In the fibers of your working muscles", "In the marrow inside many bones", "In the growth zones of long bones"],
                2,
                "Marrow is the soft tissue inside bones, and making fresh blood cells is its steady job."),
              mkMatch("Match each movement word to its meaning.",
                [["Hinge joint", "A joint that bends mostly one way"], ["Ball joint", "A joint that swings in wide circles"], ["Marrow", "The soft tissue that makes blood cells"], ["Fibers", "The strands that shorten inside a muscle"]],
                "Hinges bend, ball joints swing, marrow makes, and fibers shorten. Four words, four jobs."),
              mkVisualQ("In the picture, what does the muscle do to the bone?",
                "/cortex/lessons/body/u5-l2-lever.webp",
                null,
                ["It pushes the bone away from itself", "It holds both bones apart in the air", "It pulls the bone toward itself", "It bends the bone in the middle"],
                2,
                "The picture shows the only move a muscle has. Its fibers shorten and pull the bone toward the muscle."),
              mkTrueFalse("Muscles can only pull, so they work in pairs.",
                true,
                "One muscle pulls a bone one way and its partner pulls it back, because no muscle can push."),
              mkTrueFalse("Bones are dead stone inside the body.",
                false,
                "Bones are living tissue with their own cells. They grow, store minerals, make blood cells, and repair themselves."),
              mkOrder("Put the steps of bending an arm in order.",
                ["A signal arrives from the brain", "The front muscle shortens and pulls", "The elbow bends", "The partner muscle pulls the arm straight"],
                "Signal, shorten, bend, then the partner pull. The same order runs every bend you make."),
              mkQuiz("What keeps a healthy joint moving slick and smooth?",
                ["Slippery fluid, with smooth caps on the bone ends", "Tiny muscles inside the joint that hold the bones apart", "Marrow spread thin across both of the bone ends", "Scar tissue laid over the ends after each bend"],
                0,
                "Smooth caps cover the bone ends and slippery fluid slicks the meeting, so the bones glide instead of grinding."),
              mkSpotError("One piece of this claim about growth is wrong. Spot it.",
                ["Cells divide to add new cells as you grow", "You grow mainly because each cell swells larger", "Bones lengthen at growth zones near their ends", "Sleep gives the growth message time to work"],
                1,
                "You grow because cells divide and bones lengthen at their growth zones",
                "Swelling cells is not growth. Dividing cells and lengthening bones are what make a taller body.")
            ]
          }
        ]
      },
      {
        id: "body-senses-unit",
        title: "Senses",
        subtitle: "Windows, drums, and the builder brain",
        lessons: [
          {
            id: "body-sight",
            title: "Sight",
            subtitle: "Light in, picture built",
            cards: [
              mkPredict("What does the eye actually send to the brain?",
                "The eye sends signals, never a finished picture. The brain receives those signals and builds the picture you experience.",
                ["A tiny finished picture of the whole world", "A stream of light carried whole into the brain", "Signals, which the brain turns into a picture", "Copies of everything the eye has ever touched"],
                2,
                "Eyes are reporters, not cameras handing over prints. They send signals, and the brain builds the picture from those signals."),
              mkNote("The big idea", "A window, a lens, a back wall",
                "Light enters the eye through a clear front window, and a lens focuses it onto the back wall of the eye. That back layer is the retina, and it turns light into signals. The signals travel to the brain, which builds them into the scene you see.",
                { visual: "/cortex/lessons/body/u6-l1-sight.webp" }),
              mkNote("More of the story", "Upside down, and doubled",
                "The picture that lands on the retina lands upside down, and the brain calmly turns it the right way up. Your two eyes see slightly different views, and the brain uses the difference to judge distance. Seeing feels instant, but it is building work from start to finish. The brain also builds flavor from smell, blending signals into one experience."),
              mkNote("Step by step", "One flash of light",
                "Follow one flash of light on its journey through the eye. The front lets it in, the lens aims it, and the back wall changes it into a signal the brain can use.",
                { visual: "/cortex/lessons/body/u6-l1-eye.webp", diagram: { steps: ["Light enters the eye", "The lens focuses it on the back wall", "The retina turns light into signals", "The brain builds the picture"], caption: "Light in at the front, signals out at the back, picture built in the brain." } }),
              mkVisualQ("In the picture, where is light turned into signals?",
                "/cortex/lessons/body/u6-l1-eye.webp",
                null,
                ["At the lens, near the front of the eye", "At the retina, the back wall of the eye", "In the clear window the light enters by", "In the brain, before signals arrive there"],
                1,
                "The retina lines the back of the eye. Its sensors catch the focused light and turn it into signals for the brain."),
              mkMatch("Match each seeing word to its job.",
                [["Lens", "The part that focuses light on the back wall"], ["Retina", "The back layer that turns light into signals"], ["Signals", "The messages that travel from eye to brain"], ["Brain", "The builder that turns signals into sight"]],
                "Seeing is a chain: focus, change, carry, build, and every link has one job."),
              mkTrueFalse("The brain builds what you see from signals the eyes send.",
                true,
                "The eyes gather and report. The brain does the building, which is why its shortcuts can sometimes be fooled."),
              mkTrueFalse("The eye sends a finished picture to the brain.",
                false,
                "No picture travels from the eye. Only signals travel, and the brain builds the picture after they arrive."),
              mkQuiz("Catching a ball gets harder when you close one eye and judge its flight. Why?",
                ["One eye sends signals at half the speed of two eyes working", "Two eye views give the brain the difference it uses to judge distance", "With one eye closed, the lens stops focusing light onto the retina at all", "Closing one eye turns the retina picture the wrong way up again"],
                1,
                "Distance comes from comparing two views. With one view missing, the brain has less to judge with, so catching gets harder."),
              mkNote("The payoff", "Nothing arrives finished",
                "The eye is a window and a changer: the lens focuses light, the retina turns it into signals, and the brain builds the picture you live in. Nothing you see arrives finished, and that building work is what every other sense relies on too. Tomorrow: what is a sound, before it reaches you?")
            ]
          },
          {
            id: "body-hearing",
            title: "Hearing",
            subtitle: "Shaking air, shaking bones, signals",
            cards: [
              mkPredict("What is a sound, before it reaches you?",
                "A sound starts as vibrations, shaking movements traveling through the air. Only when that shaking reaches your ear does hearing begin.",
                ["Tiny pieces of air that fly into the brain", "Light bouncing off the things you hear", "Shaking air that reaches your ear", "A signal made inside the ear itself"],
                2,
                "Sound is movement in the air. The shaking travels outward from its source until it reaches an ear and starts the hearing chain."),
              mkNote("The big idea", "Shaking air meets a drum",
                "Sounds are vibrations traveling through the air, tiny shaking movements passed from the source to you. When they reach you, they meet the eardrum, a tight skin drum stretched across the entrance to the ear. The eardrum shakes with every sound that arrives, starting the hearing chain.",
                { visual: "/cortex/lessons/body/u6-l2-hearing.webp" }),
              mkNote("More of the story", "Bones, a coil, and a warning",
                "Behind the eardrum, three tiny bones pass the shaking inward and make it stronger. Deeper inside, a coiled tube filled with fluid turns the shaking into signals and sends them to the brain. Very loud sounds can damage these delicate parts, and hearing lost that way does not come back."),
              mkNote("Step by step", "Shaking, handed along",
                "Hearing is shaking, handed along step by step. Each part passes the movement inward until the movement becomes a signal.",
                { visual: "/cortex/lessons/body/u6-l2-hearing.webp", diagram: { steps: ["Air vibrates with a sound", "The eardrum shakes", "Tiny bones pass the shaking inward", "The coiled tube turns it into signals"], caption: "Shaking air becomes shaking bones, then signals for the brain." } }),
              mkVisualQ("In the picture, which part shakes first when a sound arrives?",
                "/cortex/lessons/body/u6-l2-hearing.webp",
                null,
                ["The tiny bones behind the drum wall", "The coiled tube deep inside the ear", "The eardrum, the tight skin drum", "The brain, as the signal lands there"],
                2,
                "Sound meets the eardrum first. Its shaking starts the chain that the tiny bones then pass inward."),
              mkOrder("Put a sound's journey in order.",
                ["Air shakes as a sound travels outward", "The eardrum shakes at the ear entrance", "Tiny bones pass the shaking inward and strengthen it", "The coiled tube turns shaking into signals"],
                "Air first, drum second, bones third, signals last: hearing is a handover chain."),
              mkTrueFalse("The eardrum shakes when sound reaches it.",
                true,
                "The eardrum is stretched tight like a drum skin, so arriving vibrations set it shaking at once."),
              mkTrueFalse("Sounds travel to the brain as tiny pieces of air.",
                false,
                "Air never enters your head. The shaking travels through the air, and the ear turns that shaking into signals."),
              mkQuiz("You press your hands flat over your ears and a loud radio suddenly sounds dull and soft. Why?",
                ["Less shaking reaches the eardrum, so the signal sent onward is weaker", "Pressing the ears squeezes the coiled tube until no signals can leave it", "Your hands push the tiny bones apart so they cannot pass sound onward", "Covered ears turn sound into light before it reaches the drum at all"],
                0,
                "Hands block much of the shaking before it reaches the drum. A weaker shake makes a weaker signal, so the sound seems softer."),
              mkNote("The payoff", "From shaking to sound",
                "Hearing begins as shaking air, becomes shaking skin and bone, and ends as signals the brain can build into sound. Protect the delicate chain from very loud sounds, because damage deep inside does not heal back. Tomorrow: why does food turn dull when your nose is blocked?")
            ]
          },
          {
            id: "body-smell-taste",
            title: "Smell and taste",
            subtitle: "Two senses that are really one team",
            cards: [
              mkPredict("Why does food turn dull when your nose is blocked?",
                "Most of flavor is smell. When a blocked nose shuts smell out, the tongue still tastes, but the meal tastes flat and dull.",
                ["A blocked nose stops the tongue tasting at all", "Most of what you call flavor is really smell", "Blocked noses make every food turn cold in the mouth", "The tongue works only while air flows past it freely"],
                1,
                "The tongue keeps working with a blocked nose, but it only reports basic tastes. Smell supplies most of flavor, and a blocked nose shuts smell out."),
              mkNote("The big idea", "A short list from the tongue",
                "Your tongue is covered in taste buds, and together they report only a few basic tastes. Those tastes are sweet, sour, salty, and bitter, plus a deep savory taste that makes food feel rich. That short list is all the tongue can do on its own.",
                { visual: "/cortex/lessons/body/u6-l3-flavor.webp" }),
              mkNote("More of the story", "Smell does the rest",
                "Smell does most of the rest of the work. Tiny particles from food drift up into the nose as you chew, and the brain blends smell with taste to build flavor. Texture and warmth join the blend too, which is why a blocked nose flattens even a favorite meal."),
              mkNote("Step by step", "Two reports, one flavor",
                "Flavor is a team result, not a tongue solo. Follow the two reports as they arrive and notice where they become one experience.",
                { diagram: { steps: ["Taste buds report the basic tastes", "Smell particles reach the nose", "The brain blends taste and smell", "You experience it as flavor"], caption: "Two reports, one blend, and the result is flavor." } }),
              mkVisualQ("In the diagram, which two reports does the brain blend into flavor?",
                null,
                { steps: ["Taste buds report the basic tastes", "Smell particles reach the nose", "The brain blends taste and smell", "You experience it as flavor"], caption: "Two reports, one blend, and the result is flavor." },
                ["Taste from the tongue and smell from the nose", "Touch from the skin and pain from the sensors", "Light from the eyes and sound from the ears", "Signals from the muscles and signals from bones"],
                0,
                "Flavor is blended in the brain from the tongue taste report and the nose smell report arriving together."),
              mkBuild("Build a flavor, step by step.",
                ["Taste buds report the basic tastes", "Smell particles reach the nose as you chew", "The brain blends taste and smell together", "You experience the blend as flavor"],
                "Taste alone is a short list. Flavor appears only when smell joins it in the brain blend."),
              mkTrueFalse("Most of flavor is smell working with taste.",
                true,
                "The tongue reports a few basic tastes, and smell supplies most of the rest of what you call flavor."),
              mkTrueFalse("The tongue alone reports every flavor in a meal.",
                false,
                "The tongue can only report its few basic tastes. The flavors of a meal come from smell blended with taste in the brain."),
              mkQuiz("Two friends eat the same green vegetable. One enjoys it, and the other tastes a strong bitterness. Why?",
                ["One friend has a blocked nose, so the vegetable turns sweet", "The vegetable changes its taste between one mouth and another", "Their taste buds differ, and one notices a bitterness the other misses", "The bitter taste comes from the teeth pressing harder on the vegetable skin"],
                2,
                "Taste buds are not identical in everyone. Some people are built to notice a bitterness in certain vegetables that others never taste at all."),
              mkNote("The payoff", "One team, two hats",
                "Taste and smell are one team wearing two hats: the tongue reports a short list of basic tastes, and smell supplies most of flavor. Block the nose and the team loses its strongest player, so meals turn dull and flat. Tomorrow: what is pain for?")
            ]
          },
          {
            id: "body-touch-pain",
            title: "Touch and pain",
            subtitle: "Sensors in the skin, and the alarm",
            cards: [
              mkPredict("What is pain for?",
                "Pain is a warning signal, not the damage itself. It grabs your attention and makes you protect the hurt place while it heals.",
                ["It is the damage itself, felt in the skin", "A warning that something needs attention now", "A signal that tells muscles to move faster", "A message that orders the brain to ignore the hurt place"],
                1,
                "Pain is the alarm, not the injury. It warns the brain that a place needs care and guarding right away."),
              mkNote("The big idea", "A skin full of sensors",
                "Your skin is packed with sensors of different kinds. Some report pressure and touch, some report heat and cold, and some report damage as pain. Your fingertips carry far more sensors than your back does, which is why your fingers can read the world in fine detail.",
                { visual: "/cortex/lessons/body/u6-l4-touch.webp" }),
              mkNote("More of the story", "An alarm the brain can adjust",
                "Pain is a signal, not the damage itself. The signal makes you guard the hurt place and keep it still while healing runs its course. The brain can also turn pain up or down, so a hurt often eases when your attention is fully caught by something else."),
              mkNote("Step by step", "From sensor to response",
                "Touch and pain travel the same road from skin to brain. The difference begins with which sensor fires at the start of the road.",
                { diagram: { steps: ["A sensor fires in the skin", "The signal races to the spinal cord and brain", "The brain reads it as touch or pain", "You move, adjust, or protect the place"], caption: "Sensor, signal, reading, response: touch and pain share one road." } }),
              mkVisualQ("In the diagram, what does the brain read the signal as?",
                null,
                { steps: ["A sensor fires in the skin", "The signal races to the spinal cord and brain", "The brain reads it as touch or pain", "You move, adjust, or protect the place"], caption: "Sensor, signal, reading, response: touch and pain share one road." },
                ["Heat alone, whatever sensor started the signal", "Touch or pain, depending on the sensor that fired", "A picture built from light at the back wall", "A finished order sent back before the brain reads anything at all"],
                1,
                "Different sensors send different reports. The brain reads a touch sensor report as touch and a damage sensor report as pain."),
              mkSpotError("One piece of this claim about pain is wrong. Spot it.",
                ["Sensors in the skin report touch, heat, and damage", "Pain is the damage itself happening in the skin", "The brain can turn a pain signal up or down", "Pain makes you protect the hurt place while it heals"],
                1,
                "Pain is a warning signal the brain builds from sensor reports",
                "The damage and the pain are two different things. Sensors report the damage, and the brain builds the pain as a warning."),
              mkTrueFalse("Your fingertips hold far more touch sensors than your back.",
                true,
                "Sensors crowd where fine touch matters most. That crowding is why fingers can feel tiny bumps and edges that your back would miss completely."),
              mkTrueFalse("Pain is the damage itself, not a signal about it.",
                false,
                "Pain is the brain warning built from sensor reports. The damage is in the skin, and the pain is the alarm about it."),
              mkQuiz("You bump your elbow and rub it, and the hurt eases a little. Why does rubbing help?",
                ["Rubbing pushes the damage out through the skin at once", "Touch signals crowd in, and the brain turns the pain signal down", "Your hand blocks the spinal cord, so no signals can pass in either direction", "The sensors stop reporting until the elbow is fully healed and quiet"],
                1,
                "The brain can turn pain up or down. A flood of gentle touch reports gives it reason to turn the pain down a little."),
              mkNote("The payoff", "The useful alarm",
                "Your skin is a field of sensors, and pain is the alarm they can raise when damage happens. The brain builds that alarm from their reports and can turn it up or down, which is why attention and rubbing can change a hurt. Tomorrow: can your eyes lie to you?")
            ]
          },
          {
            id: "body-senses",
            title: "How the brain fills in",
            subtitle: "Illusions, blind spots, and useful shortcuts",
            cards: [
              mkPredict("Can your eyes lie to you?",
                "Your eyes report honestly and send signals as they find them. The brain builds your experience from those signals using shortcuts, and a shortcut can be fooled.",
                ["Yes, the eyes invent pictures to trick the brain daily", "Yes, the retina sends finished pictures that are often wrong", "The eyes report signals truly, but the brain can be fooled", "No, the brain checks every signal and never errs at all"],
                2,
                "The eyes are honest reporters. The brain builds experience with fast shortcuts, and shortcuts are the part that can be fooled."),
              mkNote("The big idea", "Raw signals, built experience",
                "Your eyes and ears gather raw signals, and your brain builds what you actually experience. To build quickly, the brain uses shortcuts that guess what the signals mean. An illusion is simply a place where one of those shortcuts gets fooled.",
                { visual: "/cortex/lessons/body/u6-l5-illusions.webp" }),
              mkNote("More of the story", "The spot you never see",
                "Everyone has a blind spot in each eye, the place where the nerve leaves the eye and no sensors sit. You never notice the gap, because the brain fills it in with what should be there. Filling in is the brain's habit everywhere, and most days the habit is right. Every human brain does this, in every *Homo sapiens* who has ever looked at the world."),
              mkNote("Step by step", "Gaps in, world out",
                "Your experience feels smooth and complete, but the signals underneath it have gaps. The brain covers those gaps so quickly that you never see the joins.",
                { diagram: { steps: ["Signals arrive with gaps", "Shortcuts guess the missing parts", "The brain builds a smooth experience", "Most days, the guesses are right"], caption: "Gaps in, guesses made, and a smooth world comes out." } }),
              mkVisualQ("In the diagram, why do you never notice your blind spot?",
                null,
                { steps: ["Signals arrive with gaps", "Shortcuts guess the missing parts", "The brain builds a smooth experience", "Most days, the guesses are right"], caption: "Gaps in, guesses made, and a smooth world comes out." },
                ["The other eye grows extra sensors to cover it", "The brain fills the gap before you can notice it", "The blind spot closes whenever light gets bright", "The nerve leaving the eye carries a finished picture over the gap"],
                1,
                "Filling gaps is the brain's habit. It paints over the blind spot with what should be there, so the gap never shows."),
              mkMatch("Match each sense to what it gathers.",
                [["Sight", "Light entering the eyes"], ["Hearing", "Vibrations reaching the ears"], ["Smell", "Tiny particles landing in the nose"], ["Touch", "Pressure, heat, and cold felt by the skin"]],
                "Each sense gathers its own kind of signal, and one brain puts them all together."),
              mkTrueFalse("You have a blind spot in each eye and never notice it.",
                true,
                "The brain fills the blind spot gap with what should be there, so the missing patch never reaches your experience."),
              mkTrueFalse("An illusion means your eyes are broken.",
                false,
                "Your eyes report honestly in an illusion. The mistake is in the brain shortcut that guesses what the signals mean."),
              mkQuiz("In an optical illusion, two lines that are truly equal look different in length. Where does the mistake happen?",
                ["In the printed lines, which change length as you look", "In the brain, as it builds sight from the signals", "In the hands holding the page, which shake the lines out of place", "In the retina, which sends the lines at the wrong size"],
                1,
                "The eyes report the lines honestly. The brain shortcut that judges length gets fooled, so the mistake is in the building, not the reporting."),
              mkNote("The payoff", "Built, not handed over",
                "Your senses do not hand you the world ready made. They hand your brain signals, gaps and all, and the brain builds the smooth experience you live in, filling and guessing as it goes. Tomorrow: can you follow a sandwich and a sprint through the whole body?")
            ]
          },
          {
            id: "body-senses-checkpoint",
            title: "Checkpoint: Senses",
            subtitle: "Eight mixed questions on the whole unit. Nothing new, just proof.",
            checkpoint: true,
            cards: [
              mkQuiz("Where does light become signals in the eye?",
                ["At the lens, which focuses light at the front", "At the retina, on the back wall of the eye", "In the clear window where light first enters", "In the nerve, after signals have left the eye"],
                1,
                "The retina is the back layer of the eye, and changing light into signals is its job."),
              mkMatch("Match each senses word to its job.",
                [["Lens", "Focuses light onto the back wall of the eye"], ["Eardrum", "The tight drum that shakes when sound arrives"], ["Taste buds", "Report the basic tastes from the tongue"], ["Sensors", "Skin parts that report touch, heat, and damage"]],
                "Lens focuses, eardrum shakes, taste buds report tastes, and sensors report the skin world."),
              mkVisualQ("In the picture, where is light turned into signals?",
                "/cortex/lessons/body/u6-l1-eye.webp",
                null,
                ["On the lens, at the front of the eye", "On the retina, the back wall of the eye", "In the window where the light comes in", "In the nerve road that carries signals away from the eye"],
                1,
                "Light lands focused on the retina at the back, and the retina is where it becomes signals."),
              mkTrueFalse("The brain builds what you see and what you hear.",
                true,
                "Eyes and ears both send signals. The brain builds sights and sounds from those signals, never receiving either one finished."),
              mkTrueFalse("The eye sends a finished picture to the brain.",
                false,
                "Only signals leave the eye. The brain builds the picture, which is why its shortcuts can be fooled."),
              mkOrder("Put a sound's journey in order.",
                ["Air shakes as the sound travels", "The eardrum shakes at the entrance", "Tiny bones pass the shaking inward", "The coiled tube turns shaking into signals"],
                "Shaking air, shaking drum, shaking bones, then signals. The order never changes."),
              mkQuiz("What is most of what you call flavor?",
                ["Taste alone, reported by the tongue by itself", "Smell, working with taste from the tongue", "Warmth and texture, with no smell involved at all", "Memory of meals you have eaten in past weeks"],
                1,
                "The tongue reports only basic tastes. Smell blended with taste in the brain makes most of flavor."),
              mkSpotError("One piece of this claim about pain is wrong. Spot it.",
                ["Sensors report damage from the skin", "Pain is the damage itself, not a signal", "The brain reads sensor reports as pain", "Pain warns you to protect the hurt place"],
                1,
                "Pain is a warning signal the brain builds from sensor reports",
                "Pain is not the damage. It is the warning the brain builds so you protect the damaged place.")
            ]
          },
          {
            id: "body-capstone",
            title: "Follow a Sandwich and a Sprint",
            subtitle: "Everything you have learned, working at once",
            capstone: true,
            cards: [
              mkNote("The quest", "One sandwich, one sprint",
                "Here is the quest. One sandwich, one sprint, and every system you have met will work in the next few minutes. Watch for each crew as it joins in, from the first bite to the final stride."),
              mkQuiz("Your sandwich reaches the stomach. What happens to it there?",
                ["It is absorbed whole into the blood at once", "It is churned with strong juices into smaller pieces", "It rests untouched until the sprint is over", "It is broken into basic tastes and sent on to the taste buds"],
                1,
                "The stomach is the churning station. Its strong juices attack the pieces the teeth chopped, breaking the sandwich down further."),
              mkOrder("Put the sandwich's road in order.",
                ["Chewing chops the sandwich in the mouth", "The stomach churns it with strong juices", "The small intestine absorbs the useful pieces", "The blood delivers the pieces to the cells"],
                "Chop, churn, absorb, deliver: the sandwich road never changes its order."),
              mkNote("The sprint", "Now run for it",
                "Now the sprint begins. Your muscles call for more oxygen and faster waste clearing, and two systems answer before you have run ten steps. The heart and lungs speed up together, driven by signals and messages you never have to order."),
              mkPredict("You sprint for the bus. What happens to your heartbeat and breathing in the first minute?",
                "Both speed up within the first minute. Working muscles demand more oxygen and make more carbon dioxide, so the heart pumps faster and breathing deepens to keep up.",
                ["Both slow down, so the muscles can rest while you run", "Both speed up, as muscles demand more oxygen and make more waste", "Only breathing speeds up, while the heart holds steady", "Heartbeat and breathing stay at their resting pace for the whole first minute"],
                1,
                "Hard work burns oxygen faster and makes waste gas faster. Faster pumping and faster breathing are the delivery answer."),
              mkVisualQ("In the picture, what is the pump at the center of the city?",
                "/cortex/paths/path-body.webp",
                null,
                ["The lungs, trading gases at the air sacs daily", "The stomach, churning food with strong juices", "The heart, sending blood out along the roads", "The brain, building pictures from eye signals"],
                2,
                "The heart is the pump at the center of the delivery city. Every road of blood leads back to it and out from it again."),
              mkTrueFalse("Your heart and lungs speed up together when muscles demand more.",
                true,
                "The two systems share one job during hard work: bringing oxygen in and clearing waste out at the new, faster pace."),
              mkTrueFalse("Your muscles pull the bones by pushing against them.",
                false,
                "Muscles cannot push at all. They pull bones toward them, and partner muscles pull the bones back."),
              mkQuiz("As you sprint, your skin feels the wind and your eyes track the bus ahead. Where is all of it put together?",
                ["In the eyes, which build the whole experience alone", "In the brain, which builds one experience from many signals", "In the spinal cord, which builds the experience before the brain hears of it", "In the skin, where every sense reports to the nerves"],
                1,
                "Every sense sends signals, and the brain is the builder that puts them together into the moment you experience."),
              mkNote("The payoff", "The city is you",
                "The sandwich was chopped, churned, absorbed, and delivered, and your cells released its energy to power the sprint. The guards stood watch the whole way, the control room conducted every signal, and the scaffolding of bone and muscle carried you down the road. You are the city, and now you know its crews.")
            ]
          }
        ]
      }
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
                "Our solar system is the Sun plus everything its gravity holds: eight planets, their moons, and crowds of rocky and icy leftovers. The four planets nearest the Sun are small and rocky. The four far ones are giants made mostly of gas and liquid.",
                { visual: "/cortex/paths/path-space.webp" }),
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
              mkSpotError("One piece of this claim is wrong. Tap the piece that does not belong.",
                ["The four planets nearest the Sun are small and rocky", "Mercury is the closest planet to the Sun", "Jupiter is the largest planet of all", "Jupiter sits closer to the Sun than Earth"],
                3,
                "Jupiter sits far beyond Mars, much farther from the Sun than Earth.",
                "Jupiter is a giant of the outer system. It comes after Mars, far past Earth, among the far planets the lesson opened with. The first three pieces are all true; the last one moves Jupiter into the inner system, where it does not belong."),
              mkTrueFalse("The Sun is a star.",
                true,
                "The Sun is a medium sized star. It only looks huge and bright because it is so much closer than every other star."),
              mkDeepen("Go deeper: everything in this lesson is our local neighborhood, and it is only the beginning. Far beyond it sit planets around other stars, and at the center of our galaxy a black hole so heavy its gravity bends the orbits of stars around it. The neighborhood turns out to be one street in a vast city."),
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
              mkDeepen("Go deeper: Venus plays by strange rules. It spins so slowly that one full day on Venus lasts longer than its whole year around the Sun, and it spins backwards compared with most planets. A sunrise there would be a rare and leisurely event."),
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
                ["The oceans hold it", "Earth's gravity keeps pulling it in", "It has no way to move", "Space is completely empty in every direction"],
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
              mkDeepen("Go deeper: gravity can ripple. When two black holes crash together far away, the collision sends waves through space itself, and detectors on Earth can feel the squeeze as a wave passes. The wildest part: those ripples were predicted about a hundred years before anyone could build a machine sensitive enough to catch one."),
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
              mkDeepen("Go deeper: starlight is a biography. Its color tells a star's temperature, its brightness hints at its size, and faint lines in its spectrum name the gases it is made of. Sort stars by those clues and a pattern appears: most live quiet middle lives, and the biggest burn out fastest."),
            ],
          },
        ],
      },
      {
        id: "space-moon-beyond", title: "The Moon and the Far Beyond", subtitle: "Phases, eclipses, and galaxies",
        lessons: [
          {
            id: "space-moon", title: "The Moon and Its Changing Face", subtitle: "Sunlight, shadow, and a monthly show",
            cards: [
              mkNote("The big idea", "The Moon shines with borrowed light",
                "The Moon makes no light of its own. It shines because sunlight falls on it, the way a ball glows in a sunbeam. The Sun always lights one half of the Moon, but from Earth we see different amounts of that lit half as the Moon circles us. Those changing views are the phases, and the full round takes about 29 days."),
              mkQuiz("Why does the Moon shine in the night sky?",
                ["It glows like a small sun", "It reflects sunlight", "It stores light from the day", "City lights bounce off it"],
                1,
                "Moonlight is sunlight that bounced off the Moon's dusty surface. A full moon is bright enough to read by, and all of it is borrowed."),
              mkOrder("Put the Moon's changing faces in order across a month.",
                ["New moon, the lit half faces away and the Moon looks dark", "A crescent, a thin sliver of light at the edge", "Half moon, exactly half the face lit", "Full moon, the whole face lit"],
                "The lit part grows from nothing to a sliver, to a half, to the full face, then shrinks back again. One full round of faces takes about a month."),
              mkTrueFalse("During a solar eclipse, the Moon passes between Earth and the Sun.",
                true,
                "The Moon's shadow falls on Earth, and for a few minutes day turns to dusk along a narrow path. The Moon is far smaller than the Sun, but it is also far closer, so it can just cover the face of the Sun."),
              mkQuiz("The phases of the Moon happen because...",
                ["the Moon spins like a top", "we see different amounts of its sunlit half as it orbits Earth", "clouds cover large parts of the Moon each night, all month long", "the Moon changes shape"],
                1,
                "The Moon itself never changes shape. Our viewing angle changes as it orbits, so the lit half turns toward us, then away, in a steady monthly rhythm."),
              mkDeepen("Go deeper: eclipses are clockwork you can set your watch by. People predicted them with careful tables long before telescopes, and the same patient timing now tracks the Moon's orbit so precisely that we know it drifts a few centimeters farther from Earth every year."),
            ],
          },
          {
            id: "space-beyond", title: "Galaxies and the Light Year", subtitle: "Our star is one among billions",
            cards: [
              mkNote("The big idea", "Cities of stars",
                "Stars are not scattered evenly through space. They gather into vast families called galaxies, each holding billions of stars along with gas and dust. Our Sun is one ordinary star in one such family, the Milky Way. Beyond it lie billions more galaxies, so far away that their light takes billions of years to reach us."),
              mkQuiz("A light year is...",
                ["the time light takes to circle Earth", "the distance light travels in one year", "a year with extra daylight", "the brightness of a star"],
                1,
                "Despite its name, a light year measures distance, not time. Light is so fast that one year of its travel covers an enormous stretch of space."),
              mkMatch("Match each word to what it means.",
                [["Galaxy", "A vast family of billions of stars"], ["Milky Way", "The galaxy that contains our Sun"], ["Light year", "The distance light travels in one year"], ["Andromeda", "A large galaxy near our own"]],
                "Our address in the universe: the Sun, in the Milky Way, with Andromeda as the big neighbor, and light years as the measuring tape."),
              mkTrueFalse("The nearest star beyond the Sun is a little over 4 light years away.",
                true,
                "It is called Proxima Centauri. Even traveling at the speed of the fastest spacecraft humans have built, the trip would take thousands of years, which gives a real feel for how big a light year is."),
              mkQuiz("When you look at a star 100 light years away, you see it...",
                ["as it is right now", "as it was 100 years ago", "as it will be in 100 years", "only in photographs"],
                1,
                "The light arriving tonight left that star a century ago. Looking far into space is always looking back in time, and telescopes are time machines of a sort."),
              mkDeepen("Go deeper: counting galaxies is a problem that grows as you get better at it. Point a telescope at the darkest patch of sky you can find, wait, and the black fills with thousands of galaxies nobody knew were there. Every deeper look raises the total instead of settling it."),
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
                "The water in your glass is ancient. It has been in oceans, clouds, rain, rivers, and living things, over and over again. The Sun powers the whole loop by lifting water into the air as invisible vapor. Water that turns into vapor and rises this way has evaporated.",
                { visual: "/cortex/paths/path-earth.webp", diagram: { steps: ["Ocean water warms in the Sun", "Water rises as vapor", "Vapor cools and forms clouds", "Water falls as rain or snow", "Rivers carry it back to the ocean"], caption: "The water cycle, in five moves. Nothing is created and nothing is lost; the same water goes around." } }),
              mkBuild("Build the water cycle: tap each step in the order it happens.",
                ["Sunlight warms the ocean", "Water rises into the air as vapor", "The vapor cools and forms clouds", "Water falls as rain or snow", "Rivers carry it back to the ocean"],
                "Warmth lifts the water, cooling gathers it into clouds, gravity brings it down, and rivers return it to the sea."),
              mkQuiz("Water rising from the sea into the air has...",
                ["evaporated", "frozen", "condensed", "rained"],
                0,
                "Evaporation is liquid water turning into vapor. It happens at the surface of oceans, lakes, and even wet soil."),
              mkMatch("Match each word to what it means.",
                [["Evaporation", "Liquid water turning into vapor"], ["Condensation", "Vapor turning back into liquid drops"], ["Precipitation", "Rain, snow, or hail falling from clouds"], ["Collection", "Water gathering in oceans, lakes, and the ground"]],
                "Up as vapor, back as drops, down as rain, gathered in the sea. Then it starts again."),
              mkVisualQ("Look at the diagram of the cycle. What happens right after the vapor cools?",
                "/cortex/paths/path-earth.webp",
                { steps: ["Ocean water warms in the Sun", "Water rises as vapor", "Vapor cools and forms clouds", "Water falls as rain or snow", "Rivers carry it back to the ocean"], caption: "The water cycle, in five moves." },
                ["It gathers into clouds", "It falls as rain at once", "It sinks into the ground", "It turns into sunlight"],
                0,
                "Cooling comes first, then gathering. The vapor condenses into tiny droplets, and billions of droplets together form a cloud. Rain only falls later, once the droplets grow heavy."),
              mkTrueFalse("Rain over land is a brand new supply of water made by clouds.",
                false,
                "Clouds move water around; they do not create it. Rain is ocean and lake water that evaporated, traveled on the wind, and fell again."),
              mkDeepen("Go deeper: the water in your glass has been on a long journey. It has been ocean, cloud, rain, river, and root, over and over, and the same endless loop connects a puddle on your street to ice at the poles. Trace any drop and you end up touring the whole planet."),
            ],
          },
          {
            id: "earth-clouds", title: "Clouds and Rain", subtitle: "Water you can see in the sky",
            cards: [
              mkNote("The big idea", "Clouds are water you can see",
                "Air always holds some invisible water vapor. When air rises and cools, the vapor condenses onto tiny specks of dust, forming droplets so small they float. Billions of those droplets together make a cloud."),
              mkQuiz("A cloud forms when water vapor...",
                ["disappears from the open sky", "cools and condenses into tiny droplets", "boils away into steam", "turns into oxygen gas"],
                1,
                "Cooling is the trigger. Cold air holds less vapor, so the extra vapor gathers into droplets around specks of dust."),
              mkTrueFalse("Fog is a cloud that forms at ground level.",
                true,
                "Same recipe, different height. When air at the surface cools until its vapor condenses, the cloud simply sits on the ground, and we call it fog."),
              mkQuiz("Raindrops begin to fall when the droplets...",
                ["grow heavy enough that the air cannot hold them up", "turn a bright blue color in the sky", "freeze solid into ice", "hear thunder rolling past"],
                0,
                "Droplets grow by joining together. Once they are too heavy for the rising air inside the cloud to support, down they come."),
              mkMatch("Match each cloud to its description.",
                [["Cumulus", "Puffy clouds with flat bottoms"], ["Cirrus", "Thin wispy clouds high in the sky"], ["Stratus", "Gray sheets of cloud that cover the sky"], ["Fog", "A cloud resting on the ground"]],
                "Sailors and farmers read the sky with these four shapes long before satellites existed."),
              mkDeepen("Go deeper: clouds are double agents in the warming story. Low bright clouds bounce sunlight back to space and cool the ground, while high thin clouds trap heat like a blanket. Which kind wins, and where, is one of the biggest open questions in understanding how fast the planet warms."),
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
                ["trees wave it into being", "air moves from where pressure is high to where it is low", "the Earth pauses its spin for a moment", "birds push the air along"],
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
              mkDeepen("Go deeper: forecasts earn trust the slow way, by being scored. Every prediction gets compared with what actually happened, and the scores have climbed decade after decade. A five day forecast today is about as trustworthy as a three day forecast was a generation ago."),
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
              mkDeepen("Go deeper: a climate average is built from patience: the same measurements, taken the same way, in the same places, for thirty years or more. That long view is what lets one cold winter sit inside a warming century without contradicting it. Short records shout. Long records speak."),
            ],
          },
        ],
      },
      {
        id: "earth-restless", title: "The Restless Earth", subtitle: "Rocks that change and plates that drift",
        lessons: [
          {
            id: "earth-rocks", title: "Rocks That Change", subtitle: "Three families, one slow cycle",
            cards: [
              mkNote("The big idea", "Three families of rock",
                "Every rock belongs to one of three families. Igneous rock forms when melted rock cools and hardens. Sedimentary rock forms when layers of sand, mud, and shells are buried and pressed into stone. Metamorphic rock forms when older rock is squeezed and heated until it changes into a new kind. Given enough time, any family can turn into any other."),
              mkQuiz("Fossils are most often found in which family of rock?",
                ["Igneous", "Sedimentary", "Metamorphic", "All three equally"],
                1,
                "Sedimentary layers settle gently over dead plants and animals, preserving their shapes. Melted rock would destroy such traces, and heat and pressure usually crush them."),
              mkMatch("Match each rock family to how it forms.",
                [["Igneous", "Melted rock cools and hardens"], ["Sedimentary", "Layers are buried and pressed into stone"], ["Metamorphic", "Older rock changed by heat and pressure"], ["Fossil", "Traces of a living thing kept in stone"]],
                "Cooling makes the first family, pressure from above makes the second, and heat and pressure together remake the third. Fossils ride along in the layers."),
              mkTrueFalse("Once a rock forms, it stays that kind of rock forever.",
                false,
                "Rocks are recycled over millions of years. Burial can press sediment into stone, melting can turn any rock back into liquid, and uplift and weather can break any rock down again."),
              mkQuiz("Granite, which cooled slowly from melted rock deep underground, belongs to which family?",
                ["Sedimentary", "Metamorphic", "Igneous", "Fossil"],
                2,
                "Any rock born from melted rock is igneous, whether it cooled fast at the surface, like lava rock, or slowly underground, like granite."),
              mkDeepen("Go deeper: rocks carry clocks inside them. Some atoms decay at a perfectly steady rate, so measuring how much has changed tells you how long the rock has existed. Stack those clocks across many rocks and a timeline emerges, one that puts the age of Earth at about 4.5 billion years."),
            ],
          },
          {
            id: "earth-plates", title: "Plates on the Move", subtitle: "The ground beneath you is drifting",
            cards: [
              mkNote("Key idea", "A cracked shell that drifts",
                "Earth's hard outer shell is not one solid piece. It is cracked into huge slabs called plates, and the plates drift, very slowly, riding on hotter and softer rock below. They move only a few centimeters a year, about as fast as your fingernails grow, but over millions of years that crawl redraws the whole map of the world. Where two plates push into each other, the land crumples upward into mountain ranges. Satellites measure the distances between continents changing year by year, so the drift is something we can watch happening, not just a guess."),
              mkQuiz("Where two plates push into each other, the land often...",
                ["melts into ocean", "crumples upward into mountain ranges", "turns into desert", "stops moving forever after that"],
                1,
                "Something has to give when two slabs collide, and the crust buckles and lifts. The Himalayas rose this way and are still rising as the pushing continues."),
              mkOrder("Put the life of a mountain range in order.",
                ["Two plates drift toward each other", "The crust between them crumples and lifts", "Peaks rise over millions of years", "Wind, water, and ice wear the peaks down"],
                "Colliding plates build the range, and weather slowly unmakes it. The tallest mountains on Earth are young ones, still rising faster than they wear away."),
              mkTrueFalse("Earthquakes happen mostly where plates meet and grind against each other.",
                true,
                "Plates do not slide smoothly. They lock, strain builds, and when the lock breaks the ground shakes loose all at once. That is an earthquake, and it happens along plate edges."),
              mkQuiz("How do scientists know the plates are really moving today?",
                ["They can feel the ground drifting", "Satellites measure the distances between continents changing year by year", "Sailors reported it long ago", "Maps drawn in different centuries disagree with each other"],
                1,
                "Modern instruments measure plate motion directly, a few centimeters a year. The drift the theory predicted is now a number anyone can watch changing."),
              mkDeepen("Go deeper: the drift of the continents was once laughed at, mostly because nobody could say what force could move whole continents. The idea won when the ocean floor itself turned out to be spreading, carrying the continents like luggage on a slow conveyor. Being right early is not enough. An idea also needs its mechanism."),
            ],
          },
        ],
      },
    ],
  },
];

/* ── catalog topic courses ─────────────────────────────────────────
   Every topic on the catalog shelves is an authored course in the
   same shape as the learning paths: two lessons that teach the
   topic in plain words, then a review lesson of quizzes on what
   was taught. Standard textbook knowledge, written for a curious
   twelve year old. No papers are referenced anywhere in the flow:
   no citations, no years, no findings, just teaching and checks.
   The factories are the path factories, so the Player, the
   staircase, and the progress store treat these exactly like
   paths. One unit holds the three lessons so the staircase and
   the unlock rule work unchanged. */
export const TOPIC_COURSES = [
  {
    id: "topic-sleep-memory", title: "Sleep and Memory", category: "Mind and Brain",
    blurb: "What sleep does to the memories you formed that day, and how the studies measure it.",
    units: [{ id: "topic-sleep-memory-unit", title: "The whole course", subtitle: "Two teaching lessons, then a review.", lessons: [
      {
        id: "sm-1", title: "The Night Shift", subtitle: "What your brain does while you sleep",
        cards: [
          mkNote("The big idea", "Sleep is work, not rest for the brain",
            "While you sleep, your brain is busy. Sleep comes in stages that repeat in cycles of about 90 minutes: light sleep, deep sleep, and dreaming sleep, which is also called REM sleep because the eyes move rapidly under the lids. A full night gives you several of these cycles, and each stage does a different job."),
          mkQuiz("How long does one full cycle of sleep stages last?",
            ["About 10 minutes", "About 90 minutes", "About four hours on a long night", "The whole night"],
            1,
            "The stages repeat in cycles of about 90 minutes, so a full night holds several cycles, each ending with dreaming sleep."),
          mkNote("How it works", "The brain files the day away",
            "During the day, new memories sit in a short term store, fragile and easy to knock loose. During sleep the brain replays the day and files those memories into long term storage, where they last. This filing job is called consolidation. Deep sleep does most of the filing for facts and events, like names, places, and things you studied. Dreaming sleep does more of the work for skills and for the emotional charge on memories."),
          mkQuiz("What does consolidation mean?",
            ["Forgetting the day so the brain can rest", "Filing new memories from a short term store into long term storage", "Dreaming about the day in story form", "Sleeping through the whole night, every night, without waking up once"],
            1,
            "Consolidation is the filing job sleep does: new memories move from a fragile short term store into long term storage, where they last."),
          mkNote("One more piece", "A short night costs you twice",
            "Sleep loss hurts at both ends. A tired brain takes in new learning badly the next day, because attention is part of learning. And a short night after studying gives the brain less time to file what you learned, so more of it fades. Learning something right before sleep protects it too: there is nothing new after it to crowd it out."),
          mkTrueFalse("Deep sleep does most of the filing for facts and events you learned that day.",
            true,
            "Deep sleep does most of the consolidation work for facts and events. Dreaming sleep does more of the work for skills and for the feelings attached to memories."),
        ],
      },
      {
        id: "sm-2", title: "The Hand Over", subtitle: "How memories move and settle during sleep",
        cards: [
          mkNote("The big idea", "A temporary store hands over to a lasting one",
            "Think of the hippocampus as the brain's front desk: it holds new memories for a short time. The cortex, the outer layer of the brain, is the archive where memories live for the long run. During deep sleep, the hippocampus replays the day's memories to the cortex again and again, and with each replay the memory settles more firmly into the archive. That is why a memory can feel weak at night and clear the next morning."),
          mkQuiz("In the front desk and archive picture, what does the hippocampus do?",
            ["It stores every memory forever, exactly as it happened, in perfect detail", "It holds new memories for a short time and hands them over during sleep", "It erases memories that do not matter", "It builds dreams out of old memories"],
            1,
            "The hippocampus is the front desk: it holds new memories briefly, then replays them to the cortex during deep sleep so they settle into long term storage."),
          mkNote("How it works", "Feelings get filed separately",
            "Sleep does not just copy the day. It edits. The facts of an event are kept, while the sharp feeling that came with them is turned down over time, which is one reason a bad day stings less after some nights of sleep. Skills settle too: a piano passage or a sports move practiced during the day is often smoother the next morning, even with no extra practice, because dreaming sleep helped file the pattern of movements."),
          mkMatch("Match each word to what it means.",
            [["Consolidation", "Filing new memories into long term storage"], ["REM sleep", "The dreaming stage, when the eyes move rapidly"], ["Hippocampus", "The front desk that holds new memories briefly"], ["Cortex", "The archive where memories live for the long run"]],
            "These four words carry the whole lesson: consolidation is the filing, REM sleep is the dreaming stage, the hippocampus holds memories briefly, and the cortex keeps them."),
          mkNote("One more piece", "Naps count, with a catch",
            "A nap can file memories too, and even a short nap after learning helps more than staying awake. The catch is depth: a nap long enough to reach deep sleep does the most filing, and waking from deep sleep can leave you groggy for a while. A short nap keeps you in light sleep and is easier to wake from, but it files less."),
          mkQuiz("Why can a memory feel weak at night and clear the next morning?",
            ["The brain invents missing details overnight", "Sleep replayed it from the front desk into the archive, so it settled", "Morning light repairs memories directly", "Tiredness hides memories that were never stored anywhere in the brain at all"],
            1,
            "During deep sleep the hippocampus replays the day's memories to the cortex. Each replay settles the memory more firmly, so it can feel clearer after sleep."),
        ],
      },
      {
        id: "sm-3", title: "Review and Recall", subtitle: "The whole topic, asked again",
        cards: [
          mkQuiz("Which stage of sleep does most of the filing for facts and events?",
            ["Light sleep", "Dreaming sleep", "Deep sleep", "The moment of waking"],
            2,
            "Deep sleep does most of the consolidation for facts and events. Dreaming sleep does more for skills and for the feelings on memories."),
          mkQuiz("What is the dreaming stage of sleep also called?",
            ["Deep sleep", "REM sleep", "Light sleep", "The filing stage"],
            1,
            "The dreaming stage is REM sleep, named for the rapid eye movements that come with it."),
          mkTrueFalse("A short night after studying costs nothing, because the filing happens only while you are awake.",
            false,
            "Sleep loss costs you at both ends: less filing time after learning, and worse attention for new learning the next day."),
          mkQuiz("What does the cortex do in this picture of memory?",
            ["It holds new memories for a short time and hands them over during sleep", "It builds the dreams you remember", "It is the archive where memories live for the long run", "It decides which feelings to erase"],
            2,
            "The cortex is the archive. The hippocampus holds new memories briefly and hands them over to the cortex during sleep."),
          mkQuiz("Why is learning something right before sleep a good plan?",
            ["Sleep doubles the size of the brain's storage and files everything twice", "Nothing new comes after it to crowd it out, and sleep files it next", "Dreams always repeat what you studied", "The hippocampus only works before midnight"],
            1,
            "Learning just before sleep is protected from interference, because nothing new follows it, and then sleep does the filing."),
        ],
      },
    ] }],
  },
  {
    id: "topic-predicting-brain", title: "The Predicting Brain", category: "Mind and Brain",
    blurb: "How the brain predicts what it is about to sense, and how it corrects itself.",
    units: [{ id: "topic-predicting-brain-unit", title: "The whole course", subtitle: "Two teaching lessons, then a review.", lessons: [
      {
        id: "pb-1", title: "A Brain That Guesses", subtitle: "Perception is a prediction that keeps getting checked",
        cards: [
          mkNote("The big idea", "Your brain guesses the world, then checks",
            "You might think your eyes and ears hand your brain the world as it is. They are too slow and too partial for that. Instead, the brain keeps a model of what the world is probably like right now, predicts what the senses should report next, and compares the prediction with what actually arrives. What you experience is mostly the model, corrected wherever the senses disagree."),
          mkQuiz("What does the brain mostly experience, in this picture?",
            ["Raw signals, exactly as the senses send them, with nothing added or changed", "A model of the world, corrected wherever the senses disagree", "Whatever it dreamed the night before", "Only the things it pays attention to"],
            1,
            "The senses are slow and partial, so the brain runs a model of the world and corrects it with incoming signals. Experience is the corrected model."),
          mkNote("How it works", "Errors are the teachers",
            "When the senses report something the model did not predict, that mismatch is called a prediction error. Prediction errors are precious: they are the only news the model gets. The brain uses them to update the model, so the next prediction is better. Signals that match the prediction are mostly ignored, which is why you stop noticing the feel of your clothes or the hum of a fridge."),
          mkQuiz("What is a prediction error?",
            ["A mistake the senses make when they are tired, repeated until the model breaks", "The mismatch between what the model predicted and what the senses report", "A wrong guess that damages the model", "The moment a dream feels real"],
            1,
            "A prediction error is the gap between prediction and report. The brain uses that gap to update the model, which is how the model learns."),
          mkNote("One more piece", "Prediction makes you fast",
            "Because the brain predicts, it can act before the full signal arrives. Catching a ball would be impossible if you waited to see where it is at each moment: by the time the signal is processed, the ball has moved. Your motor system throws your hand to where the model says the ball will be. Reading sloppy handwriting works the same way: the model fills in letters your eyes never fully resolved."),
          mkTrueFalse("Signals that match the brain's prediction are mostly ignored.",
            true,
            "That is the economy of the system: only mismatches carry news, so matching signals get little processing and fade from notice, like the feel of your clothes."),
        ],
      },
      {
        id: "pb-2", title: "When the Model Shows", subtitle: "Illusions, attention, and the cost of a stale model",
        cards: [
          mkNote("The big idea", "Illusions are the model, caught in the open",
            "An optical illusion is not your eyes failing. It is your model applying a good rule in a case where the rule misleads. A drawing can trick the rule that judges size by surrounding objects, or the rule that reads shading as depth. The illusion shows you the rule itself, because the senses and the model disagree and, for once, you can see the model's side of the argument."),
          mkQuiz("What does an optical illusion reveal?",
            ["That the eyes send damaged signals", "A rule the brain's model uses, caught in a case where it misleads", "That perception has nothing to do with models, and the brain plays no part", "That some people see the world as it truly is"],
            1,
            "Illusions expose the model's rules. The rules are usually right, which is why the cases where they mislead are so striking."),
          mkNote("How it works", "Attention turns up the volume on errors",
            "The brain cannot chase every prediction error at once. Attention is how it chooses: signals from the thing you attend to get their errors amplified, so the model updates there first, while the rest runs on habit. That is why a conversation you care about stays clear in a noisy room, and why an error in an unattended corner can pass completely unnoticed."),
          mkMatch("Match each word to what it means.",
            [["Model", "The brain's running picture of what the world is like"], ["Prediction error", "The mismatch between the model and what the senses report"], ["Illusion", "A case where a model rule misleads, so you can see the rule"], ["Attention", "The volume control that amplifies some errors over others"]],
            "The model predicts, prediction errors correct it, illusions expose its rules, and attention decides which errors get heard first."),
          mkNote("One more piece", "A model can go stale",
            "A model that updates too slowly leaves you surprised by a changed world: reaching for a step that is not there, or braking late on a wet road. A model that updates too eagerly treats noise as news and never settles. Healthy perception sits between the two, trusting errors in proportion to how reliable the signal usually is: sharp senses in bright light get more say than blurred ones in fog."),
          mkQuiz("Why does the brain trust the same signal more in bright light than in fog?",
            ["Bright light makes the model work faster", "It weights errors by how reliable the signal usually is", "Fog switches the prediction system off entirely until the sky clears", "The model prefers daytime predictions"],
            1,
            "The brain weights prediction errors by the usual reliability of the signal. A clear signal earns a bigger update than a blurred one."),
        ],
      },
      {
        id: "pb-3", title: "Review and Recall", subtitle: "The whole topic, asked again",
        cards: [
          mkQuiz("Why can you catch a ball that is moving fast?",
            ["Your eyes are faster than the ball", "Your motor system acts on where the model predicts it will be", "The brain slows time down during sport, which is why catching feels easy", "Catching uses no perception at all"],
            1,
            "Signals are too slow to track a ball moment by moment, so the brain predicts where it will be and throws the hand there."),
          mkQuiz("Why do you stop noticing the hum of a fridge?",
            ["The fridge gets quieter over time", "The hum matches the model, so it is mostly ignored", "Attention deletes sounds permanently once they repeat a few times", "The ears stop sending the signal"],
            1,
            "Only mismatches carry news. A sound the model predicts stops producing errors, so it fades from notice."),
          mkTrueFalse("An optical illusion means the eyes are damaged and sending broken signals.",
            false,
            "The eyes are fine. An illusion exposes a rule of the model, applied in a case where the rule misleads."),
          mkQuiz("What does attention do, in the prediction picture?",
            ["It builds the model from nothing", "It amplifies the prediction errors of the thing you attend to", "It stops prediction errors from happening and keeps the model frozen", "It chooses which dreams you have"],
            1,
            "Attention is a volume control: errors from the attended thing are amplified, so the model updates there first."),
          mkQuiz("What is the only news the brain's model ever gets?",
            ["Signals that match its predictions", "Prediction errors, where senses disagree with the model", "Dreams that feel important to the dreamer", "Sounds loud enough to notice consciously and remember afterwards"],
            1,
            "Prediction errors are the model's only news. They are what updates the model, everything else is business as usual."),
        ],
      },
    ] }],
  },
  {
    id: "topic-attention", title: "Attention Under Siege", category: "Mind and Brain",
    blurb: "What focus is, and what pulls it away.",
    units: [{ id: "topic-attention-unit", title: "The whole course", subtitle: "Two teaching lessons, then a review.", lessons: [
      {
        id: "at-1", title: "One Spotlight", subtitle: "Attention is limited, and that shapes everything",
        cards: [
          mkNote("The big idea", "Attention is a spotlight, not a floodlight",
            "At any moment, far more is happening around you than you can take in. Attention is the spotlight that selects a small part of it for full processing: one conversation, one page, one problem. What the spotlight lights up gets remembered and acted on. What stays outside it is processed shallowly or not at all, even when it happens right in front of you."),
          mkQuiz("What does the spotlight picture say about attention?",
            ["Everything in view gets processed equally", "A small part is selected for full processing and the rest is shallow or missed", "Attention widens the more tired you are", "Only sounds compete for attention, and sights and smells never compete for it at all"],
            1,
            "Attention selects. The lit part gets deep processing; the rest is shallow, which is why obvious things can be missed."),
          mkNote("How it works", "Focused people can miss the obvious",
            "When the spotlight is fully occupied, even striking events outside it can vanish. In a classic classroom demonstration, people asked to count passes between players in a game often fail to notice a person in a costume strolling through the middle of the scene. The eyes pointed at the scene the whole time. The spotlight was busy, so the event was never fully processed. This blindness to the unattended is not carelessness; it is the price of a spotlight that works."),
          mkQuiz("Why did the counters miss the person in the costume?",
            ["The person moved too fast to see", "Their spotlight was fully occupied by the counting task", "The costume made the person invisible", "They were looking at a different scene in a different room entirely"],
            1,
            "The event stayed outside the spotlight. Attention was spent on counting, so a striking event in plain view went unprocessed."),
          mkNote("One more piece", "Two kinds of pull",
            "The spotlight can be aimed on purpose, from the top down: you decide to read, and attention holds the page. It can also be grabbed from the bottom up: a sudden noise, a flash, a name spoken across the room. Good focus is mostly the top down aim winning, again and again, over a world full of things built to grab the spotlight from below."),
          mkTrueFalse("Missing an obvious event while concentrating can happen because the spotlight was fully occupied.",
            true,
            "It means the spotlight was occupied. Blindness to the unattended is the normal price of selective attention, not a character flaw."),
        ],
      },
      {
        id: "at-2", title: "The Switching Tax", subtitle: "Multitasking, grabs for attention, and getting focus back",
        cards: [
          mkNote("The big idea", "Multitasking is switching, and switching costs",
            "The spotlight lights one demanding task at a time. What feels like doing two things at once is usually rapid switching between them, and every switch costs: the brain must reload the rules and the state of the task it returns to, and some of the previous task lingers and interferes. The cost shows up as slowness and errors, worst when the two tasks are similar or both demand language."),
          mkQuiz("What is really happening when someone multitasks at two demanding jobs?",
            ["Two spotlights are running at once", "One spotlight is switching rapidly, and every switch costs time and accuracy", "The brain splits into two equal halves", "Practice removes the cost of switching entirely once you have done it for years"],
            1,
            "There is one spotlight. Multitasking is switching, and reloading a task after each switch is where the time and errors come from."),
          mkNote("How it works", "Designed to grab",
            "Bottom up grabs are not accidents. A phone buzzing, a red badge, a headline written to startle: these are built to seize the spotlight, because the spotlight is valuable. Each grab is small, but the return trip is not: after an interruption, the mind needs time to reload the task, and part of attention stays behind wondering about the message. Silencing the grabs does not remove willpower problems; it removes the need for willpower."),
          mkMatch("Match each word to what it means.",
            [["Spotlight", "The small selection that gets full processing"], ["Switching cost", "The time and errors paid each time the task changes"], ["Top down aim", "Attention directed on purpose, by your own goal"], ["Bottom up grab", "Attention seized by a sudden signal from outside"]],
            "The spotlight selects, switching costs, the top down aim is yours, and bottom up grabs are the world's bids for the same spotlight."),
          mkNote("One more piece", "Focus can be rebuilt",
            "Attention tires like a muscle and recovers like one too. Sleep restores it most, which is why a tired mind wanders no matter how much it cares. Short breaks help, and so does a single clear target: one task, visible, with the next step obvious. Long sessions of forced focus work better as a rhythm of effort and rest than as one unbroken strain."),
          mkQuiz("Why does silencing notifications help more than trying harder to ignore them?",
            ["Notifications stop existing when silenced", "It removes the bottom up grabs instead of fighting them all day", "Trying hard has no effect on attention at all, however hard anyone tries", "Silence switches the spotlight off completely"],
            1,
            "Each grab forces a contest between the grab and your aim, plus a costly reload after. Removing the grabs removes the contests."),
        ],
      },
      {
        id: "at-3", title: "Review and Recall", subtitle: "The whole topic, asked again",
        cards: [
          mkQuiz("What happens to things outside the spotlight of attention?",
            ["They are processed deeply anyway", "They are processed shallowly or missed entirely", "They are stored for later automatic recall in perfect detail", "They are converted into dreams"],
            1,
            "Outside the spotlight, processing is shallow or absent. That is the price, and the point, of selection."),
          mkQuiz("What does every switch between tasks cost?",
            ["Nothing, once you are practiced", "A reload of the task's rules and state, paid in time and errors", "The whole spotlight, permanently", "One full attention cycle plus the cost of rebuilding the whole scene"],
            1,
            "Switching means reloading. The reload, plus interference from the task you left, is the multitasking tax."),
          mkTrueFalse("A red badge and a buzzing phone are top down grabs for attention, aimed by your own goal.",
            false,
            "Sudden, loud, or startling signals seize the spotlight from below. Badges and buzzes are designed to do exactly that."),
          mkQuiz("What restores attention most?",
            ["More coffee than usual, cup after cup", "Sleep and time away from demands", "Switching tasks faster", "Brighter screens"],
            1,
            "Sleep is the great restorer of attention. Breaks and a single clear target help during the day, but a tired mind wanders."),
          mkQuiz("Who aims the spotlight in top down attention?",
            ["The loudest signal nearby", "Your own goal, on purpose", "The last notification", "Habit alone, never choice"],
            1,
            "Top down attention is the deliberate aim: you choose the page, the conversation, the problem, and hold the spotlight there."),
        ],
      },
    ] }],
  },
  {
    id: "topic-why-we-dream", title: "Why We Dream", category: "Mind and Brain",
    blurb: "Why we dream at all, and the explanations researchers are still testing.",
    units: [{ id: "topic-why-we-dream-unit", title: "The whole course", subtitle: "Two teaching lessons, then a review.", lessons: [
      {
        id: "dr-1", title: "Stories in the Dark", subtitle: "What dreaming is, before why",
        cards: [
          mkNote("The big idea", "The brain builds stories while the body is off",
            "Most vivid dreams arrive during REM sleep, the stage where the eyes move rapidly under the lids. In this stage the brain is nearly as active as when you are awake, and it builds experiences out of that activity: people, places, and plots that feel real while they last. At the same time, the muscles of the body are switched off, which is why you do not act the dream out in bed."),
          mkQuiz("Why do you not act out your dreams in bed?",
            ["Dreams are too faint to move muscles", "During REM sleep the body's muscles are switched off", "The brain forbids all movement at night, even rolling over in bed", "Sleeping people cannot move at all"],
            1,
            "In REM sleep the brain is highly active while the skeletal muscles are switched off, so the dream plays without the body joining in."),
          mkNote("How it works", "Dreams are built from pieces of the day",
            "Dream material is not random noise from nowhere. Pieces of recent days turn up again and again: faces, worries, places, half finished tasks. Older memories mix in too, and the dreaming brain is loose about logic, so a childhood kitchen can open into a modern airport without the dreamer blinking. The looseness is a clue: whatever dreaming is for, strict accuracy is not its style."),
          mkQuiz("Where does dream material mostly come from?",
            ["Only from childhood", "Pieces of recent days mixed with older memories", "Pure random noise with no link to life, work, or memory", "Only from things you worried about"],
            1,
            "Dreams recombine the recent and the old. The mix, and the loose logic applied to it, are the dream's signature."),
          mkNote("One more piece", "Everyone dreams, not everyone remembers",
            "People who say they never dream usually mean they never remember one. Wake someone during REM sleep and they will often report a dream in progress; let the stage finish and the dream usually evaporates. Remembering depends on waking at the right moment and paying attention quickly, which is why a dream can feel huge at waking and gone by breakfast."),
          mkTrueFalse("During dreaming sleep the brain is switched off and quiet, just like the muscles.",
            false,
            "During REM sleep the brain is nearly as active as in waking. It is the body that is switched off, not the brain."),
        ],
      },
      {
        id: "dr-2", title: "Ideas About Why", subtitle: "Four explanations, none of them settled",
        cards: [
          mkNote("The big idea", "Nobody knows for certain, and that is the honest start",
            "Why we dream is an open question, and any honest course should say so plainly. There are serious ideas, each with something to recommend it and none with a knockout proof. Treat what follows as a map of the contenders, not a verdict: dreams might file memories, might process feelings, might rehearse dangers, or might be the side effect of a brain tidying itself, with the story built to make sense of the noise."),
          mkQuiz("What is the honest state of the question, why do we dream?",
            ["It was settled long ago: dreams predict the future and warn us", "Several serious ideas compete and none has a knockout proof", "Dreams have been proven to mean nothing at all", "Only one idea has ever been proposed"],
            1,
            "The question is open. Memory filing, emotion processing, threat rehearsal, and side effect stories are all live contenders."),
          mkNote("How it works", "The leading contenders",
            "The memory idea says dreams are the filing system at work, replaying the day while memories consolidate. The feelings idea notes that dreams are heavy with emotion, and suggests the brain replays emotional events in a safe place until their charge fades. The rehearsal idea points at how many dreams involve being chased, unprepared, or in danger: practice for threats, in a world where failing costs nothing. The side effect idea says the cortex simply narrates the signals a tidying brain sends, and the story is the narration, not the purpose."),
          mkMatch("Match each idea to what it claims.",
            [["Memory idea", "Dreams are the filing system replaying the day"], ["Feelings idea", "Dreams replay emotional events until their charge fades"], ["Rehearsal idea", "Dreams practice threats where failing costs nothing"], ["Side effect idea", "Dreams are the story built to narrate a tidying brain"]],
            "Four contenders, four different claims. A good test for any of them is whether it explains the emotion, the danger, and the loose logic of dreams at once."),
          mkNote("One more piece", "Nightmares and lucid dreams",
            "A nightmare is a dream whose threat rehearsal, or emotion, runs too hot and wakes the sleeper. Occasional nightmares are normal; frequent ones that wreck sleep are a problem worth help. At the gentler end sits the lucid dream, where the dreamer becomes aware they are dreaming while still asleep and can sometimes steer the story: a reminder that the dreaming brain is not one simple thing, but layers that can switch on separately."),
          mkQuiz("What is a lucid dream?",
            ["A dream you remember perfectly in the morning, word for word and scene for scene", "A dream where the dreamer knows they are dreaming while still asleep", "A dream with no story at all", "A nightmare that ends happily"],
            1,
            "In a lucid dream the dreamer is aware, mid dream, that it is a dream, and can sometimes steer it."),
        ],
      },
      {
        id: "dr-3", title: "Review and Recall", subtitle: "The whole topic, asked again",
        cards: [
          mkQuiz("In which stage of sleep do most vivid dreams arrive?",
            ["Deep sleep", "Falling asleep", "REM sleep", "Light sleep only"],
            2,
            "Vivid dreams belong mostly to REM sleep, when the brain is highly active and the body is switched off."),
          mkQuiz("Why do people who say they never dream usually still dream?",
            ["They dream only during childhood years and never again after that", "They rarely wake during REM sleep, so dreams evaporate", "Their dreams are too short to count", "Dreaming stops when memory is good"],
            1,
            "Dreaming is near universal. Remembering is the rare part, and it depends on waking at the right moment."),
          mkTrueFalse("The rehearsal idea says dreams let the brain practice threats in a place where failing costs nothing.",
            true,
            "That is the rehearsal contender: dreams are full of chases and dangers, and practice in a safe place would explain why."),
          mkQuiz("What should an honest course say about why we dream?",
            ["The question is settled, the answer is simple, and everyone agrees", "The question is open, with serious ideas and no knockout proof", "Dreams are messages that need decoding", "Science ignores the question entirely"],
            1,
            "Open means open. The ideas are worth knowing precisely because none of them has won yet."),
          mkQuiz("Which of these is one of the contenders for why we dream?",
            ["Dreams cool the brain like a fan", "Dreams process feelings by replaying emotional events safely", "Dreams empty the eyes of the day's images, washing them clean overnight", "Dreams are how the skull grows at night"],
            1,
            "The feelings idea is a real contender, alongside the memory idea, the rehearsal idea, and the side effect idea."),
        ],
      },
    ] }],
  },
  {
    id: "topic-exercise-longevity", title: "Exercise and Longevity", category: "Body and Health",
    blurb: "What the research measures about movement, aging, and how much is enough.",
    units: [{ id: "topic-exercise-longevity-unit", title: "The whole course", subtitle: "Two teaching lessons, then a review.", lessons: [
      {
        id: "ex-1", title: "Movement Is a Signal", subtitle: "What exercise actually does inside the body",
        cards: [
          mkNote("The big idea", "Working muscles talk to the whole body",
            "Exercise is not just burning fuel. When muscles work, they release signal molecules into the blood that speak to the heart, the liver, the fat stores, and even the brain. The heart grows stronger and pumps more per beat. Blood vessels stay supple. The body gets better at moving sugar out of the blood and into muscle, which is one reason regular movement protects against type 2 diabetes."),
          mkQuiz("What do working muscles release into the blood?",
            ["Nothing at all; they only burn fuel and make the body tired", "Signal molecules that speak to organs all over the body", "Extra bones for storage in the legs", "Heat and nothing else worth naming"],
            1,
            "Contracting muscles are a signaling organ. Their messages reach the heart, liver, fat, and brain, which is why exercise touches so many systems at once."),
          mkNote("How it works", "Two kinds of training, two kinds of gain",
            "Aerobic exercise, like brisk walking, cycling, or swimming, trains the heart and lungs to deliver oxygen. Strength training loads the muscles and bones, and they answer by growing denser and stronger. Both matter, and they matter more with age: muscle and bone are the savings account you draw on in old age, and strength work also protects balance, which protects against falls."),
          mkQuiz("What does strength training protect that aerobic exercise protects less?",
            ["The heart's pumping power and the lungs' reach", "Muscle, bone density, and balance", "The ability to hold your breath", "Eyesight and sharp vision"],
            1,
            "Strength work loads muscle and bone, so both grow stronger, and it protects balance. Aerobic work is the heart and lungs specialist."),
          mkNote("One more piece", "How much is enough",
            "The standard public health guideline for adults is about 150 minutes of moderate aerobic activity a week, plus strength work twice a week. Moderate means you can talk but not sing. The guideline is a floor with big benefits, not a cliff: the largest gain comes from going from nothing to something, and benefits keep rising, more gently, beyond it."),
          mkTrueFalse("Going from no activity to some activity brings the largest health gain.",
            true,
            "The first steps matter most. Benefits keep rising after that, but the jump from nothing to something is the steepest part of the curve."),
        ],
      },
      {
        id: "ex-2", title: "The Long Game", subtitle: "Habits, recovery, and the sitting problem",
        cards: [
          mkNote("The big idea", "The body adapts to what you repeat",
            "One hard workout changes little. The body adapts to patterns: train regularly and it rebuilds itself a little stronger after each session, during the rest that follows. That is the quiet secret of exercise: the workout is the request, and recovery is when the improvement is actually built. Skip the recovery too often and the requests pile up as soreness, stalled progress, and injury."),
          mkQuiz("When is the improvement from a workout actually built?",
            ["During the workout itself", "During the recovery that follows, as the body rebuilds", "Only during sleep on weekends", "Never; workouts only spend the body and never build anything"],
            1,
            "The workout is the request; recovery is the construction. Training without recovery stacks requests on a body that cannot answer them."),
          mkNote("How it works", "Sitting is its own problem",
            "Long unbroken sitting carries risks of its own, separate from whether you exercise. Blood sugar and fat handling worsen through a long still day, even in people who train in the morning. The practical answer is not to fear chairs but to break the stillness: stand, walk, and move briefly and often. Small movements through the day and a workout are partners, not substitutes."),
          mkMatch("Match each word to what it means.",
            [["Aerobic exercise", "Training that builds the heart and lungs' oxygen delivery"], ["Strength training", "Loading muscles and bones so they grow stronger"], ["Recovery", "The rest in which the body rebuilds after training"], ["Moderate activity", "Effort where you can talk but not sing"]],
            "Aerobic work trains oxygen delivery, strength work loads muscle and bone, recovery is when gains are built, and moderate means talk, not sing."),
          mkNote("One more piece", "More is not always better",
            "There is a ceiling where extra training stops adding health and starts adding wear. Joints, immune function, and mood all notice when the load never lets up. The people who live longest with their strength intact tend to be neither extreme nor idle: they move a lot, moderately, for decades. Longevity rewards the habit you can keep, not the heroic month."),
          mkQuiz("What pattern does longevity reward most, in this picture?",
            ["One heroic month of training each year and then complete rest", "A moderate habit of movement kept up for decades", "Total rest, to save the joints", "Training only when ill"],
            1,
            "The body adapts to what repeats. Decades of moderate movement beat short bursts of heroics followed by nothing."),
        ],
      },
      {
        id: "ex-3", title: "Review and Recall", subtitle: "The whole topic, asked again",
        cards: [
          mkQuiz("About how much moderate aerobic activity does the standard guideline suggest each week?",
            ["About 20 minutes", "About 150 minutes", "About 900 minutes", "As much as possible, without limit"],
            1,
            "About 150 minutes a week of moderate activity, plus strength work twice a week. It is a floor with big benefits, not a cliff."),
          mkQuiz("What is moderate activity, by the talk test?",
            ["Effort where you cannot speak at all", "Effort where you can talk but not sing", "Effort where singing is easy", "Any movement done outdoors"],
            1,
            "Talk but not sing: that is the everyday measure of moderate effort."),
          mkTrueFalse("A morning workout alone covers the whole day, so long sitting between workouts costs nothing.",
            false,
            "Long stillness carries its own risks. Breaking it up with brief movement through the day partners with the workout; it is not replaced by it."),
          mkQuiz("Why does recovery matter as much as the workout?",
            ["It is when the body rebuilds itself a little stronger", "It burns more fuel than training", "It is the only time muscles release signals into the blood at all", "It does not matter; only workouts count"],
            0,
            "Recovery is construction time. The workout asks, the rest answers, and skipping the answer turns training into wear."),
          mkQuiz("What happens to blood sugar handling as muscles work regularly?",
            ["The body forgets how to use sugar and stops using it entirely", "It gets better at moving sugar from blood into muscle", "Sugar handling stops mattering with age", "Only the lungs are affected by it"],
            1,
            "Regular movement improves how the body clears sugar from the blood, one of the ways exercise protects against type 2 diabetes."),
        ],
      },
    ] }],
  },
  {
    id: "topic-gut-immune", title: "The Gut Immune Alliance", category: "Body and Health",
    blurb: "How gut microbes and the immune system shape each other, study by study.",
    units: [{ id: "topic-gut-immune-unit", title: "The whole course", subtitle: "Two teaching lessons, then a review.", lessons: [
      {
        id: "gi-1", title: "A Crowded Border", subtitle: "Why so much of the immune system lives at the gut",
        cards: [
          mkNote("The big idea", "The gut is a border, and borders need guards",
            "Your gut is a long tube where the outside world passes through the middle of you: food, drink, and trillions of microbes. Its lining is a border only one cell thick in places, and borders like that need guards. That is why a large share of the body's immune cells live in and around the gut wall, more than anywhere else: it is the busiest frontier the body has."),
          mkQuiz("Why do so many immune cells live around the gut?",
            ["The gut is where the blood is made", "It is a busy border where the outside world passes through", "Immune cells prefer warm places to live", "The gut is the largest and heaviest organ in the whole human body"],
            1,
            "The gut wall is a thin, busy frontier between you and everything you swallow. Guards gather where the traffic is."),
          mkNote("How it works", "Microbes train the guards",
            "The immune system is not born knowing friend from foe. Gut microbes help teach it. Immune cells sample the microbes at the border and learn which residents are harmless neighbors to leave alone and which patterns mean danger. A gut with a rich variety of microbes gives the guards a broader education, and an immune system trained this way is less likely to overreact to harmless things like pollen or food."),
          mkQuiz("What do gut microbes help teach the immune system?",
            ["How to digest food without enzymes", "Which residents are harmless and which patterns mean danger", "How to make the gut lining thicker", "Nothing at all; the immune system is born finished and learns nothing"],
            1,
            "Microbes are the training set. Sampling them teaches immune cells the difference between a neighbor and a threat."),
          mkNote("One more piece", "When training goes wrong",
            "An immune system that overreacts to harmless things produces allergies. One that attacks the body's own tissues produces autoimmune illness. One that underreacts lets invaders through. The alliance in this course's title is real: the microbes are not passengers, they are part of how the guards learn their job, and the health of one side shows up in the other."),
          mkTrueFalse("An allergy is the immune system overreacting to something harmless.",
            true,
            "Allergies are overreactions: the guards treating a harmless thing, like pollen or a food, as if it were a dangerous invader."),
        ],
      },
      {
        id: "gi-2", title: "Feeding the Alliance", subtitle: "Fiber, variety, and the barrier itself",
        cards: [
          mkNote("The big idea", "Fiber is food for the guards' teachers",
            "You cannot digest fiber; your microbes can. When they ferment fiber, they release helpful acids that feed the gut lining itself and calm immune activity at the border. A diet with many different plant fibers feeds many different microbes, which keeps the whole community, and the training it gives, broad. A narrow diet feeds a narrow community."),
          mkQuiz("What do gut microbes make from fiber that helps the gut?",
            ["Extra fiber for the next meal", "Helpful acids that feed the gut lining and calm the border", "Vitamins and nothing else at all, whatever else the meal holds", "Oxygen to enrich the blood"],
            1,
            "Fermenting fiber, microbes release helpful acids. Those acids nourish the lining cells and tune immune activity at the border."),
          mkNote("How it works", "The barrier is alive and selective",
            "The gut lining is not a wall; it is a staffed checkpoint. Mucus coats it, cells are joined tightly, and immune cells patrol behind it. The right things pass: water, nutrients, the microbes' helpful acids. The wrong things are held back or dealt with. When the barrier is damaged or the mucus thins, more of the wrong traffic reaches the guards, and the border stays inflamed."),
          mkMatch("Match each word to what it means.",
            [["Microbes", "The trillions of tiny residents living in the gut"], ["Fiber", "Plant material you cannot digest but your microbes can"], ["Barrier", "The living checkpoint of mucus, lining cells, and guards"], ["Allergy", "An immune overreaction to something harmless"]],
            "Microbes live at the border, fiber feeds them, the barrier checks the traffic, and an allergy is the guards overreacting."),
          mkNote("One more piece", "Variety beats any single hero food",
            "No single food builds a healthy gut community; variety does. Different microbes eat different fibers, so a week with many different plants feeds a broader community than a week of one perfect vegetable. Fermented foods like yogurt and kimchi add live microbes to the mix as well. The alliance is an ecosystem, and ecosystems thrive on diversity, not on a single star species."),
          mkQuiz("Why does eating many different plants help the gut community?",
            ["Plants cancel each other out completely", "Different microbes eat different fibers, feeding more kinds", "Only green plants contain any fiber", "Variety confuses harmful microbes into leaving the gut and never returning"],
            1,
            "Each fiber feeds different residents. A varied menu raises a varied community, and a varied community trains the guards broadly."),
        ],
      },
      {
        id: "gi-3", title: "Review and Recall", subtitle: "The whole topic, asked again",
        cards: [
          mkQuiz("Where does a large share of the body's immune system live?",
            ["In the skin only", "In and around the gut wall", "In the bones of the legs", "Nowhere in particular"],
            1,
            "The gut is the busiest border, so the guards gather there: a large share of immune cells live in and around the gut wall."),
          mkQuiz("What feeds gut microbes best, in this picture?",
            ["Sugar water", "Many different plant fibers", "Protein alone", "Nothing; microbes feed themselves"],
            1,
            "Fiber is microbe food, and different fibers feed different microbes. Variety in plants means variety in the community."),
          mkTrueFalse("The gut lining is an open gate that lets everything from a meal pass straight into the blood.",
            false,
            "It is a staffed checkpoint: mucus, tight joins between cells, and patrolling immune cells let the right things pass and hold the wrong things back."),
          mkQuiz("What can an undertrained or mistuned immune system do?",
            ["Nothing but its job, always and perfectly, in every body and every place", "It can overreact to harmless things or attack the body's own tissues", "It turns into extra gut microbes instead", "It stops needing the gut entirely"],
            1,
            "All three failures are failures of the same training: allergies overreact, autoimmune illness attacks the self, and weak responses let invaders through."),
          mkQuiz("What do the helpful acids from fermenting fiber do?",
            ["Dissolve the gut lining", "Feed the gut lining and calm immune activity at the border", "Replace the need for immune cells", "Make fiber digestible by humans directly"],
            1,
            "The acids nourish the lining itself and tune the guards. Fiber feeds microbes, microbes feed the border."),
        ],
      },
    ] }],
  },
  {
    id: "topic-fasting-metabolism", title: "Fasting and Metabolism", category: "Body and Health",
    blurb: "What skipping meals does, and what it does not.",
    units: [{ id: "topic-fasting-metabolism-unit", title: "The whole course", subtitle: "Two teaching lessons, then a review.", lessons: [
      {
        id: "fa-1", title: "Two Fuel Tanks", subtitle: "How the body switches between fed and fasting",
        cards: [
          mkNote("The big idea", "The body runs on two fuel systems",
            "After a meal, the body burns the sugar arriving from food and stores the extra: some as glycogen, a quick access store in the liver and muscles, and the rest as fat. Hours after eating, when incoming sugar runs out, the body switches over: it frees stored fuel, first glycogen, then increasingly fat. This switching between the fed state and the fasting state is normal, and your body does a version of it every night while you sleep."),
          mkQuiz("What does the body do with extra sugar right after a meal?",
            ["It throws the extra away", "It stores some as glycogen and the rest as fat", "It turns all of it into muscle, bone, and height at once", "It stops burning fuel entirely"],
            1,
            "Fed state storage: quick access glycogen first, fat for the long term. The fasting state spends those stores in the same order."),
          mkNote("How it works", "Insulin is the switch operator",
            "The hormone insulin rises when you eat and tells the body to store fuel and stop releasing it. When you fast, insulin falls, and low insulin is the permission slip for the stores to open: glycogen breaks down, fat is freed to burn. This is why insulin is sometimes called the fed state hormone: high means store, low means spend."),
          mkQuiz("What does low insulin permit the body to do?",
            ["Store more fat immediately", "Open the fuel stores and spend glycogen and fat", "Stop using fuel altogether", "Convert muscle into sugar at once, all of it, overnight"],
            1,
            "Insulin low means spend. The stores open in order: glycogen first, then more and more fat as the fast goes on."),
          mkNote("One more piece", "Hunger is a wave, not a ramp",
            "Hunger does not rise in a straight line until you eat. It comes in waves, often at the times you usually eat, driven partly by habit and by the hunger hormone ghrelin, which your body releases on a learned schedule. Miss the wave and it often passes. This is why the first days of a new eating schedule feel hardest: the waves still arrive at the old times, before the schedule relearns."),
          mkTrueFalse("The body switches between fed and fasting states every day, including overnight.",
            true,
            "The switch is normal physiology, not a special mode. Sleeping through the night is the fast everyone already does."),
        ],
      },
      {
        id: "fa-2", title: "What Fasting Can and Cannot Do", subtitle: "Real effects, honest limits",
        cards: [
          mkNote("The big idea", "Most of the benefit is the simple part",
            "People who fast often lose weight, and the main reason is plain: eating in fewer hours usually means eating less overall. The fuel switching is real, but it is not magic; a fast spent eating double at dinner undoes itself. Where fasting helps many people is structure: a clear window is a rule that is easy to follow, and rules that are easy to follow beat perfect plans that collapse."),
          mkQuiz("Why do people who fast usually lose weight?",
            ["Fasting melts fat directly, no matter what or when they eat", "Eating in fewer hours usually means eating less overall", "Insulin stops working forever", "Hunger disappears permanently"],
            1,
            "The main driver is total intake. The window is a structure that makes eating less easier to sustain."),
          mkNote("How it works", "The body also tidies during fasts",
            "When fuel is plentiful, cells build. When fuel runs low, cells shift toward maintenance: they recycle worn parts and clear out damaged material, a housekeeping process sometimes called the body's self cleaning. This tidying is one reason fasting interests scientists beyond weight. But it also happens in ordinary overnight fasts and during exercise; it is a dial the body turns, not a switch only long fasts can reach."),
          mkMatch("Match each word to what it means.",
            [["Glycogen", "The quick access fuel store in liver and muscles"], ["Insulin", "The hormone that rises with food and orders storage"], ["Ghrelin", "The hunger hormone released on a learned schedule"], ["Fasting state", "The hours when the body spends its stored fuel"]],
            "Glycogen is the quick store, insulin orders storage, ghrelin schedules hunger, and the fasting state spends what was stored."),
          mkNote("One more piece", "Not for everyone, and not a contest",
            "Fasting is a tool, not a virtue, and it does not suit every body or every life. People who are pregnant, who take medicines timed with food, or who have a history of eating disorders should not fast without medical guidance. Longer is not automatically better, either: very long fasts cost muscle and can be dangerous. The honest summary is modest: fasting is one workable way to eat less, with a few extra metabolic effects, and its risks grow as it stretches."),
          mkQuiz("What is the honest summary of fasting, from this lesson?",
            ["It is magic that melts fat regardless of intake", "One workable eating structure: helpful for some, risky stretched far", "Everyone should fast as long as possible daily, for as many hours as they can", "It replaces the need for sleep and exercise"],
            1,
            "Structure, modest extra effects, real limits. That is the whole honest picture."),
        ],
      },
      {
        id: "fa-3", title: "Review and Recall", subtitle: "The whole topic, asked again",
        cards: [
          mkQuiz("In what order does the body spend its stored fuel in a fast?",
            ["Fat first, then glycogen, then muscle at the end", "Glycogen first, then increasingly fat", "Muscle first, always", "It never spends stores"],
            1,
            "Quick access first: glycogen opens early, and fat takes a growing share the longer the fast runs."),
          mkQuiz("Why does hunger often pass if you wait?",
            ["The stomach switches off", "Hunger comes in waves tied to habit and ghrelin, and waves pass", "Waiting destroys the hunger hormone forever and hunger never returns", "Hunger only exists at mealtimes by law"],
            1,
            "Hunger is scheduled and wave like. Miss the usual eating time and the wave often fades on its own."),
          mkTrueFalse("Eating double in the eating window still works, because only the window matters.",
            false,
            "Total intake still rules. Eating double in the window undoes the fast; the window mainly works by making less easier."),
          mkQuiz("What does the body shift toward when fuel runs low?",
            ["Building new tissue at all costs, ignoring the fuel shortage", "Maintenance: recycling worn parts and clearing damage", "Growing new organs for later", "Stopping all repair work entirely"],
            1,
            "Low fuel turns the dial toward housekeeping. The recycling happens in overnight fasts too, not only in long ones."),
          mkQuiz("Who should not fast without medical guidance?",
            ["Only professional athletes in heavy training", "People who are pregnant, on timed medicines, or prone to eating disorders", "Everyone over the age of thirty", "Nobody; fasting suits all bodies equally well, whatever their health or age"],
            1,
            "Fasting is a tool with limits. Those groups need guidance first, and very long fasts carry risks for anyone."),
        ],
      },
    ] }],
  },
  {
    id: "topic-pain-explained", title: "Pain, Explained", category: "Body and Health",
    blurb: "How the brain builds pain, and why the same injury can hurt more or less.",
    units: [{ id: "topic-pain-explained-unit", title: "The whole course", subtitle: "Two teaching lessons, then a review.", lessons: [
      {
        id: "pa-1", title: "Pain Is Built, Not Delivered", subtitle: "Signals go up; pain is made at the top",
        cards: [
          mkNote("The big idea", "Damage signals are not pain yet",
            "Special sensors called nociceptors sit in skin, muscle, and organs, watching for damage or threat: heat, pressure, chemicals from injured tissue. When they fire, signals travel to the brain. But the signals are not pain. Pain is the experience the brain builds from those signals, combined with context: what you expect, what you fear, what you are doing, and what similar moments meant before."),
          mkQuiz("What are nociceptors?",
            ["Pain itself, in cellular form", "Sensors that detect damage or threat and signal the brain", "The brain's own pain volume knob", "Cells that exist only in the skin layer and nowhere else in the body"],
            1,
            "Nociceptors are the sensors. They send signals; the brain builds the pain from signals plus context."),
          mkNote("How it works", "Why the same injury can hurt differently",
            "Two people, same sprained ankle, different pain. It is not imaginary in either case. The brain weighs the signals against the situation: an athlete mid game may notice little until the whistle, because attention and urgency turn the volume down; the same ankle at night, with nothing to do but worry, can throb. Fear, poor sleep, and past bad injuries turn the volume up. Calm, understanding, and feeling safe turn it down."),
          mkQuiz("Why might an athlete barely feel an injury until the game ends?",
            ["Athletes have fewer nociceptors", "Attention and urgency turn the pain volume down", "Injuries only hurt after midnight", "Signals travel slower during sport and arrive hours late"],
            1,
            "The signals were arriving all along. The brain, busy and urgent, built less pain from them until the game released its attention."),
          mkNote("One more piece", "The brain has a volume control",
            "The pathway runs both ways. The brain sends signals back down that can dampen or amplify the incoming traffic, a built in volume control. This is not a metaphor layered on the science; it is plumbing. Expectation reaches into that plumbing, which is why a treatment you believe in can genuinely reduce pain, and why a frightening explanation of a scan can genuinely make a back hurt more."),
          mkTrueFalse("Pain is a direct readout of how much tissue damage there is.",
            false,
            "Pain is built from signals plus context. Severe damage can hurt little in the moment, and pain can be severe with little damage, because the brain is weighing, not just reading."),
        ],
      },
      {
        id: "pa-2", title: "When Pain Outstays Its Job", subtitle: "Acute warnings, chronic alarms, and what helps",
        cards: [
          mkNote("The big idea", "Acute pain is a warning; chronic pain is a stuck alarm",
            "Fresh pain after an injury is useful: it guards the damaged part while it heals. Pain that lasts long after healing, usually counted as chronic past about three months, is different. The system itself has become more sensitive, like an alarm tuned to go off at a breath. The pain is real, but it is reporting the alarm's sensitivity now, not ongoing damage."),
          mkQuiz("What is chronic pain reporting, when tissue has healed?",
            ["Hidden damage that scans cannot see, hiding deep in the tissue", "The alarm system's own sensitivity, turned up over time", "Nothing; chronic pain is imaginary", "Damage in a different body part"],
            1,
            "A sensitized system produces real pain with little provocation. The message is about the alarm, not about fresh damage."),
          mkNote("How it works", "Sensitivity is trainable, in both directions",
            "Alarms learn. Repeated pain teaches the pathways to respond earlier and stronger, which is one reason early, calm treatment of injuries matters. The same learning runs in reverse: gentle movement, good sleep, and understanding what pain means can retrain the system toward its normal setting. Total rest for a sensitive system usually backfires, because the alarm never gets evidence that movement is safe."),
          mkMatch("Match each word to what it means.",
            [["Nociceptor", "A sensor that detects damage or threat"], ["Acute pain", "Fresh pain that guards an injury while it heals"], ["Chronic pain", "Pain lasting past healing, from a sensitized system"], ["Volume control", "The brain's power to dampen or amplify incoming signals"]],
            "Sensors detect, acute pain guards, chronic pain is a sensitized alarm, and the volume control explains why context matters."),
          mkNote("One more piece", "What this means in practice",
            "Because pain is built, treating it well means treating more than tissue: sleep, fear, fitness, and understanding all feed the construction. It also means pain deserves respect as a real experience in every case, including when scans look clean. A clean scan says little about damage. It says nothing about how much something hurts, because hurt was never only about the tissue."),
          mkQuiz("Why can total rest backfire for a sensitized pain system?",
            ["Rest makes muscles vanish in a day", "The alarm never gets evidence that movement is safe", "Rest is painful all by itself", "Movement is the only cause of pain anywhere in the body"],
            1,
            "Retraining needs evidence. Gentle, successful movement teaches the alarm that the body part is safe again."),
        ],
      },
      {
        id: "pa-3", title: "Review and Recall", subtitle: "The whole topic, asked again",
        cards: [
          mkQuiz("Where is pain actually built?",
            ["In the injured tissue", "In the brain, from signals plus context", "In the nociceptors alone", "Nowhere; pain is delivered ready made to the tissue itself"],
            1,
            "Signals travel up; pain is constructed at the top, which is why context, expectation, and sleep all shape it."),
          mkQuiz("Which of these turns the pain volume up?",
            ["Feeling safe and calm", "Fear, poor sleep, and past bad injuries", "Understanding what pain means and signals", "Gentle movement"],
            1,
            "Fear, poor sleep, and bad history amplify. Calm, understanding, and safety dampen."),
          mkTrueFalse("Chronic pain can continue after healing because the alarm system has become more sensitive.",
            true,
            "A sensitized alarm produces real pain without fresh damage. The pain reports the system's sensitivity, not ongoing injury."),
          mkQuiz("Why can a frightening explanation of a scan make pain worse?",
            ["Words cannot affect pain in any way", "Expectation reaches the volume control and turns it up", "Scans themselves cause damage", "It cannot happen; only medicine changes pain, never words"],
            1,
            "Expectation is part of the construction. A scary story is an instruction to the volume control."),
          mkQuiz("What is acute pain for?",
            ["Punishing carelessness", "Guarding a damaged part while it heals", "Testing the alarm system monthly, like a fire drill at school", "Nothing useful at all"],
            1,
            "Fresh pain is a guard: it protects injured tissue during healing. The problem is only when the guard never stands down."),
        ],
      },
    ] }],
  },
  {
    id: "topic-editing-code-of-life", title: "Editing the Code of Life", category: "Life and Evolution",
    blurb: "Gene editing, from the first tools to the big arguments.",
    units: [{ id: "topic-editing-code-of-life-unit", title: "The whole course", subtitle: "Two teaching lessons, then a review.", lessons: [
      {
        id: "cr-1", title: "Scissors Borrowed From Bacteria", subtitle: "Where the editing tool came from",
        cards: [
          mkNote("The big idea", "DNA is a text, and bacteria invented the scissors",
            "Your DNA is an instruction text written in four letters, and a gene is one instruction in it. The editing tool called CRISPR was not invented in a lab from nothing; it was borrowed. Bacteria use it as an immune system: when a virus attacks, the bacterium stores a snippet of the virus's DNA and later uses that snippet as a wanted poster, guiding a cutting protein to chop the matching virus DNA if it returns."),
          mkQuiz("Where did the CRISPR editing tool come from?",
            ["It was designed from scratch by computer, atom by atom, in a modern lab", "It was borrowed from a bacterial defense system against viruses", "It was found in a meteorite", "It occurs naturally in human cells"],
            1,
            "CRISPR is a bacterial immune system, repurposed. The wanted poster snippet and the cutting protein were already working together in bacteria."),
          mkNote("How it works", "A guide, a cutter, and a repair crew",
            "To edit a cell, scientists build a small guide made of RNA whose letters match the DNA spot they want to change. The guide leads a cutting protein, often called Cas9, to exactly that spot, and the protein cuts the DNA there. Then the cell's own repair crew fixes the cut. If the repair is sloppy, the gene at that spot usually stops working. If a corrected template is provided, the repair can paste it in, changing the instruction."),
          mkQuiz("What does the guide RNA do in editing?",
            ["It cuts the DNA at random", "Its letters match the target spot, leading the cutting protein there", "It repairs the cut after editing", "It carries the cell's whole instruction text"],
            1,
            "The guide is the addressing system: its letters match one spot in the DNA text, and the cutter follows it there."),
          mkNote("One more piece", "Cutting is easy; precision is the hard part",
            "The cutter sometimes trims at spots that merely resemble the target. These off target cuts can break other instructions, so much of the craft in gene editing is choosing guides carefully and checking the result letter by letter. Editing one cell in a dish is a world away from editing the right cells inside a living body, which is where delivery becomes the real problem."),
          mkTrueFalse("The cell's own repair crew fixes the DNA after the cutting protein makes its cut.",
            true,
            "The cutter only cuts. The edited outcome, a gene knocked out or a template pasted in, is the repair crew's work."),
        ],
      },
      {
        id: "cr-2", title: "What Editing Is For", subtitle: "Real uses and the lines being argued about",
        cards: [
          mkNote("The big idea", "First uses: fixing instructions in blood cells",
            "The first approved gene editing treatments work on blood. In sickle cell disease, one wrong letter in one gene makes red blood cells deform into stiff sickles that jam blood vessels. Doctors can take a patient's blood stem cells out, edit them in the lab, check the edit, and return them. Working outside the body is what makes this first generation of treatments possible: the cells can be inspected before they go back in."),
          mkQuiz("Why do the first approved treatments edit cells outside the body?",
            ["Editing only works in a lab dish", "Cells edited outside can be checked before they are returned", "The body rejects all edited cells", "It is cheaper to edit blood than any other tissue in the whole body"],
            1,
            "Outside the body, the edit can be verified cell batch by cell batch. Delivery inside the body is the unsolved half of the field."),
          mkNote("How it works", "Body cells and embryos are different questions",
            "Editing body cells, like blood cells, changes only the person treated. Editing an embryo changes every cell of a future person, including the cells that make their children, so the change can be inherited. That difference is why the first is medicine and the second is a society wide argument: about consent from people not yet born, about safety across generations, and about who decides which traits count as diseases to fix."),
          mkMatch("Match each word to what it means.",
            [["DNA", "The instruction text written in four letters"], ["Guide RNA", "The small guide whose letters address one DNA spot"], ["Cas9", "The cutting protein that follows the guide"], ["Off target cut", "A cut at a spot that only resembles the target"]],
            "DNA is the text, the guide RNA is the address, Cas9 is the cutter, and an off target cut is the imprecision everyone works to avoid."),
          mkNote("One more piece", "Beyond medicine",
            "The same tool is reshaping ordinary biology and farming: crops edited for disease resistance, mosquitoes edited to fight malaria spread, and basic research that switches genes off one by one to learn what each does. Each use replays the same pattern from this course: a precise cut is easy to make, and the hard part is knowing all of what the cut will do."),
          mkQuiz("What makes editing an embryo a different question from editing blood cells?",
            ["Embryo cells are larger than blood cells in every species", "Embryo edits change every cell and can be inherited", "Blood cells have no DNA in them", "Embryos cannot be edited at all"],
            1,
            "An embryo edit is inherited by every cell, including the ones that make the next generation. That is why it is an argument for society, not just a treatment."),
        ],
      },
      {
        id: "cr-3", title: "Review and Recall", subtitle: "The whole topic, asked again",
        cards: [
          mkQuiz("In bacteria, what was CRISPR originally for?",
            ["Building the cell's outer walls", "Cutting up the DNA of viruses that attack the cell", "Making food from sunlight alone", "Copying the cell's own DNA faithfully each time it divides"],
            1,
            "It is an immune system: store a snippet of the attacker, then use it as a wanted poster to guide the cutter next time."),
          mkQuiz("What usually happens to a gene when the repair of a cut is sloppy?",
            ["It becomes twice as strong", "It usually stops working", "It moves to another cell", "Nothing at all"],
            1,
            "A sloppy repair scrambles the instruction at the cut, so the gene is knocked out. A provided template is how a repair becomes a correction."),
          mkTrueFalse("An off target cut happens at exactly the DNA spot the guide was built for.",
            false,
            "Off target means exactly that: the cutter trimmed a lookalike spot. Choosing guides and checking results letter by letter is the craft of avoiding them."),
          mkQuiz("In sickle cell disease, what goes wrong?",
            ["The blood has too few cells of any kind to carry oxygen", "One wrong letter in one gene makes red cells deform", "The cutting protein attacks the blood", "The liver stores too much iron instead"],
            1,
            "A single letter error in a single gene changes the shape of red blood cells, which is why it became the first target for editing treatments."),
          mkQuiz("What is the hardest unsolved problem in editing inside the body?",
            ["Locating any gene to edit in the whole text of the genome", "Delivering the editor to the right cells", "Making the cutter cut at all", "Reading the DNA text"],
            1,
            "The cut is easy. Getting guides and cutters to the right cells, and only those cells, inside a living body is the hard part."),
        ],
      },
    ] }],
  },
  {
    id: "topic-why-we-age", title: "Why We Age", category: "Life and Evolution",
    blurb: "How cells age, and the clocks researchers use to measure it.",
    units: [{ id: "topic-why-we-age-unit", title: "The whole course", subtitle: "Two teaching lessons, then a review.", lessons: [
      {
        id: "ag-1", title: "Many Small Declines", subtitle: "Aging is not one switch but a pileup",
        cards: [
          mkNote("The big idea", "There is no single cause of aging",
            "Aging is not one mechanism wearing out. It is many small declines running at once: damage piling up in DNA and proteins, power stations in cells working less well, repair crews slowing, and the immune system losing its edge. Each decline feeds the others, which is why aging speeds up as it goes, and why no single fix can be the whole answer."),
          mkQuiz("Which picture of aging does this lesson teach?",
            ["One switch flips and aging begins", "Many small declines run at once and feed each other", "Aging is caused only by the sun", "Only the brain ages; the body stays new and unchanged forever"],
            1,
            "Damage, power loss, slow repair, weaker immunity: the pileup is the point, and it is why aging accelerates."),
          mkNote("How it works", "The caps on the ends of chromosomes",
            "Every time a cell divides, it copies its chromosomes, the DNA packages. The copying cannot quite reach the very ends, so a protective cap at each end, called a telomere, gets a little shorter with each division. When the cap runs too short, the cell stops dividing or dies. Telomeres are one of the body's counting clocks: they limit how many times a cell line can renew itself."),
          mkQuiz("What is a telomere?",
            ["A kind of power station inside cells, making all their energy", "A protective cap on chromosome ends that shortens", "A hormone that causes aging itself", "The name given to a very old cell"],
            1,
            "Telomeres are end caps. Each division shortens them, and a cap that runs out stops the cell from dividing further."),
          mkNote("One more piece", "Cells that retire but will not leave",
            "Some worn cells enter a state called senescence: they stop dividing, which protects against cancer, but they do not die. They linger and leak inflammatory signals that trouble their neighbors. A few such cells are useful, after injury for instance. Piles of them, accumulating with age, are part of why old tissue heals slowly and stays inflamed."),
          mkTrueFalse("Senescent cells have stopped dividing but remain in the tissue, leaking inflammatory signals.",
            true,
            "That is the bargain of senescence: division stops, which guards against cancer, but the lingering cells inflame the neighborhood."),
        ],
      },
      {
        id: "ag-2", title: "Power, Repair, and What Helps", subtitle: "Mitochondria, maintenance, and honest limits",
        cards: [
          mkNote("The big idea", "The power stations wear too",
            "Inside nearly every cell sit mitochondria, the power stations that turn fuel and oxygen into usable energy. They carry their own small loop of DNA, close to where energy is made, and it takes damage over a lifetime. As power output falls and waste signals rise, cells run less cleanly. Tissues that demand the most energy, muscle, brain, and heart among them, feel the decline first and loudest."),
          mkQuiz("Why do muscle, brain, and heart feel mitochondrial decline early?",
            ["They have no mitochondria", "They demand the most energy, so falling output hits them first", "They divide more than other tissues", "They are the oldest tissues in the body, made before all the others"],
            1,
            "Power loss shows where demand is highest. The hungriest tissues notice a failing supply first."),
          mkNote("How it works", "Maintenance is the real contest",
            "Young bodies do not avoid damage; they out repair it. DNA is fixed, misfolded proteins are recycled, worn cells are replaced. Aging is what happens when damage slowly outpaces this maintenance. That framing matters, because maintenance can be supported: muscle kept in use keeps its repair crews funded, sleep is prime repair time, and not smoking removes a major source of new damage."),
          mkMatch("Match each word to what it means.",
            [["Telomere", "The chromosome end cap that shortens with each division"], ["Senescence", "The state of a cell that stopped dividing but lingers"], ["Mitochondria", "The cell's power stations, turning fuel into energy"], ["Maintenance", "The repair work that keeps damage from piling up"]],
            "Telomeres count divisions, senescent cells linger, mitochondria power the cell, and maintenance is the repair effort aging outpaces."),
          mkNote("One more piece", "Honest limits",
            "No treatment has been shown to stop or reverse human aging. Claims beyond that are marketing, not results. What does hold up is duller and real: exercise, sleep, and not smoking slow several of the declines at once, and they do it by supporting maintenance, the same contest the whole course describes. Aging research aims first at more healthy years, not at immortality."),
          mkQuiz("What has actually been shown to slow several declines of aging at once?",
            ["A single supplement that reverses aging for everyone, young and old", "Exercise, sleep, and not smoking, by supporting maintenance", "Avoiding all effort to save the joints", "Nothing whatsoever affects the pace"],
            1,
            "The proven levers are plain ones. They support the repair side of the contest, which is the side that can be helped."),
        ],
      },
      {
        id: "ag-3", title: "Review and Recall", subtitle: "The whole topic, asked again",
        cards: [
          mkQuiz("What happens when a telomere runs too short?",
            ["The cell divides faster", "The cell stops dividing or dies", "The chromosome doubles in length", "Nothing changes for the cell"],
            1,
            "The cap is the counter. When it runs out, that cell line's renewals are over."),
          mkQuiz("Why does aging speed up as it goes?",
            ["Each birthday adds a fixed amount of damage, the same every year", "The declines feed each other, so the pileup compounds", "Telomeres lengthen with age", "Repair improves but damage doubles nightly"],
            1,
            "Damage slows repair, slow repair allows more damage: the loop is why the pace quickens."),
          mkTrueFalse("Young bodies avoid damage entirely, which is why they do not age.",
            false,
            "Young bodies take damage constantly. They out repair it. Aging begins in the balance, not in the presence of damage."),
          mkQuiz("What leaks inflammatory signals that trouble neighboring cells?",
            ["Brand new stem cells, freshly made in the bone marrow", "Senescent cells that stopped dividing but linger", "Red blood cells carrying oxygen", "Telomeres themselves, leaking"],
            1,
            "Senescent cells are retirees who will not leave: safe from dividing, costly to live next to."),
          mkQuiz("What is the honest aim of aging research?",
            ["Immortality, guaranteed soon", "More healthy years, by slowing the declines", "Stopping all cell division", "Replacing maintenance with medicine entirely"],
            1,
            "Health span first. The levers that work support maintenance; nothing shown reverses human aging."),
        ],
      },
    ] }],
  },
  {
    id: "topic-animal-minds", title: "Minds of Other Animals", category: "Life and Evolution",
    blurb: "Which animals know what, and how we can tell.",
    units: [{ id: "topic-animal-minds-unit", title: "The whole course", subtitle: "Two teaching lessons, then a review.", lessons: [
      {
        id: "am-1", title: "Testing Fairly", subtitle: "The first problem is the test itself",
        cards: [
          mkNote("The big idea", "A fair test fits the animal",
            "Asking what an animal knows is harder than it sounds, because the test has to fit the animal's body and senses. A test of memory built on reading would call every animal stupid. A test of smell would crown the dog and fail the human. The craft of this field is designing questions each animal can answer in its own way: choosing, reaching, looking, or waiting, so that what is measured is the mind, not the mismatch."),
          mkQuiz("What makes a test of animal minds fair?",
            ["Giving every species the same written exam and marking it the same way", "Asking the question in a form that fits the animal's senses and body", "Only testing animals that resemble humans", "Testing in a laboratory, always"],
            1,
            "Fairness is fit. Measure the mind through the senses and limbs the animal actually has, or you measure the mismatch instead."),
          mkNote("How it works", "The mirror test and what it can show",
            "One famous test puts a mark on an animal where it can only be seen in a mirror. If the animal uses the mirror to inspect or touch the mark on its own body, it suggests the animal recognizes the reflection as itself. Some apes, dolphins, elephants, and magpies have passed versions of this. Failing proves little: an animal that never uses mirrors, or does not care about marks, may know itself in ways the test cannot see."),
          mkQuiz("What does touching a mirror only mark on your own body suggest?",
            ["That the animal likes mirrors", "That the animal recognizes the reflection as itself", "That the animal has learned a trick for food over many trials", "Nothing worth concluding yet"],
            1,
            "The mark can only be located by using the reflection, so touching it means the animal treats the image as its own body."),
          mkNote("One more piece", "Absence of evidence is not evidence of absence",
            "This field lives by one warning: failing a test shows the test found nothing, not that nothing is there. Minds unlike ours are easy to underestimate, because our tests are built from our own senses and habits. The history of the field is a trail of animals surprising people who had designed fairer tests. For a dog, a fair memory test hides food and watches whether the dog returns to the right place: memory asked in the currency the dog actually spends."),
          mkTrueFalse("If an animal fails a test, that failure alone does not prove the ability the test was for is missing.",
            true,
            "It proves the test found nothing, which may be about the test. Fair design is the whole craft, precisely because failure is ambiguous."),
        ],
      },
      {
        id: "am-2", title: "What Animals Have Shown", subtitle: "Tools, memory, and other minds",
        cards: [
          mkNote("The big idea", "Tools and foresight beyond us",
            "Tool use was once called the human trademark, and it is not. Chimpanzees fish for termites with prepared sticks. Crows bend wire into hooks and keep their best tools. Sea otters crack shellfish on rock anvils, and some octopuses carry coconut shells to hide inside later, which is planning: carrying a shelter now for a need that has not arrived yet. Each case was first doubted, then watched again more carefully."),
          mkQuiz("Why is an octopus carrying a coconut shell a sign of planning?",
            ["The shell is heavy exercise for it", "The shell is carried now for a need that has not arrived", "Octopuses collect all round objects they find on the sea floor", "It is not planning at all, ever"],
            1,
            "Planning means acting now for a future need. Hauling a shelter you do not yet need is exactly that."),
          mkNote("How it works", "Remembering what, where, and when",
            "Some birds hide thousands of seeds and recover them months later, remembering not just where each cache is but what is stored there and how long it keeps; they dig up perishable food first. That is memory for what, where, and when together, a combination once thought to be a human specialty called episodic memory. Whether the bird's experience feels like ours is unknowable; the behavior itself is measured and real."),
          mkMatch("Match each idea to what it means.",
            [["Fair test", "A question asked in a form that fits the animal's senses"], ["Mirror test", "Touching a mark only visible in a mirror, showing self recognition"], ["Tool use", "Using an object to do a job, like a stick for termites"], ["Planning", "Acting now for a need that has not arrived yet"]],
            "Fit the test to the animal, mirrors probe self recognition, tools extend the body, and planning acts ahead of need."),
          mkNote("One more piece", "Other minds in mind",
            "The deepest question is whether animals know that others have minds too: that a rival who saw the food hidden knows where it is. Ravens and apes behave in experiments as if they track what others have seen, hiding food again when watched by a competitor who was present at the first hiding. Each result is argued about, fairly, because behavior can sometimes be explained by simpler rules. The argument itself is the science working."),
          mkQuiz("Why do scientists argue about tests of animal minds even after clever behavior is seen?",
            ["They dislike animals and distrust their tests, their tools, and their keepers", "Simpler rules can explain the same behavior, so cleverness must earn it", "Behavior can never be evidence about a mind", "Only mirror tests are allowed as evidence"],
            1,
            "A behavior that could be rule following or mind reading needs cleaner tests to separate the two. The argument is the method, not a failure of it."),
        ],
      },
      {
        id: "am-3", title: "Review and Recall", subtitle: "The whole topic, asked again",
        cards: [
          mkQuiz("Which of these is a fairer memory test for a dog?",
            ["A written list to memorize", "Hiding food and watching whether the dog returns to the right place", "Asking the dog to describe yesterday", "A test of reading facial expressions in photographs only, nothing else"],
            1,
            "The test must fit the animal: a dog's mind is reachable through smell, place, and choice, not through reading."),
          mkQuiz("What combination of memory do seed hiding birds demonstrate?",
            ["Only where it happened, and nothing more than that", "What, where, and when together", "Only when it happened", "Faces and names only"],
            1,
            "They recover perishable food first, which means the cache memory carries what is stored, where, and how long it keeps."),
          mkTrueFalse("Passing the mirror test is the only way an animal can show self awareness.",
            false,
            "It is one probe, bound to vision and mirrors. Animals may know themselves through senses the test never touches, and failing proves little."),
          mkQuiz("A crow bending wire into a hook is an example of what?",
            ["Instinct with no flexibility and no learning at all", "Tool making: shaping an object to do a job", "Planning for next year", "Mirror self recognition"],
            1,
            "Bending a new hook from straight wire is tool making, not just tool use: the object is shaped for the task."),
          mkQuiz("What is the field's standing warning about failed tests?",
            ["Failure settles the question forever and ends the matter", "Absence of evidence is not evidence of absence", "All animals secretly pass all tests", "Tests should never be repeated"],
            1,
            "A failed test may indict the test. That warning is why the field keeps redesigning fairer questions."),
        ],
      },
    ] }],
  },
  {
    id: "topic-first-life", title: "The First Life", category: "Life and Evolution",
    blurb: "The experiments and arguments about how life first started copying itself.",
    units: [{ id: "topic-first-life-unit", title: "The whole course", subtitle: "Two teaching lessons, then a review.", lessons: [
      {
        id: "fl-1", title: "A World With No Life", subtitle: "The ingredients and the energy to mix them",
        cards: [
          mkNote("The big idea", "Start with a planet, water, and sparks",
            "The young Earth had oceans, an atmosphere of simple gases, and abundant energy: lightning, ultraviolet light, and heat from volcanoes and deep sea vents. There was no free oxygen, because oxygen in the air is made by life, and there was no life yet. The puzzle of the first life is how ordinary chemistry in that world crossed into something that could copy itself and evolve."),
          mkQuiz("Why did the young Earth's air have no free oxygen?",
            ["Oxygen had not been invented by volcanoes or stored in the seas", "Oxygen in air is made by life, and there was no life yet", "Oxygen sank into the oceans permanently", "The young Earth had no air at all"],
            1,
            "Free oxygen is a product of living things. Before life, the air held simple gases, water vapor, and no oxygen to speak of."),
          mkNote("How it works", "Building blocks form on their own",
            "In a classic laboratory demonstration, researchers ran electric sparks, standing in for lightning, through gases and water chosen to mimic the young Earth. The water turned cloudy with new compounds, among them amino acids, the building blocks of proteins. The demonstration did not create life. It showed something nearly as important: the first steps, from gases to building blocks, happen by plain chemistry when energy is supplied."),
          mkQuiz("What did the spark experiment actually show?",
            ["Life can be created in a week in a jar, fully formed and crawling", "Plain chemistry, given energy, turns gases into amino acids", "Amino acids themselves are alive", "Lightning is made of amino acids"],
            1,
            "Building blocks, not life. The importance is that the first steps need no miracle: energy plus simple ingredients does them."),
          mkNote("One more piece", "Three things life needs",
            "However the story went, the first living thing needed three inventions working together. It needed a boundary, a membrane to hold it apart from the sea. It needed instructions that could be copied, so offspring resembled parents. And it needed a way to harvest energy from its surroundings to pay for the copying. Modern cells have all three in sophisticated forms; the puzzle is the order they arrived in."),
          mkTrueFalse("The spark experiment created amino acids, the building blocks of proteins.",
            true,
            "It created amino acids, the building blocks of proteins. That is step one of a long staircase, not the top of it."),
        ],
      },
      {
        id: "fl-2", title: "Which Came First", subtitle: "The RNA idea and the common ancestor",
        cards: [
          mkNote("The big idea", "A chicken and egg problem at the heart of cells",
            "Modern cells store instructions in DNA, and read them using proteins. But DNA cannot copy itself without proteins, and proteins are built from DNA's instructions. Each needs the other, so which came first? A leading answer points at RNA, a cousin of DNA. RNA can store instructions like DNA, and, unlike DNA, it can also do chemical work like a protein. One molecule playing both roles dissolves the chicken and egg problem."),
          mkQuiz("Why is RNA a leading candidate for the first instruction molecule?",
            ["It is the only molecule in cells", "It can both store instructions and do chemical work", "It is stronger than DNA in every way", "It was found in meteorites fully formed and ready to copy"],
            1,
            "DNA stores but cannot act; proteins act but are not copied as instructions. RNA does some of both, so it could have started the loop."),
          mkNote("How it works", "Membranes that make themselves",
            "The boundary problem has a surprisingly gentle answer. Fatty molecules of the kind that form in these early chemistries gather themselves into hollow spheres in water, for the same reason oil forms droplets: it is what the physics prefers. Such spheres can grow, split, and trap other molecules inside by chance. A self copying molecule caught inside a self forming bubble is not yet a cell, but it is recognizably on the road to one."),
          mkMatch("Match each word to what it means.",
            [["Amino acids", "The building blocks of proteins"], ["RNA", "The molecule that can store instructions and do chemical work"], ["Membrane", "The boundary that holds a cell apart from the sea"], ["Protein", "The worker molecules that do the cell's chemistry"]],
            "Amino acids build proteins, RNA may have bridged instructions and work, membranes draw the boundary, and proteins are the workers that run the chemistry."),
          mkNote("One more piece", "One ancestor for everything alive",
            "Compare any two living things, a human and a mushroom, and their cells use the same instruction code, the same building blocks, and the same basic machinery. The simplest explanation is that all life today descends from one ancient population of cells, sometimes called the last universal common ancestor. It was not the first life; it was the first life whose descendants survived. Earlier experiments in living, whatever they were, left no line behind."),
          mkQuiz("Why do scientists think all life shares one ancestor?",
            ["All living things look much alike", "All use the same code, building blocks, and machinery", "Only one cell ever formed at all", "Fossils show the first cell directly, whole and preserved in rock"],
            1,
            "The deep sameness of the machinery is the fingerprint of common descent. One surviving line explains it best."),
        ],
      },
      {
        id: "fl-3", title: "Review and Recall", subtitle: "The whole topic, asked again",
        cards: [
          mkQuiz("Which three inventions did the first life need together?",
            ["Wings, eyes, and legs for moving across the land and sea", "A boundary, copyable instructions, and harvested energy", "Bones, blood, and a working brain", "Seeds, soil, and sunlight to eat"],
            1,
            "A membrane to be separate, instructions to be copied, and energy to pay for it. Everything else in life is elaboration."),
          mkQuiz("What energy sources did the young Earth offer early chemistry?",
            ["Only sunlight, falling gently", "Lightning, ultraviolet light, and volcanic heat", "None; the planet was cold, still, and dark for ages", "Fire, lit by the first animals"],
            1,
            "A violent young planet was an energy rich one, and energy is what turns simple gases into building blocks."),
          mkTrueFalse("The last universal common ancestor was the very first living thing.",
            false,
            "It was the first whose descendants survived. Earlier forms of life may have existed and left no line behind."),
          mkQuiz("How do fatty molecules help solve the boundary problem?",
            ["They cannot interact with water at all and avoid it completely", "They gather into hollow spheres in water by themselves", "They turn directly into DNA strands", "They are alive entirely on their own"],
            1,
            "The physics prefers spheres: fatty molecules in water form droplets and shells without any cellular machinery."),
          mkQuiz("What is the chicken and egg problem of the first cell?",
            ["Which animal species came first", "DNA needs proteins to copy it; proteins are built from DNA", "Cells need oxygen, but oxygen needs cells", "Membranes need water, but water needs membranes to exist first"],
            1,
            "Each partner in the modern system requires the other. RNA, playing both roles, is the leading way out of the loop."),
        ],
      },
    ] }],
  },
  {
    id: "topic-oceans-in-motion", title: "Oceans in Motion", category: "Earth and Climate",
    blurb: "How ocean currents move heat around the planet, and what researchers watch for as they change.",
    units: [{ id: "topic-oceans-in-motion-unit", title: "The whole course", subtitle: "Two teaching lessons, then a review.", lessons: [
      {
        id: "oc-1", title: "Rivers Inside the Sea", subtitle: "Surface currents and what drives them",
        cards: [
          mkNote("The big idea", "The ocean surface is a network of rivers",
            "The top of the ocean moves in great loops called currents, some as wide and strong as rivers. Steady winds dragging on the water start them, and the spin of the Earth bends their paths, so the loops circle whole ocean basins. Warm currents carry tropical heat toward the poles along some coasts, and cold currents return along others, which is why two beaches at the same latitude can have utterly different water."),
          mkQuiz("What starts the great surface currents?",
            ["Earthquakes under the sea floor", "Steady winds dragging on the water, bent by the Earth's spin", "The Moon pulling whole oceans sideways, dragging them around the Earth", "Fish migrations pushing the water"],
            1,
            "Wind drag plus planetary spin: the wind supplies the push, and the spin bends the flow into basin wide loops."),
          mkNote("How it works", "The Coriolis bend",
            "Because the Earth rotates, moving water does not travel in the straight line it started on; it curves, to the right in the northern half of the planet and to the left in the southern half. This bending is called the Coriolis effect, and it is the same reason storms spin in opposite directions on either side of the equator. Currents, winds, and storms all obey it."),
          mkQuiz("What does the Coriolis effect do to moving water?",
            ["It warms the water by friction", "It bends its path: right in the north, left in the south", "It pulls it toward the equator always", "It stops currents at the equator line"],
            1,
            "The bend comes from standing on a rotating planet: paths curve right in the north, left in the south."),
          mkNote("One more piece", "Currents are climate",
            "Western Europe is far warmer than other places at its latitude, and a warm Atlantic current flowing past its coasts is a major reason: the current delivers tropical heat, and the winds deliver the warmed air inland. When people ask why ocean currents matter, that is the shortest answer: they are a planetary heating system, moving warmth from where there is too much to where there is too little."),
          mkTrueFalse("Ocean currents can make two beaches at the same latitude have water at very different temperatures.",
            true,
            "Currents decide much of it. A warm current on one coast and a cold current on another make the same latitude feel like different planets."),
        ],
      },
      {
        id: "oc-2", title: "The Deep Conveyor", subtitle: "Cold water, sinking water, and the water that rises",
        cards: [
          mkNote("The big idea", "Below the wind's reach, density drives the flow",
            "Deep currents obey a different rule: density. Cold water is denser than warm, and salty water is denser than fresh. Near the poles, surface water grows cold and salty as sea ice forms, until it is heavy enough to sink, sliding down to the ocean floor and creeping toward the equator. This slow overturning, surface to deep and back over centuries, is called the conveyor, and it connects every ocean on Earth."),
          mkQuiz("What makes polar surface water sink?",
            ["It is pushed down by strong surface winds blowing week after week", "It grows cold and salty, dense enough to sink to the floor", "It is pulled downward by the Moon", "It sinks simply because it is old"],
            1,
            "Density is the driver: cold and salty wins the sinking contest, and that sinking is the conveyor's engine."),
          mkNote("How it works", "Where the deep water comes back up",
            "Water that sinks must somewhere rise, and in many places it does so where winds pull surface water away from a coast or the equator, letting cold deep water well up in its place. This upwelling water is rich: it carries nutrients that sank with dead plankton long ago. Where upwelling happens, plankton bloom, and fish, birds, and fisheries gather; some of the world's great fishing grounds sit exactly on upwelling zones."),
          mkMatch("Match each word to what it means.",
            [["Current", "A river of water moving inside the ocean"], ["Coriolis effect", "The bending of paths on a rotating planet"], ["Conveyor", "The slow overturning linking surface and deep ocean"], ["Upwelling", "Deep water rising to replace surface water pulled away"]],
            "Currents are the rivers, Coriolis bends them, the conveyor overturns the whole ocean slowly, and upwelling returns deep water, and its nutrients, to the light."),
          mkNote("One more piece", "A conveyor worth watching",
            "Because the conveyor moves heat, nutrients, and carbon, scientists watch its strength the way doctors watch a pulse. A slowdown would reshuffle climates and fisheries far from the poles where the sinking happens. The system is slow and vast, so changes are hard to measure and slow to be sure of, which is exactly why the watching never stops."),
          mkQuiz("Why is upwelling water good for fisheries?",
            ["It is warmer than surface water", "It carries nutrients up from the deep for plankton", "It pushes fish toward the coast", "It is fresher, and fish prefer it"],
            1,
            "The rising water is a fertilizer delivery: nutrients return to the sunlit layer, plankton bloom, and the food chain follows."),
        ],
      },
      {
        id: "oc-3", title: "Review and Recall", subtitle: "The whole topic, asked again",
        cards: [
          mkQuiz("In the southern half of the planet, which way does the Coriolis effect bend moving water?",
            ["To the right", "To the left", "Straight down", "It does not bend it at all"],
            1,
            "Left in the south, right in the north: one rotating planet, two mirror image rules."),
          mkQuiz("What is the engine of the deep conveyor?",
            ["Wind dragging on the deep water below, far under the surface", "Cold salty water grows dense and sinks near the poles", "Volcanoes heating the sea floor", "The tides squeezing the basins"],
            1,
            "Density drives the deep flow. Sinking at the poles pulls the whole slow overturning behind it."),
          mkTrueFalse("Each ocean circulates on its own, cut off from the others, with no worldwide conveyor.",
            false,
            "Surface to deep and back over centuries, basin to basin: it is one system, which is why changes at the poles matter worldwide."),
          mkQuiz("Why is western Europe warmer than other places at its latitude?",
            ["It sits closer to the sun", "A warm Atlantic current delivers tropical heat to its coasts", "Its mountains block all cold air forever and keep the warmth in", "The conveyor avoids Europe entirely"],
            1,
            "The current brings the heat; the winds carry the warmed air inland. Latitude alone does not set a climate."),
          mkQuiz("How long does a full trip around the conveyor take, roughly?",
            ["A few days", "A single season", "Centuries", "Exactly one year"],
            2,
            "The overturning is measured in centuries, which is why its changes are slow, vast, and worth watching early."),
        ],
      },
    ] }],
  },
  {
    id: "topic-soil-beneath-us", title: "The Soil Beneath Us", category: "Earth and Climate",
    blurb: "The living world inside soil, and the carbon it holds or releases.",
    units: [{ id: "topic-soil-beneath-us-unit", title: "The whole course", subtitle: "Two teaching lessons, then a review.", lessons: [
      {
        id: "sl-1", title: "A Teaspoon of Wilderness", subtitle: "Soil is alive, crowded, and busy",
        cards: [
          mkNote("The big idea", "Soil is an ecosystem, not a substance",
            "A teaspoon of healthy soil holds billions of microbes, more than there are people on Earth, plus fungal threads, tiny animals, and the roots of plants threading through it all. This community is not decoration. It digests dead matter, recycles nutrients into forms plants can use, and builds the crumbly structure that lets soil hold water and air. Dirt is what soil becomes when the community dies. Nearly all of this life crowds into the dark upper layer, the topsoil, roughly the first hand span below the surface."),
          mkQuiz("What does the soil community do for plants?",
            ["Nothing at all; plants need only sunlight and nothing from the soil", "It recycles nutrients for plants and builds soil structure", "It eats the roots of weak plants only", "It makes the soil heavier and denser"],
            1,
            "The community is the recycling plant and the construction crew: nutrients freed, structure built, water held."),
          mkNote("How it works", "The trade at the root",
            "Plants leak sugars from their roots on purpose, feeding the microbes around them. In return, microbes and fungi deliver what roots struggle to get alone: phosphorus, nitrogen, and water gathered from far beyond the root's reach. Fungal threads are the great traders, connecting roots into networks that move nutrients from where they are plentiful to where they are wanted, with the fungus paid in sugar."),
          mkQuiz("What do plants pay fungi in the root trade?",
            ["Oxygen from the air above", "Sugars leaked from their roots", "Extra leaves dropped in fall", "Nothing at all; fungi work for free and ask nothing"],
            1,
            "Sugar is the currency. Roots feed the network, and the network delivers minerals and water from beyond the roots' reach."),
          mkNote("One more piece", "The carbon vault underfoot",
            "Soil is one of the largest carbon stores on the planet, holding more carbon than the air above it. Most of that carbon is the remains and excretions of the living community, locked into the soil's fabric. This is why soil is a climate subject and not just a farming one: how land is treated decides whether the vault keeps its carbon or releases it."),
          mkTrueFalse("Soil holds more carbon than the atmosphere does.",
            true,
            "The underground vault is bigger than the airborne one. Land care is climate care, whether intended or not."),
        ],
      },
      {
        id: "sl-2", title: "Keeping the Vault Shut", subtitle: "Worms, tilling, and the sponge effect",
        cards: [
          mkNote("The big idea", "Disturbance spends the vault",
            "Plowing and heavy tilling feel like care, but to the soil community they are an earthquake and a fire at once: fungal networks are shredded, burrows collapse, and buried carbon meets the air and burns away as carbon dioxide. Fields tilled hard for decades lose their crumbly structure, hold less water, and wash away faster. The living soil is slow to build and fast to spend."),
          mkQuiz("Why does heavy tilling release soil carbon?",
            ["The plow runs hot from friction alone and burns the carbon out", "It shreds fungal networks and exposes buried carbon to air", "Tilling adds carbon from the tractor", "It does not release carbon in any way"],
            1,
            "Exposure is the key: buried carbon, suddenly aired and stirred, is food for microbes that release it as carbon dioxide."),
          mkNote("How it works", "Worms and the sponge",
            "Earthworms are the soil's engineers: they drag leaves underground, mix the layers, and leave burrows that channel water and air. A soil full of life and roots holds rain like a sponge, releasing it slowly to plants and streams. A dead, compacted soil sheds rain off its surface, flooding quickly and drying just as fast. The sponge is not the mineral; it is the architecture the community builds."),
          mkMatch("Match each word to what it means.",
            [["Microbes", "The billions of tiny organisms living in soil"], ["Fungal network", "Threads that connect roots and trade nutrients for sugar"], ["Topsoil", "The dark, living upper layer where most soil life concentrates"], ["Tilling", "Turning the soil over, which shreds networks and airs buried carbon"]],
            "Microbes run the recycling, fungal networks run the trade, topsoil is where the life concentrates, and tilling is the disturbance that spends it."),
          mkNote("One more piece", "Farming with the community",
            "Farmers who protect soil life tend to share a few habits: keep living roots in the ground as much of the year as possible, disturb the soil less, keep it covered, and rotate what grows there. None of this is nostalgia; it is maintenance of the workforce. The yields that follow are steadier in droughts and floods alike, because the sponge and the traders survive to do their jobs."),
          mkQuiz("Why do fields with living soil handle drought better?",
            ["Living soil attracts rain", "Its spongy structure holds water and releases it slowly to plants", "Microbes drink less water than minerals, so the soil keeps its store", "Drought cannot reach living soil"],
            1,
            "Structure is storage. The architecture the community builds is what turns a downpour into a reserve instead of a runoff."),
        ],
      },
      {
        id: "sl-3", title: "Review and Recall", subtitle: "The whole topic, asked again",
        cards: [
          mkQuiz("About how many microbes live in a teaspoon of healthy soil?",
            ["A few dozen at most", "Thousands, roughly, in every single spoonful", "Billions, more than the people on Earth", "None at all; soil is sterile"],
            2,
            "Billions in a teaspoon. Soil is among the most crowded habitats on the planet."),
          mkQuiz("What do fungal networks get from plant roots, and what do they give?",
            ["They give sugar and get minerals and water in return", "They get sugar and give minerals and water", "Both sides give nothing", "They get water and give leaves"],
            1,
            "Sugar flows down, minerals and water flow up the network. It is a market, run on trade."),
          mkTrueFalse("Dirt and soil are the same thing, technically.",
            false,
            "Soil is the living system; dirt is what remains when the community is gone. The difference is the life, not the location."),
          mkQuiz("Which habit protects soil life on a farm?",
            ["Tilling the soil as often as possible, again and again all year", "Keeping living roots in the ground and disturbing soil less", "Removing all the worms to keep it tidy", "Leaving the fields bare between crops"],
            1,
            "Roots feed the community, cover protects it, and less disturbance lets the networks survive. The workforce stays employed."),
          mkQuiz("What is the sponge in soil, really?",
            ["A layer of actual sponge rock below", "The crumbly architecture the living community builds", "The clay content of the soil alone", "Frozen water held in winter soil"],
            1,
            "Minerals alone shed water. The community's structure, crumbs, burrows, and roots, is what holds it."),
        ],
      },
    ] }],
  },
  {
    id: "topic-forests-and-carbon", title: "Forests and Carbon", category: "Earth and Climate",
    blurb: "What forests do with carbon, and how it is measured.",
    units: [{ id: "topic-forests-and-carbon-unit", title: "The whole course", subtitle: "Two teaching lessons, then a review.", lessons: [
      {
        id: "fo-1", title: "Breathing In, Building Wood", subtitle: "Where a tree's body actually comes from",
        cards: [
          mkNote("The big idea", "A tree is mostly made of air",
            "It feels obvious that a tree grows out of the soil, but weigh the soil before and after and it barely changes. The bulk of a tree's body is carbon taken from the air. Through photosynthesis, leaves pull in carbon dioxide, keep the carbon, and release the oxygen. Trunk, branches, and roots are that kept carbon, stacked year by year into wood. A forest is the sky, stored. The leaves doing this work form the canopy, the forest's sunlit roof, and below it lives the understory, a shaded layer of young trees and shrubs waiting for light."),
          mkQuiz("Where does most of a tree's body come from?",
            ["The soil it stands in", "Carbon pulled from the air by its leaves", "Rainwater soaked through the roots", "Sunlight converted directly into wood by the trunk alone"],
            1,
            "Photosynthesis keeps the carbon and returns the oxygen. The soil supplies water and minerals, but the mass is air."),
          mkNote("How it works", "Growing fast versus storing much",
            "Here is the distinction that decides most arguments about forests and climate. A young, fast growing forest takes in carbon quickly each year but holds little so far. An old forest takes in less extra each year, because its breathing and decay nearly balance its growth, yet it holds an enormous store accumulated over centuries. Cutting the old forest releases the store; planting the young one rebuilds slowly. Rate and total are different virtues."),
          mkQuiz("What is the climate virtue of an old forest, compared with a young one?",
            ["It takes in carbon faster each year than a young forest does", "It holds a larger store of carbon, built over centuries", "It releases no oxygen at all", "It needs no rain to survive"],
            1,
            "Old forests are vaults: slower annual intake, enormous holdings. Young forests are fast savers starting from near zero."),
          mkNote("One more piece", "Half the forest is underground",
            "The visible trees are only part of the store. Roots hold a large share, and the soil beneath a forest holds another, fed by fallen leaves and dead roots for centuries. This is why clearing a forest costs more carbon than the trunks suggest, and why a plantation on drained or dug up soil can take many years just to pay back the carbon its planting disturbed."),
          mkTrueFalse("Most of a tree's mass is carbon pulled from the air by its leaves.",
            true,
            "The soil barely loses weight. The mass is carbon from the air, kept by photosynthesis and stacked into wood."),
        ],
      },
      {
        id: "fo-2", title: "Keeping Carbon in the Trees", subtitle: "Fire, rot, and what protection really means",
        cards: [
          mkNote("The big idea", "Stored carbon has three exits",
            "Carbon in a forest leaves by three doors. Fire sends it back to the air in hours. Rot, by fungi, microbes, and termites, returns it over years as trees die and decay. And harvest moves it into wood products, where it stays stored only as long as the product lasts: centuries in a beam, very briefly in a sheet or a page that is burned or rotted. A forest's climate value is the balance between what it keeps taking in and what leaves by every door."),
          mkQuiz("Which harvest product keeps carbon stored longest?",
            ["A wrapping sheet burned within the year", "A wooden beam in a building for centuries", "Wood chips left to rot in a season", "Sawdust washed into a river"],
            1,
            "Storage lasts as long as the product does. Long lived wood keeps the vault shut; quick rot or burning opens it."),
          mkNote("How it works", "Protection is a time promise",
            "Planting trees is the popular half of forest climate policy, but the math in lesson one gives protection of existing forests the larger near term role: the store is already built, and keeping it is instant, while a seedling's vault takes decades to fill. A planted forest also only counts if it survives, which makes planting a promise about time, not an event. Trees planted and abandoned are a photo, not a vault."),
          mkMatch("Match each word to what it means.",
            [["Photosynthesis", "The leaf process that keeps carbon from the air and releases oxygen"], ["Canopy", "The leafy roof layer where most sunlight is caught"], ["Understory", "The shaded plants living below the canopy"], ["Rot", "The slow return of carbon by fungi, microbes, and termites"]],
            "Photosynthesis does the keeping, the canopy catches the light, the understory lives in its shade, and rot is the slow exit door."),
          mkNote("One more piece", "Forests do more than carbon",
            "A forest is worth more than its vault. Forests cool their surroundings, shelter a large share of the world's land species, hold soil on slopes, and steady the flow of streams. Carbon made forests a climate headline, but protecting them was wise before the headline and stays wise for reasons no single number captures."),
          mkQuiz("Why does protecting an old forest beat planting a new one in the near term?",
            ["Old trees grow faster every year", "The old store is already built; a new vault takes decades", "New forests release carbon forever", "Planting new trees never works at all, in any soil or climate"],
            1,
            "Keeping a filled vault is instant; filling an empty one is slow. Both matter, on different clocks."),
        ],
      },
      {
        id: "fo-3", title: "Review and Recall", subtitle: "The whole topic, asked again",
        cards: [
          mkQuiz("What does a leaf keep from the air during photosynthesis?",
            ["Oxygen from the air around it", "Carbon, which becomes the tree's body", "Nitrogen from the air around it", "Nothing; leaves only release gases"],
            1,
            "Carbon is kept and stacked into wood; oxygen is the part returned to the air."),
          mkQuiz("Besides the trunks, where does a forest keep much of its carbon?",
            ["In the clouds above it", "In roots and in the soil beneath", "In the animals passing through", "Nowhere; trunks hold it all"],
            1,
            "Roots and forest soil hold a large share, which is why clearing costs more than the visible trees suggest."),
          mkTrueFalse("A young, fast growing forest holds more total carbon than an old forest.",
            false,
            "Fast intake, small holdings. The old forest's centuries of accumulation make it the bigger vault."),
          mkQuiz("What are the three exits for carbon stored in a forest?",
            ["Wind, rain, and snow", "Fire, rot, and harvest into products", "Birds, rivers, and roots", "There are no exits; storage is permanent"],
            1,
            "Fire in hours, rot in years, harvest for as long as the product lasts. The balance of in and out is the climate value."),
          mkQuiz("Why is a planted forest only a promise, not yet a vault?",
            ["Seedlings are not real trees yet", "Its store takes decades to fill, and only counts if it survives", "Planted trees cannot photosynthesize until they stand fully grown", "Protection laws forbid counting them at all"],
            1,
            "Time is the ingredient. Planting starts the clock; survival is what makes the vault real."),
        ],
      },
    ] }],
  },
  {
    id: "topic-extreme-weather", title: "Extreme Weather", category: "Earth and Climate",
    blurb: "How scientists pin a storm to a warming world.",
    units: [{ id: "topic-extreme-weather-unit", title: "The whole course", subtitle: "Two teaching lessons, then a review.", lessons: [
      {
        id: "ew-1", title: "A Loaded Sky", subtitle: "What warming does to the ingredients of weather",
        cards: [
          mkNote("The big idea", "Warm air holds more water",
            "The physics here is plain enough to state in one line: for every degree Celsius warmer, air can hold about 7 percent more water vapor. A warmer world therefore loads the sky with more water to drop, so when rain comes it can come harder. The same warming puts more heat into heat waves, making them likelier and longer, and raises sea level, so a storm's flooding starts from a higher floor."),
          mkQuiz("About how much more water vapor can air hold per degree Celsius warmer?",
            ["About 1 percent", "About 7 percent", "About 50 percent", "Twice as much per degree"],
            1,
            "Roughly 7 percent per degree. It is steady physics, and it is why downpours have more to work with in a warmer world."),
          mkNote("How it works", "Loaded dice, not scripted storms",
            "No single storm is caused by climate change in the way a match causes a fire; storms have always happened. The honest image is loaded dice. Warming changes the odds: the heaviest rain events and hottest days come up more often than they used to. A particular flood is weather; the rising frequency of such floods across decades is climate showing through the weather."),
          mkQuiz("What does the loaded dice image mean?",
            ["Every storm is scripted in advance", "Warming changes the odds, so extremes come up more often", "Dice control the climate completely", "Extremes are becoming less likely now than they used to be"],
            1,
            "Odds, not scripts. One throw proves nothing about the dice; a long run of throws does."),
          mkNote("One more piece", "Not every extreme moves the same way",
            "Warming does not simply turn every dial toward worse. Cold snaps become rarer in most places. Some regions dry while others flood harder. Snowfall can even increase where air stays cold enough but now carries more moisture. The pattern is specific, not uniform, which is why honest accounts name the event and the region instead of declaring that weather in general is worse."),
          mkTrueFalse("A single storm, by itself, proves the climate is changing.",
            false,
            "One storm is weather. Climate is the rising frequency of such storms across decades, and warming loads the dice: it changes the odds, it does not sign any single event."),
        ],
      },
      {
        id: "ew-2", title: "Pinning a Number On It", subtitle: "Attribution: comparing two worlds",
        cards: [
          mkNote("The big idea", "Run the world twice",
            "Attribution science asks a precise question: how much more likely, or how much stronger, did warming make this event? The method is comparison. Scientists model the world as it is, with today's warmed atmosphere, and a counterfactual world without human driven warming, then run the same event's weather through both, many times. The difference between the two worlds is the fingerprint of climate change on that event."),
          mkQuiz("What two worlds does attribution science compare?",
            ["The northern world and the southern world, compared side by side", "Today's warmed world and one modeled without human warming", "The world of last year and this year", "Land and ocean, side by side"],
            1,
            "Same weather, two climates. The gap between the runs is the measured contribution of warming to the event."),
          mkNote("How it works", "Fractions, not verdicts",
            "The answer comes out as a fraction or a multiplier, never as a slogan. A heat wave might be reported as made several times more likely, a rainfall total as made some percent heavier. Some events show a strong fingerprint; others, like certain droughts, show a muddy one, and honest reporting says so. The method's credibility comes from refusing to claim more than the comparison shows."),
          mkMatch("Match each word to what it means.",
            [["Attribution", "Measuring how much warming changed an event's odds or strength"], ["Water vapor", "The invisible water gas air can hold, about 7 percent more per degree"], ["Heat wave", "A run of unusually hot days, made likelier and longer by warming"], ["Pattern", "The trend across many events and years, where climate shows"]],
            "Attribution measures the fingerprint on one event; the pattern across events is where certainty lives."),
          mkNote("One more piece", "Why the numbers matter",
            "These fractions have jobs to do outside science. City planners sizing drains, farmers choosing crops, and courts and insurers weighing responsibility all need to know whether an extreme was bad luck or a shifted baseline. Attribution turns the argument from impressions into arithmetic, which is the only kind of argument that can settle budgets."),
          mkQuiz("Why do attribution answers come out as fractions and multipliers?",
            ["Scientists are indecisive by habit alone and prefer vague answers", "Warming changes the odds, so the honest answer is comparative", "The models cannot do better in principle", "Fractions are required by law here"],
            1,
            "The question itself is comparative: how much likelier, how much heavier. The answer inherits that shape."),
        ],
      },
      {
        id: "ew-3", title: "Review and Recall", subtitle: "The whole topic, asked again",
        cards: [
          mkQuiz("Why can downpours be heavier in a warmer world?",
            ["Warm air holds more water vapor, so there is more water to drop", "Gravity increases as temperature rises", "Clouds are made of warmer ice chunks", "Rain ignores physics whenever it is hot, falling up as often as down"],
            0,
            "Capacity is the mechanism: about 7 percent more vapor per degree means storms draw on a fuller sky."),
          mkQuiz("What does a higher sea level do to a storm's flooding?",
            ["Nothing; floods start from the same floor", "It raises the floor floods start from, so storms flood more", "It absorbs the storm surge completely, cancelling every flood", "It only matters for tsunamis at sea"],
            1,
            "The storm adds its water on top of the sea that is already there. A higher base means higher water everywhere the storm reaches."),
          mkTrueFalse("Attribution science can say warming made a specific heat wave several times more likely.",
            true,
            "That comparative statement is exactly what the two world method produces: odds in the warmed world against odds in the unwarned one."),
          mkQuiz("Where does proof of a changing climate live?",
            ["In the single worst storm anyone remembers", "In patterns across many events and many years", "In one hot summer in one city", "In photographs of floods"],
            1,
            "Events are weather; patterns are climate. Attribution links the two without confusing them."),
          mkQuiz("Which extreme becomes rarer in most places as the world warms?",
            ["Heat waves", "The heaviest downpours", "Cold snaps", "Sea level flooding"],
            2,
            "Not every dial turns the same way. Cold extremes retreat in most regions even as heat and heavy rain advance."),
        ],
      },
    ] }],
  },
  {
    id: "topic-black-holes", title: "Black Holes", category: "Space and Physics",
    blurb: "Black holes and the edge where the known rules stop working.",
    units: [{ id: "topic-black-holes-unit", title: "The whole course", subtitle: "Two teaching lessons, then a review.", lessons: [
      {
        id: "bh-1", title: "The Point of No Return", subtitle: "What a black hole actually is",
        cards: [
          mkNote("The big idea", "Gravity so strong that light cannot leave",
            "A black hole is a region where so much mass is packed so tightly that gravity defeats everything, including light. Its boundary is called the event horizon: cross it, and every path leads inward, so nothing that enters can ever send news back out. The hole itself is not a hole in anything, and it is not a cosmic vacuum cleaner; at a distance, its gravity pulls exactly like any object of the same mass."),
          mkQuiz("What is the event horizon?",
            ["The visible surface of a black hole, shining in the dark", "The boundary past which nothing can return", "A ring of fire around the hole", "The center of the black hole"],
            1,
            "The horizon is the point of no return. Inside it, all futures point inward, which is why the interior is unknowable from outside."),
          mkNote("How it works", "The glowing ring is dinner, not the hole",
            "Black holes are black, yet the sky shows bright rings around the famous ones. That light comes from gas falling in. As gas spirals toward the horizon it is squeezed and heated until it glows fiercely, outshining galaxies, in the last moments before it crosses. The dark shadow inside the ring is the hole's silhouette: the region light cannot escape from, outlined by the glowing food around it."),
          mkQuiz("Why do photographs of black holes show a bright ring?",
            ["The hole itself glows from inside", "Gas spiraling in is heated until it glows, outlining the dark region within", "Telescopes add the ring for clarity", "Starlight behind the hole bends into a circle by chance, and the ring is a trick of the light"],
            1,
            "The ring is the meal, glowing on the way down. The darkness inside its outline is the hole."),
          mkNote("One more piece", "Born when a giant star collapses",
            "Most black holes begin as the cores of enormous stars. A star holds itself up by burning; when the fuel runs out, the core can collapse under its own gravity, past every stopping point physics offers, into a black hole a few times the mass of our Sun. Larger ones grow later, by swallowing gas and merging with each other over cosmic time. At the center of the collapse sits the singularity, the point where the known rules stop working."),
          mkTrueFalse("From far away, a black hole pulls harder than any other object of the same mass.",
            false,
            "At a distance, a black hole's gravity is just the gravity of its mass: swap the Sun for a black hole of the same mass and Earth keeps the same orbit. The hole is only extreme close up, where all that mass is packed into so small a space."),
        ],
      },
      {
        id: "bh-2", title: "Giants and Slow Clocks", subtitle: "The monsters at galaxy centers, and time near the edge",
        cards: [
          mkNote("The big idea", "Every big galaxy hides a giant",
            "At the center of nearly every large galaxy, including our own Milky Way, sits a supermassive black hole: millions to billions of times the mass of the Sun, gathered into a region small by galactic standards. Stars near our galaxy's center whip around an invisible point at enormous speeds, and their orbits let astronomers weigh the giant precisely: about four million Suns, in a space smaller than a solar system."),
          mkQuiz("How do astronomers know the Milky Way's center holds about four million Suns of mass?",
            ["They counted the stars in the galaxy", "Stars near the center orbit an invisible point, and their orbits give its mass", "The center glows with four million Suns of light, shining plainly across the galaxy", "Probes have visited the center"],
            1,
            "Orbits are scales. Fast stars circling nothing visible reveal the mass that must be pulling them."),
          mkNote("How it works", "Clocks run slow near the edge",
            "Gravity bends time as well as space. A clock carried close to a black hole ticks more slowly than one far away, an effect measured with ordinary clocks around Earth in weaker form. Near the horizon the slowing becomes extreme: to a watcher far away, anything falling in appears to freeze at the edge and fade, while the falling traveler, on their own clock, crosses in ordinary time. Both descriptions are correct; that is the strangeness the theory insists on."),
          mkMatch("Match each word to what it means.",
            [["Event horizon", "The boundary past which nothing can return"], ["Accretion glow", "The fierce light of gas heated as it spirals in"], ["Supermassive", "A black hole of millions to billions of Suns, at a galaxy's center"], ["Singularity", "The center, where the known rules stop working"]],
            "The horizon bounds it, infalling gas advertises it, the giants anchor galaxies, and the singularity is where physics runs out."),
          mkNote("One more piece", "The center is where the map ends",
            "Inside the horizon, the equations point to a singularity, a place where density rises without limit and the theory that predicted it stops working. Physicists read that failure honestly: not as a description of nature, but as a sign that a deeper theory, marrying gravity with quantum rules, is still missing. The black hole is the signpost at the edge of the map: here the known rules end."),
          mkQuiz("What does the singularity tell physicists?",
            ["Exactly what the center looks like", "That the current theory has reached its limit and a deeper one is missing", "That black holes are impossible", "That nothing exists inside the horizon at all, and the whole hole is hollow"],
            1,
            "A prediction of infinity is a theory confessing its edge. The singularity is a signpost, not a description."),
        ],
      },
      {
        id: "bh-3", title: "Review and Recall", subtitle: "The whole topic, asked again",
        cards: [
          mkQuiz("Why is a black hole black?",
            ["It absorbs paint like a pigment and turns black with age", "Its gravity is so strong that light cannot escape", "It is always sitting in shadow", "It is made of cold dark gas"],
            1,
            "Light is the messenger, and inside the horizon every path leads inward. No messenger leaves."),
          mkQuiz("How are most black holes born?",
            ["When two planets collide head on", "When the core of a huge star collapses, out of fuel", "When galaxies merge directly together and their centers collide", "They have all existed since forever"],
            1,
            "Stellar collapse is the common birth: burning stops, support fails, and gravity wins all the way down."),
          mkTrueFalse("A black hole's bright ring in photographs is gas outside the horizon, glowing as it falls.",
            true,
            "Nothing escapes from inside. The ring is gas outside the horizon, glowing as it falls, outlining the darkness within."),
          mkQuiz("What happens to a clock near a black hole, compared with one far away?",
            ["It ticks faster", "It ticks more slowly", "It stops being affected by gravity", "It runs backwards"],
            1,
            "Gravity slows time. The effect is real around Earth in small measure and extreme near a horizon."),
          mkQuiz("Where do supermassive black holes live?",
            ["Only in empty space between galaxies", "At the centers of nearly every large galaxy", "Inside the largest stars", "Nowhere confirmed yet"],
            1,
            "Our own galaxy included: about four million Suns of mass, weighed by the stars orbiting it."),
        ],
      },
    ] }],
  },
  {
    id: "topic-shape-of-spacetime", title: "The Shape of Spacetime", category: "Space and Physics",
    blurb: "Gravity as geometry, and the tests that checked it.",
    units: [{ id: "topic-shape-of-spacetime-unit", title: "The whole course", subtitle: "Two teaching lessons, then a review.", lessons: [
      {
        id: "st-1", title: "Gravity Is a Shape", subtitle: "The idea that replaced the force",
        cards: [
          mkNote("The big idea", "Mass bends the stage itself",
            "The older picture said gravity is a force pulling objects together. General relativity replaced it with geometry. Space and time form a single fabric called spacetime, and mass and energy bend that fabric. Objects then move along the bends. A planet orbiting the Sun is not being yanked by a rope; it is following the curve the Sun's mass makes in spacetime, the way a ball rolls around the dip in a trampoline."),
          mkQuiz("In general relativity, why does Earth orbit the Sun?",
            ["A force from the Sun pulls it in a circle, year after year", "It follows the curve the Sun's mass makes in spacetime", "It is pushed by light from the Sun", "It is falling forever and missing by luck"],
            1,
            "Orbit is geometry: the planet travels the straightest path available through bent spacetime, and the bent path is a circle."),
          mkNote("How it works", "Light bends too",
            "If the fabric is bent, everything traveling through it follows the bend, including light, which has no mass to pull on. Starlight passing near the Sun deflects measurably, and a massive galaxy can bend the light of things behind it into arcs and rings, acting as a lens. This gravitational lensing is now a working tool: the bending betrays mass we cannot see, including the dark matter holding galaxies together."),
          mkQuiz("What does gravitational lensing let astronomers do?",
            ["See around corners in a laboratory with curved mirrors", "Detect unseen mass by how it bends light", "Photograph the past directly", "Slow light down for study"],
            1,
            "Light bending is a measurement: the size of the bend reports the mass doing it, seen or unseen."),
          mkNote("One more piece", "Mercury's small rebellion",
            "For decades, Mercury's orbit refused to match the old force theory exactly: its oval path rotated slightly more than every known planet's pull could explain. General relativity predicted the extra rotation precisely, from the Sun's bending of spacetime near itself. A discrepancy too small to see without telescopes and patience became one of the new theory's first triumphs."),
          mkTrueFalse("Light travels through bent spacetime in a perfectly straight line, unaffected.",
            false,
            "Light follows the fabric like everything else. Its bending near the Sun was an early, measured confirmation of the theory."),
        ],
      },
      {
        id: "st-2", title: "Time Is Part of the Fabric", subtitle: "Slow clocks, satellite corrections, and ripples",
        cards: [
          mkNote("The big idea", "Gravity slows time itself",
            "Because time is woven into the fabric, bending the fabric bends time. Clocks deeper in gravity tick slower than clocks higher up: a clock in a basement ages, very slightly, less than one in an attic. The effect is tiny on Earth and enormous near black holes, but it is not theoretical at any size. It has been measured with precision clocks at different heights, and engineering has to live with it daily."),
          mkQuiz("Where does a clock tick slowest?",
            ["At the top of a mountain", "Deeper in gravity, down in a basement", "Wherever the air is coldest", "Time is the same everywhere"],
            1,
            "Deeper in the bend, slower the tick. Height is a time machine setting, even on Earth, by amounts precision clocks can catch."),
          mkNote("How it works", "Satellites must correct for bent time",
            "Navigation satellites carry clocks high above Earth, where gravity is weaker and their clocks run slightly fast, while their speed makes them run slightly slow. Both effects are relativity, and both are corrected for in the system's design. Leave the corrections out and the positions it computes would drift wrong by kilometers each day. Few theories of the universe are also load bearing parts of a phone's map, but this one is."),
          mkMatch("Match each word to what it means.",
            [["Spacetime", "The single fabric woven from space and time"], ["Curve", "The bend mass makes, which moving things then follow"], ["Lensing", "Light bent by mass into arcs, betraying the mass"], ["Gravitational wave", "A ripple in spacetime from a violent cosmic event"]],
            "Spacetime is the fabric, mass curves it, lensing reads the curves by light, and gravitational waves are ripples traveling through it."),
          mkNote("One more piece", "Ripples in the fabric",
            "When massive things collide, a pair of black holes spiraling together, for instance, the fabric itself rings like a struck bell, sending ripples of stretching and squeezing across the universe at the speed of light. Detectors have caught these gravitational waves by measuring changes in distance smaller than the width of an atom's core. The ripples confirm the fabric picture in its most dramatic form: spacetime is not a stage. It moves."),
          mkQuiz("What do gravitational waves prove about spacetime?",
            ["That it is perfectly rigid throughout and never moves at all", "It is a real fabric that can ripple and carry energy", "That light can outrun gravity itself", "That black holes never merge at all"],
            1,
            "A stage cannot ring. Detecting the ripples from colliding black holes shows the fabric itself is a physical player."),
        ],
      },
      {
        id: "st-3", title: "Review and Recall", subtitle: "The whole topic, asked again",
        cards: [
          mkQuiz("What bends spacetime?",
            ["Only black holes", "Mass and energy", "Light alone", "Nothing; spacetime is fixed"],
            1,
            "Every mass and every energy bends the fabric a little; big masses bend it a lot. Motion then follows the bends."),
          mkQuiz("Which planet's orbit gave an early triumph to the theory?",
            ["Venus", "Mercury", "Mars", "Jupiter"],
            1,
            "Mercury's extra rotation matched the new geometry exactly, after decades of resisting every other explanation."),
          mkTrueFalse("Navigation satellites drift wrong by kilometers every day unless relativity corrections are applied.",
            true,
            "Their clocks gain and lose time by relativity every day, and uncorrected positions would drift wrong by kilometers daily."),
          mkQuiz("Why can a galaxy act as a lens?",
            ["Its stars reflect light like mirrors", "Its mass bends the fabric, and light follows the bend", "It emits its own focused beam of light like a searchlight", "It magnifies things by its size alone"],
            1,
            "Lensing is geometry in action: the bend, not the galaxy's glow, does the magnifying, and it reports unseen mass."),
          mkQuiz("At what speed do gravitational waves travel?",
            ["Instantly, with no travel time", "The speed of light", "The speed of sound in space", "They do not travel; they are static"],
            1,
            "The ripples move at light speed, carrying news of collisions that light from the event may never show us."),
        ],
      },
    ] }],
  },
  {
    id: "topic-quantum-machines", title: "Quantum Machines", category: "Space and Physics",
    blurb: "How quantum computers work, and the errors they have to outrun.",
    units: [{ id: "topic-quantum-machines-unit", title: "The whole course", subtitle: "Two teaching lessons, then a review.", lessons: [
      {
        id: "qm-1", title: "Bits That Can Be Both", subtitle: "Qubits, superposition, and entanglement",
        cards: [
          mkNote("The big idea", "A qubit is not just a faster bit",
            "An ordinary bit is a switch: 0 or 1. A quantum bit, a qubit, can sit in a blend of both states at once, a property called superposition. A row of qubits can therefore stand for a vast landscape of combinations simultaneously. A quantum computer does not simply run faster; it works on the whole landscape at once, for the right kinds of problems, in a way no ordinary machine can imitate step for step."),
          mkQuiz("What makes a qubit different from an ordinary bit?",
            ["It stores numbers in a smaller space", "It can sit in a blend of 0 and 1 at once", "It never makes errors of any kind", "It works without electricity"],
            1,
            "Superposition is the difference: the bit is either, the qubit is a blend, and blends of many qubits cover whole landscapes of combinations."),
          mkNote("How it works", "Linked fates: entanglement",
            "Qubits can also be entangled: prepared so their states are linked, such that measuring one settles something about the other, instantly, however far apart they are. Nothing travels between them; the link is in how they were prepared, like a pair of gloves separated into two boxes, except richer, because the gloves are not secretly left or right all along. Entanglement is the second ingredient, letting a machine coordinate its landscape of states in ways ordinary bits cannot."),
          mkQuiz("What does entanglement link between two qubits?",
            ["Their physical positions in space and their distance apart", "Their states, so measuring one speaks of the other", "Their temperatures while running", "Their owners, by strict law"],
            1,
            "The link is statistical and real: the pair behaves as one system, which is what the machine exploits."),
          mkNote("One more piece", "Reading the answer destroys the blend",
            "There is a catch at the heart of it all. Measure a qubit and the blend collapses to a plain 0 or 1; you can never peek at the landscape directly. Quantum programming is therefore the art of arranging interference: choreographing the blends so that wrong answers cancel each other out and right answers reinforce, leaving the correct result likely to be what the final measurement finds."),
          mkTrueFalse("Reading out a qubit collapses its blend to one plain answer.",
            true,
            "Measurement collapses the blend to one plain answer. The machine's craft is arranging things so the answer you get is the one you wanted."),
        ],
      },
      {
        id: "qm-2", title: "The Error Problem", subtitle: "Fragile states and the fight to protect them",
        cards: [
          mkNote("The big idea", "Qubits forget, constantly",
            "The blend that makes a qubit powerful makes it fragile. Heat, stray fields, vibration, a single wandering particle: any nudge from the environment can collapse or scramble the state, an event called decoherence. Useful quantum machines must therefore run their calculations faster than their qubits forget, inside some of the coldest, quietest, most shielded environments ever built."),
          mkQuiz("What is decoherence?",
            ["The machine warming up to working temperature after a cold start", "A qubit's state scrambling from nudges in its environment", "A programming language for quantum machines", "The moment a calculation finishes up"],
            1,
            "Decoherence is forgetting by disturbance. Shielding and speed are the defenses, and they are never perfect."),
          mkNote("How it works", "Correction by committee",
            "Quantum error correction protects one precious logical qubit by spreading its state across many physical qubits, arranged so that errors can be detected and repaired without anyone measuring, and collapsing, the protected state itself. The overhead is brutal: a single trustworthy logical qubit can require hundreds or thousands of physical ones. Much of the field's progress is measured in that exchange rate improving."),
          mkMatch("Match each word to what it means.",
            [["Qubit", "A quantum bit that can blend 0 and 1"], ["Superposition", "The blend of states a qubit can hold at once"], ["Entanglement", "Linked states across qubits, so one measurement speaks of the other"], ["Decoherence", "The scrambling of a quantum state by its environment"]],
            "Qubits blend, superposition is the blend, entanglement links them, and decoherence is the forgetting all of it fights."),
          mkNote("One more piece", "What they will and will not do",
            "Quantum computers are not general speedups. They shine on problems whose structure matches their landscape trick: simulating molecules and materials, where nature itself is quantum, and certain mathematical problems with special patterns. For ordinary computing, email, games, spreadsheets, the machine on your desk stays better. The quantum machine is a specialist instrument, not a replacement appliance."),
          mkQuiz("Where do quantum computers shine most naturally?",
            ["Word processing and documents", "Simulating molecules, where nature itself is quantum", "Playing videos at higher speed", "Replacing every ordinary computer soon, in homes and offices"],
            1,
            "Simulating quantum things with quantum hardware is the home fixture. Everything else is at best an away game."),
        ],
      },
      {
        id: "qm-3", title: "Review and Recall", subtitle: "The whole topic, asked again",
        cards: [
          mkQuiz("What happens when you measure a qubit in superposition?",
            ["You see both values printed side by side", "The blend collapses to a plain 0 or 1", "The qubit doubles", "Nothing; measurement is free of effects"],
            1,
            "Collapse is the price of reading. Quantum algorithms are choreography around that price."),
          mkQuiz("Why spread one logical qubit across many physical ones?",
            ["To make the machine look much bigger", "So errors can be repaired without collapsing the state", "Physical qubits are free and unlimited, so use as many as you like", "To slow the calculation down safely"],
            1,
            "Redundancy with a twist: the committee can detect a member's error without ever asking what the protected answer is."),
          mkTrueFalse("Quantum computers will soon replace ordinary computers for everyday tasks.",
            false,
            "They are specialists. Ordinary computing stays ordinary, and better at being ordinary."),
          mkQuiz("Which ingredient lets qubits behave as one coordinated system?",
            ["Superposition all by itself", "Entanglement, linking their states", "Very cold temperatures", "Careful measurement"],
            1,
            "Entanglement is the coordination: the linked states make the whole more than a row of separate blends."),
          mkQuiz("Why are quantum machines kept in extreme cold and shielding?",
            ["Cold makes electrons move faster", "To slow decoherence, the scrambling of fragile states", "The materials only exist in winter", "For dramatic effect in photos"],
            1,
            "Quiet and cold buy time: the calculation must finish before the environment scrambles it."),
        ],
      },
    ] }],
  },
  {
    id: "topic-worlds-around-other-stars", title: "Worlds Around Other Stars", category: "Space and Physics",
    blurb: "Reading the air of planets we will never touch.",
    units: [{ id: "topic-worlds-around-other-stars-unit", title: "The whole course", subtitle: "Two teaching lessons, then a review.", lessons: [
      {
        id: "xo-1", title: "Catching What You Cannot See", subtitle: "Dimming stars and wobbling stars",
        cards: [
          mkNote("The big idea", "Planets are found by their effects on stars",
            "A planet beside its star is like a firefly beside a lighthouse: the glare swamps the glow. So most exoplanets, planets around other stars, are found indirectly. In the transit method, astronomers watch a star for a tiny, regular dip in brightness, the shadow of a planet crossing its face. In the wobble method, they watch the star's light shift rhythmically as an orbiting planet's gravity tugs the star around a small circle. Thousands of planets are now known."),
          mkQuiz("What does the transit method detect?",
            ["A planet's own light, seen directly through the telescope", "A tiny regular dip in brightness as a planet crosses", "A star slowly growing larger", "Planets colliding with stars"],
            1,
            "The dip is the planet's shadow signature: depth gives the planet's size, timing gives its year."),
          mkNote("How it works", "Each method reads a different fact",
            "The transit tells you the planet's size and how long its year is, but not its mass. The wobble tells you a minimum mass and the year, but not the size. Catch the same planet both ways and you get size and mass together, and from those, density: the difference between a ball of rock, a ball of gas, and something in between. Astronomy assembles planets the way detectives assemble suspects: no single witness knows everything."),
          mkQuiz("A planet caught by both the transit and the wobble methods gives you what?",
            ["Its color and nothing else at all", "Size and mass together, and from those its density", "Its weather forecast for the year", "Proof of life on its surface"],
            1,
            "Transit gives size, wobble gives mass, and the pair together give density, the first real character sketch of a world."),
          mkNote("One more piece", "Most found worlds are not like home",
            "The catalog so far is gloriously strange: gas giants hugging their stars in days, puffy planets with the density of foam, worlds with years lasting a few hours. This is partly real variety and partly selection: big planets close to their stars are easiest to detect, so they dominate the list. Earth sized worlds in year long orbits are the hardest to catch, which is a fact about our instruments, not about the universe's preferences."),
          mkTrueFalse("The thousands of known exoplanets were mostly photographed directly.",
            false,
            "Nearly all were caught indirectly, by transits and wobbles. Direct photographs exist for a few large, young, distant planets only."),
        ],
      },
      {
        id: "xo-2", title: "Reading the Air", subtitle: "Habitable zones and the fingerprints of gases",
        cards: [
          mkNote("The big idea", "The habitable zone is a distance, not a promise",
            "Around every star lies a band where a rocky planet could hold liquid water on its surface: not so close that the water boils away, not so far that it freezes solid. This habitable zone is the first filter in the search for life, and only a filter. A planet in the zone can still be airless, scorched by flares, or locked in extremes. Location is the beginning of the inquiry, not its conclusion."),
          mkQuiz("What does being in the habitable zone guarantee?",
            ["Life definitely exists there", "Liquid water on the surface is possible, nothing more", "A breathable atmosphere for humans", "An exactly Earth sized planet"],
            1,
            "The zone is a possibility condition. Air, water actually present, and a stable climate all still have to be earned separately."),
          mkNote("How it works", "Starlight through air leaves fingerprints",
            "During a transit, a sliver of the star's light passes through the planet's atmosphere on its way to us. Gases in that air absorb particular colors, so the light arrives with a barcode of missing colors, and the barcode names the gases: water vapor, carbon dioxide, methane, and others have been read this way. It is chemistry performed across light years, on air belonging to a world no one will ever visit."),
          mkMatch("Match each word to what it means.",
            [["Transit", "A planet crossing its star, dipping the star's light"], ["Wobble", "A star's rhythmic shift as a planet's gravity tugs it"], ["Habitable zone", "The band where liquid surface water is possible"], ["Barcode", "The pattern of missing colors that names gases in an atmosphere"]],
            "Transits and wobbles find and weigh the worlds; the zone filters them; the barcode reads their air."),
          mkNote("One more piece", "What would count as a hint of life",
            "No single gas is proof. Oxygen alone can be made without life, and methane alone likewise. But certain combinations are hard to explain without something living maintaining them, gases that should destroy each other, persisting together because life keeps remaking them. Results like that would be a strong hint, announced carefully, and argued about for years, which is exactly how a claim that large should be handled."),
          mkQuiz("Why would oxygen and methane found together be a strong hint of life?",
            ["Both are rare gases anywhere at all", "They destroy each other, so something must keep remaking them", "Only humans can produce these gases", "They glow visibly from Earth at night and shine through telescopes"],
            1,
            "A mixture that chemistry keeps erasing, yet endures, needs a maintainer. Life is the leading candidate for that job."),
        ],
      },
      {
        id: "xo-3", title: "Review and Recall", subtitle: "The whole topic, asked again",
        cards: [
          mkQuiz("What does the depth of a transit dip tell you?",
            ["The planet's temperature in space", "Roughly the planet's size, from blocked starlight", "The planet's mass, read directly", "Whether the planet harbors life"],
            1,
            "Blocked light is area: the deeper the dip against the star's face, the bigger the planet's silhouette."),
          mkQuiz("Why do big, close in planets dominate the list of discoveries?",
            ["They are the only kind that exist", "They are easiest to detect, so selection stacks the list", "Small planets avoid our telescopes", "Close planets are simply older"],
            1,
            "The catalog reflects our instruments. Earth like worlds in long orbits are the hardest catch, not necessarily the rarest prey."),
          mkTrueFalse("A rocky planet in the habitable zone may have liquid water on its surface if its air and pressure allow.",
            true,
            "The zone makes water possible; air, pressure, and history decide whether it is there. A filter is not a conclusion."),
          mkQuiz("How are gases in a distant planet's air identified?",
            ["By landing probes inside its air", "By the barcode of missing colors left in starlight", "By the planet's color in photographs", "By listening for chemical sounds"],
            1,
            "Absorption fingerprints survive the trip across light years. The missing colors name the gases."),
          mkQuiz("What does density, from size and mass together, reveal?",
            ["The planet's age, exactly known", "Whether the world is mostly rock, gas, or between", "The color of its sky above", "Its distance from us here"],
            1,
            "Density is the character sketch: rock is dense, gas is not, and the number sorts the strange catalog into kinds."),
        ],
      },
    ] }],
  },
  {
    id: "topic-insect-gut", title: "The Insect Gut", category: "The Living World",
    blurb: "The microbes inside insect guts, and the chemistry they do there.",
    units: [{ id: "topic-insect-gut-unit", title: "The whole course", subtitle: "Two teaching lessons, then a review.", lessons: [
      {
        id: "ig-1", title: "A Gut Full of Helpers", subtitle: "Why insects outsource their digestion",
        cards: [
          mkNote("The big idea", "Insects eat what they cannot digest alone",
            "Some of the toughest food on Earth, wood, dry leaves, plant fiber, is eaten by insects that cannot chemically unlock it by themselves. Their solution is partnership. The insect gut is a tube of different chambers, each with its own acidity and chemistry, and it is full of microbes: bacteria and other tiny residents that do the unlocking. The insect provides the home and the harvest; the microbes provide the chemistry."),
          mkQuiz("Why do so many plant eating insects depend on gut microbes?",
            ["Microbes make insects fly much better", "Microbes unlock tough fiber the insect cannot digest alone", "Insects have no gut of their own", "Microbes replace the need to eat at all, feeding the insect directly"],
            1,
            "Partnership is division of labor: housing and harvesting from the insect, chemistry from the residents."),
          mkNote("How it works", "Termites and the wood problem",
            "Wood's strength is a sugar polymer called cellulose, laced with tougher material, and almost no animal makes the enzymes to dismantle it unaided. Termites run colonies on wood because their guts are fermenting chambers: microbes inside break cellulose down into small molecules the termite can absorb, and the termite in turn feeds and shelters the microbes. Kill the partners with the wrong treatment and the termite starves in a house made of food."),
          mkQuiz("What do termite gut microbes do with cellulose?",
            ["Store it unchanged for winter", "Break it into small molecules the termite can absorb", "Turn it into wood again", "Use it to build their own houses outside"],
            1,
            "Fermentation is the unlock: big indigestible chains become small absorbable pieces, and the termite lives on the change."),
          mkNote("One more piece", "More than digestion",
            "Gut microbes earn their keep beyond the menu. They make vitamins the insect's food lacks. They crowd out and poison invading germs, acting as a first immune system. They can even change what the insect prefers to eat and how it behaves. An insect and its gut community are better read as one combined organism than as an animal with passengers."),
          mkTrueFalse("Gut microbes unlock the tough fiber that a plant eating insect cannot digest alone.",
            true,
            "They also make vitamins, crowd out invading germs, and change what the insect prefers to eat and how it behaves. The partnership runs through the insect's whole life, far beyond the menu."),
        ],
      },
      {
        id: "ig-2", title: "Where the Partners Come From", subtitle: "Inheritance, the neighborhood, and the black soldier fly",
        cards: [
          mkNote("The big idea", "Partners are inherited, gathered, and shared",
            "A young insect does not hatch with a finished gut community. Some microbes arrive on or in the egg from the mother, a direct inheritance. Others are gathered from food, soil, and nestmates; social insects pass microbes mouth to mouth and through shared droppings, which is less charming and more important than it sounds. Disrupt the passing, with sterile food or isolation, and the gut community, and the insect, come out poorer."),
          mkQuiz("How do young social insects get their gut microbes?",
            ["They make them from scratch in the gut, inventing each kind anew", "From the egg, from food and soil, and shared by nestmates", "Only from flowers they visit", "They never need them until adulthood"],
            1,
            "Inheritance plus gathering plus sharing: the community is a culture, passed down and topped up."),
          mkNote("How it works", "The larva that eats the world's leftovers",
            "Black soldier fly larvae are the gut partnership put to work. The larvae eat decaying matter, manure, food scraps, and other waste streams, and their gut microbes help convert that difficult diet into larval body mass rich in protein and fat. The larvae are then harvested as feed for animals like fish and poultry. One insect's gut community becomes a recycling plant, turning what nobody wants into what everybody needs."),
          mkMatch("Match each word to what it means.",
            [["Cellulose", "The tough sugar polymer that gives wood and fiber their strength"], ["Fermentation", "Microbes breaking big molecules down into absorbable pieces"], ["Gut community", "The full set of microbes living in an insect's gut"], ["Larva", "The young, feeding stage of an insect like the black soldier fly"]],
            "Cellulose is the locked food, fermentation is the key, the gut community holds the keys, and larvae are where the eating happens."),
          mkNote("One more piece", "Fragile partnerships",
            "Because the partnership is alive, it can be broken. Antibiotics and some pesticides damage gut communities along with their targets, and insects raised too cleanly can grow up with impoverished guts and weaker health. The lesson repeats across this whole field of science: the microbes are not contamination to be eliminated. They are half the organism."),
          mkQuiz("Why can antibiotics harm an insect that has no infection?",
            ["Antibiotics are insect poison by design", "They damage the gut community the insect depends on", "They sweeten the gut and attract predators", "They cannot harm insects at all"],
            1,
            "The medicine does not distinguish partner from pest. Break the community and the insect loses chemistry it cannot replace alone."),
        ],
      },
      {
        id: "ig-3", title: "Review and Recall", subtitle: "The whole topic, asked again",
        cards: [
          mkQuiz("What does the insect provide in the gut partnership, and what do the microbes provide?",
            ["The insect provides chemistry; the microbes provide housing and food as well", "The insect provides home and harvest; the microbes provide the chemistry", "Both sides provide only food", "The microbes provide everything"],
            1,
            "Housing and harvesting one way, unlocking chemistry the other. Neither side eats wood alone."),
          mkQuiz("What do black soldier fly larvae turn into protein and fat, with their gut microbes' help?",
            ["Only fresh leaves and stems", "Decaying matter, manure, and food scraps", "Plastic waste of all kinds", "Other insects exclusively"],
            1,
            "Waste streams in, feed out. The larva is a recycling plant built around a gut community."),
          mkTrueFalse("A young insect always hatches with its full adult gut community already installed.",
            false,
            "Some microbes are inherited on the egg, but much of the community is gathered and shared after hatching."),
          mkQuiz("Besides digestion, name a job gut microbes do for their insect.",
            ["They build the wings", "They make vitamins and crowd out invading germs", "They see for the insect at night", "They replace the brain"],
            1,
            "Nutrition and defense both run through the gut. The community is closer to an organ than to a passenger list."),
          mkQuiz("What is cellulose, and why does it matter here?",
            ["A vitamin insects must eat daily", "The tough polymer in wood and fiber that microbes unlock", "A poison found in all plants", "The hard material of insect shells"],
            1,
            "Cellulose is the locked pantry of the plant world. Gut microbes hold the keys, and whole insect empires run on that fact."),
        ],
      },
    ] }],
  },
  {
    id: "topic-fermentation", title: "Fermentation", category: "The Living World",
    blurb: "Fermentation, the food technology that stays alive in the jar.",
    units: [{ id: "topic-fermentation-unit", title: "The whole course", subtitle: "Two teaching lessons, then a review.", lessons: [
      {
        id: "fe-1", title: "Eating Without Air", subtitle: "What fermentation is, at the level of the microbe",
        cards: [
          mkNote("The big idea", "Microbes eating sugar and leaving gifts",
            "Fermentation is what some microbes do when they eat sugar without oxygen: they take part of the energy and discard the rest as waste products. Those wastes are the point, for us. Depending on the microbe, the discards are lactic acid, alcohol, and carbon dioxide gas. Bread, yogurt, beer, cheese, pickles, and kimchi are all, underneath their differences, managed discards of microbial meals."),
          mkQuiz("What do fermenting microbes take in, and what do they leave behind?",
            ["Oxygen in, and sugar back out", "Sugar in, and acids, alcohol, or gas out as waste", "Nothing in, and food comes out", "Protein in, vitamins only out"],
            1,
            "The microbes are eating; we are farming their leftovers. Which leftover you get depends on which microbe is at the table."),
          mkNote("How it works", "Two famous families",
            "Yeasts are the gas and alcohol family: in bread dough their carbon dioxide inflates the loaf, and in beer and wine their alcohol stays for the drinking. The baking kills the yeast but the structure it built remains. Lactic acid bacteria are the sour family: they turn milk into yogurt and cabbage into kraut, and the acid they make is not just flavor. It is defense, as the next lesson shows."),
          mkQuiz("Why does bread dough rise?",
            ["Heat from the oven expands the flour", "Yeast releases carbon dioxide gas, inflating the dough", "Flour absorbs air when kneaded once", "The yeast multiplies until it fills the loaf and bursts it open"],
            1,
            "Gas is the lift. The yeast eats sugar in the dough and exhales bubbles, and the dough's stretchy web traps them."),
          mkNote("One more piece", "Older than farming, probably",
            "Fermentation needs no inventor: fruit ferments on the ground, milk sours in any warm pot. Humans domesticated it so long ago that beer and bread both predate writing. Every culture's pantry holds a version, because the discovery is the same everywhere: yesterday's spoiled pot, tasted carefully, was sometimes better, and safer, than the fresh one."),
          mkTrueFalse("Fermentation is a modern food technology invented in laboratories.",
            false,
            "Fermentation is older than farming and older than writing: fruit ferments on the ground and milk sours in any warm pot, with no laboratory anywhere near. Kitchens knew it first. Laboratories only arrived later to explain what kitchens already knew."),
        ],
      },
      {
        id: "fe-2", title: "Sour Is a Shield", subtitle: "Preservation, flavor, and living food",
        cards: [
          mkNote("The big idea", "Acid as a fence",
            "The lactic acid that sours a pickle is also its bodyguard. Most microbes that rot food or cause illness cannot tolerate much acid, so a well fermented food defends itself: the good microbes eat the sugar first and salt the earth behind them with acid. This is why fermentation was a preservation technology before it was a cuisine: cabbage harvested in autumn, fermented, stays food through winter with no cold and no canning."),
          mkQuiz("How does lactic acid preserve a fermented food?",
            ["It freezes the food from the inside", "Most rot microbes cannot tolerate it, so food defends itself", "It coats the food in an airtight skin that seals it from the air", "It removes all the water instantly"],
            1,
            "Acid is a hostile environment for the microbes you do not want. The fermenters tolerate their own waste; the spoilers cannot."),
          mkNote("How it works", "Flavor is microbial waste, refined",
            "The tang of yogurt, the funk of a ripe cheese, the depth in a long fermented dough: these are the discards of lesson one, layered. Different microbes in sequence leave different wastes, and time stacks them into flavors no single ingredient owns. This is also why fermented food tastes alive in a way sterile food does not: in the living ones, it literally is, until cooking or time ends the culture."),
          mkMatch("Match each word to what it means.",
            [["Yeast", "The microbe family that leaves gas and alcohol"], ["Lactic acid", "The sour waste of the bacteria behind yogurt and pickles"], ["Culture", "The living community of microbes doing the fermenting"], ["Preserve", "To keep food safe and edible for far longer"]],
            "Yeasts gas and brew, lactic bacteria sour and shield, the culture is the workforce, and preservation is the prize."),
          mkNote("One more piece", "Living and finished ferments",
            "Some fermented foods reach you alive: yogurt, kefir, and uncooked kraut carry their cultures with them, and eating live microbes can add temporary guests to your own gut community. Others are finished by heat: bread is baked, beer is often pasteurized, and the microbes are gone while their work remains. Both are true ferments; the difference is only whether the workforce is still on site when you eat."),
          mkQuiz("What is the difference between yogurt and bread as ferments?",
            ["Only yogurt is a real ferment at all", "Yogurt can arrive alive; bread is baked and its yeast dies", "Bread involves no microbes at all", "Yogurt is made by yeast exclusively"],
            1,
            "Same principle, different ending: heat retires the workforce in bread, while yogurt is often served with the crew still aboard."),
        ],
      },
      {
        id: "fe-3", title: "Review and Recall", subtitle: "The whole topic, asked again",
        cards: [
          mkQuiz("What are the three famous waste products of fermentation?",
            ["Water, salt, and beach sand", "Lactic acid, alcohol, and carbon dioxide gas", "Oxygen, sugar, and raw protein", "Heat, light, and loud sound"],
            1,
            "Sour, spirited, or bubbly: every ferment is one of these discards, farmed on purpose."),
          mkQuiz("Which microbe family makes bread rise and beer brew?",
            ["Lactic bacteria", "Yeasts", "Molds only", "Soil microbes"],
            1,
            "Yeasts leave gas and alcohol: gas lifts the loaf, alcohol stays in the brew."),
          mkTrueFalse("A fermented food keeps because the acid its culture produces stops the microbes that would rot it.",
            true,
            "No cold required. The acid the culture produces is the fence, which is why fermentation preserved food for millennia before refrigeration."),
          mkQuiz("Why does fermented food keep through a winter without canning?",
            ["It is dried to dust first", "Its own acid defeats the microbes that would rot it", "Winter air sterilizes it weekly", "Salt alone does all the work in every ferment"],
            1,
            "The culture salts the earth behind it. Spoilers that cannot tolerate acid never get a foothold."),
          mkQuiz("What does it mean that a yogurt is alive?",
            ["It can move around on its own", "Its living culture is still aboard when you eat it", "It will ferment forever untouched", "It contains animal cells inside"],
            1,
            "Alive means the workforce is aboard: living bacteria, still capable of their chemistry, guesting briefly in your gut."),
        ],
      },
    ] }],
  },
  {
    id: "topic-microbes-and-crops", title: "Microbes and Crops", category: "The Living World",
    blurb: "How the microbes around roots and the crops above them affect each other.",
    units: [{ id: "topic-microbes-and-crops-unit", title: "The whole course", subtitle: "Two teaching lessons, then a review.", lessons: [
      {
        id: "mc-1", title: "The Root Market", subtitle: "Trade underground decides harvests above it",
        cards: [
          mkNote("The big idea", "Roots run a market, and microbes are the traders",
            "A crop root is not a passive straw. It leaks sugars into the soil deliberately, and the microbes that gather to feed become its trading partners. From them the plant buys what roots alone get slowly: nitrogen and phosphorus freed from soil and dead matter, water from pores too small for roots, and protection from diseases whose microbes get crowded out by the friendly crowd. The harvest above ground starts as this market below it."),
          mkQuiz("Why do roots leak sugar on purpose?",
            ["It is waste they cannot help losing", "It feeds the microbes whose trade the plant depends on", "Sugar attracts pollinators underground, where they work in the dark", "It sweetens the soil for next year"],
            1,
            "Sugar is payment. The market it funds returns nutrients, water, and protection worth more than the sugar cost."),
          mkNote("How it works", "Pulling nitrogen from thin air",
            "Air is mostly nitrogen, yet plants starve for it, because the gas form is locked where plant chemistry cannot reach. Certain bacteria can pick that lock: living in soil or in special root nodules of peas, beans, and their relatives, they convert air nitrogen into a form plants can use, a process called nitrogen fixation. A field of legumes with the right bacteria is, in effect, fertilizing itself from the sky."),
          mkQuiz("What is nitrogen fixation?",
            ["Repairing damaged nitrogen in soil", "Bacteria converting air nitrogen into a form plants use", "Plants breathing nitrogen directly", "Freezing nitrogen for later storage"],
            1,
            "The lock pick of agriculture: the air is full of nitrogen, and only these bacteria hold the key plants need."),
          mkNote("One more piece", "Fungal highways",
            "Fungal threads connect many roots at once, and the network trades across the whole field: water and minerals move along it toward roots that pay sugar, and a well connected plant can draw on a far larger volume of soil than its own roots touch. The network is old, older than roots themselves in evolutionary terms; plants came ashore from the water with fungal partners already in the arrangement."),
          mkTrueFalse("Nitrogen fixing bacteria turn air nitrogen into a form plants can use.",
            true,
            "The gas is locked to plant chemistry. Nitrogen fixing bacteria are the intermediaries, which is why legumes and their root nodules matter so much."),
        ],
      },
      {
        id: "mc-2", title: "Farming the Invisible Half", subtitle: "Protection, partnerships, and what breaks them",
        cards: [
          mkNote("The big idea", "A crowded root is a defended root",
            "Disease microbes face the same problem everywhere: they must reach the root through a crowd that got there first. A rich root community defends its plant the way a full parking lot defeats a late arrival: the spaces and the food are taken, and some residents actively poison or outcompete the invaders. Fields with poor soil life often show the reverse, where a single disease finds the root undefended and the crop falls like a row of dominoes."),
          mkQuiz("How does a rich root community protect a crop?",
            ["By making the roots poisonous to touch", "By occupying space and food, outcompeting invaders", "By warning the plant to grow faster", "It does not protect; only sprays do"],
            1,
            "Defense by occupancy: a living crowd at the gate is a wall that sprays alone cannot imitate for long."),
          mkNote("How it works", "What feeds the partnership, and what starves it",
            "The market thrives on the same habits as the soil course taught: living roots in the ground as much of the year as possible, less disturbance, and variety above ground feeding variety below. It starves under the opposite: long bare fallows with no roots paying sugar, heavy disturbance shredding the fungal highways, and a single crop repeated until its specific diseases build up in an undefended soil."),
          mkMatch("Match each word to what it means.",
            [["Nitrogen fixation", "Bacteria turning air nitrogen into plant usable form"], ["Nodule", "The root lump where nitrogen fixing bacteria live on legumes"], ["Fungal highway", "The thread network trading water and minerals between roots"], ["Fallow", "Land left bare with no crop, and no roots paying sugar"]],
            "Fixation unlocks the air, nodules house the unlockers, fungal highways move the goods, and fallow is the market with no traders paid."),
          mkNote("One more piece", "Fertilizer is a tool, not a villain",
            "Bagged fertilizer feeds plants directly and has fed billions of people; nothing in this course argues otherwise. The nuance is partnership: a plant flooded with free nutrients pays less sugar to its traders, and the market thins. Skilled farming uses both: enough fertilizer to feed the crop, managed so the underground market, which no bag can replace for water trading and defense, stays in business."),
          mkQuiz("Why can flooding a plant with fertilizer thin its microbe market?",
            ["Fertilizer poisons all microbes instantly", "A plant with free nutrients pays less sugar, so the market thins", "Microbes dislike being observed closely", "It cannot; markets are unaffected by supply, however much is added"],
            1,
            "Trade follows need. Remove the need and the payments stop, and with them the traders, including the defenders."),
        ],
      },
      {
        id: "mc-3", title: "Review and Recall", subtitle: "The whole topic, asked again",
        cards: [
          mkQuiz("Which crop family hosts nitrogen fixing bacteria in root nodules?",
            ["Grasses and grains only", "Peas, beans, and their relatives, the legumes", "All trees in the forest", "No crops; it happens only in forests"],
            1,
            "Legumes run the sky fertilizer partnership, which is why rotations through history so often pass through beans and peas."),
          mkQuiz("What do roots buy with their leaked sugar?",
            ["Nothing; the leak is pure loss", "Nutrients, water from tiny pores, and protection", "Bigger leaves, grown directly", "Pollination services in spring"],
            1,
            "It is the highest returning payment in the field: sugar out, the whole underground economy back."),
          mkTrueFalse("A crop's root community is a passenger list with no effect on the harvest.",
            false,
            "Defense, water, and nutrients all run through the community. The harvest above ground starts in the market below it."),
          mkQuiz("Which practice starves the root market?",
            ["Keeping living roots in the ground much of the year, in every field", "Long bare fallows, heavy disturbance, and the same crop repeated", "Rotating crops through a field", "Keeping the soil covered over"],
            1,
            "No roots, no sugar; shredded highways, no trade; one crop forever, and its diseases inherit the field."),
          mkQuiz("What is the skilled position on fertilizer, from this course?",
            ["Never use it under any circumstances at all", "Feed the crop, while managing so the market stays in business", "It replaces microbes entirely and forever", "Only organic farms may use it ever"],
            1,
            "Both tools, deliberately: the bag feeds the plant today, the market defends and supplies it in ways no bag can."),
        ],
      },
    ] }],
  },
  {
    id: "topic-oceans-smallest", title: "The Ocean's Smallest", category: "The Living World",
    blurb: "Marine microbes and phytoplankton, the smallest life in the sea.",
    units: [{ id: "topic-oceans-smallest-unit", title: "The whole course", subtitle: "Two teaching lessons, then a review.", lessons: [
      {
        id: "os-1", title: "Meadows You Cannot See", subtitle: "Phytoplankton, the grass of the sea",
        cards: [
          mkNote("The big idea", "The sea's grass is microscopic and drifting",
            "On land, the base of nearly every food chain is visible: grass, trees, crops. In the ocean, the base is phytoplankton: countless tiny drifting organisms, most smaller than a grain of sand, that live in the sunlit surface layer and photosynthesize like plants. They are individually invisible and collectively colossal: the meadow that feeds the sea, spread over most of its surface."),
          mkQuiz("What are phytoplankton?",
            ["The smallest fish in the whole ocean", "Tiny drifting organisms that photosynthesize in sunlight", "Grains of sand with life growing on them", "Baby seaweed attached to the rocks"],
            1,
            "Drifting, sunlit, photosynthesizing: the sea's grass is a crowd, not a plant you can point at."),
          mkNote("How it works", "Breathing out half the world's oxygen",
            "Like the plants they resemble, phytoplankton take in carbon dioxide and release oxygen. Added up across the oceans, their share of the planet's oxygen production is enormous, often put at about half. The breath connection is real but indirect: the oxygen you breathe has cycled through air and sea for ages, and the ocean's meadow is one of its two great sources, alongside the land's forests."),
          mkQuiz("About how much of the planet's oxygen production is credited to ocean phytoplankton?",
            ["Almost none", "About a tenth", "About half", "All of it"],
            2,
            "About half, the sea's meadow matching all the land's greenery. Every second breath, roughly, has an ocean in its past."),
          mkNote("One more piece", "Blooms you can see from space",
            "When conditions align, light, nutrients welling up from below, calm water, phytoplankton multiply explosively into blooms: patches of ocean colored green, turquoise, or rust by trillions of cells, large enough to photograph from orbit. A bloom is the meadow in fast motion, and everything that eats the meadow, directly or at several removes, gathers to it."),
          mkTrueFalse("Phytoplankton crowd the sunlit surface layer, because they need light to photosynthesize.",
            true,
            "They need light, so they crowd the sunlit surface layer. The deep ocean is fed by what rains down from the meadow above."),
        ],
      },
      {
        id: "os-2", title: "The Chain and the Pump", subtitle: "Who eats the meadow, and where its carbon goes",
        cards: [
          mkNote("The big idea", "Nearly everything in the sea eats the meadow, or eats what does",
            "Tiny animals graze the phytoplankton; small fish and krill graze the grazers; and the chain climbs through squid, fish, seals, and whales. Krill deserve their fame in it: shrimp like animals that harvest phytoplankton in vast swarms and package it into food big enough for the largest animals that have ever lived, blue whales among them, to eat by the ton."),
          mkQuiz("Why are krill so important to the ocean's food chain?",
            ["They produce oxygen like phytoplankton", "They package the microscopic meadow into food giants can eat", "They clean the water of plastic bits", "They are the largest animals in the sea"],
            1,
            "Krill are the adapter between the microscopic and the enormous: meadow in, whale food out."),
          mkNote("How it works", "The biological pump",
            "When phytoplankton and their grazers die or are eaten, some of their remains sink: shells, bodies, and waste drifting down as a slow snowfall called marine snow. Carbon in that snow can reach the deep ocean and stay there for centuries, out of the air's reach. This biological pump is one of the planet's great carbon movers, and it starts, like everything else in this course, with the meadow in the sunlight."),
          mkMatch("Match each word to what it means.",
            [["Phytoplankton", "The tiny drifting photosynthesizers at the sea's surface"], ["Bloom", "An explosive growth of phytoplankton, visible from space"], ["Krill", "The small animals that graze the meadow and feed giants"], ["Marine snow", "The slow fall of remains carrying carbon to the deep"]],
            "The meadow photosynthesizes, blooms erupt, krill package the harvest, and marine snow delivers carbon to the deep."),
          mkNote("One more piece", "A meadow with seasons and moods",
            "The meadow is not steady. It blooms with spring light and nutrient mixing, thins in calm stratified summers, and depends on iron and other trace nutrients blown as dust from land or welled up from below. Warm, still surface water can starve it by locking nutrients down deep. Watching the ocean's color from space is, in effect, watching the health of the base of nearly all sea life."),
          mkQuiz("Why can warm, still surface water starve the meadow?",
            ["Warmth kills all phytoplankton instantly, in every warm sea on Earth", "Still, layered water locks nutrients deep below the sunlit layer", "The sun stops shining on warm seas", "Krill eat faster in warm water"],
            1,
            "No mixing, no delivery: the meadow lives in the light but feeds from below, and calm stratification cuts the supply line."),
        ],
      },
      {
        id: "os-3", title: "Review and Recall", subtitle: "The whole topic, asked again",
        cards: [
          mkQuiz("Where do phytoplankton live, and why there?",
            ["On the sea floor, where it is safest", "In the sunlit surface layer, because they photosynthesize", "Inside fish, riding as passengers", "Only in the seas near the poles"],
            1,
            "Light is the address. The meadow floats where the sun reaches, and the dark deep lives on what rains down."),
          mkQuiz("What is the biological pump?",
            ["A machine ships use to move seawater", "Sinking remains carrying carbon down to the deep", "The motion of tides mixing the surface", "The way whales move nutrients upward only, and never down"],
            1,
            "Marine snow is the vehicle. Carbon that reaches the deep is out of circulation for centuries."),
          mkTrueFalse("Blue whales eat phytoplankton directly, mouthful by mouthful.",
            false,
            "Whales eat the packagers: krill by the ton. The meadow is too fine to harvest directly, even for giants."),
          mkQuiz("What two ingredients from below does the meadow depend on?",
            ["Sand and salt from beaches", "Nutrients welled up from the deep, including trace iron", "Warmth and total darkness", "Nothing; sunlight is enough alone"],
            1,
            "Light above, groceries below. When the deep supply is locked away, the meadow thins no matter how bright the day."),
          mkQuiz("What does a satellite photograph of ocean color really show?",
            ["Only the water temperature above", "The health and spread of the meadow feeding the sea", "Every single fish in the frame", "Pollution and nothing else at all"],
            1,
            "Color is the meadow made visible: where it blooms, the sea's whole chain is being fed."),
        ],
      },
    ] }],
  },
];

/* One lookup for every path the Player can open: the authored
   learning paths first, then the catalog topic courses, which are
   paths in everything but shelf. Progress for both lives in the
   same store, keyed by lesson id. */
export function topicPathFor(title) {
  return TOPIC_COURSES.find((p) => p.title === title) || null;
}
export function builtinPathFor(id) {
  return LEARNING_PATHS.find((p) => p.id === id) || TOPIC_COURSES.find((p) => p.id === id) || null;
}

export const INTERACTIVE_KINDS = ["quiz", "cloze", "battle", "truefalse", "match", "order", "visualq", "spoterror", "predict", "build"];
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

/* The mastery bar. Finishing a lesson completes it at any score:
   completion is generous, and it is what unlocks the staircase. A
   lesson counts as mastered only at MASTERY_MIN_PCT or better, or
   when the learner later completes a Review what you missed pass
   for that lesson. Mastery, not mere completion, is what daily
   practice treats as learned. */
export const MASTERY_MIN_PCT = 70;

export function isLessonMastered(rec) {
  if (!rec || !rec.done) return false;
  if (rec.mastered === true || rec.reviewMastered === true) return true;
  /* Records written before mastery existed carry no mastered field;
     they are read off the best score, which is all they ever had. */
  return (rec.best || 0) >= MASTERY_MIN_PCT;
}

export function pathProgress(path, progress) {
  const flat = flattenPathLessons(path);
  const store = (progress && progress.lessons) || {};
  const done = flat.filter((l) => store[l.id] && store[l.id].done).length;
  const mastered = flat.filter((l) => isLessonMastered(store[l.id])).length;
  const next = flat.find((l) => !(store[l.id] && store[l.id].done)) || null;
  return {
    done, mastered, total: flat.length,
    pct: flat.length ? Math.round((done / flat.length) * 100) : 0,
    complete: flat.length > 0 && done === flat.length,
    nextLessonId: next ? next.id : null,
  };
}

/* Record a finished built in lesson: best score kept, mastery
   recomputed, the path's continue pointer moved to the next
   unfinished lesson. Pure: takes a progress object, returns the
   next one. Pass opts.review when the result comes from completing
   a Review what you missed pass for the lesson: that masters the
   lesson at whatever score it already holds. */
export function applyLessonResult(progress, path, lessonId, pct, opts) {
  const next = {
    lessons: { ...((progress && progress.lessons) || {}) },
    lastPathId: path.id,
    lastLessonId: lessonId,
  };
  const prev = next.lessons[lessonId] || {};
  const best = Math.max(prev.best || 0, Math.round(pct || 0));
  const reviewMastered = !!(prev.reviewMastered || (opts && opts.review));
  next.lessons[lessonId] = {
    done: true,
    best,
    /* A running count of completions, so the Player can scale a
       replay's XP down (full, half, then none) while progress and
       mastery stay uncapped. Records written before this field
       existed count their done state as the first completion. */
    completions: (prev.completions || (prev.done ? 1 : 0)) + 1,
    completedAt: prev.completedAt || new Date().toISOString(),
    /* The last day this lesson was studied, first completion or
       replay. The journey map reads it to mark finished ground as
       fading when its review falls due; records written before
       this field existed fall back to completedAt. */
    lastAt: new Date().toISOString(),
    reviewMastered,
    mastered: isLessonMastered({ done: true, best, reviewMastered }),
  };
  const pp = pathProgress(path, next);
  if (pp.nextLessonId) next.lastLessonId = pp.nextLessonId;
  return next;
}

/* ── ranks: XP becomes a ladder with a face (redesign, 2026-10-14) ──
   Five named rungs sit on top of the XP total. Each rung carries a
   kit line, one plain sentence about what a learner at that rung
   travels with, and the home and win screens show the current rung,
   its kit line in a framed medallion, and the distance to the next
   rung, so progress is visible instead of a bare number. */
export const RANK_LADDER = [
  { name: "Observer", minXp: 0, kit: "A notebook, sharp eyes, and a head full of questions." },
  { name: "Explorer", minXp: 200, kit: "A field notebook with the first paths filled in." },
  { name: "Investigator", minXp: 600, kit: "A magnifier, a habit of checking, and reviews kept on schedule." },
  { name: "Field Researcher", minXp: 1400, kit: "A full field kit, and whole subjects held without notes." },
  { name: "Principal Investigator", minXp: 3000, kit: "The whole kit, plus the judgment to know what to ask next." },
];

export function rankForXp(xp) {
  const total = Math.max(0, Math.floor(xp || 0));
  let idx = 0;
  for (let i = 0; i < RANK_LADDER.length; i++) if (total >= RANK_LADDER[i].minXp) idx = i;
  const rank = RANK_LADDER[idx];
  const next = RANK_LADDER[idx + 1] || null;
  const intoRank = total - rank.minXp;
  const spanXp = next ? next.minXp - rank.minXp : 0;
  return {
    index: idx,
    name: rank.name,
    kit: rank.kit,
    minXp: rank.minXp,
    xp: total,
    nextName: next ? next.name : null,
    nextMinXp: next ? next.minXp : null,
    xpToNext: next ? next.minXp - total : 0,
    pctToNext: next ? Math.min(100, Math.round((intoRank / spanXp) * 100)) : 100,
    atTop: !next,
  };
}

/* Per topic mastery, levels 0 to 5, computed from what the progress
   record already holds: how much of the topic is done, how much is
   mastered, the average best score across finished lessons, and
   how much of the finishing came through review passes. Level 0 is
   untouched; a fully mastered topic with strong scores reads 5. */
export function topicMasteryLevel(topicPath, progress) {
  if (!topicPath) return 0;
  const flat = flattenPathLessons(topicPath);
  const store = (progress && progress.lessons) || {};
  const recs = flat.map((l) => store[l.id]).filter((r) => r && r.done);
  if (!recs.length || !flat.length) return 0;
  const mastered = recs.filter((r) => isLessonMastered(r)).length;
  const reviewed = recs.filter((r) => r.reviewMastered).length;
  const avgBest = recs.reduce((sum, r) => sum + (r.best || 0), 0) / recs.length;
  const score = 0.5 * (mastered / flat.length)
    + 0.3 * (avgBest / 100) * (recs.length / flat.length)
    + 0.2 * (reviewed / flat.length);
  return Math.max(1, Math.min(5, 1 + Math.floor(score * 5)));
}

/* ── fading: finished ground whose review is due ───────────────────
   A finished lesson reads as fading on the journey map when enough
   days have passed since it was last studied: two days for a lesson
   finished but not mastered, seven for a mastered one, matching the
   spirit of the review schedule without touching its math. */
export const FADING_AFTER_DAYS = 2;
export const MASTERED_FADING_AFTER_DAYS = 7;

export function lessonLastActivityMs(rec) {
  if (!rec) return 0;
  const raw = rec.lastAt || rec.completedAt || "";
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
}

export function isLessonFading(rec, now = Date.now()) {
  if (!rec || !rec.done) return false;
  const last = lessonLastActivityMs(rec);
  if (!last) return false;
  const days = isLessonMastered(rec) ? MASTERED_FADING_AFTER_DAYS : FADING_AFTER_DAYS;
  return now - last >= days * DAY_MS;
}

/* Every fading lesson across a set of paths, in path order: the
   review bench counts them and the review session samples them. */
export function fadingLessons(paths, progress, now = Date.now()) {
  const out = [];
  const store = (progress && progress.lessons) || {};
  for (const path of paths || []) {
    for (const lesson of flattenPathLessons(path)) {
      if (isLessonFading(store[lesson.id], now)) out.push({ path, lesson });
    }
  }
  return out;
}

/* The review session: due spaced review cards first, then
   activities sampled from fading lessons, so one tap from the
   review bench plays exactly what is due and nothing else.
   Deterministic for a given seed, like daily practice. */
export function buildReviewSessionCards({ progress, dueCards = [], seed = 1, limit = 10, paths = null, now = Date.now() } = {}) {
  const pool = paths || [...LEARNING_PATHS, ...TOPIC_COURSES];
  const fading = fadingLessons(pool, progress, now);
  const fadingCards = [];
  for (const { lesson } of fading) {
    for (const c of lesson.cards) if (isInteractiveCard(c)) fadingCards.push(c);
  }
  const duePart = dueCards.slice(0, 6);
  const room = Math.max(0, limit - duePart.length);
  const picks = seededShuffle(fadingCards, (seed || 1) + 29).slice(0, room);
  return [...duePart, ...picks].slice(0, limit);
}

/* ── lesson rhythm: the opener rotates by position ─────────────────
   Lesson shape used to be identical everywhere, so lesson twelve
   felt like lesson one. The opener framing now rotates with the
   lesson's position on its path: a visual opener where the lesson
   actually carries a visual or diagram, a predict opener, then a
   story opener, repeating. Card order inside the lesson never
   changes; only the framing on the lesson intro rotates, so every
   ordering guarantee the suite pins still holds. */
export const OPENER_STYLES = ["visual", "predict", "story"];
export function lessonOpenerStyle(lesson, flatIndex) {
  const want = OPENER_STYLES[Math.abs(flatIndex || 0) % OPENER_STYLES.length];
  if (want === "visual") {
    const hasVisual = ((lesson && lesson.cards) || []).some((c) => c.visual || c.diagram);
    return hasVisual ? "visual" : "story";
  }
  return want;
}

/* Daily practice: due review cards first in spirit, then activities
   sampled from lessons already finished in paths the learner has
   started. Finished but unmastered lessons are practice material
   with priority: their cards fill the session before mastered
   lessons, which are the learned pool. Deterministic for a given
   seed, so a day is stable. */
export function buildDailyPracticeCards({ progress, dueCards = [], seed = 1, limit = 8, paths = LEARNING_PATHS } = {}) {
  const store = (progress && progress.lessons) || {};
  const priorityPool = [];
  const learnedPool = [];
  for (const path of paths) {
    const flat = flattenPathLessons(path);
    const started = flat.some((l) => store[l.id] && store[l.id].done);
    if (!started) continue;
    for (const l of flat) {
      const rec = store[l.id];
      if (rec && rec.done) {
        const bucket = isLessonMastered(rec) ? learnedPool : priorityPool;
        for (const c of l.cards) if (isInteractiveCard(c)) bucket.push(c);
      }
    }
  }
  const duePart = dueCards.slice(0, 6);
  const room = Math.max(0, limit - duePart.length);
  const picks = [
    ...seededShuffle(priorityPool, seed || 1),
    ...seededShuffle(learnedPool, (seed || 1) + 7),
  ].slice(0, room);
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
    if (card.kind === "quiz" || card.kind === "cloze" || card.kind === "visualq" || card.kind === "predict") {
      if (!Array.isArray(card.options) || card.options.length < 2) problems.push(where + ": " + card.kind + " needs at least 2 options");
      else if (!(card.correct >= 0 && card.correct < card.options.length)) problems.push(where + ": " + card.kind + " correct index is outside its options");
      if (!card.why) problems.push(where + ": " + card.kind + " has no explanation");
      if (card.kind === "visualq" && !card.visual && !card.diagram) problems.push(where + ": visualq needs the visual or diagram it is answered from");
      if (card.kind === "predict" && !card.outcome) problems.push(where + ": predict has no outcome to reveal");
    } else if (card.kind === "spoterror") {
      if (!Array.isArray(card.parts) || card.parts.length < 3 || card.parts.length > 6) problems.push(where + ": spoterror needs 3 to 6 pieces");
      else if (!(card.wrong >= 0 && card.wrong < card.parts.length)) problems.push(where + ": spoterror wrong index is outside its pieces");
      if (!card.fix) problems.push(where + ": spoterror has no corrected piece to teach");
      if (!card.why) problems.push(where + ": spoterror has no explanation");
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
    } else if (card.kind === "order" || card.kind === "build") {
      if (!Array.isArray(card.items) || card.items.length < 3 || card.items.length > 6) problems.push(where + ": " + card.kind + " needs 3 to 6 items");
      else if (new Set(card.items).size !== card.items.length) problems.push(where + ": " + card.kind + " items repeat");
      if (!card.why) problems.push(where + ": " + card.kind + " has no explanation");
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
        // Card count ceiling raised 8 to 10 on 2026-10-14 for the flagship
        // lesson standard (the nine beats land as ten physical cards:
        // hook, three teach cards, image quiz, one rotating interactive,
        // a true or false pair, apply, payoff). Legacy lessons stay 5 to 8.
        if (!Array.isArray(lesson.cards) || lesson.cards.length < 5 || lesson.cards.length > 10) {
          problems.push(where + ": lesson needs 5 to 10 cards, has " + (lesson.cards || []).length);
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
    xpCompletions: Object.fromEntries(flat
      .filter((l) => store[l.id] && store[l.id].done)
      .map((l) => [l.id, store[l.id].completions || 1])),
    xpEarned: 0,
    vocab: [],
  };
}

/* ── the XP economy ────────────────────────────────────────────────
   XP is meant to measure learning, so it pays for being right and
   for finishing, and almost nothing for anything else. A correct
   answer earns 10. A checked wrong answer earns a token 1: the
   attempt happened, the learning is in the feedback, and the point
   says so without pretending it was half a success (wrong answers
   used to earn 4, and reading a card earned 2, so the total mostly
   counted activity). Battle cards have no wrong answer to give, so
   engaging one earns its flat 6. Finishing a lesson earns 20.
   Reading cards (notes, papers, deepen, summaries) earn nothing:
   advancing past a card is not an achievement.
   Replays are capped per lesson: the first completion of a lesson
   pays in full, the second pays half, and later completions pay
   nothing. Progress, mastery, and practice are never capped, only
   the points stop. */
export const XP_CORRECT = 10;
export const XP_WRONG = 1;
export const XP_BATTLE = 6;
export const XP_LESSON_FINISH = 20;

/* Match cards: a clean run earns full marks; every miss knocks 2
   off, down to the token point for a card that took real work to
   finish at all. */
export function matchScore(mistakes) {
  const m = Math.max(0, mistakes || 0);
  return m === 0 ? XP_CORRECT : Math.max(XP_WRONG, XP_CORRECT - 2 * m);
}

/* The replay scale for a lesson, from how many times it has
   already been completed: full, half, then nothing. */
export function lessonXpScale(priorCompletions) {
  const n = Math.max(0, priorCompletions || 0);
  return n === 0 ? 1 : n === 1 ? 0.5 : 0;
}
export function scaleXp(xp, scale) {
  return Math.round((xp || 0) * (scale == null ? 1 : scale));
}

/* Per position credit for order cards. Every step sitting in its
   correct slot earns its share of the card's 10 XP and a clean full
   sequence earns the full 10. A checked attempt with nothing in
   place earns the token point a wrong answer earns everywhere. */
export function orderScore(placed, items) {
  const total = (items || []).length;
  if (!total) return { correctPositions: 0, total: 0, xp: 0, perfect: false };
  const correctPositions = (placed || []).reduce((n, v, i) => n + (v === items[i] ? 1 : 0), 0);
  const perfect = correctPositions === total;
  const xp = perfect ? XP_CORRECT
    : correctPositions > 0 ? Math.round((correctPositions / total) * XP_CORRECT)
    : XP_WRONG;
  return { correctPositions, total, xp, perfect };
}

/* ── loop systems: daily quests, Sparks, reminders, leagues ───────
   Phase 3. One daily loop: a session, one target quest chosen from
   the weakest visible behaviour, and one stretch quest. Finishing
   work records events on the day, quests pay Sparks when they
   settle, and Sparks pay only for streak protection. Nothing here
   sells progress of any kind. All of it is pure, so the whole loop
   can be pinned without a DOM. */
export const SPARKS_RATES = { session: 10, quest: 5, checkpoint: 15, perfect: 5, rankUp: 50, freezeCost: 50, repairCost: 100, freezeCap: 2 };
export const SPARKS_NEVER_BUYS = ["answers", "hints", "skips", "XP", "rank", "mastery", "league standing"];

export function emptyLoop(day) {
  return {
    plan: null,
    sessionDone: false,
    sessionPaid: false,
    done: { session: false, target: false, stretch: false },
    paid: { session: false, target: false, stretch: false },
    events: { lessons: [], perfect: [], checkpoints: [], paidPerfect: [], paidCheckpoints: [] },
    dueAtStart: 0,
  };
}

export function loopForDay(profile, dayKey) {
  const base = emptyLoop(dayKey);
  if (!profile || profile.loopDay !== dayKey || !profile.loop || typeof profile.loop !== "object" || Array.isArray(profile.loop)) return base;
  const stored = profile.loop;
  return {
    ...base,
    ...stored,
    done: { ...base.done, ...(stored.done || {}) },
    paid: { ...base.paid, ...(stored.paid || {}) },
    events: {
      lessons: [...((stored.events && stored.events.lessons) || [])],
      perfect: [...((stored.events && stored.events.perfect) || [])],
      checkpoints: [...((stored.events && stored.events.checkpoints) || [])],
      paidPerfect: [...((stored.events && stored.events.paidPerfect) || [])],
      paidCheckpoints: [...((stored.events && stored.events.paidCheckpoints) || [])],
    },
  };
}

export function buildDailyQuests({ day, profile, progress, dueCount } = {}) {
  const dayStr = day || "";
  const xp = (profile && profile.xp) || 0;
  const due = Math.max(0, dueCount || 0);
  const allPaths = [...LEARNING_PATHS, ...TOPIC_COURSES];
  const session = {
    slot: "session", kind: "session",
    title: "Finish today's session",
    detail: "Play the daily session from warmup to payoff.",
    targetId: null, pathId: null, dueAtStart: due,
  };
  let target = null;
  if (due > 0) {
    target = {
      slot: "target", kind: "review",
      title: "Clear the review queue",
      detail: due + (due === 1 ? " question is" : " questions are") + " due for review today.",
      targetId: null, pathId: null, dueAtStart: due,
    };
  } else {
    const fading = fadingLessons(allPaths, progress || { lessons: {} });
    if (fading.length) {
      target = {
        slot: "target", kind: "fading",
        title: "Revisit " + fading[0].lesson.title,
        detail: "This finished lesson is fading. A visit brings it back.",
        targetId: fading[0].lesson.id, pathId: fading[0].path.id, dueAtStart: due,
      };
    } else {
      const candidates = [];
      for (const path of allPaths) {
        const pp = pathProgress(path, progress || { lessons: {} });
        if (pp.nextLessonId) candidates.push({ path, pp });
      }
      let pick = candidates[0] || null;
      const started = candidates.filter((c) => c.pp.done > 0 && !c.pp.complete);
      if (started.length) {
        const sorted = [...started].sort((a, b) => (a.pp.pct - b.pp.pct) || (a.pp.done - b.pp.done));
        const bestPct = sorted[0].pp.pct;
        const bestDone = sorted[0].pp.done;
        const tied = sorted.filter((c) => c.pp.pct === bestPct && c.pp.done === bestDone);
        pick = tied.length > 1 ? tied[hashStr(dayStr + xp) % tied.length] : sorted[0];
      }
      if (pick) {
        const flat = flattenPathLessons(pick.path);
        const lesson = flat.find((l) => l.id === pick.pp.nextLessonId) || flat[0];
        target = {
          slot: "target", kind: "lesson",
          title: "Finish " + (lesson ? lesson.title : "the next lesson"),
          detail: "The next unfinished lesson on " + pick.path.title + ".",
          targetId: lesson ? lesson.id : pick.pp.nextLessonId, pathId: pick.path.id, dueAtStart: due,
        };
      } else {
        target = {
          slot: "target", kind: "lesson",
          title: "Finish a lesson",
          detail: "Pick any path and finish its next lesson.",
          targetId: null, pathId: null, dueAtStart: due,
        };
      }
    }
  }
  let stretch = null;
  for (const path of allPaths) {
    const pp = pathProgress(path, progress || { lessons: {} });
    if (!pp.nextLessonId) continue;
    const flat = flattenPathLessons(path);
    const next = flat.find((l) => l.id === pp.nextLessonId);
    if (next && next.checkpoint === true) {
      stretch = {
        slot: "stretch", kind: "checkpoint",
        title: "Pass the checkpoint " + next.title,
        detail: "The checkpoint lesson on " + path.title + " is your next stop there.",
        targetId: next.id, pathId: path.id, dueAtStart: due,
      };
      break;
    }
  }
  if (!stretch) {
    const freshTopic = TOPIC_COURSES.find((p) => pathProgress(p, progress || { lessons: {} }).done === 0);
    if (freshTopic) {
      stretch = {
        slot: "stretch", kind: "newtopic",
        title: "Start " + freshTopic.title,
        detail: "A topic you have not opened yet. One lesson starts it.",
        targetId: null, pathId: freshTopic.id, dueAtStart: due,
      };
    } else {
      stretch = {
        slot: "stretch", kind: "perfect",
        title: "Finish a lesson with a perfect score",
        detail: "Every check right on the first try, in any lesson.",
        targetId: null, pathId: null, dueAtStart: due,
      };
    }
  }
  return [session, target, stretch];
}

export function questState(quest, { loop, dueCount, progress, now } = {}) {
  if (!quest) return { current: 0, total: 1, done: false };
  const effLoop = loop || emptyLoop("");
  const events = effLoop.events || { lessons: [], perfect: [], checkpoints: [] };
  const lessonsDone = events.lessons || [];
  const at = now == null ? Date.now() : now;
  if (quest.kind === "session") {
    const done = !!effLoop.sessionDone;
    return { current: done ? 1 : 0, total: 1, done };
  }
  if (quest.kind === "review") {
    const total = Math.max(0, quest.dueAtStart || 0);
    const remaining = Math.min(Math.max(0, dueCount || 0), total);
    return { current: total - remaining, total, done: total > 0 && (dueCount || 0) === 0 };
  }
  if (quest.kind === "fading") {
    const inEvents = !!quest.targetId && lessonsDone.includes(quest.targetId);
    const rec = progress && progress.lessons ? progress.lessons[quest.targetId] : null;
    const noLongerFading = !!rec && !!rec.done && !isLessonFading(rec, at);
    const done = inEvents || noLongerFading;
    return { current: done ? 1 : 0, total: 1, done };
  }
  if (quest.kind === "lesson") {
    const done = !!quest.targetId && lessonsDone.includes(quest.targetId);
    return { current: done ? 1 : 0, total: 1, done };
  }
  if (quest.kind === "checkpoint") {
    const done = !!quest.targetId && (events.checkpoints || []).includes(quest.targetId);
    return { current: done ? 1 : 0, total: 1, done };
  }
  if (quest.kind === "newtopic") {
    const path = [...LEARNING_PATHS, ...TOPIC_COURSES].find((p) => p.id === quest.pathId) || null;
    const ids = path ? flattenPathLessons(path).map((l) => l.id) : [];
    const done = ids.some((id) => lessonsDone.includes(id));
    return { current: done ? 1 : 0, total: 1, done };
  }
  if (quest.kind === "perfect") {
    const done = ((events.perfect || []).length > 0);
    return { current: done ? 1 : 0, total: 1, done };
  }
  return { current: 0, total: 1, done: false };
}

export function recordLoopEvent(profile, day, event) {
  const base = profile || {};
  const loop = loopForDay(base, day);
  const next = {
    ...base,
    sparks: Math.max(0, base.sparks || 0),
    loopDay: day,
    loop: {
      ...loop,
      done: { ...loop.done },
      paid: { ...loop.paid },
      events: {
        lessons: [...loop.events.lessons],
        perfect: [...loop.events.perfect],
        checkpoints: [...loop.events.checkpoints],
        paidPerfect: [...loop.events.paidPerfect],
        paidCheckpoints: [...loop.events.paidCheckpoints],
      },
    },
  };
  if (!event || !event.type) return next;
  if (event.type === "lesson" && event.lessonId) {
    if (!next.loop.events.lessons.includes(event.lessonId)) next.loop.events.lessons.push(event.lessonId);
  } else if (event.type === "perfect" && event.lessonId) {
    if (!next.loop.events.perfect.includes(event.lessonId)) next.loop.events.perfect.push(event.lessonId);
    if (!next.loop.events.paidPerfect.includes(event.lessonId)) {
      next.loop.events.paidPerfect.push(event.lessonId);
      next.sparks = Math.max(0, next.sparks + SPARKS_RATES.perfect);
    }
  } else if (event.type === "checkpoint" && event.lessonId) {
    if (!next.loop.events.checkpoints.includes(event.lessonId)) next.loop.events.checkpoints.push(event.lessonId);
    if (!next.loop.events.paidCheckpoints.includes(event.lessonId)) {
      next.loop.events.paidCheckpoints.push(event.lessonId);
      next.sparks = Math.max(0, next.sparks + SPARKS_RATES.checkpoint);
    }
  } else if (event.type === "session") {
    next.loop.sessionDone = true;
    if (!next.loop.sessionPaid) {
      next.loop.sessionPaid = true;
      next.sparks = Math.max(0, next.sparks + SPARKS_RATES.session);
    }
  }
  return next;
}

export function settleQuestPayouts(profile, day, quests, ctx = {}) {
  const base = profile || {};
  const loop = loopForDay(base, day);
  const next = {
    ...base,
    sparks: Math.max(0, base.sparks || 0),
    loopDay: day,
    loop: {
      ...loop,
      done: { ...loop.done },
      paid: { ...loop.paid },
      events: {
        lessons: [...loop.events.lessons],
        perfect: [...loop.events.perfect],
        checkpoints: [...loop.events.checkpoints],
        paidPerfect: [...loop.events.paidPerfect],
        paidCheckpoints: [...loop.events.paidCheckpoints],
      },
    },
  };
  const newlyPaid = [];
  for (const quest of quests || []) {
    if (!quest || !quest.slot) continue;
    const state = questState(quest, { loop: next.loop, dueCount: ctx.dueCount || 0, progress: ctx.progress, now: ctx.now });
    if (state.done) {
      next.loop.done[quest.slot] = true;
      if (!next.loop.paid[quest.slot]) {
        next.loop.paid[quest.slot] = true;
        next.sparks = Math.max(0, next.sparks + SPARKS_RATES.quest);
        newlyPaid.push(quest.slot);
      }
    }
  }
  return { profile: next, newlyPaid };
}

export function awardSparksForRankUps(profile, fromXp, toXp) {
  const base = profile || {};
  const gained = rankForXp(toXp).index - rankForXp(fromXp).index;
  if (gained <= 0) return { ...base, sparks: Math.max(0, base.sparks || 0) };
  return { ...base, sparks: Math.max(0, (base.sparks || 0) + gained * SPARKS_RATES.rankUp) };
}

export function spendSparks(profile, amount) {
  const balance = Math.max(0, (profile && profile.sparks) || 0);
  const cost = Math.max(0, amount || 0);
  if (balance < cost) return null;
  return { ...(profile || {}), sparks: balance - cost };
}

export function buyStreakFreeze(profile) {
  const base = profile || {};
  if ((base.freezes || 0) >= SPARKS_RATES.freezeCap) return null;
  const spent = spendSparks(base, SPARKS_RATES.freezeCost);
  if (!spent) return null;
  return { ...spent, freezes: (base.freezes || 0) + 1 };
}

export function streakRepairOffer(profile, now) {
  const base = profile || {};
  const nowDate = now == null ? new Date() : (now instanceof Date ? now : new Date(now));
  const keyFor = (offset) => { const d = new Date(nowDate); d.setDate(d.getDate() + offset); return todayKey(d); };
  const days = new Set(base.days || []);
  const today = keyFor(0);
  const yesterday = keyFor(-1);
  const dayBefore = keyFor(-2);
  if (!days.has(today) || days.has(yesterday) || !days.has(dayBefore)) return null;
  let lostStreak = 0;
  for (let offset = -2; ; offset--) {
    if (days.has(keyFor(offset))) lostStreak++;
    else break;
  }
  return { missedDay: yesterday, lostStreak, cost: SPARKS_RATES.repairCost };
}

export function applyStreakRepair(profile) {
  const base = profile || {};
  const offer = streakRepairOffer(base, new Date());
  if (!offer) return null;
  const spent = spendSparks(base, SPARKS_RATES.repairCost);
  if (!spent) return null;
  const days = [...new Set([...(base.days || []), offer.missedDay])].sort();
  const bridged = [...new Set([...(base.bridged || []), offer.missedDay])];
  const set = new Set(days);
  let streak = 0;
  for (let offset = 0; ; offset--) {
    const d = new Date(); d.setDate(d.getDate() + offset);
    if (set.has(todayKey(d))) streak++;
    else break;
  }
  return { ...spent, days, bridged, streak };
}

export function reminderFor({ profile, quests, loop, now } = {}) {
  const base = profile || {};
  if (base.reminderHour == null) return null;
  const effLoop = loop || emptyLoop("");
  if (effLoop.sessionDone) return null;
  const nowDate = now == null ? new Date() : (now instanceof Date ? now : new Date(now));
  const hour = nowDate.getHours();
  if (hour < base.reminderHour) return null;
  const streak = base.streak || 0;
  if (hour >= 22) {
    return {
      kind: "atrisk",
      title: "Your streak needs you tonight",
      body: "Your streak is " + streak + (streak === 1 ? " day" : " days") + ". Finish today's session before midnight to keep it going.",
    };
  }
  const list = quests || [];
  const open = list.find((q) => {
    if (!q) return false;
    if (q.kind === "session") return !effLoop.sessionDone;
    if (effLoop.done && q.slot && effLoop.done[q.slot]) return false;
    if (effLoop.paid && q.slot && effLoop.paid[q.slot]) return false;
    return true;
  }) || list[0] || null;
  return {
    kind: "daily",
    title: "Time for Cortex",
    body: "Your streak is " + streak + (streak === 1 ? " day" : " days") + "." + (open ? " Still open today: " + open.title + "." : " Finish today's session to keep it going."),
  };
}

export const LEAGUE_GROUP_SIZE = 30;
export const LEAGUE_DAILY_POINTS_CAP = 60;
export const LEAGUES_WEEKLY_ACTIVE_GATE = 3000;

export function leagueDailyPoints({ lessonsFirstTime = 0, reviewCorrect = 0 } = {}) {
  const raw = Math.max(0, lessonsFirstTime || 0) * 20 + Math.max(0, reviewCorrect || 0) * 2;
  return Math.min(LEAGUE_DAILY_POINTS_CAP, raw);
}

export function leagueWeeklyPoints(arrayOfDailyPoints) {
  return (arrayOfDailyPoints || []).reduce((sum, n) => sum + (n || 0), 0);
}

export function leagueGroupFor(learnerId, ids, size = LEAGUE_GROUP_SIZE) {
  const sorted = [...(ids || [])].sort((a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0));
  const chunkSize = Math.max(1, size || LEAGUE_GROUP_SIZE);
  for (let i = 0; i < sorted.length; i += chunkSize) {
    const chunk = sorted.slice(i, i + chunkSize);
    if (chunk.includes(learnerId)) return chunk;
  }
  return [];
}

export function leaguesAreOpen(weeklyActives) {
  return (weeklyActives || 0) >= LEAGUES_WEEKLY_ACTIVE_GATE;
}

export function shareCardModel(kind, data = {}) {
  const d = data || {};
  if (kind === "lesson") {
    const lines = [];
    if (d.accuracy != null) lines.push("First try accuracy " + d.accuracy + "%");
    if (d.xp != null) lines.push("+" + d.xp + " XP");
    if (d.courseTitle) lines.push(d.courseTitle);
    if (Array.isArray(d.lines)) lines.push(...d.lines);
    return { eyebrow: "LESSON COMPLETE", title: d.title || d.lessonTitle || "Lesson complete", lines, pose: "celebrate" };
  }
  if (kind === "course") {
    const lines = [];
    if (d.accuracy != null) lines.push("First try accuracy " + d.accuracy + "%");
    if (d.xp != null) lines.push("+" + d.xp + " XP");
    if (d.lessons != null) lines.push(d.lessons + " lessons finished");
    if (Array.isArray(d.lines)) lines.push(...d.lines);
    return { eyebrow: "COURSE COMPLETE", title: d.title || d.courseTitle || "Course complete", lines, pose: "celebrate" };
  }
  if (kind === "streak") {
    const lines = [];
    if (d.rankName) lines.push("Rank " + d.rankName);
    if (d.mastered != null) lines.push(d.mastered + " lessons mastered");
    if (d.lessonsMastered != null) lines.push(d.lessonsMastered + " lessons mastered");
    if (Array.isArray(d.lines)) lines.push(...d.lines);
    return { eyebrow: "STREAK", title: (d.streak != null ? d.streak + " day streak" : d.title || "Streak"), lines, pose: "celebrate" };
  }
  if (kind === "rank") {
    const lines = [];
    if (d.kit) lines.push(d.kit);
    if (d.xp != null) lines.push(d.xp + " XP in all");
    if (Array.isArray(d.lines)) lines.push(...d.lines);
    return { eyebrow: "YOUR RANK", title: d.rankName || d.title || "Rank", lines, pose: "wave" };
  }
  const lines = [];
  if (d.streak != null) lines.push(d.streak + (d.streak === 1 ? " day" : " days") + " streak");
  if (d.rankName) lines.push("Rank " + d.rankName);
  if (d.mastered != null) lines.push(d.mastered + " lessons mastered");
  if (d.lessonsMastered != null) lines.push(d.lessonsMastered + " lessons mastered");
  if (Array.isArray(d.lines)) lines.push(...d.lines);
  return { eyebrow: "DAILY SESSION COMPLETE", title: d.title || "Daily session complete", lines, pose: "celebrate" };
}

/* ── share cards: one square image the learner chooses to share ──
   The click draws a 1080 by 1080 canvas from the pure model, then
   offers the system share sheet when the browser can share files
   and a download either way. Nothing is posted automatically. */
function ShareCardButton({ model, P, accent }) {
  const [msg, setMsg] = useState("");
  if (!model) return null;
  const draw = async () => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1080; canvas.height = 1080;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = (P && P.bg) || "#1c1917";
      ctx.fillRect(0, 0, 1080, 1080);
      ctx.strokeStyle = accent; ctx.lineWidth = 14;
      ctx.beginPath(); ctx.arc(540, 300, 150, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = accent; ctx.lineWidth = 6;
      ctx.strokeRect(36, 36, 1008, 1008);
      const src = CHARACTER_POSES[model.pose] || null;
      const img = src ? await new Promise((resolve) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => resolve(null);
        im.src = src;
      }) : null;
      if (img) { try { ctx.drawImage(img, 440, 190, 200, 200); } catch { /* draw without it */ } }
      ctx.textAlign = "center";
      ctx.fillStyle = accent;
      ctx.font = "700 30px Georgia, serif";
      ctx.fillText("Cortex", 540, 110);
      ctx.fillStyle = (P && P.ink2) || "#d4d4d8";
      ctx.font = "400 26px Georgia, serif";
      ctx.fillText(CORTEX_TAGLINE, 540, 150);
      ctx.fillStyle = accent;
      ctx.font = "700 28px Georgia, serif";
      ctx.fillText(String(model.eyebrow || ""), 540, 510);
      ctx.fillStyle = (P && P.ink) || "#ffffff";
      ctx.font = "600 62px Georgia, serif";
      const words = String(model.title || "").split(/\s+/);
      const wrapped = [];
      let lineNow = "";
      for (const w of words) {
        const trial = lineNow ? lineNow + " " + w : w;
        if (ctx.measureText(trial).width > 880 && lineNow) { wrapped.push(lineNow); lineNow = w; } else lineNow = trial;
      }
      if (lineNow) wrapped.push(lineNow);
      wrapped.slice(0, 3).forEach((ln, i) => ctx.fillText(ln, 540, 590 + i * 72));
      ctx.fillStyle = (P && P.ink) || "#ffffff";
      ctx.font = "400 36px Georgia, serif";
      (model.lines || []).slice(0, 5).forEach((ln, i) => ctx.fillText(String(ln), 540, 790 + i * 52));
      ctx.fillStyle = (P && P.faint) || "#a1a1aa";
      ctx.font = "400 26px Georgia, serif";
      ctx.fillText("Cortex · askcerebrum.org", 540, 1010);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) return;
      const file = typeof File !== "undefined" ? new File([blob], "cortexshare.png", { type: "image/png" }) : null;
      if (file && typeof navigator !== "undefined" && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: "Cortex" }); } catch { /* the download still follows */ }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "cortexshare.png";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setMsg("Share card saved as an image.");
    } catch { setMsg("The share card could not be made here."); }
  };
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <button className="lv-btn" onClick={draw}
        style={{ background: "transparent", border: "1px solid " + P.line, color: P.ink, borderRadius: RADIUS.pill, padding: "10px 18px", fontSize: FONT_SIZES.label, fontWeight: 700, cursor: "pointer", fontFamily: "var(--cb-font)", minHeight: 44 }}>
        Share card
      </button>
      {msg && <span style={{ fontSize: FONT_SIZES.label, color: P.ink2 }}>{msg}</span>}
    </span>
  );
}

/* ── lesson player (full screen) ─────────────────────────────────── */
function Player({ course, startLesson, P, accent, at, soundOn, onExit, onProgress, onLessonDone, onReviewDone, rankSummary, goalPicker }) {
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
  const [firstFinish, setFirstFinish] = useState(false);
  const [misses, setMisses] = useState([]);
  const [reviewCards, setReviewCards] = useState(null);
  const [reviewForId, setReviewForId] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [lastAward, setLastAward] = useState(0);
  const [orderResult, setOrderResult] = useState(null);
  const [announce, setAnnounce] = useState({ n: 0, text: "" });
  const xpAtLessonStart = useRef(0);
  const claimsRef = useRef(null);
  if (!claimsRef.current) claimsRef.current = loadClaims();

  /* Per lesson completion counts, seeded from the course record
     (a lesson in doneLessons has completed at least once, and
     courses that track xpCompletions carry the real count) and
     bumped each time a finish bonus is paid in this sitting. The
     count drives lessonXpScale, so a replay pays half and later
     runs pay nothing, while progress is never capped. */
  const xpCompletionsRef = useRef(null);
  if (!xpCompletionsRef.current) {
    const init = {};
    for (const l of course.lessons || []) {
      const n = (course.xpCompletions && course.xpCompletions[l.id])
        || ((course.doneLessons || []).includes(l.id) ? 1 : 0);
      if (n) init[l.id] = n;
    }
    xpCompletionsRef.current = init;
  }

  /* Shuffles are salted per mount and per attempt, so a retried
     card never shows the layout the learner just memorized. */
  const shuffleSalt = useRef(Math.floor(Math.random() * 100000));
  const shellRef = useRef(null);
  const exitRef = useRef(onExit);
  exitRef.current = onExit;

  /* The Player is a full screen layer: focus moves into it on open
     and back to whatever held it on close, Escape closes it, and Tab
     cycles inside it for as long as it is open. The listener is
     removed with the Player, so a closed Player never traps Tab. */
  useEffect(() => {
    const prevFocus = typeof document !== "undefined" ? document.activeElement : null;
    const node = shellRef.current;
    if (node && node.focus) node.focus({ preventScroll: true });
    const onKey = (e) => {
      if (e.key === "Escape" && exitRef.current) { exitRef.current(); return; }
      if (e.key !== "Tab") return;
      const shellNode = shellRef.current;
      if (!shellNode || typeof shellNode.querySelectorAll !== "function") return;
      const focusables = Array.from(shellNode.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter((el) => el.getClientRects().length > 0);
      const step = focusTrapStep(focusables.length, focusables.indexOf(document.activeElement), e.shiftKey);
      if (step === null) return;
      e.preventDefault();
      if (typeof step === "number" && focusables[step]) focusables[step].focus({ preventScroll: true });
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (prevFocus && prevFocus !== document.body && document.contains(prevFocus) && prevFocus.focus) {
        prevFocus.focus({ preventScroll: true });
      }
    };
  }, []);

  const say = (text) => setAnnounce((a) => ({ n: a.n + 1, text }));

  const lesson = reviewCards
    ? { id: "missed-review", title: "Review what you missed", cards: reviewCards }
    : course.lessons[lessonIdx];
  const card = lesson ? lesson.cards[cardIdx] : null;
  const interactive = isInteractiveCard(card);
  /* Option cards (quiz, cloze, true or false) render in a shuffled
     display order, per attempt, through shuffledOptionsForCard:
     authored order parks the answer at one index, so the Player,
     never the data, decides where each option sits this attempt.
     Every comparison against the learner's pick (isRight, check,
     the option buttons, the feedback sheet) reads displayCorrect
     and displayOptions, so the whole surface agrees on the order
     actually shown. */
  const quizDisplay = useMemo(() => {
    if (!card || (card.kind !== "quiz" && card.kind !== "cloze" && card.kind !== "truefalse" && card.kind !== "visualq" && card.kind !== "predict")) return null;
    return shuffledOptionsForCard(card, hashStr(card.question || card.statement || card.prompt || "") + 59 + shuffleSalt.current + attempt * 131);
  }, [card, attempt]);
  const displayOptions = quizDisplay ? quizDisplay.options : (card ? card.options : null);
  const displayCorrect = quizDisplay ? quizDisplay.correct : (card ? card.correct : null);
  const isRight = interactive && card.kind !== "battle" && (
    card.kind === "match" ? matchMistakes === 0
    : card.kind === "order" || card.kind === "build" ? orderCorrect
    : card.kind === "spoterror" ? picked === card.wrong
    : picked === displayCorrect
  );
  const lessonPct = lesson ? Math.round(((cardIdx + (checked ? 1 : 0)) / lesson.cards.length) * 100) : 0;

  /* Display orders for the tap activities, shuffled per attempt so
     the right column and the item pool are not just the answer key
     read aloud, and a retry never repeats the layout. */
  const matchRights = useMemo(() => {
    if (!card || card.kind !== "match") return [];
    return seededShuffle(card.pairs.map((_, i) => i), hashStr(card.prompt || "") + 31 + shuffleSalt.current + attempt * 131);
  }, [card, attempt]);
  const orderDisplay = useMemo(() => {
    if (!card || (card.kind !== "order" && card.kind !== "build")) return [];
    return seededShuffle(card.items, hashStr(card.prompt || "") + 47 + shuffleSalt.current + attempt * 131);
  }, [card, attempt]);

  const resetCardState = () => {
    setPicked(null); setChecked(false);
    setMatchSel(null); setMatchDone([]); setMatchMistakes(0); setMatchFlash(null);
    setOrderPlaced([]); setOrderCorrect(false); setOrderResult(null);
    setAttempt((n) => n + 1);
  };

  const award = (xp) => { setSessionXp((x) => x + xp); setLastAward(xp); };

  const activeLessonId = reviewCards ? (reviewForId || "missed-review") : (lesson ? lesson.id : null);
  const xpScaleNow = () => lessonXpScale(activeLessonId ? (xpCompletionsRef.current[activeLessonId] || 0) : 0);
  /* Every card award flows through here, so the replay scale
     applies the same way on every card kind, and the announced
     amount is the amount actually paid. */
  const pay = (xp) => {
    const paid = scaleXp(xp, xpScaleNow());
    award(paid);
    onProgress && onProgress(paid, course);
    return paid;
  };

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
        const paid = pay(matchScore(matchMistakes));
        say(clean ? "All pairs matched, first try. Plus " + paid + " XP." : "All pairs matched. Plus " + paid + " XP.");
      } else {
        say("Matched " + doneNow.length + " of " + card.pairs.length + ".");
      }
    } else {
      setMatchMistakes((m) => m + 1);
      setMatchFlash(pairIdx);
      playSound("wrong", soundOn);
      say("That pair does not match.");
      setTimeout(() => setMatchFlash(null), 480);
    }
  };

  /* Order play: tap items in the sequence you believe, tap a placed
     item to take it back, then check. Each step in its right place
     earns its share of the marks, and the explanation carries the
     right order. */
  const orderTap = (item) => {
    if (checked) return;
    setOrderPlaced((placed) => placed.includes(item) ? placed.filter((x) => x !== item) : [...placed, item]);
    playSound("tick", soundOn);
  };
  const checkOrder = () => {
    if (!card || (card.kind !== "order" && card.kind !== "build") || checked) return;
    if (orderPlaced.length !== card.items.length) return;
    const res = orderScore(orderPlaced, card.items);
    setOrderResult(res);
    setOrderCorrect(res.perfect);
    setChecked(true);
    setAnswered((n) => n + 1);
    if (res.perfect) setRight((n) => n + 1); else noteMiss();
    const paid = pay(res.xp);
    playSound(res.perfect ? "correct" : "wrong", soundOn);
    say(res.perfect
      ? "In the right order. Plus " + paid + " XP."
      : res.correctPositions > 0
        ? res.correctPositions + " of " + res.total + " steps in the right place. Plus " + paid + " XP."
        : "Not the right order. Plus " + paid + " XP.");
  };

  const check = () => {
    if (!interactive || picked === null || checked) return;
    if (card.kind === "match" || card.kind === "order" || card.kind === "build") return;
    setChecked(true);
    setAnswered((n) => n + 1);
    if (card.kind === "battle") {
      const paid = pay(XP_BATTLE);
      playSound("tick", soundOn);
      say("Both readings are on the table. Plus " + paid + " XP.");
      return;
    }
    const correct = card.kind === "spoterror" ? picked === card.wrong : picked === displayCorrect;
    if (correct) setRight((n) => n + 1);
    if (!correct) {
      const origin = course.lessons[lessonIdx];
      setMisses((ms) => (ms.some((m) => m.card === card) ? ms : [...ms, { card, lessonTitle: origin ? origin.title : "" }]));
    }
    const paid = pay(correct ? XP_CORRECT : XP_WRONG);
    playSound(correct ? "correct" : "wrong", soundOn);
    say(correct ? "Right. Plus " + paid + " XP." : "Not quite. Plus " + paid + " XP.");
    if (card.claimId && claimsRef.current[card.claimId]) {
      gradeClaim(claimsRef.current, card.claimId, correct);
      saveClaims(claimsRef.current);
    }
  };

  const finishLesson = (markDone) => {
    if (markDone) {
      /* The first lesson this learner ever finishes in this course
         carries the two one line explanations of XP and review, so
         the mechanics are explained once, where they first appear,
         and never nag again. */
      const priorCompletions = Object.values(xpCompletionsRef.current).reduce((a, b) => a + b, 0);
      if (priorCompletions === 0 && !(course.doneLessons || []).length) setFirstFinish(true);
      const done = [...new Set([...(course.doneLessons || []), lesson.id])];
      /* The finish bonus is paid at this lesson's replay scale,
         then the completion is counted, so the next run of the
         lesson pays less. Progress itself is never scaled. */
      const bonus = scaleXp(XP_LESSON_FINISH, xpScaleNow());
      award(bonus);
      onProgress && onProgress(bonus, course, done);
      if (activeLessonId) {
        xpCompletionsRef.current[activeLessonId] = (xpCompletionsRef.current[activeLessonId] || 0) + 1;
      }
      say("Lesson complete. Plus " + bonus + " XP for finishing.");
      if (onLessonDone) {
        onLessonDone(lesson, answered ? Math.round((right / answered) * 100) : 100);
      }
    }
    setShowLessonDone(true);
  };

  const advance = () => {
    if (interactive && !checked) return;
    /* Reading cards (notes, papers, deepen pieces, summaries) earn
       no XP for being advanced past. Points pay for answers and
       finishes, not for turning pages. */
    resetCardState();
    if (cardIdx < lesson.cards.length - 1) { setCardIdx(cardIdx + 1); return; }
    if (reviewCards) {
      /* Completing the miss review is what masters the lesson it
         came from; the parent records it through onReviewDone. */
      if (onReviewDone && reviewForId) onReviewDone(reviewForId);
      say(onReviewDone && reviewForId ? "Review complete. That lesson counts as mastered now." : "Review complete.");
      setReviewCards(null); setReviewForId(null); setCardIdx(0); setShowLessonDone(true);
      return;
    }
    finishLesson(true);
  };

  const startMissReview = (cards) => {
    setReviewForId(lesson ? lesson.id : null);
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
      say("Course complete. Plus " + sessionXp + " XP this session.");
    }
  };

  const btnPrimary = {
    background: accent, color: at, border: "none", borderRadius: 14,
    padding: "15px 30px", fontSize: FONT_SIZES.body, fontWeight: 700, cursor: "pointer",
    fontFamily: "var(--cb-font)", minHeight: 54,
  };

  const shell = (children) => (
    <div ref={shellRef} tabIndex={-1} role="dialog" aria-modal="true"
      aria-label={finished ? "Course complete: " + course.title : "Lesson: " + (lesson ? lesson.title : course.title)}
      style={{
      position: "fixed", inset: 0, zIndex: 210, background: P.bg, color: P.ink,
      overflowY: "auto", fontFamily: "var(--cb-font)", WebkitOverflowScrolling: "touch",
      outline: "none",
    }}>
      <style>{CSS}</style>
      {/* One polite live region for the whole Player: right and wrong
          verdicts, matched counts, and completion are announced,
          never left as colour alone. */}
      <div aria-live="polite" role="status" style={{
        position: "absolute", width: 1, height: 1, margin: -1, padding: 0,
        overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0,
      }}>
        <span key={announce.n}>{announce.text}</span>
      </div>
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
          <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.14em", color: accent, marginBottom: 10 }}>{course.builtin ? "PATH COMPLETE" : "COURSE COMPLETE"}</div>
          <h2 style={{ fontFamily: SERIF, fontSize: FONT_SIZES.hero, fontWeight: 600, margin: "0 0 12px", lineHeight: 1.2 }}>{course.title}</h2>
          <p style={{ color: P.ink2, fontSize: FONT_SIZES.body, lineHeight: 1.6, margin: "0 auto 30px", maxWidth: 440 }}>
            {course.builtin
              ? "Every lesson on this path is done. Your progress is saved on the path, and daily practice will keep pulling activities from it so the ideas stay fresh."
              : "Every question you answered is on your review schedule now. It comes back when it starts to fade, not before."}
          </p>
          {rankSummary && (
            <p style={{ color: P.ink2, fontSize: FONT_SIZES.body, lineHeight: 1.6, margin: "0 auto 18px", maxWidth: 440 }}>
              Your rank: <span style={{ color: P.ink, fontWeight: 700 }}>{rankSummary.name}</span>
              {rankSummary.atTop ? ". Top rung, earned." : " · " + rankSummary.xpToNext + " XP to " + rankSummary.nextName + "."}
            </p>
          )}
          <div style={{ display: "flex", justifyContent: "center", margin: "0 auto 18px" }}>
            <CharacterPose pose="celebrate" size={64} />
          </div>
          <div style={{ margin: "0 auto 18px" }}>
            <ShareCardButton P={P} accent={accent} model={shareCardModel("course", { title: course.title, accuracy: answered ? Math.round((right / answered) * 100) : 100, xp: sessionXp })} />
          </div>
          <div style={{ display: "flex", gap: 14, justifyContent: "center", marginBottom: 36, flexWrap: "wrap" }}>
            <div style={{ background: P.raised, border: "1px solid " + P.line, borderRadius: RADIUS.xl, padding: "16px 26px" }}>
              <div style={{ fontSize: FONT_SIZES.hero, fontWeight: 700, color: accent }}>+{sessionXp}</div>
              <div style={{ fontSize: FONT_SIZES.caption, color: P.faint }}>XP this session</div>
            </div>
            <div style={{ background: P.raised, border: "1px solid " + P.line, borderRadius: RADIUS.xl, padding: "16px 26px" }}>
              <div style={{ fontSize: FONT_SIZES.hero, fontWeight: 700 }}>{answered ? Math.round((right / answered) * 100) + "%" : "·"}</div>
              <div style={{ fontSize: FONT_SIZES.caption, color: P.faint }}>First try accuracy</div>
            </div>
          </div>
          {misses.length > 0 ? (
            <div style={{ textAlign: "left", maxWidth: 520, margin: "0 auto 34px" }}>
              <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.12em", color: accent, marginBottom: 12, textAlign: "center" }}>WORTH ANOTHER LOOK</div>
              {misses.map((m, i) => (
                <div key={i} style={{ background: P.raised, border: "1px solid " + P.line, borderRadius: RADIUS.xl, padding: "16px 18px", marginBottom: 10 }}>
                  <div style={{ fontSize: FONT_SIZES.body, fontWeight: 600, lineHeight: 1.45, marginBottom: 6 }}>{m.card.question || m.card.statement || m.card.prompt}</div>
                  <div style={{ fontSize: FONT_SIZES.body, lineHeight: 1.55, color: P.ink2 }}>
                    {"The idea: "}<span style={{ color: P.ink }}><RichText text={m.card.why} /></span>
                  </div>
                </div>
              ))}
              <p style={{ fontSize: FONT_SIZES.label, color: P.ink2, lineHeight: 1.55, textAlign: "center", margin: "14px 0 0" }}>
                {course.builtin
                  ? "Daily practice pulls from lessons you have finished, so these will come back around."
                  : "These are already on your review schedule, so they will come back while they are still fresh enough to fix."}
              </p>
            </div>
          ) : (
            <p style={{ color: P.ink2, fontSize: FONT_SIZES.body, margin: "0 auto 34px" }}>Clean run. Nothing missed.</p>
          )}
          {course.vocab && course.vocab.length > 0 && (
            <div style={{ textAlign: "left", maxWidth: 520, margin: "0 auto 34px" }}>
              <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.12em", color: accent, marginBottom: 12, textAlign: "center" }}>WORDS FROM THIS COURSE</div>
              {course.vocab.map((v, i) => (
                <div key={i} style={{ background: P.raised, border: "1px solid " + P.line, borderRadius: RADIUS.xl, padding: "14px 18px", marginBottom: 10 }}>
                  <span style={{ fontFamily: SERIF, fontSize: FONT_SIZES.body, fontWeight: 700 }}>{v.term}</span>
                  <div style={{ fontSize: FONT_SIZES.body, lineHeight: 1.55, color: P.ink2, marginTop: 4 }}><RichText text={v.text} /></div>
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
          <button onClick={onExit} aria-label="Close lesson" style={{ background: "none", border: "none", color: P.faint, cursor: "pointer", fontSize: 22, lineHeight: 1, padding: 6, minWidth: 44, minHeight: 44, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>✕</button>
          <span style={{ fontSize: FONT_SIZES.caption, color: P.faint, letterSpacing: "0.05em" }}>LESSON {lessonIdx + 1} OF {course.lessons.length}</span>
          <span style={{ width: 44 }} />
        </div>
        <div className="lv-rise" style={{ textAlign: "center", paddingTop: "6vh" }}>
          <Cover title={course.title} height={150} radius={20} cat={CATALOG.find((c) => c.name === course.category) || null} img={course.img} />
          <h2 style={{ fontFamily: SERIF, fontSize: FONT_SIZES.hero, fontWeight: 600, lineHeight: 1.2, margin: "30px 0 12px" }}>{lesson.title}</h2>
          <p style={{ color: P.ink2, fontSize: FONT_SIZES.body, lineHeight: 1.6, margin: "0 auto 14px", maxWidth: 420 }}>{lesson.subtitle}</p>
          <p style={{ color: P.ink2, fontSize: FONT_SIZES.label, margin: "0 0 22px" }}>{lesson.cards.length} cards · about {Math.max(1, Math.round(lesson.cards.length * 0.4))} min</p>
          {(() => {
            /* The opener rotates with the lesson's position, so a
               path does not feel like the same shape twelve times:
               a picture first where the lesson carries one, a guess
               first, then a story first, repeating. */
            const opener = lessonOpenerStyle(lesson, lessonIdx);
            const line = opener === "visual"
              ? "This one starts with the picture. Look first, then read."
              : opener === "predict"
                ? "This one starts with a guess. Commit to an answer before you check; the correction is what makes it stick."
                : "This one starts with a story. Settle in first, then the checks begin.";
            return (
              <div style={{ display: "inline-block", background: P.raised, border: "1px solid " + P.line, borderRadius: RADIUS.pill, padding: "9px 16px", margin: "0 0 26px" }}>
                <span style={{ fontSize: FONT_SIZES.label, fontWeight: 700, color: accent, letterSpacing: "0.06em" }}>
                  {opener === "visual" ? "START WITH THE PICTURE" : opener === "predict" ? "START WITH A GUESS" : "START WITH A STORY"}
                </span>
                <span style={{ fontSize: FONT_SIZES.label, color: P.ink2 }}> · {line}</span>
              </div>
            );
          })()}
          {(() => {
            const purpose = {
              basics: "The core ideas of this topic, stated plainly. Read them first; the checks that follow ask about exactly these points, and nothing else.",
              deeper: "More of the topic, in the same plain style: read the ideas, then prove you can recall them.",
              vocab: "The words this topic uses, each one inside a statement that uses it. Know the words and the ideas get easier to hold.",
              review: "Every idea from this course, asked again. This is the pass that makes it stick.",
              "missed-review": "The questions you missed, once more while they are still fresh. This pass is where the correction happens.",
            }[lesson.id] || "";
            if (!purpose) return null;
            return (
              <div style={{ textAlign: "left", background: P.raised, border: "1px solid " + P.line, borderRadius: 18, padding: "18px 20px", margin: "0 auto 30px", maxWidth: 440 }}>
                <p style={{ fontSize: FONT_SIZES.body, lineHeight: 1.6, color: P.ink, margin: 0 }}>{purpose}</p>
              </div>
            );
          })()}
          {course.builtin && (
            <div style={{ textAlign: "left", background: P.raised, border: "1px solid " + P.line, borderRadius: 18, padding: "18px 20px", margin: "0 auto 30px", maxWidth: 440 }}>
              <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.12em", color: P.faint, marginBottom: 8 }}>ABOUT THESE LESSONS</div>
              <p style={{ fontSize: FONT_SIZES.body, lineHeight: 1.6, color: P.ink, margin: 0 }}>
                Written for Cortex from standard textbook material. The checks explain the ideas in plain words and quote no single paper. Courses built from a search on the Cortex home teach the same way: plain statements first, then quizzes on the ideas.
              </p>
            </div>
          )}
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
    const lessonXp = sessionXp - xpAtLessonStart.current;
    return shell(
      <div style={{ maxWidth: 620, margin: "0 auto", padding: "72px 24px 48px", textAlign: "center" }}>
        <div className="lv-rise">
          <svg width="60" height="60" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ margin: "0 auto 18px" }}>
            <circle cx="12" cy="12" r="11" stroke={accent} strokeWidth="1.6" />
            <path d="M7 12.5 L10.5 16 L17 8.5" stroke={accent} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="lv-pop" />
          </svg>
          <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.14em", color: accent, marginBottom: 10 }}>LESSON COMPLETE</div>
          <h2 style={{ fontFamily: SERIF, fontSize: FONT_SIZES.hero, fontWeight: 600, margin: "0 0 10px", lineHeight: 1.25 }}>{lesson.title}</h2>
          <p style={{ color: P.ink2, fontSize: FONT_SIZES.body, lineHeight: 1.6, margin: "0 auto 30px", maxWidth: 400 }}>
            {course.builtin
              ? "+" + lessonXp + " XP. This lesson is marked on your path, and the next one is unlocked."
              : "+" + lessonXp + " XP. The questions from this lesson are on your review schedule now."}
          </p>
          <div style={{ display: "flex", justifyContent: "center", margin: "0 auto 6px" }}>
            <CharacterPose pose="celebrate" size={64} />
          </div>
          {rankSummary && (
            <p style={{ color: P.ink2, fontSize: FONT_SIZES.body, lineHeight: 1.6, margin: "0 auto 18px", maxWidth: 400 }}>
              Your rank: <span style={{ color: P.ink, fontWeight: 700 }}>{rankSummary.name}</span>
              {rankSummary.atTop ? ". That is the top rung. It stays yours by keeping the learning going." : " · " + rankSummary.xpToNext + " XP to " + rankSummary.nextName + "."}
            </p>
          )}
          <div style={{ margin: "0 auto 18px" }}>
            <ShareCardButton P={P} accent={accent} model={shareCardModel("lesson", { title: lesson.title, courseTitle: course.title, accuracy: answered ? Math.round((right / answered) * 100) : 100, xp: lessonXp })} />
          </div>
          {goalPicker && (
            <div style={{ textAlign: "left", background: P.raised, border: "1px solid " + P.line, borderRadius: 18, padding: "18px 20px", margin: "0 auto 30px", maxWidth: 440 }}>
              <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.12em", color: P.faint, marginBottom: 8 }}>SET YOUR DAILY GOAL</div>
              <p style={{ fontSize: FONT_SIZES.body, lineHeight: 1.6, color: P.ink, margin: "0 0 14px" }}>
                One win in. How many minutes a day should Cortex ask of you? Small and daily beats big and rare.
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {[5, 10, 15, 20].map((m) => (
                  <button key={m} className="lv-chip" onClick={() => goalPicker.onPick(m)}
                    aria-pressed={goalPicker.minutes === m}
                    style={{
                      borderRadius: RADIUS.pill, padding: "10px 16px", fontSize: FONT_SIZES.body, fontWeight: 700, cursor: "pointer", fontFamily: "var(--cb-font)", minHeight: 48,
                      background: goalPicker.minutes === m ? accent : "transparent",
                      color: goalPicker.minutes === m ? (at || "#101408") : P.ink,
                      border: "1px solid " + (goalPicker.minutes === m ? accent : P.line),
                    }}>
                    {m} min
                  </button>
                ))}
              </div>
            </div>
          )}
          {firstFinish && (
            <div style={{ textAlign: "left", background: P.raised, border: "1px solid " + P.line, borderRadius: 18, padding: "18px 20px", margin: "0 auto 30px", maxWidth: 440 }}>
              <p style={{ fontSize: FONT_SIZES.body, lineHeight: 1.6, color: P.ink, margin: "0 0 10px" }}>
                XP is a progress count for finishing lessons and answering checks. It measures learning done, nothing more.
              </p>
              <p style={{ fontSize: FONT_SIZES.body, lineHeight: 1.6, color: P.ink, margin: 0 }}>
                Review brings back what you learned later, for a quick check, just as it starts to fade: that timing is what makes it stick.
              </p>
            </div>
          )}
          {(() => {
            const lessonMisses = misses.filter((m) => m.lessonTitle === lesson.title);
            if (!lessonMisses.length) return null;
            return (
              <button className="lv-btn" onClick={() => startMissReview(lessonMisses.map((m) => m.card))}
                style={{
                  width: "100%", maxWidth: 340, marginBottom: 12, background: "transparent",
                  border: "1.5px solid " + accent, color: accent, borderRadius: 14,
                  padding: "13px 20px", fontSize: FONT_SIZES.body, fontWeight: 700, cursor: "pointer",
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
            <button onClick={onExit} style={{ background: "none", border: "none", color: P.ink2, cursor: "pointer", fontSize: FONT_SIZES.body, fontFamily: "var(--cb-font)", padding: 8 }}>
              Back to the path
            </button>
          </div>
        </div>
      </div>
    );
  }

  const cardKindLabel = (c) => c.kind === "paper" ? "Read" : c.kind === "cloze" ? "Predict" : c.kind === "battle" ? "Debate" : c.kind === "note" ? "Intro" : c.kind === "summary" ? "Wrap" : c.kind === "match" ? "Match" : c.kind === "order" ? "Order" : c.kind === "build" ? "Build" : c.kind === "visualq" ? "Look" : c.kind === "spoterror" ? "Spot the error" : c.kind === "predict" ? "Predict" : c.kind === "truefalse" ? "True or false" : c.kind === "deepen" ? "Go deeper" : c.vocab ? "Vocab" : "Recall";

  /* Feedback tones are Cerebrum's own, from the design system's
     STATUS palette: the strong hue for borders and the sheet button,
     a wash of it for fills, and the theme aware ink pairing the rest
     of the app uses for status text. No borrowed brand colours.
     The wash is a tint only, never a background on its own: the
     feedback sheet slides up over the card, and a translucent
     sheet double exposes whatever sits beneath it (the garbled
     finding in Dusty's 2026-10-13 photo). The sheet's background
     is the solid surface token with the wash layered over it as
     an image, so the composite is opaque in every palette. */
  const toneGood = STATUS.good;
  const toneBad = STATUS.bad;
  const goodInk = P.dark ? STATUS.good : "#047857";
  const badInk = P.dark ? STATUS.bad : "#b92c31";
  const goodWash = withAlpha(STATUS.good, P.dark ? 0.2 : 0.13);
  const badWash = withAlpha(STATUS.bad, P.dark ? 0.2 : 0.13);

  const sheetGood = checked && (card.kind === "battle" || isRight);
  const sheet = checked ? (
    <div className="lv-sheet" style={{
      position: "sticky", bottom: 0, marginTop: 28,
      backgroundColor: P.surface,
      backgroundImage: "linear-gradient(" + (sheetGood ? goodWash : badWash) + ", " + (sheetGood ? goodWash : badWash) + ")",
      borderTop: "2px solid " + (sheetGood ? toneGood : toneBad),
      borderRadius: "20px 20px 0 0", padding: "20px 22px 24px", color: P.ink,
    }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <div style={{ float: "left", marginRight: 14, marginBottom: 4 }}>
          <CharacterPose pose={sheetGood ? "cheer" : "think"} size={48} />
        </div>
        <div style={{ fontSize: FONT_SIZES.title, fontWeight: 800, marginBottom: 6, color: sheetGood ? goodInk : badInk }}>
          {card.kind === "battle" ? "Two readings, honestly held. That is the point."
            : card.kind === "match" ? (isRight ? "Every pair, first try." : "All pairs matched.")
            : card.kind === "order" || card.kind === "build" ? (orderResult && orderResult.perfect ? (card.kind === "build" ? "Built in the right order." : "In the right order.")
              : orderResult && orderResult.correctPositions > 0 ? orderResult.correctPositions + " of " + orderResult.total + " steps in the right place."
              : "Not the right order.")
            : card.kind === "spoterror" ? (isRight ? "You found the wrong piece." : "That piece is fine.")
            : isRight ? "Right." : "Not quite."}
          <span style={{ float: "right", fontSize: FONT_SIZES.label, fontWeight: 700, color: sheetGood ? goodInk : badInk }}>
            {"+" + lastAward + " XP"}
          </span>
        </div>
        {card.kind === "battle" ? (
          <p style={{ fontSize: FONT_SIZES.body, lineHeight: 1.6, margin: 0, color: P.ink2 || P.ink }}>
            These two readings do not agree, and there is no correct side to pick here. Disagreement at this level usually means the answer depends on conditions, and seeing both sides plainly is the skill being practiced.
          </p>
        ) : (
          <>
            {!isRight && displayOptions && picked !== null && picked !== undefined && (
              <p style={{ fontSize: FONT_SIZES.body, lineHeight: 1.55, margin: "0 0 10px", color: P.ink2 || P.ink }}>
                You picked: <span style={{ fontWeight: 600 }}><RichText text={displayOptions[picked]} /></span>
              </p>
            )}
            {card.kind === "spoterror" && picked !== null && picked !== undefined && (
              <p style={{ fontSize: FONT_SIZES.body, lineHeight: 1.55, margin: "0 0 10px", color: P.ink2 || P.ink }}>
                You picked: <span style={{ fontWeight: 600 }}><RichText text={card.parts[picked]} /></span>
              </p>
            )}
            {card.kind === "predict" && card.outcome && (
              <>
                <p style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.1em", color: P.faint, margin: "0 0 4px" }}>WHAT ACTUALLY HAPPENS</p>
                <p style={{ fontSize: FONT_SIZES.body, lineHeight: 1.6, margin: "0 0 12px", color: P.ink }}><RichText text={card.outcome} /></p>
              </>
            )}
            <p style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.1em", color: P.faint, margin: "0 0 4px" }}>WHY</p>
            <p style={{ fontFamily: SERIF, fontSize: FONT_SIZES.body, lineHeight: 1.6, margin: 0, color: P.ink }}><RichText text={card.why} /></p>
            {card.kind === "spoterror" && (
              <p style={{ fontSize: FONT_SIZES.body, lineHeight: 1.6, margin: "10px 0 0", color: P.ink }}>
                The wrong piece says: <span style={{ fontWeight: 600 }}><RichText text={card.parts[card.wrong]} /></span><br />
                It should say: <span style={{ fontWeight: 600 }}><RichText text={card.fix} /></span>
              </p>
            )}
          </>
        )}
        <button className="lv-btn" onClick={advance}
          style={{
            marginTop: 18, width: "100%", background: sheetGood ? toneGood : toneBad, color: accentText(sheetGood ? toneGood : toneBad),
            border: "none", borderRadius: 14, padding: "15px 24px", fontSize: FONT_SIZES.body, fontWeight: 800,
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
          <button onClick={onExit} aria-label="Close lesson" style={{ background: "none", border: "none", color: P.faint, cursor: "pointer", fontSize: 21, lineHeight: 1, padding: 4, minWidth: 44, minHeight: 44, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>✕</button>
          <div style={{ display: "flex", gap: 5, flex: 1 }}>
            {course.lessons.map((l, li) => (
              <div key={l.id} style={{ flex: 1, height: 10, borderRadius: RADIUS.pill, background: P.line, overflow: "hidden" }}>
                <div className="lv-fill" style={{
                  height: "100%", borderRadius: RADIUS.pill,
                  width: (li < lessonIdx || (li === lessonIdx && showLessonDone) ? 100 : li === lessonIdx ? lessonPct : 0) + "%",
                  background: "linear-gradient(rgba(255,255,255,.38), rgba(255,255,255,0) 48%), " + accent,
                }} />
              </div>
            ))}
          </div>
          <span style={{ fontSize: FONT_SIZES.label, fontWeight: 700, color: accent, minWidth: 52, textAlign: "right" }}>{sessionXp > 0 ? "+" + sessionXp + " XP" : ""}</span>
        </div>
        <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, letterSpacing: "0.05em", marginTop: 12 }}>
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
              <span style={{ position: "absolute", left: 16, bottom: 10, color: "#fff", fontFamily: SERIF, fontSize: FONT_SIZES.body, fontWeight: 600 }}>{lesson.title}</span>
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
                  <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.13em", color: course.img ? "#cfe8b8" : accent, marginBottom: 10 }}>{(card.kicker || "").toUpperCase()}</div>
                  <h2 style={{ fontFamily: SERIF, fontSize: FONT_SIZES.display, fontWeight: 600, lineHeight: 1.22, margin: 0, color: course.img ? "#fff" : P.ink }}>{card.title}</h2>
                </div>
              </div>
              {(card.visual || card.diagram) && (
                <>
                  <CardVisual src={card.visual} P={P} accent={accent} />
                  <DiagramArt diagram={card.diagram} P={P} accent={accent} />
                </>
              )}
              <p style={{ fontSize: FONT_SIZES.title, color: P.ink2, lineHeight: 1.65, margin: 0 }}><RichText text={card.text} /></p>
              {lesson.id === "vocab" && course.vocab && course.vocab.length > 0 && (
                <div style={{ marginTop: 26 }}>
                  <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.12em", color: P.faint, marginBottom: 12 }}>THE WORDS AHEAD</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {course.vocab.map((v, i) => (
                      <span key={i} style={{ fontFamily: SERIF, fontSize: FONT_SIZES.body, fontWeight: 600, color: P.ink, background: P.raised, border: "1px solid " + P.line, borderRadius: RADIUS.pill, padding: "7px 14px" }}>{v.term}</span>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ marginTop: 28 }}>
                <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.12em", color: P.faint, marginBottom: 12 }}>THE SHAPE OF THIS LESSON</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 7, alignItems: "center" }}>
                  {lesson.cards.map((c, i) => (
                    <span key={i} style={{
                      fontSize: FONT_SIZES.label, fontWeight: i === cardIdx ? 800 : 600, borderRadius: RADIUS.pill, padding: "6px 12px",
                      color: i === cardIdx ? "#14240a" : P.ink2,
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
              {/* Reading cards from courses stored before the pivot:
                 the passage is kept, but it renders as plain teaching
                 text now. No title of any paper, no meta line, no
                 citation furniture: the flow does not display them. */}
              <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.13em", color: accent, marginBottom: 14 }}>READ</div>
              {card.text && (
                <div style={{ background: P.raised, border: "1px solid " + P.line, borderRadius: RADIUS.xl, padding: "19px 21px" }}>
                  <p style={{ fontFamily: SERIF, fontSize: FONT_SIZES.title, lineHeight: 1.62, margin: 0 }}>{emphasizeFinding(card.text, accent)}</p>
                </div>
              )}
              <p style={{ fontSize: FONT_SIZES.body, color: P.ink2, lineHeight: 1.55, margin: "24px 0 0" }}>Read it once, slowly. The next card asks you to recall it.</p>
            </div>
          )}

          {(card.kind === "quiz" || card.kind === "cloze" || card.kind === "visualq" || card.kind === "predict") && (
            <div>
              <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.13em", color: accent, marginBottom: 14 }}>
                {card.vocab ? "VOCABULARY · TERMS IN CONTEXT" : card.kind === "cloze" ? "PREDICT THE RESULT" : card.kind === "visualq" ? "LOOK AT THE PICTURE" : card.kind === "predict" ? "PREDICT WHAT HAPPENS" : "RECALL"}
              </div>
              <h2 style={{ fontFamily: SERIF, fontSize: FONT_SIZES.display, fontWeight: 600, lineHeight: 1.4, margin: "0 0 10px" }}>{card.question}</h2>
              {card.kind === "visualq" && (
                <>
                  <CardVisual src={card.visual} P={P} accent={accent} />
                  <DiagramArt diagram={card.diagram} P={P} accent={accent} />
                </>
              )}
              {card.prompt && (
                <div style={{ background: P.raised, border: "1px solid " + P.line, borderLeft: "4px solid " + accent, borderRadius: RADIUS.xl, padding: "17px 19px", margin: "4px 0 10px" }}>
                  <p style={{ fontFamily: SERIF, fontSize: FONT_SIZES.title, lineHeight: 1.6, margin: 0 }}><RichText text={card.prompt} /></p>
                </div>
              )}
              <div style={card.vocab
                ? { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 18 }
                : { display: "flex", flexDirection: "column", gap: 10, marginTop: 18 }}>
                {(displayOptions || []).map((opt, i) => {
                  let bg = P.dark ? "#242b24" : "#ffffff", border = P.line, color = P.ink;
                  if (checked && i === displayCorrect) { bg = goodWash; border = toneGood; color = P.ink; }
                  else if (checked && i === picked) { bg = badWash; border = toneBad; color = P.ink; }
                  else if (!checked && picked === i) { bg = P.dark ? "#274b63" : "#DDF4FF"; border = "#84D8FF"; color = P.ink; }
                  return (
                    <button key={i} className={"lv-opt" + (checked && picked === i && i !== displayCorrect ? " lv-shake" : "")}
                      onClick={() => pick(i)} disabled={checked}
                      style={{
                        appearance: "none", WebkitAppearance: "none", width: "100%", boxSizing: "border-box",
                        background: bg, backgroundColor: bg, border: "2px solid " + border, borderRadius: RADIUS.xl,
                        padding: "15px 18px", fontSize: card.kind === "cloze" ? FONT_SIZES.title : FONT_SIZES.body, lineHeight: 1.5,
                        color, cursor: checked ? "default" : "pointer", textAlign: "left",
                        fontFamily: "var(--cb-font)", minHeight: 54, display: "flex", gap: 12, alignItems: "flex-start",
                      }}>
                      <span aria-hidden="true" style={{
                        flexShrink: 0, width: 26, height: 26, borderRadius: RADIUS.md, marginTop: 1,
                        border: "1.5px solid " + (checked && i === displayCorrect ? toneGood : checked && i === picked ? toneBad : border),
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: FONT_SIZES.label, fontWeight: 700, color: checked && i === displayCorrect ? goodInk : color, opacity: 0.9,
                      }}>{checked && i === displayCorrect ? "✓" : "ABCD"[i] || ""}</span>
                      <span style={{ minWidth: 0, overflowWrap: "break-word" }}><RichText text={opt} /></span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {card.kind === "battle" && (
            <div>
              <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.13em", color: accent, marginBottom: 14 }}>CLAIM BATTLE · TWO READINGS</div>
              <h2 style={{ fontFamily: SERIF, fontSize: FONT_SIZES.display, fontWeight: 600, lineHeight: 1.4, margin: "0 0 20px" }}>{card.question}</h2>
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
                      <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.1em", color: accent, marginBottom: 9 }}>{side.tag}</div>
                      <p style={{ fontFamily: SERIF, fontSize: FONT_SIZES.title, lineHeight: 1.55, margin: 0 }}><RichText text={side.claim} /></p>
                    </button>
                  );
                  if (i === 0) return [btn];
                  return [(
                    <div key="vs" style={{ display: "flex", justifyContent: "center", margin: "-13px 0", position: "relative", zIndex: 1 }}>
                      <span style={{
                        width: 40, height: 40, borderRadius: "50%", background: accent, color: "#14240a",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: FONT_SIZES.label, fontWeight: 800, border: "3px solid " + P.bg, boxSizing: "border-box",
                      }}>VS</span>
                    </div>
                  ), btn];
                })}
              </div>
            </div>
          )}

          {card.kind === "truefalse" && (
            <div>
              <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.13em", color: accent, marginBottom: 14 }}>TRUE OR FALSE</div>
              <div style={{ background: P.raised, border: "1px solid " + P.line, borderLeft: "4px solid " + accent, borderRadius: RADIUS.xl, padding: "19px 21px", marginBottom: 20 }}>
                <p style={{ fontFamily: SERIF, fontSize: FONT_SIZES.title, lineHeight: 1.55, margin: 0 }}><RichText text={card.statement} /></p>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {(displayOptions || ["True", "False"]).map((label, i) => {
                  let bg = P.dark ? "#242b24" : "#ffffff", border = P.line, color = P.ink;
                  if (checked && i === displayCorrect) { bg = goodWash; border = toneGood; color = P.ink; }
                  else if (checked && i === picked) { bg = badWash; border = toneBad; color = P.ink; }
                  else if (!checked && picked === i) { bg = P.dark ? "#274b63" : "#DDF4FF"; border = "#84D8FF"; color = P.ink; }
                  return (
                    <button key={label} className={"lv-opt" + (checked && picked === i && i !== displayCorrect ? " lv-shake" : "")}
                      onClick={() => pick(i)} disabled={checked}
                      style={{
                        appearance: "none", WebkitAppearance: "none", background: bg, backgroundColor: bg,
                        border: "2px solid " + border, borderRadius: RADIUS.xl, padding: "18px 12px",
                        fontSize: FONT_SIZES.title, fontWeight: 700, color, cursor: checked ? "default" : "pointer",
                        fontFamily: "var(--cb-font)", minHeight: 62,
                      }}>
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {card.kind === "spoterror" && (
            <div>
              <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.13em", color: accent, marginBottom: 14 }}>SPOT THE ERROR</div>
              <h2 style={{ fontFamily: SERIF, fontSize: FONT_SIZES.display, fontWeight: 600, lineHeight: 1.4, margin: "0 0 8px" }}>{card.prompt}</h2>
              <p style={{ fontSize: FONT_SIZES.body, color: P.ink2, margin: "0 0 4px", lineHeight: 1.55 }}>The claim below is built from pieces. Exactly one piece is wrong. Tap it, then check.</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 18 }}>
                {(card.parts || []).map((part, i) => {
                  let bg = P.dark ? "#242b24" : "#ffffff", border = P.line, color = P.ink;
                  if (checked && i === card.wrong) { bg = badWash; border = toneBad; color = P.ink; }
                  else if (checked && i === picked) { bg = goodWash; border = toneGood; color = P.ink; }
                  else if (!checked && picked === i) { bg = P.dark ? "#274b63" : "#DDF4FF"; border = "#84D8FF"; color = P.ink; }
                  return (
                    <button key={i} className={"lv-opt" + (checked && picked === i && i !== card.wrong ? " lv-shake" : "")}
                      onClick={() => pick(i)} disabled={checked} aria-pressed={picked === i}
                      style={{
                        appearance: "none", WebkitAppearance: "none", width: "100%", boxSizing: "border-box",
                        background: bg, backgroundColor: bg, border: "2px solid " + border, borderRadius: RADIUS.xl,
                        padding: "15px 18px", fontSize: FONT_SIZES.body, lineHeight: 1.5,
                        color, cursor: checked ? "default" : "pointer", textAlign: "left",
                        fontFamily: "var(--cb-font)", minHeight: 54,
                      }}>
                      <RichText text={part} />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {card.kind === "match" && (
            <div>
              <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.13em", color: accent, marginBottom: 14 }}>MATCH THE PAIRS</div>
              <h2 style={{ fontFamily: SERIF, fontSize: FONT_SIZES.display, fontWeight: 600, lineHeight: 1.4, margin: "0 0 8px" }}>{card.prompt}</h2>
              <p style={{ fontSize: FONT_SIZES.body, color: P.ink2, margin: "0 0 4px", lineHeight: 1.55 }}>Tap a word on the left, then tap the meaning it belongs with on the right.</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 18 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {card.pairs.map((pair, i) => {
                    const donePair = matchDone.includes(i);
                    const selected = matchSel === i;
                    return (
                      <button key={"l" + i} onClick={() => matchLeftTap(i)} disabled={donePair || checked}
                        className="lv-opt" aria-pressed={selected || donePair}
                        style={{
                          appearance: "none", WebkitAppearance: "none", width: "100%", boxSizing: "border-box",
                          background: donePair ? goodWash : selected ? (P.dark ? "#274b63" : "#DDF4FF") : (P.dark ? "#242b24" : "#ffffff"),
                          border: "2px solid " + (donePair ? toneGood : selected ? "#84D8FF" : P.line), borderRadius: 14,
                          padding: "13px 14px", fontSize: FONT_SIZES.body, fontWeight: 700, lineHeight: 1.45, textAlign: "left",
                          color: P.ink, cursor: donePair || checked ? "default" : "pointer",
                          fontFamily: "var(--cb-font)", minHeight: 52,
                        }}>
                        <RichText text={pair.left} />{donePair ? " ✓" : ""}
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
                        className={"lv-opt" + (flash ? " lv-shake" : "")} aria-pressed={donePair}
                        style={{
                          appearance: "none", WebkitAppearance: "none", width: "100%", boxSizing: "border-box",
                          background: donePair ? goodWash : flash ? badWash : (P.dark ? "#242b24" : "#ffffff"),
                          border: "2px solid " + (donePair ? toneGood : flash ? toneBad : P.line), borderRadius: 14,
                          padding: "13px 14px", fontSize: FONT_SIZES.body, lineHeight: 1.5, textAlign: "left",
                          color: P.ink, cursor: donePair || checked ? "default" : "pointer",
                          fontFamily: "var(--cb-font)", minHeight: 52,
                        }}>
                        <RichText text={card.pairs[pairIdx].right} />
                      </button>
                    );
                  })}
                </div>
              </div>
              <p style={{ fontSize: FONT_SIZES.label, color: P.ink2, margin: "16px 0 0" }}>
                {matchDone.length} of {card.pairs.length} matched{matchMistakes > 0 ? " · " + matchMistakes + (matchMistakes === 1 ? " miss" : " misses") : ""}
              </p>
            </div>
          )}

          {(card.kind === "order" || card.kind === "build") && (
            <div>
              <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.13em", color: accent, marginBottom: 14 }}>{card.kind === "build" ? "BUILD THE SYSTEM" : "PUT IT IN ORDER"}</div>
              <h2 style={{ fontFamily: SERIF, fontSize: FONT_SIZES.display, fontWeight: 600, lineHeight: 1.4, margin: "0 0 8px" }}>{card.prompt}</h2>
              <p style={{ fontSize: FONT_SIZES.body, color: P.ink2, margin: "0 0 4px", lineHeight: 1.55 }}>{card.kind === "build" ? "Tap the parts in the order the system runs. Tap a placed part to take it back." : "Tap the steps in the order they happen. Tap a placed step to take it back."}</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 9, margin: "20px 0 18px" }}>
                {orderPlaced.length === 0 && (
                  <p style={{ fontSize: FONT_SIZES.body, color: P.ink2, margin: 0, border: "1.5px dashed " + P.line, borderRadius: 14, padding: "15px 16px" }}>Your order will appear here.</p>
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
                        background: rightHere ? goodWash : wrongHere ? badWash : withAlphaSafe(accent, P.dark ? 0.2 : 0.12),
                        border: "2px solid " + (rightHere ? toneGood : wrongHere ? toneBad : accent), borderRadius: 14,
                        padding: "12px 15px", fontSize: FONT_SIZES.body, lineHeight: 1.45,
                        color: P.ink,
                        cursor: checked ? "default" : "pointer", fontFamily: "var(--cb-font)", minHeight: 52,
                      }}>
                      <span aria-hidden="true" style={{
                        flexShrink: 0, width: 26, height: 26, borderRadius: "50%",
                        background: rightHere ? toneGood : wrongHere ? toneBad : accent, color: rightHere ? accentText(toneGood) : "#fff",
                        display: "flex", alignItems: "center", justifyContent: "center", fontSize: FONT_SIZES.label, fontWeight: 800,
                      }}>{i + 1}</span>
                      <span style={{ minWidth: 0 }}><RichText text={item} /></span>
                    </button>
                  );
                })}
              </div>
              {orderDisplay.filter((item) => !orderPlaced.includes(item)).length > 0 && (
                <>
                  <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.12em", color: P.faint, marginBottom: 10 }}>THE STEPS</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 9 }}>
                    {orderDisplay.filter((item) => !orderPlaced.includes(item)).map((item) => (
                      <button key={"pool" + item} onClick={() => orderTap(item)} disabled={checked}
                        className="lv-opt"
                        style={{
                          appearance: "none", WebkitAppearance: "none", boxSizing: "border-box",
                          background: P.dark ? "#242b24" : "#ffffff", border: "2px solid " + P.line, borderRadius: RADIUS.pill,
                          padding: "10px 16px", fontSize: FONT_SIZES.body, fontWeight: 600, lineHeight: 1.4,
                          color: P.ink, cursor: checked ? "default" : "pointer", fontFamily: "var(--cb-font)", minHeight: 46,
                        }}>
                        <RichText text={item} />
                      </button>
                    ))}
                  </div>
                </>
              )}
              {checked && !orderCorrect && (
                <p style={{ fontSize: FONT_SIZES.body, color: P.ink2, margin: "18px 0 0", lineHeight: 1.6 }}>
                  The right order: {card.items.join(", then ")}.
                </p>
              )}
            </div>
          )}

          {card.kind === "deepen" && (
            <div>
              <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.13em", color: accent, marginBottom: 14 }}>GO DEEPER · OPTIONAL</div>
              <div style={{ background: P.raised, border: "1px solid " + P.line, borderLeft: "4px solid " + accent, borderRadius: RADIUS.xl, padding: "20px 22px" }}>
                <p style={{ fontSize: FONT_SIZES.title, lineHeight: 1.65, margin: 0 }}><RichText text={card.text} /></p>
              </div>
              <p style={{ fontSize: FONT_SIZES.body, color: P.ink2, lineHeight: 1.55, margin: "16px 0 0" }}>
                This lesson stands on its own. The catalog on the Cortex home teaches more subjects in this same style.
              </p>
            </div>
          )}

          {card.kind === "summary" && (
            <div>
              <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.13em", color: accent, marginBottom: 14 }}>WRAP UP</div>
              <h2 style={{ fontFamily: SERIF, fontSize: FONT_SIZES.display, fontWeight: 600, lineHeight: 1.25, margin: "0 0 16px" }}>{card.title}</h2>
              <p style={{ fontSize: FONT_SIZES.title, color: P.ink2, lineHeight: 1.65, margin: 0 }}><RichText text={card.text} /></p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 24 }}>
                <span style={{ fontSize: FONT_SIZES.label, fontWeight: 700, color: P.ink, background: P.raised, border: "1px solid " + P.line, borderRadius: RADIUS.pill, padding: "8px 15px" }}>{course.lessons.length} lessons</span>
                {course.vocab && course.vocab.length > 0 && (
                  <span style={{ fontSize: FONT_SIZES.label, fontWeight: 700, color: P.ink, background: P.raised, border: "1px solid " + P.line, borderRadius: RADIUS.pill, padding: "8px 15px" }}>{course.vocab.length} terms met</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* bottom action bar / feedback sheet. The bar is solid P.bg,
          not a fade from transparent: it carries the Check button
          over scrolling card content, and a translucent bar lets
          that content show through under the button. Same rule as
          the feedback sheet above. */}
      {checked ? sheet : (
        <div style={{ position: "sticky", bottom: 0, padding: "14px 24px 22px", background: P.bg }}>
          <div style={{ maxWidth: 640, margin: "0 auto" }}>
            {card.kind === "match" ? (
              <button className="lv-btn" disabled
                style={{ ...btnPrimary, width: "100%", opacity: 0.45, cursor: "default" }}>
                Match every pair to finish
              </button>
            ) : card.kind === "order" || card.kind === "build" ? (
              <button className="lv-btn lv-btn-primary"
                style={{
                  ...btnPrimary, width: "100%",
                  opacity: orderPlaced.length !== card.items.length ? 0.45 : 1,
                  cursor: orderPlaced.length !== card.items.length ? "default" : "pointer",
                }}
                onClick={checkOrder} disabled={orderPlaced.length !== card.items.length}>
                {card.kind === "build" ? "Check build" : "Check order"}
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
      <button onClick={onBack} style={{ background: "none", border: "none", color: P.ink2, cursor: "pointer", fontSize: FONT_SIZES.body, fontFamily: "var(--cb-font)", padding: "4px 0", marginBottom: 16 }}>
        ← All courses
      </button>
      <div className="lv-rise">
        <Cover title={course.title} height={168} radius={22} cat={CATALOG.find((c) => c.name === course.category) || null} img={course.img} />
        <h2 style={{ fontFamily: SERIF, fontSize: FONT_SIZES.hero, fontWeight: 600, lineHeight: 1.22, margin: "22px 0 8px", color: P.ink }}>{course.title}</h2>
        <p style={{ color: P.ink2, fontSize: FONT_SIZES.body, margin: "0 0 6px" }}>
          {course.lessons.length} lessons · {(course.vocab || []).length} terms · {course.xpEarned || 0} XP earned
        </p>
        <div style={{ margin: "14px 0 30px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: FONT_SIZES.caption, color: P.faint, marginBottom: 6 }}>
            <span>Memory strength</span><span>{mem.label}</span>
          </div>
          <div style={{ height: 8, borderRadius: RADIUS.pill, background: P.line, overflow: "hidden" }}>
            <div className="lv-fill" style={{ width: mem.pct + "%", height: "100%", background: accent, borderRadius: RADIUS.pill }} />
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
                color: isDone ? at : isNext ? accent : P.faint,
                fontWeight: 800, fontSize: FONT_SIZES.body, fontFamily: "var(--cb-font)",
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
                  <span style={{ fontFamily: SERIF, fontSize: FONT_SIZES.title, fontWeight: 600, lineHeight: 1.3 }}>{lesson.title}</span>
                  <span style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.06em", color: isDone ? accent : P.faint, flexShrink: 0 }}>
                    {isDone ? "DONE" : isNext ? "UP NEXT" : lesson.cards.length + " CARDS"}
                  </span>
                </div>
                <p style={{ color: P.ink2, fontSize: FONT_SIZES.body, lineHeight: 1.5, margin: "5px 0 0" }}>{lesson.subtitle}</p>
              </button>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 8, borderTop: "1px solid " + P.line, paddingTop: 20 }}>
        {confirmDelete ? (
          <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span style={{ fontSize: FONT_SIZES.body, color: P.ink2 }}>Delete this course and its review schedule?</span>
            <button onClick={onDelete} style={{ background: STATUS.bad, color: "#fff", border: "none", borderRadius: 9, padding: "8px 14px", fontSize: FONT_SIZES.label, fontWeight: 700, cursor: "pointer", fontFamily: "var(--cb-font)" }}>Delete</button>
            <button onClick={() => setConfirmDelete(false)} style={{ background: "transparent", color: P.ink2, border: "1px solid " + P.line, borderRadius: 9, padding: "8px 14px", fontSize: FONT_SIZES.label, cursor: "pointer", fontFamily: "var(--cb-font)" }}>Keep</button>
          </span>
        ) : (
          <button onClick={() => setConfirmDelete(true)} style={{ background: "none", border: "none", color: P.ink2, cursor: "pointer", fontSize: FONT_SIZES.label, fontFamily: "var(--cb-font)", padding: 0 }}>
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
      <button onClick={onBack} style={{ background: "none", border: "none", color: P.ink2, cursor: "pointer", fontSize: FONT_SIZES.body, fontFamily: "var(--cb-font)", padding: "4px 0", marginBottom: 16 }}>
        ← Cortex home
      </button>
      <div className="lv-rise">
        <Cover title={path.title} height={168} radius={22} cat={CATALOG.find((c) => c.name === path.category) || null} />
        <h2 style={{ fontFamily: SERIF, fontSize: FONT_SIZES.hero, fontWeight: 600, lineHeight: 1.22, margin: "22px 0 8px", color: P.ink }}>{path.title}</h2>
        <p style={{ color: P.ink2, fontSize: FONT_SIZES.body, lineHeight: 1.55, margin: "0 0 6px" }}>{path.blurb}</p>
        <p style={{ color: P.ink2, fontSize: FONT_SIZES.body, margin: 0 }}>
          {pp.total} lessons · {path.units.length} unit{path.units.length === 1 ? "" : "s"} · taught directly, no papers needed
        </p>
        <p style={{ color: P.ink2, fontSize: FONT_SIZES.body, lineHeight: 1.55, margin: "6px 0 0" }}>
          Written for Cortex from standard textbook material. These lessons teach the ideas directly and quote no single paper. Courses built from your searches teach the same way: plain statements first, then quizzes on the ideas.
        </p>
        <div style={{ margin: "16px 0 6px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: FONT_SIZES.caption, color: P.faint, marginBottom: 6 }}>
            <span>Path progress</span><span>{pp.done} of {pp.total} done · {pp.mastered} mastered</span>
          </div>
          <div style={{ height: 8, borderRadius: RADIUS.pill, background: P.line, overflow: "hidden" }}>
            <div className="lv-fill" style={{ width: pp.pct + "%", height: "100%", background: accent, borderRadius: RADIUS.pill }} />
          </div>
        </div>
        <p style={{ color: P.ink2, fontSize: FONT_SIZES.label, lineHeight: 1.55, margin: "10px 0 0" }}>
          Filled stops are ground you own. A stop marked fading is a finished lesson whose review has come due: it is still yours, and a short review session from the Cortex home brings it back to full strength.
        </p>
      </div>

      {path.units.map((unit, ui) => (
        <div key={unit.id} style={{ marginTop: 34 }}>
          <div style={{
            background: withAlphaSafe(accent, P.dark ? 0.16 : 0.1), border: "1px solid " + P.line,
            borderRadius: 18, padding: "16px 20px", marginBottom: 26,
          }}>
            <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.12em", color: accent, marginBottom: 5 }}>UNIT {ui + 1}</div>
            <div style={{ fontFamily: SERIF, fontSize: FONT_SIZES.title, fontWeight: 600, lineHeight: 1.3, color: P.ink }}>{unit.title}</div>
            <p style={{ color: P.ink2, fontSize: FONT_SIZES.body, lineHeight: 1.5, margin: "4px 0 0" }}>{unit.subtitle}</p>
          </div>
          {unit.lessons.map((lesson, li) => {
            const flatIdx = flattenPathLessons(path).findIndex((l) => l.id === lesson.id);
            const rec = store[lesson.id];
            const isDone = !!(rec && rec.done);
            const mastered = isLessonMastered(rec);
            const fading = isLessonFading(rec);
            const unlocked = isLessonUnlocked(path, lesson.id, progress);
            const isCurrent = unlocked && !isDone;
            const offset = offsets[(flatIdx + li) % offsets.length];
            return (
              <div key={lesson.id} style={{ display: "flex", gap: 16, alignItems: "flex-start", marginLeft: offset, marginBottom: 22, maxWidth: 520 }}>
                <div aria-hidden="true" className={isCurrent ? "lv-pulse" : ""}
                  style={{
                    flexShrink: 0, width: 56, height: 56, borderRadius: "50%",
                    background: mastered ? accent : P.raised,
                    border: (fading ? "2px dashed " : "2px solid ") + (mastered || isDone || isCurrent ? accent : P.line),
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: mastered ? at : isDone || isCurrent ? accent : P.faint,
                    fontWeight: 800, fontSize: FONT_SIZES.title, fontFamily: "var(--cb-font)",
                    opacity: fading ? 0.72 : 1,
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
                    <span style={{ fontFamily: SERIF, fontSize: FONT_SIZES.title, fontWeight: 600, lineHeight: 1.3 }}>{lesson.title}</span>
                    <span style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.06em", color: mastered || isDone || isCurrent ? accent : P.faint, flexShrink: 0 }}>
                      {mastered ? "MASTERED" : fading ? "FADING" : isDone ? "DONE" : isCurrent ? "UP NEXT" : "LOCKED"}
                    </span>
                  </span>
                  <span style={{ display: "block", color: P.ink2, fontSize: FONT_SIZES.body, lineHeight: 1.5, marginTop: 5 }}>{lesson.subtitle}</span>
                  <span style={{ display: "block", fontSize: FONT_SIZES.caption, color: P.faint, marginTop: 8 }}>
                    {fading
                      ? "Finished, and its review is due. A review session from the home brings it back."
                      : mastered
                      ? "Mastered · best score " + (rec.best || 0) + "% · tap to play again"
                      : isDone
                        ? "Best score " + (rec.best || 0) + "% · done, not mastered yet. Reach " + MASTERY_MIN_PCT + "% or clear the review of your misses to master it"
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
   follow a path, guess first, check, review on schedule. */
const TOUR_STEPS = [
  {
    title: "Start with a path",
    body: "The learning paths teach whole subjects in order: sleep, evolution, quantum machines, and more, broken into short lessons with checks the whole way.",
  },
  {
    title: "Lessons teach first, then check",
    body: "Every lesson explains an idea in plain words, in small steps, and only then quizzes you on it. Nothing is asked that was not taught, and every check explains why in the feedback.",
  },
  {
    title: "The catalog is twenty four taught topics",
    body: "The catalog courses are written for Cortex from standard textbook material, the same plain teaching as the paths. A course built from a search works the same way: its lessons state the ideas plainly and quiz the ideas, never the reading.",
  },
  {
    title: "Review makes it stick",
    body: "Finishing earns XP, and daily practice keeps finished lessons in rotation. Questions you answered join a review schedule, coming back right before they would fade.",
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
        <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.12em", color: P.faint, marginBottom: 8 }}>
          HOW CORTEX WORKS · {step + 1} OF {TOUR_STEPS.length}
        </div>
        <h2 style={{ fontFamily: SERIF, fontSize: FONT_SIZES.display, fontWeight: 600, margin: "0 0 10px", lineHeight: 1.25 }}>{s.title}</h2>
        <p style={{ fontSize: FONT_SIZES.body, lineHeight: 1.65, color: P.ink2, margin: "0 0 24px" }}>{s.body}</p>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
          {TOUR_STEPS.map((_, i) => (
            <span key={i} style={{
              width: i === step ? 22 : 8, height: 8, borderRadius: RADIUS.pill,
              background: i === step ? accent : P.line, transition: "all .25s",
            }} />
          ))}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {step > 0 && (
            <button className="lv-btn" onClick={() => setStep(step - 1)}
              style={{ background: "transparent", border: "1px solid " + P.line, color: P.ink, borderRadius: RADIUS.lg, padding: "13px 20px", fontSize: FONT_SIZES.body, fontWeight: 600, cursor: "pointer", fontFamily: "var(--cb-font)", minHeight: 50 }}>
              Back
            </button>
          )}
          <button className="lv-btn lv-btn-primary" onClick={() => (last ? onClose() : setStep(step + 1))}
            style={{ flex: 1, background: accent, color: at || "#101408", border: "none", borderRadius: RADIUS.lg, padding: "13px 20px", fontSize: FONT_SIZES.body, fontWeight: 700, cursor: "pointer", fontFamily: "var(--cb-font)", minHeight: 50 }}>
            {last ? "Start learning" : "Next"}
          </button>
        </div>
        {!last && (
          <button onClick={onClose} style={{ background: "none", border: "none", color: P.ink2, cursor: "pointer", fontSize: FONT_SIZES.label, fontFamily: "var(--cb-font)", padding: "12px 0 0", display: "block", margin: "0 auto" }}>
            Skip the tour
          </button>
        )}
      </div>
    </div>
  );
}

/* ── first run onboarding (redesign, 2026-10-14) ───────────────────
   Three short questions, then straight into a first lesson. What
   are you curious about (which sets the first path), how many
   minutes a day (which becomes the daily goal, adjustable later
   on the first win screen), and when Cortex should remind you.
   No account wall, no tour first: the first lesson starts inside
   the first minute, and the goal is set for real on the win
   screen while the feeling is warm. */
const ONBOARDING_CHOICES = [
  { id: "the-human-body", label: "The human body", note: "Hearts, blood, senses, and the machinery of you" },
  { id: "space-and-the-solar-system", label: "Space", note: "Planets, stars, gravity, and the far beyond" },
  { id: "earth-and-weather", label: "Earth and weather", note: "Water, air, rocks, and the restless planet" },
  { id: "how-science-works", label: "How science works", note: "Questions, evidence, and honest answers" },
  { id: "everything", label: "A bit of everything", note: "Start with the water cycle, then wander" },
];
const ONBOARDING_FIRST_LESSON = {
  "the-human-body": "the-human-body",
  "space-and-the-solar-system": "space-and-the-solar-system",
  "earth-and-weather": "earth-and-weather",
  "how-science-works": "how-science-works",
  everything: "earth-and-weather",
};

function OnboardingFlow({ P, accent, at, onDone, onSkip }) {
  const [step, setStep] = useState(0);
  const [curiosity, setCuriosity] = useState("everything");
  const [minutes, setMinutes] = useState(5);
  const [reminderHour, setReminderHour] = useState(null);
  const chip = (active) => ({
    borderRadius: RADIUS.pill, padding: "11px 18px", fontSize: FONT_SIZES.body, fontWeight: 700,
    cursor: "pointer", fontFamily: "var(--cb-font)", minHeight: 50,
    background: active ? accent : "transparent", color: active ? (at || "#101408") : P.ink,
    border: "1.5px solid " + (active ? accent : P.line), textAlign: "left",
  });
  return (
    <div style={{ maxWidth: 620, margin: "0 auto", padding: "48px 24px 56px", fontFamily: "var(--cb-font)", color: P.ink }}>
      <style>{CSS}</style>
      <div className="lv-rise">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <span style={{ color: accent, display: "inline-flex" }}><Icon name="cortex" size={30} /></span>
          <span style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.12em", color: P.faint }}>
            WELCOME TO CORTEX · {step + 1} OF 3
          </span>
          <span style={{ marginLeft: 2 }}><CharacterPose pose="wave" size={40} /></span>
        </div>
        <h1 style={{ fontFamily: SERIF, fontSize: FONT_SIZES.hero, fontWeight: 600, margin: "0 0 8px", lineHeight: 1.2 }}>Cortex</h1>
        <p style={{ fontSize: FONT_SIZES.body, color: P.ink2, lineHeight: 1.6, margin: "0 0 6px" }}>{CORTEX_TAGLINE}</p>
        {step === 0 ? (
          <>
            <h2 style={{ fontFamily: SERIF, fontSize: FONT_SIZES.display, fontWeight: 600, margin: "26px 0 10px", lineHeight: 1.3 }}>What are you curious about?</h2>
            <p style={{ fontSize: FONT_SIZES.body, color: P.ink2, lineHeight: 1.55, margin: "0 0 18px" }}>
              Pick the one that pulls at you. It chooses your first path; every path stays open to you afterwards.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {ONBOARDING_CHOICES.map((c) => (
                <button key={c.id} className="lv-opt" style={chip(curiosity === c.id)} aria-pressed={curiosity === c.id}
                  onClick={() => setCuriosity(c.id)}>
                  {c.label}
                  <span style={{ display: "block", fontSize: FONT_SIZES.label, fontWeight: 500, color: curiosity === c.id ? (at || "#101408") : P.ink2, marginTop: 3 }}>{c.note}</span>
                </button>
              ))}
            </div>
            <button className="lv-btn lv-btn-primary" onClick={() => setStep(1)}
              style={{ width: "100%", marginTop: 22, background: accent, color: at || "#101408", border: "none", borderRadius: 14, padding: "15px 24px", fontSize: FONT_SIZES.body, fontWeight: 700, cursor: "pointer", fontFamily: "var(--cb-font)", minHeight: 54 }}>
              Continue
            </button>
          </>
        ) : step === 1 ? (
          <>
            <h2 style={{ fontFamily: SERIF, fontSize: FONT_SIZES.display, fontWeight: 600, margin: "26px 0 10px", lineHeight: 1.3 }}>How many minutes a day?</h2>
            <p style={{ fontSize: FONT_SIZES.body, color: P.ink2, lineHeight: 1.55, margin: "0 0 18px" }}>
              This becomes your daily goal: the size of one daily session. Small and daily beats big and rare, and you can change it on your first win screen.
            </p>
            <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
              {[5, 10, 15, 20].map((m) => (
                <button key={m} className="lv-chip" style={chip(minutes === m)} aria-pressed={minutes === m}
                  onClick={() => setMinutes(m)}>
                  {m} min a day
                </button>
              ))}
            </div>
            <button className="lv-btn lv-btn-primary"
              onClick={() => setStep(2)}
              style={{ width: "100%", marginTop: 22, background: accent, color: at || "#101408", border: "none", borderRadius: 14, padding: "15px 24px", fontSize: FONT_SIZES.body, fontWeight: 700, cursor: "pointer", fontFamily: "var(--cb-font)", minHeight: 54 }}>
              Continue
            </button>
            <button onClick={() => setStep(0)}
              style={{ background: "none", border: "none", color: P.ink2, cursor: "pointer", fontSize: FONT_SIZES.body, fontFamily: "var(--cb-font)", padding: "12px 0 0", display: "block", margin: "0 auto" }}>
              Back
            </button>
          </>
        ) : (
          <>
            <h2 style={{ fontFamily: SERIF, fontSize: FONT_SIZES.display, fontWeight: 600, margin: "26px 0 10px", lineHeight: 1.3 }}>When should Cortex remind you?</h2>
            <p style={{ fontSize: FONT_SIZES.body, color: P.ink2, lineHeight: 1.55, margin: "0 0 18px" }}>
              Pick a time and Cortex will have your streak and your open quest waiting when you come back. You can change this later on the home page.
            </p>
            <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
              {[{ label: "No reminder", value: null }, { label: "Morning 8 AM", value: 8 }, { label: "Midday 1 PM", value: 13 }, { label: "Evening 7 PM", value: 19 }].map((opt) => (
                <button key={opt.label} className="lv-chip" style={chip(reminderHour === opt.value)} aria-pressed={reminderHour === opt.value}
                  onClick={() => setReminderHour(opt.value)}>
                  {opt.label}
                </button>
              ))}
            </div>
            <button className="lv-btn lv-btn-primary"
              onClick={() => onDone({ curiosity, minutes, reminderHour })}
              style={{ width: "100%", marginTop: 22, background: accent, color: at || "#101408", border: "none", borderRadius: 14, padding: "15px 24px", fontSize: FONT_SIZES.body, fontWeight: 700, cursor: "pointer", fontFamily: "var(--cb-font)", minHeight: 54 }}>
              Start your first lesson
            </button>
            <button onClick={() => setStep(1)}
              style={{ background: "none", border: "none", color: P.ink2, cursor: "pointer", fontSize: FONT_SIZES.body, fontFamily: "var(--cb-font)", padding: "12px 0 0", display: "block", margin: "0 auto" }}>
              Back
            </button>
          </>
        )}
        <button onClick={onSkip}
          style={{ background: "none", border: "none", color: P.faint, cursor: "pointer", fontSize: FONT_SIZES.label, fontFamily: "var(--cb-font)", padding: "16px 0 0", display: "block", margin: "0 auto" }}>
          Skip for now
        </button>
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
  const [progressMsg, setProgressMsg] = useState("");
  const [questCheer, setQuestCheer] = useState([]);
  const [sparksMsg, setSparksMsg] = useState("");

  const refresh = () => {
    setCourses(loadLearnCourses());
    setClaims(loadClaims());
  };

  /* Progress export and import. The learning record lives in this
     browser only, so it can leave as a file the learner keeps and
     come back the same way. Import parses and validates the whole
     file first, then asks before replacing anything, the same
     window.confirm pattern the Settings workspace import uses.
     Applying an import reruns the same loaders a fresh visit runs,
     so the imported progress shows with no reload. */
  const exportProgress = () => {
    const doc = buildCortexExport({ courses, claims, profile, builtinProgress, sound: soundOn }, new Date());
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cerebrum-cortex-progress-" + todayKey() + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setProgressMsg("Saved. The file holds your paths, courses, review claims, streak, and sound setting.");
  };

  const importProgressFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCortexImport(String(reader.result || ""));
      if (!parsed.ok) { setProgressMsg(parsed.error); return; }
      if (!window.confirm("Replace the Cortex progress in this browser with the progress in this file? This can't be undone.")) return;
      /* The write itself is transactional: success is announced
         only after all five sections are stored and read back, and
         any failure leaves the previous record exactly as it was. */
      const applied = applyCortexImport(parsed.state, localStorage);
      if (!applied.ok) { setProgressMsg(applied.error); return; }
      const s = parsed.state;
      setCourses(loadLearnCourses());
      setClaims(loadClaims());
      setProfile(touchStreak(loadProfile()));
      setBuiltinProgress(loadBuiltinProgress());
      setSoundOn(s.sound);
      setProgressMsg("Imported. Your progress from the file is showing now.");
    };
    reader.readAsText(file);
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
    let newLessonIds = [];
    if (course && course.id !== "review" && doneLessons) {
      const existing = loadLearnCourses().find((c) => c.id === course.id);
      if (existing) {
        const beforeIds = new Set(existing.doneLessons || []);
        newLessonIds = doneLessons.filter((id) => !beforeIds.has(id));
      }
    }
    setProfile((prev) => {
      const base = prev || loadProfile();
      const fromXp = base.xp || 0;
      const toXp = fromXp + xpGain;
      let p = awardSparksForRankUps({ ...base, xp: toXp }, fromXp, toXp);
      for (const id of newLessonIds) p = recordLoopEvent(p, todayKey(), { type: "lesson", lessonId: id });
      saveProfile(p);
      return p;
    });
    if (course && course.id !== "review") {
      const all = loadLearnCourses();
      const found = all.find((c) => c.id === course.id);
      if (found) {
        found.xpEarned = (found.xpEarned || 0) + xpGain;
        if (doneLessons) {
          /* Lessons finished for the first time in this call bump
             their completion count, which is what scales the XP a
             replay of the lesson can earn. */
          const before = new Set(found.doneLessons || []);
          found.xpCompletions = { ...(found.xpCompletions || {}) };
          for (const id of doneLessons) {
            if (!before.has(id)) found.xpCompletions[id] = (found.xpCompletions[id] || 0) + 1;
          }
          found.doneLessons = doneLessons;
        }
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
        setBuildError("Not enough solid material on this topic yet to build a course. Try a broader topic.");
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
      if (e && e.status === 429) setBuildError("The service is busy right now. Wait a minute and try again.");
      else if (e && e.status) setBuildError("The search hit a server error (status " + e.status + "). Try again in a moment.");
      else setBuildError("The search did not come back. Check your connection and try again.");
    } finally {
      setBuilding(false);
      setBuildingLabel("");
    }
  };
  const buildCourse = () => buildCourseFrom(topic.trim());

  /* Built in paths: starting a lesson points the continue row at
     it; finishing one records the score through the Player's
     onLessonDone callback. */
  const startBuiltinLesson = (path, flatIdx, opts) => {
    const course = courseFromPath(path, builtinProgress);
    const lesson = course.lessons[flatIdx];
    if (!lesson) return;
    const cur = loadBuiltinProgress();
    cur.lastPathId = path.id;
    cur.lastLessonId = lesson.id;
    saveBuiltinProgress(cur);
    setBuiltinProgress(cur);
    setScreen({ name: "player", course, startLesson: flatIdx, fromPath: false, pathId: path.id, fromOnboarding: !!(opts && opts.fromOnboarding) });
  };
  const handleBuiltinLessonDone = (pathId, lesson, pct) => {
    const path = builtinPathFor(pathId);
    if (!path || !lesson) return;
    const prevProgress = loadBuiltinProgress();
    const prevRecord = (prevProgress.lessons || {})[lesson.id];
    const firstTime = !(prevRecord && prevRecord.done);
    void firstTime;
    const next = applyLessonResult(prevProgress, path, lesson.id, pct);
    saveBuiltinProgress(next);
    setBuiltinProgress(next);
    setProfile((prev) => {
      let p = prev || loadProfile();
      p = recordLoopEvent(p, todayKey(), { type: "lesson", lessonId: lesson.id });
      if (pct === 100) p = recordLoopEvent(p, todayKey(), { type: "perfect", lessonId: lesson.id });
      if (lesson.checkpoint === true) p = recordLoopEvent(p, todayKey(), { type: "checkpoint", lessonId: lesson.id });
      saveProfile(p);
      return p;
    });
  };

  /* Completing a Review what you missed pass masters the lesson it
     came from, at whatever score the lesson already holds. */
  const handleBuiltinReviewDone = (pathId, lessonId) => {
    const path = builtinPathFor(pathId);
    if (!path || !lessonId) return;
    const cur = loadBuiltinProgress();
    const rec = cur.lessons[lessonId];
    if (!rec || !rec.done) return;
    const next = applyLessonResult(cur, path, lessonId, rec.best || 0, { review: true });
    saveBuiltinProgress(next);
    setBuiltinProgress(next);
  };

  /* ── the daily session bundle (reviewer consensus, 2026-10-14) ──
     Daily practice is one bundled session in a fixed order: a
     short review warmup drawn from due spaced review items, then
     one new lesson at the learner's next stop, then a payoff
     screen with rank progress, the streak, and one hook for
     tomorrow. One button starts the bundle; leaving a stage early
     ends the bundle rather than skipping ahead. Warmup repeats pay
     at the existing review rates, through the same pay path as
     every other session: nothing new was invented for them. */
  const [bundleStageDone, setBundleStageDone] = useState({ warmup: false, lesson: false });
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);

  const updateProfile = (patch) => {
    setProfile((prev) => {
      const p = { ...(prev || loadProfile()), ...patch };
      saveProfile(p);
      return p;
    });
  };

  const recordSessionDone = () => {
    setProfile((prev) => {
      const p = recordLoopEvent(prev || loadProfile(), todayKey(), { type: "session" });
      saveProfile(p);
      return p;
    });
  };

  /* The loop reconcile: ensure today's loop and plan exist, then
     settle any quest payouts the day has earned. Writes only when
     something actually changed, so the effect settles. */
  useEffect(() => {
    if (!profile) return;
    const day = todayKey();
    let working = profile;
    let changed = false;
    const effLoop = loopForDay(working, day);
    if (working.loopDay !== day || !working.loop || effLoop.plan == null) {
      let loop = effLoop;
      if (loop.plan == null) {
        const quests = buildDailyQuests({ day, profile: working, progress: builtinProgress, dueCount: due.length });
        loop = { ...loop, plan: { session: quests[0], target: quests[1], stretch: quests[2] }, dueAtStart: due.length };
      }
      working = { ...working, sparks: working.sparks || 0, loopDay: day, loop };
      changed = true;
    }
    const plan = working.loop && working.loop.plan;
    const planQuests = plan ? (Array.isArray(plan) ? plan : [plan.session, plan.target, plan.stretch].filter(Boolean)) : [];
    if (planQuests.length) {
      const settled = settleQuestPayouts(working, day, planQuests, { dueCount: due.length, progress: builtinProgress });
      if (settled.newlyPaid.length) {
        working = settled.profile;
        changed = true;
        setQuestCheer(settled.newlyPaid);
      }
    }
    if (changed) { saveProfile(working); setProfile(working); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, due, builtinProgress]);

  const nextBundleStop = () => {
    const order = [];
    const last = builtinPathFor(builtinProgress.lastPathId);
    if (last) order.push(last);
    for (const p of LEARNING_PATHS) if (!order.includes(p)) order.push(p);
    for (const p of TOPIC_COURSES) if (!order.includes(p)) order.push(p);
    for (const p of order) {
      const pp = pathProgress(p, builtinProgress);
      if (pp.nextLessonId) {
        const flat = flattenPathLessons(p);
        const flatIdx = flat.findIndex((l) => l.id === pp.nextLessonId);
        if (flatIdx >= 0) return { path: p, flatIdx, lesson: flat[flatIdx] };
      }
    }
    return null;
  };

  const startBundleLesson = () => {
    const stop = nextBundleStop();
    if (!stop) { recordSessionDone(); setScreen({ name: "payoff" }); return; }
    const course = courseFromPath(stop.path, builtinProgress);
    const lesson = course.lessons[stop.flatIdx];
    if (!lesson) { recordSessionDone(); setScreen({ name: "payoff" }); return; }
    const cur = loadBuiltinProgress();
    cur.lastPathId = stop.path.id;
    cur.lastLessonId = lesson.id;
    saveBuiltinProgress(cur);
    setBuiltinProgress(cur);
    setScreen({ name: "player", course, startLesson: stop.flatIdx, fromPath: false, pathId: stop.path.id, bundleStage: "lesson" });
  };

  const startBundle = () => {
    setBundleStageDone({ warmup: false, lesson: false });
    const warm = due.slice(0, 6).map((c) => ({ ...c.card, claimId: c.id, kind: c.card.kind || "quiz" }));
    if (warm.length) {
      setScreen({
        name: "player", fromPath: false, bundleStage: "warmup",
        course: { id: "bundle-warmup", title: "Daily session", lessons: [{ id: "bundle-warmup", title: "Review warmup", subtitle: "Questions that are due, while they are still fresh enough to fix", cards: warm }], doneLessons: [] },
        startLesson: 0,
      });
      return;
    }
    startBundleLesson();
  };

  /* The review bench: one tap plays exactly what is due, due
     spaced review cards first, then activities from fading
     lessons. */
  const startReview = () => {
    const dueCards = due.slice(0, 10).map((c) => ({ ...c.card, claimId: c.id, kind: c.card.kind || "quiz" }));
    const seed = Number(todayKey().replace(/[^0-9]/g, "")) || 1;
    const cards = buildReviewSessionCards({ progress: builtinProgress, dueCards, seed, paths: [...LEARNING_PATHS, ...TOPIC_COURSES] });
    if (!cards.length) return;
    setScreen({
      name: "player", fromPath: false,
      course: { id: "review-bench", title: "Review bench", lessons: [{ id: "review-bench", title: "Review bench", subtitle: "What is due, brought back while it can still be fixed", cards }], doneLessons: [] },
      startLesson: 0,
    });
  };

  const completeOnboarding = ({ curiosity, minutes, reminderHour }) => {
    updateProfile({ onboarded: true, curiosity, dailyGoalMinutes: minutes, reminderHour: reminderHour == null ? null : reminderHour });
    const path = builtinPathFor(ONBOARDING_FIRST_LESSON[curiosity] || "earth-and-weather") || LEARNING_PATHS[0];
    startBuiltinLesson(path, 0, { fromOnboarding: true });
  };
  const skipOnboarding = () => {
    updateProfile({ onboarded: true });
    setOnboardingDismissed(true);
  };

  const handlePlayerExit = () => {
    refresh();
    setProfile(touchStreak(loadProfile()));
    setBuiltinProgress(loadBuiltinProgress());
    if (screen.bundleStage === "warmup") {
      if (bundleStageDone.warmup) { startBundleLesson(); return; }
      setScreen({ name: "home" });
      return;
    }
    if (screen.bundleStage === "lesson") {
      if (bundleStageDone.lesson) { recordSessionDone(); setScreen({ name: "payoff" }); return; }
      setScreen({ name: "home" });
      return;
    }
    if (screen.fromOnboarding) { setScreen({ name: "home" }); return; }
    if (screen.pathId) setScreen({ name: "bpath", pathId: screen.pathId });
    else if (screen.fromPath && screen.course.id !== "review") setScreen({ name: "path", courseId: screen.course.id });
    else setScreen({ name: "home" });
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
        rankSummary={rankForXp(profile ? profile.xp : 0)}
        goalPicker={screen.fromOnboarding
          ? { minutes: (profile && profile.dailyGoalMinutes) || 5, onPick: (m) => updateProfile({ dailyGoalMinutes: m }) }
          : null}
        onExit={handlePlayerExit}
        onProgress={(xpGain, course, doneLessons) => {
          handleProgress(xpGain, course, doneLessons);
          if (screen.bundleStage === "warmup" && doneLessons && doneLessons.length) {
            setBundleStageDone((s) => ({ ...s, warmup: true }));
          }
        }}
        onLessonDone={screen.course && screen.course.builtin
          ? (lesson, pct) => {
            handleBuiltinLessonDone(screen.course.pathId, lesson, pct);
            if (screen.bundleStage === "lesson") setBundleStageDone((s) => ({ ...s, lesson: true }));
          }
          : undefined}
        onReviewDone={screen.course && screen.course.builtin
          ? (lessonId) => handleBuiltinReviewDone(screen.course.pathId, lessonId)
          : undefined}
      />
    );
  }

  if (screen.name === "bpath") {
    const path = builtinPathFor(screen.pathId);
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
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, background: P.raised, border: "1px solid " + P.line, borderRadius: RADIUS.pill, padding: "8px 14px", fontSize: FONT_SIZES.label, color: P.ink }}>
      {icon}
      <strong style={{ fontWeight: 700 }}>{value}</strong>
      <span style={{ color: P.ink2, fontSize: FONT_SIZES.label }}>{label}</span>
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
  const lastPath = builtinPathFor(builtinProgress.lastPathId) || null;
  const lastLesson = lastPath
    ? flattenPathLessons(lastPath).find((l) => l.id === builtinProgress.lastLessonId) || null
    : null;
  const lastPathProg = lastPath ? pathProgress(lastPath, builtinProgress) : null;
  const startedPaths = [...LEARNING_PATHS, ...TOPIC_COURSES].filter((p) => pathProgress(p, builtinProgress).done > 0);
  const dailyReady = due.length > 0 || startedPaths.length > 0;
  const totalPathLessons = LEARNING_PATHS.reduce((n, p) => n + flattenPathLessons(p).length, 0);
  const totalPathDone = LEARNING_PATHS.reduce((n, p) => n + pathProgress(p, builtinProgress).done, 0);
  const progressStore = builtinProgress.lessons || {};
  const allBuiltinSets = [...LEARNING_PATHS, ...TOPIC_COURSES];
  const fadingAll = fadingLessons(allBuiltinSets, builtinProgress);
  const reviewDueCount = due.length + fadingAll.length;
  const bundleStop = nextBundleStop();
  const bundleReady = due.length > 0 || !!bundleStop;
  const todayLoop = profile ? loopForDay(profile, todayKey()) : emptyLoop(todayKey());
  const todayQuests = todayLoop.plan
    ? (Array.isArray(todayLoop.plan) ? todayLoop.plan : [todayLoop.plan.session, todayLoop.plan.target, todayLoop.plan.stretch].filter(Boolean))
    : buildDailyQuests({ day: todayKey(), profile: profile || {}, progress: builtinProgress, dueCount: due.length });
  const repairOffer = profile ? streakRepairOffer(profile, new Date()) : null;
  const reminder = profile ? reminderFor({ profile, quests: todayQuests, loop: todayLoop, now: new Date() }) : null;

  /* The bundle payoff: rank progress, the streak, mastery so far,
     and one hook for tomorrow. Shown only at the end of a full
     daily session bundle, never for a stage left early. */
  if (screen.name === "payoff") {
    const rank = rankForXp(profile ? profile.xp : 0);
    const masteredTotal = allBuiltinSets.reduce((n, p) => n + pathProgress(p, builtinProgress).mastered, 0);
    const doneTotal = allBuiltinSets.reduce((n, p) => n + pathProgress(p, builtinProgress).done, 0);
    const openQuest = todayQuests.find((q) => !questState(q, { loop: todayLoop, dueCount: due.length, progress: builtinProgress }).done);
    const hook = openQuest
      ? "Tomorrow, one quest is still open: " + openQuest.title + "."
      : bundleStop
        ? "Tomorrow, your next stop is " + bundleStop.lesson.title + " on " + bundleStop.path.title + "."
        : fadingAll.length > 0
          ? "Tomorrow, " + fadingAll.length + " finished lesson" + (fadingAll.length === 1 ? " is" : "s are") + " fading and due for review."
          : "Tomorrow, a fresh daily session will be waiting here.";
    return (
      <div style={{ maxWidth: 620, margin: "0 auto", padding: "56px 24px 56px", fontFamily: "var(--cb-font)", color: P.ink, textAlign: "center" }}>
        <style>{CSS}</style>
        <div className="lv-rise">
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}>
            <CharacterPose pose="celebrate" size={72} />
          </div>
          <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.14em", color: accent, marginBottom: 10 }}>DAILY SESSION COMPLETE</div>
          <h2 style={{ fontFamily: SERIF, fontSize: FONT_SIZES.hero, fontWeight: 600, margin: "0 0 12px", lineHeight: 1.2 }}>That is today, done properly.</h2>
          <p style={{ color: P.ink2, fontSize: FONT_SIZES.body, lineHeight: 1.6, margin: "0 auto 26px", maxWidth: 440 }}>
            Warmup, new ground, and a clear head to end on. Here is where today leaves you.
          </p>
          <div style={{ display: "flex", gap: 14, justifyContent: "center", marginBottom: 26, flexWrap: "wrap" }}>
            <div style={{ background: P.raised, border: "1px solid " + P.line, borderRadius: RADIUS.xl, padding: "16px 24px", minWidth: 130 }}>
              <div style={{ fontSize: FONT_SIZES.title, fontWeight: 700, color: accent }}>{rank.name}</div>
              <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, marginTop: 4 }}>
                {rank.atTop ? "Top rank" : rank.xpToNext + " XP to " + rank.nextName}
              </div>
            </div>
            <div style={{ background: P.raised, border: "1px solid " + P.line, borderRadius: RADIUS.xl, padding: "16px 24px", minWidth: 130 }}>
              <div style={{ fontSize: FONT_SIZES.title, fontWeight: 700 }}>{profile ? profile.streak || 0 : 0} day streak</div>
              <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, marginTop: 4 }}>{profile ? profile.xp : 0} XP in all</div>
            </div>
            <div style={{ background: P.raised, border: "1px solid " + P.line, borderRadius: RADIUS.xl, padding: "16px 24px", minWidth: 130 }}>
              <div style={{ fontSize: FONT_SIZES.title, fontWeight: 700 }}>{masteredTotal} mastered</div>
              <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, marginTop: 4 }}>{doneTotal} lessons finished</div>
            </div>
          </div>
          <div style={{ background: P.raised, border: "1px solid " + accent, borderRadius: 18, padding: "18px 20px", margin: "0 auto 30px", maxWidth: 440, textAlign: "left" }}>
            <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.12em", color: accent, marginBottom: 7 }}>TOMORROW</div>
            <p style={{ fontSize: FONT_SIZES.body, lineHeight: 1.6, color: P.ink, margin: 0 }}>{hook}</p>
          </div>
          <div style={{ margin: "0 auto 24px" }}>
            <ShareCardButton P={P} accent={accent} model={shareCardModel([7, 30, 100, 365].includes(profile ? profile.streak || 0 : 0) ? "streak" : "session", { streak: profile ? profile.streak || 0 : 0, rankName: rank.name, mastered: masteredTotal })} />
          </div>
          <button className="lv-btn lv-btn-primary" onClick={() => setScreen({ name: "home" })}
            style={{ background: accent, color: at || "#101408", border: "none", borderRadius: 14, padding: "15px 30px", fontSize: FONT_SIZES.body, fontWeight: 700, cursor: "pointer", fontFamily: "var(--cb-font)", minHeight: 54 }}>
            Back to Cortex home
          </button>
        </div>
      </div>
    );
  }

  /* First run: a learner with no progress and no answers yet gets
     the three question onboarding instead of the home, once. */
  const freshLearner = !!profile && !profile.onboarded && (profile.xp || 0) === 0 && totalPathDone === 0 && courses.length === 0;
  if (freshLearner && !onboardingDismissed && screen.name === "home") {
    return (
      <OnboardingFlow P={P} accent={accent} at={at || "#101408"}
        onDone={completeOnboarding} onSkip={skipOnboarding} />
    );
  }

  return (
    <div className="lv-home" style={{ maxWidth: 880, margin: "0 auto", padding: "30px 24px 56px", fontFamily: "var(--cb-font)" }}>
      <style>{CSS}</style>
      {tourOpen && <CortexTour P={P} accent={accent} at={at} onClose={closeTour} />}
      <div className="lv-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ color: accent, display: "inline-flex", flexShrink: 0 }}><Icon name="cortex" size={36} /></span>
            <h1 className="lv-h1" style={{ fontFamily: SERIF, fontSize: FONT_SIZES.hero, fontWeight: 600, color: P.ink, margin: "0 0 8px" }}>Cortex</h1>
          </div>
          <p className="lv-tagline" style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: FONT_SIZES.title, color: P.ink, margin: "0 0 8px" }}>{CORTEX_TAGLINE}</p>
          <p className="lv-sub" style={{ color: P.ink2, fontSize: FONT_SIZES.body, lineHeight: 1.55, margin: 0, maxWidth: 520 }}>
            Lessons that teach you a subject in small steps, with quizzes on what you just learned. Follow a path, pick a catalog topic, or build a course from any question. What you answer comes back later, right before you forget, so it stays.
          </p>
          <button onClick={() => setTourOpen(true)}
            style={{ background: "none", border: "none", color: accent, cursor: "pointer", fontSize: FONT_SIZES.label, fontWeight: 600, fontFamily: "var(--cb-font)", padding: "8px 0 0", display: "inline-flex", alignItems: "center", gap: 6 }}>
            How Cortex works <Icon name="arrowRight" size={13} />
          </button>
        </div>
        <button onClick={() => { const v = !soundOn; setSoundOn(v); saveJSON(SOUND_KEY, v); }}
          aria-label={soundOn ? "Mute lesson sounds" : "Unmute lesson sounds"}
          style={{ background: "transparent", border: "1px solid " + P.line, borderRadius: RADIUS.pill, color: P.ink2, cursor: "pointer", padding: "8px 14px", fontSize: FONT_SIZES.label, fontFamily: "var(--cb-font)", flexShrink: 0 }}>
          Sound {soundOn ? "on" : "off"}
        </button>
      </div>

      <div className="lv-pills" style={{ display: "flex", gap: 9, flexWrap: "wrap", margin: "20px 0 26px" }}>
        {pill(flame, profile ? profile.streak || 0 : 0, "day streak" + (profile && profile.freezes ? " · " + profile.freezes + " freeze" + (profile.freezes === 1 ? "" : "s") : ""))}
        {pill(null, profile ? profile.xp : 0, "XP")}
        {pill(null, profile ? profile.sparks || 0 : 0, "Sparks")}
        {pill(null, due.length, "due for review")}
        {pill(null, courses.length, "courses")}
      </div>

      {reminder && (
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", background: P.raised, border: "1px solid " + accent, borderRadius: 20, padding: "16px 20px", margin: "0 0 26px" }}>
          <CharacterPose pose={reminder.kind === "atrisk" ? "think" : "wave"} size={52} />
          <span style={{ flex: "1 1 260px", minWidth: 0 }}>
            <span style={{ fontFamily: SERIF, fontSize: FONT_SIZES.title, fontWeight: 700, color: P.ink, display: "block" }}>{reminder.title}</span>
            <span style={{ fontSize: FONT_SIZES.label, color: P.ink2, display: "block", marginTop: 3, lineHeight: 1.5 }}>{reminder.body}</span>
          </span>
          <button className="lv-btn lv-btn-primary" onClick={startBundle}
            style={{ background: accent, color: at || "#101408", border: "none", borderRadius: RADIUS.lg, padding: "12px 20px", fontSize: FONT_SIZES.body, fontWeight: 700, cursor: "pointer", fontFamily: "var(--cb-font)", minHeight: 48 }}>
            Start today's session
          </button>
        </div>
      )}

      {/* your rank: the XP ladder made visible, frame and kit line
          changing with the rung */}
      {profile && (() => {
        const rank = rankForXp(profile.xp);
        return (
          <div style={{
            display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap",
            background: P.raised, border: (2 + Math.min(2, rank.index)) + "px solid " + accent,
            borderRadius: 20, padding: "16px 20px", margin: "0 0 26px",
          }}>
            <span aria-hidden="true" style={{
              width: 52, height: 52, borderRadius: "50%", flexShrink: 0,
              border: (2 + Math.min(3, rank.index)) + "px solid " + accent,
              display: "flex", alignItems: "center", justifyContent: "center", color: accent,
              background: withAlphaSafe(accent, 0.1 + rank.index * 0.05),
            }}>
              <Icon name="cortex" size={24} />
            </span>
            <span style={{ flex: "1 1 260px", minWidth: 0 }}>
              <span style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.12em", color: P.faint, display: "block", marginBottom: 3 }}>
                YOUR RANK · RUNG {rank.index + 1} OF {RANK_LADDER.length}
              </span>
              <span style={{ fontFamily: SERIF, fontSize: FONT_SIZES.title, fontWeight: 700, color: P.ink, display: "block" }}>{rank.name}</span>
              <span style={{ fontSize: FONT_SIZES.label, color: P.ink2, display: "block", marginTop: 3, lineHeight: 1.5 }}>{rank.kit}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
                <span style={{ flex: 1, height: 7, borderRadius: RADIUS.pill, background: P.line, overflow: "hidden", display: "block", maxWidth: 300 }}>
                  <span className="lv-fill" style={{ display: "block", height: "100%", background: accent, borderRadius: RADIUS.pill, width: rank.pctToNext + "%" }} />
                </span>
                <span style={{ fontSize: FONT_SIZES.label, color: P.ink2 }}>
                  {rank.atTop ? "Top rung reached" : rank.xpToNext + " XP to " + rank.nextName}
                </span>
              </span>
              <span style={{ fontSize: FONT_SIZES.label, color: P.ink2, display: "block", marginTop: 8 }}>
                {profile.sparks || 0} Sparks
              </span>
              <span style={{ display: "block", marginTop: 10 }}>
                <ShareCardButton P={P} accent={accent} model={shareCardModel("rank", { rankName: rank.name, kit: rank.kit, xp: profile.xp })} />
              </span>
            </span>
            <CharacterPose pose="wave" size={52} />
          </div>
        );
      })()}

      {/* progress backup: the record lives in this browser only, so
          it can leave as a file the learner keeps, and return as one */}
      <div style={{ margin: "0 0 26px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: FONT_SIZES.label, color: P.ink2 }}>
            Your progress is stored in this browser only.
          </span>
          <button onClick={exportProgress}
            style={{ background: "transparent", border: "1px solid " + P.line, borderRadius: RADIUS.pill, color: P.ink2, cursor: "pointer", padding: "8px 14px", fontSize: FONT_SIZES.label, fontFamily: "var(--cb-font)", flexShrink: 0 }}>
            Export progress
          </button>
          <label
            style={{ background: "transparent", border: "1px solid " + P.line, borderRadius: RADIUS.pill, color: P.ink2, cursor: "pointer", padding: "8px 14px", fontSize: FONT_SIZES.label, fontFamily: "var(--cb-font)", flexShrink: 0, display: "inline-flex", alignItems: "center" }}>
            Import progress
            <input type="file" accept=".json" style={{ display: "none" }} onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; importProgressFile(f); }} />
          </label>
        </div>
        <p style={{ fontSize: FONT_SIZES.label, color: P.ink2, lineHeight: 1.5, margin: "8px 0 0", maxWidth: 520 }}>
          Export saves a file you keep, not a cloud copy. Import replaces the progress in this browser with the file you pick.
        </p>
        {progressMsg && (
          <p aria-live="polite" style={{ fontSize: FONT_SIZES.label, color: P.ink, lineHeight: 1.5, margin: "8px 0 0" }}>{progressMsg}</p>
        )}
      </div>

      {/* reminders: in app only, shown on return at the chosen hour */}
      <div style={{ background: P.raised, border: "1px solid " + P.line, borderRadius: 20, padding: 22, marginBottom: 24 }}>
        <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.12em", color: accent, marginBottom: 8 }}>REMINDERS</div>
        <p style={{ fontSize: FONT_SIZES.body, color: P.ink2, lineHeight: 1.55, margin: "0 0 14px" }}>
          Reminders live here for now: pick an hour and Cortex will have your streak and your open quest waiting at the top of this page when you come back.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[{ label: "None", value: null }, { label: "7 AM", value: 7 }, { label: "9 AM", value: 9 }, { label: "1 PM", value: 13 }, { label: "6 PM", value: 18 }, { label: "9 PM", value: 21 }].map((opt) => {
            const active = profile ? (profile.reminderHour == null ? null : profile.reminderHour) === opt.value : opt.value === null;
            return (
              <button key={opt.label} className="lv-chip" aria-pressed={active} onClick={() => updateProfile({ reminderHour: opt.value })}
                style={{ borderRadius: RADIUS.pill, padding: "10px 16px", fontSize: FONT_SIZES.label, fontWeight: 700, cursor: "pointer", fontFamily: "var(--cb-font)", minHeight: 44, background: active ? accent : "transparent", color: active ? (at || "#101408") : P.ink, border: "1px solid " + (active ? accent : P.line) }}>
                {opt.label}
              </button>
            );
          })}
        </div>
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
              <span style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.12em", color: accent, display: "block", marginBottom: 7 }}>
                {hero.kicker}
              </span>
              <span className="lv-hero-title" style={{ fontFamily: SERIF, fontSize: FONT_SIZES.display, fontWeight: 600, lineHeight: 1.28, display: "block" }}>{hero.title}</span>
              {hero.sub && <span style={{ display: "block", fontSize: FONT_SIZES.label, color: P.ink2, marginTop: 5 }}>{hero.sub}</span>}
              <span style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 13 }}>
                <span style={{ flex: 1, height: 8, borderRadius: RADIUS.pill, background: P.line, overflow: "hidden", display: "block" }}>
                  <span className="lv-fill" style={{ display: "block", height: "100%", background: accent, borderRadius: RADIUS.pill, width: hero.pct + "%" }} />
                </span>
                <span style={{ fontSize: FONT_SIZES.label, color: P.ink2 }}>{hero.count}</span>
              </span>
            </span>
          </button>
        );
      })()}

      {/* the daily session bundle: warmup, one new lesson, payoff */}
      <div style={{ border: "1px solid " + (bundleReady ? accent : P.line), borderRadius: 20, padding: 22, marginBottom: 24, background: P.raised }}>
        <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.12em", color: accent, marginBottom: 8 }}>DAILY PRACTICE</div>
        <p style={{ fontSize: FONT_SIZES.body, color: P.ink, lineHeight: 1.55, margin: "0 0 6px" }}>
          One session, in a fixed order: a short review warmup from what is due, then one new lesson at your next stop, then a payoff screen with your rank, your streak, and tomorrow's hook.
        </p>
        <p style={{ fontSize: FONT_SIZES.label, color: P.ink2, lineHeight: 1.5, margin: "0 0 14px" }}>
          {due.length > 0
            ? due.length + " question" + (due.length === 1 ? " is" : "s are") + " due for the warmup."
            : "Nothing is due, so the warmup rests and the session starts at your next stop."}
          {bundleStop ? " Next stop: " + bundleStop.lesson.title + " on " + bundleStop.path.title + "." : " Every path is finished; the session is a review round."}
          {" "}{totalPathDone} of {totalPathLessons} path lessons done so far.
        </p>
        <button className="lv-btn lv-btn-primary" onClick={startBundle} disabled={!bundleReady}
          style={{
            background: accent, color: at || "#101408", border: "none", borderRadius: RADIUS.lg,
            padding: "13px 24px", fontSize: FONT_SIZES.body, fontWeight: 700,
            cursor: bundleReady ? "pointer" : "default", fontFamily: "var(--cb-font)",
            opacity: bundleReady ? 1 : 0.5,
          }}>
          Start daily practice
        </button>
      </div>

      {/* today's quests: the daily loop made visible */}
      <div style={{ border: "1px solid " + P.line, borderRadius: 20, padding: 22, marginBottom: 24, background: P.raised }}>
        <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.12em", color: accent, marginBottom: 8 }}>TODAY'S QUESTS</div>
        {questCheer.length > 0 && questCheer.map((slot) => {
          const cheerQuest = todayQuests.find((q) => q.slot === slot);
          return (
            <div key={slot} style={{ display: "flex", alignItems: "center", gap: 12, background: P.bg, border: "1px solid " + accent, borderRadius: 14, padding: "12px 14px", marginBottom: 12 }}>
              <CharacterPose pose="celebrate" size={44} />
              <span style={{ fontSize: FONT_SIZES.body, color: P.ink, lineHeight: 1.5 }}>
                {"+5 Sparks · " + (cheerQuest ? cheerQuest.title : "Quest done")}
              </span>
            </div>
          );
        })}
        {todayQuests.map((quest) => {
          const state = questState(quest, { loop: todayLoop, dueCount: due.length, progress: builtinProgress });
          const pct = state.total > 0 ? Math.round((state.current / state.total) * 100) : (state.done ? 100 : 0);
          return (
            <div key={quest.slot} style={{ padding: "12px 0", borderTop: "1px solid " + P.line, opacity: state.done ? 0.75 : 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                <span style={{ fontFamily: SERIF, fontSize: FONT_SIZES.body, fontWeight: 700, color: P.ink, lineHeight: 1.35 }}>{quest.title}</span>
                <span style={{ fontSize: FONT_SIZES.label, fontWeight: 700, color: state.done ? accent : P.ink2, flexShrink: 0 }}>{state.done ? "Done" : state.current + " of " + state.total}</span>
              </div>
              <p style={{ fontSize: FONT_SIZES.label, color: P.ink2, lineHeight: 1.5, margin: "4px 0 8px" }}>{quest.detail}</p>
              <span style={{ display: "block", height: 6, borderRadius: RADIUS.pill, background: P.line, overflow: "hidden" }}>
                <span className="lv-fill" style={{ display: "block", height: "100%", background: accent, borderRadius: RADIUS.pill, width: pct + "%" }} />
              </span>
            </div>
          );
        })}
      </div>

      {/* sparks: streak protection only, earned by the loop */}
      <div style={{ border: "1px solid " + P.line, borderRadius: 20, padding: 22, marginBottom: 24, background: P.raised }}>
        <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.12em", color: accent, marginBottom: 8 }}>SPARKS</div>
        <p style={{ fontSize: FONT_SIZES.body, color: P.ink, lineHeight: 1.55, margin: "0 0 6px" }}>
          You hold {profile ? profile.sparks || 0 : 0} Sparks.
        </p>
        <p style={{ fontSize: FONT_SIZES.label, color: P.ink2, lineHeight: 1.5, margin: "0 0 14px" }}>
          Sparks come from finishing sessions and quests, passing checkpoints and perfect lessons, and climbing ranks. They pay for streak protection, and nothing else.
        </p>
        {(() => {
          const freezesNow = profile ? profile.freezes || 0 : 0;
          const balance = profile ? profile.sparks || 0 : 0;
          const atCap = freezesNow >= SPARKS_RATES.freezeCap;
          const short = balance < SPARKS_RATES.freezeCost;
          return (
            <div style={{ marginBottom: 14 }}>
              <button className="lv-btn lv-btn-primary" disabled={atCap || short}
                onClick={() => {
                  if (!profile) return;
                  const bought = buyStreakFreeze(profile);
                  if (bought) { saveProfile(bought); setProfile(bought); setSparksMsg("Freeze bought. It will bridge one missed day."); }
                }}
                style={{ background: accent, color: at || "#101408", border: "none", borderRadius: RADIUS.lg, padding: "12px 22px", fontSize: FONT_SIZES.body, fontWeight: 700, cursor: atCap || short ? "default" : "pointer", fontFamily: "var(--cb-font)", opacity: atCap || short ? 0.5 : 1 }}>
                Buy a streak freeze · 50 Sparks
              </button>
              {(atCap || short) && (
                <p style={{ fontSize: FONT_SIZES.label, color: P.ink2, lineHeight: 1.5, margin: "8px 0 0" }}>
                  {atCap ? "You already hold the most freezes you can carry." : "You need 50 Sparks for a freeze."}
                </p>
              )}
            </div>
          );
        })()}
        {repairOffer && (
          <div style={{ border: "1px solid " + accent, borderRadius: 14, padding: "14px 16px", marginBottom: 14 }}>
            <p style={{ fontSize: FONT_SIZES.body, color: P.ink, lineHeight: 1.55, margin: "0 0 10px" }}>
              You missed a day and a streak of {repairOffer.lostStreak} {repairOffer.lostStreak === 1 ? "day" : "days"} ended. This offer lasts today only, and repairing it puts the missed day back.
            </p>
            <button className="lv-btn lv-btn-primary" disabled={(profile ? profile.sparks || 0 : 0) < repairOffer.cost}
              onClick={() => {
                if (!profile) return;
                const repaired = applyStreakRepair(profile);
                if (repaired) { saveProfile(repaired); setProfile(repaired); setSparksMsg("Streak repaired. Your streak reads restored."); }
              }}
              style={{ background: accent, color: at || "#101408", border: "none", borderRadius: RADIUS.lg, padding: "12px 22px", fontSize: FONT_SIZES.body, fontWeight: 700, cursor: "pointer", fontFamily: "var(--cb-font)", opacity: (profile ? profile.sparks || 0 : 0) < repairOffer.cost ? 0.5 : 1 }}>
              Repair the missed day · 100 Sparks
            </button>
            {(profile ? profile.sparks || 0 : 0) < repairOffer.cost && (
              <p style={{ fontSize: FONT_SIZES.label, color: P.ink2, lineHeight: 1.5, margin: "8px 0 0" }}>You need 100 Sparks to repair the missed day.</p>
            )}
          </div>
        )}
        {sparksMsg && <p aria-live="polite" style={{ fontSize: FONT_SIZES.label, color: P.ink, lineHeight: 1.5, margin: "0 0 10px" }}>{sparksMsg}</p>}
        <p style={{ fontSize: FONT_SIZES.label, color: P.ink2, lineHeight: 1.5, margin: 0 }}>
          {"Sparks never buy " + SPARKS_NEVER_BUYS.join(", ") + "."}
        </p>
      </div>

      {/* leagues: not open yet, joining is a saved choice only */}
      <div style={{ border: "1px solid " + P.line, borderRadius: 20, padding: 22, marginBottom: 24, background: P.raised }}>
        <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.12em", color: accent, marginBottom: 8 }}>LEAGUES</div>
        <p style={{ fontSize: FONT_SIZES.body, color: P.ink, lineHeight: 1.55, margin: "0 0 6px" }}>
          Leagues open once enough learners are active each week. Groups of 30, ranked on league points earned from first time lessons and review accuracy, capped each day. Replays earn nothing, and joining is always your choice.
        </p>
        <p style={{ fontSize: FONT_SIZES.label, color: P.ink2, lineHeight: 1.5, margin: "0 0 14px" }}>
          Leagues are not open yet.
        </p>
        <button className="lv-btn" aria-pressed={!!(profile && profile.leaguesOptIn)} onClick={() => updateProfile({ leaguesOptIn: !(profile && profile.leaguesOptIn) })}
          style={{ background: profile && profile.leaguesOptIn ? accent : "transparent", color: profile && profile.leaguesOptIn ? (at || "#101408") : P.ink, border: "1px solid " + (profile && profile.leaguesOptIn ? accent : P.line), borderRadius: RADIUS.pill, padding: "10px 18px", fontSize: FONT_SIZES.label, fontWeight: 700, cursor: "pointer", fontFamily: "var(--cb-font)", minHeight: 44 }}>
          {profile && profile.leaguesOptIn ? "You are in" : "Join when leagues open"}
        </button>
        {profile && profile.leaguesOptIn && (
          <p style={{ fontSize: FONT_SIZES.label, color: P.ink, lineHeight: 1.5, margin: "10px 0 0" }}>You are in for opening day. Your place is saved.</p>
        )}
      </div>

      {/* the review bench: review as a place, with its due count
          on the door */}
      <div style={{ border: "1px solid " + P.line, borderRadius: 20, padding: 22, marginBottom: 24, background: P.raised }}>
        <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.12em", color: accent, marginBottom: 8 }}>REVIEW BENCH</div>
        <p style={{ fontSize: FONT_SIZES.body, color: P.ink, lineHeight: 1.55, margin: "0 0 6px" }}>
          {reviewDueCount > 0
            ? reviewDueCount + " thing" + (reviewDueCount === 1 ? " is" : "s are") + " due for review: " + due.length + " scheduled question" + (due.length === 1 ? "" : "s") + " and " + fadingAll.length + " fading lesson" + (fadingAll.length === 1 ? "" : "s") + ". One tap plays exactly what is due."
            : "Nothing is due right now. Finished lessons land here as they start to fade, and scheduled questions arrive on their own timing."}
        </p>
        <p style={{ fontSize: FONT_SIZES.label, color: P.ink2, lineHeight: 1.5, margin: "0 0 14px" }}>
          Review is what makes lessons stay. It pays at the usual rates, and finishing a fading lesson's review brings it back to full strength on the map.
        </p>
        <button className="lv-btn lv-btn-primary" onClick={startReview} disabled={reviewDueCount === 0}
          style={{
            background: accent, color: at || "#101408", border: "none", borderRadius: RADIUS.lg,
            padding: "13px 24px", fontSize: FONT_SIZES.body, fontWeight: 700,
            cursor: reviewDueCount > 0 ? "pointer" : "default", fontFamily: "var(--cb-font)",
            opacity: reviewDueCount > 0 ? 1 : 0.5,
          }}>
          Start review{reviewDueCount > 0 ? " (" + reviewDueCount + " due)" : ""}
        </button>
      </div>

      {/* the journey: paths as places, units as regions, lessons
          as stops. Filled ground is knowledge the learner owns;
          a dashed, dimmed stop is finished ground whose review
          has come due, so review due shows on the map itself. */}
      <div style={{ marginBottom: 30 }}>
        <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.12em", color: accent, marginBottom: 8 }}>LEARNING PATHS</div>
        <h2 style={{ fontFamily: SERIF, fontSize: FONT_SIZES.display, fontWeight: 600, color: P.ink, margin: "0 0 8px", lineHeight: 1.25 }}>Your journey</h2>
        <p style={{ fontSize: FONT_SIZES.body, color: P.ink2, lineHeight: 1.55, margin: "0 0 10px" }}>
          Whole subjects, taught step by step, laid out as places to travel. Every lesson teaches first, then checks what stuck, and nothing here needs a search to start.
        </p>
        <p style={{ fontSize: FONT_SIZES.label, color: P.ink2, lineHeight: 1.55, margin: "0 0 18px" }}>
          How to read the map: a filled stop is ground you own. The outlined stop is where you are. A dashed stop marked fading is a finished lesson whose review has come due; it is still yours, and a visit to the review bench brings it back.
        </p>
        {LEARNING_PATHS.map((path) => {
          const pp = pathProgress(path, builtinProgress);
          const flat = flattenPathLessons(path);
          let stopNo = -1;
          return (
            <div key={path.id} style={{ background: P.raised, border: "1px solid " + P.line, borderRadius: 22, padding: "20px 20px 10px", marginBottom: 18 }}>
              <button onClick={() => setScreen({ name: "bpath", pathId: path.id })}
                style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "var(--cb-font)", color: P.ink }}>
                <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                  <span style={{ fontFamily: SERIF, fontSize: FONT_SIZES.title, fontWeight: 700, lineHeight: 1.3 }}>{path.title}</span>
                  <span style={{ fontSize: FONT_SIZES.label, fontWeight: 700, color: accent, flexShrink: 0 }}>
                    {pp.complete ? "Complete" : pp.done > 0 ? pp.done + " of " + pp.total + " stops" : pp.total + " stops"}
                  </span>
                </span>
                <span style={{ display: "block", fontSize: FONT_SIZES.label, color: P.ink2, lineHeight: 1.5, marginTop: 4 }}>{path.blurb}</span>
                <span style={{ display: "block", height: 7, borderRadius: RADIUS.pill, background: P.line, overflow: "hidden", marginTop: 10 }}>
                  <span className="lv-fill" style={{ display: "block", height: "100%", background: accent, borderRadius: RADIUS.pill, width: pp.pct + "%" }} />
                </span>
              </button>
              {path.units.map((unit, ui) => {
                const unitOwned = unit.lessons.every((l) => progressStore[l.id] && progressStore[l.id].done);
                return (
                  <div key={unit.id} style={{
                    marginTop: 16, borderRadius: 16, padding: "12px 12px 2px",
                    background: unitOwned ? withAlphaSafe(accent, P.dark ? 0.13 : 0.08) : "transparent",
                    border: "1px solid " + (unitOwned ? accent : "transparent"),
                  }}>
                    <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.1em", color: unitOwned ? accent : P.faint, marginBottom: 10, paddingLeft: 4 }}>
                      UNIT {ui + 1} · {unit.title.toUpperCase()}{unitOwned ? " · YOURS" : ""}
                    </div>
                    {unit.lessons.map((lesson) => {
                      stopNo += 1;
                      const myStop = stopNo;
                      const rec = progressStore[lesson.id];
                      const isDone = !!(rec && rec.done);
                      const mastered = isLessonMastered(rec);
                      const fading = isLessonFading(rec);
                      const unlocked = isLessonUnlocked(path, lesson.id, builtinProgress);
                      const isCurrent = unlocked && !isDone;
                      return (
                        <div key={lesson.id} style={{ display: "flex", gap: 13, alignItems: "flex-start", marginBottom: 12 }}>
                          <span aria-hidden="true" className={isCurrent ? "lv-pulse" : ""}
                            style={{
                              flexShrink: 0, width: 40, height: 40, borderRadius: "50%", marginTop: 2,
                              background: isDone ? accent : P.bg,
                              border: (fading ? "2px dashed " : "2px solid ") + (isDone || isCurrent ? accent : P.line),
                              display: "flex", alignItems: "center", justifyContent: "center",
                              color: isDone ? (at || "#101408") : isCurrent ? accent : P.faint,
                              fontWeight: 800, fontSize: FONT_SIZES.label, fontFamily: "var(--cb-font)",
                              opacity: fading ? 0.7 : 1,
                            }}>
                            {isDone ? (
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M5 12.5 L10 17 L19 7.5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            ) : unlocked ? myStop + 1 : (
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <rect x="5" y="10.5" width="14" height="9.5" rx="2.5" stroke="currentColor" strokeWidth="2" />
                                <path d="M8 10.5 V7.8 a4 4 0 0 1 8 0 v2.7" stroke="currentColor" strokeWidth="2" />
                              </svg>
                            )}
                          </span>
                          <button className="lv-node"
                            onClick={() => { if (unlocked) startBuiltinLesson(path, myStop); else setScreen({ name: "bpath", pathId: path.id }); }}
                            style={{
                              flex: 1, minWidth: 0, display: "block", textAlign: "left", cursor: "pointer",
                              background: P.bg, border: "1px solid " + (isCurrent ? accent : P.line), borderRadius: 14,
                              padding: "11px 14px", fontFamily: "var(--cb-font)", color: P.ink,
                              opacity: unlocked ? 1 : 0.6,
                            }}>
                            <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                              <span style={{ fontFamily: SERIF, fontSize: FONT_SIZES.body, fontWeight: 700, lineHeight: 1.3 }}>{lesson.title}</span>
                              <span style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.06em", color: isDone || isCurrent ? accent : P.faint, flexShrink: 0 }}>
                                {mastered ? "MASTERED" : fading ? "FADING" : isDone ? "DONE" : isCurrent ? "NEXT STOP" : "LOCKED"}
                              </span>
                            </span>
                            <span style={{ display: "block", color: P.ink2, fontSize: FONT_SIZES.label, lineHeight: 1.45, marginTop: 3 }}>
                              {fading ? "Finished, and its review is due." : lesson.subtitle}
                            </span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* courses from searches: heading for everything below */}
      <div style={{ marginBottom: 4 }}>
        <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.12em", color: accent, marginBottom: 8 }}>TOPIC COURSES</div>
        <p style={{ fontSize: FONT_SIZES.body, color: P.ink2, lineHeight: 1.55, margin: "0 0 18px" }}>
          Twenty four topics, each a full course of taught lessons and quizzes. Pick one and start learning it right away, no searching needed.
        </p>
      </div>

      {/* the catalog */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          {["All", ...CATALOG.map((c) => c.name), ...(published.length ? ["From contributors"] : [])].map((name) => (
            <button key={name} className="lv-chip" onClick={() => setCatFilter(name)}
              style={{
                borderRadius: RADIUS.pill, padding: "9px 15px", fontSize: FONT_SIZES.label, fontWeight: 600, cursor: "pointer", fontFamily: "var(--cb-font)",
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
            const topicPath = topicPathFor(t.t);
            const tpp = topicPath ? pathProgress(topicPath, builtinProgress) : null;
            const mastery = topicPath ? topicMasteryLevel(topicPath, builtinProgress) : 0;
            return (
              <button key={cat.name + t.t} className="lv-topic"
                onClick={() => { if (topicPath) setScreen({ name: "bpath", pathId: topicPath.id }); }}
                style={{
                  textAlign: "left", cursor: "pointer", padding: 0, overflow: "hidden",
                  background: P.raised, border: "1px solid " + P.line, borderRadius: 20,
                  fontFamily: "var(--cb-font)", color: P.ink,
                }}>
                <Cover title={t.t} height={104} radius={0} cat={cat} img={t.img} />
                <span style={{ display: "block", padding: "14px 16px 16px" }}>
                  <span style={{ fontFamily: SERIF, fontSize: FONT_SIZES.title, fontWeight: 600, lineHeight: 1.3, display: "block" }}>{t.t}</span>
                  <span style={{ fontSize: FONT_SIZES.label, color: P.ink2, lineHeight: 1.5, display: "block", marginTop: 5, minHeight: 39 }}>{t.b}</span>
                  {mastery > 0 && (
                    <span style={{ display: "block", fontSize: FONT_SIZES.label, fontWeight: 700, color: accent, marginTop: 8 }}>
                      Mastery level {mastery} of 5
                    </span>
                  )}
                  <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                    <span style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.08em", color: P.faint }}>{cat.name.toUpperCase()}</span>
                    <span style={{ fontSize: FONT_SIZES.label, fontWeight: 700, color: accent }}>{tpp && tpp.complete ? "Complete" : tpp && tpp.done > 0 ? tpp.done + " of " + tpp.total : "Start"}</span>
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
                  <span style={{ fontFamily: SERIF, fontSize: FONT_SIZES.title, fontWeight: 600, lineHeight: 1.3, display: "block" }}>{e.title}</span>
                  <span style={{ fontSize: FONT_SIZES.label, color: P.ink2, lineHeight: 1.5, display: "block", marginTop: 5, minHeight: 39 }}>{e.blurb || e.query}</span>
                  <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                    <span style={{ fontSize: FONT_SIZES.caption, color: P.faint, display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <span style={{ color: accent, display: "inline-flex" }}><Icon name="cortex" size={12} /></span>
                      by {String(e.createdBy || "").split("@")[0]}
                    </span>
                    <span style={{ fontSize: FONT_SIZES.label, fontWeight: 700, color: accent }}>{existing ? "Open" : isBuilding ? "Searching..." : "Build course"}</span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <p style={{ fontSize: FONT_SIZES.caption, color: P.faint, margin: "14px 0 0" }}>Cover photos are free stock matched to each topic, from Pexels, Unsplash, and Wikimedia Commons.</p>
        {buildError && catFilter !== null && buildingLabel === "" && (
          <p style={{ color: "#FF8A8A", fontSize: FONT_SIZES.body, margin: "14px 0 0" }}>{buildError}</p>
        )}
      </div>

      {/* courses from your searches: the builder, and the library
          of courses it has built for you */}
      <div style={{ marginBottom: 4 }}>
        <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.12em", color: accent, marginBottom: 8 }}>COURSES FROM YOUR SEARCHES</div>
        <p style={{ fontSize: FONT_SIZES.body, color: P.ink2, lineHeight: 1.55, margin: "0 0 18px" }}>
          Ask about anything in Search, or name a topic below, and Cortex turns it into taught lessons with checks. The courses you build live here, under the journey, where they belong.
        </p>
      </div>

      {/* topic builder */}
      <div style={{ background: P.raised, border: "1px solid " + P.line, borderRadius: 20, padding: 22, marginBottom: 24 }}>
        <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.12em", color: accent, marginBottom: 8 }}>BUILD A COURSE</div>
        <p style={{ fontSize: FONT_SIZES.body, color: P.ink2, lineHeight: 1.55, margin: "0 0 14px" }}>
          Name a topic. Cerebrum searches for what is known and turns the answer's ideas into taught lessons with quizzes, on the spot.
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
              padding: "14px 16px", fontSize: 16, color: P.ink, fontFamily: "var(--cb-font)", minHeight: 54, boxSizing: "border-box",
            }}
          />
          <button className="lv-btn lv-btn-primary" onClick={buildCourse} disabled={building || !topic.trim()}
            style={{
              background: accent, color: at || "#101408", border: "none", borderRadius: 14,
              padding: "14px 26px", fontSize: FONT_SIZES.body, fontWeight: 700, cursor: building ? "wait" : "pointer",
              fontFamily: "var(--cb-font)", minHeight: 54, opacity: building || !topic.trim() ? 0.55 : 1,
            }}>
            {building ? "Searching..." : "Build course"}
          </button>
        </div>
        {buildError && <p style={{ color: "#FF8A8A", fontSize: FONT_SIZES.body, margin: "12px 0 0" }}>{buildError}</p>}
      </div>

      {/* library */}
      {courses.length === 0 ? (
        <div style={{ border: "1px dashed " + P.line, borderRadius: 20, padding: "38px 28px", textAlign: "center" }}>
          <h3 style={{ fontFamily: SERIF, color: P.ink, fontSize: FONT_SIZES.display, fontWeight: 600, margin: "0 0 8px" }}>No courses yet</h3>
          <p style={{ color: P.ink2, fontSize: FONT_SIZES.body, lineHeight: 1.6, margin: "0 auto 20px", maxWidth: 430 }}>
            Build one above, or open any answer in Search and choose Turn into course. Either way, the answer's ideas become lessons that teach and then check.
          </p>
          <button onClick={() => onNavigate && onNavigate("search")}
            style={{ background: "transparent", border: "1px solid " + P.line, borderRadius: RADIUS.lg, padding: "12px 22px", color: P.ink, fontSize: FONT_SIZES.body, cursor: "pointer", fontFamily: "var(--cb-font)" }}>
            Go to Search
          </button>
        </div>
      ) : (
        <>
          <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.12em", color: P.faint, margin: "6px 0 14px" }}>YOUR COURSES</div>
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
                    <span style={{ fontFamily: SERIF, fontSize: FONT_SIZES.title, fontWeight: 600, lineHeight: 1.3, display: "block", minHeight: 48 }}>{course.title}</span>
                    <span style={{ fontSize: FONT_SIZES.caption, color: P.faint, display: "block", marginTop: 4 }}>
                      {course.lessons.length} lessons · {(course.vocab || []).length} terms
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
                      <span style={{ flex: 1, height: 7, borderRadius: RADIUS.pill, background: P.line, overflow: "hidden", display: "block" }}>
                        <span className="lv-fill" style={{ display: "block", height: "100%", background: accent, borderRadius: RADIUS.pill, width: (course.lessons.length ? Math.round((doneCount / course.lessons.length) * 100) : 0) + "%" }} />
                      </span>
                      <span style={{ fontSize: FONT_SIZES.caption, color: mem.pct > 0 || doneCount > 0 ? accent : P.faint, fontWeight: 600 }}>{mem.label}</span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* contributor studio */}
      {access.isCreator && (
        <div style={{ background: P.raised, border: "1px solid " + P.line, borderRadius: 20, padding: 22, marginBottom: 24 }}>
          <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.12em", color: accent, marginBottom: 8 }}>CONTRIBUTOR STUDIO</div>
          <p style={{ fontSize: FONT_SIZES.body, color: P.ink2, lineHeight: 1.55, margin: "0 0 14px" }}>
            You can publish to the catalog. A published course is a topic and a promise: when someone taps it, Cortex builds the course on the spot, same as every course here.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input value={studio.title} onChange={(e) => setStudio({ ...studio, title: e.target.value })}
              placeholder="Course title" aria-label="Catalog course title"
              style={{ flex: "1 1 220px", background: P.bg, border: "1px solid " + P.line, borderRadius: RADIUS.lg, padding: "12px 14px", fontSize: 16, color: P.ink, fontFamily: "var(--cb-font)", minHeight: 48, boxSizing: "border-box" }} />
            <select value={studio.category} onChange={(e) => setStudio({ ...studio, category: e.target.value })}
              aria-label="Catalog category"
              style={{ flex: "0 1 200px", background: P.bg, border: "1px solid " + P.line, borderRadius: RADIUS.lg, padding: "12px 14px", fontSize: 16, color: P.ink, fontFamily: "var(--cb-font)", minHeight: 48, boxSizing: "border-box" }}>
              {CATALOG.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
            <input value={studio.query} onChange={(e) => setStudio({ ...studio, query: e.target.value })}
              placeholder="Topic the course is built from, e.g. tardigrade desiccation" aria-label="Catalog course topic"
              style={{ flex: "1 1 220px", background: P.bg, border: "1px solid " + P.line, borderRadius: RADIUS.lg, padding: "12px 14px", fontSize: 16, color: P.ink, fontFamily: "var(--cb-font)", minHeight: 48, boxSizing: "border-box" }} />
            <input value={studio.blurb} onChange={(e) => setStudio({ ...studio, blurb: e.target.value })}
              placeholder="One line that sells it honestly" aria-label="Catalog course blurb"
              style={{ flex: "1 1 220px", background: P.bg, border: "1px solid " + P.line, borderRadius: RADIUS.lg, padding: "12px 14px", fontSize: 16, color: P.ink, fontFamily: "var(--cb-font)", minHeight: 48, boxSizing: "border-box" }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 14, flexWrap: "wrap" }}>
            <button className="lv-btn lv-btn-primary" onClick={publishEntry} disabled={!studio.title.trim() || !studio.query.trim()}
              style={{ background: accent, color: at || "#101408", border: "none", borderRadius: RADIUS.lg, padding: "12px 24px", fontSize: FONT_SIZES.body, fontWeight: 700, cursor: "pointer", fontFamily: "var(--cb-font)", opacity: !studio.title.trim() || !studio.query.trim() ? 0.55 : 1 }}>
              Publish to catalog
            </button>
            {studioMsg && <span style={{ fontSize: FONT_SIZES.label, color: P.ink2 }}>{studioMsg}</span>}
          </div>
          {published.filter((e) => access.isFounder || e.createdBy === access.email).length > 0 && (
            <div style={{ marginTop: 18, borderTop: "1px solid " + P.line, paddingTop: 14 }}>
              {published.filter((e) => access.isFounder || e.createdBy === access.email).map((e) => (
                <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0" }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: FONT_SIZES.body, color: P.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.title} <span style={{ color: P.ink2 }}>· {e.category}</span></span>
                  <button onClick={() => deleteEntry(e.id)}
                    style={{ background: "transparent", border: "1px solid " + P.line, borderRadius: RADIUS.pill, color: P.ink2, cursor: "pointer", padding: "6px 12px", fontSize: FONT_SIZES.label, fontFamily: "var(--cb-font)" }}>
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
          <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.12em", color: accent, marginBottom: 8 }}>CREATORS</div>
          <p style={{ fontSize: FONT_SIZES.body, color: P.ink2, lineHeight: 1.55, margin: "0 0 14px" }}>
            Type an email and that account can create for Cortex: publishing catalog courses from the studio above. Creators also receive the Cortex Contributor badge on their profile.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input value={creatorEmail} onChange={(e) => setCreatorEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") grantCreator(); }}
              placeholder="creator@example.com" aria-label="Creator email" type="email"
              style={{ flex: "1 1 260px", background: P.bg, border: "1px solid " + P.line, borderRadius: RADIUS.lg, padding: "12px 14px", fontSize: 16, color: P.ink, fontFamily: "var(--cb-font)", minHeight: 48, boxSizing: "border-box" }} />
            <button className="lv-btn lv-btn-primary" onClick={grantCreator} disabled={!creatorEmail.trim()}
              style={{ background: accent, color: at || "#101408", border: "none", borderRadius: RADIUS.lg, padding: "12px 24px", fontSize: FONT_SIZES.body, fontWeight: 700, cursor: "pointer", fontFamily: "var(--cb-font)", opacity: !creatorEmail.trim() ? 0.55 : 1 }}>
              Allow creator
            </button>
          </div>
          {ownerMsg && <p style={{ fontSize: FONT_SIZES.label, color: P.ink2, margin: "12px 0 0" }}>{ownerMsg}</p>}
          {creators.length > 0 && (
            <div style={{ marginTop: 16, borderTop: "1px solid " + P.line, paddingTop: 12 }}>
              {creators.map((c) => (
                <div key={c.email} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0" }}>
                  <span style={{ color: accent, display: "inline-flex" }}><Icon name="cortex" size={15} /></span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: FONT_SIZES.body, color: P.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.email}</span>
                  <button onClick={() => revokeCreator(c.email)}
                    style={{ background: "transparent", border: "1px solid " + P.line, borderRadius: RADIUS.pill, color: P.ink2, cursor: "pointer", padding: "6px 12px", fontSize: FONT_SIZES.label, fontFamily: "var(--cb-font)" }}>
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

    </div>
  );
}
