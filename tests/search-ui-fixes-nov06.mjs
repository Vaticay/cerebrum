/**
 * Search UI fixes (2026-11-06, site debug search lane D1 to D3).
 *
 * Three proven defects on the search and answer surface, each pinned
 * here against the real shipped source:
 *
 *   D1. The "Ask a follow up" button on an answer did nothing: its
 *       handler queried input[aria-label="Follow-up question"], a
 *       label the follow up input never renders (it renders "Follow
 *       up question on ..." or "Follow up question"). The handler now
 *       selects by the input's data-cb-followup attribute.
 *   D2. A shapeshifter detected ask mode stuck forever: the empty
 *       branch of runShapeshift cleared the badge state but never
 *       restored askMode, and newSession() never reset it. The empty
 *       branch now restores the pre shift mode and newSession()
 *       resets askMode to "explain".
 *   D3. ask() is a useCallback that reads askMode for the request
 *       body but omitted it from its dependency array, so undoing a
 *       detected mode and pressing Enter sent the undone mode.
 *       askMode is in the deps now.
 *
 * The D2 tests run the real runShapeshift and overrideShape extracted
 * from src/CerebrumApp.jsx, driven by the real predictAskMode and
 * MODE_SIGNALS, through a small harness that mirrors the composer's
 * React semantics (state in locals, refs as objects, closures rebuilt
 * per "render" so shapeActive is never stale).
 *
 * Run with: node tests/search-ui-fixes-nov06.mjs
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(root, "src/CerebrumApp.jsx"), "utf8");

let passed = 0;
let failed = 0;
const t = (name, fn) => {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}: ${e.message}`); }
};

/* ── Extract the real prediction machinery ─────────────────────────── */
const sigStart = SRC.indexOf("const MODE_SIGNALS");
const predStart = SRC.indexOf("function predictAskMode", sigStart);
const predEnd = SRC.indexOf("\n}", predStart) + 2;
assert.ok(sigStart > 0 && predStart > sigStart && predEnd > predStart, "could not locate MODE_SIGNALS / predictAskMode");
const sandbox = {};
new Function("exports", SRC.slice(sigStart, predEnd) + "; exports.predictAskMode = predictAskMode;")(sandbox);
const predictAskMode = sandbox.predictAskMode;

/* ── Extract the real shapeshifter state machine ───────────────────── */
const shapeStart = SRC.indexOf("const runShapeshift = (v) => {");
const shapeEnd = SRC.indexOf("/* ── Citation aware composer: the attached paper chip", shapeStart);
assert.ok(shapeStart > 0 && shapeEnd > shapeStart, "could not locate runShapeshift / overrideShape");
const shapeFns = SRC.slice(shapeStart, shapeEnd);

/* A composer instance with React-faithful semantics: runShapeshift and
   overrideShape are rebuilt on every call with the current shapeActive,
   exactly as a re-render rebuilds them, and askModeRef tracks askMode
   the way the render assignment in the component does. */
function makeComposer() {
  const st = { askMode: "explain", shapeActive: null, shapeSignal: null };
  const askModeRef = { current: st.askMode };
  const shapeLockRef = { current: false };
  const shapePrevRef = { current: null };
  const render = () => {
    const setAskMode = (m) => { st.askMode = m; askModeRef.current = m; };
    const factory = new Function(
      "predictAskMode", "askModeRef", "shapeLockRef", "shapePrevRef",
      "setAskMode", "shapeActive", "setShapeActive", "setShapeSignal", "clickSfx",
      shapeFns + "; return { runShapeshift, overrideShape };"
    );
    return factory(
      predictAskMode, askModeRef, shapeLockRef, shapePrevRef,
      setAskMode, st.shapeActive,
      (v) => { st.shapeActive = v; },
      (v) => { st.shapeSignal = v; },
      () => {}
    );
  };
  return {
    st,
    type: (v) => render().runShapeshift(v),
    undo: () => render().overrideShape(),
  };
}

const VERSUS = "cats versus dogs, which sheds less";
const PLAIN = "How does the brain store memories";
const VERIFY = "is it true that coffee stunts growth";

console.log("\nSearch UI fixes — prediction machinery (guard)");
t("predictAskMode flags the versus question as compare", () => {
  assert.equal(predictAskMode(VERSUS).key, "compare");
});
t("predictAskMode returns null for the plain memory question", () => {
  assert.equal(predictAskMode(PLAIN), null);
});

console.log("\nSearch UI fixes — D2 shapeshifter state machine");
t("typing a versus question switches the mode to compare", () => {
  const c = makeComposer();
  c.type(VERSUS);
  assert.equal(c.st.askMode, "compare");
  assert.equal(c.st.shapeActive, "compare");
});
t("D2: clearing the box restores the pre shift mode", () => {
  const c = makeComposer();
  c.type(VERSUS);
  assert.equal(c.st.askMode, "compare");
  c.type("");
  assert.equal(c.st.askMode, "explain", "mode survived an emptied box");
  assert.equal(c.st.shapeActive, null);
});
t("D2: compare question, clear, plain question sends the default mode", () => {
  const c = makeComposer();
  c.type(VERSUS);
  c.type("");
  c.type(PLAIN);
  assert.equal(c.st.askMode, "explain", "plain question inherited the detected compare mode");
});
t("editing back to non matching text restores the mode (restore branch intact)", () => {
  const c = makeComposer();
  c.type(VERSUS);
  c.type("dogs are great pets to keep");
  assert.equal(c.st.askMode, "explain");
  assert.equal(c.st.shapeActive, null);
});
t("detection still fires for a fresh mode after a clear", () => {
  const c = makeComposer();
  c.type(VERSUS);
  c.type("");
  c.type(VERIFY);
  assert.equal(c.st.askMode, "verify");
  assert.equal(c.st.shapeActive, "verify");
});
t("undo restores the mode and locks prediction until the box is cleared", () => {
  const c = makeComposer();
  c.type(VERSUS);
  c.undo();
  assert.equal(c.st.askMode, "explain");
  c.type(VERSUS);
  assert.equal(c.st.askMode, "explain", "prediction fired while locked by the undo");
  c.type("");
  c.type(VERSUS);
  assert.equal(c.st.askMode, "compare", "prediction stayed locked after the box was cleared");
});
t("D2: newSession() resets askMode to the default", () => {
  const start = SRC.indexOf("function newSession()");
  assert.ok(start > 0, "newSession not found");
  const end = SRC.indexOf("\n  }\n", start);
  const body = SRC.slice(start, end);
  assert.match(body, /setAskMode\("explain"\)/, "newSession never resets askMode");
});

console.log("\nSearch UI fixes — D3 ask() dependency array");
t("D3: ask() lists askMode in its useCallback deps", () => {
  const depsAt = SRC.indexOf("noteRequestId]);");
  assert.ok(depsAt > 0, "ask() dependency array not found");
  const lineStart = SRC.lastIndexOf("}, [", depsAt);
  const deps = SRC.slice(lineStart, depsAt);
  assert.ok(/(^|[,\s])askMode([,\s]|$)/.test(deps), "askMode missing from ask() deps: " + deps);
});
t("ask() sends the state mode in the request body", () => {
  assert.match(SRC, /const searchBody = \{ query: question, mode: askMode,/, "request body does not read askMode");
});

console.log("\nSearch UI fixes — D1 follow up button selector");
t("D1: the broken aria label selector is gone", () => {
  assert.ok(!SRC.includes('aria-label="Follow-up question"]'), "handler still queries the label the input never renders");
});
t("D1: the handler selects the follow up input by its data attribute", () => {
  const m = SRC.match(/onFollowUp=\{\(\) => \{ const el = document\.querySelector\('([^']+)'\)/);
  assert.ok(m, "onFollowUp handler / querySelector not found");
  assert.match(m[1], /data-cb-followup/, "selector does not use data-cb-followup: " + m[1]);
});
t("D1: the selector from the shipped handler matches the rendered follow up input", () => {
  const m = SRC.match(/onFollowUp=\{\(\) => \{ const el = document\.querySelector\('([^']+)'\)/);
  const selector = m[1];
  // The input as rendered at the foot of the thread, both label branches.
  const rendered = [
    { "data-cb-followup": "true", "aria-label": "Follow up question on How does sleep work" },
    { "data-cb-followup": "true", "aria-label": "Follow up question" },
  ];
  const matches = (el) => {
    const aria = selector.match(/\[aria-label="([^"]+)"\]/);
    if (aria) return el["aria-label"] === aria[1];
    const data = selector.match(/\[data-cb-followup(?:="([^"]+)")?\]/);
    if (data) return data[1] ? el["data-cb-followup"] === data[1] : "data-cb-followup" in el;
    return false;
  };
  for (const el of rendered) assert.ok(matches(el), `selector ${selector} does not match aria-label "${el["aria-label"]}"`);
});
t("D1: the follow up input still carries the data-cb-followup hook", () => {
  assert.match(SRC, /<input style=\{S\.searchInput\} value=\{input\} data-cb-followup="true"/, "follow up input lost its data hook");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
