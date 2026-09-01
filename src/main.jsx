import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createRoot } from "react-dom/client";
import gsap from "gsap";

/* ════════════════════════════════════════════════════════════════
   CEREBRUM — design philosophy

   Design language: Deep space observatory. Not a chatbot — a
   research instrument that happens to understand language.
   
   Typography: Space Grotesk for display (tight geometric grotesk,
   engineered rather than editorial — reads as a precision instrument,
   not a magazine), Inter for body (proven readability at small
   sizes), JetBrains Mono for data/metadata (instrument readout
   precision).
   
   Layout: Left-aligned editorial grid. Massive whitespace. The 
   content breathes. Headlines run large. The search bar is a 
   command line, not a friendly input. Results read like a premium 
   research brief — you'd print this.
   
   Color: Deep navy foundation (#070b14). Surfaces are slightly 
   lifted with blue-tinted glass. Accent is used only for 
   citations, active states, and the search ring. Everything else
   is monochrome with blue undertones.
   
   Motion: No bouncy springs. UI transitions fade in with slight
   upward drift and blur-to-focus — smooth, slow, intentional, like
   instruments warming up. The one exception is the background itself
   (see LivingBackground/ConstellationField): a sparse, slowly-drifting
   node field with thin connecting lines — a live echo of the app's
   own Source Network feature, rendered as ambient texture rather
   than UI chrome.
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

// "2h ago"-style relative time for the Inbox's thread list. Falls back to a
// short absolute date past a week, same threshold the History modal's own
// (absolute-only) date display effectively uses.
function relativeTime(ms) {
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

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
  let res;
  try {
    res = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...payload }) });
  } catch (netErr) {
    throw new Error("Connection to auth server failed. Please check your network or try again.");
  }
  const isJson = (res.headers.get("content-type") || "").includes("json");
  const data = isJson ? await res.json().catch(() => ({})) : {};
  if (!res.ok) {
    if (!isJson) throw new Error("Couldn't reach the account service right now — it may not be deployed yet. Try again shortly, or contact support if this keeps happening.");
    // Surface the specific backend error (e.g. "Incorrect email or password",
    // "An account with that email already exists", "Too many attempts") so the
    // user sees exactly what went wrong rather than a generic catch-all.
    throw new Error(data.error || (res.status === 401 ? "Invalid credentials." : res.status === 429 ? "Too many requests — wait a moment and try again." : "Something went wrong. Please try again."));
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
async function apiDataGet(resource, params) {
  try {
    const qs = new URLSearchParams({ resource, ...(params || {}) });
    const res = await fetch(`/api/data?${qs.toString()}`);
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
// The Multiplayer Network actions (update-profile/toggle-follow/send-message)
// dispatch on a bare `action` field with no `resource` at all — see the
// comment above them in functions/api/data.js. Reuses apiDataPost's error
// handling rather than duplicating it; passing `undefined` as the resource
// just means JSON.stringify drops that key from the request body entirely.
async function apiDataAction(action, payload) {
  return apiDataPost(undefined, { action, ...payload });
}

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");
const MOD = IS_MAC ? "⌘" : "Ctrl";
const kbdLabel = (key) => `${MOD}${IS_MAC ? "" : "+"}${key}`;

// Loading messages retired — replaced by deterministic AgentTrace log.

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

// v33: some upstream scholarly metadata (Crossref/PubMed/OpenAlex title
// fields, in particular) carries basic HTML formatting for chemical
// formulas and species/genus names — "CO<sub>2</sub> capture", "<i>E.
// coli</i> biofilms". Every title in this app rendered as a plain React
// text child, which is safe (React auto-escapes string children) but shows
// the literal tag characters to the reader instead of the subscript/italic
// they're meant to convey — the "<sub>0.5</sub>" bug this fixes. The fix is
// deliberately NOT dangerouslySetInnerHTML on raw title text — that would
// hand an upstream API this app doesn't control a way to run arbitrary
// HTML/script in every visitor's browser. Instead this parses ONLY four
// whitelisted, well-known-safe formatting tags into real React elements;
// everything else in the string — including any other tag-like substring —
// is emitted as a plain string segment, which React renders as an inert
// text node exactly like before, never as markup.
const TITLE_SAFE_TAG_RE = /<(sub|sup|i|b)>([^<]*)<\/\1>/gi;
function renderCleanTitle(raw) {
  const title = raw || "";
  if (!/<(sub|sup|i|b)>/i.test(title)) return title;
  const parts = [];
  let last = 0, m, key = 0;
  TITLE_SAFE_TAG_RE.lastIndex = 0;
  while ((m = TITLE_SAFE_TAG_RE.exec(title))) {
    if (m.index > last) parts.push(title.slice(last, m.index));
    parts.push(React.createElement(m[1].toLowerCase(), { key: key++ }, m[2]));
    last = TITLE_SAFE_TAG_RE.lastIndex;
  }
  if (last < title.length) parts.push(title.slice(last));
  return parts;
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

// Every video object search.js/videos.js hands back already carries a
// pre-validated 11-character id (see videos.js's YT_ID_RE check on the
// piped/invidious path) — prefer that directly and only fall back to
// parsing it out of the stored watch/shorts/youtu.be URL for anything
// older or from a path that didn't set `id`. Returns null rather than a
// guess when nothing usable is found, so a caller never embeds garbage.
const YT_ID_RE = /^[\w-]{11}$/;
function getYouTubeId(v) {
  if (v && v.id && YT_ID_RE.test(v.id)) return v.id;
  const url = (v && v.url) || "";
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([\w-]{11})/);
  return m ? m[1] : null;
}

function formatCitation(source, style, index) {
  const s = source || {};
  const authors = s.authors || "";
  const title = s.title || "Untitled";
  const journal = s.journal || "";
  const year = s.year || "n.d.";
  const url = s.url || "";
  // v28 fix: every style below used to unconditionally append ". " after
  // `authors` — fine when authors is a plain name list ("Smith J, Doe A"),
  // but the backend's own authors string sometimes already ends in "et
  // al." (already period-terminated), so blindly appending another "."
  // produced "et al.." — a real, visible double-period, not a one-off.
  // Trim first, then only add a period if one isn't already there.
  const authorsPart = (() => {
    const a = authors.trim();
    if (!a) return "";
    return (a.endsWith(".") ? a : a + ".") + " ";
  })();
  switch (style) {
    case "vancouver": {
      const parts = [`${index}. ${authorsPart}${title}.`];
      if (journal) parts.push(` ${journal}.`);
      parts.push(` ${year}.`);
      return parts.join("");
    }
    case "apa": {
      return `${authorsPart}(${year}). ${title}. ${journal ? "*" + journal + "*." : ""}`.trim();
    }
    case "mla": {
      return `${authorsPart}"${title}." *${journal || "n.p."}*, ${year}${url ? ", " + url : ""}.`;
    }
    case "chicago": {
      return `${authorsPart}${year}. "${title}." *${journal || "n.p."}*.`;
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
   DESIGN SYSTEM — palettes ("Darknode")

   v7.1 ground-up repaint: the previous system was a deep-navy "space
   observatory" — moody, but still fundamentally a soft, rounded
   consumer product underneath. This is a harder pivot: obsidian/pitch
   black foundations (#000000/#0a0a0a, not navy), hairline greyscale
   borders instead of tinted glass, and hard/tight shadows instead of
   diffuse glow — the visual target is an elite command-center /
   telemetry-console aesthetic, not an editorial reading app. Dark and
   Mid are now both true obsidian variants (Mid a shade lighter, for
   anyone who wants slightly more surface separation); Light is kept
   as the accessible non-dark option and deliberately NOT pushed
   toward the same "command center" look — that aesthetic is a dark-
   mode-only identity by design, matching the blueprint's own "Pure
   dark mode" framing.
   ════════════════════════════════════════════════════════════════ */

const PALETTES = {
  // Commit 46: REVERSED the "lift off pure black" direction from the two
  // rounds above, for Dark and Sage specifically — explicit follow-up
  // request for "razor-sharp, readable contrast" after the warm-charcoal
  // versions still read as low-contrast / muddy in practice, on top of
  // being the direct cause of the Commit 45 fog bug (a scrim tinted from
  // an accidentally-light `bg`). Back to a true near-black surface with
  // pure/near-pure white ink — Mid and Light are unaffected, this was
  // reported against Dark and Sage specifically.
  //
  // Older reasoning, kept for context now that it's been reversed: this
  // used to be lifted off pure black per explicit direction (Strike 5) on
  // the theory that near-black surfaces with stark white text read as
  // "cyberpunk terminal" rather than "premium research software," tuned to
  // sit at the lightness Apple/Linear/Notion's own dark surfaces use. That
  // reasoning didn't survive contact with actual use — hence this reversal.
  Dark:  { dark: true,  bg: "#09090b", surface: "#131316", raised: "#1c1c21", ink: "#ffffff", ink2: "#d4d4d8", faint: "#a1a1aa", line: "rgba(255,255,255,0.08)", line2: "rgba(255,255,255,0.15)", shadow: "none", shadowSm: "none", grain: 0, skel: "linear-gradient(90deg, #131316 25%, #1c1c21 50%, #131316 75%)" },
  // Slate: a cooler, blue-leaning dark surface (the Discord/Linear
  // register) for anyone who wants dark without Dark's neutral-grey cast —
  // kept deliberately cool rather than folded into the warm pair above, so
  // it stays a real alternative and not a fourth near-duplicate. Ink
  // softened off pure white to match the other three's restraint.
  Mid:   { dark: true,  bg: "#25262b", surface: "#303339", raised: "#3b3f46", ink: "#e8e7e5", ink2: "#a1a1aa", faint: "#9a9ca2", line: "rgba(255,255,255,0.08)", line2: "rgba(255,255,255,0.14)", shadow: "none", shadowSm: "none", grain: 0, skel: "linear-gradient(90deg, #303339 25%, #3b3f46 50%, #303339 75%)" },
  Light: { dark: false, bg: "#f5f4f1", surface: "#fbfaf8", raised: "#ffffff", ink: "#29261f", ink2: "#5a5548", faint: "#736e62", line: "rgba(41,38,31,0.07)", line2: "rgba(41,38,31,0.12)", shadow: "0 1px 2px rgba(41,38,31,0.05), 0 6px 18px rgba(41,38,31,0.07)", shadowSm: "0 1px 2px rgba(41,38,31,0.05)", grain: 0.006, skel: "linear-gradient(90deg, #efeeea 25%, #f6f5f2 50%, #efeeea 75%)" },
  // Sage — "Modern Organic," and now the default palette a fresh browser
  // lands on (see App()'s paletteName useState below): near-black stone
  // instead of neutral charcoal, paired by default with the muted
  // sage-green accent (ACCENTS.Sage) instead of a neon hue.
  // Commit 46: lifted back toward near-black alongside Dark, same
  // "razor-sharp contrast" request and same fog-bug root cause — see the
  // comment on Dark above. `ink`/`line` keep Sage's own warm-green
  // undertone rather than going fully neutral, so it stays visibly a
  // different palette from Dark, not a re-skinned duplicate.
  Sage:  { dark: true, bg: "#0d0f0e", surface: "#151816", raised: "#1e221f", ink: "#f4f7f4", ink2: "#cbd5cd", faint: "#94a397", line: "rgba(139,168,136,0.12)", line2: "rgba(139,168,136,0.2)", shadow: "none", shadowSm: "none", grain: 0, skel: "linear-gradient(90deg, #151816 25%, #1e221f 50%, #151816 75%)" },
};
// Cyberpunk-leaning neon set — the two hues the blueprint calls out by name
// (Matrix Green, Cyberpunk Cyan) moved to the front and pushed slightly
// more saturated/electric; the rest of the wheel (Violet, Sky/Indigo,
// Amber, Rose) kept for real per-user customization but tuned a shade
// cooler/harder so none of them reads as a pastel accent next to the new
// obsidian base.
const ACCENTS = { Mono: "#ffffff", Sage: "#8ba888" };

// v6.9: type sizing used to be ~228 separately hand-typed pixel literals —
// 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5 all meaning "small metadata text" to
// whoever typed each one in the moment, with no shared reference to keep them
// aligned. A real type scale collapses each cluster of near-duplicates onto
// one deliberate value, chosen to sit at (or already exactly match) that
// cluster's own most common existing size, so this is a consolidation pass,
// not a redesign — nothing should visually jump by more than ~1px anywhere.
// The two true one-off giant numerics (the hero stat display's 52/84 and the
// hero wordmark's responsive clamp()) are left as literals on purpose: they
// answer to their own unique layout, not to a shared metadata/heading scale.
const FONT_SIZES = {
  // Second readability pass (Commit 43) — the first pass (Commit 40) nudged
  // the smallest sizes up by half a point and lifted secondary-text
  // contrast; still reported as too small/hard to read in real use, so this
  // round moves every size in the scale up a full step rather than another
  // half-point nudge, on the theory that half a point was simply too
  // conservative a correction the first time.
  micro: 11,        // footnotes, superscripts, smallest badges
  caption: 12,      // metadata labels, timestamps, byline text
  small: 13,        // secondary text, form inputs, chips, tab labels
  body: 15,         // primary body copy
  subhead: 17,      // card titles, list items, modal subheads
  heading: 18,      // component/section headings
  sectionHead: 20,  // markdown-rendered answer section headers
  display: 24,      // headline callouts, mobile hero titles
  hero: 34,         // desktop hero titles, prominent stat numbers
};

// v31: the wordmark's animated emerald→sky→indigo gradient (this constant
// fed both `.cb-gradient-text` and `.cb-kinetic > span`) is retired — the
// "Next-Gen Editorial Intelligence" direction wants a calm, solid wordmark,
// not a cycling color shimmer. Both CSS rules now just use `currentColor`.

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

// Relative (perceptual) luminance of a hex color, 0 (black) to 1 (white) —
// used wherever a color needs to be checked against a FIXED surface rather
// than the current theme, since this app's own accent isn't always a real
// color: the only built-in scheme is genuine monochrome (see ACCENTS —
// white in dark mode, black in light mode), so "accent" can legitimately BE
// black. Anything checking accent against a hardcoded dark surface needs to
// know that, not just trust the prop.
function relLuminance(hex) {
  if (typeof hex !== "string" || !/^#[0-9a-fA-F]{6}$/.test(hex)) return 1;
  const c = (v) => { const n = parseInt(v, 16) / 255; return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4); };
  return 0.2126 * c(hex.slice(1, 3)) + 0.7152 * c(hex.slice(3, 5)) + 0.0722 * c(hex.slice(5, 7));
}

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
    case "menu": return <svg {...common}><path d="M4 6h16M4 12h16M4 18h16" /></svg>;
    case "arrowRight": return <svg {...common}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
    case "mic": return <svg {...common}><path d="M12 15a3 3 0 003-3V6a3 3 0 00-6 0v6a3 3 0 003 3z" /><path d="M5 12a7 7 0 0014 0M12 19v3" /></svg>;
    case "check": return <svg {...common}><path d="M20 6L9 17l-5-5" /></svg>;
    // v28: the toolbar's Copy button used to borrow "check" (a checkmark)
    // because it always had a visible "Copy answer" text label to carry the
    // actual meaning. Icon-only buttons can't lean on a label like that, so
    // Copy gets its own real clipboard glyph.
    case "copy": return <svg {...common}><rect x="8" y="8" width="12" height="12" rx="1.5" /><path d="M16 8V5.5A1.5 1.5 0 0014.5 4h-9A1.5 1.5 0 004 5.5v9A1.5 1.5 0 005.5 16H8" /></svg>;
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
    case "mail": return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3.5 6.5L12 13l8.5-6.5" /></svg>;
    case "badge": return <svg {...common}><circle cx="12" cy="9" r="5.5" /><path d="M8.5 13.5L7 21l5-2.6L17 21l-1.5-7.5" /></svg>;
    case "send": return <svg {...common}><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" /></svg>;
    case "flag": return <svg {...common}><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" /></svg>;
    case "award": return <svg {...common}><circle cx="12" cy="8" r="6" /><path d="M15.5 12.9L17 22l-5-3-5 3 1.5-9.1" /></svg>;
    case "bookOpen": return <svg {...common}><path d="M12 7v14" /><path d="M3 18a1 1 0 01-1-1V4a1 1 0 011-1h5a4 4 0 014 4 4 4 0 014-4h5a1 1 0 011 1v13a1 1 0 01-1 1h-6a3 3 0 00-3 3 3 3 0 00-3-3z" /></svg>;
    case "zap": return <svg {...common}><path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" /></svg>;
    case "camera": return <svg {...common}><path d="M4 8.5A1.5 1.5 0 015.5 7h2.2l1-1.6A1.5 1.5 0 0110 4.7h4a1.5 1.5 0 011.3.7l1 1.6h2.2A1.5 1.5 0 0120 8.5v10A1.5 1.5 0 0118.5 20h-13A1.5 1.5 0 014 18.5z" /><circle cx="12" cy="13" r="3.6" /></svg>;
    // Commit 46: added for VideoHuddle's FaceTime-style control island —
    // "off" variants follow this file's existing convention (see volumeOff
    // above) of the base glyph plus a diagonal slash, rather than a wholly
    // different symbol, so mic/camera on-vs-off reads as one pair at a
    // glance instead of two unrelated icons.
    case "micOff": return <svg {...common}><path d="M12 15a3 3 0 003-3V6a3 3 0 00-6 0v6a3 3 0 003 3z" /><path d="M5 12a7 7 0 0014 0M12 19v3" /><path d="M3 3l18 18" /></svg>;
    case "cameraOff": return <svg {...common}><path d="M4 8.5A1.5 1.5 0 015.5 7h2.2l1-1.6A1.5 1.5 0 0110 4.7h4a1.5 1.5 0 011.3.7l1 1.6h2.2A1.5 1.5 0 0120 8.5v10A1.5 1.5 0 0118.5 20h-13A1.5 1.5 0 014 18.5z" /><circle cx="12" cy="13" r="3.6" /><path d="M3 3l18 18" /></svg>;
    // Tile/grid view toggle for the huddle's "switch view" control.
    case "grid": return <svg {...common}><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" /></svg>;
    // End-call glyph: the standard rotated-handset silhouette (same shape
    // most icon sets use for "phone"), plus the same off-slash convention
    // as micOff/cameraOff above, for the red End Call button.
    case "phoneOff": return <svg {...common}><path d="M22 16.9v3a2 2 0 01-2.18 2 19.8 19.8 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.34 1.85.57 2.81.7a2 2 0 011.72 2.03z" /><path d="M2 2l20 20" /></svg>;
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

// v32 fix: some free-tier models (WAVE 2/3 in the backend race) comply with
// the "## Executive Summary" etc. header text itself but skip the blank
// line that's supposed to come before it — the header lands mid-sentence,
// glued to the end of the previous section ("...brainstem volume[7]. ##
// Current Evidence & Mechanisms\nChronic stress has been shown..."). The
// paragraph-splitter a few dozen lines down only recognizes a header when
// it's the ENTIRE contents of its own \n{2,}-delimited paragraph, so a
// glued-on header never matches — it just prints as literal "##" text in
// the middle of a paragraph, which is exactly the garbled output this
// patches. Since STRUCTURE (functions/api/search.js) hard-enforces these
// four section titles verbatim, we can look for the titles themselves —
// with or without a "##" prefix, with or without correct spacing — and
// force each one onto its own blank-line-delimited paragraph before the
// splitter ever runs. This is strictly additive: an answer that already
// has correct spacing round-trips through unchanged.
function normalizeSectionHeaders(text) {
  // Universally catch any ## or ### header that lacks a preceding blank
  // line and force \n\n before it, regardless of what title text follows —
  // an exact-title allowlist can't keep up with the model occasionally
  // drifting to a legacy/hallucinated title (e.g. "Executive Summary")
  // that was never in the list, which is what let literal "##" leak into
  // the UI in the first place.
  // No "i" flag: [A-Z] is deliberately case-sensitive here. A real header
  // always starts with a capital letter, and without that constraint this
  // also matches a stray "##" glued mid-sentence into ordinary lowercase
  // prose (e.g. "the drug ## interacts with...", "p ## 0.05 was..."),
  // turning an unrelated run-on sentence into a giant fake heading.
  return (text || "")
    .replace(/([^\n])\s*(#{2,3}\s+[A-Z])/g, "$1\n\n$2")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderAnswer(text, sources, P, accent, hoverCite, setHoverCite) {
  let clean = normalizeSectionHeaders(text || "")
    // v28 fix: this used to strip EVERY leading "#" on EVERY line
    // unconditionally, before the code a few dozen lines down ever got a
    // chance to look for "^##\s" / "^###\s" and render them as real
    // section headers. That made the header-rendering branch below
    // permanently dead — a synthesized answer with "## Executive Summary"
    // would have its "## " stripped right here and just print
    // "Executive Summary" as an ordinary paragraph, no visual distinction
    // at all. Removed: real "##"/"###" headers are exactly what the H2/H3
    // branches below are designed to catch, so there's nothing here that
    // needs stripping in the first place.
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
      // v28 fix: this used to glue the repaired citation back on with a
      // literal " " before the bracket ("word" + " " + "[1]" + "."), which
      // combined with the citation badge's own visual padding read as a
      // stray, ungrammatical gap — "word 1 ." instead of "word[1]." No
      // space belongs here; a citation sits directly against the word it
      // supports, same as any bracketed citation the model already writes
      // correctly on its own.
      return ds.length >= 1 ? b + ds.map(n => "["+n+"]").join("") + p : m;
    })
    // v28 fix: general safety net for citation spacing, independent of
    // which path produced the bracket — whether the model wrote "[1]"
    // correctly on its own, or it came from the bare-number repair just
    // above. A citation must sit snug against the word before it (no
    // space before the bracket) and any following punctuation must come
    // immediately after the badge, not after a gap ("faeces[1]." not
    // "faeces [1] ." or "faeces[1] ."). Handles runs of multiple adjacent
    // citations ("[1][2]") as one unit before the punctuation check.
    .replace(/\s+(\[\d+\])/g, "$1")
    .replace(/((?:\[\d+\])+)\s+([.,;:!?)\]])/g, "$1$2")
    .replace(/\n[-—]{2,}\s*\n/g, "\n\n")
    .replace(/\n\s*(references|sources|bibliography|citations|works cited)\s*:?\s*\n[\s\S]*$/i, "")
    .trim();

  return clean.split(/\n{2,}/).map((para, pi) => {
    // Markdown headers
    const h2 = para.match(/^##\s+(.+)$/);
    // v30: dropped the borderBottom divider — that read as a frame line on
    // a surface that's now deliberately frameless everywhere else. Bumped
    // larger and bolder per "large, bold h2/h3 for structural hierarchy";
    // whitespace above/below now does the separating work a rule used to.
    if (h2) return <h3 key={pi} style={{ fontSize: 26, fontWeight: 700, color: P.ink, margin: "44px 0 16px", letterSpacing: "-0.02em", fontFamily: "var(--cb-display)", lineHeight: 1.25 }}>{h2[1]}</h3>;
    const h3 = para.match(/^###\s+(.+)$/);
    if (h3) return <h4 key={pi} style={{ fontSize: 19, fontWeight: 700, color: P.ink, margin: "32px 0 12px", letterSpacing: "-0.015em", fontFamily: "var(--cb-display)", lineHeight: 1.3 }}>{h3[1]}</h4>;
    // Bold-line headers (e.g., "**Mechanism**")
    const boldHeader = para.match(/^\*\*([^*]+)\*\*\s*$/);
    if (boldHeader) return <h4 key={pi} style={{ fontSize: FONT_SIZES.subhead, fontWeight: 700, color: accent, margin: "30px 0 10px", letterSpacing: "-0.01em", fontFamily: "var(--cb-display)", lineHeight: 1.3 }}>{boldHeader[1]}</h4>;

    // Bullet lists: lines starting with "- " or "• "
    const bulletMatch = para.match(/^(?:[•\-]\s+.+\n?)+$/m);
    if (bulletMatch) {
      // Strip stray "##"/"###" that survived normalizeSectionHeaders as
      // plain text (see its own comment: a "##" NOT followed by a capital
      // letter is deliberately left alone there, so it doesn't get promoted
      // to a real header, but that also means it's never removed either —
      // it was reaching the page as literal hash characters). Safe here
      // because by definition this line already matched as a bullet, not a
      // header, so any "#" left in it is stray, not a marker.
      const items = para.split("\n").filter(l => /^[•\-]\s+/.test(l)).map(l => l.replace(/^[•\-]\s+/, "").replace(/#{2,3}\s*/g, ""));
      return (
        <ul key={pi} style={{ margin: "0 0 20px", paddingLeft: 24, listStyle: "none" }}>
          {items.map((item, ii) => (
            <li key={ii} style={{ fontSize: FONT_SIZES.subhead, lineHeight: 1.8, color: P.ink, marginBottom: 8, position: "relative", paddingLeft: 12, fontFamily: "var(--cb-body)", fontWeight: 400 }}>
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
      // Same stray-hash cleanup as the bullet-list branch above.
      const items = para.split("\n").filter(l => /^\d+\.\s+/.test(l)).map(l => l.replace(/^\d+\.\s+/, "").replace(/#{2,3}\s*/g, ""));
      return (
        <ol key={pi} style={{ margin: "0 0 20px", paddingLeft: 24, listStyle: "none", counterReset: "cb-list" }}>
          {items.map((item, ii) => (
            <li key={ii} style={{ fontSize: FONT_SIZES.subhead, lineHeight: 1.8, color: P.ink, marginBottom: 8, position: "relative", paddingLeft: 16, fontFamily: "var(--cb-body)", fontWeight: 400, counterIncrement: "cb-list" }}>
              <span style={{ position: "absolute", left: -8, top: 0, fontSize: FONT_SIZES.small, fontWeight: 700, color: accent, fontFamily: "var(--cb-mono)", opacity: 0.8 }}>{ii + 1}.</span>
              {renderInlineSegments(item, sources, P, accent, hoverCite, setHoverCite)}
            </li>
          ))}
        </ol>
      );
    }

    // Last-resort cleanup: anything reaching this default branch already
    // failed the h2/h3/bold-header checks above, so it is definitionally
    // NOT a real header — normalizeSectionHeaders only forces "##"/"###"
    // onto its own paragraph when a capital letter follows (deliberately,
    // to avoid turning a stray "##" glued into ordinary lowercase prose
    // into a fake giant heading — see that function's own comment). That
    // left exactly this case unhandled: the stray hash was correctly left
    // out of the heading path, but nothing ever removed the literal
    // characters either, so they were still reaching the page as visible
    // "##" text. Safe to strip unconditionally here since real headers
    // never reach this branch in the first place.
    const paraClean = para.replace(/#{2,3}\s*/g, "");
    return (
    <p key={pi} style={{ fontSize: 16, lineHeight: 1.7, margin: "0 0 20px", color: P.ink, letterSpacing: "-0.008em", fontFamily: "var(--cb-body)", fontWeight: 400 }}>
      {paraClean.split("\n").map((line, li) => (
        <React.Fragment key={li}>
          {renderInlineSegments(line, sources, P, accent, hoverCite, setHoverCite)}
          {li < paraClean.split("\n").length - 1 && <br />}
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
      // v30: was a tiny superscript "[1]" badge in mono — raised above the
      // baseline, breaking the sentence's reading line, and visually part of
      // the "hacker terminal" look this round explicitly retires. Rewritten
      // as an inline, baseline-sitting pill — "(1)" in the body sans-serif,
      // sitting in the text flow like Perplexity's citation chips rather
      // than interrupting it.
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
          display: "inline-flex", alignItems: "center",
          fontSize: 11, color: P.ink, verticalAlign: "baseline",
          textDecoration: "none", fontWeight: 600,
          fontFamily: "var(--cb-body)",
          margin: "0 2px", padding: "2px 8px",
          borderRadius: 12,
          background: hoverCite === n ? (P.dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.07)") : (P.dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.04)"),
          border: "1px solid " + P.line,
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
    <div style={{ marginTop: 20, border: `1px solid ${P.line2}`, borderRadius: 3, background: P.surface, padding: "20px 22px" }} className="cb-rise">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: oc, flexShrink: 0 }} />
        <span style={{ fontSize: FONT_SIZES.small, fontWeight: 600, letterSpacing: "0.02em", color: oc, fontFamily: "var(--cb-mono)", textTransform: "uppercase" }}>{label[fc.overall] || fc.overall}</span>
        <span style={{ fontSize: FONT_SIZES.caption, color: P.faint, marginLeft: "auto", fontFamily: "var(--cb-mono)" }}>vs. cited abstracts</span>
      </div>
      {score !== null && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: FONT_SIZES.hero, fontWeight: 700, color: scoreColor, letterSpacing: "-0.03em", fontFamily: "var(--cb-display)" }}>{score}<span style={{ fontSize: FONT_SIZES.subhead, fontWeight: 500, opacity: 0.7 }}>%</span></span>
            <span style={{ fontSize: FONT_SIZES.small, color: P.ink2, fontWeight: 500 }}>source alignment</span>
          </div>
          <div style={{ display: "flex", height: 4, borderRadius: 2, overflow: "hidden", background: P.line, gap: 1 }}>
            {nSup > 0 && <div style={{ flex: nSup, background: STATUS.good, borderRadius: 2 }} title={`${nSup} supported`} />}
            {nThin > 0 && <div style={{ flex: nThin, background: STATUS.warn, borderRadius: 2 }} title={`${nThin} thin`} />}
            {nUns > 0 && <div style={{ flex: nUns, background: STATUS.bad, borderRadius: 2 }} title={`${nUns} unsupported`} />}
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 8, fontFamily: "var(--cb-mono)", fontSize: FONT_SIZES.caption, color: P.faint }}>
            <span>{nSup} solid</span><span>{nThin} thin</span><span>{nUns} unsupported</span>
          </div>
        </div>
      )}
      {fc.summary && <div style={{ fontSize: FONT_SIZES.body, color: P.ink2, marginBottom: claims.length ? 14 : 0, lineHeight: 1.6, paddingTop: score !== null ? 14 : 0, borderTop: score !== null ? `1px solid ${P.line}` : "none" }}>{fc.summary}</div>}
      {claims.map((c, i) => {
        const cc = colors[c.status] || P.ink2;
        const iconName = c.status === "supported" ? "check" : c.status === "thin" ? "partial" : "close";
        return (
          <div key={i} style={{ display: "flex", gap: 12, padding: "10px 0", borderTop: i ? `1px solid ${P.line}` : "none" }}>
            <span style={{ color: cc, flexShrink: 0, width: 18, height: 18, borderRadius: 3, background: withAlpha(cc, 0.1), display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}><Icon name={iconName} size={11} /></span>
            <div><div style={{ fontSize: FONT_SIZES.small, color: P.ink, lineHeight: 1.5 }}>{c.claim}</div>{c.note && <div style={{ fontSize: FONT_SIZES.small, color: P.faint, marginTop: 3, lineHeight: 1.5 }}>{c.note}</div>}</div>
          </div>
        );
      })}
    </div>
  );
}

function Skeleton({ P, accent }) {
  const bar = (w, h = 12, delay = 0) => (
    <div style={{
      height: h, width: w, borderRadius: 3,
      background: P.skel,
      backgroundSize: "200% 100%",
      animation: `cbShimmer 1.8s ease-in-out ${delay}ms infinite`,
    }} />
  );
  return (
    <div style={{
      background: P.dark ? withAlpha(P.surface, 0.85) : "rgba(255,255,255,0.7)",
      backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
      border: `1px solid ${P.line}`,
      borderRadius: 3, padding: "32px 34px",
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

// Deterministic deployment-log-style trace — replaces the old rotating
// joke messages with a timestamped, Vercel-style progress readout.
function AgentTrace({ P, accent }) {
  const startRef = useRef(performance.now());
  const [now, setNow] = useState(performance.now());
  const STEPS = [
    { t: 0,    label: "Initializing query pipeline" },
    { t: 600,  label: "Dispatching to 14 indexes" },
    { t: 1800, label: "PubMed · Europe PMC · OpenAlex responding" },
    { t: 3200, label: "Semantic Scholar · Crossref · arXiv responding" },
    { t: 4800, label: "De-duplicating and ranking results" },
    { t: 6200, label: "Scoring evidence quality" },
    { t: 7600, label: "Checking retraction databases" },
    { t: 9200, label: "Synthesizing answer" },
  ];
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(id);
  }, []);
  const elapsed = now - startRef.current;
  let activeIdx = 0;
  for (let i = STEPS.length - 1; i >= 0; i--) {
    if (elapsed >= STEPS[i].t) { activeIdx = i; break; }
  }
  return (
    <div style={{ padding: "16px 0 4px", fontFamily: "var(--cb-mono)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: accent, boxShadow: `0 0 8px ${withAlpha(accent, 0.5)}`, animation: "cbSynapse 1.25s cubic-bezier(0.4,0,0.6,1) infinite" }} />
        <span style={{ fontSize: FONT_SIZES.caption, color: P.ink2, letterSpacing: "0.02em" }}>
          {Math.floor(elapsed / 1000)}.{Math.floor((elapsed % 1000) / 100)}s elapsed
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {STEPS.map((step, i) => {
          if (elapsed < step.t) return null;
          const done = i < activeIdx;
          const active = i === activeIdx;
          return (
            <div key={i} className="cb-fade" style={{
              display: "flex", alignItems: "center", gap: 12, padding: "3px 0",
              opacity: active ? 1 : done ? 0.45 : 0.2,
              transition: "opacity 300ms ease",
            }}>
              <span style={{
                fontSize: FONT_SIZES.micro, color: P.faint,
                fontVariantNumeric: "tabular-nums", minWidth: 44, textAlign: "right",
              }}>
                {String(Math.floor(step.t / 1000)).padStart(2, "0")}.{Math.floor((step.t % 1000) / 100)}s
              </span>
              <span style={{
                width: 5, height: 5, borderRadius: "50%", flexShrink: 0,
                background: done ? P.faint : active ? accent : P.line,
                transition: "all 300ms ease",
              }} />
              <span style={{
                fontSize: FONT_SIZES.caption,
                color: active ? P.ink : P.faint,
                fontWeight: active ? 600 : 400,
                letterSpacing: "0.01em",
                transition: "color 300ms ease",
              }}>
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================
   CINEMATIC BRAIN INTRO — preserved canvas logic entirely, 
   redesigned surrounding UI
   ============================================================ */

/* ════════════════════════════════════════════════════════════════
   INTRO — cinematic landing

   Always dark. WebGL particle field background. Staggered text
   reveal with blur-to-focus. No neural canvas, no cheap animations.
   Two CTAs: "Start exploring" and "How it works."
   ════════════════════════════════════════════════════════════════ */

/* ════════════════════════════════════════════════════════════════
   ORB — Intro screen background (ogl, hover-reactive glow sphere)
   ════════════════════════════════════════════════════════════════ */
function Orb({ hue = 0, hoverIntensity = 0.2, rotateOnHover = true, forceHoverState = false, backgroundColor = "#000000" }) {
  const mountRef = useRef(null);
  useEffect(() => {
    const reduceMotion = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;
    const container = mountRef.current;
    if (!container) return;
    let cancelled = false; let renderer, gl, rafId;
    const handlers = {};

    (async () => {
      try {
        const { Renderer, Program, Mesh, Triangle, Vec3 } = await import("ogl");
        if (cancelled || !container) return;

        const hexToVec3 = (hex) => {
          const h = hex.replace("#", "");
          return new Vec3(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255);
        };

        const vert = `
          precision highp float;
          attribute vec2 position;
          attribute vec2 uv;
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = vec4(position, 0.0, 1.0);
          }
        `;
        const frag = `
          precision highp float;
          uniform float iTime;
          uniform vec3 iResolution;
          uniform float hue;
          uniform float hover;
          uniform float rot;
          uniform float hoverIntensity;
          uniform vec3 backgroundColor;
          varying vec2 vUv;

          vec3 rgb2yiq(vec3 c) { float y = dot(c, vec3(0.299, 0.587, 0.114)); float i = dot(c, vec3(0.596, -0.274, -0.322)); float q = dot(c, vec3(0.211, -0.523, 0.312)); return vec3(y, i, q); }
          vec3 yiq2rgb(vec3 c) { float r = c.x + 0.956 * c.y + 0.621 * c.z; float g = c.x - 0.272 * c.y - 0.647 * c.z; float b = c.x - 1.106 * c.y + 1.703 * c.z; return vec3(r, g, b); }
          vec3 adjustHue(vec3 color, float hueDeg) {
            float hueRad = hueDeg * 3.14159265 / 180.0;
            vec3 yiq = rgb2yiq(color);
            float cosA = cos(hueRad); float sinA = sin(hueRad);
            float i = yiq.y * cosA - yiq.z * sinA; float q = yiq.y * sinA + yiq.z * cosA;
            yiq.y = i; yiq.z = q;
            return yiq2rgb(yiq);
          }
          vec3 hash33(vec3 p3) {
            p3 = fract(p3 * vec3(0.1031, 0.11369, 0.13787));
            p3 += dot(p3, p3.yxz + 19.19);
            return -1.0 + 2.0 * fract(vec3(p3.x + p3.y, p3.x + p3.z, p3.y + p3.z) * p3.zyx);
          }
          float snoise3(vec3 p) {
            const float K1 = 0.333333333; const float K2 = 0.166666667;
            vec3 i = floor(p + (p.x + p.y + p.z) * K1);
            vec3 d0 = p - (i - (i.x + i.y + i.z) * K2);
            vec3 e = step(vec3(0.0), d0 - d0.yzx);
            vec3 i1 = e * (1.0 - e.zxy);
            vec3 i2 = 1.0 - e.zxy * (1.0 - e);
            vec3 d1 = d0 - (i1 - K2);
            vec3 d2 = d0 - (i2 - K1);
            vec3 d3 = d0 - 0.5;
            vec4 h = max(0.6 - vec4(dot(d0, d0), dot(d1, d1), dot(d2, d2), dot(d3, d3)), 0.0);
            vec4 n = h * h * h * h * vec4(dot(d0, hash33(i)), dot(d1, hash33(i + i1)), dot(d2, hash33(i + i2)), dot(d3, hash33(i + 1.0)));
            return dot(vec4(31.316), n);
          }
          vec4 extractAlpha(vec3 colorIn) { float a = max(max(colorIn.r, colorIn.g), colorIn.b); return vec4(colorIn.rgb / (a + 1e-5), a); }

          const vec3 baseColor1 = vec3(0.611765, 0.262745, 0.996078);
          const vec3 baseColor2 = vec3(0.298039, 0.760784, 0.913725);
          const vec3 baseColor3 = vec3(0.062745, 0.078431, 0.600000);
          const float innerRadius = 0.6;
          const float noiseScale = 0.65;

          float light1(float intensity, float attenuation, float dist) { return intensity / (1.0 + dist * attenuation); }
          float light2(float intensity, float attenuation, float dist) { return intensity / (1.0 + dist * dist * attenuation); }

          vec4 draw(vec2 uv) {
            vec3 color1 = adjustHue(baseColor1, hue);
            vec3 color2 = adjustHue(baseColor2, hue);
            vec3 color3 = adjustHue(baseColor3, hue);
            float ang = atan(uv.y, uv.x);
            float len = length(uv);
            float invLen = len > 0.0 ? 1.0 / len : 0.0;
            float bgLuminance = dot(backgroundColor, vec3(0.299, 0.587, 0.114));
            float n0 = snoise3(vec3(uv * noiseScale, iTime * 0.5)) * 0.5 + 0.5;
            float r0 = mix(mix(innerRadius, 1.0, 0.4), mix(innerRadius, 1.0, 0.6), n0);
            float d0 = distance(uv, (r0 * invLen) * uv);
            float v0 = light1(1.0, 10.0, d0);
            v0 *= smoothstep(r0 * 1.05, r0, len);
            float innerFade = smoothstep(r0 * 0.8, r0 * 0.95, len);
            v0 *= mix(innerFade, 1.0, bgLuminance * 0.7);
            float cl = cos(ang + iTime * 2.0) * 0.5 + 0.5;
            float a = iTime * -1.0;
            vec2 pos = vec2(cos(a), sin(a)) * r0;
            float d = distance(uv, pos);
            float v1 = light2(1.5, 5.0, d);
            v1 *= light1(1.0, 50.0, d0);
            float v2 = smoothstep(1.0, mix(innerRadius, 1.0, n0 * 0.5), len);
            float v3 = smoothstep(innerRadius, mix(innerRadius, 1.0, 0.5), len);
            vec3 colBase = mix(color1, color2, cl);
            float fadeAmount = mix(1.0, 0.1, bgLuminance);
            vec3 darkCol = mix(color3, colBase, v0);
            darkCol = (darkCol + v1) * v2 * v3;
            darkCol = clamp(darkCol, 0.0, 1.0);
            vec3 lightCol = (colBase + v1) * mix(1.0, v2 * v3, fadeAmount);
            lightCol = mix(backgroundColor, lightCol, v0);
            lightCol = clamp(lightCol, 0.0, 1.0);
            vec3 finalCol = mix(darkCol, lightCol, bgLuminance);
            return extractAlpha(finalCol);
          }
          vec4 mainImage(vec2 fragCoord) {
            vec2 center = iResolution.xy * 0.5;
            float size = min(iResolution.x, iResolution.y);
            vec2 uv = (fragCoord - center) / size * 2.8;
            float angle = rot;
            float s = sin(angle); float c = cos(angle);
            uv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);
            uv.x += hover * hoverIntensity * 0.1 * sin(uv.y * 10.0 + iTime);
            uv.y += hover * hoverIntensity * 0.1 * sin(uv.x * 10.0 + iTime);
            return draw(uv);
          }
          void main() {
            vec2 fragCoord = vUv * iResolution.xy;
            vec4 col = mainImage(fragCoord);
            gl_FragColor = vec4(col.rgb * col.a, col.a);
          }
        `;

        renderer = new Renderer({ alpha: true, premultipliedAlpha: false });
        gl = renderer.gl;
        gl.clearColor(0, 0, 0, 0);
        container.appendChild(gl.canvas);

        const geometry = new Triangle(gl);
        const program = new Program(gl, {
          vertex: vert, fragment: frag,
          uniforms: {
            iTime: { value: 0 },
            iResolution: { value: new Vec3(gl.canvas.width, gl.canvas.height, gl.canvas.width / gl.canvas.height) },
            hue: { value: hue },
            hover: { value: 0 },
            rot: { value: 0 },
            hoverIntensity: { value: hoverIntensity },
            backgroundColor: { value: hexToVec3(backgroundColor) },
          },
        });
        const mesh = new Mesh(gl, { geometry, program });

        const resize = () => {
          if (!container) return;
          const dpr = window.devicePixelRatio || 1;
          const width = container.clientWidth; const height = container.clientHeight;
          renderer.setSize(width * dpr, height * dpr);
          gl.canvas.style.width = width + "px"; gl.canvas.style.height = height + "px";
          program.uniforms.iResolution.value.set(gl.canvas.width, gl.canvas.height, gl.canvas.width / gl.canvas.height);
        };
        handlers.resize = resize;
        window.addEventListener("resize", resize);
        resize();

        // Super-charged: mouse position directly drives hover (not just
        // proximity-gated), so the ripple tracks the cursor across the
        // whole viewport, not only within a centered radius.
        let targetHover = 1; let currentRot = 0; let lastTime = 0;
        const rotationSpeed = 0.3;

        handlers.mousemove = (e) => {
          const rect = container.getBoundingClientRect();
          const x = e.clientX - rect.left; const y = e.clientY - rect.top;
          const size = Math.min(rect.width, rect.height);
          const uvX = ((x - rect.width / 2) / size) * 2.0;
          const uvY = ((y - rect.height / 2) / size) * 2.0;
          targetHover = Math.min(1.4, 0.6 + Math.sqrt(uvX * uvX + uvY * uvY));
        };
        handlers.mouseleave = () => { targetHover = 1; };
        container.addEventListener("mousemove", handlers.mousemove);
        container.addEventListener("mouseleave", handlers.mouseleave);

        const update = (t) => {
          rafId = requestAnimationFrame(update);
          const dt = (t - lastTime) * 0.001; lastTime = t;
          program.uniforms.iTime.value = t * 0.001;
          program.uniforms.hue.value = hue;
          program.uniforms.hoverIntensity.value = hoverIntensity;
          program.uniforms.backgroundColor.value = hexToVec3(backgroundColor);
          const effectiveHover = forceHoverState ? 1.4 : targetHover;
          program.uniforms.hover.value += (effectiveHover - program.uniforms.hover.value) * 0.15;
          if (rotateOnHover) currentRot += dt * rotationSpeed * effectiveHover;
          program.uniforms.rot.value = currentRot;
          renderer.render({ scene: mesh });
        };
        rafId = requestAnimationFrame(update);
      } catch { /* no WebGL context available — flat black Intro surface stands in */ }
    })();

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (handlers.resize) window.removeEventListener("resize", handlers.resize);
      if (handlers.mousemove) container.removeEventListener("mousemove", handlers.mousemove);
      if (handlers.mouseleave) container.removeEventListener("mouseleave", handlers.mouseleave);
      if (gl?.canvas && container.contains(gl.canvas)) container.removeChild(gl.canvas);
      gl?.getExtension?.("WEBGL_lose_context")?.loseContext();
    };
  }, [hue, hoverIntensity, rotateOnHover, forceHoverState, backgroundColor]);
  return <div ref={mountRef} aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 0 }} />;
}

/* ════════════════════════════════════════════════════════════════
   SOFT AURORA — main app background (ogl, mouse-parallax noise field)
   ════════════════════════════════════════════════════════════════ */
function SoftAurora({
  speed = 0.6, scale = 1.5, brightness = 1, color1 = "#f7f7f7", color2 = "#e100ff",
  noiseFrequency = 2.5, noiseAmplitude = 1, bandHeight = 0.5, bandSpread = 1,
  octaveDecay = 0.1, layerOffset = 0, colorSpeed = 1, enableMouseInteraction = true, mouseInfluence = 1.5,
}) {
  const mountRef = useRef(null);
  useEffect(() => {
    const reduceMotion = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;
    const container = mountRef.current;
    if (!container) return;
    let cancelled = false; let renderer, gl, rafId;
    const handlers = {};

    (async () => {
      try {
        const { Renderer, Program, Mesh, Triangle } = await import("ogl");
        if (cancelled || !container) return;

        const hexToVec3 = (hex) => {
          const h = hex.replace("#", "");
          return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
        };

        const vertexShader = `
          attribute vec2 uv;
          attribute vec2 position;
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = vec4(position, 0, 1);
          }
        `;
        const fragmentShader = `
          precision highp float;
          uniform float uTime;
          uniform vec3 uResolution;
          uniform float uSpeed;
          uniform float uScale;
          uniform float uBrightness;
          uniform vec3 uColor1;
          uniform vec3 uColor2;
          uniform float uNoiseFreq;
          uniform float uNoiseAmp;
          uniform float uBandHeight;
          uniform float uBandSpread;
          uniform float uOctaveDecay;
          uniform float uLayerOffset;
          uniform float uColorSpeed;
          uniform vec2 uMouse;
          uniform float uMouseInfluence;
          uniform bool uEnableMouse;
          #define TAU 6.28318
          vec3 gradientHash(vec3 p) {
            p = vec3(dot(p, vec3(127.1, 311.7, 234.6)), dot(p, vec3(269.5, 183.3, 198.3)), dot(p, vec3(169.5, 283.3, 156.9)));
            vec3 h = fract(sin(p) * 43758.5453123);
            float phi = acos(2.0 * h.x - 1.0);
            float theta = TAU * h.y;
            return vec3(cos(theta) * sin(phi), sin(theta) * cos(phi), cos(phi));
          }
          float quinticSmooth(float t) { float t2 = t * t; float t3 = t * t2; return 6.0 * t3 * t2 - 15.0 * t2 * t2 + 10.0 * t3; }
          vec3 cosineGradient(float t, vec3 a, vec3 b, vec3 c, vec3 d) { return a + b * cos(TAU * (c * t + d)); }
          float perlin3D(float amplitude, float frequency, float px, float py, float pz) {
            float x = px * frequency; float y = py * frequency;
            float fx = floor(x); float fy = floor(y); float fz = floor(pz);
            float cx = ceil(x); float cy = ceil(y); float cz = ceil(pz);
            vec3 g000 = gradientHash(vec3(fx, fy, fz)); vec3 g100 = gradientHash(vec3(cx, fy, fz));
            vec3 g010 = gradientHash(vec3(fx, cy, fz)); vec3 g110 = gradientHash(vec3(cx, cy, fz));
            vec3 g001 = gradientHash(vec3(fx, fy, cz)); vec3 g101 = gradientHash(vec3(cx, fy, cz));
            vec3 g011 = gradientHash(vec3(fx, cy, cz)); vec3 g111 = gradientHash(vec3(cx, cy, cz));
            float d000 = dot(g000, vec3(x - fx, y - fy, pz - fz)); float d100 = dot(g100, vec3(x - cx, y - fy, pz - fz));
            float d010 = dot(g010, vec3(x - fx, y - cy, pz - fz)); float d110 = dot(g110, vec3(x - cx, y - cy, pz - fz));
            float d001 = dot(g001, vec3(x - fx, y - fy, pz - cz)); float d101 = dot(g101, vec3(x - cx, y - fy, pz - cz));
            float d011 = dot(g011, vec3(x - fx, y - cy, pz - cz)); float d111 = dot(g111, vec3(x - cx, y - cy, pz - cz));
            float sx = quinticSmooth(x - fx); float sy = quinticSmooth(y - fy); float sz = quinticSmooth(pz - fz);
            float lx00 = mix(d000, d100, sx); float lx10 = mix(d010, d110, sx);
            float lx01 = mix(d001, d101, sx); float lx11 = mix(d011, d111, sx);
            float ly0 = mix(lx00, lx10, sy); float ly1 = mix(lx01, lx11, sy);
            return amplitude * mix(ly0, ly1, sz);
          }
          float auroraGlow(float t, vec2 shift) {
            vec2 uv = gl_FragCoord.xy / uResolution.y;
            uv += shift;
            float noiseVal = 0.0; float freq = uNoiseFreq; float amp = uNoiseAmp;
            vec2 samplePos = uv * uScale;
            for (float i = 0.0; i < 3.0; i += 1.0) {
              noiseVal += perlin3D(amp, freq, samplePos.x, samplePos.y, t);
              amp *= uOctaveDecay; freq *= 2.0;
            }
            float yBand = uv.y * 10.0 - uBandHeight * 10.0;
            return 0.3 * max(exp(uBandSpread * (1.0 - 1.1 * abs(noiseVal + yBand))), 0.0);
          }
          void main() {
            vec2 uv = gl_FragCoord.xy / uResolution.xy;
            float t = uSpeed * 0.4 * uTime;
            vec2 shift = vec2(0.0);
            if (uEnableMouse) shift = (uMouse - 0.5) * uMouseInfluence;
            vec3 col = vec3(0.0);
            col += 0.99 * auroraGlow(t, shift) * cosineGradient(uv.x + uTime * uSpeed * 0.2 * uColorSpeed, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.3, 0.20, 0.20)) * uColor1;
            col += 0.99 * auroraGlow(t + uLayerOffset, shift) * cosineGradient(uv.x + uTime * uSpeed * 0.1 * uColorSpeed, vec3(0.5), vec3(0.5), vec3(2.0, 1.0, 0.0), vec3(0.5, 0.20, 0.25)) * uColor2;
            col *= uBrightness;
            float alpha = clamp(length(col), 0.0, 1.0);
            gl_FragColor = vec4(col, alpha);
          }
        `;

        renderer = new Renderer({ alpha: true, premultipliedAlpha: false });
        gl = renderer.gl;
        gl.clearColor(0, 0, 0, 0);

        let currentMouse = [0.5, 0.5]; let targetMouse = [0.5, 0.5];

        handlers.mousemove = (e) => {
          const rect = gl.canvas.getBoundingClientRect();
          targetMouse = [(e.clientX - rect.left) / rect.width, 1.0 - (e.clientY - rect.top) / rect.height];
        };
        handlers.mouseleave = () => { targetMouse = [0.5, 0.5]; };

        let program;
        const resize = () => {
          renderer.setSize(container.clientWidth, container.clientHeight);
          if (program) program.uniforms.uResolution.value = [gl.canvas.width, gl.canvas.height, gl.canvas.width / gl.canvas.height];
        };
        handlers.resize = resize;
        window.addEventListener("resize", resize);
        resize();

        const geometry = new Triangle(gl);
        program = new Program(gl, {
          vertex: vertexShader, fragment: fragmentShader,
          uniforms: {
            uTime: { value: 0 },
            uResolution: { value: [gl.canvas.width, gl.canvas.height, gl.canvas.width / gl.canvas.height] },
            uSpeed: { value: speed },
            uScale: { value: scale },
            uBrightness: { value: brightness },
            uColor1: { value: hexToVec3(color1) },
            uColor2: { value: hexToVec3(color2) },
            uNoiseFreq: { value: noiseFrequency },
            uNoiseAmp: { value: noiseAmplitude },
            uBandHeight: { value: bandHeight },
            uBandSpread: { value: bandSpread },
            uOctaveDecay: { value: octaveDecay },
            uLayerOffset: { value: layerOffset },
            uColorSpeed: { value: colorSpeed },
            uMouse: { value: new Float32Array([0.5, 0.5]) },
            uMouseInfluence: { value: mouseInfluence },
            uEnableMouse: { value: enableMouseInteraction },
          },
        });
        const mesh = new Mesh(gl, { geometry, program });
        container.appendChild(gl.canvas);

        if (enableMouseInteraction) {
          gl.canvas.addEventListener("mousemove", handlers.mousemove);
          gl.canvas.addEventListener("mouseleave", handlers.mouseleave);
        }

        const update = (t) => {
          rafId = requestAnimationFrame(update);
          program.uniforms.uTime.value = t * 0.001;
          if (enableMouseInteraction) {
            currentMouse[0] += 0.08 * (targetMouse[0] - currentMouse[0]);
            currentMouse[1] += 0.08 * (targetMouse[1] - currentMouse[1]);
            program.uniforms.uMouse.value[0] = currentMouse[0];
            program.uniforms.uMouse.value[1] = currentMouse[1];
          } else {
            program.uniforms.uMouse.value[0] = 0.5;
            program.uniforms.uMouse.value[1] = 0.5;
          }
          program.uniforms.uMouseInfluence.value = mouseInfluence;
          renderer.render({ scene: mesh });
        };
        rafId = requestAnimationFrame(update);
      } catch { /* no WebGL context available — flat page background stands in */ }
    })();

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (handlers.resize) window.removeEventListener("resize", handlers.resize);
      if (enableMouseInteraction && gl?.canvas) {
        if (handlers.mousemove) gl.canvas.removeEventListener("mousemove", handlers.mousemove);
        if (handlers.mouseleave) gl.canvas.removeEventListener("mouseleave", handlers.mouseleave);
      }
      if (gl?.canvas && container.contains(gl.canvas)) container.removeChild(gl.canvas);
      gl?.getExtension?.("WEBGL_lose_context")?.loseContext();
    };
  }, [speed, scale, brightness, color1, color2, noiseFrequency, noiseAmplitude, bandHeight, bandSpread, octaveDecay, layerOffset, colorSpeed, enableMouseInteraction, mouseInfluence]);
  return <div ref={mountRef} aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 0 }} />;
}


/* ════════════════════════════════════════════════════════════════
   INTRO background
   ════════════════════════════════════════════════════════════════ */
function Intro({ accent, P, onEnter, animationMode = "off" }) {
  const isMobile = useIsMobile();

  // This screen's surface is unconditionally black (see `background:
  // "#000000"` below) — a fixed splash look, independent of whichever
  // palette the visitor has chosen for the app itself. `accent` is NOT
  // fixed, though: this app's only built-in accent scheme is real
  // monochrome (white in dark mode, black in light mode — see App()'s own
  // accent computation, and ACCENTS itself), so a visitor who last used the
  // app in light mode arrives here with accent === black. Every
  // accent-colored element on this permanently-black screen — both wordmark
  // glyphs and the "We'll find the paper." line — would render invisible
  // without this guard. A real luminance check rather than a literal
  // string-match against "#000000" also catches a custom accent color a
  // visitor picked in Settings that happens to be too dark to read here.
  const introAccent = relLuminance(accent) < 0.15 ? "#5be8b0" : accent;

  // GSAP-driven reveal (replaces the old per-element CSS-transition
  // fade/blur choreography): a real staggered timeline that fires once on
  // mount, plus a matching reverse timeline on exit so leaving the intro
  // feels like one continuous motion instead of a hard cut. `animationMode
  // === "off"` skips both entirely — every ref'd element gets full opacity
  // immediately via its own inline style below, same "opt out of motion
  // gets a flat, static screen" contract every other animated surface in
  // this file follows.
  const navRef = useRef(null);
  const logoRef = useRef(null);
  const head1Ref = useRef(null);
  const head2Ref = useRef(null);
  const descRef = useRef(null);
  const tagsRef = useRef(null);
  const btnsRef = useRef(null);
  const EASE = "power3.inOut";

  useEffect(() => {
    if (animationMode === "off") return;
    const tl = gsap.timeline();
    tl.fromTo(navRef.current, { y: -15, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 1.33, ease: EASE }, 0)
      .fromTo(logoRef.current, { scale: 0.4, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 1.33, ease: EASE }, 0)
      .fromTo(head1Ref.current, { y: -25, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 1.66, ease: EASE }, 0.2)
      .fromTo(head2Ref.current, { y: -25, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 1.66, ease: EASE }, 0.3)
      .fromTo(descRef.current, { y: -15, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 1.33, ease: EASE }, 0.5)
      .fromTo(tagsRef.current, { y: -10, autoAlpha: 0 }, { y: 0, autoAlpha: 0.85, duration: 1.33, ease: EASE }, 0.6)
      .fromTo(btnsRef.current, { y: -10, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 1.33, ease: EASE }, 0.7);
    return () => tl.kill();
  }, [animationMode]);

  const go = () => {
    if (animationMode === "off") { onEnter(); return; }
    const tl = gsap.timeline({ onComplete: onEnter });
    tl.to(btnsRef.current, { y: 15, autoAlpha: 0, duration: 0.6, ease: EASE }, 0)
      .to(tagsRef.current, { y: 15, autoAlpha: 0, duration: 0.6, ease: EASE }, 0.05)
      .to(descRef.current, { y: 20, autoAlpha: 0, duration: 0.6, ease: EASE }, 0.1)
      .to(head2Ref.current, { y: 25, autoAlpha: 0, duration: 0.6, ease: EASE }, 0.2)
      .to(head1Ref.current, { y: 25, autoAlpha: 0, duration: 0.6, ease: EASE }, 0.25)
      .to(logoRef.current, { scale: 0.8, autoAlpha: 0, duration: 0.6, ease: EASE }, 0.3)
      .to(navRef.current, { y: -15, autoAlpha: 0, duration: 0.6, ease: EASE }, 0.4);
  };

  const FEATURE_TAGS = ["Cited answers", "Compare investigations", "Source network", "Literature timeline", "AI illustrations"];

  return (
    <div id="cb-intro-wrap" style={{
      minHeight: "100dvh", display: "flex", flexDirection: "column",
      background: "#000000", position: "relative", overflow: "hidden",
      fontFamily: "var(--cb-body)",
    }}>
      {/* The animated LivingBackground field — gated on animationMode
          exactly like the main app and InfoPage, so a visitor who has
          opted out of animation gets a flat, static screen here too. */}
      {animationMode !== "off" && (
        <div style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none" }}>
          <LivingBackground accent={accent} P={P} intensity="cinematic" speed={1} paused={false} variant="intro" />
        </div>
      )}

      {/* NO MUDDY FOG .cb-ambient LAYER ALLOWED HERE. This screen is meant
          to read as a real landing-page hero shot with the WebGL field
          full-bleed and undimmed behind it — a scrim over the whole
          viewport defeats that. Legibility over the brightest parts of the
          field is instead handled per-element with a tight text-shadow
          below, which costs nothing when animation is off and the
          background is flat black anyway. */}

      <nav ref={navRef} style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: isMobile ? "16px 20px" : "20px 40px",
        position: "relative", zIndex: 3,
        opacity: animationMode === "off" ? 1 : 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Mark size={20} accent={introAccent} glow />
          <span style={{ fontSize: FONT_SIZES.subhead, fontWeight: 600, color: "#ffffff", letterSpacing: "0.04em", textTransform: "uppercase", textShadow: "0 1px 8px rgba(0,0,0,0.7)" }}>Cerebrum</span>
        </div>
        <div style={{ display: "flex", gap: isMobile ? 16 : 28 }}>
          {["About", "Privacy", "Contact"].map((item) => (
            <a key={item} href={`/${item.toLowerCase()}`} style={{ fontSize: FONT_SIZES.caption, color: "#a3b0c2", textDecoration: "none", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", transition: "color 0.2s", textShadow: "0 1px 8px rgba(0,0,0,0.7)" }}
              onMouseEnter={(e) => e.target.style.color = "#e8edf5"} onMouseLeave={(e) => e.target.style.color = "#a3b0c2"}>{item}</a>
          ))}
        </div>
      </nav>

      <main style={{
        flex: 1, display: "flex", flexDirection: "column", justifyContent: "center",
        padding: isMobile ? "0 24px 60px" : "0 clamp(48px, 8vw, 140px) 80px",
        position: "relative", zIndex: 10, pointerEvents: "auto", maxWidth: 820,
      }}>
        <div ref={logoRef} style={{ marginBottom: 32, opacity: animationMode === "off" ? 1 : 0 }}>
          <Mark size={36} accent={introAccent} glow />
        </div>

        <h1 style={{
          fontSize: isMobile ? 48 : "clamp(64px, 8vw, 96px)",
          fontWeight: 800, letterSpacing: "-0.05em", lineHeight: 1.0,
          color: "#ffffff", margin: "0 0 28px",
          fontFamily: "var(--cb-display)", textTransform: "uppercase",
        }}>
          <div ref={head1Ref} style={{ opacity: animationMode === "off" ? 1 : 0, textShadow: "0 4px 32px rgba(0,0,0,0.65)" }}>Ask anything.</div>
          <div ref={head2Ref} style={{ color: introAccent, opacity: animationMode === "off" ? 1 : 0, textShadow: "0 4px 32px rgba(0,0,0,0.65)" }}>We'll find the paper.</div>
        </h1>

        <p ref={descRef} style={{
          fontSize: isMobile ? FONT_SIZES.body : FONT_SIZES.subhead, color: "#c3cbd9", lineHeight: 1.65,
          margin: "0 0 32px", maxWidth: 520, fontWeight: 400,
          textShadow: "0 2px 16px rgba(0,0,0,0.7)",
          opacity: animationMode === "off" ? 1 : 0,
        }}>
          Cerebrum searches 14 scholarly databases in parallel and writes you
          an answer where every claim traces back to a real, citable source.
          One research instrument, not just a chatbot.
        </p>

        {/* Feature-discovery row: `tagsRef` is already choreographed into
            both the entrance and exit timelines above, so this needs to
            exist in the DOM for those tweens to have anything to animate —
            also doubles as the "not just a chatbot" positioning line this
            app has carried since it added Compare/Source-network/Timeline/
            Illustration as real features. */}
        <div ref={tagsRef} style={{
          display: "flex", flexWrap: "wrap", gap: "7px 18px", marginBottom: 32,
          opacity: animationMode === "off" ? 0.85 : 0,
        }}>
          {FEATURE_TAGS.map((f) => (
            <span key={f} style={{ fontSize: FONT_SIZES.caption, fontWeight: 600, color: "#a3b0c2", letterSpacing: "0.04em", fontFamily: "var(--cb-mono)", textTransform: "uppercase", textShadow: "0 1px 8px rgba(0,0,0,0.7)" }}>{f}</span>
          ))}
        </div>

        <div ref={btnsRef} style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", opacity: animationMode === "off" ? 1 : 0 }}>
          <button onClick={go} style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "16px 36px", fontSize: FONT_SIZES.body, fontWeight: 700,
            textTransform: "uppercase", letterSpacing: "0.05em",
            background: "#ffffff", color: "#000000", border: "none", borderRadius: 0,
            cursor: "pointer", fontFamily: "var(--cb-display)",
            transition: "opacity 0.2s ease",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.85"; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}>
            Start exploring
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" strokeLinejoin="miter"><path d="M5 12h13M12 5.5l6.5 6.5-6.5 6.5"/></svg>
          </button>
        </div>
      </main>
    </div>
  );
}


/* ════════════════════════════════════════════════════════════════
   LIVING BACKGROUND — dispatches per screen, not per user choice

   v32: one dedicated field per screen, same as before, now pointing at
   Orb (Intro) and SoftAurora (main app) instead of the retired Three.js
   particle fields — see those two components' own comment blocks above
   for why. `speed` still matters: Settings' "Animation speed" slider
   (0.25-2x) feeds this prop and used to scale the retired field's drift —
   it's kept alive here as a multiplier on SoftAurora's own base speed so
   that control doesn't go silently dead. `paused` has no equivalent on
   either reactbits component (neither exposes a freeze switch) so it's
   accepted but unused, same as it would be for any prop a call site still
   passes that the current field genuinely has no use for.
   ════════════════════════════════════════════════════════════════ */
function LivingBackground({ accent, P, intensity = "cinematic", speed = 1, paused = false, variant = "main" }) {
  return (
    <div className="cb-constellation-host" style={{
      position: "fixed", inset: 0, width: "100%", height: "100%",
      pointerEvents: "none", zIndex: 0,
      opacity: intensity === "subtle" ? 0.55 : 1,
      transition: "opacity 0.5s ease",
    }} aria-hidden="true">
      {variant === "intro"
        ? (
          // hoverIntensity was previously 2.58 here — over 12x Orb's own
          // documented default (0.2). Orb's `hover` uniform doesn't rest at
          // 0 when nothing is actively hovering it: it's seeded at 1 and
          // reset to 1 on mouseleave, and never gets a touch handler at
          // all, so on mobile (no mouse events ever fire) it just sits at
          // ~1 permanently. That means this was never a "kicks in on
          // hover" accent — it was a constant, maxed-out UV-distortion
          // term applied to the orb's noise field at all times, which reads
          // as a soft, hazy smear rather than the crisp ring/orb shape the
          // shader actually draws. Turned down to a level where the same
          // gentle shimmer is still there without swamping the shape
          // underneath it — Orb's own code, its shader, and every other
          // prop are untouched.
          <Orb hoverIntensity={0.4} rotateOnHover hue={117} forceHoverState={false} backgroundColor="#000000" />
        )
        : <SoftAurora speed={0.6 * speed} scale={1.5} brightness={1} color1="#3B82F6" color2="#1dae7c" noiseFrequency={1.5} noiseAmplitude={1} bandHeight={0.5} bandSpread={1} octaveDecay={0.1} layerOffset={0} colorSpeed={1.1} enableMouseInteraction mouseInfluence={1.5} />}
    </div>
  );
}


/* v7.0 cleanup: two banner comments used to sit here ("Custom blend-mode
   cursor" and "Mouse-tracking glow border") describing features that were
   never actually built — no function followed either one, just the
   comment block itself. Removed rather than left as a description of
   code that doesn't exist. */

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


/* v31: this used to be VantaCellsField — the pre-v5 Intro background
   brought back as a bundled npm dependency (`vanta`+`three`) rather than a
   runtime CDN script, with WebGLNeuralField as its fallback. Both are gone
   now: the "Next-Gen Editorial Intelligence" rewrite retired the whole
   style-picker lineage (Constellation/Neural Field/Fluid Ripples/Vanta
   Cells) in favor of one dedicated field per screen — Orb for Intro,
   SoftAurora for the main app (v32; originally Three.js-based
   WebGLIntelligenceCore/WebGLTopographyGrid, both defined up near Intro's
   own comment block), rendered via the lightweight `ogl` WebGL library
   instead. `vanta` and `three` both stay out of package.json going
   forward. */
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
      style={{ width: 34, height: 34, borderRadius: 3, border: "none", cursor: "pointer", background: listening ? accent : "transparent", color: listening ? "#fff" : P.faint, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, position: "relative" }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 15a3 3 0 003-3V6a3 3 0 00-6 0v6a3 3 0 003 3z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><path d="M5 12a7 7 0 0014 0M12 19v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      {listening && <span style={{ position: "absolute", inset: -4, borderRadius: 3, border: `2px solid ${accent}`, animation: "cbMicPulse 1.5s ease-in-out infinite", pointerEvents: "none" }} />}
    </button>
  );
}

/* ============================================================
   ANSWER PLAYER (TTS) — logic preserved
   ============================================================ */
function AnswerPlayer({ text, accent, P, compact = false }) {
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
  const label = status === "loading" ? "Loading…" : status === "playing" ? "Pause" : status === "paused" ? "Resume" : "Listen";
  const active = status === "playing" || status === "paused";
  const playIcon = <svg width={compact ? 12 : 11} height={compact ? 12 : 11} viewBox="0 0 24 24" fill="currentColor">{status === "playing" ? (<><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></>) : (<path d="M8 5v14l11-7z" />)}</svg>;
  // v28: docked into the new top-right answer toolbar (see `Turn`) alongside
  // Copy/Share/PDF/Illustrate, this needs to be the same 28x28 icon-only
  // shape as its neighbors instead of the wider icon+label pill it used to
  // render inline below the answer. The full pill (with its progress bar and
  // separate Stop button) still exists for anywhere else this component gets
  // used — nothing about that path changed.
  if (compact) {
    return (
      <button
        type="button" title={active ? `${label} (${Math.round(progress * 100)}%)` : label} aria-label={label}
        onClick={onClick}
        style={{ ...S_toolbarBtnBase(P), ...(active ? { background: withAlpha(accent, 0.16), color: accent } : {}) }}
        onMouseEnter={(e) => { if (!active) { e.currentTarget.style.background = withAlpha(accent, 0.08); e.currentTarget.style.color = accent; } }}
        onMouseLeave={(e) => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = P.ink2; } }}
      >
        {status === "loading" ? <span style={{ width: 10, height: 10, border: `2px solid ${P.line2}`, borderTopColor: accent, borderRadius: "50%", display: "inline-block", animation: "cbspin 0.7s linear infinite" }} /> : playIcon}
      </button>
    );
  }
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 12 }}>
      <button onClick={onClick} style={{ padding: "6px 14px", fontSize: FONT_SIZES.caption, fontWeight: 600, background: active ? accent : "transparent", color: active ? accentText(accent) : P.ink2, border: `1px solid ${active ? accent : P.line2}`, borderRadius: 3, cursor: "pointer", fontFamily: "var(--cb-mono)", display: "inline-flex", alignItems: "center", gap: 6, letterSpacing: "0.01em" }}>
        {playIcon}
        {label}
      </button>
      {active && (
        <div style={{ width: 80, height: 2, background: P.line, borderRadius: 1, overflow: "hidden" }}>
          <div style={{ width: "100%", height: "100%", background: accent, transformOrigin: "left", transform: `scaleX(${progress})`, transition: "transform 0.15s ease" }} />
        </div>
      )}
      {active && (
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
        <button key={v} onClick={() => set(v)} style={{ flex: 1, padding: "9px 6px", fontSize: FONT_SIZES.small, fontWeight: 600, background: voice === v ? accent : "transparent", color: voice === v ? at : P.ink2, border: `1px solid ${voice === v ? accent : P.line}`, borderRadius: 3, cursor: "pointer", fontFamily: "inherit" }}>{label}</button>
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
      <input type="password" aria-label="ElevenLabs API key" placeholder="ElevenLabs API key (optional)" value={key} onChange={(e) => setKey(e.target.value)} style={{ padding: "10px 12px", fontSize: FONT_SIZES.small, background: P.surface, color: P.ink, border: `1px solid ${P.line}`, borderRadius: 3, fontFamily: "inherit", outline: "none" }} />
      <select value={voice} onChange={(e) => setVoice(e.target.value)} style={{ padding: "10px 12px", fontSize: FONT_SIZES.small, background: P.surface, color: P.ink, border: `1px solid ${P.line}`, borderRadius: 3, fontFamily: "inherit", cursor: "pointer", outline: "none", ...selectChrome(P) }}>
        {voices.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select>
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={save} style={{ flex: 1, padding: "8px 12px", fontSize: FONT_SIZES.small, fontWeight: 600, background: accent, color: at, border: "none", borderRadius: 3, cursor: "pointer", fontFamily: "inherit" }}>{saved ? "✓ Saved" : "Save"}</button>
        {key && <button onClick={clear} style={{ padding: "8px 12px", fontSize: FONT_SIZES.small, fontWeight: 500, background: "transparent", color: P.ink2, border: `1px solid ${P.line}`, borderRadius: 3, cursor: "pointer", fontFamily: "inherit" }}>Clear</button>}
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
  const paletteName = (() => { try { return getCookie("cb_palette") || "Sage"; } catch { return "Sage"; } })();
  const P = PALETTES[paletteName] || PALETTES.Sage;
  // ACCENTS was collapsed to a single { Mono } entry when the app moved to
  // its current monochrome accent direction (App()'s own accentName state,
  // a few thousand lines down, already defaults to "Mono" to match) — this
  // page kept the old pre-redesign default of "Emerald", a key that no
  // longer exists on ACCENTS. ACCENTS["Emerald"] came back undefined, and
  // so did the "|| ACCENTS.Emerald" fallback right after it, so `accent`
  // itself was undefined for every visitor who'd never explicitly set a
  // cb_accent cookie — which then crashed withAlpha() (called straight
  // below, and again in typeColor() elsewhere) the instant it tried
  // `undefined.slice(...)`, taking the whole page to a blank white screen
  // with no error boundary to catch it. This is what was actually behind
  // "the about and contact pages are just white" — a real render crash,
  // not only the separate _redirects/routing issue fixed alongside this.
  const accentName = (() => { try { return getCookie("cb_accent") || "Mono"; } catch { return "Mono"; } })();
  const customAccent = (() => { try { return getCookie("cb_accentCustom") || ""; } catch { return ""; } })();
  const accent = customAccent || ACCENTS[accentName] || ACCENTS.Mono;
  const at = accentText(accent);
  const isMobile = useIsMobile();
  // v6.8: this page runs as its own standalone route, outside App()'s tree,
  // so it never picked up the animationMode fix that made the heavy WebGL
  // background opt-in there — it always rendered LivingBackground here,
  // fully ignoring whatever the visitor chose (or didn't choose) in
  // Settings. Reading the same persisted cookie App() writes to keeps the
  // two in sync instead of this page being a silent exception to the fix.
  // v29: default flipped to "cinematic" alongside App()'s own default — see
  // the comment on App's animationMode state for why "off" was the actual
  // reason the WebGL background never appeared for new visitors.
  const animationMode = (() => { try { return getCookie("cb_anim2") || "cinematic"; } catch { return "cinematic"; } })();
  const goHome = () => { window.location.href = "/"; };
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
      <div aria-hidden="true" className="cb-ambient" style={{
        position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", overflow: "hidden",
        // Was three different named ACCENTS colors (Emerald/Violet/Teal) —
        // none of those keys exist anymore (see the comment on `accent`
        // above), so this repeats the one real accent color at three
        // descending opacities instead of reintroducing a multi-color
        // palette the rest of the app has already moved away from.
        background: [
          `radial-gradient(ellipse 900px 700px at 10% -10%, ${withAlpha(accent, P.dark ? 0.2 : 0.17)}, transparent 60%)`,
          `radial-gradient(ellipse 820px 820px at 110% 12%, ${withAlpha(accent, P.dark ? 0.14 : 0.11)}, transparent 55%)`,
          `radial-gradient(ellipse 760px 920px at 46% 118%, ${withAlpha(accent, P.dark ? 0.1 : 0.08)}, transparent 60%)`,
        ].join(", "),
      }} />
      {animationMode !== "off" && (
        <div style={{ position: "fixed", inset: 0, opacity: 0.4, pointerEvents: "none", zIndex: 0 }}>
          <LivingBackground accent={accent} P={P} intensity="subtle" speed={0.6} paused={false} variant="main" />
        </div>
      )}
      <header style={{ position: "sticky", top: 0, zIndex: 10 }}>
        {/* Blur lives on its own layer behind the content instead of on the
            sticky element itself — see the `headerGlass` comment in the main
            app styles for why that split is what actually keeps mouse-wheel
            scrolling alive over this bar. The `translateZ(0)` +
            `willChange: "transform"` compositor hint this used to also carry
            was removed (v25) to match the same edit in makeStyles' `header`
            — see that comment for the full reasoning. */}
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, zIndex: -1, pointerEvents: "none", background: withAlpha(P.bg, 0.85), backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", borderBottom: `1px solid ${P.line}` }} />
        <div style={{ maxWidth: 760, margin: "0 auto", padding: isMobile ? "14px 20px" : "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <button onClick={goHome} style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600, color: P.ink, fontSize: FONT_SIZES.subhead, background: "none", border: "none", cursor: "pointer", fontFamily: "var(--cb-display)", letterSpacing: "-0.02em", padding: 0 }}>
            <Mark size={18} accent={accent} /> Cerebrum
          </button>
          <nav style={{ display: "flex", gap: 6 }}>
            {NAV.map(([slug, label]) => (
              <a key={slug} href={`/${slug}`} className="cb-info-navlink" aria-current={page === slug ? "page" : undefined} style={{ fontSize: FONT_SIZES.body, color: page === slug ? P.ink : P.ink2, textDecoration: "none", padding: "6px 10px", fontWeight: page === slug ? 700 : 500, letterSpacing: "-0.01em" }}>{label}</a>
            ))}
          </nav>
        </div>
      </header>
      <main style={{ flex: 1, position: "relative", zIndex: 1 }}>
        <div style={{ maxWidth: 640, margin: "0 auto", padding: isMobile ? "48px 20px 64px" : "72px 28px 80px" }}>
          <div className="cb-fadein" style={{ animationDelay: "0ms" }}>
            <span style={{ fontSize: FONT_SIZES.caption, fontWeight: 600, letterSpacing: "0.15em", textTransform: "uppercase", color: accent, fontFamily: "var(--cb-mono)" }}>{data.eyebrow}</span>
            <h1 style={{ fontSize: isMobile ? FONT_SIZES.display : FONT_SIZES.hero, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.15, color: P.ink, margin: "12px 0 16px", fontFamily: "var(--cb-display)" }}>{data.title}</h1>
            <p style={{ fontSize: FONT_SIZES.subhead, lineHeight: 1.65, color: P.ink2, marginBottom: 8 }}>{data.lede}</p>
            {data.updated && <div style={{ fontSize: FONT_SIZES.small, color: P.faint, marginBottom: 0, fontFamily: "var(--cb-mono)" }}>{data.updated}</div>}
          </div>
          <div style={{ marginTop: 48, display: "flex", flexDirection: "column", gap: 40 }}>
            {data.blocks.map((block, i) => (
              <div key={i} className="cb-info-block cb-fadein" style={{ animationDelay: `${(i + 1) * 80}ms` }}>
                <h2>{block.h}</h2>
                {block.p && <p>{block.p}</p>}
                {block.email && <a href={`mailto:${block.email}`} style={{ fontSize: FONT_SIZES.body, color: accent, textDecoration: "none", fontFamily: "var(--cb-mono)", display: "inline-block", marginBottom: 8 }}>{block.email}</a>}
                {block.list && <ul>{block.list.map((li, j) => <li key={j}>{li}</li>)}</ul>}
              </div>
            ))}
          </div>
        </div>
      </main>
      <footer style={{ borderTop: `1px solid ${P.line}`, padding: "28px 20px", textAlign: "center", position: "relative", zIndex: 1 }}>
        <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600, color: P.ink, fontSize: FONT_SIZES.body, fontFamily: "var(--cb-display)" }}><Mark size={16} accent={accent} /> Cerebrum</div>
          <nav style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "center" }}>
            {NAV.map(([slug, label]) => (<a key={slug} href={`/${slug}`} className="cb-info-navlink" aria-current={page === slug ? "page" : undefined} style={{ fontSize: FONT_SIZES.small, color: page === slug ? P.ink : P.ink2, textDecoration: "none", padding: "5px 10px", fontWeight: page === slug ? 700 : 500 }}>{label}</a>))}
          </nav>
          <div style={{ fontSize: FONT_SIZES.small, color: P.faint, fontFamily: "var(--cb-mono)" }}>© 2026 Cerebrum</div>
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
    <div style={{ marginTop: 32, border: P.dark ? "1px solid rgba(255,255,255,0.08)" : `1px solid ${P.line}`, borderRadius: 3, padding: "24px 26px 10px", background: P.dark ? "rgba(5,8,22,0.5)" : withAlpha(P.surface, 0.7), backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)" }} className="cb-fade">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 18, flexWrap: "wrap", paddingBottom: 16, borderBottom: `1px solid ${P.line}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 3, height: 18, background: accent, borderRadius: 2 }} />
          <div style={{ fontSize: FONT_SIZES.small, fontWeight: 700, letterSpacing: "0.04em", color: P.ink, textTransform: "uppercase", fontFamily: "var(--cb-mono)" }}>Bibliography</div>
          <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 600, color: P.faint, fontFamily: "var(--cb-mono)", background: withAlpha(P.faint, 0.1), padding: "1px 8px", borderRadius: 3 }}>{sources.length}</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select value={citationStyle} onChange={(e) => setCitationStyle(e.target.value)} style={{ padding: "6px 10px", fontSize: FONT_SIZES.caption, fontWeight: 500, background: P.bg, color: P.ink, border: `1px solid ${P.line}`, borderRadius: 3, cursor: "pointer", fontFamily: "var(--cb-mono)", outline: "none", ...selectChrome(P) }}>
            {styleOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          <button onClick={copyAll} style={bibBtn(P, accent)}>{copied ? "✓ Copied" : "Copy all"}</button>
          <button onClick={downloadFile} style={bibBtn(P, accent)}>Download</button>
        </div>
      </div>
      {/* v28: was a stack of individually bordered, padded "cards" — each
          one paying for its own box (border + radius + background + 14px
          gap to the next) even though a bibliography is inherently a dense
          list, not a set of unrelated tiles. Reworked into slim divider-rows
          — the same high-density-list language this file already uses for
          the Sources sidebar (`srcItem`: no per-row box, a hairline
          `borderBottom`, a flush hover wash) — so ten references read as one
          continuous, scannable column instead of ten separate panels. */}
      <ol className="cb-stagger" style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", paddingBottom: 4 }}>
        {sources.map((src, i) => <BibEntry key={i} source={src} index={i + 1} P={P} accent={accent} style={citationStyle} className="cb-fade" last={i === sources.length - 1} />)}
      </ol>
    </div>
  );
}

function BibEntry({ source, index, P, accent, style, className, last }) {
  const [hover, setHover] = useState(false);
  const formatted = formatCitation(source, style, index);
  const domain = source.url ? source.url.replace(/^https?:\/\//, "").replace(/^www\./, "").slice(0, 42) : "";
  return (
    <li id={`ref-${index}`} className={className}
      style={{
        padding: "9px 6px", margin: "0 -6px", display: "flex", gap: 10, alignItems: "flex-start",
        background: hover ? withAlpha(accent, 0.05) : "transparent",
        borderBottom: last ? "none" : `1px solid ${P.line}`,
        opacity: 0, transition: "background 0.15s ease",
      }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <span style={{ flexShrink: 0, width: 20, textAlign: "right", paddingTop: 1, color: accent, fontWeight: 700, fontSize: FONT_SIZES.caption, fontFamily: "var(--cb-mono)" }}>{index}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {(source.retracted || source.concern) && (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 7px", marginBottom: 5, background: withAlpha(source.retracted ? STATUS.bad : STATUS.warn, source.retracted ? 0.12 : 0.14), border: `1px solid ${source.retracted ? STATUS.bad : STATUS.warn}`, borderRadius: 3, fontSize: FONT_SIZES.micro, fontWeight: 700, color: source.retracted ? STATUS.bad : STATUS.warn, letterSpacing: "0.04em", fontFamily: "var(--cb-mono)", textTransform: "uppercase" }}>
            <span>⚠</span><span>{source.retracted ? "RETRACTED" : "EXPRESSION OF CONCERN"}</span>
          </div>
        )}
        {style === "bibtex" ? (
          <pre style={{ fontSize: FONT_SIZES.caption, fontFamily: "var(--cb-mono)", color: P.ink2, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{formatted}</pre>
        ) : (
          <div style={{ fontSize: FONT_SIZES.small, lineHeight: 1.5, color: P.ink, fontWeight: 500 }} dangerouslySetInnerHTML={{ __html: escapeHtml(formatted)
            // v33: escapeHtml above turns a title's real "<sub>2</sub>" into
            // literal, visible "&lt;sub&gt;2&lt;/sub&gt;" text — the same
            // bug renderCleanTitle fixes elsewhere, showing up here too
            // since this path builds a full formatted-citation string
            // through dangerouslySetInnerHTML instead of React children.
            // Same fix, same safety property: only these four whitelisted
            // tags are restored to real markup, matched against the
            // ALREADY-ESCAPED string, so anything else in the title
            // (including a real "<script>") stays inert "&lt;script&gt;"
            // text — this can only ever re-enable four known-safe tags,
            // never un-escape arbitrary HTML.
            .replace(/&lt;(sub|sup|i|b)&gt;([\s\S]*?)&lt;\/\1&gt;/gi, (m, tag, inner) => `<${tag.toLowerCase()}>${inner}</${tag.toLowerCase()}>`)
            .replace(/\*([^*]+)\*/g, '<em style="font-style: italic; font-weight: 400;">$1</em>').replace(/\n/g, "<br>") }} />
        )}
        {/* One dense meta line instead of three stacked blocks: type ·
            citation count · linked domain all inline, mono, muted. */}
        {(source.citations != null || source.type || domain) && (
          <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, marginTop: 3, display: "flex", gap: 6, alignItems: "center", fontFamily: "var(--cb-mono)", flexWrap: "wrap" }}>
            {source.type && <span style={{ fontWeight: 600, color: P.ink2 }}>{source.type}</span>}
            {source.type && (source.citations != null || domain) && <span style={{ opacity: 0.4 }}>·</span>}
            {source.citations != null && <span>{source.citations.toLocaleString()} citation{source.citations === 1 ? "" : "s"}</span>}
            {source.citations != null && domain && <span style={{ opacity: 0.4 }}>·</span>}
            {domain && (
              <a href={safeHref(source.url)} target="_blank" rel="noreferrer" style={{ color: accent, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 3, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{domain}</span><span style={{ flexShrink: 0 }}>↗</span>
              </a>
            )}
          </div>
        )}
        {source.tldr && (
          <div style={{ fontSize: FONT_SIZES.caption, color: P.ink2, marginTop: 5, paddingLeft: 8, borderLeft: `2px solid ${withAlpha(accent, 0.4)}`, lineHeight: 1.5, fontStyle: "italic" }}>
            <span style={{ fontWeight: 600, fontStyle: "normal", color: accent, letterSpacing: "0.06em", textTransform: "uppercase", marginRight: 6, fontFamily: "var(--cb-mono)" }}>TL;DR</span>{source.tldr}
          </div>
        )}
      </div>
    </li>
  );
}
function bibBtn(P, accent) { return { padding: "5px 10px", fontSize: FONT_SIZES.caption, fontWeight: 500, background: "transparent", color: P.ink2, border: `1px solid ${P.line}`, borderRadius: 3, cursor: "pointer", fontFamily: "var(--cb-mono)", letterSpacing: "0.01em" }; }

// v28: one icon-only button shape shared by every item in the docked answer
// toolbar (Copy/Share/PDF/Illustrate/Source network/Timeline — Listen is the
// odd one out since AnswerPlayer manages its own play/pause state, but it
// renders itself at the same 28x28 size so the row stays visually uniform).
// `active` swaps in the accent wash used everywhere else in this file for a
// toggled-on state (sortTabActive, sBtnP, etc.) instead of inventing a new one.
function ToolbarBtn({ title, icon, onClick, accent, P, active = false, spin = false }) {
  return (
    <button
      type="button" title={title} aria-label={title}
      onClick={onClick}
      style={{ ...S_toolbarBtnBase(P), ...(active ? { background: withAlpha(accent, 0.16), color: accent } : {}) }}
      onMouseEnter={(e) => { if (!active) { e.currentTarget.style.background = withAlpha(accent, 0.08); e.currentTarget.style.color = accent; } }}
      onMouseLeave={(e) => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = P.ink2; } }}
    >
      <Icon name={icon} size={14} className={spin ? "cb-spin" : undefined} />
    </button>
  );
}
function S_toolbarBtnBase(P) { return { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, background: "transparent", border: "none", borderRadius: 3, color: P.ink2, cursor: "pointer", fontFamily: "var(--cb-mono)", transition: "background 0.15s ease, color 0.15s ease" }; }

function ReportModal({ query, P, accent, at, onClose }) {
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("hallucination");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const trapRef = useRef(null);

  useEffect(() => { if (trapRef.current) trapRef.current.focus(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!description.trim()) return;
    setSubmitting(true);
    try {
      await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, description: description.trim(), category }),
      });
      setSubmitted(true);
      setTimeout(() => onClose(), 1800);
    } catch {
      setSubmitted(true);
      setTimeout(() => onClose(), 1800);
    }
  };

  const categories = [
    { id: "hallucination", label: "Hallucinated claim" },
    { id: "wrong-citation", label: "Wrong citation" },
    { id: "broken-source", label: "Broken source link" },
    { id: "outdated", label: "Outdated information" },
    { id: "other", label: "Other" },
  ];

  return (
    <div onClick={onClose} role="dialog" aria-modal="true" aria-label="Report data issue" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 220, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} className="cb-backdrop">
      <div ref={trapRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} style={{
        background: P.dark ? "rgba(15, 17, 26, 0.9)" : "rgba(255, 255, 255, 0.95)",
        backdropFilter: "blur(40px) saturate(150%)", WebkitBackdropFilter: "blur(40px) saturate(150%)",
        border: P.dark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.08)",
        borderRadius: 3, maxWidth: 460, width: "100%", padding: "28px", outline: "none",
        boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
      }} className="cb-modal">
        {submitted ? (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ width: 44, height: 44, borderRadius: "50%", background: withAlpha(STATUS.good, 0.12), color: STATUS.good, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
              <Icon name="check" size={20} />
            </div>
            <div style={{ fontSize: FONT_SIZES.body, fontWeight: 600, color: P.ink }}>Report received</div>
            <div style={{ fontSize: FONT_SIZES.small, color: P.ink2, marginTop: 6 }}>Thank you for improving data quality.</div>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <div style={{ fontSize: FONT_SIZES.heading, fontWeight: 700, letterSpacing: "-0.02em", color: P.ink, fontFamily: "var(--cb-display)" }}>Report data issue</div>
              <button type="button" onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: P.faint, cursor: "pointer", padding: 4, display: "inline-flex" }}><Icon name="close" size={18} /></button>
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: FONT_SIZES.small, fontWeight: 600, color: P.ink2, marginBottom: 8 }}>Category</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {categories.map((c) => (
                  <button key={c.id} type="button" onClick={() => setCategory(c.id)} style={{
                    fontSize: FONT_SIZES.caption, padding: "6px 12px", borderRadius: 3, cursor: "pointer",
                    fontFamily: "var(--cb-mono)", fontWeight: 600, transition: "all 0.15s ease",
                    background: category === c.id ? withAlpha(accent, 0.16) : "transparent",
                    color: category === c.id ? accent : P.ink2,
                    border: `1px solid ${category === c.id ? withAlpha(accent, 0.3) : P.line}`,
                  }}>{c.label}</button>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: FONT_SIZES.small, fontWeight: 600, color: P.ink2, marginBottom: 6 }}>Describe the issue</div>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="Which claim is incorrect? What should it say instead?" style={{
                width: "100%", padding: "11px 13px", fontSize: FONT_SIZES.body, borderRadius: 3,
                border: `1px solid ${P.line}`, background: P.dark ? "rgba(255,255,255,0.03)" : "#fff",
                color: P.ink, fontFamily: "var(--cb-body)", resize: "vertical", outline: "none",
              }} />
            </div>
            <button type="submit" disabled={submitting || !description.trim()} style={{
              width: "100%", padding: "12px", fontSize: FONT_SIZES.body, fontWeight: 600,
              background: accent, color: at, border: "none", borderRadius: 3,
              cursor: submitting || !description.trim() ? "default" : "pointer",
              opacity: submitting || !description.trim() ? 0.6 : 1,
              fontFamily: "var(--cb-body)",
            }}>{submitting ? "Sending…" : "Submit report"}</button>
          </form>
        )}
      </div>
    </div>
  );
}

// Onboarding guided tour — localStorage-gated, shown once for new visitors.
// Three pulsing tooltip popovers highlighting the search bar, evidence
// filters, and source network. Skip button dismisses permanently.
const TOUR_STEPS = [
  {
    title: "Command Line",
    icon: "⌘",
    text: "Type any scientific question into the search bar. Cerebrum queries 14 scholarly databases in parallel — PubMed, OpenAlex, Semantic Scholar, Europe PMC, and more — then synthesizes a fully cited answer from the retrieved evidence. No pre-trained generalization: every claim traces to a real paper.",
    hint: `Press ${IS_MAC ? "⌘" : "Ctrl"}+K to focus the search bar from anywhere.`,
  },
  {
    title: "Evidence Filters",
    icon: "◉",
    text: "After results arrive, use the filter row to narrow by publication type (meta-analysis, RCT, review, preprint), date range, and evidence tier. Filters apply instantly — the source panel and synthesis update in real time so you see only the evidence that meets your threshold.",
    hint: "Combine filters to surface the highest-confidence subset of the literature.",
  },
  {
    title: "Deep Read Drawer",
    icon: "⊞",
    text: "Click any source card to open its deep-read panel: full abstract, author list, journal metadata, DOI link, relevance score, and evidence classification. Save or pin papers directly from here, and use the Author button to instantly find more work by the same research group.",
    hint: "Navigate source cards with J/K keys; Enter opens the drawer, Escape closes it.",
  },
  {
    title: "Contradiction Engine",
    icon: "⟁",
    text: "The Divergent Findings & Gaps section surfaces papers that disagree with each other or with the consensus. Instead of burying conflicting evidence, Cerebrum highlights it — so you can evaluate the full landscape of a question, not just the majority position.",
    hint: "Methodological Confidence scores help distinguish strong from weak disagreements.",
  },
  {
    title: "High-APM Navigation",
    icon: "⚡",
    text: "Cerebrum is built for speed. Open the command palette to jump between investigations instantly. Use keyboard shortcuts for every major action: search, new investigation, saved articles, settings, and theme toggle. Pin key papers so they persist across follow-up queries in the same session.",
    hint: `${IS_MAC ? "⌘" : "Ctrl"}+K Search · ${IS_MAC ? "⌘" : "Ctrl"}+J New investigation · ${IS_MAC ? "⌘" : "Ctrl"}+B Saved · Esc Close`,
  },
];

function GuidedTour({ P, accent }) {
  const [step, setStep] = useState(0);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem("cb_tour_done") === "1"; } catch { return false; }
  });
  const [entering, setEntering] = useState(true);

  useEffect(() => {
    if (dismissed) return;
    const t = setTimeout(() => setEntering(false), 400);
    return () => clearTimeout(t);
  }, [dismissed]);

  useEffect(() => {
    if (dismissed) return;
    const onKey = (e) => {
      if (e.key === "Escape") { dismiss(); return; }
      if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); next(); }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); setStep((s) => Math.max(0, s - 1)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismissed, step]);

  const dismiss = () => {
    try { localStorage.setItem("cb_tour_done", "1"); } catch {}
    setDismissed(true);
  };
  const next = () => {
    if (step >= TOUR_STEPS.length - 1) { dismiss(); return; }
    setStep(step + 1);
  };
  const prev = () => setStep((s) => Math.max(0, s - 1));

  if (dismissed) return null;

  const current = TOUR_STEPS[step];
  const progress = ((step + 1) / TOUR_STEPS.length) * 100;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 300,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0, 0, 0, 0.6)",
      backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
      opacity: entering ? 0 : 1,
      transition: "opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
    }} onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}>
      <div style={{
        width: "min(480px, calc(100vw - 48px))",
        background: P.dark ? "rgba(15, 17, 26, 0.85)" : "rgba(255, 255, 255, 0.92)",
        backdropFilter: "blur(40px) saturate(150%)",
        WebkitBackdropFilter: "blur(40px) saturate(150%)",
        border: P.dark ? "1px solid rgba(255,255,255,0.1)" : "1px solid rgba(0,0,0,0.1)",
        borderRadius: 16,
        boxShadow: P.dark
          ? "0 24px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05) inset"
          : "0 24px 80px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.03) inset",
        overflow: "hidden",
        transform: entering ? "scale(0.95) translateY(12px)" : "scale(1) translateY(0)",
        transition: "transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
      }}>
        {/* Progress bar */}
        <div style={{ height: 2, background: P.dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)" }}>
          <div style={{
            height: "100%", width: progress + "%",
            background: accent,
            transition: "width 0.35s cubic-bezier(0.16, 1, 0.3, 1)",
          }} />
        </div>

        <div style={{ padding: "32px 32px 28px" }}>
          {/* Step icon + counter */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: withAlpha(accent, 0.12),
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 20, color: accent,
            }}>{current.icon}</div>
            <span style={{
              fontSize: FONT_SIZES.caption, fontWeight: 600, letterSpacing: "0.08em",
              textTransform: "uppercase", color: P.faint, fontFamily: "var(--cb-mono)",
            }}>{step + 1} of {TOUR_STEPS.length}</span>
          </div>

          {/* Title */}
          <h3 style={{
            fontSize: "clamp(18px, 2.5vw, 22px)", fontWeight: 700, color: P.ink,
            margin: "0 0 12px", fontFamily: "var(--cb-heading)", letterSpacing: "-0.02em",
            lineHeight: 1.2,
          }}>{current.title}</h3>

          {/* Body text */}
          <p style={{
            fontSize: FONT_SIZES.body, color: P.ink2, lineHeight: 1.7,
            margin: "0 0 16px", fontFamily: "var(--cb-body)",
          }}>{current.text}</p>

          {/* Hint */}
          {current.hint && (
            <div style={{
              fontSize: FONT_SIZES.small, color: P.faint,
              background: P.dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
              border: P.dark ? "1px solid rgba(255,255,255,0.06)" : "1px solid rgba(0,0,0,0.06)",
              borderRadius: 8, padding: "10px 14px",
              fontFamily: "var(--cb-mono)", letterSpacing: "0.01em", lineHeight: 1.5,
            }}>{current.hint}</div>
          )}
        </div>

        {/* Navigation footer */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 32px 24px",
          borderTop: P.dark ? "1px solid rgba(255,255,255,0.06)" : "1px solid rgba(0,0,0,0.06)",
        }}>
          <button onClick={dismiss} style={{
            fontSize: FONT_SIZES.small, color: P.faint,
            background: "none", border: "none", cursor: "pointer",
            fontFamily: "var(--cb-body)", padding: "6px 0",
            transition: "color 0.2s",
          }} onMouseEnter={(e) => e.target.style.color = P.ink}
             onMouseLeave={(e) => e.target.style.color = P.faint}>
            Skip tour
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            {step > 0 && (
              <button onClick={prev} style={{
                fontSize: FONT_SIZES.small, fontWeight: 600, padding: "8px 18px", borderRadius: 8,
                background: P.dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
                color: P.ink, border: "none", cursor: "pointer",
                fontFamily: "var(--cb-body)", transition: "background 0.2s",
              }} onMouseEnter={(e) => e.target.style.background = P.dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)"}
                 onMouseLeave={(e) => e.target.style.background = P.dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)"}>
                Back
              </button>
            )}
            <button onClick={next} style={{
              fontSize: FONT_SIZES.small, fontWeight: 600, padding: "8px 22px", borderRadius: 8,
              background: accent, color: P.dark ? "#000" : "#fff",
              border: "none", cursor: "pointer", fontFamily: "var(--cb-body)",
              transition: "filter 0.2s",
            }} onMouseEnter={(e) => e.target.style.filter = "brightness(1.15)"}
               onMouseLeave={(e) => e.target.style.filter = "none"}>
              {step >= TOUR_STEPS.length - 1 ? "Get started" : "Next"}
            </button>
          </div>
        </div>

        {/* Step dots */}
        <div style={{
          display: "flex", justifyContent: "center", gap: 6,
          paddingBottom: 20,
        }}>
          {TOUR_STEPS.map((_, i) => (
            <button key={i} onClick={() => setStep(i)} aria-label={`Go to step ${i + 1}`} style={{
              width: i === step ? 20 : 6, height: 6, borderRadius: 3,
              background: i === step ? accent : P.dark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.12)",
              border: "none", cursor: "pointer", padding: 0,
              transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
            }} />
          ))}
        </div>
      </div>
    </div>
  );
}

// Reshapes an already-synthesized answer into Abstract / body / Conclusion
// blocks for the print-only academic layout below. This is a reformat, not
// a new generation pass — every word here already exists in `answer`; the
// "##"/"###" section headers the model wrote are kept as body headings, the
// first real paragraph becomes the Abstract, and the last becomes the
// Conclusion, the same way a person skimming their own answer for a quick
// paper would carve it up by hand.
function buildAcademicPaperBlocks(answer) {
  const clean = normalizeSectionHeaders(answer || "").trim();
  const chunks = clean.split(/\n{2,}/).map((c) => c.trim()).filter(Boolean);
  const blocks = chunks.map((c) => {
    const h = c.match(/^#{2,3}\s+(.+)$/);
    if (h) return { type: "heading", text: h[1] };
    return { type: "para", text: c.replace(/^[•\-]\s+/gm, "").replace(/^\d+\.\s+/gm, "") };
  });
  let firstParaIdx = blocks.findIndex((b) => b.type === "para");
  let lastParaIdx = -1;
  for (let i = blocks.length - 1; i >= 0; i--) { if (blocks[i].type === "para") { lastParaIdx = i; break; } }
  const abstract = firstParaIdx >= 0 ? blocks[firstParaIdx].text : "";
  const conclusion = lastParaIdx >= 0 && lastParaIdx !== firstParaIdx ? blocks[lastParaIdx].text : "";
  const bodyBlocks = blocks.filter((_, i) => i !== firstParaIdx && i !== lastParaIdx);
  return { abstract, bodyBlocks, conclusion };
}

function Turn({ t, P, accent, at, S, typewriter, hoverCite, setHoverCite, onRelated, citationStyle, setCitationStyle, onShowNetwork = () => {}, onShowTimeline = () => {}, onIllustrate = () => {}, interactive = true }) {
  const shown = useTypewriter(t.answer, typewriter && t.fresh);
  const done = shown === t.answer;
  const [copiedAnswer, setCopiedAnswer] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [generatingPaper, setGeneratingPaper] = useState(false);
  const [paperReady, setPaperReady] = useState(false);
  const [openVideo, setOpenVideo] = useState(null);
  const paper = useMemo(() => buildAcademicPaperBlocks(t.answer), [t.answer]);

  // A running conversation mounts one <Turn> per exchange (see turns.map in
  // App), so "only one printed paper on the page" can't be enforced with a
  // single top-level flag — it falls out of each Turn owning its own
  // paperReady instead: only the turn that was actually printed ever
  // renders a .cb-print-paper-doc node at all, so the print stylesheet's
  // "unhide the one that exists" rule (see the @media print CSS) never has
  // more than one candidate to find. The body class is what hides
  // everything else (header, other turns, buttons) for the duration of the
  // print; afterprint (or a fallback timeout for browsers that don't fire
  // it from window.print()) removes it and clears this turn's own node.
  useEffect(() => {
    if (!paperReady) return;
    document.body.classList.add("cb-printing-paper");
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      document.body.classList.remove("cb-printing-paper");
      setPaperReady(false);
    };
    window.addEventListener("afterprint", cleanup, { once: true });
    const fallback = setTimeout(cleanup, 15000);
    window.print();
    return () => { clearTimeout(fallback); window.removeEventListener("afterprint", cleanup); };
  }, [paperReady]);
  return (
    <div style={S.turn} className="cb-rise">
      {/* Query label — monospaced, quiet */}
      <div style={S.qLabel}>
        <span style={S.qDot} />
        <span style={{ fontFamily: "var(--cb-mono)", fontSize: FONT_SIZES.caption, letterSpacing: "0.08em", textTransform: "uppercase" }}>Inquiry</span>
      </div>
      <h2 style={S.headline}>{t.hasImage && <Icon name="image" size={22} style={{ marginRight: 10, verticalAlign: "-3px", opacity: 0.6 }} />}{t.q}</h2>
      {/* Answer card */}
      <div style={S.answerCard} className="cb-answer-enter cb-glass-panel">
        {/* v34: the metadata badge and the action toolbar used to be two
            independent siblings — the badge in normal flow, the toolbar
            docked via `position: absolute; top; right`. On a narrow mobile
            width the badge's text ("11 sources · 2 min read") runs long
            enough to reach under the absolutely-positioned toolbar, which
            has no awareness of the badge's width and just sits on top of
            it — a real, reported overlap, not a spacing tweak. Fixed by
            making them two children of ONE flex row instead: `justifyContent:
            space-between` keeps them pinned to opposite ends on a wide
            screen exactly like before, and `flexWrap: wrap` means that when
            they don't both fit on one line, the toolbar wraps to its own
            line below the badge — pushed down, never overlapping. `S.toolbar`
            itself dropped `position: absolute` (see its own comment) to
            become a normal flow item this row can actually wrap. */}
        {((t.sources && t.sources.length > 0) || (done && t.answer)) && (
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 8, marginBottom: 16 }}>
            {t.sources && t.sources.length > 0 ? (
              <div className="sources-badge" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: FONT_SIZES.caption, fontWeight: 600, color: accent, background: withAlpha(accent, 0.1), padding: "3px 10px", borderRadius: 3, fontFamily: "var(--cb-mono)", letterSpacing: "0.02em" }}>{t.sources.length} source{t.sources.length === 1 ? "" : "s"}</span>
                {t.answer && <span style={{ fontSize: FONT_SIZES.caption, color: P.faint, fontFamily: "var(--cb-mono)" }}>{Math.ceil(t.answer.split(/\s+/).length / 238)} min read</span>}
              </div>
            ) : <span />}
            {/* v28: icon-first, one row that never wraps internally —
                replaces the old flex-wrap row of icon+label buttons
                (Copy answer / Share / Print / Source network / Timeline /
                Illustrate) that reflowed onto two or three ragged lines once
                all six were present. Every button keeps its meaning via
                `title` + `aria-label` instead of visible text — that's the
                actual trade-off of going icon-only, called out here rather
                than left for someone to discover by accident. Requested set
                is Copy/Share/PDF/Listen/Illustrate; Source network and
                Timeline were real existing features (not in the requested
                bracket) kept appended at the end rather than silently
                dropped. v34: no longer docked via `position: absolute` — see
                the wrapping row's own comment just above — so it now sits as
                a normal flex item that wraps below the badge instead of
                sitting on top of it. */}
            {done && t.answer && (
              <div style={S.toolbar} onClick={(e) => e.stopPropagation()}>
                <ToolbarBtn
                  title={copiedAnswer ? "Copied!" : "Copy answer"}
                  icon={copiedAnswer ? "check" : "copy"}
                  active={copiedAnswer}
                  accent={accent} P={P}
                  onClick={() => {
                    copyToClipboard(t.answer, "Answer copied").then((ok) => {
                      if (ok) { setCopiedAnswer(true); setTimeout(() => setCopiedAnswer(false), 1500); }
                    });
                  }}
                />
                <ToolbarBtn
                  title={linkCopied ? "Link copied!" : "Share"}
                  icon={linkCopied ? "check" : "link"}
                  active={linkCopied}
                  accent={accent} P={P}
                  onClick={async () => {
                    const url = window.location.origin + "/?q=" + encodeURIComponent(t.q);
                    // Prefer the native share sheet (real "sharing" — Messages,
                    // Mail, social apps — on mobile and supporting desktop
                    // browsers). navigator.share() requires a secure context and
                    // can throw AbortError when the user just dismisses the
                    // sheet, which is not a failure and shouldn't show an error.
                    if (navigator.share && window.isSecureContext) {
                      try { await navigator.share({ title: "Cerebrum", text: t.q, url }); return; }
                      catch (err) { if (err && err.name === "AbortError") return; /* fall through to clipboard */ }
                    }
                    copyToClipboard(url, "Link copied").then((ok) => {
                      if (ok) { setLinkCopied(true); setTimeout(() => setLinkCopied(false), 1500); }
                    });
                  }}
                />
                {/* v5: there was already a full @media print stylesheet in this
                    file — quietly supporting the design goal stated in this
                    file's own header comment ("results read like a premium
                    research brief — you'd print this") — with no button
                    anywhere that surfaced it. A user would've had to already
                    know to hit Ctrl/Cmd+P.
                    v36: rather than print the live app chrome as-is, this now
                    reflows the same answer into a formal paper layout first
                    (see buildAcademicPaperBlocks) — a real reformat of what's
                    already on screen, not a second AI call. */}
                <ToolbarBtn
                  title={generatingPaper ? "Generating paper…" : "Generate paper / Print"}
                  icon={generatingPaper ? "refresh" : "printer"}
                  active={generatingPaper}
                  spin={generatingPaper}
                  accent={accent} P={P}
                  onClick={() => {
                    if (generatingPaper || paperReady) return;
                    setGeneratingPaper(true);
                    setTimeout(() => { setGeneratingPaper(false); setPaperReady(true); }, 650);
                  }}
                />
                {t.answer.length > 40 && <AnswerPlayer text={t.answer} accent={accent} P={P} compact />}
                {done && <ToolbarBtn title="Illustrate this answer" icon="wand" accent={accent} P={P} onClick={() => onIllustrate(t.q)} />}
                {interactive && t.sources && t.sources.length >= 2 && <ToolbarBtn title="Source network" icon="network" accent={accent} P={P} onClick={() => onShowNetwork(t.sources)} />}
                {interactive && t.sources && t.sources.length >= 2 && <ToolbarBtn title="Timeline" icon="timeline" accent={accent} P={P} onClick={() => onShowTimeline(t.sources)} />}
                <ToolbarBtn title="Report bad answer" icon="flag" accent={STATUS.bad} P={P} onClick={() => setShowReport(true)} />
              </div>
            )}
          </div>
        )}
        {renderAnswer(shown, t.sources, P, accent, hoverCite, setHoverCite)}
        {done && (
          <div style={{ ...S.byline, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <span style={S.aiTag}>AI-synthesized · verify against cited sources</span>
            <span style={{ fontSize: FONT_SIZES.micro, color: P.faint, fontFamily: "var(--cb-mono)" }}>{new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
          </div>
        )}
        {showReport && <ReportModal query={t.q} P={P} accent={accent} at={at} onClose={() => setShowReport(false)} />}
      </div>
      {/* Points of Friction — conflicting claims detected across sources */}
      {done && t.literatureConflicts && t.literatureConflicts.length > 0 && (
        <div style={{ marginTop: 20, padding: "20px 24px", border: `1px solid ${withAlpha(STATUS.warn, 0.3)}`, borderRadius: 3, background: withAlpha(STATUS.warn, 0.04) }} className="cb-fade">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <div style={{ width: 3, height: 18, background: STATUS.warn, borderRadius: 2 }} />
            <div style={{ fontSize: FONT_SIZES.small, fontWeight: 700, letterSpacing: "0.04em", color: STATUS.warn, textTransform: "uppercase", fontFamily: "var(--cb-mono)" }}>Points of Friction</div>
            <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 600, color: withAlpha(STATUS.warn, 0.7), fontFamily: "var(--cb-mono)", background: withAlpha(STATUS.warn, 0.1), padding: "1px 8px", borderRadius: 3 }}>{t.literatureConflicts.length}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {t.literatureConflicts.map((c, ci) => (
              <div key={ci} style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 12, alignItems: "stretch" }}>
                <div style={{ padding: "12px 14px", background: withAlpha(STATUS.warn, 0.06), borderRadius: 3, border: `1px solid ${withAlpha(STATUS.warn, 0.15)}` }}>
                  <div style={{ fontSize: FONT_SIZES.micro, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: withAlpha(STATUS.warn, 0.7), fontFamily: "var(--cb-mono)", marginBottom: 6 }}>[{c.idxA}]</div>
                  <div style={{ fontSize: FONT_SIZES.small, color: P.ink, lineHeight: 1.55 }}>{c.claimA}</div>
                  <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, marginTop: 6, lineHeight: 1.4, fontStyle: "italic" }}>{c.sourceA ? renderCleanTitle(c.sourceA) : ""}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", color: withAlpha(STATUS.warn, 0.5), fontSize: FONT_SIZES.small, fontFamily: "var(--cb-mono)", fontWeight: 700 }}>vs</div>
                <div style={{ padding: "12px 14px", background: withAlpha(STATUS.warn, 0.06), borderRadius: 3, border: `1px solid ${withAlpha(STATUS.warn, 0.15)}` }}>
                  <div style={{ fontSize: FONT_SIZES.micro, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: withAlpha(STATUS.warn, 0.7), fontFamily: "var(--cb-mono)", marginBottom: 6 }}>[{c.idxB}]</div>
                  <div style={{ fontSize: FONT_SIZES.small, color: P.ink, lineHeight: 1.55 }}>{c.claimB || "—"}</div>
                  <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, marginTop: 6, lineHeight: 1.4, fontStyle: "italic" }}>{c.sourceB ? renderCleanTitle(c.sourceB) : ""}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {done && t.factCheck && <FactCheck fc={t.factCheck} P={P} accent={accent} />}
      {/* AI suggestions */}
      {interactive && done && t.suggestions && t.suggestions.length > 0 && (
        <div style={{ marginTop: 20, display: "flex", flexWrap: "wrap", gap: 8 }} className="cb-fade">
          {t.suggestions.map((s, i) => (
            <button key={i} onClick={() => s.query && onRelated && onRelated(s.query)} disabled={!s.query}
              style={{ padding: "7px 14px", fontSize: FONT_SIZES.small, fontWeight: 500, background: s.query ? withAlpha(accent, 0.08) : "transparent", color: s.query ? accent : P.faint, border: `1px solid ${s.query ? withAlpha(accent, 0.25) : P.line}`, borderRadius: 3, cursor: s.query ? "pointer" : "default", fontFamily: "inherit" }}>
              {s.label} {s.query && <span style={{ opacity: 0.5, marginLeft: 4 }}>→</span>}
            </button>
          ))}
        </div>
      )}
      {done && t.sources && t.sources.length > 0 && <Bibliography sources={t.sources} P={P} accent={accent} citationStyle={citationStyle} setCitationStyle={setCitationStyle} />}
      {/* v28: was a collapsed <details>/<summary> — closed by default, so a
          real feature (video results) was invisible unless someone thought
          to click a plain-text disclosure triangle. Un-collapsed into a
          persistent section with the same header treatment as Bibliography
          (accent tick + label + count chip) so it reads as a first-class
          part of the answer, not a hidden extra. Grid unchanged structurally
          (16:9 thumbnails, auto-fill 2-3 columns) but given a play-glyph
          overlay and a real hover glow — no fabricated duration badge, since
          the backend's video objects genuinely carry no duration data. */}
      {done && t.videos && t.videos.length > 0 && t.sources && t.sources.length > 0 && (
        <div style={{ marginTop: 24 }} className="cb-fade">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <div style={{ width: 3, height: 18, background: accent, borderRadius: 2 }} />
            <div style={{ fontSize: FONT_SIZES.small, fontWeight: 700, letterSpacing: "0.04em", color: P.ink, textTransform: "uppercase", fontFamily: "var(--cb-mono)" }}>Related videos</div>
            <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 600, color: P.faint, fontFamily: "var(--cb-mono)", background: withAlpha(P.faint, 0.1), padding: "1px 8px", borderRadius: 3 }}>{t.videos.length}</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }} className="cb-stagger">
            {t.videos.slice(0, 6).map((v, i) => (
              <button key={v.id || i} type="button" onClick={() => setOpenVideo(v)} className="cb-fade cb-card" style={{ display: "block", width: "100%", background: P.surface, border: `1px solid ${P.line}`, borderRadius: 3, overflow: "hidden", textDecoration: "none", color: P.ink, opacity: 0, padding: 0, font: "inherit", textAlign: "left", cursor: "pointer", transition: "border-color 0.2s ease, box-shadow 0.2s ease" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.boxShadow = `0 0 0 1px ${withAlpha(accent, 0.4)}, 0 8px 24px ${withAlpha(accent, 0.12)}`; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = P.line; e.currentTarget.style.boxShadow = "none"; }}>
                <div style={{ position: "relative", width: "100%", aspectRatio: "16/9", background: P.bg, overflow: "hidden" }}>
                  <img src={v.thumbnail} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.15)" }}>
                    <div style={{ width: 34, height: 34, borderRadius: "50%", background: "rgba(10,14,32,0.65)", border: "1px solid rgba(255,255,255,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z" /></svg>
                    </div>
                  </div>
                </div>
                <div style={{ padding: "10px 12px" }}>
                  <div style={{ fontSize: FONT_SIZES.small, fontWeight: 600, lineHeight: 1.35, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", marginBottom: 4 }}>{v.title}</div>
                  <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, fontFamily: "var(--cb-mono)" }}>{v.author}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
      {openVideo && <VideoPlayerModal P={P} accent={accent} at={at} video={openVideo} close={() => setOpenVideo(null)} />}
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
      {/* Print-only academic layout — invisible in the normal UI (see the
          base ".cb-print-paper-doc { display: none }" rule) and only ever
          mounted once this specific Turn's "Generate paper" button has
          fired (see paperReady above), so it's never the wrong turn's
          content that a multi-turn conversation's print stylesheet finds. */}
      {paperReady && (
        <div className="cb-print-paper-doc" aria-hidden="true">
          <div className="cb-paper-watermark">Cerebrum™</div>
          <div className="cb-paper-page">
            <div className="cb-paper-title">{t.q}</div>
            <div className="cb-paper-byline">Synthesized by Cerebrum · {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div>

            <div className="cb-paper-section-label">Abstract</div>
            <p className="cb-paper-para">{paper.abstract || "No summary available for this answer."}</p>

            <div className="cb-paper-section-label">Introduction</div>
            <p className="cb-paper-para">This paper synthesizes current research addressing the question: "{t.q}." The findings below are drawn from {t.sources && t.sources.length > 0 ? `the ${t.sources.length} source${t.sources.length === 1 ? "" : "s"} cited in the references` : "the cited literature"}.</p>

            {paper.bodyBlocks.map((b, i) => (
              b.type === "heading"
                ? <div key={i} className="cb-paper-heading">{b.text}</div>
                : <p key={i} className="cb-paper-para">{b.text}</p>
            ))}

            {paper.conclusion && (
              <>
                <div className="cb-paper-section-label">Conclusion</div>
                <p className="cb-paper-para">{paper.conclusion}</p>
              </>
            )}

            {t.sources && t.sources.length > 0 && (
              <>
                <div className="cb-paper-section-label">References</div>
                <div className="cb-paper-references">
                  {t.sources.map((s, i) => (
                    <p key={i} className="cb-paper-ref">{formatCitation(s, citationStyle || "vancouver", i + 1)}</p>
                  ))}
                </div>
              </>
            )}
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
      <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 600, letterSpacing: "0.1em", color: accent, marginBottom: 10, textTransform: "uppercase", fontFamily: "var(--cb-mono)" }}>{title}</div>
      <div style={{ fontSize: FONT_SIZES.body, lineHeight: 1.7, color: P.ink }}>{children}</div>
    </div>
  );
  const List = ({ items }) => (
    <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
      {items.map((it, i) => <li key={i} style={{ marginBottom: 6, fontSize: FONT_SIZES.small, lineHeight: 1.65, color: P.ink2 }}>{it}</li>)}
    </ul>
  );
  return (
    <div onClick={close} role="dialog" aria-modal="true" aria-label="How Cerebrum works" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} className="cb-backdrop">
      <div ref={trapRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} style={{ background: P.bg, borderRadius: 3, maxWidth: 600, width: "100%", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 24px 80px rgba(0,0,0,0.5)", border: `1px solid ${P.line}`, outline: "none" }} className="cb-modal">
        <div style={{ position: "sticky", top: 0, background: P.bg, padding: "20px 24px 16px", borderBottom: `1px solid ${P.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: FONT_SIZES.heading, fontWeight: 700, letterSpacing: "-0.02em", color: P.ink, fontFamily: "var(--cb-display)" }}>How Cerebrum works</div>
            <div style={{ fontSize: FONT_SIZES.small, color: P.faint, marginTop: 2, fontFamily: "var(--cb-mono)" }}>A short, honest technical explanation.</div>
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
          <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, marginTop: 24, paddingTop: 16, borderTop: `1px solid ${P.line}`, fontFamily: "var(--cb-mono)" }}>Cerebrum™ · Built by Vaticay</div>
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
    <div onClick={close} role="dialog" aria-modal="true" aria-label="What's new in Cerebrum V5" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 210, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} className="cb-backdrop">
      <div ref={trapRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} style={{ background: P.bg, borderRadius: 3, maxWidth: 520, width: "100%", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 24px 80px rgba(0,0,0,0.5)", border: `1px solid ${P.line}`, outline: "none" }} className="cb-modal">
        <div style={{ padding: "28px 28px 8px" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "4px 10px", borderRadius: 3, background: withAlpha(accent, 0.12), color: accent, fontSize: FONT_SIZES.caption, fontWeight: 700, fontFamily: "var(--cb-mono)", letterSpacing: "0.06em", marginBottom: 16 }}>
            <Icon name="sparkle" size={12} /> V5 · NOW LIVE
          </div>
          <div style={{ fontSize: FONT_SIZES.display, fontWeight: 700, letterSpacing: "-0.02em", color: P.ink, fontFamily: "var(--cb-display)", marginBottom: 8 }}>Cerebrum is now an all-in-one research instrument.</div>
          <div style={{ fontSize: FONT_SIZES.body, color: P.ink2, lineHeight: 1.6, marginBottom: 22 }}>Not just a question box anymore — compare investigations, map and time-trace your sources, and generate a concept illustration, all without leaving the app.</div>
        </div>
        <div style={{ padding: "0 28px" }}>
          {items.map((it, i) => (
            <div key={i} style={{ display: "flex", gap: 14, padding: "14px 0", borderTop: i ? `1px solid ${P.line}` : "none" }}>
              <span style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 3, background: withAlpha(accent, 0.1), color: accent, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name={it.icon} size={16} /></span>
              <div>
                <div style={{ fontSize: FONT_SIZES.body, fontWeight: 600, color: P.ink, marginBottom: 3 }}>{it.title}</div>
                <div style={{ fontSize: FONT_SIZES.small, color: P.ink2, lineHeight: 1.55 }}>{it.body}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ padding: "20px 28px 28px" }}>
          <button onClick={close} style={{ width: "100%", padding: "13px", fontSize: FONT_SIZES.body, fontWeight: 600, background: accent, color: at, border: "none", borderRadius: 3, cursor: "pointer", fontFamily: "var(--cb-body)" }}>Got it</button>
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
      <div ref={trapRef} tabIndex={-1} style={{ background: P.bg, borderRadius: 3, maxWidth: 400, width: "100%", padding: 26, boxShadow: "0 24px 80px rgba(0,0,0,0.5)", border: `1px solid ${P.line}`, outline: "none" }} className="cb-modal">
        <div style={{ width: 40, height: 40, borderRadius: 3, background: withAlpha(accent, 0.12), color: accent, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}><Icon name="bookmarkFilled" size={18} /></div>
        <div style={{ fontSize: FONT_SIZES.subhead, fontWeight: 700, color: P.ink, marginBottom: 8 }}>Bring your existing data along?</div>
        <div style={{ fontSize: FONT_SIZES.small, color: P.ink2, lineHeight: 1.6, marginBottom: 18 }}>
          This browser already has {savedCount > 0 ? <><strong>{savedCount} saved source{savedCount === 1 ? "" : "s"}</strong>{historyCount > 0 ? " and " : ""}</> : null}
          {historyCount > 0 ? <><strong>{historyCount} past investigation{historyCount === 1 ? "" : "s"}</strong></> : null} from before you signed in. Attach it to your new account so it follows you to other devices?
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onSkip} style={{ flex: 1, padding: "11px", fontSize: FONT_SIZES.small, fontWeight: 600, background: "transparent", color: P.ink2, border: `1px solid ${P.line}`, borderRadius: 3, cursor: "pointer" }}>Start account fresh</button>
          <button onClick={onImport} style={{ flex: 1, padding: "11px", fontSize: FONT_SIZES.small, fontWeight: 600, background: accent, color: at, border: "none", borderRadius: 3, cursor: "pointer" }}>Add to my account</button>
        </div>
        <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, marginTop: 12, lineHeight: 1.5 }}>"Start fresh" clears this browser's local list rather than leaving it stranded outside your account.</div>
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
      <div ref={trapRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} style={{ background: P.bg, borderRadius: 3, maxWidth: 780, width: "100%", maxHeight: "85vh", display: "flex", boxShadow: "0 24px 80px rgba(0,0,0,0.5)", border: `1px solid ${P.line}`, overflow: "hidden", outline: "none" }} className="cb-modal">
        <div style={{ width: 210, flexShrink: 0, borderRight: `1px solid ${P.line}`, padding: 16, overflowY: "auto" }}>
          <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: P.faint, fontFamily: "var(--cb-mono)", marginBottom: 12 }}>Collections</div>
          {[{ id: "all", name: "All saved" }, { id: "uncategorized", name: "Uncategorized" }, ...collections].map((c) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
              {renamingId === c.id ? (
                <input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { onRenameCollection(c.id, renameValue); setRenamingId(null); } if (e.key === "Escape") { e.stopPropagation(); setRenamingId(null); } }} onBlur={() => setRenamingId(null)} style={{ flex: 1, padding: "7px 8px", fontSize: FONT_SIZES.small, borderRadius: 3, border: `1px solid ${accent}`, background: "transparent", color: P.ink }} />
              ) : (
                <button onClick={() => setActiveId(c.id)} onDoubleClick={() => { if (c.id !== "all" && c.id !== "uncategorized") { setRenamingId(c.id); setRenameValue(c.name); } }} style={{ flex: 1, textAlign: "left", padding: "7px 8px", fontSize: FONT_SIZES.small, borderRadius: 3, border: "none", cursor: "pointer", background: activeId === c.id ? withAlpha(accent, 0.12) : "transparent", color: activeId === c.id ? accent : P.ink2, fontFamily: "var(--cb-body)" }}>
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
            <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) { onCreateCollection(newName.trim()); setNewName(""); } }} placeholder="New collection…" aria-label="New collection name" style={{ flex: 1, padding: "7px 8px", fontSize: FONT_SIZES.small, borderRadius: 3, border: `1px solid ${P.line}`, background: "transparent", color: P.ink }} />
            <button onClick={() => { if (newName.trim()) { onCreateCollection(newName.trim()); setNewName(""); } }} aria-label="Create collection" style={{ background: withAlpha(accent, 0.12), color: accent, border: "none", borderRadius: 3, padding: "0 10px", cursor: "pointer" }}><Icon name="plus" size={13} /></button>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "16px 20px", borderBottom: `1px solid ${P.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: FONT_SIZES.body, fontWeight: 700, color: P.ink }}>{activeId === "all" ? "All saved" : activeId === "uncategorized" ? "Uncategorized" : collections.find((c) => c.id === activeId)?.name || "Collection"}</div>
            <button onClick={close} aria-label="Close" style={{ background: "none", border: "none", color: P.faint, cursor: "pointer", padding: 4, display: "inline-flex" }}><Icon name="close" size={18} /></button>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
            {visible.length === 0 ? (
              <div style={{ fontSize: FONT_SIZES.small, color: P.faint, textAlign: "center", padding: "40px 0" }}>
                {activeId === "all" ? "Nothing saved yet." : "Nothing here yet — move a saved source in with the dropdown next to it on “All saved.”"}
              </div>
            ) : visible.map((s, i) => (
              <div key={sourceKey(s)} style={{ padding: "12px 0", borderTop: i ? `1px solid ${P.line}` : "none", display: "flex", alignItems: "flex-start", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: FONT_SIZES.small, fontWeight: 600, color: P.ink, marginBottom: 4 }}>{s.title}</div>
                  <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, fontFamily: "var(--cb-mono)" }}>{s.journal || ""}{s.year ? ` · ${s.year}` : ""}</div>
                </div>
                <select value={s.collectionId || ""} onChange={(e) => onMoveSource(s, e.target.value || null)} aria-label={`Move "${s.title}" to a collection`} style={{ fontSize: FONT_SIZES.caption, padding: "5px 6px", borderRadius: 3, border: `1px solid ${P.line}`, background: "transparent", color: P.ink2, fontFamily: "var(--cb-mono)", cursor: "pointer", ...selectChrome(P) }}>
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
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ width: "100%", padding: "9px 10px", fontSize: FONT_SIZES.small, borderRadius: 3, border: `1px solid ${P.line}`, background: P.dark ? "rgba(255,255,255,0.03)" : "#fff", color: P.ink, fontFamily: "var(--cb-mono)", cursor: "pointer", ...selectChrome(P) }}>
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
      )) : <div style={{ fontSize: FONT_SIZES.small, color: P.faint, textAlign: "center", padding: "60px 0" }}>Pick an investigation to compare.</div>}
    </div>
  );
  return (
    <div onClick={close} role="dialog" aria-modal="true" aria-label="Compare investigations" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} className="cb-backdrop">
      <div ref={trapRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} style={{ background: P.bg, borderRadius: 3, maxWidth: 1100, width: "100%", height: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 80px rgba(0,0,0,0.5)", border: `1px solid ${P.line}`, overflow: "hidden", outline: "none" }} className="cb-modal">
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${P.line}`, display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ fontSize: FONT_SIZES.body, fontWeight: 700, color: P.ink, flexShrink: 0 }}>Compare</div>
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

/* ════════════════════════════════════════════════════════════════
   PAPER DRAWER — deep-read panel for individual sources

   Slides in from the right edge when a source card is clicked.
   Displays the paper's full metadata (title, authors, journal, year,
   abstract) and provides a scoped Q&A input so the user can ask
   follow-up questions constrained to that single paper's content.
   ════════════════════════════════════════════════════════════════ */
// Parse an abstract for methodology signals: study design, sample size,
// key metrics/endpoints, and statistical significance. Returns an array
// of { design, sampleSize, keyMetric, pValue } row objects. Pure regex
// heuristic — no LLM call.
function extractMethodology(abstract) {
  if (!abstract || typeof abstract !== "string") return [];
  const rows = [];
  const text = abstract;

  // Study design detection
  const designPatterns = [
    [/\b(randomized\s+controlled\s+trial|RCT)\b/i, "Randomized Controlled Trial"],
    [/\b(systematic\s+review(?:\s+and\s+meta-analysis)?)\b/i, "Systematic Review"],
    [/\b(meta-analysis)\b/i, "Meta-Analysis"],
    [/\b(cohort\s+study)\b/i, "Cohort Study"],
    [/\b(case-control\s+study)\b/i, "Case-Control Study"],
    [/\b(cross-sectional\s+study)\b/i, "Cross-Sectional Study"],
    [/\b(double-blind(?:ed)?(?:\s+placebo-controlled)?)\b/i, "Double-Blind Trial"],
    [/\b(prospective\s+(?:observational\s+)?study)\b/i, "Prospective Study"],
    [/\b(retrospective\s+(?:analysis|study|review))\b/i, "Retrospective Study"],
    [/\b(in\s+vitro\s+(?:study|experiment|analysis))\b/i, "In Vitro"],
    [/\b(in\s+vivo\s+(?:study|experiment|model))\b/i, "In Vivo"],
    [/\b(case\s+report)\b/i, "Case Report"],
    [/\b(pilot\s+study)\b/i, "Pilot Study"],
    [/\b(narrative\s+review)\b/i, "Narrative Review"],
    [/\b(observational\s+study)\b/i, "Observational Study"],
    [/\b(clinical\s+trial)\b/i, "Clinical Trial"],
  ];
  let design = "Not specified";
  for (const [re, label] of designPatterns) {
    if (re.test(text)) { design = label; break; }
  }

  // Sample size
  const sizePatterns = [
    /\b[Nn]\s*=\s*([\d,]+)/,
    /\b([\d,]+)\s+(?:patients|participants|subjects|individuals|samples|cases|respondents|volunteers|adults|children)\b/i,
    /\bsample\s+(?:size|of)\s+(?:of\s+)?([\d,]+)/i,
    /\b([\d,]+)\s+(?:studies|trials|articles)\s+(?:were\s+)?(?:included|analyzed|reviewed)\b/i,
  ];
  let sampleSize = "—";
  for (const re of sizePatterns) {
    const m = text.match(re);
    if (m) { sampleSize = "n = " + m[1].replace(/,/g, ","); break; }
  }

  // Key metrics / endpoints
  const metricPatterns = [
    /\b(?:primary\s+(?:outcome|endpoint|measure)[s]?:?\s*)(.*?)(?:\.|$)/i,
    /\b(?:measured|assessed|evaluated|examined)\s+(.*?)(?:\.|$)/i,
  ];
  let keyMetric = "—";
  for (const re of metricPatterns) {
    const m = text.match(re);
    if (m && m[1]) {
      keyMetric = m[1].trim().replace(/\s+/g, " ");
      if (keyMetric.length > 80) keyMetric = keyMetric.slice(0, 77) + "…";
      break;
    }
  }

  // P-value / significance
  const pPatterns = [
    /\bp\s*[<>=≤≥]\s*[\d.]+/gi,
    /\bsignificant(?:ly)?\s*\(([^)]+)\)/gi,
    /\bCI\s*[:=]?\s*[\d.]+-[\d.]+/gi,
    /\b95%\s*CI\s*[:,]?\s*[\d.]+\s*[-–]\s*[\d.]+/gi,
  ];
  let pValue = "—";
  for (const re of pPatterns) {
    const m = text.match(re);
    if (m) { pValue = m[0].trim(); break; }
  }

  rows.push({ design, sampleSize, keyMetric, pValue });
  return rows;
}

function PaperDrawer({ P, accent, at, S, source, onAskScoped, close }) {
  const [scopedInput, setScopedInput] = useState("");
  const [scopedAnswer, setScopedAnswer] = useState("");
  const [scopedBusy, setScopedBusy] = useState(false);
  const [drawerTab, setDrawerTab] = useState("overview");
  const isMobile = useIsMobile();
  const drawerRef = useRef(null);

  const methodology = useMemo(() => extractMethodology(source?.abstract), [source?.abstract]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  async function askScoped() {
    const q = scopedInput.trim();
    if (!q || scopedBusy) return;
    setScopedBusy(true);
    setScopedAnswer("");
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: q,
          scopedSource: {
            title: source.title || "",
            authors: source.authors || "",
            journal: source.journal || "",
            abstract: source.abstract || "",
            url: source.url || "",
          },
          settings: { answerLength: "medium", factCheck: false },
        }),
      });
      const data = await res.json().catch(() => ({}));
      setScopedAnswer(data.answer || data.text || "No answer available for this query.");
    } catch {
      setScopedAnswer("Failed to get an answer. Please try again.");
    } finally {
      setScopedBusy(false);
    }
  }

  if (!source) return null;

  const w = isMobile ? "100vw" : "480px";

  return (
    <>
      <div onClick={close} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 50 }} className="cb-backdrop" />
      <div ref={drawerRef} role="dialog" aria-modal="true" aria-label={source.title || "Paper details"} className="cb-modal" style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: w, maxWidth: "100vw",
        background: P.dark ? withAlpha(P.bg, 0.97) : "#ffffff",
        borderLeft: "1px solid " + P.line,
        boxShadow: "-8px 0 32px rgba(0,0,0,0.15)",
        zIndex: 51, display: "flex", flexDirection: "column",
        backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
      }}>
        {/* Header */}
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid " + P.line, flexShrink: 0, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: FONT_SIZES.micro, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: P.faint, fontFamily: "var(--cb-mono)", marginBottom: 6 }}>Deep Read</div>
            <h2 style={{ fontSize: FONT_SIZES.subhead, fontWeight: 600, color: P.ink, margin: 0, lineHeight: 1.4, fontFamily: "var(--cb-display)", letterSpacing: "-0.01em" }}>
              {source.title ? renderCleanTitle(source.title) : ""}
            </h2>
          </div>
          <button onClick={close} aria-label="Close" style={{ background: "none", border: "none", color: P.faint, cursor: "pointer", padding: 4, display: "inline-flex", flexShrink: 0 }}><Icon name="close" size={18} /></button>
        </div>

        {/* Tab bar */}
        <div style={{ display: "flex", gap: 0, borderBottom: "1px solid " + P.line, flexShrink: 0, padding: "0 24px" }}>
          {[["overview", "Overview"], ["methodology", "Methodology"]].map(([key, label]) => (
            <button key={key} onClick={() => setDrawerTab(key)} style={{
              padding: "10px 16px", fontSize: FONT_SIZES.small, fontWeight: 600, fontFamily: "var(--cb-mono)",
              background: "none", border: "none", borderBottom: drawerTab === key ? `2px solid ${accent}` : "2px solid transparent",
              color: drawerTab === key ? P.ink : P.faint, cursor: "pointer", letterSpacing: "0.02em",
              transition: "color 0.15s, border-color 0.15s",
            }}>{label}</button>
          ))}
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", WebkitOverflowScrolling: "touch" }}>
          {drawerTab === "overview" && <>
          {/* Metadata */}
          <div style={{ marginBottom: 20 }}>
            {source.authors && <div style={{ fontSize: FONT_SIZES.small, color: P.ink, fontWeight: 500, marginBottom: 6, lineHeight: 1.5 }}>{source.authors}</div>}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              {source.journal && <span style={{ fontSize: FONT_SIZES.caption, color: P.faint, fontFamily: "var(--cb-mono)" }}>{source.journal}</span>}
              {source.year && <span style={{ fontSize: FONT_SIZES.caption, color: P.faint, fontFamily: "var(--cb-mono)" }}>{source.year}</span>}
              {source.type && <span style={{ fontSize: FONT_SIZES.micro, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: accent, background: withAlpha(accent, 0.1), padding: "2px 6px", borderRadius: 4, fontFamily: "var(--cb-mono)" }}>{source.type}</span>}
              {typeof source.relevance === "number" && <span style={{ fontSize: FONT_SIZES.micro, fontWeight: 600, color: P.faint, fontFamily: "var(--cb-mono)" }}>{source.relevance}%</span>}
            </div>
            {source.url && (
              <a href={safeHref(source.url)} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: FONT_SIZES.small, color: accent, textDecoration: "none", marginTop: 10, fontFamily: "var(--cb-mono)", fontWeight: 500 }}>
                Open full paper <Icon name="arrowRight" size={12} />
              </a>
            )}
          </div>

          {/* Abstract */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: P.faint, fontFamily: "var(--cb-mono)", marginBottom: 10 }}>Abstract</div>
            <div style={{ fontSize: FONT_SIZES.body, color: P.ink, lineHeight: 1.75, fontFamily: "var(--cb-body)" }}>
              {source.abstract || "No abstract available for this paper."}
            </div>
          </div>

          {/* Scoped Q&A */}
          <div style={{ borderTop: "1px solid " + P.line, paddingTop: 20 }}>
            <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: P.faint, fontFamily: "var(--cb-mono)", marginBottom: 10 }}>Ask about this paper</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={scopedInput}
                onChange={(e) => setScopedInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && askScoped()}
                placeholder="e.g. What methodology did they use?"
                style={{ flex: 1, padding: "10px 14px", fontSize: FONT_SIZES.small, border: "1px solid " + P.line, borderRadius: 3, background: "transparent", color: P.ink, fontFamily: "var(--cb-body)", outline: "none" }}
              />
              <button onClick={askScoped} disabled={scopedBusy} style={{
                padding: "10px 16px", fontSize: FONT_SIZES.small, fontWeight: 600,
                background: P.ink, color: P.bg, border: "none", borderRadius: 3,
                cursor: scopedBusy ? "default" : "pointer", opacity: scopedBusy ? 0.6 : 1,
                fontFamily: "var(--cb-body)", flexShrink: 0,
              }}>{scopedBusy ? "Thinking…" : "Ask"}</button>
            </div>
            {scopedAnswer && (
              <div className="cb-fade" style={{ marginTop: 16, padding: "16px 18px", background: P.dark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)", border: "1px solid " + P.line, borderRadius: 3, fontSize: FONT_SIZES.body, color: P.ink, lineHeight: 1.7, fontFamily: "var(--cb-body)" }}>
                {scopedAnswer}
              </div>
            )}
          </div>
          </>}
          {drawerTab === "methodology" && (
            <div>
              <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: P.faint, fontFamily: "var(--cb-mono)", marginBottom: 16 }}>Methodology Matrix</div>
              {methodology.length > 0 && methodology[0].design !== "Not specified" ? (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: FONT_SIZES.small, fontFamily: "var(--cb-body)" }}>
                    <thead>
                      <tr>
                        {["Study Design", "Sample Size", "Key Metrics", "P-Value / Significance"].map((h) => (
                          <th key={h} style={{ padding: "10px 12px", textAlign: "left", borderBottom: "2px solid " + P.line, color: P.ink, fontWeight: 600, fontFamily: "var(--cb-mono)", fontSize: FONT_SIZES.caption, letterSpacing: "0.04em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {methodology.map((row, ri) => (
                        <tr key={ri}>
                          <td style={{ padding: "10px 12px", borderBottom: "1px solid " + P.line, color: accent, fontWeight: 600, whiteSpace: "nowrap" }}>{row.design}</td>
                          <td style={{ padding: "10px 12px", borderBottom: "1px solid " + P.line, color: P.ink, fontFamily: "var(--cb-mono)" }}>{row.sampleSize}</td>
                          <td style={{ padding: "10px 12px", borderBottom: "1px solid " + P.line, color: P.ink, lineHeight: 1.5 }}>{row.keyMetric}</td>
                          <td style={{ padding: "10px 12px", borderBottom: "1px solid " + P.line, color: P.ink, fontFamily: "var(--cb-mono)" }}>{row.pValue}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ fontSize: FONT_SIZES.body, color: P.faint, lineHeight: 1.7, padding: "20px 0", textAlign: "center" }}>
                  {source.abstract
                    ? "No structured methodology detected in this abstract. The methodology parser recognizes study designs, sample sizes, key metrics, and p-values when explicitly stated."
                    : "No abstract available to extract methodology from."}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
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
      <div ref={trapRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} style={{ background: P.bg, borderRadius: 3, maxWidth: 680, width: "100%", boxShadow: "0 24px 80px rgba(0,0,0,0.5)", border: `1px solid ${P.line}`, outline: "none" }} className="cb-modal">
        <div style={{ padding: "18px 22px", borderBottom: `1px solid ${P.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: FONT_SIZES.body, fontWeight: 700, color: P.ink }}>Source network</div>
            <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, marginTop: 2 }}>Node size = relevance. Lines = shared journal, or a link to the strongest match.</div>
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
            <div style={{ fontSize: FONT_SIZES.small, color: P.ink2, lineHeight: 1.5 }}>
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
  return `${cleaned}. Cinematic abstract scientific 3D render, microscopic macro photography, glowing ethereal structures, deep depth of field, high-end octane render. NO TEXT, NO WORDS, NO DIAGRAMS, pure abstract visual art.`;
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
      <div ref={trapRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} style={{ background: P.bg, borderRadius: 3, maxWidth: 640, width: "100%", boxShadow: "0 24px 80px rgba(0,0,0,0.5)", border: `1px solid ${P.line}`, outline: "none", overflow: "hidden" }} className="cb-modal">
        <div style={{ padding: "18px 22px", borderBottom: `1px solid ${P.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: FONT_SIZES.body, fontWeight: 700, color: P.ink }}>Concept illustration</div>
            <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, marginTop: 2 }}>AI-generated visual concept — not a data figure from the cited papers.</div>
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
              <span style={{ fontSize: FONT_SIZES.small, fontFamily: "var(--cb-mono)" }}>Generating illustration…</span>
            </div>
          )}
          {status === "error" && (
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: P.faint, padding: 20, textAlign: "center" }}>
              <Icon name="warning" size={20} />
              <span style={{ fontSize: FONT_SIZES.small }}>Couldn't generate an illustration right now — the image service may be busy. Try again in a moment.</span>
            </div>
          )}
        </div>
        <div style={{ padding: "14px 22px 20px", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, lineHeight: 1.5, maxWidth: 320 }}>
            Generated by an AI image model from your question alone — a conceptual sketch, not a scientific figure. Verify anything visual against the cited sources.
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button onClick={() => setSeed(Math.floor(Math.random() * 1000000))} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", fontSize: FONT_SIZES.small, fontWeight: 600, background: "transparent", color: P.ink2, border: `1px solid ${P.line2}`, borderRadius: 3, cursor: "pointer", fontFamily: "var(--cb-body)" }}><Icon name="refresh" size={13} />Regenerate</button>
            <a href={imgUrl} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", fontSize: FONT_SIZES.small, fontWeight: 600, background: accent, color: at, border: "none", borderRadius: 3, cursor: "pointer", textDecoration: "none", fontFamily: "var(--cb-body)" }}><Icon name="link" size={13} />Open full size</a>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   TRENDING IN SCIENCE — a live, full-page editorial feed, honestly
   labeled as a preview. functions/api/trending.js fetches real, live
   articles (title, summary, real photo, real outlet, real link) from the
   Spaceflight News API — a free, keyless, publicly documented science-
   journalism feed — never an invented headline or an AI-generated stand-in
   image. Deliberately carries no "Fact-Checked" badge: unlike a single
   search answer, nothing here has gone through Cerebrum's fact-check pass,
   and a green shield here would claim a verification step that didn't
   happen. "Preview" is the accurate word for what this is. Used to be a
   centered modal (TrendingModal); now a real full-page view, matched to
   the rest of the App Shell migration.
   ════════════════════════════════════════════════════════════════ */
// Hero treatment for the lead story — a full-bleed image with the
// headline set directly over it, the way science.org's front page and
// Nebula's featured-show rail both lead with one large cinematic card
// before dropping into a grid, rather than just a bigger version of the
// same image-on-top-text-below card every other story uses.
function TrendingHero({ P, accent, item, onExpand }) {
  const [imgStatus, setImgStatus] = useState(item.image_url ? "loading" : "error");
  return (
    <button
      type="button" onClick={() => onExpand(item)}
      style={{
        position: "relative", display: "block", width: "100%", borderRadius: 16, overflow: "hidden",
        aspectRatio: "16/9", background: P.dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
        textDecoration: "none", color: "inherit", border: `1px solid ${P.line}`, padding: 0,
        font: "inherit", cursor: "pointer", textAlign: "left",
      }}
      className="cb-trend-hero"
    >
      {imgStatus !== "error" && (
        <img src={item.image_url} alt="" aria-hidden="true" loading="eager" onLoad={() => setImgStatus("ready")} onError={() => setImgStatus("error")}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: imgStatus === "ready" ? 1 : 0, transition: "opacity 0.5s ease" }} />
      )}
      {imgStatus !== "ready" && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: P.faint, background: P.surface }}>
          <Icon name="image" size={36} style={{ opacity: 0.4 }} />
        </div>
      )}
      {/* Always-on scrim (not opacity-gated to imgStatus) so the headline
          stays legible over the placeholder background too, not just once
          a real photo loads. */}
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "linear-gradient(0deg, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.35) 55%, rgba(0,0,0,0.05) 100%)" }} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "28px 28px 26px", display: "flex", flexDirection: "column", gap: 10 }}>
        {item.source && (
          <span style={{ display: "inline-flex", alignSelf: "flex-start", alignItems: "center", gap: 6, fontSize: FONT_SIZES.micro, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#fff", fontFamily: "var(--cb-mono)" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: accent }} />
            {item.source}
          </span>
        )}
        <div style={{ fontSize: "clamp(22px, 3vw, 34px)", fontWeight: 700, color: "#fff", lineHeight: 1.15, letterSpacing: "-0.02em", fontFamily: "var(--cb-display)", maxWidth: 780, textShadow: "0 2px 20px rgba(0,0,0,0.4)" }}>{item.title}</div>
        <div style={{ fontSize: FONT_SIZES.body, color: "rgba(255,255,255,0.82)", lineHeight: 1.55, maxWidth: 640, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{item.summary}</div>
        <div style={{ fontSize: FONT_SIZES.micro, color: "rgba(255,255,255,0.6)", fontFamily: "var(--cb-mono)", marginTop: 4, display: "flex", alignItems: "center", gap: 8 }}>
          {item.publishedAt ? relativeTime(new Date(item.publishedAt).getTime()) : ""}
          <span style={{ color: "#fff", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>Read the full story <Icon name="arrowRight" size={12} /></span>
        </div>
      </div>
    </button>
  );
}

function TrendingCard({ P, accent, at, item, onExpand }) {
  const [imgStatus, setImgStatus] = useState(item.image_url ? "loading" : "error");
  return (
    <button
      type="button" onClick={() => onExpand(item)}
      style={{
        borderRadius: 14, border: `1px solid ${P.line}`, overflow: "hidden",
        background: P.surface, display: "flex", flexDirection: "column",
        textDecoration: "none", color: "inherit", width: "100%", padding: 0,
        font: "inherit", cursor: "pointer", textAlign: "left",
      }}
      className="cb-trend-card"
    >
      <div style={{ position: "relative", aspectRatio: "16/10", background: P.dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)", flexShrink: 0 }}>
        {imgStatus !== "error" && (
          <img src={item.image_url} alt="" aria-hidden="true" loading="lazy" onLoad={() => setImgStatus("ready")} onError={() => setImgStatus("error")}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", opacity: imgStatus === "ready" ? 1 : 0, transition: "opacity 0.4s ease" }} />
        )}
        {imgStatus !== "ready" && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: P.faint }}>
            <Icon name="image" size={20} style={{ opacity: 0.4 }} />
          </div>
        )}
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 50%, rgba(0,0,0,0.55) 100%)", opacity: imgStatus === "ready" ? 1 : 0 }} />
        {item.source && <span style={{ position: "absolute", top: 10, left: 10, fontSize: FONT_SIZES.micro, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#fff", background: "rgba(0,0,0,0.55)", padding: "3px 8px", borderRadius: 100, fontFamily: "var(--cb-mono)" }}>{item.source}</span>}
      </div>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
        <div style={{ fontSize: FONT_SIZES.subhead, fontWeight: 700, color: P.ink, lineHeight: 1.3, letterSpacing: "-0.01em" }}>{item.title}</div>
        <div style={{ fontSize: FONT_SIZES.small, color: P.ink2, lineHeight: 1.55, flex: 1, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{item.summary}</div>
        <div style={{ fontSize: FONT_SIZES.micro, color: P.faint, fontFamily: "var(--cb-mono)", display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
          {item.publishedAt ? relativeTime(new Date(item.publishedAt).getTime()) : ""}
          <span style={{ color: accent, marginLeft: "auto", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>Expand <Icon name="arrowRight" size={11} /></span>
        </div>
      </div>
    </button>
  );
}

// Client-side dedup safety net — mirrors the normalization functions.
// lib/trendingSource.js runs server-side (see that file), so a cached or
// slightly-stale response, or any future backend change, still can't put
// the same story on screen twice. Dedupes by normalized URL first, falling
// back to normalized title for two different URLs carrying the same
// syndicated story.
function normalizeTrendingUrl(url) {
  return String(url || "").trim().toLowerCase()
    .replace(/^https?:\/\//, "").replace(/^www\./, "")
    .replace(/[?#].*$/, "").replace(/\/+$/, "");
}
function normalizeTrendingTitle(title) {
  return String(title || "").trim().toLowerCase().replace(/\s+/g, " ");
}
function dedupeTrendingItems(items) {
  const seenUrls = new Set();
  const seenTitles = new Set();
  const out = [];
  for (const item of items) {
    const urlKey = normalizeTrendingUrl(item.url);
    const titleKey = normalizeTrendingTitle(item.title);
    if ((urlKey && seenUrls.has(urlKey)) || (titleKey && seenTitles.has(titleKey))) continue;
    if (urlKey) seenUrls.add(urlKey);
    if (titleKey) seenTitles.add(titleKey);
    out.push(item);
  }
  return out;
}

// Article detail — opened by clicking a TrendingHero/TrendingCard instead
// of leaving the app immediately. Same dialog pattern as InstitutionModal/
// InboxModal (backdrop click + Escape both close, focus trapped inside):
// full title, full untruncated summary, source, published date, and the
// actual outbound link to the original article, which lives here now
// instead of on the card itself.
function TrendingArticleModal({ P, accent, at, item, close }) {
  useEffect(() => { const onKey = (e) => { if (e.key === "Escape") close(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [close]);
  const trapRef = useFocusTrap();
  const [imgStatus, setImgStatus] = useState(item.image_url ? "loading" : "error");
  const publishedLabel = item.publishedAt
    ? new Date(item.publishedAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
    : "";
  return (
    <div onClick={close} role="dialog" aria-modal="true" aria-label={item.title || "Article"} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 217, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} className="cb-backdrop">
      <div ref={trapRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} style={{
        background: P.dark ? "rgba(15, 17, 26, 0.96)" : "rgba(255, 255, 255, 0.98)",
        backdropFilter: "blur(40px) saturate(150%)", WebkitBackdropFilter: "blur(40px) saturate(150%)",
        border: P.dark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.08)",
        borderRadius: 16, maxWidth: 640, width: "100%", maxHeight: "88vh", display: "flex", flexDirection: "column",
        boxShadow: "0 24px 80px rgba(0,0,0,0.5)", overflow: "hidden", outline: "none",
      }} className="cb-modal">
        <div style={{ position: "relative", flexShrink: 0 }}>
          {item.image_url && imgStatus !== "error" && (
            <div style={{ position: "relative", aspectRatio: "16/9", background: P.dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)" }}>
              <img src={item.image_url} alt="" aria-hidden="true" onLoad={() => setImgStatus("ready")} onError={() => setImgStatus("error")}
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", opacity: imgStatus === "ready" ? 1 : 0, transition: "opacity 0.4s ease" }} />
              <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "linear-gradient(0deg, rgba(0,0,0,0.55) 0%, transparent 45%)" }} />
            </div>
          )}
          <button onClick={close} aria-label="Close" style={{ position: "absolute", top: 14, right: 14, width: 32, height: 32, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.45)", color: "#fff", border: "none", cursor: "pointer" }}><Icon name="close" size={16} /></button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 26 }}>
          {item.source && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: FONT_SIZES.micro, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: accent, fontFamily: "var(--cb-mono)" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: accent }} />
              {item.source}
            </span>
          )}
          <div style={{ fontSize: FONT_SIZES.display, fontWeight: 700, color: P.ink, lineHeight: 1.25, letterSpacing: "-0.015em", fontFamily: "var(--cb-display)", marginTop: 10 }}>{item.title}</div>
          {publishedLabel && <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, fontFamily: "var(--cb-mono)", marginTop: 8 }}>{publishedLabel}</div>}
          <div style={{ fontSize: FONT_SIZES.body, color: P.ink2, lineHeight: 1.7, marginTop: 18 }}>{item.summary}</div>
          <a href={safeHref(item.url)} target="_blank" rel="noreferrer" style={{
            display: "inline-flex", alignItems: "center", gap: 8, marginTop: 24, padding: "10px 18px",
            fontSize: FONT_SIZES.small, fontWeight: 600, color: at, background: accent, borderRadius: 8,
            textDecoration: "none",
          }}>
            Read the full story{item.source ? ` at ${item.source}` : ""} <Icon name="external" size={14} />
          </a>
        </div>
      </div>
    </div>
  );
}

// Related-video playback — same dialog pattern as TrendingArticleModal
// (backdrop click + Escape both close, focus trapped inside) but hosting a
// real YouTube <iframe> instead of a text summary, so a related video plays
// inline instead of just linking out to youtube.com in a new tab. autoplay
// only fires once the iframe itself is actually mounted inside the open
// dialog, never in the results grid, so nothing plays until someone
// actually asks for it.
function VideoPlayerModal({ P, accent, at, video, close }) {
  useEffect(() => { const onKey = (e) => { if (e.key === "Escape") close(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [close]);
  const trapRef = useFocusTrap();
  const ytId = getYouTubeId(video);
  return (
    <div onClick={close} role="dialog" aria-modal="true" aria-label={video.title || "Video"} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 217, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} className="cb-backdrop">
      <div ref={trapRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} style={{
        background: P.dark ? "rgba(15, 17, 26, 0.96)" : "rgba(255, 255, 255, 0.98)",
        border: P.dark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.08)",
        borderRadius: 16, maxWidth: 860, width: "100%", display: "flex", flexDirection: "column",
        boxShadow: "0 24px 80px rgba(0,0,0,0.5)", overflow: "hidden", outline: "none",
      }} className="cb-modal">
        <div style={{ position: "relative", width: "100%", aspectRatio: "16/9", background: "#000", flexShrink: 0 }}>
          {ytId ? (
            <iframe
              src={`https://www.youtube.com/embed/${ytId}?autoplay=1&rel=0`}
              title={video.title || "Video"}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: P.faint, fontSize: FONT_SIZES.small }}>Couldn't identify this video.</div>
          )}
          <button onClick={close} aria-label="Close" style={{ position: "absolute", top: 14, right: 14, width: 32, height: 32, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", cursor: "pointer" }}><Icon name="close" size={16} /></button>
        </div>
        <div style={{ padding: "18px 22px 22px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: FONT_SIZES.subhead, fontWeight: 700, color: P.ink, lineHeight: 1.35 }}>{video.title}</div>
            {video.author && <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, fontFamily: "var(--cb-mono)", marginTop: 6 }}>{video.author}</div>}
          </div>
          <a href={safeHref(video.url)} target="_blank" rel="noreferrer" style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 6, fontSize: FONT_SIZES.small, fontWeight: 600, color: accent, textDecoration: "none", whiteSpace: "nowrap" }}>
            Watch on YouTube <Icon name="external" size={13} />
          </a>
        </div>
      </div>
    </div>
  );
}

// How often an open Trending tab re-polls its own endpoint. The feed
// itself only actually changes once an hour (trending-refresh.js's own
// job) — this isn't trying to beat that clock, it's just making sure
// someone who leaves the tab open for a while sees the next hourly
// refresh land without having to manually reload.
const TRENDING_POLL_MS = 5 * 60 * 1000;

function TrendingView({ P, accent, at, isMobile }) {
  const [status, setStatus] = useState("loading"); // "loading" | "ready" | "error"
  const [items, setItems] = useState([]);
  const [generatedAt, setGeneratedAt] = useState(0);
  const [expanded, setExpanded] = useState(null);
  // Forces the "Updated Xm ago" line to keep counting up between polls,
  // not just re-render whenever a fetch happens to land.
  const [, forceTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer = null;

    const load = (isBackground) => {
      if (!isBackground) setStatus((s) => (s === "ready" ? s : "loading"));
      fetch("/api/trending")
        .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
        .then(({ ok, data }) => {
          if (cancelled) return;
          if (!ok || !data || !Array.isArray(data.items) || data.items.length === 0) {
            // A background poll that comes back empty shouldn't nuke a
            // feed that's already on screen — only a genuine first-load
            // failure shows the error state.
            if (!isBackground) setStatus("error");
            return;
          }
          setItems(data.items);
          setGeneratedAt(data.generatedAt || Date.now());
          setStatus("ready");
        })
        .catch(() => { if (!cancelled && !isBackground) setStatus("error"); });
    };

    load(false);
    timer = setInterval(() => load(true), TRENDING_POLL_MS);
    const tickTimer = setInterval(() => forceTick((n) => n + 1), 30000);
    return () => { cancelled = true; clearInterval(timer); clearInterval(tickTimer); };
  }, []);

  // Deduped here regardless of what the backend already did (see
  // dedupeTrendingItems above) — a safety net against a stale cache row or
  // a future source change, never a substitute for the server-side dedup.
  const deduped = useMemo(() => dedupeTrendingItems(items), [items]);
  const [hero, ...rest] = deduped;

  return (
    <div style={{ flex: 1, minHeight: 0 }}>
      <div style={{ maxWidth: 1180, width: "100%", margin: "0 auto", padding: isMobile ? "24px 18px 60px" : "44px 32px 90px" }}>
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: FONT_SIZES.hero * 0.7, fontWeight: 700, letterSpacing: "-0.02em", color: P.ink, fontFamily: "var(--cb-display)" }}>Trending in Science</div>
            <span style={{ fontSize: FONT_SIZES.micro, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: accent, background: withAlpha(accent, 0.12), padding: "3px 9px", borderRadius: 100, fontFamily: "var(--cb-mono)" }}>Preview</span>
            {status === "ready" && (
              <span title="Refreshed automatically once an hour" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: FONT_SIZES.micro, fontWeight: 600, color: P.faint, fontFamily: "var(--cb-mono)" }}>
                <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: STATUS.good, flexShrink: 0, animation: "cbHuddlePulse 1.6s ease-in-out infinite" }} />
                Live{generatedAt ? " · updated " + relativeTime(generatedAt) : ""}
              </span>
            )}
          </div>
          <div style={{ fontSize: FONT_SIZES.body, color: P.faint, marginTop: 8, maxWidth: 640, lineHeight: 1.6 }}>
            Real science journalism, refreshed automatically every hour — not editorially curated by Cerebrum, and not run through Cerebrum's fact-check pass the way a single search answer is. Read the source before citing anything here.
          </div>
        </div>
        {status === "loading" && (
          <>
            <div style={{ borderRadius: 16, overflow: "hidden", aspectRatio: "16/9", background: P.skel, backgroundSize: "200% 100%", animation: "cbShimmer 1.8s ease-in-out infinite", marginBottom: 24 }} />
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(280px, 1fr))", gap: 24 }}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} style={{ borderRadius: 14, border: `1px solid ${P.line}`, overflow: "hidden" }}>
                  <div style={{ aspectRatio: "16/10", background: P.skel, backgroundSize: "200% 100%", animation: `cbShimmer 1.8s ease-in-out ${i * 120}ms infinite` }} />
                  <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ height: 14, width: "80%", borderRadius: 3, background: P.skel, backgroundSize: "200% 100%", animation: `cbShimmer 1.8s ease-in-out ${i * 120}ms infinite` }} />
                    <div style={{ height: 10, width: "100%", borderRadius: 3, background: P.skel, backgroundSize: "200% 100%", animation: `cbShimmer 1.8s ease-in-out ${i * 120}ms infinite` }} />
                    <div style={{ height: 10, width: "60%", borderRadius: 3, background: P.skel, backgroundSize: "200% 100%", animation: `cbShimmer 1.8s ease-in-out ${i * 120}ms infinite` }} />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {status === "error" && (
          <div style={{ textAlign: "center", color: P.faint, padding: "60px 16px" }}>
            <Icon name="warning" size={26} style={{ opacity: 0.6 }} />
            <div style={{ fontSize: FONT_SIZES.body, marginTop: 12 }}>Couldn't load the trending feed right now — the source may be busy. Try again in a moment.</div>
          </div>
        )}
        {status === "ready" && (
          <>
            {hero && <div style={{ marginBottom: 24 }}><TrendingHero P={P} accent={accent} item={hero} onExpand={setExpanded} /></div>}
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(280px, 1fr))", gap: 24 }}>
              {rest.map((item, i) => <TrendingCard key={item.url || i} P={P} accent={accent} at={at} item={item} onExpand={setExpanded} />)}
            </div>
          </>
        )}
      </div>
      {expanded && <TrendingArticleModal P={P} accent={accent} at={at} item={expanded} close={() => setExpanded(null)} />}
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
      <div ref={trapRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} style={{ background: P.bg, borderRadius: 3, maxWidth: 700, width: "100%", boxShadow: "0 24px 80px rgba(0,0,0,0.5)", border: `1px solid ${P.line}`, outline: "none" }} className="cb-modal">
        <div style={{ padding: "18px 22px", borderBottom: `1px solid ${P.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: FONT_SIZES.body, fontWeight: 700, color: P.ink }}>Literature timeline</div>
            <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, marginTop: 2 }}>Dot size and color = relevance. Where this literature actually sits in time.</div>
          </div>
          <button onClick={close} aria-label="Close" style={{ background: "none", border: "none", color: P.faint, cursor: "pointer", padding: 4, display: "inline-flex" }}><Icon name="close" size={18} /></button>
        </div>
        {!points.length ? (
          <div style={{ padding: "40px 22px", textAlign: "center", color: P.faint, fontSize: FONT_SIZES.small }}>None of these sources have a usable publication year to plot.</div>
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
                <div style={{ fontSize: FONT_SIZES.small, color: P.ink2, lineHeight: 1.5 }}>
                  <strong style={{ color: P.ink }}>{points[hoverIdx].s.title}</strong>{points[hoverIdx].s.journal ? ` — ${points[hoverIdx].s.journal}` : ""} · {points[hoverIdx].year}{typeof points[hoverIdx].s.relevance === "number" ? ` · ${points[hoverIdx].s.relevance}% relevance` : ""}
                </div>
              ) : (
                <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, display: "flex", gap: 14, flexWrap: "wrap" }}>
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

// Accounts modal — a single 6-digit-code sign-in flow. Talks to /api/auth
// (see functions/api/auth.js). `onAuthed(user)` fires once verify-code
// succeeds; the caller (App) decides what to do with the account's data
// (pull it down, offer to import local data, etc.) — this component only
// handles the two-step credential exchange itself: send-code, verify-code.
// No password is ever collected — proving inbox ownership is the entire
// credential, which is also why there's nothing here for a phishing page to
// usefully imitate beyond the code itself, and that code is single-use and
// dead within 15 minutes even if it leaks.
const OTP_LENGTH = 6;
const OTP_RESEND_COOLDOWN_S = 30;

function AuthModal({ P, accent, at, close, onAuthed }) {
  const [step, setStep] = useState("email"); // "email" | "code"
  const [email, setEmail] = useState("");
  const [digits, setDigits] = useState(Array(OTP_LENGTH).fill(""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const boxRefs = useRef([]);
  useEffect(() => { const onKey = (e) => { if (e.key === "Escape") close(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [close]);
  const trapRef = useFocusTrap();

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  async function requestCode(e) {
    if (e) e.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      await apiAuth("send-code", { email });
      setDigits(Array(OTP_LENGTH).fill(""));
      setStep("code");
      setCooldown(OTP_RESEND_COOLDOWN_S);
      setTimeout(() => boxRefs.current[0]?.focus(), 60);
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function verify(fullCode) {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const data = await apiAuth("verify-code", { email, code: fullCode });
      onAuthed(data.user);
    } catch (err) {
      setError(err.message || "That code didn't work.");
      setDigits(Array(OTP_LENGTH).fill(""));
      setTimeout(() => boxRefs.current[0]?.focus(), 60);
    } finally {
      setBusy(false);
    }
  }

  function setDigitAt(i, val) {
    setDigits((prev) => {
      const next = [...prev];
      next[i] = val;
      const joined = next.join("");
      if (joined.length === OTP_LENGTH && next.every((d) => d !== "")) {
        setTimeout(() => verify(joined), 0);
      }
      return next;
    });
  }

  function onBoxChange(i, e) {
    const raw = e.target.value;
    const clean = raw.replace(/\D/g, "");
    if (!clean) { setDigitAt(i, ""); return; }
    // Typing normally lands one digit; a fast mobile keyboard or autofill
    // can hand this box more than one character at once — treat either the
    // same way paste is handled below rather than dropping the extras.
    if (clean.length > 1) { distributeFromIndex(i, clean); return; }
    setDigitAt(i, clean);
    if (i < OTP_LENGTH - 1) boxRefs.current[i + 1]?.focus();
  }

  function distributeFromIndex(startIdx, str) {
    const chars = str.replace(/\D/g, "").slice(0, OTP_LENGTH - startIdx).split("");
    setDigits((prev) => {
      const next = [...prev];
      chars.forEach((c, j) => { next[startIdx + j] = c; });
      const joined = next.join("");
      if (joined.length === OTP_LENGTH && next.every((d) => d !== "")) {
        setTimeout(() => verify(joined), 0);
      }
      return next;
    });
    const landOn = Math.min(startIdx + chars.length, OTP_LENGTH - 1);
    setTimeout(() => boxRefs.current[landOn]?.focus(), 0);
  }

  function onBoxKeyDown(i, e) {
    if (e.key === "Backspace") {
      if (digits[i]) { setDigitAt(i, ""); return; }
      if (i > 0) { boxRefs.current[i - 1]?.focus(); setDigitAt(i - 1, ""); }
      e.preventDefault();
    } else if (e.key === "ArrowLeft" && i > 0) {
      e.preventDefault(); boxRefs.current[i - 1]?.focus();
    } else if (e.key === "ArrowRight" && i < OTP_LENGTH - 1) {
      e.preventDefault(); boxRefs.current[i + 1]?.focus();
    }
  }

  function onBoxPaste(i, e) {
    const text = (e.clipboardData || window.clipboardData).getData("text");
    if (!/\d/.test(text)) return;
    e.preventDefault();
    distributeFromIndex(0, text);
  }

  const inputStyle = { width: "100%", padding: "11px 13px", fontSize: FONT_SIZES.body, borderRadius: 3, border: `1px solid ${P.line}`, background: P.dark ? "rgba(255,255,255,0.03)" : "#fff", color: P.ink, fontFamily: "var(--cb-body)", marginTop: 6 };
  const boxStyle = { width: 44, height: 52, textAlign: "center", fontSize: 22, fontWeight: 700, borderRadius: 8, border: `1px solid ${P.line}`, background: P.dark ? "rgba(255,255,255,0.03)" : "#fff", color: P.ink, fontFamily: "var(--cb-mono)", outline: "none" };

  return (
    <div onClick={close} role="dialog" aria-modal="true" aria-label="Sign in to Cerebrum" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 215, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} className="cb-backdrop">
      <div ref={trapRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} style={{ background: P.dark ? "rgba(15, 17, 26, 0.9)" : "rgba(255, 255, 255, 0.95)", backdropFilter: "blur(40px) saturate(150%)", WebkitBackdropFilter: "blur(40px) saturate(150%)", borderRadius: 3, maxWidth: 400, width: "100%", boxShadow: "0 24px 80px rgba(0,0,0,0.5)", border: P.dark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.08)", outline: "none" }} className="cb-modal">
        <div style={{ padding: "26px 26px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: FONT_SIZES.heading, fontWeight: 700, letterSpacing: "-0.02em", color: P.ink, fontFamily: "var(--cb-display)" }}>{step === "email" ? "Sign in" : "Enter your code"}</div>
          <button onClick={close} aria-label="Close" style={{ background: "none", border: "none", color: P.faint, cursor: "pointer", padding: 4, display: "inline-flex" }}><Icon name="close" size={18} /></button>
        </div>

        {step === "email" ? (
          <form onSubmit={requestCode} style={{ padding: "18px 26px 26px" }}>
            <label style={{ display: "block", fontSize: FONT_SIZES.small, fontWeight: 600, color: P.ink2 }}>
              Email
              <input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} placeholder="you@example.com" aria-label="Email" />
            </label>
            <div style={{ fontSize: FONT_SIZES.small, color: P.faint, marginTop: 10, lineHeight: 1.5 }}>No password to remember — we'll email you a 6-digit code that signs you in.</div>
            {error && <div role="alert" style={{ marginTop: 14, padding: "9px 12px", borderRadius: 3, background: withAlpha(STATUS.bad, 0.1), color: STATUS.bad, fontSize: FONT_SIZES.small, lineHeight: 1.5 }}>{error}</div>}
            <button type="submit" disabled={busy} style={{ width: "100%", marginTop: 18, padding: "12px", fontSize: FONT_SIZES.body, fontWeight: 600, background: accent, color: at, border: "none", borderRadius: 3, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1, fontFamily: "var(--cb-body)" }}>
              {busy ? "Sending…" : "Send sign-in code"}
            </button>
            <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, marginTop: 14, lineHeight: 1.6 }}>
              Saved articles, collections, and history stay local unless you sign in — see <a href="/privacy" style={{ color: P.faint, borderBottom: `1px dotted ${P.faint}`, textDecoration: "none" }}>Privacy</a> for exactly what that means.
            </div>
          </form>
        ) : (
          <div style={{ padding: "18px 26px 26px" }}>
            <div style={{ fontSize: FONT_SIZES.small, color: P.ink2, lineHeight: 1.6, marginBottom: 18 }}>We sent a 6-digit code to <strong>{email}</strong>. It expires in 15 minutes.</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }} onPaste={(e) => onBoxPaste(0, e)}>
              {digits.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => { boxRefs.current[i] = el; }}
                  type="text"
                  inputMode="numeric"
                  autoComplete={i === 0 ? "one-time-code" : "off"}
                  maxLength={1}
                  value={d}
                  disabled={busy}
                  onChange={(e) => onBoxChange(i, e)}
                  onKeyDown={(e) => onBoxKeyDown(i, e)}
                  onPaste={(e) => onBoxPaste(i, e)}
                  aria-label={`Digit ${i + 1} of ${OTP_LENGTH}`}
                  style={{ ...boxStyle, borderColor: error ? STATUS.bad : P.line }}
                />
              ))}
            </div>
            {error && <div role="alert" style={{ marginTop: 16, padding: "9px 12px", borderRadius: 3, background: withAlpha(STATUS.bad, 0.1), color: STATUS.bad, fontSize: FONT_SIZES.small, lineHeight: 1.5, textAlign: "center" }}>{error}</div>}
            {busy && <div style={{ marginTop: 16, textAlign: "center", fontSize: FONT_SIZES.small, color: P.faint }}>Verifying…</div>}
            <div style={{ marginTop: 20, textAlign: "center", fontSize: FONT_SIZES.small, color: P.faint }}>
              {cooldown > 0 ? (
                <span>Didn't receive it? Resend in {cooldown}s</span>
              ) : (
                <button type="button" onClick={requestCode} disabled={busy} style={{ background: "none", border: "none", color: accent, fontWeight: 600, cursor: busy ? "default" : "pointer", fontFamily: "var(--cb-body)", fontSize: FONT_SIZES.small, padding: 0 }}>Resend code</button>
              )}
            </div>
            <button type="button" onClick={() => { setStep("email"); setError(""); setDigits(Array(OTP_LENGTH).fill("")); }} style={{ width: "100%", marginTop: 16, padding: "9px", fontSize: FONT_SIZES.small, color: P.faint, background: "none", border: "none", cursor: "pointer", fontFamily: "var(--cb-body)" }}>Use a different email</button>
          </div>
        )}
      </div>
    </div>
  );
}

// Loads Jitsi Meet's external API script at most once per session (shared
// across every VideoHuddle mount — closing one huddle and opening another
// reuses the already-loaded script instead of re-fetching it). Not bundled:
// meet.jit.si serves this itself and expects to be loaded fresh from there,
// not vendored, since it's what wires the embed to their own signaling.
let jitsiScriptPromise = null;
function loadJitsiScript() {
  if (typeof window !== "undefined" && window.JitsiMeetExternalAPI) return Promise.resolve();
  if (!jitsiScriptPromise) {
    // Always a fresh <script> element for a fresh attempt (jitsiScriptPromise
    // is only ever null on the very first call, or right after the retry
    // button below explicitly clears it): reusing a script tag left over
    // from a failed attempt would mean listening for "load"/"error" events
    // that already fired once and, having already resolved to failure,
    // never fire again — the retry would just hang forever instead of
    // actually retrying. A stale failed tag (if any) is removed first so it
    // can't linger and confuse a future lookup.
    document.querySelectorAll('script[src="https://meet.jit.si/external_api.js"]').forEach((el) => el.remove());
    jitsiScriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://meet.jit.si/external_api.js";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("script failed to load"));
      document.head.appendChild(s);
    });
  }
  return jitsiScriptPromise;
}

// Genuinely live now — a real embedded call via Jitsi Meet's free public
// server (meet.jit.si), through their external_api.js embed. No signaling
// server, account, or API key of ours involved: the iframe Jitsi's script
// creates talks straight to their infrastructure. `roomSeed` (the thread id)
// is hashed into the room name rather than used raw, so the room isn't just
// our internal id in plain sight, but it's still fully deterministic —
// everyone opening the huddle from the same conversation lands in the same
// room, and no other conversation collides into it. meet.jit.si rooms have
// no access control of their own beyond the room name being unguessable, the
// same trust model as sharing any meet.jit.si/xyz link.
//
// Commit 46: rebuilt as a dedicated full-screen overlay (FaceTime-style)
// instead of an inline panel confined to the Inbox's right pane. Three
// pieces, each a real implementation rather than a decorative shell:
// - Main stage: the same Jitsi iframe as before, now sized off the
//   viewport (`position: fixed`, inset-based) instead of a nested flex
//   column, so it can't collapse to 0 height the way an ancestor flex box
//   theoretically could — the specific "cropped/blacked out" failure mode
//   this round asked to rule out.
// - Self-view PiP: a genuinely separate local camera preview via this
//   component's own `getUserMedia` call — not a restyle of anything
//   inside Jitsi's iframe, which is cross-origin content this app has no
//   DOM/CSS access into. Real cost of that honesty: the browser's camera
//   permission prompt can fire twice (once for this preview, once inside
//   Jitsi's iframe for the actual call).
// - Floating control island: real buttons wired to Jitsi's IFrame API
//   (`executeCommand`), not decorative — mic/camera reflect and drive
//   Jitsi's own mute state via its change events, "switch view" toggles
//   Jitsi's tile/speaker view, and the red button hangs up the Jitsi call
//   and closes this overlay together. Jitsi's own built-in toolbar is
//   hidden (`toolbarButtons: []`) so there's one set of call controls on
//   screen, not two competing for the same space.
function VideoHuddle({ P, accent, at, isMobile, name, roomSeed, onClose }) {
  const containerRef = useRef(null);
  const selfVideoRef = useRef(null);
  const apiRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [retryTick, setRetryTick] = useState(0);
  const [micMuted, setMicMuted] = useState(false);
  const [camMuted, setCamMuted] = useState(false);
  const [tileView, setTileView] = useState(false);
  const [selfPreviewError, setSelfPreviewError] = useState(false);
  const roomName = useMemo(
    () => `cerebrum-huddle-${hashSeed(String(roomSeed != null ? roomSeed : (name || "room"))).toString(36)}`,
    [roomSeed, name]
  );

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    loadJitsiScript().then(() => {
      if (cancelled || !containerRef.current) return;
      // The call screen is always dark chrome regardless of the app's own
      // light/dark palette — same convention FaceTime/Zoom/Meet all use,
      // a call surface doesn't follow the host app's theme.
      const bg = "#0b0b0d";
      const api = new window.JitsiMeetExternalAPI("meet.jit.si", {
        roomName,
        parentNode: containerRef.current,
        width: "100%",
        height: "100%",
        userInfo: name ? { displayName: name } : undefined,
        configOverwrite: {
          prejoinPageEnabled: true,
          disableDeepLinking: true,
          defaultBackground: bg,
          toolbarButtons: [],
        },
        interfaceConfigOverwrite: {
          DEFAULT_BACKGROUND: bg,
          SHOW_JITSI_WATERMARK: false,
          SHOW_WATERMARK_FOR_GUESTS: false,
          MOBILE_APP_PROMO: false,
          HIDE_INVITE_MORE_HEADER: true,
          TOOLBAR_BUTTONS: [],
        },
      });
      apiRef.current = api;
      api.addEventListener("videoConferenceLeft", () => onCloseRef.current && onCloseRef.current());
      api.addEventListener("readyToClose", () => onCloseRef.current && onCloseRef.current());
      api.addEventListener("audioMuteStatusChanged", ({ muted }) => setMicMuted(!!muted));
      api.addEventListener("videoMuteStatusChanged", ({ muted }) => setCamMuted(!!muted));
      Promise.resolve(api.isAudioMuted()).then((m) => setMicMuted(!!m)).catch(() => {});
      Promise.resolve(api.isVideoMuted()).then((m) => setCamMuted(!!m)).catch(() => {});
      setStatus("ready");
    }).catch(() => { if (!cancelled) setStatus("error"); });
    return () => {
      cancelled = true;
      if (apiRef.current) { apiRef.current.dispose(); apiRef.current = null; }
    };
  }, [roomName, name, retryTick]);

  // Self-view PiP: a real, separate local camera preview, independent of
  // whatever Jitsi is doing inside its own iframe — see the block comment
  // above this component for why it can't just borrow Jitsi's own feed.
  useEffect(() => {
    let cancelled = false;
    let stream = null;
    if (navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ video: true, audio: false }).then((s) => {
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        if (selfVideoRef.current) selfVideoRef.current.srcObject = s;
      }).catch(() => { if (!cancelled) setSelfPreviewError(true); });
    } else {
      setSelfPreviewError(true);
    }
    return () => { cancelled = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, []);

  const toggleMic = () => apiRef.current?.executeCommand("toggleAudio");
  const toggleCam = () => apiRef.current?.executeCommand("toggleVideo");
  const toggleView = () => { apiRef.current?.executeCommand("toggleTileView"); setTileView((v) => !v); };
  const endCall = () => { apiRef.current?.executeCommand("hangup"); onClose(); };

  const controlBtn = (active, onClick, iconOn, iconOff, label) => (
    <button key={label} onClick={onClick} aria-label={label} aria-pressed={active} title={label} style={{
      width: 48, height: 48, borderRadius: "50%", border: "none", cursor: "pointer",
      display: "flex", alignItems: "center", justifyContent: "center",
      background: active ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.14)",
      color: active ? "#0b0b0d" : "#fff",
      transition: "background 0.15s ease, color 0.15s ease",
    }}>
      <Icon name={active ? iconOff : iconOn} size={19} />
    </button>
  );

  return (
    <div role="dialog" aria-modal="true" aria-label={`Video huddle with ${name}`} style={{ position: "fixed", inset: 0, zIndex: 300, background: "#0b0b0d" }}>
      {/* Main stage */}
      <div style={{
        position: "absolute", inset: isMobile ? 0 : 16,
        borderRadius: isMobile ? 0 : 20, overflow: "hidden", background: "#000",
      }}>
        <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
        {status !== "ready" && (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 24, textAlign: "center" }}>
            {status === "loading" ? (<>
              <div style={{ width: 32, height: 32, border: "2px solid rgba(255,255,255,0.2)", borderTopColor: accent, borderRadius: "50%", animation: "cbspin 0.8s linear infinite" }} />
              <div style={{ fontSize: FONT_SIZES.small, color: "rgba(255,255,255,0.7)" }}>Connecting call…</div>
            </>) : (<>
              <Icon name="warning" size={22} style={{ color: "rgba(255,255,255,0.6)" }} />
              <div style={{ fontSize: FONT_SIZES.small, fontWeight: 600, color: "#fff" }}>Couldn't reach the video call service.</div>
              <div style={{ fontSize: FONT_SIZES.caption, color: "rgba(255,255,255,0.6)", maxWidth: 280 }}>Check your connection and try again.</div>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => { jitsiScriptPromise = null; setRetryTick((n) => n + 1); }} style={{ padding: "8px 18px", borderRadius: 100, border: "1px solid rgba(255,255,255,0.25)", background: "none", color: "#fff", cursor: "pointer", fontSize: FONT_SIZES.small, fontWeight: 600, fontFamily: "var(--cb-body)" }}>Retry</button>
                <button onClick={onClose} style={{ padding: "8px 18px", borderRadius: 100, border: "none", background: "rgba(255,255,255,0.14)", color: "#fff", cursor: "pointer", fontSize: FONT_SIZES.small, fontWeight: 600, fontFamily: "var(--cb-body)" }}>Back to chat</button>
              </div>
            </>)}
          </div>
        )}
      </div>

      {/* Top bar: who you're calling, reachable even before the call connects */}
      <div style={{ position: "absolute", top: isMobile ? 14 : 28, left: isMobile ? 14 : 28, display: "flex", alignItems: "center", gap: 8, padding: "6px 14px 6px 6px", borderRadius: 100, background: "rgba(0,0,0,0.4)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}>
        <span style={{ width: 26, height: 26, borderRadius: "50%", background: withAlpha(accent, 0.35), color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: FONT_SIZES.micro, fontWeight: 700, fontFamily: "var(--cb-mono)" }}>{(name || "?")[0]?.toUpperCase()}</span>
        <span style={{ fontSize: FONT_SIZES.small, fontWeight: 600, color: "#fff", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
      </div>

      {/* Picture-in-picture self view */}
      {status === "ready" && (
        <div style={{
          position: "absolute", top: isMobile ? 14 : 28, right: isMobile ? 14 : 28, width: isMobile ? 96 : 140, height: isMobile ? 128 : 104,
          borderRadius: 16, overflow: "hidden", background: "#18181c",
          border: "1px solid rgba(255,255,255,0.22)", boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
        }}>
          {!selfPreviewError ? (
            <video ref={selfVideoRef} autoPlay muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)", opacity: camMuted ? 0.12 : 1, transition: "opacity 0.2s ease" }} />
          ) : (
            <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name="cameraOff" size={18} style={{ color: "rgba(255,255,255,0.4)" }} />
            </div>
          )}
        </div>
      )}

      {/* Floating control island */}
      {status === "ready" && (
        <div style={{
          position: "absolute", bottom: isMobile ? 20 : 32, left: "50%", transform: "translateX(-50%)",
          display: "flex", alignItems: "center", gap: 14, padding: 10, borderRadius: 100,
          background: "rgba(28,28,32,0.55)",
          backdropFilter: "blur(24px) saturate(180%)", WebkitBackdropFilter: "blur(24px) saturate(180%)",
          border: "1px solid rgba(255,255,255,0.14)", boxShadow: "0 14px 40px rgba(0,0,0,0.45)",
        }}>
          {controlBtn(micMuted, toggleMic, "mic", "micOff", micMuted ? "Unmute microphone" : "Mute microphone")}
          {controlBtn(camMuted, toggleCam, "camera", "cameraOff", camMuted ? "Turn camera on" : "Turn camera off")}
          {controlBtn(tileView, toggleView, "grid", "grid", "Switch view")}
          <button onClick={endCall} aria-label="End call" title="End call" style={{ width: 54, height: 48, borderRadius: 100, border: "none", cursor: "pointer", background: STATUS.bad, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="phoneOff" size={20} />
          </button>
        </div>
      )}
    </div>
  );
}

// Inbox — get-inbox (functions/api/data.js) supplies the thread list with
// just each thread's most recent message, since that's all a list needs;
// opening a thread fetches its full history from the separate get-thread
// endpoint. Genuinely live now: sending a message is a real INSERT into
// `messages`. What's still honestly missing: there is no "start a new
// conversation" flow anywhere in the app yet — no directory, no "message
// this person" button on a profile — so a brand-new account's inbox is
// correctly empty rather than seeded with anything illustrative, and stays
// that way until a thread-creation path exists somewhere.
//
// Commit 46: promoted from a centered InboxModal to a real full-page view
// (InboxView), the same treatment ProfileView/SettingsView/TrendingView
// already got — see the "inbox" case in App's handleSidebarNavigate and
// the Sidebar NAV entry. No more dialog role, backdrop, focus trap, or
// Escape-to-close: it's a page you navigate to and away from, not a
// transient overlay. Mobile gets a real two-step flow (conversation list,
// then the open thread with a back button) instead of squeezing both
// panes into one narrow column the modal never had to solve for.
function InboxView({ P, accent, at, isMobile, threads, setThreads, initialThreadId, onConsumeInitialThread }) {
  const [activeId, setActiveId] = useState(null);
  const [activeThread, setActiveThread] = useState(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [huddleOpen, setHuddleOpen] = useState(false);
  useEffect(() => { setHuddleOpen(false); }, [activeId]);

  // Refreshed every time this view mounts (navigating here from the
  // Sidebar), in case something arrived since the last visit.
  useEffect(() => {
    apiDataGet("inbox").then((data) => { if (data?.items) setThreads(data.items); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A thread just created by "Message" in Find People / an institution hub
  // arrives here as initialThreadId — seeded once, then immediately
  // reported back as consumed so App can clear it. Without that hand-back,
  // the same stale thread id would win this race again next visit,
  // silently overriding "default to my most recent conversation" below.
  useEffect(() => {
    if (initialThreadId) {
      setActiveId(initialThreadId);
      onConsumeInitialThread && onConsumeInitialThread();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialThreadId]);

  useEffect(() => { if (!activeId && !initialThreadId && threads.length > 0) setActiveId(threads[0].id); }, [threads, activeId, initialThreadId]);

  useEffect(() => {
    setDraft("");
    if (!activeId) { setActiveThread(null); return; }
    let cancelled = false;
    setLoadingThread(true);
    apiDataGet("thread", { thread_id: activeId }).then((data) => {
      if (cancelled) return;
      setActiveThread(data && !data.error ? data : null);
      setLoadingThread(false);
    });
    return () => { cancelled = true; };
  }, [activeId]);

  const sendMessage = async () => {
    const text = draft.trim();
    if (!text || !activeId || sending) return;
    setSending(true);
    setDraft("");
    try {
      const res = await apiDataAction("send-message", { thread_id: activeId, text });
      setActiveThread((t) => (t ? { ...t, messages: [...t.messages, { ...res.message, who: "You" }] } : t));
      setThreads((prev) => prev.map((t) => (t.id === activeId ? { ...t, lastMessage: res.message } : t)));
    } catch (e) {
      setDraft(text);
      toast(e.message || "Couldn't send that message.", { tone: "error" });
    } finally {
      setSending(false);
    }
  };

  const subtitle = activeThread
    ? (activeThread.kind === "group"
      ? `${activeThread.memberCount} member${activeThread.memberCount === 1 ? "" : "s"}`
      : [activeThread.otherEmail, activeThread.otherAffiliation].filter(Boolean).join(" · "))
    : "";

  // Mobile: show one pane at a time (list, or the open thread with a way
  // back) instead of squeezing both into one narrow column.
  const showList = !isMobile || !activeId;
  const showThread = !isMobile || !!activeId;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: isMobile ? "column" : "row" }}>
      {showList && (
        <div style={{ width: isMobile ? "100%" : 300, flexShrink: 0, borderRight: isMobile ? "none" : `1px solid ${P.line}`, display: "flex", flexDirection: "column", height: "100%" }}>
          <div style={{ padding: "22px 22px 14px" }}>
            <div style={{ fontSize: FONT_SIZES.heading, fontWeight: 700, color: P.ink, fontFamily: "var(--cb-display)" }}>Inbox</div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "0 12px 12px" }}>
            {threads.length === 0 && (
              <div style={{ padding: "16px 12px", fontSize: FONT_SIZES.caption, color: P.faint, lineHeight: 1.6 }}>No conversations yet.</div>
            )}
            {threads.map((t) => {
              const initials = (t.name || "?").split(" ").map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
              const preview = t.lastMessage
                ? (t.lastMessage.mine ? "You: " : "") + (t.lastMessage.text || (t.lastMessage.attachmentTitle ? `Attached: ${t.lastMessage.attachmentTitle}` : ""))
                : "No messages yet";
              return (
                <button key={t.id} onClick={() => setActiveId(t.id)} style={{
                  width: "100%", textAlign: "left", padding: "12px 10px", borderRadius: 8, border: "none", cursor: "pointer",
                  background: activeId === t.id ? withAlpha(accent, 0.1) : "transparent",
                  display: "flex", gap: 10, alignItems: "flex-start", fontFamily: "var(--cb-body)",
                }}>
                  <span style={{ width: 34, height: 34, borderRadius: "50%", background: withAlpha(accent, 0.18), color: accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: FONT_SIZES.small, fontWeight: 700, fontFamily: "var(--cb-mono)", flexShrink: 0 }}>{initials}</span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                      <span style={{ fontSize: FONT_SIZES.small, fontWeight: 700, color: P.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.name}</span>
                      <span style={{ fontSize: FONT_SIZES.micro, color: P.faint, flexShrink: 0 }}>{relativeTime(t.lastMessage?.createdAt)}</span>
                    </span>
                    <span style={{ display: "block", fontSize: FONT_SIZES.caption, color: P.faint, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{preview}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {showThread && (
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", height: "100%" }}>
          {activeThread ? (<>
            <div style={{ padding: "18px 24px", borderBottom: `1px solid ${P.line}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                {isMobile && (
                  <button onClick={() => setActiveId(null)} aria-label="Back to conversations" style={{ background: "none", border: "none", color: P.ink2, cursor: "pointer", padding: 4, display: "inline-flex", flexShrink: 0 }}>
                    <Icon name="arrowRight" size={16} style={{ transform: "rotate(180deg)" }} />
                  </button>
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: FONT_SIZES.body, fontWeight: 700, color: P.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activeThread.name}</div>
                  {subtitle && <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, fontFamily: "var(--cb-mono)" }}>{subtitle}</div>}
                </div>
              </div>
              <button onClick={() => setHuddleOpen(true)} aria-label="Start video huddle" title="Video Huddle" style={{ background: withAlpha(accent, 0.1), border: "none", borderRadius: 8, color: accent, cursor: "pointer", padding: "8px 14px", display: "inline-flex", alignItems: "center", gap: 7, fontSize: FONT_SIZES.small, fontWeight: 600, fontFamily: "var(--cb-body)", flexShrink: 0 }}>
                <Icon name="camera" size={16} /> {!isMobile && "Huddle"}
              </button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
              {activeThread.messages.length === 0 && (
                <div style={{ textAlign: "center", color: P.faint, fontSize: FONT_SIZES.small, marginTop: 20 }}>No messages yet — say hello.</div>
              )}
              {activeThread.messages.map((m, i) => (
                <div key={m.id || i} style={{ maxWidth: 460, alignSelf: m.mine ? "flex-end" : "flex-start" }}>
                  {!m.mine && activeThread.kind === "group" && m.who && (
                    <div style={{ fontSize: FONT_SIZES.micro, fontWeight: 700, color: P.faint, marginBottom: 3, marginLeft: 4 }}>{m.who}</div>
                  )}
                  {m.text && (
                    <div style={{
                      padding: "12px 16px", fontSize: FONT_SIZES.small, lineHeight: 1.6,
                      borderRadius: m.mine ? "16px 16px 2px 16px" : "16px 16px 16px 2px",
                      color: m.mine ? at : P.ink,
                      background: m.mine ? accent : (P.dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.04)"),
                      border: m.mine ? "none" : (P.dark ? "1px solid rgba(255,255,255,0.06)" : "1px solid rgba(0,0,0,0.05)"),
                    }}>{m.text}</div>
                  )}
                  {m.attachmentTitle && (
                    <div style={{
                      marginTop: 8, padding: "10px 14px", borderRadius: 8, display: "flex", alignItems: "center", gap: 10,
                      background: withAlpha(accent, 0.06), border: `1px solid ${withAlpha(accent, 0.2)}`,
                    }}>
                      <Icon name="external" size={15} style={{ color: accent, flexShrink: 0 }} />
                      <span style={{ fontSize: FONT_SIZES.small, color: P.ink, fontWeight: 500 }}>Attached: {m.attachmentTitle}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div style={{ padding: "14px 24px 18px", borderTop: `1px solid ${P.line}` }}>
              <div style={{ display: "flex", gap: 10 }}>
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={`Message ${activeThread.name}…`}
                  aria-label="Reply"
                  disabled={sending}
                  style={{ flex: 1, padding: "10px 14px", borderRadius: 100, border: `1px solid ${P.line}`, background: P.dark ? "rgba(255,255,255,0.03)" : "#fff", color: P.ink, fontFamily: "var(--cb-body)", fontSize: FONT_SIZES.small }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); sendMessage(); } }}
                />
                <button onClick={sendMessage} disabled={!draft.trim() || sending} aria-label="Send" style={{ width: 40, height: 40, borderRadius: "50%", background: accent, color: at, border: "none", cursor: draft.trim() && !sending ? "pointer" : "default", opacity: draft.trim() && !sending ? 1 : 0.5, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Icon name="send" size={16} />
                </button>
              </div>
            </div>
          </>) : (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: P.faint, fontSize: FONT_SIZES.small, textAlign: "center", padding: 24 }}>
              {loadingThread ? "Loading…" : threads.length === 0 ? "Nothing here yet." : "Select a conversation"}
            </div>
          )}
        </div>
      )}

      {huddleOpen && activeThread && (
        <VideoHuddle P={P} accent={accent} at={at} isMobile={isMobile} name={activeThread.name} roomSeed={activeId} onClose={() => setHuddleOpen(false)} />
      )}
    </div>
  );
}

// Maps a real `badge_type` value returned by get-profile (functions/api/
// data.js) to how it renders. Only badge types this codebase can actually
// grant belong here — see the badge_type comment in schema.sql for which
// ones that is today ("top_peer_reviewer" and "published_author" have no
// granting mechanism yet, so they're deliberately absent rather than
// showing a badge nobody has actually earned). An unrecognized badge_type
// is skipped, not guessed at, so a future badge type shows nothing instead
// of broken chrome until this map is updated to know about it.
const BADGE_DISPLAY = {
  early_adopter: { label: "Early adopter", icon: "zap", tint: "#b45309" },
};

// Reference list of universities for the affiliation field's filter-as-you-
// type suggestions below — command-palette-style, not a live institution
// directory lookup (there isn't a real one wired up yet). These are real
// institution names (Ivy League, major US state flagships, major private
// research universities, and a solid cross-section of top global schools
// across the UK, continental Europe, Canada, Asia, and Australia/NZ) so the
// dropdown is actually useful rather than a token demo list; the field stays
// free text underneath, so an institution not on this list can still be
// typed and saved. Selecting one just sets the same `profile.affiliation`
// field the plain text input always wrote to, so nothing about persistence
// changes — it's a faster way to fill in the same field.
const UNIVERSITIES = [
  // Ivy League
  "Harvard University", "Yale University", "Princeton University", "Columbia University",
  "University of Pennsylvania", "Cornell University", "Dartmouth College", "Brown University",

  // Major US state flagships / public research universities
  "University of Alabama", "Auburn University", "University of Alabama in Huntsville",
  "University of Alaska Fairbanks", "University of Arizona", "Arizona State University",
  "University of Arkansas", "University of California, Berkeley", "University of California, Los Angeles",
  "University of California, San Diego", "University of California, Davis", "University of California, Irvine",
  "University of California, Santa Barbara", "University of California, Santa Cruz",
  "University of California, Riverside", "University of California, Merced",
  "University of Colorado Boulder", "Colorado State University", "Colorado School of Mines",
  "University of Connecticut", "University of Delaware", "University of Florida", "Florida State University",
  "University of Central Florida", "University of South Florida", "Florida International University",
  "University of Georgia", "Georgia Institute of Technology", "Georgia State University",
  "University of Hawaii at Manoa", "University of Idaho", "University of Illinois Urbana-Champaign",
  "University of Illinois Chicago", "Indiana University Bloomington", "Purdue University",
  "University of Iowa", "Iowa State University", "University of Kansas", "Kansas State University",
  "University of Kentucky", "Louisiana State University", "Louisiana Tech University",
  "University of Maine", "University of Maryland, College Park", "University of Maryland, Baltimore County",
  "University of Massachusetts Amherst", "University of Massachusetts Boston",
  "University of Michigan", "Michigan State University", "Michigan Technological University",
  "University of Minnesota Twin Cities", "University of Mississippi", "Mississippi State University",
  "University of Missouri", "University of Missouri-Kansas City", "Missouri University of Science and Technology",
  "University of Montana", "University of Nebraska-Lincoln", "University of Nebraska Omaha",
  "University of Nevada, Reno", "University of Nevada, Las Vegas", "University of New Hampshire",
  "Rutgers University", "University of New Mexico", "University at Buffalo, SUNY", "Stony Brook University",
  "University at Albany, SUNY", "University of North Carolina at Chapel Hill", "North Carolina State University",
  "University of North Carolina at Charlotte", "University of North Carolina at Greensboro",
  "East Carolina University", "Appalachian State University", "University of North Dakota",
  "Ohio State University", "Ohio University", "Miami University", "Kent State University",
  "Bowling Green State University", "University of Toledo", "University of Akron",
  "University of Oklahoma", "Oklahoma State University", "University of Oregon", "Oregon State University",
  "Pennsylvania State University", "University of Pittsburgh", "Temple University",
  "University of Rhode Island", "University of South Carolina", "Clemson University",
  "University of South Dakota", "University of Tennessee", "University of Memphis",
  "University of Texas at Austin", "Texas A&M University", "Texas Tech University",
  "University of North Texas", "University of Houston", "University of Utah", "Utah State University",
  "University of Vermont", "University of Virginia", "Virginia Tech", "Virginia Commonwealth University",
  "George Mason University", "James Madison University", "Old Dominion University",
  "University of Washington", "Washington State University", "West Virginia University",
  "University of Wisconsin-Madison", "University of Wyoming", "San Diego State University",
  "University of Cincinnati", "Wayne State University",

  // Major private research universities
  "Massachusetts Institute of Technology", "Stanford University", "University of Chicago",
  "Northwestern University", "Duke University", "Johns Hopkins University", "Vanderbilt University",
  "Rice University", "Washington University in St. Louis", "Emory University", "Georgetown University",
  "University of Notre Dame", "Carnegie Mellon University", "University of Southern California",
  "New York University", "Boston University", "Boston College", "Tufts University", "Brandeis University",
  "Case Western Reserve University", "University of Rochester", "Lehigh University", "Northeastern University",
  "Wake Forest University", "Tulane University", "University of Miami", "Southern Methodist University",
  "Baylor University", "Yeshiva University", "Syracuse University", "George Washington University",
  "American University", "Villanova University", "Fordham University", "Drexel University",
  "Pepperdine University", "Santa Clara University", "University of Denver", "University of Tulsa",
  "Texas Christian University", "Rensselaer Polytechnic Institute", "Worcester Polytechnic Institute",
  "Stevens Institute of Technology", "Illinois Institute of Technology", "Rochester Institute of Technology",
  "Clark University", "Brigham Young University", "University of San Diego", "Loyola University Chicago",
  "DePaul University", "Marquette University", "Saint Louis University", "University of Dayton",
  "Creighton University", "Duquesne University", "Seton Hall University", "Quinnipiac University",
  "University of the Pacific", "Chapman University", "Loyola Marymount University",

  // Liberal arts colleges
  "Williams College", "Amherst College", "Swarthmore College", "Pomona College", "Wellesley College",
  "Bowdoin College", "Middlebury College", "Carleton College", "Claremont McKenna College",
  "Davidson College", "Colby College", "Hamilton College", "Vassar College", "Haverford College",
  "Colgate University", "Smith College", "Bryn Mawr College", "Grinnell College", "Oberlin College",
  "Bates College", "Barnard College", "Mount Holyoke College", "Wesleyan University", "Reed College",
  "Scripps College", "Trinity College", "Kenyon College", "Macalester College",

  // Historically Black colleges and universities
  "Howard University", "Spelman College", "Morehouse College", "Hampton University",
  "Tuskegee University", "Xavier University of Louisiana",

  // United Kingdom
  "University of Oxford", "University of Cambridge", "Imperial College London", "University College London",
  "London School of Economics and Political Science", "King's College London", "University of Edinburgh",
  "University of Manchester", "University of Bristol", "University of Warwick", "University of Glasgow",
  "University of Birmingham", "University of Leeds", "University of Sheffield", "University of Nottingham",
  "University of Southampton", "Durham University", "University of St Andrews",
  "Queen Mary University of London", "University of York", "Cardiff University", "University of Exeter",
  "Lancaster University", "University of Bath", "Newcastle University", "Queen's University Belfast",
  "University of Liverpool", "University of Aberdeen",

  // Continental Europe
  "ETH Zurich", "EPFL (École Polytechnique Fédérale de Lausanne)", "University of Zurich",
  "LMU Munich", "Technical University of Munich", "Heidelberg University", "Humboldt University of Berlin",
  "Free University of Berlin", "University of Freiburg", "University of Tübingen", "RWTH Aachen University",
  "KU Leuven", "Ghent University", "University of Amsterdam", "Delft University of Technology",
  "Utrecht University", "Leiden University", "Erasmus University Rotterdam", "Wageningen University",
  "Sorbonne University", "Sciences Po", "École Normale Supérieure", "École Polytechnique",
  "University of Copenhagen", "Technical University of Denmark", "Karolinska Institute",
  "KTH Royal Institute of Technology", "Stockholm University", "Uppsala University", "Lund University",
  "University of Oslo", "University of Helsinki", "Aalto University", "University of Vienna",
  "University of Geneva", "University of Bologna", "Sapienza University of Rome", "Politecnico di Milano",
  "University of Barcelona", "Universidad Autónoma de Madrid", "Universidad Complutense de Madrid",
  "University of Warsaw", "Charles University", "University of Lisbon", "Trinity College Dublin",
  "University College Dublin",

  // Canada
  "University of Toronto", "McGill University", "University of British Columbia", "University of Alberta",
  "University of Waterloo", "McMaster University", "Université de Montréal", "Queen's University",
  "Western University", "University of Calgary", "University of Ottawa", "Simon Fraser University",
  "Dalhousie University", "University of Victoria", "York University", "Concordia University",

  // Asia
  "University of Tokyo", "Kyoto University", "Osaka University", "Tohoku University",
  "Tokyo Institute of Technology", "Nagoya University", "Waseda University", "Keio University",
  "Tsinghua University", "Peking University", "Fudan University", "Shanghai Jiao Tong University",
  "Zhejiang University", "University of Science and Technology of China", "National University of Singapore",
  "Nanyang Technological University", "Seoul National University", "KAIST", "Yonsei University",
  "Korea University", "Hong Kong University of Science and Technology", "University of Hong Kong",
  "Chinese University of Hong Kong", "National Taiwan University", "Indian Institute of Technology Bombay",
  "Indian Institute of Technology Delhi", "Indian Institute of Science", "Indian Institute of Technology Madras",
  "Indian Institute of Technology Kanpur", "University of Delhi", "Tel Aviv University",
  "Hebrew University of Jerusalem", "Technion – Israel Institute of Technology",
  "King Abdullah University of Science and Technology", "King Fahd University of Petroleum and Minerals",

  // Australia and New Zealand
  "University of Melbourne", "University of Sydney", "Australian National University",
  "University of Queensland", "Monash University", "University of New South Wales",
  "University of Western Australia", "University of Adelaide", "University of Auckland",
  "University of Otago", "Victoria University of Wellington",
];

// Standard academic degrees and credentials for the degree field's matching
// filter-as-you-type suggestions (see the affiliation dropdown above for the
// same pattern). Short and finite by nature, unlike the university list, so
// this covers the common associate/bachelor's/master's/doctoral and
// professional credentials rather than trying to be exhaustive.
const DEGREES = [
  "A.A.", "A.S.", "A.A.S.",
  "B.A.", "B.S.", "B.Sc.", "B.Eng.", "B.F.A.", "B.B.A.", "B.Arch.", "B.Mus.", "B.S.N.", "LL.B.",
  "M.A.", "M.S.", "M.Sc.", "M.Eng.", "M.B.A.", "M.F.A.", "M.P.H.", "M.P.A.", "M.P.P.", "M.S.W.",
  "M.Ed.", "LL.M.", "M.Arch.", "M.S.N.", "M.Div.", "M.Phil.",
  "Ph.D.", "Ed.D.", "Psy.D.", "M.D.", "D.O.", "D.D.S.", "D.M.D.", "D.V.M.", "J.D.", "Pharm.D.",
  "D.N.P.", "D.P.T.", "Sc.D.", "Th.D.", "Au.D.",
  "Postdoctoral Fellowship",
];

// The Academic CV — a full page now (ProfileView), not a centered ID-card
// modal. Same real, live data as before (name/username/affiliation/degree/
// grad_year edit in place, avatar upload, real follower count and badges);
// laid out the way LinkedIn or Google Scholar lay out a profile instead of
// how a wallet ID card does — a wide cover banner, a large overlapping
// avatar, and a two-column body once there's real content to put in a
// second column.
function ProfileView({ P, accent, at, isMobile, user, profile, setProfile, profileMeta, history, saved, collections, onOpenHistory, onManageAccount }) {
  const emailLocal = (user?.email || "").split("@")[0] || "";

  // A signed-in account always has a real username by the time this modal
  // can even open (verify-code defaults it to the email's local part at
  // signup — see functions/api/auth.js) — so `profile.username` is only
  // ever empty for the brief window before get-profile's response lands.
  // Falls back to the email-local-part guess for that window rather than a
  // hardcoded person's name, so nobody but the actual account owner is ever
  // shown here even for a flash of a frame.
  const displayName = profile.name || emailLocal;
  const displayUsername = profile.username ? `@${profile.username}` : `@${emailLocal}`;
  const displayInitial = (displayName || "?")[0]?.toUpperCase() || "?";
  const avatarSeed = encodeURIComponent((profile.username || emailLocal || "cerebrum"));
  const [avatarFailed, setAvatarFailed] = useState(false);
  const fileInputRef = useRef(null);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarError, setAvatarError] = useState("");

  // Center-crops whatever aspect ratio was uploaded to a square, then
  // downsamples it onto a fixed 256x256 canvas and re-encodes as JPEG —
  // a phone photo comes in at several MB; this keeps what actually gets
  // stored and sent over the wire down to tens of KB. Defined inside the
  // component (rather than at module scope, where a stateless helper like
  // this would normally live) since it's only ever used here and closes
  // over nothing — kept local on purpose so this modal's avatar pipeline
  // reads top to bottom in one place.
  async function compressAvatarFile(file) {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Couldn't read that file."));
      reader.readAsDataURL(file);
    });
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("That doesn't look like a valid image."));
      el.src = dataUrl;
    });
    const side = Math.min(img.width, img.height);
    const sx = (img.width - side) / 2;
    const sy = (img.height - side) / 2;
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, sx, sy, side, side, 0, 0, 256, 256);
    return canvas.toDataURL("image/jpeg", 0.85);
  }

  async function handleAvatarFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = ""; // lets the same file be re-picked later
    if (!file) return;
    if (!file.type.startsWith("image/")) { setAvatarError("Please choose an image file."); return; }
    if (file.size > 8 * 1024 * 1024) { setAvatarError("That photo is too large — try one under 8MB."); return; }
    setAvatarError("");
    setAvatarSaving(true);
    try {
      const base64 = await compressAvatarFile(file);
      setAvatarFailed(false);
      setProfile((p) => ({ ...p, avatar_base64: base64 }));
      // Saved immediately rather than folded into the 900ms-debounced
      // name/username/affiliation sync further down in App — a photo you
      // just picked shouldn't be one closed tab away from being lost.
      await apiDataAction("update-profile", { avatar_base64: base64 });
    } catch (err) {
      setAvatarError(err.message || "Couldn't update your photo.");
    } finally {
      setAvatarSaving(false);
    }
  }
  const followers = profileMeta?.followers || 0;
  const badges = [
    { label: "Verified sign-in", icon: "check", real: true },
    ...(profileMeta?.badges || []).map((bt) => BADGE_DISPLAY[bt]).filter(Boolean),
  ];

  // Affiliation command-palette: filters UNIVERSITIES against whatever is
  // currently typed, live, on every keystroke. Capped to a handful of
  // results — with 350+ real institutions in the list, an empty query would
  // otherwise render the entire list into the dropdown.
  const [affiliationOpen, setAffiliationOpen] = useState(false);
  const affiliationQuery = (profile.affiliation || "").trim().toLowerCase();
  const affiliationMatches = UNIVERSITIES.filter(
    (u) => u.toLowerCase().includes(affiliationQuery) && u.toLowerCase() !== affiliationQuery
  ).slice(0, 8);

  // Degree command-palette: same filter-as-you-type pattern as affiliation
  // above, matched against the DEGREES reference list.
  const [degreeOpen, setDegreeOpen] = useState(false);
  const degreeQuery = (profile.degree || "").trim().toLowerCase();
  const degreeMatches = DEGREES.filter(
    (d) => d.toLowerCase().includes(degreeQuery) && d.toLowerCase() !== degreeQuery
  ).slice(0, 8);

  const inputStyle = { width: "100%", padding: "9px 12px", fontSize: FONT_SIZES.small, borderRadius: 8, border: `1px solid ${P.line}`, background: P.dark ? "rgba(255,255,255,0.03)" : "#fff", color: P.ink, fontFamily: "var(--cb-body)" };
  // Raised (not surface) on purpose: the whole profile body now sits inside
  // its own P.surface panel (see the return below), so these stat cards use
  // the next elevation step up to still read as distinct, layered blocks
  // rather than disappearing flush into the panel behind them.
  const cardStyle = { background: P.raised, border: `1px solid ${P.line}`, borderRadius: 14, padding: 18 };
  const cardLabel = { fontSize: FONT_SIZES.caption, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: P.faint, fontFamily: "var(--cb-mono)", marginBottom: 14 };
  const recentHistory = (history || []).slice(0, 6);
  const collectionCounts = (collections || []).map((c) => ({ ...c, count: (saved || []).filter((s) => s.collectionId === c.id).length }));

  return (
    <div role="region" aria-label="Your profile" style={{ flex: 1, minHeight: 0 }}>
      {/* Cover banner — a wide textured header block instead of the old
          ID-card's flat accent stripe, per the LinkedIn/Scholar-style
          layout this page is modeled on. No stock photo is faked in here:
          it's the same accent-tinted gradient wash the rest of the app
          already uses for depth, just at full page width. */}
      <div aria-hidden="true" style={{
        height: isMobile ? 130 : 200, width: "100%",
        background: `linear-gradient(135deg, ${withAlpha(accent, 0.5)} 0%, ${P.raised} 60%, ${P.surface} 100%)`,
        position: "relative", overflow: "hidden",
      }}>
        <div style={{ position: "absolute", inset: 0, opacity: 0.6, backgroundImage: `radial-gradient(circle at 15% 25%, ${withAlpha(accent, 0.45)}, transparent 45%), radial-gradient(circle at 85% 75%, ${withAlpha(accent, 0.3)}, transparent 42%)` }} />
        {/* Fades the banner's bottom edge into the panel's own P.surface so
            the two read as one continuous piece instead of a hard seam. */}
        <div style={{ position: "absolute", inset: 0, boxShadow: `inset 0 -46px 40px -20px ${withAlpha(P.surface, 0.95)}` }} />
      </div>

      <div style={{ maxWidth: 980, width: "100%", margin: "0 auto", padding: isMobile ? "0 14px 60px" : "0 24px 80px" }}>
        {/* Profile panel — a single elevated surface the cover banner tucks
            behind, so identity, affiliation, and the stat cards below read
            as one cohesive card instead of loose fields floating on bare
            page background (the previous "soulless" complaint). */}
        <div style={{
          position: "relative", background: P.surface, border: `1px solid ${P.line}`,
          borderRadius: isMobile ? 16 : 20,
          boxShadow: P.dark ? "0 24px 64px rgba(0,0,0,0.35)" : (P.shadow || "0 12px 40px rgba(41,38,31,0.08)"),
          padding: isMobile ? "0 18px 26px" : "0 28px 34px",
        }}>
        {/* Roster info: overlapping avatar + identity + institution crest */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 20, marginTop: isMobile ? -46 : -64, marginBottom: 24 }}>
          <div style={{ position: "relative", width: isMobile ? 92 : 120, height: isMobile ? 92 : 120, flexShrink: 0 }}>
            {avatarFailed && !profile.avatar_base64 ? (
              <div style={{
                width: "100%", height: "100%", borderRadius: "50%",
                background: withAlpha(accent, 0.18), color: accent, display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 38, fontWeight: 700, fontFamily: "var(--cb-mono)", border: `4px solid ${P.surface}`,
                boxShadow: `0 0 0 3px ${withAlpha(accent, 0.4)}, 0 10px 26px rgba(0,0,0,0.28)`,
              }}>{displayInitial}</div>
            ) : (
              // Dicebear's own default background for the "shapes" style is
              // an arbitrary hue picked per seed — against this app's warm-
              // stone palette that reads as a random clash rather than a
              // deliberate choice, so the background is pinned to the
              // current accent instead. The ring below (accent-tinted, not
              // Dicebear's) is what actually integrates the generated
              // artwork into the page rather than leaving it looking pasted
              // on top of the cover banner.
              <img
                src={profile.avatar_base64 || `https://api.dicebear.com/7.x/shapes/svg?seed=${avatarSeed}&backgroundColor=${accent.replace("#", "")}`}
                alt={`${displayName}'s avatar`}
                onError={() => setAvatarFailed(true)}
                style={{
                  width: "100%", height: "100%", borderRadius: "50%", display: "block", border: `4px solid ${P.surface}`,
                  objectFit: "cover", background: P.surface,
                  boxShadow: `0 0 0 3px ${withAlpha(accent, 0.4)}, 0 10px 26px rgba(0,0,0,0.28)`,
                }}
              />
            )}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={avatarSaving}
              aria-label="Change photo"
              title="Change photo"
              style={{
                position: "absolute", bottom: 2, right: 2, width: 32, height: 32, borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center", cursor: avatarSaving ? "default" : "pointer",
                background: accent, color: at, border: `2px solid ${P.surface}`,
                opacity: avatarSaving ? 0.6 : 1,
                boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
              }}
            >
              {avatarSaving ? <Icon name="refresh" size={14} className="cb-spin" /> : <Icon name="camera" size={14} />}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarFile} style={{ display: "none" }} aria-hidden="true" tabIndex={-1} />
          </div>

          <div style={{ flex: 1, minWidth: 220, paddingBottom: 4 }}>
            <input
              value={profile.name || ""}
              onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))}
              placeholder={displayName}
              aria-label="Your name"
              style={{ display: "block", width: "100%", background: "transparent", border: "none", padding: 0, fontSize: isMobile ? FONT_SIZES.heading : FONT_SIZES.display, fontWeight: 700, color: P.ink, fontFamily: "var(--cb-display)", letterSpacing: "-0.01em" }}
            />
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 6, fontSize: FONT_SIZES.small, color: P.ink2, fontFamily: "var(--cb-mono)" }}>
              <span>{displayUsername}</span>
              <span style={{ opacity: 0.4 }}>·</span>
              <span>{user?.email}</span>
              <span style={{ opacity: 0.4 }}>·</span>
              <span>{followers} {followers === 1 ? "follower" : "followers"}</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
              <div style={{ position: "relative", flex: "1 1 200px" }}>
                <input
                  value={profile.degree || ""}
                  onChange={(e) => setProfile((p) => ({ ...p, degree: e.target.value }))}
                  onFocus={() => setDegreeOpen(true)}
                  onBlur={() => setDegreeOpen(false)}
                  placeholder="Degree, e.g. Ph.D. Microbiology"
                  aria-label="Degree"
                  autoComplete="off"
                  style={{ ...inputStyle, width: "100%", fontFamily: "var(--cb-mono)", fontSize: FONT_SIZES.caption }}
                />
                {degreeOpen && degreeMatches.length > 0 && (
                  <div style={{
                    position: "absolute", left: 0, width: "100%", top: "calc(100% + 4px)", zIndex: 5, textAlign: "left",
                    background: P.dark ? "rgba(20,22,32,0.98)" : "#fff", border: `1px solid ${P.line}`, borderRadius: 8,
                    overflow: "hidden", boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
                  }}>
                    {degreeMatches.map((d) => (
                      <div
                        key={d}
                        onMouseDown={(e) => { e.preventDefault(); setProfile((p) => ({ ...p, degree: d })); setDegreeOpen(false); }}
                        style={{ padding: "9px 13px", fontSize: FONT_SIZES.small, color: P.ink, cursor: "pointer" }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = withAlpha(accent, 0.08); }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                      >{d}</div>
                    ))}
                  </div>
                )}
              </div>
              <input
                value={profile.grad_year || ""}
                onChange={(e) => setProfile((p) => ({ ...p, grad_year: e.target.value }))}
                placeholder="Grad. year"
                aria-label="Graduating year"
                style={{ ...inputStyle, width: 100, flex: "0 0 100px", fontFamily: "var(--cb-mono)", fontSize: FONT_SIZES.caption }}
              />
            </div>
          </div>

          {/* Institution crest — an initials badge generated from the
              affiliation text itself (no real logo database exists or is
              being invented here), so it only ever appears once an
              affiliation is actually set. */}
          {profile.affiliation && profile.affiliation.trim() && (
            <img
              src={`https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(profile.affiliation.trim())}&backgroundColor=${accent.replace("#", "")}`}
              alt={`${profile.affiliation} logo`}
              title={profile.affiliation}
              style={{ width: 64, height: 64, borderRadius: 12, border: `1px solid ${withAlpha(accent, 0.3)}`, boxShadow: "0 6px 16px rgba(0,0,0,0.2)", flexShrink: 0 }}
            />
          )}
        </div>

        {avatarError && <div role="alert" style={{ fontSize: FONT_SIZES.caption, color: "#e05555", marginBottom: 16 }}>{avatarError}</div>}

        <div style={{ position: "relative", marginBottom: 24 }}>
          <input
            value={profile.affiliation || ""}
            onChange={(e) => setProfile((p) => ({ ...p, affiliation: e.target.value }))}
            onFocus={() => setAffiliationOpen(true)}
            onBlur={() => setAffiliationOpen(false)}
            placeholder="Affiliation, e.g. University of Tennessee"
            aria-label="Affiliation"
            autoComplete="off"
            style={{ ...inputStyle, maxWidth: 420 }}
          />
          {affiliationOpen && affiliationMatches.length > 0 && (
            <div style={{
              position: "absolute", left: 0, width: "100%", maxWidth: 420, top: "calc(100% + 4px)", zIndex: 5, textAlign: "left",
              background: P.dark ? "rgba(20,22,32,0.98)" : "#fff", border: `1px solid ${P.line}`, borderRadius: 8,
              overflow: "hidden", boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
            }}>
              {affiliationMatches.map((u) => (
                <div
                  key={u}
                  onMouseDown={(e) => { e.preventDefault(); setProfile((p) => ({ ...p, affiliation: u })); setAffiliationOpen(false); }}
                  style={{ padding: "9px 13px", fontSize: FONT_SIZES.small, color: P.ink, cursor: "pointer" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = withAlpha(accent, 0.08); }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >{u}</div>
              ))}
            </div>
          )}
        </div>

        {/* Two-column body: Accolades/Affiliations on the left, Recent
            Investigations/Saved Collections — real data, not placeholder
            copy — on the right. */}
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0,1fr) minmax(0,1.4fr)", gap: 16, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={cardStyle}>
              <div style={cardLabel}>Accolades</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {badges.map((b) => (
                  <span key={b.label} style={{
                    display: "inline-flex", alignItems: "center", gap: 6, fontSize: FONT_SIZES.caption, fontWeight: 600,
                    padding: "6px 12px", borderRadius: 100,
                    color: b.real ? accent : (b.tint || P.ink2),
                    background: b.real ? withAlpha(accent, 0.1) : (P.dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)"),
                    border: b.real ? `1px solid ${withAlpha(accent, 0.3)}` : `1px solid ${P.line}`,
                  }}>
                    <Icon name={b.icon} size={13} style={b.tint ? { filter: `drop-shadow(0 0 3px ${withAlpha(b.tint, 0.7)})` } : undefined} />
                    {b.label}
                  </span>
                ))}
              </div>
            </div>
            <div style={cardStyle}>
              <div style={cardLabel}>Affiliations</div>
              {profile.affiliation && profile.affiliation.trim() ? (
                <div style={{ fontSize: FONT_SIZES.small, color: P.ink, fontWeight: 500 }}>{profile.affiliation}</div>
              ) : (
                <div style={{ fontSize: FONT_SIZES.small, color: P.faint, lineHeight: 1.5 }}>No affiliation set yet — add one above. Cerebrum only tracks one affiliation per profile right now, not a full institutional history.</div>
              )}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={cardStyle}>
              <div style={cardLabel}>Recent Investigations</div>
              {recentHistory.length === 0 ? (
                <div style={{ fontSize: FONT_SIZES.small, color: P.faint, lineHeight: 1.5 }}>Nothing here yet — questions you ask get saved to History and show up here.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {recentHistory.map((h, i) => (
                    <button key={h.id} onClick={() => onOpenHistory(h)} style={{
                      textAlign: "left", background: "transparent", border: "none", cursor: "pointer",
                      padding: "10px 0", borderTop: i > 0 ? `1px solid ${P.line}` : "none",
                    }}>
                      <div style={{ fontSize: FONT_SIZES.small, fontWeight: 600, color: P.ink, lineHeight: 1.4 }}>{h.title}</div>
                      <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, marginTop: 3 }}>{(h.turns || []).length} exchange{(h.turns || []).length === 1 ? "" : "s"} · {new Date(h.ts).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div style={cardStyle}>
              <div style={cardLabel}>Saved Collections</div>
              {collectionCounts.length === 0 ? (
                <div style={{ fontSize: FONT_SIZES.small, color: P.faint, lineHeight: 1.5 }}>No collections yet — create one from any saved article to start organizing your library.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {collectionCounts.map((c, i) => (
                    <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderTop: i > 0 ? `1px solid ${P.line}` : "none" }}>
                      <span style={{ fontSize: FONT_SIZES.small, fontWeight: 500, color: P.ink, display: "inline-flex", alignItems: "center", gap: 8 }}><Icon name="folder" size={14} style={{ color: P.faint }} />{c.name}</span>
                      <span style={{ fontSize: FONT_SIZES.caption, color: P.faint, fontFamily: "var(--cb-mono)" }}>{c.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        </div>
        {/* /Profile panel */}

        <button onClick={onManageAccount} style={{ marginTop: 20, padding: "10px 18px", fontSize: FONT_SIZES.small, fontWeight: 600, color: P.ink2, background: P.surface, border: `1px solid ${P.line}`, borderRadius: 8, cursor: "pointer", fontFamily: "var(--cb-body)" }}>Manage account &amp; security</button>
      </div>
    </div>
  );
}

// A directory of other Cerebrum users to find and message doesn't exist yet
// — there's no server endpoint backing a real cross-account people search,
// just the mock roster below. Rather than wire "Follow"/"Message" up to
// calls that would either 500 against a fake id or silently do nothing,
// this stays explicitly labeled as a preview: Follow toggles local-only
// state that resets next time the modal opens, and Message is honest about
// not being a real conversation before it hands off to the (real) Inbox.
function NetworkSearchModal({ P, accent, at, close, onMessage, onOpenHub }) {
  useEffect(() => { const onKey = (e) => { if (e.key === "Escape") close(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [close]);
  const trapRef = useFocusTrap();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [hubs, setHubs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [followBusy, setFollowBusy] = useState(() => new Set());
  const [messageBusy, setMessageBusy] = useState(() => new Set());
  const searchTimer = useRef(null);

  // Real accounts, searched live via functions/api/data.js's search-users —
  // this used to be a hardcoded 4-name MOCK_RESEARCHERS array labeled
  // "Preview — sample results". Debounced the same 300ms most other
  // as-you-type lookups in this file use; the 2-character floor mirrors the
  // one the backend itself enforces, so a single keystroke never fires a
  // request that would just come back empty anyway. `hubs` rides along in
  // the same response — a Hub is just a distinct affiliation string at
  // least one real account has set (see the backend comment on this
  // endpoint), never an invented institution roster.
  useEffect(() => {
    clearTimeout(searchTimer.current);
    const q = query.trim();
    if (q.length < 2) { setLoading(false); setResults([]); setHubs([]); return; }
    setLoading(true);
    searchTimer.current = setTimeout(async () => {
      const data = await apiDataGet("search-users", { q });
      setLoading(false);
      setResults(data && Array.isArray(data.items) ? data.items : []);
      setHubs(data && Array.isArray(data.hubs) ? data.hubs : []);
    }, 300);
    return () => clearTimeout(searchTimer.current);
  }, [query]);

  const toggleFollow = async (r) => {
    if (followBusy.has(r.id)) return;
    setFollowBusy((prev) => new Set(prev).add(r.id));
    try {
      const res = await apiDataAction("toggle-follow", { target_id: r.id });
      setResults((prev) => prev.map((x) => (x.id === r.id ? { ...x, following: res.following, followers: res.followers } : x)));
    } catch (e) {
      toast(e.message || "Couldn't update that follow.", { tone: "error" });
    } finally {
      setFollowBusy((prev) => { const next = new Set(prev); next.delete(r.id); return next; });
    }
  };

  // Find-or-create a real DM thread (start-thread in functions/api/data.js)
  // before ever touching the Inbox — no more "isn't a real account yet"
  // disclosure toast, because now it is one.
  const messageResearcher = async (r) => {
    if (messageBusy.has(r.id)) return;
    setMessageBusy((prev) => new Set(prev).add(r.id));
    try {
      const res = await apiDataAction("start-thread", { target_id: r.id });
      onMessage(r, res.thread_id);
    } catch (e) {
      toast(e.message || "Couldn't start that conversation.", { tone: "error" });
      setMessageBusy((prev) => { const next = new Set(prev); next.delete(r.id); return next; });
    }
    // No `finally` clearing messageBusy on success — onMessage closes this
    // modal immediately after, so there's nothing left to un-disable.
  };

  const trimmed = query.trim();
  return (
    <div onClick={close} role="dialog" aria-modal="true" aria-label="Find researchers" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 214, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} className="cb-backdrop">
      <div ref={trapRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} style={{
        background: P.dark ? "rgba(15, 17, 26, 0.9)" : "rgba(255, 255, 255, 0.95)",
        backdropFilter: "blur(40px) saturate(150%)", WebkitBackdropFilter: "blur(40px) saturate(150%)",
        border: P.dark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.08)",
        borderRadius: 14, maxWidth: 480, width: "100%", maxHeight: "80vh", display: "flex", flexDirection: "column",
        boxShadow: "0 24px 80px rgba(0,0,0,0.5)", overflow: "hidden", outline: "none",
      }} className="cb-modal">
        <div style={{ padding: "18px 20px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: P.dark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.08)" }}>
          <div>
            <div style={{ fontSize: FONT_SIZES.body, fontWeight: 700, color: P.ink }}>Find people</div>
            <div style={{ fontSize: FONT_SIZES.micro, color: P.faint, marginTop: 2, fontFamily: "var(--cb-mono)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Search Cerebrum researchers</div>
          </div>
          <button onClick={close} aria-label="Close" style={{ background: "none", border: "none", color: P.faint, cursor: "pointer", padding: 4, display: "inline-flex" }}><Icon name="close" size={18} /></button>
        </div>

        <div style={{ padding: "14px 20px 0" }}>
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: P.faint, display: "inline-flex" }}><Icon name="search" size={15} /></span>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, username, or institution"
              aria-label="Search researchers"
              style={{ width: "100%", padding: "10px 13px 10px 34px", fontSize: FONT_SIZES.small, borderRadius: 8, border: `1px solid ${P.line}`, background: P.dark ? "rgba(255,255,255,0.03)" : "#fff", color: P.ink, fontFamily: "var(--cb-body)" }}
            />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "12px 12px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
          {trimmed.length < 2 && (
            <div style={{ padding: "24px 12px", textAlign: "center", fontSize: FONT_SIZES.caption, color: P.faint }}>Search by name, username, or institution to find people and hubs on Cerebrum.</div>
          )}
          {trimmed.length >= 2 && loading && results.length === 0 && hubs.length === 0 && (
            <div style={{ padding: "24px 12px", textAlign: "center", fontSize: FONT_SIZES.caption, color: P.faint }}>Searching…</div>
          )}
          {trimmed.length >= 2 && !loading && results.length === 0 && hubs.length === 0 && (
            <div style={{ padding: "24px 12px", textAlign: "center", fontSize: FONT_SIZES.caption, color: P.faint }}>Nothing matches that search.</div>
          )}
          {hubs.length > 0 && (
            <div style={{ marginBottom: 4 }}>
              <div style={{ fontSize: FONT_SIZES.micro, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: P.faint, fontFamily: "var(--cb-mono)", padding: "4px 8px" }}>Institutions</div>
              {hubs.map((h) => (
                <div
                  key={h.name}
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenHub(h.name)}
                  onKeyDown={(e) => { if (e.key === "Enter") onOpenHub(h.name); }}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 8px", borderRadius: 10, cursor: "pointer" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = P.dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <img
                    src={`https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(h.name)}&backgroundColor=${accent.replace("#", "")}`}
                    alt="" aria-hidden="true" loading="lazy"
                    style={{ width: 40, height: 40, borderRadius: 8, flexShrink: 0, border: `1px solid ${P.line}` }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: FONT_SIZES.small, fontWeight: 700, color: P.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.name}</div>
                    <div style={{ fontSize: FONT_SIZES.caption, color: P.faint }}>{h.researcherCount} researcher{h.researcherCount === 1 ? "" : "s"} on Cerebrum</div>
                  </div>
                  <Icon name="arrowRight" size={14} style={{ color: P.faint, flexShrink: 0 }} />
                </div>
              ))}
              {results.length > 0 && (
                <div style={{ fontSize: FONT_SIZES.micro, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: P.faint, fontFamily: "var(--cb-mono)", padding: "10px 8px 4px" }}>People</div>
              )}
            </div>
          )}
          {results.map((r) => {
            const isFollowing = !!r.following;
            const isFollowBusy = followBusy.has(r.id);
            const isMessageBusy = messageBusy.has(r.id);
            const subtitle = [r.affiliation, r.followers ? `${r.followers} follower${r.followers === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ");
            return (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 8px", borderRadius: 10 }}>
                <img
                  src={`https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(r.username || r.id)}&backgroundColor=0a0a0a`}
                  alt=""
                  aria-hidden="true"
                  loading="lazy"
                  style={{ width: 40, height: 40, borderRadius: "50%", flexShrink: 0, border: `1px solid ${P.line}`, objectFit: "cover" }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: FONT_SIZES.small, fontWeight: 700, color: P.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
                  {subtitle && <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{subtitle}</div>}
                </div>
                <button
                  onClick={() => toggleFollow(r)}
                  disabled={isFollowBusy}
                  style={{
                    fontSize: FONT_SIZES.caption, fontWeight: 600, padding: "6px 12px", borderRadius: 100, cursor: isFollowBusy ? "default" : "pointer", flexShrink: 0,
                    opacity: isFollowBusy ? 0.6 : 1,
                    color: isFollowing ? P.ink2 : accent,
                    background: isFollowing ? (P.dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)") : withAlpha(accent, 0.1),
                    border: isFollowing ? `1px solid ${P.line}` : `1px solid ${withAlpha(accent, 0.3)}`,
                  }}
                >{isFollowing ? "Following" : "Follow"}</button>
                <button
                  onClick={() => messageResearcher(r)}
                  disabled={isMessageBusy}
                  aria-label={`Message ${r.name}`}
                  title={`Message ${r.name}`}
                  style={{ width: 32, height: 32, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: "none", border: `1px solid ${P.line}`, color: P.ink2, cursor: isMessageBusy ? "default" : "pointer", opacity: isMessageBusy ? 0.6 : 1 }}
                ><Icon name="mail" size={14} /></button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   INSTITUTION HUB — a University/Lab's page on Cerebrum. Not backed by a
   separate "institutions" table: a Hub IS the set of real accounts sharing
   one affiliation string (see the `hub` resource in functions/api/data.js).
   That means Top Researchers is always real, but Departments and Recent
   Papers — which would need data this schema doesn't track (no department
   field on a user, no link between a researcher and "papers they authored
   that Cerebrum has indexed") — show an honest empty state instead of
   invented rosters. Filling those in for real is a bigger addition
   (department taxonomy, and joining a researcher's name against gatherPapers'
   own author-search path) than this pass covers.
   ============================================================ */
function InstitutionModal({ P, accent, at, close, hubName, onMessage }) {
  useEffect(() => { const onKey = (e) => { if (e.key === "Escape") close(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [close]);
  const trapRef = useFocusTrap();
  const isMobile = useIsMobile();
  const [tab, setTab] = useState("researchers");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null); // { name, researchers }
  const [messageBusy, setMessageBusy] = useState(() => new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiDataGet("hub", { name: hubName }).then((res) => {
      if (cancelled) return;
      setData(res && !res.error ? res : { name: hubName, researchers: [] });
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [hubName]);

  const messageResearcher = async (r) => {
    if (messageBusy.has(r.id)) return;
    setMessageBusy((prev) => new Set(prev).add(r.id));
    try {
      const res = await apiDataAction("start-thread", { target_id: r.id });
      onMessage(r, res.thread_id);
    } catch (e) {
      toast(e.message || "Couldn't start that conversation.", { tone: "error" });
      setMessageBusy((prev) => { const next = new Set(prev); next.delete(r.id); return next; });
    }
  };

  const researchers = (data && data.researchers) || [];
  const TABS = [["researchers", "Top Researchers"], ["departments", "Departments"], ["papers", "Recent Papers"]];

  return (
    <div onClick={close} role="dialog" aria-modal="true" aria-label="Institution Hub" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 215, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} className="cb-backdrop">
      <div ref={trapRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} style={{
        background: P.dark ? "rgba(15, 17, 26, 0.94)" : "rgba(255, 255, 255, 0.97)",
        backdropFilter: "blur(40px) saturate(150%)", WebkitBackdropFilter: "blur(40px) saturate(150%)",
        border: P.dark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.08)",
        borderRadius: 16, maxWidth: 640, width: "100%", maxHeight: "85vh", display: "flex", flexDirection: "column",
        boxShadow: "0 24px 80px rgba(0,0,0,0.5)", overflow: "hidden", outline: "none",
      }} className="cb-modal">
        {/* Cinematic full-bleed header: an accent wash behind the mark + name. */}
        <div style={{
          position: "relative", padding: isMobile ? "28px 20px 20px" : "36px 28px 24px", overflow: "hidden",
          background: `linear-gradient(160deg, ${withAlpha(accent, 0.22)}, transparent 70%)`,
          borderBottom: `1px solid ${P.line}`,
        }}>
          <button onClick={close} aria-label="Close" style={{ position: "absolute", top: 16, right: 16, background: "none", border: "none", color: P.faint, cursor: "pointer", padding: 4, display: "inline-flex" }}><Icon name="close" size={18} /></button>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <img
              src={`https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(hubName)}&backgroundColor=${accent.replace("#", "")}`}
              alt="" aria-hidden="true"
              style={{ width: 64, height: 64, borderRadius: 12, border: `1px solid ${P.line}`, flexShrink: 0, boxShadow: "0 8px 24px rgba(0,0,0,0.3)" }}
            />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: FONT_SIZES.micro, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: withAlpha(accent, 0.9), fontFamily: "var(--cb-mono)" }}>Institution Hub</div>
              <div style={{ fontSize: isMobile ? FONT_SIZES.subhead : FONT_SIZES.heading, fontWeight: 700, color: P.ink, fontFamily: "var(--cb-display)", marginTop: 2 }}>{hubName}</div>
              <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, marginTop: 4 }}>{researchers.length} researcher{researchers.length === 1 ? "" : "s"} on Cerebrum</div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 4, padding: "10px 20px 0", borderBottom: `1px solid ${P.line}`, flexShrink: 0 }}>
          {TABS.map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} style={{
              padding: "8px 14px", fontSize: FONT_SIZES.small, fontWeight: 600, background: "none", border: "none", cursor: "pointer",
              color: tab === key ? P.ink : P.faint, borderBottom: tab === key ? `2px solid ${accent}` : "2px solid transparent", marginBottom: -1,
            }}>{label}</button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
          {tab === "researchers" && (
            loading ? (
              <div style={{ padding: "24px 12px", textAlign: "center", fontSize: FONT_SIZES.caption, color: P.faint }}>Loading…</div>
            ) : researchers.length === 0 ? (
              <div style={{ padding: "24px 12px", textAlign: "center", fontSize: FONT_SIZES.caption, color: P.faint }}>No researchers from {hubName} on Cerebrum yet.</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
                {researchers.map((r) => {
                  const isMessageBusy = messageBusy.has(r.id);
                  const meta = [r.degree, r.gradYear].filter(Boolean).join(" · ");
                  return (
                    <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: 12, borderRadius: 10, border: `1px solid ${P.line}` }}>
                      <img
                        src={`https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(r.username || r.id)}&backgroundColor=0a0a0a`}
                        alt="" aria-hidden="true" loading="lazy"
                        style={{ width: 36, height: 36, borderRadius: "50%", flexShrink: 0, border: `1px solid ${P.line}`, objectFit: "cover" }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: FONT_SIZES.small, fontWeight: 700, color: P.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
                        {meta && <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, fontFamily: "var(--cb-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{meta}</div>}
                      </div>
                      <button
                        onClick={() => messageResearcher(r)}
                        disabled={isMessageBusy}
                        aria-label={`Message ${r.name}`}
                        title={`Message ${r.name}`}
                        style={{ width: 30, height: 30, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: "none", border: `1px solid ${P.line}`, color: P.ink2, cursor: isMessageBusy ? "default" : "pointer", opacity: isMessageBusy ? 0.6 : 1 }}
                      ><Icon name="mail" size={13} /></button>
                    </div>
                  );
                })}
              </div>
            )
          )}
          {tab === "departments" && (
            <div style={{ padding: "24px 12px", textAlign: "center", fontSize: FONT_SIZES.caption, color: P.faint, maxWidth: 340, margin: "0 auto" }}>
              Department listings aren't built yet — Cerebrum profiles don't currently carry a department field. Top Researchers above is the real, live roster for this institution.
            </div>
          )}
          {tab === "papers" && (
            <div style={{ padding: "24px 12px", textAlign: "center", fontSize: FONT_SIZES.caption, color: P.faint, maxWidth: 340, margin: "0 auto" }}>
              Recent Papers isn't wired up yet — it would need to match this institution's researchers against Cerebrum's own literature search, which is a separate build. Try searching a researcher's name directly from the home screen in the meantime.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   NOTEBOOK MODE — deep summarization + Q&A over one full document the user
   brings themselves (paste or drop), independent of Cerebrum's own
   multi-database retrieval. See functions/api/document.js for the backend
   half. Rendered as a full-screen overlay toggled from the header rather
   than a layout swap inside App()'s own scroll tree — that tree is large
   and already stateful enough that grafting a second mode into the middle
   of it would risk the existing search view for no real benefit; an
   overlay gets the same "switch modes" experience with zero touch on
   anything already working there.
   ============================================================ */
// pdfjs-dist is only ever needed by the one person in a given session who
// actually drops a PDF into Document Mode — a static top-level import would
// put its parser in every visitor's main bundle for a feature most people
// never touch. Loaded lazily, once, on first real use instead. Pin here
// tracks the exact version in package.json's dependency — the worker file
// pdf.js loads into its own thread has to match the main library's version
// exactly, and since the worker is fetched from a CDN rather than bundled
// (see the standard Vite-compatible pattern for this library), there's
// nothing tying the two together automatically the way a bundled import
// would.
const PDFJS_VERSION = "4.10.38";
let pdfjsLibPromise = null;
function loadPdfJs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import("pdfjs-dist").then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;
      return mod;
    });
  }
  return pdfjsLibPromise;
}

// Page-by-page text extraction via getTextContent() — the standard pdf.js
// approach for a text-layer PDF (anything produced by Word/LaTeX/a real
// export pipeline, which covers the overwhelming majority of papers and
// reports someone would drop in here). A scanned/image-only PDF has no text
// layer at all, so every page comes back with zero items and the joined
// result is empty or whitespace-only; that's detected by the caller rather
// than here; this doesn't fail for that case, it just legitimately returns
// nothing. Actual OCR (reading text out of a raster image) is real, separate
// work this doesn't attempt.
async function extractPdfText(file) {
  const pdfjsLib = await loadPdfJs();
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str || "").join(" ").replace(/\s+/g, " ").trim());
  }
  return pages.join("\n\n").trim();
}

// Right-pane analysis tabs. "findings" folds together the backend's
// keyFindings + limitations fields — the source prompt asked for a tab
// per {Executive Summary, Methodology, Follow-up Q&A}, but
// functions/api/document.js already splits out Key Findings and
// Limitations as their own real sections (see splitSummarySections there),
// and dropping either on the floor to match a flatter 3-tab shape would
// throw away content the model actually generated. One extra tab keeps all
// four sections reachable without inventing a fifth.
const NOTEBOOK_TABS = [
  ["summary", "Executive Summary", "executiveSummary"],
  ["methodology", "Methodology", "methodology"],
  ["findings", "Findings & Limitations", null],
  ["qa", "Follow-up Q&A", null],
];

function NotebookMode({ P, accent, at, close }) {
  useEffect(() => { const onKey = (e) => { if (e.key === "Escape") close(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [close]);
  const isMobile = useIsMobile();
  const [leftTab, setLeftTab] = useState("paste"); // "paste" | "upload"
  const [rightTab, setRightTab] = useState("summary");
  const [documentText, setDocumentText] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [summary, setSummary] = useState(null); // { raw, model, mode: "summary", executiveSummary, methodology, keyFindings, limitations }
  const [error, setError] = useState("");
  const [qaQuery, setQaQuery] = useState("");
  const [qaBusy, setQaBusy] = useState(false);
  const [qaHistory, setQaHistory] = useState([]); // [{ query, answer, errorMsg }]
  const [hoverCite, setHoverCite] = useState(null);
  const [extractingPdf, setExtractingPdf] = useState(false);
  const fileInputRef = useRef(null);

  // Plain text/Markdown is read directly; a .pdf goes through pdf.js
  // (extractPdfText, above) instead — entirely in the browser, nothing sent
  // anywhere just to get text out of it. A scanned/image-only PDF has no
  // extractable text layer at all (see extractPdfText's own comment) rather
  // than failing outright, so that's called out explicitly rather than
  // silently handing the summarizer an empty document; a genuinely corrupt
  // or non-PDF file rejected by pdf.js itself gets its own distinct message
  // rather than both collapsing into one generic "couldn't read this."
  const readFile = (file) => {
    if (!file) return;
    setError("");
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
    if (isPdf) {
      setExtractingPdf(true);
      extractPdfText(file)
        .then((text) => {
          if (!text || text.length < 20) {
            setError("Couldn't find any text in that PDF — it may be a scanned or image-only document. Try a different file, or paste the text directly if you have it.");
            return;
          }
          setDocumentText(text);
          setLeftTab("paste");
        })
        .catch((e) => {
          console.error("PDF extraction failed:", e);
          setError("Couldn't read that PDF — it may be corrupted or password-protected. Try a different file, or paste the text directly instead.");
        })
        .finally(() => setExtractingPdf(false));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => { setDocumentText(String(reader.result || "")); setLeftTab("paste"); };
    reader.onerror = () => setError("Couldn't read that file. Try pasting the text directly instead.");
    reader.readAsText(file);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) readFile(file);
  };

  const analyze = async () => {
    const text = documentText.trim();
    if (!text || analyzing) return;
    setAnalyzing(true);
    setError("");
    setSummary(null);
    setQaHistory([]);
    setRightTab("summary");
    try {
      const res = await fetch("/api/document", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentText: text }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't analyze that document. Please try again.");
      setSummary(data);
    } catch (e) {
      setError(e.message || "Couldn't analyze that document. Please try again.");
    } finally {
      setAnalyzing(false);
    }
  };

  // Every factual claim in the answer still has to come from the document
  // text alone (see QA_SYSTEM_PROMPT in functions/api/document.js) — but a
  // real conversation needs a follow-up like "and the second one?" or "why
  // is that?" to resolve against what was actually just asked, so the prior
  // turns of THIS document's own thread are sent along as plain context.
  // The backend treats that history as disambiguation only, never as a
  // source of facts, so grounding stays strict while the exchange stops
  // resetting to a blank slate every single question.
  const askFollowUp = async () => {
    const q = qaQuery.trim();
    if (!q || qaBusy || !summary) return;
    const historyForRequest = qaHistory
      .filter((h) => h.answer)
      .flatMap((h) => [{ role: "user", text: h.query }, { role: "assistant", text: h.answer }]);
    setQaBusy(true);
    setQaQuery("");
    setRightTab("qa");
    setQaHistory((prev) => [...prev, { query: q, answer: "" }]);
    try {
      const res = await fetch("/api/document", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentText: documentText.trim(), query: q, history: historyForRequest }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't answer that.");
      setQaHistory((prev) => prev.map((h, i) => (i === prev.length - 1 ? { ...h, answer: data.answer } : h)));
    } catch (e) {
      setQaHistory((prev) => prev.map((h, i) => (i === prev.length - 1 ? { ...h, errorMsg: e.message || "Couldn't answer that." } : h)));
    } finally {
      setQaBusy(false);
    }
  };

  const paneBase = { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" };
  const inputBg = P.dark ? "rgba(255,255,255,0.03)" : "#fff";
  const dimBtnBg = P.dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";

  return (
    <div role="dialog" aria-modal="true" aria-label="Document Mode" style={{ position: "fixed", inset: 0, zIndex: 300, background: P.bg, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: isMobile ? "14px 16px" : "16px 24px", borderBottom: `1px solid ${P.line}`, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Icon name="bookOpen" size={18} style={{ color: accent }} />
          <div>
            <div style={{ fontSize: FONT_SIZES.subhead, fontWeight: 700, color: P.ink, fontFamily: "var(--cb-display)" }}>Document Mode</div>
            {!isMobile && <div style={{ fontSize: FONT_SIZES.caption, color: P.faint }}>Deep summarization and Q&A over one document</div>}
          </div>
        </div>
        <button onClick={close} aria-label="Close Document Mode" style={{ background: "none", border: "none", color: P.faint, cursor: "pointer", padding: 6, display: "inline-flex" }}><Icon name="close" size={20} /></button>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: isMobile ? "column" : "row", overflow: "hidden" }}>
        {/* LEFT PANE — the source, tabbed between pasting text directly and
            loading it from a file. Only one sub-view renders at a time now
            instead of stacking the dropzone above the textarea always. */}
        <div style={{ ...paneBase, borderRight: isMobile ? "none" : `1px solid ${P.line}`, borderBottom: isMobile ? `1px solid ${P.line}` : "none", padding: 20, maxHeight: isMobile ? "48%" : "none" }}>
          <div role="tablist" aria-label="Document source" style={{ display: "flex", gap: 4, marginBottom: 14, flexShrink: 0, background: dimBtnBg, borderRadius: 8, padding: 3 }}>
            {[["paste", "Source Text"], ["upload", "Upload File"]].map(([key, label]) => (
              <button key={key} role="tab" aria-selected={leftTab === key} onClick={() => setLeftTab(key)}
                style={{
                  flex: 1, padding: "7px 10px", borderRadius: 6, border: "none", cursor: "pointer",
                  background: leftTab === key ? accent : "transparent", color: leftTab === key ? at : P.ink2,
                  fontSize: FONT_SIZES.small, fontWeight: 600, fontFamily: "var(--cb-mono)", transition: "all 150ms ease",
                }}
              >{label}</button>
            ))}
          </div>

          {leftTab === "upload" ? (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              aria-label="Drop a document file or click to browse"
              style={{
                flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6,
                border: `1.5px dashed ${dragActive ? accent : P.line}`, borderRadius: 12, padding: "18px 16px", textAlign: "center", cursor: "pointer",
                background: dragActive ? withAlpha(accent, 0.06) : "transparent", transition: "all 150ms ease", minHeight: isMobile ? 140 : 240,
              }}
            >
              <input ref={fileInputRef} type="file" accept=".txt,.md,.pdf,text/plain,application/pdf" style={{ display: "none" }} onChange={(e) => readFile(e.target.files && e.target.files[0])} />
              {extractingPdf ? (<>
                <div style={{ width: 24, height: 24, border: `2px solid ${P.line2}`, borderTopColor: accent, borderRadius: "50%", animation: "cbspin 0.8s linear infinite" }} />
                <div style={{ fontSize: FONT_SIZES.small, color: P.ink2, fontWeight: 600, marginTop: 6 }}>Extracting text from PDF…</div>
              </>) : (<>
                <Icon name="bookOpen" size={22} style={{ color: P.faint, opacity: 0.6 }} />
                <div style={{ fontSize: FONT_SIZES.small, color: P.ink2, fontWeight: 600 }}>Drop a file here, or click to browse</div>
                <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, marginTop: 4, maxWidth: 260 }}>PDF, plain text, or Markdown. PDF text is extracted right in your browser — nothing is uploaded just to read it. Scanned/image-only PDFs have no text to extract; paste the text directly for those.</div>
              </>)}
            </div>
          ) : (
            <textarea
              value={documentText}
              onChange={(e) => setDocumentText(e.target.value)}
              placeholder="Paste the full text of a paper, report, or document here…"
              style={{
                flex: 1, width: "100%", resize: "none", padding: 14, borderRadius: 10, border: `1px solid ${P.line}`,
                background: inputBg, color: P.ink, fontFamily: "var(--cb-body)", fontSize: FONT_SIZES.small, lineHeight: 1.6, minHeight: isMobile ? 140 : 240,
              }}
            />
          )}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, flexShrink: 0, gap: 12 }}>
            <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, fontFamily: "var(--cb-mono)" }}>{documentText.trim().length.toLocaleString()} characters</div>
            <button
              onClick={analyze}
              disabled={!documentText.trim() || analyzing}
              style={{
                padding: "10px 20px", borderRadius: 100, border: "none", cursor: (!documentText.trim() || analyzing) ? "default" : "pointer",
                background: (!documentText.trim() || analyzing) ? dimBtnBg : accent,
                color: (!documentText.trim() || analyzing) ? P.faint : at, fontWeight: 700, fontSize: FONT_SIZES.small, flexShrink: 0,
              }}
            >{analyzing ? "Analyzing…" : "Analyze Document"}</button>
          </div>
          {error && <div style={{ marginTop: 10, fontSize: FONT_SIZES.caption, color: STATUS.bad }}>{error}</div>}
        </div>

        {/* RIGHT PANE — the analysis, tabbed across the sections the backend
            actually returns (see NOTEBOOK_TABS above) plus a dedicated
            Follow-up Q&A tab so a running conversation doesn't crowd out
            the summary itself. */}
        <div style={{ ...paneBase, padding: 20 }}>
          {!summary && !analyzing && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: P.faint }}>
              <Icon name="bookOpen" size={28} style={{ opacity: 0.4 }} />
              <div style={{ fontSize: FONT_SIZES.body, fontWeight: 600, color: P.ink2 }}>Awaiting Document</div>
              <div style={{ fontSize: FONT_SIZES.caption, maxWidth: 280, textAlign: "center" }}>Paste or drop a document on the left, then analyze it to get a structured summary here.</div>
            </div>
          )}
          {analyzing && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ fontSize: FONT_SIZES.body, fontWeight: 600, color: P.ink2 }}>Reading the document…</div>
              <Skeleton P={P} accent={accent} />
            </div>
          )}
          {summary && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div role="tablist" aria-label="Analysis section" style={{ display: "flex", gap: 4, marginBottom: 14, flexShrink: 0, overflowX: "auto" }}>
                {NOTEBOOK_TABS.map(([key, label]) => (
                  <button key={key} role="tab" aria-selected={rightTab === key} onClick={() => setRightTab(key)}
                    style={{
                      padding: "7px 12px", borderRadius: 100, border: `1px solid ${rightTab === key ? accent : P.line}`, cursor: "pointer",
                      background: rightTab === key ? withAlpha(accent, 0.12) : "transparent", color: rightTab === key ? accent : P.ink2,
                      fontSize: FONT_SIZES.caption, fontWeight: 600, fontFamily: "var(--cb-mono)", whiteSpace: "nowrap", flexShrink: 0,
                    }}
                  >{label}</button>
                ))}
              </div>
              <div style={{ flex: 1, overflowY: "auto", paddingRight: 4 }}>
                {rightTab !== "qa" && (() => {
                  const tabDef = NOTEBOOK_TABS.find((t) => t[0] === rightTab);
                  if (rightTab === "findings") {
                    const hasFindings = !!(summary.keyFindings && summary.keyFindings.trim());
                    const hasLimitations = !!(summary.limitations && summary.limitations.trim());
                    if (!hasFindings && !hasLimitations) {
                      return <div style={{ fontSize: FONT_SIZES.small, color: P.faint }}>This response didn't break out Key Findings or Limitations as distinct sections — see Executive Summary for the full analysis.</div>;
                    }
                    return (
                      <>
                        {hasFindings && (<>
                          <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: accent, fontFamily: "var(--cb-mono)", marginBottom: 10 }}>Key Findings</div>
                          {renderAnswer(summary.keyFindings, [], P, accent, hoverCite, setHoverCite)}
                        </>)}
                        {hasLimitations && (<>
                          <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: accent, fontFamily: "var(--cb-mono)", marginTop: hasFindings ? 20 : 0, marginBottom: 10 }}>Limitations</div>
                          {renderAnswer(summary.limitations, [], P, accent, hoverCite, setHoverCite)}
                        </>)}
                      </>
                    );
                  }
                  const field = tabDef && tabDef[2];
                  const content = field && summary[field] && summary[field].trim();
                  if (!content) {
                    return <div style={{ fontSize: FONT_SIZES.small, color: P.faint }}>This response didn't break out a distinct {tabDef ? tabDef[1] : "section"} — see Executive Summary for the full analysis.</div>;
                  }
                  return renderAnswer(content, [], P, accent, hoverCite, setHoverCite);
                })()}
                {rightTab === "qa" && (
                  <>
                    {qaHistory.length === 0 && <div style={{ fontSize: FONT_SIZES.small, color: P.faint }}>Ask a question below and Cerebrum will answer strictly from this document's text.</div>}
                    {qaHistory.map((h, i) => (
                      <div key={i} style={{ marginTop: i === 0 ? 0 : 20, paddingTop: i === 0 ? 0 : 16, borderTop: i === 0 ? "none" : `1px solid ${P.line}` }}>
                        <div style={{ fontSize: FONT_SIZES.small, fontWeight: 700, color: P.ink, marginBottom: 8 }}>{h.query}</div>
                        {h.answer ? renderAnswer(h.answer, [], P, accent, hoverCite, setHoverCite) : h.errorMsg ? <div style={{ fontSize: FONT_SIZES.caption, color: STATUS.bad }}>{h.errorMsg}</div> : <div style={{ fontSize: FONT_SIZES.caption, color: P.faint }}>Thinking…</div>}
                      </div>
                    ))}
                  </>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, paddingTop: 14, borderTop: `1px solid ${P.line}`, flexShrink: 0 }}>
                <input
                  value={qaQuery}
                  onChange={(e) => setQaQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); askFollowUp(); } }}
                  placeholder="Ask a question about this document…"
                  aria-label="Ask a question about this document"
                  disabled={qaBusy}
                  style={{ flex: 1, padding: "10px 13px", fontSize: FONT_SIZES.small, borderRadius: 8, border: `1px solid ${P.line}`, background: inputBg, color: P.ink, fontFamily: "var(--cb-body)" }}
                />
                <button onClick={askFollowUp} disabled={!qaQuery.trim() || qaBusy} aria-label="Ask" style={{ width: 38, height: 38, borderRadius: "50%", border: "none", background: (!qaQuery.trim() || qaBusy) ? dimBtnBg : accent, color: (!qaQuery.trim() || qaBusy) ? P.faint : at, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: (!qaQuery.trim() || qaBusy) ? "default" : "pointer", flexShrink: 0 }}><Icon name="send" size={15} /></button>
              </div>
            </div>
          )}
        </div>
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
        <span style={{ fontSize: FONT_SIZES.small, color: P.ink2 }}>{label}</span>
        <span style={{ fontSize: FONT_SIZES.caption, color: P.faint, fontFamily: "var(--cb-mono)" }}>{format(local)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={local} onChange={(e) => setLocal(parseFloat(e.target.value))} onMouseUp={commit} onTouchEnd={commit} onKeyUp={commit} style={{ width: "100%", accentColor: accent, cursor: "pointer" }} />
    </div>
  );
}


/* ════════════════════════════════════════════════════════════════
   SETTINGS — iOS-style grouped sections
   Proper alignment, accessibility, real settings (no orphaned
   controls — every piece of state below is reachable from here).
   ════════════════════════════════════════════════════════════════ */
function SettingsView({ P, accent, at, S, PALETTES, ACCENTS, paletteName, setPaletteName, accentName, setAccentName, customAccent, setCustomAccent, answerLength, setAnswerLength, factCheck, setFactCheck, muted, setMuted, typewriter, setTypewriter, soundMode, setSoundMode, animationMode, setAnimationMode, animSpeed, setAnimSpeed, sfx, setSessions, setSaved, saved, history, setHistory, highContrast, setHighContrast, fontSize, setFontSize, reducedTransparency, setReducedTransparency, autoplay, setAutoplay, dyslexicFont, setDyslexicFont, lineSpacing, setLineSpacing, focusHighlight, setFocusHighlight, citationStyle, setCitationStyle, user, onSignOut, onAccountDeleted, onOpenAuth, initialTab, close, dataDensity, setDataDensity, collections, turns }) {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState(initialTab || "general");
  const [confirmClear, setConfirmClear] = useState(false);
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState("");
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false);
  const [delBusy, setDelBusy] = useState(false);
  // v6.7: the tab bar's sliding underline used to assume all 6 tabs were
  // equal width (`left`/`width` as `index/count` and `1/count` percentages)
  // — true on desktop, where flex:1 with enough room does divide them
  // evenly, but on a narrow phone viewport there isn't enough width for
  // "Audio & Voice"/"History & Data" to fit at their natural size, and the
  // fixed `flex:1` sizing plus no way to scroll meant the bar just
  // overflowed the dialog with the last tab ("History & Data") clipped
  // clean off the edge — genuinely unreachable, not just visually off.
  // Making the bar horizontally scrollable fixes reachability; measuring
  // the active tab's real DOM position (instead of assuming equal widths)
  // keeps the underline correct at both sizes instead of just re-breaking
  // it for the scrollable case.
  const tabBtnRefs = useRef({});
  const [tabUnderline, setTabUnderline] = useState({ left: 0, width: 0 });
  useEffect(() => {
    const el = tabBtnRefs.current[tab];
    if (el) {
      setTabUnderline({ left: el.offsetLeft, width: el.offsetWidth });
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [tab, isMobile]);

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
      {title && <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 600, color: P.faint, marginBottom: 8, paddingLeft: 2, textTransform: "uppercase", fontFamily: "var(--cb-mono)", letterSpacing: "0.08em" }}>{title}</div>}
      <div style={{ background: bg, border: glassBorderS, borderRadius: 3, overflow: "hidden", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}>{children}</div>
      {footer && <div style={{ fontSize: FONT_SIZES.small, color: P.faint, marginTop: 8, paddingLeft: 2, lineHeight: 1.5 }}>{footer}</div>}
    </div>
  );

  const Row = ({ icon, label, desc, control, onClick, last, destructive }) => (
    <div onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 16px", cursor: onClick ? "pointer" : "default", borderBottom: last ? "none" : `1px solid ${divider}` }}>
      {icon && <span style={{ fontSize: FONT_SIZES.heading, width: 28, height: 28, borderRadius: 3, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{icon}</span>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: FONT_SIZES.body, color: destructive ? STATUS.bad : P.ink, fontWeight: 500, fontFamily: "var(--cb-body)", letterSpacing: "-0.01em" }}>{label}</div>
        {desc && <div style={{ fontSize: FONT_SIZES.small, color: P.faint, lineHeight: 1.4, marginTop: 2 }}>{desc}</div>}
      </div>
      {control && <div style={{ flexShrink: 0 }}>{control}</div>}
      {onClick && !control && <span style={{ color: P.faint, fontSize: FONT_SIZES.subhead }}>›</span>}
    </div>
  );

  const Switch = ({ on, onChange, label }) => (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => { sfx(); onChange(!on); }}
      style={{ width: 44, height: 26, borderRadius: 3, position: "relative", background: on ? accent : P.dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.14)", border: "none", cursor: "pointer", padding: 0, transition: "background 220ms ease" }}>
      <span style={{ position: "absolute", top: 2, left: 2, width: 22, height: 22, borderRadius: "50%", background: "#fff", transform: on ? "translateX(18px)" : "translateX(0)", transition: "transform 220ms cubic-bezier(0.4, 0, 0.2, 1)", boxShadow: "0 2px 6px rgba(0,0,0,0.25)" }} />
    </button>
  );

  const Picker = ({ value, options, onChange }) => (
    <select value={value} onChange={(e) => { sfx(); onChange(e.target.value); }}
      style={{ padding: "6px 10px", fontSize: FONT_SIZES.body, color: accent, background: "transparent", border: "none", cursor: "pointer", fontFamily: "var(--cb-body)", fontWeight: 500, outline: "none", ...selectChrome(P) }}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );

  return (
    // position/zIndex here are load-bearing — see pageView's own comment
    // (makeStyles) for why a plain static box never wins a stacking fight
    // against LivingBackground's absolutely-positioned canvas, opaque
    // background or not, past the first screenful of scroll.
    <div role="region" aria-label="Settings" style={{ flex: 1, minHeight: "100%", background: P.bg, display: "flex", flexDirection: "column", overflowY: "auto", position: "relative", zIndex: 1 }}>
      <div style={{ width: "100%", maxWidth: 760, margin: "0 auto", padding: isMobile ? "22px 18px 60px" : "44px 32px 90px", display: "flex", flexDirection: "column", fontFamily: "var(--cb-body)" }}>

        {/* Header — a page title now, not a dialog: no backdrop, no close
            button. Leaving this screen means picking another Sidebar
            destination, not dismissing an overlay. */}
        <div style={{ flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <div style={{ fontSize: FONT_SIZES.display, fontWeight: 700, color: P.ink, letterSpacing: "-0.02em", fontFamily: "var(--cb-display)" }}>Settings</div>
          </div>

          {/* Tab bar — a sliding underline indicator instead of the filled
              segmented-pill look this used to share with the command
              palette/dropdown chrome elsewhere. Same pattern as AuthModal's
              tab bar now uses, so the two places in the app with real
              client-side tabs read as one deliberate system rather than
              each having invented its own. */}
          <div className="cb-scroll-x" style={{ position: "relative", display: "flex", borderBottom: `1px solid ${P.line}`, marginBottom: 18, overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
            {TABS.map(([id, label]) => (
              <button key={id} ref={(el) => { tabBtnRefs.current[id] = el; }} onClick={() => { sfx(); setTab(id); }}
                style={{ flexShrink: 0, padding: isMobile ? "8px 10px 10px" : "9px 4px 11px", fontSize: isMobile ? FONT_SIZES.caption : FONT_SIZES.small, fontWeight: tab === id ? 700 : 500, background: "transparent", color: tab === id ? P.ink : P.faint, border: "none", cursor: "pointer", fontFamily: "var(--cb-body)", letterSpacing: "-0.01em", whiteSpace: "nowrap", transition: "color 200ms ease" }}>{label}</button>
            ))}
            <div aria-hidden="true" style={{ position: "absolute", bottom: -1, left: tabUnderline.left, width: tabUnderline.width, height: 2, background: accent, borderRadius: 2, transition: "left 250ms cubic-bezier(0.4, 0, 0.2, 1), width 250ms cubic-bezier(0.4, 0, 0.2, 1)" }} />
          </div>
        </div>

        {/* Content */}
        <div key={tab} className="cb-fade" style={{ padding: "0 16px 16px", overflowY: "auto", flex: 1, WebkitOverflowScrolling: "touch" }}>

          {tab === "account" && (<>
            {!user ? (
              <Section title="Account" footer="Signing in moves your saved articles, collections, and history to your account so they follow you to any device. Guest mode — everything you're using right now — keeps working exactly as-is if you never sign in.">
                <Row label="You're browsing as a guest" desc="Nothing here leaves this browser." control={
                  <button onClick={() => onOpenAuth("login")} style={{ padding: "8px 16px", fontSize: FONT_SIZES.small, fontWeight: 600, background: accent, color: at, border: "none", borderRadius: 3, cursor: "pointer" }}>Sign in</button>
                } last />
              </Section>
            ) : (<>
              <Section title="Account">
                <Row label={user.email} desc="Signed in" last />
              </Section>
              <Section title="Password" footer="Set a password so you can sign in without waiting on an email link every time.">
                <div style={{ padding: "14px 16px" }}>
                  <form onSubmit={submitPassword}>
                    <input type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} placeholder="New password (8+ characters)" aria-label="New password" style={{ width: "100%", padding: "10px 12px", fontSize: FONT_SIZES.small, borderRadius: 3, border: `1px solid ${P.line}`, background: "transparent", color: P.ink, marginBottom: 8 }} />
                    <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Confirm new password" aria-label="Confirm new password" style={{ width: "100%", padding: "10px 12px", fontSize: FONT_SIZES.small, borderRadius: 3, border: `1px solid ${P.line}`, background: "transparent", color: P.ink }} />
                    {pwMsg && <div style={{ fontSize: FONT_SIZES.small, color: pwMsg === "Password updated." ? STATUS.good : STATUS.bad, marginTop: 8 }}>{pwMsg}</div>}
                    <button type="submit" disabled={pwBusy} style={{ marginTop: 10, padding: "8px 16px", fontSize: FONT_SIZES.small, fontWeight: 600, background: withAlpha(accent, 0.12), color: accent, border: "none", borderRadius: 3, cursor: pwBusy ? "default" : "pointer", opacity: pwBusy ? 0.6 : 1 }}>{pwBusy ? "Saving…" : "Update password"}</button>
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
                    <span style={{ fontSize: FONT_SIZES.small, color: STATUS.bad }}>Permanently delete your account and all its data?</span>
                    <span style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                      <button onClick={() => setConfirmDeleteAccount(false)} style={{ padding: "6px 12px", fontSize: FONT_SIZES.small, background: "transparent", color: P.ink2, border: `1px solid ${P.line}`, borderRadius: 3, cursor: "pointer" }}>Cancel</button>
                      <button onClick={submitDeleteAccount} disabled={delBusy} style={{ padding: "6px 12px", fontSize: FONT_SIZES.small, fontWeight: 600, background: STATUS.bad, color: "#fff", border: "none", borderRadius: 3, cursor: delBusy ? "default" : "pointer" }}>{delBusy ? "Deleting…" : "Confirm delete"}</button>
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
                    style={{ flex: 1, padding: "14px 10px 10px", borderRadius: 3, cursor: "pointer", border: paletteName === pn ? `2px solid ${accent}` : `1px solid ${divider}`, background: PALETTES[pn].bg, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <span style={{ width: 22, height: 22, borderRadius: 3, background: PALETTES[pn].surface, border: `1px solid ${PALETTES[pn].line2}` }} />
                      <span style={{ width: 22, height: 22, borderRadius: 3, background: accent }} />
                    </div>
                    <span style={{ fontSize: FONT_SIZES.small, color: PALETTES[pn].ink, fontWeight: paletteName === pn ? 600 : 500, fontFamily: "var(--cb-body)" }}>{pn}</span>
                  </button>
                ))}
              </div>
            </Section>

            <Section title="Accent color">
              {/* v7.0 redesign: these were full circles — a row of bright
                  candy-colored dots reads more "pick a crayon" than
                  "configure an instrument." Rounded squares (squircles)
                  read as precision swatches/chips instead, matching the
                  radius scale used on every other control in this panel. */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, padding: "14px 16px", alignItems: "center" }}>
                {Object.keys(ACCENTS).map((an) => (
                  <button key={an} title={an} aria-label={an} onClick={() => { sfx(); setCustomAccent(""); setAccentName(an); }}
                    style={{ width: 30, height: 30, borderRadius: 3, background: ACCENTS[an], border: (!customAccent && accentName === an) ? "2px solid #fff" : "2px solid transparent", cursor: "pointer", boxShadow: (!customAccent && accentName === an) ? `0 0 0 2px ${ACCENTS[an]}` : "none", transition: "all 150ms ease" }} />
                ))}
                <label style={{ width: 30, height: 30, borderRadius: 3, border: `2px dashed ${P.faint}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }} title="Custom">
                  <input type="color" value={accent} onChange={(e) => setCustomAccent(e.target.value)} style={{ opacity: 0, width: 0, height: 0, position: "absolute" }} />
                  <span style={{ fontSize: FONT_SIZES.subhead, color: P.faint, lineHeight: 1 }}>+</span>
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
              } last={animationMode === "off"} />
              {/* v6.9: was cookie-persisted and threaded all the way down into
                  LivingBackground already, but had no control anywhere to
                  actually change it from its default — this is the first real
                  UI for it, reusing LocalSlider (defined below, previously
                  built but never called from anywhere). Hidden when the
                  background is off entirely, since a speed has nothing to
                  apply to at that point. */}
              {animationMode !== "off" && (
                <div style={{ padding: "12px 0 4px" }}>
                  <LocalSlider label="Animation speed" value={animSpeed} min={0.25} max={2} step={0.25}
                    format={(v) => `${v}×`} onCommit={(v) => { sfx(); setAnimSpeed(v); }} accent={accent} P={P} />
                </div>
              )}
            </Section>

            {/* v31: the "Background style" picker is gone — one field per screen now. */}

            <Section title="Layout density" footer="Compact mode reduces padding throughout the interface — useful when reviewing many sources at once.">
              <Row label="Data density" control={
                <Picker value={dataDensity} options={[["comfortable", "Comfortable"], ["compact", "Compact"]]} onChange={(v) => { sfx(); setDataDensity(v); }} />
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
                  <button onClick={() => { setHistory([]); sfx(); }} style={{ padding: "6px 14px", fontSize: FONT_SIZES.small, color: STATUS.bad, background: "transparent", border: "none", cursor: "pointer", fontWeight: 500, fontFamily: "var(--cb-body)" }}>Clear</button>
                } last />
              )}
            </Section>

            <Section title="Storage" footer="Saved articles and preferences are stored locally in your browser. Your search queries are sent to Cerebrum's server to run the search — see the Privacy page for details.">
              <Row label="Saved articles" desc={`${saved.length} article${saved.length === 1 ? "" : "s"} saved`} />
              <Row label="Clear all data" destructive control={
                confirmClear
                  ? <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => { setSessions([]); setSaved([]); setHistory([]); setConfirmClear(false); sfx(); }} style={{ padding: "6px 14px", fontSize: FONT_SIZES.small, fontWeight: 600, background: STATUS.bad, color: "#fff", border: "none", borderRadius: 3, cursor: "pointer", fontFamily: "var(--cb-body)" }}>Delete</button>
                      <button onClick={() => setConfirmClear(false)} style={{ padding: "6px 14px", fontSize: FONT_SIZES.small, color: P.ink2, background: "transparent", border: `1px solid ${P.line}`, borderRadius: 3, cursor: "pointer", fontFamily: "var(--cb-body)" }}>Cancel</button>
                    </div>
                  : <button onClick={() => setConfirmClear(true)} style={{ padding: "6px 14px", fontSize: FONT_SIZES.small, color: STATUS.bad, background: "transparent", border: "none", cursor: "pointer", fontWeight: 500, fontFamily: "var(--cb-body)" }}>Clear…</button>
              } last />
            </Section>

            <Section title="Workspace" footer="Export all saved articles, history, and preferences as a portable JSON file you can reimport on any device.">
              <Row label="Export workspace" desc="Download all your data as JSON" control={
                <button onClick={() => {
                  const workspace = {
                    version: APP_VERSION,
                    exported: new Date().toISOString(),
                    saved, history,
                    preferences: { paletteName, accentName, customAccent, answerLength, factCheck: factCheck ? "1" : "0", muted: muted ? "1" : "0", soundMode, typewriter: typewriter ? "1" : "0", citationStyle, animationMode, dataDensity },
                  };
                  const blob = new Blob([JSON.stringify(workspace, null, 2)], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url; a.download = `cerebrum-workspace-${Date.now()}.json`;
                  document.body.appendChild(a); a.click(); document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                  sfx();
                }} style={{ padding: "6px 14px", fontSize: FONT_SIZES.small, fontWeight: 600, background: withAlpha(accent, 0.12), color: accent, border: "none", borderRadius: 3, cursor: "pointer", fontFamily: "var(--cb-body)" }}>Export JSON</button>
              } />
              <Row label="Import workspace" desc="Restore from a previously exported file" control={
                <label style={{ padding: "6px 14px", fontSize: FONT_SIZES.small, fontWeight: 600, background: withAlpha(accent, 0.12), color: accent, border: "none", borderRadius: 3, cursor: "pointer", fontFamily: "var(--cb-body)", display: "inline-block" }}>
                  Import
                  <input type="file" accept=".json" style={{ display: "none" }} onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      try {
                        const data = JSON.parse(reader.result);
                        if (data.saved && Array.isArray(data.saved)) setSaved(data.saved);
                        if (data.history && Array.isArray(data.history)) setHistory(data.history);
                        sfx();
                      } catch {
                        // Silently fail on malformed JSON — the button stays inert
                      }
                    };
                    reader.readAsText(file);
                  }} />
                </label>
              } last />
            </Section>

            <Section title="Keyboard shortcuts">
              <div style={{ padding: "4px 0" }}>
                {[[kbdLabel("K"), "Search"], [kbdLabel("J"), "New investigation"], [kbdLabel("B"), "Saved articles"], [kbdLabel("/"), "Settings"], [kbdLabel("D"), "Toggle light / dark"], ["Esc", "Back to search"]].map(([key, desc], i, arr) => (
                  <div key={desc} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: i < arr.length - 1 ? `1px solid ${divider}` : "none" }}>
                    <span style={{ fontSize: FONT_SIZES.body, color: P.ink, fontWeight: 500, fontFamily: "var(--cb-body)" }}>{desc}</span>
                    <kbd style={{ fontSize: FONT_SIZES.small, fontFamily: "var(--cb-mono)", color: P.faint, background: P.dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)", padding: "3px 8px", borderRadius: 3, fontWeight: 500 }}>{key}</kbd>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="About">
              <Row label="Version" control={<span style={{ fontSize: FONT_SIZES.body, color: P.faint, fontFamily: "var(--cb-mono)" }}>{APP_VERSION}</span>} />
              <Row label="Built by" control={<span style={{ fontSize: FONT_SIZES.body, color: accent, fontWeight: 500 }}>Vaticay</span>} last />
            </Section>
          </>)}

        </div>
      </div>
    </div>
  );
}


/* ════════════════════════════════════════════════════════════════
   STYLE SYSTEM — shared style objects

   Left-aligned editorial layout. Serif display headings. Deep navy
   glass surfaces. The search bar is a command line. Results read
   like a premium brief.
   ════════════════════════════════════════════════════════════════ */
function makeStyles(P, accent, at, isMobile = false, density = "comfortable") {
  const isCompact = density === "compact";
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
    // overflowX: "clip" lives here now instead of on html/body — see the
    // matching comment on the `html, body` CSS rule near the bottom of this
    // file for why (v25 wheel-scroll hotfix).
    // v31 pinned this to a fixed obsidian/white hex regardless of palette,
    // so switching palettes never actually changed the page's own base
    // color underneath everything else. Reversed per explicit direction
    // (Strike 5): the whole point of Sage/Dark/Mid/Light now is that the
    // page itself is warm stone, cool slate, or paper-white depending on
    // what's selected — P.bg is that selection, so this reads it directly.
    page: { minHeight: "100dvh", background: P.bg, color: P.ink, fontFamily: font, WebkitFontSmoothing: "antialiased", display: "flex", flexDirection: "column", overflowX: "clip" },
    // v32: SoftAurora (see its own comment block) is a deliberately loud,
    // saturated, constantly-moving field — nothing like the 0.04-opacity
    // dot-grid it replaced. Sitting reading text directly on top of it would
    // fail contrast the moment a bright band of the aurora drifts under a
    // sentence. This layer is the fix: a wide, soft, horizontal "reading
    grain: { position: "fixed", inset: 0, pointerEvents: "none", opacity: P.grain, zIndex: 100, backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")" },

    /* ── Ambient wash: the always-on depth layer ──
       A pure-CSS radial-gradient wash, built from colors already in
       memory — no network dependency, cannot fail. LivingBackground (the
       animated ConstellationField canvas, see its own component comment)
       layers on top of this when animation is enabled; this wash is the
       baseline atmosphere either way, including for anyone with animation
       switched off in Settings. */
    // v6.8: light theme's wash used to sit at roughly half the alpha of
    // dark's (0.12/0.09/0.08 vs 0.24/0.20/0.18) on the reasoning that a
    // light surface needs a lighter touch — but against an already
    // near-white body, that read as "no background at all" rather than "a
    // subtle one." Brought closer to parity with dark so the wash is
    // something a visitor actually notices as a deliberate background,
    // not something only visible on close inspection.
    // v30: retiring the "Darknode terminal" concept entirely per direction —
    // this was a vignette left over from that round (already pared down
    // from three colored blobs to one dark edge fade last round). The new
    // target was "Next-Gen Editorial Intelligence": a flawless, solid,
    // premium surface, not a vignette or a haze of any kind — reasoning
    // that P.bg's own solid color would carry the surface and a fully
    // transparent ambient layer would leave "zero gradient math left to
    // fight the page's WebGL layer for the same pixels."
    // Commit 43: that reasoning didn't hold. `page`'s solid `background:
    // P.bg` paints at the very back of the page element's own box, but
    // LivingBackground (SoftAurora) is a later sibling in the DOM with the
    // same z-index, so it paints ON TOP of that solid color, full-bleed,
    // completely undimmed, everywhere the app's actual content — cards,
    // panels, text — doesn't happen to sit directly over it. In practice
    // that's every gap, margin, and stretch of negative space in the
    // layout, which is exactly what reads as a hazy, foggy wash across the
    // dark palettes rather than the flat, considered surface this was
    // meant to produce. Restoring a real scrim here — the same role the
    // Intro screen's own `.cb-ambient` layer already plays for Orb, just
    // lighter — knocks the aurora back down to a quiet, controlled accent
    // in open space instead of a fog filling the whole viewport.
    //
    // Commit 44: the Commit 43 pass above still shipped this scrim BEHIND
    // LivingBackground in paint order (this div sits earlier in the JSX,
    // and both are `position:fixed` at the same z-index, so ties resolve by
    // document order — later wins). A layer painted behind a WebGL canvas
    // can only ever show through where that canvas is transparent — i.e.
    // wherever the aurora shader is already dim — so it did nothing at all
    // to the bright, saturated core of the aurora band, which is exactly
    // the part that actually reads as "foggy." That's the real reason the
    // haze was still there after that fix shipped: the scrim was rendering,
    // it just never had a chance to dim the one thing it needed to. Moving
    // it to zIndex: 1 — one level above LivingBackground's own zIndex: 0,
    // and still nowhere near Sidebar's zIndex: 30 or the real content above
    // it — puts it on top instead, where it actually composites over every
    // pixel of the aurora, bright bands included. Opacity nudged up
    // alongside the reorder for real margin now that it's doing its job.
    //
    // Commit 45: STILL read as foggy after the z-index fix, and the actual
    // cause was this comment's own prior claim — "built from P.bg itself...
    // not a new color" was true back when the dark palettes' `bg` was
    // near-black. It no longer is: the user separately asked for dark mode
    // to be "not so dark," and PALETTES.Dark/Mid/Sage were deliberately
    // lifted off pure black to a warm/cool charcoal (`#201f1d`/`#25262b`/
    // `#242420` — see PALETTES itself). Tinting a dimming scrim with that
    // *lighter* charcoal, at 72% opacity, over a bright saturated WebGL
    // shader doesn't dim it the way a near-black overlay does — it blends
    // into exactly the warm-gray haze being reported. The scrim's job is to
    // darken the animated layer, not to color-match the theme's own (now
    // deliberately lighter) surface tone, so those two now need to be
    // decoupled: dark themes' scrim is a fixed near-black regardless of how
    // light `P.bg` gets, while light theme's scrim (never reported as
    // foggy, and already close to white) still derives from its own P.bg.
    ambient: {
      position: "fixed", inset: 0, zIndex: 1, pointerEvents: "none", overflow: "hidden",
      background: P.dark ? "rgba(0,0,0,0.72)" : withAlpha(P.bg, 0.45),
    },

    /* ── Header: dark glass bar, minimal ──
       `position: sticky` combined with `backdrop-filter` on the same element
       is a known Chromium compositor trap: the filter forces its own paint
       layer, and when that layer also has to track scroll offset for
       stickiness, Chrome can mark the region under it as needing main-thread
       scroll handling and then never promptly re-check that determination as
       the page grows — mouse-wheel scroll goes dead over that region while a
       manual scrollbar drag (a different, compositor-level code path) keeps
       working fine. The sticky element itself doesn't carry the filter at
       all: it's just a plain positioned box, and the blur lives on a separate
       `headerGlass` layer stacked behind the content with `pointer-events:
       none`. Splitting them means the thing that's actually `position:
       sticky` never triggers Chrome's filter-plus-stickiness repaint path in
       the first place.
       `transform: translateZ(0)` + `will-change: transform` used to also sit
       here, forcing this element onto its own GPU compositor layer. Per this
       comment's own prior note they were already "not enough on their own"
       to prevent the dead zone above — the filter/content split is what
       actually does that — so they were live only as an unproven, unrequested
       hint. Removed at the user's explicit direction after a live report of
       wheel scroll going dead specifically after landing on the answer view;
       a forced compositor layer on a sticky, frequently-repositioned element
       is a real, documented way for some Chrome/GPU-driver combinations to
       mis-track which region owns wheel input, so dropping it is a reasonable
       thing to try even though it wasn't this file's previously-identified
       cause. See the matching note on `panel` below — same change, same
       reasoning. */
    header: {
      flexShrink: 0,
      position: "sticky", top: 0, zIndex: 20,
    },
    headerGlass: {
      position: "absolute", inset: 0, zIndex: -1, pointerEvents: "none",
      borderBottom: glassBorder,
      background: P.dark ? withAlpha(P.bg, 0.75) : withAlpha(P.bg, 0.85),
      backdropFilter: "blur(14px) saturate(1.3)",
      WebkitBackdropFilter: "blur(14px) saturate(1.3)",
    },
    headInner: { maxWidth: 1120, margin: "0 auto", padding: `0 ${pad}px`, height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" },
    // v36: headActions picked up a 7th button ("Find People") without any
    // extra room to hold it — at gap:4 with no breathing room on either end,
    // seven icon buttons in a row read as one solid, cramped block. Bumped
    // gap and added a little padding on both rows so the header settles back
    // to feeling like a toolbar instead of a squeeze; brandRow's own
    // padding keeps it from crowding the search pill immediately next to it.
    brandRow: { display: "flex", alignItems: "center", gap: 12, paddingRight: 8, cursor: "pointer" },
    brand: { fontWeight: 700, fontSize: FONT_SIZES.heading, letterSpacing: "-0.03em", color: P.ink, fontFamily: "var(--cb-display)" },
    // Nudged from 7 toward more breathing room, but not all the way to a flat
    // 24px: the header now carries eight icon buttons (Document Mode joined
    // this row too), and 24px of gap between each would push the row past
    // brandRow's own width on anything narrower than a wide desktop window,
    // wrapping or clipping the rightmost buttons. 10 keeps the "toolbar, not
    // a squeeze" goal without reopening that overflow.
    headActions: { display: "flex", alignItems: "center", gap: isMobile ? 3 : 10, paddingLeft: isMobile ? 4 : 10 },
    // v6.6: this whole pill — including the plain word "Search" — was set in
    // --cb-mono (a JetBrains-Mono-first stack), which reads as a dev-tool/
    // terminal typeface for what's actually the single most-used control in
    // the header. Mono still belongs on the `Ctrl+K` shortcut chip itself
    // (that's the normal, expected convention — see `kbd` below, which sets
    // its own fontFamily independently and is untouched by this), just not
    // on the word next to it.
    cmdHint: { display: "flex", alignItems: "center", gap: 8, background: P.dark ? withAlpha(P.surface, 0.5) : P.surface, border: glassBorder, color: P.ink2, padding: "7px 10px 7px 14px", borderRadius: 3, cursor: "pointer", fontSize: FONT_SIZES.small, fontFamily: font, fontWeight: 500, letterSpacing: "-0.01em", boxShadow: P.shadowSm, marginRight: 4 },
    kbd: { fontSize: FONT_SIZES.micro, fontFamily: "var(--cb-mono)", color: P.faint, background: P.dark ? withAlpha(P.raised, 0.6) : P.bg, border: `1px solid ${P.line2}`, borderRadius: 4, padding: "2px 6px", fontWeight: 500 },
    ghostBtn: { background: "transparent", border: "none", color: P.ink2, padding: isMobile ? "8px" : "8px 12px", borderRadius: 3, cursor: "pointer", fontSize: FONT_SIZES.small, fontWeight: 500, fontFamily: font },
    iconBtn: { background: "transparent", border: "none", color: P.ink2, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, height: 38, minWidth: isMobile ? 40 : 38, padding: isMobile ? "0 8px" : "0 12px", borderRadius: 3, cursor: "pointer", fontSize: FONT_SIZES.small, fontWeight: 500, fontFamily: "var(--cb-body)", position: "relative" },
    iconBtnLabel: { lineHeight: 1 },
    countPill: { fontSize: FONT_SIZES.micro, fontWeight: 700, lineHeight: 1, background: accent, color: at, padding: "2px 6px", borderRadius: 3, minWidth: 16, textAlign: "center", marginLeft: isMobile ? 0 : -2, position: isMobile ? "absolute" : "static", top: isMobile ? 1 : undefined, right: isMobile ? 1 : undefined },

    /* ── App shell: fixed Sidebar + everything else shifted right of it ──
       The header used to carry every destination (New, Document, Trending,
       History, Saved, Collections, Find People, Settings) as its own icon
       button — a dozen controls fighting for one 56px-tall row. Those all
       live in the Sidebar now; the header keeps only the brand, the search
       command bar, and account/inbox. Desktop: sidebar is always visible
       and `appMain` is permanently offset by its width. Mobile: sidebar
       becomes a slide-in drawer (see `sidebarMobile*` below) and `appMain`
       stays full-width, opened with a hamburger button in the header. */
    sidebarWidth: 260,
    sidebar: {
      position: "fixed", top: 0, left: 0, bottom: 0, width: 260, zIndex: 30,
      background: P.surface, borderRight: `1px solid ${P.line}`,
      display: "flex", flexDirection: "column",
      transform: isMobile ? "translateX(-100%)" : "none",
      transition: "transform 240ms cubic-bezier(0.4, 0, 0.2, 1)",
    },
    sidebarMobileOpen: { transform: "translateX(0)", boxShadow: "0 0 40px rgba(0,0,0,0.4)" },
    sidebarBrand: { display: "flex", alignItems: "center", gap: 10, padding: "18px 18px 14px", cursor: "pointer", flexShrink: 0 },
    sidebarNav: { flex: 1, overflowY: "auto", padding: "6px 12px", display: "flex", flexDirection: "column", gap: 2 },
    sidebarSectionLabel: { fontSize: FONT_SIZES.micro, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: P.faint, fontFamily: "var(--cb-mono)", padding: "14px 10px 6px" },
    sidebarItem: {
      display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left",
      padding: "10px 12px", borderRadius: 8, border: "none", background: "transparent",
      color: P.ink2, cursor: "pointer", fontSize: FONT_SIZES.small, fontWeight: 500,
      fontFamily: "var(--cb-body)", transition: "background 150ms ease, color 150ms ease",
    },
    sidebarItemActive: { background: withAlpha(accent, 0.14), color: P.ink, fontWeight: 600 },
    sidebarItemBadge: { marginLeft: "auto", fontSize: FONT_SIZES.micro, fontWeight: 700, color: P.faint, background: P.dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)", padding: "2px 7px", borderRadius: 100, fontFamily: "var(--cb-mono)" },
    sidebarFooter: { flexShrink: 0, padding: "10px 12px 14px", borderTop: `1px solid ${P.line}`, display: "flex", flexDirection: "column", gap: 2 },
    // `position: relative` + `zIndex: 1` are load-bearing, not decoration:
    // without them this is a plain static box, which CSS paints in the
    // in-flow layer — strictly below ANY positioned element in the same
    // stacking context, even one at zIndex: 0/1, regardless of DOM order.
    // `.cb-ambient` (S.ambient, a few hundred lines up) is exactly such an
    // element: position:fixed, zIndex:1, a 72%-black scrim meant only to
    // dim the WebGL aurora behind it (LivingBackground, zIndex:0). With
    // appMain unpositioned, that scrim was painting over EVERYTHING inside
    // it too — the whole "search" hero (title, subhead, search bar, evidence
    // chips, trust row, footer) rendered through a 72%-black wash, which is
    // why "Cerebrum" sampled as flat rgb(71,71,71) instead of the white
    // P.ink the inline style plainly set: 255*(1-0.72) = 71, exactly. The
    // Sidebar was never affected because it already carries its own
    // zIndex:30. Other full-page views (Settings/Trending/etc.) already
    // dodge this independently — they're wrapped in S.pageView, which sets
    // this same {position:relative, zIndex:1} and, being later in the DOM
    // than .cb-ambient, wins document-order tiebreaking at the tied
    // zIndex:1. Giving appMain the identical treatment covers every view it
    // wraps (the search hero included) with the same one fix, rather than
    // relying on each view to separately remember to opt in.
    appMain: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", marginLeft: isMobile ? 0 : 260, position: "relative", zIndex: 1 },

    /* ── Full-page views (Profile / Settings / Trending) ──
       Replace what used to be centered modal dialogs — no backdrop, no
       fixed positioning, no close button. Each fills `appMain` below the
       header and scrolls the normal document way, same as the search
       results thread does. */
    // Opaque on purpose: LivingBackground's animated canvas sits fixed
    // behind the whole app shell so it can show through the search hero's
    // deliberately translucent panels. Profile/Settings/Trending replace
    // that hero entirely and are meant to read as solid pages, not another
    // translucent layer over a paused-but-still-painted canvas frame — so
    // unlike the hero, these get a flat P.bg fill of their own.
    //
    // `position: relative` + `zIndex: 1` are load-bearing, not decoration:
    // LivingBackground's own wrapper is `position: absolute; z-index: 0`
    // (see `ambient` above), and a plain static box — which this was —
    // never wins a stacking fight against ANY positioned element, even one
    // sitting at z-index 0, no matter how opaque its background is or how
    // tall it grows to cover the content. That let the canvas paint on TOP
    // of this fill the moment the page had enough content to scroll (the
    // gap only showed up scrolled past the first screenful, which is why
    // the original opaque-background fix looked complete on an unscrolled
    // check but wasn't). Giving this box its own stacking position at a
    // z-index above the canvas's is the actual fix; the header above uses
    // the same trick at zIndex 20 for the same reason.
    pageView: { flex: 1, width: "100%", background: P.bg, minHeight: "100%", position: "relative", zIndex: 1 },
    pageViewInner: { maxWidth: 920, width: "100%", margin: "0 auto", padding: isMobile ? "24px 18px 60px" : "40px 32px 80px" },
    pageViewTitle: { fontSize: FONT_SIZES.hero * 0.7, fontWeight: 700, letterSpacing: "-0.02em", color: P.ink, fontFamily: "var(--cb-display)" },

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
    heroGlow: { display: "none" },
    heroMark: { marginBottom: 32, position: "relative" },
    heroTitle: {
      fontSize: isMobile ? 52 : 84, fontWeight: 700,
      letterSpacing: "-0.05em", lineHeight: 0.92,
      color: P.ink, marginBottom: 24, position: "relative",
      // v29: was `--cb-display` fed through `--cb-body` (Inter) — the round,
      // friendly grotesque the user called out by name on the wordmark.
      // `--cb-display` is Space Grotesk, this file's own designated
      // "engineered" face (see the typography comment at the top of the
      // file) — that's what a command-center wordmark should be set in.
      fontFamily: "var(--cb-display)",
    },
    heroSub: {
      fontSize: isMobile ? FONT_SIZES.subhead : FONT_SIZES.heading, color: P.ink2,
      maxWidth: 560, lineHeight: 1.65, marginBottom: 52,
      letterSpacing: "-0.01em", position: "relative", fontWeight: 300,
      // v30: "Darknode" round retired — mono in the subheadline was that
      // round's signature move, and this round's explicit target
      // (Perplexity-style editorial) wants maximum legibility over
      // engineered edge. Back to the body sans-serif everywhere text is
      // meant to just be read.
      fontFamily: "var(--cb-body)",
    },

    /* ── Search bar: THE CONVERSATIONAL PILL ──
       v30: the "Darknode" HUD chassis (solid black, glowing 1px border, `>`
       prompt glyph, `[ ↵ ]` glyph button) is fully retired per direction —
       "zero retro hacker elements." Back to a wide, fully rounded floating
       glass pill with a plain conversational placeholder and a circular
       arrow button at the right edge. Enter still submits via the existing
       onKeyDown handler; the circular button is the pointer-friendly path. */
    searchShell: {
      display: "flex", alignItems: "center", gap: 10,
      width: "100%", maxWidth: 700,
      backdropFilter: "blur(40px) saturate(150%)",
      WebkitBackdropFilter: "blur(40px) saturate(150%)",
      background: P.dark ? "rgba(15, 17, 26, 0.75)" : "rgba(255, 255, 255, 0.85)",
      border: P.dark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.08)",
      borderRadius: 100,
      padding: isMobile ? "8px 8px 8px 20px" : "10px 10px 10px 24px",
      boxShadow: "0 8px 32px rgba(0,0,0,0.08)",
      transition: "border-color 0.3s ease, box-shadow 0.3s ease",
      position: "relative"
    },
    searchShellActive: {
      borderColor: P.line2,
      boxShadow: P.shadow
    },
    searchInput: {
      flex: 1, border: "none", outline: "none", background: "transparent",
      fontFamily: "var(--cb-body)", fontSize: FONT_SIZES.body, color: P.ink,
      minWidth: 0, letterSpacing: "-0.01em"
    },
    searchBtn: {
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: 38, height: 38, flexShrink: 0,
      background: P.dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
      color: P.ink,
      border: "1px solid " + P.line,
      borderRadius: "50%", cursor: "pointer",
      transition: "transform 0.15s ease, background 0.2s ease",
      boxShadow: "none",
    },

    /* ── Suggestion chips: fluid conversational prompts ──
       v30: were sharp-cornered "[ EXEC ]" command lines in mono — retired
       along with the rest of the terminal aesthetic. Fully rounded,
       minimal tags with a subtle border that gently lights up on hover;
       the label is now just the question, nothing prefixed onto it. */
    chips: { display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center", marginTop: 28, position: "relative", maxWidth: 700 },
    chip: {
      // Commit 46: was P.ink2 (secondary) at rest — explicit direction that
      // chips are one of the surfaces that must never render as dark grey
      // on black, so this is P.ink like the hover state already was,
      // rather than only brightening on interaction.
      fontSize: FONT_SIZES.small, color: P.ink,
      background: "transparent",
      border: "1px solid " + P.line,
      borderRadius: 100, padding: "10px 18px",
      cursor: "pointer",
      transition: "color 0.2s ease, background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease",
      fontFamily: "var(--cb-body)", letterSpacing: "-0.01em",
      outline: "none",
      WebkitTapHighlightColor: "transparent",
      boxSizing: "border-box",
    },
    chipHover: {
      borderColor: P.line2, color: P.ink,
      background: P.dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.02)",
      boxShadow: `0 0 0 1px ${P.dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)"}`,
      outline: "none",
    },
    trustRow: { display: "flex", flexWrap: "wrap", gap: 20, marginTop: 56, opacity: 0.4 },
    trustItem: { fontSize: FONT_SIZES.caption, fontWeight: 500, color: P.ink2, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "var(--cb-mono)" },

    /* ── Workspace: single-column editorial flow ──
       v6.4: widened from 760 to give the answer more room to breathe —
       previously the reading column was noticeably narrower than the answer
       card's own generous padding suggested it should be. */
    // v6.6: the top gap was only 40px on desktop — right under a 56px sticky
    // header, that put the eyebrow/headline close enough to the chrome above
    // it that the two read as one crowded block instead of "header, then a
    // clear new zone for the question." Given real room to breathe before
    // anything else starts, plus a matching bump below (see `headline` and
    // `qLabel` next to this) so the eyebrow → headline → answer-card rhythm
    // opens up gradually instead of everything landing within a few px.
    // v34: mobile has no separate scroll pane — the document itself scrolls —
    // so the bottom of the LAST answer is the bottom of this container. On a
    // phone that bottom edge sits directly under `mobSrcBtn`, the fixed
    // purple FAB pinned near the viewport's own bottom edge; without extra
    // room down here the FAB just sits on top of the final lines of text for
    // as long as the user is scrolled near the end. Padding the container
    // itself (rather than the FAB or some wrapper) guarantees real content
    // never lands in that reserved strip regardless of how long the answer
    // runs. Desktop keeps the old, smaller value — there's no floating FAB there.
    workspace: { display: "flex", flexDirection: "column", gap: 0, padding: isMobile ? "32px 0" : "72px 0 48px", paddingBottom: isMobile ? 120 : 48, flex: 1, maxWidth: 900, margin: "0 auto", width: "100%" },
    workspaceMobile: { maxWidth: "100%" },
    // v5: on anything wide enough to spare the room, sources shouldn't live
    // behind a FAB the whole session — that was true on a phone (no room for
    // a second column) but never actually true on desktop, it was just the
    // one drawer pattern doing double duty. Widening the row and giving the
    // sidebar its own fixed column turns "tap to see your sources" into
    // "they're just there," which is the whole point of a research tool.
    workspaceWithSidebar: { flexDirection: "row", alignItems: "flex-start", gap: 40, maxWidth: 1160 },
    thread: { minWidth: 0, flex: 1 },
    sidebarCol: { width: 340, flexShrink: 0 },

    /* ── Turn: clean editorial brief ── */
    turn: { marginBottom: isMobile ? 40 : 56 },
    qLabel: {
      fontSize: FONT_SIZES.micro, fontWeight: 600, letterSpacing: "0.14em",
      textTransform: "uppercase", color: accent,
      marginBottom: isMobile ? 16 : 20, display: "flex", alignItems: "center", gap: 8,
      fontFamily: "var(--cb-mono)",
    },
    qDot: { width: 4, height: 4, borderRadius: "50%", background: accent, boxShadow: `0 0 6px ${withAlpha(accent, 0.5)}` },
    headline: {
      fontWeight: 600, fontSize: isMobile ? FONT_SIZES.display : FONT_SIZES.hero,
      lineHeight: 1.25, marginBottom: isMobile ? 28 : 40,
      color: P.ink, letterSpacing: "-0.03em",
      fontFamily: "var(--cb-display)",
    },

    /* ── Answer card: DEFINED GLASS SURFACE ──
       Sits above the WebGLTopographyGrid field with its own solid
       P.surface fill and a hairline border, so the reading column stays
       a stable, high-contrast surface regardless of what the background
       canvas is doing underneath it. */
    answerCard: {
      position: "relative",
      background: P.dark ? "rgba(15, 17, 26, 0.75)" : "rgba(255, 255, 255, 0.85)",
      backdropFilter: "blur(40px) saturate(150%)",
      WebkitBackdropFilter: "blur(40px) saturate(150%)",
      border: P.dark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.08)",
      borderRadius: 3,
      padding: isCompact ? (isMobile ? "20px 16px" : "32px 40px") : (isMobile ? "32px 24px" : "56px 64px"),
      boxShadow: "0 8px 32px rgba(0,0,0,0.08)",
      lineHeight: 1.7,
      fontSize: isMobile ? FONT_SIZES.subhead : FONT_SIZES.heading,
    },
    byline: {
      fontSize: FONT_SIZES.micro, color: P.faint, 
      paddingTop: 16, marginTop: 20, 
      fontFamily: "var(--cb-mono)", display: "flex",
      letterSpacing: "0.04em", textTransform: "uppercase",
    },
    aiTag: { fontSize: FONT_SIZES.micro, color: P.faint, fontWeight: 500, letterSpacing: "0.04em", fontFamily: "var(--cb-mono)", textTransform: "uppercase" },
    loading: { display: "flex", alignItems: "center", gap: 12, color: P.ink2, fontSize: FONT_SIZES.body, padding: "14px 0 0" },
    spinner: { width: 16, height: 16, border: `2px solid ${P.line2}`, borderTopColor: accent, borderRadius: "50%", display: "inline-block", animation: "cbspin 0.7s linear infinite" },
    error: {
      padding: "20px 24px", background: withAlpha(STATUS.bad, 0.06), color: STATUS.bad,
      borderRadius: 3, fontSize: FONT_SIZES.body, lineHeight: 1.6,
      border: `1px solid ${withAlpha(STATUS.bad, 0.2)}`,
      display: "flex", alignItems: "flex-start", gap: 12,
      backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
    },
    followShell: { display: "flex", alignItems: "center", gap: 8, background: P.dark ? "rgba(15, 17, 26, 0.75)" : "rgba(255, 255, 255, 0.85)", backdropFilter: "blur(40px) saturate(150%)", WebkitBackdropFilter: "blur(40px) saturate(150%)", border: P.dark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.08)", borderRadius: 3, padding: isMobile ? "10px 8px 10px 16px" : "12px 12px 12px 22px", boxShadow: "0 8px 32px rgba(0,0,0,0.08)", transition: "border-color 0.3s ease, box-shadow 0.3s ease", marginTop: 24 },
    relatedWrap: { marginTop: 32, paddingTop: 28, borderTop: `1px solid ${P.line}` },
    relatedLabel: { fontSize: FONT_SIZES.micro, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: P.faint, marginBottom: 16, fontFamily: "var(--cb-mono)", display: "flex", alignItems: "center", gap: 8 },
    relatedList: { display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 },
    relatedBtn: {
      display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: 12, textAlign: "left", padding: "14px 18px",
      fontSize: FONT_SIZES.small, background: P.dark ? withAlpha(P.surface, 0.5) : P.surface, color: P.ink2,
      border: glassBorder, borderRadius: 3,
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
       separate layer.
       `transform: translateZ(0)` + `will-change: transform` removed for the
       same reason as `header` above — see that comment. This element is
       worth flagging as its own, more likely wheel-dead-zone suspect
       regardless of the compositor-hint question: it's the one sticky region
       that also scrolls internally (`overflowY: "auto"` right below), and it
       only exists in the DOM once a question's been asked — which matches a
       live report of the wheel "going dead after asking a question" more
       specifically than the header does (the header is present before asking
       too). If wheel-over-the-sidebar is still dead after this round, that
       nested-scroll-region angle — not the header — is the next thing to
       chase, not another compositor-hint removal. */
    panel: {
      position: "sticky", top: 24,
      background: P.dark ? "rgba(15, 17, 26, 0.75)" : "rgba(255, 255, 255, 0.85)",
      backdropFilter: "blur(40px) saturate(150%)",
      WebkitBackdropFilter: "blur(40px) saturate(150%)",
      border: P.dark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.08)",
      borderRadius: 3,
      padding: "20px", boxShadow: "0 8px 32px rgba(0,0,0,0.08)",
      maxHeight: "calc(100dvh - 110px)", overflowY: "auto",
    },
    panelMobile: { position: "fixed", top: 0, right: 0, height: "100dvh", width: isMobile ? "88vw" : "380px", maxWidth: 400, borderRadius: 0, maxHeight: "none", zIndex: 30, boxShadow: "-8px 0 40px rgba(0,0,0,0.5)" },
    srcHead: { display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: FONT_SIZES.caption, fontWeight: 600, color: P.ink, marginBottom: 16, letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: "var(--cb-mono)" },
    srcCount: { fontSize: FONT_SIZES.micro, fontWeight: 700, color: accent, background: withAlpha(accent, 0.1), padding: "3px 8px", borderRadius: 3, fontFamily: "var(--cb-mono)" },
    srcActions: { display: "flex", gap: 6, marginBottom: 12 },
    srcFilterInput: { width: "100%", padding: "9px 12px", fontSize: FONT_SIZES.small, border: glassBorder, background: P.dark ? withAlpha(P.bg, 0.5) : P.bg, color: P.ink, borderRadius: 3, outline: "none", fontFamily: "var(--cb-mono)", marginBottom: 10 },
    sortTabs: { display: "flex", gap: 2, background: P.dark ? withAlpha(P.bg, 0.4) : P.bg, padding: 3, borderRadius: 3, marginBottom: 14, border: `1px solid ${P.line}` },
    sortTab: { flex: 1, padding: "6px", fontSize: FONT_SIZES.caption, background: "transparent", color: P.ink2, border: "none", borderRadius: 3, cursor: "pointer", fontFamily: "var(--cb-mono)", fontWeight: 600, transition: "all 0.2s ease" },
    sortTabActive: { background: P.dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)", color: P.ink, boxShadow: "none", fontWeight: 600 },
    srcGroupLabel: { fontSize: FONT_SIZES.micro, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: accent, margin: "16px 0 8px", paddingBottom: 6, borderBottom: `1px solid ${P.line}`, fontFamily: "var(--cb-mono)" },
    sBtn: { flex: 1, fontSize: FONT_SIZES.caption, padding: "8px", background: P.dark ? withAlpha(P.bg, 0.5) : P.bg, color: P.ink2, border: glassBorder, borderRadius: 3, cursor: "pointer", fontFamily: "var(--cb-mono)", fontWeight: 600 },
    sBtnP: { flex: 1, fontSize: FONT_SIZES.caption, padding: "8px", background: P.ink, color: P.bg, border: "none", borderRadius: 3, cursor: "pointer", fontWeight: 600, fontFamily: "var(--cb-mono)" },
    savedNote: { fontSize: FONT_SIZES.caption, color: accent, marginBottom: 12, fontFamily: "var(--cb-mono)" },
    zBox: { background: P.dark ? withAlpha(P.bg, 0.5) : P.bg, border: glassBorder, borderRadius: 3, padding: 12, marginBottom: 12, display: "flex", flexDirection: "column", gap: 8 },
    zIn: { padding: "9px 12px", fontSize: FONT_SIZES.small, border: glassBorder, background: P.dark ? withAlpha(P.surface, 0.4) : P.surface, color: P.ink, borderRadius: 3, outline: "none", fontFamily: "var(--cb-mono)" },
    zMsg: { fontSize: FONT_SIZES.caption, color: accent, fontFamily: "var(--cb-mono)" },
    srcList: { display: "flex", flexDirection: "column", gap: 2 },
    empty: { fontSize: FONT_SIZES.small, color: P.faint, lineHeight: 1.5, padding: "12px 0" },
    srcItem: { padding: isCompact ? "10px 14px" : "16px 14px", margin: "0 -14px", borderRadius: 3, transition: "background 0.25s ease, transform 0.2s ease", borderBottom: `1px solid ${P.line}` },
    // v31: srcTitle was already inheriting the page's body font (`font`,
    // set on `page:` at the root) — never mono to begin with, so nothing to
    // change there. srcMeta was the one actually set to mono; switched to
    // body, since long author lists/journal names in a monospace face read
    // cramped and harder to scan than the same text in the body sans-serif.
    srcTitle: { fontSize: FONT_SIZES.small, textDecoration: "none", lineHeight: 1.45, fontWeight: 600, display: "block", marginBottom: 6, transition: "color 0.2s ease", letterSpacing: "-0.01em" },
    srcMeta: { fontSize: FONT_SIZES.caption, color: P.ink2, lineHeight: 1.5, fontFamily: "var(--cb-body)" },
    srcRow: { display: "flex", gap: 6, marginTop: 10 },
    chipMini: { fontSize: FONT_SIZES.caption, padding: "4px 10px", border: "1px solid", borderRadius: 3, cursor: "pointer", fontFamily: "var(--cb-mono)", fontWeight: 600, background: "transparent", transition: "all 0.2s ease" },
    // v28: the old row (icon+text-label buttons, `flexWrap: "wrap"`) read as
    // a loose pile that reflowed onto 2-3 ragged lines the moment "Source
    // network"/"Timeline" showed up next to "Print / Save PDF" — six
    // variable-width labels fighting for one row. Replaced with a single
    // fixed-size icon-only toolbar (title/aria-label carry the words instead
    // of visible text) docked to the answer card's top-right corner via
    // `answerCard`'s new `position: relative` — it never wraps because it
    // never needs more room than its own icons.
    // v31: was its own chip — a bordered, blurred, tinted pill sitting on
    // the answer card. Direction this round is explicit: "remove the heavy
    // background color, border, and blur... let the icons sit invisibly
    // against the main answer card until hovered." Now the row is pure
    // layout, no chrome of its own — each icon's own hover wash (in
    // `ToolbarBtn`/`S_toolbarBtnBase`) is the only thing that ever renders.
    // v33: was top:14/right:14 — with answerCard's padding widened back out
    // (see that comment) the toolbar sat close enough to the card's own top
    // edge to crowd the header above it; pushed down/in a touch so it has
    // clear air on both sides.
    // v34: dropped `position: absolute` (and the top/right that went with it).
    // Docking it to the card's corner meant it had zero awareness of the
    // metadata badge sharing that header — on a narrow screen the badge's
    // text ran long enough to run straight under it, a real overlap, not
    // just tight spacing. It's now a normal-flow child of the flex row built
    // in `Turn` (`justifyContent: space-between`, `flexWrap: wrap`), so on a
    // wide screen it still lands at the opposite end of the row from the
    // badge, and on a narrow one it simply wraps to its own line instead of
    // stacking on top of anything.
    toolbar: { display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: 3, background: "transparent", border: "none", boxShadow: "none", zIndex: 2 },

    /* ── Footer ── */
    foot: { marginTop: "auto", padding: "32px 0 36px", textAlign: "center", borderTop: `1px solid ${P.line}`, marginLeft: isMobile ? 0 : -pad, marginRight: isMobile ? 0 : -pad, paddingLeft: pad, paddingRight: pad },
    footDbs: { fontSize: FONT_SIZES.micro, letterSpacing: "0.06em", color: P.faint, lineHeight: 1.7, fontFamily: "var(--cb-mono)", textTransform: "uppercase" },

    /* ── Mobile sources FAB ── */
    mobSrcBtn: { position: "fixed", bottom: "calc(18px + env(safe-area-inset-bottom, 0px))", right: 18, background: accent, color: at, border: "none", borderRadius: 3, padding: "14px 20px", fontSize: FONT_SIZES.small, fontWeight: 600, cursor: "pointer", boxShadow: `0 6px 24px ${withAlpha(accent, 0.4)}, 0 2px 8px rgba(0,0,0,0.2)`, zIndex: 20, fontFamily: "var(--cb-mono)", display: "inline-flex", alignItems: "center", gap: 8, backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" },
    scrim: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", zIndex: 25 },

    /* ── Command palette ── */
    cmdWrap: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "14vh", zIndex: 50 },
    cmdBox: { width: 560, maxWidth: "92vw", background: P.dark ? P.surface : P.raised, border: glassBorder, borderRadius: 3, boxShadow: "0 24px 80px rgba(0,0,0,0.6)", overflow: "hidden", fontFamily: font },
    cmdInputRow: { display: "flex", alignItems: "center", gap: 12, padding: "16px 18px", borderBottom: `1px solid ${P.line}` },
    cmdInput: { flex: 1, border: "none", outline: "none", background: "transparent", fontSize: FONT_SIZES.subhead, color: P.ink, fontFamily: "var(--cb-mono)" },
    cmdList: { maxHeight: 340, overflowY: "auto", padding: 8 },
    cmdSection: { fontSize: FONT_SIZES.micro, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: P.faint, padding: "12px 14px 6px", fontFamily: "var(--cb-mono)" },
    cmdItem: { width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", fontSize: FONT_SIZES.small, color: P.ink, background: "transparent", border: "none", borderRadius: 3, cursor: "pointer", fontFamily: font, textAlign: "left", transition: "background 0.15s" },

    /* ── Modals ── */
    modalWrap: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 40, padding: 16 },
    modal: { background: P.dark ? "rgba(15, 17, 26, 0.85)" : "rgba(255, 255, 255, 0.92)", backdropFilter: "blur(40px) saturate(150%)", WebkitBackdropFilter: "blur(40px) saturate(150%)", border: P.dark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.08)", borderRadius: 3, padding: 28, width: 480, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", fontFamily: font, boxShadow: "0 24px 80px rgba(0,0,0,0.6)" },
    modalTitle: { fontSize: FONT_SIZES.display, fontWeight: 400, color: P.ink, marginBottom: 24, letterSpacing: "-0.03em", fontFamily: "var(--cb-display)" },
    // v7.0 cleanup: setLabel/palRow/palCard/accentRow/accentDot/customDot
    // removed — leftovers from an older, untabbed Settings layout with an
    // inline palette/accent picker. The current tabbed Settings (Appearance
    // tab) has its own separate, actually-used markup for both; these six
    // were dead style objects with zero call sites anywhere in the file.
    modalClose: { width: "100%", padding: "13px", fontSize: FONT_SIZES.body, fontWeight: 600, background: accent, color: at, border: "none", borderRadius: 3, cursor: "pointer", fontFamily: "var(--cb-display)" },
    soundGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 4 },
    soundBtn: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", fontSize: FONT_SIZES.small, background: P.dark ? withAlpha(P.bg, 0.5) : P.bg, color: P.ink2, border: glassBorder, borderRadius: 3, cursor: "pointer", fontFamily: "var(--cb-mono)", fontWeight: 600 },
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
          background: "rgba(18,20,32,0.96)", color: "#fff", padding: "10px 16px", borderRadius: 3,
          fontSize: FONT_SIZES.small, fontWeight: 500, fontFamily: "var(--cb-mono)", boxShadow: "0 8px 28px rgba(0,0,0,0.3)",
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

/* ════════════════════════════════════════════════════════════════
   SIDEBAR — the App Shell's left-hand navigation.
   Replaces the old header's icon-button row (New, Document, Trending,
   History, Saved, Collections, Find People, Settings all fighting for
   space in one 56px bar). Four of these entries — Search, Trending,
   Settings, Profile — switch which full-page `view` fills the shell;
   the rest open their existing dialog exactly as the header buttons
   used to, just relocated here so the header itself can stay down to
   the brand, the search bar, and account/inbox.
   ════════════════════════════════════════════════════════════════ */
// Wrapped in React.memo: this nav rail's own props are all cheap primitives
// or already-stable references (P/accent/at are effectively stable per
// palette/accent choice, S is memoized, history/saved/user only change
// when their own data actually changes) once the callback props passed to
// it are also stabilized at the call site (see stableSidebarNavigate,
// handleSidebarCloseMobile, handleToggleMute, handleLogoClick in App) —
// without memo, this whole rail (and the nav-item hover handlers it
// recreates) re-rendered on every App state change, including something as
// frequent as a keystroke in the search box, even though almost none of
// those actually change anything Sidebar shows.
const Sidebar = React.memo(function Sidebar({ P, accent, at, S, view, onNavigate, isMobile, mobileOpen, onCloseMobile, user, history, saved, threads, muted, onToggleMute, onLogoClick }) {
  const NAV = [
    ["new", "New investigation", "plus", null],
    ["search", "Search", "search", null],
    ["document", "Document Mode", "bookOpen", null],
    ["trending", "Trending", "chart", null],
    ["history", "History", "history", history.length || null],
    ["saved", "Saved", "bookmark", saved.length || null],
    // Commit 46: promoted from a header icon button (opening a centered
    // InboxModal) to a first-class nav destination — see InboxView and the
    // "inbox" case in App's handleSidebarNavigate. Badge count is unread
    // "you have conversations" signal same as History/Saved above, not an
    // unread-message count (get-inbox doesn't return per-thread read state
    // yet) — good enough to show the Inbox isn't empty at a glance.
    ["inbox", "Inbox", "mail", threads.length || null],
  ];
  const hoverIn = (e) => { e.currentTarget.style.background = withAlpha(accent, 0.08); };
  const hoverOut = (key) => (e) => { if (view !== key) e.currentTarget.style.background = "transparent"; };
  const itemStyle = (key) => ({ ...S.sidebarItem, ...(view === key ? S.sidebarItemActive : {}) });

  const body = (
    <nav aria-label="Main" style={{ ...S.sidebar, ...(isMobile && mobileOpen ? S.sidebarMobileOpen : {}) }}>
      <div style={S.sidebarBrand} onClick={onLogoClick} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onLogoClick(); } }} aria-label="Back to landing page">
        <Mark size={18} accent={accent} glow={P.dark} />
        <span style={{ fontWeight: 700, fontSize: FONT_SIZES.subhead, color: P.ink, fontFamily: "var(--cb-display)" }}>Cerebrum</span>
      </div>
      <div style={S.sidebarNav}>
        {NAV.map(([key, label, icon, badge]) => (
          <button key={key} onClick={() => onNavigate(key)} style={itemStyle(key)} aria-current={view === key ? "page" : undefined}
            onMouseEnter={hoverIn} onMouseLeave={hoverOut(key)}>
            <Icon name={icon} size={17} />
            <span>{label}</span>
            {!!badge && <span style={S.sidebarItemBadge}>{badge}</span>}
          </button>
        ))}
        {user && (
          <button onClick={() => onNavigate("collections")} style={itemStyle("collections")} onMouseEnter={hoverIn} onMouseLeave={hoverOut("collections")}>
            <Icon name="folder" size={17} /><span>Collections</span>
          </button>
        )}
        {user && (
          <button onClick={() => onNavigate("findPeople")} style={itemStyle("findPeople")} onMouseEnter={hoverIn} onMouseLeave={hoverOut("findPeople")}>
            <Icon name="network" size={17} /><span>Find People</span>
          </button>
        )}
        <button onClick={() => onNavigate("settings")} style={itemStyle("settings")} onMouseEnter={hoverIn} onMouseLeave={hoverOut("settings")}>
          <Icon name="settings" size={17} /><span>Settings</span>
        </button>
      </div>
      <div style={S.sidebarFooter}>
        <button onClick={onToggleMute} style={S.sidebarItem} title={muted ? "Unmute" : "Mute"} onMouseEnter={hoverIn} onMouseLeave={hoverOut("__mute")}>
          <Icon name={muted ? "volumeOff" : "volumeOn"} size={17} />
          <span>{muted ? "Unmute" : "Mute"}</span>
        </button>
        <button onClick={() => onNavigate("profile")} style={itemStyle("profile")} onMouseEnter={hoverIn} onMouseLeave={hoverOut("profile")}>
          {user ? <span aria-hidden="true" style={{ width: 20, height: 20, borderRadius: "50%", background: withAlpha(accent, 0.18), color: accent, fontSize: FONT_SIZES.micro, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--cb-mono)", flexShrink: 0 }}>{(user.email || "?")[0].toUpperCase()}</span> : <Icon name="user" size={17} />}
          <span>{user ? "Profile" : "Sign in"}</span>
        </button>
      </div>
    </nav>
  );

  if (!isMobile) return body;
  return (
    <>
      {mobileOpen && <div onClick={onCloseMobile} className="cb-backdrop" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 29 }} />}
      {body}
    </>
  );
});

function App() {
  const isMobile = useIsMobile();
  const [entered, setEntered] = useState(false);
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
  // Commit 46: Inbox is now a real full-page `view` (like profile/settings/
  // trending) instead of a centered modal — see InboxView and the "inbox"
  // case in handleSidebarNavigate below. The old `inboxOpen` boolean is
  // gone; `view === "inbox"` is the single source of truth now.
  const [networkSearchOpen, setNetworkSearchOpen] = useState(false);
  const [notebookOpen, setNotebookOpen] = useState(false);
  const [hubOpen, setHubOpen] = useState(false);
  const [activeHubName, setActiveHubName] = useState("");
  // Which full-page view fills the app shell to the right of the Sidebar.
  // Profile, Settings, and Trending used to be centered modal dialogs
  // (UserProfileModal/Settings/TrendingModal) — each is now a real page
  // (ProfileView/SettingsView/TrendingView) swapped in here instead of
  // stacked on a backdrop. Everything else that used to live in the header
  // (Document Mode, History, Saved, Collections, Find People) stayed as
  // its existing dialog; only its trigger moved into the Sidebar.
  const [view, setView] = useState("search"); // "search" | "profile" | "settings" | "trending" | "inbox"
  const [sidebarMobileOpen, setSidebarMobileOpen] = useState(false);
  // Set by NetworkSearchModal's/InstitutionModal's "Message" button right
  // before switching to the Inbox view, so the Inbox lands on that
  // conversation instead of whatever was most recently active. InboxView
  // seeds its own activeId from this once, then calls back to clear it —
  // see the comment on that effect in InboxView for why the hand-back
  // matters.
  const [pendingThreadId, setPendingThreadId] = useState(null);
  // Profile — name/username/affiliation live in the `users` table now (see
  // functions/api/data.js's get-profile/update-profile), pulled down on
  // sign-in and pushed back up on every edit by the debounced sync effect
  // further down, same shape as the saved/history sync below. The
  // localStorage mirror is guest-mode-only scratch space: the profile modal
  // itself is only ever reachable once signed in (see the header button),
  // so nothing here is ever presented as real before an account exists to
  // back it.
  const [profile, setProfile] = useState(() => { try { return JSON.parse(localStorage.getItem("cb_profile") || "{}"); } catch { return {}; } });
  useEffect(() => { try { localStorage.setItem("cb_profile", JSON.stringify(profile)); } catch {} }, [profile]);
  // followers/badges are read-only server state (nothing edits them from
  // this modal directly — following happens from someone else's account,
  // badges are granted server-side), so they live separately from the
  // editable `profile` fields above instead of being folded into it.
  const [profileMeta, setProfileMeta] = useState({ followers: 0, badges: [] });
  // Inbox threads — real rows from get-inbox once signed in; stays empty
  // for guests and for any signed-in account with no conversations yet
  // (there's currently no "start a new conversation" flow anywhere in the
  // app, so a brand-new account's inbox is genuinely, correctly empty).
  const [threads, setThreads] = useState([]);
  const [networkGraphSources, setNetworkGraphSources] = useState(null);
  const [timelineSources, setTimelineSources] = useState(null);
  const [illustrateQuery, setIllustrateQuery] = useState(null);

  async function handleAuthed(authedUser, { checkImport }) {
    setUser(authedUser);
    setAuthOpen(false);
    const [savedRes, histRes, colRes, profileRes, inboxRes] = await Promise.all([
      apiDataGet("saved"), apiDataGet("history"), apiDataGet("collections"),
      apiDataGet("profile"), apiDataGet("inbox"),
    ]);
    const serverSaved = savedRes?.items || [];
    const serverHist = histRes?.items || [];
    setCollections(colRes?.items || []);
    // The account row always exists by the time a session exists (verify-code
    // creates it), so profileRes.user should always be present — but the
    // fetch itself can still fail (network blip, a 500), and silently
    // keeping whatever was in localStorage beats wiping a signed-in
    // person's profile fields back to blank over a transient error.
    if (profileRes?.user) {
      setProfile((p) => ({
        ...p,
        name: profileRes.user.name || "",
        username: profileRes.user.username || "",
        affiliation: profileRes.user.affiliation || "",
        degree: profileRes.user.degree || "",
        grad_year: profileRes.user.grad_year || "",
        avatar_base64: profileRes.user.avatar_base64 || "",
      }));
      setProfileMeta({ followers: profileRes.followers || 0, badges: profileRes.badges || [] });
    }
    setThreads(inboxRes?.items || []);
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
    setProfile({}); setProfileMeta({ followers: 0, badges: [] }); setThreads([]);
    sfx();
  }

  // Deletion is real and immediate server-side (see functions/api/auth.js's
  // "delete-account" action — a cascading DELETE, not a soft flag). Clearing
  // the local mirrors too means nothing about the account lingers anywhere
  // this browser can still show, matching what "delete my account" should
  // actually mean.
  function onAccountDeleted() {
    setUser(null); setSyncReady(false); setCollections([]); setSaved([]); setHistory([]);
    setProfile({}); setProfileMeta({ followers: 0, badges: [] }); setThreads([]);
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
  const [settingsInitialTab, setSettingsInitialTab] = useState("general");
  const [drawerSource, setDrawerSource] = useState(null);
  const [focusedSourceIdx, setFocusedSourceIdx] = useState(-1);
  const [evidenceFilter, setEvidenceFilter] = useState("all");
  const [dataDensity, setDataDensity] = useState(() => getCookie("cb_density") || "comfortable");
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
  // v6.6: this used to default every first-time visitor into "cinematic" —
  // a continuously-rendering CDN-loaded WebGL scene (Vanta.js/three.js, long
  // since replaced — see LivingBackground's own comment) running behind a
  // page that ALSO leans hard on `backdrop-filter: blur(...)` for the
  // header, answer card, search bar, and chips. Those two together were a
  // well-known perf collision: every frame the WebGL canvas changed, every
  // blurred element sitting over it had to recompute its blur from scratch,
  // continuously, whether or not anyone was even scrolling — and it lined up
  // with a real, repeated report of laggy, unresponsive wheel-scroll that
  // only a scrollbar drag could get past. LivingBackground is now a plain,
  // much cheaper 2D canvas with no continuous GPU scene behind it, but the
  // CSS-only `ambient` wash (see makeStyles) already gives every visitor a
  // real sense of depth/atmosphere at effectively zero cost regardless, so
  // there's no reason to default animation on for everyone — it stays one
  // click away in Settings → Appearance for anyone who wants it.
  // v29: this defaulted to "off", which meant the ENTIRE WebGL background
  // system built across the last several commits (WebGLFluidRipples,
  // VantaCellsField, WebGLNeuralField) never actually rendered for a first-
  // time visitor — the only thing they ever saw was the static `.cb-ambient`
  // gradient wash underneath it. That's the real root cause behind "the
  // background looks cloudy, not tech": there was no WebGL on screen to look
  // sharp OR cloudy, just the blur. Flipped to "cinematic" so the
  // (now-brightened) WebGL layer is what a new visitor actually sees.
  // `prefers-reduced-motion` still overrides this per-component (each WebGL
  // field checks it independently), so this doesn't fight accessibility —
  // it only changes what people who haven't opted out of motion get by
  // default. Respects an explicit stored preference either way.
  const [animationMode, setAnimationMode] = useState(() => getCookie("cb_anim2") || "cinematic");
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
  // v6.9: this used to also carry animPreset/animDensity/animOpacity —
  // three more pieces of persisted state, threaded all the way through
  // Settings' props and into LivingBackground, with no Settings control
  // that ever actually let a user change any of them (no onChange/setter
  // call site existed anywhere in the file besides these useState
  // initializers), AND LivingBackground's own render logic never read
  // `preset` or `opacity` at all and only used `density` in a dependency
  // array with no effect on what it computed. Pure dead weight — removed.
  // `animSpeed` is the one that actually does something (LivingBackground
  // scales the ConstellationField's drift speed by it), so it's kept, and
  // now has a real control below instead of being permanently stuck at its
  // default.
  const [animSpeed, setAnimSpeed] = useState(() => parseFloat(getCookie("cb_animS") || "1"));
  // v31: the per-screen background STYLE choice (bgStyleIntro/bgStyleMain,
  // and the four components it picked between) is retired — Intro and the
  // main app shell each get one fixed, dedicated field now (Orb / SoftAurora,
  // v32). `animationMode` above still governs whether it's on at all, and
  // `animSpeed` below still scales it (see LivingBackground's own comment).
  const [highContrast, setHighContrast] = useState(() => getCookie("cb_hc") === "1");
  const [fontSize, setFontSize] = useState(() => getCookie("cb_fs") || "medium");
  const [reducedTransparency, setReducedTransparency] = useState(() => getCookie("cb_rt") === "1");
  const [autoplay, setAutoplay] = useState(() => getCookie("cb_ap") !== "0");
  const [dyslexicFont, setDyslexicFont] = useState(() => getCookie("cb_df") === "1");
  const [lineSpacing, setLineSpacing] = useState(() => getCookie("cb_ls") || "normal");
  const [focusHighlight, setFocusHighlight] = useState(() => getCookie("cb_fh") === "1");
  const [paletteName, setPaletteName] = useState(() => getCookie("cb_pal") || "Sage");
  const [accentName, setAccentName] = useState(() => getCookie("cb_accent") || "Sage");
  const [customAccent, setCustomAccent] = useState(() => getCookie("cb_ca") || "");
  const [hover, setHover] = useState("");
  const [hoverCite, setHoverCite] = useState(0);
  const inputRef = useRef(null);
  const cmdRef = useRef(null);
  // A quiet tribute, not a feature: the version badge used to read "DP" —
  // a private nod to Dolly Parton, kept as an initialism nobody would think
  // twice about. Now that it's spelled out as a real version number,
  // pressing and holding the badge surfaces the tribute directly, for
  // anyone curious enough to try. Doesn't touch any other state, doesn't
  // persist anything — genuinely just for whoever finds it.
  const dpEggRef = useRef({ longPressed: false, timer: null });
  const threadRef = useRef(null);
  const mutedRef = useRef(false);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  const P = PALETTES[paletteName] || PALETTES.Sage;
  // "Mono" isn't a real color swatch — it means "match the current palette's
  // own ink," which is why it's derived from P.dark rather than read out of
  // ACCENTS. Any other named accent (Sage, or a future addition) is a real
  // fixed hex and should render as itself regardless of palette darkness —
  // this used to hardcode the Mono branch unconditionally, silently ignoring
  // accentName for every non-Mono swatch (invisible while Mono was the only
  // entry in ACCENTS; became a real bug the moment a second one was added).
  const accent = (customAccent && /^#[0-9a-fA-F]{6}$/.test(customAccent))
    ? customAccent
    : accentName === "Mono"
      ? (P.dark ? "#ffffff" : "#000000")
      : (ACCENTS[accentName] || (P.dark ? "#ffffff" : "#000000"));
  const at = accentText(accent);
  // v6.4 perf: makeStyles() builds a large tree of inline-style objects —
  // previously rebuilt from scratch on every single render (every keystroke
  // in the search box, every hover-state change, every busy tick during a
  // typewriter animation). Memoizing it means that work only happens when
  // something it actually depends on changes.
  const S = useMemo(() => makeStyles(P, accent, at, isMobile, dataDensity), [P, accent, at, isMobile, dataDensity]);
  // Stable identity (reads mutedRef, a ref, so it never needs to change) —
  // matters beyond just avoiding one function allocation per render: it's
  // what lets the Sidebar-facing callbacks built from it below (see
  // handleLogoClick) stay stable in turn, which is what actually lets
  // React.memo(Sidebar) skip re-rendering the nav rail on unrelated App
  // state changes (typing in the search box, hover states, etc.) instead
  // of bailing out on a "new function every render" prop every time.
  const sfx = useCallback(() => { if (!mutedRef.current) Audio.click(); }, []);

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
      const res = await fetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: question, image: imageToSend || undefined, history: prior, settings: { answerLength, factCheck, evidenceFilter: evidenceFilter !== "all" ? evidenceFilter : undefined }, pinnedSources, corrections }) });
      if (!res.ok) {
        let errData = {};
        try { errData = await res.json(); } catch {}
        setError(errData.error || "Something went sideways. Try that again?"); setBusy(false); return;
      }
      // Stream response body via ReadableStream — reads chunks as they arrive.
      // Currently the backend sends a single JSON payload; when it's upgraded
      // to chunked/SSE, this reader renders content progressively with zero
      // frontend changes needed.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (value) buf += decoder.decode(value, { stream: !done });
        if (done) break;
      }
      let data;
      try { data = JSON.parse(buf); }
      catch { setError("Got an unexpected response from the server. Try that again?"); setBusy(false); return; }
      if (!data || typeof data !== "object") { setError("Got an unexpected response from the server. Try that again?"); setBusy(false); return; }
      const turnId = Date.now() + Math.random();
      const nt = { id: turnId, q: question || "What does this image show?", hasImage: !!imageToSend, answer: data.answer || "", sources: data.sources || [], videos: data.videos || [], source: data.source || "", factCheck: data.factCheck || null, literatureConflicts: data.literature_conflicts || null, related: data.related || [], suggestions: data.suggestions || [], fresh: typewriter };
      const looksLikeCorrection = /^(actually|no,?\s+it['']?s|no,?\s+they['']?re|correction[:,]|wrong\b|that['']?s\s+(wrong|incorrect|not right))/i.test(question) || /you\s+(said|got|had|were)\s+.+\s+(wrong|actually|but|however)/i.test(question) || /\bnot\s+\w+,?\s+(it['']?s|they['']?re|but)\s+/i.test(question);
      if (looksLikeCorrection) { setCorrections((prev) => [...prev, question].slice(-20)); }
      setTurns((t) => [...t, nt]);
      setAllSources((prev) => { const seen = new Set(prev.map(sourceKey)); return [...prev, ...(data.sources || []).filter((s) => !seen.has(sourceKey(s)))]; });
      if (turns.length === 0) setSessions((s) => [{ q: question, ts: Date.now() }, ...s].slice(0, 40));
      if (!mutedRef.current) Audio.pop();
      videosPromise.then(({ videos }) => { if (videos && videos.length) { setTurns((prev) => prev.map((t) => t.id === turnId ? { ...t, videos } : t)); } });
    } catch (e) { setError(`Couldn't reach the backend. Give it a second and try again. (${e.message})`); }
    finally { setBusy(false); }
  }, [input, attachedImage, busy, turns, answerLength, factCheck, typewriter, isMobile, pinnedSources, corrections, evidenceFilter]);

  useEffect(() => { if (entered && !isMobile && !cmdOpen) inputRef.current?.focus(); }, [entered, isMobile, cmdOpen]);

  // Keyboard navigation: J/K steps through source cards, Enter opens
  // PaperDrawer for the focused card, Escape closes it. Only active when
  // no modal/overlay is open and no input is focused — so it never
  // conflicts with typing in the search bar or the command palette.
  useEffect(() => {
    const onNav = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (view !== "search" || cmdOpen || savedOpen || historyOpen || authOpen || collectionsOpen) return;
      const srcCount = allSources.length;
      if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        setFocusedSourceIdx((prev) => { const next = Math.min(prev + 1, srcCount - 1); return srcCount > 0 ? Math.max(next, 0) : -1; });
      } else if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        setFocusedSourceIdx((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
        if (focusedSourceIdx >= 0 && focusedSourceIdx < srcCount && !drawerSource) {
          e.preventDefault();
          setDrawerSource(allSources[focusedSourceIdx]);
        }
      } else if (e.key === "Escape" && drawerSource) {
        e.preventDefault();
        setDrawerSource(null);
      }
    };
    window.addEventListener("keydown", onNav);
    return () => window.removeEventListener("keydown", onNav);
  }, [allSources, focusedSourceIdx, drawerSource, view, cmdOpen, savedOpen, historyOpen, authOpen, collectionsOpen]);

  // Auto-attribution clipboard: when text containing citation brackets
  // [N] is copied from an answer card, append full references to the
  // clipboard payload so the pasted text is properly sourced.
  useEffect(() => {
    const onCopy = (e) => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;
      const anchor = sel.anchorNode;
      if (!anchor) return;
      // Only intercept copies originating inside an answer card
      const card = anchor.parentElement?.closest?.(".cb-answer-enter");
      if (!card) return;

      const text = sel.toString();
      const citeRe = /\[(\d+)\]/g;
      const cited = new Set();
      let match;
      while ((match = citeRe.exec(text)) !== null) {
        cited.add(parseInt(match[1], 10));
      }
      if (cited.size === 0) return;

      // Build reference strings from the current turn's sources
      const refs = [];
      for (const idx of [...cited].sort((a, b) => a - b)) {
        const si = idx - 1;
        if (si < 0 || si >= allSources.length) continue;
        const s = allSources[si];
        const parts = [];
        if (s.authors) parts.push(s.authors);
        if (s.title) parts.push(`"${s.title.replace(/<\/?(sub|sup|i|b)>/gi, "")}"`);
        if (s.journal) parts.push(s.journal);
        if (s.year) parts.push(`(${s.year})`);
        if (s.url) parts.push(s.url);
        refs.push(`[${idx}] ${parts.join(". ")}`);
      }
      if (refs.length === 0) return;

      e.preventDefault();
      const attributed = text + "\n\n— References —\n" + refs.join("\n") + "\n\nRetrieved via Cerebrum (askcerebrum.org)";
      e.clipboardData.setData("text/plain", attributed);
    };
    document.addEventListener("copy", onCopy);
    return () => document.removeEventListener("copy", onCopy);
  }, [allSources]);

  // v6.4: was threadRef.current.scrollTop = threadRef.current.scrollHeight —
  // unconditionally, on every new turn AND every busy toggle. That's a real
  // regression on its own: if someone scrolls UP to re-read an earlier
  // answer and then asks a follow-up (or the current answer just finishes
  // streaming), this used to yank them all the way back down regardless of
  // where they were reading — reported live as the page "jumping" out from
  // under them. Standard chat-UI fix: only auto-scroll-to-latest if the
  // user was ALREADY near the bottom (i.e. they were following along), so
  // scrolling away to read something is respected instead of fought.
  // v6.5: this depended on the whole `turns` array, not just its length —
  // so ANY in-place patch to an existing turn (e.g. the delayed
  // `videosPromise.then()` above attaching videos to a turn well after its
  // answer already finished rendering) produced a new array reference and
  // re-ran this effect. If the reader was anywhere near the bottom at that
  // moment — which they almost always are, having just watched the answer
  // finish — it silently yanked them back down mid-read, felt from the
  // outside like "I can't scroll up after it answers." The fix: only care
  // about turns.length (a real new turn was appended) and busy (streaming
  // started/stopped) — not incidental field mutations on existing turns.
  useEffect(() => {
    const doc = document.documentElement;
    const distanceFromBottom = doc.scrollHeight - (window.scrollY + doc.clientHeight);
    const wasNearBottom = distanceFromBottom < 300;
    // v6.5: `window.scrollTo(x, y)` (the two-number form) resolves its
    // scroll behavior from the `scroll-behavior` CSS property on <html> —
    // and this file sets `html { scroll-behavior: smooth }` globally. That
    // means this "snap to the latest turn" call was never actually instant:
    // it kicked off a ~300-500ms animated glide every time. If the user
    // picked up the wheel during that glide — which is exactly when
    // they're most likely to, right as an answer finishes — their wheel
    // input and the browser's own smooth-scroll animation fought each
    // other, and it read as "the page won't scroll." Passing an explicit
    // `behavior: "instant"` bypasses the CSS smooth-scroll entirely for
    // this programmatic correction, so it can never fight live input; the
    // CSS smooth-scroll still applies everywhere it's supposed to (the
    // "back to top" button below, anchor links, etc).
    if (wasNearBottom) window.scrollTo({ top: doc.scrollHeight, left: 0, behavior: "instant" });
  }, [turns.length, busy]);
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
    const anyOverlayOpen = cmdOpen || savedOpen || howItWorksOpen || mobilePanel || historyOpen
      || authOpen || collectionsOpen || compareOpen || !!networkGraphSources || !!timelineSources || !!illustrateQuery || !!importPrompt || v5Open || !!drawerSource;
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
      // Same CSS smooth-scroll gotcha as the auto-follow effect above: this
      // is a silent technical restore (putting the page back exactly where
      // it was before a modal locked it), not a user-facing glide — it
      // should be invisible, not animated.
      window.scrollTo({ top: scrollY, left: 0, behavior: "instant" });
    };
  }, [cmdOpen, savedOpen, howItWorksOpen, mobilePanel, historyOpen, authOpen, collectionsOpen, compareOpen, networkGraphSources, timelineSources, illustrateQuery, importPrompt, v5Open, drawerSource]);
  useEffect(() => { setCookie("cb_snd", soundMode); }, [soundMode]);
  useEffect(() => { setCookie("cb_len", answerLength); }, [answerLength]);
  useEffect(() => { setCookie("cb_fc", factCheck ? "1" : "0"); }, [factCheck]);
  useEffect(() => { setCookie("cb_muted", muted ? "1" : "0"); }, [muted]);
  useEffect(() => { setCookie("cb_tw", typewriter ? "1" : "0"); }, [typewriter]);
  useEffect(() => { setCookie("cb_cite", citationStyle); }, [citationStyle]);
  useEffect(() => { setCookie("cb_anim2", animationMode); }, [animationMode]);
  useEffect(() => { const t = setTimeout(() => setCookie("cb_animS", String(animSpeed)), 500); return () => clearTimeout(t); }, [animSpeed]);
  useEffect(() => { setCookie("cb_pal", paletteName); }, [paletteName]);
  useEffect(() => { setCookie("cb_accent", accentName); }, [accentName]);
  useEffect(() => { setCookie("cb_density", dataDensity); }, [dataDensity]);
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
      else if (e.key === "Escape") { setCmdOpen(false); setMobilePanel(false); setSavedOpen(false); setHistoryOpen(false); setConfirmClearSaved(false); setHistoryConfirmId(null); setView((v) => (v === "search" ? v : "search")); }
      else if ((e.metaKey || e.ctrlKey) && e.key === "/") { e.preventDefault(); setView((v) => (v === "settings" ? "search" : "settings")); }
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

  // Pushes name/username/affiliation edits to the account, debounced exactly
  // like saved/history above. Unlike those two, a failure here is surfaced
  // instead of swallowed — "couldn't sync my saved articles" can fail
  // silently and just retry next edit, but "that username is already taken"
  // (see update-profile in functions/api/data.js) is something the person
  // typing needs to actually see, not lose track of.
  const profileSyncTimer = useRef(null);
  useEffect(() => {
    if (!user || !syncReady) return;
    clearTimeout(profileSyncTimer.current);
    profileSyncTimer.current = setTimeout(() => {
      apiDataAction("update-profile", {
        name: profile.name || "",
        username: profile.username || "",
        affiliation: profile.affiliation || "",
        degree: profile.degree || "",
        grad_year: profile.grad_year || "",
      }).catch((e) => toast(e.message || "Couldn't save your profile changes.", { tone: "error" }));
    }, 900);
    return () => clearTimeout(profileSyncTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.name, profile.username, profile.affiliation, profile.degree, profile.grad_year, user, syncReady]);

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
    setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, left: 0, behavior: "instant" }), 60);
  }
  // Single dispatch point for every Sidebar item. Four destinations (search,
  // trending, settings, profile) swap the full-page `view`; the rest open
  // their existing dialog exactly as the old header buttons did — moving
  // here only relocated the trigger, not the underlying feature.
  function handleSidebarNavigate(key) {
    sfx();
    if (isMobile) setSidebarMobileOpen(false);
    switch (key) {
      case "new": newSession(); setView("search"); break;
      case "search": setView("search"); break;
      case "document": setNotebookOpen(true); break;
      case "trending": setView("trending"); break;
      case "history": setHistoryOpen(true); break;
      case "saved": setSavedOpen(true); break;
      case "collections": if (user) setCollectionsOpen(true); break;
      case "settings": setSettingsInitialTab("general"); setView("settings"); break;
      case "findPeople": if (user) setNetworkSearchOpen(true); break;
      case "inbox": if (user) setView("inbox"); else { setAuthInitialTab("login"); setAuthOpen(true); } break;
      case "profile": if (user) setView("profile"); else { setAuthInitialTab("login"); setAuthOpen(true); } break;
      default: break;
    }
  }
  // handleSidebarNavigate itself reads turns/input/allSources indirectly
  // through newSession, so it (correctly) gets a new identity every render
  // those change — which is most keystrokes. Sidebar is wrapped in
  // React.memo below specifically so it stops re-rendering on the rest of
  // App's state churn, but a memo only pays off if EVERY prop it receives
  // is reference-stable; handing it handleSidebarNavigate directly would
  // hand it a "changed" onNavigate prop on exactly the renders memo is
  // trying to skip, defeating it entirely. The standard fix for "stable
  // callback identity, always-current behavior" is a ref that's kept
  // pointed at the latest closure (same pattern as mutedRef above, updated
  // in an effect rather than during render) behind one callback whose own
  // identity never changes.
  const handleSidebarNavigateRef = useRef(handleSidebarNavigate);
  useEffect(() => { handleSidebarNavigateRef.current = handleSidebarNavigate; });
  const stableSidebarNavigate = useCallback((key) => handleSidebarNavigateRef.current(key), []);
  const handleSidebarCloseMobile = useCallback(() => setSidebarMobileOpen(false), []);
  const handleToggleMute = useCallback(() => setMuted((m) => !m), []);
  const handleLogoClick = useCallback(() => { sfx(); setEntered(false); setView("search"); }, [sfx]);
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
    { label: "Open settings", hint: kbdLabel("/"), run: () => { setCmdOpen(false); setView("settings"); } },
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
    return <Intro accent={accent} P={P} onEnter={() => { sfx(); setEntered(true); }} animationMode={animationMode} />;
  }

  const started = turns.length > 0 || busy;
  const exportList = saved.length ? saved : allSources;
  const relColor = (r) => r >= 65 ? STATUS.good : r >= 45 ? STATUS.warn : P.faint;
  const relLabel = (r) => r >= 65 ? "strong" : r >= 45 ? "partial" : "weak";
  // Used to color-code Preprint/Reference/Dataset badges differently from
  // a plain Journal source — ACCENTS.Amber/Violet/Sky don't exist anymore
  // (ACCENTS is just { Mono } now; see the comment on InfoPage's own
  // `accent` derivation for the same regression). Every one of those three
  // resolved to undefined, and this feeds straight into withAlpha() below
  // wherever s.type is Preprint/Reference/Dataset — precisely the types
  // gatherPapers() assigns to bioRxiv/medRxiv/arXiv and Zenodo/Figshare
  // results, not edge cases — so a completely ordinary search result would
  // crash the source badge it renders in. Falling through to the one real
  // accent color for every type, same as InfoPage's fix.
  const typeColor = () => accent;

  const SourceCard = (s, i) => (
    <div key={i} className="cb-fade" style={{
      ...S.srcItem,
      borderLeft: `2px solid ${withAlpha(relColor(s.relevance ?? 0), 0.5)}`,
      background: hover === "src" + i ? withAlpha(accent, 0.06) : hoverCite === i + 1 ? withAlpha(accent, 0.07) : focusedSourceIdx === i ? withAlpha(accent, 0.04) : "transparent",
      boxShadow: hover === "src" + i ? `0 6px 20px ${withAlpha(accent, 0.1)}` : focusedSourceIdx === i ? `inset 0 0 0 1px ${withAlpha(accent, 0.4)}` : "none",
      transform: hover === "src" + i ? "translate3d(2px, -1px, 0)" : "translate3d(0, 0, 0)",
      cursor: "pointer",
    }} onMouseEnter={() => setHover("src" + i)} onMouseLeave={() => setHover("")} onClick={() => setDrawerSource(s)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDrawerSource(s); } }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 5, flexWrap: "wrap" }}>
        {s.type && <span style={{ fontSize: FONT_SIZES.micro, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: typeColor(s.type), background: withAlpha(typeColor(s.type), 0.1), padding: "2px 6px", borderRadius: 4, fontFamily: "var(--cb-mono)" }}>{s.type}</span>}
        {/* v5: the "strong/partial/weak" word already existed (relLabel)
            but only ever reached a `title` tooltip — invisible to touch,
            keyboard, and screen-reader users, who only ever saw a bare
            color-coded percentage. Now it's always on screen. */}
        {typeof s.relevance === "number" && <span style={{ fontSize: FONT_SIZES.micro, fontWeight: 600, color: relColor(s.relevance), background: withAlpha(relColor(s.relevance), 0.1), padding: "2px 6px", borderRadius: 4, fontFamily: "var(--cb-mono)" }}>{s.relevance}% · {relLabel(s.relevance)}</span>}
        {s.year && <span style={{ fontSize: FONT_SIZES.micro, color: P.faint, fontFamily: "var(--cb-mono)" }}>{s.year}</span>}
      </div>
      {/* v34 had simplified this to stripping <sub>/<sup>/<i>/<b> outright —
          "CO2" instead of "CO<sub>2</sub>" reads clean, but it also flattens
          "<i>E. coli</i>" to "E. coli" with the italics (and the species-name
          convention they signal) gone. v36: back to rendering the four
          whitelisted tags as real elements via renderCleanTitle (same
          safe, non-dangerouslySetInnerHTML parser already used at its other
          call site below) — a formula still reads clean AND a species name
          still reads like one. */}
      <a href={safeHref(s.url)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ ...S.srcTitle, color: hover === "src" + i ? accent : P.ink }}>{(s.title ? renderCleanTitle(s.title) : s.url)}</a>
      <div style={S.srcMeta}>{[s.authors, s.journal].filter(Boolean).join(" · ")}{typeof s.citations === "number" && ` · ${s.citations.toLocaleString()} cit.`}</div>
      <div style={S.srcRow}>
        <button style={{ ...S.chipMini, display: "inline-flex", alignItems: "center", gap: 4, color: isSaved(s) ? at : P.ink2, background: isSaved(s) ? accent : "transparent", borderColor: isSaved(s) ? accent : P.line2 }} onClick={(e) => { e.stopPropagation(); toggleSave(s); }}><Icon name={isSaved(s) ? "bookmarkFilled" : "bookmark"} size={11} />{isSaved(s) ? "Saved" : "Save"}</button>
        <button style={{ ...S.chipMini, display: "inline-flex", alignItems: "center", gap: 4, color: isPinned(s) ? at : P.ink2, background: isPinned(s) ? accent : "transparent", borderColor: isPinned(s) ? accent : P.line2 }} onClick={(e) => { e.stopPropagation(); togglePin(s); }} title={isPinned(s) ? "Pinned to conversation" : "Pin for follow-ups"}><Icon name={isPinned(s) ? "pinFilled" : "pin"} size={11} />{isPinned(s) ? "Pinned" : "Pin"}</button>
        {s.authors && <button style={{ ...S.chipMini, color: accent, borderColor: P.line2 }} onClick={(e) => { e.stopPropagation(); setMobilePanel(false); ask(`papers by ${(s.authors || "").replace(" et al.", "")}`); }}>Author →</button>}
      </div>
    </div>
  );

  const SourcesInner = (
    <>
      <div style={S.srcHead}><span>Sources</span><span style={S.srcCount}>{allSources.length}</span></div>
      {pinnedSources.length > 0 && (<div style={{ padding: "7px 10px", margin: "0 0 8px", background: withAlpha(accent, 0.06), border: `1px solid ${withAlpha(accent, 0.25)}`, borderRadius: 3, fontSize: FONT_SIZES.caption, color: accent, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontFamily: "var(--cb-mono)" }}><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="pinFilled" size={11} />{pinnedSources.length} pinned</span><button onClick={() => setPinnedSources([])} style={{ background: "transparent", border: "none", color: accent, cursor: "pointer", fontSize: FONT_SIZES.caption, textDecoration: "underline" }}>Clear</button></div>)}
      {corrections.length > 0 && (<div style={{ padding: "7px 10px", margin: "0 0 8px", background: withAlpha(STATUS.warn, 0.06), border: `1px solid ${withAlpha(STATUS.warn, 0.25)}`, borderRadius: 3, fontSize: FONT_SIZES.caption, color: STATUS.warn, display: "flex", alignItems: "center", gap: 6, justifyContent: "space-between", fontFamily: "var(--cb-mono)" }}><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="edit" size={11} />{corrections.length} correction{corrections.length === 1 ? "" : "s"}</span><button onClick={() => setCorrections([])} style={{ background: "transparent", border: "none", color: STATUS.warn, cursor: "pointer", fontSize: FONT_SIZES.caption, textDecoration: "underline" }}>Clear</button></div>)}
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
    // v6.7: "High contrast" used to force every text element to pure white
    // unconditionally, in one CSS rule with no idea which theme was
    // active. In dark mode that's genuinely high contrast; in light mode
    // it's white text on a light background — the opposite of the feature's
    // entire purpose, and exactly the "everything is unreadable" report.
    // Two theme-specific classes let the CSS actually flip direction
    // instead of only ever forcing white.
    highContrast && "cb-high-contrast",
    highContrast && (P.dark ? "cb-hc-dark" : "cb-hc-light"),
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
      <div style={S.ambient} className="cb-ambient" aria-hidden="true" />
      {animationMode !== "off" && <LivingBackground accent={accent} P={P} intensity={animationMode} speed={animSpeed} paused={view !== "search"} variant="main" />}
      <div style={S.grain} />
      <GuidedTour P={P} accent={accent} />
      {started && <div className="cb-scroll-progress" style={{ transform: "scaleX(" + scrollProg + ")" }} />}
      {showScrollTop && <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} style={{ position: "fixed", bottom: isMobile ? 80 : 24, left: 24, width: 36, height: 36, borderRadius: "50%", background: P.dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.06)", border: "none", color: P.ink2, cursor: "pointer", zIndex: 15, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(8px)", fontSize: FONT_SIZES.subhead }}>↑</button>}
      <Sidebar
        P={P} accent={accent} at={at} S={S}
        view={view} onNavigate={stableSidebarNavigate}
        isMobile={isMobile} mobileOpen={sidebarMobileOpen} onCloseMobile={handleSidebarCloseMobile}
        user={user} history={history} saved={saved} threads={threads} muted={muted}
        onToggleMute={handleToggleMute}
        onLogoClick={handleLogoClick}
      />
      <div style={S.appMain}>
      {/* Commit 46: the top header is gone for good — every destination it
          used to hold (search command bar, Inbox, Profile/Sign-in, the
          brand/back-to-landing mark) already lives in the Sidebar too (see
          sidebarBrand and the Profile/Sign-in footer item below), so nothing
          here was actually navigation-only. Two real, non-navigational
          casualties, deliberately not replaced:
          - The manual "V5" reopen button for the what's-new announcement.
            It still shows itself once automatically on first visit (see the
            v5Open effect above); there's just no way to deliberately
            re-open it afterward anymore.
          - The header's own visible "Search ⌘K" button. The keyboard
            shortcut itself is unaffected (still a global keydown listener,
            not wired to this button), and Sidebar's "Search" item already
            reaches the same search page by another route.
          The one genuinely load-bearing thing the header carried — opening
          the Sidebar on mobile, since a permanently-docked 260px rail
          doesn't fit next to search results on a phone screen — gets its
          own minimal floating trigger just below instead of a full bar. */}
      {isMobile && (
        <button
          className="cb-hbtn"
          onClick={() => { sfx(); setSidebarMobileOpen(true); }}
          aria-label="Open menu"
          title="Menu"
          style={{
            position: "fixed", top: 14, left: 14, zIndex: 21,
            width: 38, height: 38, borderRadius: "50%",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: P.dark ? withAlpha(P.bg, 0.75) : withAlpha(P.bg, 0.85),
            border: `1px solid ${P.line}`,
            backdropFilter: "blur(14px) saturate(1.3)", WebkitBackdropFilter: "blur(14px) saturate(1.3)",
            color: P.ink, cursor: "pointer",
          }}
        >
          <Icon name="menu" size={18} />
        </button>
      )}
      {view === "search" && (
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
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, padding: "6px 10px 6px 6px", background: P.dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)", border: `1px solid ${P.line}`, borderRadius: 3, maxWidth: "fit-content" }}>
                  <img src={attachedImage} alt="Attached" style={{ width: 32, height: 32, borderRadius: 3, objectFit: "cover" }} />
                  <span style={{ fontSize: FONT_SIZES.small, color: P.ink2, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{attachedImageName}</span>
                  <button onClick={() => { setAttachedImage(null); setAttachedImageName(""); }} aria-label="Remove image" style={{ background: "none", border: "none", color: P.faint, cursor: "pointer", padding: 2, display: "inline-flex" }}><Icon name="close" size={14} /></button>
                </div>
              )}
              <div className="cb-search-glow cb-search-shell" style={{ ...S.searchShell, ...(hover === "in" ? S.searchShellActive : {}), width: "100%", maxWidth: 700 }} onMouseEnter={() => setHover("in")} onMouseLeave={() => setHover("")}>
                  <input ref={inputRef} style={S.searchInput} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) ask(); }} placeholder="Ask anything..." />
                  <button onClick={() => imageInputRef.current?.click()} title="Attach an image" aria-label="Attach an image" style={{ background: "none", border: "none", cursor: "pointer", color: attachedImage ? accent : P.faint, display: "flex", alignItems: "center", padding: 4, flexShrink: 0 }}><Icon name="image" size={17} /></button>
                  <MicButton onTranscript={(t) => setInput(t)} accent={accent} P={P} />
                  <button
                    style={S.searchBtn} onClick={() => ask()} title="Ask" aria-label="Ask"
                    onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.06)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
                  ><Icon name="arrowRight" size={17} /></button>
              </div>
              {/* Evidence tier filter — pre-search constraint for study type */}
              <div className="cb-filter-row" style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 16, flexWrap: "wrap", maxWidth: 700 }}>
                {[["all", "All Evidence"], ["systematic-review", "Systematic Reviews"], ["rct", "RCTs"], ["in-vivo-vitro", "In Vivo / In Vitro"]].map(([val, label]) => (
                  <button key={val} onClick={() => { sfx(); setEvidenceFilter(val); }}
                    style={{
                      fontSize: FONT_SIZES.caption, fontFamily: "var(--cb-mono)", fontWeight: 600,
                      letterSpacing: "0.03em",
                      padding: "6px 14px", borderRadius: 100, cursor: "pointer",
                      transition: "all 0.2s ease",
                      background: evidenceFilter === val ? (P.dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)") : "transparent",
                      color: evidenceFilter === val ? P.ink : P.faint,
                      border: evidenceFilter === val ? "1px solid " + P.line2 : "1px solid " + P.line,
                    }}>{label}</button>
                ))}
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
                {busy && (<div style={S.turn}><div style={S.qLabel}><span style={S.qDot} /><span style={{ fontFamily: "var(--cb-mono)", fontSize: FONT_SIZES.caption, letterSpacing: "0.08em", textTransform: "uppercase" }}>Processing</span></div><Skeleton P={P} /><AgentTrace P={P} accent={accent} /></div>)}
                {error && <div role="alert" style={S.error} className="cb-fade"><span style={{ flexShrink: 0, display: "inline-flex" }}><Icon name="warning" size={18} /></span><div><div style={{ fontWeight: 600, marginBottom: 4 }}>Search failed</div><div style={{ opacity: 0.85 }}>{error}</div><button onClick={() => { setError(""); ask(turns.length ? turns[turns.length - 1].q : input); }} style={{ marginTop: 10, padding: "6px 14px", fontSize: FONT_SIZES.small, fontWeight: 600, background: withAlpha(STATUS.bad, 0.15), color: STATUS.bad, border: `1px solid ${withAlpha(STATUS.bad, 0.3)}`, borderRadius: 3, cursor: "pointer", fontFamily: "var(--cb-mono)" }}>Try again</button></div></div>}
                {turns.length > 0 && !busy && (<>
                  {attachedImage && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, padding: "6px 10px 6px 6px", background: P.dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)", border: `1px solid ${P.line}`, borderRadius: 3, maxWidth: "fit-content" }}>
                      <img src={attachedImage} alt="Attached" style={{ width: 32, height: 32, borderRadius: 3, objectFit: "cover" }} />
                      <span style={{ fontSize: FONT_SIZES.small, color: P.ink2, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{attachedImageName}</span>
                      <button onClick={() => { setAttachedImage(null); setAttachedImageName(""); }} aria-label="Remove image" style={{ background: "none", border: "none", color: P.faint, cursor: "pointer", padding: 2, display: "inline-flex" }}><Icon name="close" size={14} /></button>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                    {[["all", "All"], ["systematic-review", "Reviews"], ["rct", "RCTs"], ["in-vivo-vitro", "In Vivo/Vitro"]].map(([val, label]) => (
                      <button key={val} onClick={() => { sfx(); setEvidenceFilter(val); }}
                        style={{
                          fontSize: FONT_SIZES.micro, fontFamily: "var(--cb-mono)", fontWeight: 600,
                          padding: "4px 10px", borderRadius: 100, cursor: "pointer",
                          transition: "all 0.2s ease",
                          background: evidenceFilter === val ? (P.dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)") : "transparent",
                          color: evidenceFilter === val ? P.ink : P.faint,
                          border: evidenceFilter === val ? "1px solid " + P.line2 : "1px solid " + P.line,
                        }}>{label}</button>
                    ))}
                  </div>
                  <div style={{ ...S.followShell, ...(hover === "f" ? S.searchShellActive : {}) }} onMouseEnter={() => setHover("f")} onMouseLeave={() => setHover("")}>
                    <input style={S.searchInput} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) ask(); }} placeholder="Follow up — I remember the whole thread" />
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
            <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, lineHeight: 1.55, maxWidth: 520, margin: "0 auto 14px", textAlign: "center" }}>Answers are assembled from real papers by AI. Always check the cited sources.</div>
            <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, fontFamily: "var(--cb-mono)" }}>
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
      )}
      {view === "profile" && (
        <div style={S.pageView}>
          <ProfileView
            P={P} accent={accent} at={at} isMobile={isMobile}
            user={user} profile={profile} setProfile={setProfile} profileMeta={profileMeta}
            history={history} saved={saved} collections={collections}
            onOpenHistory={(h) => { openHistoryItem(h); setView("search"); }}
            onManageAccount={() => { setSettingsInitialTab("account"); setView("settings"); }}
          />
        </div>
      )}
      {view === "settings" && (
        <SettingsView {...{ P, accent, at, S, PALETTES, ACCENTS, paletteName, setPaletteName, accentName, setAccentName, customAccent, setCustomAccent, answerLength, setAnswerLength, factCheck, setFactCheck, muted, setMuted, typewriter, setTypewriter, soundMode, setSoundMode, animationMode, setAnimationMode, animSpeed, setAnimSpeed, sfx, setSessions, setSaved, saved, history, setHistory, highContrast, setHighContrast, fontSize, setFontSize, reducedTransparency, setReducedTransparency, autoplay, setAutoplay, dyslexicFont, setDyslexicFont, lineSpacing, setLineSpacing, focusHighlight, setFocusHighlight, citationStyle, setCitationStyle, user, onSignOut: signOut, onAccountDeleted, onOpenAuth: (tab) => { setAuthInitialTab(tab); setAuthOpen(true); }, initialTab: settingsInitialTab, close: () => setView("search"), dataDensity, setDataDensity, collections, turns }} />
      )}
      {view === "trending" && (
        <div style={S.pageView}><TrendingView P={P} accent={accent} at={at} isMobile={isMobile} /></div>
      )}
      {view === "inbox" && (
        <div style={S.pageView}>
          <InboxView
            P={P} accent={accent} at={at} isMobile={isMobile}
            threads={threads} setThreads={setThreads}
            initialThreadId={pendingThreadId}
            onConsumeInitialThread={() => setPendingThreadId(null)}
          />
        </div>
      )}
      </div>
      {started && isMobile && (<button style={{ ...S.mobSrcBtn, "--fab-glow": withAlpha(accent, 0.35) }} className="cb-fab-pulse" onClick={() => setMobilePanel(true)} aria-label={`Sources${allSources.length ? `, ${allSources.length}` : ""}`}><Icon name="sparkle" size={14} /><span>Sources</span>{allSources.length > 0 && <span style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, background: withAlpha(at, 0.22), padding: "2px 6px", borderRadius: 3, lineHeight: 1.3 }}>{allSources.length}</span>}</button>)}
      {started && isMobile && mobilePanel && (<><div style={S.scrim} onClick={() => setMobilePanel(false)} className="cb-backdrop" /><aside role="dialog" aria-modal="true" aria-label="Sources" style={{ ...S.panel, ...S.panelMobile }} className="cb-modal"><button style={{ ...S.ghostBtn, marginBottom: 14, display: "inline-flex", alignItems: "center", gap: 6 }} onClick={() => setMobilePanel(false)}><Icon name="close" size={13} /> Close</button>{SourcesInner}</aside></>)}
      {cmdOpen && (<div role="dialog" aria-modal="true" aria-label="Command palette" style={S.cmdWrap} onClick={() => setCmdOpen(false)}><div style={S.cmdBox} onClick={(e) => e.stopPropagation()} className="cb-pop"><div style={S.cmdInputRow}><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke={P.faint} strokeWidth="1.8" /><path d="M21 21l-4-4" stroke={P.faint} strokeWidth="1.8" strokeLinecap="round" /></svg><input ref={cmdRef} style={S.cmdInput} value={cmdQuery} onChange={(e) => setCmdQuery(e.target.value)} onKeyDown={onCmdKeyDown} placeholder="Search or type a command…" /><kbd style={S.kbd}>esc</kbd></div><div style={S.cmdList}>{cmdSuggest.length > 0 && <div style={S.cmdSection}>Ask</div>}{cmdSuggest.map((s, i) => (<button key={s} style={{ ...S.cmdItem, background: cmdActive === i ? withAlpha(accent, 0.1) : "transparent" }} onClick={() => ask(s)} onMouseEnter={() => setCmdActive(i)}><span style={{ color: accent }}>→</span>{s}</button>))}<div style={S.cmdSection}>Commands</div>{filteredCmds.map((c, i) => { const flatIdx = cmdSuggest.length + i; return (<button key={c.label} style={{ ...S.cmdItem, background: cmdActive === flatIdx ? withAlpha(accent, 0.1) : "transparent" }} onClick={c.run} onMouseEnter={() => setCmdActive(flatIdx)}><span>{c.label}</span>{c.hint && <kbd style={{ ...S.kbd, marginLeft: "auto" }}>{c.hint}</kbd>}</button>); })}</div></div></div>)}
      {savedOpen && (
        <div role="dialog" aria-modal="true" aria-label="Saved articles" style={S.modalWrap} onClick={() => { setSavedOpen(false); setConfirmClearSaved(false); }} className="cb-backdrop">
          <div style={{ ...S.modal, width: 520 }} onClick={(e) => e.stopPropagation()} className="cb-modal">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}><div style={S.modalTitle}>Saved articles</div><span style={S.srcCount}>{saved.length}</span></div>
            {saved.length === 0 ? (
              <div style={{ fontSize: FONT_SIZES.body, color: P.ink2, lineHeight: 1.6, padding: "20px 0 28px", textAlign: "center" }}>
                No saved articles yet.<br />
                <span style={{ fontSize: FONT_SIZES.small, color: P.faint, display: "inline-flex", alignItems: "center", gap: 5, marginTop: 4 }}><Icon name="bookmark" size={11} /> Save any source to keep it here.</span>
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
                      <a href={safeHref(s.url)} target="_blank" rel="noreferrer" style={{ ...S.srcTitle, fontSize: FONT_SIZES.body }}>{s.title ? renderCleanTitle(s.title) : s.url}</a>
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
              <div style={{ fontSize: FONT_SIZES.body, color: P.ink2, lineHeight: 1.6, padding: "20px 0 28px", textAlign: "center" }}>Nothing here yet.<br /><span style={{ fontSize: FONT_SIZES.small, color: P.faint }}>Starting a new investigation keeps the last one here so you can come back to it.</span></div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: "60vh", overflowY: "auto" }}>
                {history.map((h) => (
                  <div key={h.id} style={{ padding: "13px 10px", margin: "0 -10px", borderBottom: `1px solid ${P.line}`, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                    <button onClick={() => openHistoryItem(h)} style={{ flex: 1, textAlign: "left", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
                      <div style={{ fontSize: FONT_SIZES.body, fontWeight: 500, color: P.ink, lineHeight: 1.4 }}>{h.title}</div>
                      <div style={{ fontSize: FONT_SIZES.small, color: P.faint, marginTop: 3 }}>{(h.turns || []).length} exchange{(h.turns || []).length === 1 ? "" : "s"} · {new Date(h.ts).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</div>
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
      {howItWorksOpen && <HowItWorksModal P={P} accent={accent} close={() => setHowItWorksOpen(false)} />}
      {v5Open && <V5AnnouncementModal P={P} accent={accent} at={at} close={() => { try { localStorage.setItem("cb_seen_v6", "1"); } catch {} setV5Open(false); }} />}
      {authOpen && <AuthModal P={P} accent={accent} at={at} close={() => setAuthOpen(false)} onAuthed={(u) => handleAuthed(u, { checkImport: true })} />}
      {notebookOpen && <NotebookMode P={P} accent={accent} at={at} close={() => setNotebookOpen(false)} />}
      {networkSearchOpen && (
        <NetworkSearchModal
          P={P} accent={accent} at={at}
          close={() => setNetworkSearchOpen(false)}
          onMessage={(researcher, threadId) => {
            setNetworkSearchOpen(false);
            setPendingThreadId(threadId);
            setView("inbox");
          }}
          onOpenHub={(name) => {
            setNetworkSearchOpen(false);
            setActiveHubName(name);
            setHubOpen(true);
          }}
        />
      )}
      {hubOpen && (
        <InstitutionModal
          P={P} accent={accent} at={at}
          close={() => setHubOpen(false)}
          hubName={activeHubName}
          onMessage={(researcher, threadId) => {
            setHubOpen(false);
            setPendingThreadId(threadId);
            setView("inbox");
          }}
        />
      )}
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
      {drawerSource && <PaperDrawer P={P} accent={accent} at={at} S={S} source={drawerSource} onAskScoped={(q) => ask(q)} close={() => setDrawerSource(null)} />}
      <ToastHost P={P} accent={accent} />
    </div>
  );
}


/* ════════════════════════════════════════════════════════════════
   GLOBAL CSS
   Tight geometric display face. Blur-to-focus entrances. No bouncy
   springs. Everything slow, intentional, precise.
   ════════════════════════════════════════════════════════════════ */
const CSS = `
:root {
  --cb-display: 'Space Grotesk', 'Inter', system-ui, -apple-system, sans-serif;
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
/* v25 hotfix: this line used to also carry \`overflow-x: hidden\` and
   \`overscroll-behavior-y: contain\` directly on html/body. Per a live report
   of dead mouse-wheel scroll after asking a question, both were removed at
   the user's explicit direction — overflow-x hidden on the root html/body
   element, stacked with the sticky flex containers elsewhere on this page,
   is a real way for some Chrome/Windows builds to kill wheel scroll capture
   even though it isn't the cause this file had previously traced the bug to
   (see the \`header\`/\`panel\` style comments in makeStyles for that one).
   The horizontal-overflow containment this was doing still matters — this
   page has full-bleed decorative elements (the ambient wash, the WebGL
   backgrounds) that must never introduce a horizontal scrollbar — so it
   moved down to \`overflowX: "clip"\` on \`S.page\`, the actual app-shell
   wrapper, instead of the document root. \`overflow-x: clip\` (not
   \`hidden\`) on purpose: \`hidden\` creates a new scroll container of its
   own, which is exactly the kind of nested scrolling context this fix is
   trying to get rid of; \`clip\` suppresses the paint without doing that. */
html, body { margin: 0; }
/* Commit 43: iOS/macOS Safari runs its own automatic text-inflation
   algorithm on top of every font-size this app already sets — it silently
   scales body text up or down (independent of pinch-zoom) based on column
   width heuristics that this single-column app shell was never designed
   around, and it can re-trigger on rotation, making the same screen render
   at a different effective text size a moment later with no code change in
   between. Every size in FONT_SIZES is already deliberate; this switches
   Safari's own adjustment off so what's actually shipped is what renders,
   the same way it does in Chrome/Firefox. Has no effect outside WebKit. */
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }

/* Belt-and-suspenders guarantee that the decorative ConstellationField
   canvas (see LivingBackground) can never sit in the hit-test path for
   wheel, touch, or click input meant for the real page underneath it —
   the component already sets pointer-events:none inline, this just makes
   it non-negotiable via the stylesheet too. */
.cb-constellation-host, .cb-constellation-host canvas {
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

/* Scrollbar — hidden everywhere for a native-app feel; scroll still works
   via wheel/touch/keyboard, only the visible track+thumb chrome is gone. */
::-webkit-scrollbar { display: none; }
* { scrollbar-width: none; }

/* ── Keyframes: all blur-to-focus, slow, intentional ── */
@keyframes cbspin { to { transform: rotate(360deg); } }
.cb-spin { animation: cbspin 0.9s linear infinite; display: inline-flex; }
@keyframes cbShimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
@keyframes cbHuddlePulse { 0%, 100% { transform: scale(1); opacity: 0.7; } 50% { transform: scale(1.15); opacity: 0.35; } }
@keyframes cbpulse { 0%, 100% { box-shadow: 0 0 0 4px rgba(255,255,255,0.1); } 50% { box-shadow: 0 0 0 8px rgba(255,255,255,0.2); } }

/* v6.6: this used to drift via a continuous 34s transform animation. Given
   a live, repeated report of laggy/unresponsive scrolling, that's a risk not
   worth taking: this layer sits directly behind the header, answer card,
   search bar, and chips, every one of which uses a backdrop blur filter —
   and a blurred surface has to recompute its blur every single frame its
   backdrop changes, even from a "barely-there" transform. Static costs
   nothing (painted once, cached); animated costs a continuous repaint tax on
   every blurred element in the app, for a decorative effect that was never
   meant to be consciously noticed anyway. Depth without the tax. */
.cb-ambient { /* intentionally static — see comment above */ }

/* Horizontally-scrollable strips (the Settings tab bar on narrow viewports)
   still need to scroll with a finger or a wheel, just not show a visible
   scrollbar riding along under the tab labels. */
.cb-scroll-x { scrollbar-width: none; -ms-overflow-style: none; }
.cb-scroll-x::-webkit-scrollbar { display: none; height: 0; }

/* v43: every "to" frame below used to land on the value "filter: blur(0)"
   instead of the keyword "filter: none". Visually identical (zero-radius
   blur draws nothing) — but not the same value to the CSS engine: a filter
   of anything other than the literal keyword "none" makes the element a
   containing block for its fixed/absolute-positioned descendants, and with
   animation-fill-mode "both" that "to" state is what the element is left
   holding forever once the 200-700ms entrance animation finishes, not just
   while it's mid-flight. Every one of these classes sits on some ancestor
   of ordinary page content, so this was a standing landmine for any fixed
   or absolutely positioned element mounted underneath one — including
   Turn's own print/export overlay (see .cb-print-paper-doc and its fixed
   watermark, sitting under Turn's own "cb-rise" wrapper): once the entrance
   animation settled, that wrapper silently became the watermark's
   containing block instead of the viewport, and the export doc's own
   width:100% resolved against that narrow flex column instead of the full
   page — the reported "exports as one squeezed column" bug. Swapping the
   endpoint to the real "none" keyword removes the stray containing block
   with no visual change. */
@keyframes cbEnter {
  from { opacity: 0; transform: translateY(16px); filter: blur(8px); }
  to   { opacity: 1; transform: none; filter: none; }
}
@keyframes cbFade {
  from { opacity: 0; filter: blur(4px); }
  to   { opacity: 1; filter: none; }
}
@keyframes cbRise {
  from { opacity: 0; transform: translateY(12px); filter: blur(6px); }
  to   { opacity: 1; transform: none; filter: none; }
}
@keyframes cbPop {
  from { opacity: 0; transform: scale(0.97); filter: blur(4px); }
  to   { opacity: 1; transform: none; filter: none; }
}
@keyframes cbHero {
  from { opacity: 0; transform: translateY(20px); filter: blur(10px); }
  to   { opacity: 1; transform: none; filter: none; }
}
@keyframes cbGate {
  from { opacity: 0; transform: translateY(16px); filter: blur(8px); }
  to   { opacity: 1; transform: none; filter: none; }
}
@keyframes cbModal {
  from { opacity: 0; transform: translateY(16px) scale(0.98); filter: blur(6px); }
  to   { opacity: 1; transform: none; filter: none; }
}
@keyframes cbBackdrop { from { opacity: 0; } to { opacity: 1; } }
@keyframes cbSlideUp {
  from { opacity: 0; transform: translateY(24px); filter: blur(6px); }
  to   { opacity: 1; transform: none; filter: none; }
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

/* CTA shimmer — removed: monochrome CTA needs no shimmer */

/* ── Entrance classes: SNAPPY (200-250ms) — instant-feeling, not sluggish ── */
.cb-fade    { animation: cbFade  200ms var(--cb-ease) both; }
.cb-rise    { animation: cbRise  250ms var(--cb-ease) both; }
.cb-pop     { animation: cbPop   200ms var(--cb-ease) both; }
.cb-gate    { animation: cbGate  250ms var(--cb-ease) both; }
.cb-hero    { animation: cbHero  250ms var(--cb-ease) both; }
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
/* v31: dropped the same animated neon gradient .cb-gradient-text used to
   carry (see that class's comment) — this is the more visible instance of
   it, since it's the large per-letter hero wordmark on the home screen.
   Solid currentColor (P.ink from the parent's inline style), letter-in
   fade kept since that's staggering, not color. */
.cb-kinetic > span {
  color: currentColor;
  animation: cbLetterIn 500ms ease both;
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
.cb-stagger > * { opacity: 0; animation: cbFade 200ms var(--cb-ease) both; }
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
  box-shadow: 0 0 0 2px var(--cb-accent, #34d399) !important;
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
  to { opacity: 1; transform: none; filter: none; }
}

/* Suggestion chip hover ripple */
.cb-chip-hover {
  position: relative;
  overflow: hidden;
  outline: none !important;
}
.cb-chip-hover:focus,
.cb-chip-hover:focus-visible {
  outline: none !important;
  box-shadow: none;
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
  to { opacity: 1; transform: none; filter: none; letter-spacing: inherit; }
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

/* v31: was an animated emerald→sky→indigo gradient cycling every 8s behind
   the wordmark — exactly the "heavy 80s neon" look this round retires.
   Left as a plain class (no gradient, no clip, no animation) rather than
   deleted outright so the two call sites (header brand mark, home-screen
   hero title) don't need touching — solid color: currentColor from the
   element's own inline style (P.ink, already theme-correct) is what
   actually renders now. */
.cb-gradient-text { color: currentColor; }

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

/* ── High contrast ──
   Structural changes that apply regardless of theme (thicker borders,
   underlined links, bolder headings) live on the plain .cb-high-contrast
   class. Actual COLOR direction is theme-specific — .cb-hc-dark forces
   white-on-near-black, .cb-hc-light forces near-black-on-white — because a
   single unconditional "force everything white" rule (the old behavior)
   is only high-contrast in one of the two themes and is the exact opposite
   of legible in the other. Both variants also force a real solid
   background on cards/surfaces, not just text color: several surfaces in
   this app are semi-transparent "glass" panels by design, and a
   half-opaque background sitting over the ambient wash/photo-like content
   behind it can undercut the contrast ratio even when the text color
   itself is technically correct. */
.cb-high-contrast button { border-width: 2px !important; }
.cb-high-contrast h1, .cb-high-contrast h2, .cb-high-contrast h3,
.cb-high-contrast strong, .cb-high-contrast b { font-weight: 800 !important; }

.cb-hc-dark,
.cb-hc-dark p, .cb-hc-dark span, .cb-hc-dark div, .cb-hc-dark li,
.cb-hc-dark td, .cb-hc-dark label { color: #ffffff !important; }
.cb-hc-dark a { color: #5eead4 !important; text-decoration: underline !important; }
.cb-hc-dark h1, .cb-hc-dark h2, .cb-hc-dark h3 { color: #ffffff !important; }
.cb-hc-dark input, .cb-hc-dark select, .cb-hc-dark textarea {
  border: 2px solid rgba(255,255,255,0.4) !important; color: #ffffff !important; background: #000000 !important;
}
.cb-hc-dark { background: #000000 !important; }

.cb-hc-light,
.cb-hc-light p, .cb-hc-light span, .cb-hc-light div, .cb-hc-light li,
.cb-hc-light td, .cb-hc-light label { color: #0a0a0a !important; }
.cb-hc-light a { color: #0552b5 !important; text-decoration: underline !important; }
.cb-hc-light h1, .cb-hc-light h2, .cb-hc-light h3 { color: #000000 !important; }
.cb-hc-light input, .cb-hc-light select, .cb-hc-light textarea {
  border: 2px solid rgba(0,0,0,0.5) !important; color: #0a0a0a !important; background: #ffffff !important;
}
.cb-hc-light { background: #ffffff !important; }

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
.cb-solid-panels header { background: var(--cb-solid-bg, #000000) !important; }

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

/* AI Paper Generator's print-only layout. Hidden in the live app always
   (this rule applies outside @media print too, so the node sitting in the
   DOM never affects normal layout); the @media print block below overrides
   it back to visible ONLY while body carries .cb-printing-paper, which
   Turn's paperReady effect adds for exactly the duration of window.print(). */
.cb-print-paper-doc { display: none; }
@media print {
  body.cb-printing-paper * { visibility: hidden !important; }
  /* Belt-and-suspenders alongside the keyframe fix above: any lingering
     filter or transform on an ancestor (an entrance animation's finished
     state, a hover transform a mouse handler forgot to clear, etc.) makes
     that ancestor a containing block for the print doc's own fixed/absolute
     boxes, so the exported page sizes and centers itself against that
     ancestor's box instead of the printed page. Stripping both for every
     (invisible) element for the duration of the print closes that off
     entirely rather than relying on having found every source of it. */
  body.cb-printing-paper * { filter: none !important; transform: none !important; }
  body.cb-printing-paper .cb-print-paper-doc,
  body.cb-printing-paper .cb-print-paper-doc * { visibility: visible !important; }
  body.cb-printing-paper .cb-print-paper-doc {
    display: block !important; position: absolute; left: 0; top: 0; width: 100%; background: #fff !important; z-index: 999999;
  }
  .cb-paper-page {
    position: relative; z-index: 1; max-width: 7in; margin: 0 auto; padding: 0.6in 0 1in;
    font-family: "Times New Roman", Times, serif; color: #000 !important;
  }
  .cb-paper-title { font-size: 18pt; font-weight: 700; text-align: center; margin: 0 0 6pt; line-height: 1.3; }
  .cb-paper-byline { font-size: 10pt; text-align: center; color: #444 !important; margin: 0 0 28pt; font-style: italic; }
  .cb-paper-section-label { font-size: 12pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin: 22pt 0 8pt; border-bottom: 1pt solid #000; padding-bottom: 2pt; }
  .cb-paper-heading { font-size: 12pt; font-weight: 700; margin: 16pt 0 6pt; }
  .cb-paper-para { font-size: 11pt; line-height: 1.7; text-align: justify; text-indent: 0.3in; margin: 0 0 10pt; }
  .cb-paper-ref { font-size: 9.5pt; line-height: 1.5; text-indent: -0.25in; padding-left: 0.25in; margin: 0 0 6pt; text-align: left; }
  .cb-paper-watermark {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-35deg);
    font-size: 90pt; font-weight: 800; color: rgba(0,0,0,0.1) !important; z-index: 0;
    white-space: nowrap; font-family: "Helvetica Neue", Arial, sans-serif; pointer-events: none;
  }
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
   font (the system sans standing in for Space Grotesk on the hero
   headline), guaranteeing a visible flash-of-unstyled-text on every
   first visit.
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
  // v7.0: this also used to preload Vanta.js/three.js from a CDN here.
  // LivingBackground no longer depends on either — see its own comment —
  // so there's nothing left to preload for the background at all.
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
