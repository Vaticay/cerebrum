/**
 * Scope audit: no unbound identifier references in the frontend sources.
 *
 * On 2026-09-12 every search crashed the whole app to the error boundary
 * with "saveState is not defined" — the Turn component rendered a
 * save-state indicator whose state lived in a different component. The
 * production build passed (plain JS, no type checking) and no test caught
 * it, because nothing verified that referenced names actually resolve.
 *
 * This suite parses each frontend source with @babel/parser and walks every
 * scope with @babel/traverse: any ReferencedIdentifier that binds to nothing
 * in scope and is not a known runtime global or build-time define is a
 * would-be ReferenceError — a crash waiting for the code path that renders
 * it. The same audit also caught setPwMsg (delete-account error path) and
 * setIllustrateQuery (a command-palette entry for a removed feature).
 *
 * Standalone script with its own assertions; run as a child process from
 * tests/run. No server, no network.
 * Run with: node tests/scope-audit.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "tests/scope-audit.mjs"));
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;

// Real runtime globals (browser + JS builtins). Anything referenced that is
// neither bound in scope nor listed here is an unbound reference.
const GLOBALS = new Set([
  "window", "document", "navigator", "localStorage", "sessionStorage", "location",
  "history", "fetch", "performance", "requestAnimationFrame", "cancelAnimationFrame",
  "requestIdleCallback", "cancelIdleCallback", "setTimeout", "clearTimeout",
  "setInterval", "clearInterval", "queueMicrotask", "console", "alert", "confirm",
  "prompt", "getComputedStyle", "matchMedia", "scrollTo", "open", "close",
  "URL", "URLSearchParams", "Blob", "File", "FileReader", "Image", "Audio",
  "FormData", "Headers", "Request", "Response", "AbortController", "AbortSignal",
  "TextEncoder", "TextDecoder", "crypto", "atob", "btoa",
  "IntersectionObserver", "ResizeObserver", "MutationObserver", "CustomEvent",
  "Event", "KeyboardEvent", "MouseEvent", "TouchEvent", "HTMLElement", "Element",
  "Node", "DOMParser", "XMLSerializer", "CanvasGradient", "Path2D",
  "Notification", "SpeechSynthesisUtterance", "RTCPeerConnection",
  "RTCSessionDescription", "RTCIceCandidate", "MediaRecorder",
  "JSON", "Math", "Object", "Array", "String", "Number", "Boolean", "Date",
  "RegExp", "Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError",
  "Map", "Set", "WeakMap", "WeakSet", "Promise", "Symbol", "BigInt", "Intl",
  "Reflect", "Proxy", "NaN", "Infinity", "undefined", "globalThis", "self",
  "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURI", "decodeURI",
  "encodeURIComponent", "decodeURIComponent", "escape", "unescape",
  "structuredClone", "WebSocket", "Worker", "BroadcastChannel", "MessageChannel",
  "DeviceMotionEvent", "DeviceOrientationEvent", "visualViewport",
  "CSS", "getSelection", "devicePixelRatio", "screen", "innerWidth",
  "innerHeight", "pageXOffset", "pageYOffset", "scrollX", "scrollY",
  "React", "ReactDOM", "process", "__DEV__",
  // Build-time defines injected by vite.config (typeof-guarded at use sites).
  "__CB_BUILD__",
]);

function unboundReferences(src, filename) {
  const ast = parser.parse(src, {
    sourceType: "module",
    plugins: ["jsx", "classProperties", "optionalChaining",
      "nullishCoalescingOperator", "objectRestSpread", "dynamicImport"],
  });
  const problems = [];
  traverse(ast, {
    ReferencedIdentifier(path) {
      const name = path.node.name;
      if (GLOBALS.has(name)) return;
      const parent = path.parentPath;
      if (parent.isLabeledStatement() || parent.isBreakStatement() || parent.isContinueStatement()) return;
      if (!path.scope.getBinding(name)) {
        const fn = path.getFunctionParent();
        const fnName = fn && fn.node.id ? fn.node.id.name
          : (fn && fn.parentPath.isVariableDeclarator() ? fn.parentPath.node.id.name : "(anonymous)");
        const { line, column } = path.node.loc.start;
        problems.push(`${filename}: "${name}" unbound at line ${line}:${column} (in ${fnName})`);
      }
    },
  });
  return [...new Set(problems)];
}

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

for (const f of ["src/CerebrumApp.jsx", "src/main.jsx", "src/legalContent.js"]) {
  await test(`no unbound references in ${f}`, () => {
    const src = readFileSync(join(root, f), "utf8");
    const problems = unboundReferences(src, f);
    assert.equal(problems.length, 0,
      `would-be ReferenceError(s):\n      - ` + problems.join("\n      - "));
  });
}

await test("saveState reaches the turn renderer as a prop", () => {
  const src = readFileSync(join(root, "src/CerebrumApp.jsx"), "utf8");
  const decl = src.match(/function TurnInner\(\{[\s\S]{0,1200}?\}\) \{/);
  assert.ok(decl && decl[0].includes("saveState"),
    "TurnInner must declare saveState in its props");
  assert.match(src, /<TurnRow[^>]*saveState=\{saveState\}/,
    "the live thread must pass saveState into TurnRow");
});

console.log(`\nScope audit: ${passed} passed, ${failures.length} failed.`);
if (failures.length) process.exit(1);
