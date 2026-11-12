/* The Bench (Nov 12, 2026). The memory and record helpers behind
 * Nova tab replacement: her bench in the lab, where the Field Notes
 * entries live on as records of sessions instead of the product
 * itself.
 *
 * The opening of a bench visit is memory driven, in the Her Rounds
 * sense: she notes what changed in the reader library and topics
 * since the last visit, from data the app actually holds on this
 * device. Saved papers (cb_saved), past answers (cb_history), the
 * notebook read and review state, and the last bench visit stamp.
 * Nothing here invents a paper, a finding, or a visit. When the
 * store holds nothing she can honestly name, the line says so.
 *
 * Pure functions only. The view feeds them parsed local state and
 * the suite pins them without a DOM or a network. Reading a bench
 * never calls the fleet: everything below runs on cached data.
 */

export const BENCH_TAGLINE = "Science, one spark at a time.";
export const BENCH_LAST_VISIT_KEY = "cerebrum-bench-lastvisit";
export const BENCH_SESSIONS_KEY = "cerebrum-bench-sessions";

const DAY_MS = 86400000;

export function toMs(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : 0;
  }
  return 0;
}

function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/* Whole calendar days between two stamps, never negative. */
export function benchDaysAway(lastVisitMs, nowMs) {
  if (!lastVisitMs || !nowMs) return 0;
  return Math.max(0, Math.round((startOfDay(nowMs) - startOfDay(lastVisitMs)) / DAY_MS));
}

function cleanTitle(v) {
  const s = String(v || "").replace(/\s+/g, " ").trim();
  return s || null;
}

/* The facts her opening is allowed to use, and nothing else.
 * saved: the cb_saved array (papers with title and savedAt).
 * history: the cb_history array (answers with title or a first
 * turn question, and a ts stamp).
 * Everything returned is either a count of real rows or a title
 * copied from a real row. No synthesis, no guessing. */
export function benchFacts({ saved = [], history = [], readIds = [], reviewState = {}, entries = [], lastVisitMs = 0, nowMs = Date.now() } = {}) {
  const savedRows = (Array.isArray(saved) ? saved : []).filter((s) => s && cleanTitle(s.title));
  const histRows = (Array.isArray(history) ? history : []).filter((h) => h && (cleanTitle(h.title) || cleanTitle(h.turns && h.turns[0] && h.turns[0].q)));
  const since = lastVisitMs || 0;

  const newSaved = savedRows
    .filter((s) => since && toMs(s.savedAt || s.createdAt) > since)
    .sort((a, b) => toMs(b.savedAt || b.createdAt) - toMs(a.savedAt || a.createdAt));

  const recentHist = [...histRows].sort((a, b) => toMs(b.ts) - toMs(a.ts));
  const lastHist = recentHist[0] || null;
  const lastQuestion = lastHist ? cleanTitle(lastHist.title) || cleanTitle(lastHist.turns && lastHist.turns[0] && lastHist.turns[0].q) : null;

  /* A topic she can honestly say the reader keeps coming back to:
   * the same question asked more than once in the held history. */
  const counts = new Map();
  for (const h of histRows) {
    const t = cleanTitle(h.title) || cleanTitle(h.turns && h.turns[0] && h.turns[0].q);
    if (t) counts.set(t.toLowerCase(), (counts.get(t.toLowerCase()) || 0) + 1);
  }
  let repeatTitle = null;
  let repeatCount = 0;
  for (const h of recentHist) {
    const t = cleanTitle(h.title) || cleanTitle(h.turns && h.turns[0] && h.turns[0].q);
    if (t && (counts.get(t.toLowerCase()) || 0) > repeatCount) { repeatCount = counts.get(t.toLowerCase()) || 0; repeatTitle = t; }
  }
  if (repeatCount < 2) { repeatTitle = null; repeatCount = 0; }

  const read = new Set(Array.isArray(readIds) ? readIds : []);
  const dueIds = Object.entries(reviewState || {})
    .filter(([, r]) => r && r.dueAt && r.dueAt <= nowMs)
    .map(([id]) => id);
  const dueEntries = (entries || []).filter((e) => dueIds.includes(e.id));

  /* What she puts on the bench. A due review first, because she
   * promised it would come back around. Then an entry whose marks
   * touch the reader own recent work, matched the same plain way
   * the answer imprint matched them. Then the newest unread entry.
   * Then the newest entry of all, because the bench is never empty
   * while the notebook holds anything. */
  let onBench = null;
  let onBenchWhy = null;
  if (dueEntries.length) { onBench = dueEntries[0]; onBenchWhy = "review"; }
  if (!onBench) {
    const hay = [
      ...savedRows.map((s) => String(s.title || "")),
      ...recentHist.slice(0, 5).map((h) => String(h.title || (h.turns && h.turns[0] && h.turns[0].q) || "")),
    ].join(" ").toLowerCase();
    if (hay.trim()) {
      for (const e of entries || []) {
        if ((e.marks || []).some((m) => hay.includes(m))) { onBench = e; onBenchWhy = "match"; break; }
      }
    }
  }
  if (!onBench) {
    onBench = (entries || []).find((e) => !read.has(e.id)) || null;
    if (onBench) onBenchWhy = "unread";
  }
  if (!onBench && (entries || []).length) { onBench = entries[0]; onBenchWhy = "latest"; }

  return {
    firstVisit: !lastVisitMs,
    daysAway: benchDaysAway(lastVisitMs, nowMs),
    savedCount: savedRows.length,
    newSavedCount: newSaved.length,
    newestSavedTitle: newSaved.length ? cleanTitle(newSaved[0].title) : null,
    lastQuestion,
    repeatTitle,
    repeatCount,
    dueCount: dueEntries.length,
    readCount: read.size,
    entryCount: (entries || []).length,
    onBench,
    onBenchWhy,
  };
}

/* Her opening, built only from the facts above. Two or three short
 * lines. The order is the Her Rounds discipline: what changed since
 * the last visit first, then what she has put on the bench. When
 * there is nothing to report she says exactly that, in her voice,
 * and offers the bench anyway. First visit lines never pretend a
 * past the app does not hold. */
export function benchOpeningLines(facts) {
  if (!facts) return ["Sit down. The bench is clear, and so is my notebook."];
  const lines = [];
  if (facts.firstVisit) {
    lines.push("First time at my bench. Mind the glassware. Everything on it is real, and most of it bites a little.");
    if (facts.savedCount > 0) lines.push("You already keep " + facts.savedCount + (facts.savedCount === 1 ? " paper" : " papers") + " in your library. Good. A bench with material on it is a bench that can work.");
    else if (facts.lastQuestion) lines.push("You have been asking questions out there. Bring the next one in here and we will take it apart properly.");
    else lines.push("Nothing in your library yet, no questions I can see. Fine. We start with what I have been reading.");
  } else {
    if (facts.daysAway >= 2) lines.push("There you are. " + facts.daysAway + " days since you last stood here. The bench kept your place.");
    else if (facts.daysAway === 1) lines.push("Back again. One day away, and the bench barely cooled.");
    else lines.push("You again. The bench was still warm.");
    if (facts.newSavedCount > 0 && facts.newestSavedTitle) {
      lines.push("Since then you saved " + facts.newSavedCount + (facts.newSavedCount === 1 ? " paper" : " papers") + ". The newest is " + facts.newestSavedTitle + ". I have read the title twice and I have opinions forming.");
    } else if (facts.repeatTitle) {
      lines.push("You keep coming back to " + facts.repeatTitle + ". Twice is a habit. Habits deserve a proper look, so it goes on the list.");
    } else if (facts.lastQuestion) {
      lines.push("Last thing you asked out there was " + facts.lastQuestion + ". It is still on my mind, which is more than I say for most questions.");
    } else {
      lines.push("Nothing new in your library since you last came, and no fresh questions I can see. Quiet stretch. The bench does not mind.");
    }
    if (facts.dueCount > 0) lines.push(facts.dueCount === 1 ? "One specimen came back around while you were gone. I kept it warm for you." : facts.dueCount + " specimens came back around while you were gone. Reviews, in my language. We start there.");
  }
  if (facts.onBench) {
    if (facts.onBenchWhy === "review") lines.push("On the bench today: " + facts.onBench.title + ". You have seen it before. Today you find out what stayed.");
    else lines.push("On the bench today: " + facts.onBench.title + ". Sit down, this one is stranger than it looks.");
  }
  return lines;
}

/* One session record per examined entry, stamped when it happens.
 * Records are the bench form of the old read state: dated proof of
 * a visit, kept beside the read ids the notebook already stores. */
export function makeSessionRecord(prev, entryId, patch, nowMs = Date.now()) {
  const base = (prev && typeof prev === "object" && prev[entryId]) || {};
  return { ...(prev || {}), [entryId]: { ...base, ...patch, updatedAt: nowMs } };
}

export function sessionDateLabel(record) {
  const ms = record && (record.answeredAt || record.openedAt);
  if (!ms) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return months[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
}
