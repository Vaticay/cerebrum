/* ── Nova, app wide: the Easter egg (egg wave, 2026-10-14) ──────
   Nova belongs to the learning view, but she is the product's
   character, so rarely, and only when nothing important is
   happening, she visits the rest of the app as a still
   appearance in the corner, and a path completion earns the
   same still visit with a pleased line. There is one
   deliberate secret: three quick clicks on the Cerebrum
   wordmark summon her. It is written down nowhere in the app.
   The swim, the peek, the bubbles, the shimmer and the roll
   retired on 2026-10-18 (design audit M49): her life is in
   her expression and her voice, never in travel or stickers.

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
   retired with the raster poses). */
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
   lesson, a call, a checkout, a hidden tab, or a screen where
   she already lives (one Nova per screen: a visit never stands
   beside a resident figure of her). */
export function eggBlocked(ctx) {
  const c = ctx || {};
  return !!(c.hidden || c.typing || c.inLesson || c.inCall || c.inCheckout || c.novaResident);
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
   already renders: a lesson is its feedback sheet (.lv-sheet)
   or the lesson Player's labelled dialog, a call is its named dialog or a live video in a fixed frame,
   a checkout is a dialog talking about Pro or subscribing, and
   typing is an editable element holding focus. Best effort by
   design: a missed signal only ever costs an appearance. */
function probeEggContext() {
  const ctx = { hidden: true, typing: false, inLesson: false, inCall: false, inCheckout: false, novaResident: false };
  try {
    ctx.hidden = !!document.hidden;
    const ae = document.activeElement;
    if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT" || ae.isContentEditable)) ctx.typing = true;
    if (document.querySelector(".lv-sheet")) ctx.inLesson = true;
    /* The whole lesson, not just its feedback sheet (2026-10-26,
       Nova perfection pass): .lv-sheet exists only while an
       answered card's sheet is open, but the lesson Player is on
       screen from the first card to the completion screen, with
       its own Nova figure in the header the whole time. The
       Player's root is a dialog labelled for the lesson or the
       completion, so that label is the marker. Without it she
       could visit over a live lesson and stand beside the
       Player's Nova, and her celebration visit could land next
       to the completion screen's own figure. */
    if (!ctx.inLesson) {
      const allDialogs = document.querySelectorAll('[role="dialog"]');
      for (let i = 0; i < allDialogs.length; i++) {
        const label = allDialogs[i].getAttribute("aria-label") || "";
        if (label.startsWith("Lesson:") || label.startsWith("Course complete:")) { ctx.inLesson = true; break; }
      }
    }
    /* The learning home carries a resident Nova on every tab
       (the header figure, or her stage on Today), tour included:
       the .lv-home root is in the DOM whenever she lives there,
       so a visit to that screen would double her. */
    if (document.querySelector(".lv-home")) ctx.novaResident = true;
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
.ne-rig { position: absolute; pointer-events: none; }
.ne-rig-live { pointer-events: auto; cursor: pointer; }
.ne-shadow { position: absolute; left: 12%; right: 12%; bottom: -13px; height: 15px; border-radius: 50%; background: rgba(0,0,0,0.35); filter: blur(7px); }
.ne-bubble { position: absolute; bottom: calc(100% + 10px); left: 50%; transform: translateX(-50%); width: max-content; max-width: 290px; background: #FDF3D7; color: #1A1A1A; border: 1px solid rgba(26,26,26,0.16); border-radius: 2px; padding: 11px 48px 11px 14px; font-size: 14.5px; line-height: 1.5; pointer-events: auto; box-shadow: none; animation: neBubbleIn 0.35s var(--cb-ease) both; }
@keyframes neBubbleIn { from { opacity: 0; transform: translateX(-50%) translateY(6px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
.ne-bubble-tail { position: absolute; bottom: -7px; left: 50%; margin-left: -7px; width: 13px; height: 13px; background: #FDF3D7; border-right: 1px solid rgba(26,26,26,0.16); border-bottom: 1px solid rgba(26,26,26,0.16); transform: rotate(45deg); }
/* The close hit area is 44px (phase 2 fitted polish,
   2026-10-28), the same area the sidebar pop and the sheet
   dismiss carry; the glyph size is unchanged, and the bubble
   padding above reserves the wider box. The 28px box it
   replaces sat under every tap floor on the site. */
.ne-bubble-x { position: absolute; top: 0; right: 0; width: 44px; height: 44px; background: none; border: none; color: #6E675C; cursor: pointer; font-size: 12px; line-height: 1; display: inline-flex; align-items: center; justify-content: center; }
/* The celebration visit is a still visit too: she fades in
   at the corner, pleased, says her line, and fades out. */
.ne-celebrate { right: 22px; bottom: 22px; }
.ne-celebrate.ne-ph-show { animation: neStillIn 0.6s var(--cb-ease) both; }
.ne-celebrate.ne-ph-leave { animation: neStillOut 0.7s var(--cb-ease) both; }
/* The summon entrance: she rises in the middle and stays to talk. */
.ne-summon { left: 50%; bottom: 5%; }
.ne-summon.ne-ph-rise { animation: neSummonRise 1.6s var(--cb-ease) both; }
@keyframes neSummonRise {
  0% { transform: translateX(-50%) translateY(72%) scale(0.86); opacity: 0; }
  22% { transform: translateX(-50%) translateY(78%) scale(0.87); opacity: 1; }
  76% { transform: translateX(-50%) translateY(-3%) scale(1.01); opacity: 1; }
  100% { transform: translateX(-50%) translateY(0) scale(1); opacity: 1; }
}
.ne-summon.ne-ph-speak { transform: translateX(-50%) translateY(0); }
.ne-summon.ne-ph-leave { animation: neSummonLeave 1.8s var(--cb-ease) both; }
@keyframes neSummonLeave {
  0% { transform: translateX(-50%) translateY(0); opacity: 1; }
  100% { transform: translateX(-50%) translateY(46%); opacity: 0; }
}
/* The still visit, for quiet motion settings: she fades in at
   the corner, says her line, fades out. No travel, no particles. */
.ne-still { right: 22px; bottom: 22px; }
.ne-still.ne-ph-show { animation: neStillIn 0.6s var(--cb-ease) both; }
@keyframes neStillIn { from { opacity: 0; } to { opacity: 1; } }
.ne-still.ne-ph-leave { animation: neStillOut 0.7s var(--cb-ease) both; }
@keyframes neStillOut { from { opacity: 1; } to { opacity: 0; } }
/* Phone fit (phase 2 fitted polish, 2026-10-28): the corner
   visits sit 22px off the right edge, and a bubble centered on
   the figure at its 290px cap ran past a 360px screen, where
   the stage's hidden overflow clipped its right half. At
   phone widths the corner bubbles anchor to the figure's
   right edge instead and cap inside the viewport; the tail
   moves to stay over the figure. The centered summon bubble
   is untouched: the middle of the screen has room for it. */
@media (max-width: 480px) {
  .ne-celebrate .ne-bubble, .ne-still .ne-bubble { left: auto; right: -4px; transform: none; max-width: calc(100vw - 40px); animation-name: neBubbleInEdge; }
  .ne-celebrate .ne-bubble-tail, .ne-still .ne-bubble-tail { left: auto; right: 52px; margin-left: 0; }
  @keyframes neBubbleInEdge { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
}
@media (prefers-reduced-motion: reduce) {
  .ne-rig, .ne-bubble { animation: none !important; }
}
`;

/* Timelines: phase steps per kind, milliseconds from the start
   of the visit. The pose rides along with the phases; the line
   shows during the speaking phases. */
const EGG_TIMELINES = {
  celebrate: [
    { at: 0, phase: "show", pose: "pleased", line: true },
    { at: 5800, phase: "leave", pose: "pleased" },
    { at: 6600, end: true },
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

const EGG_SIZES = { celebrate: 120, summon: 168, still: 120 };
const EGG_SPEAK_PHASES = { celebrate: ["show"], summon: ["speak"], still: ["show"] };

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
      const wantLine = true;
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
      endVisit();
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
      startVisit("still");
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
  return (
    <div className="ne-stage" aria-hidden={!visit.line}>
      <style>{EGG_CSS}</style>
      <div
        className={"ne-rig ne-" + visit.kind + " ne-ph-" + visit.phase + (speaking ? " ne-rig-live" : "")}
        onClick={onFigureClick}
      >
        <div className="ne-shadow" />
        <EggFigure pose={visit.pose} size={EGG_SIZES[visit.kind] || 140} />
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
