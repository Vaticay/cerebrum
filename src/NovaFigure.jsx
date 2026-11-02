/* ── Nova's figure: the restored axolotl (2026-11-02) ───────
   The owner's order of 2026-11-02 retired the drop and
   restored her old original loved version: the revision 3
   axolotl in her coat, the model sheet still carried in the
   repo, recolored to the register and approved by him as a
   still before this build (~/workspace/nova-final-still-v2-nov02/:
   skin #CC7A75, blush #D98A90, coat #BCAFA6, gills #B06068,
   gold #C89A3A, ink #2A1A12). The artwork constants below are
   that approved file's own groups, transcribed path for path;
   the one promotion he approved in the same still is the
   glasses treatment, restroked into the artwork here: an ink
   outline on both sides of each ring, the base gold as the
   underside, and the bright gold REGISTER_GOLD_BRIGHT as the
   lit rim. She renders behind the same seam the drop used:
   NovaRive.jsx's NovaCanvas feeds the behavior state name,
   quizState and appState, the sleep stage, the scanning flag,
   the speech controller's talking flag, the pointer, the
   reduced motion flag, and the poke and celebrate counters.

   ── Life on the real artwork (the owner's order: her
   animations need to feel more alive) ─────────────────────
   Everything is transforms and lid geometry on this one
   drawing. There is no mouth performance of any kind: her
   mouth is the drawn line and it never moves (her owner
   called the old plate mouth talking animation horrendous;
   speech reads through her lids, her eyes, her head, and
   her gills, never through mouth swaps).
   - Breathing: a slow 5.2 second cycle, a sub percent
     vertical stretch around her feet with a two unit rise,
     so she is alive at rest without swaying like a sticker.
   - Blink: lids close in 90ms, hold 40ms, reopen in 280ms.
     The slow reopen is her personality, kept from before.
     Interval randomized between 7 and 13 seconds.
   - Gills: each of the six filaments sways on its own
     detuned period around its drawn pivot, uneven the way
     the sheet drew them uneven. Thinking stills them to a
     third; sleep stills them entirely.
   - Glances: her eyes shift, with the glasses and a whisper
     of head following, hold, and come back. The picker never
     serves the same glance target twice in a row. Attention
     from the pointer overrides a glance while it lasts.
   - Speaking: while the speech controller's talking flag is
     up, her head tilts and settles into a gentle rhythmic
     nod priced by the tick, and her lids lower a touch and
     pulse with the rhythm. No nod at all under reduced
     motion, and no nod ever moves her mouth.
   - Expressions are lid coverage and eye position only, on
     the same drawing: deadpan drops the lids past halfway,
     greeting lifts them, thinking drops them and locks her
     glance to one side, worried lifts them and raises the
     eyes, pleased softens them, poked slams them for the
     flash, sleep closes them whole.
   - Poke: a recoil, rotation and a lateral step back over
     the flash, never a scale pop, per the owner's ruling.
   - Reduced motion, by prop or by the system setting,
     stills every cycle above except the blink: the clock
     never runs, no glance fires, no nod, no sway, and the
     composed figure simply changes lid state.

   Size law: the figure measures its visible height. Above
   200 she stands full figure. From 120 to 200 the framing
   crops to head and shoulders on the same canvas. Below 120
   NovaCanvas already routes to the approved glyph; the one
   mount that still reaches this component small, the flow
   mount, gets the crop framing too. The recut head glyph
   from this artwork is a separate art approval and is NOT
   snuck in here: the existing glyph stands until then. */

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { REGISTER_GOLD, REGISTER_GOLD_BRIGHT } from "./registerTokens.js";

/* ── Size buckets and framing ───────────────────────────────
   The figure measures its own visible rendered height and
   classes itself, as it always has: under 90 small, 90 to
   200 medium, above 200 stage. The alive wave adds the
   framing law the audit set: full figure above 200, a head
   and shoulders crop at 200 and below. */
export function novaSizeClassFor(heightPx) {
  if (typeof heightPx !== "number" || !Number.isFinite(heightPx) || heightPx <= 0) {
    return { name: "stage", multiplier: 1, heightPx: 0 };
  }
  if (heightPx < 90) return { name: "small", multiplier: 3, heightPx };
  if (heightPx <= 200) return { name: "medium", multiplier: 1.8, heightPx };
  return { name: "stage", multiplier: 1, heightPx };
}
export function novaFigureModeFor(heightPx, bust = false) {
  if (bust) return "crop";
  if (typeof heightPx === "number" && Number.isFinite(heightPx) && heightPx > 0 && heightPx <= 200) return "crop";
  return "full";
}

/* ── The randomized blink ───────────────────────────────────
   Interval randomized between 7 and 13 seconds; rand is a 0
   to 1 draw, injected so the distribution is testable.
   Close 90ms, hold 40ms, reopen 280ms: the reopen outlasts
   the close on purpose. */
export function novaBlinkIntervalMs(rand = Math.random()) {
  const u = Math.max(0, Math.min(1, rand));
  return Math.round(7000 + u * 6000);
}
export const NOVA_BLINK_CLOSE_MS = 90;
export const NOVA_BLINK_HOLD_MS = 40;
export const NOVA_BLINK_OPEN_MS = 280;

/* ── Expression transitions ─────────────────────────────────
   Ordinary 300ms, verdict faces (deadpan, pleased, worried)
   120ms in, drift toward sleep 1000ms, greeting softening
   260ms. On this figure they price the lid and eye moves. */
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

/* ── Lid coverage per expression ────────────────────────────
   Her expressions are lid geometry: the share of each eye
   the lid covers at rest for that face. Sleep is whole. The
   blink adds its own coverage on top of whatever the face
   holds, and speaking lowers the lids a further touch. */
export function novaLidCoverageFor(expression) {
  switch (expression) {
    case "greeting": return 0.14;
    case "explaining": return 0.22;
    case "worried": return 0.18;
    case "thinking": return 0.46;
    case "pleased": return 0.26;
    case "deadpan": return 0.52;
    case "poked": return 0.62;
    case "fading": return 0.8;
    case "sleep": return 1;
    default: return 0.34;
  }
}

/* Eye offset per expression: where her eyes sit inside the
   glasses before any glance or pointer is added. Worried
   raises them, thinking locks them to one side, pleased
   settles them a unit lower. Units are artwork units. */
export function novaEyeOffsetFor(expression) {
  switch (expression) {
    case "worried": return { x: 0, y: -3 };
    case "thinking": return { x: 6, y: 0 };
    case "pleased": return { x: 0, y: 1 };
    case "deadpan": return { x: 0, y: 1 };
    default: return { x: 0, y: 0 };
  }
}

/* ── Attention ──────────────────────────────────────────────
   The pointer feed is the contract's joystick, minus 100
   to 100. On this figure it becomes her eye shift in
   artwork units, with the head following at a fraction. */
export function novaAttentionShift(pointer) {
  if (!pointer) return { x: 0, y: 0 };
  const clamp = (v, m) => Math.max(-m, Math.min(m, v));
  return {
    x: Math.round(clamp(pointer.x * 0.07, 7) * 10) / 10,
    y: Math.round(clamp(pointer.y * 0.04, 4) * 10) / 10,
  };
}

/* ── Glances ────────────────────────────────────────────────
   The targets her eyes visit while nothing else owns them,
   in artwork units, and the picker over them: seeded for
   tests, and it never serves the same target twice in a
   row, so a glance is a visit, not a loop. */
export const NOVA_GLANCE_TARGETS = [
  { x: 0, y: 0 },
  { x: 7, y: 1 },
  { x: -7, y: 1 },
  { x: 5, y: -3 },
  { x: -5, y: -3 },
  { x: 0, y: 4 },
];
export function novaGlancePick(seed = 0, avoidIndex = -1) {
  const n = NOVA_GLANCE_TARGETS.length;
  let i = Math.abs(Math.floor(seed || 0)) % n;
  if (i === avoidIndex && n > 1) i = (i + 1) % n;
  return i;
}

/* One filament's sway angle at a moment in its wobble: the
   filament turns from rest to a, then to b, then back to
   rest over its period. Cosine steps keep the turns soft;
   there is no overshoot in the shape. */
export function filamentAngleAt(tickMs, durS, a, b) {
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

/* The resting expression and its neighbours, read off the
   same feeds the contract has always carried: sleep
   outranks everything, a result outranks a thought, and
   the default, when nothing is being asked of her, is the
   stern face. */
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

const NOVA_FIGURE_CSS = `
.nva-root .nva-arrive { animation: nvaArrive 400ms ease-out both; transform-box: fill-box; transform-origin: 50% 50%; }
@keyframes nvaArrive { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
.nva-root.nva-still .nva-arrive { animation: none !important; }
.nva-root.nva-still .nva-nolid { transition: none !important; }
@media (prefers-reduced-motion: reduce) {
  .nva-root .nva-arrive { animation: none !important; }
  .nva-root .nva-nolid { transition: none !important; }
}
`;

/* Her colors, the approved still's values, named once. The
   golds ride the shared register tokens, as the seam has
   always required; the rest are the artwork's own. */
const INK = "#2A1A12";
const SKIN = "#CC7A75";
const GOLD = REGISTER_GOLD;
const GOLD_BRIGHT = REGISTER_GOLD_BRIGHT;

const ART_TAIL = "<g id=\"Tail\" data-pivot=\"650,730\">\n    <path d=\"M 636 668 C 748 692, 828 766, 888 848 C 900 868, 892 884, 872 882 C 792 876, 714 830, 656 776 C 638 742, 630 702, 636 668 Z\" fill=\"#CC7A75\" stroke=\"#2A1A12\" stroke-width=\"10\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/>\n    <path d=\"M 664 710 C 736 754, 798 806, 840 850\" fill=\"none\" stroke=\"#2A1A12\" stroke-width=\"4\" stroke-linecap=\"round\"/>\n  </g>";
const ART_GILLS = [
  { id: "Gill_L1", pivot: [300, 330], dur: 7.1, a: -1.6, b: 1.0, html: "<g id=\"Gill_L1\" data-pivot=\"300,330\">\n    <path d=\"M 300 330 C 328.8 269.6, 324.7 214.1, 298.8 152.3 C 291.1 111.6, 270.8 113.4, 270.3 154.8 C 255.6 220.2, 261.1 275.5, 300 330 Z\" fill=\"#B06068\" stroke=\"#2A1A12\" stroke-width=\"10\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/>\n  </g>" },
  { id: "Gill_L2", pivot: [300, 330], dur: 6.2, a: 1.3, b: -1.8, html: "<g id=\"Gill_L2\" data-pivot=\"300,330\">\n    <path d=\"M 300 330 C 298.1 258.7, 268.4 206, 216 156 C 190.1 119.3, 172.4 129.5, 191.3 170.3 C 208.4 240.6, 239.2 292.7, 300 330 Z\" fill=\"#B06068\" stroke=\"#2A1A12\" stroke-width=\"10\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/>\n  </g>" },
  { id: "Gill_L3", pivot: [300, 330], dur: 7.8, a: 1.0, b: -1.2, html: "<g id=\"Gill_L3\" data-pivot=\"300,330\">\n    <path d=\"M 300 330 C 264.1 270, 213.5 240, 144.8 223.9 C 105 205.6, 94.8 223.3, 130.5 248.6 C 178.8 300.1, 230.1 328.9, 300 330 Z\" fill=\"#B06068\" stroke=\"#2A1A12\" stroke-width=\"10\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/>\n  </g>" },
  { id: "Gill_R1", pivot: [724, 330], dur: 8.3, a: 1.8, b: -0.9, html: "<g id=\"Gill_R1\" data-pivot=\"724,330\">\n    <path d=\"M 724 330 C 762.9 275.5, 768.4 220.2, 753.7 154.8 C 753.2 113.4, 732.9 111.6, 725.2 152.3 C 699.3 214.1, 695.2 269.6, 724 330 Z\" fill=\"#B06068\" stroke=\"#2A1A12\" stroke-width=\"10\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/>\n  </g>" },
  { id: "Gill_R2", pivot: [724, 330], dur: 5.4, a: -1.2, b: 1.5, html: "<g id=\"Gill_R2\" data-pivot=\"724,330\">\n    <path d=\"M 724 330 C 784.8 292.7, 815.6 240.6, 832.7 170.3 C 851.6 129.5, 833.9 119.3, 808 156 C 755.6 206, 725.9 258.7, 724 330 Z\" fill=\"#B06068\" stroke=\"#2A1A12\" stroke-width=\"10\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/>\n  </g>" },
  { id: "Gill_R3", pivot: [724, 330], dur: 6.7, a: -1.5, b: 1.1, html: "<g id=\"Gill_R3\" data-pivot=\"724,330\">\n    <path d=\"M 724 330 C 793.9 328.9, 845.2 300.1, 893.5 248.6 C 929.2 223.3, 919 205.6, 879.2 223.9 C 810.5 240, 759.9 270, 724 330 Z\" fill=\"#B06068\" stroke=\"#2A1A12\" stroke-width=\"10\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/>\n  </g>" },
];
const ART_BODY = "<g id=\"Body\" data-pivot=\"512,860\">\n    <path d=\"M 672 470 C 674 490, 670 510, 672 544 C 678 644, 682 742, 676 820 C 674 840, 658 856, 636 864 C 626 868, 622 874, 624 884 C 626 896, 612 902, 590 902 C 568 902, 552 897, 547 886 C 543 876, 544 865, 533 859 C 524 854, 500 854, 491 859 C 480 865, 481 876, 477 886 C 472 897, 456 902, 434 902 C 412 902, 398 896, 400 884 C 402 874, 398 868, 388 864 C 366 856, 350 840, 350 820 C 352 760, 354 690, 354 640 C 352 560, 354 508, 352 470 C 420 450, 604 450, 672 470 Z\" fill=\"#CC7A75\" stroke=\"#2A1A12\" stroke-width=\"10\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/>\n    <path d=\"M 426 876 L 426 899\" fill=\"none\" stroke=\"#2A1A12\" stroke-width=\"4\" stroke-linecap=\"round\"/>\n    <path d=\"M 452 878 L 452 900\" fill=\"none\" stroke=\"#2A1A12\" stroke-width=\"4\" stroke-linecap=\"round\"/>\n    <path d=\"M 572 878 L 572 900\" fill=\"none\" stroke=\"#2A1A12\" stroke-width=\"4\" stroke-linecap=\"round\"/>\n    <path d=\"M 598 876 L 598 899\" fill=\"none\" stroke=\"#2A1A12\" stroke-width=\"4\" stroke-linecap=\"round\"/>\n  </g><g id=\"Coat\" data-pivot=\"512,650\">\n    <path d=\"M 356 470 C 340 560, 336 660, 342 758 C 344 796, 350 818, 362 824 C 450 848, 580 848, 668 824 C 680 818, 686 796, 688 758 C 694 660, 690 560, 674 470 C 620 446, 566 438, 515 438 C 464 438, 410 446, 356 470 Z\" fill=\"#BCAFA6\" stroke=\"#2A1A12\" stroke-width=\"10\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/>\n    <g id=\"Collar\">\n      <path d=\"M 370 462 L 512 468 L 492 538 L 366 500 Z\" fill=\"#BCAFA6\" stroke=\"#2A1A12\" stroke-width=\"4\" stroke-linejoin=\"round\"/>\n      <path d=\"M 654 462 L 512 468 L 532 538 L 658 500 Z\" fill=\"#BCAFA6\" stroke=\"#2A1A12\" stroke-width=\"4\" stroke-linejoin=\"round\"/>\n    </g>\n    <g id=\"Placket\">\n      <path d=\"M 490 538 L 490 838\" fill=\"none\" stroke=\"#2A1A12\" stroke-width=\"4\" stroke-linecap=\"round\"/>\n      <path d=\"M 532 538 L 532 838\" fill=\"none\" stroke=\"#2A1A12\" stroke-width=\"4\" stroke-linecap=\"round\"/>\n      <circle cx=\"511\" cy=\"596\" r=\"9\" fill=\"#2A1A12\"/>\n      <circle cx=\"511\" cy=\"668\" r=\"9\" fill=\"#2A1A12\"/>\n      <circle cx=\"511\" cy=\"740\" r=\"9\" fill=\"#2A1A12\"/>\n      <circle cx=\"511\" cy=\"806\" r=\"9\" fill=\"#2A1A12\"/>\n    </g>\n    <g id=\"Pocket_L\">\n      <path d=\"M 386 592 L 468 592 L 468 652 C 468 662, 460 668, 450 668 L 404 668 C 394 668, 386 662, 386 652 Z\" fill=\"#BCAFA6\" stroke=\"#2A1A12\" stroke-width=\"4\" stroke-linejoin=\"round\"/>\n      <g fill=\"none\" stroke=\"#C89A3A\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\" transform=\"translate(431 630) scale(1.3) translate(-12 -12)\">\n        <path d=\"M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1 0-4.12A2.5 2.5 0 0 1 7.5 11a2.5 2.5 0 0 1 0-4.12A2.5 2.5 0 0 1 9.5 2Z\"/>\n        <path d=\"M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 0-4.12A2.5 2.5 0 0 0 16.5 11a2.5 2.5 0 0 0 0-4.12A2.5 2.5 0 0 0 14.5 2Z\"/>\n      </g>\n    </g>\n    <g id=\"Pocket_R\">\n      <path d=\"M 556 592 L 638 592 L 638 652 C 638 662, 630 668, 620 668 L 574 668 C 564 668, 556 662, 556 652 Z\" fill=\"#BCAFA6\" stroke=\"#2A1A12\" stroke-width=\"4\" stroke-linejoin=\"round\"/>\n    </g>\n  </g><g id=\"Arm_R\" data-pivot=\"652,530\">\n    <path d=\"M 672 518 C 700 572, 730 640, 750 697 L 702 715 C 690 650, 668 590, 648 534 Z\" fill=\"#BCAFA6\" stroke=\"#2A1A12\" stroke-width=\"10\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/>\n    <path d=\"M 694 692 L 742 674\" fill=\"none\" stroke=\"#2A1A12\" stroke-width=\"4\" stroke-linecap=\"round\"/>\n    <g id=\"Hand_R\" data-pivot=\"726,712\">\n      <path d=\"M 760 712 C 770 730, 772 756, 766 774 C 762 788, 750 790, 746 780 C 742 792, 730 792, 728 780 C 725 792, 713 792, 711 779 C 708 790, 696 786, 693 772 C 686 754, 686 728, 694 712 Z\" fill=\"#CC7A75\" stroke=\"#2A1A12\" stroke-width=\"10\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/>\n      <ellipse cx=\"686\" cy=\"746\" rx=\"13\" ry=\"23\" fill=\"#CC7A75\" stroke=\"#2A1A12\" stroke-width=\"10\" transform=\"rotate(-32 686 746)\"/>\n    </g>\n  </g><g id=\"Arm_L\" data-pivot=\"364,532\">\n    <path d=\"M 387 510 C 352 478, 312 442, 276 406 L 240 442 C 276 478, 310 514, 341 554 Z\" fill=\"#BCAFA6\" stroke=\"#2A1A12\" stroke-width=\"10\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/>\n    <path d=\"M 293 423 L 257 459\" fill=\"none\" stroke=\"#2A1A12\" stroke-width=\"4\" stroke-linecap=\"round\"/>\n\n    <g id=\"Keycard\" data-pivot=\"205,440\" transform=\"rotate(-6 205 585)\">\n      <path d=\"M 194 419 L 216 419 C 219 419, 221 421, 221 424 L 221 447 L 189 447 L 189 424 C 189 421, 191 419, 194 419 Z\" fill=\"#EDE8DE\" stroke=\"#2A1A12\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n      <rect x=\"125\" y=\"435\" width=\"160\" height=\"300\" rx=\"12\" fill=\"#EDE8DE\" stroke=\"#2A1A12\" stroke-width=\"10\"/>\n      <rect x=\"139\" y=\"506\" width=\"132\" height=\"36\" fill=\"#2A1A12\"/>\n      <text x=\"205\" y=\"533\" font-family=\"Helvetica Neue, Helvetica, Arial, sans-serif\" font-size=\"19\" font-weight=\"700\" letter-spacing=\"2.2\" text-anchor=\"middle\" fill=\"#EDE8DE\">CEREBRUM</text>\n      <rect x=\"139\" y=\"552\" width=\"78\" height=\"84\" fill=\"#26231F\" stroke=\"#2A1A12\" stroke-width=\"4\"/>\n      <g id=\"Badge_Photo\">\n        <path d=\"M 161 588 L 143 574 L 145 586 Z\" fill=\"#CC7A75\" stroke=\"#2A1A12\" stroke-width=\"3\" stroke-linejoin=\"round\"/>\n        <path d=\"M 160 597 L 141 593 L 149 602 Z\" fill=\"#CC7A75\" stroke=\"#2A1A12\" stroke-width=\"3\" stroke-linejoin=\"round\"/>\n        <path d=\"M 195 588 L 213 574 L 211 586 Z\" fill=\"#CC7A75\" stroke=\"#2A1A12\" stroke-width=\"3\" stroke-linejoin=\"round\"/>\n        <path d=\"M 196 597 L 215 593 L 207 602 Z\" fill=\"#CC7A75\" stroke=\"#2A1A12\" stroke-width=\"3\" stroke-linejoin=\"round\"/>\n        <ellipse cx=\"178\" cy=\"594\" rx=\"18\" ry=\"16\" fill=\"#CC7A75\" stroke=\"#2A1A12\" stroke-width=\"3\"/>\n        <path d=\"M 172 603 Q 178 607 184 603\" fill=\"none\" stroke=\"#2A1A12\" stroke-width=\"2.4\" stroke-linecap=\"round\"/>\n        <circle cx=\"171\" cy=\"590\" r=\"3.6\" fill=\"#2A1A12\"/>\n        <circle cx=\"185\" cy=\"590\" r=\"3.6\" fill=\"#2A1A12\"/>\n      </g>\n      <text x=\"225\" y=\"572\" font-family=\"Helvetica Neue, Helvetica, Arial, sans-serif\" font-size=\"11\" font-weight=\"700\" fill=\"#2A1A12\">ID 0001</text>\n      <text x=\"225\" y=\"594\" font-family=\"Helvetica Neue, Helvetica, Arial, sans-serif\" font-size=\"8\" letter-spacing=\"0.2\" fill=\"#2A1A12\">CLEARANCE</text>\n      <text x=\"225\" y=\"610\" font-family=\"Helvetica Neue, Helvetica, Arial, sans-serif\" font-size=\"12\" font-weight=\"700\" fill=\"#2A1A12\">LEVEL 3</text>\n      <rect x=\"225\" y=\"618\" width=\"28\" height=\"18\" rx=\"3\" fill=\"none\" stroke=\"#C89A3A\" stroke-width=\"3\"/>\n      <path d=\"M 225 627 L 253 627 M 239 618 L 239 636\" fill=\"none\" stroke=\"#C89A3A\" stroke-width=\"2.4\"/>\n      <path d=\"M 139 650 L 271 650\" fill=\"none\" stroke=\"#2A1A12\" stroke-width=\"4\" stroke-linecap=\"round\"/>\n      <text x=\"139\" y=\"683\" font-family=\"Helvetica Neue, Helvetica, Arial, sans-serif\" font-size=\"25\" font-weight=\"700\" letter-spacing=\"0.5\" fill=\"#2A1A12\">NOVA</text>\n      <text x=\"140\" y=\"700\" font-family=\"Helvetica Neue, Helvetica, Arial, sans-serif\" font-size=\"9.5\" letter-spacing=\"0.6\" fill=\"#2A1A12\">RESEARCH ASSISTANT</text>\n      <path d=\"M 141 715 L 243 715\" fill=\"none\" stroke=\"#2A1A12\" stroke-width=\"14\" stroke-linecap=\"butt\" stroke-dasharray=\"4 3 2 3 6 2 2 4 3 2 5 3 2 2 4 3 3 2 5 2\"/>\n      <text x=\"251\" y=\"720\" font-family=\"Helvetica Neue, Helvetica, Arial, sans-serif\" font-size=\"8\" fill=\"#2A1A12\">0001</text>\n    </g>\n\n    <g id=\"Hand_L\" data-pivot=\"258,424\">\n      <path d=\"M 228 394 C 262 384, 294 398, 302 426 C 308 446, 298 464, 274 468 C 246 473, 218 459, 212 436 C 206 414, 212 396, 228 394 Z\" fill=\"#CC7A75\" stroke=\"#2A1A12\" stroke-width=\"10\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/>\n      <path d=\"M 216 456 C 208 474, 210 488, 222 490 C 233 492, 237 478, 234 460 Z\" fill=\"#CC7A75\" stroke=\"#2A1A12\" stroke-width=\"10\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/>\n      <path d=\"M 237 460 C 231 480, 234 494, 246 496 C 257 498, 260 482, 255 462 Z\" fill=\"#CC7A75\" stroke=\"#2A1A12\" stroke-width=\"10\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/>\n      <path d=\"M 258 458 C 254 476, 258 490, 268 490 C 278 490, 280 474, 274 454 Z\" fill=\"#CC7A75\" stroke=\"#2A1A12\" stroke-width=\"10\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/>\n    </g>\n  </g>";
const ART_HEAD = "<g id=\"Head_Base\" data-pivot=\"512,460\">\n    <path d=\"M 512 112 C 606 112, 684 138, 724 196 C 754 240, 762 292, 760 342 C 758 402, 738 446, 694 464 C 640 496, 384 496, 332 466 C 288 446, 266 402, 264 344 C 262 292, 270 240, 300 196 C 340 138, 418 112, 512 112 Z\" fill=\"#CC7A75\" stroke=\"#2A1A12\" stroke-width=\"10\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/>\n  </g>";
const ART_FACE = "<ellipse cx=\"344\" cy=\"410\" rx=\"32\" ry=\"15\" fill=\"#D98A90\"/>\n    <ellipse cx=\"680\" cy=\"410\" rx=\"32\" ry=\"15\" fill=\"#D98A90\"/>\n    <circle cx=\"494\" cy=\"372\" r=\"4.5\" fill=\"#2A1A12\"/>\n    <circle cx=\"530\" cy=\"372\" r=\"4.5\" fill=\"#2A1A12\"/>";
const ART_EYE_L = "<g id=\"Eye_L\" data-pivot=\"408,330\">\n      <ellipse cx=\"408\" cy=\"330\" rx=\"27\" ry=\"38\" fill=\"#2A1A12\" transform=\"rotate(6 408 330)\"/>\n      <circle cx=\"417\" cy=\"319\" r=\"6\" fill=\"#EDE8DE\"/>\n    </g>";
const ART_EYE_R = "<g id=\"Eye_R\" data-pivot=\"616,330\">\n      <ellipse cx=\"616\" cy=\"330\" rx=\"27\" ry=\"38\" fill=\"#2A1A12\" transform=\"rotate(-6 616 330)\"/>\n      <circle cx=\"625\" cy=\"319\" r=\"6\" fill=\"#EDE8DE\"/>\n    </g>";
const ART_MOUTH = "<path id=\"Mouth\" d=\"M 478 404 Q 512 418 546 404\" fill=\"none\" stroke=\"#2A1A12\" stroke-width=\"4\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/>";
const ART_GLASSES = "<g id=\"Glasses\"><path d=\"M 372 281 L 444 281 Q 462 281 462 299 L 462 361 Q 462 379 444 379 L 372 379 Q 354 379 354 361 L 354 299 Q 354 281 372 281 Z\" fill=\"none\" stroke=\"#2A1A12\" stroke-width=\"17\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/><path d=\"M 372 281 L 444 281 Q 462 281 462 299 L 462 361 Q 462 379 444 379 L 372 379 Q 354 379 354 361 L 354 299 Q 354 281 372 281 Z\" fill=\"none\" stroke=\"#C89A3A\" stroke-width=\"13\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/><path d=\"M 372 281 L 444 281 Q 462 281 462 299 L 462 361 Q 462 379 444 379 L 372 379 Q 354 379 354 361 L 354 299 Q 354 281 372 281 Z\" fill=\"none\" stroke=\"#E0BD68\" stroke-width=\"7\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/><path d=\"M 580 281 L 652 281 Q 670 281 670 299 L 670 361 Q 670 379 652 379 L 580 379 Q 562 379 562 361 L 562 299 Q 562 281 580 281 Z\" fill=\"none\" stroke=\"#2A1A12\" stroke-width=\"17\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/><path d=\"M 580 281 L 652 281 Q 670 281 670 299 L 670 361 Q 670 379 652 379 L 580 379 Q 562 379 562 361 L 562 299 Q 562 281 580 281 Z\" fill=\"none\" stroke=\"#C89A3A\" stroke-width=\"13\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/><path d=\"M 580 281 L 652 281 Q 670 281 670 299 L 670 361 Q 670 379 652 379 L 580 379 Q 562 379 562 361 L 562 299 Q 562 281 580 281 Z\" fill=\"none\" stroke=\"#E0BD68\" stroke-width=\"7\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/><path d=\"M 462 318 Q 512 302 562 318\" fill=\"none\" stroke=\"#2A1A12\" stroke-width=\"17\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/><path d=\"M 462 318 Q 512 302 562 318\" fill=\"none\" stroke=\"#C89A3A\" stroke-width=\"13\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/><path d=\"M 462 318 Q 512 302 562 318\" fill=\"none\" stroke=\"#E0BD68\" stroke-width=\"7\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/><path d=\"M 354 306 L 266 298\" fill=\"none\" stroke=\"#2A1A12\" stroke-width=\"17\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/><path d=\"M 354 306 L 266 298\" fill=\"none\" stroke=\"#C89A3A\" stroke-width=\"13\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/><path d=\"M 354 306 L 266 298\" fill=\"none\" stroke=\"#E0BD68\" stroke-width=\"7\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/><path d=\"M 670 306 L 758 298\" fill=\"none\" stroke=\"#2A1A12\" stroke-width=\"17\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/><path d=\"M 670 306 L 758 298\" fill=\"none\" stroke=\"#C89A3A\" stroke-width=\"13\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/><path d=\"M 670 306 L 758 298\" fill=\"none\" stroke=\"#E0BD68\" stroke-width=\"7\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/><path d=\"M 366 352 L 378 326\" fill=\"none\" stroke=\"#EDE8DE\" stroke-width=\"7\" stroke-linecap=\"round\"/><path d=\"M 658 352 L 646 326\" fill=\"none\" stroke=\"#EDE8DE\" stroke-width=\"7\" stroke-linecap=\"round\"/></g>";
/* Placement on the seam's 480 by 640 canvas, per framing
   mode. Full: the square artwork scaled to the canvas width
   and stood on her contact shadow near the bottom line, the
   way the standing figure always stood. Crop: scaled up and
   anchored on the head, so a 120 to 200 mount reads head,
   gills, glasses, badge corner, and shoulders. */
const PLACE = {
  full: { x: 0, y: 168, s: 480 / 1024 },
  crop: { x: -57, y: -16, s: 594 / 1024 },
};
const GILL_PARAMS = ART_GILLS.map((g) => ({ dur: g.dur, a: g.a, b: g.b }));

export function NovaFigure(props) {
  const {
    state = null, quizState = 0, appState = 0, sleepStage = 0, scanning = false,
    talking = false, pointer = null, reducedMotion = false, pokeN = 0, celebrateN = 0,
    bust = false,
  } = props;

  /* ── Size measurement ───────────────────────────────────
     The figure reads its own visible height: its mount's
     height, clipped by the nearest overflow hidden ancestor,
     which is the height a viewer actually sees. Measured on
     mount, on resize, and whenever the framing inputs
     change. Ported whole from the drop build. */
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
  const mode = novaFigureModeFor(sizeInfo.heightPx, bust);
  const place = PLACE[mode];

  /* Poke and celebrate arrive as counters: a rising count
     flashes the matching expression, then she settles back.
     A poke also fires the recoil: she steps back and turns
     a few degrees for the first beat of the flash, then
     returns. Never a scale pop. */
  const [flash, setFlash] = useState(null);
  const [recoil, setRecoil] = useState(false);
  const prevPokeRef = useRef(pokeN);
  const prevCelebrateRef = useRef(celebrateN);
  const flashTimerRef = useRef(null);
  const recoilTimerRef = useRef(null);
  useEffect(() => {
    if (pokeN > prevPokeRef.current) {
      setFlash("poked");
      setRecoil(true);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      if (recoilTimerRef.current) clearTimeout(recoilTimerRef.current);
      flashTimerRef.current = setTimeout(() => setFlash(null), 750);
      recoilTimerRef.current = setTimeout(() => setRecoil(false), 170);
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
  useEffect(() => () => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    if (recoilTimerRef.current) clearTimeout(recoilTimerRef.current);
  }, []);

  /* ── Pre sleep resistance ───────────────────────────────
     When the sleep stage steps up toward fading, she first
     performs one long blink, and only then does the fading
     face land. */
  const [resisting, setResisting] = useState(false);
  const [longBlink, setLongBlink] = useState(null);
  const prevSleepRef = useRef(sleepStage);
  const longBlinkTimersRef = useRef([]);
  useEffect(() => {
    const prev = prevSleepRef.current;
    prevSleepRef.current = sleepStage;
    if (prev === sleepStage || sleepStage < 1 || prev > sleepStage) return undefined;
    const closeMs = 220;
    const holdMs = 420;
    const openMs = 340;
    setResisting(true);
    setLongBlink({ phase: "closing", closeMs, openMs });
    longBlinkTimersRef.current.forEach((t) => clearTimeout(t));
    longBlinkTimersRef.current = [
      setTimeout(() => setLongBlink({ phase: "closed", closeMs, openMs }), closeMs),
      setTimeout(() => setLongBlink({ phase: "opening", closeMs, openMs }), closeMs + holdMs),
      setTimeout(() => { setLongBlink(null); setResisting(false); }, closeMs + holdMs + openMs),
    ];
    return undefined;
  }, [sleepStage]);
  useEffect(() => () => { longBlinkTimersRef.current.forEach((t) => clearTimeout(t)); }, []);

  const rawExpression = flash || baseExpressionFor({ state, quizState, appState, sleepStage, scanning });
  const expression = resisting && (rawExpression === "fading" || rawExpression === "sleep")
    ? baseExpressionFor({ state: state === "asleep" || state === "fading" ? null : state, quizState, appState, sleepStage: 0, scanning })
    : rawExpression;
  const awake = expression !== "sleep" && expression !== "fading";

  /* Expression transition duration for this change, from
     the table, derived during render so a duration set in
     an effect does not land one change late. */
  const [exprTrack, setExprTrack] = useState({ expr: expression, ms: 300 });
  let exprMs = exprTrack.ms;
  if (exprTrack.expr !== expression) {
    exprMs = novaExpressionTransitionMs(exprTrack.expr, expression);
    setExprTrack({ expr: expression, ms: exprMs });
  }

  /* ── The blink engine ───────────────────────────────────
     A timeout chain, not a fixed loop: wait a randomized 7
     to 13 seconds, close in 90ms, hold 40ms, reopen in
     280ms. It runs under reduced motion too: the blink is
     the one cycle reduced motion keeps, per the alive
     wave's law. Off while she sleeps. */
  const [blinkPhase, setBlinkPhase] = useState("open");
  useEffect(() => {
    if (expression === "sleep") { setBlinkPhase("open"); return undefined; }
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
  }, [expression === "sleep"]);

  /* ── Attention wake and reread ──────────────────────────
     Typing raises her lids one step before any line answers;
     attention returning (focus, visibility, a pointer over
     her) narrows them a step for a few seconds. Lid beats,
     as they have always been on this seam. */
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

  /* ── Glances ────────────────────────────────────────────
     While she is awake and nothing owns her eyes, a glance
     fires every 4 to 9 seconds: the picker serves a target,
     never the one she is already looking at, she holds it
     about a second and a half, then returns to centre. The
     pointer and the thinking face's locked gaze override
     the glance while they last. Stilled under reduced
     motion. */
  const [glanceIndex, setGlanceIndex] = useState(0);
  const glanceIndexRef = useRef(0);
  useEffect(() => {
    if (reducedMotion || !awake) return undefined;
    let cancelled = false;
    const timers = [];
    const later = (fn, ms) => { timers.push(setTimeout(() => { if (!cancelled) fn(); }, ms)); };
    const visit = () => {
      const next = novaGlancePick(Math.random() * 997 + Date.now() % 89, glanceIndexRef.current);
      if (next !== 0) {
        glanceIndexRef.current = next;
        setGlanceIndex(next);
        later(() => {
          glanceIndexRef.current = 0;
          setGlanceIndex(0);
          later(visit, 4000 + Math.random() * 5000);
        }, 1300 + Math.random() * 700);
      } else {
        later(visit, 4000 + Math.random() * 5000);
      }
    };
    later(visit, 2600 + Math.random() * 3000);
    return () => { cancelled = true; timers.forEach((t) => clearTimeout(t)); };
  }, [reducedMotion, awake]);

  /* ── The motion clock ───────────────────────────────────
     One 120ms clock drives the idle life so the parts keep
     their relations: the breath is a 5.2 second sine, the
     gill sway reads each filament's own period off the same
     tick, the tail drifts on a slow 9 second turn, and the
     speaking nod rides the tick while the talking flag is
     up. The gill amplitude eases toward its cause (full at
     rest, a third while thinking, nothing asleep), so a
     state change never snaps her gills. Under reduced
     motion the clock never runs and every value sits at
     rest: the composed figure, blinking only. */
  const [motion, setMotion] = useState({ breath: 0, angles: GILL_PARAMS.map(() => 0), tail: 0, gillAmp: 1, nod: 0 });
  const phaseRef = useRef({ tick: 0, gillAmp: 1 });
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
      const gillTarget = sleeping ? 0 : expression === "thinking" ? 0.33 : 1;
      PH.gillAmp += (gillTarget - PH.gillAmp) * Math.min(1, dt / 600);
      const breath = sleeping ? 0 : Math.sin((PH.tick / 5200) * Math.PI * 2);
      setMotion({
        breath: Math.round(breath * 1000) / 1000,
        angles: GILL_PARAMS.map((f) => Math.round(filamentAngleAt(PH.tick, f.dur, f.a, f.b) * PH.gillAmp * 100) / 100),
        tail: Math.round(Math.sin((PH.tick / 9000) * Math.PI * 2) * 0.6 * PH.gillAmp * 100) / 100,
        gillAmp: PH.gillAmp,
        nod: talking && awake ? Math.round(Math.sin((PH.tick / 190) * Math.PI) * 1000) / 1000 : 0,
      });
    }, talking ? 50 : 120);
    return () => clearInterval(iv);
  }, [reducedMotion, expression, talking, awake]);

  /* ── Lids, eyes, head ───────────────────────────────────
     Coverage composes: the expression's resting coverage,
     the wake and reread beats, the speaking dip, and the
     blink travelling on top of all of it toward whole. The
     lid group for each eye carries the composed coverage as
     a translate from parked (coverage 0) to whole (coverage
     1), priced by the phase that moved it. */
  let coverage = novaLidCoverageFor(expression);
  if (awake && expression !== "poked") {
    if (attentionWake) coverage -= 0.07;
    if (reread) coverage += 0.07;
    if (talking) coverage += 0.05 + 0.03 * Math.abs(motion.nod);
  }
  coverage = Math.max(0, Math.min(1, coverage));
  const blinkClosed = longBlink ? longBlink.phase !== "opening" : (blinkPhase === "closing" || blinkPhase === "closed");
  const lidCoverage = blinkClosed ? 1 : coverage;
  const lidMs = longBlink
    ? (longBlink.phase === "opening" ? longBlink.openMs : longBlink.closeMs)
    : blinkPhase === "opening" ? NOVA_BLINK_OPEN_MS : blinkPhase === "closing" ? NOVA_BLINK_CLOSE_MS : exprMs;
  const lidEase = (longBlink && longBlink.phase === "opening") || blinkPhase === "opening" ? "ease-out" : "ease";

  const att = novaAttentionShift(pointer);
  const exprEye = novaEyeOffsetFor(expression);
  const glance = NOVA_GLANCE_TARGETS[glanceIndex] || NOVA_GLANCE_TARGETS[0];
  const eyeX = pointer ? att.x : exprEye.x + glance.x;
  const eyeY = pointer ? att.y : exprEye.y + glance.y;
  const headTilt = (pointer ? att.x * 0.12 : glance.x * 0.06) + (talking && awake ? motion.nod * 1.1 : 0);
  const headY = talking && awake ? Math.abs(motion.nod) * 2.2 : 0;

  const lidGroup = (clipId, cx) => (
    <g clipPath={`url(#${clipId})`}>
      <g className="nva-lid" style={{ transform: `translateY(${Math.round((lidCoverage * 76 - 80) * 10) / 10}px)`, transition: `transform ${lidMs}ms ${lidEase}` }}>
        <path d={`M ${cx - 34} 288 L ${cx + 34} 288 L ${cx + 34} 372 Q ${cx} 384 ${cx - 34} 372 Z`} fill={SKIN} />
        <path d={`M ${cx - 34} 372 Q ${cx} 384 ${cx + 34} 372`} fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round" />
      </g>
    </g>
  );

  const breathScale = 1 + motion.breath * 0.006;
  const breathY = motion.breath * 1.8;
  const recoilDeg = recoil && !reducedMotion ? -2.6 : 0;

  return (
    <span ref={wrapRef} style={{ display: "block", width: "100%", height: "100%" }}
      onPointerEnter={() => {
        setReread(true);
        if (rereadTimerRef.current) clearTimeout(rereadTimerRef.current);
        rereadTimerRef.current = setTimeout(() => setReread(false), 2000 + Math.random() * 2000);
      }}>
      <style>{NOVA_FIGURE_CSS}</style>
      <svg
        className={"nva-root" + (reducedMotion ? " nva-still" : "")}
        data-nova-figure="axolotl"
        data-expression={expression}
        data-talking={talking ? "true" : "false"}
        data-size-class={sizeClass}
        data-mode={mode}
        data-mouth="flat"
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
          <clipPath id="nvaEyeL"><ellipse cx="408" cy="330" rx="30" ry="41" transform="rotate(6 408 330)" /></clipPath>
          <clipPath id="nvaEyeR"><ellipse cx="616" cy="330" rx="30" ry="41" transform="rotate(-6 616 330)" /></clipPath>
        </defs>

        {/* The contact shadow sits on the mount's own ground,
            outside the placed artwork: she moves, it stays. */}
        {mode === "full" && (
          <ellipse cx="240" cy="600" rx="150" ry="16" fill="#000000" opacity="0.55" />
        )}

        <g style={{
          transform: `translateX(${recoil && !reducedMotion ? -5 : 0}px) rotate(${recoilDeg}deg)`,
          transformBox: "view-box",
          transformOrigin: "240px 600px",
          transition: recoil ? "transform 140ms ease-out" : "transform 420ms ease",
        }}>
        <g transform={`translate(${place.x} ${place.y}) scale(${place.s})`}>
          <g className="nva-arrive">
            {/* Breath: the whole body stretches a whisper
                around her feet and rises with it. The head
                rides inside this group, so a breath moves
                her whole self, never a part against a part. */}
            <g transform={`translate(512 ${Math.round((880 - breathY) * 10) / 10}) scale(1 ${breathScale}) translate(-512 -880)`}>
              <g transform={`rotate(${motion.tail} 650 730)`} dangerouslySetInnerHTML={{ __html: ART_TAIL }} />
              <g dangerouslySetInnerHTML={{ __html: ART_BODY }} />

              {/* The head: tilt and the speaking nod at the
                  neck pivot, in artwork coordinates. */}
              <g transform={`translate(0 ${Math.round(headY * 10) / 10}) rotate(${Math.round(headTilt * 100) / 100} 512 470)`}>
                {ART_GILLS.map((g, i) => (
                  <g key={g.id} transform={`rotate(${motion.angles[i]} ${g.pivot[0]} ${g.pivot[1]})`} dangerouslySetInnerHTML={{ __html: g.html }} />
                ))}
                <g dangerouslySetInnerHTML={{ __html: ART_HEAD }} />
                <g dangerouslySetInnerHTML={{ __html: ART_FACE }} />
                <g transform={`translate(${eyeX} ${eyeY})`}>
                  <g dangerouslySetInnerHTML={{ __html: ART_EYE_L }} />
                  <g dangerouslySetInnerHTML={{ __html: ART_EYE_R }} />
                </g>
                {lidGroup("nvaEyeL", 408)}
                {lidGroup("nvaEyeR", 616)}
                {/* The mouth: the drawn line, exactly as
                    authored. Speech never touches it. */}
                <g dangerouslySetInnerHTML={{ __html: ART_MOUTH }} />
                <g transform={`translate(${Math.round(eyeX * 5) / 10} ${Math.round(eyeY * 5) / 10})`}
                  dangerouslySetInnerHTML={{ __html: ART_GLASSES }} />
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
