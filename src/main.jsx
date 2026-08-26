import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createRoot } from "react-dom/client";

/* ════════════════════════════════════════════════════════════════
   CEREBRUM v4.0 — "DARKNODE"
   
   Design language: Deep space observatory. Not a chatbot — a 
   research instrument that happens to understand language.
   
   Typography: Cormorant Garamond for display (editorial serif,
   high contrast, reads as institutional authority), Inter for 
   body (proven readability at small sizes), JetBrains Mono for 
   data/metadata (instrument readout precision).
   
   Layout: Left-aligned editorial grid. Massive whitespace. The 
   content breathes. Headlines run large. The search bar is a 
   command line, not a friendly input. Results read like a premium 
   research brief — you'd print this.
   
   Color: Deep navy foundation (#070b14). Surfaces are slightly 
   lifted with blue-tinted glass. Accent is used only for 
   citations, active states, and the search ring. Everything else
   is monochrome with blue undertones.
   
   Motion: No bouncy springs, no particle clouds. Everything fades
   in with slight upward drift and blur-to-focus. Smooth, slow, 
   intentional — like instruments warming up.
   ════════════════════════════════════════════════════════════════ */

function setCookie(k, v) { try { document.cookie = `${k}=${encodeURIComponent(v)}; path=/; max-age=31536000; SameSite=Lax`; } catch {} }
// Loads OpenDyslexic on demand rather than on every page view — see the
// dyslexia-font toggle in Settings and loadFonts() further down.
function ensureDyslexicFont() {
  if (typeof document === "undefined" || document.getElementById("cb-dyslexic-font")) return;
  const df = document.createElement("link");
  df.id = "cb-dyslexic-font"; df.rel = "stylesheet";
  df.href = "https://fonts.cdnfonts.com/css/opendyslexic";
  document.head.appendChild(df);
}
function getCookie(k) { try { const m = document.cookie.match(new RegExp("(?:^|; )" + k + "=([^;]*)")); return m ? decodeURIComponent(m[1]) : null; } catch { return null; } }

// Single source of truth for the version shown in the footer and Settings.
// Previously these two spots (plus package.json) had each drifted to a
// different number independently — a user could see three different
// version strings in one sitting. One constant, everything else reads it.
const APP_VERSION = "5.0.0";

// ── Account API — thin wrappers around /api/auth and /api/data. Both
// endpoints are same-origin (Cloudflare Pages Functions served from the same
// domain as the static site), so the browser sends the session cookie
// automatically with no extra fetch options needed — no client ever handles
// the raw session token, only the server does.
async function apiAuth(action, payload) {
  const res = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...payload }) });
  // A real backend error still comes back as JSON with an `error` field, so
  // that's the case a plain "Something went wrong" fallback is for. But if
  // this route isn't actually deployed as a Cloudflare Pages Function (the
  // wrong file location, or a missing functions/lib/auth.js import breaking
  // just this one function's build), Cloudflare's static-asset layer catches
  // the request instead: POST comes back 405 with an empty body, GET comes
  // back 200 with the SPA's own index.html. Either way `res.json()` throws
  // on non-JSON content, which the old `.catch(() => ({}))` silently
  // swallowed into an empty object — so this exact "the endpoint doesn't
  // exist" case always surfaced as the same unhelpful "Something went wrong.
  // Please try again," indistinguishable from a real validation error and
  // impossible to tell apart from the outside. Checking the content-type
  // up front separates the two and says which one actually happened.
  const isJson = (res.headers.get("content-type") || "").includes("json");
  const data = isJson ? await res.json().catch(() => ({})) : {};
  if (!res.ok) {
    if (!isJson) throw new Error("Couldn't reach the account service right now — it may not be deployed yet. Try again shortly, or contact support if this keeps happening.");
    throw new Error(data.error || "Something went wrong. Please try again.");
  }
  return data;
}
async function apiWhoAmI() {
  try {
    const res = await fetch("/api/auth");
    if (!res.ok) return null;
    const data = await res.json();
    return data.user || null;
  } catch { return null; }
}
async function apiDataGet(resource) {
  try {
    const res = await fetch(`/api/data?resource=${resource}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}
async function apiDataPost(resource, payload) {
  const res = await fetch("/api/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resource, ...payload }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");
const MOD = IS_MAC ? "⌘" : "Ctrl";
const kbdLabel = (key) => `${MOD}${IS_MAC ? "" : "+"}${key}`;

// v5: this used to lean hard on internet-meme references (a SpongeBob line,
// a Kanye ad-lib, Zelda, Portal, gamer "achievement unlocked" copy) that
// clash with the "research instrument, not a chatbot" tone the rest of the
// product is going for — and age badly fast, the way memes do. Kept the
// jokes that are actually about the work (peer review, Reviewer 2, p-values,
// Bonferroni) and cut everything that was just a meme wearing a lab coat.
const LOADING_MESSAGES = [
  "It's not a bug, it's peer review",
  "Downloading more RAM for science",
  "He who controls the citations controls the universe",
  "Bribing PubMed with a warm cookie",
  "Convincing OpenAlex you're not a robot",
  "Asking arXiv to please hurry up",
  "Explaining to bioRxiv what a preprint is",
  "Negotiating with Reviewer 2",
  "Reviewer 2 says reject. Ignoring Reviewer 2",
  "Waiting on revisions since 2019",
  "Politely declining to read the supplementary material",
  "Pretending to understand the methods section",
  "Skipping straight to the figures like everyone does",
  "Checking if the p-value is load-bearing",
  "Counting how many times they wrote 'novel'",
  "Looking for the one paper everyone cites but nobody read",
  "Determining whether 'further research is needed'",
  "Spoiler: further research is needed",
  "Finding the paper that contradicts the last paper",
  "Locating the ethics board",
  "Feeding the graduate students",
  "The grad students have been fed",
  "Emailing the corresponding author (no reply expected)",
  "Requesting the dataset. Author has left academia",
  "Untangling a 400-author collaboration",
  "Deciding if the abstract oversold it (it did)",
  "Consulting the ghost of Carl Sagan",
  "Sagan says: billions and billions of results",
  "Sharpening Occam's razor",
  "Applying Occam's razor. Ouch",
  "Dividing by n-1 out of respect",
  "Correcting for multiple comparisons, reluctantly",
  "Bonferroni is coming for your p-values",
  "Confirming: mitochondria, still the powerhouse",
  "Checking if it's lupus. It's never lupus",
  "Trust me, I'm a language model",
  "Making the little numbers go up",
  "Reading the paper so you don't have to",
  "Pretending I know what phenology means",
  "Googling 'phenology'. Don't tell anyone",
  "Consulting fourteen databases simultaneously, showing off",
  "Arguing with a bibliography",
  "The bibliography won",
];

const SUGGESTION_POOL = [
  // Biology & Genetics
  "How does CRISPR-Cas9 achieve target specificity?",
  "What causes antibiotic resistance to spread between species?",
  "How do prions propagate protein misfolding?",
  "Mechanisms of epigenetic inheritance across generations",
  "How does the gut microbiome influence brain function?",
  "What drives protein phase separation in cells?",
  "How do CAR-T cells recognize and kill tumors?",
  "Why do some species regenerate limbs and others cannot?",
  // Medicine & Neuroscience
  "How does mRNA vaccine technology work?",
  "Mechanisms of long COVID and persistent symptoms",
  "How do psychedelics rewire neural circuits?",
  "What causes Alzheimer's amyloid plaques to form?",
  "How does immunotherapy checkpoint inhibition work?",
  "Neural mechanisms of general anesthesia",
  "How do opioids hijack the brain's reward system?",
  "What triggers autoimmune diseases?",
  // Chemistry & Materials
  "Why is the SN2 reaction stereospecific?",
  "How do enzymes lower activation energy?",
  "Mechanism of lithium-ion battery degradation",
  "How do metallic glasses form without crystallization?",
  "What makes graphene such an exceptional conductor?",
  "How does photocatalytic water splitting work?",
  // Physics & Astronomy
  "What is dark matter and how do we detect it?",
  "How do quantum computers achieve entanglement?",
  "What causes high-temperature superconductivity?",
  "How do gravitational waves distort spacetime?",
  "Mechanism of Hawking radiation from black holes",
  "How does nuclear fusion sustain a star?",
  "What evidence supports the multiverse hypothesis?",
  // Earth & Environmental Science
  "How does ocean acidification affect marine ecosystems?",
  "What triggers mass extinction events?",
  "How do tectonic plates drive continental drift?",
  "Mechanisms of rapid Arctic ice sheet collapse",
  "How do volcanoes influence global climate?",
  "What causes harmful algal blooms to form?",
  // Computer Science & AI
  "How do transformer neural networks process language?",
  "What is the halting problem and why is it unsolvable?",
  "How does homomorphic encryption enable secure computation?",
  "Mechanisms of reinforcement learning from human feedback",
  "How do generative adversarial networks create images?",
  "What makes P vs NP the most important open problem?",
  // Psychology & Social Science
  "How does chronic stress alter brain structure?",
  "What causes the placebo effect at a molecular level?",
  "How does sleep consolidate memory?",
  "Neural basis of consciousness and subjective experience",
  "How do mirror neurons enable empathy?",
  // Ecology & Evolution
  "How does natural selection drive speciation?",
  "What caused the Cambrian explosion of life?",
  "How do extremophiles survive in boiling acid?",
  "Mechanisms of convergent evolution across distant species",
];
function pick(n = 4) {
  const a = [...SUGGESTION_POOL];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}


function host(url) { try { return new URL(url).hostname.replace("www.", ""); } catch { return ""; } }
function toRIS(sources) {
  return sources.map((s) => {
    const authors = (s.authors || "").split(/,| and /).map((a) => a.trim()).filter(Boolean);
    const lines = ["TY  - JOUR"];
    authors.forEach((a) => lines.push(`AU  - ${a}`));
    if (s.title) lines.push(`TI  - ${s.title}`);
    if (s.journal) lines.push(`JO  - ${s.journal}`);
    if (s.year) lines.push(`PY  - ${s.year}`);
    if (s.url) lines.push(`UR  - ${s.url}`);
    lines.push("ER  - ");
    return lines.join("\n");
  }).join("\n");
}
function toBibTeX(sources) {
  return sources.map((s, i) => {
    const fields = [];
    if (s.authors) fields.push(`  author = {${s.authors}}`);
    if (s.title) fields.push(`  title = {${s.title}}`);
    if (s.journal) fields.push(`  journal = {${s.journal}}`);
    if (s.year) fields.push(`  year = {${s.year}}`);
    if (s.url) fields.push(`  url = {${s.url}}`);
    return `@article{cerebrum${s.year || ""}_${i + 1},\n${fields.join(",\n")}\n}`;
  }).join("\n\n");
}
function download(fn, text) { const blob = new Blob([text], { type: "text/plain" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = fn; a.click(); URL.revokeObjectURL(a.href); }
async function saveToZotero(sources, apiKey, userId) {
  const items = sources.map((s) => ({ itemType: "journalArticle", title: s.title || "", creators: (s.authors || "").split(/,| and /).map((a) => a.trim()).filter(Boolean).map((name) => ({ creatorType: "author", name })), publicationTitle: s.journal || "", date: String(s.year || ""), url: s.url || "" }));
  const res = await fetch(`https://api.zotero.org/users/${userId}/items`, { method: "POST", headers: { "Zotero-API-Key": apiKey, "Content-Type": "application/json" }, body: JSON.stringify(items) });
  if (!res.ok) throw new Error(`Zotero ${res.status}`);
  return res.json();
}
// Paper metadata (title, authors, journal) comes from external scholarly APIs
// — several of which (Zenodo, DOAJ, CORE, BASE, OpenAIRE) index self-deposited
// records with no HTML sanitization on the backend. Any of those fields can
// contain raw markup. This MUST be applied before anything derived from them
// is passed to dangerouslySetInnerHTML, or a maliciously-titled "paper" could
// run arbitrary script in every visitor's browser on this origin.
function escapeHtml(str) {
  return String(str == null ? "" : str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// Identity key for a source used across dedup / save / pin state. Was
// `(s.title || "").toLowerCase()` in half a dozen places — when two distinct
// sources both lack a title (not uncommon: some Zenodo/CORE/BASE records
// have no title field), they collapse to the same key "". That meant the
// second untitled source silently disappeared from dedup (bug), and toggling
// save/pin on one untitled source affected every other untitled source's
// state (bug). Falling back to `url` before giving up keeps two different
// untitled papers distinct in the overwhelmingly common case where they at
// least have different URLs.
function sourceKey(s) {
  return ((s && (s.title || s.url)) || "").toLowerCase().trim();
}

// Only allow http(s) URLs into href/target=_blank. Paper URLs come from
// external, self-deposited scholarly metadata (Zenodo, DOAJ, CORE, BASE,
// OpenAIRE) with no guarantee they're sane — a "javascript:" or "data:" URL
// in that field would execute when clicked. Defense in depth alongside the
// HTML-escaping fix in BibEntry.
function safeHref(url) {
  const u = (url || "").trim();
  return /^https?:\/\//i.test(u) ? u : "#";
}

function formatCitation(source, style, index) {
  const s = source || {};
  const authors = s.authors || "";
  const title = s.title || "Untitled";
  const journal = s.journal || "";
  const year = s.year || "n.d.";
  const url = s.url || "";
  switch (style) {
    case "vancouver": {
      const parts = [`${index}. ${authors ? authors + ". " : ""}${title}.`];
      if (journal) parts.push(` ${journal}.`);
      parts.push(` ${year}.`);
      return parts.join("");
    }
    case "apa": {
      return `${authors ? authors + ". " : ""}(${year}). ${title}. ${journal ? "*" + journal + "*." : ""}`.trim();
    }
    case "mla": {
      return `${authors ? authors + ". " : ""}"${title}." *${journal || "n.p."}*, ${year}${url ? ", " + url : ""}.`;
    }
    case "chicago": {
      return `${authors ? authors + ". " : ""}${year}. "${title}." *${journal || "n.p."}*.`;
    }
    case "bibtex": {
      // Bug: this built the key from `year`, which defaults to the literal
      // string "n.d." above, producing a malformed key like "cerebrumn.d._1"
      // (periods aren't valid in a BibTeX citekey). The OTHER BibTeX
      // generator in this file, toBibTeX() above, already gets this right —
      // `cerebrum${s.year || ""}_${i+1}` — so the two exports disagreed for
      // any undated source. Match that convention here.
      const key = "cerebrum" + (s.year || "") + "_" + index;
      const fields = [];
      if (authors) fields.push(`  author = {${authors}}`);
      if (title) fields.push(`  title = {${title}}`);
      if (journal) fields.push(`  journal = {${journal}}`);
      if (year && year !== "n.d.") fields.push(`  year = {${year}}`);
      if (url) fields.push(`  url = {${url}}`);
      return `@article{${key},\n${fields.join(",\n")}\n}`;
    }
    default:
      return `${index}. ${authors} ${title}. ${journal} ${year}.`;
  }
}

function formatBibliography(sources, style) {
  return sources
    .map((s, i) => formatCitation(s, style, i + 1))
    .join(style === "bibtex" ? "\n\n" : "\n\n");
}

const Audio = (() => {
  let ctx = null, ambient = null, lfoTimer = null;
  function ac() { if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { ctx = null; } } return ctx; }
  function tone(freq, dur, vol) { const c = ac(); if (!c) return; const o = c.createOscillator(), g = c.createGain(); o.type = "sine"; o.frequency.value = freq; g.gain.setValueAtTime(0.0001, c.currentTime); g.gain.exponentialRampToValueAtTime(vol, c.currentTime + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur); o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + dur + 0.02); }
  function click() { tone(660, 0.08, 0.045); }
  function pop() { tone(880, 0.06, 0.04); }
  function startAmbient(mode = "pulse") {
    const c = ac(); if (!c || ambient) return;
    if (mode === "minimal") { tone(523.25, 0.5, 0.05); return; }
    const now = c.currentTime;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.connect(c.destination);
    const oscs = [];
    if (mode === "shimmer") {
      const o = c.createOscillator(), o2 = c.createOscillator();
      o.type = "sine"; o.frequency.value = 587.33; o2.type = "sine"; o2.frequency.value = 880;
      const lfo = c.createOscillator(), lfoG = c.createGain();
      lfo.frequency.value = 0.25; lfoG.gain.value = 6; lfo.connect(lfoG); lfoG.connect(o.detune); lfo.start();
      o.connect(g); o2.connect(g); o.start(); o2.start(); oscs.push(o, o2, lfo);
      g.gain.exponentialRampToValueAtTime(0.02, now + 0.6);
    } else if (mode === "warm") {
      const f = [98, 146.83, 196];
      f.forEach((freq) => { const o = c.createOscillator(); o.type = "sine"; o.frequency.value = freq; o.connect(g); o.start(); oscs.push(o); });
      g.gain.exponentialRampToValueAtTime(0.024, now + 0.5);
    } else {
      const o = c.createOscillator(), o2 = c.createOscillator();
      o.type = "sine"; o.frequency.value = 110; o2.type = "sine"; o2.frequency.value = 164.81;
      o.connect(g); o2.connect(g); o.start(); o2.start(); oscs.push(o, o2);
      let up = true;
      g.gain.exponentialRampToValueAtTime(0.03, now + 0.8);
      lfoTimer = setInterval(() => {
        if (!ctx) return;
        const t = ctx.currentTime;
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(g.gain.value, t);
        g.gain.exponentialRampToValueAtTime(up ? 0.012 : 0.032, t + 1.4);
        up = !up;
      }, 1400);
    }
    ambient = { g, oscs };
  }
  function stopAmbient() {
    if (lfoTimer) { clearInterval(lfoTimer); lfoTimer = null; }
    if (!ambient || !ctx) return;
    const { g, oscs } = ambient;
    try { g.gain.cancelScheduledValues(ctx.currentTime); g.gain.setValueAtTime(g.gain.value, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4); oscs.forEach((o) => { try { o.stop(ctx.currentTime + 0.45); } catch {} }); } catch {}
    ambient = null;
  }
  function preview(mode) { startAmbient(mode); setTimeout(stopAmbient, 1400); }
  return { click, pop, startAmbient, stopAmbient, preview };
})();


/* ════════════════════════════════════════════════════════════════
   DESIGN SYSTEM v4 — "DARKNODE"
   
   Three palettes, all dark-first. Light exists but the app is 
   designed dark. Deep navy foundations, blue-tinted glass, 
   editorial serif headings.
   ════════════════════════════════════════════════════════════════ */

const PALETTES = {
  // Bug: all three themes' `faint` color failed WCAG AA contrast against
  // their own `bg` (Dark 2.87:1, Mid 2.57:1, Light 2.44:1 — all below even
  // the 3:1 large-text floor, let alone the 4.5:1 normal-text floor), yet
  // it's used at 10-12px throughout: byline text, footer/copyright, "N min
  // read" labels, timestamps, source metadata. Adjusted each to the closest
  // value on the same hue that clears 4.5:1.
  Dark:  { dark: true,  bg: "#050816", surface: "#0c1222", raised: "#131c30", ink: "#f0f2f8", ink2: "#94a0b8", faint: "#7688a5", line: "rgba(148,160,184,0.07)", line2: "rgba(148,160,184,0.12)", shadow: "0 2px 4px rgba(0,0,0,0.4), 0 16px 56px rgba(0,0,0,0.5)", shadowSm: "0 1px 3px rgba(0,0,0,0.5)", grain: 0.01, skel: "linear-gradient(90deg, #0c1222 25%, #131c30 50%, #0c1222 75%)" },
  Mid:   { dark: true,  bg: "#0a0d15", surface: "#111827", raised: "#1f2937", ink: "#f3f4f6", ink2: "#9ca3af", faint: "#78818c", line: "rgba(156,163,175,0.08)", line2: "rgba(156,163,175,0.13)", shadow: "0 2px 4px rgba(0,0,0,0.4), 0 16px 56px rgba(0,0,0,0.5)", shadowSm: "0 1px 3px rgba(0,0,0,0.4)", grain: 0.014, skel: "linear-gradient(90deg, #111827 25%, #1f2937 50%, #111827 75%)" },
  Light: { dark: false, bg: "#f8f9fc", surface: "#ffffff", raised: "#ffffff", ink: "#0f172a", ink2: "#475569", faint: "#5c6b80", line: "rgba(15,23,42,0.06)", line2: "rgba(15,23,42,0.10)", shadow: "0 1px 2px rgba(0,0,0,0.04), 0 8px 32px rgba(0,0,0,0.07)", shadowSm: "0 1px 2px rgba(0,0,0,0.05)", grain: 0.006, skel: "linear-gradient(90deg, #f1f5f9 25%, #f8fafc 50%, #f1f5f9 75%)" },
};
const ACCENTS = { Emerald: "#34d399", Indigo: "#818cf8", Sky: "#38bdf8", Amber: "#fbbf24", Rose: "#fb7185", Violet: "#a78bfa", Teal: "#2dd4bf", Cyan: "#22d3ee" };

// The brand wordmark's animated gradient deliberately cycles through a
// hand-picked SUBSET of ACCENTS in a hue-ordered sequence (not declaration
// order, not all 8 — Teal/Cyan were left out as too close to Sky/Emerald
// for a clean 6-stop wheel) rather than the user's single selected accent —
// a "living brand" treatment independent of theme choice. Built from named
// ACCENTS references (not copy-pasted hex) so editing one accent's hex
// can't silently desync the two CSS rules that used to hardcode this same
// six-color list separately (`.cb-kinetic > span` and `.cb-gradient-text`).
const BRAND_GRADIENT_STOPS = [ACCENTS.Emerald, ACCENTS.Sky, ACCENTS.Indigo, ACCENTS.Violet, ACCENTS.Rose, ACCENTS.Amber, ACCENTS.Emerald].join(", ");

// v5: status semantics (fact-check verdicts, retraction flags, relevance
// tiers, correction markers) had drifted to three different "warning amber"
// hexes and two different "success green" hexes across the file, hand-typed
// independently over several rounds of edits. These are meant to read as
// fixed, theme-independent signal colors — the same way a traffic light
// doesn't change color when you repaint the car — so they're intentionally
// NOT derived from the user's chosen accent. One definition, referenced
// everywhere a status color is needed.
const STATUS = { good: "#10b981", warn: "#d9a520", bad: "#e5484d" };

function accentText(hex) {
  if (!hex || hex[0] !== "#" || hex.length < 7) return "#111";
  const r = parseInt(hex.slice(1, 3), 16),
        g = parseInt(hex.slice(3, 5), 16),
        b = parseInt(hex.slice(5, 7), 16);
  const L = (0.299 * r + 0.587 * g + 0.114 * b);
  return L > 175 ? "#0f172a" : "#fff";
}
function withAlpha(hex, a) { const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16); return `rgba(${r},${g},${b},${a})`; }

// Rotates a hex color's hue by `deg` degrees, keeping its own saturation/
// lightness — used to derive a second, related-but-distinct color from a
// single accent (e.g. LivingBackground's two-stop fallback gradient) so a
// two-tone effect doesn't collapse to one flat color for every accent.
function hueShift(hex, deg) {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let h, s;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  h = (h + deg / 360) % 1;
  if (h < 0) h += 1;
  const hue2rgb = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
  let nr, ng, nb;
  if (s === 0) { nr = ng = nb = l; }
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    nr = hue2rgb(p, q, h + 1 / 3); ng = hue2rgb(p, q, h); nb = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = (v) => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${toHex(nr)}${toHex(ng)}${toHex(nb)}`;
}

// Shared "de-chromed" <select> treatment — Settings' own Picker already
// suppressed the native OS dropdown arrow in favor of a custom SVG chevron
// that matches the rest of the glass/editorial aesthetic, but every OTHER
// <select> in the app (voice picker, citation style, move-to-collection,
// Compare's thread pickers) kept the browser's default chrome, which on
// most platforms renders as a plain gray system-font triangle sitting
// inside an otherwise fully custom dark-glass control. Spread this into
// any <select>'s style object (after its own border/background/padding)
// to give it the same chevron everywhere, themed to the current palette
// instead of one hardcoded gray.
function selectChrome(P) {
  const arrow = P.dark ? "9ca3af" : "6b7280";
  return {
    WebkitAppearance: "none",
    appearance: "none",
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23${arrow}'/%3E%3C/svg%3E")`,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "right 10px center",
    paddingRight: 28,
  };
}

/* ════════════════════════════════════════════════════════════════
   ICON SYSTEM — Thinner weight (1.4) for the dark aesthetic
   ════════════════════════════════════════════════════════════════ */
function Icon({ name, size = 17, className, style }) {
  const common = {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round",
    strokeLinejoin: "round", className, style,
    "aria-hidden": true, focusable: false,
  };
  switch (name) {
    case "plus": return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
    case "bookmark": return <svg {...common}><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" /></svg>;
    case "bookmarkFilled": return <svg {...common} fill="currentColor" stroke="none"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" /></svg>;
    case "settings": return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>;
    case "volumeOn": return <svg {...common}><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13" /></svg>;
    case "volumeOff": return <svg {...common}><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M22 9l-6 6M16 9l6 6" /></svg>;
    case "search": return <svg {...common}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.2-4.2" /></svg>;
    case "close": return <svg {...common}><path d="M18 6L6 18M6 6l12 12" /></svg>;
    case "arrowRight": return <svg {...common}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
    case "mic": return <svg {...common}><path d="M12 15a3 3 0 003-3V6a3 3 0 00-6 0v6a3 3 0 003 3z" /><path d="M5 12a7 7 0 0014 0M12 19v3" /></svg>;
    case "check": return <svg {...common}><path d="M20 6L9 17l-5-5" /></svg>;
    case "external": return <svg {...common}><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><path d="M15 3h6v6M10 14L21 3" /></svg>;
    case "chevronDown": return <svg {...common}><path d="M6 9l6 6 6-6" /></svg>;
    case "sparkle": return <svg {...common}><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8L12 2z" /></svg>;
    case "history": return <svg {...common}><path d="M3 12a9 9 0 109-9 9 9 0 00-9 9z" /><path d="M12 7v5l3 3" /><path d="M3 3v6h6" /><path d="M3 9a9 9 0 011.5-3.5" /></svg>;
    case "image": return <svg {...common}><rect x="3" y="3" width="18" height="18" rx="2.5" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>;
    case "pin": return <svg {...common}><path d="M12 21s-7-7.7-7-12.3A7 7 0 0119 8.7C19 13.3 12 21 12 21z" /><circle cx="12" cy="8.7" r="2.4" /></svg>;
    case "pinFilled": return <svg {...common} fill="currentColor" stroke="none"><path d="M12 21s-7-7.7-7-12.3A7 7 0 0119 8.7C19 13.3 12 21 12 21zm0-10a2.4 2.4 0 100-4.8 2.4 2.4 0 000 4.8z" /></svg>;
    case "warning": return <svg {...common}><path d="M12 3.5L21.5 20H2.5L12 3.5z" /><path d="M12 10v4M12 16.7h.01" /></svg>;
    case "edit": return <svg {...common}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>;
    case "link": return <svg {...common}><path d="M9.5 14.5l5-5" /><path d="M13.5 6l1.3-1.3a3.6 3.6 0 015 5L18.5 11" /><path d="M10.5 18l-1.3 1.3a3.6 3.6 0 01-5-5L5.5 13" /></svg>;
    case "chart": return <svg {...common}><path d="M3 3v18h18" /><path d="M7 17v-5M12 17V8M17 17v-9" /></svg>;
    case "shield": return <svg {...common}><path d="M12 2.5l8 3.2v5.8c0 5.2-3.4 8.9-8 10.3-4.6-1.4-8-5.1-8-10.3V5.7z" /></svg>;
    case "brain": return <svg {...common}><circle cx="12" cy="5.2" r="1.9" /><circle cx="5.7" cy="16" r="1.9" /><circle cx="18.3" cy="16" r="1.9" /><path d="M12 7.1v3.3M12 10.4L7.1 14.4M12 10.4l4.9 4" /></svg>;
    case "partial": return <svg {...common}><path d="M4 13c1.6-2.6 3.2-2.6 4.8 0s3.2 2.6 4.8 0 3.2-2.6 4.8 0" /></svg>;
    case "printer": return <svg {...common}><path d="M6 9V3h12v6" /><rect x="4" y="9" width="16" height="8" rx="1.5" /><path d="M6 17v4h12v-4" /></svg>;
    case "user": return <svg {...common}><circle cx="12" cy="8" r="3.5" /><path d="M4.5 20.5a7.5 7.5 0 0115 0" /></svg>;
    case "folder": return <svg {...common}><path d="M3 6.5A1.5 1.5 0 014.5 5h4.5l2 2.5H19.5A1.5 1.5 0 0121 9v9a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 18z" /></svg>;
    case "compare": return <svg {...common}><rect x="3" y="4" width="8" height="16" rx="1.5" /><rect x="13" y="4" width="8" height="16" rx="1.5" /></svg>;
    case "network": return <svg {...common}><circle cx="12" cy="4.5" r="2" /><circle cx="5" cy="18" r="2" /><circle cx="19" cy="18" r="2" /><path d="M12 6.5v5M12 11.5L6.3 16.3M12 11.5l5.7 4.8" /></svg>;
    case "refresh": return <svg {...common}><path d="M21 12a9 9 0 01-15.3 6.4M3 12a9 9 0 0115.3-6.4" /><path d="M21 4v6h-6M3 20v-6h6" /></svg>;
    case "wand": return <svg {...common}><path d="M4 20L18 6" /><path d="M15 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1z" /><path d="M6 15l.6 1.4L8 17l-1.4.6L6 19l-.6-1.4L4 17l1.4-.6z" /></svg>;
    case "timeline": return <svg {...common}><path d="M3 12h18" /><circle cx="6" cy="12" r="1.8" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" /><circle cx="18" cy="12" r="1.8" fill="currentColor" stroke="none" /></svg>;
    default: return null;
  }
}

function Mark({ size = 26, accent, glow }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ filter: glow ? `drop-shadow(0 0 12px ${withAlpha(accent, 0.5)})` : "none" }}>
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1 0-4.12A2.5 2.5 0 0 1 7.5 11a2.5 2.5 0 0 1 0-4.12A2.5 2.5 0 0 1 9.5 2Z" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 0-4.12A2.5 2.5 0 0 0 16.5 11a2.5 2.5 0 0 0 0-4.12A2.5 2.5 0 0 0 14.5 2Z" />
    </svg>
  );
}

function useTypewriter(full, on) {
  const [out, setOut] = useState(on ? "" : full);
  useEffect(() => {
    if (!on) { setOut(full); return; }
    setOut(""); let i = 0; const step = Math.max(2, Math.round(full.length / 240));
    const id = setInterval(() => { i += step; setOut(full.slice(0, i)); if (i >= full.length) { setOut(full); clearInterval(id); } }, 12);
    return () => clearInterval(id);
  }, [full, on]);
  return out;
}

function renderAnswer(text, sources, P, accent, hoverCite, setHoverCite) {
  let clean = (text || "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\[(\d+)\]\((?:https?:\/\/|#)[^\s)]+\)/g, "[$1]")
    // Split grouped citations "[1, 2]" or "[1,2]" into individual "[1][2]"
    .replace(/\[([\d,\s]+)\]/g, (m, nums) => {
      const ds = nums.split(/[,\s]+/).map(n => parseInt(n,10)).filter(n => n > 0 && n <= (sources||[]).length);
      return ds.length ? ds.map(n => "["+n+"]").join("") : m;
    })
    .replace(/\(([\d,\s]+)\)/g, (m, nums) => {
      const ds = nums.split(/[,\s]+/).map(n => parseInt(n,10)).filter(n => n > 0 && n <= (sources||[]).length);
      return ds.length ? ds.map(n => "["+n+"]").join("") : m;
    })
    .replace(/([a-z])\s+(\d(?:\s*,?\s*\d){0,8})\s*([.;,])(?!\d)/gi, (m, b, nums, p) => {
      const ds = nums.split(/[,\s]+/).map(n => parseInt(n,10)).filter(n => n > 0 && n <= (sources||[]).length);
      return ds.length >= 1 ? b + " " + ds.map(n => "["+n+"]").join("") + p : m;
    })
    .replace(/\n[-—]{2,}\s*\n/g, "\n\n")
    .replace(/\n\s*(references|sources|bibliography|citations|works cited)\s*:?\s*\n[\s\S]*$/i, "")
    .trim();

  return clean.split(/\n{2,}/).map((para, pi) => {
    // Markdown headers
    const h2 = para.match(/^##\s+(.+)$/);
    if (h2) return <h3 key={pi} style={{ fontSize: 20, fontWeight: 700, color: accent, margin: "36px 0 12px", letterSpacing: "-0.015em", fontFamily: "var(--cb-display)", borderBottom: `1px solid ${P.line}`, paddingBottom: 12, lineHeight: 1.3 }}>{h2[1]}</h3>;
    const h3 = para.match(/^###\s+(.+)$/);
    if (h3) return <h4 key={pi} style={{ fontSize: 17, fontWeight: 600, color: P.ink, margin: "28px 0 10px", letterSpacing: "-0.01em", fontFamily: "var(--cb-display)", lineHeight: 1.3 }}>{h3[1]}</h4>;
    // Bold-line headers (e.g., "**Mechanism**")
    const boldHeader = para.match(/^\*\*([^*]+)\*\*\s*$/);
    if (boldHeader) return <h4 key={pi} style={{ fontSize: 17, fontWeight: 700, color: accent, margin: "30px 0 10px", letterSpacing: "-0.01em", fontFamily: "var(--cb-display)", lineHeight: 1.3 }}>{boldHeader[1]}</h4>;

    // Bullet lists: lines starting with "- " or "• "
    const bulletMatch = para.match(/^(?:[•\-]\s+.+\n?)+$/m);
    if (bulletMatch) {
      const items = para.split("\n").filter(l => /^[•\-]\s+/.test(l)).map(l => l.replace(/^[•\-]\s+/, ""));
      return (
        <ul key={pi} style={{ margin: "0 0 20px", paddingLeft: 24, listStyle: "none" }}>
          {items.map((item, ii) => (
            <li key={ii} style={{ fontSize: 16.5, lineHeight: 1.8, color: P.ink, marginBottom: 8, position: "relative", paddingLeft: 12, fontFamily: "var(--cb-body)", fontWeight: 400 }}>
              <span style={{ position: "absolute", left: -12, top: "0.55em", width: 5, height: 5, borderRadius: "50%", background: accent, opacity: 0.7 }} />
              {renderInlineSegments(item, sources, P, accent, hoverCite, setHoverCite)}
            </li>
          ))}
        </ul>
      );
    }

    // Numbered lists: lines starting with "1. ", "2. ", etc.
    const numberedMatch = para.match(/^(?:\d+\.\s+.+\n?)+$/m);
    if (numberedMatch) {
      const items = para.split("\n").filter(l => /^\d+\.\s+/.test(l)).map(l => l.replace(/^\d+\.\s+/, ""));
      return (
        <ol key={pi} style={{ margin: "0 0 20px", paddingLeft: 24, listStyle: "none", counterReset: "cb-list" }}>
          {items.map((item, ii) => (
            <li key={ii} style={{ fontSize: 16.5, lineHeight: 1.8, color: P.ink, marginBottom: 8, position: "relative", paddingLeft: 16, fontFamily: "var(--cb-body)", fontWeight: 400, counterIncrement: "cb-list" }}>
              <span style={{ position: "absolute", left: -8, top: 0, fontSize: 12, fontWeight: 700, color: accent, fontFamily: "var(--cb-mono)", opacity: 0.8 }}>{ii + 1}.</span>
              {renderInlineSegments(item, sources, P, accent, hoverCite, setHoverCite)}
            </li>
          ))}
        </ol>
      );
    }

    return (
    <p key={pi} style={{ fontSize: 17.5, lineHeight: 1.85, margin: "0 0 20px", color: P.ink, letterSpacing: "-0.008em", fontFamily: "var(--cb-body)", fontWeight: 400 }}>
      {para.split("\n").map((line, li) => (
        <React.Fragment key={li}>
          {renderInlineSegments(line, sources, P, accent, hoverCite, setHoverCite)}
          {li < para.split("\n").length - 1 && <br />}
        </React.Fragment>
      ))}
    </p>
    );
  });
}

/** Inline segment renderer — handles bold, italic, underline, citations, and inline code */
function renderInlineSegments(line, sources, P, accent, hoverCite, setHoverCite) {
  return line.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`|\[\d+\])/g).map((seg, si) => {
    const b = seg.match(/^\*\*([^*]+)\*\*$/);
    if (b) return <strong key={si} style={{ color: P.ink, fontWeight: 700 }}>{b[1]}</strong>;
    const it = seg.match(/^\*([^*\n]+)\*$/);
    if (it) return <em key={si} style={{ fontStyle: "italic", color: P.ink }}>{it[1]}</em>;
    const ul = seg.match(/^_([^_\n]+)_$/);
    if (ul) return <em key={si} style={{ fontStyle: "italic", color: P.ink }}>{ul[1]}</em>;
    // Inline code backticks
    const code = seg.match(/^`([^`\n]+)`$/);
    if (code) return <code key={si} style={{ fontSize: "0.88em", fontFamily: "var(--cb-mono)", background: P.dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)", padding: "2px 6px", borderRadius: 4, color: accent }}>{code[1]}</code>;
    const c = seg.match(/^\[(\d+)\]$/);
    if (c) {
      const n = parseInt(c[1], 10); const src = (sources || [])[n - 1];
      return <a key={si} href={`#ref-${n}`} title={src?.title || ""} onMouseEnter={() => setHoverCite(n)} onMouseLeave={() => setHoverCite(0)}
        onClick={(e) => {
          e.preventDefault();
          const el = document.getElementById(`ref-${n}`);
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            el.style.transition = "background 0.3s";
            el.style.background = withAlpha(accent, 0.15);
            setTimeout(() => { el.style.background = "transparent"; }, 1400);
          }
        }}
        style={{
          fontSize: 10, verticalAlign: "super", color: accent,
          textDecoration: "none", fontWeight: 700,
          fontFamily: "var(--cb-mono)",
          padding: "1px 5px", borderRadius: 4,
          background: hoverCite === n ? withAlpha(accent, 0.16) : withAlpha(accent, 0.08),
          transition: "background 0.15s ease", cursor: "pointer",
        }}>{n}</a>;
    }
    return <span key={si}>{seg}</span>;
  });
}


/* ============================================================
   FACT CHECK, SKELETON, LOADING — redesigned visuals, same logic
   ============================================================ */
function FactCheck({ fc, P, accent }) {
  const colors = { supported: STATUS.good, partly: STATUS.warn, unsupported: STATUS.bad, thin: STATUS.warn };
  const label = { supported: "Supported by sources", partly: "Partly supported", unsupported: "Not supported by sources" };
  const oc = colors[fc.overall] || P.ink2;
  const claims = fc.claims || [];
  const nSup = claims.filter((c) => c.status === "supported").length;
  const nThin = claims.filter((c) => c.status === "thin").length;
  const nUns = claims.filter((c) => c.status === "unsupported").length;
  const total = claims.length;
  const score = total ? Math.round(((nSup + nThin * 0.5) / total) * 100) : null;
  const scoreColor = score === null ? P.ink2 : score >= 75 ? STATUS.good : score >= 45 ? STATUS.warn : STATUS.bad;
  return (
    <div style={{ marginTop: 20, border: `1px solid ${P.line2}`, borderRadius: 14, background: P.surface, padding: "20px 22px" }} className="cb-rise">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: oc, flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.02em", color: oc, fontFamily: "var(--cb-mono)", textTransform: "uppercase" }}>{label[fc.overall] || fc.overall}</span>
        <span style={{ fontSize: 11, color: P.faint, marginLeft: "auto", fontFamily: "var(--cb-mono)" }}>vs. cited abstracts</span>
      </div>
      {score !== null && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 32, fontWeight: 700, color: scoreColor, letterSpacing: "-0.03em", fontFamily: "var(--cb-display)" }}>{score}<span style={{ fontSize: 16, fontWeight: 500, opacity: 0.7 }}>%</span></span>
            <span style={{ fontSize: 12, color: P.ink2, fontWeight: 500 }}>source alignment</span>
          </div>
          <div style={{ display: "flex", height: 4, borderRadius: 2, overflow: "hidden", background: P.line, gap: 1 }}>
            {nSup > 0 && <div style={{ flex: nSup, background: STATUS.good, borderRadius: 2 }} title={`${nSup} supported`} />}
            {nThin > 0 && <div style={{ flex: nThin, background: STATUS.warn, borderRadius: 2 }} title={`${nThin} thin`} />}
            {nUns > 0 && <div style={{ flex: nUns, background: STATUS.bad, borderRadius: 2 }} title={`${nUns} unsupported`} />}
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 8, fontFamily: "var(--cb-mono)", fontSize: 10.5, color: P.faint }}>
            <span>{nSup} solid</span><span>{nThin} thin</span><span>{nUns} unsupported</span>
          </div>
        </div>
      )}
      {fc.summary && <div style={{ fontSize: 14, color: P.ink2, marginBottom: claims.length ? 14 : 0, lineHeight: 1.6, paddingTop: score !== null ? 14 : 0, borderTop: score !== null ? `1px solid ${P.line}` : "none" }}>{fc.summary}</div>}
      {claims.map((c, i) => {
        const cc = colors[c.status] || P.ink2;
        const iconName = c.status === "supported" ? "check" : c.status === "thin" ? "partial" : "close";
        return (
          <div key={i} style={{ display: "flex", gap: 12, padding: "10px 0", borderTop: i ? `1px solid ${P.line}` : "none" }}>
            <span style={{ color: cc, flexShrink: 0, width: 18, height: 18, borderRadius: 6, background: withAlpha(cc, 0.1), display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}><Icon name={iconName} size={11} /></span>
            <div><div style={{ fontSize: 13.5, color: P.ink, lineHeight: 1.5 }}>{c.claim}</div>{c.note && <div style={{ fontSize: 12, color: P.faint, marginTop: 3, lineHeight: 1.5 }}>{c.note}</div>}</div>
          </div>
        );
      })}
    </div>
  );
}

function Skeleton({ P, accent }) {
  const bar = (w, h = 12, delay = 0) => (
    <div style={{
      height: h, width: w, borderRadius: 6,
      background: `linear-gradient(90deg, ${P.skel} 25%, ${P.dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)"} 50%, ${P.skel} 75%)`,
      backgroundSize: "200% 100%",
      animation: `cbShimmer 1.8s ease-in-out ${delay}ms infinite`,
    }} />
  );
  return (
    <div style={{
      background: P.dark ? "rgba(5,8,22,0.7)" : "rgba(255,255,255,0.7)",
      backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
      border: P.dark ? "1px solid rgba(255,255,255,0.06)" : `1px solid ${P.line}`,
      borderRadius: 18, padding: "32px 34px",
      display: "flex", flexDirection: "column", gap: 14,
    }}>
      {/* Simulated header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        {bar("80px", 18, 0)}
        {bar("50px", 18, 100)}
      </div>
      {/* Simulated paragraph */}
      {bar("95%", 13, 150)}
      {bar("100%", 13, 250)}
      {bar("88%", 13, 350)}
      <div style={{ height: 6 }} />
      {bar("92%", 13, 450)}
      {bar("76%", 13, 550)}
    </div>
  );
}

function useIsMobile() {
  const [m, setM] = useState(typeof window !== "undefined" ? window.innerWidth < 900 : false);
  useEffect(() => { const onR = () => setM(window.innerWidth < 900); window.addEventListener("resize", onR); return () => window.removeEventListener("resize", onR); }, []);
  return m;
}

function LoadingLine({ P, accent, S }) {
  const [msg, setMsg] = useState(() => LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)]);
  const [stage, setStage] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  // v5: these used to be raw emoji (🔍🔗📊🛡🧠✍) dropped into an otherwise
  // fully custom monochrome stroke-icon interface — they'd render as
  // completely different glyphs per OS/browser and visually clash with
  // every other icon on the page. Now they reference the same Icon system
  // as the header, buttons, and everything else.
  const STAGES = [
    { label: "Querying 14 indexes", icon: "search" },
    { label: "Merging and de-duplicating", icon: "link" },
    { label: "Scoring evidence quality", icon: "chart" },
    { label: "Checking for retractions", icon: "shield" },
    { label: "Cerebrum Intelligence reasoning", icon: "brain" },
    { label: "Writing the answer", icon: "edit" },
  ];
  useEffect(() => {
    const msgId = setInterval(() => {
      setMsg((prev) => {
        let next = prev;
        while (next === prev && LOADING_MESSAGES.length > 1) {
          next = LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)];
        }
        return next;
      });
    }, 2600);
    const stageId = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 1900);
    const clockId = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => { clearInterval(msgId); clearInterval(stageId); clearInterval(clockId); };
  }, []);

  const progress = Math.min(100, ((stage + 1) / STAGES.length) * 100);

  return (
    <div style={{ padding: "20px 0 4px" }}>
      {/* Progress bar */}
      <div style={{ height: 3, borderRadius: 2, background: P.line, overflow: "hidden", marginBottom: 18 }}>
        <div style={{
          height: "100%", borderRadius: 2,
          background: `linear-gradient(90deg, ${accent}, ${withAlpha(accent, 0.6)})`,
          width: progress + "%",
          transition: "width 800ms cubic-bezier(0.16,1,0.3,1)",
        }} />
      </div>
      {/* Synapse loader + fun message */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }} aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span key={i} style={{
              width: 6, height: 6, borderRadius: "50%",
              background: accent,
              animation: `cbSynapse 1.25s ${i * 0.18}s cubic-bezier(0.4, 0, 0.6, 1) infinite`,
            }} />
          ))}
        </div>
        <span key={msg} className="cb-fade" style={{ fontSize: 13.5, color: P.ink2, letterSpacing: "-0.01em", fontWeight: 500, fontFamily: "var(--cb-body)", flex: 1 }}>
          {msg}
        </span>
        <span style={{ fontSize: 10, color: P.faint, fontFamily: "var(--cb-mono)", flexShrink: 0 }}>
          {elapsed}s
        </span>
      </div>
      {/* Stage steps */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingLeft: 1 }}>
        {STAGES.map((s, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: 10,
            opacity: i <= stage ? 1 : 0.35,
            transition: "opacity 400ms ease",
          }}>
            <span style={{
              width: 18, height: 18, borderRadius: 5,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 10,
              background: i < stage ? withAlpha(accent, 0.12) : i === stage ? withAlpha(accent, 0.2) : "transparent",
              color: i <= stage ? accent : P.faint,
              fontWeight: 700, fontFamily: "var(--cb-mono)",
              border: i === stage ? `1px solid ${withAlpha(accent, 0.3)}` : "1px solid transparent",
              transition: "all 400ms ease",
            }}>
              {i < stage ? <Icon name="check" size={10} /> : i === stage ? <Icon name={s.icon} size={10} /> : "·"}
            </span>
            <span style={{
              fontSize: 11.5,
              color: i === stage ? P.ink : i < stage ? P.ink2 : P.faint,
              fontFamily: "var(--cb-mono)", letterSpacing: "0.01em",
              fontWeight: i === stage ? 600 : 400,
              transition: "color 400ms ease, font-weight 400ms ease",
            }}>
              {s.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   CINEMATIC BRAIN INTRO — preserved canvas logic entirely, 
   redesigned surrounding UI
   ============================================================ */

/* ════════════════════════════════════════════════════════════════
   INTRO v4 — DARKNODE-STYLE CINEMATIC LANDING
   
   Always dark. WebGL particle field background. Staggered text 
   reveal with blur-to-focus. No neural canvas, no cheap animations.
   Two CTAs: "Start exploring" and "How it works."
   ════════════════════════════════════════════════════════════════ */

// Global script loader — deduplicates across components
const _loadedScripts = new Set();
function loadCDN(src) {
  return new Promise((resolve, reject) => {
    if (_loadedScripts.has(src) || document.querySelector(`script[src="${src}"]`)) {
      _loadedScripts.add(src);
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = src; s.async = true;
    s.onload = () => { _loadedScripts.add(src); resolve(); };
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// Load all Vanta dependencies once
let _vantaReady = null;
function ensureVanta() {
  if (_vantaReady) return _vantaReady;
  _vantaReady = loadCDN("https://cdnjs.cloudflare.com/ajax/libs/three.js/r134/three.min.js")
    .then(() => Promise.all([
      loadCDN("https://cdn.jsdelivr.net/npm/vanta@latest/dist/vanta.net.min.js"),
      loadCDN("https://cdn.jsdelivr.net/npm/vanta@latest/dist/vanta.fog.min.js"),
      loadCDN("https://cdn.jsdelivr.net/npm/vanta@latest/dist/vanta.cells.min.js"),
      loadCDN("https://cdn.jsdelivr.net/npm/vanta@latest/dist/vanta.halo.min.js"),
    ]))
    .catch(() => { _vantaReady = null; });
  return _vantaReady;
}


/* ════════════════════════════════════════════════════════════════
   INTRO v4.1 — Vanta.js CELLS background
   Loads Three.js + Vanta from CDN. Dark, immersive, cinematic.
   ════════════════════════════════════════════════════════════════ */
function Intro({ accent, P, onEnter, animationMode = "cinematic" }) {
  const vantaRef = useRef(null);
  const vantaEffect = useRef(null);
  const [revealed, setRevealed] = useState(false);
  const [ready, setReady] = useState(false);
  const isMobile = useIsMobile();

  // Load Three.js + Vanta from CDN and init CELLS
  useEffect(() => {
    if (animationMode === "off") { setRevealed(true); setReady(true); return; }

    function initVanta() {
      if (!window.VANTA || !window.THREE || !vantaRef.current) return;
      try {
        // Parse accent to hex int
        const hex = accent.replace("#", "");
        const c1 = parseInt(hex, 16);
        // Darker complement
        const r = Math.max(0, parseInt(hex.slice(0,2),16) - 80);
        const g = Math.max(0, parseInt(hex.slice(2,4),16) - 80);
        const b = Math.max(0, parseInt(hex.slice(4,6),16) - 80);
        const c2 = (r << 16) | (g << 8) | b;

        vantaEffect.current = window.VANTA.CELLS({
          el: vantaRef.current,
          THREE: window.THREE,
          mouseControls: true,
          touchControls: true,
          gyroControls: false,
          minHeight: 200,
          minWidth: 200,
          scale: 1.0,
          color1: c1,
          color2: c2 || 0x0a0e1a,
          size: isMobile ? 0.8 : 0.5,
          speed: 1.5,
          backgroundColor: 0x050816,
        });
      } catch (e) { console.warn("Vanta init failed:", e); }
    }

    // Load Vanta via shared loader
    ensureVanta().then(() => { setTimeout(initVanta, 50); }).catch(() => {});

    return () => { if (vantaEffect.current) { try { vantaEffect.current.destroy(); } catch {} } };
  }, [accent, animationMode, isMobile]);

  useEffect(() => {
    const t1 = setTimeout(() => setRevealed(true), 400);
    const t2 = setTimeout(() => setReady(true), 900);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  const go = () => {
    if (animationMode === "off") { onEnter(); return; }
    const el = document.getElementById("cb-intro-wrap");
    if (el) { el.style.transition = "opacity 0.6s ease, filter 0.6s ease"; el.style.opacity = "0"; el.style.filter = "blur(8px)"; }
    setTimeout(() => onEnter(), 650);
  };

  return (
    <div id="cb-intro-wrap" style={{
      minHeight: "100dvh", display: "flex", flexDirection: "column",
      background: "#050816", position: "relative", overflow: "hidden",
      fontFamily: "var(--cb-body)",
    }}>
      {/* Vanta background container */}
      <div ref={vantaRef} className="cb-vanta-host" style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none" }} />

      {/* Dark overlay for readability */}
      <div style={{
        position: "absolute", inset: 0, zIndex: 1,
        background: "linear-gradient(135deg, rgba(5,9,16,0.7) 0%, rgba(5,9,16,0.3) 50%, rgba(5,9,16,0.5) 100%)",
        pointerEvents: "none",
      }} />

      {/* Nav */}
      <nav style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: isMobile ? "16px 20px" : "20px 40px",
        position: "relative", zIndex: 3,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Mark size={20} accent={accent} glow />
          <span style={{ fontSize: 16, fontWeight: 600, color: "#e8edf5", letterSpacing: "-0.02em" }}>Cerebrum</span>
        </div>
        <div style={{ display: "flex", gap: isMobile ? 16 : 28 }}>
          {["About", "Privacy", "Contact"].map((item) => (
            <a key={item} href={`/${item.toLowerCase()}`} style={{ fontSize: 13, color: "#6b7a90", textDecoration: "none", fontWeight: 500, transition: "color 0.2s" }}
              onMouseEnter={(e) => e.target.style.color = "#e8edf5"} onMouseLeave={(e) => e.target.style.color = "#6b7a90"}>{item}</a>
          ))}
        </div>
      </nav>

      {/* Hero content */}
      <main style={{
        flex: 1, display: "flex", flexDirection: "column", justifyContent: "center",
        padding: isMobile ? "0 24px 60px" : "0 clamp(48px, 8vw, 140px) 80px",
        position: "relative", zIndex: 3, maxWidth: 820,
      }}>
        <div style={{
          marginBottom: 32,
          opacity: revealed ? 1 : 0, transform: revealed ? "none" : "translateY(12px)",
          filter: revealed ? "blur(0)" : "blur(6px)",
          transition: "all 0.8s cubic-bezier(0.16, 1, 0.3, 1)",
        }}>
          <Mark size={36} accent={accent} glow />
        </div>

        <h1 style={{
          fontSize: isMobile ? 38 : "clamp(52px, 6.5vw, 76px)",
          fontWeight: 300, letterSpacing: "-0.04em", lineHeight: 1.08,
          color: "#e8edf5", margin: "0 0 28px",
          fontFamily: "var(--cb-display)",
          opacity: revealed ? 1 : 0, transform: revealed ? "none" : "translateY(24px)",
          filter: revealed ? "blur(0)" : "blur(10px)",
          transition: "all 1.1s cubic-bezier(0.16, 1, 0.3, 1) 0.15s",
        }}>
          Ask anything.<br />
          <span style={{ fontWeight: 700, color: accent }}>We'll find the paper.</span>
        </h1>

        <p style={{
          fontSize: isMobile ? 15 : 17, color: "#7a8599", lineHeight: 1.65,
          margin: "0 0 44px", maxWidth: 460, fontWeight: 400,
          opacity: revealed ? 1 : 0, transform: revealed ? "none" : "translateY(16px)",
          filter: revealed ? "blur(0)" : "blur(6px)",
          transition: "all 0.9s cubic-bezier(0.16, 1, 0.3, 1) 0.35s",
        }}>
          Cerebrum searches 14 scholarly databases in parallel and writes you
          an answer where every claim traces back to a real, citable source —
          then lets you compare investigations, map how sources relate,
          trace a literature across time, and see a concept illustrated.
          One research instrument, not just a chatbot.
        </p>

        <div style={{
          display: "flex", flexWrap: "wrap", gap: "7px 18px", marginBottom: 32,
          opacity: revealed ? 0.6 : 0, transition: "opacity 1s cubic-bezier(0.16, 1, 0.3, 1) 0.5s",
        }}>
          {["Cited answers", "Compare investigations", "Source network", "Literature timeline", "AI illustrations"].map((f) => (
            <span key={f} style={{ fontSize: 11, fontWeight: 600, color: "#7a8599", letterSpacing: "0.04em", fontFamily: "var(--cb-mono)" }}>{f}</span>
          ))}
        </div>

        <div style={{
          display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
          opacity: ready ? 1 : 0, transform: ready ? "none" : "translateY(12px)",
          filter: ready ? "blur(0)" : "blur(4px)",
          transition: "all 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.1s",
        }}>
          <button onClick={go} className="cb-glow-btn" style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "15px 32px", fontSize: 15, fontWeight: 600,
            background: accent, color: accentText(accent),
            border: "none", borderRadius: 12, cursor: "pointer",
            fontFamily: "var(--cb-body)",
            boxShadow: `0 4px 28px ${withAlpha(accent, 0.4)}`,
          }}>
            Start exploring
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h13M12 5.5l6.5 6.5-6.5 6.5"/></svg>
          </button>

          <button onClick={() => window.location.href = "/about"} style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "15px 20px", fontSize: 14, fontWeight: 500,
            background: "transparent", color: "#7a8599", border: "none",
            cursor: "pointer", fontFamily: "var(--cb-body)",
          }} onMouseEnter={(e) => e.target.style.color = "#e8edf5"} onMouseLeave={(e) => e.target.style.color = "#7a8599"}>
            How it works →
          </button>
        </div>
      </main>

      {/* Bottom database strip */}
      <div style={{
        padding: isMobile ? "0 24px 24px" : "0 48px 36px",
        position: "relative", zIndex: 3,
        display: "flex", flexWrap: "wrap", gap: isMobile ? "6px 16px" : "6px 28px",
        opacity: ready ? 0.35 : 0, transition: "opacity 1.5s ease 0.6s",
      }}>
        {["PubMed", "Europe PMC", "OpenAlex", "Semantic Scholar", "CORE", "arXiv"].map((d) => (
          <span key={d} style={{ fontSize: 10, fontWeight: 500, color: "#6b7a90", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "var(--cb-mono)" }}>{d}</span>
        ))}
        {/* Bug: said "+10" after 6 named databases (implying 16 total) —
            the real backend fanout queries 14. See matching fix in the
            trustRow strip elsewhere in this file. */}
        <span style={{ fontSize: 10, color: "#3d4a5c", fontFamily: "var(--cb-mono)", letterSpacing: "0.1em" }}>+8</span>
      </div>
    </div>
  );
}


/* ════════════════════════════════════════════════════════════════
   LIVING BACKGROUND v4 — Vanta.js powered
   
   Replaces 700 lines of hand-rolled canvas with CDN-hosted 
   Three.js + Vanta.js. Loads NET for dark themes (connected 
   nodes, premium depth), FOG for light themes (soft ambient).
   Mouse-reactive, GPU-accelerated, zero maintenance.
   ════════════════════════════════════════════════════════════════ */
function LivingBackground({ accent, P, intensity = "cinematic", preset = "particles", density = 1, speed = 1, opacity = 1, paused = false }) {
  const containerRef = useRef(null);
  const effectRef = useRef(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    ensureVanta().then(() => setLoaded(true)).catch((e) => console.warn("Vanta load failed:", e));
  }, []);

  useEffect(() => {
    if (!loaded || !containerRef.current || !window.THREE) return;
    // Destroy previous
    if (effectRef.current) { try { effectRef.current.destroy(); } catch {} effectRef.current = null; }

    const hex = accent.replace("#", "");
    const accentInt = parseInt(hex, 16);
    const el = containerRef.current;

    try {
      if (P.dark && window.VANTA && window.VANTA.HALO) {
        // Dark mode: HALO — soft glow, premium, never competes with content
        effectRef.current = window.VANTA.HALO({
          el,
          THREE: window.THREE,
          // v6.4: mouse/touch camera controls were on for a purely decorative,
          // pointer-events:none background. Vanta's touch controls bind their
          // own touchstart/touchmove listeners (independent of CSS
          // pointer-events) to interpret drag/pinch gestures as camera
          // movement, which competes with the browser's native pinch-zoom and
          // the page's own touch-scroll — a well-documented class of Vanta.js
          // bug where scrolling "locks up" after a pinch gesture. This
          // background isn't meant to be touched or dragged, so disable all
          // pointer-driven camera control entirely.
          mouseControls: false,
          touchControls: false,
          gyroControls: false,
          minHeight: 200, minWidth: 200,
          backgroundColor: 0x050816,
          baseColor: accentInt,
          size: 1.5,
          amplitudeFactor: 0.8,
          speed: speed * 0.4,
          xOffset: 0.1,
          yOffset: 0.05,
        });
      } else if (P.dark && window.VANTA && window.VANTA.NET) {
        // Fallback: NET at very low density
        effectRef.current = window.VANTA.NET({
          el, THREE: window.THREE,
          mouseControls: false, touchControls: false, gyroControls: false, // see HALO note above
          minHeight: 200, minWidth: 200, scale: 1.0, scaleMobile: 1.0,
          color: accentInt,
          backgroundColor: 0x050816,
          points: 3, maxDistance: 18, spacing: 25, showDots: true,
          speed: speed * 0.3,
        });
      } else if (!P.dark && window.VANTA && window.VANTA.NET) {
        // Light mode: NET barely visible
        effectRef.current = window.VANTA.NET({
          el, THREE: window.THREE,
          mouseControls: false, touchControls: false, gyroControls: false, // see HALO note above
          minHeight: 200, minWidth: 200, scale: 1.0, scaleMobile: 1.0,
          color: accentInt,
          backgroundColor: parseInt(P.bg.replace("#",""), 16) || 0xf8f9fc,
          points: 3, maxDistance: 16, spacing: 28, showDots: true,
          speed: speed * 0.3,
        });
      }
    } catch (e) { console.warn("Vanta bg failed:", e); }

    return () => { if (effectRef.current) { try { effectRef.current.destroy(); } catch {} effectRef.current = null; } };
  }, [loaded, accent, P.dark, P.bg, density, speed]);

  // Pause/resume
  useEffect(() => {
    if (!effectRef.current) return;
    if (paused) { try { effectRef.current.setOptions({ speed: 0 }); } catch {} }
    else { try { effectRef.current.setOptions({ speed: speed * (P.dark ? 0.8 : 0.6) }); } catch {} }
  }, [paused, speed, P.dark]);

  // v6.4 perf: this is a continuously-rendering WebGL scene running behind
  // the entire app. Previously it only paused while the settings panel was
  // open — it kept burning GPU/CPU (and mobile battery) at full tilt even
  // while the browser tab was minimized or in a background tab, which the
  // user never sees. Pause it whenever the tab isn't visible and resume at
  // its normal speed when it comes back.
  useEffect(() => {
    const onVis = () => {
      if (!effectRef.current) return;
      try {
        if (document.hidden) effectRef.current.setOptions({ speed: 0 });
        else if (!paused) effectRef.current.setOptions({ speed: speed * (P.dark ? 0.8 : 0.6) });
      } catch {}
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [paused, speed, P.dark]);

  return (
    <div ref={containerRef} className="cb-vanta-host" style={{
      position: "fixed", inset: 0, width: "100%", height: "100%",
      pointerEvents: "none", zIndex: 0,
      opacity: intensity === "subtle" ? 0.08 : 0.15,
      transition: "opacity 0.5s ease",
      /* CSS fallback gradient — visible while Vanta loads or if it fails.
         Built from the user's actual selected `accent` (a Rose/Amber/Cyan
         user used to see a hardcoded green-and-indigo flash here regardless
         of their choice, since Vanta itself already reads `accent` — see
         above — but this fallback never did) plus a second stop offset a
         third of the way around the hue wheel so the two radial pools
         still read as two distinct colors rather than one flat wash. */
      background: loaded ? "transparent" : (P.dark
        ? `radial-gradient(ellipse at 30% 20%, ${withAlpha(accent, 0.07)} 0%, transparent 50%), radial-gradient(ellipse at 70% 80%, ${withAlpha(hueShift(accent, 60), 0.05)} 0%, transparent 50%), ${P.bg}`
        : P.bg),
    }} aria-hidden="true" />
  );
}


/* ════════════════════════════════════════════════════════════════
   UPGRADE 1: CUSTOM BLEND-MODE CURSOR
   
   Hides the default cursor. Renders a glowing dot with a trailing 
   ring that expands + inverts over actionable elements via 
   mix-blend-mode: difference. Pure React, no dependencies.
   ════════════════════════════════════════════════════════════════ */


/* ════════════════════════════════════════════════════════════════
   UPGRADE 3: MOUSE-TRACKING GLOW BORDER
   
   Wraps the search bar. Renders a radial glow that follows the 
   mouse X/Y along the border. Creates a localized light source.
   ════════════════════════════════════════════════════════════════ */

// v5: this was named "kinetic" but was actually a static span — a leftover
// label from an earlier version of the hero that never got the per-letter
// motion the name promises. Now it actually is: each character enters on
// its own staggered delay (same technique as .cb-stagger elsewhere in this
// file), so the wordmark assembles itself rather than just fading in as one
// block. Falls back to the plain gradient text for anything screen readers
// or copy/paste care about — the stagger is purely decorative markup.
function KineticText({ text, style, className }) {
  return (
    <span className={`cb-gradient-text cb-kinetic ${className || ""}`} style={{ ...style, display: "inline-block" }} aria-label={text}>
      {text.split("").map((ch, i) => (
        <span key={i} style={{ animationDelay: `${i * 45}ms` }} aria-hidden="true">{ch === " " ? " " : ch}</span>
      ))}
    </span>
  );
}


/* ════════════════════════════════════════════════════════════════
   UPGRADE 5: WEBGL PARTICLE FIELD
   
   Raw WebGL (no Three.js dependency). Renders a 3D particle field 
   with mouse-reactive raycasting, bloom glow via multi-pass 
   rendering, and depth-of-field blur. Particles scatter from 
   cursor and reform magnetically. Replaces the 2D canvas 
   LivingBackground on capable devices.
   ════════════════════════════════════════════════════════════════ */
function MicButton({ onTranscript, accent, P }) {
  const [supported, setSupported] = useState(true);
  const [listening, setListening] = useState(false);
  const recRef = useRef(null);
  const cbRef = useRef(onTranscript);
  cbRef.current = onTranscript;
  const wantListenRef = useRef(false);
  const finalTextRef = useRef("");
  const beep = (freq, dur = 0.08, gain = 0.05) => { try { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; const ctx = new AC(); const osc = ctx.createOscillator(); const g = ctx.createGain(); osc.type = "sine"; osc.frequency.value = freq; g.gain.value = 0; osc.connect(g); g.connect(ctx.destination); const now = ctx.currentTime; g.gain.linearRampToValueAtTime(gain, now + 0.01); g.gain.linearRampToValueAtTime(0, now + dur); osc.start(now); osc.stop(now + dur + 0.02); setTimeout(() => { try { ctx.close(); } catch {} }, (dur + 0.1) * 1000); } catch {} };
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setSupported(false); return; }
    const rec = new SR(); rec.continuous = true; rec.interimResults = true; rec.lang = navigator.language || "en-US";
    rec.onresult = (e) => { let interim = ""; for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) { finalTextRef.current = (finalTextRef.current + " " + t).replace(/\s+/g, " ").trim(); } else { interim += t; } } const combined = (finalTextRef.current + (interim ? " " + interim : "")).replace(/\s+/g, " ").trim(); cbRef.current(combined, false); };
    rec.onerror = (e) => { const err = e && e.error; if (err === "no-speech" || err === "aborted") return; if (err === "not-allowed" || err === "service-not-allowed") { wantListenRef.current = false; setListening(false); } };
    rec.onend = () => { if (wantListenRef.current) { try { rec.start(); } catch { wantListenRef.current = false; setListening(false); } } else { setListening(false); } };
    recRef.current = rec;
    return () => { wantListenRef.current = false; try { rec.abort(); } catch {} };
  }, []);
  if (!supported) return null;
  const toggle = () => {
    if (!recRef.current) return;
    if (listening) { wantListenRef.current = false; try { recRef.current.stop(); } catch {} setListening(false); cbRef.current(finalTextRef.current.trim(), true); beep(660, 0.09); setTimeout(() => beep(440, 0.11), 90); }
    else { finalTextRef.current = ""; wantListenRef.current = true; try { recRef.current.start(); setListening(true); beep(523, 0.07); setTimeout(() => beep(784, 0.09), 70); } catch { wantListenRef.current = false; setListening(false); } }
  };
  return (
    <button onClick={toggle} title={listening ? "Stop dictation" : "Start voice dictation"} className="cb-hbtn"
      style={{ width: 34, height: 34, borderRadius: 8, border: "none", cursor: "pointer", background: listening ? accent : "transparent", color: listening ? "#fff" : P.faint, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, position: "relative" }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 15a3 3 0 003-3V6a3 3 0 00-6 0v6a3 3 0 003 3z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><path d="M5 12a7 7 0 0014 0M12 19v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      {listening && <span style={{ position: "absolute", inset: -4, borderRadius: 12, border: `2px solid ${accent}`, animation: "cbMicPulse 1.5s ease-in-out infinite", pointerEvents: "none" }} />}
    </button>
  );
}

/* ============================================================
   ANSWER PLAYER (TTS) — logic preserved
   ============================================================ */
function AnswerPlayer({ text, accent, P }) {
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const audioRef = useRef(null);
  const utterRef = useRef(null);
  const [useElevenLabs, setUseElevenLabs] = useState(false);
  useEffect(() => { try { setUseElevenLabs(!!localStorage.getItem("cb_eleven_key")); } catch {} }, []);
  const stop = () => { if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; } try { window.speechSynthesis.cancel(); } catch {} utterRef.current = null; setStatus("idle"); setProgress(0); };
  const playBrowser = () => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.0; utter.pitch = 1.0;
    const voices = window.speechSynthesis.getVoices();
    // Bug: this ignored the user's saved Male/Female preference
    // (`cb_tts_voice`, set via TtsVoiceSetting and honored by
    // playCerebrum()'s backend call) entirely — if the backend TTS call or
    // ElevenLabs failed and this browser fallback engaged, the chosen voice
    // was silently dropped for a fixed, gender-blind name guess.
    let voicePref = "";
    try { voicePref = localStorage.getItem("cb_tts_voice") || ""; } catch {}
    const femaleNames = /Samantha|Karen|Victoria|Female/i;
    const maleNames = /Alex|Daniel|David|Fred|Male/i;
    const genderRe = voicePref === "male" ? maleNames : voicePref === "female" ? femaleNames : null;
    const pref =
      (genderRe && voices.find((v) => genderRe.test(v.name) && /en/i.test(v.lang))) ||
      voices.find((v) => /Google.*(US|English)|Samantha|Alex|Karen|Daniel/i.test(v.name)) ||
      voices.find((v) => /en/i.test(v.lang));
    if (pref) utter.voice = pref;
    utter.onstart = () => setStatus("playing"); utter.onend = () => { setStatus("idle"); setProgress(0); }; utter.onerror = () => { setStatus("idle"); setProgress(0); }; utter.onboundary = (e) => { if (e.charIndex && text.length) setProgress(e.charIndex / text.length); }; utterRef.current = utter; window.speechSynthesis.speak(utter);
  };
  const playEleven = async () => {
    // Bug: unlike the sibling playCerebrum() below (which wraps its
    // localStorage read in try/catch), these two reads were unguarded.
    // localStorage.getItem can throw (private browsing in older Safari,
    // storage disabled by the user/policy, a sandboxed iframe without the
    // allow-same-origin flag) — that would blow up the click handler before
    // ever reaching playBrowser()'s fallback, silently doing nothing instead
    // of degrading gracefully like every other storage read in this file.
    let key = "", voiceId = "21m00Tcm4TlvDq8ikWAM";
    try {
      key = localStorage.getItem("cb_eleven_key") || "";
      voiceId = localStorage.getItem("cb_eleven_voice") || voiceId;
    } catch {}
    if (!key) return playBrowser(); setStatus("loading"); try { const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, { method: "POST", headers: { "xi-api-key": key, "Content-Type": "application/json" }, body: JSON.stringify({ text, model_id: "eleven_flash_v2_5", voice_settings: { stability: 0.5, similarity_boost: 0.75 } }) }); if (!res.ok) throw new Error("ElevenLabs error " + res.status); const blob = await res.blob(); const url = URL.createObjectURL(blob); const audio = new Audio(url); audioRef.current = audio; audio.ontimeupdate = () => { if (audio.duration) setProgress(audio.currentTime / audio.duration); }; audio.onended = () => { setStatus("idle"); setProgress(0); URL.revokeObjectURL(url); audioRef.current = null; }; audio.onerror = () => { setStatus("idle"); playBrowser(); }; await audio.play(); setStatus("playing"); } catch { playCerebrum(); } };
  const playCerebrum = async () => { setStatus("loading"); try { let voicePref = ""; try { voicePref = localStorage.getItem("cb_tts_voice") || ""; } catch {} const res = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, voice: voicePref }) }); if (!res.ok) throw new Error("TTS " + res.status); const ct = res.headers.get("content-type") || ""; if (!ct.startsWith("audio/")) throw new Error("Non-audio response"); const blob = await res.blob(); const url = URL.createObjectURL(blob); const audio = new Audio(url); audioRef.current = audio; audio.ontimeupdate = () => { if (audio.duration) setProgress(audio.currentTime / audio.duration); }; audio.onended = () => { setStatus("idle"); setProgress(0); URL.revokeObjectURL(url); audioRef.current = null; }; audio.onerror = () => { setStatus("idle"); playBrowser(); }; await audio.play(); setStatus("playing"); } catch { playBrowser(); } };
  const onClick = () => { if (status === "playing") { if (audioRef.current) { audioRef.current.pause(); setStatus("paused"); return; } try { window.speechSynthesis.pause(); setStatus("paused"); } catch {} return; } if (status === "paused") { if (audioRef.current) { audioRef.current.play(); setStatus("playing"); return; } try { window.speechSynthesis.resume(); setStatus("playing"); } catch {} return; } if (useElevenLabs) playEleven(); else playCerebrum(); };
  useEffect(() => () => stop(), []);
  const label = status === "loading" ? "Loading..." : status === "playing" ? "Pause" : status === "paused" ? "Resume" : "Listen";
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 12 }}>
      <button onClick={onClick} style={{ padding: "6px 14px", fontSize: 11.5, fontWeight: 600, background: status === "playing" || status === "paused" ? accent : "transparent", color: status === "playing" || status === "paused" ? accentText(accent) : P.ink2, border: `1px solid ${status === "playing" || status === "paused" ? accent : P.line2}`, borderRadius: 8, cursor: "pointer", fontFamily: "var(--cb-mono)", display: "inline-flex", alignItems: "center", gap: 6, letterSpacing: "0.01em" }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">{status === "playing" ? (<><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></>) : (<path d="M8 5v14l11-7z" />)}</svg>
        {label}
      </button>
      {(status === "playing" || status === "paused") && (
        <div style={{ width: 80, height: 2, background: P.line, borderRadius: 1, overflow: "hidden" }}>
          <div style={{ width: "100%", height: "100%", background: accent, transformOrigin: "left", transform: `scaleX(${progress})`, transition: "transform 0.15s ease" }} />
        </div>
      )}
      {(status === "playing" || status === "paused") && (
        <button onClick={stop} title="Stop" aria-label="Stop" style={{ background: "transparent", border: "none", cursor: "pointer", color: P.faint, padding: 2, display: "inline-flex" }}><Icon name="close" size={13} /></button>
      )}
    </div>
  );
}

function TtsVoiceSetting({ P, accent, at, S, sfx }) {
  const [voice, setVoice] = useState(() => { try { return localStorage.getItem("cb_tts_voice") || "female"; } catch { return "female"; } });
  const set = (v) => { setVoice(v); try { localStorage.setItem("cb_tts_voice", v); } catch {} sfx(); };
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
      {[["female", "Female"], ["male", "Male"]].map(([v, label]) => (
        <button key={v} onClick={() => set(v)} style={{ flex: 1, padding: "9px 6px", fontSize: 12, fontWeight: 600, background: voice === v ? accent : "transparent", color: voice === v ? at : P.ink2, border: `1px solid ${voice === v ? accent : P.line}`, borderRadius: 8, cursor: "pointer", fontFamily: "inherit" }}>{label}</button>
      ))}
    </div>
  );
}

function ElevenLabsSetting({ P, accent, at, S, sfx }) {
  const [key, setKey] = useState(() => { try { return localStorage.getItem("cb_eleven_key") || ""; } catch { return ""; } });
  const [voice, setVoice] = useState(() => { try { return localStorage.getItem("cb_eleven_voice") || "21m00Tcm4TlvDq8ikWAM"; } catch { return "21m00Tcm4TlvDq8ikWAM"; } });
  const [saved, setSaved] = useState(false);
  const voices = [ { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel (female, calm)" }, { id: "AZnzlk1XvdvUeBnXmlld", name: "Domi (female, strong)" }, { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella (female, soft)" }, { id: "ErXwobaYiN019PkySvjV", name: "Antoni (male, well-rounded)" }, { id: "MF3mGyEYCl7XYWbV9V6O", name: "Elli (female, emotional)" }, { id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh (male, deep)" }, { id: "VR6AewLTigWG4xSOukaG", name: "Arnold (male, crisp)" }, { id: "pNInz6obpgDQGcFmaJgB", name: "Adam (male, narration)" }, { id: "yoZ06aMxZJJ28mfd3POQ", name: "Sam (male, raspy)" } ];
  const save = () => { try { if (key.trim()) localStorage.setItem("cb_eleven_key", key.trim()); else localStorage.removeItem("cb_eleven_key"); localStorage.setItem("cb_eleven_voice", voice); } catch {} sfx(); setSaved(true); setTimeout(() => setSaved(false), 1500); };
  const clear = () => { setKey(""); try { localStorage.removeItem("cb_eleven_key"); } catch {} sfx(); };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <input type="password" aria-label="ElevenLabs API key" placeholder="ElevenLabs API key (optional)" value={key} onChange={(e) => setKey(e.target.value)} style={{ padding: "10px 12px", fontSize: 12.5, background: P.surface, color: P.ink, border: `1px solid ${P.line}`, borderRadius: 8, fontFamily: "inherit", outline: "none" }} />
      <select value={voice} onChange={(e) => setVoice(e.target.value)} style={{ padding: "10px 12px", fontSize: 12.5, background: P.surface, color: P.ink, border: `1px solid ${P.line}`, borderRadius: 8, fontFamily: "inherit", cursor: "pointer", outline: "none", ...selectChrome(P) }}>
        {voices.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select>
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={save} style={{ flex: 1, padding: "8px 12px", fontSize: 12, fontWeight: 600, background: accent, color: at, border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "inherit" }}>{saved ? "✓ Saved" : "Save"}</button>
        {key && <button onClick={clear} style={{ padding: "8px 12px", fontSize: 12, fontWeight: 500, background: "transparent", color: P.ink2, border: `1px solid ${P.line}`, borderRadius: 8, cursor: "pointer", fontFamily: "inherit" }}>Clear</button>}
      </div>
    </div>
  );
}

function looksLikeFollowupText(q) {
  if (!q) return false;
  const s = q.toLowerCase().trim();
  if (s.length < 8) return true;
  return /^(but|and|also|what about|how about|explain|tell me more|more on|also,|actually|wait|no,)/i.test(s)
      || /\b(you (forgot|missed)|the (paper|study|source|answer)|that (paper|study|source|answer)|this (paper|study))\b/i.test(s);
}
// REMOVED (this round): a global `useWheelScrollTakeover()` hook used to sit
// here, hand-rolling site-wide wheel scrolling by intercepting every wheel
// event on `window`, calling preventDefault() unconditionally, and manually
// replaying the delta via scrollBy(). It was built to work around a real but
// narrow old-Chromium compositor bug (position: sticky + backdrop-filter
// could create a wheel dead zone over the sticky header). Tracing this
// again after repeated "scroll is still buggy" reports across several
// rounds turned up the actual problem: this hand-rolled replacement never
// accounted for `e.deltaMode` — a wheel event's deltaY is only "pixels" when
// deltaMode is 0 (DOM_DELTA_PIXEL, what trackpads and most modern mice
// report). A traditional notched mouse wheel commonly reports deltaMode 1
// (DOM_DELTA_LINE), where deltaY is a small integer like 3 meaning "3 lines"
// — treating that as 3 pixels makes every scroll notch crawl instead of
// move a normal amount. That's a real, confirmed bug in the "fix" itself,
// global and permanent, independent of whatever the original sticky-header
// issue was — and it explains persistent "buggy everywhere" reports far
// better than a narrow compositor edge case ever could.
//
// Rather than patch the replacement further, it's deleted outright: native
// wheel/touch scrolling already handles deltaMode, momentum, scroll
// chaining into nested scrollable containers, and rubber-banding correctly
// by definition, for free. The actual sticky-header compositor issue this
// was built for is handled the standard way instead — giving the sticky
// header its own compositor layer via `transform: translateZ(0)` +
// `willChange: "transform"` (already present on both sticky headers below,
// see the `header`/`panel` style entries) — without touching scroll
// behavior at all. If a real dead zone ever reappears, fix the specific
// element (a compositor hint, or isolating it in its own stacking context),
// not global scroll again.

function InfoPage({ page }) {
  const paletteName = (() => { try { return getCookie("cb_palette") || "Dark"; } catch { return "Dark"; } })();
  const P = PALETTES[paletteName] || PALETTES.Dark;
  const accentName = (() => { try { return getCookie("cb_accent") || "Emerald"; } catch { return "Emerald"; } })();
  const customAccent = (() => { try { return getCookie("cb_accentCustom") || ""; } catch { return ""; } })();
  const accent = customAccent || ACCENTS[accentName] || ACCENTS.Emerald;
  const at = accentText(accent);
  const isMobile = useIsMobile();
  const goHome = () => { try { setCookie("cb_entered_v5", "1", 365); } catch {} window.location.href = "/"; };
  const PAGES = {
    about: { eyebrow: "About", title: "A research instrument, not a chatbot", lede: "A research instrument that searches real scholarly databases and gives you answers you can trace to the source.", blocks: [ { h: "What it does", p: "You ask a scientific question. Cerebrum queries a group of open scholarly databases in parallel, scores what comes back for genuine relevance, and writes a summary constrained by what those papers actually say. Every citation is a real DOI you can open and check." }, { h: "The databases", list: ["Europe PMC — 43M articles", "PubMed — 36M articles", "OpenAlex — 250M works", "Semantic Scholar — 220M papers", "Crossref — 150M works", "arXiv, bioRxiv — preprints", "DOAJ, PLOS, Zenodo — open access", "CORE, BASE, PMC full-text, OpenAIRE — additional aggregator/repository coverage"] }, { h: "The principle", p: "If no papers are retrieved for a question, Cerebrum says so plainly rather than inventing sources. A confident guess dressed up as science is worse than an honest 'nothing found.' That constraint is enforced mechanically, not just requested politely." }, { h: "What it is not", list: ["Not a substitute for reading the papers — every summary is AI-generated, so verify anything you'll rely on.", "Not a medical, legal, or financial advisor.", "Not tracked or monetized — no ads, no selling data, and an account (optional, only for syncing your saved articles and history) is never required to use it."] } ] },
    privacy: { eyebrow: "Privacy", title: "We collect as little as physically possible — and we can show our work", lede: "No tracking pixels. No third-party analytics. No ads. No selling data — there is nothing to sell. An account is entirely optional, and everything below is a specific, checkable claim, not a marketing line.", updated: "Last updated August 2026", blocks: [
      { h: "Guest mode (the default, no account needed)", list: ["No tracking pixels, third-party analytics, or ad networks, ever, account or not.", "Nothing about you is stored on Cerebrum's servers — not your questions, not an identifier, nothing.", "Saved articles, history, and preferences (theme, motion, voice) live only in your browser's local storage. Clear your browser data and they're gone — we never had a copy."] },
      { h: "What happens when you search (guest or signed in, identical either way)", list: ["Your question is sent to Cerebrum's server to run the search and generate an answer — this one round trip is unavoidable for the product to work at all.", "Search terms are forwarded to scholarly APIs (Europe PMC, PubMed, OpenAlex, and others) to retrieve papers.", "The question and retrieved abstracts are sent to a language-model provider (OpenRouter, Cloudflare Workers AI, or Pollinations) to write the summary.", "Your IP is visible to Cloudflare for rate limiting and abuse prevention — standard for any web request, not something Cerebrum adds on top.", "We do not permanently store your question text on the server unless you're signed in and it becomes part of your own account's history (see below)."] },
      { h: "If you create an account (optional — here's exactly what changes)", p: "Signing in exists for one reason: so your saved articles, collections, and history follow you to another device instead of being trapped in one browser. Creating an account stores your email, and either a password hash or nothing at all if you only ever use an emailed sign-in link — never a recoverable copy of your password. That's it; no name, no phone number, no payment details, nothing else is asked for or collected." },
      { h: "How the account data is actually protected — not just described", list: ["Passwords are hashed with PBKDF2-SHA256 at 100,000 iterations — the maximum a single request is allowed to spend on this before our hosting platform cuts it off — combined with a random salt generated fresh for every account, before either ever touches the database. A full copy of the database gives an attacker no usable password: every account's salt is different, so no precomputed table of hashes helps, and every guess still has to pay the full 100,000-iteration cost per account, per attempt.", "The sign-in cookie in your browser and the copy of it kept on the server are never the same value: the server stores only a one-way SHA-256 hash of it. A leaked database is useless for signing in as anyone, and the cookie itself is marked HttpOnly, so no script running on the page — including a successful attack against the page itself — can ever read it.", "A one-time email sign-in link works the same way: only its hash is stored, it expires in 15 minutes, and it stops working the instant it's used once.", "Deleting your account (Settings → Account → Delete account) is immediate and total — your email, password hash, saved articles, collections, and history are deleted from every table that references your account in that same request. Nothing is soft-deleted or kept 'just in case.'"] },
      { h: "What an account does not change", p: "Guest mode keeps working exactly as it always has, forever — nobody is required to create an account to use Cerebrum, and nothing about the search itself (which databases are queried, how the answer is written, what's sent to the AI provider) is any different signed in versus signed out." },
      { h: "Optional integrations", p: "If you paste a Zotero or ElevenLabs API key in Settings, that key is stored only in your browser's local storage and sent directly to that service when you use the relevant feature — it never passes through, or is stored on, Cerebrum's server." },
      { h: "Children", p: "Cerebrum is not directed at children under 13." },
    ] },
    terms: { eyebrow: "Terms", title: "The rules that keep this usable for everyone", lede: "Cerebrum is a free tool provided as-is. Using it means agreeing to a few common-sense terms.", updated: "Last updated August 2026", blocks: [ { h: "What Cerebrum is", p: "A free scientific literature search tool that returns AI-generated summaries of retrieved peer-reviewed papers, provided as-is with no warranty." }, { h: "Accuracy is not guaranteed", p: "Answers are generated by a language model from retrieved abstracts. Models can misread or misattribute. Verify anything important against the cited sources. Cerebrum is not a substitute for a qualified professional." }, { h: "Acceptable use", list: ["Don't disrupt, degrade, or circumvent the service or its rate limits.", "Don't systematically scrape, mirror, or resell answers.", "Don't generate content meant to defraud, defame, harass, or endanger.", "Don't violate the terms of the upstream scholarly APIs."] }, { h: "Third-party content", p: "Cerebrum links to papers hosted by publishers and repositories. We aren't responsible for their content, availability, or licensing — follow each publisher's terms." }, { h: "Availability & liability", p: "Cerebrum is free and comes with no availability guarantee. To the maximum extent allowed by law, we aren't liable for damages arising from your use of the service." } ] },
    contact: { eyebrow: "Contact", title: "Tell us what's broken or missing", lede: "Bug reports, feature requests, feedback, security issues — all welcome.", blocks: [ { h: "Email", email: "contact@askcerebrum.org", p: "Include as much detail as you can. A bug report is far easier to act on with the exact query, your browser, and what you expected to see." }, { h: "Reporting a bad answer", p: "Found a wrong species, an invented citation, a misattributed finding? Email the exact question and a short description. This is how the system improves." }, { h: "Security", p: "Discovered a vulnerability? Email us with details and please hold off on public disclosure until we've had a chance to respond." }, { h: "Blocked at work?", p: "If your organization's web filter is blocking Cerebrum, email us — we can help get it recategorized correctly as Reference / Educational." } ] },
  };
  const data = PAGES[page]; if (!data) return null;
  const NAV = [["about", "About"], ["privacy", "Privacy"], ["terms", "Terms"], ["contact", "Contact"]];
  return (
    <div style={{ minHeight: "100dvh", background: P.bg, color: P.ink, fontFamily: "var(--cb-body)", position: "relative", display: "flex", flexDirection: "column", overflowX: "hidden" }}>
      <style>{`
        .cb-info-block h2 { font-size: 20px; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 12px; color: ${P.ink}; font-family: var(--cb-display); }
        .cb-info-block p { font-size: 15.5px; line-height: 1.7; color: ${P.ink2}; margin: 0; }
        .cb-info-block ul { margin: 0; padding: 0; list-style: none; }
        .cb-info-block li { font-size: 15px; line-height: 1.65; color: ${P.ink2}; padding: 10px 0 10px 24px; position: relative; border-bottom: 1px solid ${P.line}; }
        .cb-info-block li:last-child { border-bottom: none; }
        .cb-info-block li:before { content: ""; position: absolute; left: 6px; top: 18px; width: 5px; height: 5px; border-radius: 50%; background: ${accent}; }
        .cb-info-navlink { position: relative; transition: color .15s ease; }
        .cb-info-navlink::after { content: ""; position: absolute; left: 10px; right: 10px; bottom: 1px; height: 2px; background: ${accent}; border-radius: 2px; transform: scaleX(0); transform-origin: left; transition: transform .25s cubic-bezier(0.4, 0, 0.2, 1); }
        .cb-info-navlink:hover { color: ${accent} !important; }
        .cb-info-navlink:hover::after, .cb-info-navlink[aria-current="page"]::after { transform: scaleX(1); }
        .cb-fadein { animation: cbInfoFade .6s cubic-bezier(0.16,1,0.3,1) both; }
        @keyframes cbInfoFade { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
      `}</style>
      <div style={{ position: "fixed", inset: 0, opacity: 0.4, pointerEvents: "none", zIndex: 0 }}>
        <LivingBackground accent={accent} P={P} intensity="subtle" preset="aurora" density={0.7} speed={0.6} opacity={0.7} paused={false} />
      </div>
      <header style={{ position: "sticky", top: 0, zIndex: 10, transform: "translateZ(0)", willChange: "transform" }}>
        {/* Blur lives on its own layer behind the content instead of on the
            sticky element itself — see the `headerGlass` comment in the main
            app styles for why that split, not just translateZ(0), is what
            actually keeps mouse-wheel scrolling alive over this bar. */}
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, zIndex: -1, pointerEvents: "none", background: withAlpha(P.bg, 0.85), backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", borderBottom: `1px solid ${P.line}` }} />
        <div style={{ maxWidth: 760, margin: "0 auto", padding: isMobile ? "14px 20px" : "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <button onClick={goHome} style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600, color: P.ink, fontSize: 16, background: "none", border: "none", cursor: "pointer", fontFamily: "var(--cb-display)", letterSpacing: "-0.02em", padding: 0 }}>
            <Mark size={18} accent={accent} /> Cerebrum
          </button>
          <nav style={{ display: "flex", gap: 6 }}>
            {NAV.map(([slug, label]) => (
              <a key={slug} href={`/${slug}`} className="cb-info-navlink" aria-current={page === slug ? "page" : undefined} style={{ fontSize: 14.5, color: page === slug ? P.ink : P.ink2, textDecoration: "none", padding: "6px 10px", fontWeight: page === slug ? 700 : 500, letterSpacing: "-0.01em" }}>{label}</a>
            ))}
          </nav>
        </div>
      </header>
      <main style={{ flex: 1, position: "relative", zIndex: 1 }}>
        <div style={{ maxWidth: 640, margin: "0 auto", padding: isMobile ? "48px 20px 64px" : "72px 28px 80px" }}>
          <div className="cb-fadein" style={{ animationDelay: "0ms" }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.15em", textTransform: "uppercase", color: accent, fontFamily: "var(--cb-mono)" }}>{data.eyebrow}</span>
            <h1 style={{ fontSize: isMobile ? 28 : 36, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.15, color: P.ink, margin: "12px 0 16px", fontFamily: "var(--cb-display)" }}>{data.title}</h1>
            <p style={{ fontSize: 16, lineHeight: 1.65, color: P.ink2, marginBottom: 8 }}>{data.lede}</p>
            {data.updated && <div style={{ fontSize: 12, color: P.faint, marginBottom: 0, fontFamily: "var(--cb-mono)" }}>{data.updated}</div>}
          </div>
          <div style={{ marginTop: 48, display: "flex", flexDirection: "column", gap: 40 }}>
            {data.blocks.map((block, i) => (
              <div key={i} className="cb-info-block cb-fadein" style={{ animationDelay: `${(i + 1) * 80}ms` }}>
                <h2>{block.h}</h2>
                {block.p && <p>{block.p}</p>}
                {block.email && <a href={`mailto:${block.email}`} style={{ fontSize: 15, color: accent, textDecoration: "none", fontFamily: "var(--cb-mono)", display: "inline-block", marginBottom: 8 }}>{block.email}</a>}
                {block.list && <ul>{block.list.map((li, j) => <li key={j}>{li}</li>)}</ul>}
              </div>
            ))}
          </div>
        </div>
      </main>
      <footer style={{ borderTop: `1px solid ${P.line}`, padding: "28px 20px", textAlign: "center", position: "relative", zIndex: 1 }}>
        <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600, color: P.ink, fontSize: 14, fontFamily: "var(--cb-display)" }}><Mark size={16} accent={accent} /> Cerebrum</div>
          <nav style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "center" }}>
            {NAV.map(([slug, label]) => (<a key={slug} href={`/${slug}`} className="cb-info-navlink" aria-current={page === slug ? "page" : undefined} style={{ fontSize: 13.5, color: page === slug ? P.ink : P.ink2, textDecoration: "none", padding: "5px 10px", fontWeight: page === slug ? 700 : 500 }}>{label}</a>))}
          </nav>
          <div style={{ fontSize: 12, color: P.faint, fontFamily: "var(--cb-mono)" }}>© 2026 Cerebrum</div>
        </div>
      </footer>
    </div>
  );
}


/* ============================================================
   BIBLIOGRAPHY, TURN — redesigned card architecture
   ============================================================ */
function Bibliography({ sources, P, accent, citationStyle, setCitationStyle }) {
  const [copied, setCopied] = useState(false);
  const styleOptions = [ { key: "vancouver", label: "Vancouver" }, { key: "apa", label: "APA" }, { key: "mla", label: "MLA" }, { key: "chicago", label: "Chicago" }, { key: "bibtex", label: "BibTeX" } ];
  const copyAll = () => {
    copyToClipboard(formatBibliography(sources, citationStyle), "Bibliography copied").then((ok) => {
      if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1500); }
    });
  };
  const downloadFile = () => { const ext = citationStyle === "bibtex" ? "bib" : "txt"; download(`cerebrum-bibliography.${ext}`, formatBibliography(sources, citationStyle)); };
  return (
    <div style={{ marginTop: 32, border: P.dark ? "1px solid rgba(255,255,255,0.08)" : `1px solid ${P.line}`, borderRadius: 16, padding: "24px 26px 10px", background: P.dark ? "rgba(5,8,22,0.5)" : withAlpha(P.surface, 0.7), backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)" }} className="cb-fade">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 18, flexWrap: "wrap", paddingBottom: 16, borderBottom: `1px solid ${P.line}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 3, height: 18, background: accent, borderRadius: 2 }} />
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.04em", color: P.ink, textTransform: "uppercase", fontFamily: "var(--cb-mono)" }}>Bibliography</div>
          <div style={{ fontSize: 11, fontWeight: 600, color: P.faint, fontFamily: "var(--cb-mono)", background: withAlpha(P.faint, 0.1), padding: "1px 8px", borderRadius: 20 }}>{sources.length}</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select value={citationStyle} onChange={(e) => setCitationStyle(e.target.value)} style={{ padding: "6px 10px", fontSize: 11.5, fontWeight: 500, background: P.bg, color: P.ink, border: `1px solid ${P.line}`, borderRadius: 8, cursor: "pointer", fontFamily: "var(--cb-mono)", outline: "none", ...selectChrome(P) }}>
            {styleOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          <button onClick={copyAll} style={bibBtn(P, accent)}>{copied ? "✓ Copied" : "Copy all"}</button>
          <button onClick={downloadFile} style={bibBtn(P, accent)}>Download</button>
        </div>
      </div>
      <ol className="cb-stagger" style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10, paddingBottom: 14 }}>
        {sources.map((src, i) => <BibEntry key={i} source={src} index={i + 1} P={P} accent={accent} style={citationStyle} className="cb-fade" />)}
      </ol>
    </div>
  );
}

function BibEntry({ source, index, P, accent, style, className }) {
  const [hover, setHover] = useState(false);
  const formatted = formatCitation(source, style, index);
  return (
    <li id={`ref-${index}`} className={className}
      style={{
        padding: "16px 18px", display: "flex", gap: 14, alignItems: "flex-start",
        background: hover ? withAlpha(accent, 0.05) : (P.dark ? "rgba(255,255,255,0.02)" : withAlpha(P.line, 0.25)),
        border: `1px solid ${hover ? withAlpha(accent, 0.3) : P.line}`,
        borderRadius: 12, opacity: 0, transition: "background 0.15s ease, border-color 0.15s ease",
      }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div style={{
        flexShrink: 0, width: 26, height: 26, borderRadius: "50%",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: accent, fontWeight: 700, fontSize: 11.5, fontFamily: "var(--cb-mono)",
        background: withAlpha(accent, 0.12), border: `1px solid ${withAlpha(accent, 0.3)}`,
      }}>{index}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {(source.retracted || source.concern) && (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 8px", marginBottom: 8, background: withAlpha(source.retracted ? STATUS.bad : STATUS.warn, source.retracted ? 0.12 : 0.14), border: `1px solid ${source.retracted ? STATUS.bad : STATUS.warn}`, borderRadius: 6, fontSize: 10, fontWeight: 700, color: source.retracted ? STATUS.bad : STATUS.warn, letterSpacing: "0.04em", fontFamily: "var(--cb-mono)", textTransform: "uppercase" }}>
            <span>⚠</span><span>{source.retracted ? "RETRACTED" : "EXPRESSION OF CONCERN"}</span>
          </div>
        )}
        {style === "bibtex" ? (
          <pre style={{ fontSize: 11.5, fontFamily: "var(--cb-mono)", color: P.ink2, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{formatted}</pre>
        ) : (
          <div style={{ fontSize: 13.5, lineHeight: 1.6, color: P.ink, fontWeight: 500 }} dangerouslySetInnerHTML={{ __html: escapeHtml(formatted).replace(/\*([^*]+)\*/g, '<em style="font-style: italic; font-weight: 400;">$1</em>').replace(/\n/g, "<br>") }} />
        )}
        {(source.citations != null || source.type) && (
          <div style={{ fontSize: 11, color: P.faint, marginTop: 6, display: "flex", gap: 6, alignItems: "center", fontFamily: "var(--cb-mono)" }}>
            {source.type && <span style={{ fontWeight: 600, color: P.ink2 }}>{source.type}</span>}
            {source.type && source.citations != null && <span style={{ opacity: 0.5 }}>·</span>}
            {source.citations != null && <span>{source.citations.toLocaleString()} citation{source.citations === 1 ? "" : "s"}</span>}
          </div>
        )}
        {source.tldr && (
          <div style={{ fontSize: 12.5, color: P.ink2, marginTop: 10, padding: "10px 14px", background: withAlpha(accent, 0.05), borderLeft: `2px solid ${withAlpha(accent, 0.4)}`, borderRadius: "4px 8px 8px 4px", lineHeight: 1.55, fontStyle: "italic" }}>
            <span style={{ fontWeight: 600, fontStyle: "normal", color: accent, fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", marginRight: 6, fontFamily: "var(--cb-mono)" }}>TL;DR</span>{source.tldr}
          </div>
        )}
        {source.url && (
          <a href={safeHref(source.url)} target="_blank" rel="noreferrer"
            style={{
              fontSize: 11, color: accent, textDecoration: "none", marginTop: 10,
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "4px 10px", borderRadius: 20, background: withAlpha(accent, 0.08),
              border: `1px solid ${withAlpha(accent, 0.2)}`, fontFamily: "var(--cb-mono)",
              maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{source.url.replace(/^https?:\/\//, "").slice(0, 50)}{source.url.length > 50 ? "…" : ""}</span>
            <span style={{ flexShrink: 0 }}>↗</span>
          </a>
        )}
      </div>
    </li>
  );
}
function bibBtn(P, accent) { return { padding: "5px 10px", fontSize: 11, fontWeight: 500, background: "transparent", color: P.ink2, border: `1px solid ${P.line}`, borderRadius: 6, cursor: "pointer", fontFamily: "var(--cb-mono)", letterSpacing: "0.01em" }; }

function Turn({ t, P, accent, at, S, typewriter, hoverCite, setHoverCite, onRelated, citationStyle, setCitationStyle, onShowNetwork = () => {}, onShowTimeline = () => {}, onIllustrate = () => {}, interactive = true }) {
  const shown = useTypewriter(t.answer, typewriter && t.fresh);
  const done = shown === t.answer;
  return (
    <div style={S.turn} className="cb-rise">
      {/* Query label — monospaced, quiet */}
      <div style={S.qLabel}>
        <span style={S.qDot} />
        <span style={{ fontFamily: "var(--cb-mono)", fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase" }}>Inquiry</span>
      </div>
      <h2 style={S.headline}>{t.hasImage && <Icon name="image" size={22} style={{ marginRight: 10, verticalAlign: "-3px", opacity: 0.6 }} />}{t.q}</h2>
      {/* Answer card */}
      <div style={S.answerCard} className="cb-answer-enter cb-glass-panel">
        {t.sources && t.sources.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: accent, background: withAlpha(accent, 0.1), padding: "3px 10px", borderRadius: 20, fontFamily: "var(--cb-mono)", letterSpacing: "0.02em" }}>{t.sources.length} source{t.sources.length === 1 ? "" : "s"}</span>
            {t.answer && <span style={{ fontSize: 11, color: P.faint, fontFamily: "var(--cb-mono)" }}>{Math.ceil(t.answer.split(/\s+/).length / 238)} min read</span>}
          </div>
        )}
        {renderAnswer(shown, t.sources, P, accent, hoverCite, setHoverCite)}
        {done && (
          <div style={{ ...S.byline, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <span style={S.aiTag}>AI-synthesized · verify against cited sources</span>
            <span style={{ fontSize: 10, color: P.faint, fontFamily: "var(--cb-mono)" }}>{new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
          </div>
        )}
        {done && t.answer && (
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button onClick={(e) => {
              const label = e.currentTarget.querySelector("span");
              copyToClipboard(t.answer, "Answer copied").then((ok) => {
                if (ok && label) { label.textContent = "Copied!"; setTimeout(() => { label.textContent = "Copy answer"; }, 1500); }
              });
            }} style={S.answerActionBtn}><Icon name="check" size={12} /><span>Copy answer</span></button>
            <button onClick={async (e) => {
              const label = e.currentTarget.querySelector("span");
              const url = window.location.origin + "/?q=" + encodeURIComponent(t.q);
              // Prefer the native share sheet (real "sharing" — Messages, Mail,
              // social apps — on mobile and supporting desktop browsers).
              // navigator.share() requires a secure context and can throw
              // AbortError when the user just dismisses the sheet, which is
              // not a failure and shouldn't show an error toast.
              if (navigator.share && window.isSecureContext) {
                try {
                  await navigator.share({ title: "Cerebrum", text: t.q, url });
                  return;
                } catch (err) {
                  if (err && err.name === "AbortError") return; // user cancelled — not an error
                  // Fall through to clipboard fallback below.
                }
              }
              copyToClipboard(url, "Link copied").then((ok) => {
                if (ok && label) { label.textContent = "Link copied!"; setTimeout(() => { label.textContent = "Share"; }, 1500); }
              });
            }} style={S.answerActionBtn}><Icon name="link" size={12} /><span>Share</span></button>
            {/* v5: there was already a full @media print stylesheet in this
                file — quietly supporting the design goal stated in this
                file's own header comment ("results read like a premium
                research brief — you'd print this") — with no button
                anywhere that surfaced it. A user would've had to already
                know to hit Ctrl/Cmd+P. */}
            <button onClick={() => window.print()} style={S.answerActionBtn}><Icon name="printer" size={12} /><span>Print / Save PDF</span></button>
            {interactive && t.sources && t.sources.length >= 2 && <button onClick={() => onShowNetwork(t.sources)} style={S.answerActionBtn}><Icon name="network" size={12} /><span>Source network</span></button>}
            {interactive && t.sources && t.sources.length >= 2 && <button onClick={() => onShowTimeline(t.sources)} style={S.answerActionBtn}><Icon name="timeline" size={12} /><span>Timeline</span></button>}
            {interactive && done && t.answer && <button onClick={() => onIllustrate(t.q)} style={S.answerActionBtn}><Icon name="wand" size={12} /><span>Illustrate</span></button>}
          </div>
        )}
        {done && t.answer && t.answer.length > 40 && <AnswerPlayer text={t.answer} accent={accent} P={P} />}
      </div>
      {done && t.factCheck && <FactCheck fc={t.factCheck} P={P} accent={accent} />}
      {/* AI suggestions */}
      {interactive && done && t.suggestions && t.suggestions.length > 0 && (
        <div style={{ marginTop: 20, display: "flex", flexWrap: "wrap", gap: 8 }} className="cb-fade">
          {t.suggestions.map((s, i) => (
            <button key={i} onClick={() => s.query && onRelated && onRelated(s.query)} disabled={!s.query}
              style={{ padding: "7px 14px", fontSize: 12.5, fontWeight: 500, background: s.query ? withAlpha(accent, 0.08) : "transparent", color: s.query ? accent : P.faint, border: `1px solid ${s.query ? withAlpha(accent, 0.25) : P.line}`, borderRadius: 8, cursor: s.query ? "pointer" : "default", fontFamily: "inherit" }}>
              {s.label} {s.query && <span style={{ opacity: 0.5, marginLeft: 4 }}>→</span>}
            </button>
          ))}
        </div>
      )}
      {done && t.sources && t.sources.length > 0 && <Bibliography sources={t.sources} P={P} accent={accent} citationStyle={citationStyle} setCitationStyle={setCitationStyle} />}
      {/* Videos */}
      {done && t.videos && t.videos.length > 0 && t.sources && t.sources.length > 0 && (
        <details style={{ marginTop: 20 }} className="cb-fade">
          <summary style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: P.faint, cursor: "pointer", padding: "8px 0", listStyle: "none", display: "flex", alignItems: "center", gap: 8, userSelect: "none", fontFamily: "var(--cb-mono)" }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
            Related videos · {t.videos.length}
          </summary>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12, marginTop: 10 }} className="cb-stagger">
            {t.videos.slice(0, 6).map((v, i) => (
              <a key={v.id || i} href={safeHref(v.url)} target="_blank" rel="noreferrer" className="cb-fade cb-card" style={{ display: "block", background: P.surface, border: `1px solid ${P.line}`, borderRadius: 10, overflow: "hidden", textDecoration: "none", color: P.ink, opacity: 0 }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = accent; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = P.line; }}>
                <div style={{ position: "relative", width: "100%", aspectRatio: "16/9", background: P.bg, overflow: "hidden" }}>
                  <img src={v.thumbnail} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                </div>
                <div style={{ padding: "10px 12px" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.35, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", marginBottom: 4 }}>{v.title}</div>
                  <div style={{ fontSize: 11, color: P.faint, fontFamily: "var(--cb-mono)" }}>{v.author}</div>
                </div>
              </a>
            ))}
          </div>
        </details>
      )}
      {/* Related questions */}
      {interactive && done && t.related && t.related.length > 0 && (
        <div style={S.relatedWrap} className="cb-fade">
          <div style={S.relatedLabel}>Continue the investigation</div>
          <div style={S.relatedList}>
            {t.related.map((r, i) => (
              <button key={i} style={S.relatedBtn} onClick={() => onRelated(r)} onMouseEnter={(e) => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.color = accent; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = P.line2; e.currentTarget.style.color = P.ink2; }}>
                <span>{r}</span><span style={{ color: accent, fontFamily: "var(--cb-mono)" }}>→</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


// Shared keyboard-trap for every modal in the app: focuses the first
// focusable element on mount, keeps Tab/Shift+Tab cycling inside the modal
// instead of leaking out to whatever's behind the backdrop, and hands focus
// back to whatever had it before the modal opened once it closes. Every
// modal below is only ever mounted while it's open, so a plain mount/unmount
// effect lines up exactly with open/close — same trick as
// useWheelScrollTakeover just above InfoPage.
function useFocusTrap() {
  const ref = useRef(null);
  // Captured via a lazy ref initializer — evaluated during render, before
  // this modal's own DOM (and anything like an autoFocus'd input inside it)
  // has actually been committed — rather than inside the effect below.
  // Reading document.activeElement from the effect instead is one render
  // late: by the time a passive effect runs, React has already committed
  // the modal into the DOM and fired any native autoFocus, so
  // document.activeElement at that point is something inside the modal
  // itself (never what was focused before it opened), and "restore focus
  // on close" silently restores focus to nothing useful.
  const previouslyFocusedRef = useRef(typeof document !== "undefined" ? document.activeElement : null);
  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const getFocusable = () => Array.from(container.querySelectorAll(FOCUSABLE));
    // Only move focus ourselves if nothing inside the modal has it already —
    // a few modals (AuthModal's email field) use their own autoFocus for a
    // more useful default landing spot than "whatever's first in DOM order,"
    // usually the Close button. Respect that instead of stealing it back.
    if (!container.contains(document.activeElement)) {
      const first = getFocusable()[0];
      (first || container).focus?.();
    }
    const onKeyDown = (e) => {
      if (e.key !== "Tab") return;
      const items = getFocusable();
      if (!items.length) return;
      const firstEl = items[0], lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    };
    container.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("keydown", onKeyDown);
      const toRestore = previouslyFocusedRef.current;
      if (toRestore && typeof toRestore.focus === "function" && document.contains(toRestore)) toRestore.focus();
    };
  }, []);
  return ref;
}

/* ============================================================
   HOW IT WORKS MODAL + SETTINGS — same logic, new visual system
   ============================================================ */
function HowItWorksModal({ P, accent, close }) {
  useEffect(() => { const onKey = (e) => { if (e.key === "Escape") close(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [close]);
  const trapRef = useFocusTrap();
  const Section = ({ title, children }) => (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: "0.1em", color: accent, marginBottom: 10, textTransform: "uppercase", fontFamily: "var(--cb-mono)" }}>{title}</div>
      <div style={{ fontSize: 14, lineHeight: 1.7, color: P.ink }}>{children}</div>
    </div>
  );
  const List = ({ items }) => (
    <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
      {items.map((it, i) => <li key={i} style={{ marginBottom: 6, fontSize: 13.5, lineHeight: 1.65, color: P.ink2 }}>{it}</li>)}
    </ul>
  );
  return (
    <div onClick={close} role="dialog" aria-modal="true" aria-label="How Cerebrum works" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} className="cb-backdrop">
      <div ref={trapRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} style={{ background: P.bg, borderRadius: 18, maxWidth: 600, width: "100%", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 24px 80px rgba(0,0,0,0.5)", border: `1px solid ${P.line}`, outline: "none" }} className="cb-modal">
        <div style={{ position: "sticky", top: 0, background: P.bg, padding: "20px 24px 16px", borderBottom: `1px solid ${P.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em", color: P.ink, fontFamily: "var(--cb-display)" }}>How Cerebrum works</div>
            <div style={{ fontSize: 12, color: P.faint, marginTop: 2, fontFamily: "var(--cb-mono)" }}>A short, honest technical explanation.</div>
          </div>
          <button onClick={close} aria-label="Close" style={{ background: "none", border: "none", color: P.faint, cursor: "pointer", padding: 4, display: "inline-flex" }}><Icon name="close" size={18} /></button>
        </div>
        <div style={{ padding: "24px 24px 32px" }}>
          <Section title="The retrieval layer">Every query fans out to 14 scholarly databases in parallel, all free and keyless.
            <List items={[<><strong>Europe PMC</strong> — biomedical, includes preprints</>,<><strong>PubMed</strong> (NCBI E-utilities) — biomedical, automatic term mapping</>,<><strong>OpenAlex</strong> — cross-disciplinary, concept graph</>,<><strong>Crossref</strong> — DOI-registered works, checked for retraction status</>,<><strong>arXiv</strong> — physics, math, CS, quantitative biology</>,<><strong>Semantic Scholar</strong> — includes auto-generated TL;DR summaries</>,<><strong>bioRxiv</strong> preprints (via OpenAlex)</>,<><strong>DOAJ, PLOS, Zenodo</strong> — additional open-access coverage</>,<><strong>CORE, BASE, PMC full-text, OpenAIRE</strong> — additional aggregator/repository coverage</>]} />
          </Section>
          <Section title="Query intelligence"><List items={[<><strong>Species queries</strong> are wrapped in quoted phrases with strict species-level filtering.</>,<><strong>Author queries</strong> hit OpenAlex's author disambiguation endpoint.</>,<><strong>Acronym expansion</strong> for common scientific abbreviations.</>,<><strong>Fallback ladder</strong>: if a strict query returns nothing, we retry looser, then plain.</>]} /></Section>
          <Section title="Trust and safety"><List items={[<><strong>Retraction flagging</strong> via Crossref's crossmark data.</>,<><strong>No fabricated citations</strong> — the AI is instructed to never invent DOIs, authors, or journal names.</>,<><strong>Honest hedging</strong> — when literature is thin, the model says so.</>]} /></Section>
          <Section title="The AI layer">Answers are synthesized by free-tier language models. Dozens of models across three providers (OpenRouter, Cloudflare Workers AI, and Pollinations) are raced in parallel in two waves — whichever responds first with a good answer wins — so a slow or rate-limited provider can't stall the others.</Section>
          <Section title="Known limitations"><List items={["New preprints may not be indexed anywhere for hours or days.","The AI can misinterpret papers — verify claims.","Free AI models rate-limit under load.","Non-English literature is under-indexed."]} /></Section>
          <Section title="What Cerebrum is not"><List items={["Not a replacement for reading the actual papers","Not a systematic review tool","Not medical, legal, or financial advice","Not paywalled or ad-supported"]} /></Section>
          <div style={{ fontSize: 11, color: P.faint, marginTop: 24, paddingTop: 16, borderTop: `1px solid ${P.line}`, fontFamily: "var(--cb-mono)" }}>Cerebrum™ · Built by Vaticay</div>
        </div>
      </div>
    </div>
  );
}

// v5: the "what's new" launch modal. Shows once per browser (gated by
// cb_seen_v5 in localStorage — see App's mount effect) the first time
// someone lands on the app after this ships, and is reachable again any
// time afterward from the small "V5" badge next to the wordmark.
function V5AnnouncementModal({ P, accent, at, close }) {
  useEffect(() => { const onKey = (e) => { if (e.key === "Escape") close(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [close]);
  const trapRef = useFocusTrap();
  const items = [
    { icon: "wand", title: "AI concept illustrations", body: "Any answer can now generate a clean, textbook-style visual sketch of the concept it's explaining — a quick way to see the idea, not just read it." },
    { icon: "timeline", title: "Literature timeline", body: "See where a topic's sources actually sit in time — an established, decades-deep body of work, or something that only emerged in the last two years." },
    { icon: "network", title: "Source network", body: "A visual map of how an answer's sources relate to each other, sized by relevance." },
    { icon: "compare", title: "Compare investigations", body: "Put two past investigations side by side and read their answers and sources in parallel." },
    { icon: "bookmarkFilled", title: "Collections", body: "Sort saved sources into named collections instead of one flat list — signed-in accounts only." },
    { icon: "history", title: "Accounts that follow you", body: "An optional account syncs saved sources, collections, and past investigations across every device — guest mode still works exactly as before, with nothing stored on our servers." },
  ];
  return (
    <div onClick={close} role="dialog" aria-modal="true" aria-label="What's new in Cerebrum DP" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 210, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} className="cb-backdrop">
      <div ref={trapRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} style={{ background: P.bg, borderRadius: 18, maxWidth: 520, width: "100%", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 24px 80px rgba(0,0,0,0.5)", border: `1px solid ${P.line}`, outline: "none" }} className="cb-modal">
        <div style={{ padding: "28px 28px 8px" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "4px 10px", borderRadius: 20, background: withAlpha(accent, 0.12), color: accent, fontSize: 11, fontWeight: 700, fontFamily: "var(--cb-mono)", letterSpacing: "0.06em", marginBottom: 16 }}>
            <Icon name="sparkle" size={12} /> DP · NOW LIVE
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em", color: P.ink, fontFamily: "var(--cb-display)", marginBottom: 8 }}>Cerebrum is now an all-in-one research instrument.</div>
          <div style={{ fontSize: 14, color: P.ink2, lineHeight: 1.6, marginBottom: 22 }}>Not just a question box anymore — compare investigations, map and time-trace your sources, and generate a concept illustration, all without leaving the app.</div>
        </div>
        <div style={{ padding: "0 28px" }}>
          {items.map((it, i) => (
            <div key={i} style={{ display: "flex", gap: 14, padding: "14px 0", borderTop: i ? `1px solid ${P.line}` : "none" }}>
              <span style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 10, background: withAlpha(accent, 0.1), color: accent, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name={it.icon} size={16} /></span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: P.ink, marginBottom: 3 }}>{it.title}</div>
                <div style={{ fontSize: 13, color: P.ink2, lineHeight: 1.55 }}>{it.body}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ padding: "20px 28px 28px" }}>
          <button onClick={close} style={{ width: "100%", padding: "13px", fontSize: 14, fontWeight: 600, background: accent, color: at, border: "none", borderRadius: 10, cursor: "pointer", fontFamily: "var(--cb-body)" }}>Got it</button>
        </div>
      </div>
    </div>
  );
}

// Shown once, right after a successful sign-in/sign-up, if the browser
// already had guest-mode saved articles or history sitting in localStorage.
// Accepting keeps that data exactly where it is client-side (nothing new to
// fetch) — it simply gets swept into the account by the normal sync effect
// that already watches `saved`/`history` for changes once `user` is set.
function ImportLocalDataPrompt({ P, accent, at, savedCount, historyCount, onImport, onSkip }) {
  const trapRef = useFocusTrap();
  return (
    <div role="dialog" aria-modal="true" aria-label="Import your existing data" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 216, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} className="cb-backdrop">
      <div ref={trapRef} tabIndex={-1} style={{ background: P.bg, borderRadius: 16, maxWidth: 400, width: "100%", padding: 26, boxShadow: "0 24px 80px rgba(0,0,0,0.5)", border: `1px solid ${P.line}`, outline: "none" }} className="cb-modal">
        <div style={{ width: 40, height: 40, borderRadius: 11, background: withAlpha(accent, 0.12), color: accent, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}><Icon name="bookmarkFilled" size={18} /></div>
        <div style={{ fontSize: 16, fontWeight: 700, color: P.ink, marginBottom: 8 }}>Bring your existing data along?</div>
        <div style={{ fontSize: 13.5, color: P.ink2, lineHeight: 1.6, marginBottom: 18 }}>
          This browser already has {savedCount > 0 ? <><strong>{savedCount} saved source{savedCount === 1 ? "" : "s"}</strong>{historyCount > 0 ? " and " : ""}</> : null}
          {historyCount > 0 ? <><strong>{historyCount} past investigation{historyCount === 1 ? "" : "s"}</strong></> : null} from before you signed in. Attach it to your new account so it follows you to other devices?
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onSkip} style={{ flex: 1, padding: "11px", fontSize: 13.5, fontWeight: 600, background: "transparent", color: P.ink2, border: `1px solid ${P.line}`, borderRadius: 9, cursor: "pointer" }}>Start account fresh</button>
          <button onClick={onImport} style={{ flex: 1, padding: "11px", fontSize: 13.5, fontWeight: 600, background: accent, color: at, border: "none", borderRadius: 9, cursor: "pointer" }}>Add to my account</button>
        </div>
        <div style={{ fontSize: 11, color: P.faint, marginTop: 12, lineHeight: 1.5 }}>"Start fresh" clears this browser's local list rather than leaving it stranded outside your account.</div>
      </div>
    </div>
  );
}

// Collections tab — organizes the flat Saved-articles list into named
// groups (signed-in only; server-backed via /api/data's "collections"
// actions, same as everything else in this file talks to the backend).
// Deliberately simple: create/rename/delete a collection, and move a saved
// source in or out of one via a plain <select> rather than drag-and-drop —
// drag-and-drop is a lot of extra surface for what's fundamentally a filing
// operation people do occasionally, not constantly.
function CollectionsModal({ P, accent, at, S, saved, collections, onCreateCollection, onRenameCollection, onDeleteCollection, onMoveSource, close }) {
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [activeId, setActiveId] = useState("all"); // "all" | "uncategorized" | collection id
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  useEffect(() => { const onKey = (e) => { if (e.key === "Escape") close(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [close]);
  const trapRef = useFocusTrap();

  const countFor = (id) => id === "all" ? saved.length : id === "uncategorized" ? saved.filter((s) => !s.collectionId).length : saved.filter((s) => s.collectionId === id).length;
  const visible = activeId === "all" ? saved : activeId === "uncategorized" ? saved.filter((s) => !s.collectionId) : saved.filter((s) => s.collectionId === activeId);

  return (
    <div onClick={close} role="dialog" aria-modal="true" aria-label="Collections" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} className="cb-backdrop">
      <div ref={trapRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} style={{ background: P.bg, borderRadius: 18, maxWidth: 780, width: "100%", maxHeight: "85vh", display: "flex", boxShadow: "0 24px 80px rgba(0,0,0,0.5)", border: `1px solid ${P.line}`, overflow: "hidden", outline: "none" }} className="cb-modal">
        <div style={{ width: 210, flexShrink: 0, borderRight: `1px solid ${P.line}`, padding: 16, overflowY: "auto" }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: P.faint, fontFamily: "var(--cb-mono)", marginBottom: 12 }}>Collections</div>
          {[{ id: "all", name: "All saved" }, { id: "uncategorized", name: "Uncategorized" }, ...collections].map((c) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
              {renamingId === c.id ? (
                <input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { onRenameCollection(c.id, renameValue); setRenamingId(null); } if (e.key === "Escape") { e.stopPropagation(); setRenamingId(null); } }} onBlur={() => setRenamingId(null)} style={{ flex: 1, padding: "7px 8px", fontSize: 12.5, borderRadius: 7, border: `1px solid ${accent}`, background: "transparent", color: P.ink }} />
              ) : (
                <button onClick={() => setActiveId(c.id)} onDoubleClick={() => { if (c.id !== "all" && c.id !== "uncategorized") { setRenamingId(c.id); setRenameValue(c.name); } }} style={{ flex: 1, textAlign: "left", padding: "7px 8px", fontSize: 12.5, borderRadius: 7, border: "none", cursor: "pointer", background: activeId === c.id ? withAlpha(accent, 0.12) : "transparent", color: activeId === c.id ? accent : P.ink2, fontFamily: "var(--cb-body)" }}>
                  {c.name} <span style={{ opacity: 0.6 }}>({countFor(c.id)})</span>
                </button>
              )}
              {c.id !== "all" && c.id !== "uncategorized" && renamingId !== c.id && (
                deleteConfirmId === c.id ? (
                  <span style={{ display: "inline-flex", gap: 4, flexShrink: 0 }}>
                    <button onClick={() => setDeleteConfirmId(null)} style={{ ...S.chipMini, padding: "3px 7px" }}>Cancel</button>
                    <button onClick={() => { onDeleteCollection(c.id); setDeleteConfirmId(null); if (activeId === c.id) setActiveId("all"); }} style={{ ...S.chipMini, padding: "3px 7px", background: STATUS.bad, color: "#fff", borderColor: STATUS.bad }}>Confirm</button>
                  </span>
                ) : (
                  <button onClick={() => setDeleteConfirmId(c.id)} aria-label={`Delete ${c.name}`} style={{ background: "none", border: "none", color: P.faint, cursor: "pointer", padding: 4, display: "inline-flex" }}><Icon name="close" size={12} /></button>
                )
              )}
            </div>
          ))}
          <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) { onCreateCollection(newName.trim()); setNewName(""); } }} placeholder="New collection…" aria-label="New collection name" style={{ flex: 1, padding: "7px 8px", fontSize: 12, borderRadius: 7, border: `1px solid ${P.line}`, background: "transparent", color: P.ink }} />
            <button onClick={() => { if (newName.trim()) { onCreateCollection(newName.trim()); setNewName(""); } }} aria-label="Create collection" style={{ background: withAlpha(accent, 0.12), color: accent, border: "none", borderRadius: 7, padding: "0 10px", cursor: "pointer" }}><Icon name="plus" size={13} /></button>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "16px 20px", borderBottom: `1px solid ${P.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: P.ink }}>{activeId === "all" ? "All saved" : activeId === "uncategorized" ? "Uncategorized" : collections.find((c) => c.id === activeId)?.name || "Collection"}</div>
            <button onClick={close} aria-label="Close" style={{ background: "none", border: "none", color: P.faint, cursor: "pointer", padding: 4, display: "inline-flex" }}><Icon name="close" size={18} /></button>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
            {visible.length === 0 ? (
              <div style={{ fontSize: 13, color: P.faint, textAlign: "center", padding: "40px 0" }}>
                {activeId === "all" ? "Nothing saved yet." : "Nothing here yet — move a saved source in with the dropdown next to it on “All saved.”"}
              </div>
            ) : visible.map((s, i) => (
              <div key={sourceKey(s)} style={{ padding: "12px 0", borderTop: i ? `1px solid ${P.line}` : "none", display: "flex", alignItems: "flex-start", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: P.ink, marginBottom: 4 }}>{s.title}</div>
                  <div style={{ fontSize: 11.5, color: P.faint, fontFamily: "var(--cb-mono)" }}>{s.journal || ""}{s.year ? ` · ${s.year}` : ""}</div>
                </div>
                <select value={s.collectionId || ""} onChange={(e) => onMoveSource(s, e.target.value || null)} aria-label={`Move "${s.title}" to a collection`} style={{ fontSize: 11.5, padding: "5px 6px", borderRadius: 6, border: `1px solid ${P.line}`, background: "transparent", color: P.ink2, fontFamily: "var(--cb-mono)", cursor: "pointer", ...selectChrome(P) }}>
                  <option value="">Uncategorized</option>
                  {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Compare view — two History threads shown side by side. Deliberately just
// two: past three-plus and the useful comparison ("did these two questions
// get consistent answers?") turns into a horizontal-scrolling mess instead
// of something actually readable.
function CompareModal({ P, accent, at, S, history, close }) {
  const [leftId, setLeftId] = useState(history[0]?.id || "");
  const [rightId, setRightId] = useState(history[1]?.id || "");
  useEffect(() => { const onKey = (e) => { if (e.key === "Escape") close(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [close]);
  const trapRef = useFocusTrap();
  const left = history.find((h) => h.id === leftId);
  const right = history.find((h) => h.id === rightId);
  const noop = () => {};
  const Picker = ({ value, onChange, exclude }) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ width: "100%", padding: "9px 10px", fontSize: 12.5, borderRadius: 8, border: `1px solid ${P.line}`, background: P.dark ? "rgba(255,255,255,0.03)" : "#fff", color: P.ink, fontFamily: "var(--cb-mono)", cursor: "pointer", ...selectChrome(P) }}>
      <option value="">Choose an investigation…</option>
      {history.filter((h) => h.id !== exclude).map((h) => <option key={h.id} value={h.id}>{h.title}</option>)}
    </select>
  );
  const Column = ({ entry }) => (
    <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: 18 }}>
      {entry ? entry.turns.map((t, ti) => (
        // interactive=false — this is a read-only side-by-side replay of a
        // past investigation, and there's no live `ask` or network-graph
        // state here to wire "Continue the investigation" / "Source
        // network" up to, so Turn hides those controls entirely instead of
        // rendering buttons that quietly do nothing when clicked.
        <Turn key={t.id ?? ti} t={t} P={P} accent={accent} at={at} S={S} typewriter={false} last={ti === entry.turns.length - 1} hoverCite={null} setHoverCite={noop} citationStyle="apa" setCitationStyle={noop} interactive={false} />
      )) : <div style={{ fontSize: 13, color: P.faint, textAlign: "center", padding: "60px 0" }}>Pick an investigation to compare.</div>}
    </div>
  );
  return (
    <div onClick={close} role="dialog" aria-modal="true" aria-label="Compare investigations" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} className="cb-backdrop">
      <div ref={trapRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} style={{ background: P.bg, borderRadius: 18, maxWidth: 1100, width: "100%", height: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 80px rgba(0,0,0,0.5)", border: `1px solid ${P.line}`, overflow: "hidden", outline: "none" }} className="cb-modal">
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${P.line}`, display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: P.ink, flexShrink: 0 }}>Compare</div>
          <div style={{ flex: 1 }}><Picker value={leftId} onChange={setLeftId} exclude={rightId} /></div>
          <div style={{ flex: 1 }}><Picker value={rightId} onChange={setRightId} exclude={leftId} /></div>
          <button onClick={close} aria-label="Close" style={{ background: "none", border: "none", color: P.faint, cursor: "pointer", padding: 4, display: "inline-flex", flexShrink: 0 }}><Icon name="close" size={18} /></button>
        </div>
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          <Column entry={left} />
          <div style={{ width: 1, background: P.line, flexShrink: 0 }} />
          <Column entry={right} />
        </div>
      </div>
    </div>
  );
}

// Source network graph — a small hand-rolled force layout (no charting
// library; the whole thing is under 100 lines and this is the only place in
// the app that needs one). Honest about what it actually shows: there's no
// real citation-graph data available here (that would mean fetching and
// cross-referencing every source's own reference list, which none of the 14
// upstream APIs hand back in one call) — so edges connect sources that
// share a journal, and every node also links faintly to the single
// highest-relevance source as a hub, so the layout stays readable instead
// of turning into scattered islands. Node size = relevance score.
function buildNetworkLayout(sources) {
  const n = sources.length;
  const nodes = sources.map((s, i) => {
    const angle = (i / n) * Math.PI * 2;
    return { s, x: 300 + Math.cos(angle) * 160, y: 220 + Math.sin(angle) * 160, vx: 0, vy: 0 };
  });
  const hubIdx = sources.reduce((best, s, i) => (s.relevance || 0) > (sources[best]?.relevance || 0) ? i : best, 0);
  const edges = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sameJournal = sources[i].journal && sources[i].journal === sources[j].journal;
      if (sameJournal) edges.push([i, j, 1]);
    }
    if (i !== hubIdx) edges.push([i, hubIdx, 0.25]);
  }
  for (let iter = 0; iter < 140; iter++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = nodes[j].x - nodes[i].x, dy = nodes[j].y - nodes[i].y;
        const distSq = Math.max(dx * dx + dy * dy, 1);
        const force = 2200 / distSq;
        const dist = Math.sqrt(distSq);
        const fx = (dx / dist) * force, fy = (dy / dist) * force;
        nodes[i].vx -= fx; nodes[i].vy -= fy;
        nodes[j].vx += fx; nodes[j].vy += fy;
      }
      nodes[i].vx += (300 - nodes[i].x) * 0.002;
      nodes[i].vy += (220 - nodes[i].y) * 0.002;
    }
    for (const [a, b, strength] of edges) {
      const dx = nodes[b].x - nodes[a].x, dy = nodes[b].y - nodes[a].y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const target = 130;
      const f = (dist - target) * 0.02 * strength;
      const fx = (dx / dist) * f, fy = (dy / dist) * f;
      nodes[a].vx += fx; nodes[a].vy += fy;
      nodes[b].vx -= fx; nodes[b].vy -= fy;
    }
    for (const node of nodes) {
      node.x += node.vx * 0.6; node.y += node.vy * 0.6;
      node.vx *= 0.75; node.vy *= 0.75;
      node.x = Math.max(30, Math.min(570, node.x));
      node.y = Math.max(30, Math.min(410, node.y));
    }
  }
  return { nodes, edges };
}

function SourceNetworkGraph({ P, accent, at, sources, close }) {
  useEffect(() => { const onKey = (e) => { if (e.key === "Escape") close(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [close]);
  const trapRef = useFocusTrap();
  const [hoverIdx, setHoverIdx] = useState(null);
  // Slicing happens INSIDE the memo callback, keyed on `sources` itself —
  // `sources.slice(...)` returns a new array reference every render, and a
  // useMemo keyed on that recomputes every time regardless, silently
  // defeating the whole point of memoizing a 140-iteration force layout
  // (it was re-running on every hoverIdx change, i.e. every mouse move over
  // a node). Keying on the actual `sources` prop — stable across renders
  // that don't change which sources are shown — fixes that.
  const { nodes, edges } = useMemo(() => buildNetworkLayout(sources.slice(0, 18)), [sources]);
  const sizeFor = (s) => 8 + Math.min(14, (s.relevance || 40) / 100 * 16);
  return (
    <div onClick={close} role="dialog" aria-modal="true" aria-label="Source relevance network" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} className="cb-backdrop">
      <div ref={trapRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} style={{ background: P.bg, borderRadius: 18, maxWidth: 680, width: "100%", boxShadow: "0 24px 80px rgba(0,0,0,0.5)", border: `1px solid ${P.line}`, outline: "none" }} className="cb-modal">
        <div style={{ padding: "18px 22px", borderBottom: `1px solid ${P.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: P.ink }}>Source network</div>
            <div style={{ fontSize: 11.5, color: P.faint, marginTop: 2 }}>Node size = relevance. Lines = shared journal, or a link to the strongest match.</div>
          </div>
          <button onClick={close} aria-label="Close" style={{ background: "none", border: "none", color: P.faint, cursor: "pointer", padding: 4, display: "inline-flex" }}><Icon name="close" size={18} /></button>
        </div>
        <svg viewBox="0 0 600 440" style={{ width: "100%", height: 420, display: "block" }}>
          {edges.map(([a, b, strength], i) => (
            <line key={i} x1={nodes[a].x} y1={nodes[a].y} x2={nodes[b].x} y2={nodes[b].y} stroke={P.line2 || P.line} strokeWidth={strength >= 1 ? 1.4 : 0.8} opacity={strength >= 1 ? 0.5 : 0.25} />
          ))}
          {nodes.map((node, i) => {
            const label = `${node.s.title || "Untitled source"}${node.s.journal ? ` — ${node.s.journal}` : ""}${node.s.relevance ? ` · ${node.s.relevance}% relevance` : ""}`;
            return (
              <g
                key={i}
                tabIndex={0}
                role="button"
                aria-label={label}
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)}
                onFocus={() => setHoverIdx(i)}
                onBlur={() => setHoverIdx(null)}
                style={{ cursor: "pointer" }}
              >
                <circle cx={node.x} cy={node.y} r={sizeFor(node.s)} fill={hoverIdx === i ? accent : withAlpha(accent, 0.55)} stroke={P.bg} strokeWidth={2} style={{ outline: "none" }} />
                {hoverIdx === i && (
                  <circle cx={node.x} cy={node.y} r={sizeFor(node.s) + 4} fill="none" stroke={accent} strokeWidth={1.5} opacity={0.6} />
                )}
              </g>
            );
          })}
        </svg>
        <div style={{ padding: "0 22px 20px", minHeight: 40 }}>
          {hoverIdx !== null && nodes[hoverIdx] && (
            <div style={{ fontSize: 12.5, color: P.ink2, lineHeight: 1.5 }}>
              <strong style={{ color: P.ink }}>{nodes[hoverIdx].s.title}</strong>{nodes[hoverIdx].s.journal ? ` — ${nodes[hoverIdx].s.journal}` : ""}{nodes[hoverIdx].s.relevance ? ` · ${nodes[hoverIdx].s.relevance}% relevance` : ""}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   AI-GENERATED CONCEPT ILLUSTRATIONS
   The literal "illustrations" feature: a quick, free, keyless visual
   sketch of the concept a question is about. Deliberately NOT presented
   as a data figure or anything derived from the cited papers — it's an
   image model's interpretation of the topic, said so plainly in the
   modal itself, right next to the image. Uses Pollinations' free, keyless
   image-generation endpoint (image.pollinations.ai) — already the same
   provider the backend races for text — via a plain <img src>, so this
   needed zero backend changes and no new API key.
   ════════════════════════════════════════════════════════════════ */

// Deterministic (per-query) seed — reopening the illustration for the same
// answer shows the same image instead of a fresh random one every time,
// while two different questions land on two different images. Tiny,
// non-cryptographic; only needs to spread inputs across a wide range.
function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h) % 1000000;
}

// Turns a research question into an image-generation prompt. Explicitly
// asks for no text/words/labels/watermark — image models reliably render
// garbled fake text when asked for a "diagram" or "labeled figure," and
// that reads as broken rather than illustrative. Better to let Cerebrum's
// own caption do the labeling than have the model attempt real typography.
function buildIllustrationPrompt(query) {
  const cleaned = (query || "").replace(/[?!]+/g, "").trim().slice(0, 220);
  return `${cleaned}. Scientific concept illustration, clean minimalist vector art, educational textbook diagram style, soft muted color palette, no text, no words, no letters, no labels, no watermark, no signature`;
}

function IllustrationModal({ P, accent, at, query, close }) {
  useEffect(() => { const onKey = (e) => { if (e.key === "Escape") close(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [close]);
  const trapRef = useFocusTrap();
  const [seed, setSeed] = useState(() => hashSeed(query || ""));
  const [status, setStatus] = useState("loading"); // "loading" | "ready" | "error"
  const prompt = useMemo(() => buildIllustrationPrompt(query), [query]);
  const imgUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=576&nologo=true&seed=${seed}`;

  useEffect(() => { setStatus("loading"); }, [imgUrl]);

  return (
    <div onClick={close} role="dialog" aria-modal="true" aria-label="Concept illustration" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} className="cb-backdrop">
      <div ref={trapRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} style={{ background: P.bg, borderRadius: 18, maxWidth: 640, width: "100%", boxShadow: "0 24px 80px rgba(0,0,0,0.5)", border: `1px solid ${P.line}`, outline: "none", overflow: "hidden" }} className="cb-modal">
        <div style={{ padding: "18px 22px", borderBottom: `1px solid ${P.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: P.ink }}>Concept illustration</div>
            <div style={{ fontSize: 11.5, color: P.faint, marginTop: 2 }}>AI-generated visual concept — not a data figure from the cited papers.</div>
          </div>
          <button onClick={close} aria-label="Close" style={{ background: "none", border: "none", color: P.faint, cursor: "pointer", padding: 4, display: "inline-flex" }}><Icon name="close" size={18} /></button>
        </div>
        <div style={{ position: "relative", aspectRatio: "16/9", background: P.surface }}>
          {status !== "error" && (
            <img
              key={imgUrl}
              src={imgUrl}
              alt={`AI-generated concept illustration for: ${query || "this question"}`}
              onLoad={() => setStatus("ready")}
              onError={() => setStatus("error")}
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", opacity: status === "ready" ? 1 : 0, transition: "opacity 0.4s ease" }}
            />
          )}
          {status === "loading" && (
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: P.faint }}>
              <div style={{ width: 26, height: 26, border: `2px solid ${P.line2}`, borderTopColor: accent, borderRadius: "50%", animation: "cbspin 0.8s linear infinite" }} />
              <span style={{ fontSize: 12, fontFamily: "var(--cb-mono)" }}>Generating illustration…</span>
            </div>
          )}
          {status === "error" && (
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: P.faint, padding: 20, textAlign: "center" }}>
              <Icon name="warning" size={20} />
              <span style={{ fontSize: 12.5 }}>Couldn't generate an illustration right now — the image service may be busy. Try again in a moment.</span>
            </div>
          )}
        </div>
        <div style={{ padding: "14px 22px 20px", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 11, color: P.faint, lineHeight: 1.5, maxWidth: 320 }}>
            Generated by an AI image model from your question alone — a conceptual sketch, not a scientific figure. Verify anything visual against the cited sources.
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button onClick={() => setSeed(Math.floor(Math.random() * 1000000))} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", fontSize: 12.5, fontWeight: 600, background: "transparent", color: P.ink2, border: `1px solid ${P.line2}`, borderRadius: 8, cursor: "pointer", fontFamily: "var(--cb-body)" }}><Icon name="refresh" size={13} />Regenerate</button>
            <a href={imgUrl} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", fontSize: 12.5, fontWeight: 600, background: accent, color: at, border: "none", borderRadius: 8, cursor: "pointer", textDecoration: "none", fontFamily: "var(--cb-body)" }}><Icon name="link" size={13} />Open full size</a>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   LITERATURE TIMELINE
   Plots the current answer's sources across publication year — purely
   client-side, reusing data already fetched for the answer itself, so
   this needed zero backend work. Answers the question a flat citation
   list can't: is this an established, decades-deep literature, or is
   everything from the last two years? Dot color reuses the same
   relevance tokens as the sources panel (STATUS.good/warn, P.faint) so
   the two views read as one consistent system rather than introducing
   a second, unrelated color language.
   ════════════════════════════════════════════════════════════════ */
function buildTimelineLayout(sources, width, margin) {
  const withYear = sources
    .map((s) => ({ s, year: parseInt(s.year, 10) }))
    .filter((x) => Number.isFinite(x.year) && x.year > 1500 && x.year <= new Date().getFullYear() + 1);
  if (!withYear.length) return { points: [], minYear: null, maxYear: null };
  const minYear = Math.min(...withYear.map((x) => x.year));
  const maxYear = Math.max(...withYear.map((x) => x.year));
  const span = Math.max(1, maxYear - minYear);
  const xFor = (year) => (minYear === maxYear ? width / 2 : margin + ((year - minYear) / span) * (width - margin * 2));
  // Stack same-year (or near-same-x) sources vertically so they don't
  // overlap into one indistinguishable blob.
  const byYear = new Map();
  for (const x of withYear) {
    if (!byYear.has(x.year)) byYear.set(x.year, []);
    byYear.get(x.year).push(x.s);
  }
  const points = [];
  for (const [year, group] of byYear) {
    group
      .slice()
      .sort((a, b) => (b.relevance || 0) - (a.relevance || 0))
      .forEach((s, i) => {
        points.push({ s, year, x: xFor(year), y: 90 - i * 24 });
      });
  }
  return { points, minYear, maxYear };
}

function LiteratureTimeline({ P, accent, at, sources, close }) {
  useEffect(() => { const onKey = (e) => { if (e.key === "Escape") close(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [close]);
  const trapRef = useFocusTrap();
  const [hoverIdx, setHoverIdx] = useState(null);
  const WIDTH = 640, MARGIN = 36;
  const { points, minYear, maxYear } = useMemo(() => buildTimelineLayout(sources, WIDTH, MARGIN), [sources]);
  const relColor = (r) => (r >= 65 ? STATUS.good : r >= 45 ? STATUS.warn : P.faint);
  const sizeFor = (s) => 6 + Math.min(10, (s.relevance || 40) / 100 * 12);
  const maxStack = points.reduce((m, p) => Math.max(m, 90 - p.y), 0);
  const height = Math.max(120, maxStack + 70);
  const ticks = minYear === null ? [] : minYear === maxYear ? [minYear] : Array.from(new Set([minYear, Math.round((minYear + maxYear) / 2), maxYear]));
  return (
    <div onClick={close} role="dialog" aria-modal="true" aria-label="Literature timeline" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} className="cb-backdrop">
      <div ref={trapRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} style={{ background: P.bg, borderRadius: 18, maxWidth: 700, width: "100%", boxShadow: "0 24px 80px rgba(0,0,0,0.5)", border: `1px solid ${P.line}`, outline: "none" }} className="cb-modal">
        <div style={{ padding: "18px 22px", borderBottom: `1px solid ${P.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: P.ink }}>Literature timeline</div>
            <div style={{ fontSize: 11.5, color: P.faint, marginTop: 2 }}>Dot size and color = relevance. Where this literature actually sits in time.</div>
          </div>
          <button onClick={close} aria-label="Close" style={{ background: "none", border: "none", color: P.faint, cursor: "pointer", padding: 4, display: "inline-flex" }}><Icon name="close" size={18} /></button>
        </div>
        {!points.length ? (
          <div style={{ padding: "40px 22px", textAlign: "center", color: P.faint, fontSize: 13 }}>None of these sources have a usable publication year to plot.</div>
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              <svg viewBox={`0 0 ${WIDTH} ${height}`} style={{ width: "100%", minWidth: 480, height: Math.min(height, 320), display: "block" }}>
                <line x1={MARGIN} y1={95} x2={WIDTH - MARGIN} y2={95} stroke={P.line2 || P.line} strokeWidth={1.5} />
                {ticks.map((yr, i) => {
                  const x = minYear === maxYear ? WIDTH / 2 : MARGIN + ((yr - minYear) / Math.max(1, maxYear - minYear)) * (WIDTH - MARGIN * 2);
                  return (
                    <g key={i}>
                      <line x1={x} y1={91} x2={x} y2={99} stroke={P.faint} strokeWidth={1} />
                      <text x={x} y={112} textAnchor="middle" fontSize={10.5} fill={P.faint} fontFamily="var(--cb-mono)">{yr}</text>
                    </g>
                  );
                })}
                {points.map((p, i) => (
                  <g
                    key={i}
                    tabIndex={0}
                    role="button"
                    aria-label={`${p.s.title || "Untitled source"}${p.s.journal ? ` — ${p.s.journal}` : ""}, ${p.year}${typeof p.s.relevance === "number" ? `, ${p.s.relevance}% relevance` : ""}`}
                    onMouseEnter={() => setHoverIdx(i)}
                    onMouseLeave={() => setHoverIdx(null)}
                    onFocus={() => setHoverIdx(i)}
                    onBlur={() => setHoverIdx(null)}
                    style={{ cursor: "pointer" }}
                  >
                    <line x1={p.x} y1={95} x2={p.x} y2={p.y} stroke={withAlpha(relColor(p.s.relevance || 0), 0.35)} strokeWidth={1} />
                    <circle cx={p.x} cy={p.y} r={sizeFor(p.s)} fill={hoverIdx === i ? accent : withAlpha(relColor(p.s.relevance || 0), 0.8)} stroke={P.bg} strokeWidth={1.5} style={{ outline: "none" }} />
                    {hoverIdx === i && <circle cx={p.x} cy={p.y} r={sizeFor(p.s) + 4} fill="none" stroke={accent} strokeWidth={1.5} opacity={0.6} />}
                  </g>
                ))}
              </svg>
            </div>
            <div style={{ padding: "0 22px 20px", minHeight: 40 }}>
              {hoverIdx !== null && points[hoverIdx] ? (
                <div style={{ fontSize: 12.5, color: P.ink2, lineHeight: 1.5 }}>
                  <strong style={{ color: P.ink }}>{points[hoverIdx].s.title}</strong>{points[hoverIdx].s.journal ? ` — ${points[hoverIdx].s.journal}` : ""} · {points[hoverIdx].year}{typeof points[hoverIdx].s.relevance === "number" ? ` · ${points[hoverIdx].s.relevance}% relevance` : ""}
                </div>
              ) : (
                <div style={{ fontSize: 11.5, color: P.faint, display: "flex", gap: 14, flexWrap: "wrap" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS.good, display: "inline-block" }} />Strong</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS.warn, display: "inline-block" }} />Partial</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: P.faint, display: "inline-block" }} />Weak</span>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Accounts modal — sign in / create account / passwordless email link, all
// three tabs in one place. Talks to /api/auth (see functions/api/auth.js).
// `onAuthed(user)` fires on a successful login/signup/magic-verify; the
// caller (App) is the one that decides what to do with the account's data
// (pull it down, offer to import local data, etc.) — this component only
// handles the credentials exchange itself.
const AUTH_TAB_IDS = ["login", "signup", "magic"];

// Rough, dependency-free password strength read — not a security control
// (the server-side PBKDF2 cost is what actually matters), just an honest
// nudge so "Create account" isn't a black box until the request fails.
function passwordStrength(pw) {
  if (!pw) return { label: "", score: 0 };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw) && /[^a-zA-Z0-9]/.test(pw)) score++;
  const label = pw.length < 8 ? "Too short" : score <= 1 ? "Weak" : score === 2 ? "Fair" : score === 3 ? "Good" : "Strong";
  const color = pw.length < 8 || score <= 1 ? STATUS.bad : score === 2 ? STATUS.warn : STATUS.good;
  return { label, score: Math.min(score, 4), color };
}

function AuthModal({ P, accent, at, close, onAuthed, initialTab }) {
  const [tab, setTab] = useState(initialTab || "login"); // "login" | "signup" | "magic"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [magicSent, setMagicSent] = useState(false);
  useEffect(() => { const onKey = (e) => { if (e.key === "Escape") close(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [close]);
  const trapRef = useFocusTrap();

  const strength = passwordStrength(password);
  const passwordsMismatch = tab === "signup" && confirmPassword.length > 0 && password !== confirmPassword;

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setError("");
    // Client-side confirm-password check before ever hitting the network —
    // a mismatch is the single most common signup mistake and shouldn't
    // need a round trip to catch.
    if (tab === "signup" && password !== confirmPassword) { setError("Those passwords don't match."); return; }
    setBusy(true);
    try {
      if (tab === "magic") {
        await apiAuth("magic-request", { email });
        setMagicSent(true);
      } else {
        const data = await apiAuth(tab === "signup" ? "signup" : "login", { email, password });
        onAuthed(data.user);
      }
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const switchTab = (id) => { setTab(id); setError(""); setMagicSent(false); setConfirmPassword(""); };

  // Underline tab bar — a real font/interaction distinct from the small
  // filled-pill mono-font segmented control used elsewhere (Settings,
  // command palette): larger body-font labels, a single indicator that
  // slides between tabs instead of each tab getting its own background fill.
  const tabIndex = AUTH_TAB_IDS.indexOf(tab);
  const tabBtn = (id, label) => (
    <button
      type="button"
      role="tab"
      id={`authtab-${id}`}
      aria-selected={tab === id}
      aria-controls="authtab-panel"
      tabIndex={tab === id ? 0 : -1}
      onClick={() => switchTab(id)}
      style={{ flex: 1, padding: "12px 0 13px", fontSize: 14, fontWeight: tab === id ? 700 : 500, letterSpacing: "-0.01em", border: "none", background: "transparent", cursor: "pointer", fontFamily: "var(--cb-body)", color: tab === id ? P.ink : P.faint, transition: "color 0.2s ease" }}
    >{label}</button>
  );

  const inputStyle = { width: "100%", padding: "11px 13px", fontSize: 14, borderRadius: 9, border: `1px solid ${P.line}`, background: P.dark ? "rgba(255,255,255,0.03)" : "#fff", color: P.ink, fontFamily: "var(--cb-body)", marginTop: 6 };

  return (
    <div onClick={close} role="dialog" aria-modal="true" aria-label="Sign in to Cerebrum" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 215, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} className="cb-backdrop">
      <div ref={trapRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} style={{ background: P.bg, borderRadius: 18, maxWidth: 400, width: "100%", boxShadow: "0 24px 80px rgba(0,0,0,0.5)", border: `1px solid ${P.line}`, outline: "none" }} className="cb-modal">
        <div style={{ padding: "26px 26px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em", color: P.ink, fontFamily: "var(--cb-display)" }}>Your account</div>
          <button onClick={close} aria-label="Close" style={{ background: "none", border: "none", color: P.faint, cursor: "pointer", padding: 4, display: "inline-flex" }}><Icon name="close" size={18} /></button>
        </div>
        <div style={{ padding: "18px 26px 0" }}>
          <div role="tablist" aria-label="Account access method" style={{ position: "relative", display: "flex", borderBottom: `1px solid ${P.line}` }}>
            {tabBtn("login", "Sign in")}
            {tabBtn("signup", "Create account")}
            {tabBtn("magic", "Email link")}
            <div aria-hidden="true" style={{ position: "absolute", bottom: -1, left: `${(tabIndex / AUTH_TAB_IDS.length) * 100}%`, width: `${100 / AUTH_TAB_IDS.length}%`, height: 2, background: accent, borderRadius: 2, transition: "left 0.25s cubic-bezier(0.4, 0, 0.2, 1)" }} />
          </div>
        </div>
        {magicSent ? (
          <div id="authtab-panel" role="tabpanel" aria-labelledby={`authtab-${tab}`} style={{ padding: "24px 26px 30px", textAlign: "center" }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: withAlpha(accent, 0.12), color: accent, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}><Icon name="link" size={20} /></div>
            <div style={{ fontSize: 14.5, fontWeight: 600, color: P.ink, marginBottom: 6 }}>Check your inbox</div>
            <div style={{ fontSize: 13, color: P.ink2, lineHeight: 1.6 }}>We sent a one-time sign-in link to <strong>{email}</strong>. It expires in 15 minutes.</div>
          </div>
        ) : (
          <form id="authtab-panel" role="tabpanel" aria-labelledby={`authtab-${tab}`} onSubmit={submit} style={{ padding: "18px 26px 26px" }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: P.ink2 }}>
              Email
              <input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} placeholder="you@example.com" aria-label="Email" />
            </label>
            {tab !== "magic" && (
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: P.ink2, marginTop: 14 }}>
                Password
                <input type="password" required minLength={8} autoComplete={tab === "signup" ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} placeholder={tab === "signup" ? "At least 8 characters" : "••••••••"} aria-label="Password" />
              </label>
            )}
            {tab === "signup" && password.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7 }}>
                <div style={{ flex: 1, height: 4, borderRadius: 2, background: P.dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)", overflow: "hidden" }}>
                  <div style={{ width: `${Math.min(strength.score, 4) / 4 * 100}%`, height: "100%", background: strength.color, borderRadius: 2, transition: "width 0.2s ease, background 0.2s ease" }} />
                </div>
                <span style={{ fontSize: 11, fontWeight: 600, color: strength.color, fontFamily: "var(--cb-mono)", flexShrink: 0 }}>{strength.label}</span>
              </div>
            )}
            {tab === "signup" && (
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: P.ink2, marginTop: 14 }}>
                Confirm password
                <input type="password" required minLength={8} autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} style={{ ...inputStyle, borderColor: passwordsMismatch ? STATUS.bad : P.line }} placeholder="Type it again" aria-label="Confirm password" aria-invalid={passwordsMismatch} />
                {passwordsMismatch && <span style={{ display: "block", fontSize: 11.5, color: STATUS.bad, marginTop: 5, fontWeight: 500 }}>Doesn't match yet</span>}
                {tab === "signup" && confirmPassword.length > 0 && !passwordsMismatch && confirmPassword.length >= 8 && (
                  <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, color: STATUS.good, marginTop: 5, fontWeight: 500 }}><Icon name="check" size={11} />Passwords match</span>
                )}
              </label>
            )}
            {tab === "magic" && <div style={{ fontSize: 12.5, color: P.faint, marginTop: 10, lineHeight: 1.5 }}>No password needed — we'll email you a link that signs you in.</div>}
            {error && <div role="alert" style={{ marginTop: 14, padding: "9px 12px", borderRadius: 8, background: withAlpha(STATUS.bad, 0.1), color: STATUS.bad, fontSize: 12.5, lineHeight: 1.5 }}>{error}</div>}
            <button type="submit" disabled={busy || passwordsMismatch} style={{ width: "100%", marginTop: 18, padding: "12px", fontSize: 14, fontWeight: 600, background: accent, color: at, border: "none", borderRadius: 10, cursor: (busy || passwordsMismatch) ? "default" : "pointer", opacity: (busy || passwordsMismatch) ? 0.7 : 1, fontFamily: "var(--cb-body)" }}>
              {busy ? "Please wait…" : tab === "signup" ? "Create account" : tab === "magic" ? "Send sign-in link" : "Sign in"}
            </button>
            <div style={{ fontSize: 11, color: P.faint, marginTop: 14, lineHeight: 1.6 }}>
              Passwords are hashed, never stored in plain form. Saved articles, collections, and history stay local unless you sign in — see <a href="/privacy" style={{ color: P.faint, borderBottom: `1px dotted ${P.faint}`, textDecoration: "none" }}>Privacy</a> for exactly what that means.
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function LocalSlider({ label, value, min, max, step, format, onCommit, accent, P }) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  const commit = () => { if (local !== value) onCommit(local); };
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: P.ink2 }}>{label}</span>
        <span style={{ fontSize: 11, color: P.faint, fontFamily: "var(--cb-mono)" }}>{format(local)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={local} onChange={(e) => setLocal(parseFloat(e.target.value))} onMouseUp={commit} onTouchEnd={commit} onKeyUp={commit} style={{ width: "100%", accentColor: accent, cursor: "pointer" }} />
    </div>
  );
}


/* ════════════════════════════════════════════════════════════════
   SETTINGS v4 — Full iOS-style redesign
   Grouped sections, proper alignment, accessibility, real settings
   ════════════════════════════════════════════════════════════════ */
function Settings({ P, accent, at, S, PALETTES, ACCENTS, paletteName, setPaletteName, accentName, setAccentName, customAccent, setCustomAccent, answerLength, setAnswerLength, factCheck, setFactCheck, muted, setMuted, typewriter, setTypewriter, soundMode, setSoundMode, animationMode, setAnimationMode, animPreset, setAnimPreset, animDensity, setAnimDensity, animSpeed, setAnimSpeed, animOpacity, setAnimOpacity, sfx, setSessions, setSaved, saved, history, setHistory, highContrast, setHighContrast, fontSize, setFontSize, reducedTransparency, setReducedTransparency, autoplay, setAutoplay, dyslexicFont, setDyslexicFont, lineSpacing, setLineSpacing, focusHighlight, setFocusHighlight, citationStyle, setCitationStyle, user, onSignOut, onAccountDeleted, onOpenAuth, initialTab, close }) {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState(initialTab || "general");
  const [confirmClear, setConfirmClear] = useState(false);
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState("");
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false);
  const [delBusy, setDelBusy] = useState(false);

  async function submitPassword(e) {
    e.preventDefault();
    if (pw1.length < 8) { setPwMsg("Password must be at least 8 characters."); return; }
    if (pw1 !== pw2) { setPwMsg("Passwords don't match."); return; }
    setPwBusy(true); setPwMsg("");
    try { await apiAuth("set-password", { password: pw1 }); setPwMsg("Password updated."); setPw1(""); setPw2(""); }
    catch (err) { setPwMsg(err.message || "Couldn't update password."); }
    finally { setPwBusy(false); }
  }
  async function submitDeleteAccount() {
    setDelBusy(true);
    try { await apiAuth("delete-account", {}); onAccountDeleted(); close(); }
    catch (err) { setPwMsg(err.message || "Couldn't delete account."); setDelBusy(false); }
  }

  const TABS = [
    ["account", "Account"],
    ["general", "General"],
    ["appearance", "Appearance"],
    ["accessibility", "Accessibility"],
    ["audio", "Audio & Voice"],
    ["data", "History & Data"],
  ];

  /* ── Building blocks — restyled to match Cerebrum's own glass/editorial
     language (the version this replaced was a literal iOS Settings clone:
     system-gray panels, iOS green switches, thin-weight system-font labels —
     nothing here matched the rest of the app, which is dark glass, accent-
     driven controls, and a deliberately weightier type scale). ── */
  const bg = P.dark ? withAlpha(P.surface, 0.55) : P.surface;
  const divider = P.dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)";
  const sectionBg = "transparent";
  const glassBorderS = P.dark ? `1px solid ${withAlpha(P.ink2, 0.1)}` : `1px solid ${P.line2}`;

  const Section = ({ title, footer, children }) => (
    <div style={{ marginBottom: 22 }}>
      {title && <div style={{ fontSize: 11, fontWeight: 600, color: P.faint, marginBottom: 8, paddingLeft: 2, textTransform: "uppercase", fontFamily: "var(--cb-mono)", letterSpacing: "0.08em" }}>{title}</div>}
      <div style={{ background: bg, border: glassBorderS, borderRadius: 14, overflow: "hidden", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}>{children}</div>
      {footer && <div style={{ fontSize: 12.5, color: P.faint, marginTop: 8, paddingLeft: 2, lineHeight: 1.5 }}>{footer}</div>}
    </div>
  );

  const Row = ({ icon, label, desc, control, onClick, last, destructive }) => (
    <div onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 16px", cursor: onClick ? "pointer" : "default", borderBottom: last ? "none" : `1px solid ${divider}` }}>
      {icon && <span style={{ fontSize: 18, width: 28, height: 28, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{icon}</span>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, color: destructive ? STATUS.bad : P.ink, fontWeight: 500, fontFamily: "var(--cb-body)", letterSpacing: "-0.01em" }}>{label}</div>
        {desc && <div style={{ fontSize: 12.5, color: P.faint, lineHeight: 1.4, marginTop: 2 }}>{desc}</div>}
      </div>
      {control && <div style={{ flexShrink: 0 }}>{control}</div>}
      {onClick && !control && <span style={{ color: P.faint, fontSize: 16 }}>›</span>}
    </div>
  );

  const Switch = ({ on, onChange, label }) => (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => { sfx(); onChange(!on); }}
      style={{ width: 44, height: 26, borderRadius: 14, position: "relative", background: on ? accent : P.dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.14)", border: "none", cursor: "pointer", padding: 0, transition: "background 220ms ease" }}>
      <span style={{ position: "absolute", top: 2, left: 2, width: 22, height: 22, borderRadius: "50%", background: "#fff", transform: on ? "translateX(18px)" : "translateX(0)", transition: "transform 220ms cubic-bezier(0.4, 0, 0.2, 1)", boxShadow: "0 2px 6px rgba(0,0,0,0.25)" }} />
    </button>
  );

  const Picker = ({ value, options, onChange }) => (
    <select value={value} onChange={(e) => { sfx(); onChange(e.target.value); }}
      style={{ padding: "6px 10px", fontSize: 15, color: accent, background: "transparent", border: "none", cursor: "pointer", fontFamily: "var(--cb-body)", fontWeight: 500, outline: "none", ...selectChrome(P) }}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );

  return (
    <div role="dialog" aria-modal="true" aria-label="Settings" style={{ position: "fixed", inset: 0, background: P.dark ? "rgba(0,0,0,0.65)" : "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 40, padding: 16 }} onClick={close} className="cb-backdrop">
      <div onClick={(e) => e.stopPropagation()} className="cb-modal" style={{ background: P.dark ? withAlpha(P.bg, 0.92) : withAlpha("#ffffff", 0.96), backdropFilter: "blur(28px) saturate(1.3)", WebkitBackdropFilter: "blur(28px) saturate(1.3)", border: glassBorderS, borderRadius: isMobile ? 16 : 18, width: 520, maxWidth: "100%", maxHeight: isMobile ? "92dvh" : "85vh", display: "flex", flexDirection: "column", fontFamily: "var(--cb-body)", boxShadow: "0 24px 80px rgba(0,0,0,0.5)", overflow: "hidden" }}>

        {/* Header */}
        <div style={{ padding: "20px 22px 0", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div style={{ fontSize: 21, fontWeight: 600, color: P.ink, letterSpacing: "-0.02em", fontFamily: "var(--cb-display)" }}>Settings</div>
            <button onClick={close} aria-label="Close" style={{ background: P.dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)", border: "none", width: 30, height: 30, borderRadius: "50%", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: P.ink2 }}><Icon name="close" size={14} /></button>
          </div>

          {/* Tab bar — a sliding underline indicator instead of the filled
              segmented-pill look this used to share with the command
              palette/dropdown chrome elsewhere. Same pattern as AuthModal's
              tab bar now uses, so the two places in the app with real
              client-side tabs read as one deliberate system rather than
              each having invented its own. */}
          <div style={{ position: "relative", display: "flex", borderBottom: `1px solid ${P.line}`, marginBottom: 18 }}>
            {TABS.map(([id, label]) => (
              <button key={id} onClick={() => { sfx(); setTab(id); }}
                style={{ flex: 1, padding: isMobile ? "8px 2px 10px" : "9px 4px 11px", fontSize: isMobile ? 10.5 : 12.5, fontWeight: tab === id ? 700 : 500, background: "transparent", color: tab === id ? P.ink : P.faint, border: "none", cursor: "pointer", fontFamily: "var(--cb-body)", letterSpacing: "-0.01em", whiteSpace: "nowrap", transition: "color 200ms ease" }}>{label}</button>
            ))}
            <div aria-hidden="true" style={{ position: "absolute", bottom: -1, left: `${(TABS.findIndex(([id]) => id === tab) / TABS.length) * 100}%`, width: `${100 / TABS.length}%`, height: 2, background: accent, borderRadius: 2, transition: "left 250ms cubic-bezier(0.4, 0, 0.2, 1)" }} />
          </div>
        </div>

        {/* Content */}
        <div key={tab} className="cb-fade" style={{ padding: "0 16px 16px", overflowY: "auto", flex: 1, WebkitOverflowScrolling: "touch" }}>

          {tab === "account" && (<>
            {!user ? (
              <Section title="Account" footer="Signing in moves your saved articles, collections, and history to your account so they follow you to any device. Guest mode — everything you're using right now — keeps working exactly as-is if you never sign in.">
                <Row label="You're browsing as a guest" desc="Nothing here leaves this browser." control={
                  <button onClick={() => onOpenAuth("login")} style={{ padding: "8px 16px", fontSize: 13, fontWeight: 600, background: accent, color: at, border: "none", borderRadius: 8, cursor: "pointer" }}>Sign in</button>
                } last />
              </Section>
            ) : (<>
              <Section title="Account">
                <Row label={user.email} desc="Signed in" last />
              </Section>
              <Section title="Password" footer="Set a password so you can sign in without waiting on an email link every time.">
                <div style={{ padding: "14px 16px" }}>
                  <form onSubmit={submitPassword}>
                    <input type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} placeholder="New password (8+ characters)" aria-label="New password" style={{ width: "100%", padding: "10px 12px", fontSize: 13.5, borderRadius: 8, border: `1px solid ${P.line}`, background: "transparent", color: P.ink, marginBottom: 8 }} />
                    <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Confirm new password" aria-label="Confirm new password" style={{ width: "100%", padding: "10px 12px", fontSize: 13.5, borderRadius: 8, border: `1px solid ${P.line}`, background: "transparent", color: P.ink }} />
                    {pwMsg && <div style={{ fontSize: 12, color: pwMsg === "Password updated." ? STATUS.good : STATUS.bad, marginTop: 8 }}>{pwMsg}</div>}
                    <button type="submit" disabled={pwBusy} style={{ marginTop: 10, padding: "8px 16px", fontSize: 13, fontWeight: 600, background: withAlpha(accent, 0.12), color: accent, border: "none", borderRadius: 8, cursor: pwBusy ? "default" : "pointer", opacity: pwBusy ? 0.6 : 1 }}>{pwBusy ? "Saving…" : "Update password"}</button>
                  </form>
                </div>
              </Section>
              <Section title="Session">
                <Row label="Sign out" desc="Switches this browser back to guest mode." onClick={() => { onSignOut(); close(); }} last />
              </Section>
              <Section title="Danger zone" footer="Deleting your account permanently removes your email, password, saved articles, collections, and history from Cerebrum's servers immediately — this cannot be undone.">
                {!confirmDeleteAccount ? (
                  <Row label="Delete account" destructive onClick={() => setConfirmDeleteAccount(true)} last />
                ) : (
                  <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <span style={{ fontSize: 13, color: STATUS.bad }}>Permanently delete your account and all its data?</span>
                    <span style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                      <button onClick={() => setConfirmDeleteAccount(false)} style={{ padding: "6px 12px", fontSize: 12.5, background: "transparent", color: P.ink2, border: `1px solid ${P.line}`, borderRadius: 7, cursor: "pointer" }}>Cancel</button>
                      <button onClick={submitDeleteAccount} disabled={delBusy} style={{ padding: "6px 12px", fontSize: 12.5, fontWeight: 600, background: STATUS.bad, color: "#fff", border: "none", borderRadius: 7, cursor: delBusy ? "default" : "pointer" }}>{delBusy ? "Deleting…" : "Confirm delete"}</button>
                    </span>
                  </div>
                )}
              </Section>
            </>)}
          </>)}

          {tab === "general" && (<>
            <Section title="Responses">
              <Row label="Answer length" control={
                <Picker value={answerLength} options={[["short", "Concise"], ["medium", "Standard"], ["long", "Detailed"]]} onChange={setAnswerLength} />
              } />
              <Row label="Fact-check pass" desc="Runs a second verification pass over claims before showing the answer" control={<Switch on={factCheck} onChange={(v) => { sfx(); setFactCheck(v); }} label="Fact-check pass" />} />
              <Row label="Animated typing" desc="Reveals answers progressively as they're written" control={<Switch on={typewriter} onChange={setTypewriter} label="Typing animation" />} />
              <Row label="Citation format" control={
                <Picker value={citationStyle} options={[["vancouver", "Vancouver"], ["apa", "APA"], ["mla", "MLA"], ["chicago", "Chicago"], ["bibtex", "BibTeX"]]} onChange={setCitationStyle} />
              } last />
            </Section>

          </>)}

          {tab === "appearance" && (<>
            <Section title="Theme">
              <div style={{ display: "flex", gap: 8, padding: 12 }}>
                {Object.keys(PALETTES).map((pn) => (
                  <button key={pn} onClick={() => { sfx(); setPaletteName(pn); }}
                    style={{ flex: 1, padding: "14px 10px 10px", borderRadius: 10, cursor: "pointer", border: paletteName === pn ? `2px solid ${accent}` : `1px solid ${divider}`, background: PALETTES[pn].bg, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <span style={{ width: 22, height: 22, borderRadius: 6, background: PALETTES[pn].surface, border: `1px solid ${PALETTES[pn].line2}` }} />
                      <span style={{ width: 22, height: 22, borderRadius: 6, background: accent }} />
                    </div>
                    <span style={{ fontSize: 12, color: PALETTES[pn].ink, fontWeight: paletteName === pn ? 600 : 500, fontFamily: "var(--cb-body)" }}>{pn}</span>
                  </button>
                ))}
              </div>
            </Section>

            <Section title="Accent color">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, padding: "14px 16px", alignItems: "center" }}>
                {Object.keys(ACCENTS).map((an) => (
                  <button key={an} title={an} aria-label={an} onClick={() => { sfx(); setCustomAccent(""); setAccentName(an); }}
                    style={{ width: 32, height: 32, borderRadius: "50%", background: ACCENTS[an], border: (!customAccent && accentName === an) ? "3px solid #fff" : "2px solid transparent", cursor: "pointer", boxShadow: (!customAccent && accentName === an) ? `0 0 0 2px ${ACCENTS[an]}` : "none", transition: "all 200ms ease" }} />
                ))}
                <label style={{ width: 32, height: 32, borderRadius: "50%", border: `2px dashed ${P.faint}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }} title="Custom">
                  <input type="color" value={accent} onChange={(e) => setCustomAccent(e.target.value)} style={{ opacity: 0, width: 0, height: 0, position: "absolute" }} />
                  <span style={{ fontSize: 16, color: P.faint, lineHeight: 1 }}>+</span>
                </label>
              </div>
            </Section>

            {/* Motion lives here, once — it used to also have a duplicate
                on/off toggle over on the Accessibility tab that read a ref
                (`lastAnimModeRef`) never passed into this component, which
                threw a ReferenceError the instant anyone touched it. One
                control, one place, no crash. */}
            <Section title="Motion" footer="Off disables the background entirely — the same effect the Accessibility tab's old 'Reduce motion' toggle was meant to give you.">
              <Row label="Background animation" desc="Particles and entrance effects" control={
                <Picker value={animationMode} options={[["off", "Off"], ["subtle", "Subtle"], ["cinematic", "Full"]]} onChange={setAnimationMode} />
              } last />
            </Section>
          </>)}

          {tab === "accessibility" && (<>
            <Section title="Vision" footer="All changes apply immediately and persist across sessions.">
              <Row label="High contrast" desc="Maximum contrast between text and background" control={<Switch on={highContrast} onChange={(v) => { sfx(); setHighContrast(v); }} label="High contrast" />} />
              <Row label="Text size" control={
                <Picker value={fontSize} options={[["small", "Small"], ["medium", "Default"], ["large", "Large"], ["xlarge", "Extra Large"]]} onChange={(v) => { sfx(); setFontSize(v); }} />
              } />
              <Row label="Line spacing" desc="Increases space between lines of text" control={
                <Picker value={lineSpacing} options={[["normal", "Normal"], ["relaxed", "Relaxed"], ["loose", "Loose"]]} onChange={(v) => { sfx(); setLineSpacing(v); }} />
              } />
              <Row label="Reduce transparency" desc="Makes panels solid instead of frosted glass" control={<Switch on={reducedTransparency} onChange={(v) => { sfx(); setReducedTransparency(v); }} label="Reduce transparency" />} />
              <Row label="Focus indicators" desc="Shows a visible ring around the focused element" control={<Switch on={focusHighlight} onChange={(v) => { sfx(); setFocusHighlight(v); }} label="Focus indicators" />} last />
            </Section>

            <Section title="Reading" footer="OpenDyslexic is a typeface designed to increase readability for readers with dyslexia.">
              <Row label="Dyslexia-friendly font" desc="Uses OpenDyslexic typeface for body text" control={<Switch on={dyslexicFont} onChange={(v) => { sfx(); if (v) ensureDyslexicFont(); setDyslexicFont(v); }} label="Dyslexic font" />} last />
            </Section>

            <Section title="Audio assistance" footer="Voice and playback options live on the Audio & Voice tab.">
              <Row label="Auto-read answers" desc="Reads new answers aloud automatically" control={<Switch on={autoplay} onChange={(v) => { sfx(); setAutoplay(v); }} label="Auto-read" />} last />
            </Section>
          </>)}

          {tab === "audio" && (<>
            <Section title="Interface sounds">
              <Row label="Sound effects" desc="Click sounds and ambient tones while searching" control={<Switch on={!muted} onChange={(v) => setMuted(!v)} label="Sound effects" />} />
              <Row label="Search ambience" desc="Background tone while a search runs" control={
                <Picker value={soundMode} options={[["pulse", "Pulse"], ["shimmer", "Shimmer"], ["warm", "Warm"], ["minimal", "Minimal"]]} onChange={(v) => { setSoundMode(v); Audio.preview(v); }} />
              } last />
            </Section>

            <Section title="Text to speech" footer="Default voice uses Cerebrum's free servers. Add an ElevenLabs key for premium narration.">
              <TtsVoiceSetting P={P} accent={accent} at={at} S={S} sfx={sfx} />
              <ElevenLabsSetting P={P} accent={accent} at={at} S={S} sfx={sfx} />
            </Section>
          </>)}

          {tab === "data" && (<>
            <Section title="Conversation history" footer="Previous investigations are stored locally in your browser and never leave your device unless you open them.">
              <Row label="Saved conversations" desc={`${(history || []).length} conversation${(history || []).length === 1 ? "" : "s"} kept`} />
              {(history || []).length > 0 && (
                <Row label="Clear conversation history" destructive control={
                  <button onClick={() => { setHistory([]); sfx(); }} style={{ padding: "6px 14px", fontSize: 13, color: STATUS.bad, background: "transparent", border: "none", cursor: "pointer", fontWeight: 500, fontFamily: "var(--cb-body)" }}>Clear</button>
                } last />
              )}
            </Section>

            <Section title="Storage" footer="Saved articles and preferences are stored locally in your browser. Your search queries are sent to Cerebrum's server to run the search — see the Privacy page for details.">
              <Row label="Saved articles" desc={`${saved.length} article${saved.length === 1 ? "" : "s"} saved`} />
              <Row label="Clear all data" destructive control={
                confirmClear
                  ? <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => { setSessions([]); setSaved([]); setHistory([]); setConfirmClear(false); sfx(); }} style={{ padding: "6px 14px", fontSize: 13, fontWeight: 600, background: STATUS.bad, color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "var(--cb-body)" }}>Delete</button>
                      <button onClick={() => setConfirmClear(false)} style={{ padding: "6px 14px", fontSize: 13, color: P.ink2, background: "transparent", border: `1px solid ${P.line}`, borderRadius: 8, cursor: "pointer", fontFamily: "var(--cb-body)" }}>Cancel</button>
                    </div>
                  : <button onClick={() => setConfirmClear(true)} style={{ padding: "6px 14px", fontSize: 13, color: STATUS.bad, background: "transparent", border: "none", cursor: "pointer", fontWeight: 500, fontFamily: "var(--cb-body)" }}>Clear…</button>
              } last />
            </Section>

            <Section title="Keyboard shortcuts">
              <div style={{ padding: "4px 0" }}>
                {[[kbdLabel("K"), "Search"], [kbdLabel("J"), "New investigation"], [kbdLabel("B"), "Saved articles"], [kbdLabel("/"), "Settings"], [kbdLabel("D"), "Toggle light / dark"], ["Esc", "Close panel"]].map(([key, desc], i, arr) => (
                  <div key={desc} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: i < arr.length - 1 ? `1px solid ${divider}` : "none" }}>
                    <span style={{ fontSize: 14.5, color: P.ink, fontWeight: 500, fontFamily: "var(--cb-body)" }}>{desc}</span>
                    <kbd style={{ fontSize: 12, fontFamily: "var(--cb-mono)", color: P.faint, background: P.dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)", padding: "3px 8px", borderRadius: 6, fontWeight: 500 }}>{key}</kbd>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="About">
              <Row label="Version" control={<span style={{ fontSize: 14.5, color: P.faint, fontFamily: "var(--cb-mono)" }}>{APP_VERSION}</span>} />
              <Row label="Built by" control={<span style={{ fontSize: 14.5, color: accent, fontWeight: 500 }}>Vaticay</span>} last />
            </Section>
          </>)}

        </div>
      </div>
    </div>
  );
}


/* ════════════════════════════════════════════════════════════════
   STYLE SYSTEM v4 — "DARKNODE"
   
   Left-aligned editorial layout. Serif display headings. Deep navy
   glass surfaces. The search bar is a command line. Results read
   like a premium brief.
   ════════════════════════════════════════════════════════════════ */
function makeStyles(P, accent, at, isMobile = false) {
  const font = "var(--cb-body)";
  const pad = isMobile ? 18 : 32;
  const glass = P.dark 
    ? `${withAlpha(P.surface, 0.6)}` 
    : P.surface;
  const glassBorder = P.dark
    ? `1px solid ${withAlpha(P.ink2, 0.08)}`
    : `1px solid ${P.line2}`;

  return {
    /* ── Page shell ──
       v6.4: this used to be `position: fixed; height: 100dvh; overflow:
       hidden` with a single inner `.scroll` div doing all the scrolling —
       a classic "app-shell" pattern. That pattern is fragile against ANY
       zoom: after a pinch-zoom (mobile) or ctrl+scroll/trackpad zoom
       (desktop), the fixed shell's relationship to the browser's visual
       viewport can end up mismatched, and touch/wheel scroll gestures over
       the inner scrollable stop reaching it — "scrolling breaks after you
       zoom in," reported live. InfoPage (the /about, /privacy, etc. pages)
       never had this problem because it just lets the real document
       scroll. Bringing the main app in line with that same natural-scroll
       model removes this entire class of bug rather than patching it: the
       browser's own scroll/zoom handling is used unmodified, on both
       desktop and mobile. See the matching `scroll` key below, and the
       window-based scroll listeners in App() that replaced threadRef's div
       scrollTop/scrollHeight reads. */
    page: { minHeight: "100dvh", background: P.bg, color: P.ink, fontFamily: font, WebkitFontSmoothing: "antialiased", display: "flex", flexDirection: "column" },
    grain: { position: "fixed", inset: 0, pointerEvents: "none", opacity: P.grain, zIndex: 100, backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")" },

    /* ── Header: dark glass bar, minimal ──
       `position: sticky` combined with `backdrop-filter` on the same element
       is a known Chromium compositor trap: the filter forces its own paint
       layer, and when that layer also has to track scroll offset for
       stickiness, Chrome can mark the region under it as needing main-thread
       scroll handling and then never promptly re-check that determination as
       the page grows — mouse-wheel scroll goes dead over that region while a
       manual scrollbar drag (a different, compositor-level code path) keeps
       working fine. `translateZ(0)` + `will-change: transform` alone weren't
       enough to keep it off the main thread in practice, so the sticky
       element itself no longer carries the filter at all: it's just a plain
       positioned box now, and the blur lives on a separate `headerGlass`
       layer stacked behind the content with `pointer-events: none`. Splitting
       them means the thing that's actually `position: sticky` never triggers
       Chrome's filter-plus-stickiness repaint path in the first place. */
    header: {
      flexShrink: 0,
      position: "sticky", top: 0, zIndex: 20,
      transform: "translateZ(0)", willChange: "transform",
    },
    headerGlass: {
      position: "absolute", inset: 0, zIndex: -1, pointerEvents: "none",
      borderBottom: glassBorder,
      background: P.dark ? withAlpha(P.bg, 0.75) : withAlpha(P.bg, 0.85),
      backdropFilter: "blur(20px) saturate(1.3)",
      WebkitBackdropFilter: "blur(20px) saturate(1.3)",
    },
    headInner: { maxWidth: 1120, margin: "0 auto", padding: `0 ${pad}px`, height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" },
    brandRow: { display: "flex", alignItems: "center", gap: 10, cursor: "pointer" },
    brand: { fontWeight: 700, fontSize: 18, letterSpacing: "-0.03em", color: P.ink, fontFamily: "var(--cb-body)" },
    headActions: { display: "flex", alignItems: "center", gap: isMobile ? 1 : 4 },
    cmdHint: { display: "flex", alignItems: "center", gap: 8, background: P.dark ? withAlpha(P.surface, 0.5) : P.surface, border: glassBorder, color: P.ink2, padding: "7px 10px 7px 14px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontFamily: "var(--cb-mono)", boxShadow: P.shadowSm, marginRight: 4 },
    kbd: { fontSize: 10, fontFamily: "var(--cb-mono)", color: P.faint, background: P.dark ? withAlpha(P.raised, 0.6) : P.bg, border: `1px solid ${P.line2}`, borderRadius: 4, padding: "2px 6px", fontWeight: 500 },
    ghostBtn: { background: "transparent", border: "none", color: P.ink2, padding: isMobile ? "8px" : "8px 12px", borderRadius: 8, cursor: "pointer", fontSize: 13.5, fontWeight: 500, fontFamily: font },
    iconBtn: { background: "transparent", border: "none", color: P.ink2, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, height: 38, minWidth: isMobile ? 40 : 38, padding: isMobile ? "0 8px" : "0 12px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 500, fontFamily: "var(--cb-body)", position: "relative" },
    iconBtnLabel: { lineHeight: 1 },
    countPill: { fontSize: 10, fontWeight: 700, lineHeight: 1, background: accent, color: at, padding: "2px 6px", borderRadius: 20, minWidth: 16, textAlign: "center", marginLeft: isMobile ? 0 : -2, position: isMobile ? "absolute" : "static", top: isMobile ? 1 : undefined, right: isMobile ? 1 : undefined },

    /* ── Scroll area ── */
    // No longer a scroll container itself (see `page` note above) — the
    // real document scrolls now. `flex: 1` still lets it fill remaining
    // height below the sticky header on short pages, and the bottom padding
    // still clears the floating mobile "Sources" FAB.
    scroll: { flex: 1, paddingBottom: isMobile ? 88 : 0 },
    container: { maxWidth: 1200, margin: "0 auto", padding: `0 ${pad}px`, minHeight: "100%", display: "flex", flexDirection: "column" },

    /* ── Hero: LEFT-ALIGNED editorial layout ── */
    hero: { 
      flex: 1, display: "flex", flexDirection: "column", 
      alignItems: "center", justifyContent: "center", 
      textAlign: "center",
      padding: isMobile ? "32px 0 40px" : "40px 0 56px", 
      position: "relative",
    },
    heroGlow: { 
      position: "absolute", width: 800, height: 800, borderRadius: "50%", 
      background: `radial-gradient(circle, ${withAlpha(accent, P.dark ? 0.06 : 0.04)}, transparent 60%)`, 
      top: "-20%", left: "50%", transform: "translateX(-50%)", filter: "blur(100px)", pointerEvents: "none" 
    },
    heroMark: { marginBottom: 32, position: "relative" },
    heroTitle: {
      fontSize: isMobile ? 52 : 84, fontWeight: 700,
      letterSpacing: "-0.05em", lineHeight: 0.92,
      color: P.ink, marginBottom: 24, position: "relative",
      fontFamily: "var(--cb-body)",
    },
    heroSub: {
      fontSize: isMobile ? 16 : 19, color: P.ink2,
      maxWidth: 540, lineHeight: 1.65, marginBottom: 52,
      letterSpacing: "-0.01em", position: "relative", fontWeight: 400
    },

    /* ── Search bar: COMMAND CENTER ── */
    searchShell: { 
      display: "flex", alignItems: "center", gap: 12, 
      width: "100%", maxWidth: 700, 
      backdropFilter: "blur(24px) saturate(1.4)", 
      WebkitBackdropFilter: "blur(24px) saturate(1.4)", 
      background: glass, 
      border: glassBorder, 
      borderRadius: 14, 
      padding: isMobile ? "8px 8px 8px 16px" : "10px 10px 10px 20px", 
      boxShadow: P.shadow, 
      transition: "border-color 0.3s ease, box-shadow 0.3s ease", 
      position: "relative" 
    },
    searchShellActive: { 
      borderColor: withAlpha(accent, 0.4), 
      boxShadow: `${P.shadow}, 0 0 0 1px ${withAlpha(accent, 0.15)}, 0 0 40px ${withAlpha(accent, 0.06)}` 
    },
    searchInput: { 
      flex: 1, border: "none", outline: "none", background: "transparent", 
      fontFamily: "var(--cb-body)", fontSize: 15, color: P.ink, 
      minWidth: 0, letterSpacing: "-0.01em" 
    },
    searchBtn: { 
      fontSize: 14, fontWeight: 600, 
      background: accent, color: at, 
      border: "none", 
      padding: isMobile ? "12px 18px" : "12px 24px", 
      borderRadius: 10, cursor: "pointer", 
      fontFamily: "var(--cb-display)", flexShrink: 0, 
      letterSpacing: "0.01em",
      boxShadow: `0 2px 12px ${withAlpha(accent, 0.3)}` 
    },

    /* ── Suggestion chips ── */
    chips: { display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center", marginTop: 28, position: "relative", maxWidth: 700 },
    chip: { 
      fontSize: 13, color: P.ink2, 
      background: P.dark ? withAlpha(P.surface, 0.4) : withAlpha(P.surface, 0.7), 
      backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", 
      border: glassBorder, 
      borderRadius: 10, padding: "10px 16px", 
      cursor: "pointer", transition: "all 0.25s ease", 
      fontFamily: font, letterSpacing: "-0.01em" 
    },
    chipHover: { 
      borderColor: withAlpha(accent, 0.3), color: accent, 
      transform: "translateY(-2px)", 
      boxShadow: `0 4px 20px ${withAlpha(accent, 0.1)}` 
    },
    trustRow: { display: "flex", flexWrap: "wrap", gap: 20, marginTop: 56, opacity: 0.4 },
    trustItem: { fontSize: 11, fontWeight: 500, color: P.ink2, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "var(--cb-mono)" },

    /* ── Workspace: single-column editorial flow ──
       v6.4: widened from 760 to give the answer more room to breathe —
       previously the reading column was noticeably narrower than the answer
       card's own generous padding suggested it should be. */
    workspace: { display: "flex", flexDirection: "column", gap: 0, padding: isMobile ? "24px 0" : "40px 0", flex: 1, maxWidth: 900, margin: "0 auto", width: "100%" },
    workspaceMobile: { maxWidth: "100%" },
    // v5: on anything wide enough to spare the room, sources shouldn't live
    // behind a FAB the whole session — that was true on a phone (no room for
    // a second column) but never actually true on desktop, it was just the
    // one drawer pattern doing double duty. Widening the row and giving the
    // sidebar its own fixed column turns "tap to see your sources" into
    // "they're just there," which is the whole point of a research tool.
    workspaceWithSidebar: { flexDirection: "row", alignItems: "flex-start", gap: 28, maxWidth: 1160 },
    thread: { minWidth: 0, flex: 1 },
    sidebarCol: { width: 340, flexShrink: 0 },

    /* ── Turn: clean editorial brief ── */
    turn: { marginBottom: isMobile ? 40 : 56 },
    qLabel: { 
      fontSize: 10, fontWeight: 600, letterSpacing: "0.14em", 
      textTransform: "uppercase", color: accent, 
      marginBottom: 14, display: "flex", alignItems: "center", gap: 8,
      fontFamily: "var(--cb-mono)",
    },
    qDot: { width: 4, height: 4, borderRadius: "50%", background: accent, boxShadow: `0 0 6px ${withAlpha(accent, 0.5)}` },
    headline: { 
      fontWeight: 600, fontSize: isMobile ? 24 : 34, 
      lineHeight: 1.2, marginBottom: isMobile ? 20 : 28, 
      color: P.ink, letterSpacing: "-0.03em", 
      fontFamily: "var(--cb-display)",
    },

    /* ── Answer card: GLASSMORPHISM reading surface ── 
       Semi-transparent dark glass panel that separates 
       content from the animated background. The single 
       biggest premium upgrade. ── */
    answerCard: {
      background: P.dark ? "rgba(5,8,22,0.94)" : "rgba(255,255,255,0.88)",
      backdropFilter: "blur(16px) saturate(1.2)",
      WebkitBackdropFilter: "blur(16px) saturate(1.2)",
      border: P.dark ? "1px solid rgba(255,255,255,0.08)" : `1px solid ${P.line}`,
      borderRadius: 20,
      padding: isMobile ? "34px 24px" : "56px 64px",
      boxShadow: P.dark
        ? "0 0 0 0.5px rgba(255,255,255,0.04) inset, 0 12px 48px rgba(0,0,0,0.45), 0 4px 12px rgba(0,0,0,0.3)"
        : `${P.shadow}, 0 0 0 0.5px rgba(0,0,0,0.03)`,
      lineHeight: 1.85,
      fontSize: isMobile ? 16.5 : 18,
    },
    byline: { 
      fontSize: 10, color: P.faint, 
      paddingTop: 16, marginTop: 20, 
      fontFamily: "var(--cb-mono)", display: "flex",
      letterSpacing: "0.04em", textTransform: "uppercase",
    },
    aiTag: { fontSize: 10, color: P.faint, fontWeight: 500, letterSpacing: "0.04em", fontFamily: "var(--cb-mono)", textTransform: "uppercase" },
    loading: { display: "flex", alignItems: "center", gap: 12, color: P.ink2, fontSize: 14, padding: "14px 0 0" },
    spinner: { width: 16, height: 16, border: `2px solid ${P.line2}`, borderTopColor: accent, borderRadius: "50%", display: "inline-block", animation: "cbspin 0.7s linear infinite" },
    error: {
      padding: "20px 24px", background: withAlpha(STATUS.bad, 0.06), color: STATUS.bad,
      borderRadius: 14, fontSize: 14, lineHeight: 1.6,
      border: `1px solid ${withAlpha(STATUS.bad, 0.2)}`,
      display: "flex", alignItems: "flex-start", gap: 12,
      backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
    },
    followShell: { display: "flex", alignItems: "center", gap: 8, background: P.dark ? "rgba(5,8,22,0.85)" : "rgba(255,255,255,0.9)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", border: glassBorder, borderRadius: 14, padding: isMobile ? "10px 8px 10px 16px" : "12px 12px 12px 22px", boxShadow: P.shadow, transition: "border-color 0.3s ease, box-shadow 0.3s ease", marginTop: 24 },
    relatedWrap: { marginTop: 32, paddingTop: 28, borderTop: `1px solid ${P.line}` },
    relatedLabel: { fontSize: 10, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: P.faint, marginBottom: 16, fontFamily: "var(--cb-mono)", display: "flex", alignItems: "center", gap: 8 },
    relatedList: { display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 },
    relatedBtn: {
      display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: 12, textAlign: "left", padding: "14px 18px",
      fontSize: 13.5, background: P.dark ? withAlpha(P.surface, 0.5) : P.surface, color: P.ink2,
      border: glassBorder, borderRadius: 12,
      cursor: "pointer", fontFamily: font,
      transition: "all 0.25s ease", letterSpacing: "-0.01em",
      lineHeight: 1.45,
    },

    /* ── Sources panel: dark glass sidebar ──
       Same sticky + backdrop-filter compositor trap as `header` above, same
       fix: no filter on the sticky box itself, background/border/blur is a
       plain non-positioned wash instead. This one isn't inset-absolute like
       headerGlass because the panel's own height is content-driven (it's not
       a fixed-height bar), so a solid painted background on the box itself —
       just without `backdrop-filter` — sidesteps the bug without needing a
       separate layer. */
    panel: {
      position: "sticky", top: 24,
      background: P.dark ? withAlpha(P.bg, 0.92) : withAlpha(P.bg, 0.97),
      border: glassBorder, borderRadius: 16,
      padding: "20px", boxShadow: P.shadow,
      maxHeight: "calc(100dvh - 110px)", overflowY: "auto",
      transform: "translateZ(0)", willChange: "transform",
    },
    panelMobile: { position: "fixed", top: 0, right: 0, height: "100dvh", width: isMobile ? "88vw" : "380px", maxWidth: 400, borderRadius: 0, maxHeight: "none", zIndex: 30, boxShadow: "-8px 0 40px rgba(0,0,0,0.5)" },
    srcHead: { display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, fontWeight: 600, color: P.ink, marginBottom: 16, letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: "var(--cb-mono)" },
    srcCount: { fontSize: 10, fontWeight: 700, color: accent, background: withAlpha(accent, 0.1), padding: "3px 8px", borderRadius: 20, fontFamily: "var(--cb-mono)" },
    srcActions: { display: "flex", gap: 6, marginBottom: 12 },
    srcFilterInput: { width: "100%", padding: "9px 12px", fontSize: 12, border: glassBorder, background: P.dark ? withAlpha(P.bg, 0.5) : P.bg, color: P.ink, borderRadius: 8, outline: "none", fontFamily: "var(--cb-mono)", marginBottom: 10 },
    sortTabs: { display: "flex", gap: 2, background: P.dark ? withAlpha(P.bg, 0.4) : P.bg, padding: 3, borderRadius: 10, marginBottom: 14, border: `1px solid ${P.line}` },
    sortTab: { flex: 1, padding: "6px", fontSize: 11, background: "transparent", color: P.ink2, border: "none", borderRadius: 7, cursor: "pointer", fontFamily: "var(--cb-mono)", fontWeight: 600, transition: "all 0.2s ease" },
    sortTabActive: { background: P.dark ? P.raised : P.surface, color: P.ink, boxShadow: P.shadowSm, fontWeight: 600 },
    srcGroupLabel: { fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: accent, margin: "16px 0 8px", paddingBottom: 6, borderBottom: `1px solid ${P.line}`, fontFamily: "var(--cb-mono)" },
    sBtn: { flex: 1, fontSize: 11.5, padding: "8px", background: P.dark ? withAlpha(P.bg, 0.5) : P.bg, color: P.ink2, border: glassBorder, borderRadius: 8, cursor: "pointer", fontFamily: "var(--cb-mono)", fontWeight: 600 },
    sBtnP: { flex: 1, fontSize: 11.5, padding: "8px", background: accent, color: at, border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontFamily: "var(--cb-mono)" },
    savedNote: { fontSize: 11, color: accent, marginBottom: 12, fontFamily: "var(--cb-mono)" },
    zBox: { background: P.dark ? withAlpha(P.bg, 0.5) : P.bg, border: glassBorder, borderRadius: 10, padding: 12, marginBottom: 12, display: "flex", flexDirection: "column", gap: 8 },
    zIn: { padding: "9px 12px", fontSize: 12, border: glassBorder, background: P.dark ? withAlpha(P.surface, 0.4) : P.surface, color: P.ink, borderRadius: 8, outline: "none", fontFamily: "var(--cb-mono)" },
    zMsg: { fontSize: 11, color: accent, fontFamily: "var(--cb-mono)" },
    srcList: { display: "flex", flexDirection: "column", gap: 2 },
    empty: { fontSize: 13, color: P.faint, lineHeight: 1.5, padding: "12px 0" },
    srcItem: { padding: "16px 14px", margin: "0 -14px", borderRadius: 12, transition: "background 0.25s ease, transform 0.2s ease", borderBottom: `1px solid ${P.line}` },
    srcTitle: { fontSize: 13.5, textDecoration: "none", lineHeight: 1.45, fontWeight: 600, display: "block", marginBottom: 6, transition: "color 0.2s ease", letterSpacing: "-0.01em" },
    srcMeta: { fontSize: 11, color: P.ink2, lineHeight: 1.5, fontFamily: "var(--cb-mono)" },
    srcRow: { display: "flex", gap: 6, marginTop: 10 },
    chipMini: { fontSize: 10.5, padding: "4px 10px", border: "1px solid", borderRadius: 6, cursor: "pointer", fontFamily: "var(--cb-mono)", fontWeight: 600, background: "transparent", transition: "all 0.2s ease" },
    // v5: Copy/Share/Print used to be label-only text buttons while the
    // header and every other action row in the app is icon+label — one more
    // spot where the app quietly switched button anatomies mid-screen.
    answerActionBtn: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, padding: "6px 14px", background: "transparent", border: `1px solid ${P.line2}`, borderRadius: 8, color: P.ink2, cursor: "pointer", fontFamily: "var(--cb-mono)" },

    /* ── Footer ── */
    foot: { marginTop: "auto", padding: "32px 0 36px", textAlign: "center", borderTop: `1px solid ${P.line}`, marginLeft: isMobile ? 0 : -pad, marginRight: isMobile ? 0 : -pad, paddingLeft: pad, paddingRight: pad },
    footDbs: { fontSize: 10, letterSpacing: "0.06em", color: P.faint, lineHeight: 1.7, fontFamily: "var(--cb-mono)", textTransform: "uppercase" },

    /* ── Mobile sources FAB ── */
    mobSrcBtn: { position: "fixed", bottom: "calc(18px + env(safe-area-inset-bottom, 0px))", right: 18, background: accent, color: at, border: "none", borderRadius: 14, padding: "14px 20px", fontSize: 12, fontWeight: 600, cursor: "pointer", boxShadow: `0 6px 24px ${withAlpha(accent, 0.4)}, 0 2px 8px rgba(0,0,0,0.2)`, zIndex: 20, fontFamily: "var(--cb-mono)", display: "inline-flex", alignItems: "center", gap: 8, backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" },
    scrim: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", zIndex: 25 },

    /* ── Command palette ── */
    cmdWrap: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "14vh", zIndex: 50 },
    cmdBox: { width: 560, maxWidth: "92vw", background: P.dark ? P.surface : P.raised, border: glassBorder, borderRadius: 16, boxShadow: "0 24px 80px rgba(0,0,0,0.6)", overflow: "hidden", fontFamily: font },
    cmdInputRow: { display: "flex", alignItems: "center", gap: 12, padding: "16px 18px", borderBottom: `1px solid ${P.line}` },
    cmdInput: { flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 16, color: P.ink, fontFamily: "var(--cb-mono)" },
    cmdList: { maxHeight: 340, overflowY: "auto", padding: 8 },
    cmdSection: { fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: P.faint, padding: "12px 14px 6px", fontFamily: "var(--cb-mono)" },
    cmdItem: { width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", fontSize: 13.5, color: P.ink, background: "transparent", border: "none", borderRadius: 8, cursor: "pointer", fontFamily: font, textAlign: "left", transition: "background 0.15s" },

    /* ── Modals ── */
    modalWrap: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 40, padding: 16 },
    modal: { background: P.dark ? P.surface : P.raised, border: glassBorder, borderRadius: 18, padding: 28, width: 480, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", fontFamily: font, boxShadow: "0 24px 80px rgba(0,0,0,0.6)" },
    modalTitle: { fontSize: 24, fontWeight: 400, color: P.ink, marginBottom: 24, letterSpacing: "-0.03em", fontFamily: "var(--cb-display)" },
    setLabel: { fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: P.faint, marginBottom: 10, marginTop: 4, fontWeight: 600, fontFamily: "var(--cb-mono)" },
    palRow: { display: "flex", gap: 10, marginBottom: 24 },
    palCard: { flex: 1, display: "flex", flexDirection: "column", gap: 8, padding: "12px", borderRadius: 12, cursor: "pointer", border: "1px solid", alignItems: "flex-start", fontFamily: font },
    accentRow: { display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 24, alignItems: "center" },
    accentDot: { width: 26, height: 26, borderRadius: "50%", border: "none", cursor: "pointer", transition: "transform 0.2s" },
    customDot: { width: 26, height: 26, borderRadius: "50%", border: `1px dashed ${P.line2}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" },
    modalClose: { width: "100%", padding: "13px", fontSize: 14, fontWeight: 600, background: accent, color: at, border: "none", borderRadius: 10, cursor: "pointer", fontFamily: "var(--cb-display)" },
    soundGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 4 },
    soundBtn: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", fontSize: 12.5, background: P.dark ? withAlpha(P.bg, 0.5) : P.bg, color: P.ink2, border: glassBorder, borderRadius: 10, cursor: "pointer", fontFamily: "var(--cb-mono)", fontWeight: 600 },
    soundBtnActive: { color: P.ink, borderColor: withAlpha(accent, 0.4), background: withAlpha(accent, 0.06) },
  };
}

/* ============================================================
   TOAST NOTIFICATIONS
   Lightweight, dependency-free confirmation toasts. Any component calls
   toast("message") without prop-drilling — it dispatches a window
   CustomEvent that <ToastHost/> (mounted once in App) listens for and
   renders as a small floating notification. This replaces relying on a
   button's own label swapping to "Copied!", which is easy to miss and, if
   the underlying clipboard/share action silently fails (common: insecure
   context, permission denial, focus loss), never appears at all — so
   copyToClipboard() below always fires a toast on both success AND
   failure, making failures visible instead of silent.
   ============================================================ */
let cbToastId = 0;
function toast(message, opts = {}) {
  try {
    window.dispatchEvent(new CustomEvent("cb-toast", {
      detail: { id: ++cbToastId, message, tone: opts.tone || "success" },
    }));
  } catch {}
}

// Robust clipboard write with a visible outcome either way. navigator.clipboard
// can silently reject (insecure context, denied permission, lost focus) —
// previously several buttons had no .catch() at all, so a failure looked
// exactly like nothing happening. This always resolves to true/false and
// always shows a toast, plus falls back to the legacy execCommand path for
// browsers/contexts where the async Clipboard API is unavailable.
async function copyToClipboard(text, successMessage) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      toast(successMessage || "Copied to clipboard");
      return true;
    }
    throw new Error("Clipboard API unavailable");
  } catch {
    // Legacy fallback: a temporary offscreen textarea + document.execCommand.
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) {
        toast(successMessage || "Copied to clipboard");
        return true;
      }
      throw new Error("execCommand copy failed");
    } catch {
      toast("Couldn't copy — try selecting the text manually", { tone: "error" });
      return false;
    }
  }
}

function ToastHost({ P, accent }) {
  const [toasts, setToasts] = useState([]);
  useEffect(() => {
    const onToast = (e) => {
      const t = e.detail;
      setToasts((prev) => [...prev, t]);
      setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== t.id)), 2600);
    };
    window.addEventListener("cb-toast", onToast);
    return () => window.removeEventListener("cb-toast", onToast);
  }, []);
  if (!toasts.length) return null;
  return (
    // Bug: toasts (including the clipboard-copy/share confirmations and
    // failures) updated only visually — a screen-reader user got zero
    // announcement for any of them. role="status" + aria-live="polite"
    // makes assistive tech announce new toasts as they appear.
    <div role="status" aria-live="polite" style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 9999, display: "flex", flexDirection: "column", gap: 8, alignItems: "center", pointerEvents: "none" }}>
      {toasts.map((t) => (
        <div key={t.id} className="cb-toast-pop" style={{
          background: "rgba(18,20,32,0.96)", color: "#fff", padding: "10px 16px", borderRadius: 10,
          fontSize: 13, fontWeight: 500, fontFamily: "var(--cb-mono)", boxShadow: "0 8px 28px rgba(0,0,0,0.3)",
          border: `1px solid ${t.tone === "error" ? STATUS.bad : withAlpha(accent, 0.45)}`,
          display: "flex", alignItems: "center", gap: 8, maxWidth: "min(90vw, 420px)",
        }}>
          <span style={{ color: t.tone === "error" ? STATUS.bad : accent, display: "inline-flex" }}><Icon name={t.tone === "error" ? "warning" : "check"} size={14} /></span>
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}

function App() {
  const isMobile = useIsMobile();
  const [entered, setEntered] = useState(() => { try { return getCookie("cb_entered_v5") === "1"; } catch { return false; } });
  // V5 "what's new" announcement — shows once per browser, the first time
  // someone lands on the main app after this ships. Keyed off its own
  // localStorage flag rather than the entry cookie above, since a returning
  // user who already has cb_entered_v5 set (nothing to re-trigger) still
  // needs to see it exactly once.
  const [v5Open, setV5Open] = useState(false);
  useEffect(() => {
    if (!entered) return;
    try { if (localStorage.getItem("cb_seen_v6") !== "1") setV5Open(true); } catch {}
  }, [entered]);

  // ── Accounts. `user` stays null for guest mode, which is still the
  // overwhelming default — nothing below ever runs for someone who never
  // signs in, and their saved/history data never leaves localStorage.
  // `syncReady` gates the push-to-server effects further down so they can't
  // fire with stale pre-pull state and clobber a signed-in user's real data
  // before the initial pull (or the import-prompt decision) has resolved.
  const [user, setUser] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authInitialTab, setAuthInitialTab] = useState("login");
  const [syncReady, setSyncReady] = useState(false);
  const [importPrompt, setImportPrompt] = useState(null);
  const [collections, setCollections] = useState([]);
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [networkGraphSources, setNetworkGraphSources] = useState(null);
  const [timelineSources, setTimelineSources] = useState(null);
  const [illustrateQuery, setIllustrateQuery] = useState(null);

  async function handleAuthed(authedUser, { checkImport }) {
    setUser(authedUser);
    setAuthOpen(false);
    const [savedRes, histRes, colRes] = await Promise.all([apiDataGet("saved"), apiDataGet("history"), apiDataGet("collections")]);
    const serverSaved = savedRes?.items || [];
    const serverHist = histRes?.items || [];
    setCollections(colRes?.items || []);
    if (serverSaved.length > 0 || serverHist.length > 0) {
      // This account already has data (a returning session, or a second
      // device) — the server copy wins over whatever's in this browser.
      setSaved(serverSaved.map(({ id, createdAt, ...rest }) => rest));
      setHistory(serverHist.map((h) => ({ id: h.id, title: h.title, ts: h.createdAt, turns: h.turns, allSources: h.allSources })));
      setSyncReady(true);
    } else if (checkImport && (saved.length > 0 || history.length > 0)) {
      // Brand-new account, and this browser already had guest-mode data —
      // ask before silently attaching it. syncReady stays false until the
      // person answers, so the push effect can't fire on stale state first.
      setImportPrompt({ savedCount: saved.length, historyCount: history.length });
    } else {
      setSyncReady(true);
    }
  }

  // Restores an existing session on load, and completes a magic-link
  // sign-in when the browser arrives via the emailed `?magic=` link.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const magicToken = params.get("magic");
      if (magicToken) {
        window.history.replaceState({}, "", window.location.pathname);
        try {
          const data = await apiAuth("magic-verify", { token: magicToken });
          if (!cancelled) await handleAuthed(data.user, { checkImport: true });
        } catch (e) {
          if (!cancelled) toast(e.message || "That sign-in link didn't work.", { tone: "error" });
        }
        return;
      }
      const u = await apiWhoAmI();
      if (cancelled || !u) return;
      await handleAuthed(u, { checkImport: false });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signOut() {
    try { await apiAuth("logout", {}); } catch {}
    setUser(null); setSyncReady(false); setCollections([]);
    sfx();
  }

  // Deletion is real and immediate server-side (see functions/api/auth.js's
  // "delete-account" action — a cascading DELETE, not a soft flag). Clearing
  // the local mirrors too means nothing about the account lingers anywhere
  // this browser can still show, matching what "delete my account" should
  // actually mean.
  function onAccountDeleted() {
    setUser(null); setSyncReady(false); setCollections([]); setSaved([]); setHistory([]);
  }

  const [input, setInput] = useState("");
  // Previous conversations. This used to be dead state (`showHistory` was
  // declared and never read anywhere — a stub from an earlier attempt at
  // this exact feature that never got finished) while "New investigation"
  // silently threw the entire thread away with no way to get it back. Now
  // newSession() snapshots the outgoing thread here before clearing it.
  // Declared up here (rather than down by newSession()) because the
  // scroll-lock effect below reads historyOpen in its dependency array.
  const [history, setHistory] = useState(() => { try { return JSON.parse(localStorage.getItem("cb_history") || "[]"); } catch { return []; } });
  const [historyOpen, setHistoryOpen] = useState(false);
  // v5: destructive-delete confirmation used to be inconsistent three ways —
  // Settings' "Clear all data" had a real inline confirm, Saved's "Clear
  // all" popped a jarring unstyled native browser confirm() (the only place
  // in this whole custom-designed app that happened), and History's
  // per-item "Delete" had no confirmation at all. One pattern now: an
  // inline Cancel/Delete swap, same as Settings already had.
  const [confirmClearSaved, setConfirmClearSaved] = useState(false);
  const [historyConfirmId, setHistoryConfirmId] = useState(null);
  // Attached image (a figure, a screenshot of a chart, a photo of a
  // specimen) sent alongside the next question — see describeImage() on
  // the backend, which converts it to text via a vision model before it
  // ever reaches the retrieval pipeline.
  const [attachedImage, setAttachedImage] = useState(null); // data: URL
  const [attachedImageName, setAttachedImageName] = useState("");
  const imageInputRef = useRef(null);
  function onImagePicked(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("That file isn't an image."); return; }
    if (file.size > 8_000_000) { setError("That image is too large — try one under 8MB."); return; }
    const reader = new FileReader();
    reader.onload = () => { setAttachedImage(reader.result); setAttachedImageName(file.name); };
    reader.onerror = () => setError("Couldn't read that image — try another file.");
    reader.readAsDataURL(file);
  }
  const [turns, setTurns] = useState([]);
  const [pinnedSources, setPinnedSources] = useState([]);
  const [corrections, setCorrections] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [allSources, setAllSources] = useState([]);
  const [saved, setSaved] = useState(() => { try { return JSON.parse(localStorage.getItem("cb_saved") || "[]"); } catch { return []; } });
  const [savedOpen, setSavedOpen] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [mobilePanel, setMobilePanel] = useState(false);
  const [suggestions, setSuggestions] = useState(pick());
  const chipsPausedRef = useRef(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState("general");
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdQuery, setCmdQuery] = useState("");
  const [zoteroOpen, setZoteroOpen] = useState(false);
  const [srcSort, setSrcSort] = useState("relevance");
  const [srcFilter, setSrcFilter] = useState("");
  const [zKey, setZKey] = useState(""); const [zUser, setZUser] = useState(""); const [zMsg, setZMsg] = useState("");
  const [answerLength, setAnswerLength] = useState(() => getCookie("cb_len") || "medium");
  const [factCheck, setFactCheck] = useState(true);
  const [muted, setMuted] = useState(() => getCookie("cb_muted") === "1");
  const [soundMode, setSoundMode] = useState(() => getCookie("cb_snd") || "pulse");
  const [typewriter, setTypewriter] = useState(() => getCookie("cb_tw") !== "0");
  const [citationStyle, setCitationStyle] = useState(() => getCookie("cb_cite") || "vancouver");
  const [animationMode, setAnimationMode] = useState(() => getCookie("cb_anim") || "cinematic");
  // v5: this used to swap the chip row's content out from under the user
  // every 8s unconditionally — a real interaction hazard, not just a CSS
  // animation, since a keyboard user who tabs to a chip and takes >8s to
  // decide would submit a DIFFERENT question than the one they read. Pause
  // while any chip has hover or focus, and don't rotate at all when the
  // user has turned animations off in Settings. (This effect has to live
  // down here, after animationMode's own declaration — its dependency array
  // reads that binding, and a dependency array is evaluated eagerly on every
  // render, unlike the effect body itself; declaring it any earlier in the
  // component would be reading `animationMode` before its own `const` runs.)
  useEffect(() => {
    if (turns.length > 0 || animationMode === "off") return;
    const id = setInterval(() => { if (!chipsPausedRef.current) setSuggestions(pick()); }, 8000);
    return () => clearInterval(id);
  }, [turns.length, animationMode]);
  // Bug: three independent binary Switches (General>Motion "Background
  // effects", General>Motion "Reduced motion", Accessibility>Motion "Reduce
  // motion") used to each control this same 3-way ("off"|"subtle"|
  // "cinematic") value, but each only recognized two of the three states —
  // so enabling one could silently clobber a choice made via another. E.g.
  // Accessibility's "Reduce motion" (→"off") looked unchanged/unchecked on
  // General's "Reduced motion" switch, and toggling THAT switch set the
  // mode back to "subtle", silently re-enabling the animation the user had
  // just turned off. Fixed by making General's motion control a single
  // 3-way Picker (one authoritative control, no lossy binary projections),
  // and having Accessibility's on/off shortcut restore the user's last
  // non-off choice instead of hardcoding "cinematic" — tracked here.
  const lastAnimModeRef = useRef(animationMode !== "off" ? animationMode : "cinematic");
  useEffect(() => { if (animationMode !== "off") lastAnimModeRef.current = animationMode; }, [animationMode]);
  const [animPreset, setAnimPreset] = useState(() => getCookie("cb_animP") || "aurora");
  const [animDensity, setAnimDensity] = useState(() => parseFloat(getCookie("cb_animD") || "1"));
  const [animSpeed, setAnimSpeed] = useState(() => parseFloat(getCookie("cb_animS") || "1"));
  const [animOpacity, setAnimOpacity] = useState(() => parseFloat(getCookie("cb_animO") || "1"));
  const [highContrast, setHighContrast] = useState(() => getCookie("cb_hc") === "1");
  const [fontSize, setFontSize] = useState(() => getCookie("cb_fs") || "medium");
  const [reducedTransparency, setReducedTransparency] = useState(() => getCookie("cb_rt") === "1");
  const [autoplay, setAutoplay] = useState(() => getCookie("cb_ap") !== "0");
  const [dyslexicFont, setDyslexicFont] = useState(() => getCookie("cb_df") === "1");
  const [lineSpacing, setLineSpacing] = useState(() => getCookie("cb_ls") || "normal");
  const [focusHighlight, setFocusHighlight] = useState(() => getCookie("cb_fh") === "1");
  const [paletteName, setPaletteName] = useState(() => getCookie("cb_pal") || "Dark");
  const [accentName, setAccentName] = useState(() => getCookie("cb_accent") || "Emerald");
  const [customAccent, setCustomAccent] = useState(() => getCookie("cb_ca") || "");
  const [hover, setHover] = useState("");
  const [hoverCite, setHoverCite] = useState(0);
  const inputRef = useRef(null);
  const cmdRef = useRef(null);
  const threadRef = useRef(null);
  const mutedRef = useRef(false);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  const P = PALETTES[paletteName] || PALETTES.Dark;
  const accent = customAccent && /^#[0-9a-fA-F]{6}$/.test(customAccent) ? customAccent : (ACCENTS[accentName] || ACCENTS.Emerald);
  const at = accentText(accent);
  // v6.4 perf: makeStyles() builds a large tree of inline-style objects —
  // previously rebuilt from scratch on every single render (every keystroke
  // in the search box, every hover-state change, every busy tick during a
  // typewriter animation). Memoizing it means that work only happens when
  // something it actually depends on changes.
  const S = useMemo(() => makeStyles(P, accent, at, isMobile), [P, accent, at, isMobile]);
  const sfx = () => { if (!mutedRef.current) Audio.click(); };

  // Scroll progress bar
  // v6.4: reads window/document scroll now instead of a dedicated inner
  // scroll div — see the `page`/`scroll` style notes in makeStyles() for why.
  const [scrollProg, setScrollProg] = useState(0);
  const [showScrollTop, setShowScrollTop] = useState(false);
  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      const top = window.scrollY || doc.scrollTop || 0;
      setScrollProg(max > 0 ? top / max : 0);
      setShowScrollTop(top > 400);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [entered]);

  const ask = useCallback(async (q, opts = {}) => {
    const question = (q ?? input).trim();
    const imageToSend = attachedImage;
    if ((!question && !imageToSend) || busy) return;
    if (!mutedRef.current) Audio.click();
    setInput(""); setAttachedImage(null); setAttachedImageName(""); setBusy(true); setError(""); setCmdOpen(false); if (isMobile) setMobilePanel(false);
    const prior = [];
    turns.slice(-10).forEach((t) => { prior.push({ role: "user", content: t.q }); prior.push({ role: "assistant", content: t.answer, sources: t.sources || [] }); });
    try {
      const priorUserTurn = [...turns].reverse().find((t) => t && t.q);
      const videoQuery = (priorUserTurn && priorUserTurn.q && looksLikeFollowupText(question)) ? priorUserTurn.q + " " + question : question;
      const videosPromise = imageToSend ? Promise.resolve({ videos: [] }) : fetch("/api/videos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: videoQuery }) }).then((r) => r.ok ? r.json() : { videos: [] }).catch(() => ({ videos: [] }));
      const res = await fetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: question, image: imageToSend || undefined, history: prior, settings: { answerLength, factCheck }, pinnedSources, corrections }) });
      // Bug: res.json() throwing on a malformed/empty/non-JSON body (still
      // possible on a 200, e.g. an edge timeout truncating the response) used
      // to fall straight into the outer catch below, which reports "Couldn't
      // reach the backend" — misleading, since the backend WAS reached; the
      // response just wasn't valid JSON. Distinguish the two cases.
      let data;
      try { data = await res.json(); }
      catch { setError("Got an unexpected response from the server. Try that again?"); setBusy(false); return; }
      if (!data || typeof data !== "object") { setError("Got an unexpected response from the server. Try that again?"); setBusy(false); return; }
      if (!res.ok) { setError(data.error || "Something went sideways. Try that again?"); setBusy(false); return; }
      const turnId = Date.now() + Math.random();
      const nt = { id: turnId, q: question || "What does this image show?", hasImage: !!imageToSend, answer: data.answer || "", sources: data.sources || [], videos: data.videos || [], source: data.source || "", factCheck: data.factCheck || null, related: data.related || [], suggestions: data.suggestions || [], fresh: typewriter };
      const looksLikeCorrection = /^(actually|no,?\s+it['']?s|no,?\s+they['']?re|correction[:,]|wrong\b|that['']?s\s+(wrong|incorrect|not right))/i.test(question) || /you\s+(said|got|had|were)\s+.+\s+(wrong|actually|but|however)/i.test(question) || /\bnot\s+\w+,?\s+(it['']?s|they['']?re|but)\s+/i.test(question);
      if (looksLikeCorrection) { setCorrections((prev) => [...prev, question].slice(-20)); }
      setTurns((t) => [...t, nt]);
      setAllSources((prev) => { const seen = new Set(prev.map(sourceKey)); return [...prev, ...(data.sources || []).filter((s) => !seen.has(sourceKey(s)))]; });
      if (turns.length === 0) setSessions((s) => [{ q: question, ts: Date.now() }, ...s].slice(0, 40));
      if (!mutedRef.current) Audio.pop();
      videosPromise.then(({ videos }) => { if (videos && videos.length) { setTurns((prev) => prev.map((t) => t.id === turnId ? { ...t, videos } : t)); } });
    } catch (e) { setError(`Couldn't reach the backend. Give it a second and try again. (${e.message})`); }
    finally { setBusy(false); }
  }, [input, attachedImage, busy, turns, answerLength, factCheck, typewriter, isMobile, pinnedSources, corrections]);

  useEffect(() => { if (entered && !isMobile && !cmdOpen) inputRef.current?.focus(); }, [entered, isMobile, cmdOpen]);
  // v6.4: was threadRef.current.scrollTop = threadRef.current.scrollHeight —
  // unconditionally, on every new turn AND every busy toggle. That's a real
  // regression on its own: if someone scrolls UP to re-read an earlier
  // answer and then asks a follow-up (or the current answer just finishes
  // streaming), this used to yank them all the way back down regardless of
  // where they were reading — reported live as the page "jumping" out from
  // under them. Standard chat-UI fix: only auto-scroll-to-latest if the
  // user was ALREADY near the bottom (i.e. they were following along), so
  // scrolling away to read something is respected instead of fought.
  useEffect(() => {
    const doc = document.documentElement;
    const distanceFromBottom = doc.scrollHeight - (window.scrollY + doc.clientHeight);
    const wasNearBottom = distanceFromBottom < 300;
    if (wasNearBottom) window.scrollTo(0, doc.scrollHeight);
  }, [turns, busy]);
  useEffect(() => { if (busy && !muted) Audio.startAmbient(soundMode); else Audio.stopAmbient(); return () => Audio.stopAmbient(); }, [busy, muted, soundMode]);
  useEffect(() => { document.body.style.background = P.bg; }, [P]);
  // v6.4: the page now uses natural document scrolling (see makeStyles'
  // `page` note) instead of a fixed non-scrolling shell. The old fixed
  // shell had a free side effect: the background could never scroll behind
  // an open modal/overlay, because it never scrolled at all. Now that the
  // document genuinely scrolls, an open modal needs its own explicit
  // scroll-lock or the page behind it will scroll along with touch/wheel
  // input that misses the modal's own content.
  //
  // v6.4 follow-up: a plain `body.style.overflow = "hidden"` toggle is a
  // known-unreliable way to lock scroll — several browsers/engines don't
  // reliably preserve the exact scroll offset across that toggle, which can
  // present as the page snapping back to the top the moment a modal closes.
  // Pin the body at its current visual scroll position explicitly instead
  // (the standard robust scroll-lock pattern) and restore that exact
  // position on close, rather than trusting the browser to remember it.
  useEffect(() => {
    const anyOverlayOpen = cmdOpen || savedOpen || settingsOpen || howItWorksOpen || mobilePanel || historyOpen
      || authOpen || collectionsOpen || compareOpen || !!networkGraphSources || !!timelineSources || !!illustrateQuery || !!importPrompt || v5Open;
    if (!anyOverlayOpen) return;
    const scrollY = window.scrollY;
    const body = document.body;
    const prev = { overflow: body.style.overflow, position: body.style.position, top: body.style.top, width: body.style.width };
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    return () => {
      body.style.overflow = prev.overflow;
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.width = prev.width;
      window.scrollTo(0, scrollY);
    };
  }, [cmdOpen, savedOpen, settingsOpen, howItWorksOpen, mobilePanel, historyOpen, authOpen, collectionsOpen, compareOpen, networkGraphSources, timelineSources, illustrateQuery, importPrompt, v5Open]);
  useEffect(() => { setCookie("cb_snd", soundMode); }, [soundMode]);
  useEffect(() => { setCookie("cb_len", answerLength); }, [answerLength]);
  useEffect(() => { setCookie("cb_fc", factCheck ? "1" : "0"); }, [factCheck]);
  useEffect(() => { setCookie("cb_muted", muted ? "1" : "0"); }, [muted]);
  useEffect(() => { setCookie("cb_tw", typewriter ? "1" : "0"); }, [typewriter]);
  useEffect(() => { setCookie("cb_cite", citationStyle); }, [citationStyle]);
  useEffect(() => { setCookie("cb_anim", animationMode); }, [animationMode]);
  useEffect(() => { setCookie("cb_animP", animPreset); }, [animPreset]);
  useEffect(() => { const t = setTimeout(() => setCookie("cb_animD", String(animDensity)), 500); return () => clearTimeout(t); }, [animDensity]);
  useEffect(() => { const t = setTimeout(() => setCookie("cb_animS", String(animSpeed)), 500); return () => clearTimeout(t); }, [animSpeed]);
  useEffect(() => { const t = setTimeout(() => setCookie("cb_animO", String(animOpacity)), 500); return () => clearTimeout(t); }, [animOpacity]);
  useEffect(() => { setCookie("cb_pal", paletteName); }, [paletteName]);
  useEffect(() => { setCookie("cb_accent", accentName); }, [accentName]);
  useEffect(() => { setCookie("cb_ca", customAccent); }, [customAccent]);
  useEffect(() => { setCookie("cb_hc", highContrast ? "1" : "0"); }, [highContrast]);
  useEffect(() => { setCookie("cb_fs", fontSize); }, [fontSize]);
  useEffect(() => { setCookie("cb_rt", reducedTransparency ? "1" : "0"); }, [reducedTransparency]);
  useEffect(() => { setCookie("cb_ap", autoplay ? "1" : "0"); }, [autoplay]);
  useEffect(() => { setCookie("cb_df", dyslexicFont ? "1" : "0"); }, [dyslexicFont]);
  useEffect(() => { setCookie("cb_ls", lineSpacing); }, [lineSpacing]);
  useEffect(() => { setCookie("cb_fh", focusHighlight ? "1" : "0"); }, [focusHighlight]);
  useEffect(() => { try { localStorage.setItem("cb_saved", JSON.stringify(saved)); } catch {} }, [saved]);
  // Pushes the current saved-articles list to the account, debounced so a
  // rapid string of Save clicks doesn't fire one request each. Whole-array
  // replace rather than per-item add/remove calls — see functions/api/data.js
  // for why that's the simpler, equally-correct choice at this scale.
  // Gated on syncReady so this can't fire with pre-pull/pre-import-decision
  // state and overwrite the account's real data before it's even loaded.
  const savedSyncTimer = useRef(null);
  useEffect(() => {
    if (!user || !syncReady) return;
    clearTimeout(savedSyncTimer.current);
    savedSyncTimer.current = setTimeout(() => { apiDataPost("saved", { action: "replace-all", items: saved }).catch(() => {}); }, 900);
    return () => clearTimeout(savedSyncTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved, user, syncReady]);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setCmdOpen((v) => !v); setTimeout(() => cmdRef.current?.focus(), 40); }
      else if (e.key === "Escape") { setCmdOpen(false); setSettingsOpen(false); setMobilePanel(false); setSavedOpen(false); setHistoryOpen(false); setConfirmClearSaved(false); setHistoryConfirmId(null); }
      else if ((e.metaKey || e.ctrlKey) && e.key === "/") { e.preventDefault(); setSettingsOpen((v) => !v); }
      else if ((e.metaKey || e.ctrlKey) && e.key === "j") { e.preventDefault(); newSession(); }
      else if ((e.metaKey || e.ctrlKey) && e.key === "d") { e.preventDefault(); setPaletteName(P.dark ? "Light" : "Dark"); }
      else if ((e.metaKey || e.ctrlKey) && e.key === "b") { e.preventDefault(); setSavedOpen((v) => !v); }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);

  // (No wheel-scroll takeover here — see the comment above InfoPage() for
  // why it was removed. Native scrolling + the sticky header's own
  // translateZ(0) compositor layer handle this correctly without it.)

  useEffect(() => { try { localStorage.setItem("cb_history", JSON.stringify(history.slice(0, 40))); } catch {} }, [history]);
  const historySyncTimer = useRef(null);
  useEffect(() => {
    if (!user || !syncReady) return;
    clearTimeout(historySyncTimer.current);
    historySyncTimer.current = setTimeout(() => { apiDataPost("history", { action: "replace-all", items: history }).catch(() => {}); }, 900);
    return () => clearTimeout(historySyncTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, user, syncReady]);

  // Collections CRUD — thin wrappers around /api/data's "collections"
  // actions, plus the local `saved` array update so the Collections modal
  // reflects a move/create/rename/delete instantly rather than waiting on
  // a round trip.
  async function createCollection(name) {
    try { const r = await apiDataPost("collections", { action: "create", name }); setCollections((c) => [...c, { id: r.id, name: r.name, created_at: Date.now() }]); }
    catch (e) { toast(e.message || "Couldn't create that collection.", { tone: "error" }); }
  }
  async function renameCollection(id, name) {
    setCollections((c) => c.map((x) => x.id === id ? { ...x, name } : x));
    try { await apiDataPost("collections", { action: "rename", id, name }); } catch (e) { toast(e.message || "Couldn't rename that collection.", { tone: "error" }); }
  }
  async function deleteCollection(id) {
    setCollections((c) => c.filter((x) => x.id !== id));
    setSaved((prev) => prev.map((s) => s.collectionId === id ? { ...s, collectionId: null } : s));
    try { await apiDataPost("collections", { action: "delete", id }); } catch (e) { toast(e.message || "Couldn't delete that collection.", { tone: "error" }); }
  }
  function moveSourceToCollection(source, collectionId) {
    setSaved((prev) => prev.map((s) => sourceKey(s) === sourceKey(source) ? { ...s, collectionId } : s));
  }
  function newSession() {
    if (!mutedRef.current) Audio.click();
    if (turns.length > 0) {
      const firstQ = turns[0]?.q || input || "Untitled investigation";
      setHistory((h) => [
        { id: "h" + Date.now(), title: firstQ.slice(0, 140), ts: Date.now(), turns, allSources },
        ...h.filter((entry) => entry.turns?.[0]?.id !== turns[0]?.id),
      ].slice(0, 40));
    }
    setTurns([]); setAllSources([]); setPinnedSources([]); setCorrections([]); setInput(""); setError(""); setSuggestions(pick()); setCmdOpen(false); setTimeout(() => inputRef.current?.focus(), 50);
  }
  function openHistoryItem(entry) {
    sfx();
    setTurns(entry.turns || []);
    setAllSources(entry.allSources || []);
    setPinnedSources([]); setCorrections([]); setError("");
    setHistoryOpen(false);
    setTimeout(() => window.scrollTo(0, document.body.scrollHeight), 60);
  }
  function toggleSave(s) { sfx(); setSaved((prev) => { const k = sourceKey(s); return prev.some((x) => sourceKey(x) === k) ? prev.filter((x) => sourceKey(x) !== k) : [...prev, s]; }); }
  function isPinned(s) { const k = sourceKey(s); return pinnedSources.some((x) => sourceKey(x) === k); }
  function togglePin(s) { sfx(); setPinnedSources((prev) => { const k = sourceKey(s); return prev.some((x) => sourceKey(x) === k) ? prev.filter((x) => sourceKey(x) !== k) : [...prev, s]; }); }
  const isSaved = (s) => saved.some((x) => sourceKey(x) === sourceKey(s));
  async function doZotero() {
    setZMsg("");
    const list = saved.length ? saved : allSources;
    if (!zKey || !zUser) { setZMsg("Enter your Zotero API key and user ID."); return; }
    try {
      await saveToZotero(list, zKey.trim(), zUser.trim());
      setZMsg(`Saved ${list.length} items.`);
    } catch (e) {
      // v5: this used to surface e.message straight from the fetch call —
      // the one place in the app where a raw JS/HTTP error string reached
      // the user verbatim, instead of the plain-language copy used
      // everywhere else. Map the couple of ways this actually fails to real
      // sentences, and fall back to something a person can still act on.
      const raw = String(e && e.message || "");
      const human = /401|403|forbidden|unauthorized/i.test(raw) ? "That API key or user ID looks wrong — double-check them in your Zotero account settings."
        : /network|fetch|failed to fetch/i.test(raw) ? "Couldn't reach Zotero. Check your connection and try again."
        : "Couldn't save to Zotero right now. Try again in a moment.";
      setZMsg(human);
    }
  }

  const commands = [
    { label: "New investigation", hint: kbdLabel("J"), run: () => newSession() },
    { label: "Open saved articles", hint: kbdLabel("B"), run: () => { setCmdOpen(false); setSavedOpen(true); } },
    { label: "Open previous conversations", run: () => { setCmdOpen(false); setHistoryOpen(true); } },
    // Collections' header button is desktop-only (there's no room for it in
    // the mobile header), but this palette is available on every viewport —
    // it's a signed-in-only feature, hence gated on `user` here.
    ...(user ? [{ label: "Open collections", run: () => { setCmdOpen(false); setCollectionsOpen(true); } }] : []),
    { label: "Open settings", hint: kbdLabel("/"), run: () => { setCmdOpen(false); setSettingsOpen(true); } },
    { label: muted ? "Unmute sound" : "Mute sound", run: () => { setMuted(!muted); setCmdOpen(false); } },
    { label: "Toggle light / dark", hint: kbdLabel("D"), run: () => { setPaletteName(P.dark ? "Light" : "Dark"); setCmdOpen(false); } },
    { label: factCheck ? "Turn off fact-check" : "Turn on fact-check", run: () => { setFactCheck(!factCheck); setCmdOpen(false); } },
    { label: "Export saved as BibTeX", run: () => { download("cerebrum.bib", toBibTeX(saved.length ? saved : allSources)); setCmdOpen(false); } },
    ...(history.length >= 2 ? [{ label: "Compare investigations", run: () => { setCmdOpen(false); setCompareOpen(true); } }] : []),
    ...(turns.length && turns[turns.length - 1].sources && turns[turns.length - 1].sources.length >= 2
      ? [{ label: "View source network", run: () => { setCmdOpen(false); setNetworkGraphSources(turns[turns.length - 1].sources); } }]
      : []),
    ...(turns.length && turns[turns.length - 1].sources && turns[turns.length - 1].sources.length >= 2
      ? [{ label: "View literature timeline", run: () => { setCmdOpen(false); setTimelineSources(turns[turns.length - 1].sources); } }]
      : []),
    ...(turns.length && turns[turns.length - 1].answer
      ? [{ label: "Illustrate this answer", run: () => { setCmdOpen(false); setIllustrateQuery(turns[turns.length - 1].q); } }]
      : []),
  ];
  const filteredCmds = commands.filter((c) => c.label.toLowerCase().includes(cmdQuery.toLowerCase()));
  const cmdSuggest = SUGGESTION_POOL.filter((s) => cmdQuery && s.toLowerCase().includes(cmdQuery.toLowerCase())).slice(0, 4);
  // v5: only Enter was ever wired here, and it always ran whatever sat in
  // slot zero — a palette that visually lists several matches but can only
  // ever reach the first one from the keyboard isn't actually keyboard-
  // navigable, which is the whole point of a command palette. cmdActive
  // indexes into the same flat order the list below renders (suggestions
  // first, then commands), so Up/Down actually walks the visible list.
  const [cmdActive, setCmdActive] = useState(0);
  useEffect(() => { setCmdActive(0); }, [cmdQuery, cmdOpen]);
  const cmdFlat = [...cmdSuggest.map((s) => ({ type: "ask", s })), ...filteredCmds.map((c) => ({ type: "cmd", c }))];
  const runCmdFlat = (item) => { if (!item) return; if (item.type === "ask") ask(item.s); else item.c.run(); };
  const onCmdKeyDown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setCmdActive((i) => Math.min(i + 1, Math.max(cmdFlat.length - 1, 0))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCmdActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { runCmdFlat(cmdFlat[cmdActive] || cmdFlat[0]); }
  };

  // These four all used to be recomputed on every single render — including
  // ones that have nothing to do with the source list, like a keystroke in
  // an unrelated field, or a hover-state change elsewhere in the app. None
  // of that recomputation was visible as a bug (the results were always
  // correct), just wasted work — a full filter+sort+regroup pass over
  // potentially hundreds of sources on every unrelated re-render. useMemo
  // with the actual inputs as deps makes each one only redo the work when
  // something it actually depends on changes.
  //
  // These MUST stay above the `if (!entered) return <Intro .../>` early
  // return directly below — every hook in a component has to run in the
  // same order on every render, landing page included. Putting them after
  // that early return (where they used to live, back when they were plain
  // `const` expressions and not hook calls) meant the very first render
  // (landing, entered === false) called four fewer hooks than every render
  // after clicking "Start exploring" — React's "Rendered more hooks than
  // during the previous render" crash, reliably, on the very first
  // interaction of a fresh session.
  const filteredSources = useMemo(() => allSources.filter((s) => { if (!srcFilter.trim()) return true; const f = srcFilter.toLowerCase(); return (s.title || "").toLowerCase().includes(f) || (s.authors || "").toLowerCase().includes(f) || (s.journal || "").toLowerCase().includes(f); }), [allSources, srcFilter]);
  const sortedSources = useMemo(() => [...filteredSources].sort((a, b) => { if (srcSort === "date") return (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0); if (srcSort === "database") return (a.journal || "").localeCompare(b.journal || ""); return (b.relevance ?? 0) - (a.relevance ?? 0); }), [filteredSources, srcSort]);
  // Bug: SourceCard's global index used to be looked up via
  // `allSources.indexOf(s)` inside the render loop — O(n) per source, O(n²)
  // for the whole list. `sortedSources`/`grouped` reorder the SAME object
  // references as `allSources` (spread+sort, not a deep clone), so a single
  // reference-keyed Map built once gives O(1) lookups instead.
  const sourceIndexMap = useMemo(() => new Map(allSources.map((s, i) => [s, i])), [allSources]);
  const grouped = useMemo(() => { if (srcSort === "database") { const g = {}; for (const s of sortedSources) { const k = s.type || "Other"; (g[k] = g[k] || []).push(s); } return Object.entries(g); } if (srcSort === "date") { const g = {}; for (const s of sortedSources) { const k = s.year || "Undated"; (g[k] = g[k] || []).push(s); } return Object.entries(g).sort((a, b) => (parseInt(b[0], 10) || 0) - (parseInt(a[0], 10) || 0)); } return null; }, [sortedSources, srcSort]);

  if (!entered) {
    return <Intro accent={accent} P={P} onEnter={() => { sfx(); try { setCookie("cb_entered_v5", "1", 365); } catch {} setEntered(true); }} animationMode={animationMode} />;
  }

  const started = turns.length > 0 || busy;
  const exportList = saved.length ? saved : allSources;
  const relColor = (r) => r >= 65 ? STATUS.good : r >= 45 ? STATUS.warn : P.faint;
  const relLabel = (r) => r >= 65 ? "strong" : r >= 45 ? "partial" : "weak";
  const typeColor = (t) => t === "Preprint" ? ACCENTS.Amber : t === "Reference" ? ACCENTS.Violet : t === "Dataset" ? ACCENTS.Sky : accent;

  const SourceCard = (s, i) => (
    <div key={i} className="cb-fade" style={{ ...S.srcItem, background: hover === "src" + i ? withAlpha(accent, 0.05) : hoverCite === i + 1 ? withAlpha(accent, 0.06) : "transparent", transform: hover === "src" + i ? "translate3d(0, -1px, 0)" : "translate3d(0, 0, 0)" }} onMouseEnter={() => setHover("src" + i)} onMouseLeave={() => setHover("")}>
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 5, flexWrap: "wrap" }}>
        {s.type && <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: typeColor(s.type), background: withAlpha(typeColor(s.type), 0.1), padding: "2px 6px", borderRadius: 4, fontFamily: "var(--cb-mono)" }}>{s.type}</span>}
        {/* v5: the "strong/partial/weak" word already existed (relLabel)
            but only ever reached a `title` tooltip — invisible to touch,
            keyboard, and screen-reader users, who only ever saw a bare
            color-coded percentage. Now it's always on screen. */}
        {typeof s.relevance === "number" && <span style={{ fontSize: 9, fontWeight: 600, color: relColor(s.relevance), background: withAlpha(relColor(s.relevance), 0.1), padding: "2px 6px", borderRadius: 4, fontFamily: "var(--cb-mono)" }}>{s.relevance}% · {relLabel(s.relevance)}</span>}
        {s.year && <span style={{ fontSize: 10, color: P.faint, fontFamily: "var(--cb-mono)" }}>{s.year}</span>}
      </div>
      <a href={safeHref(s.url)} target="_blank" rel="noreferrer" style={{ ...S.srcTitle, color: hover === "src" + i ? accent : P.ink }}>{s.title || s.url}</a>
      <div style={S.srcMeta}>{[s.authors, s.journal].filter(Boolean).join(" · ")}{typeof s.citations === "number" && ` · ${s.citations.toLocaleString()} cit.`}</div>
      <div style={S.srcRow}>
        <button style={{ ...S.chipMini, display: "inline-flex", alignItems: "center", gap: 4, color: isSaved(s) ? at : P.ink2, background: isSaved(s) ? accent : "transparent", borderColor: isSaved(s) ? accent : P.line2 }} onClick={() => toggleSave(s)}><Icon name={isSaved(s) ? "bookmarkFilled" : "bookmark"} size={11} />{isSaved(s) ? "Saved" : "Save"}</button>
        <button style={{ ...S.chipMini, display: "inline-flex", alignItems: "center", gap: 4, color: isPinned(s) ? at : P.ink2, background: isPinned(s) ? accent : "transparent", borderColor: isPinned(s) ? accent : P.line2 }} onClick={() => togglePin(s)} title={isPinned(s) ? "Pinned to conversation" : "Pin for follow-ups"}><Icon name={isPinned(s) ? "pinFilled" : "pin"} size={11} />{isPinned(s) ? "Pinned" : "Pin"}</button>
        {s.authors && <button style={{ ...S.chipMini, color: accent, borderColor: P.line2 }} onClick={() => { setMobilePanel(false); ask(`papers by ${(s.authors || "").replace(" et al.", "")}`); }}>Author →</button>}
      </div>
    </div>
  );

  const SourcesInner = (
    <>
      <div style={S.srcHead}><span>Sources</span><span style={S.srcCount}>{allSources.length}</span></div>
      {pinnedSources.length > 0 && (<div style={{ padding: "7px 10px", margin: "0 0 8px", background: withAlpha(accent, 0.06), border: `1px solid ${withAlpha(accent, 0.25)}`, borderRadius: 7, fontSize: 11, color: accent, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontFamily: "var(--cb-mono)" }}><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="pinFilled" size={11} />{pinnedSources.length} pinned</span><button onClick={() => setPinnedSources([])} style={{ background: "transparent", border: "none", color: accent, cursor: "pointer", fontSize: 10.5, textDecoration: "underline" }}>Clear</button></div>)}
      {corrections.length > 0 && (<div style={{ padding: "7px 10px", margin: "0 0 8px", background: withAlpha(STATUS.warn, 0.06), border: `1px solid ${withAlpha(STATUS.warn, 0.25)}`, borderRadius: 7, fontSize: 11, color: STATUS.warn, display: "flex", alignItems: "center", gap: 6, justifyContent: "space-between", fontFamily: "var(--cb-mono)" }}><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="edit" size={11} />{corrections.length} correction{corrections.length === 1 ? "" : "s"}</span><button onClick={() => setCorrections([])} style={{ background: "transparent", border: "none", color: STATUS.warn, cursor: "pointer", fontSize: 10.5, textDecoration: "underline" }}>Clear</button></div>)}
      {allSources.length > 0 && (<>
        <div style={S.srcActions}>
          <button style={S.sBtn} onClick={() => { sfx(); download("cerebrum.ris", toRIS(exportList)); }}>RIS</button>
          <button style={S.sBtn} onClick={() => { sfx(); download("cerebrum.bib", toBibTeX(exportList)); }}>BibTeX</button>
          <button style={S.sBtnP} onClick={() => { sfx(); setZoteroOpen(!zoteroOpen); }}>Zotero</button>
        </div>
        <input style={S.srcFilterInput} placeholder="Filter sources…" value={srcFilter} onChange={(e) => setSrcFilter(e.target.value)} />
        <div style={S.sortTabs}>
          {[["relevance", "Relevance"], ["date", "Date"], ["database", "Type"]].map(([k, label]) => (
            <button key={k} style={{ ...S.sortTab, ...(srcSort === k ? S.sortTabActive : {}) }} onClick={() => { sfx(); setSrcSort(k); }}>{label}</button>
          ))}
        </div>
      </>)}
      {saved.length > 0 && <div style={S.savedNote}>{saved.length} saved · exports use saved</div>}
      {zoteroOpen && (<div style={S.zBox}><input style={S.zIn} aria-label="Zotero API key" placeholder="Zotero API key" value={zKey} onChange={(e) => setZKey(e.target.value)} /><input style={S.zIn} aria-label="Zotero user ID" placeholder="Zotero user ID" value={zUser} onChange={(e) => setZUser(e.target.value)} /><button style={S.sBtnP} onClick={doZotero}>Save {exportList.length}</button>{zMsg && <div style={S.zMsg}>{zMsg}</div>}</div>)}
      <div style={S.srcList} className="cb-stagger">
        {allSources.length === 0 ? <div style={S.empty} className="cb-fade">Sources appear here as you research.</div> :
          sortedSources.length === 0 ? <div style={S.empty} className="cb-fade">No sources match "{srcFilter}".</div> :
          grouped ? grouped.map(([label, items]) => (<div key={label} className="cb-fade"><div style={S.srcGroupLabel}>{label} <span style={{ color: P.faint, fontWeight: 500 }}>· {items.length}</span></div>{items.map((s) => SourceCard(s, sourceIndexMap.get(s)))}</div>)) : sortedSources.map((s) => SourceCard(s, sourceIndexMap.get(s)))}
      </div>
    </>
  );

  const a11yClasses = [
    highContrast && "cb-high-contrast",
    fontSize === "large" && "cb-text-lg",
    fontSize === "xlarge" && "cb-text-xl",
    fontSize === "small" && "cb-text-sm",
    lineSpacing === "relaxed" && "cb-line-relaxed",
    lineSpacing === "loose" && "cb-line-loose",
    reducedTransparency && "cb-solid-panels",
    dyslexicFont && "cb-dyslexic",
    focusHighlight && "cb-focus-ring",
  ].filter(Boolean).join(" ");

  return (
    <div style={{...S.page, "--cb-accent": accent}} className={a11yClasses}>
      {animationMode !== "off" && <LivingBackground accent={accent} P={P} intensity={animationMode} preset={animPreset} density={animDensity} speed={animSpeed} opacity={animOpacity} paused={settingsOpen} />}
      <div style={S.grain} />
      {started && <div className="cb-scroll-progress" style={{ transform: "scaleX(" + scrollProg + ")" }} />}
      {showScrollTop && <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} style={{ position: "fixed", bottom: isMobile ? 80 : 24, left: 24, width: 36, height: 36, borderRadius: "50%", background: P.dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.06)", border: "none", color: P.ink2, cursor: "pointer", zIndex: 15, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(8px)", fontSize: 16 }}>↑</button>}
      <header style={S.header}>
        <div style={S.headerGlass} aria-hidden="true" />
        <div style={S.headInner}>
          <div style={{ ...S.brandRow, position: "relative" }}>
            
              {/* v5: this used to clear the cookie and hard-reload the whole
                  page — a jarring flash-to-white on every other transition in
                  the app being a smooth fade/blur. Flipping `entered` back to
                  false replays the exact same Intro the cookie-clear was
                  trying to reach, without throwing away the JS runtime. */}
              <div onClick={(e) => { e.stopPropagation(); sfx(); try { document.cookie = "cb_entered_v5=; path=/; max-age=0"; } catch {} setEntered(false); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); try { document.cookie = "cb_entered_v5=; path=/; max-age=0"; } catch {} setEntered(false); } }} role="button" tabIndex={0} aria-label="Back to landing page" style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                <span style={{ display: "inline-flex" }}><Mark size={20} accent={accent} glow={P.dark} /></span>
                <span style={S.brand} className="cb-gradient-text">Cerebrum<sup style={{ fontSize: "0.55em", fontWeight: 400, marginLeft: 2, opacity: 0.5, letterSpacing: "0.02em", WebkitTextFillColor: "currentColor", background: "none" }}>™</sup></span>
              </div>
              {/* Reopens the "what's new" modal on demand — otherwise it's a
                  one-time popup nobody could get back to once dismissed. */}
              <button onClick={(e) => { e.stopPropagation(); sfx(); setV5Open(true); }} title="What's new in DP" aria-label="What's new in Cerebrum DP" style={{ border: `1px solid ${withAlpha(accent, 0.35)}`, background: withAlpha(accent, 0.1), color: accent, borderRadius: 999, fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", padding: "2px 7px", cursor: "pointer", fontFamily: "var(--cb-mono)", lineHeight: 1.6 }}>DP</button>
          </div>
          <div style={S.headActions}>
            {!isMobile && (<button className="cb-hbtn" style={S.cmdHint} onClick={() => { setCmdOpen(true); setTimeout(() => cmdRef.current?.focus(), 40); }} aria-label="Open search palette"><Icon name="search" size={13} /><span>Search</span><kbd style={S.kbd}>{kbdLabel("K")}</kbd></button>)}
            <button className="cb-hbtn" style={S.iconBtn} onClick={() => { sfx(); newSession(); }} title="New investigation" aria-label="New investigation"><Icon name="plus" size={16} />{!isMobile && <span style={S.iconBtnLabel}>New</span>}</button>
            <button className="cb-hbtn" style={S.iconBtn} onClick={() => { sfx(); setHistoryOpen(true); }} title="Previous conversations" aria-label={`Previous conversations${history.length ? `, ${history.length}` : ""}`}><Icon name="history" size={16} />{!isMobile && <span style={S.iconBtnLabel}>History</span>}</button>
            <button className="cb-hbtn" style={{ ...S.iconBtn, ...(saved.length > 0 ? { color: accent } : {}) }} onClick={() => { sfx(); setSavedOpen(true); }} title={`Saved articles${saved.length ? ` (${saved.length})` : ""}`} aria-label={`Saved articles${saved.length ? `, ${saved.length}` : ""}`}><Icon name={saved.length > 0 ? "bookmarkFilled" : "bookmark"} size={16} />{!isMobile && <span style={S.iconBtnLabel}>Saved</span>}{saved.length > 0 && <span style={S.countPill}>{saved.length}</span>}</button>
            {user && !isMobile && (<button className="cb-hbtn" style={S.iconBtn} onClick={() => { sfx(); setCollectionsOpen(true); }} title="Collections" aria-label="Collections"><Icon name="folder" size={16} /><span style={S.iconBtnLabel}>Collections</span></button>)}
            <button className="cb-hbtn" style={S.iconBtn} onClick={() => setMuted(!muted)} title={muted ? "Unmute" : "Mute"} aria-label={muted ? "Unmute" : "Mute"}><Icon name={muted ? "volumeOff" : "volumeOn"} size={16} /></button>
            <button className="cb-hbtn" style={S.iconBtn} onClick={() => { sfx(); setSettingsInitialTab("general"); setSettingsOpen(true); }} title="Settings" aria-label="Settings"><Icon name="settings" size={16} />{!isMobile && <span style={S.iconBtnLabel}>Settings</span>}</button>
            <button className="cb-hbtn" style={S.iconBtn} onClick={() => { sfx(); if (user) { setSettingsInitialTab("account"); setSettingsOpen(true); } else { setAuthInitialTab("login"); setAuthOpen(true); } }} title={user ? user.email : "Sign in"} aria-label={user ? `Signed in as ${user.email} — open account settings` : "Sign in or create an account"}>
              {user ? <span aria-hidden="true" style={{ width: 19, height: 19, borderRadius: "50%", background: withAlpha(accent, 0.18), color: accent, fontSize: 10, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--cb-mono)" }}>{user.email[0].toUpperCase()}</span> : <Icon name="user" size={16} />}
              {!isMobile && <span style={S.iconBtnLabel}>{user ? "Account" : "Sign in"}</span>}
            </button>
          </div>
        </div>
      </header>
      <div style={S.scroll} ref={threadRef} onDoubleClick={(e) => {
        const sel = window.getSelection()?.toString()?.trim();
        if (sel && sel.length > 3 && sel.length < 80 && !sel.includes("\n")) {
          ask(sel);
        }
      }}>
        <div style={S.container}>
          {!started ? (
            <div style={S.hero} className="cb-hero">
              <div style={S.heroGlow} className="cb-hero-glow" />
              <div style={{ ...S.heroMark, display: "inline-flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
                <span aria-hidden="true" className="cb-hero-ring" style={{ position: "absolute", width: 74, height: 74, borderRadius: "50%", border: `1px solid ${withAlpha(accent, 0.4)}` }} />
                <Mark size={44} accent={accent} glow={P.dark} />
              </div>
              <h1 style={S.heroTitle} className="cb-text-reveal"><KineticText text="Cerebrum" /></h1>
              <p style={S.heroSub}>Ask a real research question. We'll dig through the actual literature and give you a straight answer — every citation checkable, nothing invented.</p>
              <input ref={imageInputRef} type="file" accept="image/*" onChange={onImagePicked} style={{ display: "none" }} />
              {attachedImage && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, padding: "6px 10px 6px 6px", background: P.dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)", border: `1px solid ${P.line}`, borderRadius: 10, maxWidth: "fit-content" }}>
                  <img src={attachedImage} alt="Attached" style={{ width: 32, height: 32, borderRadius: 6, objectFit: "cover" }} />
                  <span style={{ fontSize: 12.5, color: P.ink2, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{attachedImageName}</span>
                  <button onClick={() => { setAttachedImage(null); setAttachedImageName(""); }} aria-label="Remove image" style={{ background: "none", border: "none", color: P.faint, cursor: "pointer", padding: 2, display: "inline-flex" }}><Icon name="close" size={14} /></button>
                </div>
              )}
              <div className="cb-search-glow" style={{ ...S.searchShell, ...(hover === "in" ? S.searchShellActive : {}), width: "100%", maxWidth: 700, borderRadius: 14 }} onMouseEnter={() => setHover("in")} onMouseLeave={() => setHover("")}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, marginLeft: 2 }}><circle cx="11" cy="11" r="7" stroke={P.faint} strokeWidth="1.6" /><path d="M21 21l-4-4" stroke={P.faint} strokeWidth="1.6" strokeLinecap="round" /></svg>
                  <input ref={inputRef} style={S.searchInput} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} placeholder="What are you curious about?" />
                  <button onClick={() => imageInputRef.current?.click()} title="Attach an image" aria-label="Attach an image" style={{ background: "none", border: "none", cursor: "pointer", color: attachedImage ? accent : P.faint, display: "flex", alignItems: "center", padding: 4, flexShrink: 0 }}><Icon name="image" size={17} /></button>
                  <MicButton onTranscript={(t) => setInput(t)} accent={accent} P={P} />
                  <button style={S.searchBtn} onClick={() => ask()}>Search</button>
              </div>
              <div style={S.chips} className="cb-stagger" onMouseEnter={() => chipsPausedRef.current = true} onMouseLeave={() => chipsPausedRef.current = false} onFocus={() => chipsPausedRef.current = true} onBlur={() => chipsPausedRef.current = false}>
                {suggestions.map((s, i) => (<button key={s} className="cb-fade cb-chip-hover" style={{ ...S.chip, ...(hover === "c" + i ? S.chipHover : {}) }} onMouseEnter={() => setHover("c" + i)} onMouseLeave={() => setHover("")} onClick={() => ask(s)}>{s}</button>))}
              </div>
              <div style={S.trustRow}>
                {/* Bug: this said "+ 10 more" after 6 named databases (implying
                    16 total), matching the stale "16 databases" figure that
                    was hardcoded in several other places (index.html meta
                    tags, Settings footer, HowItWorksModal) — the real backend
                    fanout (functions/api/search.js's `sourceNames`) queries
                    14. Corrected to match. */}
                {["Europe PMC", "PubMed", "OpenAlex", "Crossref", "Semantic Scholar", "arXiv"].map((d) => <span key={d} style={S.trustItem}>{d}</span>)}
                <span style={{ ...S.trustItem, color: P.faint }}>+ 8 more</span>
              </div>
            </div>
          ) : (
            <div style={{ ...S.workspace, ...(isMobile ? S.workspaceMobile : S.workspaceWithSidebar) }} className="cb-page-enter">
              <div style={S.thread}>
                {turns.map((t, ti) => (<Turn key={t.id ?? ti} t={t} P={P} accent={accent} at={at} S={S} typewriter={typewriter && ti === turns.length - 1} last={ti === turns.length - 1} hoverCite={hoverCite} setHoverCite={setHoverCite} onRelated={(q) => ask(q)} citationStyle={citationStyle} setCitationStyle={setCitationStyle} onShowNetwork={setNetworkGraphSources} onShowTimeline={setTimelineSources} onIllustrate={setIllustrateQuery} />))}
                {busy && (<div style={S.turn}><div style={S.qLabel}><span style={S.qDot} /><span style={{ fontFamily: "var(--cb-mono)", fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase" }}>Searching</span></div><div style={{ fontSize: 11, color: P.faint, fontFamily: "var(--cb-mono)", margin: "8px 0 12px", letterSpacing: "0.03em", opacity: 0.7 }}>Querying PubMed · Europe PMC · OpenAlex · Semantic Scholar · Crossref · arXiv</div><Skeleton P={P} /><LoadingLine P={P} accent={accent} S={S} /></div>)}
                {error && <div role="alert" style={S.error} className="cb-fade"><span style={{ flexShrink: 0, display: "inline-flex" }}><Icon name="warning" size={18} /></span><div><div style={{ fontWeight: 600, marginBottom: 4 }}>Search failed</div><div style={{ opacity: 0.85 }}>{error}</div><button onClick={() => { setError(""); ask(turns.length ? turns[turns.length - 1].q : input); }} style={{ marginTop: 10, padding: "6px 14px", fontSize: 12, fontWeight: 600, background: withAlpha(STATUS.bad, 0.15), color: STATUS.bad, border: `1px solid ${withAlpha(STATUS.bad, 0.3)}`, borderRadius: 8, cursor: "pointer", fontFamily: "var(--cb-mono)" }}>Try again</button></div></div>}
                {turns.length > 0 && !busy && (<>
                  {attachedImage && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, padding: "6px 10px 6px 6px", background: P.dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)", border: `1px solid ${P.line}`, borderRadius: 10, maxWidth: "fit-content" }}>
                      <img src={attachedImage} alt="Attached" style={{ width: 32, height: 32, borderRadius: 6, objectFit: "cover" }} />
                      <span style={{ fontSize: 12.5, color: P.ink2, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{attachedImageName}</span>
                      <button onClick={() => { setAttachedImage(null); setAttachedImageName(""); }} aria-label="Remove image" style={{ background: "none", border: "none", color: P.faint, cursor: "pointer", padding: 2, display: "inline-flex" }}><Icon name="close" size={14} /></button>
                    </div>
                  )}
                  <div style={{ ...S.followShell, ...(hover === "f" ? S.searchShellActive : {}) }} onMouseEnter={() => setHover("f")} onMouseLeave={() => setHover("")}>
                    <input style={S.searchInput} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} placeholder="Follow up — I remember the whole thread" />
                    <button onClick={() => imageInputRef.current?.click()} title="Attach an image" aria-label="Attach an image" style={{ background: "none", border: "none", cursor: "pointer", color: attachedImage ? accent : P.faint, display: "flex", alignItems: "center", padding: 4, flexShrink: 0 }}><Icon name="image" size={17} /></button>
                    <MicButton onTranscript={(t) => setInput(t)} accent={accent} P={P} />
                    <button style={S.searchBtn} onClick={() => ask()}>Ask</button>
                  </div>
                </>)}
              </div>
              {/* v5: standing sidebar replaces the drawer on anything roomy
                  enough to hold one — see workspaceWithSidebar above. The FAB
                  + slide-in drawer below is now mobile-only. */}
              {!isMobile && (
                <aside aria-label="Sources" style={{ ...S.panel, ...S.sidebarCol }}>
                  {SourcesInner}
                </aside>
              )}
            </div>
          )}
          <div style={S.foot}>
            <div style={{ fontSize: 11, color: P.faint, lineHeight: 1.55, maxWidth: 520, margin: "0 auto 14px", textAlign: "center" }}>Answers are assembled from real papers by AI. Always check the cited sources.</div>
            <div style={{ fontSize: 10.5, color: P.faint, fontFamily: "var(--cb-mono)" }}>
              <button onClick={() => setHowItWorksOpen(true)} style={{ color: P.faint, textDecoration: "none", background: "none", border: "none", borderBottom: `1px dotted ${P.faint}`, padding: 0, cursor: "pointer", font: "inherit" }}>How it works</button>
              <span style={{ margin: "0 8px", opacity: 0.4 }}>·</span><a href="/about" style={{ color: P.faint, textDecoration: "none", borderBottom: `1px dotted ${P.faint}` }}>About</a>
              <span style={{ margin: "0 8px", opacity: 0.4 }}>·</span><a href="/privacy" style={{ color: P.faint, textDecoration: "none", borderBottom: `1px dotted ${P.faint}` }}>Privacy</a>
              <span style={{ margin: "0 8px", opacity: 0.4 }}>·</span><a href="/terms" style={{ color: P.faint, textDecoration: "none", borderBottom: `1px dotted ${P.faint}` }}>Terms</a>
              <span style={{ margin: "0 8px", opacity: 0.4 }}>·</span><a href="/contact" style={{ color: P.faint, textDecoration: "none", borderBottom: `1px dotted ${P.faint}` }}>Contact</a>
              <span style={{ margin: "0 8px", opacity: 0.4 }}>·</span>© {new Date().getFullYear()} Cerebrum™ · v{APP_VERSION}
            </div>
          </div>
        </div>
      </div>
      {started && isMobile && (<button style={{ ...S.mobSrcBtn, "--fab-glow": withAlpha(accent, 0.35) }} className="cb-fab-pulse" onClick={() => setMobilePanel(true)} aria-label={`Sources${allSources.length ? `, ${allSources.length}` : ""}`}><Icon name="sparkle" size={14} /><span>Sources</span>{allSources.length > 0 && <span style={{ fontSize: 11, fontWeight: 700, background: withAlpha(at, 0.22), padding: "2px 6px", borderRadius: 20, lineHeight: 1.3 }}>{allSources.length}</span>}</button>)}
      {started && isMobile && mobilePanel && (<><div style={S.scrim} onClick={() => setMobilePanel(false)} className="cb-backdrop" /><aside role="dialog" aria-modal="true" aria-label="Sources" style={{ ...S.panel, ...S.panelMobile }} className="cb-modal"><button style={{ ...S.ghostBtn, marginBottom: 14, display: "inline-flex", alignItems: "center", gap: 6 }} onClick={() => setMobilePanel(false)}><Icon name="close" size={13} /> Close</button>{SourcesInner}</aside></>)}
      {cmdOpen && (<div role="dialog" aria-modal="true" aria-label="Command palette" style={S.cmdWrap} onClick={() => setCmdOpen(false)}><div style={S.cmdBox} onClick={(e) => e.stopPropagation()} className="cb-pop"><div style={S.cmdInputRow}><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke={P.faint} strokeWidth="1.8" /><path d="M21 21l-4-4" stroke={P.faint} strokeWidth="1.8" strokeLinecap="round" /></svg><input ref={cmdRef} style={S.cmdInput} value={cmdQuery} onChange={(e) => setCmdQuery(e.target.value)} onKeyDown={onCmdKeyDown} placeholder="Search or type a command…" /><kbd style={S.kbd}>esc</kbd></div><div style={S.cmdList}>{cmdSuggest.length > 0 && <div style={S.cmdSection}>Ask</div>}{cmdSuggest.map((s, i) => (<button key={s} style={{ ...S.cmdItem, background: cmdActive === i ? withAlpha(accent, 0.1) : "transparent" }} onClick={() => ask(s)} onMouseEnter={() => setCmdActive(i)}><span style={{ color: accent }}>→</span>{s}</button>))}<div style={S.cmdSection}>Commands</div>{filteredCmds.map((c, i) => { const flatIdx = cmdSuggest.length + i; return (<button key={c.label} style={{ ...S.cmdItem, background: cmdActive === flatIdx ? withAlpha(accent, 0.1) : "transparent" }} onClick={c.run} onMouseEnter={() => setCmdActive(flatIdx)}><span>{c.label}</span>{c.hint && <kbd style={{ ...S.kbd, marginLeft: "auto" }}>{c.hint}</kbd>}</button>); })}</div></div></div>)}
      {savedOpen && (
        <div role="dialog" aria-modal="true" aria-label="Saved articles" style={S.modalWrap} onClick={() => { setSavedOpen(false); setConfirmClearSaved(false); }} className="cb-backdrop">
          <div style={{ ...S.modal, width: 520 }} onClick={(e) => e.stopPropagation()} className="cb-modal">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}><div style={S.modalTitle}>Saved articles</div><span style={S.srcCount}>{saved.length}</span></div>
            {saved.length === 0 ? (
              <div style={{ fontSize: 14, color: P.ink2, lineHeight: 1.6, padding: "20px 0 28px", textAlign: "center" }}>
                No saved articles yet.<br />
                <span style={{ fontSize: 12.5, color: P.faint, display: "inline-flex", alignItems: "center", gap: 5, marginTop: 4 }}><Icon name="bookmark" size={11} /> Save any source to keep it here.</span>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                  <button style={S.sBtn} onClick={() => { sfx(); download("cerebrum-saved.ris", toRIS(saved)); }}>Export RIS</button>
                  <button style={S.sBtn} onClick={() => { sfx(); download("cerebrum-saved.bib", toBibTeX(saved)); }}>Export BibTeX</button>
                  {confirmClearSaved ? (
                    <span style={{ display: "inline-flex", gap: 8, marginLeft: "auto" }}>
                      <button style={S.sBtn} onClick={() => setConfirmClearSaved(false)}>Cancel</button>
                      <button style={{ ...S.sBtn, background: STATUS.bad, color: "#fff", borderColor: STATUS.bad }} onClick={() => { setSaved([]); setConfirmClearSaved(false); sfx(); }}>Confirm delete</button>
                    </span>
                  ) : (
                    <button style={{ ...S.sBtn, marginLeft: "auto", color: STATUS.bad, borderColor: withAlpha(STATUS.bad, 0.35) }} onClick={() => setConfirmClearSaved(true)}>Clear all</button>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: "56vh", overflowY: "auto" }}>
                  {saved.map((s, i) => (
                    <div key={sourceKey(s) || i} style={{ padding: "12px 10px", margin: "0 -10px", borderBottom: `1px solid ${P.line}` }}>
                      <a href={safeHref(s.url)} target="_blank" rel="noreferrer" style={{ ...S.srcTitle, fontSize: 14 }}>{s.title || s.url}</a>
                      <div style={S.srcMeta}>{[s.authors, s.journal, s.year].filter(Boolean).join(" · ")}{typeof s.citations === "number" && ` · ${s.citations.toLocaleString()} cit.`}</div>
                      <div style={S.srcRow}>
                        <button style={{ ...S.chipMini, color: STATUS.bad, borderColor: withAlpha(STATUS.bad, 0.35) }} onClick={() => setSaved((prev) => prev.filter((x) => sourceKey(x) !== sourceKey(s)))}>Remove</button>
                        {s.authors && <button style={{ ...S.chipMini, color: accent, borderColor: P.line2 }} onClick={() => { setSavedOpen(false); ask(`papers by ${(s.authors || "").replace(" et al.", "")}`); }}>Author →</button>}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            <button style={{ ...S.modalClose, marginTop: 20 }} onClick={() => { setSavedOpen(false); setConfirmClearSaved(false); }}>Done</button>
          </div>
        </div>
      )}
      {historyOpen && (
        <div role="dialog" aria-modal="true" aria-label="Previous conversations" style={S.modalWrap} onClick={() => { setHistoryOpen(false); setHistoryConfirmId(null); }} className="cb-backdrop">
          <div style={{ ...S.modal, width: 560 }} onClick={(e) => e.stopPropagation()} className="cb-modal">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <div style={S.modalTitle}>Previous conversations</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {history.length >= 2 && <button onClick={() => { setHistoryOpen(false); setCompareOpen(true); }} style={{ ...S.chipMini, display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name="compare" size={11} /> Compare</button>}
                <span style={S.srcCount}>{history.length}</span>
              </div>
            </div>
            {history.length === 0 ? (
              <div style={{ fontSize: 14, color: P.ink2, lineHeight: 1.6, padding: "20px 0 28px", textAlign: "center" }}>Nothing here yet.<br /><span style={{ fontSize: 12.5, color: P.faint }}>Starting a new investigation keeps the last one here so you can come back to it.</span></div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: "60vh", overflowY: "auto" }}>
                {history.map((h) => (
                  <div key={h.id} style={{ padding: "13px 10px", margin: "0 -10px", borderBottom: `1px solid ${P.line}`, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                    <button onClick={() => openHistoryItem(h)} style={{ flex: 1, textAlign: "left", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
                      <div style={{ fontSize: 14.5, fontWeight: 500, color: P.ink, lineHeight: 1.4 }}>{h.title}</div>
                      <div style={{ fontSize: 12, color: P.faint, marginTop: 3 }}>{(h.turns || []).length} exchange{(h.turns || []).length === 1 ? "" : "s"} · {new Date(h.ts).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</div>
                    </button>
                    {historyConfirmId === h.id ? (
                      <span style={{ display: "inline-flex", gap: 6, flexShrink: 0 }}>
                        <button onClick={() => setHistoryConfirmId(null)} style={S.chipMini}>Cancel</button>
                        <button onClick={() => { setHistory((prev) => prev.filter((x) => x.id !== h.id)); setHistoryConfirmId(null); }} style={{ ...S.chipMini, background: STATUS.bad, color: "#fff", borderColor: STATUS.bad }}>Confirm</button>
                      </span>
                    ) : (
                      <button onClick={() => setHistoryConfirmId(h.id)} aria-label="Delete conversation" style={{ ...S.chipMini, color: STATUS.bad, borderColor: withAlpha(STATUS.bad, 0.35), flexShrink: 0 }}>Delete</button>
                    )}
                  </div>
                ))}
              </div>
            )}
            <button style={{ ...S.modalClose, marginTop: 20 }} onClick={() => { setHistoryOpen(false); setHistoryConfirmId(null); }}>Done</button>
          </div>
        </div>
      )}
      {settingsOpen && <Settings {...{ P, accent, at, S, PALETTES, ACCENTS, paletteName, setPaletteName, accentName, setAccentName, customAccent, setCustomAccent, answerLength, setAnswerLength, factCheck, setFactCheck, muted, setMuted, typewriter, setTypewriter, soundMode, setSoundMode, animationMode, setAnimationMode, animPreset, setAnimPreset, animDensity, setAnimDensity, animSpeed, setAnimSpeed, animOpacity, setAnimOpacity, sfx, setSessions, setSaved, saved, history, setHistory, highContrast, setHighContrast, fontSize, setFontSize, reducedTransparency, setReducedTransparency, autoplay, setAutoplay, dyslexicFont, setDyslexicFont, lineSpacing, setLineSpacing, focusHighlight, setFocusHighlight, citationStyle, setCitationStyle, user, onSignOut: signOut, onAccountDeleted, onOpenAuth: (tab) => { setSettingsOpen(false); setAuthInitialTab(tab); setAuthOpen(true); }, initialTab: settingsInitialTab, close: () => setSettingsOpen(false) }} />}
      {howItWorksOpen && <HowItWorksModal P={P} accent={accent} close={() => setHowItWorksOpen(false)} />}
      {v5Open && <V5AnnouncementModal P={P} accent={accent} at={at} close={() => { try { localStorage.setItem("cb_seen_v6", "1"); } catch {} setV5Open(false); }} />}
      {authOpen && <AuthModal P={P} accent={accent} at={at} initialTab={authInitialTab} close={() => setAuthOpen(false)} onAuthed={(u) => handleAuthed(u, { checkImport: true })} />}
      {importPrompt && (
        <ImportLocalDataPrompt
          P={P} accent={accent} at={at}
          savedCount={importPrompt.savedCount} historyCount={importPrompt.historyCount}
          onImport={() => { setImportPrompt(null); setSyncReady(true); }}
          onSkip={() => { setSaved([]); setHistory([]); setImportPrompt(null); setSyncReady(true); }}
        />
      )}
      {collectionsOpen && (
        <CollectionsModal
          P={P} accent={accent} at={at} S={S} saved={saved} collections={collections}
          onCreateCollection={createCollection} onRenameCollection={renameCollection} onDeleteCollection={deleteCollection} onMoveSource={moveSourceToCollection}
          close={() => setCollectionsOpen(false)}
        />
      )}
      {compareOpen && <CompareModal P={P} accent={accent} at={at} S={S} history={history} close={() => setCompareOpen(false)} />}
      {networkGraphSources && <SourceNetworkGraph P={P} accent={accent} at={at} sources={networkGraphSources} close={() => setNetworkGraphSources(null)} />}
      {timelineSources && <LiteratureTimeline P={P} accent={accent} at={at} sources={timelineSources} close={() => setTimelineSources(null)} />}
      {illustrateQuery && <IllustrationModal P={P} accent={accent} at={at} query={illustrateQuery} close={() => setIllustrateQuery(null)} />}
      <ToastHost P={P} accent={accent} />
    </div>
  );
}


/* ════════════════════════════════════════════════════════════════
   CSS v4 — DARKNODE
   Serif display. Blur-to-focus entrances. No bouncy springs.
   Everything slow, intentional, premium.
   ════════════════════════════════════════════════════════════════ */
const CSS = `
:root {
  --cb-display: 'Cormorant Garamond', 'Georgia', 'Times New Roman', serif;
  --cb-body:    'Inter', system-ui, -apple-system, sans-serif;
  --cb-mono:    'JetBrains Mono', 'SF Mono', 'Fira Code', monospace;
  --cb-ease:    cubic-bezier(0.16, 1, 0.3, 1);
  --cb-ease-in: cubic-bezier(0.4, 0, 1, 1);
  --cb-ease-out: cubic-bezier(0, 0, 0.2, 1);
}

*, *::before, *::after {
  box-sizing: border-box;
  -webkit-tap-highlight-color: transparent;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
html, body { margin: 0; overflow-x: hidden; overscroll-behavior-y: contain; }

/* Vanta.js (WebGL decorative background) injects its own <canvas> at runtime
   and, on some builds, stamps that canvas with its own inline pointer-events
   / touch-action so its (disabled) camera-drag controls still have something
   to bind to. An inline style with no !important loses to an author
   stylesheet rule that DOES carry !important, so this is a hard guarantee —
   independent of whatever Vanta sets on the element directly — that the
   decorative canvas can never sit in the hit-test path for wheel, touch, or
   click input meant for the real page underneath it. */
.cb-vanta-host, .cb-vanta-host canvas {
  pointer-events: none !important;
  touch-action: pan-y !important;
}
@supports (padding: max(0px)) {
  body { padding-left: env(safe-area-inset-left); padding-right: env(safe-area-inset-right); padding-bottom: env(safe-area-inset-bottom); }
}
input, textarea, select { font-size: 16px; }
a { color: inherit; text-decoration: none; }
input::placeholder, textarea::placeholder { color: inherit; opacity: 0.35; }
summary::-webkit-details-marker { display: none; }

/* Scrollbar */
::-webkit-scrollbar { width: 4px; height: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(138,155,186,0.15); border-radius: 10px; }
::-webkit-scrollbar-thumb:hover { background: rgba(138,155,186,0.25); }
* { scrollbar-width: thin; scrollbar-color: rgba(138,155,186,0.15) transparent; }

/* ── Keyframes: all blur-to-focus, slow, intentional ── */
@keyframes cbspin { to { transform: rotate(360deg); } }
@keyframes cbShimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

@keyframes cbEnter {
  from { opacity: 0; transform: translateY(16px); filter: blur(8px); }
  to   { opacity: 1; transform: none; filter: blur(0); }
}
@keyframes cbFade {
  from { opacity: 0; filter: blur(4px); }
  to   { opacity: 1; filter: blur(0); }
}
@keyframes cbRise {
  from { opacity: 0; transform: translateY(12px); filter: blur(6px); }
  to   { opacity: 1; transform: none; filter: blur(0); }
}
@keyframes cbPop {
  from { opacity: 0; transform: scale(0.97); filter: blur(4px); }
  to   { opacity: 1; transform: none; filter: blur(0); }
}
@keyframes cbHero {
  from { opacity: 0; transform: translateY(20px); filter: blur(10px); }
  to   { opacity: 1; transform: none; filter: blur(0); }
}
@keyframes cbGate {
  from { opacity: 0; transform: translateY(16px); filter: blur(8px); }
  to   { opacity: 1; transform: none; filter: blur(0); }
}
@keyframes cbModal {
  from { opacity: 0; transform: translateY(16px) scale(0.98); filter: blur(6px); }
  to   { opacity: 1; transform: none; filter: blur(0); }
}
@keyframes cbBackdrop { from { opacity: 0; } to { opacity: 1; } }
@keyframes cbSlideUp {
  from { opacity: 0; transform: translateY(24px); filter: blur(6px); }
  to   { opacity: 1; transform: none; filter: blur(0); }
}
@keyframes cbMicPulse {
  0%, 100% { opacity: 0.5; transform: scale(1); }
  50%      { opacity: 0; transform: scale(1.5); }
}
@keyframes cbSynapse {
  0%, 100% { opacity: 0.2; transform: scale(0.7); }
  35%      { opacity: 1; transform: scale(1.2); }
  65%      { opacity: 0.35; transform: scale(0.85); }
}
@keyframes cb-float {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-4px); }
}
@keyframes cbGlowPulse {
  0%, 100% { opacity: 0.4; transform: scale(1); }
  50%      { opacity: 0.8; transform: scale(1.1); }
}
@keyframes cbCaret { 0%, 45% { opacity: 1; } 55%, 100% { opacity: 0.15; } }

/* CTA shimmer */
.cb-glow-btn { position: relative; overflow: hidden; }
.cb-glow-btn::before {
  content: "";
  position: absolute; inset: 0;
  background: linear-gradient(105deg, transparent 35%, rgba(255,255,255,0.12) 45%, rgba(255,255,255,0.18) 50%, rgba(255,255,255,0.12) 55%, transparent 65%);
  background-size: 250% 100%;
  animation: cbBtnShimmer 4s ease-in-out infinite;
  border-radius: inherit;
}
@keyframes cbBtnShimmer { 0% { background-position: 200% center; } 100% { background-position: -200% center; } }

/* ── Entrance classes: all SLOW (500-800ms) ── */
.cb-fade    { animation: cbFade  500ms var(--cb-ease) both; }
.cb-rise    { animation: cbRise  600ms var(--cb-ease) both; }
.cb-pop     { animation: cbPop   400ms var(--cb-ease) both; }
.cb-gate    { animation: cbGate  800ms var(--cb-ease) both; }
.cb-hero    { animation: cbHero  900ms var(--cb-ease) both; }
.cb-modal   { animation: cbModal 400ms var(--cb-ease) both; will-change: transform, opacity, filter; }
.cb-backdrop { animation: cbBackdrop 300ms ease both; }
.cb-answer-enter.cb-glass-panel { animation: cbEnter 700ms var(--cb-ease) both; }

/* ── Kinetic wordmark: per-letter entrance, see KineticText ──
   background and background-clip are NOT inherited CSS properties — once
   the wordmark's text moved from the parent span into per-letter child
   spans, the parent's own gradient had nothing left to clip against (no
   direct text of its own) and the children inherited only the transparent
   fill-color half of the effect, with no gradient behind it. Net result:
   fully invisible text, confirmed by actually rendering it. Fix is to give
   each letter its own copy of the same gradient, not just rely on the
   parent's — verified after the fact with a screenshot, not just reasoned
   through, since this exact class of bug looks fine in the DOM inspector
   (correct text, correct opacity) while being invisible on screen. */
.cb-kinetic > span {
  background: linear-gradient(270deg, ${BRAND_GRADIENT_STOPS});
  background-size: 400% 400%;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  animation: cbGradientShift 8s ease infinite, cbLetterIn 500ms ease both;
  opacity: 0;
}
@keyframes cbLetterIn { from { opacity: 0; } to { opacity: 1; } }

/* ── Hero background: slow aurora drift instead of a static glow ── */
.cb-hero-glow { animation: cbAuroraDrift 16s ease-in-out infinite; }
@keyframes cbAuroraDrift {
  0%, 100% { transform: translateX(-50%) translateY(0) scale(1); opacity: 0.9; }
  50% { transform: translateX(-46%) translateY(18px) scale(1.08); opacity: 1; }
}

/* ── Soft pulsing ring behind the hero mark ── */
.cb-hero-ring { animation: cbRingPulse 3.6s ease-in-out infinite; }
@keyframes cbRingPulse {
  0%, 100% { transform: scale(1); opacity: 0.5; }
  50% { transform: scale(1.16); opacity: 0.15; }
}

/* ── Stagger cascade: slower delays ── */
.cb-stagger > * { opacity: 0; animation: cbFade 500ms var(--cb-ease) both; }
.cb-stagger > *:nth-child(1) { animation-delay: 0ms; }
.cb-stagger > *:nth-child(2) { animation-delay: 60ms; }
.cb-stagger > *:nth-child(3) { animation-delay: 120ms; }
.cb-stagger > *:nth-child(4) { animation-delay: 180ms; }
.cb-stagger > *:nth-child(5) { animation-delay: 240ms; }
.cb-stagger > *:nth-child(6) { animation-delay: 300ms; }
.cb-stagger > *:nth-child(7) { animation-delay: 360ms; }
.cb-stagger > *:nth-child(8) { animation-delay: 420ms; }
.cb-stagger > *:nth-child(n+9) { animation-delay: 480ms; }

/* ── Global button physics: subtle, no bounce ── */
button {
  transition: transform 120ms ease, opacity 200ms ease, background-color 200ms ease, border-color 200ms ease, color 200ms ease, box-shadow 200ms ease;
}
button:not(:disabled):hover { transform: translateY(-1px); }
button:not(:disabled):active { transform: scale(0.98) translateY(0); transition-duration: 60ms; }
button:disabled { opacity: 0.4; cursor: not-allowed; }

/* ── Search focus glow — clean, no radar ── */
.cb-search-glow { position: relative; }
.cb-search-glow:focus-within {
  border-color: var(--cb-accent, #34d399) !important;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--cb-accent, #34d399) 15%, transparent), 0 4px 20px rgba(0,0,0,0.1) !important;
}
@supports not (background: color-mix(in srgb, red 50%, blue)) {
  .cb-search-glow:focus-within { box-shadow: 0 0 0 3px rgba(52,211,153,0.15), 0 4px 20px rgba(0,0,0,0.1) !important; }
}

/* ── Header buttons ── */
.cb-hbtn:hover:not(:disabled) { background: rgba(138,155,186,0.08) !important; }
.cb-hbtn:active:not(:disabled) { background: rgba(138,155,186,0.14) !important; }

/* ── Cards with glass depth ── */
.cb-card {
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1),
              border-color 0.3s ease, box-shadow 0.3s ease;
  will-change: transform;
}
.cb-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 12px 40px rgba(0,0,0,0.15);
}

/* Source card hover lift */
.cb-src-card {
  transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1),
              box-shadow 0.25s, border-color 0.25s;
}
.cb-src-card:hover { transform: translateY(-2px); }

/* Glass panel depth — multi-layer shadows for 3D float effect */
.cb-glass-panel {
  box-shadow: 
    0 0 0 0.5px rgba(255,255,255,0.05) inset,
    0 1px 0 rgba(255,255,255,0.03) inset,
    0 4px 16px rgba(0,0,0,0.2),
    0 16px 48px rgba(0,0,0,0.15);
}

/* Smooth page-level transitions */
.cb-page-enter {
  animation: cbPageEnter 0.8s cubic-bezier(0.16, 1, 0.3, 1) both;
}
@keyframes cbPageEnter {
  from { opacity: 0; transform: translateY(30px); filter: blur(12px); }
  to { opacity: 1; transform: none; filter: blur(0); }
}

/* Suggestion chip hover ripple */
.cb-chip-hover {
  position: relative;
  overflow: hidden;
}
.cb-chip-hover::after {
  content: '';
  position: absolute; inset: 0;
  background: radial-gradient(circle at var(--mx, 50%) var(--my, 50%), rgba(255,255,255,0.08), transparent 60%);
  opacity: 0;
  transition: opacity 0.3s ease;
  pointer-events: none;
}
.cb-chip-hover:hover::after { opacity: 1; }

/* Premium text reveal for headings */
.cb-text-reveal {
  animation: cbTextReveal 1s cubic-bezier(0.16, 1, 0.3, 1) both;
}
@keyframes cbTextReveal {
  from { opacity: 0; transform: translateY(20px); filter: blur(8px); letter-spacing: 0.05em; }
  to { opacity: 1; transform: none; filter: blur(0); letter-spacing: inherit; }
}

/* Floating action button pulse */
.cb-fab-pulse {
  animation: cbFabPulse 2.5s ease-in-out infinite;
}
@keyframes cbFabPulse {
  0%, 100% { box-shadow: 0 4px 20px var(--fab-glow, rgba(52,211,153,0.35)); }
  50% { box-shadow: 0 4px 32px var(--fab-glow, rgba(52,211,153,0.5)); }
}

/* Focus */
:focus { outline: none; }
:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; border-radius: 6px; }

/* ── Animated gradient text — cycles through accent colors ── */
@keyframes cbGradientShift {
  0%   { background-position: 0% 50%; }
  50%  { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
.cb-gradient-text {
  background: linear-gradient(270deg, ${BRAND_GRADIENT_STOPS});
  background-size: 400% 400%;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  animation: cbGradientShift 8s ease infinite;
}

/* Toast notifications */
@keyframes cbToastPop {
  from { opacity: 0; transform: translateY(10px) scale(0.96); }
  to   { opacity: 1; transform: none; }
}
.cb-toast-pop { animation: cbToastPop 0.22s var(--cb-ease-out, ease-out) both; }

/* Range sliders */
input[type="range"] { -webkit-appearance: none; height: 3px; border-radius: 2px; }
input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%;
  background: currentColor; cursor: pointer; transition: transform 120ms ease;
}
input[type="range"]::-webkit-slider-thumb:hover { transform: scale(1.2); }
input[type="range"]::-webkit-slider-thumb:active { transform: scale(1.35); }

/* v5: the whole "Info page styles" block that used to live here (.cb-info-
   block h2/p/ul/li, .cb-info-navlink, .cb-fadein) was a dead duplicate —
   InfoPage() renders its own <style> tag with a complete, theme-aware
   version of every one of these rules (real hover color, accent-tinted
   bullet dots, its own fade-in keyframe), and nothing outside InfoPage ever
   uses these classes. Two contradictory rule sets for the same selectors
   living in two different places was a maintenance trap waiting to bite
   whoever edited one and not the other. Removed; see InfoPage's own <style>
   block for the real definitions. */

/* ════════════════════════════════════════════════════════════════
   ACCESSIBILITY CSS — all features controlled by classes on root
   ════════════════════════════════════════════════════════════════ */

/* ── High contrast ── */
.cb-high-contrast,
.cb-high-contrast p,
.cb-high-contrast span,
.cb-high-contrast div,
.cb-high-contrast li,
.cb-high-contrast td,
.cb-high-contrast label { color: #ffffff !important; }
.cb-high-contrast a { color: #5eead4 !important; text-decoration: underline !important; }
.cb-high-contrast h1, .cb-high-contrast h2, .cb-high-contrast h3,
.cb-high-contrast strong, .cb-high-contrast b { color: #ffffff !important; font-weight: 800 !important; }
.cb-high-contrast button { border-width: 2px !important; }
.cb-high-contrast input, .cb-high-contrast select, .cb-high-contrast textarea {
  border: 2px solid rgba(255,255,255,0.4) !important; color: #ffffff !important;
}

/* ── Text size ── */
.cb-text-sm  { font-size: 14px !important; }
.cb-text-sm p, .cb-text-sm li, .cb-text-sm span { font-size: 14px !important; }
.cb-text-lg  p, .cb-text-lg li, .cb-text-lg span  { font-size: 18px !important; }
.cb-text-lg  h1 { font-size: clamp(36px, 6vw, 56px) !important; }
.cb-text-lg  h2 { font-size: 24px !important; }
.cb-text-xl  p, .cb-text-xl li, .cb-text-xl span  { font-size: 21px !important; }
.cb-text-xl  h1 { font-size: clamp(40px, 7vw, 64px) !important; }
.cb-text-xl  h2 { font-size: 28px !important; }

/* ── Line spacing ── */
.cb-line-relaxed p, .cb-line-relaxed li, .cb-line-relaxed div { line-height: 2.0 !important; }
.cb-line-loose   p, .cb-line-loose   li, .cb-line-loose   div { line-height: 2.4 !important; }

/* ── Solid panels (reduce transparency) ── */
.cb-solid-panels * {
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}
.cb-solid-panels header { background: var(--cb-solid-bg, #050816) !important; }

/* ── Dyslexia-friendly font ── */
.cb-dyslexic, .cb-dyslexic p, .cb-dyslexic li, .cb-dyslexic span,
.cb-dyslexic input, .cb-dyslexic textarea, .cb-dyslexic button {
  font-family: 'OpenDyslexic', 'Comic Sans MS', sans-serif !important;
  letter-spacing: 0.05em !important;
  word-spacing: 0.15em !important;
}

/* ── Focus ring indicators ── */
.cb-focus-ring *:focus {
  outline: 3px solid #5eead4 !important;
  outline-offset: 3px !important;
  border-radius: 4px;
}
.cb-focus-ring *:focus:not(:focus-visible) { outline: none !important; }
.cb-focus-ring *:focus-visible {
  outline: 3px solid #5eead4 !important;
  outline-offset: 3px !important;
}

/* ── Scroll progress bar ──
   v6.4: had no explicit width, and with only left:0 set (not right:0)
   under position:fixed, a contentless empty div shrinks-to-fit to ~0 width
   per spec — this bar was rendering at zero width regardless of scrollProg.
   Explicit width fixes it. */
.cb-scroll-progress {
  position: fixed; top: 0; left: 0; width: 100%; height: 2px; z-index: 100;
  background: var(--cb-accent, #34d399);
  transform-origin: left; transition: transform 0.1s linear;
  pointer-events: none;
}

/* ── Answer content typography — premium scientific reading experience ── */
.cb-answer-enter p { margin: 0 0 1em; }
.cb-answer-enter p:last-child { margin-bottom: 0; }
.cb-answer-enter strong { font-weight: 650; }
.cb-answer-enter em { font-style: italic; }
.cb-answer-enter h1, .cb-answer-enter h2, .cb-answer-enter h3 {
  font-family: var(--cb-display);
  letter-spacing: -0.02em;
  margin: 1.5em 0 0.5em;
  line-height: 1.3;
}
.cb-answer-enter h1:first-child, .cb-answer-enter h2:first-child, .cb-answer-enter h3:first-child { margin-top: 0; }

/* Citation superscript links within answers */
.cb-answer-enter a[href^="#ref-"] {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 18px;
  font-size: 10px; font-weight: 700; font-family: var(--cb-mono);
  text-decoration: none;
  border-radius: 4px;
  vertical-align: super;
  padding: 0 3px;
  margin: 0 1px;
  transition: all 0.15s ease;
}
.cb-answer-enter a[href^="#ref-"]:hover {
  transform: scale(1.1);
}

/* Smooth scroll for citation jumps */
html { scroll-behavior: smooth; }

/* ── Print-friendly ── */
@media print {
  header, footer, .cb-fab-pulse, button { display: none !important; }
  body, div { background: white !important; color: black !important; }
  * { backdrop-filter: none !important; box-shadow: none !important; }
  .cb-answer-enter { font-size: 12pt !important; line-height: 1.6 !important; }
  .cb-answer-enter strong { font-weight: bold !important; }
}

/* ── Text selection accent ──
   v5: there used to be two competing ::selection rules in this file (one
   here, one up near the base resets) — neither tied to the user's actual
   chosen accent, so selection color mismatched the theme for 7 of the 8
   accent choices. One rule now, keyed to the same --cb-accent custom
   property the rest of the theme already uses. */
::selection { background: color-mix(in srgb, var(--cb-accent, #34d399) 25%, transparent); }

/* ── Scroll-to-top button ── */
.cb-scroll-top {
  transition: opacity 0.3s ease, transform 0.3s ease !important;
}
.cb-scroll-top:hover {
  transform: translateY(-2px) !important;
  opacity: 1 !important;
}

/* ── Smooth theme transitions ── */
body {
  transition: background-color 0.4s ease;
}

/* ── Better mobile touch targets ── */
@media (max-width: 900px) {
  button, a, input, select {
    min-height: 44px;
  }
  .cb-hbtn {
    min-width: 44px !important;
  }
}

/* ── Loading step checklist ── */
@keyframes cbCheckIn {
  from { opacity: 0; transform: translateX(-8px); }
  to { opacity: 1; transform: none; }
}

/* ── Reduced motion ── */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
`;

/* Animation-library loading. The Google Fonts stylesheet used to be
   injected here, by JS, after mount — which meant the font request never
   even started until React had already mounted and painted the fallback
   font (Georgia standing in for Cormorant Garamond on the hero headline),
   guaranteeing a visible flash-of-unstyled-text on every first visit.
   It's now a plain <link> in index.html's <head>, requested before the JS
   bundle even finishes parsing — see index.html for the real tag and the
   preconnect hints alongside it. */
(function initClientAssets() {
  if (typeof document === "undefined") return;
  // v5: OpenDyslexic used to load unconditionally on every single page view,
  // for every visitor, regardless of whether the dyslexia-friendly-font
  // toggle in Settings had ever been turned on — a wasted request for the
  // overwhelming majority of users. Only fetch it if the saved preference
  // already has it on; ensureDyslexicFont() (below) covers the case where
  // someone turns the toggle on mid-session.
  if (getCookie("cb_df") === "1") ensureDyslexicFont();
  // Bug/dead weight: this used to also load the AOS scroll-animation
  // library (a stylesheet + script from a CDN, plus an init call and a
  // refresh() on every turn/busy change elsewhere in this file) even though
  // zero elements anywhere in this app carry a `data-aos` attribute — AOS
  // had no effect on anything, it just cost two extra network round-trips
  // and a JS init/refresh cycle on every page load. Removed entirely.
  // Preload Vanta dependencies
  ensureVanta().catch(() => {});
})();

/* Root */
function Root() {
  const p = typeof window !== "undefined"
    ? window.location.pathname.replace(/\.html$/, "").replace(/\/+$/, "")
    : "";
  if (p === "/about") return <><style dangerouslySetInnerHTML={{ __html: CSS }} /><InfoPage page="about" /></>;
  if (p === "/privacy") return <><style dangerouslySetInnerHTML={{ __html: CSS }} /><InfoPage page="privacy" /></>;
  if (p === "/terms") return <><style dangerouslySetInnerHTML={{ __html: CSS }} /><InfoPage page="terms" /></>;
  if (p === "/contact") return <><style dangerouslySetInnerHTML={{ __html: CSS }} /><InfoPage page="contact" /></>;
  return <><style dangerouslySetInnerHTML={{ __html: CSS }} /><App /></>;
}

createRoot(document.getElementById("root")).render(<Root />);
