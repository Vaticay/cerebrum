/**
 * shell-crosscutting.mjs — the shared shell machinery from the
 * mobile audit fix pass (2026 10 23): the visual viewport
 * keyboard inset, history backed navigation, and the three touch
 * replacements for hover only controls.
 *
 * Covered:
 *  1. computeKeyboardInset from mocked visual viewport numbers.
 *  2. The history helper's push and pop ordering: a dialog closes
 *     first, then a thread, then a view, and only then is the
 *     stack empty. A programmatic close never calls onClose and
 *     never pushes. Forward restores a layer instead of trapping.
 *     Foreign history entries are ignored.
 *  3. Source wiring: the three named inset consumers, the view
 *     and thread and dialog layers, the Inbox long press, the
 *     visible evidence tier explanation, and the Settings preview
 *     before commit behaviour.
 */

import { strict as assert } from "node:assert";
import fs from "node:fs";
import vm from "node:vm";

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
function group(name) { console.log(`\n${name}`); }

const read = (p) => fs.readFileSync(p, "utf8");
const appSrc = read("src/CerebrumApp.jsx");
const inboxSrc = read("src/inbox.jsx");
const flowSrc = read("src/flowcharts.jsx");
const settingsSrc = read("src/settings.jsx");

/* Load keyboardInset.js in a VM with the react import stubbed,
   the same pattern tests/scroll-lock.mjs uses for scrollLock.js:
   the pure computation is under test, React owns the hook. */
function loadInsetModule() {
  const src = read("src/keyboardInset.js")
    .replace(/import\s*\{\s*useState, useEffect\s*\}\s*from\s*["']react["'];?/, "const useState = (init) => [typeof init === 'function' ? init() : init, () => {}]; const useEffect = () => {};")
    .replace(/^export\s+(?=(?:function|const|let|var)\s)/gm, "")
    .replace(/export\s*\{[^}]*\};?/g, "");
  const context = vm.createContext({ console });
  vm.runInContext(src + "\nthis.__api = { computeKeyboardInset, readKeyboardInset };", context);
  return context.__api;
}

/* A fake browser history: entries, an index, push and replace,
   and back and forward that fire popstate synchronously, which
   is the ordering the helper must survive. */
function fakeWindow() {
  const listeners = {};
  const entries = [{ state: null }];
  let idx = 0;
  const fire = (name) => { for (const fn of [...(listeners[name] || [])]) fn({ type: name }); };
  const win = {
    addEventListener: (n, fn) => { (listeners[n] = listeners[n] || []).push(fn); },
    removeEventListener: (n, fn) => { listeners[n] = (listeners[n] || []).filter((f) => f !== fn); },
    history: {
      get state() { return entries[idx].state; },
      pushState(state) { entries.splice(idx + 1); entries.push({ state }); idx++; },
      replaceState(state) { entries[idx].state = state; },
      back() { if (idx > 0) { idx--; fire("popstate"); } },
      forward() { if (idx < entries.length - 1) { idx++; fire("popstate"); } },
    },
    _entries: entries,
    _idx: () => idx,
  };
  return win;
}

const { createHistoryNav } = await import("../src/historyNav.js");

group("keyboard inset computation");

await test("a keyboard covering 300px reads as a 300 inset", () => {
  const { computeKeyboardInset } = loadInsetModule();
  assert.equal(computeKeyboardInset({ innerHeight: 800, visualHeight: 500, visualOffsetTop: 0 }), 300);
});

await test("the visual viewport top offset is part of the covered band", () => {
  const { computeKeyboardInset } = loadInsetModule();
  assert.equal(computeKeyboardInset({ innerHeight: 800, visualHeight: 500, visualOffsetTop: 100 }), 200);
});

await test("no keyboard reads as zero, and sub 2px jitter reads as zero", () => {
  const { computeKeyboardInset } = loadInsetModule();
  assert.equal(computeKeyboardInset({ innerHeight: 800, visualHeight: 800, visualOffsetTop: 0 }), 0);
  assert.equal(computeKeyboardInset({ innerHeight: 800, visualHeight: 799, visualOffsetTop: 0 }), 0);
  assert.equal(computeKeyboardInset({ innerHeight: 800, visualHeight: 900, visualOffsetTop: 0 }), 0);
});

await test("missing or garbage metrics read as zero, never NaN", () => {
  const { computeKeyboardInset, readKeyboardInset } = loadInsetModule();
  assert.equal(computeKeyboardInset(null), 0);
  assert.equal(computeKeyboardInset({}), 0);
  assert.equal(computeKeyboardInset({ innerHeight: "x", visualHeight: 500 }), 0);
  assert.equal(readKeyboardInset({ innerHeight: 700 }), 0);
  assert.equal(readKeyboardInset({ innerHeight: 700, visualViewport: { height: 400, offsetTop: 0 } }), 300);
});

group("history helper ordering");

await test("back closes a dialog first, then a thread, then a view", () => {
  const win = fakeWindow();
  const nav = createHistoryNav(win);
  const closed = [];
  nav.pushLayer("view", "library", () => closed.push("view"));
  nav.pushLayer("thread", "t1", () => closed.push("thread"));
  nav.pushLayer("dialog", "d1", () => closed.push("dialog"));
  assert.equal(nav.depth(), 3);
  win.history.back();
  assert.deepEqual(closed, ["dialog"]);
  win.history.back();
  assert.deepEqual(closed, ["dialog", "thread"]);
  win.history.back();
  assert.deepEqual(closed, ["dialog", "thread", "view"]);
  assert.equal(nav.depth(), 0);
  nav.dispose();
});

await test("pushing the same top layer twice adds no second entry", () => {
  const win = fakeWindow();
  const nav = createHistoryNav(win);
  nav.pushLayer("view", "library", () => {});
  const entriesAfterFirst = win._entries.length;
  assert.equal(nav.pushLayer("view", "library", () => {}), false);
  assert.equal(win._entries.length, entriesAfterFirst);
  assert.equal(nav.depth(), 1);
  nav.dispose();
});

await test("a programmatic close steps back once and never calls onClose", () => {
  const win = fakeWindow();
  const nav = createHistoryNav(win);
  let closes = 0;
  nav.pushLayer("view", "library", () => { closes++; });
  nav.pushLayer("dialog", "d1", () => { closes++; });
  const idxBefore = win._idx();
  assert.equal(nav.closeLayer("dialog", "d1"), true);
  assert.equal(win._idx(), idxBefore - 1, "closeLayer did not step the browser back");
  assert.equal(closes, 0, "onClose fired for a programmatic close");
  assert.equal(nav.depth(), 1, "the dialog layer was not trimmed by the pop");
  win.history.back();
  assert.equal(closes, 1, "the view layer under it did not close on the next back");
  nav.dispose();
});

await test("forward restores a popped layer instead of trapping", () => {
  const win = fakeWindow();
  const nav = createHistoryNav(win);
  const events = [];
  nav.pushLayer("view", "settings",
    () => events.push("close"),
    () => events.push("restore"));
  win.history.back();
  assert.deepEqual(events, ["close"]);
  win.history.forward();
  assert.deepEqual(events, ["close", "restore"]);
  assert.equal(nav.depth(), 1);
  nav.dispose();
});

await test("foreign entries with no cbNav depth are ignored", () => {
  const win = fakeWindow();
  const nav = createHistoryNav(win);
  let closes = 0;
  nav.pushLayer("view", "trending", () => { closes++; });
  win.history.pushState(null, "");
  win.history.back();
  assert.equal(closes, 0, "landing back on the view entry closed it");
  assert.equal(nav.depth(), 1);
  nav.dispose();
});

await test("a dead layer is skipped when back walks through it", () => {
  const win = fakeWindow();
  const nav = createHistoryNav(win);
  const closed = [];
  nav.pushLayer("view", "library", () => closed.push("view"));
  nav.pushLayer("thread", "t1", () => closed.push("thread"));
  nav.releaseLayer("thread", "t1");
  nav.pushLayer("thread", "t2", () => closed.push("thread2"));
  win.history.back();
  assert.deepEqual(closed, ["thread2"]);
  /* The next back lands on the dead t1 entry: it must close the
     view under it in the same press, not stall on the dead entry. */
  win.history.back();
  assert.deepEqual(closed, ["thread2", "view"]);
  nav.dispose();
});

await test("restore marks are consumed once and only for their key", () => {
  const win = fakeWindow();
  const nav = createHistoryNav(win);
  nav.markRestore("view", "search");
  assert.equal(nav.consumeRestore("view", "library"), false);
  assert.equal(nav.consumeRestore("view", "search"), true);
  assert.equal(nav.consumeRestore("view", "search"), false);
  nav.dispose();
});

group("shared wiring in the sources");

await test("exactly the three named consumers use the keyboard inset hook", () => {
  assert.match(inboxSrc, /useKeyboardInset\(\)/, "Inbox does not use the shared inset");
  assert.match(inboxSrc, /paddingBottom: isMobile \? `calc\(72px \+ env\(safe-area-inset-bottom, 0px\) \+ \$\{keyboardInset\}px\)`/, "Inbox root does not pad by the inset");
  const composer = appSrc.slice(appSrc.indexOf("function SignalComposer"), appSrc.indexOf("function SignalComposer") + 24000);
  assert.match(composer, /useKeyboardInset\(\)/, "the search stage composer does not use the shared inset");
  assert.match(composer, /scrollMarginBottom: keyboardInset/, "the search stage composer reserves no scroll margin for the inset");
  const reader = appSrc.slice(appSrc.indexOf("function NotebookMode"), appSrc.indexOf("function NotebookMode") + 3000);
  assert.match(reader, /useKeyboardInset\(\)/, "NotebookMode does not use the shared inset");
  assert.match(appSrc, /bottom: `calc\(78px \+ env\(safe-area-inset-bottom, 0px\) \+ \$\{keyboardInset\}px\)`/, "the Reader ask bar does not lift by the inset");
});

await test("view, thread, and dialog all register history layers", () => {
  assert.match(appSrc, /historyNav\.pushLayer\("view", view/, "App pushes no view layer");
  assert.match(appSrc, /historyNav\.consumeRestore\("view", view\)/, "App does not consume pop restores for views");
  assert.match(inboxSrc, /historyNav\.pushLayer\("thread", String\(activeId\)/, "Inbox pushes no thread layer");
  assert.match(inboxSrc, /historyNav\.requestBack\("thread", String\(activeId\)\)/, "the thread back arrow does not go through history");
  assert.match(flowSrc, /historyNav\.pushLayer\("dialog", id/, "Dialog pushes no layer");
  assert.match(flowSrc, /historyNav\.closeLayer\("dialog", id\)/, "Dialog does not close its layer on unmount");
  assert.match(flowSrc, /if \(dismissable\) \{\s*historyNav\.pushLayer/, "a nondismissable dialog can push a layer and trap back");
});

await test("the Trending and NovaEgg popstate listeners still exist", () => {
  assert.match(appSrc, /window\.addEventListener\("popstate", syncFromHash\)/, "Trending hash popstate listener is gone");
  assert.match(read("src/NovaEgg.jsx"), /window\.addEventListener\("popstate", check\)/, "NovaEgg popstate listener is gone");
});

await test("Inbox messages reveal report on long press, not only on hover", () => {
  // 2026-10-23 (shell landing reconciliation): the Inbox redo landed
  // its own long press after this lane was written, covering own and
  // received messages with one action row (Report, Delete, Close).
  // The landing kept that implementation and dropped this lane's
  // duplicate, so these pins assert the reconciled wiring: a touch
  // start on the bubble arms a timer that sets actionMsgId, the
  // pressed message renders the labelled action row, and the report
  // flag reveals for the pressed message as it does for hover.
  assert.match(inboxSrc, /onTouchStart=\{\(\) => \{ if \(longPressRef\.current\) clearTimeout\(longPressRef\.current\); longPressRef\.current = setTimeout\(\(\) => setActionMsgId\(m\.id \|\| key\), 450\); \}\}/, "no long press start on a message");
  assert.match(inboxSrc, /actionMsgId === \(m\.id \|\| key\) && \(/, "no touch action row is rendered for the pressed message");
  assert.match(inboxSrc, />Report this message<\/button>/, "the touch action row carries no labelled report action");
  assert.match(inboxSrc, /opacity: hoverMsgId === key \|\| actionMsgId === \(m\.id \|\| key\) \? 1 : 0/, "the flag stays hidden after a long press");
});

await test("the selected evidence tier explanation is visible text, not only a title", () => {
  const filter = appSrc.slice(appSrc.indexOf("function EvidenceFilter"), appSrc.indexOf("function EvidenceFilter") + 7000);
  assert.match(filter, /<span style=\{\{ color: P\.ink2, fontWeight: 500 \}\}>\{active\[1\]\}\.<\/span> \{active\[2\]\}/, "the selected tier blurb is not rendered as text");
  assert.match(filter, /role="status"/, "the explanation line is not a live status line");
});

await test("reading profiles preview on a first touch tap and commit explicitly", () => {
  assert.match(settingsSrc, /profileTapRef\.current = \{ key, touch: e\.pointerType === "touch"/, "no touch press is recorded on a profile card");
  assert.match(settingsSrc, /if \(tap && tap\.touch && tap\.key === key && !tap\.previewed\) \{ setPreviewKey\(key\); return; \}/, "a first touch tap does not stop at the preview");
  assert.match(settingsSrc, /Apply \{READING_PROFILES\[previewKey\]\.label\} profile/, "there is no explicit apply action for a previewed profile");
  assert.match(settingsSrc, /Previewing\. Tap again to apply\./, "a previewed card does not say a second tap applies");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
