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
 * The app shell groups at the end (home stage, consent trigger,
 * Continue heading, recents engagement, deck) pin CerebrumApp.jsx
 * behaviour that this restoration did not change.
 *
 * 2026-10-16 (Dusty's directive): the film door is retired. His
 * verdict was that it looked AI generated and did not match the app,
 * and he ordered the intro rebuilt in the app's own design language.
 * The door is now a flat page of the app: the caller's palette for
 * ground, cards, and ink; the search stage masthead's lockup;
 * specimen claims on the app's card treatment; the way in as the
 * app's flat primary button. Gone from the door: the reel, the
 * atmosphere fields, the grain, the fanned glass cards, the tracked
 * caps wordmark. The reel component is untouched and still serves
 * the workspace. Pins that asserted the film door's furniture were
 * updated to the new contract the same day, marked at their sites;
 * the door rule, the specimens, the rotation, the proof line, and
 * the returning and reduced behavior stand as pinned before.
 *
 * 2026-10-19 (Dusty's order): the flat door was reimagined as a two
 * column room: a threshold column, a numbered evidence ledger of
 * the specimens, and a Nova section. 2026-10-20 (Dusty's verdict,
 * on seeing it live): "way too AI and busy." He ordered the
 * cinematic back. The door is the film door again, on the core list
 * only: the reel under the one calm grade the app grades all its
 * film with, the lockup, the one plain sentence, ONE specimen at a
 * time on a solid matte placard, the proof line, the single way in,
 * and Nova as one figure and one line with no section around her.
 * The ledger, the dot field, the haze fields, the steppers, and
 * the sets of three are retired by this verdict; the pins that
 * asserted them were updated at their sites the same day, each
 * marked. The door rule, the proof line, and the returning and
 * reduced behavior stand as pinned before.
 *
 * 2026-10-20 (owner photo, later the same day): the restored door's
 * clouds were too bright at placard height. Measured on pulled
 * frames, the swirling clouds clip (20231) opens at mean luminance
 * 159.5 with p95 234.8, so it left the intro reel for the darkest
 * frame checked calm clip (10011, stars, mean 1.4), and the door
 * grade darkened door locally: wrapper brightness 0.30 to 0.22 and
 * intensity 0.50 to 0.30. The grade, the intensity, and the exact
 * reel list are pinned at their sites below so the calm grade
 * cannot silently drift brighter again. The film itself, the 11
 * second holds, the placard, the lockup, the rotation, and the
 * single way in are unchanged.
 *
 * 2026-10-23 (Dusty's order): "Keep the cinematic feel but re
 * arrange and re imagine." The room's arrangement changed, nothing
 * else did. The centred stack became two groups on the header's
 * axis: the sentence and the way in high in the frame, left
 * aligned; Nova's line, the specimen plate, and the proof line low
 * in the frame, the plate widened to the room's column with the
 * citation at its right end on desktop. The film, the grade, the
 * intensity, the reel list, the sentence word for word, the proof
 * line, the solid plate ground, the rotation, and the single way
 * in all stand as pinned before; no pin in this file asserted the
 * old centred arrangement, so no pin changed. Measured the same
 * day on five pulled frames per clip, the rearrangement moves the
 * text bands on the dark matter clip from graded p95 14.6 and
 * 15.1 to 11.1 and 10.7 without touching the grade. Note for the
 * record: the huge audit of this same day reported the deployed
 * door as flat with a test pinning the flat door; that reading
 * came from the stale 423ac66 checkout. At the deployed commit
 * the door is the film door restored on 2026-10-20, the pin in
 * core-identity asserts the film is present in the Intro, and no
 * flat door pin exists in this file or that one.
 *
 * 2026-10-28 (the owner's material order, evening): the door was
 * reimagined at noon the same day (film frame, title block,
 * caption strip) and his verdict on it was that it looks the same
 * but with animations, because the cinematic material underneath
 * never changed. His order: "bring in all new cinematic elements
 * and backgrounds, do not reuse any of the old ones." The reel,
 * its exact clip list, the door grade (brightness 0.22, saturate
 * 0.60, blur 12px), the intensity dim, the graded poster, and the
 * static grain tile are all retired from the door. In their place
 * the door mounts IntroAtmosphere (src/introAtmosphere.jsx):
 * mist strata, a breathing light, motes, and animated grain,
 * authored for this door and rendered live in a shader, with one
 * composed still of the same material for reduced motion. The
 * three pins that guarded the old material (the film mount and
 * grade pin, the exact reel pair pin, and the calm is the film
 * pin) are rewritten at their sites below, each marked with this
 * date and order, to guard the new material instead: the
 * atmosphere mounted, the old material absent, the banned clips
 * still banned. Every structural pin (the sentence word for
 * word, Nova once with her line, one way in, the specimens and
 * their papers, the proof line, no dashes) stands unmodified.
 *
 * 2026-10-28 (later that night, the owner's concept pick): after
 * three doors in one day converged on the same stack (wordmark,
 * headline, button, Nova row, specimen), the owner picked the
 * concept himself: "Title card, Cerebrum as the film title." The
 * door is now a film title card: the word Cerebrum set as a title
 * over the living neutral atmosphere, one small line under it
 * ("Answers from published research."), and one quiet text way
 * in ("Tap to begin"). Everything else left the door: the
 * headline sentence, the specimen block and its rotation, the
 * proof line, the header and its links, the sage button, and
 * Nova. Proof and specimens live inside the app now. The pins
 * that guarded those elements are rewritten at their sites
 * below, each marked with this date and pick, to guard the title
 * card contract instead: the title present, exactly the allowed
 * elements, the retired elements absent, entry working. The
 * material pins, the film guard, the no composer and no consent
 * pins, the returning and reduced pins, and every app shell pin
 * at the end of this file stand unmodified.
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
group("The title card — the title, the one line, the way in (owner's pick 2026-10-28)");

const src = await readFile(join(root, "src/intro.jsx"), "utf8");
// Intro CSS keyframes live in the app's global CSS block (CerebrumApp.jsx).
const appSrc = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
const cssSrc = src + "\n" + appSrc;
const introFn = src.slice(src.indexOf("function Intro({"), src.indexOf("function CerebrumFieldCanvas"));

await test("the door carries no specimen data and renders no claim", () => {
  /* Pins rewritten 2026-10-28 (the title card, the owner's concept
     pick: "Title card, Cerebrum as the film title"). The two pins
     here used to require the SPECIMENS array and its claims,
     papers, and DOIs on the door. The pick retires the specimen
     block from the door entirely; the specimens live inside the
     app now. These pins guard the absence with the same strength:
     no data, no pick, no specimen state anywhere in the door. */
  assert.ok(!src.includes("const SPECIMENS"), "the SPECIMENS array is back in intro.jsx");
  assert.ok(!introFn.includes("specimen"), "specimen machinery is back on the door");
  assert.ok(!introFn.includes("SPECIMENS["), "the door picks a specimen again");
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

await test("the proof line is not on the door; proof lives inside the app", () => {
  /* Pin rewritten 2026-10-28 (the title card, the owner's concept
     pick). This pin used to require the proof line ("Traced to a
     real paper") as the door's sole traced statement. The pick
     moves all proof inside the app: the door states nothing about
     evidence at all. The duplicate inner traced row ban stands. */
  assert.ok(!introFn.includes("Traced to a real paper"), "the proof line is back on the door");
  assert.ok(!src.includes("Traced to a direct finding"), "the duplicate inner traced row came back");
});

await test("the title is the word Cerebrum, set as the film title", () => {
  /* New pin 2026-10-28 (the title card, the owner's concept pick).
     The one element the door is built around: the word itself in
     an h1, taking the staged entrance's title beat. */
  assert.ok(introFn.includes("Cerebrum</h1>"), "the title word is missing from the door");
  assert.ok(introFn.includes('className="cb-door-stage-2"'), "the title does not take its staged entrance beat");
});

await test("the one small line under the title says what Cerebrum is, plainly", () => {
  /* New pin 2026-10-28 (the title card, the owner's concept pick).
     One line, no slogan cadence, no source count: the honesty
     numbers belong inside the app. */
  assert.ok(introFn.includes("Answers from published research."), "the line under the title changed");
  assert.ok(!introFn.includes("scholarly indexes"), "the source count crept back onto the door");
});

await test("the single way in is one quiet text affordance reading \"Tap to begin\"", () => {
  /* Pin rewritten 2026-10-28 (the title card, the owner's concept
     pick). This pin used to require the filled sage button reading
     "Start researching" as the door's one primary CTA. The pick
     replaces it with one quiet text affordance, and the whole card
     stays tappable around it. The plate's Enter key ban stands. */
  assert.ok(introFn.includes(">Tap to begin</button>"), "the quiet way in is missing");
  assert.ok(!/>Enter<\/button>/.test(src), "the plate's Enter key still present");
  assert.ok(!introFn.includes("cb-intro-go"), "the filled button's class is back on the door");
  const inIntro = (introFn.match(/className="cb-door-begin"/g) || []).length;
  assert.equal(inIntro, 1, `the door has ${inIntro} way in affordances, expected exactly one`);
  assert.ok(introFn.includes('onClick={() => go("", false)}'), "the card itself no longer begins entry on tap");
});

// ══════════════════════════════════════════════════════════════════════════
group("No rotation — the card holds still (title card 2026-10-28)");

await test("nothing on the door rotates or advances", () => {
  /* Pins rewritten 2026-10-28 (the title card, the owner's concept
     pick). This group used to pin the specimen rotation: a timer
     advancing by one, one placard at a time, pauses for hold and
     dialog, no steppers. The title card has nothing to rotate;
     the title simply holds. The pins now guard that stillness
     with the same strength, and the stepper bans stand. */
  assert.ok(!introFn.includes("setInterval"), "a timer is back on the door");
  assert.ok(!introFn.includes("specimenIdx"), "the rotation index is back on the door");
  assert.ok(!introFn.includes("specimenHeld"), "the hold state is back on the door");
  assert.ok(!src.includes('aria-label="Previous three claims"'), "the set stepper is back");
  assert.ok(!src.includes('aria-label="Next three claims"'), "the set stepper is back");
  assert.ok(!src.includes('aria-label="Previous claim"'), "a single stepper is back");
  assert.ok(!src.includes('aria-label="Next claim"'), "a single stepper is back");
});

await test("the title takes the staged entrance", () => {
  /* Pin rewritten 2026-10-28 (the title card, the owner's concept
     pick). This pin used to guard the specimen change animation.
     There is no specimen change anymore; what animates is the
     card's own staged entrance, and the title's beat is the rise. */
  assert.ok(introFn.includes('className="cb-door-stage-2"'), "the title lost its entrance beat");
  assert.ok(cssSrc.includes("@keyframes cbDoorRise"), "the entrance rise keyframes are missing");
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
group("The door and its material (film restored 2026-10-20; new material 2026-10-28)");

await test("the door mounts the new atmosphere; the reel and its grade are gone", () => {
  // 2026-10-16: this pin replaced the film mount pin of the restored
  // door. The rebuilt door mounted no reel, no atmosphere, and no
  // grain; its ground was the palette's flat background.
  // 2026-10-19: the redesign restored atmosphere only, the dot
  // field and the blurred haze behind the chrome. The reel, the
  // grain, and the old atmosphere fields stayed banned.
  // 2026-10-20: Dusty saw the ledger door live and rejected it
  // ("way too AI and busy"), ordering the cinematic back. This pin
  // is reversed again at his word: the door mounts the intro reel
  // as its foundation, graded with the one grade every film in the
  // app carries (the shell lane's unified grade, S7/H6), and the
  // dot field and haze fields leave the door, because where the
  // field and the film would fight, the film wins. The grain and
  // the old glow atmosphere fields stay banned.
  // 2026-10-28 (evening, the owner's material order): reversed
  // again at his word, and this time the material itself is what
  // changed. The reimagined door shipped at noon kept the reel
  // (30563 and 10011) under the door grade (brightness 0.22,
  // saturate 0.60, blur 12px, intensity 0.30), and his verdict was
  // that it looked the same but with animations. His order: all
  // new cinematic elements and backgrounds, none of the old ones
  // reused. This pin now guards the replacement: the door mounts
  // IntroAtmosphere with its three contracts wired (the still for
  // reduced motion and Off, the swell for the door opening, the
  // fixed clock for cinema), and the old material is absent, not
  // merely unpinned: no reel mount, no intro reel pick, no grade
  // filter, no intensity dim on the door. The dot field, haze, and
  // old atmosphere field bans stand exactly as before: where they
  // would fight the atmosphere, the atmosphere wins.
  assert.ok(introFn.includes("<IntroAtmosphere"), "the door lost its atmosphere");
  assert.ok(introFn.includes('still={reduced || animationMode === "off"}'), "the atmosphere does not take the still contract");
  assert.ok(introFn.includes("swell={leaving}"), "the atmosphere does not take the opening swell");
  assert.ok(introFn.includes("fixedClock={!!cinema}"), "the atmosphere does not take the cinema fixed clock");
  assert.ok(!introFn.includes("<CinematicFilm"), "the film reel is back on the door");
  assert.ok(!introFn.includes('reel="intro"'), "the door plays the retired intro reel");
  assert.ok(!introFn.includes("brightness(0.22)"), "the old door grade is back on the door");
  assert.ok(!introFn.includes("intensity={0.3}"), "the old film dim is back on the door");
  /* Ground value updated 2026-10-28 (the title card): the card's
     neutral ground is #060606, the same value the split leaves
     and the static pre boot layer carry. */
  assert.ok(introFn.includes('background: "#060606"'), "the door ground is not the title card's neutral black");
  assert.ok(!introFn.includes("<DotField"), "the dot field is back on the door, fighting the atmosphere");
  assert.ok(!introFn.includes("cb-intro-haze"), "the haze fields are back on the door");
  assert.ok(!introFn.includes("cb-intro-atmosphere"), "the door's old atmosphere fields are back");
  assert.ok(!introFn.includes("cb-intro-grain"), "the door's grain layer is back");
  assert.ok(introFn.includes("const animate = animationMode !== \"off\" && !reduced;"), "motion gate changed");
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

await test("no caption strip and no colour block on the card; no gradients, no shadows on the door", () => {
  // 2026-10-16: this pin replaced the calm air pin. The specimen
  // cards carried the UICard expressions from designSystem.jsx (the
  // palette surface with the dark palette override, a 1px border,
  // the plan radius), and nothing on the door painted a gradient or
  // cast a shadow.
  // 2026-10-20: the palette card treatment went with the flat and
  // ledger doors Dusty rejected. The restored door's one piece of
  // text furniture is the film door's placard: a solid matte plate
  // (fully opaque, per the standing rule that a surface carrying
  // text is solid), a 1px hairline border, the plan radius. The
  // gradient and shadow bans stand exactly as pinned in 2026-10-16:
  // the old film door's glass, glow, and sheen do not come back
  // with the film.
  // 2026-10-28: pin rewritten at the owner's redirect ("completely
  // re imagined and cinematic, please stop just moving stuff
  // around"). The placard and the October 23 arrangement that
  // carried it are retired by the same authority that created
  // them. The specimen now stands in the frame's caption strip: a
  // full width band of the door's own solid ground at the foot of
  // the frame, no card, no border box, no radius. The rule the
  // plate served survives in the strip's terms: the ground under
  // the text stays fully opaque (the strip is #05070a itself, the
  // door ground), and the gradient and shadow bans stand exactly
  // as before. The plate's sheen is retired with the plate.
  // 2026-10-28 (later that night, the title card, the owner's
  // concept pick): rewritten again at the same authority. The
  // caption strip is retired with the specimen block; the owner's
  // desktop photo showed its band clashing purple against the old
  // material, and the card carries no band, block, or card of any
  // colour now, only the title over the neutral ground #060606.
  // The gradient and shadow bans stand exactly as before.
  assert.ok(!introFn.includes("cb-door-strip"), "the caption strip band is back on the door");
  assert.ok(introFn.includes('background: "#060606"'), "the card is not on its neutral ground");
  assert.ok(!introFn.includes("background: plateBg"), "the placard ground is back");
  assert.ok(!introFn.includes("cb-door-sheen"), "the plate sheen is back");
  assert.ok(!introFn.includes("radial-gradient") && !introFn.includes("linear-gradient"), "a gradient is painted on the door");
  assert.ok(!/boxShadow: (?!\"none\")/.test(introFn), "a shadow is cast on the door");
});

await test("the film guard stands: the banned clips never return, and the door carries no clip at all", async () => {
  // eb500f7's permanent guard (scripts/check.mjs section 8) allowlists
  // frame checked clips at build time. The door's reel was the pair
  // verified by pulled frames on 2026-10-12; the banned clips (52298
  // burning book, 5774 bright VR lab) never return as URLs.
  // Pin updated 2026-10-20 (owner photo of the door): the second
  // clip changed. 20231 (swirling clouds) measured bright over large
  // regions on five pulled frames (first frame mean luminance 159.5,
  // p95 234.8, placard band p95 238.8) and is out of the intro reel.
  // Its replacement is 10011 (stars), the darkest frame checked
  // calm clip, measured the same day: mean 1.4, p95 mean 4.9 across
  // five frames, frames looked at. The exact list was pinned below
  // so the reel cannot silently drift brighter again.
  // Pin rewritten 2026-10-28 (evening, the owner's material order):
  // there is no reel list left to pin. The door's material is the
  // authored atmosphere, which is procedural: no clip, no file, no
  // URL. The guard's job is now the negative space: the retired
  // list is gone, the door mounts no video and names no clip host,
  // the atmosphere's own source carries no footage reference of any
  // kind, and the banned ids stay banned in the whole file, exactly
  // as before. The build time half of the guard (check.mjs section
  // 8) still allowlists the workspace's own clips, untouched.
  assert.ok(!src.includes("const FILM_CLIPS_INTRO"), "the retired intro reel list is back");
  assert.ok(!introFn.includes("assets.mixkit.co"), "the door names a stock clip host again");
  assert.ok(!introFn.includes("<video"), "a video element is back on the door");
  const atmoSrc = await readFile(join(root, "src/introAtmosphere.jsx"), "utf8");
  assert.ok(!atmoSrc.includes("mixkit"), "the atmosphere names a stock clip host");
  assert.ok(!atmoSrc.includes("assets/cinematic"), "the atmosphere reaches for a reel file");
  assert.ok(!atmoSrc.includes(".mp4"), "the atmosphere references footage");
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

await test("the door renders no plate frame or running head", () => {
  assert.ok(!introFn.includes("<PlateFrame"), "the door still renders inside the plate frame");
  /* Pin updated 2026-10-19 (intro redesign, owner order): the dot
     field ban retired with the flat door. The redesign put the
     calm air back within the 2026-10-08 ruling, and the field is
     the door's atmosphere again, mounted behind the chrome and
     stilled under reduced motion. PlateFrame and the running
     head stay retired. */
  /* Pin updated 2026-10-20 (Dusty's verdict on the ledger door):
     the field leaves the door again, for the opposite reason it
     left in 2026-10-16: the film is the door's foundation now,
     and where the field and the film would fight, the film wins.
     DotField itself stays exported and still serves the surfaces
     that use it (see the export pin below). */
  assert.ok(!introFn.includes("<DotField"), "the dot field is back on the film door");
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
group("Entrance and type discipline");

await test("focus-pull keyframes exist and resolve blur to sharp", () => {
  assert.ok(cssSrc.includes("@keyframes cbFocusIn"), "cbFocusIn not defined");
  const kf = cssSrc.slice(cssSrc.indexOf("@keyframes cbFocusIn"), cssSrc.indexOf("@keyframes cbFocusIn") + 200);
  assert.ok(kf.includes("blur("), "focus-pull does not use blur");
  assert.ok(!kf.includes("translate"), "focus-pull must not move the type");
});

await test("hero text uses a premium entrance (the title's staged rise)", () => {
  /* Pin updated 2026-10-28 (door motion wave): the door plate's
     entrance is now cb-door-spec-in, the door's own rise and fade,
     which also runs on touch devices where cb-specimen-in is
     killed. The intent is unchanged: the hero text takes a named
     premium entrance class.
     Pin rewritten 2026-10-28 (the title card, the owner's concept
     pick): the hero text is the title itself now, and its entrance
     is the staged rise, stage 2 of the door's ceremony, resolved
     by the shell CSS to cbDoorRise on the same curve as every
     other beat. */
  assert.ok(introFn.includes('className="cb-door-stage-2"'), "the title takes no staged entrance class");
  assert.ok(cssSrc.includes(".cb-door-stage-2 { animation: cbDoorRise"), "the title's stage does not resolve to the rise");
});

await test("old fade-and-rise entrance is fully gone", () => {
  assert.ok(!src.includes("cb-title-in"), "cb-title-in class still referenced");
  assert.ok(!src.includes("cbTitleIn"), "cbTitleIn keyframes still referenced");
});

await test("the door has no header: the title is the only wordmark", () => {
  /* Pin rewritten 2026-10-28 (the title card, the owner's concept
     pick). This pin used to require the door header: the masthead
     lockup (Mark at 22, "Cerebrum" in Inter 500) and the four quiet
     links (About, Privacy, Terms, Contact, added 2026-10-18 so the
     header, mobile menu, and footer listed the same set). The
     title card has no header at all; the word appears once, as the
     title. The links live inside the app. */
  assert.ok(!introFn.includes("<header"), "a header is back on the door");
  assert.ok(!introFn.includes('["About", "Privacy", "Terms", "Contact"]'), "the header link list is back on the door");
  assert.ok(!introFn.includes("<Mark size={22}"), "the masthead glyph is back on the door");
  assert.ok(introFn.includes("Cerebrum</h1>"), "the title word is missing");
});

await test("the way in is plain text: no fill, no accent colour, no caps", () => {
  /* Pin rewritten 2026-10-28 (the title card, the owner's concept
     pick). This pin used to guard the filled CTA's type treatment
     (normal case, no tracked caps, no light sweep, no sage glow
     shadow). The way in is now a quiet line of text: no fill at
     all, set in the card's own neutral ink rather than any accent,
     and the old sweep and shadow bans stand. */
  const ctaAt = introFn.indexOf('className="cb-door-begin"');
  assert.ok(ctaAt > 0, "the way in affordance is missing");
  const cta = introFn.slice(ctaAt, ctaAt + 700);
  assert.ok(cta.includes('background: "none"'), "the way in carries a fill again");
  assert.ok(!cta.includes('textTransform: "uppercase"'), "the way in is set as tracked caps");
  assert.ok(!introFn.includes("introAccent"), "an accent colour is back on the door");
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
group("Proof lives inside the app — the door states nothing about evidence (title card 2026-10-28)");

await test("no proof line, no count, no paper link on the door", () => {
  /* Pins rewritten 2026-10-28 (the title card, the owner's concept
     pick). This group used to require the quiet proof line under
     every claim, built from the real source list with no hardcoded
     count, and the specimen's paper reachable by its DOI link.
     The pick moves all of it inside the app: the door's one line
     says what Cerebrum is and nothing about evidence, so the
     honesty machinery has no surface left to drift on here. The
     pins guard the absence at the same strength. */
  assert.ok(!introFn.includes("Traced to a real paper"), "the proof line is back on the door");
  assert.ok(!introFn.includes("Searched across"), "the searched across line is back on the door");
  assert.ok(!introFn.includes("SCHOLARLY_SOURCES"), "the door reads the source list again");
  assert.ok(!introFn.includes("Open the paper"), "the paper link is back on the door");
  assert.ok(!introFn.includes("spec.doi"), "the door reaches for a specimen DOI again");
});

await test("the plate's record strip is retired", () => {
  assert.ok(!introFn.includes("Indexes searched"), "record strip cell survives");
  assert.ok(!introFn.includes("Papers cited"), "record strip cell survives");
  assert.ok(!introFn.includes("recordCell"), "record strip builder survives");
});

// ════════════════════════════════════════════════════════════════
group("The title card contract (2026-10-28) — no headline, no ledger, no Nova on the door");

await test("the headline sentence is not on the door", () => {
  /* Pin rewritten 2026-10-28 (the title card, the owner's concept
     pick). This pin used to require the sentence word for word as
     the door's headline ("Ask a question and get an answer from
     the research papers, with the sources attached."). The title
     card has no headline sentence; the title and the one small
     line are the whole text above the way in. */
  assert.ok(!introFn.includes("Ask a question and get an answer from the research papers, with the sources attached."), "the headline sentence is back on the door");
});

await test("the ledger is gone: no records, no numbers, no ruled header", () => {
  /* New pin 2026-10-20 (Dusty's verdict): the two column room and
     its numbered evidence ledger are the rejected door. None of
     its furniture may stand on the restored door. */
  assert.ok(!introFn.includes("Specimens on the table"), "the ledger header is back");
  assert.ok(!introFn.includes("padStart"), "the records are numbered again");
  assert.ok(!introFn.includes("gridTemplateColumns"), "the two column room is back");
});

await test("the calm is the authored atmosphere, not a field of dots", () => {
  /* New pin 2026-10-20 (same verdict), replacing the 2026-10-19
     calm air pin: the door's atmosphere is the graded reel alone.
     The haze keyframes stay defined in the shell stylesheet for
     other surfaces; the door mounts neither layer. Pin updated
     later on 2026-10-20 (owner photo: bright clouds at placard
     height): the door grade darkened to brightness 0.22 with
     intensity 0.30, door local only.
     Pin rewritten 2026-10-28 (evening, the owner's material
     order): the graded reel is retired from the door, grade and
     dim with it. The door's calm is now the authored atmosphere
     alone (IntroAtmosphere: mist strata, a breathing light,
     motes, grain), which carries its darkness in its own palette
     and clamp rather than in a filter over footage. The haze and
     dot field bans stand exactly as pinned in 2026-10-20. */
  assert.ok(introFn.includes("<IntroAtmosphere"), "the door's authored atmosphere is missing");
  assert.ok(!introFn.includes('filter: "brightness(0.22) saturate(0.60) blur(12px)"'), "the retired door grade is back");
  assert.ok(!introFn.includes("intensity={0.3}"), "the retired film dim is back");
  assert.ok(!introFn.includes('className="cb-intro-haze"'), "the haze layer is back on the door");
  assert.ok(!introFn.includes("<DotField"), "the dot field is back on the door");
});

await test("Nova is not on the door at all", () => {
  /* Pin rewritten 2026-10-28 (the title card, the owner's concept
     pick). This pin used to require Nova on the door the quiet
     way: her figure once and one short line, no section (the
     section form was retired 2026-10-20). The title card carries
     no Nova row at all; she lives inside the app, where her own
     pins guard her. The figure count over the whole intro file
     is zero now, and her door line is gone with the row. */
  assert.ok(!src.includes("function NovaDoorSection"), "the Nova section component is back");
  const mounts = (introFn.match(/<NovaDoorSection/g) || []).length;
  assert.equal(mounts, 0, `NovaDoorSection mounts ${mounts} times on the door`);
  const figures = (src.match(/<NovaRive/g) || []).length;
  assert.equal(figures, 0, `the door file draws ${figures} Nova figures`);
  assert.ok(!src.includes("NovaRive"), "the Nova figure import or mount is back in intro.jsx");
  assert.ok(!introFn.includes("Good specimens, these."), "her door line is back");
  assert.ok(!src.includes("Nova teaches science inside Cerebrum"), "the section's second paragraph is back");
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

await test("reduced motion is one still, composed frame", async () => {
  // No entrance choreography (the gate above), no rotation (the
  // effect's early return above), and the wrap takes the still class
  // whose CSS resolves the chrome in a single fade. 2026-10-16: the
  // atmosphere freeze assertion went with the atmosphere itself;
  // there is nothing left on the door to freeze. 2026-10-20: the
  // film is back, and its freeze is the reel's own contract
  // (filmBlocked mounts the graded poster still), so there is still
  // no door level freeze left to pin here.
  // 2026-10-28 (evening, the owner's material order): there is a
  // door level freeze to pin again. The atmosphere takes the still
  // prop from the door's own reduced and Off state (asserted at the
  // mount pin above), and its still is one drawn frame at the
  // composed time, of the new material itself, not a poster file.
  assert.ok(introFn.includes('"cb-intro-still"'), "still class never applied");
  assert.ok(cssSrc.includes(".cb-intro-still .cb-intro-chrome { animation: cbIntroStillIn"), "the still frame has no composed entrance");
  const atmoSrc = await readFile(join(root, "src/introAtmosphere.jsx"), "utf8");
  assert.ok(atmoSrc.includes("draw(ATMOSPHERE_STILL_T)"), "the atmosphere does not draw its composed still");
  assert.ok(atmoSrc.includes("export const ATMOSPHERE_STILL_T"), "the composed still time is not a named constant");
});

// ══════════════════════════════════════════════════════════════════════════
group("DotField discipline (component retained; off the door again since the 2026-10-20 restoration)");

await test("the field is capped, pausable, and faint", () => {
  assert.ok(src.includes("Math.min(window.devicePixelRatio || 1, 1.5)"), "DPR not capped at 1.5");
  assert.ok(src.includes("visibilitychange") && src.includes("document.hidden"), "field does not pause when hidden");
  assert.ok(src.includes("count = 76"), "dot count changed from the plate spec");
  assert.ok(src.includes("0.05 + rnd() * 0.03"), "dot opacity left the 5 to 8 percent band");
  assert.ok(src.includes("40000 + rnd() * 20000"), "drift cycle left the 40 to 60 second band");
});

// ══════════════════════════════════════════════════════════════════════════
group("The home stage, the consent trigger, and the Continue heading");

await test("the consent gate renders exactly once, in the app shell", () => {
  const n = (appSrc.match(/<ConsentGate/g) || []).length;
  assert.equal(n, 1, `ConsentGate renders ${n} times`);
  const introBranch = appSrc.slice(appSrc.indexOf("if (!entered) {"), appSrc.indexOf("const started = turns.length"));
  assert.ok(!introBranch.includes("ConsentGate"), "the gate still overlays the intro");
  assert.ok(appSrc.includes("{!legalOk && ("), "the shell gate is no longer unconditional");
});

await test("the door is never scroll locked before the way in", () => {
  /* Regression (2026-10-14): the shell's anyOverlayOpen lock list carried
     the consent term `|| !legalOk` unscoped. useScrollLock runs in App
     above the `!entered` early return, so for every first-time visitor
     (no current cb_legal cookie) the unified lock pinned the body
     (position:fixed, overflow:hidden) while the door was the only thing
     mounted — no gate on screen to release it, and the intro could not
     scroll at all. On phones, where the door stacks taller than the
     viewport, everything below the first screen was unreachable. The
     consent term is scoped to the shell now: the lock may engage for
     the gate only once `entered`, where the gate actually renders. */
  const decl = appSrc.match(/const anyOverlayOpen = ([\s\S]*?);/);
  assert.ok(decl, "anyOverlayOpen declaration not found");
  assert.ok(/entered\s*&&\s*!\s*legalOk/.test(decl[1]), "the consent lock term is not scoped to the entered shell");
  assert.ok(!/\|\|\s*!\s*legalOk/.test(decl[1]), "the consent lock term is unscoped again — the door freezes for first-time visitors");
});

await test("the stage keeps one centred column inside the standard shell", () => {
  /* Contract revised 2026-10-13 on Dusty's directive ("bring back
     the side bar but make it better"), superseding the plate pass
     contract this test originally pinned: the desktop sidebar renders
     on the stage exactly as it does over a thread, and the main
     offset is the standard sidebar offset. What survived from the
     plate pass was the single centred column, so the scatter cannot
     return; Dusty's evening revision the same day then widened that
     column (see the next test). The fuller pin set for the restored
     stage lives in tests/core-identity.mjs ("Home stage: sidebar
     restored"). */
  assert.ok(appSrc.includes('const homeStage = view === "search" && !started'), "homeStage not derived from the empty state");
  assert.ok(!appSrc.includes("(!homeStage || isMobile)"), "sidebar is still conditional on the stage");
  /* Pin updated 2026-10-19 (S7 shell lane, audit M14): the offset reads
     the LAYOUT tokens, corrected to 216 and 68 by the tokens lane. */
  assert.ok(appSrc.includes("marginLeft: isMobile ? 0 : (railCollapsed ? LAYOUT.sidebarCollapsed : LAYOUT.sidebar)"), "main offset is not the standard sidebar offset");
  assert.ok(!appSrc.includes("marginLeft: isMobile || homeStage ? 0"), "stage still zeroes the sidebar offset");
});

await test("the stage carries the plain order and no corpus number", () => {
  /* Corrected contract (2026-10-13 evening, Dusty's photo verdict):
     the plate order this test used to pin (the eyebrow, the serif
     manifesto headline, the marketing paragraph under the composer,
     the letterspaced labels, the numbered examples) read as AI
     generated to him and is gone. The stage now opens with a plain
     Cerebrum masthead, one plain line, and the composer; the labels
     are "Continue" and "Try asking" in normal case. The column is 1160,
     not the narrower measure the plate pass set. */
  const stage = appSrc.slice(
    appSrc.indexOf("The home stage: the empty search home"),
    appSrc.indexOf("<div style={{ ...S.workspace,")
  );
  assert.ok(stage.length > 1000, "stage block not found");
  /* Pin updated 2026-10-19 (S7 shell lane, audit M13): the column now
     holds the thread width, LAYOUT.answer, from stage into thread. */
  assert.ok(stage.includes("maxWidth: LAYOUT.answer"), "stage column is not the thread measure");
  assert.ok(stage.includes("cb-stage-wordmark"), "masthead wordmark missing from the stage");
  assert.ok(stage.includes(">Cerebrum<"), "masthead does not carry the name");
  /* 2026-10-28 (declutter verdict): the stage lockup renders on
     mobile only. On desktop the sidebar brand beside the stage
     already carries the name, and the owner's photo showed the
     wordmark twice on one screen. The gate sits between the
     masthead opening and the resident Nova. */
  const mastheadSeg = stage.slice(stage.indexOf("cb-stage-masthead"), stage.indexOf("NovaLive"));
  assert.ok(mastheadSeg.includes("isMobile &&"), "stage wordmark is not gated to mobile");
  /* 2026-10-28 (declutter verdict): the stage sentence is rewritten
     in plain words. The owner flagged "from the research papers"
     directly; the promise (ask, answer, sources attached) stays,
     the flagged phrase is gone from the stage. The door keeps its
     own sentence, pinned at its own site above. */
  assert.ok(stage.includes("Ask a question and get an answer with the sources attached."), "the plain stage sentence is missing");
  assert.ok(!stage.includes("from the research papers, with the sources attached"), "the flagged headline wording survives on the stage");
  assert.ok(stage.includes('variant="stage"'), "composer not in its stage variant");
  assert.ok(!stage.includes("Plate II · Inquiry"), "the plate eyebrow survives on the stage");
  assert.ok(!stage.includes("Every answer is written from the papers"), "the manifesto headline survives on the stage");
  assert.ok(!stage.includes("Each answer opens with"), "the marketing paragraph survives under the composer");
  /* 2026-10-28 (declutter verdict): the Continue row's re ask
     action is named for what it does. It read "Keep going", which
     names no function; it is "Ask again" now, here and on the deck
     card that carries the same action off stage. */
  assert.ok(stage.includes(">Ask again<"), "continue row re ask action is not named in plain words");
  assert.ok(!stage.includes(">Keep going<"), "the stray Keep going label survives on the stage");
  assert.ok(!appSrc.includes(">Keep going</DeckBtn>"), "the stray Keep going label survives on the deck card");
  /* 2026-10-28 (declutter verdict): the evidence filter's default
     blurb was a slogan ("Everything, from lab work to large
     trials. Start here.") duplicating the proof line's pitch. It
     is gone from the app; the blurb now describes the tier. */
  assert.ok(!appSrc.includes("Everything, from lab work to large trials. Start here."), "the slogan blurb survives in the evidence filter");
  assert.ok(appSrc.includes("Every kind of study counts, from work in cells and animals to trials in people. Nothing is filtered out."), "the plain all tier blurb is missing");
  assert.ok(stage.includes(">Continue<"), "continue row missing its plain label");
  assert.ok(!stage.includes("Continue investigation"), "the plate continue label survives");
  assert.ok(stage.includes(">Try asking<"), "example questions missing their plain label");
  assert.ok(!stage.includes("Specimen inquiries"), "the specimen label survives");
  assert.ok(!stage.includes("0{i + 1}"), "the examples are still numbered");
  /* Pin updated 2026-10-22 (simplify audit SH7): the footer claim
     strip is deleted on purpose. It set an unrelated specimen claim
     at the largest type on the stage, under the users own work, and
     repeated the proof line in a second form. Specimens live on the
     intro door. The pin now guards the absence. */
  assert.ok(!stage.includes("stageSpecimen"), "the stage footer specimen came back");
  assert.ok(!stage.includes("Traced claim"), "the plate footer label survives");
  /* 2026-10-18 (design audit H10): the scholarly proof line is mounted
     on the stage on purpose now, wired to the sources dialog. This
     reverses the two no corpus number assertions that stood here. */
  assert.ok(stage.includes("scholarly databases"), "the H10 proof line is missing from the stage");
  assert.ok(stage.includes("SCHOLARLY_SOURCES.length"), "the proof line does not read the source count");
});

await test("the stage column carries a solid backing in every palette and the proof line sets at the label role", () => {
  /* 2026-10-20, readability residue wave: in the Light palette the
     stage text tones are dark and sat directly over the graded calm
     film, computing to 0.98 to 3.50 to 1 against the film patches,
     under the 4.5 to 1 floor. The stage column now spreads a solid
     opaque P.bg backing in light palettes only (dark palettes spread
     nothing, so their rendering is unchanged), which puts every
     stage tone at 5.16 to 1 or better. The proof line under the
     sentence also rose from the caption role (12) to the label
     role (13) in the same wave.
     Pin updated 2026-10-28 (declutter verdict): the owner
     photographed the app wearing a murky yellow green haze in dark
     palettes too, where the stage sat unbacked on the palette
     ground, the atmo accent glow, and the calm film. The backing
     now spreads in dark palettes as well (the ground only, no
     border or padding), so the gate this pin asserted is gone on
     purpose; the pin now asserts the backing in both branches. */
  const stage = appSrc.slice(
    appSrc.indexOf("The home stage: the empty search home"),
    appSrc.indexOf("<div style={{ ...S.workspace,")
  );
  assert.ok(stage.length > 1000, "stage block not found");
  assert.ok(stage.includes("...(P.dark ? {"), "stage backing lost its dark palette branch");
  assert.ok(!stage.includes("...(P.dark ? {} : {"), "stage backing is gated away from dark palettes again");
  assert.ok(stage.includes("background: P.bg"), "stage column carries no solid P.bg backing");
  const proof = stage.slice(stage.indexOf("setProvenanceOpen(true)"), stage.indexOf("scholarly databases"));
  assert.ok(proof.includes("fontSize: FONT_SIZES.label"), "stage proof line does not set at the label role");
  assert.ok(!proof.includes("fontSize: FONT_SIZES.caption"), "stage proof line still sets at the caption role");
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
group("Home stage browser fixes (2026-10-13, live verification findings)");

await test("the stage bar carries no centre running head to truncate", () => {
  /* Live finding: the stage's six nav links squeezed the centred
     running head into "SCIENTIFIC LITERAT…". The stage bar now drops
     its centre entirely (the masthead at the top of the stage
     carries the identity), while the intro keeps its full centre
     text: its right side is one short plate label and the text
     fits. */
  const stage = appSrc.slice(
    appSrc.indexOf("The home stage: the empty search home"),
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
    appSrc.indexOf("The home stage: the empty search home"),
    appSrc.indexOf("<div style={{ ...S.workspace,")
  );
  const deckUse = stage.slice(stage.indexOf("<HomeDeck"));
  assert.ok(deckUse.startsWith("<HomeDeck\n                      suppressContinue"), "the stage does not pass suppressContinue to the deck");
  assert.ok(appSrc.includes('label="Where you left off"'), "the deck card itself was removed instead of gated");
});

// ══════════════════════════════════════════════════════════════════════════
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
