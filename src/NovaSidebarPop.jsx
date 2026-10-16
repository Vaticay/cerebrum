/* ── Nova, at the sidebar: the discovery pop (2026-10-15) ─────
   For someone who has never opened the Nova tab, every so
   often Nova slides out from behind the left sidebar, waves,
   says her one line in a speech bubble, waves again briefly,
   and slides back. The whole visit runs about five seconds.
   She is an invitation, not a notification, and the discipline
   is the point, the same discipline the Easter egg in NovaEgg
   keeps: a strict budget, a shared store, and a hard list of
   contexts she never enters.

   The budget: no pop in the first twenty seconds of a session,
   at most one pop per session, at least a day between pops,
   and once she has been dismissed twice the gap stretches to
   a week. The moment the learner opens the Nova tab even once,
   the pops stop for good, because the store carries a visited
   flag the learning view sets and this file only reads. Her
   state lives in the existing quirks store from LearnView, so
   there is no new storage key anywhere; the session facts (the
   start stamp and whether she has already popped) live in an
   in memory ref and die with the tab.

   She never blocks anything: the stage takes no pointer events
   except on Nova herself and her bubble, a click on either
   opens the Nova tab and ends the visit politely, and only the
   bubble close button or Escape counts as a dismissal. There
   is no sound anywhere in this file, on purpose. The figure is
   NovaRive with its quip engine switched off, so she can never
   double bubble next to the pop line. */
import React, { useEffect, useRef, useState } from "react";
import { cbMotionOff } from "./flowcharts.jsx";
import { loadNovaQuirks, saveNovaQuirks } from "./LearnView.jsx";
import { NovaRive } from "./NovaRive.jsx";
import { FONT_SIZES } from "./designSystem.jsx";

export const POP_FIRST_LINE = "Hi, I'm Nova, come check me out.";
export const POP_LINES = [
  "Nova. The lessons are in the other tab.",
  "Still here. The other tab has lessons.",
  "I teach the science in there. Worth a look.",
];
export const POP_MIN_SESSION_MS = 20000;
export const POP_GAP_MS = 24 * 3600 * 1000;
export const POP_LONG_GAP_MS = 7 * 24 * 3600 * 1000;
export const POP_DISMISSAL_STRETCH = 2;
export const POP_CHECK_MS = 15000;

/* The visit itself, milliseconds from its start: she enters
   waving, holds and waves once more, leaves, and is gone at
   five seconds. The phase steps move the slide; the wave steps
   bump the wave counter the figure reads. */
export const POP_TIMELINE = [
  { at: 0, phase: "enter", wave: true },
  { at: 2600, phase: "hold", wave: true },
  { at: 4400, phase: "exit" },
  { at: 5000, end: true },
];

/* The gap a store full of history earns: two dismissals stretch
   it from a day to a week. */
export function popGapMs(q) {
  const s = q && typeof q === "object" ? q : {};
  return (s.popDismissals || 0) >= POP_DISMISSAL_STRETCH ? POP_LONG_GAP_MS : POP_GAP_MS;
}

/* The contexts she never enters, as one decision so the checks
   and the tests read the same list: a hidden tab, typing, a
   lesson, a call, a checkout, a running search, or the Nova tab
   itself already open. */
export function popBlocked(ctx) {
  const c = ctx || {};
  return !!(c.hidden || c.typing || c.inLesson || c.inCall || c.inCheckout || c.searchRunning || c.onNova);
}

/* Eligibility: context clear, the Nova tab never visited, this
   session has not had her yet, the session is old enough, and
   the gap since the last pop has run out. */
export function popEligible(q, ctx, session, now) {
  if (popBlocked(ctx)) return false;
  const s = q && typeof q === "object" ? q : {};
  if (s.hasVisitedNova) return false;
  const sess = session && typeof session === "object" ? session : {};
  if (sess.popped) return false;
  if (typeof sess.startedAt === "number" && now - sess.startedAt < POP_MIN_SESSION_MS) return false;
  if (s.lastPopAt && now - s.lastPopAt < popGapMs(s)) return false;
  return true;
}

/* Her line: the introduction the first time she ever pops, then
   the short reminders in rotation. */
export function popLineFor(popCount) {
  if (!popCount) return POP_FIRST_LINE;
  return POP_LINES[(popCount - 1) % POP_LINES.length];
}

export function recordPop(q, now) {
  const s = q && typeof q === "object" ? q : {};
  return { ...s, lastPopAt: now, popCount: (s.popCount || 0) + 1 };
}

export function recordPopDismissal(q) {
  const s = q && typeof q === "object" ? q : {};
  return { ...s, popDismissals: (s.popDismissals || 0) + 1 };
}

/* What the page is doing right now, read off the DOM the shell
   already renders, the same probe the egg runs: the lesson
   sheet, a call, a checkout, and typing. The shell facts the
   DOM cannot tell (a running search, a call the shell already
   knows about, the Nova tab being open) arrive as extra from
   the component props and merge in. Best effort by design: a
   missed signal only ever costs an appearance. */
function probePopContext(extra) {
  const ex = extra || {};
  const ctx = {
    hidden: true, typing: false, inLesson: false, inCall: false,
    inCheckout: false, searchRunning: !!ex.searchRunning, onNova: !!ex.onNova,
  };
  try {
    ctx.hidden = !!document.hidden;
    const ae = document.activeElement;
    if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT" || ae.isContentEditable)) ctx.typing = true;
    if (document.querySelector(".lv-sheet")) ctx.inLesson = true;
    if (document.querySelector('[role="dialog"][aria-label^="Incoming call"]')) ctx.inCall = true;
    if (!ctx.inCall) {
      const vids = document.querySelectorAll("video");
      for (let i = 0; i < vids.length; i++) {
        const v = vids[i];
        if (!v.paused && v.readyState >= 2 && v.closest && v.closest('[style*="fixed"]')) { ctx.inCall = true; break; }
      }
    }
    const dialogs = document.querySelectorAll('[role="dialog"]');
    for (let i = 0; i < dialogs.length; i++) {
      const t = (dialogs[i].getAttribute("aria-label") || "") + " " + (dialogs[i].textContent || "").slice(0, 400);
      if (/Cerebrum Pro|Subscribe|per month/.test(t)) { ctx.inCheckout = true; break; }
    }
  } catch { /* a failed probe reads as a quiet page; the budget still applies */ }
  if (ex.inCall) ctx.inCall = true;
  return ctx;
}

const POP_CSS = `
.nsp-stage { position: fixed; z-index: 29; pointer-events: none; }
.nsp-fig { position: absolute; pointer-events: auto; cursor: pointer; }
.nsp-fig-d.nsp-ph-enter { animation: nspSlideInD 0.6s cubic-bezier(0.22, 0.9, 0.28, 1) both; }
@keyframes nspSlideInD { from { transform: translateX(-80%); } to { transform: translateX(0); } }
.nsp-fig-d.nsp-ph-exit { animation: nspSlideOutD 0.55s cubic-bezier(0.5, 0, 0.8, 0.4) both; }
@keyframes nspSlideOutD { from { transform: translateX(0); } to { transform: translateX(-80%); } }
.nsp-fig-m.nsp-ph-enter { animation: nspSlideInM 0.6s cubic-bezier(0.22, 0.9, 0.28, 1) both; }
@keyframes nspSlideInM { from { transform: translateX(-112%); } to { transform: translateX(0); } }
.nsp-fig-m.nsp-ph-exit { animation: nspSlideOutM 0.55s cubic-bezier(0.5, 0, 0.8, 0.4) both; }
@keyframes nspSlideOutM { from { transform: translateX(0); } to { transform: translateX(-112%); } }
.nsp-still.nsp-ph-enter, .nsp-still.nsp-ph-hold { animation: nspFadeIn 0.45s ease both; }
@keyframes nspFadeIn { from { opacity: 0; } to { opacity: 1; } }
.nsp-still.nsp-ph-exit { animation: nspFadeOut 0.45s ease both; }
@keyframes nspFadeOut { from { opacity: 1; } to { opacity: 0; } }
.nsp-bubble { position: absolute; width: max-content; max-width: 290px; background: #F5F0E8; color: #1A1A1A; border: 1px solid rgba(26, 26, 26, 0.16); border-radius: 14px; padding: 11px 50px 11px 14px; font-size: ${FONT_SIZES.body}px; line-height: 1.5; pointer-events: auto; box-shadow: 0 10px 26px rgba(0, 0, 0, 0.25); animation: nspBubbleIn 0.35s cubic-bezier(0.22, 0.9, 0.28, 1) both; }
@keyframes nspBubbleIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
.nsp-bubble-d { left: calc(100% + 10px); top: 2px; }
.nsp-bubble-m { bottom: calc(100% + 10px); left: 0; }
.nsp-bubble-tail { position: absolute; width: 13px; height: 13px; background: #F5F0E8; transform: rotate(45deg); }
.nsp-bubble-d .nsp-bubble-tail { left: -7px; top: 17px; border-left: 1px solid rgba(26, 26, 26, 0.16); border-bottom: 1px solid rgba(26, 26, 26, 0.16); }
.nsp-bubble-m .nsp-bubble-tail { bottom: -7px; left: 38px; border-right: 1px solid rgba(26, 26, 26, 0.16); border-bottom: 1px solid rgba(26, 26, 26, 0.16); }
/* 44px hit area (2026-10-16, layout audit finding 20); the glyph size is unchanged, and the bubble padding above reserves the wider box. */
.nsp-bubble-x { position: absolute; top: 3px; right: 3px; width: 44px; height: 44px; background: none; border: none; color: #6E675C; cursor: pointer; font-size: 12px; line-height: 1; display: inline-flex; align-items: center; justify-content: center; }
@media (prefers-reduced-motion: reduce) {
  .nsp-fig, .nsp-bubble { animation: none !important; }
}
`;

/* Her desktop size, and the width her bust box renders at:
   NovaRive draws size times 1.85 wide, so the wrap math below
   works in rendered pixels, not in the size prop. */
const FIG_SIZE_DESKTOP = 84;
const FIG_SIZE_MOBILE = 72;
const FIG_W = Math.round(FIG_SIZE_DESKTOP * 1.85);

export default function NovaSidebarPop({ searchRunning = false, inCall = false, novaOpen = false, railCollapsed = false, isMobile = false, onOpenNova }) {
  const [pop, setPop] = useState(null);
  const popRef = useRef(null);
  const timersRef = useRef([]);
  const sessionRef = useRef({ startedAt: Date.now(), popped: false });
  const propsRef = useRef({ searchRunning, inCall, novaOpen });
  propsRef.current = { searchRunning, inCall, novaOpen };

  const clearTimers = () => {
    for (const t of timersRef.current) clearTimeout(t);
    timersRef.current = [];
  };

  const endPop = () => {
    clearTimers();
    popRef.current = null;
    setPop(null);
  };

  const dismissPop = () => {
    saveNovaQuirks(recordPopDismissal(loadNovaQuirks()));
    endPop();
  };

  const startPop = (quirks) => {
    if (popRef.current) return;
    const q = quirks && typeof quirks === "object" ? quirks : loadNovaQuirks();
    const now = Date.now();
    const line = popLineFor(q.popCount || 0);
    /* An appearance counts the moment she starts: the shared
       store clock starts now, whatever happens next. */
    saveNovaQuirks(recordPop(q, now));
    sessionRef.current.popped = true;
    let still = false;
    try { still = !!cbMotionOff(); } catch { /* the full visit is the fallback */ }
    const firstStep = POP_TIMELINE[0];
    const p = { id: now, line, phase: firstStep.phase, waveN: 1, still };
    popRef.current = p;
    setPop(p);
    for (const step of POP_TIMELINE) {
      if (step.at === 0) continue;
      const t = setTimeout(() => {
        if (!popRef.current || popRef.current.id !== p.id) return;
        if (step.end) { endPop(); return; }
        const next = { ...popRef.current };
        if (step.phase) next.phase = step.phase;
        if (step.wave) next.waveN = (popRef.current.waveN || 1) + 1;
        popRef.current = next;
        setPop(next);
      }, step.at);
      timersRef.current.push(t);
    }
  };

  /* A click on her or on her bubble: she has done her job, so
     the visit ends without a dismissal and the Nova tab opens.
     Bubble clicks reach this handler by bubbling up from the
     bubble to the figure wrap; only the close button stops
     that, in its own handler below. */
  const onFigureClick = () => {
    endPop();
    if (onOpenNova) onOpenNova();
  };

  /* The budget checks: the first look once the session is old
     enough, then a slow interval. Each check costs one store
     read and one DOM probe, and only while no pop is running. */
  useEffect(() => {
    const check = () => {
      if (popRef.current) return;
      if (typeof document !== "undefined" && document.hidden) return;
      const q = loadNovaQuirks();
      const pr = propsRef.current;
      const ctx = probePopContext({ searchRunning: pr.searchRunning, inCall: pr.inCall, onNova: pr.novaOpen });
      if (!popEligible(q, ctx, sessionRef.current, Date.now())) return;
      startPop(q);
    };
    const first = setTimeout(check, POP_MIN_SESSION_MS);
    const iv = setInterval(check, POP_CHECK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(iv);
      clearTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* If the tab hides mid pop, she leaves quietly with it. */
  useEffect(() => {
    if (!pop) return;
    const onVis = () => { if (document.hidden) endPop(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pop]);

  /* Escape dismisses her, and counts as a dismissal. */
  useEffect(() => {
    if (!pop) return;
    const onKey = (e) => { if (e.key === "Escape") dismissPop(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pop]);

  if (!pop) return null;
  const showBubble = pop.phase === "enter" || pop.phase === "hold";
  const size = isMobile ? FIG_SIZE_MOBILE : FIG_SIZE_DESKTOP;
  const railW = railCollapsed ? 68 : 216;
  /* Desktop geometry: the wrap rests with about a third of her
     width tucked past the sidebar right edge, and the slide
     runs from eighty percent hidden to that rest position. At
     the hidden end her right edge sits just behind the sidebar
     edge, so the sidebar itself clips her: the stage sits one
     layer under the opaque sidebar and the sidebar does the
     masking, which is the whole trick. On mobile there is no
     sidebar to hide behind, so she slides in from off the left
     edge of the screen instead, above the bottom nav. */
  const stageStyle = isMobile
    ? { left: 0, right: 0, bottom: "calc(78px + env(safe-area-inset-bottom))" }
    : { left: 0, right: 0, top: 0, bottom: 0 };
  const figStyle = isMobile
    ? { left: 4, bottom: 0 }
    : { left: railW - Math.round(FIG_W * 0.30), bottom: 118 };
  return (
    <div className="nsp-stage" style={stageStyle}>
      <style>{POP_CSS}</style>
      <div
        className={"nsp-fig" + (isMobile ? " nsp-fig-m" : " nsp-fig-d") + " nsp-ph-" + pop.phase + (pop.still ? " nsp-still" : "")}
        style={figStyle}
        onClick={onFigureClick}
      >
        {/* The canvas surface has no wave trigger, so the wave
            counter also feeds the celebrate counter NovaRive
            binds: the bump at the second wave beat fires the
            celebrate trigger once, in the same rising counter
            mechanism NovaLive uses. The fallback ignores the
            extra prop and waves as it always has. */}
        <NovaRive state="greeting" size={size} waveN={pop.waveN} celebrateN={pop.waveN} quips={false} />
        {showBubble && pop.line && (
          <div className={"nsp-bubble" + (isMobile ? " nsp-bubble-m" : " nsp-bubble-d")} role="status">
            <span className="nsp-bubble-tail" />
            {pop.line}
            <button type="button" className="nsp-bubble-x" aria-label="Dismiss Nova" onClick={(e) => { e.stopPropagation(); dismissPop(); }}>
              ✕
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
