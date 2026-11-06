/**
 * Shell and Lists fix lane, site debug 2026-11-06.
 *
 * Regression tests for the nine core surfaces defects fixed in this
 * lane: sidebar history (S3), sidebar current row (S1), legal popover
 * dismissal (S2), Home resume row rules (H1, H2), sign out landing
 * (A1), honest people search failure (P1), past edition failure (N1),
 * and the Diagram Studio navigation guard (D1).
 *
 * The history defect gets a behavior test against the real
 * src/historyNav.js with the App's view effect transcribed from the
 * shipped code, the same method the audit harness used to prove the
 * defect. The rest are source assertions in the style the repo
 * already uses for component behavior it cannot render headlessly.
 *
 * Run with: node tests/shell-lists-fix-nov06.mjs
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
function group(name) { console.log(`\n${name}`); }

const appSrc = readFileSync(join(root, "src/CerebrumApp.jsx"), "utf8");
const inboxSrc = readFileSync(join(root, "src/inbox.jsx"), "utf8");
const flowSrc = readFileSync(join(root, "src/flowcharts.jsx"), "utf8");

/* Minimal browser history fake with real browser semantics, the one
   the site debug harness used: pushState truncates forward entries,
   replaceState rewrites the current entry, back and forward move a
   pointer and fire popstate asynchronously. */
class FakeWindow {
  constructor() {
    this.entries = [{ state: null }];
    this.index = 0;
    this.listeners = new Set();
    const self = this;
    this.history = {
      get state() { return self.entries[self.index] ? self.entries[self.index].state : null; },
      pushState(state) {
        self.entries = self.entries.slice(0, self.index + 1);
        self.entries.push({ state });
        self.index++;
      },
      replaceState(state) {
        if (self.entries[self.index]) self.entries[self.index].state = state;
      },
      back() {
        if (self.index <= 0) return;
        self.index--;
        setTimeout(() => self.dispatchPop(), 0);
      },
      forward() {
        if (self.index >= self.entries.length - 1) return;
        self.index++;
        setTimeout(() => self.dispatchPop(), 0);
      },
    };
  }
  dispatchPop() { for (const fn of [...this.listeners]) fn(); }
  addEventListener(type, fn) { if (type === "popstate") this.listeners.add(fn); }
  removeEventListener(type, fn) { if (type === "popstate") this.listeners.delete(fn); }
  setTimeout(fn, ms) { return setTimeout(fn, ms); }
  clearTimeout(t) { clearTimeout(t); }
  back() { this.history.back(); }
  forward() { this.history.forward(); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { createHistoryNav } = await import(join(root, "src/historyNav.js"));

/* The App's view history effect, transcribed from the shipped
   CerebrumApp.jsx including the S3 door exit reset. state.entered
   and state.view stand in for the React state; runViewEffect stands
   in for the effect firing on [view, entered]. */
function makeApp() {
  const win = new FakeWindow();
  const nav = createHistoryNav(win);
  const state = { view: "search", entered: false };
  const ref = { base: null, prev: null };
  function runViewEffect() {
    if (!state.entered) {
      ref.base = null; ref.prev = null;
      for (const l of nav.layers()) {
        if (l.alive) nav.releaseLayer(l.kind, l.key);
      }
      return;
    }
    const h = ref;
    if (h.base === null) { h.base = state.view; h.prev = state.view; return; }
    if (state.view === h.prev) return;
    const from = h.prev;
    h.prev = state.view;
    if (nav.consumeRestore("view", state.view)) return;
    const v = state.view;
    nav.pushLayer("view", v,
      () => { nav.markRestore("view", from); setView(from); },
      () => { nav.markRestore("view", v); setView(v); });
  }
  function setView(v) { state.view = v; runViewEffect(); }
  function setEntered(b) { state.entered = b; runViewEffect(); }
  return { win, nav, state, setView, setEntered, runViewEffect };
}

// ══════════════════════════════════════════════════════════════════
group("S3: logo door exit and re entry plant no phantom history layer");

await test("plain chain still walks back and forward", async () => {
  const app = makeApp();
  app.setEntered(true);
  app.setView("library"); app.setView("settings");
  app.win.back(); await sleep(20);
  assert.equal(app.state.view, "library");
  app.win.back(); await sleep(20);
  assert.equal(app.state.view, "search");
  app.win.forward(); await sleep(20);
  assert.equal(app.state.view, "library");
});

await test("door exit releases the view layers and re entry pushes nothing", async () => {
  const app = makeApp();
  app.setEntered(true);
  app.setView("library"); app.setView("profile");
  // handleLogoClick: setEntered(false); setView("search");
  app.setEntered(false); app.setView("search");
  assert.ok(app.nav.layers().every((l) => !l.alive), "layers still alive after door exit");
  // Intro onEnter: setEntered(true)
  app.setEntered(true);
  await sleep(20);
  assert.ok(app.nav.layers().every((l) => !l.alive), "re entry pushed a fresh view layer");
  assert.equal(app.state.view, "search");
});

await test("one Back from the re entered home view resurrects nothing", async () => {
  const app = makeApp();
  app.setEntered(true);
  app.setView("library"); app.setView("profile");
  app.setEntered(false); app.setView("search");
  app.setEntered(true);
  await sleep(20);
  app.win.back(); await sleep(40);
  assert.equal(app.state.view, "search", `back landed on ${app.state.view}`);
  app.win.back(); await sleep(40);
  assert.equal(app.state.view, "search", `second back landed on ${app.state.view}`);
});

await test("navigation after re entry pushes and pops normally again", async () => {
  const app = makeApp();
  app.setEntered(true);
  app.setView("profile");
  app.setEntered(false); app.setView("search");
  app.setEntered(true);
  app.setView("library");
  assert.ok(app.nav.layers().some((l) => l.alive && l.kind === "view" && l.key === "library"), "post re entry navigation did not push");
  app.win.back(); await sleep(30);
  assert.equal(app.state.view, "search");
});

// ══════════════════════════════════════════════════════════════════
group("Source assertions: the nine fixes are in the shipped code");

await test("S1: the New search row checks current against the search view", () => {
  assert.match(appSrc, /const activeKey = key === "new" \? "search" : key;/);
  assert.match(appSrc, /itemStyle\(activeKey\)/);
  assert.match(appSrc, /aria-current=\{view === activeKey \? "page" : undefined\}/);
  assert.match(appSrc, /onMouseLeave=\{hoverOut\(activeKey\)\}/);
  // dispatch still uses the raw key, so the session reset still runs
  assert.match(appSrc, /onClick=\{\(\) => onNavigate\(key\)\}/);
});

await test("S2: the legal popover wires onClose to outside press and Escape", () => {
  const start = appSrc.indexOf("function ShellLegalPopover");
  const body = appSrc.slice(start, start + 2200);
  assert.match(body, /document\.addEventListener\("mousedown", onDocDown\)/);
  assert.match(body, /e\.key === "Escape"\) onClose\(\)/);
  assert.match(body, /popRef\.current\.contains\(e\.target\)/);
  assert.match(appSrc, /<ShellLegalPopover onClose=\{\(\) => setLegalOpen\(false\)\} \/>/);
});

await test("S3: the view effect resets and releases on door exit", () => {
  assert.match(appSrc, /viewHistoryRef\.current = \{ base: null, prev: null \};/);
  assert.match(appSrc, /historyNav\.releaseLayer\(l\.kind, l\.key\)/);
});

await test("H1 and H2: the resume row obeys the substantial rule and needs turns", () => {
  assert.match(appSrc, /const stageLastQText = stageLastQ;/);
  assert.ok(!/stageLastQ\s*\|\|\s*\(stageLastEntry/.test(appSrc), "title fallback is back");
  assert.match(appSrc, /const stageLastEntry = history && history\.length && Array\.isArray\(history\[0\]\.turns\) && history\[0\]\.turns\.length \? history\[0\] : null;/);
});

await test("A1: sign out and account deletion land on the search view", () => {
  const signOut = appSrc.slice(appSrc.indexOf("async function signOut()"), appSrc.indexOf("async function signOut()") + 1300);
  assert.match(signOut, /setView\("search"\)/);
  const deleted = appSrc.slice(appSrc.indexOf("function onAccountDeleted()"), appSrc.indexOf("function onAccountDeleted()") + 1400);
  assert.match(deleted, /setView\("search"\)/);
});

await test("P1: People search treats a null response as failure with a retry", () => {
  assert.match(appSrc, /const \[searchFailed, setSearchFailed\] = useState\(false\);/);
  assert.match(appSrc, /if \(data && Array\.isArray\(data\.items\)\) \{\s*setResults\(data\.items\);/);
  assert.match(appSrc, /\}, \[query, searchRetry\]\);/);
  assert.match(appSrc, /Search did not load\. Check your connection, then try again\./);
});

await test("P1: the three inbox people searches carry the same honest failure", () => {
  for (const name of ["searchFailed", "groupSearchFailed", "settingsSearchFailed"]) {
    assert.ok(inboxSrc.includes(`const [${name},`), `inbox.jsx missing ${name} state`);
  }
  const copies = inboxSrc.match(/Search did not load\. Check your connection, then try again\./g) || [];
  assert.equal(copies.length, 3, `expected 3 failure copies in inbox.jsx, found ${copies.length}`);
  assert.ok(!inboxSrc.includes("setResults((d && d.items) || [])"), "the share picker still converts failure into an empty list");
  assert.ok(!inboxSrc.includes("const items = (d && d.items) || [];"), "a group search still converts failure into an empty list");
});

await test("N1: a failed past edition restores the screen and retries that edition", () => {
  assert.match(appSrc, /const failedEditionRef = useRef\(null\);/);
  assert.match(appSrc, /const snapshot = \{ items, generatedAt, feedMeta, missingSources, citationHealth, viewingEdition, newEdition, expanded \};/);
  assert.match(appSrc, /setEditionNote\("That edition did not load\. You are still looking at the edition you had open\."\)/);
  assert.match(appSrc, /if \(fid\) openEdition\(fid\); else setReloadTick/);
});

await test("D1: the page studio registers its guard and the shell routes through it", () => {
  assert.match(flowSrc, /navGuardRef\.current = \(proceed\) => guardRef\.current\("leaving", proceed\);/);
  assert.match(flowSrc, /pendingLoad\.label === "leaving" \? "Leave without saving"/);
  assert.match(appSrc, /navGuardRef=\{studioNavGuardRef\}/);
  assert.match(appSrc, /if \(view === "studio" && key !== "studio" && studioNavGuardRef\.current\)/);
  assert.match(appSrc, /studioNavGuardRef\.current\(goDoor\)/);
});

// ══════════════════════════════════════════════════════════════════
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
