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
     torso, a blink cycle, a faint sway in each gill, an
     occasional slow glance to the side and back, and the
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
   composed stern figure. */

import React, { useEffect, useRef, useState } from "react";

const SKIN = "#C97B63";
const COAT = "#FDF3D7";
const LINE = "#2A1A12";
const GOLD = "#A98A4C";
const HEAVY = 6;
const THIN = 2.5;
const GLASSES_W = 8;

const NOVA_FIGURE_CSS = `
.nvf-root .nvf-breathe { transform-box: view-box; transform-origin: 240px 528px; animation: nvfBreathe 4.8s ease-in-out infinite alternate; }
.nvf-root .nvf-tail { transform-box: view-box; transform-origin: 306px 532px; animation: nvfTail 9s ease-in-out infinite alternate; }
.nvf-root .nvf-gill { transform-box: view-box; animation: nvfGill 6.5s ease-in-out infinite alternate; }
.nvf-root .nvf-blink { animation: nvfBlink 5.6s linear infinite; }
.nvf-root .nvf-glance { animation: nvfGlance 13s ease-in-out infinite; }
.nvf-root .nvf-brow, .nvf-root .nvf-lids, .nvf-root .nvf-headexpr { transition: transform 300ms ease; }
.nvf-root .nvf-headexpr { transform-box: fill-box; transform-origin: 50% 62%; }
.nvf-root .nvf-mouth-smirk, .nvf-root .nvf-mouth-talk { display: none; }
.nvf-root[data-expression="pleased"] .nvf-mouth-flat { display: none; }
.nvf-root[data-expression="pleased"] .nvf-mouth-smirk { display: block; }
.nvf-root[data-talking="true"] .nvf-mouth-flat, .nvf-root[data-talking="true"] .nvf-mouth-smirk { display: none; }
.nvf-root[data-talking="true"] .nvf-mouth-talk { display: block; }
.nvf-root[data-talking="true"] .nvf-mouth-talk ellipse { transform-box: fill-box; transform-origin: 50% 50%; animation: nvfTalk 0.36s ease-in-out infinite alternate; }
.nvf-root[data-expression="greeting"] .nvf-brow { transform: translateY(-3px); }
.nvf-root[data-expression="greeting"] .nvf-lids { transform: translateY(-2px); }
.nvf-root[data-expression="pleased"] .nvf-brow-l { transform: translateY(-2.5px); }
.nvf-root[data-expression="thinking"] .nvf-lids { transform: translateY(2px); }
.nvf-root[data-expression="thinking"] .nvf-headexpr { transform: rotate(1.4deg) translateX(2px); }
.nvf-root[data-expression="deadpan"] .nvf-brow { transform: translateY(2px); }
.nvf-root[data-expression="poked"] .nvf-brow { transform: translateY(3.5px); }
.nvf-root[data-expression="poked"] .nvf-lids { transform: translateY(2.5px); }
.nvf-root[data-expression="fading"] .nvf-lids { transform: translateY(5px); }
.nvf-root[data-expression="sleep"] .nvf-lids { transform: translateY(11px); }
.nvf-root[data-expression="sleep"] .nvf-blink, .nvf-root[data-expression="sleep"] .nvf-glance { animation: none; }
.nvf-root[data-expression="sleep"] .nvf-breathe { animation-duration: 7.5s; }
.nvf-root.nvf-still *, .nvf-root.nvf-still { animation: none !important; transition: none !important; }
@keyframes nvfBreathe { from { transform: translateY(0) scale(1); } to { transform: translateY(-1.5px) scale(1.006); } }
@keyframes nvfTail { from { transform: rotate(-0.8deg); } to { transform: rotate(0.9deg); } }
@keyframes nvfGill { from { transform: rotate(-1.1deg); } to { transform: rotate(1.3deg); } }
@keyframes nvfBlink { 0%, 90%, 100% { transform: translateY(0); } 93%, 95% { transform: translateY(8px); } }
@keyframes nvfGlance { 0%, 36% { transform: translateX(0); } 43%, 55% { transform: translateX(3.5px); } 62%, 100% { transform: translateX(0); } }
@keyframes nvfTalk { from { transform: scaleY(0.7); } to { transform: scaleY(1.15); } }
@media (prefers-reduced-motion: reduce) {
  .nvf-root *, .nvf-root { animation: none !important; transition: none !important; }
}
`;

/* The resting expression and its neighbours, read off the
   same feeds the Rive contract carried. Sleep outranks
   everything; a result outranks a thought; the default,
   when nothing is being asked of her, is the stern face. */
function baseExpressionFor({ state, quizState, appState, sleepStage, scanning }) {
  if (sleepStage >= 2 || state === "asleep") return "sleep";
  if (sleepStage === 1 || state === "fading") return "fading";
  if (state === "greeting") return "greeting";
  if (state === "pleased" || quizState === 3 || quizState === 5 || appState === 2) return "pleased";
  if (state === "deadpan" || quizState === 4 || appState === 3) return "deadpan";
  if (state === "thinking" || scanning || quizState === 1 || quizState === 2 || appState === 1) return "thinking";
  return "stern";
}

export function NovaFigure(props) {
  const {
    state = null, quizState = 0, appState = 0, sleepStage = 0, scanning = false,
    talking = false, pointer = null, reducedMotion = false, pokeN = 0, celebrateN = 0,
    bust = false,
  } = props;
  /* Poke and celebrate arrive as counters, the same
     contract the canvas bound to triggers: a rising count
     flashes the matching expression, then she settles back
     to whatever the feeds say. A poke earns the narrowed
     look for a beat; a celebration earns the dry pleased
     face, never a bounce. */
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

  const expression = flash || baseExpressionFor({ state, quizState, appState, sleepStage, scanning });
  /* The pointer feed is the contract's joystick, minus 100
     to 100: it becomes a few degrees and a few pixels of
     head turn around the neck pivot, the layered parallax
     the rig always promised, and nothing larger. */
  const headTilt = pointer
    ? {
        transform: `rotate(${(pointer.x * 0.022).toFixed(2)}deg) translate(${(pointer.x * 0.035).toFixed(1)}px, ${(pointer.y * 0.02).toFixed(1)}px)`,
        transformOrigin: "240px 190px",
        transformBox: "view-box",
        transition: "transform 260ms ease",
      }
    : { transformOrigin: "240px 190px", transformBox: "view-box", transition: "transform 260ms ease" };

  return (
    <span style={{ display: "block", width: "100%", height: "100%" }}>
      <style>{NOVA_FIGURE_CSS}</style>
      <svg
        className={"nvf-root" + (reducedMotion ? " nvf-still" : "")}
        data-nova-figure="rig"
        data-expression={expression}
        data-talking={talking ? "true" : "false"}
        viewBox="0 0 480 640"
        preserveAspectRatio={bust ? "xMidYMin meet" : "xMidYMax meet"}
        width="100%"
        height="100%"
        style={{ display: "block" }}
        aria-hidden="true"
      >
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
        <g id="Upper" className="nvf-breathe">
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
          <g id="HeadTilt" style={headTilt}>
            <g id="Gill_L1" className="nvf-gill" style={{ transformOrigin: "168px 118px", animationDelay: "0s" }}>
              <path d="M 170 106 C 142 84 124 62 116 38 C 112 24 100 22 96 36 C 88 68 102 98 130 120 C 144 130 158 126 170 106 Z" fill={SKIN} stroke={LINE} strokeWidth={HEAVY} strokeLinejoin="round" />
            </g>
            <g id="Gill_L2" className="nvf-gill" style={{ transformOrigin: "164px 118px", animationDelay: "0.7s" }}>
              <path d="M 166 126 C 130 112 100 104 74 108 C 60 110 56 98 68 90 C 98 68 142 80 164 104 C 172 112 172 118 166 126 Z" fill={SKIN} stroke={LINE} strokeWidth={HEAVY} strokeLinejoin="round" />
            </g>
            <g id="Gill_L3" className="nvf-gill" style={{ transformOrigin: "162px 132px", animationDelay: "1.3s" }}>
              <path d="M 168 146 C 138 150 112 162 94 182 C 84 194 72 190 76 174 C 84 144 116 122 148 122 C 162 122 170 132 168 146 Z" fill={SKIN} stroke={LINE} strokeWidth={HEAVY} strokeLinejoin="round" />
            </g>
            <g id="Gill_R1" className="nvf-gill" style={{ transformOrigin: "312px 118px", animationDelay: "0.4s" }}>
              <path d="M 310 106 C 338 84 356 62 364 38 C 368 24 380 22 384 36 C 392 68 378 98 350 120 C 336 130 322 126 310 106 Z" fill={SKIN} stroke={LINE} strokeWidth={HEAVY} strokeLinejoin="round" />
            </g>
            <g id="Gill_R2" className="nvf-gill" style={{ transformOrigin: "316px 118px", animationDelay: "1s" }}>
              <path d="M 314 126 C 350 112 380 104 406 108 C 420 110 424 98 412 90 C 382 68 338 80 316 104 C 308 112 308 118 314 126 Z" fill={SKIN} stroke={LINE} strokeWidth={HEAVY} strokeLinejoin="round" />
            </g>
            <g id="Gill_R3" className="nvf-gill" style={{ transformOrigin: "318px 132px", animationDelay: "1.6s" }}>
              <path d="M 312 146 C 342 150 368 162 386 182 C 396 194 408 190 404 174 C 396 144 364 122 332 122 C 318 122 310 132 312 146 Z" fill={SKIN} stroke={LINE} strokeWidth={HEAVY} strokeLinejoin="round" />
            </g>
            <g id="Head">
              <path d="M 240 58 C 290 58 322 86 324 128 C 326 166 296 194 240 194 C 184 194 154 166 156 128 C 158 86 190 58 240 58 Z" fill={SKIN} stroke={LINE} strokeWidth={HEAVY} strokeLinejoin="round" />
              <g id="Face" className="nvf-headexpr">
                <g id="Brows">
                  <g id="Brow_L" className="nvf-brow nvf-brow-l">
                    <path d="M 186 98 C 198 96 216 97 226 101" fill="none" stroke={LINE} strokeWidth={HEAVY} strokeLinecap="round" />
                  </g>
                  <g id="Brow_R" className="nvf-brow nvf-brow-r">
                    <path d="M 254 101 C 264 97 282 96 294 98" fill="none" stroke={LINE} strokeWidth={HEAVY} strokeLinecap="round" />
                  </g>
                </g>
                <g id="Eyes" className="nvf-glance">
                  <path d="M 190 132 C 197 124 213 124 220 132 C 213 137 197 137 190 132 Z" fill={LINE} />
                  <path d="M 260 132 C 267 124 283 124 290 132 C 283 137 267 137 260 132 Z" fill={LINE} />
                </g>
                <g id="Lids" className="nvf-lids">
                  <g className="nvf-blink">
                    <path d="M 187 129 C 198 125 216 125 227 129 L 227 100 L 187 100 Z" fill={SKIN} />
                    <path d="M 187 129 C 198 125 216 125 227 129" fill="none" stroke={LINE} strokeWidth={HEAVY} strokeLinecap="round" />
                    <path d="M 253 129 C 264 125 282 125 293 129 L 293 100 L 253 100 Z" fill={SKIN} />
                    <path d="M 253 129 C 264 125 282 125 293 129" fill="none" stroke={LINE} strokeWidth={HEAVY} strokeLinecap="round" />
                  </g>
                </g>
                <g id="Glasses">
                  <rect x="183" y="104" width="48" height="46" rx="12" fill="none" stroke={GOLD} strokeWidth={GLASSES_W} />
                  <rect x="249" y="104" width="48" height="46" rx="12" fill="none" stroke={GOLD} strokeWidth={GLASSES_W} />
                  <path d="M 231 116 C 237 111 243 111 249 116" fill="none" stroke={GOLD} strokeWidth={GLASSES_W} />
                  <path d="M 183 114 L 162 108 M 297 114 L 318 108" stroke={GOLD} strokeWidth={GLASSES_W} strokeLinecap="round" />
                </g>
                <g id="Nose">
                  <circle cx="233" cy="156" r="2.6" fill={LINE} />
                  <circle cx="247" cy="156" r="2.6" fill={LINE} />
                </g>
                <g id="Mouth_Flat" className="nvf-mouth nvf-mouth-flat">
                  <path d="M 218 170 L 262 170" stroke={LINE} strokeWidth={HEAVY} strokeLinecap="round" />
                </g>
                <g id="Mouth_Pleased" className="nvf-mouth nvf-mouth-smirk">
                  <path d="M 218 169 C 232 173 250 172 261 164" fill="none" stroke={LINE} strokeWidth={HEAVY} strokeLinecap="round" />
                </g>
                <g id="Mouth_Talk" className="nvf-mouth nvf-mouth-talk">
                  <ellipse cx="240" cy="171" rx="6" ry="4.5" fill={LINE} />
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
