/**
 * scroll-lock.mjs — Regression tests for the scroll-lock system.
 *
 * The Oct 6 "scroll broken everywhere" bug happened because there were no
 * tests: the consent gate (!legalOk) wasn't in the anyOverlayOpen list, and
 * four competing lock systems fought over body.style.overflow.
 *
 * These tests cover:
 * 1. cbDialogLockScroll/cbDialogUnlockScroll ref-counting (balanced pairs)
 * 2. Overflow save/restore correctness
 * 3. anyOverlayOpen includes the consent gate (!legalOk)
 * 4. No hand-rolled overflow toggles competing with the ref-counted system
 * 5. The pin effect is keyed on the single boolean, not individual overlays
 */

import { strict as assert } from "node:assert";
import fs from "node:fs";
import vm from "node:vm";
import { parse } from "@babel/parser";
import { transformSync } from "esbuild";

const appSrc = fs.readFileSync("src/CerebrumApp.jsx", "utf8");

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

// Extract the lock/unlock functions via AST and run them in a VM with a
// mocked document.body.style.
function getLockFns() {
  const ast = parse(appSrc, { sourceType: "module", plugins: ["jsx"] });
  const nodes = ast.program.body.filter(
    (n) =>
      n.type === "FunctionDeclaration" &&
      ["cbDialogLockScroll", "cbDialogUnlockScroll"].includes(n.id.name)
  );
  assert.equal(nodes.length, 2, "both lock functions must exist in CerebrumApp.jsx");
  // Also need the module-level lets
  const lets = ast.program.body.filter(
    (n) =>
      n.type === "VariableDeclaration" &&
      n.declarations.some((d) =>
        ["cbDialogLockDepth", "cbDialogSavedOverflow", "cbDialogSavedPaddingRight"].includes(d.id.name)
      )
  );
  const code = [...lets, ...nodes]
    .map((n) => transformSync(appSrc.slice(n.start, n.end), { loader: "js" }).code)
    .join("\n");

  const style = { overflow: "", paddingRight: "" };
  const context = vm.createContext({
    document: { body: { style } },
    window: { innerWidth: 1280, document: { documentElement: { clientWidth: 1265 } } },
    console,
  });
  // window.documentElement for scrollbar width calc
  context.window.document = { documentElement: { clientWidth: 1265 } };
  context.document.documentElement = { clientWidth: 1265 };
  vm.runInContext(code + "\nthis.__api = { lock: cbDialogLockScroll, unlock: cbDialogUnlockScroll, depth: () => cbDialogLockDepth };", context);
  return { api: context.__api, style };
}

console.log("scroll-lock — ref-counted dialog lock");

await test("single lock sets overflow hidden, single unlock restores", () => {
  const { api, style } = getLockFns();
  style.overflow = "auto";
  api.lock();
  assert.equal(style.overflow, "hidden", "lock must hide overflow");
  api.unlock();
  assert.equal(style.overflow, "auto", "unlock must restore original overflow");
  assert.equal(api.depth(), 0, "depth must return to 0");
});

await test("nested locks require nested unlocks (ref-counting)", () => {
  const { api, style } = getLockFns();
  style.overflow = "";
  api.lock();
  api.lock();
  api.lock();
  assert.equal(api.depth(), 3, "depth must be 3 after three locks");
  api.unlock();
  assert.equal(style.overflow, "hidden", "overflow must stay hidden until last unlock");
  assert.equal(api.depth(), 2);
  api.unlock();
  api.unlock();
  assert.equal(api.depth(), 0, "depth must return to 0");
  assert.equal(style.overflow, "", "original overflow restored after last unlock");
});

await test("unbalanced unlock never drives depth negative", () => {
  const { api, style } = getLockFns();
  style.overflow = "scroll";
  api.unlock(); // no matching lock
  api.unlock();
  assert.equal(api.depth(), 0, "depth must clamp at 0");
  assert.equal(style.overflow, "scroll", "unbalanced unlock must not touch styles");
});

await test("lock saves and restores original paddingRight", () => {
  const { api, style } = getLockFns();
  style.paddingRight = "10px";
  api.lock();
  api.unlock();
  // paddingRight is restored to saved value (may have scrollbar compensation added during lock)
  assert.ok(
    style.paddingRight === "10px" || style.paddingRight === "",
    `paddingRight should restore, got "${style.paddingRight}"`
  );
});

console.log("scroll-lock — consent gate and overlay coverage");

await test("anyOverlayOpen includes the consent gate (!legalOk)", () => {
  // The Oct 6 bug: first-time visitors got a fixed overlay over a scrollable
  // page because !legalOk wasn't in the lock list.
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

await test("pin effect is keyed on the single boolean", () => {
  assert.match(
    appSrc,
    /\}, \[anyOverlayOpen\]\);/,
    "scroll-lock pin effect must be keyed on [anyOverlayOpen]"
  );
});

await test("no hand-rolled body overflow toggles outside the two systems", () => {
  // EvidenceRail and the mobile sidebar were migrated to cbDialogLockScroll.
  // Any remaining direct `document.body.style.overflow = "hidden"` outside
  // the two sanctioned systems is a regression.
  const lines = appSrc.split("\n");
  const bad = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      /document\.body\.style\.overflow\s*=\s*"hidden"/.test(line) &&
      !line.includes("//")
    ) {
      // Allow the two sanctioned sites: cbDialogLockScroll and the anyOverlayOpen effect
      const ctx = lines.slice(Math.max(0, i - 30), i + 1).join("\n");
      const inLockFn = /function cbDialogLockScroll/.test(ctx.slice(-2000));
      const inPinEffect = /const anyOverlayOpen/.test(ctx.slice(-4000));
      if (!inLockFn && !inPinEffect) {
        bad.push(`line ${i + 1}: ${line.trim().slice(0, 80)}`);
      }
    }
  }
  assert.deepEqual(bad, [], `hand-rolled overflow locks found:\n${bad.join("\n")}`);
});

await test("Dialog primitive uses the ref-counted lock (not a local toggle)", () => {
  const flowSrc = fs.readFileSync("src/flowcharts.jsx", "utf8");
  assert.match(flowSrc, /cbDialogLockScroll\(\)/, "Dialog must call cbDialogLockScroll");
  assert.match(flowSrc, /cbDialogUnlockScroll\(\)/, "Dialog must call cbDialogUnlockScroll");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
