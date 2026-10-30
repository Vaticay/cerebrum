/* ── Nova's figure, rebuilt from primitives (2026-10-29) ─────
   The owner's verdict on the shipped mascot, in his words:
   she needs "to look less cartoonish", she "needs to be more
   stern and have life". The figure she replaces was the Rive
   editor asset at public/nova/nova.riv: a chibi build with an
   oversized head, oversized glossy eyes, and sticker
   proportions, which his standing bar (an adult product with
   swagger, never cute or childish) never allowed. A .riv
   binary cannot be re proportioned from code, so her figure
   is drawn here, from primitives, in the construction
   discipline of his own model sheet: flat vector only, no
   gradients, no glow, no soft shadow, no texture; closed
   paths; every limb, gill, and garment piece its own named
   group with its pivot at the joint; a solid black fill must
   still read as an axolotl in a coat with countable gills.

   What changed against the chibi build:
   - Adult proportions. The head is about a fifth of her
     height, not half of it. The torso and limbs are long,
     the coat reaches mid thigh, and she stands like a
     person, not a plush.
   - The eyes are natural sized, solid, with no sparkle and
     no gloss highlight anywhere on her.
   - Her resting face is the stern one: heavy lids sitting
     low over the eyes, a brow line set low and flat, a flat
     mouth. Unimpressed is the default. A greeting eases the
     brows and lids a fraction; a pleased moment raises one
     brow and ticks one mouth corner; neither lingers, and
     there is no scowl anywhere in the set.
   - Life is slow idle motion only: a breathing cycle in the
     torso, a blink cycle, a faint sway in each gill, and the
     head turn the pointer feed has always driven. No bounce,
     no waving, no loops that read as sticker energy.

   Palette, from his model sheet, unchanged: skin (warm clay
   rose) #C97B63, coat (parchment cream, the lightest value)
   #FDF3D7, line (deep obsidian brown) #2A1A12, glasses
   (muted gold) #A98A4C. Stroke weights are the sheet's,
   scaled to this canvas: heavy 6, thin 2.5, glasses 8.

   The seam is NovaRive.jsx's NovaCanvas, which feeds this
   component the same feeds it fed the canvas: the behavior
   state name, quizState and appState, the sleep stage, the
   scanning flag, the speech controller's talking flag, the
   pointer, the reduced motion flag, and the poke and
   celebrate counters. Expressions ride those feeds; nothing
   here invents a second brain. Reduced motion, by prop or
   by the system setting, stills every cycle and leaves the
   composed stern figure.

   ── Motion plumbing (2026-10-29, Lane 2 of the motion and
   dialog spec, Part 1, built on this rig so every timing is
   proven before the plate art lands) ──────────────────────
   - Size buckets: the figure measures its own visible
     rendered height (clipped by any overflow hidden mount,
     which is how the bust crop reports its true height) and
     scales plate transform amplitudes by it: under 90px
     times 3, 90 to 200px times 1.8, above 200px times 1.
     State swaps (lids, brows, mouths, expressions) are never
     scaled. The owner weighted the bust and small classes
     first, so the lid beats that must read at 66px (attention
     wake, reread, the pre sleep long blink) take a larger
     state step in the small class instead of the stage step.
   - The blink is randomized: a triangular interval between
     2.5 and 7.5 seconds with its mode at 4 seconds, 12
     percent double blinks, close 80ms, hold 40ms, open
     160ms ease out. It is driven from state now, not from a
     fixed keyframe loop.
   - The six gills are detuned: each has its own period
     spread between 5.8 and 7.6 seconds and its own travel
     between 3 and 4 degrees, pivoting at its root. In the
     small class the detune collapses to one shared sway.
   - Breath has phase lag: the torso leads on a 4.8 second
     cycle (7.5 seconds asleep), the head follows 120ms
     behind at 0.8 amplitude, and the gills ride a further
     60ms behind the head.
   - The fixed 13 second glance keyframes are deleted. In
     their place, micro saccades: the pupils shift 0.6 to
     1.2 units (times the bucket multiplier) at irregular
     1.5 to 4 second intervals, instant, never a glide, in
     the stage and medium classes only. Eyes otherwise move
     for a cause only. Pointer gaze stays as shipped.
   - The mouth is plan driven: the 0.36 second ellipse chew
     loop is gone. Four speech shapes (closed, slot, narrow
     open, wide open) are chosen from the speech plan's
     bursts, and the mouth is closed through every pause
     (clause 150ms, sentence 320ms, breath 120ms, punch
     560ms, as speechPlanFor in NovaSpeech.jsx computes
     them). A caller may hand the plan in directly through
     the speech, speechPlan, or speechText props; on the
     shipped seam NovaCanvas forwards only the talking flag,
     and that flag is itself pulsed by the controller from
     the same plan (speechTalkingAt), so the burst and pause
     timing the mouth obeys is the plan's either way. Shape
     choice inside a burst follows novaTalkShapeAt when only
     the flag is available, and novaMouthShapeAt when the
     plan itself is in hand.
   - Expression transitions are a table, not one global
     300ms: ordinary 300ms, verdict faces (deadpan, pleased,
     worried) 120ms in, drift toward sleep 1000ms, greeting
     softening 260ms.
   - Worried and explaining are real drawn states now, not
     fall throughs to stern. Worried: inner brow up about 4
     units and outer down about 2 (a rotation of each brow
     around its centre, plus a 1 unit lift), lids one state
     up, mouth shortened by 20 percent with corners level.
     Explaining: lids one state up, head rotated 1 degree,
     and the speech mouth set while she teaches, with the
     narrow open shape as its resting shape between bursts.
   - Idle repertoire, wired where the rig can see its
     triggers: weight shift every 20 to 60 seconds (1 to 2
     degrees of lean and a 1 unit height change, settling
     over 600ms, stage and medium only), a sigh once every
     2 to 5 minutes (one breath cycle at 1.5 amplitude and
     1.3 duration, stage and medium only), a glasses adjust
     no more often than the sigh (glasses rise 2 units over
     150ms and settle, stage only, brow flashing under it),
     attention wake (typing raises her lids one state before
     any line), pre sleep resistance (one long blink, then
     the drift to fading lands), and reread (attention
     returning to her narrows her lids one state for 2 to 4
     seconds). Sleep and wake timing stays with the brain
     that feeds sleepStage; this rig only renders the stages.
   - Reduced motion: no loops, no transforms, no saccades.
     Expression swaps still occur, and the mouth does not
     perform. The nvf-still class below enforces the stills,
     and every timer in this file checks the same flag. */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { speechPlanFor } from "./NovaSpeech.jsx";

const SKIN = "#C97B63";
const COAT = "#FDF3D7";
const LINE = "#2A1A12";
const GOLD = "#A98A4C";
const HEAVY = 6;
const THIN = 2.5;
const GLASSES_W = 8;

/* ── Size buckets (spec 1.1 and 1.5) ────────────────────────
   Plate transform amplitudes are authored for the stage and
   scaled by the bucket the figure actually renders in. State
   swaps are never scaled: a swap reads whole at any size. */
export function novaSizeClassFor(heightPx) {
  if (typeof heightPx !== "number" || !Number.isFinite(heightPx) || heightPx <= 0) {
    return { name: "stage", multiplier: 1, heightPx: 0 };
  }
  if (heightPx < 90) return { name: "small", multiplier: 3, heightPx };
  if (heightPx <= 200) return { name: "medium", multiplier: 1.8, heightPx };
  return { name: "stage", multiplier: 1, heightPx };
}

/* ── The randomized blink (spec 1.4) ────────────────────────
   A triangular draw between 2.5 and 7.5 seconds whose mode
   sits at 4 seconds, so most blinks land near 4 seconds and
   few land at the edges. rand is a 0 to 1 draw, injected so
   the shape of the distribution is testable. */
export function novaBlinkIntervalMs(rand = Math.random()) {
  const lo = 2500, mode = 4000, hi = 7500;
  const u = Math.max(0, Math.min(1, rand));
  const fc = (mode - lo) / (hi - lo);
  if (u < fc) return Math.round(lo + Math.sqrt(u * (hi - lo) * (mode - lo)));
  return Math.round(hi - Math.sqrt((1 - u) * (hi - lo) * (hi - mode)));
}
export const NOVA_BLINK_CLOSE_MS = 80;
export const NOVA_BLINK_HOLD_MS = 40;
export const NOVA_BLINK_OPEN_MS = 160;
export const NOVA_BLINK_DOUBLE_CHANCE = 0.12;

/* ── Gill detune (spec 1.4) ─────────────────────────────────
   Six gills, three a side, each with its own period spread
   between 5.8 and 7.6 seconds and its own tip travel
   between 3 and 4 degrees. The sway keyframe rotates each
   gill by half its travel either way around its root. In
   the small class every gill takes the shared row instead:
   one period, one travel, no detune. */
export const NOVA_GILL_SWAY = [
  { periodS: 5.8, travelDeg: 3.0, delayS: -0.8 },
  { periodS: 6.35, travelDeg: 3.5, delayS: -2.1 },
  { periodS: 6.9, travelDeg: 4.0, delayS: -4.0 },
  { periodS: 7.6, travelDeg: 3.2, delayS: -1.3 },
  { periodS: 6.1, travelDeg: 3.8, delayS: -3.2 },
  { periodS: 7.25, travelDeg: 3.6, delayS: -5.1 },
];
export const NOVA_GILL_SWAY_SMALL = { periodS: 6.7, travelDeg: 3.4, delayS: 0 };

/* ── Breath (spec 1.4) ──────────────────────────────────────
   One cycle of 4.8 seconds, 7.5 asleep. The torso rises 1.5
   units and scales 1.006 at its base; the head follows
   120ms behind at 0.8 amplitude; the gills ride a further
   60ms behind the head (180ms behind the torso). A sigh
   runs one cycle at 1.5 amplitude and 1.3 duration. */
export const NOVA_BREATH_MS = 4800;
export const NOVA_BREATH_SLEEP_MS = 7500;
export const NOVA_HEAD_LAG_MS = 120;
export const NOVA_GILL_LAG_MS = 180;

/* ── Expression transitions (spec 1.6) ──────────────────────
   Ordinary changes keep the 300ms baseline. Verdict faces
   land in 120ms. The drift toward sleep takes 1000ms.
   Greeting softening takes 260ms. */
export const NOVA_EXPRESSION_TRANSITIONS_MS = {
  ordinary: 300,
  verdict: 120,
  drift: 1000,
  greeting: 260,
};
const NOVA_VERDICT_FACES = ["deadpan", "pleased", "worried"];
export function novaExpressionTransitionMs(fromExpr, toExpr) {
  if (toExpr === "fading" || toExpr === "sleep") {
    if (fromExpr !== "fading" && fromExpr !== "sleep") return NOVA_EXPRESSION_TRANSITIONS_MS.drift;
  }
  if (toExpr === "greeting" && fromExpr !== "greeting") return NOVA_EXPRESSION_TRANSITIONS_MS.greeting;
  if (NOVA_VERDICT_FACES.indexOf(toExpr) !== -1 && fromExpr !== toExpr) return NOVA_EXPRESSION_TRANSITIONS_MS.verdict;
  return NOVA_EXPRESSION_TRANSITIONS_MS.ordinary;
}

/* ── The plan driven mouth (spec 1.1, 1.3, Part 2) ──────────
   Four speech shapes. Given a plan from speechPlanFor and
   an elapsed time, the shape is closed through every pause
   and opens inside a burst: a slot as the burst starts, the
   wide open at the heart of a long burst (a short burst
   peaks at narrow), and narrow as it closes. */
export function novaMouthShapeAt(plan, elapsedMs) {
  if (!plan || !Array.isArray(plan.bursts) || typeof elapsedMs !== "number" || elapsedMs < 0) return "closed";
  for (const b of plan.bursts) {
    if (elapsedMs >= b.startMs && elapsedMs < b.endMs) {
      const burstMs = b.endMs - b.startMs;
      const f = (elapsedMs - b.startMs) / Math.max(1, burstMs);
      if (f < 0.3) return "slot";
      if (f < 0.7) return burstMs >= 700 ? "wide" : "narrow";
      return "narrow";
    }
  }
  return "closed";
}
/* When only the talking flag is in hand, the flag itself is
   the plan's burst signal (the controller pulses it from
   speechTalkingAt), so the pauses still close the mouth on
   the plan's own timing. Inside one burst the shapes cycle
   slot, narrow, wide, narrow over 440ms rather than scaling
   one ellipse on a loop. */
export function novaTalkShapeAt(burstElapsedMs) {
  const t = Math.max(0, burstElapsedMs || 0) % 440;
  if (t < 110) return "slot";
  if (t < 220) return "narrow";
  if (t < 330) return "wide";
  return "narrow";
}

/* Lid rest offsets per expression, in units, positive down.
   One state up is the greeting step (minus 2); one state
   down toward closed is the thinking step (plus 2), then
   fading (plus 5) and sleep (plus 11). Worried and
   explaining sit one state up. Poked lids sit one state
   lower, as the shipped rig had them. */
export function novaLidOffsetFor(expression) {
  switch (expression) {
    case "greeting": return -2;
    case "thinking": return 2;
    case "poked": return 2.5;
    case "fading": return 5;
    case "sleep": return 11;
    case "worried": return -2;
    case "explaining": return -2;
    default: return 0;
  }
}

/* Brow transforms per expression. Worried is the audit
   geometry: rotating each brow about its centre by 8
   degrees, with a 1 unit lift, puts the inner end about 4
   units up and the outer end about 2 units down. Poked is
   the raised high state of spec 1.3 (the shipped rig pressed
   the poked brow down 3.5 units, which read as deadpan; the
   spec's raised high wins). */
function novaBrowTransformsFor(expression, glassesFlash) {
  let l = "", r = "";
  if (expression === "greeting") { l = "translateY(-3px)"; r = l; }
  else if (expression === "pleased") { l = "translateY(-2.5px)"; }
  else if (expression === "deadpan") { l = "translateY(2px)"; r = l; }
  else if (expression === "poked") { l = "translateY(-5px)"; r = l; }
  else if (expression === "worried") {
    l = "rotate(-8deg) translateY(-1px)";
    r = "rotate(8deg) translateY(-1px)";
  }
  if (glassesFlash) {
    const flash = "translateY(-2px)";
    l = flash + (l ? " " + l : "");
    r = flash + (r ? " " + r : "");
  }
  return { l, r };
}

const NOVA_FIGURE_CSS = `
.nvf-root .nvf-breathe { transform-box: view-box; transform-origin: 240px 528px; animation: nvfBreathe var(--nvf-breath-dur, 4.8s) ease-in-out infinite alternate; }
.nvf-root .nvf-headlag { transform-box: view-box; transform-origin: 240px 190px; animation: nvfBreatheHead var(--nvf-breath-dur, 4.8s) ease-in-out infinite alternate; animation-delay: 0.12s; }
.nvf-root .nvf-gillbreath { transform-box: view-box; transform-origin: 240px 130px; animation: nvfBreatheHead var(--nvf-breath-dur, 4.8s) ease-in-out infinite alternate; animation-delay: 0.18s; }
.nvf-root .nvf-tail { transform-box: view-box; transform-origin: 306px 532px; animation: nvfTail 9s ease-in-out infinite alternate; }
.nvf-root .nvf-gill { transform-box: view-box; animation: nvfGill var(--nvf-gill-dur, 6.5s) ease-in-out infinite alternate; }
.nvf-root .nvf-brow, .nvf-root .nvf-lids, .nvf-root .nvf-headexpr, .nvf-root .nvf-glasses { transition: transform var(--nvf-expr-ms, 300ms) ease; }
.nvf-root .nvf-brow { transform-box: fill-box; transform-origin: 50% 50%; }
.nvf-root .nvf-headexpr { transform-box: fill-box; transform-origin: 50% 62%; }
.nvf-root .nvf-glasses { transition: transform 150ms ease; }
.nvf-root[data-expression="thinking"] .nvf-headexpr { transform: rotate(1.4deg) translateX(2px); }
.nvf-root[data-expression="explaining"] .nvf-headexpr { transform: rotate(1deg); }
.nvf-root.nvf-still *, .nvf-root.nvf-still { animation: none !important; transition: none !important; }
@keyframes nvfBreathe { from { transform: translateY(0) scale(1); } to { transform: translateY(calc(-1.5px * var(--nvf-amp, 1) * var(--nvf-sigh-amp, 1))) scale(calc(1 + 0.006 * var(--nvf-amp, 1) * var(--nvf-sigh-amp, 1))); } }
@keyframes nvfBreatheHead { from { transform: translateY(0) scale(1); } to { transform: translateY(calc(-1.2px * var(--nvf-amp, 1) * var(--nvf-sigh-amp, 1))) scale(calc(1 + 0.0048 * var(--nvf-amp, 1) * var(--nvf-sigh-amp, 1))); } }
@keyframes nvfTail { from { transform: rotate(-0.8deg); } to { transform: rotate(0.9deg); } }
@keyframes nvfGill { from { transform: rotate(calc(var(--nvf-gill-travel, 3.4deg) * -0.5)); } to { transform: rotate(calc(var(--nvf-gill-travel, 3.4deg) * 0.5)); } }
@media (prefers-reduced-motion: reduce) {
  .nvf-root *, .nvf-root { animation: none !important; transition: none !important; }
}
`;

/* The resting expression and its neighbours, read off the
   same feeds the Rive contract carried. Sleep outranks
   everything; a result outranks a thought; the default,
   when nothing is being asked of her, is the stern face.
   Worried and explaining pass through as themselves now:
   their triggers (the second straight miss, a streak at
   risk, a darkened mood, the lesson sheet's third phase)
   already produced these names upstream and the rig used
   to drop them to stern. */
function baseExpressionFor({ state, quizState, appState, sleepStage, scanning }) {
  if (sleepStage >= 2 || state === "asleep") return "sleep";
  if (sleepStage === 1 || state === "fading") return "fading";
  if (state === "greeting") return "greeting";
  if (state === "worried") return "worried";
  if (state === "explaining") return "explaining";
  if (state === "pleased" || quizState === 3 || quizState === 5 || appState === 2) return "pleased";
  if (state === "deadpan" || quizState === 4 || appState === 3) return "deadpan";
  if (state === "thinking" || scanning || quizState === 1 || quizState === 2 || appState === 1) return "thinking";
  return "stern";
}

function userIsTypingNow(eventTarget) {
  try {
    const el = eventTarget && eventTarget.tagName ? eventTarget : (typeof document !== "undefined" ? document.activeElement : null);
    if (!el) return false;
    const tag = (el.tagName || "").toUpperCase();
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
  } catch {
    return false;
  }
}

export function NovaFigure(props) {
  const {
    state = null, quizState = 0, appState = 0, sleepStage = 0, scanning = false,
    talking = false, pointer = null, reducedMotion = false, pokeN = 0, celebrateN = 0,
    bust = false,
  } = props;
  /* Optional speech plan feeds (see the header note): a
     controller object, a plan, or a line of text to plan
     from. All optional; the shipped seam passes none of
     them and the talking flag carries the plan's timing. */
  const speechProp = props.speech || null;
  const speechCurrent = speechProp && speechProp.current ? speechProp.current : null;
  const plan = useMemo(() => props.speechPlan || (speechCurrent && speechCurrent.plan)
    || (props.speechText ? speechPlanFor(props.speechText) : null)
    || (speechCurrent && speechCurrent.text ? speechPlanFor(speechCurrent.text) : null),
    [props.speechPlan, props.speechText, speechCurrent && speechCurrent.plan, speechCurrent && speechCurrent.text]);
  const planStartMs = typeof props.speechStartedAt === "number" ? props.speechStartedAt
    : speechCurrent && typeof speechCurrent.shownAt === "number" ? speechCurrent.shownAt : null;

  /* ── Size measurement ───────────────────────────────────
     The figure reads its own visible height: its mount's
     height, clipped by the nearest overflow hidden ancestor
     (the bust crop's outer box), which is the height a
     viewer actually sees. Measured on mount, on resize of
     the mount, and whenever the framing inputs change. */
  const wrapRef = useRef(null);
  const [sizeInfo, setSizeInfo] = useState(() => novaSizeClassFor(0));
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof window === "undefined") return undefined;
    const measure = () => {
      let h = 0;
      try {
        h = el.getBoundingClientRect().height || 0;
        let node = el.parentElement;
        for (let i = 0; i < 4 && node; i++) {
          const cs = window.getComputedStyle ? window.getComputedStyle(node) : null;
          const clipped = cs && (cs.overflow === "hidden" || cs.overflowY === "hidden" || cs.overflow === "clip" || cs.overflowY === "clip");
          if (clipped) {
            const nh = node.getBoundingClientRect().height || 0;
            if (nh > 0) h = Math.min(h, nh);
          }
          node = node.parentElement;
        }
      } catch { /* Measurement is decoration; the stage default stands. */ }
      const next = novaSizeClassFor(h);
      setSizeInfo((prev) => (prev.name === next.name && Math.abs(prev.heightPx - next.heightPx) < 2 ? prev : next));
    };
    measure();
    let ro = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(measure);
      ro.observe(el);
    }
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      if (ro) ro.disconnect();
    };
  }, [bust]);
  const sizeClass = sizeInfo.name;
  const amp = sizeInfo.multiplier;
  const smallClass = sizeClass === "small";

  /* Poke and celebrate arrive as counters, the same
     contract the canvas bound to triggers: a rising count
     flashes the matching expression, then she settles back
     to whatever the feeds say. A poke earns the poked face
     for 750ms (spec 1.3); a celebration earns the dry
     pleased face for 1600ms, never a bounce. The recoil
     that accompanies a poke lives on the NovaLive wrapper
     in LearnView.jsx, per the owner's ruling: rotation and
     a lateral shift, no scale anywhere. */
  const [flash, setFlash] = useState(null);
  const prevPokeRef = useRef(pokeN);
  const prevCelebrateRef = useRef(celebrateN);
  const flashTimerRef = useRef(null);
  useEffect(() => {
    if (pokeN > prevPokeRef.current) {
      setFlash("poked");
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => setFlash(null), 750);
    }
    prevPokeRef.current = pokeN;
  }, [pokeN]);
  useEffect(() => {
    if (celebrateN > prevCelebrateRef.current) {
      setFlash("pleased");
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => setFlash(null), 1600);
    }
    prevCelebrateRef.current = celebrateN;
  }, [celebrateN]);
  useEffect(() => () => { if (flashTimerRef.current) clearTimeout(flashTimerRef.current); }, []);

  /* ── Pre sleep resistance ───────────────────────────────
     When the sleep stage steps up toward fading, she first
     performs one long blink that closes and reopens, and
     only then does the fading face land: the drift reads as
     resisted, not as a slider. The long blink is larger and
     slower in the small class, where a stage sized blink
     would barely register at 66px. */
  const [resisting, setResisting] = useState(false);
  const [longBlink, setLongBlink] = useState(null);
  const prevSleepRef = useRef(sleepStage);
  const longBlinkTimersRef = useRef([]);
  useEffect(() => {
    const prev = prevSleepRef.current;
    prevSleepRef.current = sleepStage;
    if (reducedMotion || prev === sleepStage || sleepStage < 1 || prev > sleepStage) return undefined;
    const closeMs = smallClass ? 260 : 200;
    const holdMs = smallClass ? 500 : 350;
    const openMs = smallClass ? 340 : 300;
    setResisting(true);
    setLongBlink({ phase: "closing", closeMs, openMs });
    longBlinkTimersRef.current.forEach((t) => clearTimeout(t));
    longBlinkTimersRef.current = [
      setTimeout(() => setLongBlink({ phase: "closed", closeMs, openMs }), closeMs),
      setTimeout(() => setLongBlink({ phase: "opening", closeMs, openMs }), closeMs + holdMs),
      setTimeout(() => { setLongBlink(null); setResisting(false); }, closeMs + holdMs + openMs),
    ];
    return undefined;
  }, [sleepStage, reducedMotion, smallClass]);
  useEffect(() => () => { longBlinkTimersRef.current.forEach((t) => clearTimeout(t)); }, []);

  const rawExpression = flash || baseExpressionFor({ state, quizState, appState, sleepStage, scanning });
  const expression = resisting && (rawExpression === "fading" || rawExpression === "sleep")
    ? baseExpressionFor({ state: state === "asleep" || state === "fading" ? null : state, quizState, appState, sleepStage: 0, scanning })
    : rawExpression;
  const awake = expression !== "sleep" && expression !== "fading";

  /* Expression transition duration for this change, from
     the table, held in a CSS variable the brow, lid, and
     head transitions all read. Derived during render (the
     tracked previous expression lives in state and updates
     in the same render), because a duration set in an
     effect would land one change late: the transition it
     prices would already have run at the old value. */
  const [exprTrack, setExprTrack] = useState({ expr: expression, ms: 300 });
  let exprMs = exprTrack.ms;
  if (exprTrack.expr !== expression) {
    exprMs = novaExpressionTransitionMs(exprTrack.expr, expression);
    setExprTrack({ expr: expression, ms: exprMs });
  }

  /* ── The blink engine ───────────────────────────────────
     A timeout chain, not a loop with a fixed period: wait a
     randomized interval, close in 80ms, hold 40ms, open in
     160ms ease out; 12 percent of blinks blink twice. Off
     while she sleeps and under reduced motion. The closed
     travel is one unit larger in the small class so the
     blink still reads at 66px. */
  const [blinkPhase, setBlinkPhase] = useState("open");
  useEffect(() => {
    if (reducedMotion || expression === "sleep") { setBlinkPhase("open"); return undefined; }
    let cancelled = false;
    const timers = [];
    const later = (fn, ms) => { timers.push(setTimeout(() => { if (!cancelled) fn(); }, ms)); };
    const oneBlink = (again) => {
      setBlinkPhase("closing");
      later(() => {
        setBlinkPhase("closed");
        later(() => {
          setBlinkPhase("opening");
          later(() => {
            setBlinkPhase("open");
            if (again) later(() => oneBlink(false), 140);
            else later(() => oneBlink(Math.random() < NOVA_BLINK_DOUBLE_CHANCE), novaBlinkIntervalMs());
          }, NOVA_BLINK_OPEN_MS);
        }, NOVA_BLINK_HOLD_MS);
      }, NOVA_BLINK_CLOSE_MS);
    };
    later(() => oneBlink(Math.random() < NOVA_BLINK_DOUBLE_CHANCE), novaBlinkIntervalMs());
    return () => { cancelled = true; timers.forEach((t) => clearTimeout(t)); };
  }, [reducedMotion, expression === "sleep"]);
  const blinkCloseY = smallClass ? 9 : 8;
  const blinkY = longBlink
    ? (longBlink.phase === "opening" ? 0 : blinkCloseY)
    : (blinkPhase === "closing" || blinkPhase === "closed" ? blinkCloseY : 0);
  const blinkTransitionMs = longBlink
    ? (longBlink.phase === "opening" ? longBlink.openMs : longBlink.closeMs)
    : blinkPhase === "opening" ? NOVA_BLINK_OPEN_MS : blinkPhase === "closing" ? NOVA_BLINK_CLOSE_MS : NOVA_BLINK_CLOSE_MS;
  const blinkEase = (longBlink && longBlink.phase === "opening") || blinkPhase === "opening" ? "ease-out" : "ease";

  /* ── Micro saccades ─────────────────────────────────────
     Stage and medium classes only, awake only, never under
     reduced motion. The pupils jump 0.6 to 1.2 units (times
     the bucket multiplier) at irregular 1.5 to 4 second
     intervals and hold; there is no transition on the eye
     group, so a shift is instant and never a glide. */
  const [saccade, setSaccade] = useState({ x: 0, y: 0 });
  useEffect(() => {
    if (reducedMotion || smallClass || !awake) { setSaccade({ x: 0, y: 0 }); return undefined; }
    let cancelled = false;
    const timers = [];
    const step = () => {
      const mag = (0.6 + Math.random() * 0.6) * amp;
      const dir = Math.random() < 0.5 ? -1 : 1;
      setSaccade({ x: Math.round(mag * dir * 10) / 10, y: Math.round(mag * (Math.random() - 0.5) * 8) / 10 });
      timers.push(setTimeout(() => { if (!cancelled) step(); }, 1500 + Math.random() * 2500));
    };
    timers.push(setTimeout(() => { if (!cancelled) step(); }, 1500 + Math.random() * 2500));
    return () => { cancelled = true; timers.forEach((t) => clearTimeout(t)); };
  }, [reducedMotion, smallClass, awake, amp]);

  /* ── Attention wake and reread ──────────────────────────
     Attention wake: the moment typing starts, her lids rise
     one state, before any line answers. Reread: when
     attention returns to her (the tab or window comes back,
     or the pointer returns to her), her lids narrow one
     state for 2 to 4 seconds, then release. In the small
     class both beats take a larger state step, and reread
     presses the brow as well, because a 2 unit lid step is
     under a pixel at 66px. A new question landing in view
     reaches this rig only as the thinking face it already
     wears; no separate feed for it crosses NovaCanvas, so
     that subtrigger rides the attention return signals
     above. */
  const [attentionWake, setAttentionWake] = useState(false);
  const [reread, setReread] = useState(false);
  const wakeTimerRef = useRef(null);
  const rereadTimerRef = useRef(null);
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onKey = (e) => {
      if (!userIsTypingNow(e && e.target)) return;
      setAttentionWake(true);
      if (wakeTimerRef.current) clearTimeout(wakeTimerRef.current);
      wakeTimerRef.current = setTimeout(() => setAttentionWake(false), 2400);
    };
    const doReread = () => {
      setReread(true);
      if (rereadTimerRef.current) clearTimeout(rereadTimerRef.current);
      rereadTimerRef.current = setTimeout(() => setReread(false), 2000 + Math.random() * 2000);
    };
    const onVisibility = () => { if (typeof document !== "undefined" && !document.hidden) doReread(); };
    const onFocus = () => doReread();
    window.addEventListener("keydown", onKey);
    window.addEventListener("focus", onFocus);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("focus", onFocus);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
      if (wakeTimerRef.current) clearTimeout(wakeTimerRef.current);
      if (rereadTimerRef.current) clearTimeout(rereadTimerRef.current);
    };
  }, []);

  /* ── Weight shift and sigh ──────────────────────────────
     Stage and medium only, awake only, never under reduced
     motion. Weight shift: every 20 to 60 seconds she
     resettles, 1 to 2 degrees of lean and a 1 unit height
     change (times the bucket multiplier), settling over
     600ms, holds a few seconds, and settles back. Sigh:
     every 2 to 5 minutes, one breath cycle at 1.5 amplitude
     and 1.3 duration, which the breath CSS variables below
     carry. */
  const [weightShift, setWeightShift] = useState({ deg: 0, dy: 0 });
  const [sigh, setSigh] = useState(false);
  const rareBeatsOk = !reducedMotion && !smallClass && awake;
  useEffect(() => {
    if (!rareBeatsOk) { setWeightShift({ deg: 0, dy: 0 }); return undefined; }
    let cancelled = false;
    const timers = [];
    const cycle = () => {
      const deg = Math.round((1 + Math.random()) * (Math.random() < 0.5 ? -1 : 1) * 10) / 10;
      const dy = Math.round((Math.random() < 0.5 ? -1 : 1) * amp * 10) / 10;
      setWeightShift({ deg, dy });
      timers.push(setTimeout(() => { if (!cancelled) setWeightShift({ deg: 0, dy: 0 }); }, 4000 + Math.random() * 4000));
      timers.push(setTimeout(() => { if (!cancelled) cycle(); }, 20000 + Math.random() * 40000));
    };
    timers.push(setTimeout(() => { if (!cancelled) cycle(); }, 20000 + Math.random() * 40000));
    return () => { cancelled = true; timers.forEach((t) => clearTimeout(t)); };
  }, [rareBeatsOk, amp]);
  useEffect(() => {
    if (!rareBeatsOk) { setSigh(false); return undefined; }
    let cancelled = false;
    const timers = [];
    const cycle = () => {
      setSigh(true);
      /* One full breath cycle at the sighed duration is a
         rise and a fall: two alternate iterations. Holding
         for both keeps the duration from reverting mid pose. */
      timers.push(setTimeout(() => { if (!cancelled) setSigh(false); }, Math.round(NOVA_BREATH_MS * 1.3 * 2)));
      timers.push(setTimeout(() => { if (!cancelled) cycle(); }, 120000 + Math.random() * 180000));
    };
    timers.push(setTimeout(() => { if (!cancelled) cycle(); }, 120000 + Math.random() * 180000));
    return () => { cancelled = true; timers.forEach((t) => clearTimeout(t)); };
  }, [rareBeatsOk]);

  /* ── Glasses adjust ─────────────────────────────────────
     Stage only, awake only, no more often than the sigh:
     the first beat waits at least 4 minutes and repeats at
     4 to 7 minute intervals, slower than the sigh's 2 to 5.
     The glasses rise 2 units (times the bucket multiplier,
     which is 1 on the stage) over 150ms and settle back,
     with the brow flashing raised under them. */
  const [glassesUp, setGlassesUp] = useState(false);
  useEffect(() => {
    if (reducedMotion || sizeClass !== "stage" || !awake) { setGlassesUp(false); return undefined; }
    let cancelled = false;
    const timers = [];
    const cycle = () => {
      setGlassesUp(true);
      timers.push(setTimeout(() => { if (!cancelled) setGlassesUp(false); }, 500));
      timers.push(setTimeout(() => { if (!cancelled) cycle(); }, 240000 + Math.random() * 180000));
    };
    timers.push(setTimeout(() => { if (!cancelled) cycle(); }, 240000 + Math.random() * 180000));
    return () => { cancelled = true; timers.forEach((t) => clearTimeout(t)); };
  }, [reducedMotion, sizeClass, awake]);

  /* ── The mouth ──────────────────────────────────────────
     Plan first: when a plan and a start time are in hand, a
     60ms clock (the controller's own cadence) reads the
     shape off the plan. Flag second: the talking flag's
     rising edge starts a burst, shapes cycle inside it, and
     the flag falling closes the mouth, which is the plan's
     pause arriving through the seam. Under reduced motion
     the mouth does not perform at all. */
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    if (!plan || planStartMs == null || reducedMotion) return undefined;
    setNowMs(Date.now());
    const iv = setInterval(() => setNowMs(Date.now()), 60);
    return () => clearInterval(iv);
  }, [plan, planStartMs, reducedMotion]);
  const [burstShape, setBurstShape] = useState("closed");
  const burstStartRef = useRef(null);
  useEffect(() => {
    if (reducedMotion || !talking) {
      burstStartRef.current = null;
      setBurstShape("closed");
      return undefined;
    }
    if (burstStartRef.current == null) burstStartRef.current = Date.now();
    const iv = setInterval(() => {
      setBurstShape(novaTalkShapeAt(Date.now() - (burstStartRef.current || Date.now())));
    }, 60);
    return () => clearInterval(iv);
  }, [talking, reducedMotion]);
  const planShape = plan && planStartMs != null && !reducedMotion ? novaMouthShapeAt(plan, nowMs - planStartMs) : null;
  const speaking = !reducedMotion && (talking || (planShape != null && planShape !== "closed") || (plan != null && planStartMs == null && talking));
  let activeMouth = "flat";
  if (speaking) {
    const shape = planShape != null ? planShape : burstShape;
    activeMouth = shape === "closed" ? "flat" : shape;
  } else if (expression === "pleased") activeMouth = "smirk";
  else if (expression === "worried") activeMouth = "worried";
  else if (expression === "explaining") activeMouth = "narrow";
  const mouthShown = (name) => (activeMouth === name ? "block" : "none");

  /* Lid offset: the expression's own step, plus the
     attention wake and reread steps while she is awake.
     Small class steps are larger, by the owner's bust
     weighting: wake minus 3.5 with a brow lift, reread plus
     3.5 with a brow press, against minus 2 and plus 2 on
     the larger classes. */
  let lidY = novaLidOffsetFor(expression);
  let browExtraL = "", browExtraR = "";
  if (awake && expression !== "poked") {
    if (attentionWake) {
      lidY += smallClass ? -3.5 : -2;
      if (smallClass) { browExtraL = "translateY(-2px)"; browExtraR = browExtraL; }
    }
    if (reread) {
      lidY += smallClass ? 3.5 : 2;
      if (smallClass) { browExtraL = "translateY(1.5px)"; browExtraR = browExtraL; }
    }
  }
  lidY = Math.max(-5.5, Math.min(11, lidY));
  const brows = novaBrowTransformsFor(expression, glassesUp);
  const browL = (browExtraL ? browExtraL + " " : "") + brows.l;
  const browR = (browExtraR ? browExtraR + " " : "") + brows.r;

  const breathDurS = expression === "sleep" ? (NOVA_BREATH_SLEEP_MS / 1000) + "s" : sigh ? ((NOVA_BREATH_MS * 1.3) / 1000) + "s" : (NOVA_BREATH_MS / 1000) + "s";
  const rootVars = {
    "--nvf-amp": amp,
    "--nvf-sigh-amp": sigh ? 1.5 : 1,
    "--nvf-breath-dur": breathDurS,
    "--nvf-expr-ms": exprMs + "ms",
  };

  /* The pointer feed is the contract's joystick, minus 100
     to 100: it becomes a few degrees and a few pixels of
     head turn around the neck pivot, the layered parallax
     the rig always promised, and nothing larger. Kept as
     shipped: aim up to 3.2 across and 2.4 down rides the
     NovaLive gaze feed, and the head tilt here caps at 2.2
     degrees. */
  const headTilt = pointer
    ? {
        transform: `rotate(${(pointer.x * 0.022).toFixed(2)}deg) translate(${(pointer.x * 0.035).toFixed(1)}px, ${(pointer.y * 0.02).toFixed(1)}px)`,
        transformOrigin: "240px 190px",
        transformBox: "view-box",
        transition: "transform 260ms ease",
      }
    : { transformOrigin: "240px 190px", transformBox: "view-box", transition: "transform 260ms ease" };

  const gillStyle = (i, origin) => {
    const sway = smallClass ? NOVA_GILL_SWAY_SMALL : NOVA_GILL_SWAY[i];
    return {
      transformOrigin: origin,
      animationDuration: sway.periodS + "s",
      animationDelay: sway.delayS + "s",
      "--nvf-gill-dur": sway.periodS + "s",
      "--nvf-gill-travel": sway.travelDeg + "deg",
    };
  };
  /* The gill keyframe reads its duration and travel from
     these variables, so they ride the element style; the
     animation shorthand in the stylesheet names the
     keyframes only. */
  const gillAnimStyle = (i, origin) => {
    const s = gillStyle(i, origin);
    return { ...s, animationName: "nvfGill", animationDuration: s["--nvf-gill-dur"], animationTimingFunction: "ease-in-out", animationIterationCount: "infinite", animationDirection: "alternate" };
  };

  return (
    <span ref={wrapRef} style={{ display: "block", width: "100%", height: "100%" }}
      onPointerEnter={() => {
        setReread(true);
        if (rereadTimerRef.current) clearTimeout(rereadTimerRef.current);
        rereadTimerRef.current = setTimeout(() => setReread(false), 2000 + Math.random() * 2000);
      }}>
      <style>{NOVA_FIGURE_CSS}</style>
      <svg
        className={"nvf-root" + (reducedMotion ? " nvf-still" : "")}
        data-nova-figure="rig"
        data-expression={expression}
        data-talking={talking ? "true" : "false"}
        data-size-class={sizeClass}
        data-amp={amp}
        data-mouth={activeMouth}
        data-blink={longBlink ? "long-" + longBlink.phase : blinkPhase}
        viewBox="0 0 480 640"
        preserveAspectRatio={bust ? "xMidYMin meet" : "xMidYMax meet"}
        width="100%"
        height="100%"
        style={{ display: "block", ...rootVars }}
        aria-hidden="true"
      >
        <g id="WeightShift" style={{
          transform: weightShift.deg || weightShift.dy ? `rotate(${weightShift.deg}deg) translateY(${weightShift.dy}px)` : "none",
          transformOrigin: "240px 630px",
          transformBox: "view-box",
          transition: "transform 600ms ease",
        }}>
        <g id="Tail" className="nvf-tail">
          <path d="M 306 512 C 374 538 424 564 450 596 C 458 606 450 618 434 616 C 382 608 336 584 306 556 C 298 536 298 524 306 512 Z" fill={SKIN} stroke={LINE} strokeWidth={HEAVY} strokeLinejoin="round" />
          <path d="M 330 552 C 372 572 404 588 424 600" fill="none" stroke={LINE} strokeWidth={THIN} strokeLinecap="round" />
        </g>
        <g id="Legs">
          <path d="M 201 480 L 231 480 L 232 596 L 200 596 Z" fill={SKIN} stroke={LINE} strokeWidth={HEAVY} strokeLinejoin="round" />
          <path d="M 249 480 L 279 480 L 280 596 L 248 596 Z" fill={SKIN} stroke={LINE} strokeWidth={HEAVY} strokeLinejoin="round" />
          <path d="M 188 594 C 186 607 195 615 210 615 L 232 615 C 244 615 248 606 242 597 C 234 589 196 587 188 594 Z" fill={SKIN} stroke={LINE} strokeWidth={HEAVY} strokeLinejoin="round" />
          <path d="M 238 594 C 236 607 245 615 260 615 L 282 615 C 294 615 298 606 292 597 C 284 589 246 587 238 594 Z" fill={SKIN} stroke={LINE} strokeWidth={HEAVY} strokeLinejoin="round" />
          <path d="M 210 600 L 212 608 M 226 600 L 228 608 M 260 600 L 262 608 M 276 600 L 278 608" stroke={LINE} strokeWidth={THIN} strokeLinecap="round" />
        </g>
        <g id="Neck">
          <path d="M 216 168 L 216 212 C 216 222 264 222 264 212 L 264 168 Z" fill={SKIN} stroke={LINE} strokeWidth={HEAVY} strokeLinejoin="round" />
        </g>
        <g id="Upper">
          <g id="TorsoBreath" className="nvf-breathe">
          <g id="Body">
            <path d="M 170 212 C 156 217 149 230 147 258 L 142 506 C 142 520 150 528 164 528 L 316 528 C 330 528 338 520 338 506 L 333 258 C 331 230 324 217 310 212 C 278 224 202 224 170 212 Z" fill={COAT} stroke={LINE} strokeWidth={HEAVY} strokeLinejoin="round" />
            <path d="M 234 252 L 234 520 M 246 252 L 246 520" stroke={LINE} strokeWidth={THIN} />
            <circle cx="240" cy="306" r="4.5" fill={GOLD} stroke={LINE} strokeWidth="2" />
            <circle cx="240" cy="368" r="4.5" fill={GOLD} stroke={LINE} strokeWidth="2" />
            <circle cx="240" cy="430" r="4.5" fill={GOLD} stroke={LINE} strokeWidth="2" />
            <path d="M 234 226 L 198 216 L 208 268 L 234 288 Z" fill={COAT} stroke={LINE} strokeWidth={THIN} strokeLinejoin="round" />
            <path d="M 246 226 L 282 216 L 272 268 L 246 288 Z" fill={COAT} stroke={LINE} strokeWidth={THIN} strokeLinejoin="round" />
            <path d="M 168 420 L 216 420 L 216 446 L 168 446 Z" fill={COAT} stroke={LINE} strokeWidth={THIN} strokeLinejoin="round" />
            <path d="M 264 420 L 312 420 L 312 446 L 264 446 Z" fill={COAT} stroke={LINE} strokeWidth={THIN} strokeLinejoin="round" />
            <g id="Badge" transform="translate(174 326) rotate(-2)">
              <rect x="0" y="0" width="46" height="56" rx="5" fill={COAT} stroke={LINE} strokeWidth={THIN} />
              <rect x="0" y="0" width="46" height="10" fill={GOLD} />
              <circle cx="23" cy="27" r="8" fill={SKIN} stroke={LINE} strokeWidth="2" />
              <path d="M 10 43 L 36 43 M 10 49 L 29 49" stroke={LINE} strokeWidth="2" strokeLinecap="round" />
            </g>
          </g>
          <g id="Arm_L">
            <path d="M 168 216 C 148 224 138 246 136 276 L 128 420 C 127 434 134 442 146 442 L 162 442 C 172 442 176 434 176 422 L 180 300 C 182 262 178 232 168 216 Z" fill={COAT} stroke={LINE} strokeWidth={HEAVY} strokeLinejoin="round" />
            <path d="M 130 404 L 178 404 L 178 424 L 130 424 Z" fill={COAT} stroke={LINE} strokeWidth={THIN} strokeLinejoin="round" />
            <path d="M 138 442 C 134 462 138 480 150 482 C 162 484 169 472 169 454 L 169 442 Z" fill={SKIN} stroke={LINE} strokeWidth={HEAVY} strokeLinejoin="round" />
          </g>
          <g id="Arm_R">
            <path d="M 310 214 C 334 220 352 238 358 266 L 366 330 C 368 342 362 350 352 348 L 330 344 C 322 342 318 336 317 326 L 313 262 C 311 240 308 226 310 214 Z" fill={COAT} stroke={LINE} strokeWidth={HEAVY} strokeLinejoin="round" />
            <path d="M 352 348 C 346 376 342 392 338 404 L 316 398 C 322 374 328 356 330 344 Z" fill={COAT} stroke={LINE} strokeWidth={HEAVY} strokeLinejoin="round" />
            <path d="M 322 398 C 312 410 314 428 326 432 C 338 435 348 424 346 408 L 344 396 Z" fill={SKIN} stroke={LINE} strokeWidth={HEAVY} strokeLinejoin="round" />
          </g>
          </g>
          <g id="HeadTilt" style={headTilt}>
            <g className="nvf-gillbreath">
            <g id="Gill_L1" className="nvf-gill" style={gillAnimStyle(0, "168px 118px")}>
              <path d="M 170 106 C 142 84 124 62 116 38 C 112 24 100 22 96 36 C 88 68 102 98 130 120 C 144 130 158 126 170 106 Z" fill={SKIN} stroke={LINE} strokeWidth={HEAVY} strokeLinejoin="round" />
            </g>
            <g id="Gill_L2" className="nvf-gill" style={gillAnimStyle(1, "164px 118px")}>
              <path d="M 166 126 C 130 112 100 104 74 108 C 60 110 56 98 68 90 C 98 68 142 80 164 104 C 172 112 172 118 166 126 Z" fill={SKIN} stroke={LINE} strokeWidth={HEAVY} strokeLinejoin="round" />
            </g>
            <g id="Gill_L3" className="nvf-gill" style={gillAnimStyle(2, "162px 132px")}>
              <path d="M 168 146 C 138 150 112 162 94 182 C 84 194 72 190 76 174 C 84 144 116 122 148 122 C 162 122 170 132 168 146 Z" fill={SKIN} stroke={LINE} strokeWidth={HEAVY} strokeLinejoin="round" />
            </g>
            <g id="Gill_R1" className="nvf-gill" style={gillAnimStyle(3, "312px 118px")}>
              <path d="M 310 106 C 338 84 356 62 364 38 C 368 24 380 22 384 36 C 392 68 378 98 350 120 C 336 130 322 126 310 106 Z" fill={SKIN} stroke={LINE} strokeWidth={HEAVY} strokeLinejoin="round" />
            </g>
            <g id="Gill_R2" className="nvf-gill" style={gillAnimStyle(4, "316px 118px")}>
              <path d="M 314 126 C 350 112 380 104 406 108 C 420 110 424 98 412 90 C 382 68 338 80 316 104 C 308 112 308 118 314 126 Z" fill={SKIN} stroke={LINE} strokeWidth={HEAVY} strokeLinejoin="round" />
            </g>
            <g id="Gill_R3" className="nvf-gill" style={gillAnimStyle(5, "318px 132px")}>
              <path d="M 312 146 C 342 150 368 162 386 182 C 396 194 408 190 404 174 C 396 144 364 122 332 122 C 318 122 310 132 312 146 Z" fill={SKIN} stroke={LINE} strokeWidth={HEAVY} strokeLinejoin="round" />
            </g>
            </g>
            <g id="HeadLag" className="nvf-headlag">
            <g id="Head">
              <path d="M 240 58 C 290 58 322 86 324 128 C 326 166 296 194 240 194 C 184 194 154 166 156 128 C 158 86 190 58 240 58 Z" fill={SKIN} stroke={LINE} strokeWidth={HEAVY} strokeLinejoin="round" />
              <g id="Face" className="nvf-headexpr">
                <g id="Brows">
                  <g id="Brow_L" className="nvf-brow nvf-brow-l" style={{ transform: browL }}>
                    <path d="M 186 98 C 198 96 216 97 226 101" fill="none" stroke={LINE} strokeWidth={HEAVY} strokeLinecap="round" />
                  </g>
                  <g id="Brow_R" className="nvf-brow nvf-brow-r" style={{ transform: browR }}>
                    <path d="M 254 101 C 264 97 282 96 294 98" fill="none" stroke={LINE} strokeWidth={HEAVY} strokeLinecap="round" />
                  </g>
                </g>
                <g id="Eyes" className="nvf-glance" style={{ transform: saccade.x || saccade.y ? `translate(${saccade.x}px, ${saccade.y}px)` : "none" }}>
                  <path d="M 190 132 C 197 124 213 124 220 132 C 213 137 197 137 190 132 Z" fill={LINE} />
                  <path d="M 260 132 C 267 124 283 124 290 132 C 283 137 267 137 260 132 Z" fill={LINE} />
                </g>
                <g id="Lids" className="nvf-lids" style={{ transform: `translateY(${lidY}px)`, transition: `transform ${exprMs}ms ease` }}>
                  <g className="nvf-blink" style={{ transform: `translateY(${blinkY}px)`, transition: `transform ${blinkTransitionMs}ms ${blinkEase}` }}>
                    <path d="M 187 129 C 198 125 216 125 227 129 L 227 100 L 187 100 Z" fill={SKIN} />
                    <path d="M 187 129 C 198 125 216 125 227 129" fill="none" stroke={LINE} strokeWidth={HEAVY} strokeLinecap="round" />
                    <path d="M 253 129 C 264 125 282 125 293 129 L 293 100 L 253 100 Z" fill={SKIN} />
                    <path d="M 253 129 C 264 125 282 125 293 129" fill="none" stroke={LINE} strokeWidth={HEAVY} strokeLinecap="round" />
                  </g>
                </g>
                <g id="Glasses" className="nvf-glasses" style={{ transform: glassesUp ? `translateY(${(-2 * amp).toFixed(1)}px)` : "none" }}>
                  <rect x="183" y="104" width="48" height="46" rx="12" fill="none" stroke={GOLD} strokeWidth={GLASSES_W} />
                  <rect x="249" y="104" width="48" height="46" rx="12" fill="none" stroke={GOLD} strokeWidth={GLASSES_W} />
                  <path d="M 231 116 C 237 111 243 111 249 116" fill="none" stroke={GOLD} strokeWidth={GLASSES_W} />
                  <path d="M 183 114 L 162 108 M 297 114 L 318 108" stroke={GOLD} strokeWidth={GLASSES_W} strokeLinecap="round" />
                </g>
                <g id="Nose">
                  <circle cx="233" cy="156" r="2.6" fill={LINE} />
                  <circle cx="247" cy="156" r="2.6" fill={LINE} />
                </g>
                <g id="Mouth_Flat" className="nvf-mouth nvf-mouth-flat" style={{ display: mouthShown("flat") }}>
                  <path d="M 218 170 L 262 170" stroke={LINE} strokeWidth={HEAVY} strokeLinecap="round" />
                </g>
                <g id="Mouth_Pleased" className="nvf-mouth nvf-mouth-smirk" style={{ display: mouthShown("smirk") }}>
                  <path d="M 218 169 C 232 173 250 172 261 164" fill="none" stroke={LINE} strokeWidth={HEAVY} strokeLinecap="round" />
                </g>
                <g id="Mouth_Worried" className="nvf-mouth nvf-mouth-worried" style={{ display: mouthShown("worried") }}>
                  <path d="M 222.5 170 L 257.5 170" stroke={LINE} strokeWidth={HEAVY} strokeLinecap="round" />
                </g>
                <g id="Mouth_Slot" className="nvf-mouth nvf-mouth-slot" style={{ display: mouthShown("slot") }}>
                  <rect x="227" y="168.5" width="26" height="3.5" rx="1.75" fill={LINE} />
                </g>
                <g id="Mouth_Narrow" className="nvf-mouth nvf-mouth-narrow" style={{ display: mouthShown("narrow") }}>
                  <ellipse cx="240" cy="171" rx="4" ry="3" fill={LINE} />
                </g>
                <g id="Mouth_Talk" className="nvf-mouth nvf-mouth-talk" style={{ display: mouthShown("wide") }}>
                  <ellipse cx="240" cy="171" rx="6" ry="4.5" fill={LINE} />
                </g>
              </g>
            </g>
            </g>
          </g>
        </g>
        </g>
      </svg>
    </span>
  );
}

export default NovaFigure;
