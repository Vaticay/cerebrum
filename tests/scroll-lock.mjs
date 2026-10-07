/**
 * scroll-lock.mjs — Regression tests for the UNIFIED scroll-lock system.
 *
 * Oct 7: the three competing implementations (CerebrumApp.jsx ref-counted
 * overflow lock, flowcharts.jsx's duplicate from the monolith split, and the
 * anyOverlayOpen pin effect) were unified into src/scrollLock.js — one
 * ref-counted lock using the iOS-safe pin pattern.
 *
 * These tests cover:
 * 1. lockScroll/unlockScroll ref-counting (balanced pairs)
 * 2. Pin save/restore correctness (position, top, overflow, width, paddingRight)
 * 3. Exact scroll position restore via instant scrollTo
 * 4. Scrollbar-width compensation on desktop
 * 5. Unbalanced unlock safety
 * 6. Exactly ONE implementation exists in the codebase (no duplicates)
 * 7. CerebrumApp.jsx + flowcharts.jsx import from scrollLock.js
 * 8. App uses useScrollLock(anyOverlayOpen); the overlay list is complete
 * 9. No hand-rolled body overflow toggles anywhere else
 */

import { strict as assert } from "node:assert";
import fs from "node:fs";
import vm from "node:vm";

const appSrc = fs.readFileSync("src/CerebrumApp.jsx", "utf8");
const flowSrc = fs.readFileSync("src/flowcharts.jsx", "utf8");
const lockSrc = fs.readFileSync("src/scrollLock.js", "utf8");

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  ✗ ${name}: ${e.message.split("\n")[0]}`);
  }
}

// Load scrollLock.js in a VM with mocked document/window. The module's
// `import { useEffect } from "react"` is stubbed — the hook itself isn't
// under test here (React owns effect semantics); the lock primitives are.
function loadLockModule({ scrollY = 240, clientWidth = 1265, innerWidth = 1280 } = {}) {
  const style = { overflow: "", position: "", top: "", width: "", paddingRight: "" };
  const scrollToCalls = [];
  // Strip the react import; stub useEffect for module evaluation.
  const code = lockSrc
    .replace(/import\s*\{\s*useEffect\s*\}\s*from\s*["']react["'];?/, "const useEffect = () => {};")
    .replace(/^export\s+(?=(?:function|const|let|var)\s)/gm, "")
    .replace(/export\s*\{[^}]*\};?/g, "");
  const context = vm.createContext({
    document: {
      body: { style },
      documentElement: { clientWidth },
    },
    window: {
      get scrollY() { return scrollY; },
      innerWidth,
      scrollTo: (opts) => { scrollToCalls.push(opts); },
    },
    console,
  });
  vm.runInContext(
    code + "\nthis.__api = { lockScroll, unlockScroll, scrollLockDepth, cbDialogLockScroll, cbDialogUnlockScroll };",
    context
  );
  return { api: context.__api, style, scrollToCalls };
}

console.log("scroll-lock — unified module behavior");

await test("single lock pins body with exact scroll offset", () => {
  const { api, style } = loadLockModule({ scrollY: 240 });
  api.lockScroll();
  assert.equal(style.overflow, "hidden", "overflow hidden");
  assert.equal(style.position, "fixed", "body pinned");
  assert.equal(style.top, "-240px", "pinned at exact scroll offset");
  assert.equal(style.width, "100%", "width pinned");
});

await test("single unlock restores styles and scroll position", () => {
  const { api, style, scrollToCalls } = loadLockModule({ scrollY: 240 });
  style.overflow = "auto";
  style.position = "static";
  api.lockScroll();
  api.unlockScroll();
  assert.equal(style.overflow, "auto", "original overflow restored");
  assert.equal(style.position, "static", "original position restored");
  assert.equal(style.top, "", "top cleared");
  assert.equal(style.width, "", "width cleared");
  assert.equal(scrollToCalls.length, 1, "scrollTo called once");
  assert.equal(scrollToCalls[0].top, 240, "restored to exact pre-lock scrollY");
  assert.equal(scrollToCalls[0].behavior, "instant", "restore is instant, never animated");
  assert.equal(api.scrollLockDepth(), 0, "depth back to 0");
});

await test("nested locks require nested unlocks; styles restored once", () => {
  const { api, style, scrollToCalls } = loadLockModule({ scrollY: 100 });
  api.lockScroll();
  api.lockScroll();
  api.lockScroll();
  assert.equal(api.scrollLockDepth(), 3);
  api.unlockScroll();
  assert.equal(style.position, "fixed", "still pinned while nested holders remain");
  assert.equal(scrollToCalls.length, 0, "no restore until last unlock");
  api.unlockScroll();
  api.unlockScroll();
  assert.equal(api.scrollLockDepth(), 0);
  assert.equal(style.position, "", "restored after last unlock");
  assert.equal(scrollToCalls.length, 1, "exactly one restore");
});

await test("unbalanced unlock never drives depth negative or touches styles", () => {
  const { api, style } = loadLockModule();
  style.overflow = "scroll";
  api.unlockScroll();
  api.unlockScroll();
  assert.equal(api.scrollLockDepth(), 0, "depth clamps at 0");
  assert.equal(style.overflow, "scroll", "styles untouched");
  assert.equal(style.position, "", "styles untouched");
});

await test("scrollbar width compensated as padding on desktop", () => {
  const { api, style } = loadLockModule({ innerWidth: 1280, clientWidth: 1265 });
  api.lockScroll();
  assert.match(style.paddingRight, /calc\(0px \+ 15px\)/, `expected scrollbar compensation, got "${style.paddingRight}"`);
  api.unlockScroll();
  assert.equal(style.paddingRight, "", "padding restored");
});

await test("no scrollbar means no padding compensation", () => {
  const { api, style } = loadLockModule({ innerWidth: 1280, clientWidth: 1280 });
  api.lockScroll();
  assert.equal(style.paddingRight, "", "no compensation when no scrollbar");
  api.unlockScroll();
});

await test("legacy aliases map to the same lock", () => {
  const { api, style } = loadLockModule();
  api.cbDialogLockScroll();
  assert.equal(api.scrollLockDepth(), 1, "alias acquires the shared lock");
  assert.equal(style.position, "fixed");
  api.cbDialogUnlockScroll();
  assert.equal(api.scrollLockDepth(), 0, "alias releases the shared lock");
  assert.equal(style.position, "", "restored");
});

console.log("scroll-lock — exactly one implementation");

await test("CerebrumApp.jsx has no local lock implementation", () => {
  assert.ok(!/function cbDialogLockScroll/.test(appSrc), "no local cbDialogLockScroll in CerebrumApp.jsx");
  assert.ok(!/let cbDialogLockDepth/.test(appSrc), "no local cbDialogLockDepth in CerebrumApp.jsx");
  assert.ok(!/cbDialogSavedOverflow/.test(appSrc), "no local saved-overflow state in CerebrumApp.jsx");
});

await test("flowcharts.jsx has no local lock implementation", () => {
  assert.ok(!/function cbDialogLockScroll/.test(flowSrc), "no local cbDialogLockScroll in flowcharts.jsx");
  assert.ok(!/let cbDialogLockDepth/.test(flowSrc), "no local cbDialogLockDepth in flowcharts.jsx");
});

await test("both files import the lock from scrollLock.js", () => {
  assert.match(appSrc, /from\s*["']\.\/scrollLock\.js["']/, "CerebrumApp.jsx imports scrollLock.js");
  assert.match(flowSrc, /from\s*["']\.\/scrollLock\.js["']/, "flowcharts.jsx imports scrollLock.js");
});

await test("App drives the lock via useScrollLock(anyOverlayOpen)", () => {
  assert.match(appSrc, /useScrollLock\(anyOverlayOpen\)/, "App must call useScrollLock(anyOverlayOpen)");
});

await test("no hand-rolled body overflow toggles outside scrollLock.js", () => {
  const files = {
    "src/CerebrumApp.jsx": appSrc,
    "src/flowcharts.jsx": flowSrc,
    "src/inbox.jsx": fs.readFileSync("src/inbox.jsx", "utf8"),
    "src/settings.jsx": fs.readFileSync("src/settings.jsx", "utf8"),
    "src/designSystem.jsx": fs.readFileSync("src/designSystem.jsx", "utf8"),
  };
  const bad = [];
  for (const [name, src] of Object.entries(files)) {
    src.split("\n").forEach((line, i) => {
      if (/document\.body\.style\.overflow\s*=/.test(line) && !line.trim().startsWith("//") && !line.trim().startsWith("*")) {
        bad.push(`${name}:${i + 1}: ${line.trim().slice(0, 70)}`);
      }
    });
  }
  assert.deepEqual(bad, [], `hand-rolled overflow writes found:\n${bad.join("\n")}`);
});

console.log("scroll-lock — overlay coverage (unchanged contract)");

await test("anyOverlayOpen includes the consent gate (!legalOk)", () => {
  assert.match(
    appSrc,
    /const anyOverlayOpen =[\s\S]{0,2000}!\s*legalOk/,
    "anyOverlayOpen must include !legalOk (consent gate)"
  );
});

await test("anyOverlayOpen covers all known overlay states", () => {
  const m = appSrc.match(/const anyOverlayOpen = ([\s\S]*?);/);
  assert.ok(m, "anyOverlayOpen declaration not found");
  const decl = m[1];
  const required = [
    "cmdOpen",
    "mobilePanel",
    "sidebarMobileOpen",
    "authOpen",
    "flowchartOpen",
    "proModalOpen",
    "viewingProfileId",
    "incomingCall",
    "activeHuddle",
  ];
  for (const r of required) {
    assert.ok(decl.includes(r), `anyOverlayOpen missing: ${r}`);
  }
});

await test("Dialog primitive uses the shared lock", () => {
  assert.match(flowSrc, /cbDialogLockScroll\(\)/, "Dialog must call cbDialogLockScroll");
  assert.match(flowSrc, /cbDialogUnlockScroll\(\)/, "Dialog must call cbDialogUnlockScroll");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
