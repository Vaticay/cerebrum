/**
 * Specimen-door regression tests.
 *
 * The intro is a specimen door, not a headline: the first viewport
 * shows ONE verified claim as a museum specimen — the claim in large
 * type, its paper attached, a "traced to a direct finding" verdict.
 * The product demonstrates itself instead of describing itself.
 *
 * These tests lock the invariants of the rethink (2026-10-05), as
 * carried into the plate redesign (2026-10-13), which superseded the
 * timed rotation, the set-of-three placards, the film on the door,
 * and the "Start researching" CTA:
 *
 *   1. SPECIMENS holds real published findings, each with a claim, a
 *      paper citation, and a DOI link. The old headline and slogan are
 *      gone.
 *   2. The specimen is stepped by hand, one claim at a time, with a
 *      real counter. A plate does not turn its own pages: no timer.
 *   3. The film controls must report the video element's ACTUAL playback
 *      state (media events), never inferred intent — the lying
 *      "paused — tap to play" label came from intent flags. The reel
 *      still serves the workspace; the door itself is the DotField.
 *   4. The plate language: registration corner marks and a mono
 *      running head from the shared PlateFrame, a serif wordmark with
 *      a two clause definition, and one full width Enter key.
 *   5. The specimen previews the trust data: indexes searched, papers
 *      cited, and the paper's real title, a miniature Search record.
 *   6. The consent gate renders once, in the app shell, never over
 *      the intro; the Plate II stage and the Continue heading rules
 *      are pinned at the end of this file.
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

await test("single CTA reads \"Enter\"", () => {
  assert.ok(/>Enter<\/button>/.test(src), "Enter CTA missing");
  assert.ok(!src.includes("Start researching"), "old CTA copy still present");
});

// ══════════════════════════════════════════════════════════════════════════
group("Stepping — by hand, one claim at a time (plate redesign)");

const introFn = src.slice(src.indexOf("function Intro({"), src.indexOf("function CerebrumFieldCanvas"));

await test("no timed rotation: a plate does not turn its own pages", () => {
  assert.ok(!introFn.includes("setInterval"), "a timer still advances the specimen");
  assert.ok(!introFn.includes("specimenSet"), "the set of three placards is still built");
  assert.ok(!introFn.includes("specimenHeld"), "hold to pause machinery survives");
});

await test("one specimen renders at a time", () => {
  assert.ok(introFn.includes("const specimen = SPECIMENS["), "single specimen not selected");
  assert.ok(introFn.includes("Fig. {specimenIdx + 1}"), "figure number missing");
});

await test("stepper moves one claim at a time, wrapping, with a counter", () => {
  assert.ok(src.includes('aria-label="Previous claim"'), "prev button missing");
  assert.ok(src.includes('aria-label="Next claim"'), "next button missing");
  assert.ok(introFn.includes("stepSpecimen(-1)"), "prev step not wired");
  assert.ok(introFn.includes("stepSpecimen(1)"), "next step not wired");
  assert.ok(introFn.includes("(i + d + specimenCount) % specimenCount"), "wrap step not wired");
  assert.ok(introFn.includes("Claim {specimenIdx + 1} of {specimenCount}"), "counter missing");
  assert.ok(!src.includes('role="tablist"'), "tab wall should be gone");
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
group("Still instrument — no film on the door (2026-10-08)");

await test("CinematicFilm keeps its media-event truth for the workspace", () => {
  // The reel component itself is unchanged (the workspace still uses it);
  // it is simply no longer mounted on the intro.
  assert.ok(cssSrc.includes('addEventListener("playing"'), "no playing listener");
  assert.ok(cssSrc.includes('addEventListener("pause"'), "no pause listener");
  assert.ok(cssSrc.includes('addEventListener("play"'), "no play listener");
  assert.ok(cssSrc.includes("onPlaybackChange"), "onPlaybackChange not wired");
  assert.ok(cssSrc.includes("reportPlaying"), "no element-state reporter in the reel");
});

await test("the door mounts the DotField, not the film reel", () => {
  // The reel component itself is unchanged and still serves the
  // workspace (see the media-event test above). The plate redesign
  // took it off the door: the ambient there is the dot field now.
  assert.ok(introFn.includes("<DotField"), "intro does not mount the dot field");
  assert.ok(!introFn.includes("<CinematicFilm"), "intro still mounts the film reel");
  assert.ok(!src.includes("filmPlaying"), "intro still tracks film playback state");
  assert.ok(!src.includes("toggleFilm"), "intro still has a background toggle");
});

await test("no inferred autoplay-blocked flag survives", () => {
  assert.ok(!src.includes("autoplayBlocked"), "inferred autoplay flag still present");
});

await test("intro background is the dot field over a static vignette", () => {
  assert.ok(introFn.includes("radial-gradient(120% 90% at 50% 42%"), "static vignette missing");
  assert.ok(!src.includes("cb-instr-bed"), "static calibration bed still used on the intro");
});

await test("registration corner marks come from the shared PlateFrame", () => {
  assert.ok(src.includes("export function PlateFrame"), "PlateFrame not defined in intro.jsx");
  assert.ok(introFn.includes("<PlateFrame"), "intro does not render inside the plate frame");
  assert.ok(!src.includes("cb-instr-viewport"), "old viewport tick frame still referenced");
  assert.ok(!src.includes("TickFrame"), "TickFrame still used on the intro");
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

await test("wordmark is a serif display with a two clause definition", () => {
  assert.ok(introFn.includes('fontFamily: "var(--cb-serif)"'), "serif voice missing from the intro");
  assert.ok(src.includes("A search instrument for the scientific literature, asked in plain language."), "definition clause (a) missing");
  assert.ok(src.includes("Every answer is traced to the papers behind it, so any claim can be opened and checked."), "definition clause (b) missing");
  assert.ok(!src.includes('letterSpacing: "0.42em"') && !src.includes('letterSpacing: "0.32em"'),
    "tiny tracked caps scale still present");
});

await test("running head carries the plate number", () => {
  assert.ok(introFn.includes("Scientific literature, traced"), "running head centre missing");
  assert.ok(introFn.includes("Plate I · Entrance"), "plate label missing");
});

await test("the one way in is a single full width Enter key", () => {
  assert.ok(!src.includes("cb-intro-go::after"), "CTA light sweep still present");
  assert.ok(
    !src.includes("0 14px 34px rgba(163,184,153,0.30)"),
    "old chunky sage CTA shadow still present"
  );
  // The CTA is set in normal case (textTransform "none"), not tracked caps.
  const ctaAt = src.indexOf('className="cb-intro-go"');
  assert.ok(ctaAt > 0, "CTA button missing");
  const cta = src.slice(ctaAt, ctaAt + 700);
  assert.ok(cta.includes('textTransform: "none"'), "CTA not set in normal case");
  assert.ok(cta.includes('width: "100%"'), "CTA not full width of the column");
  assert.ok(!cta.includes('textTransform: "uppercase"'), "CTA still set as tracked caps");
});

await test("reduced motion kills the focus-pull", () => {
  assert.ok(cssSrc.includes(".cb-focus-in { animation: none; }"), "reduced-motion override missing");
});

// ══════════════════════════════════════════════════════════════════════════
group("The specimen previews the Search record (plate redesign)");

await test("the record strip names indexes, papers cited, and the paper", () => {
  assert.ok(introFn.includes("Indexes searched"), "indexes cell missing");
  assert.ok(introFn.includes("Papers cited"), "papers cited cell missing");
  assert.ok(introFn.includes("String(SCHOLARLY_SOURCES.length)"), "index count is not the real source count");
  assert.ok(introFn.includes("specimenTitle"), "paper title not rendered");
});

await test("the paper title is lifted from the real citation, never written", () => {
  assert.ok(src.includes("match(/“([^”]+)”/)"), "title extraction from the citation string missing");
});

// ══════════════════════════════════════════════════════════════════════════
group("The door handle and the collapsed ceremony");

await test("the Return key enters from anywhere that is not a control", () => {
  assert.ok(introFn.includes('e.key !== "Enter"'), "Enter key handler missing");
  assert.ok(introFn.includes("howOpen || sourcesOpen"), "dialogs do not keep their own keys");
});

await test("repeat visits in a session collapse the ceremony", () => {
  assert.ok(introFn.includes('sessionStorage.getItem("cerebrum-entered")'), "entered flag never read");
  assert.ok(introFn.includes('sessionStorage.setItem("cerebrum-entered", "1")'), "entered flag never set");
  assert.ok(introFn.includes("autoFocus={enteredBefore || undefined}"), "returning plate does not focus the way in");
});

// ══════════════════════════════════════════════════════════════════════════
group("DotField discipline");

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

await test("the stage drops the desktop sidebar and centres one column", () => {
  assert.ok(appSrc.includes('const homeStage = view === "search" && !started'), "homeStage not derived from the empty state");
  assert.ok(appSrc.includes("(!homeStage || isMobile)"), "sidebar not conditional on the stage");
  assert.ok(appSrc.includes("marginLeft: isMobile || homeStage ? 0"), "sidebar offset survives on the stage");
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
  assert.ok(introFn2.includes("Scientific literature, traced"), "intro lost its running head centre");
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
