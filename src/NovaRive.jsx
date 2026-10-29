/* ── Nova's figure and voice: the code side ───────────────────
   This file began as the code side of the Rive rebuild: the
   state machine contract (Nova_Controller and its inputs),
   her quip bank, and the canvas that rendered the editor
   authored asset at public/nova/nova.riv, live from
   2026-10-15. What it holds now, after the owner's mascot
   verdict of 2026-10-29 ("less cartoonish", "more stern",
   "have life"):

   - The contract constants below, kept as the record of the
     feeds her figure has always consumed. NovaFigure.jsx
     reads the same feeds under the same names: the behavior
     state, quizState and appState, the joystick pointer,
     the sleep stage, the talking flag, reduced motion, and
     the poke and celebrate counters.
   - Her voice: the categorized quip bank below, in her
     written voice (the personality sheet: calm, dry, short,
     no hype, no exclamation, no dashes of any kind). The
     speaking itself is unified in NovaSpeech.jsx: one speech
     controller arbitrates every line she says anywhere, and
     these surfaces just render the controller's current line
     and feed its talking flag to her mouth. This file keeps
     the bank and the pure mapping helpers the controller
     imports.
   - The renderer itself: NovaRive is the figure surface and
     nothing else. The rendered figure is the primitive rig
     in NovaFigure.jsx, rebuilt under the 2026-10-29 verdict:
     adult proportions instead of the editor asset's chibi
     build (an oversized head and glossy oversized eyes that
     a .riv binary cannot be re proportioned out of from
     code), a stern resting face, and slow idle life. The
     .riv file remains in public/ as the retired asset; it
     renders nowhere. There is no second surface behind the
     rig, and no runtime or wasm is fetched for her any more:
     the self hosted Rive wasm wiring that stood here from
     2026-10-15 retired with the asset it served.

   Palette discipline: the code side visuals here stay in
   the house palette only. The speech bubble itself lives in
   NovaSpeech.jsx now, in the same cream, ink, and faint line
   the line bubble always used. The spec's cyan accent was
   not adopted; Nova's world is gold, cream, and ink. */

import React from "react";
import { NovaBubble } from "./NovaSpeech.jsx";
import { NovaFigure } from "./NovaFigure.jsx";

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
   Figure box: the rig in NovaFigure.jsx draws on a 480 by
   640 canvas and fills it edge to edge, standing on its
   bottom line. NovaCanvas takes a framing prop: "bust" (the
   default for the small spots, a head and shoulders crop of
   the size times 1.85 mount, applied in NovaCanvas below)
   or "full" (a box hugging the figure's own aspect, width
   size * 1.02 by height size), and "panel" means full too,
   the standing figure semantics the large spots always used.
   Her stage on the learning home passes framing "full" at a
   large size. The state machine names above are the retired
   asset's contract, kept as the record; the feeds themselves
   (the numbers, the booleans, the counter triggers) are what
   the rig consumes, under the same names, from the same
   props. The asset's events retired with it: nothing fires
   EmitIdleQuip any more, and quip offers come from the
   owners, as they already did for state transitions. */
export const NOVA_RIVE_STATE_MACHINE = "Nova_Controller";
export const NOVA_RIVE_SRC = "/nova/nova.riv?v=3";
export const NOVA_RIVE_ASSET = "/nova/nova.riv?v=3";
export const NOVA_RIVE_INPUTS = {
  numbers: ["quizState", "appState", "mouseX", "mouseY"],
  booleans: ["isTalking", "reducedMotion"],
  triggers: ["poke", "celebrate", "sleep", "wake"],
};
export const NOVA_RIVE_EVENTS = ["EmitIdleQuip", "EmitQuizQuip", "EmitSearchQuip"];

/* ── The quip bank ────────────────────────────────────────────
   The owner's supplied lines, rewritten into the voice the
   personality sheet binds: the ideas and categories are his,
   the wording is hers. Rewritten again on 2026-10-15 after
   the owner passed on the verdict that she sounded like a
   robot: the old bank was written and gated into sameness,
   flat clipped declaratives at one length with exclamation
   banned outright. She talks like a person now, a dry mad
   scientist who runs this lab: contractions, questions,
   fragments, asides, the occasional longer sentence when
   an idea pleases her, and a rare single exclamation when
   a result genuinely earns one (the gates price them: at
   most one per line, a small budget across the bank, none
   in the poke boundary lines). Still no hype, no baby
   talk, and no dashes of any kind anywhere, hyphenated
   compounds included. Silence is her default; the gates
   below keep every category rare. */
export const NOVA_QUIP_BANK = {
  idle: [
    "Somewhere in this lab there's a beaker I labeled do not drink back in 2019. I think about it more than I should.",
    "If I regrow a fingertip, does the new one get its own publication record? Asking for a limb.",
    "I'm neotenic, which is the scientific way of saying I refused to grow up and got a doctorate about it anyway.",
    "People assume the gills are decorative. People also assume their sample size is fine. People assume a great deal.",
    "I've read every paper in this building twice. The good ones three times. You can tell which are which by the margin notes.",
    "A control group somewhere is living a completely ordinary life right now, untouched by me. Good for them. I think about them often.",
    "The coat has two pockets. Pens in the left. In the right, also pens. A scientist contains multitudes.",
    "My resting heart rate is classified. So is my reading list. Some data isn't for distribution.",
    "If a result can't survive replication, it can't survive me. I'm not the harshest reviewer in this field, but I'm in the photograph.",
    "The badge says research assistant. The publication record says otherwise, but the badge was printed first and I respect the chain of custody.",
    "I don't chase citations. I set a beautiful trap of methodology and let them come to me.",
    "Regenerating a fingertip takes me about two months. Most of your questions take me considerably less, so no, you aren't keeping me from anything.",
  ],
  fourthWall: [
    "You, out there. Your coffee's gone cold, and these citations won't cross reference themselves. Priorities.",
    "Still here? The papers noticed. They're flattered. Slightly concerned, but flattered.",
    "You've been staring at this screen longer than some of my experiments run. Bold. I approve of the commitment, if not the posture.",
    "At some point a tab stops being a tab and becomes a lifestyle. We passed that point a while ago. I'm not judging. I'm documenting.",
  ],
  searching: [
    "Into the databases. Hold my beaker. It gets deep down there, and the lighting is terrible.",
    "Looking for the actual data. Invented citations don't get past me; I check everything twice and the footnotes three times.",
    "Fourteen databases, and somebody has to check every one of them. It's me. It's always me. I wouldn't have it any other way.",
    "Going in. If I'm not back in a minute, the abstract was longer than the paper and I'm still inside it.",
    "I read the footnotes too. Especially the footnotes. That's where the confessions live.",
    "Somewhere in these results is the real answer, usually hiding behind three opinion pieces wearing its coat.",
    "Checking the primary sources now. Summaries of summaries can wait outside with the press releases.",
    "If the data exists, I'll find it. If it doesn't, I'll find that out too, and I'll enjoy telling you.",
    "Cross referencing. Trust around here is earned one citation at a time, and I keep the ledger.",
    "Digging past the press release version. The real numbers live further down, where nobody bothers to dust.",
  ],
  preprintWarning: [
    "That one's a preprint. Fresh out of the incubator, not yet peer reviewed. Goggles on, standards up.",
    "A preprint: interesting, promising, and about as settled as wet cement. Read it the way you'd read a rumor from a reliable friend.",
    "This one hasn't faced the reviewers yet. Every number in it is provisional, including the confident ones. Especially the confident ones.",
    "Not peer reviewed. That doesn't make it wrong; it makes it unfinished. There's a difference, and it matters.",
  ],
  highConfidence: [
    "Peer reviewed, replicated, and it holds up under pressure. That's the whole celebration. I don't do confetti.",
    "Multiple groups. Same result. Independent methods. That's as close to applause as this field gets, and it's earned!",
    "The evidence agrees with itself across every check I ran. Rare. It's in the good ledger now. Moving on.",
    "Replicated, cited, and still standing. I don't say that often, so write it down somewhere.",
  ],
  quizThinking: [
    "Take your time. Wrong and fast is still wrong; the data doesn't care how quickly you arrived at it.",
    "Thinking face noted. Hovering between two options is a strategy. Not a good one, but I've seen worse published.",
    "No rush on my end. I've waited out experiments that took longer than your entire education so far.",
    "I can see the gears turning. One of them is grinding, but grinding is a kind of progress.",
    "Deliberation. My favorite spectator sport. The question and I are both patient, and only one of us is bluffing.",
    "My gills flutter when I watch someone think properly. Sixty beats a minute. Purely diagnostic, I assure you.",
  ],
  quizCorrect: [
    "Correct! And not the lucky kind of correct. I checked the reasoning twice. Old habit.",
    "Correct. I'll allow myself a small nod. You've earned the nod. The nod is significant.",
    "Right. The data and I both approve, and we so rarely agree on anything.",
    "Yes. That one wasn't easy, whatever you tell yourself later.",
    "Correct. Filed under things I didn't have to correct, a folder I treasure.",
    "That's the one. Somewhere a textbook just felt a faint sense of pride.",
    "Right answer. Moving on before either of us makes it weird.",
    "Correct, and quickly, too. Speed with accuracy is the whole game in this lab.",
    "You got it. The control group sends its regards, and its confusion.",
    "Right. Don't let it go to your head. The next question is already clearing its throat.",
  ],
  quizStreak: [
    "Three in a row! You're making my control group look bad, and they had a head start.",
    "A streak. I'm counting even if you're pretending not to. Four would be showing off. Five would be a pattern.",
    "Four straight. The difficulty curve has been notified, and it is quietly afraid.",
    "Still perfect. I'm not applauding. I'm simply not stopping you, which, from me, is applause.",
    "You're on a run. I've moved your file from promising to suspicious. That's a promotion, by the way.",
  ],
  quizWrong: [
    "Hypothesis falsified. Einstein fumbled the cosmological constant for years, so you're in tall company. Run it again.",
    "Not it. The good news? Wrong answers are data too, and this one is very informative.",
    "No. But I admire the confidence it took to commit to it. Confidence we can work with.",
    "That's not the one. The correct answer was closer than you think, which is the annoying part and also the promising part.",
    "Wrong, and that's fine. Science has an entire process for this. It's called the next question.",
    "Not quite. Even my control group misses one now and then, and they've seen the answers.",
    "Incorrect. We record it, we learn from it, and we never speak of it at parties.",
    "No. Filed under hypotheses that didn't survive contact with the evidence. The file is thick. You're not alone in it.",
    "That one missed. The textbook remains undefeated, but it's sweating.",
    "A swing and a miss. Notice I didn't say you were wrong for the data, only that the data was wrong for you. Onward.",
  ],
};

/* Her temperament in numbers, read by the speech controller
   in NovaSpeech.jsx: a long ambient gap (its SPEECH_MIN_GAP_MS
   mirrors QUIP_MIN_GAP_MS here), per category cooldowns, and
   a chance roll per category so even an eligible moment
   usually stays silent. Warnings land most often because
   they are useful; praise lands least, because she is not a
   cheerleader. How long a line stays up is the controller's
   reading time now; the old fixed QUIP_SHOW_MS retired with
   the engine that used it (2026-10-15). */
export const QUIP_MIN_GAP_MS = 60000;
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

/* ── The old quip engine retired here (2026-10-15) ───────────
   This file used to run its own gate (useNovaQuips): a module
   token, per surface offers on state transitions and Rive
   events, a fixed display time, and a private bubble. The
   unified speech controller in NovaSpeech.jsx owns all of
   that now. What survives here is what the controller and
   other callers import: the bank, the temperament numbers,
   and the pure mapping helpers above (quizCategoryForState,
   searchCategoryForState, quipCategoryForRiveEvent,
   quipGateAllows, pickQuipLine). The surfaces below take a
   speech prop (the object useNovaSpeech returns): they render
   its current line as a NovaBubble and feed its talking flag
   to her mouth. A surface with no speech prop renders the
   figure only: no bubble, talking false. State transition
   offers come from the owners (NovaLive, the Player figure,
   SearchNova), as they did before the asset retired. */

/* ── The figure surface ───────────────────────────────────────
   The only surface. From 2026-10-15 to 2026-10-29 this was
   the Rive canvas and the editor asset it ran; the owner's
   mascot verdict retired both (see the header). What renders
   here now is the primitive rig in NovaFigure.jsx, and every
   feed a caller passes lands on it under its contract name:
   the behavior state and the scanning flag, quizState and
   appState, the brain's sleep stage, the pointer, reduced
   motion, and the poke and celebrate counters (a rising
   count flashes the matching expression in the rig, the way
   a fired trigger used to). The framing boxes below are the
   ones the canvas used, unchanged, so every caller's layout
   survives the swap. */
function NovaCanvas(props) {
  // waveN is accepted here and left unused: the contract has no wave feed.
  const {
    size = 48, framing = "bust", quizState = 0, appState = 0, pointer = null, waveN = 0,
    sleepStage = 0, pokeN = 0, celebrateN = 0, reducedMotion = false, anchorRef = null,
  } = props;
  const speech = props.speech || null;
  /* Which bubble geometry a speaking surface renders with
     (2026-10-18, the feedback sheet bubble repair): every
     surface used to render its line as a "header" bubble,
     floating centered on the figure's anchor. That is right
     for the header and stage figures and wrong for the
     lesson feedback sheet, whose figure is 48px and sits at
     the sheet column's left edge: the header bubble hung
     over the sheet's body text and past the column, where
     the sheet's scroll box clipped it. A surface that
     renders its speech somewhere else in flow (the feedback
     sheet, through the Player) passes bubbleVariant null:
     the figure here is then figure only, while the speech
     prop still feeds her talking mouth. */
  const bubbleVariant = props.bubbleVariant === undefined ? "header" : props.bubbleVariant;
  const talkingNow = speech ? !!speech.talking : false;

  /* Framing. "full" and "panel" give the figure a box in its
     own proportions: the rig's canvas is 480 by 640 and she
     fills it edge to edge, standing on its bottom line, so a
     box of size times 1.02 by size holds her whole figure
     with air at the sides, and size reads as the height she
     stands at. maxWidth keeps the stage box inside a narrow
     panel; the figure meets whatever box results.
     Bust framing (2026-10-18, design audit H24): the small
     spots crop to head and shoulders. The figure mount keeps
     its old size times 1.85 square, and a smaller outer box
     clips it, centred on her head, so her face, glasses and
     badge read at resident sizes like the 66px header. The
     rig anchors its head at the top of the mount for this
     crop (the bust flag below), where the full framing
     anchors her feet at the bottom. Every bust caller
     inherits this from here: the header, the Player and the
     lesson sheet figures alike. */
  const fullBody = framing === "full" || framing === "panel";
  const w = fullBody ? Math.round(size * 1.02) : Math.round(size * 1.3);
  const h = fullBody ? Math.round(size) : Math.round(size);
  const bustInner = Math.round(size * 1.85);
  const figure = (
    <NovaFigure
      state={props.state || null}
      quizState={quizState}
      appState={appState}
      sleepStage={sleepStage}
      scanning={!!props.scanning}
      talking={talkingNow}
      pointer={pointer}
      reducedMotion={reducedMotion}
      pokeN={pokeN}
      celebrateN={celebrateN}
      bust={!fullBody}
    />
  );
  return (
    <span ref={anchorRef} className="cb-nova-sprite" style={{ position: "relative", display: "inline-flex" }}>
      {fullBody ? (
        <span style={{ width: w, height: h, maxWidth: "100%", display: "block" }}>
          {figure}
        </span>
      ) : (
        <span style={{ width: w, height: h, display: "block", overflow: "hidden", position: "relative", flexShrink: 0 }}>
          <span style={{ width: bustInner, height: bustInner, display: "block", position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)" }}>
            {figure}
          </span>
        </span>
      )}
      {speech && speech.current && bubbleVariant && <NovaBubble text={speech.current.text} variant={bubbleVariant} onDismiss={speech.dismiss} />}
    </span>
  );
}

/* ── NovaRive ─────────────────────────────────────────────────
   One component, one surface: the figure, fed by the feeds
   above. Callers (NovaLive in the header, the Player figure
   in the lesson Player, SearchNova over in the app) pass the
   same character state they always have, plus the contract
   feeds this file maps onward: quizState, appState, pointer,
   sleepStage, and the poke and celebrate counters. Speech
   arrives as the speech prop: the controller object from
   useNovaSpeech in NovaSpeech.jsx, owned by the caller,
   never created here. */
export function NovaRive(props) {
  return <NovaCanvas {...props} />;
}
