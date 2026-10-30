/* ── Nova, at the sidebar: the discovery pop (2026-10-15) ─────
   For someone who has never opened the Nova tab, every so
   often Nova slides out from behind the left sidebar, says
   her one line in the shared speech bubble, and slides back.
   She is an invitation, not a notification, and the discipline
   is the point, the same discipline the Easter egg in NovaEgg
   keeps: a strict budget, a shared store, and a hard list of
   contexts she never enters. Her visit is a presence and a
   line (2026-10-29, dialog spec Lane 1): the wave mechanism
   that used to feed a celebrate counter is gone, her line
   renders through the one NovaBubble, and the visit's leave
   step waits for the line's reading time instead of running
   on a fixed five second speech clock.

   The budget: no pop in the first twenty seconds of a session,
   at most one pop per session, at least a day between pops,
   and once she has been dismissed twice the gap stretches to
   a week. Ignoring her counts too (2026-10-29, the outside
   audit's pop finding): a pop that plays its whole visit
   unclicked is recorded as an ignore, ignores stretch the
   gap on the same count as dismissals, and four ignores stop
   the pops for good, since a person who has watched her come
   and go four times without once engaging has answered. The
   moment the learner opens the Nova tab even once, the pops
   stop for good, because the store carries a visited flag
   the learning view sets and this file only reads. Her
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
import { NovaBubble, speechDurationFor, speechPlanFor, SPEECH_TAIL_MS } from "./NovaSpeech.jsx";

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
/* Four pops watched and ignored, start to finish, retire
   the pop entirely (2026-10-29). */
export const POP_IGNORE_STOP = 4;
export const POP_CHECK_MS = 15000;

/* The visit's appearance steps, milliseconds from its start:
   she enters, holds, and leaves. These steps move the slide
   only. The visit's end is not a step here (2026-10-29): the
   leave step waits for her line's reading time, priced by
   the shared timing law in NovaSpeech (speechDurationFor,
   floored by the speech plan's own end), and the visit ends
   POP_EXIT_MS after she leaves. The wave steps the timeline
   used to carry are deleted with the wave mechanism itself:
   nothing here bumps a counter the figure reads. */
export const POP_TIMELINE = [
  { at: 0, phase: "enter" },
  { at: 2600, phase: "hold" },
  { at: 4400, phase: "exit" },
];
export const POP_EXIT_MS = 600;

/* The gap a store full of history earns: two dismissals stretch
   it from a day to a week, and ignores count toward the same
   stretch (2026-10-29): a dismissal and an ignore are the
   same answer at two volumes, and before this an ignoring
   user earned no stretch at all and was popped daily,
   indefinitely. */
export function popGapMs(q) {
  const s = q && typeof q === "object" ? q : {};
  return (s.popDismissals || 0) + (s.popIgnores || 0) >= POP_DISMISSAL_STRETCH ? POP_LONG_GAP_MS : POP_GAP_MS;
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
  /* Four full visits ignored retires her for good
     (2026-10-29), the ignore side of the budget above. */
  if ((s.popIgnores || 0) >= POP_IGNORE_STOP) return false;
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

/* A pop that played its whole visit and was never clicked,
   dismissed, or answered: the softest no there is, recorded
   so it counts (2026-10-29). */
export function recordPopIgnore(q) {
  const s = q && typeof q === "object" ? q : {};
  return { ...s, popIgnores: (s.popIgnores || 0) + 1 };
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
    /* The whole lesson, not just its feedback sheet (2026-10-26,
       Nova perfection pass): .lv-sheet exists only while an
       answered card's sheet is open, but the lesson Player is on
       screen for the whole lesson under its labelled dialog root.
       The shell's onNova prop already keeps the pop out of every
       learning screen in production; this keeps the probe honest
       on its own, the same fix the egg's probe took. */
    if (!ctx.inLesson) {
      const allDialogs = document.querySelectorAll('[role="dialog"]');
      for (let i = 0; i < allDialogs.length; i++) {
        const label = allDialogs[i].getAttribute("aria-label") || "";
        if (label.startsWith("Lesson:") || label.startsWith("Course complete:")) { ctx.inLesson = true; break; }
      }
    }
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
/* Every curve here is the site curve var(--cb-ease) (phase 2
   fitted polish, 2026-10-28); the private slide and fade
   curves this file carried retired into it. Transform and
   opacity only, durations unchanged. */
.nsp-fig-d.nsp-ph-enter { animation: nspSlideInD 0.6s var(--cb-ease) both; }
@keyframes nspSlideInD { from { transform: translateX(-80%); } to { transform: translateX(0); } }
.nsp-fig-d.nsp-ph-exit { animation: nspSlideOutD 0.55s var(--cb-ease) both; }
@keyframes nspSlideOutD { from { transform: translateX(0); } to { transform: translateX(-80%); } }
.nsp-fig-m.nsp-ph-enter { animation: nspSlideInM 0.6s var(--cb-ease) both; }
@keyframes nspSlideInM { from { transform: translateX(-112%); } to { transform: translateX(0); } }
.nsp-fig-m.nsp-ph-exit { animation: nspSlideOutM 0.55s var(--cb-ease) both; }
@keyframes nspSlideOutM { from { transform: translateX(0); } to { transform: translateX(-112%); } }
.nsp-still.nsp-ph-enter, .nsp-still.nsp-ph-hold { animation: nspFadeIn 0.45s var(--cb-ease) both; }
@keyframes nspFadeIn { from { opacity: 0; } to { opacity: 1; } }
.nsp-still.nsp-ph-exit { animation: nspFadeOut 0.45s var(--cb-ease) both; }
@keyframes nspFadeOut { from { opacity: 1; } to { opacity: 0; } }
/* The bubble's placement only (2026-10-29): the bubble itself
   is the shared NovaBubble from NovaSpeech, in its sheet
   geometry fitted to the visit by the style the component
   passes, so the private bubble styles, tail, and close
   button that used to live here are gone. These two classes
   only say where the bubble sits beside her: right of her on
   desktop, above her on mobile. The wrapper keeps the old
   entrance fade, on the site curve. */
.nsp-bubblewrap { position: absolute; width: max-content; max-width: 290px; pointer-events: auto; animation: nspBubbleIn 0.35s var(--cb-ease) both; }
@keyframes nspBubbleIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
.nsp-bubble-d { left: calc(100% + 10px); top: 2px; }
.nsp-bubble-m { bottom: calc(100% + 10px); left: 0; }
/* The shell spotlight (follow on polish, 2026-10-28): a soft pool
   of her own cream light behind the figure while she visits the
   shell, feathered to nothing at its edge. It is a backdrop light
   only: no border, no ring, nothing that frames her, and it
   drives nothing in the host. It fades in with her entrance on
   the site curve and out again as she leaves. */
.nsp-spot { position: absolute; inset: -32% -48%; border-radius: 50%; background: radial-gradient(closest-side, rgba(253, 243, 215, 0.16), rgba(253, 243, 215, 0) 72%); pointer-events: none; animation: nspSpotIn 0.6s var(--cb-ease) both; }
@keyframes nspSpotIn { from { opacity: 0; } to { opacity: 1; } }
.nsp-fig.nsp-ph-exit .nsp-spot { animation: nspSpotOut 0.55s var(--cb-ease) both; }
@keyframes nspSpotOut { from { opacity: 1; } to { opacity: 0; } }
.nsp-still .nsp-spot { animation: none; }
@media (prefers-reduced-motion: reduce) {
  .nsp-fig, .nsp-bubblewrap, .nsp-spot { animation: none !important; }
}
`;

/* Her desktop size, and the width her bust box renders at:
   NovaRive draws its bust crop at size times 1.3 wide, so the
   wrap math below works in rendered pixels, not in the size
   prop. */
const FIG_SIZE_DESKTOP = 84;
const FIG_SIZE_MOBILE = 72;
const FIG_W = Math.round(FIG_SIZE_DESKTOP * 1.3);

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
    const p = { id: now, line, phase: firstStep.phase, still };
    popRef.current = p;
    setPop(p);
    /* Her line's reading time, by the shared law (2026-10-29):
       the reading time from speechDurationFor, floored by the
       speech plan's own end less the tail, exactly as the
       controller's speechShow prices a line. The leave step
       waits for the line to finish (or for a dismissal, which
       clears these timers), so the exit step runs at the
       later of its appearance time and the line's end, and
       the visit ends POP_EXIT_MS after that. No fixed speech
       clock remains. */
    const lineMs = Math.max(speechDurationFor(line), speechPlanFor(line).speechEndMs - SPEECH_TAIL_MS);
    const schedule = (fn, at) => {
      const t = setTimeout(() => {
        if (!popRef.current || popRef.current.id !== p.id) return;
        fn();
      }, at);
      timersRef.current.push(t);
    };
    for (const step of POP_TIMELINE) {
      if (step.at === 0) continue;
      const at = step.phase === "exit" ? Math.max(step.at, lineMs) : step.at;
      schedule(() => {
        const next = { ...popRef.current, phase: step.phase };
        popRef.current = next;
        setPop(next);
      }, at);
    }
    /* Reaching the visit's end means the whole visit played
       with no click, no dismissal, and no answer: an ignore,
       and it is recorded like one (2026-10-29). Every other
       way out of a pop (the figure click, the close button,
       Escape, a hidden tab) leaves through its own path and
       records its own outcome, or none. */
    const exitAt = Math.max(POP_TIMELINE[POP_TIMELINE.length - 1].at, lineMs);
    schedule(() => { saveNovaQuirks(recordPopIgnore(loadNovaQuirks())); endPop(); }, exitAt + POP_EXIT_MS);
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
        {/* Her light arrives with her: a soft pool behind the
            figure for the length of the visit (follow on polish,
            2026-10-28). Pure backdrop, pointer events none, and
            aria hidden; the canvas below paints over it. */}
        <span className="nsp-spot" aria-hidden="true" />
        {/* Her pop visit is a presence and a line (2026-10-29):
            no wave counter, no celebrate feed. The pleased
            state stays reserved for its rationed causes. */}
        <NovaRive state="greeting" size={size} quips={false} />
        {showBubble && pop.line && (
          /* The shared bubble, fitted to the visit: the sheet
             geometry in a placed wrapper, its own dismiss
             button counting as a dismissal, the rest of the
             bubble still answering to the figure click that
             opens the Nova tab. */
          <div className={"nsp-bubblewrap" + (isMobile ? " nsp-bubble-m" : " nsp-bubble-d")}>
            <NovaBubble variant="sheet" tail={isMobile ? "down" : "left"} text={pop.line} onDismiss={dismissPop}
              style={{ width: "auto", maxWidth: 290 }} />
          </div>
        )}
      </div>
    </div>
  );
}
