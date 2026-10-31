/* ── Nova's figure: the drop (2026-10-31) ────────────────────
   The owner's ruling of 2026-10-31 settled her form: a little
   bubble, like Cortana, and of the two builds of it he picked
   Claude's version. This component is that artwork, drawn
   behind the same seam the retired rig used: NovaRive.jsx's
   NovaCanvas feeds it the behavior state name, quizState and
   appState, the sleep stage, the scanning flag, the speech
   controller's talking flag, the pointer, the reduced motion
   flag, and the poke and celebrate counters. Expressions ride
   those feeds; nothing here invents a second brain. The Home
   B composition, the dialog rework, and the brain are
   untouched by the swap.

   The visual authority is Claude's own SVG (kept at
   ~/workspace/nova-bubble-claude-oct30/nova-claude.svg): its
   body path, filament paths and lengths, gold, water, mass,
   specular, and mouth are law, transcribed below. Her values
   (ground, pool, gold, and the artwork's colors and gradient
   stops) come from the shared register tokens in
   registerTokens.js, not from literals local to this file,
   so the site wide register pass inherits one source.

   The retired rig (2026-10-29 to 2026-10-31) drew a standing
   figure on this same 480 by 640 canvas, and the canvas
   contract in NovaCanvas is built around that box: bust
   mounts crop the top of it, full mounts hug it. The drop
   keeps the canvas and is placed inside it: scaled 0.85 from
   the authority artwork's 480 square, top anchored in the
   head zone for bust mounts, standing on her contact shadow
   for full mounts. Two forced changes ride on the seam, both
   minimal, both logged in the swap report: the authority
   file's full frame ground and light pool are its portrait
   backdrop and are not drawn here (every mount sits on a
   live surface whose own ground shows through; the pool
   survives inside her, refracted), and the identity strokes
   gain weight in the small and medium size classes, because
   the authority wire at 2.7 to 3.2 units renders under half
   a pixel at the 66px header size. Per size identity drawing
   is the consult's own requirement; the values at stage size
   are Claude's exactly.

   ── Behavior on the drop (the consult's motion sections
   are the authority, ~/workspace/nova-bubble-claude-oct30/
   claude-bubble-feedback.md) ──────────────────────────────
   - Idle: a vertical drift on a 5 second sine, about 3
     percent of her diameter, the filaments following the
     body 200ms behind and settling, the interior mass
     rotating on a 22 second cycle, and each filament
     swaying on its own detuned period from the authority
     file (5.4 to 8.3 seconds, a degree or so each way).
     Driven from one 120ms clock in this file, not from
     keyframe loops, so the lag is a lag and not a phase
     guess. No bounce, no overshoot anywhere.
   - Blink: lids low at rest (about 30 percent of the lens
     covered, stern), close in 90ms, hold 40ms, reopen in
     260ms. The slow reopen is the personality. Interval
     randomized between 7 and 13 seconds. (Claude's SVG file
     reopens in about 105ms against its own consult's 260;
     the consult wins, as the parent ruled.)
   - Expressions are lid and mass state changes on the
     existing expression names: greeting eases the lids up,
     explaining and worried sit one step up, thinking lowers
     them a step and stills the filaments while one bright
     node orbits inside the mass, pleased brightens the
     specular over 600ms and lifts the filaments a few
     degrees (no smile; the mouth stays flat), deadpan is
     the unimpressed beat (lids drop a further 15 percent of
     the lens and she drifts a few units away from the
     pointer's side), poked dips the lids for the flash's
     750ms (the recoil itself still lives on the NovaLive
     wrapper, per the owner's ruling), fading descends, and
     sleep closes the lids and stills the cycles.
   - Talking: no visemes, no mouth shapes. Three channels
     from the existing speech plan: lid micro movement at
     phrase boundaries, a faint pressure ripple crossing
     the surface once per burst, and the mouth line's width
     changing 2 to 3 percent at the heart of a burst (the
     plan's wide phase reads as the stressed syllable).
     Pauses close nothing; the line simply rests.
   - Attention: the face cluster (mass, lids, wire, mouth)
     shifts a few units toward the pointer over 250ms and
     the filaments follow at a slower transition, trailing.
     No tilt, no nod.
   - Arrive: she resolves on mount, opacity and a 0.94 to 1
     settle over 400ms, the gold last over the final 200ms.
   - The rig's standing body repertoire retired with it:
     weight shift, the sigh, the glasses adjust, micro
     saccades (she has no pupils to shift), and breath in
     the torso. The attention wake and reread lid beats
     carry over; they were always lid beats. The pre sleep
     long blink carries over on the same terms.
   - Reduced motion, by prop or by the system setting,
     stills every cycle and leaves the composed drop: state
     swaps still occur, the mouth does not perform. */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { speechPlanFor } from "./NovaSpeech.jsx";
import { NOVA_DROP_TOKENS } from "./registerTokens.js";

const T = NOVA_DROP_TOKENS;

/* ── Size buckets ───────────────────────────────────────────
   The figure measures its own visible rendered height and
   classes itself: under 90px small, 90 to 200 medium, above
   200 stage. On the rig these classes scaled transform
   amplitudes; on the drop they scale the identity layer's
   stroke weights, because a swap reads whole at any size
   and a transform has nothing to prove at 66px, while a
   3 unit wire at 66px is under half a pixel. State swaps
   are never scaled. */
export function novaSizeClassFor(heightPx) {
  if (typeof heightPx !== "number" || !Number.isFinite(heightPx) || heightPx <= 0) {
    return { name: "stage", multiplier: 1, heightPx: 0 };
  }
  if (heightPx < 90) return { name: "small", multiplier: 3, heightPx };
  if (heightPx <= 200) return { name: "medium", multiplier: 1.8, heightPx };
  return { name: "stage", multiplier: 1, heightPx };
}
const NOVA_IDENTITY_BOOST = { small: 2.1, medium: 1.45, stage: 1 };

/* ── The randomized blink (consult section 4) ───────────────
   Interval randomized between 7 and 13 seconds; rand is a 0
   to 1 draw, injected so the distribution is testable.
   Close 90ms, hold 40ms, reopen 260ms: the consult's
   numbers, not the authority file's faster reopen. */
export function novaBlinkIntervalMs(rand = Math.random()) {
  const u = Math.max(0, Math.min(1, rand));
  return Math.round(7000 + u * 6000);
}
export const NOVA_BLINK_CLOSE_MS = 90;
export const NOVA_BLINK_HOLD_MS = 40;
export const NOVA_BLINK_OPEN_MS = 260;

/* ── Expression transitions ─────────────────────────────────
   The table the build already used, unchanged: ordinary
   300ms, verdict faces (deadpan, pleased, worried) 120ms
   in, drift toward sleep 1000ms, greeting softening 260ms.
   On the drop these price the lid and state transitions. */
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

/* ── The plan driven speech phases ──────────────────────────
   The same two readers the rig's mouth used, kept because
   the seam's plan timing is unchanged. What they drive is
   different: not a mouth shape, but the drop's stress value
   (the mouth line's width) and her burst boundaries (the
   lid nudge and the pressure ripple). A burst's phases:
   slot at its start, wide at the heart of a long burst (a
   short burst peaks at narrow), narrow as it closes, and
   closed through every pause the plan computes. */
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
export function novaTalkShapeAt(burstElapsedMs) {
  const t = Math.max(0, burstElapsedMs || 0) % 440;
  if (t < 110) return "slot";
  if (t < 220) return "narrow";
  if (t < 330) return "wide";
  return "narrow";
}

/* The stress value a speech phase carries: the mouth line
   widens 3 percent at a burst's heart, narrows 2 percent
   as it closes, and rests at its drawn width otherwise. */
function novaMouthStressFor(shape) {
  if (shape === "wide") return 1.03;
  if (shape === "narrow") return 0.98;
  return 1;
}

/* ── Lid positions ──────────────────────────────────────────
   The authority lids are dark shapes clipped to the lens
   circles, drawn parked above the lens (translate minus 46
   on the left, minus 44 on the right) and dropped over it
   to blink. A position here is that translate for the left
   lid; the right rides 2 units higher, as drawn. The lid's
   lower edge sits about 35 units below the lens top at
   translate 0, so coverage of the 60 unit lens runs from
   nothing at minus 46 to full at plus 25. Rest is minus
   17, about 30 percent covered: low, stern, never fully
   open, per the consult. Deadpan drops a further 15
   percent of the lens (9 units) from rest. Sleep is full
   closure. */
export const NOVA_DROP_LID_CLOSED = 25;
export function novaDropLidFor(expression) {
  switch (expression) {
    case "greeting": return -25;
    case "explaining": return -23;
    case "worried": return -23;
    case "thinking": return -11;
    case "pleased": return -19;
    case "deadpan": return -8;
    case "poked": return -11;
    case "fading": return 8;
    case "sleep": return NOVA_DROP_LID_CLOSED;
    default: return -17;
  }
}

/* ── Attention ──────────────────────────────────────────────
   The pointer feed is the contract's joystick, minus 100
   to 100. On the drop it becomes a few units of face
   cluster shift toward the pointer: the mass, lids, wire,
   and mouth move; the body and its light stay. */
export function novaAttentionShift(pointer) {
  if (!pointer) return { x: 0, y: 0 };
  const clamp = (v, m) => Math.max(-m, Math.min(m, v));
  return {
    x: Math.round(clamp(pointer.x * 0.03, 3) * 10) / 10,
    y: Math.round(clamp(pointer.y * 0.02, 2) * 10) / 10,
  };
}

/* ── The authority geometry ─────────────────────────────────
   Transcribed from Claude's SVG. The body path, the six
   filaments (three a side, uneven, never mirrored) with
   their sway values from the file's own animation (a and b
   are the two turn extremes in degrees, dur the wobble
   period in seconds, root the pivot the file rotates each
   filament around), the filament roots under the surface,
   and the lid paths. */
const BODY_PATH = "M 238 108 C 306 110, 362 164, 362 230 C 362 294, 310 356, 244 356 C 180 356, 120 300, 120 238 C 120 172, 172 108, 238 108 Z";
const RIM_ARC_PATH = "M 238 108 C 306 110, 362 164, 362 230 C 362 294, 310 356, 244 356";
const FILAMENTS = [
  { id: "Gill_L1", d: "M 145 157 C 117 137, 96 119, 70 100 C 88 124, 108 146, 139 165 Z", root: [145, 157], a: -1.3, b: 0.7, dur: 7.1 },
  { id: "Gill_R1", d: "M 333 150 C 356 133, 376 120, 398 106 C 380 126, 362 146, 340 163 Z", root: [333, 150], a: 1.5, b: -0.6, dur: 8.3 },
  { id: "Gill_L2", d: "M 121 223 C 98 220, 80 218, 62 215 C 80 222, 100 228, 122 232 Z", root: [121, 227], a: 1.1, b: -1.4, dur: 6.2 },
  { id: "Gill_R2", d: "M 360 220 C 384 219, 404 217, 424 214 C 404 223, 382 229, 360 231 Z", root: [360, 225], a: -1.0, b: 1.2, dur: 5.4 },
  { id: "Gill_L3", d: "M 145 297 C 129 310, 116 324, 102 340 C 112 320, 126 304, 150 304 Z", root: [147, 300], a: 0.9, b: -1.1, dur: 7.8 },
  { id: "Gill_R3", d: "M 335 298 C 350 310, 360 320, 370 332 C 362 314, 352 304, 341 296 Z", root: [337, 300], a: -1.2, b: 0.8, dur: 6.7 },
];
const FILAMENT_ROOTS = [
  { d: "M 142 162 C 158 176, 170 186, 182 194", w: 4 },
  { d: "M 336 155 C 322 170, 312 180, 302 189", w: 3.5 },
  { d: "M 124 227 C 142 230, 154 232, 166 234", w: 3.6 },
  { d: "M 357 226 C 340 228, 328 230, 316 232", w: 3.2 },
  { d: "M 148 300 C 162 290, 172 284, 182 278", w: 3 },
  { d: "M 334 299 C 322 290, 314 285, 306 280", w: 2.8 },
];
const LID_L_PATH = "M 160 170 L 234 170 L 234 212 C 214 221, 180 221, 160 212 Z";
const LID_R_PATH = "M 252 174 L 322 174 L 322 214 C 304 223, 272 223, 252 214 Z";
const GOLD_BAR_PATH = "M 150 212 C 178 214, 262 218, 334 222";
const GOLD_ARC_L = "M 170 203 A 30 30 0 0 1 210 190";
const GOLD_ARC_R = "M 262 207 A 28 28 0 0 1 294 192";
const MOUTH_PATH = "M 228 277 L 254 277.5";

/* Her placement on the seam's 480 by 640 canvas: the
   authority artwork scaled 0.85. Bust mounts anchor her at
   the top, in the head zone the rig's bust crop reads;
   full mounts stand her on her contact shadow, low in the
   box the way the standing figure stood on its line. */
const ART_SCALE = 0.85;
const PLACE = {
  bust: { x: 36, y: 2 },
  full: { x: 36, y: 250 },
};
const MASS_CENTER = { x: 237, y: 241 };

const NOVA_DROP_CSS = `
.nvd-root .nvd-arrive { animation: nvdArrive 400ms ease-out both; transform-box: fill-box; transform-origin: 50% 50%; }
.nvd-root .nvd-gold-in { animation: nvdGoldIn 200ms ease-out 200ms both; }
.nvd-root .nvd-ripple { animation: nvdRipple 900ms ease-out both; }
.nvd-root.nvd-still *, .nvd-root.nvd-still { animation: none !important; transition: none !important; }
@keyframes nvdArrive { from { opacity: 0; transform: scale(0.94); } to { opacity: 1; transform: scale(1); } }
@keyframes nvdGoldIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes nvdRipple { 0% { transform: translateX(-70px); opacity: 0; } 30% { opacity: 0.10; } 100% { transform: translateX(120px); opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .nvd-root *, .nvd-root { animation: none !important; transition: none !important; }
}
`;

/* The resting expression and its neighbours, read off the
   same feeds the contract carried, unchanged from the rig:
   sleep outranks everything, a result outranks a thought,
   and the default, when nothing is being asked of her, is
   the stern face. */
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

/* One filament's sway angle at a moment in its wobble: the
   authority file turns each filament from rest to a, then
   to b, then back to rest over its period. Cosine steps
   keep the turns soft; there is no overshoot in the shape. */
function filamentAngleAt(tickMs, durS, a, b) {
  const period = durS * 1000;
  const f = ((tickMs % period) + period) % period / period;
  const seg = (t0, t1, v0, v1, t) => {
    const u = Math.max(0, Math.min(1, (t - t0) / (t1 - t0)));
    const s = 0.5 - 0.5 * Math.cos(u * Math.PI);
    return v0 + (v1 - v0) * s;
  };
  if (f < 0.35) return seg(0, 0.35, 0, a, f);
  if (f < 0.7) return seg(0.35, 0.7, a, b, f);
  return seg(0.7, 1, b, 0, f);
}

export function NovaFigure(props) {
  const {
    state = null, quizState = 0, appState = 0, sleepStage = 0, scanning = false,
    talking = false, pointer = null, reducedMotion = false, pokeN = 0, celebrateN = 0,
    bust = false,
  } = props;
  /* Optional speech plan feeds, as on the rig: a controller
     object, a plan, or a line of text to plan from. All
     optional; the shipped seam passes none of them and the
     talking flag carries the plan's timing. */
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
  const smallClass = sizeClass === "small";
  const boost = NOVA_IDENTITY_BOOST[sizeClass] || 1;

  /* Poke and celebrate arrive as counters, the contract the
     canvas bound to triggers: a rising count flashes the
     matching expression, then she settles back to whatever
     the feeds say. A poke earns the dipped lid face for
     750ms; a celebration earns the pleased state for
     1600ms, never a bounce. The recoil that accompanies a
     poke lives on the NovaLive wrapper, per the owner's
     ruling: rotation and a lateral shift, no scale. */
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
     only then does the fading face land. The long blink is
     larger and slower in the small class, where a stage
     sized blink would barely register at 66px. */
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
     the table, derived during render the way the rig
     derived it, because a duration set in an effect would
     land one change late. */
  const [exprTrack, setExprTrack] = useState({ expr: expression, ms: 300 });
  let exprMs = exprTrack.ms;
  if (exprTrack.expr !== expression) {
    exprMs = novaExpressionTransitionMs(exprTrack.expr, expression);
    setExprTrack({ expr: expression, ms: exprMs });
  }

  /* ── The blink engine ───────────────────────────────────
     A timeout chain, not a loop with a fixed period: wait a
     randomized 7 to 13 seconds, close in 90ms, hold 40ms,
     reopen in 260ms ease out. Off while she sleeps and
     under reduced motion. */
  const [blinkPhase, setBlinkPhase] = useState("open");
  useEffect(() => {
    if (reducedMotion || expression === "sleep") { setBlinkPhase("open"); return undefined; }
    let cancelled = false;
    const timers = [];
    const later = (fn, ms) => { timers.push(setTimeout(() => { if (!cancelled) fn(); }, ms)); };
    const oneBlink = () => {
      setBlinkPhase("closing");
      later(() => {
        setBlinkPhase("closed");
        later(() => {
          setBlinkPhase("opening");
          later(() => {
            setBlinkPhase("open");
            later(oneBlink, novaBlinkIntervalMs());
          }, NOVA_BLINK_OPEN_MS);
        }, NOVA_BLINK_HOLD_MS);
      }, NOVA_BLINK_CLOSE_MS);
    };
    later(oneBlink, novaBlinkIntervalMs());
    return () => { cancelled = true; timers.forEach((t) => clearTimeout(t)); };
  }, [reducedMotion, expression === "sleep"]);

  /* ── Attention wake and reread ──────────────────────────
     Attention wake: the moment typing starts, her lids rise
     one step, before any line answers. Reread: when
     attention returns to her (the tab or window comes back,
     or the pointer returns to her), her lids narrow one
     step for 2 to 4 seconds, then release. Both were lid
     beats on the rig and are lid beats here. */
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

  /* ── Speech: plan, stress, boundaries ───────────────────
     The plan readers above give the current phase. The
     phase drives the mouth line's stress value, and its
     boundaries (a burst starting) fire the lid nudge and
     the pressure ripple, once per burst. Under reduced
     motion her mouth does not perform at all. */
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
  const speaking = !reducedMotion && (talking || (planShape != null && planShape !== "closed"));
  const shapeNow = speaking ? (planShape != null ? planShape : burstShape) : "closed";
  const mouthStress = speaking ? novaMouthStressFor(shapeNow) : 1;

  const [talkNudge, setTalkNudge] = useState(false);
  const [rippleKey, setRippleKey] = useState(0);
  const prevShapeRef = useRef("closed");
  const nudgeTimerRef = useRef(null);
  useEffect(() => {
    const prev = prevShapeRef.current;
    prevShapeRef.current = shapeNow;
    if (reducedMotion) return undefined;
    if (prev === "closed" && shapeNow !== "closed") {
      setTalkNudge(true);
      setRippleKey((k) => k + 1);
      if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
      nudgeTimerRef.current = setTimeout(() => setTalkNudge(false), 240);
    }
    return undefined;
  }, [shapeNow, reducedMotion]);
  useEffect(() => () => { if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current); }, []);
  const rippleLive = rippleKey > 0 && speaking;

  /* ── The motion clock ───────────────────────────────────
     One 120ms clock drives the idle life, so the parts
     keep their relations: the drift is a 5 second sine,
     the filaments read the same clock 200ms behind it,
     the mass turns on a 22 second cycle, and the filament
     sway eases in and out with its causes (thinking and
     sleep still the filaments; pleased lifts them). The
     phases freeze while she sleeps; the drift settles to
     centre as she goes. Under reduced motion the clock
     never runs and every value sits at rest. */
  const [motion, setMotion] = useState({ driftY: 0, lagY: 0, massAngle: 0, gillAmp: 1, liftDeg: 0, angles: FILAMENTS.map(() => 0), orbit: null });
  const phaseRef = useRef({ drift: 0, mass: 0, tick: 0, gillAmp: 1, lift: 0, driftY: 0 });
  useEffect(() => {
    if (reducedMotion) return undefined;
    let last = Date.now();
    const iv = setInterval(() => {
      const now = Date.now();
      const dt = Math.min(250, now - last);
      last = now;
      const PH = phaseRef.current;
      PH.tick += dt;
      const sleeping = expression === "sleep";
      if (!sleeping) {
        PH.drift += dt;
        PH.mass += dt;
      }
      const driftTarget = sleeping ? 0 : Math.sin((PH.drift / 5000) * Math.PI * 2) * 6;
      PH.driftY += (driftTarget - PH.driftY) * Math.min(1, dt / 300);
      const lagTarget = sleeping ? 0 : Math.sin(((PH.drift - 200) / 5000) * Math.PI * 2) * 6;
      const gillTarget = (sleeping || expression === "thinking") ? 0 : 1;
      PH.gillAmp += (gillTarget - PH.gillAmp) * Math.min(1, dt / 600);
      const liftTarget = expression === "pleased" ? -2.2 : 0;
      PH.lift += (liftTarget - PH.lift) * Math.min(1, dt / 600);
      setMotion({
        driftY: Math.round(PH.driftY * 100) / 100,
        lagY: Math.round(lagTarget * 100) / 100,
        massAngle: Math.round(((PH.mass / 22000) * 360 % 360) * 10) / 10,
        gillAmp: PH.gillAmp,
        liftDeg: Math.round(PH.lift * 100) / 100,
        angles: FILAMENTS.map((f) => Math.round(filamentAngleAt(PH.tick, f.dur, f.a, f.b) * PH.gillAmp * 100) / 100),
        orbit: expression === "thinking"
          ? {
              x: Math.round((MASS_CENTER.x + 20 * Math.cos((PH.tick / 2000) * Math.PI * 2)) * 10) / 10,
              y: Math.round((MASS_CENTER.y + 13 * Math.sin((PH.tick / 2000) * Math.PI * 2)) * 10) / 10,
            }
          : null,
      });
    }, 120);
    return () => clearInterval(iv);
  }, [reducedMotion, expression]);
  /* The filament layer reads the drift 200ms behind the
     body: the same sine at the lagged phase, carried in
     the clock's state as lagY, applied as the layer's own
     offset from the body's driftY. */

  /* ── Lid composition ────────────────────────────────────
     The outer group carries the expression's position (plus
     the wake, reread, and talking nudges while she is
     awake); the inner group carries the blink's closure,
     travelling from wherever the lids sit to full closure.
     The right lid rides 2 units higher throughout, as
     drawn in the authority file. */
  let lidBase = novaDropLidFor(expression);
  if (awake && expression !== "poked") {
    if (attentionWake) lidBase -= 4;
    if (reread) lidBase += 4;
    if (talkNudge) lidBase -= 2;
  }
  lidBase = Math.max(-30, Math.min(NOVA_DROP_LID_CLOSED, lidBase));
  const blinkClosed = longBlink ? longBlink.phase !== "opening" : (blinkPhase === "closing" || blinkPhase === "closed");
  const blinkDelta = blinkClosed ? NOVA_DROP_LID_CLOSED - lidBase : 0;
  const blinkMs = longBlink
    ? (longBlink.phase === "opening" ? longBlink.openMs : longBlink.closeMs)
    : blinkPhase === "opening" ? NOVA_BLINK_OPEN_MS : blinkPhase === "closing" ? NOVA_BLINK_CLOSE_MS : NOVA_BLINK_CLOSE_MS;
  const blinkEase = (longBlink && longBlink.phase === "opening") || blinkPhase === "opening" ? "ease-out" : "ease";
  const lidGroup = (clipId, path, dy) => (
    <g clipPath={`url(#${clipId})`}>
      <g style={{ transform: `translateY(${lidBase + dy}px)`, transition: `transform ${exprMs}ms ease` }}>
        <g style={{ transform: `translateY(${blinkDelta}px)`, transition: `transform ${blinkMs}ms ${blinkEase}` }}>
          <path d={path} fill={T.lid} />
        </g>
      </g>
    </g>
  );

  /* Attention and the unimpressed drift. The face cluster
     shifts toward the pointer over 250ms; the filaments
     follow the same shift at 40 percent over 450ms, so
     they trail and settle. Deadpan adds her drift away:
     a few canvas units opposite the pointer's side, on
     the placement itself. */
  const att = novaAttentionShift(pointer);
  const awayShift = expression === "deadpan" ? (pointer && pointer.x > 0 ? -5 : 5) : 0;
  const place = bust ? PLACE.bust : PLACE.full;
  const shadowCx = place.x + 246 * ART_SCALE;
  const shadowCy = place.y + 371 * ART_SCALE;
  const specularScale = (smallClass ? 1.15 : 1) * (expression === "pleased" ? 1.15 : 1);

  const stops = (list) => list.map((s, i) => <stop key={i} offset={s[0]} stopColor={s[1]} />);

  return (
    <span ref={wrapRef} style={{ display: "block", width: "100%", height: "100%" }}
      onPointerEnter={() => {
        setReread(true);
        if (rereadTimerRef.current) clearTimeout(rereadTimerRef.current);
        rereadTimerRef.current = setTimeout(() => setReread(false), 2000 + Math.random() * 2000);
      }}>
      <style>{NOVA_DROP_CSS}</style>
      <svg
        className={"nvd-root" + (reducedMotion ? " nvd-still" : "")}
        data-nova-figure="drop"
        data-expression={expression}
        data-talking={talking ? "true" : "false"}
        data-size-class={sizeClass}
        data-mouth={speaking ? "talk" : "flat"}
        data-blink={longBlink ? "long-" + longBlink.phase : blinkPhase}
        data-attention={pointer ? "on" : "off"}
        viewBox="0 0 480 640"
        preserveAspectRatio={bust ? "xMidYMin meet" : "xMidYMax meet"}
        width="100%"
        height="100%"
        style={{ display: "block" }}
        aria-hidden="true"
      >
        <defs>
          <radialGradient id="nvdPoolRefracted" cx={T.poolRefracted.cx} cy={T.poolRefracted.cy} r={T.poolRefracted.r}>
            {stops(T.poolRefracted.stops)}
          </radialGradient>
          <radialGradient id="nvdWater" cx={T.water.cx} cy={T.water.cy} r={T.water.r}>
            {stops(T.water.stops)}
          </radialGradient>
          <radialGradient id="nvdGill" gradientUnits="userSpaceOnUse" cx={T.gill.cx} cy={T.gill.cy} r={T.gill.r}>
            {stops(T.gill.stops)}
          </radialGradient>
          <filter id="nvdSoftMass" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="10" />
          </filter>
          <filter id="nvdSoftMassTight" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
          <filter id="nvdSoftLens" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3.2" />
          </filter>
          <filter id="nvdSoftShadow" x="-60%" y="-120%" width="220%" height="340%">
            <feGaussianBlur stdDeviation="13" />
          </filter>
          <filter id="nvdSoftRoot" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="2.4" />
          </filter>
          <filter id="nvdEdgeSoft" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="0.5" />
          </filter>
          <path id="nvdBodyPath" d={BODY_PATH} />
          <clipPath id="nvdBodyClip"><use href="#nvdBodyPath" /></clipPath>
          <clipPath id="nvdLensL"><circle cx="196" cy="216" r="30" /></clipPath>
          <clipPath id="nvdLensR"><circle cx="285" cy="219" r="28" /></clipPath>
        </defs>

        {/* The contact shadow sits on the mount's own ground,
            outside the placed artwork: she drifts, it stays. */}
        <ellipse cx={shadowCx} cy={shadowCy} rx={99 * ART_SCALE} ry={15 * ART_SCALE} fill="#000000" opacity="0.82" filter="url(#nvdSoftShadow)" />
        <ellipse cx={place.x + 244 * ART_SCALE} cy={place.y + 366 * ART_SCALE} rx={54 * ART_SCALE} ry={8 * ART_SCALE} fill="#000000" opacity="0.6" filter="url(#nvdSoftShadow)" />

        <g style={{
          transform: `translate(${place.x + awayShift}px, ${place.y}px) scale(${ART_SCALE})`,
          transformBox: "view-box",
          transition: "transform 300ms ease",
        }}>
          <g className="nvd-arrive">
            <g style={{ transform: `translateY(${motion.driftY}px)` }}>
              {/* Filaments: behind the body, swaying on their
                  own periods, lifted as a layer when she is
                  pleased, and following the face's attention
                  shift at 40 percent over a slower transition
                  so they trail it and settle. */}
              <g style={{
                transform: `rotate(${motion.liftDeg}deg)`,
                transformOrigin: `${place.x + 240 * ART_SCALE}px ${place.y + 300 * ART_SCALE}px`,
                transformBox: "view-box",
                transition: "transform 600ms ease",
              }}>
                <g style={{
                  transform: `translate(${Math.round(att.x * 0.4 * 10) / 10}px, ${Math.round((att.y * 0.4 + (motion.lagY - motion.driftY)) * 10) / 10}px)`,
                  transition: "transform 450ms ease",
                }}>
                  <g fill="url(#nvdGill)">
                    {FILAMENTS.map((f, i) => (
                      <path key={f.id} id={f.id} d={f.d}
                        stroke={smallClass ? "#8d8069" : "none"} strokeWidth={smallClass ? 1 : 0}
                        transform={`rotate(${motion.angles[i]} ${f.root[0]} ${f.root[1]})`} />
                    ))}
                  </g>
                </g>
              </g>

              {/* The water body and everything inside its clip. */}
              <use href="#nvdBodyPath" fill="url(#nvdWater)" />
              <g clipPath="url(#nvdBodyClip)">
                <rect x="110" y="98" width="262" height="268" fill="url(#nvdPoolRefracted)" opacity="0.85" />
                <g stroke={T.root} fill="none" strokeLinecap="round" opacity="0.3" filter="url(#nvdSoftRoot)">
                  {FILAMENT_ROOTS.map((r, i) => (
                    <path key={i} d={r.d} strokeWidth={r.w} />
                  ))}
                </g>

                {/* The face cluster: mass, lids, wire, mouth.
                    It shifts toward the pointer; the body and
                    its light do not. */}
                <g style={{ transform: `translate(${att.x}px, ${att.y}px)`, transition: "transform 250ms ease" }}>
                  <g transform={`rotate(${motion.massAngle} ${MASS_CENTER.x} ${MASS_CENTER.y})`}>
                    <ellipse cx="237" cy="241" rx="64" ry="50" fill={T.mass} opacity="0.4" filter="url(#nvdSoftMass)" />
                    <ellipse cx="233" cy="236" rx="35" ry="27" fill={T.massCore} opacity="0.3" filter="url(#nvdSoftMassTight)" />
                    <ellipse cx="252" cy="258" rx="22" ry="16" fill={T.massLobe} opacity="0.2" filter="url(#nvdSoftMassTight)" />
                  </g>
                  <g clipPath="url(#nvdLensL)">
                    <ellipse cx="197" cy="221" rx="26" ry="22" fill={T.lensMass} opacity="0.4" filter="url(#nvdSoftLens)" />
                  </g>
                  <g clipPath="url(#nvdLensR)">
                    <ellipse cx="284" cy="223" rx="24" ry="21" fill={T.lensMassRight} opacity="0.36" filter="url(#nvdSoftLens)" />
                  </g>
                  {lidGroup("nvdLensL", LID_L_PATH, 0)}
                  {lidGroup("nvdLensR", LID_R_PATH, 2)}
                  {/* The mouth: one flat line. Its width is the
                      only thing speech moves. */}
                  <g style={{
                    transform: `scaleX(${mouthStress})`,
                    transformBox: "fill-box",
                    transformOrigin: "50% 50%",
                    transition: "transform 90ms ease",
                  }}>
                    <path d={MOUTH_PATH} stroke={T.mouth} strokeWidth={2 * boost} opacity="0.3" strokeLinecap="butt" fill="none" />
                  </g>
                  {/* The gold: one continuous drawn line, crisp
                      on the front surface, last to arrive. */}
                  <g className="nvd-gold-in" fill="none" stroke={T.gold} strokeLinecap="round">
                    <path d={GOLD_BAR_PATH} strokeWidth={2.7 * boost} />
                    <circle cx="196" cy="216" r="30" strokeWidth={3.2 * boost} />
                    <circle cx="285" cy="219" r="28" strokeWidth={3 * boost} />
                  </g>
                  <g className="nvd-gold-in" fill="none" stroke={T.goldBright} strokeLinecap="round" opacity="0.55">
                    <path d={GOLD_ARC_L} strokeWidth={2.6 * boost} />
                    <path d={GOLD_ARC_R} strokeWidth={2.3 * boost} />
                  </g>
                </g>

                <ellipse cx="300" cy="306" rx="78" ry="58" fill={T.sheen} opacity="0.26" filter="url(#nvdSoftMass)" />
                {motion.orbit && (
                  <circle cx={motion.orbit.x} cy={motion.orbit.y} r="3.2" fill={T.massCore} opacity="0.55" />
                )}
                {rippleLive && (
                  <ellipse key={rippleKey} className="nvd-ripple" cx="175" cy="235" rx="26" ry="95" fill={T.massCore} opacity="0" />
                )}
              </g>
              <use href="#nvdBodyPath" fill="none" stroke={T.meniscus} strokeWidth="2.4" opacity="0.75" />
              <g clipPath="url(#nvdBodyClip)">
                <path d={RIM_ARC_PATH} fill="none" stroke={T.rimArc} strokeWidth="2.2" opacity="0.5" />
              </g>
              {/* The single hard specular, and its satellite.
                  Pleased brightens it over 600ms. */}
              <g style={{
                transform: `scale(${specularScale})`,
                transformBox: "fill-box",
                transformOrigin: "50% 50%",
                opacity: expression === "pleased" ? 1 : 0.85,
                transition: "transform 600ms ease, opacity 600ms ease",
              }}>
                <ellipse cx="183" cy="150" rx="13.5" ry="7" transform="rotate(-34 183 150)" fill={T.specular} opacity="0.92" filter="url(#nvdEdgeSoft)" />
                <ellipse cx="200" cy="140" rx="3.4" ry="2" transform="rotate(-30 200 140)" fill={T.specular} opacity="0.5" filter="url(#nvdEdgeSoft)" />
              </g>
            </g>
          </g>
        </g>
      </svg>
    </span>
  );
}

export default NovaFigure;
