/* The Bench (Nov 12, 2026). The Nova tab is her bench in the lab
 * now: a place you visit her, not a notebook you read. Dusty
 * rejected Field Notes as the tab the same day he ordered the
 * fix wave, and picked The Bench from the rethink concepts, with
 * the Her Rounds memory driven opening stolen into it.
 *
 * What stands here: she stands at stage size on the first screen,
 * alive, rendered by the NovaFigure build through NovaLive. She
 * opens with memory, from data the app actually holds on this
 * device (src/bench.js): papers saved since the last visit, the
 * last question asked, a topic returned to, reviews that came
 * back around. When the store holds nothing she can honestly
 * name, her line says so. She puts one specimen on the bench:
 * a Field Notes entry, chosen by those same facts. Examining it
 * is the session. Her one question per entry survives as her
 * bench manner, spoken and answered in conversation, never as
 * a quiz form, and there is no true or false anywhere, no card
 * deck, and nothing on this tab is scored.
 *
 * What the Field Notes build left behind, kept on purpose: the
 * dated entries themselves, now bench notes, the record of
 * sittings rather than the product. The shelf, one object per
 * finished thread. The streak, her quiet count of days you
 * showed up. The review ladder, now her memory putting a
 * specimen back on the bench. Reading never calls the fleet,
 * so a bad fleet day degrades onto the written entries exactly
 * as before.
 *
 * The module keeps its FieldNotesView name and mount so the
 * answer imprint and Library mark wiring in CerebrumApp.jsx,
 * which read from src/fieldNotes.js, stay untouched by this
 * lane. The presence change staged beside it lives in
 * NovaRive.jsx: this view passes residentFigure on her speaker
 * mounts, so at speaker sizes she renders as her cropped face
 * instead of the glyph. Nav glyphs elsewhere stay glyphs.
 */

import React, { useState, useEffect, useMemo } from "react";
import { RADIUS } from "./designSystem.jsx";
import { accentInk } from "./appUtils.js";
import { NovaLive, emitNovaActivity, loadNovaQuirks, saveNovaQuirks, recordNovaVisit } from "./LearnView.jsx";
import { FIELD_NOTE_THREADS, fieldNoteEntries, entryIsToday, notebookForFleet, scheduleEntryReview, threadProgress } from "./fieldNotes.js";
import { benchFacts, benchOpeningLines, makeSessionRecord, sessionDateLabel, BENCH_TAGLINE, BENCH_LAST_VISIT_KEY, BENCH_SESSIONS_KEY } from "./bench.js";
import { useOnlineStatus } from "./useOnlineStatus.js";

const FN_READ_KEY = "cerebrum-fieldnotes-read";
const FN_REVIEW_KEY = "cerebrum-fieldnotes-reviews";
const FN_DAYS_KEY = "cerebrum-fieldnotes-days";
const SAVED_KEY = "cb_saved";
const HISTORY_KEY = "cb_history";

function loadJSON(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: the bench still reads */ }
}
function loadStamp(key) {
  try { const v = Number(localStorage.getItem(key)); return Number.isFinite(v) && v > 0 ? v : 0; } catch { return 0; }
}
function todayKey(d = new Date()) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

export default function FieldNotesView({ P, accent, at, onNavigate }) {
  const ink = accentInk(P, accent);
  const online = useOnlineStatus();
  const entries = useMemo(() => fieldNoteEntries(FIELD_NOTE_THREADS), []);
  const [screen, setScreen] = useState({ name: "home" });
  const [readIds, setReadIds] = useState(() => loadJSON(FN_READ_KEY, []));
  const [reviewState, setReviewState] = useState(() => loadJSON(FN_REVIEW_KEY, {}));
  const [days, setDays] = useState(() => loadJSON(FN_DAYS_KEY, []));
  const [sessions, setSessions] = useState(() => loadJSON(BENCH_SESSIONS_KEY, {}));
  const [picked, setPicked] = useState(null);
  const [revealed, setRevealed] = useState(false);

  /* Her memory of the last bench visit, read once on arrival and
   * then restamped. The opening below is computed from the state
   * as it stood when the reader walked in, so her lines describe
   * the gap honestly and do not shift while she is speaking. */
  const [arrival] = useState(() => ({
    lastVisitMs: loadStamp(BENCH_LAST_VISIT_KEY),
    saved: loadJSON(SAVED_KEY, []),
    history: loadJSON(HISTORY_KEY, []),
    readIds: loadJSON(FN_READ_KEY, []),
    reviewState: loadJSON(FN_REVIEW_KEY, {}),
  }));

  useEffect(() => {
    const q = loadNovaQuirks();
    const next = recordNovaVisit(q);
    if (next !== q) saveNovaQuirks(next);
    try { localStorage.setItem(BENCH_LAST_VISIT_KEY, String(Date.now())); } catch { /* private mode: no stamp, no harm */ }
  }, []);

  const facts = useMemo(() => benchFacts({
    saved: arrival.saved, history: arrival.history, readIds: arrival.readIds,
    reviewState: arrival.reviewState, entries, lastVisitMs: arrival.lastVisitMs, nowMs: Date.now(),
  }), [arrival, entries]);
  const opening = useMemo(() => benchOpeningLines(facts), [facts]);

  const notebook = notebookForFleet({ fleetUp: online, entries, reviewState, now: Date.now() });
  const due = notebook.reviews;
  const todayEntry = entries[0];
  const streak = useMemo(() => {
    const set = new Set(days);
    let count = 0;
    const d = new Date();
    if (!set.has(todayKey(d))) d.setDate(d.getDate() - 1);
    while (set.has(todayKey(d))) { count++; d.setDate(d.getDate() - 1); }
    return count;
  }, [days]);

  const markSession = (id, patch) => {
    setSessions((prev) => {
      const next = makeSessionRecord(prev, id, patch, Date.now());
      saveJSON(BENCH_SESSIONS_KEY, next);
      return next;
    });
  };
  const openEntry = (id) => {
    setPicked(null); setRevealed(false); setScreen({ name: "session", id });
    markSession(id, { openedAt: (sessions[id] && sessions[id].openedAt) || Date.now() });
    try { window.scrollTo(0, 0); } catch { /* reading fine without it */ }
  };
  const openReview = (id) => { setPicked(null); setRevealed(false); setScreen({ name: "review", id }); try { window.scrollTo(0, 0); } catch { /* reading fine without it */ } };
  const goHome = () => { setPicked(null); setRevealed(false); setScreen({ name: "home" }); };

  const markRead = (id) => {
    if (!readIds.includes(id)) { const next = [...readIds, id]; setReadIds(next); saveJSON(FN_READ_KEY, next); }
    const tk = todayKey();
    if (!days.includes(tk)) { const next = [...days, tk]; setDays(next); saveJSON(FN_DAYS_KEY, next); }
  };

  const answer = (entry, idx, isReview) => {
    if (revealed) return;
    setPicked(idx);
    setRevealed(true);
    const correct = idx === entry.question.correct;
    markRead(entry.id);
    markSession(entry.id, { answeredAt: Date.now(), correct });
    const next = scheduleEntryReview(reviewState, entry.id, correct, Date.now());
    setReviewState(next);
    saveJSON(FN_REVIEW_KEY, next);
    if (!isReview && correct) emitNovaActivity("review", "correct");
  };

  const serif = { fontFamily: "var(--cb-serif)" };
  const shell = { maxWidth: 980, margin: "0 auto", padding: "28px 20px 64px", color: P.ink };
  const goldBtn = {
    border: "1px solid " + accent, borderRadius: RADIUS.sm, padding: "10px 18px",
    fontSize: 14, fontWeight: 500, cursor: "pointer", fontFamily: "var(--cb-font)", color: P.ink,
    background: P.raised || P.bg,
  };
  const quietBtn = { background: P.panel || P.bg, color: P.ink, border: "1px solid " + P.line, borderRadius: RADIUS.sm, padding: "10px 18px", fontSize: 14, cursor: "pointer", fontFamily: "var(--cb-font)" };
  const eyebrow = { fontSize: 13, letterSpacing: "0.08em", color: ink, margin: "0 0 12px", fontWeight: 500 };

  /* Her one question, spoken at the bench. She asks, you call it,
   * she reacts. The choices are lines she offers out loud, set as
   * plain rows of text you can tap, not a form in boxes. */
  const spokenQuestion = (entry, isReview) => {
    const mood = revealed ? (picked === entry.question.correct ? "pleased" : "deadpan") : "explaining";
    return (
      <div style={{ marginTop: 30 }}>
        <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
          <span style={{ flexShrink: 0 }}>
            <NovaLive state={mood} size={112} framing="bust" surface="nova-home" residentFigure />
          </span>
          <div style={{ flex: "1 1 300px", minWidth: 0 }}>
            <p style={eyebrow}>SHE ASKS ONE THING</p>
            <p style={{ ...serif, fontSize: 20, lineHeight: 1.5, margin: 0 }}>{entry.question.prompt}</p>
            <p style={{ fontSize: 14, color: P.ink2, margin: "10px 0 0" }}>Call it before you peek at the outcome. She remembers what you said, and so does the ladder.</p>
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          {entry.question.options.map((opt, i) => {
            const isPick = picked === i;
            const isRight = revealed && i === entry.question.correct;
            return (
              <button key={i} onClick={() => answer(entry, i, isReview)} disabled={revealed}
                style={{
                  display: "block", width: "100%", textAlign: "left", color: isRight ? ink : P.ink,
                  background: "transparent", border: "none", borderBottom: "1px solid " + P.line,
                  padding: "13px 4px", fontSize: 16, lineHeight: 1.5,
                  cursor: revealed ? "default" : "pointer", fontFamily: "var(--cb-font)",
                  fontWeight: isPick || isRight ? 500 : 400,
                  opacity: revealed && !isRight && !isPick ? 0.62 : 1,
                }}>
                {opt}
              </button>
            );
          })}
        </div>
        {revealed && (
          <div style={{ marginTop: 18, background: P.panel || P.bg, border: "1px solid " + P.line, borderRadius: RADIUS.sm, padding: "16px 18px" }}>
            <p style={{ fontSize: 15, fontWeight: 500, margin: "0 0 8px", color: ink }}>{picked === entry.question.correct ? "Right. That one sticks." : "Not yet. Look at it this way."}</p>
            <p style={{ ...serif, fontSize: 16, lineHeight: 1.6, margin: 0 }}>{entry.question.feedback}</p>
            {isReview && (
              <button onClick={() => openEntry(entry.id)} style={{ ...quietBtn, marginTop: 14 }}>Open the bench note</button>
            )}
          </div>
        )}
      </div>
    );
  };

  if (screen.name === "session" || screen.name === "review") {
    const entry = entries.find((e) => e.id === screen.id) || todayEntry;
    const isReview = screen.name === "review";
    const rec = sessions[entry.id] || null;
    const recLabel = sessionDateLabel(rec);
    return (
      <div style={shell}>
        <button onClick={goHome} style={{ ...quietBtn, marginBottom: 22 }}>Back to the bench</button>
        <p style={{ fontSize: 13, letterSpacing: "0.08em", color: ink, margin: "0 0 8px", fontWeight: 500 }}>{isReview ? "BACK ON THE BENCH · " + entry.threadTitle.toUpperCase() : "AT THE BENCH · " + entry.threadTitle.toUpperCase()}</p>
        <h1 style={{ ...serif, fontSize: 32, fontWeight: 500, lineHeight: 1.2, margin: "0 0 10px" }}>{entry.title}</h1>
        <p style={{ fontSize: 14, color: P.ink2, margin: "0 0 18px" }}>
          {isReview
            ? (recLabel ? "We examined this together on " + recLabel + ". She kept it warm. Try the question before you open the note again." : "This one came back around on her ladder. Try the question before you open the note again.")
            : "Her bench note, dated " + entry.dateLabel + ". She wrote it as she read, and she will walk it with you."}
        </p>
        {isReview ? spokenQuestion(entry, true) : (
          <>
            <p style={{ ...serif, fontSize: 17, lineHeight: 1.65, margin: 0, whiteSpace: "pre-wrap" }}>{entry.body}</p>
            {spokenQuestion(entry, false)}
            <div style={{ marginTop: 26 }}>
              <button onClick={goHome} style={goldBtn}>Back to the bench</button>
            </div>
          </>
        )}
      </div>
    );
  }

  const completedThreads = FIELD_NOTE_THREADS.filter((t) => threadProgress(t, readIds).complete);
  const onBench = facts.onBench || todayEntry;
  return (
    <div style={shell}>
      <div style={{ display: "flex", gap: 28, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ flexShrink: 0 }}>
          <NovaLive state="greeting" size={264} framing="full" surface="nova-home" reviewDue={due.length} />
        </span>
        <div style={{ flex: "1 1 320px", minWidth: 0 }}>
          <h1 style={{ ...serif, fontSize: 42, fontWeight: 500, margin: 0, lineHeight: 1.1 }}>The Bench</h1>
          <p style={{ fontSize: 14, color: ink, margin: "6px 0 0" }}>{BENCH_TAGLINE}</p>
          {opening.map((line, i) => (
            <p key={i} style={{ ...serif, fontSize: 17, lineHeight: 1.6, color: i === 0 ? P.ink : P.ink2, margin: "12px 0 0" }}>{line}</p>
          ))}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
            <span style={{ border: "1px solid " + P.line, borderRadius: RADIUS.pill, padding: "7px 13px", fontSize: 13, background: P.panel || P.bg }}>Streak · {streak} {streak === 1 ? "day" : "days"}</span>
            <span style={{ border: "1px solid " + P.line, borderRadius: RADIUS.pill, padding: "7px 13px", fontSize: 13, background: P.panel || P.bg }}>Examined · {readIds.length} of {entries.length}</span>
            {due.length > 0 && <span style={{
              border: "1px solid " + accent, borderRadius: RADIUS.pill, padding: "7px 13px", fontSize: 13,
              background: P.raised || P.bg,
            }}>Back around · {due.length}</span>}
          </div>
        </div>
      </div>

      {notebook.paused && (
        <div style={{ marginTop: 22, background: P.panel || P.bg, border: "1px solid " + P.line, borderRadius: RADIUS.sm, padding: "14px 16px" }}>
          <p style={{ ...serif, fontSize: 16, margin: 0 }}>{notebook.notice}</p>
        </div>
      )}

      {onBench && (
        <div style={{ marginTop: 34, borderTop: "1px solid " + P.line, paddingTop: 24 }}>
          <p style={eyebrow}>ON THE BENCH</p>
          <div style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "flex-start" }}>
            <div style={{ flex: "1 1 340px", minWidth: 0 }}>
              <p style={{ fontSize: 13, color: ink, margin: "0 0 6px" }}>{onBench.dateLabel} · {onBench.threadTitle}</p>
              <h2 style={{ ...serif, fontSize: 26, fontWeight: 500, lineHeight: 1.25, margin: "0 0 10px" }}>{onBench.title}</h2>
              <p style={{ ...serif, fontSize: 16, lineHeight: 1.6, color: P.ink2, margin: 0 }}>{onBench.body.split(". ").slice(0, 2).join(". ")}.</p>
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              <button onClick={() => (facts.onBenchWhy === "review" ? openReview(onBench.id) : openEntry(onBench.id))} style={goldBtn}>Examine it together</button>
              {onNavigate && <button onClick={() => onNavigate("search")} style={quietBtn}>Bring her a question instead</button>}
            </div>
          </div>
        </div>
      )}

      {due.length > 0 && (
        <div style={{ marginTop: 34 }}>
          <p style={eyebrow}>COMING BACK AROUND</p>
          <div style={{ display: "grid", gap: 10 }}>
            {due.map(({ entry }) => (
              <button key={entry.id} onClick={() => openReview(entry.id)} style={{ textAlign: "left", background: P.panel || P.bg, border: "1px solid " + P.line, borderRadius: RADIUS.sm, padding: "14px 16px", cursor: "pointer", color: P.ink, fontFamily: "var(--cb-font)" }}>
                <span style={{ fontSize: 13, color: ink }}>{entry.dateLabel} · {entry.threadTitle}</span>
                <span style={{ display: "block", ...serif, fontSize: 18, marginTop: 4 }}>{entry.title}</span>
                <span style={{ display: "block", fontSize: 14, color: P.ink2, marginTop: 4 }}>She puts it back on the bench. Try before you open it.</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {completedThreads.length > 0 && (
        <div style={{ marginTop: 34 }}>
          <p style={eyebrow}>HER SHELF</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {completedThreads.map((t) => (
              <span key={t.id} style={{ border: "1px solid " + P.line, borderRadius: RADIUS.pill, padding: "8px 14px", fontSize: 14, background: P.panel || P.bg }}>{t.shelfObject} · {t.title}</span>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 38 }}>
        <p style={eyebrow}>BENCH NOTES</p>
        <p style={{ ...serif, fontSize: 16, lineHeight: 1.6, color: P.ink2, margin: "0 0 14px" }}>The dated entries are her bench notes now, the Field Notes she wrote as she read. They are the record of sittings at this bench, not the visit itself. Open one and she will examine it with you.</p>
        <div style={{ display: "grid", gap: 12 }}>
          {entries.map((entry, i) => {
            const rec = sessions[entry.id] || null;
            const recLabel = sessionDateLabel(rec);
            return (
              <button key={entry.id} onClick={() => openEntry(entry.id)} style={{
                textAlign: "left",
                border: "1px solid " + (i === 0 ? accent : P.line),
                borderRadius: RADIUS.sm, padding: "16px 18px", cursor: "pointer", color: P.ink, fontFamily: "var(--cb-font)",
                background: i === 0 ? (P.raised || P.bg) : P.panel || P.bg,
              }}>
                <span style={{ fontSize: 13, color: ink }}>{i === 0 && entryIsToday(entry) ? "Today · " : ""}{entry.dateLabel} · {entry.threadTitle}</span>
                <span style={{ display: "block", ...serif, fontSize: 21, fontWeight: 500, marginTop: 5 }}>{entry.title}</span>
                <span style={{ display: "block", fontSize: 15, color: P.ink2, marginTop: 5, lineHeight: 1.5 }}>{entry.body.split(". ")[0]}.</span>
                <span style={{ display: "block", fontSize: 13, color: ink, marginTop: 8 }}>
                  {rec && rec.answeredAt ? "Session · " + (recLabel || entry.dateLabel) + (rec.correct ? " · that one stuck" : " · still loose, it will come back around")
                    : readIds.includes(entry.id) ? "Read · one question answered"
                    : "Not examined yet · one question waiting"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ marginTop: 34 }}>
        <p style={eyebrow}>THREADS SHE KEEPS</p>
        <div style={{ display: "grid", gap: 10 }}>
          {FIELD_NOTE_THREADS.map((t) => {
            const prog = threadProgress(t, readIds);
            return (
              <div key={t.id} style={{ border: "1px solid " + P.line, borderRadius: RADIUS.sm, padding: "14px 16px", background: P.panel || P.bg }}>
                <span style={{ ...serif, fontSize: 18, fontWeight: 500 }}>{t.title}</span>
                <span style={{ display: "block", fontSize: 14, color: P.ink2, marginTop: 4 }}>{t.intro}</span>
                <span style={{ display: "block", fontSize: 13, color: ink, marginTop: 7 }}>{prog.done} of {prog.total} entries examined{prog.complete ? " · " + t.shelfObject + " is on her shelf" : " · finishes with " + t.shelfObject.toLowerCase()}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
