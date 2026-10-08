#!/usr/bin/env node
/**
 * no-undefined-refs.mjs — Crash prevention for monolith splits.
 *
 * Catches the class of production crash that took down askcerebrum.org
 * on 2026-10-07/08:
 *   `__cbMotionCache is not defined` (flowcharts.jsx extraction)
 *   `cbMotionOff is not defined` (intro.jsx extraction)
 *   `CinematicFilm is not defined` (intro.jsx extraction)
 *   `Mark is not defined` (intro.jsx extraction — missed by the first
 *     version of this test because regex string-stripping swallowed
 *     real JSX; now uses a proper tokenizer)
 *
 * Each crash came from code extracted to a new module that referenced
 * a function or component still defined in the old file, without an
 * import. Vite builds fine because undefined identifiers are legal
 * JavaScript until they execute in the browser.
 *
 * This test scans for two specific dangerous patterns:
 * 1. JSX usage `<ComponentName` where ComponentName is not imported/defined
 * 2. Direct calls to known helpers that were moved during extractions
 */

import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "src");

// Browser and JS builtins that are legitimately available
const KNOWN_GLOBALS = new Set([
  "window", "document", "navigator", "location", "history",
  "localStorage", "sessionStorage", "fetch",
  "setTimeout", "clearTimeout", "setInterval", "clearInterval",
  "requestAnimationFrame", "cancelAnimationFrame",
  "IntersectionObserver", "ResizeObserver", "MutationObserver",
  "URL", "URLSearchParams", "FormData", "Blob", "File", "FileReader",
  "Image", "Audio", "WebSocket", "Worker", "EventSource",
  "crypto", "performance", "console",
  "ReadableStream", "TextDecoder", "TextEncoder", "AbortController",
  "CustomEvent", "DOMException", "XMLSerializer", "Path2D",
  "RTCPeerConnection", "MediaRecorder", "Notification",
  "SpeechSynthesisUtterance", "Uint8Array",
  "Object", "Array", "String", "Number", "Boolean", "Date", "Math",
  "JSON", "Promise", "Symbol", "BigInt", "Map", "Set", "WeakMap",
  "WeakSet", "Error", "TypeError", "RangeError", "RegExp",
  "React", "Fragment",
]);

let failures = 0;

/**
 * Blank out comments and string contents, preserving newlines and
 * replacing every other character with a space. This keeps line
 * numbers accurate while ensuring matches only come from real code.
 * Handles nested template literals via ${} brace tracking.
 */
function maskNonCode(src) {
  const out = new Array(src.length);
  const n = src.length;
  let i = 0;

  // stack of contexts: { type: 'tpl', braceDepth }
  const tplStack = [];
  let state = "code"; // code | lineComment | blockComment | single | double | tpl

  const pushSpace = (idx) => { out[idx] = " "; };

  // Heuristic: does a `/` at position i start a regex literal?
  // True when the previous significant char expects a value.
  const isRegexStart = (idx) => {
    let j = idx - 1;
    while (j >= 0 && (src[j] === " " || src[j] === "\t" || src[j] === "\n" || src[j] === "\r")) j--;
    if (j < 0) return true;
    const prev = src[j];
    if ("(,=:[!&|?{};".includes(prev)) return true;
    // keywords that precede a regex: return, typeof, instanceof, in, of, new, delete, void, throw, case, do, else
    const before = src.substring(Math.max(0, j - 10), j + 1);
    if (/\b(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)\s*$/.test(before)) return true;
    return false;
  };

  while (i < n) {
    const c = src[i];
    const next = i + 1 < n ? src[i + 1] : "";

    if (state === "code") {
      if (c === "/" && next === "/") {
        out[i] = " "; out[i + 1] = " "; i += 2; state = "lineComment"; continue;
      }
      if (c === "/" && next === "*") {
        out[i] = " "; out[i + 1] = " "; i += 2; state = "blockComment"; continue;
      }
      if (c === "'") { pushSpace(i); i++; state = "single"; continue; }
      if (c === '"') { pushSpace(i); i++; state = "double"; continue; }
      if (c === "`") { pushSpace(i); i++; tplStack.push({ braceDepth: 0 }); state = "tpl"; continue; }
      if (c === "/" && next !== "/" && next !== "*" && isRegexStart(i)) {
        // regex literal: consume until unescaped / outside character class
        pushSpace(i); i++;
        let inClass = false;
        while (i < n) {
          const rc = src[i];
          if (rc === "\\" && i + 1 < n) { pushSpace(i); pushSpace(i + 1); i += 2; continue; }
          if (rc === "[") { inClass = true; pushSpace(i); i++; continue; }
          if (rc === "]") { inClass = false; pushSpace(i); i++; continue; }
          if (rc === "/" && !inClass) { pushSpace(i); i++; break; }
          if (rc === "\n") { out[i] = "\n"; i++; break; } // unterminated — recover
          pushSpace(i); i++;
        }
        // skip regex flags
        while (i < n && /[a-z]/i.test(src[i])) { pushSpace(i); i++; }
        continue;
      }
      out[i] = c; i++; continue;
    }

    if (state === "lineComment") {
      if (c === "\n") { out[i] = "\n"; i++; state = "code"; continue; }
      pushSpace(i); i++; continue;
    }

    if (state === "blockComment") {
      if (c === "*" && next === "/") { pushSpace(i); pushSpace(i + 1); i += 2; state = "code"; continue; }
      out[i] = c === "\n" ? "\n" : " "; i++; continue;
    }

    if (state === "single" || state === "double") {
      const quote = state === "single" ? "'" : '"';
      if (c === "\\" && i + 1 < n) { pushSpace(i); pushSpace(i + 1); i += 2; continue; }
      if (c === "\n") { out[i] = "\n"; i++; state = "code"; continue; } // unterminated — recover
      if (c === quote) { pushSpace(i); i++; state = "code"; continue; }
      pushSpace(i); i++; continue;
    }

    if (state === "tpl") {
      const frame = tplStack[tplStack.length - 1];
      if (c === "\\" && i + 1 < n) { pushSpace(i); pushSpace(i + 1); i += 2; continue; }
      if (c === "`" && frame.braceDepth === 0) {
        pushSpace(i); i++; tplStack.pop();
        state = tplExprStack.length ? "tplExpr" : (tplStack.length ? "tpl" : "code");
        continue;
      }
      if (c === "$" && next === "{" && frame.braceDepth === 0) {
        // entering ${} expression — the ${ itself is masked, then code resumes
        pushSpace(i); pushSpace(i + 1); i += 2;
        frame.braceDepth = 1;
        state = "tplExpr";
        tplExprStack.push(frame);
        continue;
      }
      out[i] = c === "\n" ? "\n" : " "; i++; continue;
    }

    if (state === "tplExpr") {
      const frame = tplExprStack[tplExprStack.length - 1];
      if (c === "/" && next === "/") { out[i] = " "; out[i + 1] = " "; i += 2; state = "tplLineComment"; continue; }
      if (c === "/" && next === "*") { out[i] = " "; out[i + 1] = " "; i += 2; state = "tplBlockComment"; continue; }
      if (c === "'") { pushSpace(i); i++; state = "tplSingle"; continue; }
      if (c === '"') { pushSpace(i); i++; state = "tplDouble"; continue; }
      if (c === "`") { pushSpace(i); i++; tplStack.push({ braceDepth: 0 }); state = "tpl"; continue; }
      if (c === "/" && next !== "/" && next !== "*" && isRegexStart(i)) {
        pushSpace(i); i++;
        let inClass = false;
        while (i < n) {
          const rc = src[i];
          if (rc === "\\" && i + 1 < n) { pushSpace(i); pushSpace(i + 1); i += 2; continue; }
          if (rc === "[") { inClass = true; pushSpace(i); i++; continue; }
          if (rc === "]") { inClass = false; pushSpace(i); i++; continue; }
          if (rc === "/" && !inClass) { pushSpace(i); i++; break; }
          if (rc === "\n") { out[i] = "\n"; i++; break; }
          pushSpace(i); i++;
        }
        while (i < n && /[a-z]/i.test(src[i])) { pushSpace(i); i++; }
        continue;
      }
      if (c === "{") { frame.braceDepth++; out[i] = c; i++; continue; }
      if (c === "}") {
        frame.braceDepth--;
        if (frame.braceDepth === 0) {
          out[i] = c; i++;
          tplExprStack.pop();
          state = "tpl";
          continue;
        }
        out[i] = c; i++; continue;
      }
      out[i] = c; i++; continue;
    }

    if (state === "tplLineComment") {
      if (c === "\n") { out[i] = "\n"; i++; state = "tplExpr"; continue; }
      pushSpace(i); i++; continue;
    }
    if (state === "tplBlockComment") {
      if (c === "*" && next === "/") { pushSpace(i); pushSpace(i + 1); i += 2; state = "tplExpr"; continue; }
      out[i] = c === "\n" ? "\n" : " "; i++; continue;
    }
    if (state === "tplSingle" || state === "tplDouble") {
      const quote = state === "tplSingle" ? "'" : '"';
      if (c === "\\" && i + 1 < n) { pushSpace(i); pushSpace(i + 1); i += 2; continue; }
      if (c === "\n") { out[i] = "\n"; i++; state = "tplExpr"; continue; }
      if (c === quote) { pushSpace(i); i++; state = "tplExpr"; continue; }
      pushSpace(i); i++; continue;
    }
  }

  return out.join("");
}

// stack for ${} frames while inside template expressions
const tplExprStack = [];

async function checkFile(filename) {
  const filepath = join(srcDir, filename);
  const rawSrc = await readFile(filepath, "utf8");
  // reset per file (module-level stack reused across files)
  tplExprStack.length = 0;
  const src = maskNonCode(rawSrc);

  // Find all imports from RAW source
  const imported = new Set();
  const importRe = /import\s+(?:(\w+)\s*,?\s*)?(?:\{([\s\S]*?)\})?\s*from\s*["'][^"']+["']/g;
  let m;
  while ((m = importRe.exec(rawSrc)) !== null) {
    if (m[1]) imported.add(m[1].trim());
    if (m[2]) {
      for (const part of m[2].split(",")) {
        const name = part.trim().split(/\s+as\s+/).pop().trim();
        if (name) imported.add(name);
      }
    }
  }
  const nsRe = /import\s*\*\s*as\s*(\w+)\s*from/g;
  while ((m = nsRe.exec(rawSrc)) !== null) {
    imported.add(m[1]);
  }

  // Find all local definitions from masked source (comments/strings blanked)
  const defined = new Set();
  const defRe = /(?:^|[;\s{}])\s*(?:export\s+)?(?:const|let|var|function|class)\s+(\w+)/gm;
  while ((m = defRe.exec(src)) !== null) {
    defined.add(m[1]);
  }

  const isAvailable = (name) =>
    KNOWN_GLOBALS.has(name) || imported.has(name) || defined.has(name);

  // Pattern 1: JSX component usage <ComponentName
  const jsxRe = /<([A-Z][\w$]*)(?=[\s/>])/g;
  const seen = new Set();
  while ((m = jsxRe.exec(src)) !== null) {
    const name = m[1];
    if (seen.has(name)) continue;
    seen.add(name);
    if (!isAvailable(name)) {
      const lineNum = src.substring(0, m.index).split("\n").length;
      console.log(`  ✗ ${filename}:${lineNum}: JSX <${name}> used but not imported or defined`);
      failures++;
    }
  }

  // Pattern 2: Known helpers that were moved during the monolith split
  const movedHelpers = [
    "cbMotionOff",
    "__cbMotionCache",
    "cbMotionCacheSet",
  ];
  for (const name of movedHelpers) {
    const usageRe = new RegExp(`(?<![.\\w$])${name}(?=\\s*\\(|\\s*[;,)\\]}])`, "g");
    if (usageRe.test(src) && !isAvailable(name)) {
      console.log(`  ✗ ${filename}: uses "${name}" but it is not imported or defined (monolith split crash pattern)`);
      failures++;
    }
  }
}

const files = (await readdir(srcDir)).filter(f => f.endsWith(".jsx") || f.endsWith(".js"));

console.log("Checking for undefined references (monolith split crash prevention)...\n");

for (const file of files) {
  await checkFile(file);
}

if (failures === 0) {
  console.log("  ✓ No undefined component references found");
} else {
  console.log(`\n${failures} undefined reference(s) found — these would crash production`);
  process.exit(1);
}
