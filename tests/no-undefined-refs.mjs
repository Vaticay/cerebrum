#!/usr/bin/env node
/**
 * no-undefined-refs.mjs — Crash prevention for monolith splits.
 *
 * Catches the class of production crash that took down askcerebrum.org
 * on 2026-10-07:
 *   `__cbMotionCache is not defined` (flowcharts.jsx extraction)
 *   `cbMotionOff is not defined` (intro.jsx extraction)
 *   `CinematicFilm is not defined` (intro.jsx extraction)
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

function stripCommentsAndStrings(src) {
  // Remove block comments
  let out = src.replace(/\/\*[\s\S]*?\*\//g, "");
  // Remove line comments (but keep the newline)
  out = out.replace(/\/\/[^\n]*/g, "");
  // Remove template literals (may contain JSX-like text)
  out = out.replace(/`(?:\\.|[^`\\])*`/g, '""');
  // Remove double-quoted strings
  out = out.replace(/"(?:\\.|[^"\\])*"/g, '""');
  // Remove single-quoted strings
  out = out.replace(/'(?:\\.|[^'\\])*'/g, "''");
  return out;
}

async function checkFile(filename) {
  const filepath = join(srcDir, filename);
  const rawSrc = await readFile(filepath, "utf8");

  // Find all imports from RAW source (before stripping strings)
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

  const src = stripCommentsAndStrings(rawSrc);

  // Find all local definitions from RAW source (stripping can break patterns)
  const defined = new Set();
  const defRe = /(?:^|[;\s{}])\s*(?:export\s+)?(?:const|let|var|function|class)\s+(\w+)/gm;
  while ((m = defRe.exec(rawSrc)) !== null) {
    defined.add(m[1]);
  }

  const isAvailable = (name) =>
    KNOWN_GLOBALS.has(name) || imported.has(name) || defined.has(name);

  // Pattern 1: JSX component usage <ComponentName
  // Only PascalCase, not preceded by dot (method) or part of closing tag
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
  // These are the exact crash signatures from 2026-10-07
  const movedHelpers = [
    "cbMotionOff",
    "__cbMotionCache",
    "cbMotionCacheSet",
  ];
  for (const name of movedHelpers) {
    // Look for usage as function call or reference
    const usageRe = new RegExp(`(?<![.\\w$])${name.replace(/_/g, "_")}(?=\\s*\\(|\\s*[;,)\\]}])`, "g");
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
