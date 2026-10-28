/**
 * core-identity tests: Dusty's 2026-09-17 direction — the videos, the
 * search atmosphere, and the existing character are the site's core
 * identity. The redesign must layer onto Cerebrum, not hollow it out.
 *
 * These pin the restoration: the workspace film reel, the generated-field
 * fallback, the intro handoff, the grain, the app-level film controls,
 * animated typing, the full-viewport particle atmosphere, and Document
 * Mode's own film layer.
 *
 * Static assertions against the real sources — no server, no network.
 *
 * Run with: node tests/core-identity.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, readdir } from "node:fs/promises";
import { PALETTES, ACCENTS } from "../src/palettes.js";

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

const appSrc = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
const introSrc = await readFile(join(root, "src/intro.jsx"), "utf8");
const diveSrc = await readFile(join(root, "src/DiveParticles.jsx"), "utf8");
const settingsSrc = await readFile(join(root, "src/settings.jsx"), "utf8");
const designSrc = await readFile(join(root, "src/designSystem.jsx"), "utf8");
const appUtilsSrc = await readFile(join(root, "src/appUtils.js"), "utf8");
const palettesSrc = await readFile(join(root, "src/palettes.js"), "utf8");
const inboxSrc = await readFile(join(root, "src/inbox.jsx"), "utf8");
const flowchartsSrc = await readFile(join(root, "src/flowcharts.jsx"), "utf8");

group("Workspace ambient reel (revised)");
await test("workspace CinematicFilm mount exists, darker than before", () => {
  // 2026-10-08: three mounts (intro reel, calm reel, workspace backdrop).
  // 2026-10-13 plate redesign superseded the intro mount for a day: the
  // door was the DotField, so two mounts remained. Dusty's directive the
  // same day ("Bring back the old intro page just make it better")
  // restored the film door, so the intro mount came back and three
  // mounts stood again. 2026-10-16: Dusty ordered the intro rebuilt in
  // the app's design language (the film door read as AI generated and
  // off product), so the door mounts no reel again and two mounts
  // stand: the calm reel on the search backdrop and the workspace
  // backdrop. The component itself is unchanged.
  // 2026-10-20: Dusty saw the 2026-10-19 two column ledger door live
  // and rejected it ("way too AI and busy"), ordering the cinematic
  // back. The intro mount returns and three mounts stand again
  // (intro, calm, workspace), the door's reel under the same unified
  // grade asserted below. Pin updated to the corrected contract.
  // 2026-10-28 (evening, the owner's material order): the door's
  // reel is retired for good, with its door grade (brightness 0.22,
  // intensity 0.30). His verdict on the noon reimagination was that
  // it looked the same but with animations because the material
  // never changed; his order was all new cinematic elements and
  // backgrounds, none of the old ones reused. The door now mounts
  // IntroAtmosphere, an authored shader material, and two
  // CinematicFilm mounts stand (calm, workspace). The shell's
  // unified grade assertions below are untouched: the workspace
  // keeps its film exactly as before.
  const mounts = (appSrc.match(/<CinematicFilm/g) || []).concat(introSrc.match(/<CinematicFilm/g) || []);
  assert.strictEqual(mounts.length, 2, `expected calm+workspace mounts, found ${mounts.length}`);
  const introFn = introSrc.slice(introSrc.indexOf("function Intro({"), introSrc.indexOf("function CerebrumFieldCanvas"));
  assert.ok(introFn.includes("<IntroAtmosphere"), "the door lost its authored atmosphere");
  assert.ok(!introFn.includes("<CinematicFilm"), "the door mounts the film reel again");
  assert.ok(!introFn.includes("brightness(0.22)"), "the retired door grade is back on the door");
  assert.match(appSrc, /started \? 0\.16/, "reading intensity should be 0.16 (darker)");
  /* Pin updated 2026-10-19 (S7 shell lane, audit H6): the workspace reel
     no longer grades brighter than the search home. Both wrappers carry
     the one grade, dark and blurred, so this asserts the unified grade
     and the absence of the old brighter one. */
  assert.match(appSrc, /brightness\(0\.30\) saturate\(0\.60\) blur\(12px\)/, "the unified film grade is missing");
  assert.ok(!appSrc.includes("brightness(0.72)"), "the brighter workspace grade is still present");
});
await test("generated field is the fallback when film is blocked", () => {
  assert.match(appSrc, /<CerebrumFieldCanvas/, "CerebrumFieldCanvas mount missing");
});
await test("grain overlay is restored", () => {
  /* Pin updated 2026-10-22 (simplify audit SH9): the fixed S.grain
     layer is deleted on purpose; the search home stacked three
     grain layers. One layer per view survives: the atmosphere grain
     on search and the cb grain layer on the other views. */
  assert.ok(!appSrc.includes("<div style={S.grain} />"), "the third grain layer came back");
  assert.match(appSrc, /cb-atmo-grain/, "atmosphere grain missing from the search view");
  assert.match(appSrc, /className="cb-grain"/, "cb grain layer missing from the shell");
});

group("Intro-to-workspace handoff");
await test("onEnter carries the intro clip as a dissolving still", () => {
  assert.match(appSrc, /setEnterClip\(clipSrc\)/, "enterClip handoff missing from onEnter");
  assert.match(appSrc, /cb-enter-frame/, "handoff still CSS missing");
});

group("App-level film controls");
await test("footer exposes Film credits, no background toggle", () => {
  assert.match(appSrc, /\["credits", "Film credits"\]/, "Film credits footer entry missing");
  assert.ok(!/\["motion",/.test(appSrc), "dead background toggle still in the workspace footer");
  assert.match(appSrc, /setFilmCreditsOpen\(true\)/, "credits dialog opener missing");
});
await test("film credits dialog mounts from the shell", () => {
  assert.match(appSrc, /\{filmCreditsOpen && <FilmCreditsDialog/, "FilmCreditsDialog shell mount missing");
});

group("Animated typing");
await test("typewriter state persists in the cb_tw cookie", () => {
  assert.match(appSrc, /getCookie\("cb_tw"\)/, "typewriter cookie read missing");
  assert.match(appSrc, /setCookie\("cb_tw", typewriter \? "1" : "0"\)/, "typewriter cookie write missing");
});
await test("TurnInner reveals fresh answers through answer assembly", () => {
  // 2026-10-08: Answer Assembly replaced the typewriter with paragraph stagger.
  assert.match(appSrc, /useAnswerAssembly/, "answer assembly wiring missing");
});
await test("new turns are marked fresh so typing runs once", () => {
  assert.match(appSrc, /const nt = \{ id: turnId, fresh: true,/, "fresh flag missing on new turns");
});
await test("Settings exposes the Animated typing row", () => {
  // Settings UI lives in src/settings.jsx after the monolith split.
  assert.match(settingsSrc, /label="Animated typing"/, "Animated typing settings row missing");
  assert.match(settingsSrc, /\["Animated typing", "answers", "typewriter reveal progressive"\]/, "settings-search index entry missing");
});

group("Particle atmosphere");
await test("DiveParticles keeps the 190-particle three-layer field", () => {
  assert.match(diveSrc, /const COUNT = 190/, "particle count changed");
  assert.match(diveSrc, /LAYERS = \[/, "depth layers missing");
  const layers = diveSrc.match(/\{ r: [\d.]+, speed: [\d.]+, alpha: [\d.]+, sway: [\d.]+ \}/g) || [];
  assert.strictEqual(layers.length, 3, `expected 3 depth layers, found ${layers.length}`);
});
await test("the field becomes the full-viewport flight atmosphere", () => {
  // 2026-10-08: The Dive is the loading language (cb-dive).
  assert.match(appSrc, /cb-dive/, "dive layer missing");
  assert.match(appSrc, /function Dive\(/, "Dive component missing");
});

group("Document Mode is quiet");
await test("Document Mode has no film layer", () => {
  assert.ok(!/src=\{DOC_FILM_SRC\}/.test(appSrc), "Document Mode film mount still present");
  assert.match(appSrc, /2026-10-05: Document Mode's own film is gone/, "quiet-document note missing");
});

group("Slogan");
await test("slogan is byte-identical", () => {
  // 2026-10-05: the specimen door rethink removed the marketing slogan.
  // The promise now lives in the specimen verdict and the paper links.
  // Pin updated 2026-10-22 (simplify audit I3): the verdict wording
  // is the proof line's, the placard's duplicate inner row is gone.
  assert.ok(
    introSrc.includes("Traced to a real paper"),
    "specimen verdict missing"
  );
});

group("Status colors: light theme variants clear 4.5:1");
{
  // 2026-10-13: the rescore panel's standing Mobile/A11y defect. The raw
  // STATUS warn (#d9a520, 2.13:1) and good (#10b981, 2.41:1) fail WCAG
  // text contrast on the Light palette; bad already had a light variant
  // via statusBad in appUtils.js, warn and good now mirror it.
  const relLum = (hex) => {
    const c = (v) => { const n = parseInt(v, 16) / 255; return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4); };
    return 0.2126 * c(hex.slice(1, 3)) + 0.7152 * c(hex.slice(3, 5)) + 0.0722 * c(hex.slice(5, 7));
  };
  const ratio = (a, b) => { const x = relLum(a), y = relLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const statusM = designSrc.match(/export const STATUS = \{ good: "(#[0-9a-f]{6})", warn: "(#[0-9a-f]{6})", bad: "(#[0-9a-f]{6})" \}/);
  const lightM = palettesSrc.match(/Light: \{ dark: false, bg: "(#[0-9a-f]{6})", surface: "(#[0-9a-f]{6})", raised: "(#[0-9a-f]{6})"/);
  const darkM = palettesSrc.match(/Dark:\s+\{ dark: true,\s+bg: "(#[0-9a-f]{6})", surface: "(#[0-9a-f]{6})"/);
  const midM = palettesSrc.match(/Mid:\s+\{ dark: true,\s+bg: "(#[0-9a-f]{6})", surface: "(#[0-9a-f]{6})"/);
  const warnLightM = appUtilsSrc.match(/function statusWarn\(P\) \{\s*return P\.dark \? STATUS\.warn : "(#[0-9a-f]{6})";\s*\}/);
  const goodLightM = appUtilsSrc.match(/function statusGood\(P\) \{\s*return P\.dark \? STATUS\.good : "(#[0-9a-f]{6})";\s*\}/);
  const badLightM = appUtilsSrc.match(/function statusBad\(P, pn\) \{\s*return P\.dark \? \(pn === "Mid" \? "#ff7a7a" : STATUS\.bad\) : "(#[0-9a-f]{6})";\s*\}/);

  await test("raw STATUS hues are unchanged", () => {
    assert.ok(statusM, "STATUS definition not found in designSystem.jsx");
    assert.deepStrictEqual(statusM.slice(1), ["#10b981", "#d9a520", "#e5484d"]);
  });
  await test("statusWarn and statusGood mirror statusBad and are exported", () => {
    assert.ok(badLightM, "statusBad no longer matches its established shape");
    assert.ok(warnLightM, "statusWarn(P) must return STATUS.warn on dark and a light hex otherwise");
    assert.ok(goodLightM, "statusGood(P) must return STATUS.good on dark and a light hex otherwise");
    assert.match(appUtilsSrc, /export \{[^}]*statusBad, statusWarn, statusGood,[^}]*\}/, "helpers missing from the appUtils export list");
    assert.match(appSrc, /statusBad, statusWarn, statusGood,/, "CerebrumApp does not import the status helpers");
    assert.match(settingsSrc, /statusBad, statusWarn, statusGood,/, "settings does not import the status helpers");
    assert.match(inboxSrc, /statusBad, statusGood \} from "\.\/appUtils\.js"/, "inbox does not import statusGood");
  });
  await test("light variants clear 4.5:1 on every Light surface; raw hues fail", () => {
    assert.ok(lightM, "Light palette surfaces not found in palettes.js");
    const surfaces = lightM.slice(1);
    for (const [name, m] of [["warn", warnLightM], ["good", goodLightM], ["bad", badLightM]]) {
      assert.ok(m, `status ${name} light variant missing`);
      for (const s of surfaces) {
        assert.ok(ratio(m[1], s) >= 4.5, `${name} light variant ${m[1]} is ${ratio(m[1], s).toFixed(2)}:1 on light surface ${s}`);
      }
    }
    // The defect itself, pinned so the helpers are never "simplified" away:
    assert.ok(ratio(statusM[2], surfaces[1]) < 4.5, "raw warn should still fail on the light surface");
    assert.ok(ratio(statusM[1], surfaces[1]) < 4.5, "raw good should still fail on the light surface");
  });
  await test("dark surfaces keep the raw hues at passing contrast (no regression)", () => {
    assert.ok(darkM && midM, "Dark/Mid palette surfaces not found in palettes.js");
    for (const s of [...darkM.slice(1), ...midM.slice(1)]) {
      assert.ok(ratio(statusM[2], s) >= 4.5, `raw warn is ${ratio(statusM[2], s).toFixed(2)}:1 on dark surface ${s}`);
      assert.ok(ratio(statusM[1], s) >= 4.5, `raw good is ${ratio(statusM[1], s).toFixed(2)}:1 on dark surface ${s}`);
    }
  });
  await test("foreground status text routes through the helpers", () => {
    for (const [name, src] of [["CerebrumApp", appSrc], ["settings", settingsSrc], ["inbox", inboxSrc]]) {
      assert.ok(!/color: STATUS\.(warn|good)/.test(src), `${name} still sets a foreground color from raw STATUS`);
    }
    assert.match(appSrc, /tone === "warn" \? statusWarn\(P\)/, "toneColor does not route warn through statusWarn");
    assert.match(appSrc, /const relColor = \(r\) => r >= 65 \? statusGood\(P\)/, "relColor does not route through the helpers");
    assert.match(settingsSrc, /st === "ok" \? statusGood\(P\)/, "settings tone() does not route through the helpers");
    assert.match(settingsSrc, /statusPill\("Locked", statusWarn\(P\)\)/, "Locked pill does not route warn through statusWarn");
  });
}

group("No dashes in app copy (whole app guard)");
{
  // Dusty's standing rule is absolute: no dashes of any kind in user
  // visible copy, because they read as AI generated. Modeled on the
  // Cortex lesson copy pin in tests/cortex-learning.mjs, widened to the
  // whole app: parse each surface's source and walk every string
  // literal, template quasi, and JSX text node, which are the three
  // places user visible copy can live. The walk covers the main app,
  // the inbox, the settings surface, and the flowchart studio: every
  // surface a signed in user reads, including the high trust settings
  // flows (API keys, recovery phrase, vault encryption). Scope, stated
  // honestly: JS comments are not rendered and the parser drops them,
  // so they are out of scope by construction; CSS comments inside
  // template strings are stripped before checking for the same reason.
  // One value is exempted by exact
  // match below: a RegExp character class that names the em dash in
  // order to strip it out of AI generated section headers. That is code,
  // not copy, and the exemption cannot hide anything else.
  const { parse } = await import("@babel/parser");
  const DASH = /[—–]/;
  const CODE_NOT_COPY = new Set(["\\b[\\s:.?—-]*"]);
  const stripCssComments = (v) => v.replace(/\/\*[\s\S]*?\*\//g, " ");
  const copyStrings = (src) => {
    const ast = parse(src, { sourceType: "module", plugins: ["jsx"] });
    const out = [];
    const seen = new Set();
    (function rec(n) {
      if (!n || typeof n.type !== "string" || seen.has(n)) return;
      seen.add(n);
      let val = null;
      if (n.type === "StringLiteral") val = n.value;
      else if (n.type === "JSXText") val = n.value;
      else if (n.type === "TemplateElement") val = stripCssComments(n.value && n.value.cooked ? n.value.cooked : "");
      if (val != null) out.push({ val, line: n.loc ? n.loc.start.line : 0 });
      for (const k of Object.keys(n)) {
        const v = n[k];
        if (Array.isArray(v)) v.forEach(rec);
        else if (v && typeof v === "object") rec(v);
      }
    })(ast.program);
    return out;
  };
  for (const [name, src] of [["CerebrumApp.jsx", appSrc], ["inbox.jsx", inboxSrc], ["settings.jsx", settingsSrc], ["flowcharts.jsx", flowchartsSrc]]) {
    await test(`no em or en dashes in ${name} copy`, () => {
      const strings = copyStrings(src);
      assert.ok(strings.length > 500, `suspiciously little copy collected from ${name}: ${strings.length}`);
      for (const { val, line } of strings) {
        if (CODE_NOT_COPY.has(val)) continue;
        assert.ok(!DASH.test(val), `dash in ${name} copy near line ${line}: ${JSON.stringify(val.slice(0, 90))}`);
      }
    });
  }
}

group("Home stage: sidebar restored, one column, one navigation");
{
  // 2026-10-13, Dusty's directive: "bring back the side bar but make
  // it better." The plate pass made the empty search home a
  // sidebarless stage with its own hairline top bar carrying a second
  // navigation. The restoration kept the plate pass's single centred
  // column (the scatter fix: one width, one left edge, no repeated
  // padding) and put the standard shell back around it. Dusty's
  // evening revision the same day superseded the column's narrow
  // measure: the stage runs wide at 1160 under a plain wordmark
  // masthead, with quiet human labels. The older stage pins live in
  // tests/intro-title-card.mjs; this group pins the shell contract.
  const stage = appSrc.slice(
    appSrc.indexOf("The home stage: the empty search home"),
    appSrc.indexOf("<div style={{ ...S.workspace,")
  );
  await test("the sidebar renders on the stage with the standard offset", () => {
    assert.ok(stage.length > 1000, "stage block not found");
    assert.ok(!appSrc.includes("(!homeStage || isMobile)"), "sidebar render is still gated on the stage");
    const mount = appSrc.slice(appSrc.indexOf("<Sidebar"), appSrc.indexOf('id="cb-main"'));
    assert.ok(mount.includes("onNavigate={stableSidebarNavigate}"), "sidebar mount lost its navigate wiring");
    assert.ok(mount.includes("isMobile={isMobile} mobileOpen={sidebarMobileOpen}"), "mobile drawer wiring changed");
    /* Pin updated 2026-10-19 (S7 shell lane, audit M14): the main offset
       now reads the LAYOUT tokens instead of the 68 and 216 literals; the
       tokens lane corrects LAYOUT itself to sidebar 216, collapsed 68. */
    assert.ok(appSrc.includes("marginLeft: isMobile ? 0 : (railCollapsed ? LAYOUT.sidebarCollapsed : LAYOUT.sidebar)"), "main offset is not the standard sidebar offset");
    assert.ok(!appSrc.includes("marginLeft: isMobile || homeStage ? 0"), "stage still zeroes the sidebar offset");
  });
  await test("the stage column keeps one width and one left edge", () => {
    /* Corrected contract (2026-10-13 evening): the single column
       survives, but at the wide measure Dusty ordered from his
       photo of the live stage, and the Continue row carries its
       plain label, not the plate one. */
    /* Pin updated 2026-10-19 (S7 shell lane, audit M13): the stage column
       now holds the thread's own width (LAYOUT.answer, 1080) from stage
       into thread, instead of narrowing from 1160 mid ceremony. */
    /* Pin updated 2026-10-20 (photo fix wave, owner photos and his order
       to fix all the issues in them): the column also carries minWidth: 0
       between its width and maxWidth. The owner's search home photo showed
       the stage running off the right edge at laptop width because the
       flex chain sized the column to content instead of the space beside
       the sidebar; minWidth: 0 is the fix, so the pin now checks the
       three properties without requiring them to be adjacent. */
    assert.ok(stage.includes('width: "100%"') && stage.includes("minWidth: 0") && stage.includes("maxWidth: LAYOUT.answer"), "stage column is not the single wide column");
    assert.ok(!stage.includes("paddingLeft"), "a second left padding crept into the stage column");
    assert.ok(stage.includes("<HomeDeck"), "deck missing from the stage column");
    assert.ok(stage.includes(">Continue<"), "continue row missing from the column");
  });
  await test("navigation exists exactly once: no stage top bar", () => {
    assert.ok(!stage.includes("<nav"), "stage still renders its own nav");
    assert.ok(!appSrc.includes("cb-stage-navlink"), "stage top bar link styles survive");
    const mainNavs = appSrc.match(/<nav[^>]*aria-label="Main"/g) || [];
    assert.strictEqual(mainNavs.length, 1, `expected exactly one Main nav (the sidebar's), found ${mainNavs.length}`);
  });
  await test("New search tops the sidebar, wired to the reset", () => {
    /* Pin updated 2026-10-22 (simplify audit SH1): the two sidebar
       search rows are merged into one. New search tops the sidebar
       (the owner's 2026-10-13 ruling) and the standalone Search row
       is gone, so the rail carries exactly one search entry. */
    const newItem = appSrc.indexOf('["new", "New search", "plus"]');
    const searchItem = appSrc.indexOf('["search", "Search", "search"]');
    assert.ok(newItem !== -1, "New search is not the sidebar's first item");
    assert.ok(searchItem === -1, "the duplicate standalone Search row came back");
    assert.ok(appSrc.includes('case "new": newSession();'), "the new case is not wired to the session reset");
  });
  await test("the stage still renders exactly one Continue row", () => {
    const deckUse = stage.slice(stage.indexOf("<HomeDeck"));
    assert.ok(deckUse.startsWith("<HomeDeck\n                      suppressContinue"), "the stage deck lost suppressContinue");
    assert.ok(appSrc.includes("lastQ && !suppressContinue"), "the deck card is no longer gated on the prop");
  });
}

group("Mobile tab bar unread badge");
await test("the tab button speaks the unread count and the badge numeral clears 4.5 to 1", () => {
  // The badge itself is aria-hidden decoration; the count has to
  // live in the button's accessible name, the same pattern the
  // sidebar Inbox button and the inbox thread pill already use.
  assert.ok(appSrc.includes("aria-label={t.badge > 0 ? `${t.label}, ${t.badge} unread` : t.label}"),
    "the tab button's accessible name drops the unread count");
  /* The badge radius now comes from the design token (RADIUS.md === 2):
     the frontend audit migrated raw radius literals to tokens, so this
     pin follows the token instead of the literal it replaced.
     Note, 2026-10-14: wave 1 set RADIUS.md to 2. */
  const badgeAt = appSrc.indexOf("minWidth: 16, height: 16, borderRadius: RADIUS.md");
  assert.ok(badgeAt > 0, "the tab badge span is gone");
  const badgeSpan = appSrc.slice(badgeAt, badgeAt + 340);
  assert.ok(badgeSpan.includes('aria-hidden="true"'), "the tab badge is no longer hidden from assistive tech");
  const ground = (badgeSpan.match(/background: "(#[0-9a-fA-F]{6})"/) || [])[1];
  assert.ok(ground, "the tab badge carries no ground color");
  // WCAG contrast of the white numeral on the badge ground,
  // computed from the hex the app actually ships, not a copy of it.
  const lum = (hex) => [0, 2, 4].map((i) => parseInt(hex.slice(i + 1, i + 3), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)))
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (lum("#ffffff") + 0.05) / (lum(ground) + 0.05);
  assert.ok(ratio >= 4.5, `the tab badge numeral computes to ${ratio.toFixed(2)} to 1, under 4.5`);
});

group("Stage health tri state on the client");
await test("stageState classifies passed, failed, and skipped from the shipped ok value", () => {
  // Behavioural, not a string match: lift the classifier out of the
  // app source and run it over fixtures shaped like the server's real
  // stage entries (publicStageHealth in functions/api/search.js).
  const fnAt = appSrc.indexOf("function stageState(s) {");
  assert.ok(fnAt > 0, "stageState is missing from CerebrumApp.jsx");
  const fnSrc = appSrc.slice(fnAt, appSrc.indexOf("\n}", fnAt) + 2);
  const stageState = new Function(`${fnSrc}; return stageState;`)();
  assert.strictEqual(stageState({ name: "retrieval", ok: true }), "passed");
  assert.strictEqual(stageState({ name: "validation", ok: false, skipReason: "no leg answered" }), "failed");
  assert.strictEqual(stageState({ name: "fact-check", ok: null, skipReason: "nothing to verify" }), "skipped",
    "an ok null stage (skipped) must never classify as failed");
  assert.strictEqual(stageState({ name: "fact-check", ok: null, skipReason: "fact check did not run" }), "skipped");
  assert.strictEqual(stageState({}), "skipped", "an entry with no ok value is unknown, not failed");
  assert.strictEqual(stageState(null), "skipped");
  // A whole stage list partitions the way the surfaces consume it:
  // exactly the ok false entry is a failure, the ok null entry is
  // skipped and lands in no failure count.
  const stages = [
    { name: "expansion", ok: true },
    { name: "validation", ok: false, skipReason: "no leg answered" },
    { name: "fact-check", ok: null, skipReason: "nothing to verify" },
    { name: "synthesis", ok: true },
  ];
  assert.deepStrictEqual(stages.filter((s) => stageState(s) === "failed").map((s) => s.name), ["validation"]);
  assert.deepStrictEqual(stages.filter((s) => stageState(s) === "skipped").map((s) => s.name), ["fact-check"]);
});
await test("answer diagnostics counts only ok false stages as failures and reports skips neutrally", () => {
  const start = appSrc.indexOf("function AnswerDiagnostics");
  assert.ok(start > 0, "AnswerDiagnostics is missing");
  const diag = appSrc.slice(start, appSrc.indexOf("\nfunction ", start + 10));
  assert.ok(!diag.includes("stages.filter((s) => s && !s.ok)"),
    "diagnostics still treats every falsy ok as a stage failure");
  assert.ok(diag.includes('stageState(s) === "failed"'), "the failure filter does not go through stageState");
  assert.ok(diag.includes('stageState(s) === "skipped"'), "diagnostics never separates skipped stages");
  assert.ok(diag.includes("stage was skipped"), "a skipped stage gets no neutral row in diagnostics");
  assert.ok(diag.includes("s.skipReason"), "diagnostics never surfaces the shipped skipReason");
  assert.ok(diag.includes("const issueCount = missing.length + failedStages.length + (t.degraded ? 1 : 0);"),
    "the issue count changed shape; it must count failed stages only, never skipped ones");
});
await test("autopsy pipeline chips render skipped stages as skipped, with the shipped reason", () => {
  const at = appSrc.indexOf("07 · Pipeline health");
  assert.ok(at > 0, "the autopsy pipeline health section is missing");
  const chips = appSrc.slice(at, at + 3400);
  assert.ok(chips.includes("stageState(s)"), "the pipeline chips do not classify through stageState");
  assert.ok(chips.includes(": skipped"), "no chip title reads a stage as skipped");
  assert.ok(chips.includes(" · skipped"), "a skipped stage carries no visible skipped label on its chip");
  assert.ok(chips.includes("s.skipReason"), "the chips never surface the shipped skipReason");
  assert.ok(chips.includes(": failed ("), "a failed stage's chip title drops the reason the server shipped");
});

group("Viewport mode follows resizes (mobile panel)");

await test("widthToMode pins the breakpoint logic at real widths", () => {
  // Behavioural, not a string match: lift the pure function out of
  // appUtils and run it, the same treatment stageState gets above.
  const fnAt = appUtilsSrc.indexOf("function widthToMode(");
  assert.ok(fnAt > 0, "widthToMode is missing from appUtils.js");
  const fnSrc = appUtilsSrc.slice(fnAt, appUtilsSrc.indexOf("\n}", fnAt) + 2);
  const widthToMode = new Function(`${fnSrc}; return widthToMode;`)();
  /* Pin updated 2026-10-19 (S7 shell lane, deferred Lane B): the one
     breakpoint convention is inclusive, at or below the breakpoint is
     mobile, matching the CSS max-width form the shipped bands use.
     The breakpoint itself is mobile now, on both sides of the line. */
  assert.strictEqual(widthToMode(390), "mobile", "a phone width must read as mobile");
  assert.strictEqual(widthToMode(768), "mobile", "a tablet width must read as mobile");
  assert.strictEqual(widthToMode(899), "mobile");
  assert.strictEqual(widthToMode(900), "mobile", "the breakpoint itself is mobile under the one convention");
  assert.strictEqual(widthToMode(901), "desktop");
  assert.strictEqual(widthToMode(1440), "desktop");
  // A caller with its own threshold (the Trending feed's narrow layout
  // at 560) gets the same inclusive test at its own breakpoint.
  assert.strictEqual(widthToMode(390, 560), "mobile");
  assert.strictEqual(widthToMode(559, 560), "mobile");
  assert.strictEqual(widthToMode(560, 560), "mobile");
  assert.strictEqual(widthToMode(768, 560), "desktop");
});

await test("the viewport hooks live in appUtils, are exported, and follow resizes", () => {
  const widthAt = appUtilsSrc.indexOf("function useWindowWidth()");
  assert.ok(widthAt > 0, "useWindowWidth is missing from appUtils.js");
  const widthSrc = appUtilsSrc.slice(widthAt, appUtilsSrc.indexOf("\nfunction useIsMobile()", widthAt));
  assert.ok(widthSrc.includes("window.innerWidth : 1200"),
    "useWindowWidth lost the desktop first paint default the hand rolled copies used");
  assert.ok(widthSrc.includes('addEventListener("resize"'), "useWindowWidth does not subscribe to resize");
  const mobAt = appUtilsSrc.indexOf("function useIsMobile()");
  assert.ok(mobAt > 0, "useIsMobile is missing from appUtils.js");
  const mobSrc = appUtilsSrc.slice(mobAt, appUtilsSrc.indexOf("const TONES", mobAt));
  assert.ok(mobSrc.includes("widthToMode("), "useIsMobile does not decide through widthToMode");
  assert.ok(mobSrc.includes('addEventListener("resize"'), "useIsMobile does not subscribe to resize");
  assert.ok(appUtilsSrc.includes("useIsMobile, useWindowWidth, widthToMode"),
    "the viewport hooks and widthToMode are not all exported from appUtils");
  assert.ok(appSrc.includes("useIsMobile, useWindowWidth"),
    "CerebrumApp does not import the shared viewport hooks");
});

await test("no render decides its viewport mode from a one shot width read", async () => {
  // Walk every source file under src/. window.innerWidth may be read
  // directly only inside appUtils.js (the hooks themselves) or at a
  // site that measures at the moment of use: an effect positioning a
  // popup from a live rect, a canvas sizing itself, a one time
  // scrollbar measure. Each such site is listed here with its reason.
  // A new direct read anywhere else fails until it goes through the
  // hooks or earns its own justified line here.
  const exemptions = [
    // CitationPeek: a layout effect measures the citation marker's
    // rect when the peek opens and clamps the popover to the viewport.
    { file: "CerebrumApp.jsx", frag: "Math.min(340, window.innerWidth - 24)", count: 1 },
    { file: "CerebrumApp.jsx", frag: "window.innerWidth - W - 12", count: 1 },
    // The selection toolbar's effect measures the live selection; it
    // clears the toolbar on resize rather than tracking the width.
    { file: "CerebrumApp.jsx", frag: "window.innerWidth - 12", count: 1 },
    // The document highlight popup clamps at paint time around
    // coordinates captured at selection. (The constellation tip that
    // also clamped here was deleted with ProfileConstellation in the
    // 2026-10-23 profiles redo, and its exemption went with it.)
    { file: "CerebrumApp.jsx", frag: "window.innerWidth : 400", count: 1 },
    // The DotField sizes its canvas backing store inside its own
    // effect, which keeps its own resize subscription.
    { file: "intro.jsx", frag: "canvas.clientWidth || window.innerWidth", count: 1 },
    // The design system Select positions its menu from the trigger's
    // rect at the moment it opens.
    { file: "designSystem.jsx", frag: "window.innerWidth - width - 8", count: 1 },
    // The generated field sizes its canvas at setup; the module keeps
    // its own resize listener for later changes.
    { file: "cerebrumField.js", frag: "Math.max(1, window.innerWidth)", count: 1 },
    // Scroll lock measures the scrollbar width at the moment it locks.
    { file: "scrollLock.js", frag: "window.innerWidth - document.documentElement.clientWidth", count: 1 },
  ];
  const files = [];
  const walk = async (dir, prefix) => {
    for (const ent of await readdir(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      if (ent.isDirectory()) await walk(join(dir, ent.name), rel);
      else if (/\.(js|jsx)$/.test(ent.name)) files.push(rel);
    }
  };
  await walk(join(root, "src"), "");
  assert.ok(files.length > 20, "the src walk found too few files to trust this guard");
  const seen = exemptions.map(() => 0);
  for (const rel of files) {
    if (rel === "appUtils.js") continue;
    const src = await readFile(join(root, "src", rel), "utf8");
    src.split("\n").forEach((line, i) => {
      if (!line.includes("window.innerWidth")) return;
      const hits = exemptions
        .map((e, k) => (e.file === rel && line.includes(e.frag) ? k : -1))
        .filter((k) => k >= 0);
      assert.strictEqual(hits.length, 1,
        `${rel}:${i + 1} reads window.innerWidth outside appUtils and matches no justified exemption: ${line.trim()}`);
      seen[hits[0]]++;
    });
  }
  exemptions.forEach((e, k) => {
    assert.strictEqual(seen[k], e.count,
      `the exemption for ${e.file} (${e.frag}) matched ${seen[k]} lines, expected ${e.count}; the exemption list must track the code`);
  });
});

await test("the autopsy, turn, and trending surfaces take their mode from the hooks", () => {
  assert.ok(!appSrc.includes("isMobile={typeof window"),
    "a component still computes isMobile from a one shot width read at render");
  assert.ok(!appSrc.includes("innerWidth < 900"),
    "a one shot breakpoint read survives somewhere in CerebrumApp.jsx");
  const autopsyAt = appSrc.indexOf("function QueryAutopsy");
  const autopsy = appSrc.slice(autopsyAt, appSrc.indexOf("\nfunction ", autopsyAt + 10));
  assert.ok(autopsy.includes("const isMobile = useIsMobile();"), "QueryAutopsy does not call useIsMobile");
  assert.ok(autopsy.includes("<StressTest") && autopsy.includes("isMobile={isMobile}"),
    "the autopsy's StressTest does not receive the hook driven isMobile");
  assert.ok(autopsy.includes("<EvidenceStructure") && autopsy.includes("isMobile={isMobile}"),
    "the autopsy's EvidenceStructure does not receive the hook driven isMobile");
  const turnAt = appSrc.indexOf("function TurnInner");
  const turn = appSrc.slice(turnAt, appSrc.indexOf("\nfunction ", turnAt + 10));
  assert.ok(turn.includes("const isMobile = useIsMobile();"), "TurnInner does not call useIsMobile");
  assert.ok((turn.match(/isMobile=\{isMobile\}/g) || []).length >= 2,
    "TurnInner's CitationPeek and JumpRail do not both receive the hook driven isMobile");
  const trendAt = appSrc.indexOf("function TrendingView");
  const trend = appSrc.slice(trendAt, appSrc.indexOf("\nfunction ", trendAt + 10));
  assert.ok(trend.includes("const winW = useWindowWidth();"),
    "TrendingView still keeps its own width state instead of the shared hook");
  /* Pin updated 2026-10-19 (S7 shell lane, deferred Lane B): the
     Trending narrow test now reads <= 560, the one inclusive convention,
     agreeing with the bench CSS at max-width 560 at exactly 560. */
  assert.ok(trend.includes("const narrow = winW <= 560;"),
    "TrendingView's narrow threshold moved; the swap must preserve it exactly");
  assert.ok(!appSrc.includes("setWinW"), "the hand rolled winW state survives somewhere in CerebrumApp.jsx");
});

group("Client wave six: solid text surfaces, the dialog variable, and calibrated inks");
await test("the composer field is the solid palette background at full strength, both variants", () => {
  // Fifth panel, Frontend high: .cb-ask-field composited the palette
  // background at 82 percent (88 for the stage variant) over the home
  // film. The standing rule is that text bearing surfaces are solid.
  assert.ok(!appSrc.includes("var(--cb-bg) 82%"), "the 82 percent composer field background is still present");
  assert.ok(!appSrc.includes("var(--cb-bg) 88%"), "the 88 percent stage field background is still present");
  const fieldAt = appSrc.indexOf(".cb-ask-field {");
  assert.ok(appSrc.slice(fieldAt, fieldAt + 700).includes("background: var(--cb-bg);"), "the composer field is not the solid palette background");
  const stageAt = appSrc.indexOf(".cb-ask--stage .cb-ask-field {");
  assert.ok(appSrc.slice(stageAt, stageAt + 300).includes("background: var(--cb-bg);"), "the stage field is not the solid palette background");
});
await test("source card hover and focus states are opaque palette steps, never fog values", () => {
  // The cards carry paper titles; their hover and focus backgrounds
  // were rgba scrims (0.72, 0.8, 0.64, 0.7 alpha) under a comment that
  // said the fog stays. The state change now rides an opaque step.
  const cardAt = appSrc.indexOf("const SourceCard = (s, i) =>");
  assert.ok(cardAt > 0, "SourceCard not found");
  const card = appSrc.slice(cardAt, cardAt + 2600);
  for (const fog of ["rgba(22, 27, 34, 0.72)", "rgba(255, 255, 255, 0.8)", "rgba(18, 22, 29, 0.64)", "rgba(255, 255, 255, 0.7)"]) {
    assert.ok(!card.includes(fog), `source card state still uses the fog value ${fog}`);
  }
  assert.ok(card.includes("color-mix(in srgb, ${P.raised}, ${P.ink} 12%)"), "dark hover state is not the opaque raised lift");
  assert.ok(card.includes("focusedSourceIdx === i ? (P.dark ?"), "the focus state no longer takes the opaque step");
});
await test("the page flow alpha inputs and rows are solid palette values", () => {
  // Fifth panel named the 0.4 and 0.5 alpha backgrounds beside the
  // source list (filter input, sort tabs, action buttons, the z box
  // and its input); the same class in the settings rows (soundBtn)
  // went with them. None of the three literals may survive anywhere
  // in the app file.
  for (const lit of ["withAlpha(P.bg, 0.5)", "withAlpha(P.bg, 0.4)", "withAlpha(P.surface, 0.4)"]) {
    assert.ok(!appSrc.includes(lit), `an alpha background survives: ${lit}`);
  }
  assert.match(appSrc, /srcFilterInput: \{[^}]*background: P\.bg,/, "the source filter input is not the solid background");
  assert.match(appSrc, /zIn: \{[^}]*background: P\.surface,/, "the z input is not the solid surface");
});
await test("--cb-surface is set wherever --cb-solid-bg is set, and reaches the portals", () => {
  // Fifth panel, Frontend medium: the Dialog primitive's default
  // panel background reads var(--cb-surface, ...) and the variable
  // was defined nowhere, so dialogs without a panelStyle rendered
  // on the fallback alone. Sixth panel follow up: the fallback
  // constant itself was near black #141416, which only stays
  // readable under a dark theme's ink; it is now a mid neutral
  // that keeps both ink colors legible if the variable ever goes
  // missing. This pin previously asserted the #141416 literal: it
  // encoded the defect, and wave seven updated it with the fix.
  /* 2026-10-18 (design audit M3): the fallback became the COLOR.surface1
     literal #1c1b19, readable under both inks; the pin moves with it. */
  /* 2026-10-26 (look modernization): COLOR.surface1 moved to #16181d
     with the re skinned Dark palette; the fallback and this pin move
     with it, same rule as 2026-10-18. */
  assert.match(flowchartsSrc, /var\(--cb-surface, #16181d\)/, "the Dialog default no longer reads --cb-surface with the surface fallback");
  assert.ok(!flowchartsSrc.includes("var(--cb-surface, #141416)"), "the near black Dialog fallback is back");
  // The app root sets it from the active palette alongside
  // --cb-solid-bg, in the same style object.
  assert.match(appSrc, /"--cb-solid-bg": P\.bg, "--cb-surface": P\.surface/, "the app root does not set --cb-surface alongside --cb-solid-bg");
  // Dialogs portal to document.body, outside that root, so the same
  // value is mirrored onto <html> in the palette effect; without the
  // mirror the definition would never reach a portaled dialog.
  assert.match(appSrc, /document\.documentElement\.style\.setProperty\("--cb-surface", P\.surface\)/, "the palette effect does not mirror --cb-surface onto the document element");
});
await test("ModalChrome centered panels take the palette, and only media surfaces keep the dark treatment", () => {
  // Sixth panel, Frontend medium: centered ModalChrome panels were
  // hard coded #0f1115 in every palette including Light while the
  // drawers beside them honored the theme. The chrome now derives
  // its centered background, ink, and border from the palette when
  // one is passed, and the dark constants survive only behind the
  // media opt in (the citation network and the literature arc,
  // whose bodies force a dark palette in every theme). Seventh
  // panel follow up: the no palette fallback WAS the hard coded
  // constant, safe only under caller discipline; wave eight makes
  // it read the Dialog default's --cb-surface variable (mid neutral
  // fallback) with the matching ink and line variables, so the
  // constant survives only on the media branch. The two pins that
  // asserted the old ternary encoded that defect and move with it.
  const at = flowchartsSrc.indexOf("function ModalChrome");
  assert.ok(at > 0, "ModalChrome missing");
  const mc = flowchartsSrc.slice(at, flowchartsSrc.indexOf("export { ChromeHeader, ModalChrome }", at));
  assert.match(mc, /media = false/, "ModalChrome has no media opt in");
  assert.match(mc, /const themed = !!P && !media;/, "ModalChrome does not derive its themed state from the palette and the media flag");
  assert.match(mc, /media \? "#0f1115" : drawer && P \? P\.bg : themed \? P\.surface : "var\(--cb-surface, #16181d\)"/, "centered panels do not take the palette surface, or the no palette fallback is not the surface variable");
  assert.match(mc, /media \? "#f2f4f2" : P \? P\.ink : "var\(--cb-ink, #f4f4f2\)"/, "centered panels do not take the palette ink, or the no palette fallback is not the ink variable");
  assert.match(mc, /border: `1px solid \$\{panelBorder\}`/, "the centered panel border does not follow panelBorder");
  assert.match(mc, /P=\{drawer \|\| themed \? P : null\}/, "the chrome header does not receive the palette on themed centered panels");
  // Every centered ModalChrome call site in the app either passes
  // the palette or opts into the media treatment by name: a site
  // doing neither now lands on the surface variable rather than
  // the dark panel, but the named discipline stays pinned.
  for (const [marker, ok] of [
    ["<ModalChrome media label=\"Citation network\"", true],
    ["<ModalChrome media label=\"The arc of this literature\"", true],
    ["<ModalChrome label=\"Sign in to Cerebrum\" P={P}", true],
    ["<ModalChrome label=\"Command palette\" P={P}", true],
  ]) {
    assert.equal(appSrc.includes(marker), ok, `ModalChrome call site changed shape: ${marker}`);
  }
});
await test("the intro's text panels follow the palette and its film credits stay dark as a marked media surface", () => {
  // Seventh panel, Frontend: intro.jsx carried two centered text
  // panels hard coding #0f1115. The film credits panel sits on the
  // intro film and keeps the dark treatment under the media
  // exemption, marked the way ModalChrome marks its media flag;
  // IntroModal (How it works, Sources) is a text panel and takes
  // the palette surface treatment like other dialogs.
  const creditsAt = introSrc.indexOf("function FilmCreditsDialog");
  assert.ok(creditsAt > 0, "FilmCreditsDialog missing");
  const credits = introSrc.slice(creditsAt, introSrc.indexOf("function IntroModal", creditsAt));
  assert.match(credits, /Media surface, marked the way ModalChrome marks its media/, "the film credits panel is not marked as a media surface");
  assert.match(credits, /background: "#0f1115"/, "the film credits panel lost its deliberate dark treatment");
  const modalAt = introSrc.indexOf("function IntroModal");
  assert.ok(modalAt > 0, "IntroModal missing");
  /* Pin updated 2026-10-22 (simplify audit I2): HowItWorksDialog is
     deleted from the door on purpose, so IntroModal is now sliced up
     to SourcesDialog and the How it works mount assertion is gone.
     Start researching is the door's only call to action. */
  const modal = introSrc.slice(modalAt, introSrc.indexOf("function SourcesDialog", modalAt));
  assert.match(modal, /background: P \? P\.surface : "var\(--cb-surface, #767676\)"/, "IntroModal does not take the palette surface");
  assert.ok(!modal.includes('background: "#0f1115"'), "IntroModal still hard codes the near black panel");
  assert.match(introSrc, /<SourcesDialog P=\{P\} accent=\{introAccent\}/, "the intro's Sources dialog does not receive the palette");
  assert.ok(!introSrc.includes("HowItWorksDialog"), "the deleted How it works dialog came back to the door");
  assert.match(appSrc, /<SourcesDialog P=\{P\} accent=\{accent\}/, "the app's Sources dialog does not receive the palette");
});
await test("the New Search FAB icon takes accentText(accent), a colour, not a function", () => {
  assert.match(appSrc, /background: accent, color: accentText\(accent\),/, "the FAB span does not colour its icon with accentText(accent)");
});
await test("no style color property anywhere in the app is assigned a bare imported function", async () => {
  // The FAB bug's class, pinned precisely: a style object's color
  // property whose value is a bare identifier naming a FUNCTION the
  // file imports is never a colour; the declaration is invalid and
  // dropped at runtime. Calls (accentText(accent)) and plain string
  // variables (at, accent, toneColor) are legitimate and spared,
  // because the walk only flags bare identifiers that resolve to an
  // imported function definition in appUtils.js or designSystem.jsx.
  const { parse } = await import("@babel/parser");
  const fnNamesIn = (src) => {
    const names = new Set();
    const ast = parse(src, { sourceType: "module", plugins: ["jsx"] });
    for (const n of ast.program.body) {
      const d = n.type === "ExportNamedDeclaration" ? n.declaration : n;
      if (!d) continue;
      if (d.type === "FunctionDeclaration" && d.id) names.add(d.id.name);
      if (d.type === "VariableDeclaration") for (const v of d.declarations) {
        if (v.id.type === "Identifier" && v.init && (v.init.type === "ArrowFunctionExpression" || v.init.type === "FunctionExpression")) names.add(v.id.name);
      }
    }
    return names;
  };
  const moduleFns = new Set([...fnNamesIn(appUtilsSrc), ...fnNamesIn(designSrc)]);
  const importedFns = new Set();
  const appAst = parse(appSrc, { sourceType: "module", plugins: ["jsx"] });
  for (const n of appAst.program.body) {
    if (n.type !== "ImportDeclaration") continue;
    if (!/\.\/(appUtils\.js|designSystem\.jsx)$/.test(n.source.value)) continue;
    for (const s of n.specifiers) if (s.local && moduleFns.has(s.local.name)) importedFns.add(s.local.name);
  }
  assert.ok(importedFns.has("accentInk") && importedFns.has("accentText"), "the scan failed to resolve the imported helpers; it would be vacuous");
  const scan = (ast) => {
    const hits = [];
    (function rec(node) {
      if (!node || typeof node.type !== "string") return;
      if (node.type === "ObjectProperty" && !node.computed && node.key && node.key.name === "color" &&
          node.value && node.value.type === "Identifier" && importedFns.has(node.value.name)) {
        hits.push(node.value.name);
      }
      for (const k of Object.keys(node)) {
        if (k === "loc" || k === "range") continue;
        const c = node[k];
        if (Array.isArray(c)) c.forEach(rec); else if (c && typeof c.type === "string") rec(c);
      }
    })(ast.program);
    return hits;
  };
  assert.deepEqual(scan(appAst), [], "a style color is assigned a bare imported function");
  // The checker itself is not vacuous: it catches the planted bug and
  // spares the call form and a plain string variable.
  const planted = parse("const a = { color: accentInk }; const b = { color: accentText(accent) }; const c = { color: at };", { sourceType: "module", plugins: ["jsx"] });
  assert.deepEqual(scan(planted), ["accentInk"], "the scan does not catch the planted function as color bug");
});
{
  /* Item 6 arithmetic, shown. The Ask label sits on a wash of the raw
     accent over the field: ground(t) = P.bg mixed toward the accent
     by t, t = 0.14 at rest and 0.22 on hover (color-mix percentages
     over the now solid field). accentInk corrects against P.bg only,
     and on the tinted grounds it lands short in four combinations;
     the worst is Light with Amber: ink #86672f, 4.20 to 1 at rest,
     3.99 to 1 on hover. accentInkOn (appUtils.js) starts from that
     correction and searches against the tinted ground itself; the
     composer ships the ink calibrated on the hover ground, the
     harder of the two, as --cb-ask-ink. The helpers below mirror
     appUtils.js exactly (same mixHex rounding, same 12 step binary
     search, same 4.6 target), and the wiring is source pinned, so
     the numbers computed here are the numbers the app computes. */
  const relLum = (hex) => {
    const c = (v) => { const n = parseInt(v, 16) / 255; return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4); };
    return 0.2126 * c(hex.slice(1, 3)) + 0.7152 * c(hex.slice(3, 5)) + 0.0722 * c(hex.slice(5, 7));
  };
  const ratio = (a, b) => { const x = relLum(a), y = relLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const mixHex = (h1, h2, t) => {
    const c = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    const [a1, b1, d1] = c(h1), [a2, b2, d2] = c(h2);
    const m = (x, y) => Math.round(x + (y - x) * t);
    const to = (n2) => n2.toString(16).padStart(2, "0");
    return `#${to(m(a1, a2))}${to(m(b1, b2))}${to(m(d1, d2))}`;
  };
  const accentInk = (P, accent) => {
    if (P.dark || ratio(accent, P.bg) >= 4.5) return accent;
    let lo = 0, hi = 1;
    for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (ratio(mixHex(accent, "#101216", mid), P.bg) >= 4.6) hi = mid; else lo = mid; }
    return mixHex(accent, "#101216", hi);
  };
  const accentInkOn = (P, accent, ground) => {
    const base = accentInk(P, accent);
    if (ratio(base, ground) >= 4.6) return base;
    const target = relLum(base) >= relLum(ground) ? "#ffffff" : "#101216";
    let lo = 0, hi = 1;
    for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (ratio(mixHex(base, target, mid), ground) >= 4.6) hi = mid; else lo = mid; }
    return mixHex(base, target, hi);
  };
  await test("the Ask ink is wired: helper exists, composer sets --cb-ask-ink, the label reads it", () => {
    assert.match(appUtilsSrc, /function accentInkOn\(P, accent, ground\)/, "accentInkOn is missing from appUtils.js");
    assert.match(appUtilsSrc, /export \{[^}]*accentInk, accentInkOn,[^}]*\}/, "accentInkOn is not exported");
    assert.match(appSrc, /"--cb-ask-ink": accentInkOn\(P, accent, mixHex\(P\.bg, accent, 0\.22\)\)/, "the composer does not set --cb-ask-ink from the hover ground");
    assert.match(appSrc, /color: var\(--cb-ask-ink, var\(--cb-accent-ink, var\(--cb-acc\)\)\);/, "the Ask label does not read --cb-ask-ink");
  });
  // 2026-10-14, design overhaul wave 1: ACCENTS.Amber moved from #d9a441
  // to the plan gold #c4a35a, so the pinned arithmetic below was
  // recomputed from the shipped helpers. The defect story is unchanged:
  // the old correction still fails on the hover ground (3.99 to 1).
  // 2026-10-26 (look modernization): the Light and Mid grounds moved
  // with the re skinned palettes, so the pinned arithmetic below was
  // recomputed from the shipped helpers, same practice as 2026-10-14.
  // The defect story is unchanged: the old correction still fails on
  // the hover ground (3.99 to 1).
  await test("the old correction provably fails on the tinted ground (the defect, pinned)", () => {
    const L = PALETTES.Light, amber = ACCENTS.Amber;
    const ink = accentInk(L, amber);
    assert.equal(ink, "#7e6a3f", "accentInk's Light Amber correction changed; recompute the pinned arithmetic");
    assert.equal(ratio(ink, mixHex(L.bg, amber, 0.14)).toFixed(2), "4.21", "the old ink no longer computes to 4.21 at rest");
    assert.equal(ratio(ink, mixHex(L.bg, amber, 0.22)).toFixed(2), "3.99", "the old ink no longer computes to 3.99 on hover");
  });
  await test("the calibrated Ask ink clears 4.5 to 1 on its real ground, rest and hover, every palette and accent", () => {
    for (const [pn, P] of Object.entries(PALETTES)) {
      for (const [an, acc] of Object.entries(ACCENTS)) {
        const ink = accentInkOn(P, acc, mixHex(P.bg, acc, 0.22));
        const rest = ratio(ink, mixHex(P.bg, acc, 0.14));
        const hover = ratio(ink, mixHex(P.bg, acc, 0.22));
        assert.ok(rest >= 4.5, `${pn} with ${an}: Ask ink ${ink} is ${rest.toFixed(2)} to 1 at rest`);
        assert.ok(hover >= 4.5, `${pn} with ${an}: Ask ink ${ink} is ${hover.toFixed(2)} to 1 on hover`);
      }
    }
    // The headline cases, exact: Light Amber ships #72603b (4.90 rest,
    // 4.64 hover; recomputed 2026-10-26 for the re skinned Light
    // ground, see the note above the defect pin); Mid Sage ships
    // #99b396 (5.39 rest, 4.62 hover, recomputed the same day).
    const li = accentInkOn(PALETTES.Light, ACCENTS.Amber, mixHex(PALETTES.Light.bg, ACCENTS.Amber, 0.22));
    assert.equal(li, "#72603b");
    assert.equal(ratio(li, mixHex(PALETTES.Light.bg, ACCENTS.Amber, 0.14)).toFixed(2), "4.90");
    assert.equal(ratio(li, mixHex(PALETTES.Light.bg, ACCENTS.Amber, 0.22)).toFixed(2), "4.64");
    const ms = accentInkOn(PALETTES.Mid, ACCENTS.Sage, mixHex(PALETTES.Mid.bg, ACCENTS.Sage, 0.22));
    assert.equal(ms, "#99b396");
    assert.equal(ratio(ms, mixHex(PALETTES.Mid.bg, ACCENTS.Sage, 0.22)).toFixed(2), "4.62");
  });
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
