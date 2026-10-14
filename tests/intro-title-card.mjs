/**
 * Specimen-door regression tests.
 *
 * The intro is a ceremonial film door, not a search screen: the first
 * viewport shows verified claims on placards over a calm cinematic
 * reel, each claim traced to a real paper, and exactly one way in.
 * The product demonstrates itself instead of describing itself.
 *
 * These tests lock the contract of the RESTORED door (2026-10-13).
 * Dusty's directive the day the plate redesign shipped: "Bring back
 * the old intro page just make it better." The base is the door as it
 * stood at eb500f7 (film reel, calmed atmosphere, three placards
 * rotating as a set, "Start researching"), with the plate round's
 * discipline layered on: consent on the way in and never on load, an
 * honest proof line under every claim, a composed still frame under
 * reduced motion, and a collapsed ceremony for returning visitors.
 *
 * Plate pins retired by that directive, and why:
 *   - "single CTA reads Enter" and "no Start researching": the CTA is
 *     the old door's locked copy again, "Start researching".
 *   - "no timed rotation / one specimen at a time / hand stepper with
 *     a counter": the placards rotate as a set of three on a timer
 *     again, with full set steppers. That was the old door's life.
 *   - "the door mounts the DotField, not the film reel" and the
 *     vignette and PlateFrame pins: the film is back on the door; the
 *     DotField and the plate frame are no longer the door's furniture.
 *   - "serif wordmark with a two clause definition", "running head
 *     carries the plate number", "full width Enter key": plate
 *     furniture, gone with the plate door.
 *   - "the record strip names indexes, papers cited, and the paper"
 *     and the title extraction pin: the plate's record strip is
 *     replaced by the restored door's quiet proof line (same real
 *     count, the door's own voice).
 *   - "the Return key enters from anywhere": a plate door handle; the
 *     restored door's way in is its button, autofocused for returning
 *     visitors.
 *   PlateFrame, plateHead, and DotField remain exported from
 *   intro.jsx: the search stage and the consent gate still use the
 *   frame (pinned below and in core-identity).
 *
 * The app shell groups at the end (Plate II stage, consent trigger,
 * Continue heading, recents engagement, deck) pin CerebrumApp.jsx
 * behaviour that this restoration did not change.
 *
 * Run with: node tests/intro-title-card.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push({ name, error: e });
    console.log(`  ✗ ${name}\n      ${e.message}`);
  }
}

function group(name) {
  console.log(`\n${name}`);
}

// ══════════════════════════════════════════════════════════════════════════
group("The specimens — real claims, real papers");

const src = await readFile(join(root, "src/intro.jsx"), "utf8");
// Intro CSS keyframes live in the app's global CSS block (CerebrumApp.jsx).
const appSrc = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
const cssSrc = src + "\n" + appSrc;
const introFn = src.slice(src.indexOf("function Intro({"), src.indexOf("function CerebrumFieldCanvas"));

await test("SPECIMENS holds at least three specimens", () => {
  const m = src.match(/const SPECIMENS = \[([\s\S]*?)\n\];/);
  assert.ok(m, "SPECIMENS not defined");
  const claims = (m[1].match(/claim:/g) || []).length;
  assert.ok(claims >= 3, `only ${claims} specimens`);
});

await test("every specimen has a claim, a paper, and a DOI", () => {
  const m = src.match(/const SPECIMENS = \[([\s\S]*?)\n\];/);
  const block = m[1];
  for (const field of ["claim:", "paper:", "doi:"]) {
    const n = (block.match(new RegExp(field, "g")) || []).length;
    assert.ok(n >= 3, `field ${field} appears only ${n} times`);
  }
  assert.ok(block.includes("https://doi.org/"), "no DOI links in specimens");
});

await test("old headline and slogan are gone", () => {
  assert.ok(
    !src.includes("There&rsquo;s a world behind your question."),
    "old headline still present"
  );
  assert.ok(
    !src.includes("Ask a real research question. Every claim traces to a paper you can open."),
    "old slogan still present"
  );
});

await test("verdict line marks each claim as traced", () => {
  assert.ok(src.includes("Traced to a direct finding"), "verdict line missing");
});

await test("the single way in reads \"Start researching\"", () => {
  assert.ok(/>Start researching<\/button>/.test(src), "Start researching CTA missing");
  assert.ok(!/>Enter<\/button>/.test(src), "the plate's Enter key still present");
  const n = (src.match(/cb-intro-go/g) || []).length;
  assert.ok(n >= 1, "CTA class missing");
  const inIntro = (introFn.match(/className="cb-intro-go"/g) || []).length;
  assert.equal(inIntro, 1, `the door has ${inIntro} primary CTAs, expected exactly one`);
});

// ══════════════════════════════════════════════════════════════════════════
group("Rotation — three placards as a set, on a timer (restored door)");

await test("timed rotation advances the set by three", () => {
  assert.ok(introFn.includes("setInterval"), "no rotation timer on the door");
  assert.ok(introFn.includes("(i + setSize) % specimenCount"), "rotation does not advance by a full set");
  assert.ok(introFn.includes("const setSize = 3;"), "set size is not three");
  assert.ok(introFn.includes("isMobile ? 12000 : 9000"), "rotation cadence changed (9s desktop, 12s mobile)");
});

await test("three placards render as a set", () => {
  assert.ok(introFn.includes("SPECIMENS[(specimenIdx + k) % specimenCount]"), "the set of three is not built");
  assert.ok(introFn.includes("specimenSet.map"), "the set does not render");
});

await test("rotation pauses for a hold, a dialog, or reduced motion", () => {
  assert.ok(introFn.includes("if (specimenHeld || howOpen || sourcesOpen) return undefined;"), "hold and dialog pauses missing");
  assert.ok(introFn.includes("if (reduced || animationMode === \"off\") return undefined;"), "reduced motion does not stop the rotation");
  assert.ok(introFn.includes("onMouseEnter={() => setSpecimenHeld(true)}"), "hover hold missing");
});

await test("steppers move by a full set of three", () => {
  assert.ok(src.includes('aria-label="Previous three claims"'), "prev stepper missing");
  assert.ok(src.includes('aria-label="Next three claims"'), "next stepper missing");
  assert.ok(introFn.includes("(i - setSize + specimenCount) % specimenCount"), "prev step not wired by set");
});

await test("specimen change has its own entrance animation", () => {
  assert.ok(cssSrc.includes("@keyframes cbSpecimenIn"), "specimen keyframes missing");
  assert.ok(cssSrc.includes("cb-specimen-in"), "specimen entrance class missing");
});

// ══════════════════════════════════════════════════════════════════════════
group("Removals — the intro is a specimen, not an information stack");

await test("no pointer parallax anywhere in the intro", () => {
  assert.ok(!src.includes("heroColRef"), "parallax ref still referenced");
  assert.ok(!src.includes("cb-hero-enter"), "old hero entrance class still referenced");
});

await test("no rotating scene-question machinery", () => {
  assert.ok(!src.includes("cb-intro-scene"), "scene prompt class still referenced");
  assert.ok(!src.includes("scene.question"), "scene question lookup still referenced");
  assert.ok(!src.includes("Explore this question"), "explore link still present");
  assert.ok(!src.includes("sceneNo"), "editorial plate number still referenced");
});

await test("the old worked-example section is gone — the specimen is the example", () => {
  assert.ok(!src.includes("A real answer"), "old worked-example section still present");
  assert.ok(!src.includes("Do we have direct evidence of gravitational waves?"), "old example question still present");
});

// ══════════════════════════════════════════════════════════════════════════
group("The film door — cinema under calmed atmosphere (restored)");

await test("the door mounts the intro film reel, gated on motion", () => {
  assert.ok(introFn.includes("<CinematicFilm"), "intro does not mount the film reel");
  assert.ok(introFn.includes('reel="intro"'), "the door does not run the intro reel");
  assert.ok(introFn.includes("const animate = animationMode !== \"off\" && !reduced;"), "motion gate changed");
  assert.ok(introFn.includes("{animate && ("), "the film is not gated on the motion state");
});

await test("CinematicFilm keeps its media-event truth for the workspace", () => {
  // The reel component itself is unchanged (the workspace still uses
  // it); it reports the video element's ACTUAL playback state through
  // media events, never inferred intent.
  assert.ok(cssSrc.includes('addEventListener("playing"'), "no playing listener");
  assert.ok(cssSrc.includes('addEventListener("pause"'), "no pause listener");
  assert.ok(cssSrc.includes('addEventListener("play"'), "no play listener");
  assert.ok(cssSrc.includes("onPlaybackChange"), "onPlaybackChange not wired");
  assert.ok(cssSrc.includes("reportPlaying"), "no element-state reporter in the reel");
});

// ══════════════════════════════════════════════════════════════════════════
group("Orientation — the reel pick and the framing follow resize");

await test("the two one shot orientation reads are gone", () => {
  assert.ok(!src.includes("window.innerHeight > window.innerWidth"),
    "a one shot innerHeight/innerWidth comparison survives in intro.jsx");
  assert.ok(!src.includes('matchMedia("(max-width: 900px)")'),
    "a one shot matchMedia width read survives in intro.jsx");
});

await test("filmReel takes the orientation from its caller", () => {
  assert.ok(src.includes("function filmReel(pro, reel, portrait)"),
    "filmReel does not take the orientation as an argument");
  assert.ok(src.includes("return portrait && FILM_CLIPS_PORTRAIT.length ? FILM_CLIPS_PORTRAIT : FILM_CLIPS_LANDSCAPE;"),
    "filmReel's portrait pick changed shape");
});

await test("CinematicFilm reads orientation and framing width through the hooks", () => {
  const filmFn = src.slice(src.indexOf("export const CinematicFilm"));
  assert.ok(src.includes("useIsMobile, useWindowWidth, useWindowHeight"),
    "intro.jsx does not import the resize aware width and height hooks");
  assert.ok(filmFn.includes("const winW = useWindowWidth();"), "CinematicFilm does not read the width hook");
  assert.ok(filmFn.includes("const winH = useWindowHeight();"), "CinematicFilm does not read the height hook");
  assert.ok(filmFn.includes("const portrait = winH > winW;"), "the portrait test is not built from the two hooks");
  assert.ok(filmFn.includes("filmReel(proReel, reel, portrait)"), "the reel pick does not receive the hook orientation");
  assert.ok(filmFn.includes("orderRef.current._clips !== reelClips"),
    "the reshuffle is not keyed on the picked list, so an orientation flip would not re-pick");
  assert.ok(filmFn.includes("const narrow = winW <= 900;"),
    "the framing does not derive from the hook width at the old matchMedia line");
});

await test("appUtils carries the height hook in the same style as the width hook", async () => {
  const appUtilsSrc = await readFile(join(root, "src/appUtils.js"), "utf8");
  const hAt = appUtilsSrc.indexOf("function useWindowHeight()");
  assert.ok(hAt > 0, "useWindowHeight is missing from appUtils.js");
  const hSrc = appUtilsSrc.slice(hAt, appUtilsSrc.indexOf("const TONES", hAt));
  assert.ok(hSrc.includes("window.innerHeight : 800"),
    "useWindowHeight lost the windowless default that keeps the reel on its landscape fallback");
  assert.ok(hSrc.includes('addEventListener("resize"'), "useWindowHeight does not subscribe to resize");
  assert.ok(appUtilsSrc.includes("widthToMode, useWindowHeight"),
    "useWindowHeight is not exported from appUtils");
});

await test("the calm air is present: atmosphere and grain over the film", () => {
  assert.ok(introFn.includes("cb-intro-atmosphere"), "atmosphere layer missing");
  assert.ok(introFn.includes("cb-atmo-a") && introFn.includes("cb-atmo-well"), "atmosphere fields missing");
  assert.ok(introFn.includes("cb-intro-grain"), "grain missing");
  assert.ok(introFn.includes('filter: "brightness(0.42) saturate(0.72)"'), "the film is not graded dark and quiet");
});

await test("the film guard stands: the intro reel is the frame checked pair", () => {
  // eb500f7's permanent guard (scripts/check.mjs section 8) allowlists
  // frame checked clips at build time. The door's reel is the pair
  // verified by pulled frames on 2026-10-12; the banned clips (52298
  // burning book, 5774 bright VR lab) never return as URLs.
  const reel = src.slice(src.indexOf("const FILM_CLIPS_INTRO"), src.indexOf("const FILM_CLIPS_CALM"));
  assert.ok(reel.includes("videos/30563/30563-720.mp4"), "dark matter clip missing from the intro reel");
  assert.ok(reel.includes("videos/20231/20231-720.mp4"), "dark clouds clip missing from the intro reel");
  assert.ok(!src.includes("videos/52298"), "the burning book clip is back");
  assert.ok(!src.includes("videos/5774"), "the bright VR lab clip is back");
});

await test("no inferred autoplay-blocked flag survives", () => {
  assert.ok(!src.includes("autoplayBlocked"), "inferred autoplay flag still present");
});

await test("the door is a threshold: no composer on the landing screen", () => {
  assert.ok(!introFn.includes("<textarea"), "a composer textarea sits on the door");
  assert.ok(!introFn.includes("SignalComposer"), "the workspace composer sits on the door");
  assert.ok(!introFn.includes("placeholder="), "a search field sits on the door");
});

await test("the intro never summons the consent gate", () => {
  // Consent timing (plate round, kept): the gate appears on the way
  // in, in the app shell, never covering the door on load. The door
  // itself carries no gate and no legal machinery.
  assert.ok(!src.includes("ConsentGate"), "the door renders the consent gate");
  assert.ok(!src.includes("cb_legal"), "the door touches the legal consent state");
  assert.ok(!src.includes("LEGAL_VERSION"), "the door touches the legal version");
});

// ══════════════════════════════════════════════════════════════════════════
group("Retired plate furniture — gone from the door, kept for other surfaces");

await test("the door renders no plate frame, dot field, or running head", () => {
  assert.ok(!introFn.includes("<PlateFrame"), "the door still renders inside the plate frame");
  assert.ok(!introFn.includes("<DotField"), "the door still mounts the dot field");
  assert.ok(!introFn.includes("Plate I · Entrance"), "plate label still on the door");
  assert.ok(!introFn.includes("Scientific literature, traced"), "running head still on the door");
  assert.ok(!introFn.includes("Fig. {specimenIdx"), "figure label still on the door");
  assert.ok(!introFn.includes("stepSpecimen"), "the hand stepper survives");
  assert.ok(!introFn.includes("Claim {specimenIdx + 1} of"), "the plate counter survives");
  assert.ok(!introFn.includes('e.key !== "Enter"'), "the plate's global Return handler survives");
  assert.ok(!src.includes("A search instrument for the scientific literature, asked in plain language."), "plate definition clause (a) survives");
  assert.ok(!src.includes("Every answer is traced to the papers behind it, so any claim can be opened and checked."), "plate definition clause (b) survives");
});

await test("plateHead and DotField stay exported; the dead PlateFrame is gone", () => {
  /* Contract corrected by the frontend audit (third panel rescore):
     PlateFrame rendered nowhere in the app (zero <PlateFrame> call
     sites; the restored film door never used it), so the dead frame
     was removed and the one live frame language is TickFrame on the
     answer viewport. This pin used to require PlateFrame's export;
     it now requires its absence, while plateHead (live in the shell's
     home stage running heads) and DotField stay exported. */
  assert.ok(!src.includes("export function PlateFrame"), "the dead PlateFrame is exported again");
  assert.ok(!appSrc.includes("<PlateFrame"), "something renders the dead frame");
  assert.ok(src.includes("export const plateHead"), "plateHead no longer exported");
  assert.ok(src.includes("export function DotField"), "DotField no longer exported");
  assert.ok(appSrc.includes("plateHead"), "the shell no longer uses the plate voice at all");
});

// ══════════════════════════════════════════════════════════════════════════
group("Quiet sci-fi — focus-pull entrance, small type, whisper CTA");

await test("focus-pull keyframes exist and resolve blur to sharp", () => {
  assert.ok(cssSrc.includes("@keyframes cbFocusIn"), "cbFocusIn not defined");
  const kf = cssSrc.slice(cssSrc.indexOf("@keyframes cbFocusIn"), cssSrc.indexOf("@keyframes cbFocusIn") + 200);
  assert.ok(kf.includes("blur("), "focus-pull does not use blur");
  assert.ok(!kf.includes("translate"), "focus-pull must not move the type");
});

await test("hero text uses a premium entrance (focus-pull or specimen-in)", () => {
  assert.ok(src.includes('"cb-focus-in"') || src.includes('"cb-specimen-in"'), "no premium entrance applied to hero text");
});

await test("old fade-and-rise entrance is fully gone", () => {
  assert.ok(!src.includes("cb-title-in"), "cb-title-in class still referenced");
  assert.ok(!src.includes("cbTitleIn"), "cbTitleIn keyframes still referenced");
});

await test("the door header is the wordmark and quiet links", () => {
  assert.ok(introFn.includes("<Mark size={19}"), "wordmark glyph missing from the header");
  assert.ok(introFn.includes(">CEREBRUM</span>"), "tracked wordmark missing");
  assert.ok(introFn.includes('["About", "Privacy", "Contact"]'), "quiet header links missing");
});

await test("the CTA is set in normal case, not tracked caps", () => {
  const ctaAt = introFn.indexOf('className="cb-intro-go"');
  assert.ok(ctaAt > 0, "CTA button missing");
  const cta = introFn.slice(ctaAt, ctaAt + 700);
  assert.ok(cta.includes('textTransform: "none"'), "CTA not set in normal case");
  assert.ok(!cta.includes('textTransform: "uppercase"'), "CTA still set as tracked caps");
  assert.ok(!src.includes("cb-intro-go::after"), "CTA light sweep still present");
  assert.ok(
    !src.includes("0 14px 34px rgba(163,184,153,0.30)"),
    "old chunky sage CTA shadow still present"
  );
});

await test("reduced motion kills the focus-pull", () => {
  assert.ok(cssSrc.includes(".cb-focus-in { animation: none; }"), "reduced-motion override missing");
});

// ══════════════════════════════════════════════════════════════════════════
group("The proof line — honest numbers under every claim");

await test("each placard carries the quiet proof line with the real count", () => {
  assert.ok(introFn.includes("Traced to a real paper · Searched across {SCHOLARLY_SOURCES.length} scholarly indexes"), "proof line missing or not built from the real source list");
  assert.ok(!/Searched across \d+ scholarly indexes/.test(introFn), "the index count is hardcoded, not the real list");
});

await test("the plate's record strip is retired", () => {
  assert.ok(!introFn.includes("Indexes searched"), "record strip cell survives");
  assert.ok(!introFn.includes("Papers cited"), "record strip cell survives");
  assert.ok(!introFn.includes("recordCell"), "record strip builder survives");
});

await test("the paper is reachable the way the old door linked it", () => {
  assert.ok(introFn.includes("Open the paper"), "open the paper link missing");
  assert.ok(introFn.includes("href={spec.doi}"), "the link does not use the specimen's DOI");
});

// ══════════════════════════════════════════════════════════════════════════
group("Returning visitors and reduced motion — the composed door");

await test("repeat visits in a session collapse the ceremony", () => {
  assert.ok(introFn.includes('sessionStorage.getItem("cerebrum-entered")'), "entered flag never read");
  assert.ok(introFn.includes('sessionStorage.setItem("cerebrum-entered", "1")'), "entered flag never set");
  assert.ok(introFn.includes("autoFocus={enteredBefore || undefined}"), "returning door does not focus the way in");
  assert.ok(introFn.includes("const ceremony = animate && !enteredBefore;"), "returning visitors still get the entrance choreography");
  assert.ok(introFn.includes("(reduced || enteredBefore) && !leaving"), "returning door does not take the still treatment");
});

await test("reduced motion is one still, composed frame", () => {
  // No film (the animate gate above), no rotation (the effect's early
  // return above), and the wrap takes the still class whose CSS
  // freezes the atmosphere and resolves the chrome in a single fade.
  assert.ok(introFn.includes('"cb-intro-still"'), "still class never applied");
  assert.ok(cssSrc.includes(".cb-intro-still .cb-intro-atmosphere > div { animation: none; }"), "the still frame does not freeze the atmosphere");
  assert.ok(cssSrc.includes(".cb-intro-still .cb-intro-chrome { animation: cbIntroStillIn"), "the still frame has no composed entrance");
});

// ══════════════════════════════════════════════════════════════════════════
group("DotField discipline (component retained; no longer the door's ambient)");

await test("the field is capped, pausable, and faint", () => {
  assert.ok(src.includes("Math.min(window.devicePixelRatio || 1, 1.5)"), "DPR not capped at 1.5");
  assert.ok(src.includes("visibilitychange") && src.includes("document.hidden"), "field does not pause when hidden");
  assert.ok(src.includes("count = 76"), "dot count changed from the plate spec");
  assert.ok(src.includes("0.05 + rnd() * 0.03"), "dot opacity left the 5 to 8 percent band");
  assert.ok(src.includes("40000 + rnd() * 20000"), "drift cycle left the 40 to 60 second band");
});

// ══════════════════════════════════════════════════════════════════════════
group("Plate II, the consent trigger, and the Continue heading");

await test("the consent gate renders exactly once, in the app shell", () => {
  const n = (appSrc.match(/<ConsentGate/g) || []).length;
  assert.equal(n, 1, `ConsentGate renders ${n} times`);
  const introBranch = appSrc.slice(appSrc.indexOf("if (!entered) {"), appSrc.indexOf("const started = turns.length"));
  assert.ok(!introBranch.includes("ConsentGate"), "the gate still overlays the intro");
  assert.ok(appSrc.includes("{!legalOk && ("), "the shell gate is no longer unconditional");
});

await test("the stage keeps one centred column inside the standard shell", () => {
  /* Contract revised 2026-10-13 on Dusty's directive ("bring back
     the side bar but make it better"), superseding the plate pass
     contract this test originally pinned: the desktop sidebar renders
     on the stage exactly as it does over a thread, and the main
     offset is the standard sidebar offset. What survives from the
     plate pass is the single centred 720 column, so the scatter
     cannot return. The fuller pin set for the restored stage lives
     in tests/core-identity.mjs ("Home stage: sidebar restored"). */
  assert.ok(appSrc.includes('const homeStage = view === "search" && !started'), "homeStage not derived from the empty state");
  assert.ok(!appSrc.includes("(!homeStage || isMobile)"), "sidebar is still conditional on the stage");
  assert.ok(appSrc.includes("marginLeft: isMobile ? 0 : (railCollapsed ? 68 : 216)"), "main offset is not the standard sidebar offset");
  assert.ok(!appSrc.includes("marginLeft: isMobile || homeStage ? 0"), "stage still zeroes the sidebar offset");
});

await test("the stage carries the plate order and no corpus number", () => {
  const stage = appSrc.slice(
    appSrc.indexOf("Plate II (2026-10-13): the empty search home"),
    appSrc.indexOf("<div style={{ ...S.workspace,")
  );
  assert.ok(stage.length > 1000, "stage block not found");
  assert.ok(stage.includes("maxWidth: 720"), "stage column is not 720px");
  assert.ok(stage.includes("Plate II · Inquiry"), "plate label missing from the stage");
  assert.ok(stage.includes('variant="stage"'), "composer not in its stage variant");
  assert.ok(stage.includes("coverage disclosure"), "method line does not name the coverage disclosure");
  assert.ok(stage.includes("Search record"), "method line does not name the Search record");
  assert.ok(stage.includes("Continue investigation"), "continue row missing");
  assert.ok(stage.includes("Specimen inquiries"), "inquiries list missing");
  assert.ok(stage.includes("Traced claim"), "footer claim strip missing");
  assert.ok(!stage.includes("scholarly indexes"), "a corpus number sits on the stage");
  assert.ok(!stage.includes("SCHOLARLY_SOURCES.length"), "a corpus count sits on the stage");
});

await test("the stage composer rotates real specimen questions", () => {
  assert.ok(appSrc.includes("STAGE_PLACEHOLDER_QUESTIONS"), "placeholder pool missing");
  assert.ok(appSrc.includes("specimenPlaceholders"), "composer never receives the pool");
  assert.ok(appSrc.includes("cb-ask--stage"), "stage composer CSS missing");
  assert.ok(appSrc.includes("cb-ask-go--round"), "round submit key missing");
});

await test("the Continue heading can never break a sentence", () => {
  const m = appSrc.match(/function shortSubject\(q\) \{([\s\S]*?)\n\}/);
  assert.ok(m, "shortSubject not found");
  const fn = new Function("q", m[1]);
  const cases = [
    "What are the advantages are Bayesian statistics vs. p-value statistics?",
    "What is CRISPR-Cas9 and how does it cut DNA?",
    "How does the gut microbiome affect digestion in black soldier fly larvae?",
    "Do GLP-1 drugs like Ozempic protect the heart too?",
    "soil drying patterns",
  ];
  for (const q of cases) {
    assert.equal(fn(q), q, "heading altered the question: " + q);
  }
  assert.ok(!appSrc.includes("your investigation into"), "the glue prefix survives");
  assert.ok(appSrc.includes("&ldquo;{shortSubject(lastQ)}&rdquo;"), "the deck heading does not quote the question");
});

await test("deck and stage share the one Continue data walk", () => {
  const n = (appSrc.match(/lastInvestigationQuestion\(history\)/g) || []).length;
  assert.ok(n >= 2, `lastInvestigationQuestion used ${n} times, expected the deck and the stage`);
});

// ══════════════════════════════════════════════════════════════════════════
group("Plate II browser fixes (2026-10-13, live verification findings)");

await test("the stage bar carries no centre running head to truncate", () => {
  /* Live finding: the stage's six nav links squeezed the centred
     running head into "SCIENTIFIC LITERAT…". The stage bar now drops
     its centre entirely (the Plate II eyebrow below the bar carries
     the identity), while the intro keeps its full centre text: its
     right side is one short plate label and the text fits. */
  const stage = appSrc.slice(
    appSrc.indexOf("Plate II (2026-10-13): the empty search home"),
    appSrc.indexOf("<div style={{ ...S.workspace,")
  );
  assert.ok(!stage.includes("Scientific literature, traced"), "stage bar still renders the truncating centre text");
  assert.ok(!stage.includes("headCenter"), "stage still passes a headCenter");
  const introFn2 = src.slice(src.indexOf("function Intro({"), src.indexOf("function CerebrumFieldCanvas"));
  /* Restored door (2026-10-13 directive): the intro carries no running
     head at all. The plate's centre text belonged to the plate door,
     which the directive superseded the day it shipped. */
  assert.ok(!introFn2.includes("Scientific literature, traced"), "the restored intro grew a running head centre");
});

await test("recents open only on the visitor's own engagement", () => {
  /* Live finding: the composer's recents dropdown opened itself
     shortly after the stage loaded. Cause: the app focus pulls the
     field on entry (an effect keyed on `entered`) and refocuses it
     on timers, and a programmatic .focus() fires the same onFocus a
     click would, which used to open the list unconditionally. The
     corrected contract: onFocus opens the list only when the focus
     episode was engaged by the visitor (pointer press inside the
     composer, Tab onto the field, a keypress inside it), and the
     engagement resets on blur. */
  const composer = appSrc.slice(
    appSrc.indexOf("function SignalComposer("),
    appSrc.indexOf("/* ── SSE search streaming")
  );
  assert.ok(composer.length > 1000, "composer block not found");
  assert.ok(composer.includes("const engageRef = useRef(false)"), "engagement marker missing");
  assert.ok(
    composer.includes("if (engageRef.current && recents.length > 0) setRecentOpen(true)"),
    "onFocus opens the list without an engagement check"
  );
  assert.ok(
    !composer.includes("setRecentActive(-1); if (recents.length > 0) setRecentOpen(true)"),
    "the old unconditional onFocus opener survives"
  );
  assert.ok(composer.includes("onPointerDownCapture"), "pointer engagement not captured");
  assert.ok(composer.includes('if (e.key === "Tab") engageRef.current = true'), "Tab engagement not captured");
  assert.ok(composer.includes("engageRef.current = false"), "engagement never resets on blur");
  assert.ok(composer.includes('e.key === "ArrowDown"'), "ArrowDown summon missing");
  /* The self opening source stays honest: initial state closed. */
  assert.ok(composer.includes("useState(false)"), "recents state no longer starts closed");
});

await test("the stage renders exactly one Continue affordance", () => {
  /* Live finding: the stage showed its ruled Continue row AND the
     deck's own "Where you left off" card, same question, same Keep
     going and History actions. Corrected contract: HomeDeck takes a
     suppressContinue prop (default off, deck unchanged elsewhere)
     that stands the card down, and the stage passes it. */
  assert.ok(appSrc.includes("suppressContinue = false"), "deck prop missing or no longer defaults off");
  assert.ok(appSrc.includes("lastQ && !suppressContinue"), "the left off card is not gated on the prop");
  const stage = appSrc.slice(
    appSrc.indexOf("Plate II (2026-10-13): the empty search home"),
    appSrc.indexOf("<div style={{ ...S.workspace,")
  );
  const deckUse = stage.slice(stage.indexOf("<HomeDeck"));
  assert.ok(deckUse.startsWith("<HomeDeck\n                      suppressContinue"), "the stage does not pass suppressContinue to the deck");
  assert.ok(appSrc.includes('label="Where you left off"'), "the deck card itself was removed instead of gated");
});

// ══════════════════════════════════════════════════════════════════════════
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
