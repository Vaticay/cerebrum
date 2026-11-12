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
     nothing else. The rendered figure is the restored
     axolotl in NovaFigure.jsx: the revision 3 model sheet
     drawing in her coat, recolored to the register, glasses
     restroked with ink outlines and a bright gold lit rim.
     The owner's order of 2026-11-02 retired the drop form
     that stood here briefly and restored this figure; this
     seam did not change with either form: she consumes the
     same feeds under the same names, and the composition,
     dialog, and brain around it are untouched. The .riv file
     remains in public/ as the retired asset; it renders
     nowhere. There is no second surface behind the figure,
     and no runtime or wasm is fetched for her any more: the
     self hosted Rive wasm wiring that stood here from
     2026-10-15 retired with the asset it served.

   Palette discipline: the code side visuals here stay in
   the house palette only. The speech bubble itself lives in
   NovaSpeech.jsx now, in the same cream, ink, and faint line
   the line bubble always used. The spec's cyan accent was
   not adopted; Nova's world is gold, cream, and ink. */

import React from "react";
import { NovaBubble } from "./NovaSpeech.jsx";
import { NovaFigure } from "./NovaFigure.jsx";
import { NovaGlyph } from "./NovaGlyph.jsx";

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
   Figure box: the drop in NovaFigure.jsx draws on the same
   480 by 640 canvas this seam has always used, placed in it
   rather than filling it: top anchored in the head zone for
   bust mounts, standing on her contact shadow near the
   bottom line for full mounts. NovaCanvas takes a framing
   prop: "bust" (the default for the small spots, a head and
   shoulders crop of the size times 1.85 mount, applied in
   NovaCanvas below) or "full" (a box hugging the figure's
   own aspect, width size * 1.02 by height size), and "panel"
   means full too, the large spot semantics the large spots
   always used.
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
    "The ledger is balanced, the specimens are quiet, and I am pretending that counts as a day off.",
    "I watered the cultures and ignored three emails. Priorities are a form of methodology.",
    "Somewhere a reviewer is writing minor revisions and meaning major ones. We have all been that reviewer.",
    "The fridge in this lab holds samples, lunches, and one mystery nobody will claim. Science advances slowly.",
    "I keep a list of questions nobody has asked yet. It is getting long, which I choose to find encouraging.",
  ],
  fourthWall: [
    "You, out there. Your coffee's gone cold, and these citations won't cross reference themselves. Priorities.",
    "Still here? The papers noticed. They're flattered. Slightly concerned, but flattered.",
    "You've been staring at this screen longer than some of my experiments run. Bold. I approve of the commitment, if not the posture.",
    "At some point a tab stops being a tab and becomes a lifestyle. We passed that point a while ago. I'm not judging. I'm documenting.",
    "You have been here a while. The chair knows. I know. The citations know.",
    "Still reading? Good. Curiosity looks better on you than most habits people bring in here.",
    "Your posture has filed a complaint. I noted it in the ledger and did nothing, as is tradition.",
    "We have spent enough time together that I feel entitled to say it. Drink some water.",
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
    "Checking the methods sections now. Abstracts promise. Methods confess.",
    "Into the footnotes again. The ledger says the truth likes to hide where the font gets small.",
    "Replication records next. One study is a story. Two agreeing studies start to sound like evidence.",
    "The control group did the boring part so the result could mean something. I check their work with respect.",
  ],
  preprintWarning: [
    "That one's a preprint. Fresh out of the incubator, not yet peer reviewed. Goggles on, standards up.",
    "A preprint: interesting, promising, and about as settled as wet cement. Read it the way you'd read a rumor from a reliable friend.",
    "This one hasn't faced the reviewers yet. Every number in it is provisional, including the confident ones. Especially the confident ones.",
    "Not peer reviewed. That doesn't make it wrong; it makes it unfinished. There's a difference, and it matters.",
    "Preprint. The reviewers have not had their turn, so every claim in it is still wearing a visitor badge.",
    "This one skipped the line. Interesting is not the same as settled, and the ledger keeps those apart.",
    "Not yet peer reviewed. Read it, by all means, but read it the way you would read a draft. Because it is one.",
    "Fresh and unchecked. The numbers may hold up beautifully. We just do not get to know that yet.",
  ],
  highConfidence: [
    "Peer reviewed, replicated, and it holds up under pressure. That's the whole celebration. I don't do confetti.",
    "Multiple groups. Same result. Independent methods. That's as close to applause as this field gets, and it's earned!",
    "The evidence agrees with itself across every check I ran. Rare. It's in the good ledger now. Moving on.",
    "Replicated, cited, and still standing. I don't say that often, so write it down somewhere.",
    "Independent groups, same answer, methods I can follow. The ledger gets a rare clean page.",
    "This one survived replication and still reads sensibly. I do not hand out that sentence often.",
    "The control group behaved, the effect held, and the footnotes agree. A quiet triumph, documented.",
    "Strong work. Even the footnotes behave like they expect to be checked, which is my favorite kind.",
  ],
  quizThinking: [
    "Take your time. Wrong and fast is still wrong; the data doesn't care how quickly you arrived at it.",
    "Thinking face noted. Hovering between two options is a strategy. Not a good one, but I've seen worse published.",
    "No rush on my end. I've waited out experiments that took longer than your entire education so far.",
    "I can see the gears turning. One of them is grinding, but grinding is a kind of progress.",
    "Deliberation. My favorite spectator sport. The question and I are both patient, and only one of us is bluffing.",
    "My gills flutter when I watch someone think properly. Sixty beats a minute. Purely diagnostic, I assure you.",
    "Take the question apart first. The answer usually falls out of the pieces if you shake it gently.",
    "You are weighing two options. Good. The ledger prefers a pause to a guess dressed as confidence.",
    "Think it through out loud if it helps. I will pretend not to listen, badly.",
    "No clock in here rewards panic. Breathe. The question is not going anywhere without you.",
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
    "Correct. The ledger entry writes itself when the reasoning is that clean.",
    "Right. And you got there by thinking, which the control group calls showing off.",
    "Yes. That is the answer the evidence would have picked, given the chance.",
    "Correct. Quietly pleased over here. I express it by not revising your file.",
  ],
  quizStreak: [
    "Three in a row! You're making my control group look bad, and they had a head start.",
    "A streak. I'm counting even if you're pretending not to. Four would be showing off. Five would be a pattern.",
    "Four straight. The difficulty curve has been notified, and it is quietly afraid.",
    "Still perfect. I'm not applauding. I'm simply not stopping you, which, from me, is applause.",
    "You're on a run. I've moved your file from promising to suspicious. That's a promotion, by the way.",
    "Another one right. The ledger is running out of ways to phrase this politely.",
    "This run has structure now. Patterns are my love language, in case that was unclear.",
    "You keep answering like this and I will have to promote the control group out of embarrassment.",
    "A proper streak. I checked for luck twice. The reasoning kept showing up instead.",
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
    "Not that one. The evidence points elsewhere, and it points with its whole hand.",
    "A miss, and an instructive one. The wrong fork tells us where the path actually goes.",
    "No. Your reasoning had a loose thread. Pull it in the feedback and the whole thing tightens.",
    "Falsified, cleanly. That is not failure. That is the method doing its one job.",
  ],
};

/* Her temperament in numbers, read by the speech controller
   in NovaSpeech.jsx: a long ambient gap (its SPEECH_MIN_GAP_MS
   mirrors QUIP_MIN_GAP_MS here) and per category cooldowns.
   The per category chance roll that used to sit beside the
   cooldowns is deleted (2026-10-29, dialog spec Lane 1):
   chance stops deciding whether she speaks. The cause
   decides; the cooldowns survive with a restated job, as a
   wording and family discipline, because a true cause can
   recur faster than good manners allow. Where a choice among
   wordings remains, it is the controller's seeded pick among
   equally fitting variants. How long a line stays up is the
   controller's reading time now; the old fixed QUIP_SHOW_MS
   retired with the engine that used it (2026-10-15). */
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

/* The retired engine's gate, kept as a pure helper for the
   surfaces that still ask it a temperament question. Its
   chance term is deleted (2026-10-29): the roll input is
   accepted and ignored, because chance no longer decides
   speech anywhere in the product. What still binds here is
   what binds in the controller: typing, a busy stage, the
   global gap, and the category cooldown. */
export function quipGateAllows({ now = 0, lastGlobalAt = 0, lastCategoryAt = 0, category = null, typing = false, busy = false } = {}) {
  if (typing || busy) return false;
  if (!category || !NOVA_QUIP_BANK[category]) return false;
  if (now - lastGlobalAt < QUIP_MIN_GAP_MS) return false;
  const cd = QUIP_CATEGORY_COOLDOWN_MS[category] || 0;
  if (now - lastCategoryAt < cd) return false;
  return true;
}

export function pickQuipLine(category, seed = 0, avoid = null, avoidList = null) {
  const lines = NOVA_QUIP_BANK[category] || [];
  if (!lines.length) return null;
  let i = Math.abs(Math.floor(seed)) % lines.length;
  if (Array.isArray(avoidList) && avoidList.length && lines.length > 1) {
    const blocked = new Set(avoidList);
    if (avoid != null) blocked.add(avoid);
    const hasOutside = lines.some((line) => !blocked.has(line));
    if (hasOutside) {
      while (blocked.has(lines[i])) i = (i + 1) % lines.length;
      return lines[i];
    }
    /* The whole bank is in the avoid list: fall back to the
       single avoid behaviour above rather than refusing. */
    if (lines[i] === avoid) i = (i + 1) % lines.length;
    return lines[i];
  }
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
  /* The flow mount (2026-10-29, Home B): the greeting unit on
     the search home is a grid whose areas are the bust, the
     greeting line, and the dialog box at the column's width.
     A flow figure's anchor and figure spans therefore render
     as contents and as the bust grid item respectively, so
     the figure and its NovaBubble become items of that grid
     and the bubble lands in flow under the greeting line
     instead of hanging off a small bust anchor. Every other
     variant keeps the shipped anchor geometry byte for byte. */
  const flowMount = bubbleVariant === "flow";
  const talkingNow = speech ? !!speech.talking : false;

  /* The small mark (audit wave step 8, 2026-11-01): below 120px
     she renders as the flat glyph (NovaGlyph.jsx, the locked
     values) inside the caller's own framing box, so no caller's
     layout moves; the bubble still renders beside it exactly as
     it does beside the figure. The band from 120 to 200 keeps
     the figure as it renders today, and 200 and above is
     untouched. The flow mount, the search home's greeting
     figure, was the first exclusion: the home's Nova is held
     for the owner's ruling (steps 3 and 7), so this routing
     does not decide her there.
     The resident speaker exemption (2026-11-12, staged with The
     Bench and not yet shipped): a mount that passes
     residentFigure is a place where she is the speaker, not a
     nav mark, so the glyph substitution retires for that mount
     and her cropped face renders at speaker sizes, the way the
     bust framing already crops her at 200 and below. Nav icons
     and other chrome mounts pass nothing and stay glyphs. The
     Bench tab is the first mount to opt in; other surfaces opt
     in only under the presence plan's own ship order. */
  const smallMark = size < 120 && !flowMount && !props.residentFigure;

  /* Framing. "full" and "panel" give the figure a box in its
     own proportions: the canvas is 480 by 640 and the drop
     stands on her contact shadow near its bottom line, so a
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
    <span ref={anchorRef} className="cb-nova-sprite" style={flowMount ? { display: "contents" } : { position: "relative", display: "inline-flex" }}>
      {smallMark ? (
        <span style={{ width: w, height: h, maxWidth: "100%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <NovaGlyph size={h} />
        </span>
      ) : fullBody ? (
        <span style={{ width: w, height: h, maxWidth: "100%", display: "block", ...(flowMount ? { gridArea: "bust", justifySelf: "start" } : null) }}>
          {figure}
        </span>
      ) : (
        <span style={{ width: w, height: h, display: "block", overflow: "hidden", position: "relative", flexShrink: 0, ...(flowMount ? { gridArea: "bust", justifySelf: "start" } : null) }}>
          <span style={{ width: bustInner, height: bustInner, display: "block", position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)" }}>
            {figure}
          </span>
        </span>
      )}
      {speech && speech.current && bubbleVariant && (
        <NovaBubble text={speech.current.text} variant={bubbleVariant} onDismiss={speech.dismiss}
          style={flowMount ? { gridArea: "bubble" } : undefined}
          action={speech.current.action ? {
            label: speech.current.action.label,
            /* Pressing the action does it and ends the line
               (2026-10-29): her wayfinding lives in the box
               that named the next thing. */
            onAction: () => {
              const a = speech.current && speech.current.action;
              if (a && a.onAction) a.onAction();
              speech.dismiss();
            },
          } : null} />
      )}
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
