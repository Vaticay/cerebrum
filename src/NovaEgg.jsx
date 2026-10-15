/* ── Nova, app wide: the Easter egg (egg wave, 2026-10-14) ──────
   Nova belongs to the learning view, but she is the product's
   character, so rarely, and only when nothing important is
   happening, she visits the rest of the app: a swim across the
   bottom of the screen, a peek from behind the bottom edge, a
   pleased pass when a learner finishes a path, or a still
   appearance for anyone whose motion settings say quiet. There
   is one deliberate secret: three quick clicks on the Cerebrum
   wordmark summon her. It is written down nowhere in the app.

   The discipline is the egg's whole point. Rare by design: a
   low roll per check, an eight hour shared cooldown in local
   storage, at most one ambient visit per session, and never on
   consecutive visits (if she came last session, this session is
   quiet). Never during a lesson, a call, a checkout, or while
   the learner is typing. She never blocks anything: the stage
   takes no pointer events except on Nova herself during a
   pause, a click on her earns the reaction and ends the visit
   politely, and dismissing her (the bubble's close button, or
   Escape) twice stretches the cooldown to two days. When no
   visit is running the component renders nothing and keeps no
   timers beyond one slow check interval that only runs while
   the tab is visible. Her lines come from the lines library in
   LearnView; the figure herself is the NovaRive canvas, the
   same v3 character every other surface renders (2026-10-15,
   the old model purge: the traced SVG rig she used to ride
   retired with the raster poses). The canvas contract has no
   swim cycle, so the crossing itself still comes from the
   stage CSS below (the travel, the bob, the roll); her in
   figure motion while she crosses is the canvas idle. */
import React, { useEffect, useRef, useState } from "react";
import { cbMotionOff } from "./flowcharts.jsx";
import { NovaRive } from "./NovaRive.jsx";
import {
  NOVA_SUMMON_LINES,
  NOVA_CELEBRATE_LINES,
  loadNovaQuirks,
  saveNovaQuirks,
  loadNovaMemoryFacts,
  pickEggLine,
  pickNovaLine,
} from "./LearnView.jsx";

const EGG_STORE_KEY = "cerebrum-novaegg";
const EGG_SESSION_KEY = "cerebrum-novaegg-session";
export const EGG_BASE_COOLDOWN_MS = 8 * 3600 * 1000;
export const EGG_LONG_COOLDOWN_MS = 48 * 3600 * 1000;
export const EGG_CELEBRATE_COOLDOWN_MS = 30 * 60 * 1000;
export const EGG_AMBIENT_CHANCE = 0.07;
export const EGG_TICK_MS = 45000;
export const WORDMARK_GAP_MS = 700;
export const WORDMARK_CLICKS = 3;


/* The cooldown a store full of history earns: two dismissals
   stretch it from eight hours to two days. */
export function eggCooldownMs(store) {
  const s = store && typeof store === "object" ? store : {};
  return (s.dismissals || 0) >= 2 ? EGG_LONG_COOLDOWN_MS : EGG_BASE_COOLDOWN_MS;
}

/* The contexts she never enters, as one decision so the checks
   and the tests read the same list the brief wrote: typing, a
   lesson, a call, a checkout, or a hidden tab. */
export function eggBlocked(ctx) {
  const c = ctx || {};
  return !!(c.hidden || c.typing || c.inLesson || c.inCall || c.inCheckout);
}

/* Ambient eligibility: context clear, this session has not had
   her, last session did not have her either, and the shared
   cooldown has run out. */
export function eggEligible(store, ctx, session, now) {
  if (eggBlocked(ctx)) return false;
  const s = store && typeof store === "object" ? store : {};
  if (session && session.hadEgg) return false;
  if (session && session.prevSessionHadEgg) return false;
  if (s.lastAt && now - s.lastAt < eggCooldownMs(s)) return false;
  return true;
}

/* A celebration is earned, so it skips the ambient rarity rules
   and answers only to the context blocks and a short shared
   cooldown of its own. */
export function eggCelebrateEligible(store, ctx, now) {
  if (eggBlocked(ctx)) return false;
  const s = store && typeof store === "object" ? store : {};
  if (s.lastAt && now - s.lastAt < EGG_CELEBRATE_COOLDOWN_MS) return false;
  return true;
}

/* The summon count: clicks on the wordmark inside the gap stack;
   a slower click starts the count over. Three summons her. */
export function countWordmarkClick(state, now) {
  const st = state && typeof state === "object" ? state : { count: 0, lastAt: 0 };
  const count = st.lastAt && now - st.lastAt <= WORDMARK_GAP_MS ? (st.count || 0) + 1 : 1;
  if (count >= WORDMARK_CLICKS) return { count: 0, lastAt: now, summoned: true };
  return { count, lastAt: now, summoned: false };
}

export function recordEggAppearance(store, now) {
  return { ...(store && typeof store === "object" ? store : {}), lastAt: now };
}

export function recordEggDismissal(store, now) {
  const s = { ...(store && typeof store === "object" ? store : {}) };
  s.dismissals = (s.dismissals || 0) + 1;
  s.lastAt = now;
  return s;
}

function loadEggStore() {
  try {
    const raw = localStorage.getItem(EGG_STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch { return {}; }
}

function saveEggStore(s) {
  try { localStorage.setItem(EGG_STORE_KEY, JSON.stringify(s || {})); } catch { /* storage is a courtesy */ }
}

function eggSessionId() {
  try {
    let id = sessionStorage.getItem(EGG_SESSION_KEY);
    if (!id) {
      id = String(Date.now()) + "." + Math.floor(Math.random() * 1e9);
      sessionStorage.setItem(EGG_SESSION_KEY, id);
    }
    return id;
  } catch { return "nosession"; }
}

/* What the page is doing right now, read off the DOM the shell
   already renders: the lesson Player is the fixed .lv-sheet,
   a call is its named dialog or a live video in a fixed frame,
   a checkout is a dialog talking about Pro or subscribing, and
   typing is an editable element holding focus. Best effort by
   design: a missed signal only ever costs an appearance. */
function probeEggContext() {
  const ctx = { hidden: true, typing: false, inLesson: false, inCall: false, inCheckout: false };
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
  } catch { /* a failed probe reads as a quiet page; the cooldown still applies */ }
  return ctx;
}

const EGG_CSS = `
.ne-stage { position: fixed; inset: 0; z-index: 80; pointer-events: none; overflow: hidden; }
.ne-shimmer { position: absolute; left: 0; right: 0; bottom: 6%; height: 190px; pointer-events: none; background: linear-gradient(100deg, transparent 30%, rgba(255,255,255,0.05) 47%, rgba(255,255,255,0.09) 50%, rgba(255,255,255,0.05) 53%, transparent 70%); background-size: 250% 100%; animation: neShimmerMove 9s linear infinite; }
@keyframes neShimmerMove { from { background-position: 120% 0; } to { background-position: -120% 0; } }
.ne-rig { position: absolute; pointer-events: none; }
.ne-rig-live { pointer-events: auto; cursor: pointer; }
.ne-shadow { position: absolute; left: 12%; right: 12%; bottom: -13px; height: 15px; border-radius: 50%; background: rgba(0,0,0,0.35); filter: blur(7px); }
.ne-bob { animation: neBob 3.1s ease-in-out infinite alternate; }
@keyframes neBob { from { transform: translateY(0) rotate(-0.5deg); } to { transform: translateY(-6px) rotate(0.6deg); } }
.ne-roll { }
.ne-ph-cross .ne-roll { animation: neRoll 2.2s cubic-bezier(0.45, 0.05, 0.35, 1) 2.6s both; }
@keyframes neRoll { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.ne-bub { position: absolute; border-radius: 50%; border: 1px solid rgba(255,255,255,0.5); background: rgba(255,255,255,0.10); opacity: 0; animation: neBubRise ease-out infinite; }
@keyframes neBubRise {
  0% { transform: translate(0, 0); opacity: 0; }
  12% { opacity: 0.75; }
  55% { transform: translate(-16px, -38px); }
  100% { transform: translate(-6px, -74px); opacity: 0; }
}
.ne-bubble { position: absolute; bottom: calc(100% + 10px); left: 50%; transform: translateX(-50%); width: max-content; max-width: 290px; background: #F5F0E8; color: #1A1A1A; border: 1px solid rgba(26,26,26,0.16); border-radius: 14px; padding: 11px 34px 11px 14px; font-size: 14.5px; line-height: 1.5; pointer-events: auto; box-shadow: 0 10px 26px rgba(0,0,0,0.25); animation: neBubbleIn 0.35s cubic-bezier(0.22, 0.9, 0.28, 1) both; }
@keyframes neBubbleIn { from { opacity: 0; transform: translateX(-50%) translateY(6px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
.ne-bubble-tail { position: absolute; bottom: -7px; left: 50%; margin-left: -7px; width: 13px; height: 13px; background: #F5F0E8; border-right: 1px solid rgba(26,26,26,0.16); border-bottom: 1px solid rgba(26,26,26,0.16); transform: rotate(45deg); }
.ne-bubble-x { position: absolute; top: 3px; right: 3px; width: 28px; height: 28px; background: none; border: none; color: #6E675C; cursor: pointer; font-size: 12px; line-height: 1; display: inline-flex; align-items: center; justify-content: center; }
/* The swim across: enter with an anticipation dip and an
   overshoot settle, cross on a gentle arc, pause, then leave
   pleased. Every phase is its own keyframes so the positions
   join exactly. */
.ne-swim { left: 0; bottom: 13%; }
.ne-swim.ne-ph-enter { animation: neSwimEnter 1.5s cubic-bezier(0.22, 0.9, 0.28, 1) both; }
@keyframes neSwimEnter {
  0% { transform: translate(-190px, 10px); }
  18% { transform: translate(-150px, 16px); }
  72% { transform: translate(15.5vw, -3px); }
  100% { transform: translate(16vw, 0); }
}
.ne-swim.ne-ph-cross { animation: neSwimCross 5.9s cubic-bezier(0.3, 0.6, 0.4, 1) both; }
@keyframes neSwimCross {
  0% { transform: translate(16vw, 0); }
  30% { transform: translate(31vw, -26px); }
  55% { transform: translate(44vw, 2px); }
  78% { transform: translate(54vw, -18px); }
  100% { transform: translate(58vw, 0); }
}
.ne-swim.ne-ph-pause { transform: translate(58vw, 0); }
.ne-swim.ne-ph-exit { animation: neSwimExit 1.5s cubic-bezier(0.5, 0, 0.8, 0.4) both; }
@keyframes neSwimExit {
  0% { transform: translate(58vw, 0); opacity: 1; }
  80% { transform: translate(96vw, -22px); opacity: 1; }
  100% { transform: translate(108vw, -26px); opacity: 0; }
}
/* The peek: rise from behind the bottom edge, look around, duck. */
.ne-peek { left: 9vw; bottom: 0; }
.ne-peek.ne-ph-rise { animation: nePeekRise 1.4s cubic-bezier(0.22, 0.9, 0.28, 1) both; }
@keyframes nePeekRise {
  0% { transform: translateY(82%); }
  20% { transform: translateY(88%); }
  74% { transform: translateY(30%); }
  100% { transform: translateY(38%); }
}
.ne-peek.ne-ph-look { animation: nePeekLook 3s ease-in-out both; }
@keyframes nePeekLook {
  0%, 100% { transform: translateY(38%) translateX(0); }
  30% { transform: translateY(37%) translateX(-7px); }
  65% { transform: translateY(39%) translateX(7px); }
}
.ne-peek.ne-ph-duck { animation: nePeekDuck 1.1s cubic-bezier(0.6, 0, 0.9, 0.5) both; }
@keyframes nePeekDuck { from { transform: translateY(38%); } to { transform: translateY(112%); } }
/* The celebration pass: pleased, lower, a little quicker, two hops. */
.ne-celebrate { left: 0; bottom: 20%; }
.ne-celebrate.ne-ph-enter { animation: neSwimEnter 1.2s cubic-bezier(0.22, 0.9, 0.28, 1) both; }
.ne-celebrate.ne-ph-cross { animation: neCelebCross 5.2s cubic-bezier(0.3, 0.6, 0.4, 1) both; }
@keyframes neCelebCross {
  0% { transform: translate(16vw, 0); }
  26% { transform: translate(34vw, -34px); }
  50% { transform: translate(52vw, 0); }
  74% { transform: translate(70vw, -30px); }
  100% { transform: translate(84vw, -4px); }
}
.ne-celebrate.ne-ph-exit { animation: neCelebExit 1.4s cubic-bezier(0.5, 0, 0.8, 0.4) both; }
@keyframes neCelebExit {
  0% { transform: translate(84vw, -4px); opacity: 1; }
  100% { transform: translate(112vw, -30px); opacity: 0; }
}
/* The summon entrance: she rises in the middle and stays to talk. */
.ne-summon { left: 50%; bottom: 5%; }
.ne-summon.ne-ph-rise { animation: neSummonRise 1.6s cubic-bezier(0.22, 0.9, 0.28, 1) both; }
@keyframes neSummonRise {
  0% { transform: translateX(-50%) translateY(72%) scale(0.86); opacity: 0; }
  22% { transform: translateX(-50%) translateY(78%) scale(0.87); opacity: 1; }
  76% { transform: translateX(-50%) translateY(-3%) scale(1.01); opacity: 1; }
  100% { transform: translateX(-50%) translateY(0) scale(1); opacity: 1; }
}
.ne-summon.ne-ph-speak { transform: translateX(-50%) translateY(0); }
.ne-summon.ne-ph-leave { animation: neSummonLeave 1.8s cubic-bezier(0.5, 0, 0.8, 0.4) both; }
@keyframes neSummonLeave {
  0% { transform: translateX(-50%) translateY(0); opacity: 1; }
  100% { transform: translateX(-50%) translateY(46%); opacity: 0; }
}
/* The still visit, for quiet motion settings: she fades in at
   the corner, says her line, fades out. No travel, no particles. */
.ne-still { right: 22px; bottom: 22px; }
.ne-still.ne-ph-show { animation: neStillIn 0.6s ease both; }
@keyframes neStillIn { from { opacity: 0; } to { opacity: 1; } }
.ne-still.ne-ph-leave { animation: neStillOut 0.7s ease both; }
@keyframes neStillOut { from { opacity: 1; } to { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .ne-bob, .ne-shimmer, .ne-bub, .ne-pose-in { animation: none !important; }
}
`;

/* Timelines: phase steps per kind, milliseconds from the start
   of the visit. The pose rides along with the phases; the line
   shows during the speaking phases. */
const EGG_TIMELINES = {
  swim: [
    { at: 0, phase: "enter", pose: "greeting" },
    { at: 1500, phase: "cross", pose: "greeting" },
    { at: 7400, phase: "pause", pose: "explaining", line: true },
    { at: 10000, phase: "exit", pose: "pleased" },
    { at: 11500, end: true },
  ],
  peek: [
    { at: 0, phase: "rise", pose: "thinking" },
    { at: 1400, phase: "look", pose: "greeting", line: true },
    { at: 4400, phase: "duck", pose: "greeting" },
    { at: 5600, end: true },
  ],
  celebrate: [
    { at: 0, phase: "enter", pose: "pleased" },
    { at: 1200, phase: "cross", pose: "pleased", line: true },
    { at: 6400, phase: "exit", pose: "pleased" },
    { at: 7900, end: true },
  ],
  summon: [
    { at: 0, phase: "rise", pose: "greeting" },
    { at: 1600, phase: "speak", pose: "explaining", line: true },
    { at: 6600, phase: "leave", pose: "pleased" },
    { at: 8500, end: true },
  ],
  still: [
    { at: 0, phase: "show", pose: "greeting", line: true },
    { at: 5800, phase: "leave", pose: "greeting" },
    { at: 6600, end: true },
  ],
};

const EGG_SIZES = { swim: 148, peek: 132, celebrate: 148, summon: 168, still: 120 };
const EGG_SPEAK_PHASES = { swim: ["pause"], peek: ["look"], celebrate: ["cross"], summon: ["speak"], still: ["show"] };

/* Her figure on the egg stage (2026-10-15, the old model
   purge): the NovaRive canvas at full framing. The egg's poses
   map onto the canvas contract as closely as it allows:
   thinking rides quizState 1, pleased rides quizState 3 plus
   the celebrate trigger, and greeting and explaining ride the
   idle (her line rides in the egg's own bubble beside her, so
   the canvas stays figure only and event routing stays off).
   The celebrate counter rises a beat after the pleased pose
   lands rather than with it: the canvas binds its trigger
   inputs as the asset loads, and a rise that lands before the
   binding is swallowed by the counter's own bookkeeping. */
function EggFigure({ pose, size }) {
  const [celebrateN, setCelebrateN] = useState(0);
  const mountedAtRef = useRef(Date.now());
  useEffect(() => {
    if (pose !== "pleased") return undefined;
    const wait = Math.max(0, 700 - (Date.now() - mountedAtRef.current));
    const t = setTimeout(() => setCelebrateN((n) => n + 1), wait);
    return () => clearTimeout(t);
  }, [pose]);
  const quizState = pose === "thinking" ? 1 : pose === "pleased" ? 3 : 0;
  return <NovaRive state={pose} size={size} framing="full" quizState={quizState} celebrateN={celebrateN} quips={false} />;
}

export default function NovaEgg() {
  const [visit, setVisit] = useState(null);
  const visitRef = useRef(null);
  const timersRef = useRef([]);
  const sessionRef = useRef({ id: "nosession", hadEgg: false, prevSessionHadEgg: false });
  const clickRef = useRef({ count: 0, lastAt: 0 });

  const clearTimers = () => {
    for (const t of timersRef.current) clearTimeout(t);
    timersRef.current = [];
  };

  const endVisit = () => {
    clearTimers();
    visitRef.current = null;
    setVisit(null);
  };

  const dismissVisit = () => {
    saveEggStore(recordEggDismissal(loadEggStore(), Date.now()));
    endVisit();
  };

  const startVisit = (kind) => {
    if (visitRef.current) return;
    let k = kind;
    try { if (cbMotionOff()) k = "still"; } catch { /* the full visit is the fallback */ }
    const now = Date.now();
    const seed = now;
    let line = null;
    if (k === "summon") {
      line = pickNovaLine(NOVA_SUMMON_LINES, seed);
    } else if (k === "celebrate") {
      line = pickNovaLine(NOVA_CELEBRATE_LINES, seed);
    } else {
      const wantLine = k === "still" ? true : k === "peek" ? Math.random() < 0.5 : Math.random() < 0.65;
      if (wantLine) {
        const quirks = loadNovaQuirks();
        const picked = pickEggLine(
          { hour: new Date().getHours(), facts: loadNovaMemoryFacts(), allowGag: true, seed },
          quirks, now
        );
        if (picked && picked.line) {
          line = picked.line;
          saveNovaQuirks(picked.quirks);
        }
      }
    }
    /* An appearance counts, whichever door she came through:
       the shared store's clock starts now. */
    const store = recordEggAppearance(loadEggStore(), now);
    store.lastEggSessionId = sessionRef.current.id;
    saveEggStore(store);
    sessionRef.current.hadEgg = true;

    const firstStep = EGG_TIMELINES[k][0];
    const v = {
      kind: k, phase: firstStep.phase, pose: firstStep.pose, line,
      showLine: !!firstStep.line && !!line, id: now,
    };
    visitRef.current = v;
    setVisit(v);
    for (const step of EGG_TIMELINES[k]) {
      if (step.at === 0) continue;
      const t = setTimeout(() => {
        if (!visitRef.current || visitRef.current.id !== v.id) return;
        if (step.end) { endVisit(); return; }
        const next = { ...visitRef.current, phase: step.phase, pose: step.pose, showLine: !!step.line && !!visitRef.current.line };
        visitRef.current = next;
        setVisit(next);
      }, step.at);
      timersRef.current.push(t);
    }
  };

  /* A click on her during a speaking pause: the reaction beat,
     then she leaves politely. It is not a dismissal. */
  const onFigureClick = () => {
    const v = visitRef.current;
    if (!v) return;
    if (!(EGG_SPEAK_PHASES[v.kind] || []).includes(v.phase)) return;
    clearTimers();
    const beat = { ...v, pose: "pleased", showLine: false };
    visitRef.current = beat;
    setVisit(beat);
    const t = setTimeout(() => {
      if (!visitRef.current || visitRef.current.id !== v.id) return;
      if (v.kind === "swim" || v.kind === "celebrate") {
        const exit = { ...visitRef.current, phase: "exit" };
        visitRef.current = exit;
        setVisit(exit);
        const t2 = setTimeout(() => endVisit(), 1500);
        timersRef.current.push(t2);
      } else {
        endVisit();
      }
    }, 900);
    timersRef.current.push(t);
  };

  /* Session bookkeeping and the ambient rolls: one slow
     interval while the tab is visible, plus route signals. */
  useEffect(() => {
    const sid = eggSessionId();
    const store = loadEggStore();
    const prevSessionHadEgg = !!(
      store.sessionId && store.sessionId !== sid &&
      store.lastEggSessionId && store.lastEggSessionId === store.sessionId
    );
    sessionRef.current = { id: sid, hadEgg: false, prevSessionHadEgg };
    if (store.sessionId !== sid) {
      store.sessionId = sid;
      saveEggStore(store);
    }
    const check = () => {
      if (visitRef.current) return;
      if (typeof document !== "undefined" && document.hidden) return;
      const s = loadEggStore();
      const ctx = probeEggContext();
      if (!eggEligible(s, ctx, sessionRef.current, Date.now())) return;
      if (Math.random() > EGG_AMBIENT_CHANCE) return;
      startVisit(Math.random() < 0.7 ? "swim" : "peek");
    };
    const first = setTimeout(check, 20000);
    const iv = setInterval(check, EGG_TICK_MS);
    const onVis = () => { if (!document.hidden) check(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("popstate", check);
    window.addEventListener("hashchange", check);
    return () => {
      clearTimeout(first);
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("popstate", check);
      window.removeEventListener("hashchange", check);
      clearTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* The summon: three quick clicks on the wordmark, either the
     masthead's or the sidebar brand's. Not written down in the
     app anywhere, on purpose. */
  useEffect(() => {
    const onClick = (e) => {
      const t = e.target;
      if (!t || !t.closest) return;
      let hit = false;
      try { hit = !!t.closest('.cb-stage-masthead, [aria-label="Back to landing page"]'); } catch { hit = false; }
      if (!hit) return;
      const res = countWordmarkClick(clickRef.current, Date.now());
      clickRef.current = res;
      if (!res.summoned) return;
      if (visitRef.current) return;
      if (eggBlocked(probeEggContext())) return;
      startVisit("summon");
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* The celebration cue from the learning view. */
  useEffect(() => {
    const onCelebrate = () => {
      if (visitRef.current) return;
      if (!eggCelebrateEligible(loadEggStore(), probeEggContext(), Date.now())) return;
      startVisit("celebrate");
    };
    window.addEventListener("nova-egg-celebrate", onCelebrate);
    return () => window.removeEventListener("nova-egg-celebrate", onCelebrate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Escape dismisses her, and counts as a dismissal. */
  useEffect(() => {
    if (!visit) return;
    const onKey = (e) => { if (e.key === "Escape") dismissVisit(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visit]);

  if (!visit) return null;
  const speaking = (EGG_SPEAK_PHASES[visit.kind] || []).includes(visit.phase);
  const bubbles = (visit.phase === "cross" || visit.phase === "enter") && visit.kind !== "still"
    ? [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
      <span key={i} className="ne-bub" style={{
        left: 6 + (i % 3) * 9,
        bottom: 18 + (i % 4) * 13,
        width: 4 + (i % 4) * 2,
        height: 4 + (i % 4) * 2,
        animationDuration: (2.6 + (i % 5) * 0.7) + "s",
        animationDelay: (i * 0.55) + "s",
      }} />
    ))
    : null;
  return (
    <div className="ne-stage" aria-hidden={!visit.line}>
      <style>{EGG_CSS}</style>
      {(visit.kind === "swim" || visit.kind === "celebrate") && <div className="ne-shimmer" />}
      <div
        className={"ne-rig ne-" + visit.kind + " ne-ph-" + visit.phase + (speaking ? " ne-rig-live" : "")}
        onClick={onFigureClick}
      >
        <div className="ne-shadow" />
        <div className="ne-bob">
          <div className="ne-roll">
            <EggFigure pose={visit.pose} size={EGG_SIZES[visit.kind] || 140} />
          </div>
        </div>
        {bubbles}
        {visit.showLine && visit.line && (
          <div className="ne-bubble" role="status">
            <span className="ne-bubble-tail" />
            {visit.line}
            <button type="button" className="ne-bubble-x" aria-label="Dismiss Nova" onClick={(e) => { e.stopPropagation(); dismissVisit(); }}>
              ✕
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
