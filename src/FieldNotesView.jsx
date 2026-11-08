/* Field Notes view (Nov 8, 2026). Nova notebook is the learning
 * surface of this app now. This component replaces the old Learn
 * home at the mount point in CerebrumApp.jsx: the generated course
 * machine, the card factories, the lesson player, the paths and
 * catalog views, quests, leagues, and the old points per card are no longer
 * reachable from here. LearnView.jsx keeps that machinery in the
 * bundle because other modules still import its living pieces
 * (NovaLive, her voice banks, the shelf helpers, the progress
 * export validators), and the authored corpus data stays there
 * unread by this surface. What the learner meets is the notebook:
 * dated entries, one question per entry, reviews on the entry
 * ladder, and progress as entries read, streak, and shelf only.
 */

import React, { useState, useEffect, useMemo } from "react";
import { RADIUS } from "./designSystem.jsx";
import { accentInk } from "./appUtils.js";
import { NovaLive, emitNovaActivity, loadNovaQuirks, saveNovaQuirks, recordNovaVisit } from "./LearnView.jsx";
import { FIELD_NOTE_THREADS, fieldNoteEntries, notebookForFleet, scheduleEntryReview, threadProgress, FIELD_NOTES_TAGLINE } from "./fieldNotes.js";
import { useOnlineStatus } from "./useOnlineStatus.js";

const FN_READ_KEY = "cerebrum-fieldnotes-read";
const FN_REVIEW_KEY = "cerebrum-fieldnotes-reviews";
const FN_DAYS_KEY = "cerebrum-fieldnotes-days";

function loadJSON(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: the notebook still reads */ }
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
  const [picked, setPicked] = useState(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const q = loadNovaQuirks();
    const next = recordNovaVisit(q);
    if (next !== q) saveNovaQuirks(next);
  }, []);

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

  const openEntry = (id) => { setPicked(null); setRevealed(false); setScreen({ name: "entry", id }); try { window.scrollTo(0, 0); } catch { /* reading fine without it */ } };
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
    const next = scheduleEntryReview(reviewState, entry.id, correct, Date.now());
    setReviewState(next);
    saveJSON(FN_REVIEW_KEY, next);
    if (!isReview && correct) emitNovaActivity("review", "correct");
  };

  const serif = { fontFamily: "var(--cb-serif)" };
  const shell = { maxWidth: 760, margin: "0 auto", padding: "28px 20px 64px", color: P.ink };
  const goldBtn = {
    border: "1px solid " + accent, borderRadius: RADIUS.sm, padding: "10px 18px",
    fontSize: 14, fontWeight: 500, cursor: "pointer", fontFamily: "var(--cb-font)", color: P.ink,
    background: P.raised || P.bg,
  };
  const quietBtn = { background: P.panel || P.bg, color: P.ink, border: "1px solid " + P.line, borderRadius: RADIUS.sm, padding: "10px 18px", fontSize: 14, cursor: "pointer", fontFamily: "var(--cb-font)" };

  const questionBlock = (entry, isReview) => (
    <div style={{ marginTop: 28, borderTop: "1px solid " + P.line, paddingTop: 22 }}>
      <p style={{ fontSize: 13, letterSpacing: "0.08em", color: ink, margin: "0 0 10px", fontWeight: 500 }}>HER ONE QUESTION</p>
      <p style={{ ...serif, fontSize: 19, lineHeight: 1.5, margin: "0 0 16px" }}>{entry.question.prompt}</p>
      <div style={{ display: "grid", gap: 10 }}>
        {entry.question.options.map((opt, i) => {
          const isPick = picked === i;
          const isRight = revealed && i === entry.question.correct;
          return (
            <button key={i} onClick={() => answer(entry, i, isReview)} disabled={revealed}
              style={{
                textAlign: "left", color: P.ink,
                border: "1px solid " + (isRight ? accent : isPick ? ink : P.line),
                borderRadius: RADIUS.sm, padding: "13px 16px", fontSize: 16, lineHeight: 1.45,
                cursor: revealed ? "default" : "pointer", fontFamily: "var(--cb-font)",
                opacity: revealed && !isRight && !isPick ? 0.62 : 1,
                background: isRight ? (P.raised || P.bg) : P.panel || P.bg,
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
            <button onClick={() => openEntry(entry.id)} style={{ ...quietBtn, marginTop: 14 }}>Open the original entry</button>
          )}
        </div>
      )}
    </div>
  );

  if (screen.name === "entry" || screen.name === "review") {
    const entry = entries.find((e) => e.id === screen.id) || todayEntry;
    const isReview = screen.name === "review";
    return (
      <div style={shell}>
        <button onClick={goHome} style={{ ...quietBtn, marginBottom: 22 }}>Back to the notebook</button>
        <p style={{ fontSize: 13, letterSpacing: "0.08em", color: ink, margin: "0 0 8px", fontWeight: 500 }}>{isReview ? "REVIEW · " + entry.dateLabel.toUpperCase() : entry.dateLabel.toUpperCase() + " · " + entry.threadTitle.toUpperCase()}</p>
        <h1 style={{ ...serif, fontSize: 32, fontWeight: 500, lineHeight: 1.2, margin: "0 0 18px" }}>{entry.title}</h1>
        {isReview ? (
          <>
            <p style={{ ...serif, fontSize: 17, lineHeight: 1.6, color: P.ink2, margin: "0 0 6px" }}>You read this on {entry.dateLabel}. Try the question before you open the entry again.</p>
            {questionBlock(entry, true)}
          </>
        ) : (
          <>
            <p style={{ ...serif, fontSize: 17, lineHeight: 1.65, margin: 0, whiteSpace: "pre-wrap" }}>{entry.body}</p>
            {questionBlock(entry, false)}
            <div style={{ marginTop: 26 }}>
              <button onClick={goHome} style={goldBtn}>Back to the notebook</button>
            </div>
          </>
        )}
      </div>
    );
  }

  const completedThreads = FIELD_NOTE_THREADS.filter((t) => threadProgress(t, readIds).complete);
  return (
    <div style={shell}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 6 }}>
        <NovaLive state="greeting" size={66} surface="nova-home" />
        <div>
          <h1 style={{ ...serif, fontSize: 34, fontWeight: 500, margin: 0, lineHeight: 1.15 }}>Field Notes</h1>
          <p style={{ fontSize: 14, color: ink, margin: "4px 0 0" }}>{FIELD_NOTES_TAGLINE}</p>
        </div>
      </div>
      <p style={{ ...serif, fontSize: 17, lineHeight: 1.6, color: P.ink2, margin: "10px 0 0" }}>My notebook, kept as I read. One entry at a time, one question per entry. Nothing here needs the fleet awake, because I wrote it down before you arrived.</p>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
        <span style={{ border: "1px solid " + P.line, borderRadius: RADIUS.pill, padding: "7px 13px", fontSize: 13, background: P.panel || P.bg }}>Streak · {streak} {streak === 1 ? "day" : "days"}</span>
        <span style={{ border: "1px solid " + P.line, borderRadius: RADIUS.pill, padding: "7px 13px", fontSize: 13, background: P.panel || P.bg }}>Read · {readIds.length} of {entries.length}</span>
        {due.length > 0 && <span style={{
          border: "1px solid " + accent, borderRadius: RADIUS.pill, padding: "7px 13px", fontSize: 13,
          background: P.raised || P.bg,
        }}>Reviews ready · {due.length}</span>}
      </div>

      {notebook.paused && (
        <div style={{ marginTop: 18, background: P.panel || P.bg, border: "1px solid " + P.line, borderRadius: RADIUS.sm, padding: "14px 16px" }}>
          <p style={{ ...serif, fontSize: 16, margin: 0 }}>{notebook.notice}</p>
        </div>
      )}

      {due.length > 0 && (
        <div style={{ marginTop: 30 }}>
          <p style={{ fontSize: 13, letterSpacing: "0.08em", color: ink, margin: "0 0 12px", fontWeight: 500 }}>COMING BACK AROUND</p>
          <div style={{ display: "grid", gap: 10 }}>
            {due.map(({ entry }) => (
              <button key={entry.id} onClick={() => openReview(entry.id)} style={{ textAlign: "left", background: P.panel || P.bg, border: "1px solid " + P.line, borderRadius: RADIUS.sm, padding: "14px 16px", cursor: "pointer", color: P.ink, fontFamily: "var(--cb-font)" }}>
                <span style={{ fontSize: 13, color: ink }}>{entry.dateLabel} · {entry.threadTitle}</span>
                <span style={{ display: "block", ...serif, fontSize: 18, marginTop: 4 }}>{entry.title}</span>
                <span style={{ display: "block", fontSize: 14, color: P.ink2, marginTop: 4 }}>Try before you open it.</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {completedThreads.length > 0 && (
        <div style={{ marginTop: 30 }}>
          <p style={{ fontSize: 13, letterSpacing: "0.08em", color: ink, margin: "0 0 12px", fontWeight: 500 }}>HER SHELF</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {completedThreads.map((t) => (
              <span key={t.id} style={{ border: "1px solid " + P.line, borderRadius: RADIUS.pill, padding: "8px 14px", fontSize: 14, background: P.panel || P.bg }}>{t.shelfObject} · {t.title}</span>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 34 }}>
        <p style={{ fontSize: 13, letterSpacing: "0.08em", color: ink, margin: "0 0 12px", fontWeight: 500 }}>THE NOTEBOOK</p>
        <div style={{ display: "grid", gap: 12 }}>
          {entries.map((entry, i) => (
            <button key={entry.id} onClick={() => openEntry(entry.id)} style={{
              textAlign: "left",
              border: "1px solid " + (i === 0 ? accent : P.line),
              borderRadius: RADIUS.sm, padding: "16px 18px", cursor: "pointer", color: P.ink, fontFamily: "var(--cb-font)",
              background: i === 0 ? (P.raised || P.bg) : P.panel || P.bg,
            }}>
              <span style={{ fontSize: 13, color: ink }}>{i === 0 ? "Today · " : ""}{entry.dateLabel} · {entry.threadTitle}</span>
              <span style={{ display: "block", ...serif, fontSize: 21, fontWeight: 500, marginTop: 5 }}>{entry.title}</span>
              <span style={{ display: "block", fontSize: 15, color: P.ink2, marginTop: 5, lineHeight: 1.5 }}>{entry.body.split(". ")[0]}.</span>
              <span style={{ display: "block", fontSize: 13, color: ink, marginTop: 8 }}>{readIds.includes(entry.id) ? "Read · one question answered" : "Unread · one question waiting"}</span>
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 34 }}>
        <p style={{ fontSize: 13, letterSpacing: "0.08em", color: ink, margin: "0 0 12px", fontWeight: 500 }}>THREADS</p>
        <div style={{ display: "grid", gap: 10 }}>
          {FIELD_NOTE_THREADS.map((t) => {
            const prog = threadProgress(t, readIds);
            return (
              <div key={t.id} style={{ border: "1px solid " + P.line, borderRadius: RADIUS.sm, padding: "14px 16px", background: P.panel || P.bg }}>
                <span style={{ ...serif, fontSize: 18, fontWeight: 500 }}>{t.title}</span>
                <span style={{ display: "block", fontSize: 14, color: P.ink2, marginTop: 4 }}>{t.intro}</span>
                <span style={{ display: "block", fontSize: 13, color: ink, marginTop: 7 }}>{prog.done} of {prog.total} entries read{prog.complete ? " · " + t.shelfObject + " is on her shelf" : " · finishes with " + t.shelfObject.toLowerCase()}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
