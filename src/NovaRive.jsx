/* ── Nova in Rive: the code side of the Rive rebuild ──────────
   The owner approved rebuilding Nova's animation in Rive (state
   machines, a 2.5D joystick head, an autonomous quirk director)
   and supplied the spec for it. The .riv art asset itself is
   authored in the Rive editor in a later step; this file is the
   live contract that asset drops into, plus everything around
   it that is code rather than art:

   - The state machine contract (Nova_Controller and its inputs)
     the editor build is authored against, in one place below.
   - A quip engine: categorized lines in Nova's written voice
     (the personality sheet: calm, dry, short, no hype, no
     exclamation, no dashes of any kind), fired by Rive events
     and by app and quiz state transitions, gated hard so she
     stays mostly silent, never talks over typing, and never
     stacks two bubbles.
   - A fallback: until a real asset exists at public/nova/
     nova.riv, NovaRive renders the current SVG rig (NovaAvatar
     from LearnView) driven by the same state, so shipping this
     file changes nothing a learner can see except the quips.

   The one switch is NOVA_RIVE_ASSET: null means the fallback
   renders everywhere. When the editor asset lands at
   public/nova/nova.riv, set it to NOVA_RIVE_SRC and every
   surface switches with no other code change.

   Palette discipline: the code side visuals here (the quip
   bubble) use the house palette only, the cream bubble the
   NovaLive line bubble already uses. The spec's cyan accent
   was not adopted; Nova's world is gold, cream, and ink. */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  useRive,
  useStateMachineInput,
  EventType,
  Layout,
  Fit,
  Alignment,
} from "@rive-app/react-canvas";
import { NovaAvatar } from "./LearnView.jsx";
import { FONT_SIZES } from "./designSystem.jsx";

/* ── The contract ─────────────────────────────────────────────
   State machine: Nova_Controller.
   Numbers: quizState (0 idle, 1 thinking, 2 hover suspense,
   3 success, 4 fail, 5 streak), appState (0 idle, 1 searching,
   2 high confidence, 3 low confidence or preprint), mouseX and
   mouseY (the 2.5D joystick head, normalized -100 to 100).
   Booleans: isTalking, reducedMotion.
   Triggers: poke, celebrate, sleep, wake.
   Events the asset may fire: EmitIdleQuip, EmitQuizQuip,
   EmitSearchQuip.
   Canvas box: the character renders at size * 1.85 wide with a
   height ratio of 0.62, matching the fallback rig's bust box,
   so the editor artboard should be authored wide. */
export const NOVA_RIVE_STATE_MACHINE = "Nova_Controller";
export const NOVA_RIVE_SRC = "/nova/nova.riv";
export const NOVA_RIVE_ASSET = "/nova/nova.riv";
export const NOVA_RIVE_INPUTS = {
  numbers: ["quizState", "appState", "mouseX", "mouseY"],
  booleans: ["isTalking", "reducedMotion"],
  triggers: ["poke", "celebrate", "sleep", "wake"],
};
export const NOVA_RIVE_EVENTS = ["EmitIdleQuip", "EmitQuizQuip", "EmitSearchQuip"];

/* ── The quip bank ────────────────────────────────────────────
   The owner's supplied lines, rewritten into the voice the
   personality sheet binds: the ideas and categories are his,
   the wording is hers. Short, dry, underreacting. No hype, no
   exclamation, and no dashes of any kind anywhere, hyphenated
   compounds included. Silence is her default; the gates below
   keep every category rare. */
export const NOVA_QUIP_BANK = {
  idle: [
    "If I grow back a limb, does it count as a coauthor? Asking for a friend.",
    "Reorganizing the papers by how good the graphs look. Do not mind me.",
    "I am neotenic. The scientific term for refusing to grow up. I got the doctorate anyway.",
  ],
  fourthWall: [
    "You out there. Your coffee is going cold, and the citations will not cross reference themselves.",
  ],
  searching: [
    "Into PubMed and arXiv. Hold my beaker. It gets deep down there.",
    "Looking for the actual data. Made up citations do not get past me.",
  ],
  preprintWarning: [
    "That one is a preprint. Fresh out of the incubator, not yet peer reviewed. Goggles on.",
  ],
  highConfidence: [
    "Peer reviewed, replicated, and it holds up. That is the whole celebration.",
  ],
  quizThinking: [
    "Take your time. My gills flutter at sixty beats a minute when I watch someone hover between B and C.",
  ],
  quizCorrect: [
    "Correct. The chance that was a guess is under one in a thousand.",
  ],
  quizStreak: [
    "Three in a row. You are making my control group look bad.",
  ],
  quizWrong: [
    "Hypothesis falsified. Einstein fumbled the cosmological constant too. Run it again.",
  ],
};

/* Her temperament in numbers. One bubble at a time across every
   Nova on the page (the module gate below, the same pattern as
   the tip gate in LearnView), a long global gap, per category
   cooldowns, and a chance roll per category so even an eligible
   moment usually stays silent. Warnings land most often because
   they are useful; praise lands least, because she is not a
   cheerleader. */
export const QUIP_MIN_GAP_MS = 60000;
export const QUIP_SHOW_MS = 3200;
export const QUIP_LONG_IDLE_MS = 30000;
export const QUIP_CATEGORY_COOLDOWN_MS = {
  idle: 240000,
  fourthWall: 900000,
  searching: 150000,
  preprintWarning: 120000,
  highConfidence: 600000,
  quizThinking: 180000,
  quizCorrect: 60000,
  quizStreak: 180000,
  quizWrong: 60000,
};
export const QUIP_CATEGORY_CHANCE = {
  idle: 0.5,
  fourthWall: 0.6,
  searching: 0.45,
  preprintWarning: 0.85,
  highConfidence: 0.25,
  quizThinking: 0.3,
  quizCorrect: 0.55,
  quizStreak: 0.85,
  quizWrong: 0.55,
};

/* ── Pure mapping helpers (the contract as functions) ──────── */
export function quizCategoryForState(quizState) {
  if (quizState === 1) return "quizThinking";
  if (quizState === 3) return "quizCorrect";
  if (quizState === 4) return "quizWrong";
  if (quizState === 5) return "quizStreak";
  return null;
}

export function searchCategoryForState(appState) {
  if (appState === 1) return "searching";
  if (appState === 2) return "highConfidence";
  if (appState === 3) return "preprintWarning";
  return null;
}

export function quipCategoryForRiveEvent(name, ctx = {}) {
  if (name === "EmitQuizQuip") return quizCategoryForState(ctx.quizState) || "quizThinking";
  if (name === "EmitSearchQuip") return searchCategoryForState(ctx.appState) || "searching";
  if (name === "EmitIdleQuip") {
    return typeof ctx.idleMs === "number" && ctx.idleMs >= QUIP_LONG_IDLE_MS ? "fourthWall" : "idle";
  }
  return null;
}

export function quipGateAllows({ now = 0, lastGlobalAt = 0, lastCategoryAt = 0, category = null, typing = false, busy = false, roll = 0 } = {}) {
  if (typing || busy) return false;
  if (!category || !NOVA_QUIP_BANK[category]) return false;
  if (now - lastGlobalAt < QUIP_MIN_GAP_MS) return false;
  const cd = QUIP_CATEGORY_COOLDOWN_MS[category] || 0;
  if (now - lastCategoryAt < cd) return false;
  const chance = QUIP_CATEGORY_CHANCE[category];
  if (typeof chance === "number" && roll >= chance) return false;
  return true;
}

export function pickQuipLine(category, seed = 0, avoid = null) {
  const lines = NOVA_QUIP_BANK[category] || [];
  if (!lines.length) return null;
  let i = Math.abs(Math.floor(seed)) % lines.length;
  if (lines.length > 1 && lines[i] === avoid) i = (i + 1) % lines.length;
  return lines[i];
}

export function quizPointerFor(clientX, clientY, rect) {
  if (!rect || typeof rect.left !== "number" || !rect.width || !rect.height) return { x: 0, y: 0 };
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const clamp = (v) => Math.max(-100, Math.min(100, Math.round(v)));
  return {
    x: clamp(((clientX - cx) / Math.max(1, rect.width)) * 100),
    y: clamp(((clientY - cy) / Math.max(1, rect.height)) * 100),
  };
}

export function appStateForActivity(activityState) {
  if (activityState === "thinking") return 1;
  if (activityState === "pleased") return 2;
  if (activityState === "deadpan") return 3;
  return 0;
}

export function quizStateForSheet({ phase = 0, good = false, correctStreak = 0, hover = false } = {}) {
  if (phase === 1) return good ? (correctStreak >= 3 ? 5 : 3) : 4;
  if (phase === 0) return hover ? 2 : 1;
  return 1;
}

/* ── The quip engine ──────────────────────────────────────────
   One gate for every Nova on the page, module level like the
   tip gate: a global last shown stamp, per category stamps,
   and a single active token, so two instances can never speak
   at once. An instance offers a category; the gate decides.
   The engine never speaks while the learner is typing, and a
   Nova with a line of her own already up (NovaLive's poke and
   brain lines) passes lineBusy and the quip stands down. */
let novaQuipLastAt = 0;
let novaQuipActiveToken = null;
const novaQuipCategoryAt = {};
let novaQuipTokenSeq = 0;

function userIsTyping() {
  try {
    const el = typeof document !== "undefined" ? document.activeElement : null;
    if (!el) return false;
    const tag = (el.tagName || "").toUpperCase();
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
  } catch {
    return false;
  }
}

function useNovaQuips({ quizState = 0, appState = 0, enabled = true, lineBusy = false, idleMs = 0 }) {
  const [quip, setQuip] = useState(null);
  const tokenRef = useRef(0);
  const timerRef = useRef(null);
  const lastLineRef = useRef({});
  const quipRef = useRef(null);
  quipRef.current = quip;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const busyRef = useRef(lineBusy);
  busyRef.current = lineBusy;
  const ctxRef = useRef({ quizState, appState, idleMs });
  ctxRef.current = { quizState, appState, idleMs };

  const dismiss = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (novaQuipActiveToken === tokenRef.current) novaQuipActiveToken = null;
    tokenRef.current = 0;
    setQuip(null);
  };
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;

  const offer = (category) => {
    if (!enabledRef.current || !category) return;
    const now = Date.now();
    const otherBusy = novaQuipActiveToken !== null && novaQuipActiveToken !== tokenRef.current;
    const ok = quipGateAllows({
      now,
      category,
      lastGlobalAt: novaQuipLastAt,
      lastCategoryAt: novaQuipCategoryAt[category] || 0,
      typing: userIsTyping(),
      busy: busyRef.current || otherBusy || !!quipRef.current,
      roll: Math.random(),
    });
    if (!ok) return;
    const line = pickQuipLine(category, now, lastLineRef.current[category] || null);
    if (!line) return;
    lastLineRef.current[category] = line;
    novaQuipLastAt = now;
    novaQuipCategoryAt[category] = now;
    const token = ++novaQuipTokenSeq;
    tokenRef.current = token;
    novaQuipActiveToken = token;
    setQuip({ category, line });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (tokenRef.current === token) dismissRef.current();
    }, QUIP_SHOW_MS);
  };
  const offerRef = useRef(offer);
  offerRef.current = offer;

  const handleRiveEvent = useCallback((name) => {
    const cat = quipCategoryForRiveEvent(name, ctxRef.current);
    if (cat) offerRef.current(cat);
  }, []);

  const prevAppRef = useRef(appState);
  useEffect(() => {
    const prev = prevAppRef.current;
    prevAppRef.current = appState;
    if (prev === appState) return;
    const cat = searchCategoryForState(appState);
    if (cat) offerRef.current(cat);
  }, [appState]);

  const prevQuizRef = useRef(quizState);
  useEffect(() => {
    const prev = prevQuizRef.current;
    prevQuizRef.current = quizState;
    if (prev === quizState) return;
    const cat = quizCategoryForState(quizState);
    if (cat) offerRef.current(cat);
  }, [quizState]);

  useEffect(() => {
    if (lineBusy && quipRef.current) dismissRef.current();
  }, [lineBusy]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (novaQuipActiveToken === tokenRef.current) novaQuipActiveToken = null;
  }, []);

  return { quip, dismissQuip: dismiss, handleRiveEvent, talking: !!quip };
}

/* The bubble: the house cream bubble, the same values as the
   NovaLive line bubble, sized to wrap her longer quip lines.
   A click dismisses. House palette only: cream ground, ink
   text, the faint ink line. */
const NV_BUBBLE_CREAM = "#F5F0E8";
const NV_BUBBLE_INK = "#1A1A1A";
const NV_BUBBLE_LINE = "rgba(26, 26, 26, 0.16)";

function QuipBubble({ line, onDismiss }) {
  return (
    <span role="status" title="Dismiss" onClick={onDismiss} style={{
      position: "absolute", top: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)",
      background: NV_BUBBLE_CREAM, color: NV_BUBBLE_INK, border: "1px solid " + NV_BUBBLE_LINE, borderRadius: 10,
      padding: "7px 11px", fontSize: FONT_SIZES.body, lineHeight: 1.35, whiteSpace: "normal",
      width: "max-content", maxWidth: 250, cursor: "pointer", zIndex: 31,
      boxShadow: "0 6px 18px rgba(0,0,0,0.25)",
    }}>
      {line}
    </span>
  );
}

/* ── The fallback surface ─────────────────────────────────────
   No asset yet: the traced SVG rig renders, driven by the same
   state the canvas surface will take. The pointer feed, when a
   caller supplies one, lands on the rig's gaze custom
   properties at the same scale NovaLive's proximity gaze uses,
   so she looks toward the hovered answer option. */
function NovaFallback(props) {
  const {
    state = "greeting", size = 48, framing = "bust", scanning = false,
    pushN = 0, flutterN = 0, noticeN = 0, waveN = 0, pointer = null, anchorRef = null,
  } = props;
  const quips = useNovaQuips({
    quizState: props.quizState || 0,
    appState: props.appState || 0,
    enabled: props.quips !== false,
    lineBusy: !!props.lineBusy,
    idleMs: props.idleMs || 0,
  });
  const vars = pointer
    ? {
        "--nv-gx": ((pointer.x / 100) * 3.2).toFixed(2) + "px",
        "--nv-gy": ((pointer.y / 100) * 2.4).toFixed(2) + "px",
      }
    : null;
  return (
    <span ref={anchorRef} style={{ position: "relative", display: "inline-flex", ...(vars || {}) }}>
      <NovaAvatar state={state} size={size} framing={framing} scanning={scanning} pushN={pushN} flutterN={flutterN} noticeN={noticeN} waveN={waveN} />
      {quips.quip && <QuipBubble line={quips.quip.line} onDismiss={quips.dismissQuip} />}
    </span>
  );
}

/* ── The canvas surface ───────────────────────────────────────
   Mounts only when NOVA_RIVE_ASSET is set. Every contract
   input is bound through useStateMachineInput and fed from
   props: brain sleep stages fire the sleep and wake triggers,
   poke and celebrate arrive as counters from callers (a rising
   count fires the trigger once), and Rive events route into
   the quip engine. */
function NovaCanvas(props) {
  // waveN is accepted here and left unused: the Rive contract has no wave trigger.
  const {
    size = 48, quizState = 0, appState = 0, pointer = null, waveN = 0,
    sleepStage = 0, pokeN = 0, celebrateN = 0, reducedMotion = false, anchorRef = null,
  } = props;
  const quips = useNovaQuips({
    quizState,
    appState,
    enabled: props.quips !== false,
    lineBusy: !!props.lineBusy,
    idleMs: props.idleMs || 0,
  });
  const riveState = useRive({
    src: NOVA_RIVE_ASSET,
    stateMachines: NOVA_RIVE_STATE_MACHINE,
    autoplay: true,
    layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
  });
  const rive = riveState.rive;
  const RiveComponent = riveState.RiveComponent;
  const quizIn = useStateMachineInput(rive, NOVA_RIVE_STATE_MACHINE, "quizState", 0);
  const appIn = useStateMachineInput(rive, NOVA_RIVE_STATE_MACHINE, "appState", 0);
  const mouseXIn = useStateMachineInput(rive, NOVA_RIVE_STATE_MACHINE, "mouseX", 0);
  const mouseYIn = useStateMachineInput(rive, NOVA_RIVE_STATE_MACHINE, "mouseY", 0);
  const talkingIn = useStateMachineInput(rive, NOVA_RIVE_STATE_MACHINE, "isTalking", false);
  const reducedIn = useStateMachineInput(rive, NOVA_RIVE_STATE_MACHINE, "reducedMotion", false);
  const pokeIn = useStateMachineInput(rive, NOVA_RIVE_STATE_MACHINE, "poke");
  const celebrateIn = useStateMachineInput(rive, NOVA_RIVE_STATE_MACHINE, "celebrate");
  const sleepIn = useStateMachineInput(rive, NOVA_RIVE_STATE_MACHINE, "sleep");
  const wakeIn = useStateMachineInput(rive, NOVA_RIVE_STATE_MACHINE, "wake");

  useEffect(() => { if (quizIn) quizIn.value = quizState; }, [quizIn, quizState]);
  useEffect(() => { if (appIn) appIn.value = appState; }, [appIn, appState]);
  useEffect(() => { if (mouseXIn) mouseXIn.value = pointer ? pointer.x : 0; }, [mouseXIn, pointer]);
  useEffect(() => { if (mouseYIn) mouseYIn.value = pointer ? pointer.y : 0; }, [mouseYIn, pointer]);
  useEffect(() => { if (talkingIn) talkingIn.value = quips.talking; }, [talkingIn, quips.talking]);
  useEffect(() => { if (reducedIn) reducedIn.value = !!reducedMotion; }, [reducedIn, reducedMotion]);

  const prevPokeRef = useRef(pokeN);
  useEffect(() => {
    if (pokeN > prevPokeRef.current && pokeIn) {
      try { pokeIn.fire(); } catch { /* a trigger with no listener in the asset is a no op */ }
    }
    prevPokeRef.current = pokeN;
  }, [pokeN, pokeIn]);

  const prevCelebrateRef = useRef(celebrateN);
  useEffect(() => {
    if (celebrateN > prevCelebrateRef.current && celebrateIn) {
      try { celebrateIn.fire(); } catch { /* a trigger with no listener in the asset is a no op */ }
    }
    prevCelebrateRef.current = celebrateN;
  }, [celebrateN, celebrateIn]);

  const prevStageRef = useRef(sleepStage);
  useEffect(() => {
    const prev = prevStageRef.current;
    prevStageRef.current = sleepStage;
    if (sleepStage > prev && sleepStage >= 2 && sleepIn) {
      try { sleepIn.fire(); } catch { /* a trigger with no listener in the asset is a no op */ }
    } else if (sleepStage < prev && wakeIn) {
      try { wakeIn.fire(); } catch { /* a trigger with no listener in the asset is a no op */ }
    }
  }, [sleepStage, sleepIn, wakeIn]);

  const onRiveEvent = quips.handleRiveEvent;
  useEffect(() => {
    if (!rive || !onRiveEvent) return undefined;
    const handler = (e) => {
      const n = e && e.data && e.data.name;
      if (n) onRiveEvent(n);
    };
    rive.on(EventType.RiveEvent, handler);
    return () => {
      try { rive.off(EventType.RiveEvent, handler); } catch { /* the runtime is already gone */ }
    };
  }, [rive, onRiveEvent]);

  const w = Math.round(size * 1.85);
  const h = Math.round(w * 0.62);
  return (
    <span ref={anchorRef} style={{ position: "relative", display: "inline-flex" }}>
      <span style={{ width: w, height: h, display: "block" }}>
        <RiveComponent />
      </span>
      {quips.quip && <QuipBubble line={quips.quip.line} onDismiss={quips.dismissQuip} />}
    </span>
  );
}

/* ── NovaRive ─────────────────────────────────────────────────
   One component, two surfaces, switched by the asset constant
   above and nothing else. Callers (NovaLive in the header,
   SheetNova in the lesson sheet) pass the same character state
   they always have, plus the Rive contract feeds this file
   maps onward: quizState, appState, pointer, sleepStage, and
   the poke and celebrate counters. */
export function NovaRive(props) {
  if (!NOVA_RIVE_ASSET) return <NovaFallback {...props} />;
  return <NovaCanvas {...props} />;
}
