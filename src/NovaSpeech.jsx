/* ── Nova's speech, unified (2026-10-15) ─────────────────────
   One controller owns everything Nova says out loud: which line
   is up, whose it is, how long it stays, and how her mouth
   moves while it is up. This module replaces three fragmented
   surfaces that each had their own gate and their own bubble:
   NovaLive's private line state in LearnView, the tip gate
   behind NovaTip, and the quip engine inside NovaRive.jsx,
   whose isTalking feed only ever moved her mouth for quips,
   never for her brain lines or her lesson lines.

   What lives here:
   - The arbitration, as pure functions over a plain state
     object (createSpeechState, speechOffer, speechAdvance,
     speechDismiss), so the temperament rules are testable
     without a DOM: one line at a time page wide, a 60 second
     global gap for ambient lines, per category cooldowns for
     categorized offers (chance rolls retired 2026-10-29),
     typing suppression
     with a single exception (lesson feedback, which the
     learner caused), and a priority order in which caused
     lines (lesson, poke, search) outrank ambient ones (brain,
     tip, quip) and may preempt them, never the reverse.
   - The speech rhythm, also pure (speechPlanFor,
     speechTalkingAt): a line's text becomes a plan of mouth
     bursts separated by pauses at its own punctuation, so her
     mouth moves in phrases, not on a metronome, and stops
     shortly after the bubble leaves.
   - Line timing (speechDurationFor): display time scales with
     line length at a reading pace, clamped, replacing the old
     fixed 3.2 second quip and 3.6 second brain line timers.
   - useNovaSpeech, the hook every surface shares, backed by a
     module level store so two mounted Novas can never speak
     over each other, and NovaBubble, the one bubble component.

   ── INTEGRATION CONTRACT (the follow up pass, mechanical) ──
   This module is deliberately not imported by the app yet.
   The integration pass wires it in by these replacements:

   src/NovaRive.jsx
   1. Delete the quip engine block: the module gate variables
      (novaQuipLastAt, novaQuipActiveToken, novaQuipCategoryAt,
      novaQuipTokenSeq), userIsTyping, and the whole
      useNovaQuips function (the block from the comment "The
      quip engine" through the end of useNovaQuips). The pure
      helpers and the bank stay: NovaSpeech imports
      NOVA_QUIP_BANK, QUIP_CATEGORY_COOLDOWN_MS, and
      quipCategoryForRiveEvent from this file. (The chance
      table the original contract also named was deleted
      2026-10-29: chance no longer decides speech.)
   2. In NovaCanvas, replace the internal
      call `const quips = useNovaQuips({...})` with a new prop:
      both surfaces receive `speech` (a controller created by
      their caller with useNovaSpeech) and read speech.current,
      speech.talking, speech.dismiss, speech.handleRiveEvent.
   3. In NovaCanvas, the isTalking feed (the effect setting
      talkingIn.value from quips.talking) reads speech.talking
      instead. That one line is what makes her mouth move for
      brain lines and lesson lines, not only quips.
   4. The appState and quizState transition effects that used
      to live inside useNovaQuips move to the owners: NovaLive
      and SheetNova call speech.offerCategory with
      searchCategoryForState and quizCategoryForState results
      when their states change.
   5. Delete QuipBubble and the NV_BUBBLE constants. Both
      surfaces render, when speech.current exists:
      <NovaBubble text={speech.current.text} variant="header"
        onDismiss={speech.dismiss} /> inside the same anchor
      span that carries the figure.
   6. QUIP_SHOW_MS is retired. Display duration comes from
      speechDurationFor inside the controller.

   src/LearnView.jsx
   7. NovaLive: delete the pokeLine and brainLine state, the
      lineTimer and brainLineTimer refs, and the bubble JSX at
      the end of NovaLive (the block rendering bubbleLine in a
      cream span). NovaLive creates the controller with
      useNovaSpeech, passes speech into its NovaRive (replacing
      the lineBusy prop), renders NovaBubble variant "header"
      for speech.current, routes the brain's "line" behavior
      through speech.say({ source: "brain", text }), and routes
      the poke ladder's line through
      speech.say({ source: "poke", text: step.line }).
   8. SheetNova and the Player: the opinion line from
      opinionForEvent and any verdict line are offered through
      a controller SheetNova owns and passes to its NovaRive:
      speech.say({ source: "lesson", text }). The lesson
      completion screen's NOVA_LESSON_DONE_LINES pick goes
      through say({ source: "lesson", text }) the same way.
   9. NovaTip and useNovaTip: keep the seen storage and the
      per tip eligibility (tipEligible and repeatAfterMs). The
      module gate (novaTipActiveId, novaTipLastShownAt,
      TIP_GAP_MS arbitration) goes away: a tip claims the page
      stage through the controller with
      speech.say({ source: "tip", text }) and shows only while
      it owns speech.current; dismiss calls speech.dismiss and
      still records the tip as seen.
   10. LearnView's internal NovaSpeech bubble component (the
       flex row with the companion figure) is replaced by
       NovaBubble variant "sheet". The name is free once that
       component is gone; this module is why it has to go.
   11. NovaEgg: lines picked by pickEggLine surface through
       say({ source: "brain", text }) wherever the egg shows a
       line beside a figure.
   12. The unexported brain line sets in LearnView
       (NOVA_EGG_LINES, NOVA_GAG_LINES, NOVA_LATE_LINES,
       NOVA_MORNING_LINES, the poke ladder lines) get exported
       and join NOVA_SPEECH_BANKS below, so every line she can
       say is consumable from this one module.

   src/NovaSidebarPop.jsx: unchanged in the integration pass.
   It renders NovaRive with quips off and keeps its own bubble
   on its own five second timeline; routing its line through
   the controller is a later decision, not part of this wiring.
   (Superseded 2026-10-29, the dialog spec Lane 1: the pop and
   the egg now render the shared NovaBubble and price their
   lines by the shared reading time law below; their visits,
   budgets, and blocked contexts stay their own.)

   Also: add "nova-speech.mjs" to the suite list in tests/run.

   Status (2026-10-15): items 1 to 10 and 12 landed, and the
   pop was checked against the controller (it passes no speech
   prop, so it cannot double speak). Item 11 is the one piece
   left: NovaEgg still runs its own visit timelines and its
   own bubble, and wiring it through the controller is a
   follow up pass of its own. The tests/run suite list could
   not take nova-speech.mjs in this pass because wave 16 has
   the file mid edit; the module tests run standalone until
   that lands.

   Dialog spec Lane 1 (2026-10-29): every offer now carries a
   cause record (trigger, surface, subject) and an offer with
   no cause is denied by construction; the trigger list is
   closed (SPEECH_TRIGGERS below); chance no longer decides
   speech anywhere (the category chance table is deleted, and
   a roll, where one survives at a call site, only chooses
   among equally fitting wordings); search lines are judged
   for staleness at promotion against their cause record, not
   by a clock; dismissal is scoped to the dismissed line's
   cause instead of clearing the whole queue; and a line that
   names an action carries that action as a button in the
   bubble. She is the resident intelligence of the product:
   caused lines are briefings from an operator who knows the
   place and the learner's work, so wording selection prefers
   the variant that references the work the cause names.
   ──────────────────────────────────────────────────────────── */

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  NOVA_QUIP_BANK,
  QUIP_CATEGORY_COOLDOWN_MS,
  quipCategoryForRiveEvent,
} from "./NovaRive.jsx";
import {
  NOVA_SUMMON_LINES,
  NOVA_CELEBRATE_LINES,
  NOVA_LESSON_DONE_LINES,
  NOVA_EGG_LINES,
  NOVA_GAG_LINES,
  NOVA_LATE_LINES,
  NOVA_MORNING_LINES,
  NOVA_POKE_LINES,
  pickNovaLine,
} from "./LearnView.jsx";
import { FONT_SIZES, RADIUS } from "./designSystem.jsx";
import { useWindowWidth } from "./appUtils.js";

/* The line banks, consumable from here. The quip bank is the
   one in NovaRive.jsx, re exported untouched: her wording is
   settled and this module does not rewrite a single line. The
   brain banks from LearnView join it, including the sets that
   were unexported until integration day (contract item 12):
   the egg lines, the gag, the late night and morning sets,
   and the poke ladder lines.
   The values are getters, not plain reads, on purpose: this
   module sits in an import cycle (NovaRive imports the
   bubble from here, LearnView imports the hook from here,
   and this file imports banks from both). A plain read at
   module scope would hit the cycle mid evaluation and throw
   on whichever side loads first; a getter resolves on first
   use at runtime, when every module is fully evaluated. */
export { NOVA_QUIP_BANK };
export const NOVA_SPEECH_BANKS = {
  get quips() { return NOVA_QUIP_BANK; },
  get summon() { return NOVA_SUMMON_LINES; },
  get celebrate() { return NOVA_CELEBRATE_LINES; },
  get lessonDone() { return NOVA_LESSON_DONE_LINES; },
  get egg() { return NOVA_EGG_LINES; },
  get gag() { return NOVA_GAG_LINES; },
  get late() { return NOVA_LATE_LINES; },
  get morning() { return NOVA_MORNING_LINES; },
  get poke() { return NOVA_POKE_LINES; },
};

/* ── Sources and priority ─────────────────────────────────────
   Every line she says has a source, and the source decides
   how the gate treats it. Caused lines answer something the
   learner just did: lesson feedback, a poke, a search landing.
   Ambient lines are her own initiative: brain lines, teaching
   tips, quips. Caused lines outrank ambient ones, may preempt
   an ambient line already up, queue behind a caused line, and
   ignore the ambient gap. Ambient lines never interrupt
   anything and wait out the gap. */
export const SPEECH_PRIORITY = {
  lesson: 100,
  poke: 90,
  search: 80,
  brain: 50,
  tip: 40,
  quip: 10,
};
export const SPEECH_CAUSED_SOURCES = ["lesson", "poke", "search"];

/* ── Cause records and the closed trigger list (2026-10-29,
   dialog spec Lane 1) ────────────────────────────────────────
   Silence is the default. She speaks when something has
   happened that a line can be about, and every offer carries
   the record of that something: the trigger name, the surface
   it happened on, and the subject it is about (a card's
   context key, a search's identity, a path or object id, a
   tip id). An offer with no cause is denied by construction,
   not by a roll. The trigger list is closed: a new trigger is
   a spec change, not a build lane improvisation. Ambient
   quips as a free floating trigger are deleted; the quip bank
   stays as wording for the caused triggers whose categories
   fit. She does not narrate a search starting, so there is
   deliberately no search starting trigger. */
export const SPEECH_TRIGGERS = [
  "search-landed",
  "search-failed",
  "lesson-verdict",
  "lesson-complete",
  "poke",
  "path-complete",
  "shelf-object",
  "reviews-due",
  "tip-first-appearance",
  "memory-screen-fact",
  "hour-arrival",
];

/* Normalize an offer's cause record, or return null when the
   record is missing or incomplete. The subject is stringified
   so numeric ids (a search stamp, a count) compare cleanly. */
export function speechCauseOf(offer) {
  const c = offer && typeof offer === "object" ? offer.cause : null;
  if (!c || typeof c !== "object") return null;
  const trigger = typeof c.trigger === "string" ? c.trigger : "";
  const surface = typeof c.surface === "string" ? c.surface : "";
  const subject = c.subject == null ? "" : String(c.subject);
  if (!trigger || !surface || !subject) return null;
  if (SPEECH_TRIGGERS.indexOf(trigger) === -1) return null;
  return { trigger, surface, subject };
}

/* Is a queued line's cause still live? Judged per kind, the
   same rules speechAdvance applies at promotion: a lesson
   line lives while its card is the stage's context, a search
   line lives while its search is still the most recent
   completed one and the learner is still on the search
   surface, a poke line lives inside its start TTL. Used by
   the scoped dismissal: a caused line whose cause is still
   live survives a dismissal of something else. env carries
   { now, latestSearch, onSearchSurface } from the hook. */
export function speechCauseLive(line, state, env) {
  if (!line || typeof line !== "object") return false;
  const e = env && typeof env === "object" ? env : {};
  const s = state && typeof state === "object" ? state : {};
  if (line.source === "lesson") {
    return !!(line.contextKey && s.contextKey && line.contextKey === s.contextKey);
  }
  if (line.source === "search") {
    return !!(line.cause && e.latestSearch && line.cause.subject === e.latestSearch && e.onSearchSurface !== false);
  }
  if (line.source === "poke") {
    if (line.ttlMs == null) return true;
    const now = typeof e.now === "number" ? e.now : null;
    if (now == null || typeof line.queuedAt !== "number") return false;
    return now - line.queuedAt <= line.ttlMs;
  }
  return false;
}

/* The 60 second global gap, the same number the quip engine's
   QUIP_MIN_GAP_MS and the tip gate's TIP_GAP_MS each kept
   privately. One number now, and it binds ambient lines only. */
export const SPEECH_MIN_GAP_MS = 60000;
/* How many caused lines may wait their turn. Reactions are
   perishable; a longer queue would have her commenting on a
   moment that has already passed. */
export const SPEECH_QUEUE_MAX = 3;

/* Which source a categorized offer speaks with. The search
   categories are reactions to a search landing, the quiz
   categories are reactions inside a lesson, and the idle
   categories are ambient garnish. */
export function speechSourceForCategory(category) {
  if (category === "searching" || category === "highConfidence" || category === "preprintWarning") return "search";
  if (category === "quizThinking" || category === "quizCorrect" || category === "quizStreak" || category === "quizWrong") return "lesson";
  return "quip";
}

/* ── Line timing ──────────────────────────────────────────────
   Display time from length, at a reading pace: a base beat so
   even a two word line registers, 55ms per character (about
   eighteen characters a second), clamped between 2.4 and 9
   seconds. The old fixed timers (3.2s for every quip, 3.6s
   for every brain line) cut long lines off mid read and
   lingered on short ones. */
export const SPEECH_DISPLAY_BASE_MS = 900;
export const SPEECH_READ_MS_PER_CHAR = 55;
export const SPEECH_DISPLAY_MIN_MS = 2400;
export const SPEECH_DISPLAY_MAX_MS = 9000;

export function speechDurationFor(text) {
  const len = typeof text === "string" ? text.trim().length : 0;
  const raw = SPEECH_DISPLAY_BASE_MS + len * SPEECH_READ_MS_PER_CHAR;
  return Math.max(SPEECH_DISPLAY_MIN_MS, Math.min(SPEECH_DISPLAY_MAX_MS, raw));
}

/* How long a queued perishable line may wait for the stage
   before it is dropped instead of spoken late, out of
   context (2026-10-29, the outside audit's staleness fix).
   Poke reactions are the perishable kind: a poke line that
   had to wait behind a lesson line is a comment on a moment
   that has passed by the time the stage frees up. Lesson
   lines carry no TTL; they are bound to their card by the
   context key instead (see speechSetContext below). */
export const SPEECH_QUEUED_TTL_MS = 2000;

/* The one dash sanitizer (2026-10-29, the outside audit's
   unverified item, verified real). The owner's law is no
   dash characters in anything she says, and the authored
   banks obey it, but not every line she speaks is authored:
   her lesson feedback is assembled from card text, and
   generated course cards are built from claims extracted
   verbatim out of model answer prose, where hyphenated
   compounds, numeric ranges, and negative numbers are
   routine scientific writing. No stage of that path removed
   a dash. So every line passes through here at the
   controller, whatever its source: a hyphen between letters
   becomes a space, a dash inside a numeric range becomes
   the word to, a minus sign on a number becomes the word
   minus, and any dash character left over becomes a space.
   The spoken words survive; the punctuation the owner
   banned does not. */
export function speechSanitizeText(text) {
  if (typeof text !== "string") return "";
  let t = text;
  /* The dash family, by code point so this file carries no
     literal dash of its own: U+002D hyphen minus, U+2010
     through U+2015 (hyphen, dashes, horizontal bar), and
     U+2212 minus sign. */
  t = t.replace(/(\d)\s*[-\u2010-\u2015]\s*(?=\d)/g, "$1 to ");
  t = t.replace(/(^|[\s(])[-\u2212](?=\d)/g, "$1minus ");
  t = t.replace(/([A-Za-z])[-\u2010](?=[A-Za-z])/g, "$1 ");
  t = t.replace(/[-\u2010-\u2015\u2212]/g, " ");
  return t.replace(/\s+/g, " ").replace(/\s+([,.!?;:])/g, "$1").trim();
}

/* ── The speech rhythm ────────────────────────────────────────
   Her mouth plan for one line, derived from the text itself.
   The text splits into clauses at its punctuation: a comma,
   semicolon, or colon earns a short pause, a sentence end a
   longer one, and a clause too long for one breath splits
   with a breath pause. Each clause speaks as one burst of
   mouth cycles at a base 38ms per character (faster than the
   reading pace, because the mouth is stylized), clamped so a
   burst is never shorter than a visible 240ms nor longer than
   2.4 seconds unbroken. The plan is deterministic: the same
   line always gets the same rhythm. */
export const SPEECH_SPEAK_MS_PER_CHAR = 38;
export const SPEECH_BURST_MIN_MS = 240;
export const SPEECH_BURST_MAX_MS = 2400;
export const SPEECH_PAUSE_CLAUSE_MS = 150;
export const SPEECH_PAUSE_SENTENCE_MS = 320;
export const SPEECH_PAUSE_BREATH_MS = 120;
/* Her mouth may run this far past the bubble leaving, so a
   line whose speech plan outlasts its clamped display time
   still finishes its last phrase instead of freezing shut. */
export const SPEECH_TAIL_MS = 150;

/* Cadence variation (2026-10-15, the voice overhaul): the
   flat rate above was half of why she sounded like a robot.
   Every line now carries a cadence profile, hashed from its
   own text so the same line always earns the same rhythm
   and the tests stay stable:
   - a per line rate inside a narrow band around the base,
     so no two lines tick at quite the same speed;
   - a longer beat before a short final clause, the setup
     and punch rhythm of a person landing a point;
   - quicker runs inside long lines, where she gets a
     little excited about the material and stops enunciating
     like an announcement. */
export const SPEECH_CADENCE_MIN = 0.96;
export const SPEECH_CADENCE_MAX = 1.08;
export const SPEECH_PAUSE_PUNCH_MS = 560;
export const SPEECH_PUNCH_MAX_CHARS = 28;
export const SPEECH_EXCITED_MIN_CHARS = 160;
export const SPEECH_EXCITED_FACTOR = 0.85;

export function speechCadenceFor(text) {
  const clean = typeof text === "string" ? text.trim() : "";
  let h = 2166136261;
  for (let i = 0; i < clean.length; i++) {
    h ^= clean.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const t = ((h >>> 0) % 1000) / 1000;
  let factor = SPEECH_CADENCE_MIN + t * (SPEECH_CADENCE_MAX - SPEECH_CADENCE_MIN);
  if (clean.length >= SPEECH_EXCITED_MIN_CHARS) factor *= SPEECH_EXCITED_FACTOR;
  return factor;
}

export function speechPlanFor(text) {
  const clean = typeof text === "string" ? text.trim() : "";
  const bursts = [];
  if (!clean) return { bursts, speechEndMs: 0 };
  const rate = SPEECH_SPEAK_MS_PER_CHAR * speechCadenceFor(clean);
  /* Split into segments, each ending at a punctuation mark
     that stays attached to its own segment. */
  const segments = [];
  let seg = "";
  let segEnd = "clause";
  for (const ch of clean) {
    seg += ch;
    if (ch === "." || ch === "?" || ch === "!") { segments.push({ text: seg, end: "sentence" }); seg = ""; }
    else if (ch === "," || ch === ";" || ch === ":") { segments.push({ text: seg, end: "clause" }); seg = ""; }
  }
  if (seg.trim()) segments.push({ text: seg, end: "end" });
  let cursor = 0;
  segments.forEach((segment, i) => {
    let remaining = segment.text.trim().length;
    const charsPerBurst = Math.max(1, Math.floor(SPEECH_BURST_MAX_MS / rate));
    while (remaining > 0) {
      const burstChars = Math.min(remaining, charsPerBurst);
      const burstMs = Math.max(SPEECH_BURST_MIN_MS, Math.min(SPEECH_BURST_MAX_MS, Math.round(burstChars * rate)));
      bursts.push({ startMs: cursor, endMs: cursor + burstMs });
      cursor += burstMs;
      remaining -= burstChars;
      if (remaining > 0) cursor += SPEECH_PAUSE_BREATH_MS;
    }
    if (i < segments.length - 1) {
      let pause = segment.end === "sentence" ? SPEECH_PAUSE_SENTENCE_MS : SPEECH_PAUSE_CLAUSE_MS;
      /* The punch beat: a short final clause lands after a
         longer held pause, not the standard one. */
      if (i === segments.length - 2 && segments[i + 1].text.trim().length <= SPEECH_PUNCH_MAX_CHARS) {
        pause = Math.max(pause, SPEECH_PAUSE_PUNCH_MS);
      }
      cursor += pause;
    }
  });
  return { bursts, speechEndMs: bursts.length ? bursts[bursts.length - 1].endMs : 0 };
}

/* Is her mouth moving at this instant? Inside a burst, yes;
   in a pause, no; past the plan, no, unless the plan outlasts
   the bubble, in which case she finishes inside the tail
   allowance and then stops for good. */
export function speechTalkingAt(plan, elapsedMs, durationMs) {
  if (!plan || typeof elapsedMs !== "number" || elapsedMs < 0) return false;
  const limit = (typeof durationMs === "number" ? durationMs : 0) + SPEECH_TAIL_MS;
  if (elapsedMs > limit) return false;
  if (elapsedMs <= plan.speechEndMs) {
    return plan.bursts.some((b) => elapsedMs >= b.startMs && elapsedMs < b.endMs);
  }
  return plan.speechEndMs > (typeof durationMs === "number" ? durationMs : 0);
}

/* Pick a line from any bank the way the quip engine picked
   from hers: seeded, and never the line that bank showed last
   when it has another to give. (NovaRive's pickQuipLine does
   the same job for the quip bank by category; this one takes
   the bank itself, so brain and lesson banks pick the same
   way.) */
export function pickSpeechLine(lines, seed = 0, avoid = null, prefer = null) {
  if (!Array.isArray(lines) || !lines.length) return null;
  /* Wording preference (2026-10-29, dialog spec Lane 1): the
     cause is judged first and earns the wording; the pick then
     prefers the variants that fit the cause. prefer is either
     a predicate over a line, or the word "brief", which keeps
     the shorter half of the bank (a search reaction should be
     a short line; a teaching line may run long because the
     sheet holds it). This is the only place a choice among
     wordings happens: chance never decides whether she
     speaks, it only ever chooses among equally fitting
     wordings, and here even that choice is seeded, not rolled.
     The Cortana framing rides the same rule: where a bank
     offers both a garnish wording and a briefing wording for
     the same caused trigger, callers pass a predicate that
     keeps the briefing variants, the ones that reference the
     work the cause names. */
  let pool = lines;
  if (typeof prefer === "function") {
    const kept = lines.filter(prefer);
    if (kept.length) pool = kept;
  } else if (prefer === "brief" && lines.length > 1) {
    const sorted = lines.slice().sort((a, b) => String(a).length - String(b).length);
    const kept = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2)));
    if (kept.length && kept.length < lines.length) pool = kept;
  }
  let i = Math.abs(Math.floor(seed || 0)) % pool.length;
  if (pool.length > 1 && pool[i] === avoid) i = (i + 1) % pool.length;
  return pool[i];
}

/* ── The arbitration ──────────────────────────────────────────
   The gate as pure functions over a plain state object, the
   pattern the quirks engine's pokeStep and opinionForEvent
   already use: the caller owns the state, the functions never
   mutate what they are handed, and every decision comes back
   as data (shown, queued, or denied, with the reason) so the
   tests can pin the temperament exactly.

   state = {
     current: null | line,   the line on stage
     queue: [line, ...],     caused lines waiting, FIFO
     lastAnyAt: 0,           when any line last took the stage
     categoryAt: {},         category, when it last showed
     lastByCategory: {},     category, the text it last showed
     seq: 0,                 line id counter
     contextKey: null,       the context lines on this stage
                             belong to (a lesson card, today),
                             set by the owner through
                             speechSetContext
     dismissals: 0,          lines dismissed this session
     quietSession: false,    two dismissals asked for quiet:
                             ambient and arrival lines stop for
                             the session, caused lines still
                             answer (2026-10-29)
   }
   line = { id, text, source, category, owner, shownAt,
            durationMs, plan, contextKey, queuedAt, ttlMs,
            cause, action }

   offer = { text?, category?, source?, owner?, seed?,
             contextKey?, cause, action?, prefer? }
   Every offer carries a cause record (see speechCauseOf);
   an offer with no cause is denied. A categorized offer with
   no text picks from the bank in env.tables; a direct offer
   carries its text and no category. Categorized temperament
   is the per category cooldown only, restated as a wording
   and family discipline: a true cause can recur faster than
   good manners allow. Chance decides nothing (2026-10-29):
   the chance table is deleted, and wording choice among
   equally fitting variants is the seeded pick in
   pickSpeechLine, steered by the offer's prefer rule.

   env = { now, typing = false, tables = null,
           latestSearch = undefined, onSearchSurface = true }
   tables = { lines: { category: [text, ...] },
              cooldowns: { category: ms } } */
export function createSpeechState() {
  return { current: null, queue: [], lastAnyAt: 0, categoryAt: {}, lastByCategory: {}, seq: 0, contextKey: null, dismissals: 0, quietSession: false };
}

function speechIsCaused(source) {
  return SPEECH_CAUSED_SOURCES.indexOf(source) !== -1;
}

function speechShow(state, offer, source, text, now) {
  const id = state.seq + 1;
  const plan = speechPlanFor(text);
  const line = {
    id,
    text,
    source,
    category: offer.category || null,
    owner: offer.owner || null,
    contextKey: offer.contextKey || null,
    cause: speechCauseOf(offer),
    /* A line that names an action carries that one action
       (2026-10-29): the bubble renders it as a text button,
       pressing it does the action and ends the line. The
       action is { label, onAction }; a line naming no action
       carries none and renders no button. */
    action: offer.action && typeof offer.action.label === "string" && offer.action.label
      ? { label: offer.action.label, onAction: typeof offer.action.onAction === "function" ? offer.action.onAction : null }
      : null,
    shownAt: now,
    /* The display time is the reading time, unless the
       line's own mouth plan runs longer (2026-10-29, the
       outside audit's clamp finding): past roughly 260 to
       295 characters the plan outran the 9 second clamp and
       her mouth was cut mid line, on exactly the long miss
       feedback lines that matter most. The clamp now scales
       to the plan: a line stays up until its last phrase is
       spoken, less the tail allowance speechTalkingAt
       already grants. Short lines are untouched; their
       plans end long before the reading time does. */
    durationMs: Math.max(speechDurationFor(text), plan.speechEndMs - SPEECH_TAIL_MS),
    plan,
  };
  const next = {
    ...state,
    current: line,
    seq: id,
    lastAnyAt: now,
    categoryAt: offer.category
      ? { ...state.categoryAt, [offer.category]: now }
      : state.categoryAt,
    lastByCategory: offer.category
      ? { ...state.lastByCategory, [offer.category]: text }
      : state.lastByCategory,
  };
  return { state: next, line };
}

export function speechOffer(state, offer, env) {
  const s = state && typeof state === "object" ? state : createSpeechState();
  const o = offer && typeof offer === "object" ? offer : {};
  const e = env && typeof env === "object" ? env : {};
  const now = typeof e.now === "number" ? e.now : 0;
  const deny = (reason) => ({ state: s, result: "denied", reason });

  const source = o.source || speechSourceForCategory(o.category) || "quip";

  /* The cause is judged first (2026-10-29, dialog spec Lane
     1): every offer carries its cause record, and an offer
     with no cause, or a trigger outside the closed list, is
     denied by construction before any wording is considered.
     Two categories are denied outright as triggers, whatever
     cause they claim: "searching" would narrate a search
     starting (the thinking face already says that), and the
     "idle" and "fourthWall" categories were the free floating
     ambient garnish trigger, which is deleted. Their bank
     lines stay available as wording for caused triggers. */
  const cause = speechCauseOf(o);
  if (!cause) return deny("no-cause");
  if (o.category === "searching" || o.category === "idle" || o.category === "fourthWall") return deny("trigger-not-allowed");

  /* A session that has dismissed her twice has asked for
     quiet in stronger terms (2026-10-29): ambient and arrival
     lines stop for the rest of the session, while caused
     lines still answer the learner's own actions. The
     reviews due count is a caused fact, not garnish, so its
     trigger is exempt; the hour arrival lines are not. */
  if (s.quietSession && !speechIsCaused(source) && cause.trigger !== "reviews-due") return deny("quiet-session");

  /* Resolve the text. A categorized offer picks from the
     bank and keeps the one piece of categorized temperament
     that survives: the per category cooldown, restated as a
     wording and family discipline. Chance is gone as a gate:
     whether she speaks was decided by the cause above, and
     the pick below only chooses among the bank's wordings,
     preferring the variants that fit the cause (the offer's
     prefer rule; search reactions default to brief). A
     direct offer is taken as written. */
  let text = typeof o.text === "string" ? o.text.trim() : "";
  if (o.category) {
    const tables = e.tables || {};
    const bank = tables.lines ? tables.lines[o.category] : null;
    if (!Array.isArray(bank) || !bank.length) return deny("unknown-category");
    const cd = tables.cooldowns ? tables.cooldowns[o.category] || 0 : 0;
    if (now - (s.categoryAt[o.category] || 0) < cd) return deny("cooldown");
    if (!text) {
      const prefer = o.prefer != null ? o.prefer : source === "search" ? "brief" : null;
      text = pickSpeechLine(bank, typeof o.seed === "number" ? o.seed : now, s.lastByCategory[o.category] || null, prefer) || "";
    }
  }
  /* Every line she speaks passes the one dash sanitizer,
     whatever bank or assembly produced it (see
     speechSanitizeText). Authored lines are already clean
     and pass through unchanged; assembled lines from card
     text are where a dash could otherwise reach her bubble. */
  text = speechSanitizeText(text);
  if (!text) return deny("empty");

  /* Typing: she does not talk over the learner's hands. The
     one exception is lesson feedback, the line the learner's
     own answer just caused. */
  if (e.typing && source !== "lesson") return deny("typing");

  const caused = speechIsCaused(source);
  if (s.current) {
    const currentCaused = speechIsCaused(s.current.source);
    if (caused && !currentCaused && SPEECH_PRIORITY[source] > SPEECH_PRIORITY[s.current.source]) {
      /* A caused line takes the stage from an ambient one,
         the unified form of the old lineBusy dismissal: the
         ambient line is simply over. */
      const shown = speechShow(s, o, source, text, now);
      return { state: { ...shown.state, queue: s.queue }, result: "shown", line: shown.line, preempted: s.current };
    }
    if (caused) {
      if (s.queue.some((q) => q.text === text)) return deny("duplicate");
      /* Overflow drops the oldest perishable line instead of
         refusing the new one (2026-10-29): reactions are
         perishable, and the line that has waited longest is
         the stalest thing in the queue. Only a queued line
         the new one outranks or matches may be dropped; a
         queue full of lines that all outrank the newcomer
         still refuses it. */
      let baseQueue = s.queue;
      let dropped = null;
      if (s.queue.length >= SPEECH_QUEUE_MAX) {
        const newPri = SPEECH_PRIORITY[source] || 0;
        let dropAt = -1;
        for (let i = 0; i < s.queue.length; i++) {
          if ((SPEECH_PRIORITY[s.queue[i].source] || 0) <= newPri) { dropAt = i; break; }
        }
        if (dropAt === -1) return deny("queue-full");
        dropped = s.queue[dropAt];
        baseQueue = s.queue.filter((_, i) => i !== dropAt);
      }
      const plan = speechPlanFor(text);
      const queued = {
        id: 0, text, source, category: o.category || null, owner: o.owner || null,
        contextKey: o.contextKey || null, cause,
        action: o.action && typeof o.action.label === "string" && o.action.label
          ? { label: o.action.label, onAction: typeof o.action.onAction === "function" ? o.action.onAction : null }
          : null,
        queuedAt: now,
        ttlMs: source === "poke" ? SPEECH_QUEUED_TTL_MS : null,
        shownAt: 0, durationMs: Math.max(speechDurationFor(text), plan.speechEndMs - SPEECH_TAIL_MS), plan,
      };
      const res = { state: { ...s, queue: [...baseQueue, queued] }, result: "queued", line: queued };
      if (dropped) res.dropped = dropped;
      return res;
    }
    /* An ambient line never interrupts anything. */
    return deny("busy");
  }

  /* The stage is empty. Ambient lines wait out the global gap
     from the last line of any kind; caused lines do not. */
  if (!caused && s.lastAnyAt && now - s.lastAnyAt < SPEECH_MIN_GAP_MS) return deny("gap");

  const shown = speechShow(s, o, source, text, now);
  return { state: shown.state, result: "shown", line: shown.line };
}

/* Move time forward: end the current line when its display
   time has run out, and give the stage to the next queued
   caused line in the same step. The promoted line still
   respects the typing rule (a queued search reaction does
   not land while the learner is typing; a lesson line
   does). Returns what ended and what was promoted so the
   caller can log or react. */
export function speechAdvance(state, env) {
  const s = state && typeof state === "object" ? state : createSpeechState();
  const e = env && typeof env === "object" ? env : {};
  const now = typeof e.now === "number" ? e.now : 0;
  if (!s.current) return { state: s, ended: null, promoted: null };
  if (now - s.current.shownAt < s.current.durationMs) return { state: s, ended: null, promoted: null };
  const ended = s.current;
  let rest = { ...s, current: null };
  while (rest.queue.length) {
    const head = rest.queue[0];
    rest = { ...rest, queue: rest.queue.slice(1) };
    /* Stale lines never take the stage (2026-10-29): a
       queued line whose start TTL has run out is dropped,
       and so is a line tagged with a context the stage has
       moved past, a lesson card already left behind. */
    if (head.ttlMs != null && typeof head.queuedAt === "number" && now - head.queuedAt > head.ttlMs) continue;
    if (s.contextKey && head.contextKey && head.contextKey !== s.contextKey) continue;
    /* Search staleness is judged here, at promotion, against
       the line's cause record (2026-10-29, dialog spec Lane
       1): the search the line answers must still be the most
       recent completed search, and the learner must still be
       on the search surface, or the line is dropped in
       silence. Nothing is dropped by a clock while it waits,
       so a search line queued behind a lesson line still
       promotes after the lesson line's display, exactly as
       the 36a06a9 lane pinned; a live lesson context on the
       stage also means the learner is not on the search
       surface. The hook supplies latestSearch and
       onSearchSurface in env; a caller that supplies neither
       asserts nothing about searches, and the context rule
       still applies. */
    if (head.source === "search") {
      if (s.contextKey) continue;
      if (typeof e.latestSearch === "string" && (!head.cause || head.cause.subject !== e.latestSearch)) continue;
      if (e.onSearchSurface === false) continue;
    }
    if (e.typing && head.source !== "lesson") continue;
    const shown = speechShow(rest, head, head.source, head.text, now);
    return { state: { ...shown.state, queue: rest.queue }, ended, promoted: shown.line };
  }
  return { state: rest, ended, promoted: null };
}

/* A click on the bubble: the current line ends at once, and
   the blast radius is scoped (2026-10-29, dialog spec Lane
   1, replacing the clear everything behavior). Dismissal
   drops queued lines of the same cause as the dismissed
   line, and queued ambient garnish, but a caused line whose
   cause is still live (the current card's teaching, the
   landing line for the search on screen) survives to be
   offered when the stage frees: dismissing her costs the
   learner nothing they were owed. The stamps stay: being
   dismissed does not reset her cooldowns. Two dismissals in
   one session set quietSession, which speechOffer reads:
   ambient and arrival lines stop for the session, caused
   lesson lines still answer. env is the same promotion env
   speechAdvance takes ({ now, latestSearch,
   onSearchSurface }), used to judge which causes are live. */
export function speechDismiss(state, env) {
  const s = state && typeof state === "object" ? state : createSpeechState();
  if (!s.current && !s.queue.length) return s;
  const dismissed = s.current || null;
  const sameCause = (q) => !!(
    dismissed && dismissed.cause && q.cause
    && q.cause.trigger === dismissed.cause.trigger
    && q.cause.surface === dismissed.cause.surface
    && q.cause.subject === dismissed.cause.subject
  );
  const queue = s.queue.filter((q) => {
    if (sameCause(q)) return false;
    if (!speechIsCaused(q.source)) return false;
    return speechCauseLive(q, s, env);
  });
  const dismissals = (s.dismissals || 0) + (dismissed ? 1 : 0);
  return { ...s, current: null, queue, dismissals, quietSession: !!s.quietSession || dismissals >= 2 };
}

/* The stage's context changes (2026-10-29, the outside
   audit's stale lines finding): the owner names the context
   its lines belong to, a lesson card while its feedback
   sheet is up, null when no card is. Every queued line
   tagged with a different context is dropped, and a current
   line tagged with a different context ends on the spot, so
   nothing she was saying about the last card is still being
   said over the next one. Untagged lines (her ambient and
   reaction lines) belong to no card and are untouched. */
export function speechSetContext(state, contextKey) {
  const s = state && typeof state === "object" ? state : createSpeechState();
  const key = typeof contextKey === "string" && contextKey ? contextKey : null;
  const queue = s.queue.filter((q) => !q.contextKey || q.contextKey === key);
  const current = s.current && s.current.contextKey && s.current.contextKey !== key ? null : s.current;
  if (key === (s.contextKey || null) && queue.length === s.queue.length && current === s.current) return s;
  return { ...s, contextKey: key, queue, current };
}

/* ── The shared store ─────────────────────────────────────────
   One stage per page, however many of her surfaces are
   mounted: the module holds the single speech state, and
   every useNovaSpeech instance mirrors it. An instance only
   renders and voices the lines it owns (its offers carry its
   owner id), which is what keeps two mounted Novas from ever
   showing the same line twice or talking over each other.
   Any mounted instance drives the clock for the whole stage,
   so a line still ends on time when its owner unmounts. */
let speechStore = createSpeechState();
const speechListeners = new Set();
let speechOwnerSeq = 0;

function speechCommit(next) {
  if (!next || next === speechStore) return;
  speechStore = next;
  for (const fn of Array.from(speechListeners)) fn(speechStore);
}

/* The quip tables, memoized on first use rather than read
   into a constant at module scope, for the same import
   cycle reason as the banks above: the values come from
   NovaRive, which imports the bubble from this file. */
let speechTablesCache = null;
function speechTables() {
  if (!speechTablesCache) {
    speechTablesCache = {
      lines: NOVA_QUIP_BANK,
      cooldowns: QUIP_CATEGORY_COOLDOWN_MS,
    };
  }
  return speechTablesCache;
}

/* The search tracker (2026-10-29, dialog spec Lane 1): the
   module records the subject of the most recent completed
   search cause offered through any instance, and which
   instances have offered search causes (the search surface's
   owners). Promotion and scoped dismissal read both through
   speechPromotionEnv: a queued search line whose search is
   no longer the latest, or whose surface's owners have all
   unmounted, is stale. No clock is involved, so a search
   line queued behind a lesson line is never timed out. */
const speechSearchTracker = { latestSubject: null, surfaceOwners: new Set() };
const speechMountedOwners = new Set();
function speechPromotionEnv() {
  let onSearchSurface = false;
  for (const owner of speechSearchTracker.surfaceOwners) {
    if (speechMountedOwners.has(owner)) { onSearchSurface = true; break; }
  }
  return {
    now: Date.now(),
    latestSearch: speechSearchTracker.latestSubject == null ? undefined : speechSearchTracker.latestSubject,
    onSearchSurface,
  };
}

/* The typing probe, the same read the quip engine made: an
   input, a textarea, a select, or an editable element holding
   the focus means hands on keys. */
function userIsTypingSpeech() {
  try {
    const el = typeof document !== "undefined" ? document.activeElement : null;
    if (!el) return false;
    const tag = (el.tagName || "").toUpperCase();
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
  } catch {
    return false;
  }
}

/* useNovaSpeech: the one controller every speaking surface
   shares. Returns:
   - current: the line this instance owns and should render,
     or null. Other instances see busy instead.
   - talking: the pulsed isTalking feed for the Rive input,
     true only inside the current line's speech bursts.
   - busy: any line is on stage, whoever owns it.
   - say(offer): offer a line; returns "shown", "queued", or
     "denied". Every offer carries a cause record
     ({ cause: { trigger, surface, subject } }); an offer
     without one is denied. Offers carry { text, source }
     directly, or { category } to pick from the quip bank
     with its cooldown discipline, or { source: "brain",
     bank, seed } to pick from one of her other banks. An
     offer may also carry an action ({ label, onAction }):
     the line then renders that action as a button in the
     bubble, and pressing it does the action and ends the
     line.
   - offerCategory(category, cause): the categorized offer,
     for state transitions and Rive events.
   - handleRiveEvent(name, ctx): an EmitIdleQuip,
     EmitQuizQuip, or EmitSearchQuip event from the asset,
     routed to its category exactly as the quip engine did.
     The retired asset fires none of these any more, and a
     routed offer carries no cause, so the gate denies it:
     owners offer with causes now.
   - dismiss(): end the current line, with the scoped
     dismissal of speechDismiss.
   - setContext(key): name the context the stage's lines
     belong to (a lesson card, or null); lines tagged with
     another context are dropped, so a card's teaching can
     never be spoken over the next card. */
export function useNovaSpeech({ enabled = true } = {}) {
  const ownerRef = useRef(null);
  if (ownerRef.current === null) {
    speechOwnerSeq += 1;
    ownerRef.current = "speech-" + speechOwnerSeq;
  }
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const [snapshot, setSnapshot] = useState(speechStore);
  const [, setPulse] = useState(0);

  useEffect(() => {
    const fn = (s) => setSnapshot(s);
    speechListeners.add(fn);
    speechMountedOwners.add(ownerRef.current);
    return () => { speechListeners.delete(fn); speechMountedOwners.delete(ownerRef.current); };
  }, []);

  const anyCurrent = snapshot.current;
  useEffect(() => {
    if (!anyCurrent) return undefined;
    const iv = setInterval(() => {
      const adv = speechAdvance(speechStore, { typing: userIsTypingSpeech(), ...speechPromotionEnv() });
      if (adv.ended || adv.promoted) speechCommit(adv.state);
      setPulse((p) => p + 1);
    }, 60);
    return () => clearInterval(iv);
  }, [anyCurrent]);

  const say = (offer) => {
    if (!enabledRef.current) return "denied";
    const o = offer && typeof offer === "object" ? { ...offer } : {};
    if (!o.text && !o.category && o.bank) {
      const bank = NOVA_SPEECH_BANKS[o.bank] || (Array.isArray(o.bank) ? o.bank : null);
      const picked = pickSpeechLine(bank, typeof o.seed === "number" ? o.seed : Date.now(), null, o.prefer != null ? o.prefer : null);
      if (!picked) return "denied";
      o.text = picked;
    }
    delete o.bank;
    const res = speechOffer(speechStore, { ...o, owner: ownerRef.current }, {
      now: Date.now(),
      typing: userIsTypingSpeech(),
      tables: speechTables(),
    });
    if (res.result !== "denied") {
      /* A landed or queued search cause is the record of the
         most recent completed search, and this instance is
         one of the search surface's owners, until it
         unmounts. Queued search lines are judged against
         this record at promotion, never by a clock. */
      const cause = res.line && res.line.cause ? res.line.cause : null;
      if (cause && (cause.trigger === "search-landed" || cause.trigger === "search-failed")) {
        speechSearchTracker.latestSubject = cause.subject;
        speechSearchTracker.surfaceOwners.add(ownerRef.current);
      }
      speechCommit(res.state);
    }
    return res.result;
  };

  const offerCategory = (category, cause) => say({ category, cause });

  const handleRiveEvent = (name, ctx) => {
    const category = quipCategoryForRiveEvent(name, ctx || {});
    if (!category) return "denied";
    return offerCategory(category);
  };

  const dismiss = () => { speechCommit(speechDismiss(speechStore, speechPromotionEnv())); };

  const setContext = (contextKey) => { speechCommit(speechSetContext(speechStore, contextKey)); };

  const current = snapshot.current && snapshot.current.owner === ownerRef.current ? snapshot.current : null;
  const talking = current
    ? speechTalkingAt(current.plan, Date.now() - current.shownAt, current.durationMs)
    : false;
  return { current, talking, busy: !!snapshot.current, say, offerCategory, handleRiveEvent, dismiss, setContext };
}

/* ── The one bubble ───────────────────────────────────────────
   The house bubble, the values every surface already shared:
   cream ground, ink text, the faint ink line. Three placement
   variants by surface: "header" hangs below the header figure
   as the quip bubble did, tail up, "sheet" sits in flow
   with a left tail and a real dismiss button, the way the tip
   bubble read, and "flow" (2026-10-29, Home B) sits in flow
   at its container's full width with no tail, inside the
   reading column of the surface that owns it: on the search
   home that is the greeting unit, under the serif greeting
   line, where the box can never float over the wide middle
   or reach the docked composer. (The floating "stage" variant was deleted
   2026-10-29, dialog spec Lane 1: defined, used by no mount,
   and superseded by the home's in flow box.) Text only,
   always: she is on the screen once, and the bubble never
   carries a second figure of her. A click dismisses. When a
   line names an action, the bubble also carries that one
   action as a text button: pressing it does the action and
   ends the line. A line naming no action carries no button. */
const SPEECH_BUBBLE_CREAM = "#FDF3D7";
const SPEECH_BUBBLE_INK = "#1A1A1A";
const SPEECH_BUBBLE_LINE = "rgba(26, 26, 26, 0.16)";
const SPEECH_BUBBLE_FAINT = "#6E675C";

/* The header bubble clamp (2026-10-16, layout audit finding
   3): the header variant hangs centered on its figure, up to
   250px wide, so on the small header and sheet figures its
   center sits near the left edge of a phone screen and half
   the bubble ran off it. The chosen fix shape is the clamp,
   not in flow rendering: the bubble keeps its floating
   desktop look, its width caps at the viewport minus the
   margins, and its horizontal shift is measured from the
   anchor figure and clamped so neither edge crosses the
   margin. This pure helper computes that shift: how far the
   centered bubble must move so it fits, 0 when it already
   does. */
export const SPEECH_BUBBLE_VIEWPORT_MARGIN = 8;
export function speechBubbleShiftFor(anchorCenterX, bubbleWidth, viewportWidth, margin = SPEECH_BUBBLE_VIEWPORT_MARGIN) {
  if (!(bubbleWidth > 0) || !(viewportWidth > 0)) return 0;
  const half = bubbleWidth / 2;
  if (anchorCenterX - half < margin) return margin - (anchorCenterX - half);
  if (anchorCenterX + half > viewportWidth - margin) return (viewportWidth - margin) - (anchorCenterX + half);
  return 0;
}

/* The variant geometries, as a pure function of the variant
   and the header clamp shift (2026-10-18, the feedback sheet
   bubble repair). The defect this pins down: the sheet's
   speech used to render through the "header" geometry below
   (NovaCanvas handed every speaking surface variant
   "header"), so on the lesson feedback sheet her teaching
   hung absolutely from the 48px sheet figure, centered on a
   62px anchor box, capped at 250px, laid over the sheet's
   body text, and its left half ran past the sheet column's
   left edge, where the sheet scroll box (overflowY auto,
   whose overflowX computes to auto) clipped every line mid
   word. The viewport clamp could not save it: it only
   measures against the window, and on a desktop the bubble
   sat hundreds of pixels from the window's edge while it
   hung 94px past the column's. The "sheet" geometry is the
   opposite shape in every particular: in flow (relative,
   block), width 100% of the container it is rendered in,
   no transform and no left or top offset, so there is no
   mechanism left that can push its text outside its own
   box or the sheet's. The "header" geometry is the shipped
   one, byte for byte in value. */
export function speechBubbleStyleFor(variant, clampShift = 0) {
  if (variant === "sheet") {
    return {
      position: "relative", display: "block", width: "100%", boxSizing: "border-box",
      borderRadius: RADIUS.xl, padding: "12px 16px",
      lineHeight: 1.55, maxWidth: 470,
    };
  }
  if (variant === "flow") {
    /* The flow geometry (2026-10-29, Home B, dialog spec
       2.4): the sheet's in flow shape with its width cap
       lifted, because the container here is the reading
       column itself and the box takes the column's width.
       Relative, block, no transform and no offset, so no
       mechanism can push it over the content below it. */
    return {
      position: "relative", display: "block", width: "100%", boxSizing: "border-box",
      borderRadius: RADIUS.xl, padding: "12px 16px",
      lineHeight: 1.55, maxWidth: "none",
    };
  }
  return {
    position: "absolute", top: "calc(100% + 8px)", left: "50%", transform: "translateX(calc(-50% + " + clampShift + "px))",
    borderRadius: 2, padding: "7px 11px", lineHeight: 1.35,
    width: "max-content", maxWidth: "min(250px, calc(100vw - 16px))", cursor: "pointer",
    boxShadow: "none",
  };
}

export function NovaBubble({ text, children, variant = "header", tail = null, onDismiss, action = null, style }) {
  const content = children != null ? children : text;
  const v = variant === "sheet" || variant === "flow" ? variant : "header";
  /* The header clamp measurement: read the anchor figure's
     on screen center (the bubble's offsetParent, the relative
     span NovaRive wraps the figure in) and the bubble's own
     layout width, then shift the bubble the amount the pure
     helper allows. Runs on mount and on line change; the
     viewport width comes from the shared useWindowWidth hook
     (appUtils is the one place a direct width read may live,
     and the hook follows resizes, so a rotation remeasures
     through the winW dependency). */
  const winW = useWindowWidth();
  const bubbleRef = useRef(null);
  const [clampShift, setClampShift] = useState(0);
  useLayoutEffect(() => {
    if (v !== "header") return undefined;
    const el = bubbleRef.current;
    if (!el) return undefined;
    const anchor = el.offsetParent;
    if (!anchor) return undefined;
    const a = anchor.getBoundingClientRect();
    const shift = speechBubbleShiftFor(a.left + a.width / 2, el.offsetWidth, winW);
    setClampShift((prev) => (prev === shift ? prev : shift));
    return undefined;
  }, [v, content, winW]);
  if (content == null || content === "") return null;
  const tailSide = tail || (v === "header" ? "up" : v === "sheet" ? "left" : "none");
  const base = {
    background: SPEECH_BUBBLE_CREAM, color: SPEECH_BUBBLE_INK,
    border: "1px solid " + SPEECH_BUBBLE_LINE,
    fontSize: FONT_SIZES.body, whiteSpace: "normal", zIndex: 31,
  };
  const variantStyle = speechBubbleStyleFor(v, clampShift);
  /* A sheet bubble with a dismiss button keeps its text
     clear of the button's 44px hit area (2026-10-18): the
     glyph sits at the top right, and a full width first line
     would otherwise run underneath it. */
  if (v === "sheet" && onDismiss) variantStyle.paddingRight = 52;
  const tailStyle = tailSide === "down"
    ? { bottom: -7, left: "50%", marginLeft: -7, borderRight: "1px solid " + SPEECH_BUBBLE_LINE, borderBottom: "1px solid " + SPEECH_BUBBLE_LINE }
    : tailSide === "up"
      /* A clamped bubble moves, its tail does not: the tail
         counter shifts by the same amount so it keeps
         pointing at the figure's center. */
      ? { top: -7, left: "calc(50% - " + clampShift + "px)", marginLeft: -7, borderTop: "1px solid " + SPEECH_BUBBLE_LINE, borderLeft: "1px solid " + SPEECH_BUBBLE_LINE }
      : tailSide === "left"
        ? { left: -7, top: 17, borderLeft: "1px solid " + SPEECH_BUBBLE_LINE, borderBottom: "1px solid " + SPEECH_BUBBLE_LINE }
        : null;
  return (
    <span ref={bubbleRef} className="cb-nova-bubble" role="status" title={v === "sheet" ? undefined : "Dismiss"} onClick={v === "sheet" ? undefined : onDismiss}
      style={{ ...base, ...variantStyle, ...(style || {}) }}>
      {tailStyle && (
        <span aria-hidden="true" style={{
          position: "absolute", width: 13, height: 13, background: SPEECH_BUBBLE_CREAM,
          transform: "rotate(45deg)", ...tailStyle,
        }} />
      )}
      {content}
      {action && typeof action.label === "string" && action.label && (
        /* The one action a line may name (2026-10-29): her
           wayfinding. The button does the action; the caller
           ends the line. Its click never falls through to the
           bubble's own dismiss or to a figure click behind
           the bubble. */
        <button type="button" onClick={(e) => { e.stopPropagation(); if (action.onAction) action.onAction(); }}
          style={{
            display: "block", marginTop: 8, background: "none", border: "1px solid " + SPEECH_BUBBLE_LINE,
            borderRadius: RADIUS.pill, color: SPEECH_BUBBLE_INK, cursor: "pointer", fontFamily: "inherit",
            fontSize: FONT_SIZES.label, fontWeight: 500, lineHeight: 1.2, padding: "8px 14px", minHeight: 36,
          }}>
          {action.label}
        </button>
      )}
      {v === "sheet" && onDismiss && (
        <button type="button" aria-label="Dismiss" onClick={(e) => { e.stopPropagation(); if (onDismiss) onDismiss(); }}
          style={{
            /* 44px hit area (2026-10-16, layout audit finding
               20); the glyph size below is unchanged. */
            position: "absolute", top: 4, right: 4, width: 44, height: 44,
            background: "none", border: "none", color: SPEECH_BUBBLE_FAINT, cursor: "pointer",
            fontSize: 13, lineHeight: 1, display: "inline-flex", alignItems: "center", justifyContent: "center",
          }}>
          ✕
        </button>
      )}
    </span>
  );
}
