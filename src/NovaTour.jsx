/* ── The Nova tour, as a guided cutscene (2026-10-15) ─────────
   The owner ordered the old four card tour replaced: Nova
   herself guides the visit now, on stage, speaking each line
   while the text types out under her, the way a Pokemon or
   Animal Crossing conversation runs. One stop at a time:

   - She stands large in full body framing on the canvas rig
     (NovaRive), never a static image and never the retired
     SVG figure. Two framings alternate: a full stage panel
     when the stop is about her, and a bottom band when the
     stop points at the real screen behind her, which the
     host has switched and scrolled into view through the
     onSpotlight callback (the paths map, her stage and
     shelf on Today).
   - The dialogue box is the house speech cream with her
     name on a gold plate. Each line is said through the
     unified speech controller (useNovaSpeech, source
     "lesson", so it outranks ambient lines and moves her
     mouth), and the visible characters are metered by the
     same speech plan (speechPlanFor): characters land while
     a mouth burst runs and hold through its pauses, so the
     typing and the talking are the same rhythm.
   - A tap, a click, the Next button, Space, Enter, or the
     right arrow advances; mid line it completes the line
     first. The blinking caret marks a finished line. Skip
     and Escape leave at any point.
   - Persistence is the host's, unchanged from the old
     tour: LearnHome opens this on a first visit when the
     cerebrum-cortex-tour key is absent, marks it done on
     any exit, and the "How Nova works" header button
     replays it. Closing returns the learner to the tab
     they were on.
   - Reduced motion: lines appear whole, the caret rests,
     and the rig receives reducedMotion so she stills.

   The script keeps the old tour's honest contract at the
   same indices the cortex suite pins: paths first, lessons
   teach then quiz, the catalog names its textbook standard
   and search built courses, review runs on a schedule with
   daily practice. The shelf, streaks, her memory, and the
   search library are new stops in her own voice. */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { NovaRive } from "./NovaRive.jsx";
import { useNovaSpeech, speechPlanFor } from "./NovaSpeech.jsx";
import { FONT_SIZES } from "./designSystem.jsx";
import { accentInk, useWindowWidth } from "./appUtils.js";

/* The wordmark stack, mirroring LearnView's WORDMARK: her
   name plate is set in it, the way her stage wordmark is. */
const NT_WORDMARK = "'Orbitron', 'Inter Tight', ui-sans-serif, system-ui, sans-serif";

/* The house speech colours, the same values NovaSpeech's
   bubble carries, so her voice looks identical everywhere. */
const NT_CREAM = "#F5F0E8";
const NT_INK = "#1A1A1A";
const NT_LINE = "rgba(26, 26, 26, 0.16)";
const NT_FAINT = "#6E675C";

/* The script. tab and anchor steer the host's spotlight:
   tab names the Nova home tab to show behind the band,
   anchor the data-tour-anchor element to scroll into view;
   both null keeps the stop on her stage. quiz and app feed
   the rig's state machine numbers (quizStateForSheet and
   appStateForActivity speak the same numbers), celebrate
   fires her celebrate trigger as the stop opens. */
export const TOUR_STEPS = [
  {
    title: "Start with a path",
    body: "I'm Nova. An axolotl, a teacher, and hard to impress. These are learning paths: whole subjects taught in order, one short lesson at a time. Pick one and I teach it properly.",
    tab: "paths", anchor: "paths", quiz: 0, app: 0, celebrate: false,
  },
  {
    title: "Lessons teach first, then check",
    body: "Every lesson teaches an idea in plain words, and only then quizzes you on it. Nothing is asked that was not taught first. Get one wrong and the feedback tells you why.",
    tab: "paths", anchor: "paths", quiz: 1, app: 0, celebrate: false,
  },
  {
    title: "The catalog",
    body: "The catalog holds twenty four topics, written for Nova from standard textbook material and taught the same way as the paths. A course built from a search works the same way.",
    tab: "paths", anchor: "paths", quiz: 0, app: 0, celebrate: false,
  },
  {
    title: "Review brings it back",
    body: "Finishing a lesson earns XP. Every answer you give goes on a review schedule, and daily practice brings the due ones back before they fade.",
    tab: "today", anchor: "stage", quiz: 0, app: 0, celebrate: false,
  },
  {
    title: "The shelf",
    body: "Finish a whole path and one object from it lands on my shelf, on my stage, and stays there. Small proof that you finished, not just started.",
    tab: "today", anchor: "shelf", quiz: 3, app: 0, celebrate: true,
  },
  {
    title: "Streaks",
    body: "Come back on consecutive days and your streak grows. A freeze bought with Sparks can cover one missed day. The second missed day is on you.",
    tab: "today", anchor: "stage", quiz: 5, app: 0, celebrate: false,
  },
  {
    title: "Nova remembers",
    body: "I remember how you learn: what you finished, what faded, and how often you poke me. It changes how I greet you. Consider yourself observed.",
    tab: null, anchor: null, quiz: 0, app: 0, celebrate: false,
  },
  {
    title: "Search is the library",
    body: "Nova is the school. The rest of Cerebrum is the library: ask it anything and it answers from real research, with the papers attached so you can check.",
    tab: null, anchor: null, quiz: 0, app: 1, celebrate: false,
  },
  {
    title: "Off you go",
    body: "That is the whole place. Pick a path, finish the first lesson, and try to impress me. People say it cannot be done. People are often wrong.",
    tab: null, anchor: null, quiz: 0, app: 0, celebrate: true,
  },
];

/* How much of a line is on the page at a given moment,
   metered by her speech plan: characters land in proportion
   to mouth burst time elapsed, hold through the pauses
   between bursts, and the whole line is up once the plan
   ends. Pure, so the rhythm is testable without a DOM. */
export function tourVisibleChars(plan, textLength, elapsedMs) {
  const len = Math.max(0, Math.floor(textLength || 0));
  if (!len) return 0;
  if (!plan || !Array.isArray(plan.bursts) || !plan.bursts.length) return len;
  const totalSpeak = plan.bursts.reduce((sum, b) => sum + (b.endMs - b.startMs), 0);
  if (!totalSpeak) return len;
  if (typeof elapsedMs !== "number" || elapsedMs <= 0) return 0;
  if (elapsedMs >= plan.speechEndMs) return len;
  let spoken = 0;
  for (const b of plan.bursts) {
    if (elapsedMs <= b.startMs) break;
    spoken += Math.min(elapsedMs, b.endMs) - b.startMs;
  }
  return Math.max(0, Math.min(len, Math.round((len * spoken) / totalSpeak)));
}

function usePrefersReducedMotion() {
  const [reduced] = useState(() => {
    try {
      return !!(typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch { return false; }
  });
  return reduced;
}

/* The viewport width comes from the shared appUtils hook
   (useWindowWidth), the one place a direct viewport width
   read is allowed to live: it seeds from the real width in
   the browser and follows resizes, exactly as this tour
   needs for its narrow layout switch. A hand rolled copy
   here tripped the core identity guard on 2026-10-15. */
export function NovaTour({ P, accent, at, onClose, onSpotlight }) {
  const [step, setStep] = useState(0);
  const [typedMs, setTypedMs] = useState(0);
  const [celebrateN, setCelebrateN] = useState(0);
  const reduced = usePrefersReducedMotion();
  const winW = useWindowWidth();
  const ink = accentInk(P, accent);
  const onAccent = at || "#101408";

  const stop = TOUR_STEPS[step];
  const last = step === TOUR_STEPS.length - 1;
  const band = !!stop.tab;
  const plan = useMemo(() => speechPlanFor(stop.body), [stop.body]);
  const lineDone = reduced || typedMs >= plan.speechEndMs;
  const visibleText = lineDone ? stop.body : stop.body.slice(0, tourVisibleChars(plan, stop.body.length, typedMs));

  /* Her voice runs through the one controller, as a lesson
     line: it preempts anything ambient, and its talking
     pulse is the only part of the controller the figure
     reads. The tour renders its own dialogue box, so the
     figure gets a shim with no current line (no second
     bubble) and its Rive events muted: the script is hers
     alone until it ends. */
  const speech = useNovaSpeech();
  const speechRef = useRef(speech);
  speechRef.current = speech;
  const figureSpeech = {
    current: null,
    talking: speech.talking,
    dismiss: speech.dismiss,
    handleRiveEvent: () => "denied",
  };

  useEffect(() => {
    setTypedMs(reduced ? plan.speechEndMs : 0);
    speechRef.current.dismiss();
    speechRef.current.say({ text: stop.body, source: "lesson" });
    if (stop.celebrate) setCelebrateN((n) => n + 1);
    if (onSpotlight) onSpotlight(stop.tab || null, stop.anchor || null);
    // The stop index is the whole trigger: a new stop resets
    // the typewriter, says the line, and aims the spotlight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => () => { speechRef.current.dismiss(); }, []);

  useEffect(() => {
    if (reduced || lineDone) return undefined;
    const iv = setInterval(() => {
      setTypedMs((ms) => Math.min(ms + 30, plan.speechEndMs));
    }, 30);
    return () => clearInterval(iv);
  }, [step, reduced, lineDone, plan]);

  const advance = () => {
    if (!lineDone) {
      setTypedMs(plan.speechEndMs);
      speechRef.current.dismiss();
      return;
    }
    if (last) { onClose(); return; }
    setStep(step + 1);
  };
  const advanceRef = useRef(advance);
  advanceRef.current = advance;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const fn = (e) => {
      if (e.key === "Escape") { closeRef.current(); return; }
      if (e.key === " " || e.key === "Enter" || e.key === "ArrowRight") {
        if (e.repeat) return;
        e.preventDefault();
        advanceRef.current();
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);

  const narrow = winW < 600;
  const figureSize = band ? (narrow ? 96 : 124) : (narrow ? 176 : 236);

  const dots = (
    <div style={{ display: "flex", alignItems: "center", gap: 7 }} aria-hidden="true">
      {TOUR_STEPS.map((_, i) => (
        <span key={i} style={{
          width: i === step ? 20 : 7, height: 7, borderRadius: 999,
          background: i === step ? accent : (band ? P.line : "rgba(255,255,255,0.28)"),
          transition: "all .25s",
        }} />
      ))}
    </div>
  );

  const dialogue = (
    <div
      role="button"
      aria-label={"Nova says: " + stop.body}
      onClick={(e) => { e.stopPropagation(); advance(); }}
      style={{
        position: "relative", background: NT_CREAM, color: NT_INK,
        border: "1px solid " + NT_LINE, borderRadius: 14,
        padding: "18px 18px 16px", cursor: "pointer",
        boxShadow: "0 14px 34px rgba(0,0,0,0.35)",
      }}
    >
      <span style={{
        position: "absolute", top: -13, left: 14, background: accent, color: onAccent,
        fontFamily: NT_WORDMARK, fontWeight: 800, fontSize: 11, letterSpacing: "0.16em",
        padding: "5px 11px 4px", borderRadius: 6, lineHeight: 1,
      }}>
        NOVA
      </span>
      <p style={{ fontSize: FONT_SIZES.subhead, lineHeight: 1.5, margin: 0, minHeight: 76 }}>
        {visibleText}
      </p>
      {lineDone && (
        <span aria-hidden="true" className={reduced ? undefined : "nt-caret"} style={{
          position: "absolute", right: 14, bottom: 10, width: 0, height: 0,
          borderLeft: "6px solid transparent", borderRight: "6px solid transparent",
          borderTop: "8px solid " + NT_FAINT, opacity: reduced ? 0.55 : undefined,
        }} />
      )}
    </div>
  );

  const controls = (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      {dots}
      <span style={{ flex: 1 }} />
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        style={{ background: "none", border: "none", color: band ? P.ink2 : "rgba(255,255,255,0.75)", cursor: "pointer", fontSize: FONT_SIZES.label, fontWeight: 600, fontFamily: "var(--cb-font)", padding: "10px 8px", minHeight: 44 }}
      >
        Skip the tour
      </button>
      {step > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); setStep(step - 1); }}
          style={{ background: "transparent", border: "1px solid " + (band ? P.line : "rgba(255,255,255,0.35)"), color: band ? P.ink : "#FFFFFF", borderRadius: 999, padding: "10px 18px", fontSize: FONT_SIZES.body, fontWeight: 600, cursor: "pointer", fontFamily: "var(--cb-font)", minHeight: 44 }}
        >
          Back
        </button>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); advance(); }}
        style={{ background: accent, color: onAccent, border: "none", borderRadius: 999, padding: "10px 22px", fontSize: FONT_SIZES.body, fontWeight: 700, cursor: "pointer", fontFamily: "var(--cb-font)", minHeight: 44 }}
      >
        {last ? "Start learning" : "Next"}
      </button>
    </div>
  );

  const figure = (
    <span style={{ flexShrink: 0, display: "flex", alignItems: "flex-end", justifyContent: "center", maxWidth: "100%" }}>
      <NovaRive
        size={figureSize}
        framing="full"
        quizState={stop.quiz || 0}
        appState={stop.app || 0}
        celebrateN={celebrateN}
        reducedMotion={reduced}
        speech={figureSpeech}
        quips={false}
      />
    </span>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="How Nova works"
      onClick={advance}
      style={{
        position: "fixed", inset: 0, zIndex: 260,
        background: band ? "rgba(5,6,8,0.45)" : "rgba(5,6,8,0.82)",
        display: "flex",
        alignItems: band ? "flex-end" : "center",
        justifyContent: "center",
        fontFamily: "var(--cb-font)",
      }}
    >
      <style>{".nt-caret { animation: ntCaretBlink 0.9s ease-in-out infinite; } @keyframes ntCaretBlink { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }"}</style>
      {band ? (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            width: "100%", background: P.raised, borderTop: "1px solid " + P.line,
            boxShadow: "0 -18px 50px rgba(0,0,0,0.45)",
            padding: "16px 18px", paddingBottom: "max(16px, env(safe-area-inset-bottom))",
          }}
        >
          <div style={{ maxWidth: 880, margin: "0 auto", display: "flex", gap: narrow ? 12 : 20, alignItems: "flex-end" }}>
            {figure}
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.12em", color: ink }}>
                HOW NOVA WORKS · {step + 1} OF {TOUR_STEPS.length}
              </div>
              {dialogue}
              {controls}
            </div>
          </div>
        </div>
      ) : (
        <div
          className="lv-rise"
          onClick={(e) => e.stopPropagation()}
          style={{
            background: P.raised, border: "1px solid " + P.line, borderRadius: 24,
            maxWidth: 560, width: "100%", margin: 18, padding: "26px 26px 22px",
            color: P.ink, boxShadow: "0 30px 80px rgba(0,0,0,0.5)",
            maxHeight: "92vh", overflowY: "auto",
            display: "flex", flexDirection: "column", gap: 18,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.12em", color: ink }}>
              HOW NOVA WORKS · {step + 1} OF {TOUR_STEPS.length}
            </div>
            <button
              aria-label="Skip the tour"
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              style={{ background: "none", border: "none", color: P.ink2, cursor: "pointer", fontSize: 15, lineHeight: 1, padding: 8, minWidth: 36, minHeight: 36 }}
            >
              ✕
            </button>
          </div>
          <div style={{ display: "flex", justifyContent: "center" }}>{figure}</div>
          {dialogue}
          {controls}
        </div>
      )}
    </div>
  );
}
