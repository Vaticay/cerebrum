/**
 * The Nova tour cutscene (2026-10-15).
 *
 * The old tour was four text cards in LearnView.jsx. The redo
 * moves it into src/NovaTour.jsx: Nova stands on the canvas
 * rig and speaks the script herself, each line said through
 * the unified speech controller while its text types out on
 * the plan's own rhythm. The script (TOUR_STEPS) and the
 * typewriter metering (tourVisibleChars) are pure data and a
 * pure function, so they are extracted by AST and run in a
 * bare VM here, the same pattern the cortex and speech
 * suites use. The wiring (figure, controller, skip, reduced
 * motion, host persistence) is pinned against the sources.
 *
 * Run with: node tests/nova-tour.mjs
 * (Listed in tests/run since the tour polish pass,
 * 2026-10-15, once wave 16 had landed and freed that file.)
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parse } from "@babel/parser";
import { transformSync } from "esbuild";

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

// ── Extract the pure pieces ─────────────────────────────────
const tourSrc = readFileSync(join(root, "src/NovaTour.jsx"), "utf8");
const learnSrc = readFileSync(join(root, "src/LearnView.jsx"), "utf8");
const speechSrc = readFileSync(join(root, "src/NovaSpeech.jsx"), "utf8");

function extract(srcText, names) {
  const tree = parse(srcText, { sourceType: "module", plugins: ["jsx"] });
  const chunks = [];
  for (const name of names) {
    let found = null;
    for (const node of tree.program.body) {
      const decl = node.type === "ExportNamedDeclaration" ? node.declaration : node;
      if (!decl) continue;
      if (decl.type === "FunctionDeclaration" && decl.id && decl.id.name === name) found = decl;
      if (decl.type === "VariableDeclaration" && decl.declarations.some((d) => d.id && d.id.name === name)) found = decl;
    }
    assert.ok(found, `${name} must be declared`);
    chunks.push(srcText.slice(found.start, found.end));
  }
  return chunks.join("\n");
}

const js = transformSync(
  extract(tourSrc, ["TOUR_STEPS", "tourVisibleChars"])
    + "\n" + extract(speechSrc, [
      "SPEECH_SPEAK_MS_PER_CHAR", "SPEECH_BURST_MIN_MS", "SPEECH_BURST_MAX_MS",
      "SPEECH_PAUSE_CLAUSE_MS", "SPEECH_PAUSE_SENTENCE_MS", "SPEECH_PAUSE_BREATH_MS",
      // The cadence set joined the extraction 2026-10-15:
      // speechPlanFor reads the per line cadence through
      // speechCadenceFor since the natural rhythm pass in
      // NovaSpeech.jsx, and the plan cannot run in the VM
      // without the whole closure it touches.
      "SPEECH_TAIL_MS",
      "SPEECH_CADENCE_MIN", "SPEECH_CADENCE_MAX",
      "SPEECH_PAUSE_PUNCH_MS", "SPEECH_PUNCH_MAX_CHARS",
      "SPEECH_EXCITED_MIN_CHARS", "SPEECH_EXCITED_FACTOR",
      "speechCadenceFor",
      "speechPlanFor",
    ])
    + "\n;globalThis.__x = { TOUR_STEPS, tourVisibleChars, speechPlanFor };",
  { loader: "jsx" },
).code;
const context = vm.createContext({});
vm.runInContext(js, context);
const { TOUR_STEPS, tourVisibleChars, speechPlanFor } = context.__x;

// ── The script ──────────────────────────────────────────────
group("The tour script");

await test("the script walks the whole product in her order", () => {
  assert.ok(Array.isArray(TOUR_STEPS) && TOUR_STEPS.length >= 8, "the cutscene needs its stops");
  const all = TOUR_STEPS.map((s) => s.title + " " + s.body).join("\n");
  for (const topic of ["learning paths", "quizzes you on it", "catalog", "review schedule", "shelf", "streak", "remember", "library"]) {
    assert.ok(all.includes(topic), `no stop covers ${topic}`);
  }
});

await test("every spoken line is dash free and in her register", () => {
  for (const s of TOUR_STEPS) {
    assert.ok(!s.title.includes("-") && !s.body.includes("-"), `dash in a tour line: ${s.title}`);
    assert.ok(!s.title.includes("—") && !s.body.includes("—"), `em dash in a tour line: ${s.title}`);
    assert.ok(s.body.length >= 60 && s.body.length <= 220, `line length off her register: ${s.title} at ${s.body.length}`);
  }
});

await test("every stop carries stage directions the host can run", () => {
  for (const s of TOUR_STEPS) {
    assert.ok(s.tab === null || s.tab === "paths" || s.tab === "today", `bad spotlight tab on ${s.title}`);
    assert.ok(s.anchor === null || ["paths", "stage", "shelf"].includes(s.anchor), `bad spotlight anchor on ${s.title}`);
    assert.ok(Number.isInteger(s.quiz) && s.quiz >= 0 && s.quiz <= 5, `quiz state out of rig range on ${s.title}`);
    assert.ok(Number.isInteger(s.app) && s.app >= 0 && s.app <= 3, `app state out of rig range on ${s.title}`);
    assert.equal(typeof s.celebrate, "boolean", `celebrate flag missing on ${s.title}`);
    // Pin updated 2026-10-15 to the single stage contract:
    // tab and anchor used to aim the host's spotlight behind
    // the old bottom band; the stage presentation stages
    // nothing behind her, so the fields survive as context
    // only and a stop no longer needs an anchor to be valid.
    if (s.tab) assert.ok(s.tab === "paths" || s.tab === "today", `a stop's retained tab context is off: ${s.title}`);
  }
});

// ── The typewriter ──────────────────────────────────────────
group("The typewriter runs on her speech plan");

await test("nothing is typed before she starts, everything is up when the plan ends", () => {
  const line = TOUR_STEPS[0].body;
  const plan = speechPlanFor(line);
  assert.equal(tourVisibleChars(plan, line.length, 0), 0, "chars visible at zero ms");
  assert.equal(tourVisibleChars(plan, line.length, plan.speechEndMs), line.length, "line incomplete at plan end");
  assert.equal(tourVisibleChars(plan, line.length, plan.speechEndMs + 5000), line.length, "line overruns past plan end");
});

await test("typing is monotonic and holds through a pause", () => {
  const line = "Short one. Then a second sentence follows it here.";
  const plan = speechPlanFor(line);
  assert.ok(plan.bursts.length >= 2, "the probe line needs two bursts");
  let prev = 0;
  for (let t = 0; t <= plan.speechEndMs; t += 25) {
    const n = tourVisibleChars(plan, line.length, t);
    assert.ok(n >= prev, `typing went backwards at ${t}ms`);
    prev = n;
  }
  const [b0, b1] = plan.bursts;
  const atPauseStart = tourVisibleChars(plan, line.length, b0.endMs);
  const midPause = tourVisibleChars(plan, line.length, Math.floor((b0.endMs + b1.startMs) / 2));
  assert.equal(midPause, atPauseStart, "characters landed during a mouth pause");
  assert.ok(atPauseStart > 0 && atPauseStart < line.length, "the first burst should type a partial line");
});

// ── The wiring ──────────────────────────────────────────────
group("The cutscene wiring");

await test("she performs on the canvas rig at full framing, speaking through the one controller", () => {
  assert.ok(tourSrc.includes('import { NovaRive } from "./NovaRive.jsx";'), "the tour does not import the rig surface");
  assert.ok(tourSrc.includes('framing="full"'), "the tour figure is not full body framed");
  assert.ok(tourSrc.includes("useNovaSpeech()"), "the tour does not own a speech controller");
  assert.ok(tourSrc.includes('source: "lesson"'), "tour lines are not said as lesson lines");
  assert.ok(tourSrc.includes("speechPlanFor(stop.body)"), "the typewriter is not metered by the speech plan");
  assert.ok(tourSrc.includes("quips={false}"), "the rig's quip events are not muted during the script");
});

await test("advance completes a line before it turns the page, and skip is always offered", () => {
  assert.ok(tourSrc.includes('advance()') && tourSrc.includes("setTypedMs(plan.speechEndMs)"), "mid line advance does not complete the line");
  assert.ok(tourSrc.includes("Skip the tour"), "no skip control");
  assert.ok(tourSrc.includes('e.key === "Escape"'), "Escape does not leave the tour");
  assert.ok(tourSrc.includes('"Start learning"'), "the last stop does not hand over to learning");
  assert.ok(tourSrc.includes("NOVA"), "the dialogue box carries no name plate");
});

await test("reduced motion stills her and prints lines whole", () => {
  assert.ok(tourSrc.includes('window.matchMedia("(prefers-reduced-motion: reduce)")'), "the tour does not read the reduced motion signal");
  assert.ok(tourSrc.includes("reducedMotion={reduced}"), "the rig is not told to still");
  assert.ok(tourSrc.includes("reduced ? plan.speechEndMs : 0"), "reduced motion still types lines out");
});

await test("the tour writes no storage itself; the host owns the once and the replay", () => {
  assert.ok(!tourSrc.includes("localStorage.setItem"), "the tour persists something itself");
  assert.ok(learnSrc.includes('import { NovaTour } from "./NovaTour.jsx";'), "LearnView does not import the cutscene");
  assert.ok(learnSrc.includes("<NovaTour P={P} accent={accent} at={at} onClose={finishTour} onSpotlight={spotlightTour} />"), "the cutscene is not mounted by the home");
  assert.ok(!learnSrc.includes("CortexTour"), "the old card tour survived in LearnView");
  // Key pins updated 2026-10-15 to the versioned contract:
  // the key is cerebrum-nova-tour-v2 now. Under the old
  // cerebrum-cortex-tour key every returning user was
  // already done, so the cutscene never auto opened for
  // them; the v2 key gives it one first visit for everyone.
  assert.ok(learnSrc.includes('localStorage.setItem("cerebrum-nova-tour-v2", "done")'), "the host no longer marks the tour done under the v2 key");
  assert.ok(learnSrc.includes('localStorage.getItem("cerebrum-nova-tour-v2")'), "the host no longer checks the v2 first visit key");
  assert.ok(!learnSrc.includes('localStorage.getItem("cerebrum-cortex-tour")'), "the host still reads the retired cortex key for the open decision");
  assert.ok(!learnSrc.includes('localStorage.setItem("cerebrum-cortex-tour"'), "the host still writes the retired cortex key");
  assert.ok(learnSrc.includes("tourReturnRef.current = homeTab"), "the replay does not record where to return to");
  for (const anchor of ["paths", "stage", "shelf"]) {
    assert.ok(learnSrc.includes(`data-tour-anchor="${anchor}"`), `the ${anchor} spotlight anchor is missing`);
  }
});

// ── The polish pass (2026-10-15, from the live playthrough) ──
group("The playthrough polish");

await test("the name plate is house gold, not the reader's accent", () => {
  assert.ok(tourSrc.includes('const NT_GOLD = "#C4A35A";'), "the tour carries no house gold constant");
  assert.ok(tourSrc.includes("background: NT_GOLD"), "the name plate does not render in house gold");
  assert.ok(!tourSrc.includes("#8ba888") && !tourSrc.includes("#8BA888"), "the sage accent value leaked into the tour");
  const plateAt = tourSrc.indexOf("background: NT_GOLD");
  const plateSpan = tourSrc.slice(Math.max(0, plateAt - 400), plateAt + 400);
  assert.ok(plateSpan.includes("NOVA"), "the gold background is not on the NOVA plate");
  assert.ok(!plateSpan.includes("background: accent"), "the name plate still follows the reader's accent");
});

await test("the shelf and closing stops celebrate, and the rise is delayed past the bind", () => {
  assert.equal(TOUR_STEPS[4].celebrate, true, "the shelf stop does not celebrate");
  assert.equal(TOUR_STEPS[TOUR_STEPS.length - 1].celebrate, true, "the closing stop does not celebrate");
  assert.ok(
    tourSrc.includes("celebrateTimer = window.setTimeout(() => setCelebrateN((n) => n + 1), 700);"),
    "the celebrate rise is not delayed 700ms past the stop opening",
  );
  assert.ok(
    !tourSrc.includes("if (stop.celebrate) setCelebrateN((n) => n + 1);"),
    "the synchronous celebrate rise is back; NovaCanvas swallows a rise that lands before the trigger input binds",
  );
  assert.ok(
    tourSrc.includes("window.clearTimeout(celebrateTimer)"),
    "a pending celebrate rise is not cancelled when the stop changes",
  );
});

// ── The single stage pass (2026-10-15, owner framing order) ──
group("One stage, one Nova, no restart (2026-10-15)");

await test("the whole tour runs in the stage presentation; the bottom band is gone", () => {
  assert.ok(!tourSrc.includes("const band"), "the band framing switch is back; the flip was the restart seam");
  assert.ok(!tourSrc.includes('alignItems: band'), "the backdrop still flips its alignment by stop");
  assert.ok(!tourSrc.includes("rgba(5,6,8,0.45)"), "the lighter band backdrop survived");
  assert.ok(tourSrc.includes('background: "rgba(5,6,8,0.82)"'), "the stage backdrop is not the one presentation");
  assert.ok(!tourSrc.includes("onSpotlight(stop"), "the tour still stages the screen behind her");
  // Pin updated 2026-10-16 (layout audit finding 14): the narrow
  // figure shrank from 176 to 144 so the tour panel fits a phone's
  // visible area with its controls stacked in two fixed rows.
  /* 2026-10-18 (design audit M48): tour figure sizes aligned with the stage. */
  assert.ok(tourSrc.includes("const figureSize = narrow ? 264 : 288;"), "her size is not one fixed stage size per width");
});

await test("the figure mounts exactly once, so her runtime never restarts between stops", () => {
  const mounts = tourSrc.split("<NovaRive").length - 1;
  assert.equal(mounts, 1, `the tour renders ${mounts} rig mounts; a second mount point is a restart waiting at its seam`);
  assert.ok(!tourSrc.includes("createPortal"), "the figure is portaled between homes; one framing needs no relocation");
});

await test("while the tour is open the host stands its resident Novas down", () => {
  assert.ok(learnSrc.includes('homeTab !== "today" && !tourOpen'), "the header resident still renders under the tour");
  // Pin updated 2026-10-16 (layout audit finding 12): the Today stage figure is phone aware now (264 at narrow widths, 288 above), so the resident render carries the stageNarrow expression instead of the fixed 288.
  assert.ok(learnSrc.includes('{!tourOpen && <NovaLive state={novaMood} size={stageNarrow ? 264 : 288} framing="full" />}'), "the Today stage resident still renders under the tour");
});

// ── The phone fit pass (2026-10-16, layout audit findings 14 and 20) ──
group("Phone fit (2026-10-16)");

await test("the controls stack in two fixed rows and the close hit area is 44px", () => {
  assert.ok(tourSrc.includes('flexDirection: "column", gap: 10'), "the controls are not stacked in fixed rows");
  assert.ok(!tourSrc.includes('flexWrap: "wrap"'), "the control row wraps again; Next and Back can fall below the visible area");
  assert.ok(tourSrc.includes("minWidth: 44, minHeight: 44"), "the tour close hit area is under the 44px tap floor");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
