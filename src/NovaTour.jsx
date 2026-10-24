/* ── The Nova tour, as a guided cutscene (2026-10-15) ─────────
   The owner ordered the old four card tour replaced: Nova
   herself guides the visit now, on stage, speaking each line
   while the text types out under her, the way a Pokemon or
   Animal Crossing conversation runs. One stop at a time:

   - She stands large in full body framing on the canvas rig
     (NovaRive), never a static image and never the retired
     SVG figure. The whole tour runs in ONE presentation, the
     centered stage card, for all nine stops (owner's order,
     2026-10-15: "the tour halfway turns into a big square, I
     want the full thing to be that"). The first cut shipped
     a bottom band for the stops that pointed at live screens
     and the stage card for the rest, and the flip between
     them destroyed and rebuilt her Rive runtime mid tour:
     the figure unmounted with one branch and remounted with
     the other, so she vanished, restarted from the state
     machine's entry, and lost her inputs at the seam, on top
     of the page scrolling its spotlight behind her and a
     second full size Nova standing on Today behind the band.
     One framing means one mount: the figure below is created
     once when the tour opens and only ever receives new
     inputs (quiz, app, talking, celebrate) as the stops
     change. It never remounts, never resizes, and never
     restarts between stops.
   - The stops keep their tab and anchor fields as context,
     but the stage presentation no longer stages the screen
     behind her: the host is not asked to switch tabs or
     scroll while she talks (the onSpotlight prop is still
     accepted, the host's mount is unchanged, and it is
     deliberately not driven). The card sits over the app
     the way it always did for the stage stops.
   - While the tour is open the host stands its resident
     Novas down (LearnHome does not render them), so exactly
     one of her is alive on the screen: no second runtime
     competing behind the scrim, and nothing to mistake for
     her glitching. They return when the tour closes.
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
   - Persistence is the host's: LearnHome opens this on a
     first visit when the cerebrum-nova-tour-v2 key is
     absent, marks it done on any exit, and the "How Nova
     works" header button replays it. The key is versioned
     (2026-10-15): the old cerebrum-cortex-tour key is done
     for every returning user, which silently retired the
     new tour's first visit for exactly the people it was
     rebuilt for. Closing returns the learner to the tab
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

/* The house speech colours, the same values NovaSpeech's
   bubble carries, so her voice looks identical everywhere. */
const NT_CREAM = "#FDF3D7";
const NT_INK = "#1A1A1A";
/* The name plate is house gold, the site's plan gold
   (designSystem COLOR.accent, ACCENTS.Amber, the share
   card's GOLD): a brand mark, not reader chrome, so it does
   not follow the reader's accent. On the default Sage
   accent the plate used to render muted green (2026-10-15
   playthrough catch); gold is what the spec calls for. */
const NT_GOLD = "#C4A35A";
const NT_LINE = "rgba(26, 26, 26, 0.16)";
const NT_FAINT = "#6E675C";

/* The script. tab and anchor are retained context from the
   band staging the first cut shipped (which home tab and
   data-tour-anchor element a stop pointed at); the stage
   presentation does not stage the screen behind her, so
   nothing reads them now. quiz and app feed the rig's state
   machine numbers (quizStateForSheet and appStateForActivity
   speak the same numbers), celebrate fires her celebrate
   trigger a beat after the stop opens (the delayed rise in
   the step effect below).
   Voice (2026-10-15): the spoken lines took the voice
   overhaul last, once the restructure settled, so they are
   written under the same contract as her banks: she talks
   like a person, a dry mad scientist showing a new subject
   around her facility, contractions and questions and
   asides, varied lengths inside the tour's own register
   band (the suite pins 60 to 220 characters a line), no
   hype, and no dashes of any kind. Facts, order, titles,
   tabs, states, and the celebrate flags are unchanged
   from the first cut; only the wording moved. */
export const TOUR_STEPS = [
  {
    title: "Start with a path",
    body: "Welcome to the lab. I'm Nova: axolotl, teacher, and famously hard to impress. These are the learning paths, whole subjects taught in order, one short lesson at a time. Pick one, and I'll teach it properly.",
    tab: "paths", anchor: "paths", quiz: 0, app: 0, celebrate: false,
  },
  {
    title: "Lessons teach first, then check",
    body: "Here's my method. A lesson teaches one idea in plain words first, and only then quizzes you on it. Nothing gets asked that wasn't taught. Miss one, and the feedback walks you through why.",
    tab: "paths", anchor: "paths", quiz: 1, app: 0, celebrate: false,
  },
  {
    title: "The catalog",
    body: "The catalog is my list of courses: twenty four topics, each written for Nova from standard textbook material and taught in lessons and quizzes. A course built from a search? Same lessons, same standards, same me.",
    tab: "paths", anchor: "paths", quiz: 0, app: 0, celebrate: false,
  },
  {
    title: "Review brings it back",
    body: "Finishing a lesson earns you XP, points that count how much you have learned. Every answer you give goes on my review schedule, a list that brings questions back in daily practice just before you would forget them.",
    tab: "today", anchor: "stage", quiz: 0, app: 0, celebrate: false,
  },
  {
    title: "The shelf",
    body: "Finish a whole path and an object from it goes on my shelf, up on my stage, permanently. I keep trophies of completed work. Proof you finished, not merely that you started.",
    tab: "today", anchor: "shelf", quiz: 3, app: 0, celebrate: true,
  },
  {
    title: "Streaks",
    body: "Come back day after day and your streak, the count of days in a row you learned, grows. Sparks are points you earn as you learn. A freeze bought with Sparks covers one missed day. Miss a second one? That one's on you.",
    tab: "today", anchor: "stage", quiz: 5, app: 0, celebrate: false,
  },
  {
    title: "Nova remembers",
    body: "A confession: I remember how you learn. What you finished, what faded, even how often you poke me, all of it goes in the record, and it changes how I greet you. Consider yourself observed.",
    tab: null, anchor: null, quiz: 0, app: 0, celebrate: false,
  },
  {
    title: "Search is the library",
    body: "I'm the school; the rest of Cerebrum is the library. Ask it anything and it answers from real research, with the papers attached so you can check the work yourself. I insist on that part.",
    tab: null, anchor: null, quiz: 0, app: 1, celebrate: false,
  },
  {
    title: "Off you go",
    body: "That's the whole place. Pick a path, finish the first lesson, and try to impress me. People say it can't be done. People are often wrong, and I keep the data to prove it.",
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
    /* The celebrate rise is delayed a beat after the stop
       opens, the same shape NovaCelebrateFigure uses on the
       completion screens. The rise used to land synchronously
       with the step change, and the canvas swallows a rise
       that lands before its trigger input binds: NovaCanvas
       records the new count in its bookkeeping whether or
       not the input exists yet, so the fire never comes. The
       exposed case is a brisk advance beating the first bind
       after the tour opens (the shelf stop is five quick
       clicks in), and the cleanup keeps a fast advance from
       firing a stale celebration into the next stop. */
    let celebrateTimer = null;
    if (stop.celebrate) {
      celebrateTimer = window.setTimeout(() => setCelebrateN((n) => n + 1), 700);
    }
    // The stop index is the whole trigger: a new stop resets
    // the typewriter and says the line. Nothing stages the
    // screen behind her anymore (see the header), so the
    // host's spotlight callback goes undriven on purpose.
    void onSpotlight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { if (celebrateTimer) window.clearTimeout(celebrateTimer); };
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

  const narrow = winW <= 600;
  /* One figure size for the whole tour (the narrow switch
     is the only variation): her box never resizes between
     stops, so the canvas never reattributes its drawing
     surface mid tour either. The sizes match her stage on
     the learning home (2026-10-18, design audit M48): 288
     on desktop and 264 on phones, so she keeps one scale
     identity from surface to surface. The panel scrolls
     inside its 92vh cap when the taller figure needs it. */
  const figureSize = narrow ? 264 : 288;

  const dots = (
    <div style={{ display: "flex", alignItems: "center", gap: 7 }} aria-hidden="true">
      {TOUR_STEPS.map((_, i) => (
        <span key={i} style={{
          width: i === step ? 20 : 7, height: 7, borderRadius: 2,
          background: i === step ? accent : "rgba(255,255,255,0.28)",
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
        border: "1px solid " + NT_LINE, borderRadius: 2,
        padding: "18px 18px 16px", cursor: "pointer",
        boxShadow: "none",
      }}
    >
      <span style={{
        position: "absolute", top: -13, left: 14, background: NT_GOLD, color: onAccent,
        fontFamily: "var(--cb-font)", fontWeight: 500, fontSize: 11, letterSpacing: "0.16em",
        padding: "5px 11px 4px", borderRadius: 2, lineHeight: 1,
      }}>
        NOVA
      </span>
      <div style={{ fontSize: FONT_SIZES.section, fontWeight: 500, lineHeight: 1.3, margin: "0 0 8px" }}>
        {stop.title}
      </div>
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

  /* Two fixed rows (2026-10-16, layout audit finding 14):
     the old single row needed about 386px on one line and
     wrapped at phone widths, which could push Next and Back
     below the visible area. Row one is the dots and Skip,
     row two is Back and Next; neither row wraps, and each
     fits the narrowest panel content width. */
  const controls = (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {dots}
        <span style={{ flex: 1 }} />
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          style={{ background: "none", border: "none", color: "rgba(255,255,255,0.75)", cursor: "pointer", fontSize: FONT_SIZES.label, fontWeight: 500, fontFamily: "var(--cb-font)", padding: "10px 8px", minHeight: 44 }}
        >
          Skip the tour
        </button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ flex: 1 }} />
        {step > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); setStep(step - 1); }}
            style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.35)", color: "#FFFFFF", borderRadius: 2, padding: "10px 18px", fontSize: FONT_SIZES.body, fontWeight: 500, cursor: "pointer", fontFamily: "var(--cb-font)", minHeight: 44 }}
          >
            Back
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); advance(); }}
          style={{ background: accent, color: onAccent, border: "none", borderRadius: 2, padding: "10px 22px", fontSize: FONT_SIZES.body, fontWeight: 500, cursor: "pointer", fontFamily: "var(--cb-font)", minHeight: 44 }}
        >
          {last ? "Start learning" : "Next"}
        </button>
      </div>
    </div>
  );

  /* The one figure mount of the whole tour. It sits in the
     same tree position at every stop, so React never takes
     it down between stops: her runtime, her state machine,
     and her blink cycle run uninterrupted from the first
     stop to the last. */
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
        background: "rgba(5,6,8,0.82)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--cb-font)",
      }}
    >
      <style>{".nt-caret { animation: ntCaretBlink 0.9s ease-in-out infinite; } @keyframes ntCaretBlink { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }"}</style>
      <div
        className="lv-rise"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: P.raised, border: "1px solid " + P.line, borderRadius: 2,
          maxWidth: 560, width: "100%", margin: 18, padding: "26px 26px 22px",
          color: P.ink, boxShadow: "none",
          maxHeight: "92vh", overflowY: "auto",
          display: "flex", flexDirection: "column", gap: 18,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 500, letterSpacing: "0.12em", color: ink }}>
            HOW NOVA WORKS · {step + 1} OF {TOUR_STEPS.length}
          </div>
          {/* 44px hit area (2026-10-16, layout audit finding 20); the glyph size is unchanged. */}
          <button
            aria-label="Skip the tour"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            style={{ background: "none", border: "none", color: P.ink2, cursor: "pointer", fontSize: 15, lineHeight: 1, padding: 8, minWidth: 44, minHeight: 44, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
          >
            ✕
          </button>
        </div>
        <div style={{ display: "flex", justifyContent: "center" }}>{figure}</div>
        {dialogue}
        {controls}
      </div>
    </div>
  );
}
