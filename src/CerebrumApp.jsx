/**
 * CerebrumApp — the Cerebrum interface.
 *
 * This is the application: search and results, the evidence surfaces, the
 * library, profiles and messaging, settings, and every dialog and panel they
 * use. It was split out of main.jsx, which had grown to roughly 15,600 lines
 * and had become genuinely difficult to reason about — not because a large
 * file is wrong in itself, but because bootstrap, routing, styling and every
 * feature shared one scope, so nothing had a boundary.
 *
 * The split is deliberately shallow. Two application files, not thirty: the
 * features here reference each other constantly, and scattering them across a
 * directory of one-component modules would trade a long file for a long
 * import graph and make the connections harder to follow, not easier.
 *
 * main.jsx now holds only what runs before the interface exists — the React
 * root, the error boundary, the static-route dispatch and the startup side
 * effects. Genuinely separable concerns live in their own small modules:
 * cerebrumField.js (the WebGL renderer, so it can be lazy-loaded and its
 * lifecycle reasoned about on its own) and legalContent.js (shared with the
 * build-time prerenderer).
 */

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from "react";
import { PAGES as LEGAL_PAGES, LEGAL_VERSION, LEGAL_UPDATED } from "./legalContent.js";
import { staticFieldCss } from "./cerebrumField.js";
import { createPortal } from "react-dom";
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
  df.href = "/fonts/opendyslexic.css";
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
// Bumped whenever a batch of changes ships. This is the fastest way to
// answer "did my deploy actually go live?" — the footer prints it, so a
// stale bundle is visible in one glance instead of being diagnosed by
// hunting for a missing feature.
const APP_VERSION = "6.20.0";

/* Commit 69 — the legal layer.
   ---------------------------------------------------------------------
   LEGAL_VERSION is the single source of truth for "which version of the
   Terms, Privacy Policy and Disclosures has this person agreed to". It is
   stamped on every legal page, written into the cb_legal cookie when a
   person accepts, and recorded against their account row when they are
   signed in.

   BUMP IT whenever any of those three documents changes materially. Every
   user is then asked to review and accept again, because an agreement
   someone never saw is not an agreement. Do NOT bump it for a typo fix —
   re-prompting people for nothing trains them to click through without
   reading, which defeats the entire point of asking.

   NOTE FOR THE OPERATOR: this content is a thorough, good-faith draft, not
   legal advice, and it has not been reviewed by a lawyer. Section 17 of
   the Terms deliberately leaves the governing jurisdiction generic; that
   and the liability cap are the two clauses most worth having a solicitor
   or attorney look at before you rely on them. */

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
    if (!isJson) throw new Error("Couldn't reach the account service right now. It may not be deployed yet. Try again shortly, or contact support if this keeps happening.");
    // Surface the specific backend error (e.g. "Incorrect email or password",
    // "An account with that email already exists", "Too many attempts") so the
    // user sees exactly what went wrong rather than a generic catch-all.
    throw new Error(data.error || (res.status === 401 ? "Invalid credentials." : res.status === 429 ? "Too many requests. Wait a moment and try again." : "Something went wrong. Please try again."));
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
  /* Commit 95 — the same double period, one field over.
     v28 fixed it for the author string and stopped there. Titles have
     exactly the same problem and it is far more visible: PubMed ships a
     great many titles already terminated with a full stop ("...Gut
     Microbiome Functions."), and every style below appends its own, so
     real bibliographies were rendering "Functions.." on most entries.
     Same treatment, applied to the two fields that can arrive
     pre-terminated. */
  const endPunct = (v) => {
    const t = String(v || "").trim();
    if (!t) return t;
    return /[.!?]$/.test(t) ? t : t + ".";
  };
  const titleDot = endPunct(title);
  const journalDot = endPunct(journal);
  switch (style) {
    case "vancouver": {
      const parts = [`${index}. ${authorsPart}${titleDot}`];
      if (journal) parts.push(` ${journalDot}`);
      parts.push(` ${year}.`);
      return parts.join("");
    }
    case "apa": {
      return `${authorsPart}(${year}). ${titleDot} ${journal ? "*" + journal + "*." : ""}`.trim();
    }
    case "mla": {
      return `${authorsPart}"${titleDot}" *${journal || "n.p."}*, ${year}${url ? ", " + url : ""}.`;
    }
    case "chicago": {
      return `${authorsPart}${year}. "${titleDot}" *${journal || "n.p."}*.`;
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
      return `${index}. ${authors} ${titleDot} ${journal} ${year}.`;
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
    // Commit 65 — watched topics. A bell rather than a bookmark: watching a
    // topic isn't saving it, it's asking to be told when it changes.
    case "bell": return <svg {...common}><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 01-3.4 0" /></svg>;
    case "check": return <svg {...common}><path d="M20 6L9 17l-5-5" /></svg>;
    // v28: the toolbar's Copy button used to borrow "check" (a checkmark)
    // because it always had a visible "Copy answer" text label to carry the
    // actual meaning. Icon-only buttons can't lean on a label like that, so
    // Copy gets its own real clipboard glyph.
    case "copy": return <svg {...common}><rect x="8" y="8" width="12" height="12" rx="1.5" /><path d="M16 8V5.5A1.5 1.5 0 0014.5 4h-9A1.5 1.5 0 004 5.5v9A1.5 1.5 0 005.5 16H8" /></svg>;
    case "external": return <svg {...common}><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><path d="M15 3h6v6M10 14L21 3" /></svg>;
    case "chevronDown": return <svg {...common}><path d="M6 9l6 6 6-6" /></svg>;
    case "chevronRight": return <svg {...common}><path d="M9 6l6 6-6 6" /></svg>;
    // Commit 92 — the evidence table's toolbar button.
    case "table": return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 10v10" /></svg>;
    // Commit 87 — used by EvidenceFilter's disclosure trigger.
    case "filter": return <svg {...common}><path d="M3 5h18M7 12h10M11 19h2" /></svg>;
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
    case "eye": return <svg {...common}><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>;
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
    // Commit 98 — answer-quality feedback. /api/vote has existed since the
    // answer cache landed (and /api/search returns an answerId with the
    // comment "frontend can use this for upvote/downvote"), but nothing in
    // this file ever called it, so the score column that decides which
    // cached answers get served to everyone stayed permanently at 0.
    case "thumb-up": return <svg {...common}><path d="M7 20V10l4.2-7a2 2 0 013.6 1.5L14 9h4.6a2 2 0 011.95 2.45l-1.6 7A2 2 0 0117 20z" /><path d="M7 10H4v10h3z" /></svg>;
    case "thumb-down": return <svg {...common}><path d="M17 4v10l-4.2 7a2 2 0 01-3.6-1.5L10 15H5.4A2 2 0 013.45 12.55l1.6-7A2 2 0 017 4z" /><path d="M17 14h3V4h-3z" /></svg>;
    case "flag": return <svg {...common}><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" /></svg>;
    // Commit 48: standard "no entry" glyph (circle + diagonal bar) for
    // Block/Unblock controls — same off-slash language this file already
    // uses for micOff/cameraOff, applied to a plain circle instead of a
    // base glyph since "block" has no unblocked counterpart to slash.
    case "block": return <svg {...common}><circle cx="12" cy="12" r="9" /><line x1="5.5" y1="5.5" x2="18.5" y2="18.5" /></svg>;
    // Overflow "more actions" trigger — three dots, standard convention.
    case "moreVertical": return <svg {...common} fill="currentColor" stroke="none"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>;
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
    case "phone": return <svg {...common}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z" /></svg>;
    case "phoneOff": return <svg {...common}><path d="M22 16.9v3a2 2 0 01-2.18 2 19.8 19.8 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.34 1.85.57 2.81.7a2 2 0 011.72 2.03z" /><path d="M2 2l20 20" /></svg>;
    // Huddle minimize/expand — four arrowheads pointing inward (shrink to a
    // bubble) or outward (back to full screen), the standard convention.
    case "minimize2": return <svg {...common}><path d="M8 3v4a1 1 0 01-1 1H3M16 3v4a1 1 0 001 1h4M8 21v-4a1 1 0 00-1-1H3M16 21v-4a1 1 0 011-1h4" /></svg>;
    case "maximize2": return <svg {...common}><path d="M3 8V5a2 2 0 012-2h3M21 8V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3M21 16v3a2 2 0 01-2 2h-3" /></svg>;
    // Screen-share control: a monitor with an upload arrow — this project's
    // existing convention (see "external") uses a rectangle+arrow language
    // for "send this out," reused here for the same reason.
    case "screenShare": return <svg {...common}><rect x="2" y="4" width="20" height="14" rx="2" /><path d="M12 15V8M9 11l3-3 3 3" /><path d="M8 21h8" /></svg>;
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

/* ════════════════════════════════════════════════════════════════
   MOTION SYSTEM — the Intro's GSAP choreography, everywhere else
   ════════════════════════════════════════════════════════════════
   The Intro (see Intro() below) was the only surface in this app running
   real GSAP motion: a staggered power3.inOut timeline where each element
   rises from a small y-offset while fading up. Everything else was CSS
   keyframe classes (.cb-rise/.cb-fade/.cb-stagger) that fired at different
   durations, different easings, and — in .cb-stagger's case — with no
   y-motion at all, just opacity. Two different motion languages in one
   product reads as unfinished no matter how good either one is on its own.

   This is that single language, extracted once and reusable: same ease
   (power3.inOut), same "rise + fade" gesture, same staggering, applied to
   any container by wrapping it in <Reveal> or attaching useGsapReveal().

   Three details that are load-bearing, not preference:

   1. useLayoutEffect, not useEffect. GSAP's fromTo() sets its from-state
      when the tween is created; in a plain useEffect that happens AFTER the
      browser has already painted, so every reveal flashes its content at
      full opacity for one frame before snapping to invisible and animating
      in. Running before paint removes the flash entirely.

   2. clearProps: "all" on completion. A finished tween otherwise leaves an
      inline transform on the element forever, and a transformed ancestor
      becomes the containing block for any position:fixed descendant — the
      exact class of bug already documented on the cbEnter/cbRise keyframes
      further down this file (a fixed print watermark resolving against a
      narrow flex column instead of the viewport). Clearing on completion
      means these elements end in the same state they'd be in with motion
      switched off entirely.

   3. Auto-descent to the first level with real siblings. A view's root is
      usually a single wrapper div; staggering its one child is just a fade.
      Walking down until there's more than one sibling is what makes a page
      arrive section-by-section instead of as one block — without needing
      every view refactored to expose its sections.

   Honors the same "off" contract as every other animated surface here:
   the cb_anim2 cookie set in Settings, plus the OS-level
   prefers-reduced-motion, either of which skips the motion completely
   rather than merely shortening it. */
const CB_EASE = "power3.inOut";

// GSAP's lag smoothing (on by default) is the wrong trade for entrance
// animation. When the main thread stalls past its threshold, it clamps the
// delta it feeds every running tween — so instead of dropping frames and
// staying on schedule, animations stretch in wall-clock time. Measured on
// this app's own home screen with the WebGL LivingBackground running: a
// 1.05s hero reveal took ~12 SECONDS to finish, and because these tweens
// animate from autoAlpha: 0, the entire hero — wordmark, search bar,
// suggestion chips — sat invisible for most of it. A slow device is
// exactly when content must NOT be held hostage to the frame rate.
//
// lagSmoothing(0) makes tweens track real elapsed time: a stutter skips
// ahead instead of extending the animation. The visual cost is a jumpier
// animation on a struggling device; the thing it buys is that the page is
// always finished animating when it says it is.
try { gsap.ticker.lagSmoothing(0); } catch {}

function cbMotionOff() {
  try {
    if (getCookie("cb_anim2") === "off") return true;
  } catch {}
  try {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  } catch { return false; }
}

/* Reduced motion, watched live.
 *
 * Read once at module load, this would miss someone turning the preference on
 * while the app is open — which is exactly when it matters, because they are
 * turning it on in response to motion they can see. The listener keeps every
 * consumer in sync with the OS setting as it changes.
 *
 * Used by the motion system, the field renderer and any component that
 * chooses between an animated and a static presentation. */
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
  });
  useEffect(() => {
    let mq;
    try { mq = window.matchMedia("(prefers-reduced-motion: reduce)"); } catch { return undefined; }
    const onChange = () => setReduced(mq.matches);
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);
      else if (mq.removeListener) mq.removeListener(onChange);
    };
  }, []);
  return reduced;
}

/* ════════════════════════════════════════════════════════════════════════
   MOTION LANGUAGE

   One easing curve and one set of durations for the whole application, so
   every transition feels like it belongs to the same system. Before this the
   file carried several ad-hoc cubic-beziers and a spread of durations chosen
   per component.

   The three tiers correspond to what the motion is FOR:
     feedback  a control acknowledging a press
     panel     a surface arriving or leaving
     spatial   a major change of place, where the eye needs to be carried

   `--cb-ease` is the same curve the CSS layer uses, so a GSAP tween and a CSS
   transition on the same element cannot disagree.
   ════════════════════════════════════════════════════════════════════════ */
const MOTION = {
  feedback: 0.15,
  panel: 0.28,
  spatial: 0.55,
  // A single decelerating curve. Nothing overshoots: springy scientific text
  // reads as a toy, and the brief is explicit about it.
  ease: "cubic-bezier(0.16, 1, 0.3, 1)",
  gsapEase: "power3.out",
};

function useGsapReveal(deps = [], opts = {}) {
  const ref = useRef(null);
  const { y = 14, stagger = 0.05, duration = 0.8, delay = 0, descend = true } = opts;
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || cbMotionOff()) return;
    // Decorative layers (glows, rings, scrims) sit in the same DOM slot as
    // real content but shouldn't be sequenced with it — a backdrop that
    // rises alongside the text it sits behind makes the whole surface look
    // like it's sliding rather than assembling.
    let targets = Array.from(root.children).filter((el) => !el.hasAttribute("data-cb-no-reveal"));
    if (descend) {
      let guard = 0;
      while (targets.length === 1 && targets[0].children && targets[0].children.length > 1 && guard++ < 3) {
        targets = Array.from(targets[0].children);
      }
    }
    if (!targets.length) return;
    // Snapshot exactly the three inline properties this tween writes, so
    // they can be put back byte-for-byte when it finishes.
    //
    // clearProps was the obvious tool here and it is the wrong one in this
    // codebase: every element in this file is styled with React inline
    // style objects, and clearProps deletes properties from the same style
    // attribute React owns — it does not "revert to the stylesheet",
    // because for these elements there is no stylesheet. clearProps: "all"
    // wiped entire React style objects (confirmed on screen: the hidden
    // file input's display:none was erased so a raw "Choose File" control
    // appeared mid-hero, and the search bar lost its flex row and stacked
    // its own buttons vertically). Even narrowing it to clearProps:
    // "opacity" is wrong — the trust row is deliberately React-styled at
    // opacity 0.4, and clearing the property resets it to a fully opaque 1.
    //
    // Restoring per-property instead of restoring a whole cssText snapshot
    // is also deliberate: React can re-render mid-animation (a hover, a
    // rotating suggestion chip), and replaying a stale snapshot of the
    // entire style attribute would silently undo whatever it changed.
    const props = ["transform", "opacity", "visibility"];
    const before = targets.map((el) => props.map((k) => el.style[k]));
    const restore = () => {
      targets.forEach((el, i) => {
        props.forEach((k, j) => {
          const v = before[i][j];
          if (v) el.style[k] = v; else el.style.removeProperty(k);
        });
      });
    };

    const tl = gsap.timeline({ onComplete: restore });
    tl.fromTo(
      targets,
      { y, autoAlpha: 0 },
      { y: 0, autoAlpha: 1, duration, ease: CB_EASE, stagger },
      delay
    );
    return () => {
      tl.kill();
      // kill() stops the tween wherever it happens to be, which for an
      // autoAlpha tween means whatever partial opacity (or visibility:
      // hidden) it had reached stays inline on the element permanently. If
      // this effect is torn down mid-flight — a fast navigation away and
      // back, a deps change — that is content stuck half-faded or fully
      // invisible with nothing left running to finish it. Restoring here
      // means the worst case of an interrupted reveal is "no animation",
      // never "no content".
      restore();
    };
  }, deps);
  return ref;
}

// Drop-in wrapper for the hook above. `deps` is what re-fires the reveal —
// pass the view name (or a data key) so navigating between pages replays
// the entrance, the same way the Intro replays its own on mount.
function Reveal({ children, deps = [], y, stagger, duration, delay, descend, style, className, role, "aria-label": ariaLabel }) {
  const ref = useGsapReveal(deps, { y, stagger, duration, delay, descend });
  return <div ref={ref} className={className} style={style} role={role} aria-label={ariaLabel}>{children}</div>;
}

/* Commit 56 — audible ringing. A call that is silent on both ends doesn't
   read as a call: the person placing it has no feedback that anything is
   happening ("there's no dial tone"), and the person receiving it has to
   be looking at the screen to notice at all, which defeats the point of
   ringing them. Both tones are synthesized with WebAudio rather than
   shipped as audio files — a ringback is two sine tones, it costs nothing
   to generate, and it avoids adding binary assets to a repo that deploys
   by pasting source files.

   Deliberately follows the app's existing mute setting (the same cb_muted
   cookie the sfx helper uses), because a tone that ignores mute is the
   single most hostile thing an app can do.

   Two distinct patterns, matching what phones have trained everyone to
   expect: the CALLER hears a slow low ringback (440+480Hz, 2s on / 4s off,
   the North American pattern), and the CALLEE hears a brighter, more
   insistent double-pulse that is impossible to mistake for the other. */
// One-shot tone used for send/receive confirmations. Same mute contract as
// useCallTone below.
function cbBlip(freq, dur = 0.07, gain = 0.05) {
  try {
    if (getCookie("cb_muted") === "1") return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(gain, ctx.currentTime + 0.012);
    g.gain.linearRampToValueAtTime(0, ctx.currentTime + dur);
    g.connect(ctx.destination);
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    osc.connect(g); osc.start(); osc.stop(ctx.currentTime + dur);
    setTimeout(() => { try { ctx.close(); } catch {} }, (dur + 0.25) * 1000);
  } catch {}
}

// Commit 57 — OS-level notifications while Cerebrum is open.
//
// Not Web Push: that needs a service worker, VAPID keys and a server that
// can wake a closed browser, and it is a genuinely bigger build. This is
// the Notification API, which covers the case actually asked for — the
// person has Cerebrum open in a tab and is looking at something else. A
// message or an incoming call now surfaces in the OS notification centre
// instead of only inside a tab nobody is looking at.
//
// Permission is requested lazily, on the first event worth notifying about,
// never on page load: a permission prompt fired at someone who has not yet
// used the feature is the fastest way to get permanently denied.
// Commit 67 — notification categories.
//
// Cerebrum can raise three genuinely different kinds of desktop
// notification: an incoming call (someone is waiting on you right now), a
// direct message, and a watched-topic literature alert. Shipping all three
// behind a single browser permission prompt with no in-app control was the
// gap: a person who wants to be reachable for calls but does not want a
// paper alert at 2am had exactly one option, which was to deny
// notifications entirely and lose the calls too.
//
// Stored as a cookie like every other preference in this file so it
// survives without an account. Default "all" — the notifications that
// exist are all ones the user opted into by making a call, opening a
// conversation, or watching a topic, so none of them are unsolicited.
const NOTIFY_KINDS = ["call", "message", "watch"];
function notifyPref() {
  const raw = getCookie("cb_notify");
  if (raw === null || raw === "") return { call: true, message: true, watch: true };
  if (raw === "off") return { call: false, message: false, watch: false };
  const on = new Set(raw.split(","));
  return { call: on.has("call"), message: on.has("message"), watch: on.has("watch") };
}
function setNotifyPref(next) {
  const on = NOTIFY_KINDS.filter((k) => next[k]);
  setCookie("cb_notify", on.length ? on.join(",") : "off");
}
function cbNotify(title, body, tag, kind) {
  try {
    if (!("Notification" in window)) return;
    // An unrecognized/absent kind is always allowed through — a future
    // caller that forgets to pass one should still reach the user rather
    // than being silently swallowed by a preference it was never in.
    if (kind && NOTIFY_KINDS.includes(kind) && !notifyPref()[kind]) return;
    // Only when the tab isn't the thing they're looking at — a notification
    // for a conversation already on screen is noise.
    if (document.visibilityState === "visible") return;
    const fire = () => {
      try {
        const n = new Notification(title, { body, tag, icon: "/favicon.ico", renotify: false });
        n.onclick = () => { try { window.focus(); n.close(); } catch {} };
      } catch {}
    };
    if (Notification.permission === "granted") fire();
    else if (Notification.permission === "default") Notification.requestPermission().then((p) => { if (p === "granted") fire(); });
  } catch {}
}

function useCallTone(kind, active) {
  useEffect(() => {
    if (!active) return;
    try { if (getCookie("cb_muted") === "1") return; } catch {}
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    let ctx;
    try { ctx = new AC(); } catch { return; }
    let stopped = false;
    let timer = null;

    const blip = (freqs, dur, gainValue) => {
      if (stopped || ctx.state === "closed") return;
      const master = ctx.createGain();
      master.gain.setValueAtTime(0, ctx.currentTime);
      // Ramped, never switched: an instant gain change on a sine wave is an
      // audible click, and a clicking ringtone sounds broken rather than
      // premium.
      master.gain.linearRampToValueAtTime(gainValue, ctx.currentTime + 0.04);
      master.gain.setValueAtTime(gainValue, ctx.currentTime + dur - 0.06);
      master.gain.linearRampToValueAtTime(0, ctx.currentTime + dur);
      master.connect(ctx.destination);
      freqs.forEach((f) => {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(f, ctx.currentTime);
        osc.connect(master);
        osc.start();
        osc.stop(ctx.currentTime + dur);
      });
    };

    const ringback = () => { blip([440, 480], 1.6, 0.09); timer = setTimeout(ringback, 5200); };
    const ringtone = () => {
      blip([660, 880], 0.32, 0.11);
      setTimeout(() => blip([660, 880], 0.32, 0.11), 480);
      timer = setTimeout(ringtone, 2600);
    };

    (kind === "incoming" ? ringtone : ringback)();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      try { ctx.close(); } catch {}
    };
  }, [kind, active]);
}

/* Commit 57 — the daily hook.
   Engagement worth having, not the manipulative kind: a reason to come
   back that is genuinely useful on arrival. One real headline from today's
   literature, a one-tap way to ask about it, and a streak that counts days
   you actually looked something up.

   Deliberately NOT: an unread badge that lies, a red dot with nothing
   behind it, an artificial "you're about to lose your streak" threat, or a
   number that goes up for opening the app. The streak counts investigations
   because that is the behavior worth reinforcing, it never scolds, and
   breaking it costs nothing but the number. That's the line between a habit
   that serves the person and a slot machine. */
/* Commit 87 — greeting + date line for the returning-user hero.
   Deliberately time-of-day rather than a fixed "Welcome back": the second
   is a string, the first is the app noticing something true about right
   now, and that is most of the difference between software that feels
   inhabited and software that feels generated. */
function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Still up";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 22) return "Good evening";
  return "Late one";
}

function todayLabel() {
  try {
    return new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  } catch {
    return "";
  }
}

function readStreak() {
  try {
    const raw = JSON.parse(localStorage.getItem("cb_streak") || "{}");
    return { days: raw.days || 0, last: raw.last || "" };
  } catch { return { days: 0, last: "" }; }
}
function bumpStreak() {
  try {
    const today = new Date().toDateString();
    const cur = readStreak();
    if (cur.last === today) return cur;
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    const days = cur.last === yesterday ? cur.days + 1 : 1;
    const next = { days, last: today };
    localStorage.setItem("cb_streak", JSON.stringify(next));
    return next;
  } catch { return { days: 0, last: "" }; }
}

/* Commit 65 — Watched topics.
   ---------------------------------------------------------------------
   This is the retention mechanic, and it is deliberately the honest one.

   The research (arXiv 2511.18013, "Save, Revisit, Retain") found that
   saving predicts a user coming back better than any engagement signal,
   but that it's the REVISIT of the saved thing — not the save — that
   correlates with still being active a month later. Most revisits happen
   within about a day of the save. The design consequence is that the app's
   job is to give someone a real reason to come back, at the moment they've
   just shown they care about a subject.

   So: at the end of an answer, you can watch the topic. When literature is
   actually indexed on it, the watchlist says so, with a count that came
   from a live query rather than from a growth team. When nothing new has
   been published, it says nothing. There is no artificial urgency, no
   streak to lose, no red dot for a number that isn't real — because the
   users are scientists, and a fake number is the fastest way to lose one. */

const TOPIC_STOP = /^(explain the science behind|tell me about|what's new in|whats|what's|what|how|why|when|where|who|which|is|are|does|do|did|can|could|should|would|will|explain|summarize|the|a|an)\b[\s:,-]*/i;
function deriveTopic(q) {
  let t = (q || "").toString().trim();
  // Strip the question scaffolding so what gets watched is the subject
  // ("gut microbiome brain function"), not the phrasing of one question
  // ("how does the gut microbiome influence brain function?") — otherwise
  // two people watching the same subject store two different rows and the
  // literature query gets narrower for no reason.
  for (let i = 0; i < 4; i++) t = t.replace(TOPIC_STOP, "");
  t = t.replace(/[?!.]+\s*$/, "").replace(/\s+/g, " ").trim();
  const words = t.split(" ");
  if (words.length > 10) t = words.slice(0, 10).join(" ");
  return t.slice(0, 120);
}

function WatchTopicButton({ q, P, accent, user, onChanged }) {
  const topic = deriveTopic(q);
  const [state, setState] = useState("idle"); // idle | saving | on
  const [err, setErr] = useState("");
  useEffect(() => { setState("idle"); setErr(""); }, [topic]);
  if (!topic || topic.length < 3) return null;
  const signedIn = !!user;
  const toggle = async () => {
    if (!signedIn) { setErr("Sign in to watch topics."); return; }
    const next = state === "on" ? "off" : "on";
    setState("saving");
    try {
      await apiDataAction(next === "on" ? "watch-topic" : "unwatch-topic", { topic });
      setState(next === "on" ? "on" : "idle");
      setErr("");
      if (onChanged) onChanged();
    } catch (e) {
      setState(state === "on" ? "on" : "idle");
      setErr(e.message || "Couldn't save that.");
    }
  };
  const on = state === "on";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
      <button
        onClick={toggle}
        disabled={state === "saving"}
        title={on ? `You're watching "${topic}"` : `Get told when new papers on "${topic}" are indexed`}
        style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          padding: "8px 15px", borderRadius: 100, cursor: state === "saving" ? "default" : "pointer",
          fontSize: FONT_SIZES.caption, fontWeight: 600, fontFamily: "var(--cb-body)",
          background: on ? withAlpha(accent, 0.12) : "transparent",
          color: on ? accent : P.ink2,
          border: `1px solid ${on ? withAlpha(accent, 0.45) : P.line2}`,
          transition: "all 0.18s ease", opacity: state === "saving" ? 0.6 : 1,
        }}
      >
        <Icon name={on ? "check" : "bell"} size={14} />
        {on ? "Watching this topic" : "Watch this topic"}
      </button>
      <span style={{ fontSize: FONT_SIZES.micro, color: err ? STATUS.bad : P.faint, fontFamily: "var(--cb-mono)" }}>
        {err || (on ? "New papers will show on your home screen" : `Tracks new literature on "${topic}"`)}
      </span>
    </div>
  );
}

/* The home-screen watchlist. Renders nothing at all when there's nothing
   to watch or nothing new — an empty box that exists to remind you the
   feature exists is clutter, not engagement. */
function WatchList({ P, accent, at, user, onAsk, refreshKey, deck = false, onCount }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyTopic, setBusyTopic] = useState("");
  const load = useCallback(async () => {
    if (!user) { setItems([]); return; }
    setLoading(true);
    const d = await apiDataGet("watchlist");
    setLoading(false);
    setItems(d && Array.isArray(d.items) ? d.items : []);
  }, [user]);
  useEffect(() => { load(); }, [load, refreshKey]);
  // Report the count up to the Home Deck's stats strip so "Topics watched"
  // is the same number this card is showing, not a second fetch that could
  // disagree with it.
  useEffect(() => { if (onCount) onCount(items.length); }, [items.length, onCount]);

  // Commit 66 — the watchlist becomes an actual return trigger.
  //
  // A card that only says "3 new papers" once you've already come back is a
  // reward for returning, not a reason to. This fires a desktop notification
  // when real new literature lands on a topic you're watching — and only
  // then: cbNotify itself refuses to fire while the tab is visible, the
  // count is a live Europe PMC hit count (never a cached or estimated one),
  // and each topic can notify at most once a day.
  //
  // Deliberately not a daily "come back and see what's new!" ping. If
  // nothing was published, nothing is sent. That's the whole difference
  // between a literature alert and a re-engagement campaign.
  useEffect(() => {
    const fresh = items.filter((i) => i.live && i.newCount > 0);
    if (!fresh.length) return;
    let seen = {};
    try { seen = JSON.parse(localStorage.getItem("cb_watch_notified") || "{}"); } catch {}
    const today = new Date().toDateString();
    let changed = false;
    for (const i of fresh) {
      if (seen[i.topic] === today) continue;
      seen[i.topic] = today;
      changed = true;
      cbNotify(
        `${i.newCount} new paper${i.newCount === 1 ? "" : "s"} on ${i.topic}`,
        "Indexed since you last looked. Open Cerebrum to read them.",
        "cb-watch-" + i.topic,
        "watch"
      );
    }
    if (changed) { try { localStorage.setItem("cb_watch_notified", JSON.stringify(seen)); } catch {} }
  }, [items]);
  // Recheck when the tab regains focus — someone coming back tomorrow
  // should see today's count, not yesterday's render.
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);
  if (!user || (!items.length && !loading)) return null;
  const withNew = items.filter((i) => i.newCount > 0);
  /* Commit 87 — one notice, not one per row.

     When the literature index can't be reached, every row reported it
     independently, so a three-topic watchlist rendered "Couldn't check
     just now" three times in a stack ten pixels apart. Repeating the same
     error once per item makes a transient upstream blip look like three
     broken things, and it is the loudest text in the card. If NOTHING
     could be checked it is one condition, so it gets one line, at the
     bottom, in the quietest colour on the palette. */
  const allOffline = items.length > 0 && items.every((i) => !i.live && !(i.newCount > 0));
  const shell = deck
    ? { width: "100%", textAlign: "left", padding: "16px 18px 15px", borderRadius: 12, minWidth: 0,
        display: "flex", flexDirection: "column",
        background: P.dark ? "rgba(255,255,255,0.028)" : "rgba(0,0,0,0.018)",
        border: `1px solid ${P.line}` }
    : { marginTop: 28, width: "100%", maxWidth: 700, textAlign: "left",
        padding: "16px 18px", borderRadius: 12,
        background: P.dark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
        border: `1px solid ${P.line}` };
  const open = async (item) => {
    setBusyTopic(item.topic);
    try { await apiDataAction("watchlist-seen", { topic: item.topic }); } catch {}
    setBusyTopic("");
    onAsk(`What's new in ${item.topic}? Summarize the most recent findings.`);
  };
  const drop = async (item) => {
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    try { await apiDataAction("unwatch-topic", { topic: item.topic }); } catch { load(); }
  };
  return (
    <div className={deck ? "cb-card cb-deck-card" : undefined} style={shell}>
      <DeckLabel P={P} accent={accent} extra={withNew.length > 0 ? (
        <span style={{ marginLeft: "auto", color: accent, fontWeight: 600 }}>
          {withNew.length} with new work
        </span>
      ) : null}>Topics you're watching</DeckLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {/* In the deck a card is one grid cell among several — a 40-row
            watchlist would stretch the whole row. Show the four freshest and
            say how many more there are. */}
        {(deck ? items.slice(0, 4) : items).map((item) => (
          <div key={item.id} className="cb-row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0 9px 8px", margin: "0 -8px 0 -8px", borderTop: `1px solid ${P.line}` }}>
            <button
              onClick={() => open(item)}
              disabled={busyTopic === item.topic}
              style={{
                flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none",
                cursor: "pointer", padding: 0, color: P.ink, fontFamily: "var(--cb-body)",
                fontSize: FONT_SIZES.small, fontWeight: 600,
              }}
            >
              <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.topic}</span>
              <span style={{ display: "block", marginTop: 3, fontSize: FONT_SIZES.micro, fontWeight: 500, color: item.newCount > 0 ? accent : P.faint, fontFamily: "var(--cb-mono)" }}>
                {/* `live: false` means the count came from cache because the
                    literature index couldn't be reached just now. Saying so
                    is better than presenting a stale number as current. */}
                {item.newCount > 0
                  ? `${item.newCount} new paper${item.newCount === 1 ? "" : "s"} since you looked${item.live ? "" : " (last check)"}`
                  : (item.live ? "Nothing new yet" : (allOffline ? "\u00a0" : "Couldn't check just now"))}
              </span>
            </button>
            {item.newCount > 0 && (
              <span style={{
                flexShrink: 0, minWidth: 26, textAlign: "center", padding: "3px 8px", borderRadius: 100,
                background: withAlpha(accent, 0.14), color: accent,
                fontSize: FONT_SIZES.micro, fontWeight: 700, fontFamily: "var(--cb-mono)",
              }}>{item.newCount > 99 ? "99+" : item.newCount}</span>
            )}
            <button onClick={() => drop(item)} title={`Stop watching ${item.topic}`} aria-label={`Stop watching ${item.topic}`}
              style={{ flexShrink: 0, background: "none", border: "none", color: P.faint, cursor: "pointer", padding: 3, display: "inline-flex" }}>
              <Icon name="close" size={13} />
            </button>
          </div>
        ))}
        {allOffline && (
          <div style={{ marginTop: 10, fontSize: FONT_SIZES.micro, color: P.faint, fontFamily: "var(--cb-body)" }}>
            Couldn't reach the literature index just now. Counts refresh on the next check.
          </div>
        )}
      </div>
      {deck && items.length > 4 && (
        <div style={{ marginTop: 9, fontSize: FONT_SIZES.micro, color: P.faint, fontFamily: "var(--cb-mono)" }}>
          +{items.length - 4} more watched
        </div>
      )}
    </div>
  );
}

/* Commit 66 — the Home Deck.
   ---------------------------------------------------------------------
   The home screen used to be a wordmark, a search bar, and two cards
   stacked loosely underneath at whatever width they felt like. It looked
   like a landing page for a product you haven't signed into yet — which is
   exactly wrong, because the person looking at it has an account, a
   history, saved papers and watched topics, and none of that was on screen.

   The deck is the fix: everything Cerebrum already knows about your work,
   laid out as one designed grid instead of a pile. Every card here is
   backed by real state — your history, your saved sources, your watchlist,
   today's actual story. There is no card that exists to look busy, and no
   number on this screen that isn't counted from something real. */

// Saved rows can carry createdAt as an epoch number (written by this app)
// or an ISO string (a row seeded some other way). Normalize before doing
// date math on it, or a string timestamp silently becomes NaN and every
// saved paper looks "stale".
function toMs(v) {
  if (typeof v === "number") return v;
  const t = Date.parse(v);
  return Number.isNaN(t) ? 0 : t;
}

// Counts a number up when it first appears. Purely presentational — it
// always lands on the true value, and lands immediately for reduced-motion
// users. Numbers that animate into place read as "measured"; numbers that
// blink into existence read as "printed", and this screen is full of
// measurements.
function useCountUp(target, ms = 900) {
  const [n, setN] = useState(() => (cbMotionOff() ? target : 0));
  const prev = useRef(target);
  useEffect(() => {
    if (cbMotionOff()) { setN(target); prev.current = target; return; }
    const from = prev.current === target ? 0 : prev.current;
    prev.current = target;
    if (target === from) { setN(target); return; }
    const t0 = performance.now();
    let raf = 0;
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / ms);
      // Same easing curve as the rest of the motion system, so a counter
      // settling and a card rising feel like one gesture.
      const eased = 1 - Math.pow(1 - p, 3);
      setN(Math.round(from + (target - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return n;
}

// A stat's label has a long form and a short one. Four columns of
// "QUESTIONS ASKED" do not fit across a phone at any tracking that still
// looks like this app's mono label style — on a real 390px screen every
// one of them truncated to "QUESTION…", which is a label that has stopped
// being a label. On mobile the deck uses the short form in a 2x2 grid, so
// the words stay whole.
function DeckStat({ label, shortLabel, value, accent, P, isMobile, suffix = "" }) {
  const n = useCountUp(value);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <span style={{
        fontSize: FONT_SIZES.subhead, fontWeight: 700, color: value > 0 ? P.ink : P.faint,
        fontFamily: "var(--cb-display)", letterSpacing: "-0.02em", lineHeight: 1.1,
      }}>{n}{suffix}</span>
      {/* Commit 71 — was uppercase mono with wide tracking, matching the
          four shouted card eyebrows above it. Sentence case in the body
          face: the NUMBER is the thing worth seeing here, and a label
          competing with it for attention just makes the row noisy. */}
      <span style={{
        fontSize: FONT_SIZES.micro, color: P.faint, fontFamily: "var(--cb-body)",
        letterSpacing: "0.01em", lineHeight: 1.35, fontWeight: 500,
      }}>{isMobile ? (shortLabel || label) : label}</span>
    </div>
  );
}

/* Commit 71 — the eyebrow, rebuilt.
   Every card on this deck carried the same tiny uppercase monospace label
   in the accent colour: QUESTIONS ASKED, PICK UP WHERE YOU LEFT OFF,
   MILESTONES, TODAY IN SCIENCE, YOUR WATCHED TOPICS. Five identical
   shouted labels stacked down one screen is the single loudest "generated
   dashboard" signal there is — it is what a template does when it has no
   opinion about which thing matters most.

   One small accent dot and sentence case in the body face instead. It
   reads as a quiet section marker rather than a system log, and because
   it is no longer visually screaming, real hierarchy (the question, the
   headline, the photograph) can actually be seen. */
/* Commit 84 — now a thin wrapper over UILabel. Kept as a name because
   the deck calls it everywhere, but there is one implementation. */
function DeckLabel({ P, accent, children, extra }) {
  return <UILabel P={P} accent={accent} right={extra}>{children}</UILabel>;
}

/* Commit 84 — delegates to UICard. */
function DeckCard({ P, accent, label, children, className = "", labelExtra, span }) {
  return (
    <UICard P={P} className={"cb-deck-card " + className}
      style={{ display: "flex", flexDirection: "column", textAlign: "left", ...(span ? { gridColumn: span } : null) }}>
      {label && <UILabel P={P} accent={accent} right={labelExtra}>{label}</UILabel>}
      {children}
    </UICard>
  );
}

/* Commit 84 — delegates to UIButton. One button implementation. */
function DeckBtn({ children, onClick, accent, at, P, primary = false, title }) {
  return (
    <UIButton onClick={onClick} title={title} P={P} accent={accent} at={at}
      variant={primary ? "primary" : "secondary"} size="sm">{children}</UIButton>
  );
}

/* Commit 69 — milestones on the Home Deck, rebuilt on the primitives.
   Shows the nearest unearned milestone with real distance to it. The
   progress bar is the point: "2 of 5 topics" is motivating in a way a
   wall of grey locked badges is not. Every number is a row count from
   the database — see resource "milestones" in functions/api/data.js. */
function MilestoneCard({ P, accent, at, user, refreshKey }) {
  const [data, setData] = useState(null);
  const load = useCallback(async () => {
    if (!user) { setData(null); return; }
    const d = await apiDataGet("milestones");
    if (d && Array.isArray(d.items)) setData(d);
  }, [user]);
  useEffect(() => { load(); }, [load, refreshKey]);
  if (!user || !data) return null;
  const next = data.next;
  const pct = next ? Math.min(100, Math.round((next.have / next.need) * 100)) : 100;
  return (
    <DeckCard P={P} accent={accent} label="How far you've got"
      labelExtra={<span style={{ fontFamily: "var(--cb-mono)" }}>{data.earnedCount} of {data.total}</span>}>
      {next ? (
        <>
          <div style={{ fontSize: FONT_SIZES.small, fontWeight: 700, color: P.ink, marginBottom: 2 }}>{next.label}</div>
          <div style={{ fontSize: FONT_SIZES.micro, color: P.faint, marginBottom: 11, lineHeight: 1.5 }}>{next.desc}</div>
          <div style={{ height: 6, borderRadius: RADIUS.pill, background: P.dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)", overflow: "hidden", marginBottom: 7 }}>
            <div style={{ height: "100%", width: pct + "%", borderRadius: RADIUS.pill, background: accent, transition: "width 900ms cubic-bezier(0.16, 1, 0.3, 1)" }} />
          </div>
          <div style={{ fontSize: FONT_SIZES.micro, color: P.ink2, fontFamily: "var(--cb-mono)" }}>
            {next.have} of {next.need} {next.unit}{next.need === 1 ? "" : "s"}
          </div>
        </>
      ) : (
        <div style={{ fontSize: FONT_SIZES.small, color: P.ink, lineHeight: 1.55 }}>
          Every milestone earned. That's a real research habit.
        </div>
      )}
      <div style={{ paddingTop: 14, display: "flex", gap: 6, flexWrap: "wrap" }}>
        {data.items.filter((i) => i.earned).slice(-6).map((i) => (
          <span key={i.key} title={`${i.label} — ${i.desc}`} style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "4px 9px", borderRadius: RADIUS.pill,
            background: withAlpha(accent, 0.13), color: accent,
            fontSize: FONT_SIZES.micro, fontWeight: 700, maxWidth: "100%", overflow: "hidden",
          }}>
            <Icon name="check" size={11} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.label}</span>
          </span>
        ))}
      </div>
    </DeckCard>
  );
}

function HomeDeck({ P, accent, at, user, history, saved, sessions, onAsk, onOpenHistory, onOpenSaved, watchKey, isMobile }) {
  const deckRef = useGsapReveal([user ? user.id : "anon", history.length, saved.length], {
    y: 14, stagger: 0.06, duration: 0.85, descend: false,
  });
  const [streak, setStreak] = useState(() => readStreak());
  const [watchCount, setWatchCount] = useState(0);
  useEffect(() => {
    const onFocus = () => setStreak(readStreak());
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // "Pick up where you left off." The revisit research this whole surface is
  // built on is specific: it's returning to something you already engaged
  // with that predicts staying active, not being shown something new. So the
  // most recent unfinished investigation gets the most prominent card.
  const lastRun = history && history.length ? history[0] : null;
  // Commit 71 — pick the last turn that is actually a question.
  //
  // This card is the largest thing on the screen and it was rendering
  // whatever the final turn happened to be, which in a real session meant
  // a headline that read, in full, "Saho". A stray keystroke, a
  // half-typed name, an "ok" — any of them became the lead. Walk backwards
  // to the most recent turn with real substance, and if the whole session
  // is fragments, show nothing rather than something that looks broken.
  const substantial = (q) => {
    const t = String(q || "").trim();
    return t.length >= 14 && /\s/.test(t);
  };
  const lastQ = (() => {
    if (!lastRun) return "";
    const turns = Array.isArray(lastRun.turns) ? lastRun.turns : [];
    for (let i = turns.length - 1; i >= 0; i--) {
      if (substantial(turns[i] && turns[i].q)) return turns[i].q;
    }
    return substantial(lastRun.title) ? lastRun.title : "";
  })();

  // Papers saved but not looked at since the day they were saved. This is
  // the honest version of a "you have unread items" nudge: it's counted from
  // your actual saved list, it names a real paper, and if you've revisited
  // everything the card doesn't render at all.
  const DAY = 86400000;
  // `savedAt` is stamped when a paper is saved and carried across from the
  // server's created_at on sync (see setSaved in App). A source with no
  // timestamp at all — an older row saved before this existed — is treated
  // as NOT stale rather than as infinitely old, so upgrading the app never
  // greets someone with a card claiming they've been ignoring everything.
  const stale = (saved || []).filter((s) => s && s.title && s.savedAt && (Date.now() - toMs(s.savedAt)) > DAY);
  const revisit = stale.length ? stale[0] : null;

  const totalTurns = (history || []).reduce((n, h) => n + ((h.turns && h.turns.length) || 0), 0);

  return (
    <div ref={deckRef} style={{
      width: "100%", maxWidth: 880, textAlign: "left",
      // The mobile menu button is a fixed circle in the top-left corner. As
      // the deck scrolls up under it, it landed squarely on top of the
      // first stat's number — the value was unreadable behind the button.
      // Extra top margin on mobile keeps the strip clear of it at rest, and
      // the strip's own left padding keeps the first column out from under
      // the button while scrolling.
      marginTop: isMobile ? 20 : 34,
      display: "flex", flexDirection: "column", gap: 12,
    }}>
      {/* Stats strip — four real counts. Rendered only for signed-in users
          with something to count; a row of zeroes is a worse first
          impression than no row at all. */}
      {user && (totalTurns > 0 || saved.length > 0) && (
        <div className="cb-deck-stats" style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "repeat(2, minmax(0,1fr))" : "repeat(4, minmax(0,1fr))",
          gap: isMobile ? "14px 12px" : 14,
          padding: isMobile ? "15px 16px" : "13px 18px", borderRadius: 12,
          background: P.dark ? "rgba(255,255,255,0.028)" : "rgba(0,0,0,0.018)",
          border: `1px solid ${P.line}`,
        }}>
          <DeckStat label="Questions asked" shortLabel="Questions" value={totalTurns} P={P} accent={accent} isMobile={isMobile} />
          <DeckStat label="Papers saved" shortLabel="Saved" value={(saved || []).length} P={P} accent={accent} isMobile={isMobile} />
          <DeckStat label="Topics watched" shortLabel="Watched" value={watchCount} P={P} accent={accent} isMobile={isMobile} />
          <DeckStat label="Day streak" shortLabel="Streak" value={streak.days} P={P} accent={accent} isMobile={isMobile} />
        </div>
      )}

      {/* Commit 87 — alignItems: start.

          A CSS grid stretches every cell in a row to the height of the
          tallest one. The watchlist card carries three rows; the saved
          card carries one paper and two buttons — so the saved card was
          being inflated to match and its actions were left floating under
          ~120px of nothing. Four cards, four different amounts of content,
          all forced to one height, is where the ragged empty voids on this
          screen came from. Each card is now as tall as what is in it, and
          the row bottoms are allowed to differ, which is what an edited
          page looks like. */}
      <div style={{
        display: "grid", gap: 12, alignItems: "start",
        gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(310px, 1fr))",
      }}>
        {/* Commit 71 — this is the lead, so it looks like the lead.
            It was one of four identical boxes in an even grid, with the
            question set at the same 13px as every caption around it. A
            grid where nothing is bigger than anything else has made no
            editorial decision, and a screen that has made no editorial
            decision is exactly what "AI generated" looks like. It now
            spans the full width and sets the question in the display face
            at headline size — because the half-finished question you left
            behind IS the most important thing on this screen. */}
        {lastQ && (
          <DeckCard P={P} accent={accent} label="Where you left off" span={isMobile ? undefined : "1 / -1"}>
            <div style={{
              fontSize: isMobile ? FONT_SIZES.subhead : FONT_SIZES.heading,
              fontWeight: 600, color: P.ink, lineHeight: 1.28,
              letterSpacing: "-0.02em", fontFamily: "var(--cb-display)",
              marginBottom: 16, display: "-webkit-box", WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical", overflow: "hidden",
            }}>{lastQ}</div>
            <div style={{ marginTop: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
              <DeckBtn primary accent={accent} at={at} P={P} onClick={() => onAsk(lastQ)}>Keep going</DeckBtn>
              <DeckBtn accent={accent} at={at} P={P} onClick={onOpenHistory}>Everything else</DeckBtn>
            </div>
          </DeckCard>
        )}

        {revisit && (
          <DeckCard P={P} accent={accent} label="Saved, still unread"
            labelExtra={stale.length > 1 ? (
              <span style={{
                padding: "1px 7px", borderRadius: 100, background: withAlpha(accent, 0.14),
                color: accent, fontSize: FONT_SIZES.micro, fontWeight: 700,
              }}>{stale.length}</span>
            ) : null}
          >
            <div style={{
              fontSize: FONT_SIZES.small, fontWeight: 600, color: P.ink, lineHeight: 1.45,
              marginBottom: 4, display: "-webkit-box", WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical", overflow: "hidden",
            }}>{revisit.title}</div>
            <div style={{
              fontSize: FONT_SIZES.micro, color: P.faint, fontFamily: "var(--cb-mono)", marginBottom: 12,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{[revisit.journal, revisit.year].filter(Boolean).join(" · ")}</div>
            <div style={{ marginTop: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
              <DeckBtn primary accent={accent} at={at} P={P}
                onClick={() => onAsk(`What are the key findings and limitations of "${String(revisit.title).slice(0, 140)}"?`)}>
                Break it down
              </DeckBtn>
              <DeckBtn accent={accent} at={at} P={P} onClick={onOpenSaved}>Your library</DeckBtn>
            </div>
          </DeckCard>
        )}

        <WatchList P={P} accent={accent} at={at} user={user} onAsk={onAsk}
          refreshKey={watchKey} deck onCount={setWatchCount} />
        <MilestoneCard P={P} accent={accent} at={at} user={user} refreshKey={watchKey} />
        <DailyScience P={P} accent={accent} at={at} onAsk={onAsk} deck />
      </div>
    </div>
  );
}
/* Commit 72 — real photography, with its credit attached.
   ---------------------------------------------------------------------
   Resolves a picture for a subject through /api/image, which tries the
   operator's own licensed library, then open-access figures from the
   actual papers, then NASA, Wikimedia Commons, Openverse, and finally
   Unsplash/Pexels if a key is configured. See functions/api/image.js for
   why that order.

   Two rules this hook enforces on the client side:

   1. An existing image always wins. If the item already came with a
      picture from its own feed, no lookup happens at all — this is a
      fallback for the surfaces that had nothing, not a replacement for
      what already worked.

   2. Nothing renders until the image has actually decoded. A broken URL
      resolves to no picture rather than to a broken-image glyph, so the
      generated cover stays as the floor and the card can never look
      half-loaded. */
function useResolvedImage(subject, existingUrl, category) {
  const [resolved, setResolved] = useState(null);
  useEffect(() => {
    if (existingUrl || !subject) { setResolved(null); return; }
    let cancelled = false;
    const qs = new URLSearchParams({ q: String(subject).slice(0, 160) });
    if (category) qs.set("category", category);
    fetch(`/api/image?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d || !d.image || !d.image.url) return;
        // Commit 73 — video skips the probe.
        //
        // This pre-decoded every result through `new Image()` so a dead URL
        // could never render as a broken glyph. That is right for a still
        // and completely wrong for a clip: an <img> cannot decode an mp4,
        // so every video result failed the probe and was silently dropped.
        // It survived my first test only because the test stub served the
        // .mp4 with an image/png content type, which is exactly the kind of
        // thing a stub will let you get away with and production will not.
        //
        // Video is handed straight to <video>, which reports its own
        // failure through onError and falls back to the generated cover.
        if (d.image.type === "video") { setResolved(d.image); return; }
        const probe = new Image();
        probe.onload = () => { if (!cancelled) setResolved(d.image); };
        probe.onerror = () => {};
        probe.src = d.image.url;
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [subject, existingUrl, category]);
  return resolved;
}

/* The credit line. Non-negotiable for the CC-licensed sources — Commons
   and Openverse images are free to use precisely BECAUSE they are
   attributed, and an image whose licence the API couldn't state is never
   returned in the first place (see image.js). Small, over the scrim, and
   linked to the original. */
/* Commit 73 — one component for "the visual on a card", whether that
   visual turned out to be a photograph or a clip.
   ---------------------------------------------------------------------
   Video is muted, looping, playsInline and autoPlay, which is the only
   combination browsers will start without a click. It carries the poster
   frame when the source gave us one, so the card is never blank while the
   clip buffers, and it honours prefers-reduced-motion by showing the
   poster and not playing at all — a card that moves is a nice touch, a
   card that moves at someone who asked their OS for no motion is not. */
function CardMedia({ media, alt = "", onReady, onFail }) {
  const reduce = cbMotionOff();
  if (!media || !media.url) return null;
  const common = {
    style: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
    "aria-hidden": true,
  };
  if (media.type === "video") {
    if (reduce && media.poster) {
      return <img src={media.poster} alt={alt} loading="lazy" onLoad={onReady} onError={onFail} {...common} />;
    }
    return (
      <video
        src={media.url}
        poster={media.poster || undefined}
        autoPlay={!reduce} muted loop playsInline preload="metadata"
        onLoadedData={onReady} onError={onFail}
        {...common}
      />
    );
  }
  return <img src={media.url} alt={alt} loading="lazy" onLoad={onReady} onError={onFail} {...common} />;
}

function ImageCredit({ image, style }) {
  if (!image || (!image.credit && !image.license)) return null;
  const text = [image.credit, image.license].filter(Boolean).join(" · ");
  const body = (
    <span style={{
      fontSize: 9.5, lineHeight: 1.3, color: "rgba(255,255,255,0.62)",
      fontFamily: "var(--cb-mono)", textDecoration: "none",
      maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      display: "block",
    }}>{text}</span>
  );
  return (
    <div style={{ position: "absolute", right: 10, bottom: 6, maxWidth: "72%", pointerEvents: "auto", ...style }}>
      {image.creditUrl
        ? <a href={image.creditUrl} target="_blank" rel="noopener noreferrer nofollow" title={text} style={{ textDecoration: "none" }} onClick={(e) => e.stopPropagation()}>{body}</a>
        : body}
    </div>
  );
}

/* Commit 83 — ASK MODES.
   ---------------------------------------------------------------------
   The welcome screen used to offer four suggested questions. That is the
   single most chatbot-shaped thing a product can do: it teaches people
   that the way to use this is to type a sentence and read a paragraph.

   These are verbs instead. Each one is a real operation — it changes the
   enforced output contract on the server, so the answer comes back as a
   verdict, a comparison, a map of a field or a reading list rather than
   four paragraphs of prose in every case. The placeholder in the search
   box changes with the verb, because what you should type is different
   for each one.

   `explain` stays the default and is exactly what the box did before, so
   nobody who ignores all of this loses anything. */
const ASK_MODES = [
  {
    key: "explain",
    label: "Explain",
    blurb: "How something works, according to published research",
    placeholder: "Ask anything...",
    icon: "sparkle",
  },
  {
    key: "verify",
    label: "Check a claim",
    blurb: "Paste something you've heard and see if the research backs it",
    placeholder: "Paste a claim to test against the evidence...",
    icon: "check",
  },
  {
    key: "compare",
    label: "Compare",
    blurb: "Two treatments, theories or methods, weighed against each other",
    placeholder: "Compare two theories, methods or findings...",
    icon: "compare",
  },
  {
    key: "map",
    label: "Map a field",
    blurb: "Who studies this, what they've found, and what's still unsettled",
    placeholder: "Name a field to map. Who works on what, and what's open...",
    icon: "network",
  },
  {
    key: "readinglist",
    label: "Reading list",
    blurb: "The papers to read first, in the order to read them",
    placeholder: "A topic to build a reading list for...",
    icon: "bookmark",
  },
];

// Commit 84 — a horizontally scrolling row with no visible edge reads as a
// row that ends there. This returns a mask that fades whichever side still
// has content behind it, and nothing at all when the row fits.
function useEdgeMask() {
  const ref = useRef(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const more = el.scrollWidth - el.clientWidth;
      setEdges({ left: el.scrollLeft > 4, right: more > 4 && el.scrollLeft < more - 4 });
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(el);
    return () => { el.removeEventListener("scroll", measure); if (ro) ro.disconnect(); };
  }, []);
  const mask = edges.left && edges.right
    ? "linear-gradient(90deg, transparent 0, #000 22px, #000 calc(100% - 22px), transparent 100%)"
    : edges.right
      ? "linear-gradient(90deg, #000 calc(100% - 26px), transparent 100%)"
      : edges.left
        ? "linear-gradient(90deg, transparent 0, #000 26px)"
        : "none";
  return [ref, { WebkitMaskImage: mask, maskImage: mask }];
}

/* Commit 99 — these descriptions assumed the reader already knew the
   hierarchy of evidence. "Syntheses of many studies" and "Controlled human
   experiments" are accurate and tell a newcomer nothing about WHICH one they
   should pick, which is the only decision this control asks them to make.
   Each one now says what you get and when you would want it. "In vivo /
   in vitro" keeps its Latin, because that is what the label says on the
   papers themselves and hiding it would leave someone unable to recognise it
   later, but it now carries a translation. */
const EVIDENCE_TIERS = [
  ["all", "All evidence", "Everything, from lab work to large trials. Start here."],
  ["systematic-review", "Systematic reviews", "Papers that pool many studies and weigh them together. The strongest single thing to read on a settled question."],
  ["rct", "Randomised trials", "Studies that tested something on people, with a control group. Best for whether a treatment actually works."],
  ["in-vivo-vitro", "In vivo / in vitro", "Work done in animals or in cells, not yet in people. Early evidence about how something works."],
];

function EvidenceFilter({ value, onChange, P, accent, isMobile }) {
  const [open, setOpen] = useState(false);
  const active = EVIDENCE_TIERS.find((t) => t[0] === value) || EVIDENCE_TIERS[0];
  const isDefault = value === "all";
  const [scrollRef, maskStyle] = useEdgeMask();
  return (
    <div style={{ marginTop: 14, display: "flex", flexDirection: "column", alignItems: isMobile ? "stretch" : "center", gap: 10 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          alignSelf: isMobile ? "flex-start" : "center",
          display: "inline-flex", alignItems: "center", gap: 8,
          padding: "6px 12px", borderRadius: RADIUS.pill, cursor: "pointer",
          fontSize: FONT_SIZES.caption, fontFamily: "var(--cb-body)",
          fontWeight: isDefault ? 500 : 600,
          // The non-default state is the one worth seeing from across the
          // room: it changes what the search will return.
          color: isDefault ? P.faint : P.ink,
          background: isDefault ? "transparent" : withAlpha(accent, 0.12),
          border: `1px solid ${isDefault ? "transparent" : withAlpha(accent, 0.4)}`,
          transition: "background 0.2s ease, border-color 0.2s ease, color 0.2s ease",
        }}
      >
        <Icon name="filter" size={12} />
        {isDefault ? "Narrow by evidence type" : active[1]}
        <span aria-hidden="true" style={{ display: "inline-flex", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.22s cubic-bezier(0.16,1,0.3,1)" }}>
          <Icon name="chevronDown" size={12} />
        </span>
      </button>
      <div style={{
        display: "grid",
        gridTemplateRows: open ? "1fr" : "0fr",
        transition: "grid-template-rows 0.32s cubic-bezier(0.16,1,0.3,1), opacity 0.24s ease",
        opacity: open ? 1 : 0,
        width: "100%",
      }}>
        <div style={{ overflow: "hidden", minHeight: 0 }}>
          <div
            ref={scrollRef}
            className="cb-filter-row cb-scroll-x"
            style={{
              display: "flex", gap: 6, paddingTop: 2, paddingBottom: 2,
              justifyContent: isMobile ? "flex-start" : "center",
              flexWrap: isMobile ? "nowrap" : "wrap",
              overflowX: isMobile ? "auto" : "visible", maxWidth: "100%",
              WebkitOverflowScrolling: "touch",
              ...(isMobile ? maskStyle : null),
            }}
          >
            {EVIDENCE_TIERS.map(([val, label, blurb]) => {
              const on = value === val;
              return (
                <button
                  key={val} type="button" title={blurb}
                  onClick={() => { onChange(val); setOpen(false); }}
                  aria-pressed={on}
                  style={{
                    fontSize: FONT_SIZES.caption, fontFamily: "var(--cb-body)", fontWeight: 600,
                    letterSpacing: "0.005em", flexShrink: 0, whiteSpace: "nowrap",
                    padding: "6px 14px", borderRadius: RADIUS.pill, cursor: "pointer",
                    transition: "all 0.2s ease",
                    background: on ? withAlpha(accent, 0.14) : "transparent",
                    color: on ? P.ink : P.ink2,
                    border: `1px solid ${on ? withAlpha(accent, 0.42) : P.line}`,
                  }}
                >{label}</button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function AskModePicker({ mode, setMode, P, accent, isMobile }) {
  const [scrollRef, maskStyle] = useEdgeMask();
  return (
    <div
      ref={scrollRef}
      role="group"
      aria-label="What do you want to do?"
      className="cb-scroll-x"
      style={{
        display: "flex", gap: 7, marginTop: 18, marginBottom: 4,
        justifyContent: isMobile ? "flex-start" : "center",
        overflowX: "auto", maxWidth: "100%", padding: "2px 0",
        WebkitOverflowScrolling: "touch",
        ...maskStyle,
      }}
    >
      {ASK_MODES.map((m) => {
        const on = mode === m.key;
        return (
          <button
            key={m.key}
            onClick={() => setMode(m.key)}
            title={m.blurb}
            aria-pressed={on}
            className="cb-press"
            style={{
              display: "inline-flex", alignItems: "center", gap: 7, flexShrink: 0,
              padding: "8px 14px", borderRadius: 100, cursor: "pointer",
              fontSize: FONT_SIZES.caption, fontWeight: on ? 700 : 500,
              fontFamily: "var(--cb-body)", letterSpacing: "-0.005em",
              background: on ? withAlpha(accent, 0.14) : "transparent",
              color: on ? P.ink : P.ink2,
              border: `1px solid ${on ? withAlpha(accent, 0.42) : P.line}`,
              transition: "background 0.2s ease, border-color 0.2s ease, color 0.2s ease",
            }}
          >
            <span style={{ display: "inline-flex", color: on ? accent : P.faint }}>
              <Icon name={m.icon} size={14} />
            </span>
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

function DailyScience({ P, accent, at, onAsk, deck = false }) {
  const [item, setItem] = useState(null);
  const [streak, setStreak] = useState(() => readStreak());
  const [imgOk, setImgOk] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/trending").then((r) => r.json()).then((d) => {
      if (cancelled) return;
      const items = (d && Array.isArray(d.items) ? d.items : []).filter((x) => x && x.title);
      if (!items.length) return;
      // Same story for everyone for a given day — a digest that reshuffles
      // on every refresh isn't a digest, it's a slot machine pull.
      // Commit 60 — rotate the DISCIPLINE first, then pick within it. Simply
      // indexing into the merged list meant whichever source published most
      // got the daily slot most, which is how this ended up feeling like a
      // space feed even after the sources were broadened. Cycling categories
      // day to day guarantees biology, physics and the rest each get their
      // turn rather than competing on volume.
      const day = Math.floor(Date.now() / 86400000);
      const cats = Array.from(new Set(items.map((x) => x.category).filter(Boolean)));
      const pool = cats.length ? items.filter((x) => x.category === cats[day % cats.length]) : items;
      const chosen = pool.length ? pool : items;
      // Commit 71 — among the day's candidates, prefer one that has a
      // photograph. The card is now a picture card, and the whole reason
      // this screen felt machine-made was that it had no images anywhere
      // while the Trending feed was already carrying good ones.
      const withImage = chosen.filter((x) => x.image_url);
      const finalPool = withImage.length ? withImage : chosen;
      setItem(finalPool[day % finalPool.length]);
    }).catch(() => {});
    const onFocus = () => setStreak(readStreak());
    window.addEventListener("focus", onFocus);
    return () => { cancelled = true; window.removeEventListener("focus", onFocus); };
  }, []);
  useEffect(() => { setImgOk(false); }, [item && item.image_url]);
  // Commit 72 — when the feed didn't supply a picture, go and find one.
  const found = useResolvedImage(item && !item.image_url ? item.title : "", item && item.image_url, item && item.category);
  if (!item) return null;
  // Commit 73 — a photograph if the feed had one, otherwise whatever the
  // resolver found, which may be a still or a short clip.
  const heroMedia = item.image_url ? { url: item.image_url, type: "image" } : found;
  const ask = () => onAsk(`Explain the science behind: ${String(item.title).slice(0, 160)}`);
  const shell = deck
    ? { width: "100%", textAlign: "left", borderRadius: 12, minWidth: 0, overflow: "hidden",
        display: "flex", flexDirection: "column",
        background: P.dark ? "rgba(255,255,255,0.028)" : "rgba(0,0,0,0.018)",
        border: `1px solid ${P.line}` }
    : { marginTop: 28, width: "100%", maxWidth: 700, textAlign: "left", overflow: "hidden",
        borderRadius: 12,
        background: P.dark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
        border: `1px solid ${P.line}` };
  return (
    <div className={deck ? "cb-card cb-deck-card" : undefined} style={shell}>
      {/* Commit 71 — the photograph. Falls back to TrendCover's generated
          cover (initials on a category-coloured field) when the item has no
          image or the image fails, so the card never collapses to a grey
          box — but a real picture is the default, and it is what stops this
          screen reading as a template. */}
      {/* An explicit height, not aspect-ratio. In a CSS grid the cards are
          stretched to the tallest in their row, and an aspect-ratio box
          inside a stretched flex column loses the argument — the picture
          grew to ~400px tall and swallowed the card. A fixed height is
          deterministic at every card width. */}
      <div style={{ position: "relative", width: "100%", height: imgOk ? (deck ? 176 : 148) : 6, flex: "0 0 auto", overflow: "hidden", background: P.dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)", transition: "height 0.35s cubic-bezier(0.16,1,0.3,1)" }}>
        <div style={{ position: "absolute", inset: 0, opacity: imgOk ? 1 : 0, transition: "opacity 0.5s ease" }}>
          <CardMedia media={heroMedia} onReady={() => setImgOk(true)} onFail={() => setImgOk(false)} />
        </div>
        {/* Commit 80 — no more letter placeholders, anywhere.
            TrendCover paints a colour field with the story's initials in
            40px type. It was a reasonable stopgap and it looks exactly
            like what it is: a slot where a picture failed to arrive. When
            there is no photograph this card now behaves like the Trending
            type cards — the media band collapses to a slim category strip
            and the headline carries the card. */}
        {!imgOk && (
          <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: coverFor(item).background, opacity: 0.7 }} />
        )}
        {imgOk && !item.image_url && <ImageCredit image={found} style={{ bottom: 34 }} />}
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,0.05) 0%, transparent 35%, rgba(0,0,0,0.72) 100%)" }} />
        <div style={{ position: "absolute", left: 15, right: 15, bottom: 12, display: imgOk ? "flex" : "none", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{
            padding: "3px 9px", borderRadius: 100, background: "rgba(255,255,255,0.16)",
            backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
            color: "#fff", fontSize: FONT_SIZES.micro, fontWeight: 600,
          }}>Today in science</span>
          {item.category && (
            <span style={{ color: "rgba(255,255,255,0.72)", fontSize: FONT_SIZES.micro, fontWeight: 600 }}>{item.category}</span>
          )}
          {streak.days > 1 && (
            <span style={{ marginLeft: "auto", color: "rgba(255,255,255,0.72)", fontSize: FONT_SIZES.micro, fontFamily: "var(--cb-mono)" }}>
              {streak.days}-day streak
            </span>
          )}
        </div>
      </div>
      <div style={{ padding: "14px 18px 16px", display: "flex", flexDirection: "column", flex: 1 }}>
        {!imgOk && (
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: FONT_SIZES.micro, fontWeight: 600, color: P.faint, marginBottom: 9 }}>
            <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: "50%", background: accent, flexShrink: 0 }} />
            <span>Today in science{item.category ? " · " + item.category : ""}</span>
          </div>
        )}
        <div style={{ fontSize: FONT_SIZES.small, fontWeight: 600, color: P.ink, lineHeight: 1.45, marginBottom: 13, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{item.title}</div>
        <div style={{ marginTop: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={ask} className="cb-deck-btn" style={{
            padding: "7px 15px", borderRadius: 100, border: "1px solid transparent", cursor: "pointer",
            background: accent, color: at, fontSize: FONT_SIZES.caption, fontWeight: 700, fontFamily: "var(--cb-body)",
          }}>What's going on here?</button>
          {item.url && (
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="cb-deck-btn" style={{
              padding: "7px 15px", borderRadius: 100, textDecoration: "none",
              border: `1px solid ${P.line2}`, color: P.ink2, fontSize: FONT_SIZES.caption, fontWeight: 600,
              display: "inline-flex", alignItems: "center",
            }}>Read the source</a>
          )}
        </div>
      </div>
    </div>
  );
}

/* Commit 98 — rewritten, and this was hiding a much larger bug than a
   cosmetic one.

   The old body was `setInterval(..., 12)` advancing a fixed character
   `step`, on the assumption that a 12ms timer actually fires every 12ms.
   It does not here: every tick re-runs the full answer render — the
   markdown splitter, the heading detection, the citation-chip pass, the
   evidence annotations — over the whole prefix, so a tick costs far more
   than 12ms and the browser coalesces the timer. Measured against a real
   render, a 330-character answer typed out at roughly FOUR characters per
   second instead of the intended ~165.

   That is not just slow text. `done` (in Turn) is `shown === t.answer`,
   and the entire answer toolbar — Copy, Share, Print, Listen, evidence
   table, source network, timeline, Report bad answer — is gated on `done`.
   The typewriter is ON by default (`cb_tw !== "0"`), so on a normal-length
   answer those controls were, in practice, never reachable: a 4,000
   character answer needs about sixteen minutes at that rate. Every one of
   those buttons was invisible to a default user, which is why they read as
   "missing features" rather than as a slow animation.

   Two changes fix it properly rather than by tuning the interval down:

   1. Time-based, not tick-based. Each frame reveals however many
      characters the elapsed wall-clock time says it should, so a slow
      frame skips ahead instead of falling behind. The reveal always
      finishes in DURATION_MS no matter how expensive one render is.
   2. Bounded and opt-out by length. The whole animation runs for at most
      ~900ms, and an answer long enough that the effect would be a chore to
      sit through (over MAX_CHARS) simply appears. rAF also pauses in a
      background tab, so a person who switches away and back does not
      return to a half-typed answer with no toolbar.

   requestAnimationFrame instead of setInterval means the loop can never
   queue work faster than the browser can paint it. */
const TYPEWRITER_DURATION_MS = 900;
const TYPEWRITER_MAX_CHARS = 2600;
function useTypewriter(full, on) {
  const animate = on && !!full && full.length <= TYPEWRITER_MAX_CHARS;
  const [out, setOut] = useState(animate ? "" : full);
  useEffect(() => {
    if (!animate) { setOut(full); return; }
    let raf = 0;
    const started = (typeof performance !== "undefined" ? performance.now() : Date.now());
    const tick = (now) => {
      const elapsed = now - started;
      if (elapsed >= TYPEWRITER_DURATION_MS) { setOut(full); return; }
      // Ease-out so the reveal decelerates into place instead of stopping
      // dead — the same curve the rest of the motion in this file uses.
      const t = elapsed / TYPEWRITER_DURATION_MS;
      const eased = 1 - Math.pow(1 - t, 2);
      setOut(full.slice(0, Math.max(1, Math.ceil(full.length * eased))));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [full, animate]);
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

/* Commit 85 — every place a stray markdown hash could reach the page.
   The renderer promoted "## X" and "### X" only when the marker line was
   its own paragraph. Models very often emit the marker glued to the body
   ("### Mechanism" + newline + "The enzyme..."), which is ONE paragraph by
   the blank-line split, so the regexes below it failed and the characters
   rendered literally. Three separate cleanups existed for this and each
   matched "#{2,3}" only, so a single "#" or a "####" slipped past all
   three. This is the one place that decision now lives. A lone "#" in the
   middle of a line is deliberately left alone -- "#1 in its class", a hex
   colour and a hashtag are all likelier than a heading there. */
function stripStrayHashes(s) {
  return String(s == null ? "" : s)
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
    .replace(/#{2,6}[ \t]*/g, "")
    .trim();
}

/* The section masthead -- an accent rule, the title, and a hairline running
   to the right margin. Lifted out of renderAnswer so the three code paths
   that can produce a section heading (its own paragraph, glued to the body
   text below it, or a bare unmarked first line) all render identically
   instead of drifting apart. */
function h2Block(text, key, P, accent) {
  return (
    <div key={key} style={{ margin: "46px 0 18px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <span aria-hidden="true" style={{ width: 3, height: 22, borderRadius: 8, background: accent, flexShrink: 0 }} />
        <h3 style={{
          fontSize: 24, fontWeight: 700, color: P.ink, margin: 0,
          letterSpacing: "-0.02em", fontFamily: "var(--cb-display)", lineHeight: 1.2,
        }}>{text}</h3>
        <span aria-hidden="true" style={{
          flex: 1, height: 1, minWidth: 12,
          background: `linear-gradient(90deg, ${withAlpha(accent, 0.35)}, transparent)`,
        }} />
      </div>
    </div>
  );
}

function h3Block(text, key, P) {
  return <h4 key={key} style={{ fontSize: 19, fontWeight: 700, color: P.ink, margin: "32px 0 12px", letterSpacing: "-0.015em", fontFamily: "var(--cb-display)", lineHeight: 1.3 }}>{text}</h4>;
}

/* Bring a source into view without moving the reader.
 *
 * `scrollIntoView` walks every scrollable ancestor, so calling it on a source
 * card scrolled the page as well as the panel — following a citation lost
 * your place in the answer, which is the one thing that must not happen when
 * the whole product is about checking sources against claims.
 *
 * This finds the nearest scrollable ancestor and scrolls only that one, by
 * arithmetic rather than by asking the browser. If there is no scrollable
 * panel (mobile, where sources are a sheet), it does nothing to the scroll
 * position and relies on the highlight alone.
 *
 * The highlight is a class, not an inline style, so it can be animated in CSS
 * and cleaned up by simply removing it — the previous version wrote
 * element.style.background directly and restored it with a timeout, which
 * fought every other style on the element.
 */
function revealSource(n, accent) {
  try {
    const el = document.getElementById(`ref-${n}`);
    if (!el) return;

    let scroller = el.parentElement;
    while (scroller && scroller !== document.body) {
      const style = window.getComputedStyle(scroller);
      const scrolls = /(auto|scroll)/.test(style.overflowY) && scroller.scrollHeight > scroller.clientHeight + 4;
      if (scrolls) break;
      scroller = scroller.parentElement;
    }

    if (scroller && scroller !== document.body) {
      const target = el.offsetTop - scroller.clientHeight / 2 + el.offsetHeight / 2;
      const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      scroller.scrollTo({ top: Math.max(0, target), behavior: reduced ? "auto" : "smooth" });
    }

    // Coordinated flash on the source. The matching claim is styled through
    // the citation chip's own `aria-current`, so both ends light up together.
    document.querySelectorAll(".cb-source-linked").forEach((x) => x.classList.remove("cb-source-linked"));
    el.classList.add("cb-source-linked");
    el.style.setProperty("--cb-link-accent", accent || "currentColor");
  } catch {}
}

function renderAnswer(text, sources, P, accent, hoverCite, setHoverCite, activeCite, setActiveCite) {
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
    // Commit 55: a section header is now a small editorial masthead — an
    // accent rule, the title, and a hairline running to the right margin —
    // rather than one large word floating in whitespace. Three reasons this
    // is worth the extra markup: it makes the four sections scannable at a
    // glance in a long answer (the actual job of a header), the rule gives
    // the eye a place to reset between sections without reinstating the
    // heavy frame line v30 removed, and it reads as designed rather than as
    // default markdown, which was the gap on a screen that carries the
    // whole product's credibility.
    if (h2) return h2Block(h2[1], pi, P, accent);
    const h3 = para.match(/^###\s+(.+)$/);
    if (h3) return h3Block(h3[1], pi, P);

    /* Commit 85 -- a heading marker glued to the body text under it. This is
       the actual source of the "###" reaching the page: the two regexes
       above carry no /m flag, so "### Mechanism" + newline + "The enzyme..."
       matches neither, and the conservative first-line heuristic further
       down stripped "**" but never "#", so it rendered the hashes as part
       of the heading text. An explicit marker is a stronger signal than any
       heuristic, so this runs before that heuristic and skips its length
       and punctuation guards entirely -- the author already said "this is a
       heading". */
    const markedHead = para.match(/^[ \t]*(#{1,6})[ \t]+([^\n]+)(?:\n([\s\S]*))?$/);
    if (markedHead) {
      const title = stripStrayHashes(markedHead[2].replace(/\*\*/g, "")).replace(/[ \t]*#+[ \t]*$/, "").trim();
      const below = (markedHead[3] || "").trim();
      const head = markedHead[1].length <= 2 ? h2Block(title, pi + "-h", P, accent) : h3Block(title, pi + "-h", P);
      if (!title) return below ? <React.Fragment key={pi}>{renderAnswer(below, sources, P, accent, hoverCite, setHoverCite, activeCite, setActiveCite)}</React.Fragment> : null;
      return below
        ? <div key={pi}>{head}{renderAnswer(below, sources, P, accent, hoverCite, setHoverCite, activeCite, setActiveCite)}</div>
        : <React.Fragment key={pi}>{head}</React.Fragment>;
    }
    // Bold-line headers (e.g., "**Mechanism**")
    //
    // Commit 56: this used to promote ANY paragraph that was entirely
    // bold into a large accent-colored heading. The enforcer in
    // functions/api/search.js explicitly requires the model to bold at
    // least four key terms per answer, so it regularly emits a bolded
    // lead-in sentence — and that sentence was being rendered as a giant
    // heading immediately under "The short answer", which is exactly the
    // reported "why did it randomly push through big bold text". A real
    // subheading is short and isn't a sentence; a bolded sentence is
    // emphasis and should render as emphasis. Three guards: it has to be
    // short, it has to be a single line, and it must not end like a
    // sentence. Anything else falls through to normal paragraph rendering
    // with its bold intact.
    const boldHeader = para.match(/^\*\*([^*]+)\*\*\s*$/);
    const boldHeaderText = boldHeader ? boldHeader[1].trim() : "";
    const looksLikeHeading = !!boldHeaderText
      && boldHeaderText.length <= 60
      && !boldHeaderText.includes("\n")
      && !/[.!?;,]$/.test(boldHeaderText);
    if (looksLikeHeading) return <h4 key={pi} style={{ fontSize: FONT_SIZES.subhead, fontWeight: 700, color: accent, margin: "30px 0 10px", letterSpacing: "-0.01em", fontFamily: "var(--cb-display)" }}>{boldHeaderText}</h4>;

    /* Commit 79 — a section heading that arrived on the same line-break as
       its body.
       The renderer only promoted a heading when the model emitted it as
       its own paragraph, wrapped in bold. In practice it very often
       returns:

           The short answer
           The new pulse sequence developed by Tan H et al...

       — one paragraph, two lines, no bold. So "The short answer", "What
       the research shows", "Where researchers disagree" and "How solid is
       this?" all rendered at body size with no space under them, and an
       answer that HAS four clear sections looked like an undifferentiated
       wall of text. That is most of what "the answer screen needs serious
       polish" is pointing at.

       Split it: a first line that is short, has no sentence-ending
       punctuation, isn't a bullet, and is followed by real body text is a
       heading. Conservative on purpose — a genuine one-line paragraph is
       left alone, because promoting a real sentence to a heading is a
       worse error than missing one. */
    const nlIdx = para.indexOf("\n");
    if (nlIdx > 0) {
      const firstLine = para.slice(0, nlIdx).trim();
      const rest = para.slice(nlIdx + 1).trim();
      const bare = stripStrayHashes(firstLine.replace(/\*\*/g, ""));
      const isHeadingLine =
        rest.length > 0 &&
        bare.length > 0 && bare.length <= 60 &&
        !/[.!?;,:]$/.test(bare) &&
        !/^[•\-\d]/.test(bare) &&
        bare.split(/\s+/).length <= 9;
      if (isHeadingLine) {
        return (
          <div key={pi}>
            <h4 style={{ fontSize: FONT_SIZES.subhead, fontWeight: 700, color: P.ink, margin: "34px 0 10px", letterSpacing: "-0.015em", fontFamily: "var(--cb-display)", lineHeight: 1.25 }}>{bare}</h4>
            {renderAnswer(rest, sources, P, accent, hoverCite, setHoverCite, activeCite, setActiveCite)}
          </div>
        );
      }
    }

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
      const items = para.split("\n").filter(l => /^[•\-]\s+/.test(l)).map(l => stripStrayHashes(l.replace(/^[•\-]\s+/, "")));
      return (
        <ul key={pi} style={{ margin: "0 0 20px", paddingLeft: 24, listStyle: "none" }}>
          {items.map((item, ii) => (
            <li key={ii} style={{ fontSize: 17, lineHeight: 1.75, color: P.ink, marginBottom: 9, position: "relative", paddingLeft: 12, fontFamily: "var(--cb-read)", fontWeight: 400 }}>
              <span style={{ position: "absolute", left: -12, top: "0.55em", width: 5, height: 5, borderRadius: "50%", background: accent, opacity: 0.7 }} />
              {renderInlineSegments(item, sources, P, accent, hoverCite, setHoverCite, activeCite, setActiveCite)}
            </li>
          ))}
        </ul>
      );
    }

    // Numbered lists: lines starting with "1. ", "2. ", etc.
    const numberedMatch = para.match(/^(?:\d+\.\s+.+\n?)+$/m);
    if (numberedMatch) {
      // Same stray-hash cleanup as the bullet-list branch above.
      const items = para.split("\n").filter(l => /^\d+\.\s+/.test(l)).map(l => stripStrayHashes(l.replace(/^\d+\.\s+/, "")));
      return (
        <ol key={pi} style={{ margin: "0 0 20px", paddingLeft: 24, listStyle: "none", counterReset: "cb-list" }}>
          {items.map((item, ii) => (
            <li key={ii} style={{ fontSize: 17, lineHeight: 1.75, color: P.ink, marginBottom: 9, position: "relative", paddingLeft: 16, fontFamily: "var(--cb-read)", fontWeight: 400, counterIncrement: "cb-list" }}>
              <span style={{ position: "absolute", left: -8, top: 0, fontSize: FONT_SIZES.small, fontWeight: 700, color: accent, fontFamily: "var(--cb-mono)", opacity: 0.8 }}>{ii + 1}.</span>
              {renderInlineSegments(item, sources, P, accent, hoverCite, setHoverCite, activeCite, setActiveCite)}
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
    const paraClean = stripStrayHashes(para);
    return (
    <p key={pi} style={{
      /* Commit 96 — the reading surface.
         17.5px on a serif with a 1.75 leading and NO negative tracking.
         The old settings (16px sans, -0.008em) were tuned for a dense UI,
         which is what an answer read like. A serif wants a touch more size
         and air, and negative tracking on a serif is simply wrong. */
      fontSize: 17.5, lineHeight: 1.75, margin: "0 0 22px", color: P.ink,
      letterSpacing: "0", fontFamily: "var(--cb-read)", fontWeight: 400,
      fontOpticalSizing: "auto",
    }}>
      {paraClean.split("\n").map((line, li) => (
        <React.Fragment key={li}>
          {renderInlineSegments(line, sources, P, accent, hoverCite, setHoverCite, activeCite, setActiveCite)}
          {li < paraClean.split("\n").length - 1 && <br />}
        </React.Fragment>
      ))}
    </p>
    );
  });
}

/** Inline segment renderer — handles bold, italic, underline, citations, and inline code */
function renderInlineSegments(line, sources, P, accent, hoverCite, setHoverCite, activeCite, setActiveCite) {
  return line.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`|\[\d+\])/g).map((seg, si) => {
    const b = seg.match(/^\*\*([^*]+)\*\*$/);
    if (b) return <strong key={si} style={{ color: P.ink, fontWeight: 700 }}>{b[1]}</strong>;
    const it = seg.match(/^\*([^*\n]+)\*$/);
    if (it) return <em key={si} style={{ fontStyle: "italic", color: P.ink }}>{it[1]}</em>;
    const ul = seg.match(/^_([^_\n]+)_$/);
    if (ul) return <em key={si} style={{ fontStyle: "italic", color: P.ink }}>{ul[1]}</em>;
    // Inline code backticks
    const code = seg.match(/^`([^`\n]+)`$/);
    if (code) return <code key={si} style={{ fontSize: "0.88em", fontFamily: "var(--cb-mono)", background: P.dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)", padding: "2px 6px", borderRadius: 8, color: accent }}>{code[1]}</code>;
    const c = seg.match(/^\[(\d+)\]$/);
    if (c) {
      const n = parseInt(c[1], 10); const src = (sources || [])[n - 1];
      // v30: was a tiny superscript "[1]" badge in mono — raised above the
      // baseline, breaking the sentence's reading line, and visually part of
      // the "hacker terminal" look this round explicitly retires. Rewritten
      // as an inline, baseline-sitting pill — "(1)" in the body sans-serif,
      // sitting in the text flow like Perplexity's citation chips rather
      // than interrupting it.
      const isActive = activeCite === n;
      /* Activating a citation is the core evidence interaction, so it does
         three things rather than one.

         It used to scrollIntoView() the source, which scrolls EVERY
         scrollable ancestor — including the page — so following a citation
         threw away the reader's position in the answer. revealSource scrolls
         only the sources panel.

         The claim and the source light up together, briefly, so the
         correspondence is visible rather than inferred. And the citation
         stays marked until a different one is chosen, so after reading the
         source you can find your way back to the sentence it belonged to. */
      return <a key={si} href={`#ref-${n}`} title={src?.title || ""}
        aria-label={src?.title ? `Source ${n}: ${src.title}` : `Source ${n}`}
        aria-current={isActive ? "true" : undefined}
        onMouseEnter={() => setHoverCite(n)} onMouseLeave={() => setHoverCite(0)}
        onClick={(e) => { e.preventDefault(); if (setActiveCite) setActiveCite(n); revealSource(n, accent); }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (setActiveCite) setActiveCite(n); revealSource(n, accent); }
          if (e.key === "Escape" && setActiveCite) setActiveCite(0);
        }}
        style={{
          display: "inline-flex", alignItems: "center",
          fontSize: 11, color: P.ink, verticalAlign: "baseline",
          textDecoration: "none", fontWeight: 600,
          fontFamily: "var(--cb-body)",
          /* Commit 87 — "minutes 2 ." The renderer strips the space BEFORE
             a citation and pulls following punctuation up against it, but
             the badge then added 2px of margin plus 8px of internal
             padding on its right, so roughly 10px of air still separated
             the marker from the full stop. Every sentence ending in a
             citation read as a typo. Margin now only on the left, tighter
             padding, and nudged up a hair so it sits like the superscript
             it is standing in for rather than a button dropped into the
             middle of a sentence. */
          margin: "0 0 0 2px", padding: "1px 6px",
          transform: "translateY(-1px)",
          borderRadius: RADIUS.sm,
          background: isActive
            ? withAlpha(accent, 0.22)
            : hoverCite === n ? (P.dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.07)") : (P.dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.04)"),
          border: "1px solid " + (isActive ? withAlpha(accent, 0.65) : P.line),
          boxShadow: isActive ? `0 0 0 3px ${withAlpha(accent, 0.14)}` : "none",
          transition: `background ${MOTION.feedback}s ${MOTION.ease}, border-color ${MOTION.feedback}s ${MOTION.ease}, box-shadow ${MOTION.feedback}s ${MOTION.ease}`,
          cursor: "pointer",
        }}>{n}</a>;
    }
    return <span key={si}>{seg}</span>;
  });
}


/* ============================================================
   FACT CHECK, SKELETON, LOADING — redesigned visuals, same logic
   ============================================================ */
/* Commit 99 — rewritten, twice, and the second pass is the one that matters.

   The first pass fixed the wording. The real report was harder: "as a new
   reader looks at it, it doesn't make sense. What even is that for? What's
   the purpose of having that specific block? How is that going to better
   what the reader is reading?"

   That is not a copy problem. A block that appears under every answer,
   always green, always reading 100%, has no purpose a reader can name —
   because a warning that fires every time is not a warning, it is furniture.
   The reader learns in two answers that it is always green and never looks
   again, which means on the one answer where it is NOT green, they miss it.
   The panel was loudest in exactly the case where it had nothing to say.

   So the block earns its space by being quiet. Its purpose is to interrupt
   you when the answer has drifted off its own citations, and that is the
   only time it now looks like anything. Clean, it is a single line of text
   under the answer, a receipt you can open if you care. Flagged, it opens
   into the full card, headed by the specific thing that is wrong and listing
   only the items that are wrong.

   The other half of "what is it for" is that there are two very different
   checks feeding this and they were rendered identically:

     mode "claims"  an LLM read the answer's actual assertions and matched
                    each against a quote from a named source. A real check.
     mode "terms"   the gene/drug/pathway NAMES were extracted and looked
                    for in the cited titles and abstracts. This catches an
                    answer stapling an unrelated citation onto a sentence.
                    It cannot tell you a conclusion is right — the same
                    sentence with "no effect" and "essential" scores the
                    same, because both contain the gene name.

   The terms pass is the fallback that runs whenever the models are rate
   limited, i.e. often, so the weak check was borrowing the strong check's
   authority under a shared "Supported by sources / 100% source alignment"
   heading. Each now says which one it is, in words that tell the reader what
   it buys them. The percentage is gone in both: 3 of 3 shown as "100%" is a
   word-match rate with a denominator of three dressed up as a verdict. */
function FactCheck({ fc, P, accent }) {
  const colors = { supported: STATUS.good, partly: STATUS.warn, unsupported: STATUS.bad, thin: STATUS.warn };
  const claims = fc.claims || [];
  const isTerms = fc.mode === "terms";
  const nThin = claims.filter((c) => c.status === "thin").length;
  const nUns = claims.filter((c) => c.status === "unsupported").length;
  const nSup = claims.filter((c) => c.status === "supported").length;
  const total = claims.length;
  const flagged = claims.filter((c) => c.status !== "supported");
  const allClear = flagged.length === 0;
  const [open, setOpen] = useState(false);

  if (total === 0) return null;

  /* ── Clean: one line, and it stays one line unless asked ──
     This is the case that was a full bordered card with a hero percentage.
     A reader who wants to know what was checked can open it; a reader who
     does not is no longer told about it in 34px type. */
  if (allClear) {
    return (
      <div style={{ marginTop: 16 }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            background: "none", border: "none", padding: 0, cursor: "pointer",
            fontSize: FONT_SIZES.caption, color: P.faint, textAlign: "left",
            lineHeight: 1.5, fontFamily: "var(--cb-body)",
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: STATUS.good, flexShrink: 0 }} />
          <span>
            {isTerms
              ? `Checked: all ${total} specific name${total === 1 ? "" : "s"} in this answer appear in the papers it cites`
              : `Checked: all ${total} claim${total === 1 ? "" : "s"} in this answer trace to a quote in a cited paper`}
          </span>
          <span style={{ color: P.ink2, fontWeight: 600, flexShrink: 0 }}>{open ? "Hide" : "What this means"}</span>
        </button>

        {open && (
          <div style={{
            marginTop: 10, padding: "14px 16px", borderRadius: 8,
            border: `1px solid ${P.line}`, background: P.surface,
            fontSize: FONT_SIZES.small, color: P.ink2, lineHeight: 1.65,
          }}>
            {/* The caveat is the whole point of opening this. A reader who
                thinks a green line means "verified" is worse off than one
                who never saw it. */}
            {isTerms ? (
              <>
                Every gene, drug and pathway named in the answer was looked for in the
                title and abstract of each paper it cites, and all of them turned up.
                That rules out the common failure where an answer attaches a citation
                to a paper that has nothing to do with the sentence. It does not check
                whether the finding is reported correctly, so the sources are still
                worth opening for anything you plan to rely on.
              </>
            ) : (
              <>
                Each claim in the answer was matched against a specific quote from the
                paper it cites, and every one of them held up. This is the stronger of
                the two checks Cerebrum runs. It still reads abstracts rather than full
                texts, so a claim that depends on a method or a caveat buried in the
                paper can pass here and still deserve a look.
              </>
            )}
            {isTerms && total > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
                {claims.map((c, i) => (
                  <span key={i} style={{
                    fontSize: FONT_SIZES.micro, fontFamily: "var(--cb-mono)", fontWeight: 600,
                    color: STATUS.good, background: withAlpha(STATUS.good, 0.1),
                    border: `1px solid ${withAlpha(STATUS.good, 0.25)}`,
                    padding: "2px 8px", borderRadius: RADIUS.pill,
                  }}>{c.claim}</span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  /* ── Flagged: this is what the block is FOR ──
     Headed by the specific thing that is wrong and what to do about it,
     listing only the items that are wrong. The ones that passed are a count,
     not a list — they were never the reason to look. */
  const oc = nUns > 0 ? STATUS.bad : STATUS.warn;
  const headline = isTerms
    ? (nUns > 0
        ? `${nUns} name${nUns === 1 ? "" : "s"} in this answer ${nUns === 1 ? "isn't" : "aren't"} in any paper it cites`
        : `${nThin} name${nThin === 1 ? "" : "s"} only match${nThin === 1 ? "es" : ""} indirectly`)
    : (nUns > 0
        ? `${nUns} claim${nUns === 1 ? "" : "s"} in this answer ${nUns === 1 ? "isn't" : "aren't"} backed by a cited paper`
        : `${nThin} claim${nThin === 1 ? "" : "s"} ${nThin === 1 ? "is" : "are"} only partly backed by a cited paper`);
  const why = isTerms
    ? "The answer may have reached past its sources here, or attached the wrong citation. Worth opening a source before relying on these."
    : "The quote that should support this either doesn't say it, or says less than the answer claims. Worth reading the source directly.";

  return (
    <div style={{ marginTop: 20, border: `1px solid ${withAlpha(oc, 0.4)}`, borderRadius: 8, background: withAlpha(oc, 0.04), padding: "18px 20px" }} className="cb-rise">
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
        <span style={{ color: oc, flexShrink: 0, display: "flex" }}><Icon name={nUns > 0 ? "close" : "partial"} size={14} /></span>
        <span style={{ fontSize: FONT_SIZES.small, fontWeight: 600, color: oc, fontFamily: "var(--cb-body)", lineHeight: 1.4 }}>{headline}</span>
      </div>
      <div style={{ fontSize: FONT_SIZES.caption, color: P.ink2, lineHeight: 1.6, marginBottom: 4 }}>{why}</div>
      {nSup > 0 && (
        <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, lineHeight: 1.6 }}>
          {/* "The other 1 claim" reads like a typo. English wants the bare
              noun when there is exactly one of it. */}
          {isTerms
            ? (nSup === 1 ? "The other name checked out." : `The other ${nSup} names checked out.`)
            : (nSup === 1 ? "The other claim traced to a source cleanly." : `The other ${nSup} claims traced to a source cleanly.`)}
        </div>
      )}

      {flagged.map((c, i) => {
        const cc = colors[c.status] || P.ink2;
        return (
          <div key={i} style={{ display: "flex", gap: 11, padding: "12px 0 0", marginTop: 12, borderTop: `1px solid ${P.line}` }}>
            <span style={{ color: cc, flexShrink: 0, width: 18, height: 18, borderRadius: 8, background: withAlpha(cc, 0.12), display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}><Icon name={c.status === "thin" ? "partial" : "close"} size={11} /></span>
            <div>
              <div style={{ fontSize: FONT_SIZES.small, color: P.ink, lineHeight: 1.5, fontFamily: isTerms ? "var(--cb-mono)" : "var(--cb-body)", fontWeight: isTerms ? 600 : 500 }}>{c.claim}</div>
              {c.note && <div style={{ fontSize: FONT_SIZES.small, color: P.faint, marginTop: 3, lineHeight: 1.55 }}>{c.note}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Skeleton({ P, accent }) {
  const bar = (w, h = 12, delay = 0) => (
    <div style={{
      height: h, width: w, borderRadius: 8,
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
      borderRadius: 8, padding: "32px 34px",
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
/* ════════════════════════════════════════════════════════════════════════
   AgentTrace — what is actually happening while a search runs.

   WHAT THIS USED TO DO, AND WHY IT WAS A PROBLEM
   Eight steps on a hardcoded timer. At 1.8 seconds it displayed "PubMed,
   Europe PMC and OpenAlex have answered"; at 3.2 seconds, "Semantic Scholar,
   Crossref and arXiv have answered"; at 7.6 seconds, "Checking nothing here
   has been retracted". None of those were events. The client had no idea
   which databases had answered, or whether any had — the search is a single
   request that returns once, at the end. If every database had timed out, the
   interface still announced that six of them had replied, and then said it
   had checked for retractions.

   That is fabricated telemetry about scientific sourcing, in a product whose
   entire proposition is that you can check where its claims came from.

   WHAT IT DOES NOW
   The client genuinely does not know what the server is doing mid-request, so
   it says so. While waiting, the status is indeterminate: elapsed time, which
   is real, and a single honest line. The per-database outcome appears only
   AFTER the response arrives, populated from `sourcesQueried` — which the
   backend computes from actual settled promises across every retrieval
   attempt (see functions/api/search.js). A database that timed out is shown
   as not having answered, because that is what happened.

   If a future version streams real progress events, they belong here. Until
   then this shows elapsed time and nothing it cannot substantiate.
   ════════════════════════════════════════════════════════════════════════ */
function AgentTrace({ P, accent, sourcesQueried = null, done = false }) {
  const startRef = useRef(performance.now());
  const [elapsed, setElapsed] = useState(0);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (done) return undefined;
    // 200ms, not 100ms: this is a clock, and re-rendering it ten times a
    // second to move a digit that changes once a second is wasted work
    // during the most performance-sensitive moment in the app.
    const id = setInterval(() => setElapsed(performance.now() - startRef.current), 200);
    return () => clearInterval(id);
  }, [done]);

  const seconds = Math.floor(elapsed / 1000);

  /* One honest line about what is in flight. These do not claim any
     milestone has been reached — they describe the shape of the work, and
     which one is shown depends only on how long it has been, which is a fact
     the client actually has. */
  const waitingLine =
    seconds < 3 ? "Searching the literature"
    : seconds < 9 ? "Searching the literature. Some databases are slower than others."
    : "Still searching. A few databases are taking their time.";

  const responded = Array.isArray(sourcesQueried) ? sourcesQueried.filter((s) => s.ok) : [];
  const total = Array.isArray(sourcesQueried) ? sourcesQueried.length : 0;

  return (
    <div style={{ padding: "16px 0 4px", fontFamily: "var(--cb-mono)" }} aria-live="polite" aria-atomic="true">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{
          width: 6, height: 6, borderRadius: "50%", background: accent,
          boxShadow: `0 0 8px ${withAlpha(accent, 0.5)}`,
          animation: reduced ? "none" : "cbSynapse 1.25s cubic-bezier(0.4,0,0.6,1) infinite",
        }} />
        <span style={{ fontSize: FONT_SIZES.caption, color: P.ink2, letterSpacing: "0.02em", fontVariantNumeric: "tabular-nums" }}>
          {seconds}s
        </span>
        <span style={{ fontSize: FONT_SIZES.caption, color: P.faint }}>
          {done && total ? `${responded.length} of ${total} databases answered` : waitingLine}
        </span>
      </div>

      {/* The per-database breakdown, only once it is real. */}
      {done && total > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", marginTop: 4 }}>
          {sourcesQueried.map((s) => (
            <span key={s.source} style={{
              fontSize: FONT_SIZES.micro,
              color: s.ok ? P.ink2 : P.faint,
              opacity: s.ok ? 1 : 0.55,
              display: "inline-flex", alignItems: "center", gap: 4,
            }}>
              <span style={{
                width: 4, height: 4, borderRadius: "50%",
                background: s.ok ? accent : P.line,
              }} />
              {s.source}{s.ok && s.count ? ` ${s.count}` : ""}
            </span>
          ))}
        </div>
      )}
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

  // Commit 92 — "AI illustrations" was removed; the landing page should not
// advertise a feature that no longer exists, and the replacement is a
// better thing to advertise anyway.
const FEATURE_TAGS = ["Cited answers", "Compare investigations", "Source network", "Literature timeline", "Evidence table"];

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
          {/* Arrival. The core is prominent and centred, the field is at its
              most expressive, and this is the one screen that gets to be
              dramatic — everything after it inherits the same material at
              lower intensity. */}
          <CerebrumFieldCanvas
            accent={accent} P={P}
            mode="arrival"
            core={1} corePos={[0, 0.06]} coreScale={1}
            animationMode={animationMode}
          />
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
          <span style={{ fontSize: FONT_SIZES.subhead, fontWeight: 600, color: "#ffffff", letterSpacing: "0.01em", textShadow: "0 1px 8px rgba(0,0,0,0.7)" }}>Cerebrum</span>
        </div>
        <div style={{ display: "flex", gap: isMobile ? 16 : 28 }}>
          {["About", "Privacy", "Contact"].map((item) => (
            <a key={item} href={`/${item.toLowerCase()}`} style={{ fontSize: FONT_SIZES.caption, color: "#a3b0c2", textDecoration: "none", fontWeight: 600, letterSpacing: "0.01em", transition: "color 0.2s", textShadow: "0 1px 8px rgba(0,0,0,0.7)" }}
              onMouseEnter={(e) => e.target.style.color = "#e8edf5"} onMouseLeave={(e) => e.target.style.color = "#a3b0c2"}>{item}</a>
          ))}
        </div>
      </nav>

      <main style={{
        flex: 1, display: "flex", flexDirection: "column", justifyContent: "center",
        padding: isMobile ? "0 24px 60px" : "0 clamp(48px, 8vw, 140px) 80px",
        position: "relative", zIndex: 10, pointerEvents: "auto", maxWidth: 820,
      }}>
        {/* Commit 84 — the aurora ribbon sweeps straight through the lede on
            wide viewports, and a text-shadow alone is not enough contrast
            against the bright part of it. This is a soft scrim anchored to
            the copy column: it darkens what is behind the words without
            putting a visible panel on the page or dimming the artwork
            anywhere else. */}
        <div aria-hidden="true" style={{
          position: "absolute", zIndex: -1,
          top: -60, bottom: -40, left: isMobile ? -24 : "-8vw", right: isMobile ? -24 : -120,
          background: isMobile
            ? "linear-gradient(180deg, rgba(6,8,10,0.55) 0%, rgba(6,8,10,0.62) 55%, rgba(6,8,10,0) 100%)"
            : "linear-gradient(100deg, rgba(6,8,10,0.78) 0%, rgba(6,8,10,0.66) 45%, rgba(6,8,10,0.24) 72%, rgba(6,8,10,0) 100%)",
          pointerEvents: "none",
        }} />

        <div ref={logoRef} style={{ marginBottom: 32, opacity: animationMode === "off" ? 1 : 0 }}>
          <Mark size={36} accent={introAccent} glow />
        </div>

        <h1 style={{
          fontSize: isMobile ? 48 : "clamp(64px, 8vw, 96px)",
          // Commit 98 — Newsreader is a serif with real descenders; -0.05em
          // and a 1.0 leading were carried over from the sans this hero used
          // to be set in, and at 96px the "y" of "anything" ran into the cap
          // line of "We'll" below it. Loosened to values a display serif can
          // actually take.
          fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 1.05,
          color: "#ffffff", margin: "0 0 28px",
          fontFamily: "var(--cb-display)",
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
          Cerebrum searches 15 scholarly databases in parallel and writes you
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
            <span key={f} style={{ fontSize: FONT_SIZES.caption, fontWeight: 600, color: "#a3b0c2", letterSpacing: "0.01em", fontFamily: "var(--cb-body)", textShadow: "0 1px 8px rgba(0,0,0,0.7)" }}>{f}</span>
          ))}
        </div>

        <div ref={btnsRef} style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", opacity: animationMode === "off" ? 1 : 0 }}>
          <button onClick={go} style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "16px 36px", fontSize: FONT_SIZES.body, fontWeight: 700,
            letterSpacing: "0.01em",
            background: "#ffffff", color: "#000000", border: "none", borderRadius: 0,
            // Commit 98 — the CTA is a control, not a headline. Setting it in
            // the same serif as the h1 directly above flattened the contrast
            // between "thing you read" and "thing you press"; the sans reads
            // as the button it is.
            cursor: "pointer", fontFamily: "var(--cb-body)",
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

/* Orb and SoftAurora are removed.

   Orb drew the intro screen; SoftAurora drew the application. Each opened its
   own WebGL context with its own shader and its own animation loop, neither
   stopped when the tab was hidden, and SoftAurora's colours were passed in as
   literals at the call site — so the accent a person picked in Settings had no
   effect on the largest coloured surface in the product.

   Both are replaced by one renderer (src/cerebrumField.js) mounted through
   CerebrumFieldCanvas below. Deleting them rather than leaving them unused is
   the point: two dormant WebGL implementations sitting in the file is how the
   next person ends up mounting one by accident. */

/* ════════════════════════════════════════════════════════════════════════
   THE FIELD — Cerebrum's signature visual, as one React component.

   This replaces two independent renderers. `Orb` drew the intro screen and
   `SoftAurora` drew the application; each created its own WebGL context, ran
   its own requestAnimationFrame loop that never stopped when the tab was
   hidden, and SoftAurora's colours were hardcoded to a blue/green pair in the
   markup — so the accent a person chose in Settings had no effect on the
   largest coloured surface in the product.

   There is now one context, one loop, one material. The background and the
   core are computed together in a single shader (src/cerebrumField.js), which
   is what makes them look like the same substance rather than two effects
   sharing a screen.

   This component owns lifecycle and nothing else. It renders a canvas, hands
   the renderer the current state, and gets out of the way: no animation state
   lives in React, so the sixty-times-a-second loop never triggers a render.
   ════════════════════════════════════════════════════════════════════════ */
function CerebrumFieldCanvas({
  accent,
  P,
  mode = "ambient",
  energy = 0,
  core = 0,
  corePos = [0, 0],
  coreScale = 1,
  animationMode = "cinematic",
}) {
  const canvasRef = useRef(null);
  const fieldRef = useRef(null);
  const [failed, setFailed] = useState(false);

  /* The field inverts its polarity for light palettes rather than painting a
     dark sheet behind a pale interface — see the uLight branch in the shader.
     `deep` is still passed because the CSS fallback needs a ground colour. */
  const isLight = !!(P && P.dark === false);
  const deep = isLight ? (P.bg || "#f5f4f1") : ((P && P.bg) || "#0a1020");

  // Create once. Deliberately NOT keyed on accent/mode — those are pushed
  // through setState below, because tearing down a GPU context to change a
  // colour is how you end up leaking contexts on a settings screen.
  useEffect(() => {
    if (animationMode === "off") return undefined;
    let disposed = false;
    let handle = null;

    (async () => {
      try {
        const { createField } = await import("./cerebrumField.js");
        if (disposed || !canvasRef.current) return;
        handle = await createField(canvasRef.current, {
          accent, deep, mode, core, corePos, coreScale, light: isLight,
        });
        if (disposed) { if (handle) handle.destroy(); return; }
        if (!handle) { setFailed(true); return; }
        fieldRef.current = handle;
      } catch {
        if (!disposed) setFailed(true);
      }
    })();

    return () => {
      disposed = true;
      if (fieldRef.current) { fieldRef.current.destroy(); fieldRef.current = null; }
      else if (handle) handle.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animationMode]);

  // Push state changes without recreating anything.
  useEffect(() => {
    if (fieldRef.current) {
      fieldRef.current.setState({ accent, deep, mode, energy, core, corePos, coreScale, light: isLight });
    }
  }, [accent, deep, mode, energy, core, corePos[0], corePos[1], coreScale, isLight]);

  const fallbackStyle = {
    position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none",
    background: staticFieldCss(accent, deep),
  };

  // Animation off, or WebGL unavailable: the same palette and roughly the
  // same composition, painted in CSS. The page should look deliberate, not
  // like something failed to load.
  if (animationMode === "off" || failed) {
    return <div aria-hidden="true" style={fallbackStyle} />;
  }

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: "fixed", inset: 0, width: "100%", height: "100%",
        zIndex: 0, pointerEvents: "none", display: "block",
        // Painted underneath while the shader module loads, so there is never
        // a black rectangle between first paint and first frame.
        background: staticFieldCss(accent, deep),
      }}
    />
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
      style={{ width: 34, height: 34, borderRadius: 8, border: "none", cursor: "pointer", background: listening ? accent : "transparent", color: listening ? "#fff" : P.faint, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, position: "relative" }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 15a3 3 0 003-3V6a3 3 0 00-6 0v6a3 3 0 003 3z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><path d="M5 12a7 7 0 0014 0M12 19v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      {listening && <span style={{ position: "absolute", inset: -4, borderRadius: 8, border: `2px solid ${accent}`, animation: "cbMicPulse 1.5s ease-in-out infinite", pointerEvents: "none" }} />}
    </button>
  );
}

/* Commit 85 -- the replacement for double-click-to-search.

   Selecting text is a reading gesture, not a command, so the app no longer
   treats it as one. When a reader selects a phrase inside an answer this
   offers a single button near the selection; nothing happens until they
   press it. It only appears for a selection that plausibly IS a question
   worth asking -- more than two characters, under eighty, on one line, and
   inside an answer card rather than in their own typed question -- and it
   gets out of the way on scroll, on Escape, and the moment the selection
   collapses. */
function SelectionAsk({ onAsk, P, accent, containerRef }) {
  const [pos, setPos] = useState(null);
  const [text, setText] = useState("");
  useEffect(() => {
    let raf = 0;
    const clear = () => { setPos(null); setText(""); };
    const measure = () => {
      const sel = window.getSelection && window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return clear();
      const value = sel.toString().trim();
      if (value.length < 3 || value.length > 80 || value.includes("\n")) return clear();
      const node = sel.anchorNode;
      const el = node && (node.nodeType === 1 ? node : node.parentElement);
      if (!el || !el.closest) return clear();
      // Only inside a rendered answer -- not the composer, not the source
      // list, not the person's own question bubble.
      if (!el.closest(".cb-answer-enter")) return clear();
      const host = containerRef && containerRef.current;
      if (host && !host.contains(el)) return clear();
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (!rect || (!rect.width && !rect.height)) return clear();
      setText(value);
      setPos({
        top: Math.max(56, rect.top - 46),
        left: Math.min(Math.max(12, rect.left + rect.width / 2), window.innerWidth - 12),
      });
    };
    const onChange = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
    const onKey = (e) => { if (e.key === "Escape") clear(); };
    document.addEventListener("selectionchange", onChange);
    window.addEventListener("scroll", clear, true);
    window.addEventListener("resize", clear);
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("selectionchange", onChange);
      window.removeEventListener("scroll", clear, true);
      window.removeEventListener("resize", clear);
      window.removeEventListener("keydown", onKey);
    };
  }, [containerRef]);

  if (!pos || !text) return null;
  return (
    <button
      type="button"
      // onMouseDown would clear the selection before onClick ever fires.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        const q = text;
        try { window.getSelection().removeAllRanges(); } catch {}
        setPos(null); setText("");
        onAsk(q);
      }}
      style={{
        position: "fixed", top: pos.top, left: pos.left, transform: "translateX(-50%)",
        zIndex: 90, display: "inline-flex", alignItems: "center", gap: 7,
        padding: "8px 14px", borderRadius: RADIUS.pill, cursor: "pointer",
        fontSize: FONT_SIZES.caption, fontWeight: 600, fontFamily: "var(--cb-body)",
        color: P.ink, whiteSpace: "nowrap",
        background: P.dark ? "rgba(20,24,22,0.94)" : "rgba(255,255,255,0.96)",
        border: `1px solid ${withAlpha(accent, 0.45)}`,
        backdropFilter: "blur(14px) saturate(1.3)", WebkitBackdropFilter: "blur(14px) saturate(1.3)",
        boxShadow: P.dark ? "0 8px 26px rgba(0,0,0,0.55)" : "0 8px 26px rgba(0,0,0,0.16)",
      }}
    >
      <span style={{ display: "inline-flex", color: accent }}><Icon name="sparkle" size={13} /></span>
      Ask about this
    </button>
  );
}

/* ============================================================
   ANSWER PLAYER (TTS) — logic preserved
   ============================================================ */
function AnswerPlayer({ text, accent, P, compact = false, autoPlay = false }) {
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
    // Commit 85 — 1.0/1.0 is the setting that makes every browser voice
    // sound like a browser voice. A fraction under natural speed, with the
    // pitch nudged down, is the difference between "announcement" and
    // "someone reading to you", and costs nothing.
    utter.rate = 0.96; utter.pitch = 0.98; utter.lang = "en-US";
    const voices = window.speechSynthesis.getVoices();
    // Bug: this ignored the user's saved Male/Female preference
    // (`cb_tts_voice`, set via TtsVoiceSetting and honored by
    // playCerebrum()'s backend call) entirely — if the backend TTS call or
    // ElevenLabs failed and this browser fallback engaged, the chosen voice
    // was silently dropped for a fixed, gender-blind name guess.
    let voicePref = "";
    try { voicePref = localStorage.getItem("cb_tts_voice") || ""; } catch {}

    /* Commit 85 — the old picker's first choice list included Alex and
       Fred, which are 1990s formant-synthesis voices still shipped by
       macOS, and it had no notion that some installed voices are far
       better than others. Modern platforms ship genuinely good neural
       voices under predictable names ("… (Natural)" on Windows, "Siri" and
       "Google US English" elsewhere), and a pile of novelty voices that
       should never be chosen automatically. Rank rather than first-match. */
    const NOVELTY = /Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Deranged|Fred|Good News|Jester|Junior|Kathy|Organ|Ralph|Superstar|Trinoids|Whisper|Wobble|Zarvox|Grandma|Grandpa|Rocko|Shelley|Sandy|Eddy|Flo|Reed|Rishi/i;
    const FEMALE = /Samantha|Karen|Moira|Tessa|Fiona|Serena|Allison|Ava|Susan|Zoe|Joanna|Amy|Aria|Jenny|Michelle|Sonia|Female|\bZira\b/i;
    const MALE = /Daniel|Oliver|Thomas|Aaron|Arthur|Tom|Guy|Ryan|Brian|Matthew|Male|\bDavid\b|\bMark\b/i;
    const wantFemale = voicePref === "female";
    const wantMale = voicePref === "male";
    const score = (v) => {
      const n = v.name || "";
      if (NOVELTY.test(n)) return -100;
      if (!/^en/i.test(v.lang || "")) return -50;
      let sc = 0;
      if (/Natural|Neural|Premium|Enhanced/i.test(n)) sc += 40;
      if (/Siri/i.test(n)) sc += 36;
      if (/^Google/i.test(n)) sc += 30;
      if (/Samantha|Daniel|Karen|Moira|Tessa|Serena|Allison|Ava/i.test(n)) sc += 18;
      if (/en[-_]US/i.test(v.lang || "")) sc += 6;
      if (v.localService === false) sc += 4; // cloud voices are usually the better ones
      if (wantFemale && FEMALE.test(n)) sc += 25;
      if (wantMale && MALE.test(n)) sc += 25;
      if (wantFemale && MALE.test(n)) sc -= 25;
      if (wantMale && FEMALE.test(n)) sc -= 25;
      return sc;
    };
    const ranked = voices.filter((v) => score(v) > -50).sort((a, b) => score(b) - score(a));
    const pref = ranked[0] || voices.find((v) => /^en/i.test(v.lang || ""));
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
  // Commit 67 — "Auto-read answers" was a DEAD SWITCH. The preference
  // existed, defaulted to ON, wrote its cookie, and was read by absolutely
  // nothing: `autoplay` appeared in App's state, in the cookie effect, and
  // in the Settings row, and nowhere else in the file. Every user who left
  // it on believed answers would be read aloud and they never were.
  //
  // Now it does what it says. Two guards on top of the preference:
  // browsers refuse to start audio without a prior user gesture, and
  // pressing Ask is one — but a page restored from history has no gesture,
  // so a failure here is swallowed rather than thrown. And it fires once
  // per distinct answer, tracked by the text itself, so a re-render never
  // restarts narration mid-sentence.
  const autoFiredFor = useRef(null);
  useEffect(() => {
    if (!autoPlay || !text || status !== "idle") return;
    if (autoFiredFor.current === text) return;
    autoFiredFor.current = text;
    try { if (useElevenLabs) playEleven(); else playCerebrum(); } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlay, text, useElevenLabs]);

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
      <button onClick={onClick} style={{ padding: "6px 14px", fontSize: FONT_SIZES.caption, fontWeight: 600, background: active ? accent : "transparent", color: active ? accentText(accent) : P.ink2, border: `1px solid ${active ? accent : P.line2}`, borderRadius: 8, cursor: "pointer", fontFamily: "var(--cb-mono)", display: "inline-flex", alignItems: "center", gap: 6, letterSpacing: "0.01em" }}>
        {playIcon}
        {label}
      </button>
      {active && (
        <div style={{ width: 80, height: 2, background: P.line, borderRadius: 8, overflow: "hidden" }}>
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
        <button key={v} onClick={() => set(v)} style={{ flex: 1, padding: "9px 6px", fontSize: FONT_SIZES.small, fontWeight: 600, background: voice === v ? accent : "transparent", color: voice === v ? at : P.ink2, border: `1px solid ${voice === v ? accent : P.line}`, borderRadius: 8, cursor: "pointer", fontFamily: "inherit" }}>{label}</button>
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
      <input type="password" aria-label="ElevenLabs API key" placeholder="ElevenLabs API key (optional)" value={key} onChange={(e) => setKey(e.target.value)} style={{ padding: "10px 12px", fontSize: FONT_SIZES.small, background: P.surface, color: P.ink, border: `1px solid ${P.line}`, borderRadius: 8, fontFamily: "inherit", outline: "none" }} />
      <select value={voice} onChange={(e) => setVoice(e.target.value)} style={{ padding: "10px 12px", fontSize: FONT_SIZES.small, background: P.surface, color: P.ink, border: `1px solid ${P.line}`, borderRadius: 8, fontFamily: "inherit", cursor: "pointer", outline: "none", ...selectChrome(P) }}>
        {voices.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select>
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={save} style={{ flex: 1, padding: "8px 12px", fontSize: FONT_SIZES.small, fontWeight: 600, background: accent, color: at, border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "inherit" }}>{saved ? "✓ Saved" : "Save"}</button>
        {key && <button onClick={clear} style={{ padding: "8px 12px", fontSize: FONT_SIZES.small, fontWeight: 500, background: "transparent", color: P.ink2, border: `1px solid ${P.line}`, borderRadius: 8, cursor: "pointer", fontFamily: "inherit" }}>Clear</button>}
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

/* Commit 69 — how far through a legal document you are.
   Its own component rather than a hook inside InfoPage: InfoPage returns
   early when the page slug is unknown, so any hook added above that return
   would run conditionally on some renders and not others. A child mounted
   only for legal pages keeps hook order stable and the rule unbroken. */
/* Commit 69 — land on the right clause when a deep link is opened cold.
   The browser resolves #limitation-of-liability at document load, which on
   a client-rendered SPA is before any of these sections exist — so the
   anchor silently did nothing and the reader arrived at the top of a
   twenty-section document. This retries once the sections have actually
   mounted. Mounted only on legal pages, alongside LegalProgress, for the
   same hook-order reason. */
function LegalHashScroll() {
  useEffect(() => {
    const hash = (window.location.hash || "").slice(1);
    if (!hash) return;
    let tries = 0;
    const tick = () => {
      const el = document.getElementById(hash);
      if (el) { el.scrollIntoView({ block: "start", behavior: "auto" }); return; }
      if (tries++ < 20) setTimeout(tick, 60);
    };
    tick();
  }, []);
  return null;
}

function LegalProgress({ accent }) {
  const [pct, setPct] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement;
      const max = (doc.scrollHeight - window.innerHeight) || 1;
      setPct(Math.min(100, Math.max(0, (window.scrollY / max) * 100)));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); };
  }, []);
  return <div className="cb-legal-progress" aria-hidden="true" style={{ width: pct + "%" }} />;
}

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
  const PAGES = LEGAL_PAGES;
  const data = PAGES[page]; if (!data) return null;

  /* Commit 69 — long-document affordances.
     The Terms and Privacy pages went from five short blocks to twenty
     numbered sections. A wall of twenty headings with no way to see the
     shape of the document, jump to a clause, or link someone to one, is
     how a policy page becomes something nobody reads — which is exactly
     the failure mode a policy page exists to avoid. Legal pages now get a
     contents list, stable anchor ids, per-section deep links, and a
     reading-progress bar. Short pages (About, Contact) get none of it,
     because a table of contents for four sections is clutter. */
  const slug = (h) => String(h).toLowerCase()
    .replace(/^\d+\.\s*/, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim().replace(/\s+/g, "-").slice(0, 60);
  const isLegal = page === "terms" || page === "privacy" || page === "disclosures";
  const toc = isLegal ? data.blocks.map((b2) => ({ h: b2.h, id: slug(b2.h) })) : [];
  const NAV = [["about", "About"], ["privacy", "Privacy"], ["terms", "Terms"], ["disclosures", "Disclosures"], ["contact", "Contact"]];
  return (
    <div style={{ minHeight: "100dvh", background: P.bg, color: P.ink, fontFamily: "var(--cb-body)", position: "relative", display: "flex", flexDirection: "column", overflowX: "hidden" }}>
      <style>{`
        .cb-info-block:hover .cb-anchor, .cb-anchor:focus-visible { opacity: 1; }
        .cb-toc-link:hover { color: ${accent}; }
        .cb-legal-progress { position: fixed; top: 0; left: 0; height: 2px; background: ${accent}; z-index: 30; transition: width 90ms linear; }
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
          <CerebrumFieldCanvas accent={accent} P={P} mode="reading" core={0} animationMode={animationMode} />
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
      {isLegal && <LegalProgress accent={accent} />}
      {isLegal && <LegalHashScroll />}
      <main style={{ flex: 1, position: "relative", zIndex: 1 }}>
        <div style={{ maxWidth: 640, margin: "0 auto", padding: isMobile ? "48px 20px 64px" : "72px 28px 80px" }}>
          <div className="cb-fadein" style={{ animationDelay: "0ms" }}>
            <span style={{ fontSize: FONT_SIZES.caption, fontWeight: 600, letterSpacing: "0.01em", color: accent, fontFamily: "var(--cb-body)" }}>{data.eyebrow}</span>
            <h1 style={{ fontSize: isMobile ? FONT_SIZES.display : FONT_SIZES.hero, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.15, color: P.ink, margin: "12px 0 16px", fontFamily: "var(--cb-display)" }}>{data.title}</h1>
            <p style={{ fontSize: FONT_SIZES.subhead, lineHeight: 1.65, color: P.ink2, marginBottom: 8 }}>{data.lede}</p>
            {data.updated && <div style={{ fontSize: FONT_SIZES.small, color: P.faint, marginBottom: 0, fontFamily: "var(--cb-mono)" }}>{data.updated}</div>}
          </div>
          {isLegal && (
            <nav aria-label="Contents" className="cb-fadein" style={{
              marginTop: 34, padding: "18px 20px", borderRadius: 12,
              background: P.dark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
              border: `1px solid ${P.line}`,
            }}>
              <div style={{ fontSize: FONT_SIZES.micro, fontWeight: 600, letterSpacing: "0.01em", color: accent, fontFamily: "var(--cb-body)", marginBottom: 12 }}>Contents</div>
              <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "2px 22px" }}>
                {toc.map((t) => (
                  <li key={t.id}>
                    <a href={`#${t.id}`} className="cb-toc-link" style={{ display: "block", padding: "5px 0", fontSize: FONT_SIZES.small, color: P.ink2, textDecoration: "none", lineHeight: 1.4 }}>{t.h}</a>
                  </li>
                ))}
              </ol>
            </nav>
          )}
          <div style={{ marginTop: 48, display: "flex", flexDirection: "column", gap: 40 }}>
            {data.blocks.map((block, i) => (
              <div key={i} id={isLegal ? slug(block.h) : undefined} className="cb-info-block cb-fadein" style={{ animationDelay: `${(i + 1) * 80}ms`, scrollMarginTop: 90 }}>
                <h2>
                  {block.h}
                  {isLegal && (
                    /* A deep link per clause. "See section 15" is useless
                       in an email; a URL that lands on section 15 is not. */
                    <a href={`#${slug(block.h)}`} className="cb-anchor" aria-label={`Link to “${block.h}”`} title="Link to this section"
                      style={{ marginLeft: 8, color: accent, textDecoration: "none", fontSize: "0.72em", opacity: 0, transition: "opacity 0.2s ease" }}>#</a>
                  )}
                </h2>
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
    <div style={{ marginTop: 32, border: P.dark ? "1px solid rgba(255,255,255,0.08)" : `1px solid ${P.line}`, borderRadius: 8, padding: "24px 26px 10px", background: P.dark ? "rgba(5,8,22,0.5)" : withAlpha(P.surface, 0.7), backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)" }} className="cb-fade">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 18, flexWrap: "wrap", paddingBottom: 16, borderBottom: `1px solid ${P.line}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 3, height: 18, background: accent, borderRadius: 8 }} />
          <div style={{ fontSize: FONT_SIZES.small, fontWeight: 600, letterSpacing: "0.01em", color: P.ink, fontFamily: "var(--cb-body)" }}>Bibliography</div>
          <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 600, color: P.faint, fontFamily: "var(--cb-mono)", background: withAlpha(P.faint, 0.1), padding: "1px 8px", borderRadius: 8 }}>{sources.length}</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select value={citationStyle} onChange={(e) => setCitationStyle(e.target.value)} style={{ padding: "6px 10px", fontSize: FONT_SIZES.caption, fontWeight: 500, background: P.bg, color: P.ink, border: `1px solid ${P.line}`, borderRadius: 8, cursor: "pointer", fontFamily: "var(--cb-mono)", outline: "none", ...selectChrome(P) }}>
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
  /* Commit 87 — "1. 1. Grgic J et al. …"
     Vancouver puts the reference number inside the citation string, which
     is correct for an exported bibliography, and this list ALSO paints the
     number in its own left gutter — so on screen every Vancouver entry was
     numbered twice. Export keeps the number (formatCitation is untouched);
     the on-screen string drops the leading marker, because the gutter is
     already doing that job. */
  const formatted = formatCitation(source, style, index).replace(/^\s*\d+\.\s+/, "");
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
          <div style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 7px", marginBottom: 5, background: withAlpha(source.retracted ? STATUS.bad : STATUS.warn, source.retracted ? 0.12 : 0.14), border: `1px solid ${source.retracted ? STATUS.bad : STATUS.warn}`, borderRadius: 8, fontSize: FONT_SIZES.micro, fontWeight: 700, color: source.retracted ? STATUS.bad : STATUS.warn, letterSpacing: "0.01em", fontFamily: "var(--cb-body)" }}>
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
            <span style={{ fontWeight: 600, fontStyle: "normal", color: accent, letterSpacing: "0.01em", marginRight: 6, fontFamily: "var(--cb-body)" }}>TL;DR</span>{source.tldr}
          </div>
        )}
      </div>
    </li>
  );
}
function bibBtn(P, accent) { return { padding: "5px 10px", fontSize: FONT_SIZES.caption, fontWeight: 500, background: "transparent", color: P.ink2, border: `1px solid ${P.line}`, borderRadius: 8, cursor: "pointer", fontFamily: "var(--cb-mono)", letterSpacing: "0.01em" }; }

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
function S_toolbarBtnBase(P) { return { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, background: "transparent", border: "none", borderRadius: 8, color: P.ink2, cursor: "pointer", fontFamily: "var(--cb-mono)", transition: "background 0.15s ease, color 0.15s ease" }; }

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
        borderRadius: 8, maxWidth: 460, width: "100%", padding: "28px", outline: "none",
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
                    fontSize: FONT_SIZES.caption, padding: "6px 12px", borderRadius: 8, cursor: "pointer",
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
                width: "100%", padding: "11px 13px", fontSize: FONT_SIZES.body, borderRadius: 8,
                border: `1px solid ${P.line}`, background: P.dark ? "rgba(255,255,255,0.03)" : "#fff",
                color: P.ink, fontFamily: "var(--cb-body)", resize: "vertical", outline: "none",
              }} />
            </div>
            <button type="submit" disabled={submitting || !description.trim()} style={{
              width: "100%", padding: "12px", fontSize: FONT_SIZES.body, fontWeight: 600,
              background: accent, color: at, border: "none", borderRadius: 8,
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
    text: "Type any scientific question into the search bar. Cerebrum queries 15 scholarly databases in parallel, PubMed, OpenAlex, Semantic Scholar, Europe PMC, and more, then synthesizes a fully cited answer from the retrieved evidence. No pre-trained generalization: every claim traces to a real paper.",
    hint: `Press ${IS_MAC ? "⌘" : "Ctrl"}+K to focus the search bar from anywhere.`,
  },
  {
    title: "Evidence Filters",
    icon: "◉",
    text: "After results arrive, use the filter row to narrow by publication type (meta-analysis, RCT, review, preprint), date range, and evidence tier. Filters apply instantly: the source panel and synthesis update in real time so you see only the evidence that meets your threshold.",
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
    // Commit 55: these referenced the old section names ("Divergent
    // Findings & Gaps", "Methodological Confidence"). Tour copy that names
    // sections the reader will never see is worse than no tour copy.
    text: "The \"Where researchers disagree\" section surfaces papers that conflict with each other or with the consensus. Instead of burying disagreement, Cerebrum shows it, so you can judge the full landscape of a question, not just the majority position.",
    hint: "The \"How solid is this?\" section tells you which disagreements actually matter.",
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
              color: P.faint, fontFamily: "var(--cb-body)",
            }}>{step + 1} of {TOUR_STEPS.length}</span>
          </div>

          {/* Title */}
          <h3 style={{
            fontSize: "clamp(18px, 2.5vw, 22px)", fontWeight: 700, color: P.ink,
            margin: "0 0 12px", fontFamily: "var(--cb-display)", letterSpacing: "-0.02em",
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
              width: i === step ? 20 : 6, height: 6, borderRadius: 8,
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

/* ═══════════════════════════════════════════════════════════════════════
   Commit 84 — DISAGREEMENT AS A VIEW.

   "Where researchers disagree" has always been a paragraph. A paragraph
   about disagreement is a chatbot answer: you have to read it, hold both
   sides in your head, and go dig out the study sizes yourself.

   A researcher reading a contested literature wants to see the shape of
   the fight — who says what, how big their study was, and how recent.
   That is a table, not prose, and building it is an operation a chatbot
   does not perform.

   This reads the section the model already produces, pulls the citation
   markers out of each sentence, and lines the cited papers up against the
   claims they were cited for. It invents nothing: every row is a sentence
   the model wrote and a paper it pointed at. If a section has no
   citations to hang on, the panel does not render and the prose stands
   on its own — a half-empty table is worse than a paragraph.
   ═══════════════════════════════════════════════════════════════════════ */
function extractDisagreement(answer, sources) {
  if (!answer || !Array.isArray(sources) || sources.length < 2) return null;
  // The heading text is fixed by the STRUCTURE contract in search.js.
  /* Commit 93 — the section boundary needed the same fix the renderer got
     in Commit 85. The lookahead required a NEWLINE before the next "##",
     but models routinely glue the following heading onto the end of the
     last sentence. When that happened this captured the next heading as
     part of the disagreement body, and a card in the panel ended with a
     literal "## How solid is this?" hanging off it — which is exactly what
     showed up in a real answer. Tolerate the glued form. */
  const m = answer.match(/##\s*(?:Where researchers disagree|Where they actually differ)\s*\n?([\s\S]*?)(?=\s*#{1,6}\s+\w|$)/i);
  if (!m) return null;
  const body = stripStrayHashes(m[1]).trim();
  if (body.length < 60) return null;

  const claims = [];
  for (const raw of body.split(/(?<=[.!?])\s+(?=[A-Z])/)) {
    // Belt and braces: a marker surviving into an individual sentence
    // would render inside a card, where there is no second chance to
    // catch it.
    const sentence = stripStrayHashes(raw).trim();
    if (sentence.length < 40) continue;
    const refs = [...sentence.matchAll(/\[(\d{1,2})\]/g)].map((x) => parseInt(x[1], 10));
    if (!refs.length) continue;
    const cited = refs
      .map((n) => sources[n - 1])
      .filter(Boolean)
      .map((src, k) => ({
        n: refs[k],
        title: src.title || "Untitled",
        year: src.year || "",
        journal: src.journal || "",
        // Sample size is only shown when the abstract actually states one.
        // Guessing at n is worse than omitting it.
        n_size: (() => {
          const t = `${src.abstract || ""}`;
          const mm = t.match(/\b(?:n\s*=\s*|sample of\s+|total of\s+)(\d{2,6})\b/i);
          return mm ? parseInt(mm[1], 10) : null;
        })(),
      }));
    if (cited.length) claims.push({ text: sentence.replace(/\[\d{1,2}\]/g, "").replace(/\s+([.,;])/g, "$1").trim(), cited });
  }
  return claims.length >= 2 ? claims : null;
}

function DisagreementPanel({ answer, sources, P, accent, isMobile }) {
  const claims = useMemo(() => extractDisagreement(answer, sources), [answer, sources]);
  const [open, setOpen] = useState(true);
  if (!claims) return null;
  return (
    <UICard P={P} style={{ marginTop: SP.xl }}>
      <UILabel P={P} accent={accent} right={
        <button onClick={() => setOpen((v) => !v)} style={{
          background: "none", border: "none", color: P.faint, cursor: "pointer",
          fontSize: FONT_SIZES.micro, fontFamily: "var(--cb-body)", fontWeight: 600, padding: 0,
        }}>{open ? "Hide" : "Show"}</button>
      }>The disagreement, laid out</UILabel>
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: SP.md }}>
          {claims.map((c, i) => (
            <div key={i} style={{
              display: "flex", flexDirection: isMobile ? "column" : "row",
              gap: isMobile ? SP.sm : SP.lg, alignItems: "flex-start",
              paddingTop: i ? SP.md : 0,
              borderTop: i ? `1px solid ${P.line}` : "none",
            }}>
              <div style={{ flex: 1, minWidth: 0, fontSize: FONT_SIZES.small, color: P.ink, lineHeight: 1.55 }}>
                {c.text}
              </div>
              <div style={{ flexShrink: 0, width: isMobile ? "100%" : 210, display: "flex", flexDirection: "column", gap: 5 }}>
                {c.cited.map((s2, k) => (
                  <div key={k} style={{
                    fontSize: FONT_SIZES.micro, color: P.faint, fontFamily: "var(--cb-mono)",
                    display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap",
                  }}>
                    <span style={{
                      padding: "1px 6px", borderRadius: RADIUS.pill,
                      background: withAlpha(accent, 0.14), color: accent, fontWeight: 700,
                    }}>{s2.n}</span>
                    {s2.year && <span>{s2.year}</span>}
                    {s2.n_size && <span style={{ color: P.ink2 }}>n={s2.n_size.toLocaleString()}</span>}
                    {s2.journal && (
                      <span style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s2.journal}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div style={{ fontSize: FONT_SIZES.micro, color: P.faint, marginTop: 2 }}>
            Sample sizes shown only where the abstract states one.
          </div>
        </div>
      )}
    </UICard>
  );
}

function Turn({ t, P, accent, at, S, typewriter, last = false, autoRead = false, hoverCite, setHoverCite, onRelated, citationStyle, setCitationStyle, onShowNetwork = () => {}, onShowTimeline = () => {}, onEvidenceTable = () => {}, interactive = true, user = null, onWatchChanged = () => {} }) {
  const shown = useTypewriter(t.answer, typewriter && t.fresh);
  const done = shown === t.answer;
  // Only fires once the text has stopped changing (see the comment at the
  // render site): `done` flips true when the typewriter has caught up, or
  // immediately when the typewriter is off.
  const answerRevealRef = useGsapReveal([done ? t.answer : null], { y: 12, stagger: 0.045, duration: 0.7 });
  /* Which citation the reader is currently following. Persists until they
     choose another or press Escape, so after reading a source they can find
     the sentence it belonged to. Local to the turn: two answers on screen
     should not fight over one selection. */
  const [activeCite, setActiveCite] = useState(0);
  useEffect(() => {
    if (!activeCite) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setActiveCite(0); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeCite]);
  const [copiedAnswer, setCopiedAnswer] = useState(false);
  // Commit 98 — "up" | "down" | "" ; one vote per answer per session.
  const [vote, setVote] = useState("");
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
        <span style={{ fontFamily: "var(--cb-body)", fontSize: FONT_SIZES.caption, letterSpacing: "0.01em" }}>Inquiry</span>
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
                <span style={{ fontSize: FONT_SIZES.caption, fontWeight: 600, color: accent, background: withAlpha(accent, 0.1), padding: "3px 10px", borderRadius: 8, fontFamily: "var(--cb-mono)", letterSpacing: "0.02em" }}>{t.sources.length} source{t.sources.length === 1 ? "" : "s"}</span>
                {t.answer && <span style={{ fontSize: FONT_SIZES.caption, color: P.faint, fontFamily: "var(--cb-mono)" }}>{Math.ceil(t.answer.split(/\s+/).length / 238)} min read</span>}
                {/* Retrieval coverage, from the server's record of which
                    databases actually settled — not a fixed list, and not a
                    guess. Rendered only when the backend supplied it, so an
                    older cached response simply omits it rather than
                    inventing a number. Hovering names the ones that did not
                    answer, which is the part a researcher would want. */}
                {Array.isArray(t.sourcesQueried) && t.sourcesQueried.length > 0 && (() => {
                  const ok = t.sourcesQueried.filter((x) => x.ok);
                  const missing = t.sourcesQueried.filter((x) => !x.ok).map((x) => x.source);
                  return (
                    <span
                      title={missing.length ? `Did not answer: ${missing.join(", ")}` : "Every database answered"}
                      style={{ fontSize: FONT_SIZES.caption, color: P.faint, fontFamily: "var(--cb-mono)", cursor: missing.length ? "help" : "default" }}
                    >
                      {ok.length}/{t.sourcesQueried.length} databases
                    </span>
                  );
                })()}
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
                {t.answer.length > 40 && <AnswerPlayer text={t.answer} accent={accent} P={P} compact autoPlay={autoRead && last && done} />}
                {done && interactive && t.sources && t.sources.length >= 2 && <ToolbarBtn title="The evidence, side by side" icon="table" accent={accent} P={P} onClick={() => onEvidenceTable(t.sources)} />}
                {interactive && t.sources && t.sources.length >= 2 && <ToolbarBtn title="Source network" icon="network" accent={accent} P={P} onClick={() => onShowNetwork(t.sources)} />}
                {interactive && t.sources && t.sources.length >= 2 && <ToolbarBtn title="Timeline" icon="timeline" accent={accent} P={P} onClick={() => onShowTimeline(t.sources)} />}
                {/* Commit 98 — this pair is what finally feeds /api/vote. The
                    score it writes is not cosmetic: /api/search only re-serves
                    a cached answer to other people once score >= 2, and a
                    downvote also decays the confirmation count on the papers
                    attached to that query. Voting is deliberately one-shot per
                    answer (the buttons lock after a press) and fire-and-forget
                    — a failed vote is not worth an error dialog, and the
                    endpoint is rate-limited server-side anyway. Gated on
                    t.answerId so the streaming/fallback paths that don't
                    return one simply don't show the control. */}
                {t.answerId ? (
                  <>
                    <ToolbarBtn
                      title={vote === "up" ? "Marked useful" : "This was useful"}
                      icon="thumb-up" active={vote === "up"} accent={accent} P={P}
                      onClick={() => {
                        if (vote) return;
                        setVote("up");
                        fetch("/api/vote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answerId: t.answerId, vote: "up" }) }).catch(() => {});
                        toast("Thanks. That helps rank this answer.");
                      }}
                    />
                    <ToolbarBtn
                      title={vote === "down" ? "Marked not useful" : "This missed"}
                      icon="thumb-down" active={vote === "down"} accent={STATUS.warn} P={P}
                      onClick={() => {
                        if (vote) return;
                        setVote("down");
                        fetch("/api/vote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answerId: t.answerId, vote: "down" }) }).catch(() => {});
                        toast("Noted. This answer won't be reused.");
                      }}
                    />
                  </>
                ) : null}
                <ToolbarBtn title="Report bad answer" icon="flag" accent={STATUS.bad} P={P} onClick={() => setShowReport(true)} />
              </div>
            )}
          </div>
        )}
        {/* Commit 55 — the answer arrives section by section, on the same
            GSAP gesture as the Intro and every page view. The whole card
            already faded in as one block (cbEnter), which is fine for a
            card and wrong for a document: an answer is read top-down, and
            staggering its paragraphs is what makes it feel like it's being
            composed rather than pasted. Keyed on the answer text so it
            replays for each new answer but NOT on every re-render, and
            skipped entirely while the typewriter is still streaming (the
            text is changing every few milliseconds; animating each keystroke
            would be strobing, not motion). */}
        <div ref={answerRevealRef}>
          {renderAnswer(shown, t.sources, P, accent, hoverCite, setHoverCite, activeCite, setActiveCite)}
        </div>
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
        <div style={{ marginTop: 20, padding: "20px 24px", border: `1px solid ${withAlpha(STATUS.warn, 0.3)}`, borderRadius: 8, background: withAlpha(STATUS.warn, 0.04) }} className="cb-fade">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <div style={{ width: 3, height: 18, background: STATUS.warn, borderRadius: 8 }} />
            <div style={{ fontSize: FONT_SIZES.small, fontWeight: 600, letterSpacing: "0.01em", color: STATUS.warn, fontFamily: "var(--cb-body)" }}>Points of Friction</div>
            <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 600, color: withAlpha(STATUS.warn, 0.7), fontFamily: "var(--cb-mono)", background: withAlpha(STATUS.warn, 0.1), padding: "1px 8px", borderRadius: 8 }}>{t.literatureConflicts.length}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {t.literatureConflicts.map((c, ci) => (
              <div key={ci} style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 12, alignItems: "stretch" }}>
                <div style={{ padding: "12px 14px", background: withAlpha(STATUS.warn, 0.06), borderRadius: 8, border: `1px solid ${withAlpha(STATUS.warn, 0.15)}` }}>
                  <div style={{ fontSize: FONT_SIZES.micro, fontWeight: 600, letterSpacing: "0.01em", color: withAlpha(STATUS.warn, 0.7), fontFamily: "var(--cb-body)", marginBottom: 6 }}>[{c.idxA}]</div>
                  <div style={{ fontSize: FONT_SIZES.small, color: P.ink, lineHeight: 1.55 }}>{c.claimA}</div>
                  <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, marginTop: 6, lineHeight: 1.4, fontStyle: "italic" }}>{c.sourceA ? renderCleanTitle(c.sourceA) : ""}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", color: withAlpha(STATUS.warn, 0.5), fontSize: FONT_SIZES.small, fontFamily: "var(--cb-mono)", fontWeight: 700 }}>vs</div>
                <div style={{ padding: "12px 14px", background: withAlpha(STATUS.warn, 0.06), borderRadius: 8, border: `1px solid ${withAlpha(STATUS.warn, 0.15)}` }}>
                  <div style={{ fontSize: FONT_SIZES.micro, fontWeight: 600, letterSpacing: "0.01em", color: withAlpha(STATUS.warn, 0.7), fontFamily: "var(--cb-body)", marginBottom: 6 }}>[{c.idxB}]</div>
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
              style={{ padding: "7px 14px", fontSize: FONT_SIZES.small, fontWeight: 500, background: s.query ? withAlpha(accent, 0.08) : "transparent", color: s.query ? accent : P.faint, border: `1px solid ${s.query ? withAlpha(accent, 0.25) : P.line}`, borderRadius: 8, cursor: s.query ? "pointer" : "default", fontFamily: "inherit" }}>
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
            <div style={{ width: 3, height: 18, background: accent, borderRadius: 8 }} />
            <div style={{ fontSize: FONT_SIZES.small, fontWeight: 600, letterSpacing: "0.01em", color: P.ink, fontFamily: "var(--cb-body)" }}>Related videos</div>
            <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 600, color: P.faint, fontFamily: "var(--cb-mono)", background: withAlpha(P.faint, 0.1), padding: "1px 8px", borderRadius: 8 }}>{t.videos.length}</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }} className="cb-stagger">
            {t.videos.slice(0, 6).map((v, i) => (
              <button key={v.id || i} type="button" onClick={() => setOpenVideo(v)} className="cb-fade cb-card" style={{ display: "block", width: "100%", background: P.surface, border: `1px solid ${P.line}`, borderRadius: 8, overflow: "hidden", textDecoration: "none", color: P.ink, opacity: 0, padding: 0, font: "inherit", textAlign: "left", cursor: "pointer", transition: "border-color 0.2s ease, box-shadow 0.2s ease" }}
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
      {/* Commit 84 — the disagreement, as a reading rather than a
          paragraph. See DisagreementPanel. */}
      {interactive && done && (
        <DisagreementPanel answer={t.answer} sources={t.sources} P={P} accent={accent} isMobile={typeof window !== "undefined" && window.innerWidth < 900} />
      )}
      {/* Commit 65 — "Watch this topic", placed at the end of a finished
          answer because that is the one moment we know the reader cares
          about this subject. Only on the LAST turn: repeating it under
          every answer in a long thread turns a useful offer into nagging. */}
      {interactive && done && last && (
        <WatchTopicButton q={t.q} P={P} accent={accent} user={user} onChanged={onWatchChanged} />
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
      {/* Print-only academic layout — invisible in the normal UI (see the
          base ".cb-print-paper-doc { display: none }" rule) and only ever
          mounted once this specific Turn's "Generate paper" button has
          fired (see paperReady above), so it's never the wrong turn's
          content that a multi-turn conversation's print stylesheet finds.

          Rendered through a portal straight onto <body>, NOT in place here.
          It used to render right where this comment sits — several flex/grid
          levels deep inside the app shell — and get lifted out visually with
          position:absolute/fixed plus a "make everything else invisibility:
          hidden" trick. That out-of-flow overlay approach is what caused the
          real bug: Chromium's print-to-PDF pagination computes an
          out-of-flow box's per-page available width completely wrong once
          its content spans more than one printed page (title/abstract
          wrapping one word per line), and it never contributes to the
          document's flowed height, so the page count printed was whatever
          the (still-in-flow-but-hidden) chat happened to be, not the paper's
          real length — hence trailing blank pages too. A portal makes this
          node a plain static, in-flow, first-class page of its own with
          body as its only ancestor, so Chromium's ordinary (well-exercised)
          multi-page article pagination lays it out the same way it would
          any other printable page — see the plain ".cb-print-paper-doc"
          rules in the @media print block below. */}
      {paperReady && document.body && createPortal(
        <div className="cb-print-paper-doc" aria-hidden="true">
          <div className="cb-paper-watermark">Cerebrum™</div>
          <div className="cb-paper-page">
            {/* Commit 51: the same brain Mark used in the Sidebar/header
                (see the Mark component) — a small letterhead-style masthead
                above the title, not a new logo invented just for exports. */}
            <div className="cb-paper-masthead">
              <Mark size={16} accent="#000" glow={false} />
              <span className="cb-paper-masthead-text">CEREBRUM</span>
            </div>
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
        </div>,
        document.body
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
      <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 600, letterSpacing: "0.1em", color: accent, marginBottom: 10, fontFamily: "var(--cb-body)" }}>{title}</div>
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
      <div ref={trapRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} style={{ background: P.bg, borderRadius: 8, maxWidth: 600, width: "100%", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 24px 80px rgba(0,0,0,0.5)", border: `1px solid ${P.line}`, outline: "none" }} className="cb-modal">
        <div style={{ position: "sticky", top: 0, background: P.bg, padding: "20px 24px 16px", borderBottom: `1px solid ${P.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: FONT_SIZES.heading, fontWeight: 700, letterSpacing: "-0.02em", color: P.ink, fontFamily: "var(--cb-display)" }}>How Cerebrum works</div>
            <div style={{ fontSize: FONT_SIZES.small, color: P.faint, marginTop: 2, fontFamily: "var(--cb-mono)" }}>A short, honest technical explanation.</div>
          </div>
          <button onClick={close} aria-label="Close" style={{ background: "none", border: "none", color: P.faint, cursor: "pointer", padding: 4, display: "inline-flex" }}><Icon name="close" size={18} /></button>
        </div>
        <div style={{ padding: "24px 24px 32px" }}>
          <Section title="The retrieval layer">Every query fans out to 15 scholarly databases in parallel, all free and keyless.
            <List items={[<><strong>Europe PMC</strong> — biomedical, includes preprints</>,<><strong>PubMed</strong> (NCBI E-utilities) — biomedical, automatic term mapping</>,<><strong>OpenAlex</strong> — cross-disciplinary, concept graph</>,<><strong>Crossref</strong> — DOI-registered works, checked for retraction status</>,<><strong>arXiv</strong> — physics, math, CS, quantitative biology</>,<><strong>Semantic Scholar</strong> — includes auto-generated TL;DR summaries</>,<><strong>bioRxiv</strong> preprints (via OpenAlex)</>,<><strong>DOAJ, PLOS, Zenodo</strong> — additional open-access coverage</>,<><strong>CORE, BASE, PMC full-text, OpenAIRE</strong> — additional aggregator/repository coverage</>]} />
          </Section>
          <Section title="Query intelligence"><List items={[<><strong>Species queries</strong> are wrapped in quoted phrases with strict species-level filtering.</>,<><strong>Author queries</strong> hit OpenAlex's author disambiguation endpoint.</>,<><strong>Acronym expansion</strong> for common scientific abbreviations.</>,<><strong>Fallback ladder</strong>: if a strict query returns nothing, we retry looser, then plain.</>]} /></Section>
          <Section title="Trust and safety"><List items={[<><strong>Retraction flagging</strong> via Crossref's crossmark data.</>,<><strong>No fabricated citations</strong> — the AI is instructed to never invent DOIs, authors, or journal names.</>,<><strong>Honest hedging</strong> — when literature is thin, the model says so.</>]} /></Section>
          <Section title="The AI layer">Answers are synthesized by free-tier language models. Dozens of models across three providers (OpenRouter, Cloudflare Workers AI, and Pollinations) are raced in parallel in two waves — whichever responds first with a good answer wins — so a slow or rate-limited provider can't stall the others.</Section>
          <Section title="Known limitations"><List items={["New preprints may not be indexed anywhere for hours or days.","The AI can misinterpret papers: verify claims.","Free AI models rate-limit under load.","Non-English literature is under-indexed."]} /></Section>
          <Section title="What Cerebrum is not"><List items={["Not a replacement for reading the actual papers","Not a systematic review tool","Not medical, legal, or financial advice","Not paywalled or ad-supported"]} /></Section>
          <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, marginTop: 24, paddingTop: 16, borderTop: `1px solid ${P.line}`, fontFamily: "var(--cb-mono)" }}>Cerebrum™ · Built by Vaticay</div>
        </div>
      </div>
    </div>
  );
}

/* Commit 92 — V5AnnouncementModal deleted.
   Nothing rendered it (see the note where v5Open used to live), it
   advertised the concept-illustration feature that this commit removed,
   and it was the last thing referencing that feature. A dead component
   describing a dead feature is how a file gets to fourteen thousand
   lines. */

// Shown once, right after a successful sign-in/sign-up, if the browser
// already had guest-mode saved articles or history sitting in localStorage.
// Accepting keeps that data exactly where it is client-side (nothing new to
// fetch) — it simply gets swept into the account by the normal sync effect
// that already watches `saved`/`history` for changes once `user` is set.
function ImportLocalDataPrompt({ P, accent, at, savedCount, historyCount, onImport, onSkip }) {
  const trapRef = useFocusTrap();
  return (
    <div role="dialog" aria-modal="true" aria-label="Import your existing data" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 216, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} className="cb-backdrop">
      <div ref={trapRef} tabIndex={-1} style={{ background: P.bg, borderRadius: 8, maxWidth: 400, width: "100%", padding: 26, boxShadow: "0 24px 80px rgba(0,0,0,0.5)", border: `1px solid ${P.line}`, outline: "none" }} className="cb-modal">
        <div style={{ width: 40, height: 40, borderRadius: 8, background: withAlpha(accent, 0.12), color: accent, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}><Icon name="bookmarkFilled" size={18} /></div>
        <div style={{ fontSize: FONT_SIZES.subhead, fontWeight: 700, color: P.ink, marginBottom: 8 }}>Bring your existing data along?</div>
        <div style={{ fontSize: FONT_SIZES.small, color: P.ink2, lineHeight: 1.6, marginBottom: 18 }}>
          This browser already has {savedCount > 0 ? <><strong>{savedCount} saved source{savedCount === 1 ? "" : "s"}</strong>{historyCount > 0 ? " and " : ""}</> : null}
          {historyCount > 0 ? <><strong>{historyCount} past investigation{historyCount === 1 ? "" : "s"}</strong></> : null} from before you signed in. Attach it to your new account so it follows you to other devices?
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onSkip} style={{ flex: 1, padding: "11px", fontSize: FONT_SIZES.small, fontWeight: 600, background: "transparent", color: P.ink2, border: `1px solid ${P.line}`, borderRadius: 8, cursor: "pointer" }}>Start account fresh</button>
          <button onClick={onImport} style={{ flex: 1, padding: "11px", fontSize: FONT_SIZES.small, fontWeight: 600, background: accent, color: at, border: "none", borderRadius: 8, cursor: "pointer" }}>Add to my account</button>
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
function CollectionsModal({ P, accent, at, S, saved, collections, onCreateCollection, onRenameCollection, onDeleteCollection, onMoveSource, close, page = false, narrow = false }) {
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [activeId, setActiveId] = useState("all"); // "all" | "uncategorized" | collection id
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  // Commit 88 — Escape dismisses a dialog. In page mode there is nothing
  // to dismiss, and stealing Escape from a page is how you lose a
  // half-typed collection name.
  useEffect(() => { if (page) return; const onKey = (e) => { if (e.key === "Escape") close(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [close, page]);
  const trapRef = useFocusTrap();

  const countFor = (id) => id === "all" ? saved.length : id === "uncategorized" ? saved.filter((s) => !s.collectionId).length : saved.filter((s) => s.collectionId === id).length;
  const visible = activeId === "all" ? saved : activeId === "uncategorized" ? saved.filter((s) => !s.collectionId) : saved.filter((s) => s.collectionId === activeId);

  return (
    /* Commit 88 — the same component now renders either as the dialog it
       used to be (still reachable from the command palette and from a
       source's "add to collection" action, where interrupting you IS the
       right behaviour) or as a full page when it is the destination the
       sidebar navigated to. One implementation, two containers, so the two
       can never drift apart. */
    <div
      onClick={page ? undefined : close}
      role={page ? undefined : "dialog"}
      aria-modal={page ? undefined : "true"}
      aria-label={page ? undefined : "Collections"}
      style={page
        ? { width: "100%" }
        : { position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      className={page ? undefined : "cb-backdrop"}
    >
      <div ref={trapRef} tabIndex={-1} onClick={page ? undefined : ((e) => e.stopPropagation())}
        style={page
          /* Commit 88 — the two-column dialog cannot survive 390px. Its
             210px fixed rail plus a content column left about 120px for
             paper titles, which wrapped to one word — often one letter —
             per line. On a narrow page it stacks: the collection list on
             top at natural height, its contents below. */
          ? (narrow
              ? { background: P.surface, borderRadius: RADIUS.lg, width: "100%", display: "flex", flexDirection: "column", border: `1px solid ${P.line}`, overflow: "hidden", outline: "none" }
              : { background: P.surface, borderRadius: RADIUS.lg, width: "100%", height: "min(640px, 68vh)", display: "flex", border: `1px solid ${P.line}`, overflow: "hidden", outline: "none" })
          : { background: P.bg, borderRadius: 8, maxWidth: 780, width: "100%", maxHeight: "85vh", display: "flex", boxShadow: "0 24px 80px rgba(0,0,0,0.5)", border: `1px solid ${P.line}`, overflow: "hidden", outline: "none" }}
        className={page ? undefined : "cb-modal"}>
        <div style={narrow
          ? { width: "100%", flexShrink: 0, borderBottom: `1px solid ${P.line}`, padding: 16 }
          : { width: 210, flexShrink: 0, borderRight: `1px solid ${P.line}`, padding: 16, overflowY: "auto" }}>
          <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 600, letterSpacing: "0.01em", color: P.faint, fontFamily: "var(--cb-body)", marginBottom: 12 }}>Collections</div>
          {[{ id: "all", name: "All saved" }, { id: "uncategorized", name: "Uncategorized" }, ...collections].map((c) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
              {renamingId === c.id ? (
                <input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { onRenameCollection(c.id, renameValue); setRenamingId(null); } if (e.key === "Escape") { e.stopPropagation(); setRenamingId(null); } }} onBlur={() => setRenamingId(null)} style={{ flex: 1, padding: "7px 8px", fontSize: FONT_SIZES.small, borderRadius: 8, border: `1px solid ${accent}`, background: "transparent", color: P.ink }} />
              ) : (
                <button onClick={() => setActiveId(c.id)} onDoubleClick={() => { if (c.id !== "all" && c.id !== "uncategorized") { setRenamingId(c.id); setRenameValue(c.name); } }} style={{ flex: 1, textAlign: "left", padding: "7px 8px", fontSize: FONT_SIZES.small, borderRadius: 8, border: "none", cursor: "pointer", background: activeId === c.id ? withAlpha(accent, 0.12) : "transparent", color: activeId === c.id ? accent : P.ink2, fontFamily: "var(--cb-body)" }}>
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
            <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) { onCreateCollection(newName.trim()); setNewName(""); } }} placeholder="New collection…" aria-label="New collection name" style={{ flex: 1, padding: "7px 8px", fontSize: FONT_SIZES.small, borderRadius: 8, border: `1px solid ${P.line}`, background: "transparent", color: P.ink }} />
            <button onClick={() => { if (newName.trim()) { onCreateCollection(newName.trim()); setNewName(""); } }} aria-label="Create collection" style={{ background: withAlpha(accent, 0.12), color: accent, border: "none", borderRadius: 8, padding: "0 10px", cursor: "pointer" }}><Icon name="plus" size={13} /></button>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "16px 20px", borderBottom: `1px solid ${P.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: FONT_SIZES.body, fontWeight: 700, color: P.ink }}>{activeId === "all" ? "All saved" : activeId === "uncategorized" ? "Uncategorized" : collections.find((c) => c.id === activeId)?.name || "Collection"}</div>
            {!page && <button onClick={close} aria-label="Close" style={{ background: "none", border: "none", color: P.faint, cursor: "pointer", padding: 4, display: "inline-flex" }}><Icon name="close" size={18} /></button>}
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
            {visible.length === 0 ? (
              <div style={{ fontSize: FONT_SIZES.small, color: P.faint, textAlign: "center", padding: "40px 0" }}>
                {activeId === "all" ? "Nothing saved yet." : "Nothing here yet: move a saved source in with the dropdown next to it on “All saved.”"}
              </div>
            ) : visible.map((s, i) => (
              <div key={sourceKey(s)} style={{ padding: "12px 0", borderTop: i ? `1px solid ${P.line}` : "none", display: "flex", alignItems: "flex-start", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: FONT_SIZES.small, fontWeight: 600, color: P.ink, marginBottom: 4 }}>{s.title}</div>
                  <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, fontFamily: "var(--cb-mono)" }}>{s.journal || ""}{s.year ? ` · ${s.year}` : ""}</div>
                </div>
                <select value={s.collectionId || ""} onChange={(e) => onMoveSource(s, e.target.value || null)} aria-label={`Move "${s.title}" to a collection`} style={{ fontSize: FONT_SIZES.caption, padding: "5px 6px", borderRadius: 8, border: `1px solid ${P.line}`, background: "transparent", color: P.ink2, fontFamily: "var(--cb-mono)", cursor: "pointer", ...selectChrome(P) }}>
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
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ width: "100%", padding: "9px 10px", fontSize: FONT_SIZES.small, borderRadius: 8, border: `1px solid ${P.line}`, background: P.dark ? "rgba(255,255,255,0.03)" : "#fff", color: P.ink, fontFamily: "var(--cb-mono)", cursor: "pointer", ...selectChrome(P) }}>
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
      <div ref={trapRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} style={{ background: P.bg, borderRadius: 8, maxWidth: 1100, width: "100%", height: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 80px rgba(0,0,0,0.5)", border: `1px solid ${P.line}`, overflow: "hidden", outline: "none" }} className="cb-modal">
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
            <div style={{ fontSize: FONT_SIZES.micro, fontWeight: 600, letterSpacing: "0.01em", color: P.faint, fontFamily: "var(--cb-body)", marginBottom: 6 }}>Deep Read</div>
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
              {source.type && <span style={{ fontSize: FONT_SIZES.micro, fontWeight: 600, letterSpacing: "0.01em", color: accent, background: withAlpha(accent, 0.1), padding: "2px 6px", borderRadius: 8, fontFamily: "var(--cb-body)" }}>{source.type}</span>}
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
            <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 600, letterSpacing: "0.01em", color: P.faint, fontFamily: "var(--cb-body)", marginBottom: 10 }}>Abstract</div>
            <div style={{ fontSize: FONT_SIZES.body, color: P.ink, lineHeight: 1.75, fontFamily: "var(--cb-body)" }}>
              {source.abstract || "No abstract available for this paper."}
            </div>
          </div>

          {/* Scoped Q&A */}
          <div style={{ borderTop: "1px solid " + P.line, paddingTop: 20 }}>
            <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 600, letterSpacing: "0.01em", color: P.faint, fontFamily: "var(--cb-body)", marginBottom: 10 }}>Ask about this paper</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={scopedInput}
                onChange={(e) => setScopedInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && askScoped()}
                placeholder="e.g. What methodology did they use?"
                style={{ flex: 1, padding: "10px 14px", fontSize: FONT_SIZES.small, border: "1px solid " + P.line, borderRadius: 8, background: "transparent", color: P.ink, fontFamily: "var(--cb-body)", outline: "none" }}
              />
              <button onClick={askScoped} disabled={scopedBusy} style={{
                padding: "10px 16px", fontSize: FONT_SIZES.small, fontWeight: 600,
                background: P.ink, color: P.bg, border: "none", borderRadius: 8,
                cursor: scopedBusy ? "default" : "pointer", opacity: scopedBusy ? 0.6 : 1,
                fontFamily: "var(--cb-body)", flexShrink: 0,
              }}>{scopedBusy ? "Thinking…" : "Ask"}</button>
            </div>
            {scopedAnswer && (
              <div className="cb-fade" style={{ marginTop: 16, padding: "16px 18px", background: P.dark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)", border: "1px solid " + P.line, borderRadius: 8, fontSize: FONT_SIZES.body, color: P.ink, lineHeight: 1.7, fontFamily: "var(--cb-body)" }}>
                {scopedAnswer}
              </div>
            )}
          </div>
          </>}
          {drawerTab === "methodology" && (
            <div>
              <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 600, letterSpacing: "0.01em", color: P.faint, fontFamily: "var(--cb-body)", marginBottom: 16 }}>Methodology Matrix</div>
              {methodology.length > 0 && methodology[0].design !== "Not specified" ? (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: FONT_SIZES.small, fontFamily: "var(--cb-body)" }}>
                    <thead>
                      <tr>
                        {["Study Design", "Sample Size", "Key Metrics", "P-Value / Significance"].map((h) => (
                          <th key={h} style={{ padding: "10px 12px", textAlign: "left", borderBottom: "2px solid " + P.line, color: P.ink, fontWeight: 600, fontFamily: "var(--cb-body)", fontSize: FONT_SIZES.caption, letterSpacing: "0.01em", whiteSpace: "nowrap" }}>{h}</th>
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
      <div ref={trapRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} style={{ background: P.bg, borderRadius: 8, maxWidth: 680, width: "100%", boxShadow: "0 24px 80px rgba(0,0,0,0.5)", border: `1px solid ${P.line}`, outline: "none" }} className="cb-modal">
        <div style={{ padding: "18px 22px", borderBottom: `1px solid ${P.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: FONT_SIZES.body, fontWeight: 700, color: P.ink }}>Source network</div>
            <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, marginTop: 2 }}>Bigger node, closer match. Lines share a journal.</div>
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

/* ══════════════════════════════════════════════════════════════════
   Commit 92 — the concept illustrations are gone.

   That feature sent the question to a text-to-image endpoint and showed
   whatever came back. It was labelled honestly ("not a data figure from
   the cited papers"), but the label was doing a lot of work: what it
   actually produced was a decorative picture with no relationship to the
   evidence, on a screen whose entire claim is that everything on it
   traces to a real source. On a research instrument that is worse than
   nothing — it is the one element that could make a careful answer look
   unserious.

   Replaced with the thing a reader of a cited answer actually wants and
   could not previously get: the studies behind the answer laid out side
   by side, so you can see at a glance that three of the four are reviews,
   or that the one disagreeing result is also the smallest.

   Every column is derived from data already retrieved — nothing is
   generated, nothing is inferred, nothing is fetched. A sample size is
   shown ONLY where the abstract states one in a form that can be read
   literally; a design is shown only where the abstract names it. Blank
   is a legitimate answer and appears as an em dash, because "we could not
   determine this" is information and guessing would defeat the purpose.
   ══════════════════════════════════════════════════════════════════ */

// Design vocabulary, strongest evidence first — the first match wins, so
// "systematic review of randomized trials" is classified as the review it
// is rather than as a trial.
const STUDY_DESIGNS = [
  [/\bmeta-?analys/i, "Meta-analysis", 6],
  [/\bsystematic review/i, "Systematic review", 6],
  [/\bscoping review\b|\bnarrative review\b|\bliterature review\b|\breview\b/i, "Review", 3],
  [/\brandomi[sz]ed controlled trial\b|\bRCT\b|\brandomi[sz]ed[, ]/i, "Randomised trial", 5],
  [/\bcrossover (trial|design|study)\b/i, "Crossover trial", 5],
  [/\bcohort (study|design)\b|\bprospective cohort\b|\blongitudinal study\b/i, "Cohort", 4],
  [/\bcase[- ]control\b/i, "Case-control", 4],
  [/\bcross[- ]sectional\b|\bsurvey (of|study)\b/i, "Cross-sectional", 2],
  [/\bcase (report|series)\b/i, "Case report", 1],
  [/\bin vivo\b|\bmouse\b|\bmurine\b|\brat\b|\bmice\b|\bzebrafish\b|\bprimate\b/i, "Animal", 2],
  [/\bin vitro\b|\bcell (line|culture)\b|\bassay\b/i, "In vitro", 2],
  [/\bmodel(ling|ing)\b|\bsimulation\b|\bcomputational\b/i, "Modelling", 2],
];

function studyDesign(source) {
  const hay = [source && source.abstract, source && source.title].filter(Boolean).join(" ");
  if (!hay) return null;
  for (const [re, label, rank] of STUDY_DESIGNS) {
    if (re.test(hay)) return { label, rank };
  }
  return null;
}

/* Sample size, read literally or not at all.

   The patterns below each require the abstract to state the number in a
   form that unambiguously means "how many were studied": n = 420, "420
   participants", "a total of 420 patients". A bare number near the word
   "patients" is not enough — abstracts are full of numbers (doses, years,
   percentages, confidence bounds) and a wrong sample size on a comparison
   table is far more damaging than a blank one. */
function sampleSize(source) {
  const a = String((source && source.abstract) || "");
  if (!a) return null;
  const pats = [
    /\bn\s*=\s*([\d][\d,]{1,7})\b/i,
    /\b(?:a\s+)?total of\s+([\d][\d,]{1,7})\s+(?:participants|patients|subjects|individuals|adults|children|women|men|animals|mice|rats|samples|studies|trials)\b/i,
    /\b([\d][\d,]{1,7})\s+(?:participants|patients|subjects|individuals|healthy volunteers)\b/i,
    /\b(?:included|enrolled|recruited|analysed|analyzed)\s+([\d][\d,]{1,7})\s+(?:participants|patients|subjects|individuals|studies|trials|articles|records)\b/i,
  ];
  for (const re of pats) {
    const m = a.match(re);
    if (!m) continue;
    const n = parseInt(String(m[1]).replace(/,/g, ""), 10);
    // A "sample" of 1 or of ten million is a parsing accident, not a study.
    if (Number.isFinite(n) && n >= 2 && n <= 5000000) return n;
  }
  return null;
}

function EvidenceTableModal({ P, accent, at, sources, close }) {
  useEffect(() => { const onKey = (e) => { if (e.key === "Escape") close(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [close]);
  const trapRef = useFocusTrap();
  const [sortKey, setSortKey] = useState("cited");

  const rows = useMemo(() => (sources || []).map((s, i) => ({
    i: i + 1,
    src: s,
    design: studyDesign(s),
    n: sampleSize(s),
    year: Number(s.year) || null,
    citations: typeof s.citations === "number" ? s.citations : null,
  })), [sources]);

  const sorted = useMemo(() => {
    const r = rows.slice();
    if (sortKey === "n") return r.sort((a, b) => (b.n || -1) - (a.n || -1));
    if (sortKey === "year") return r.sort((a, b) => (b.year || 0) - (a.year || 0));
    if (sortKey === "design") return r.sort((a, b) => ((b.design && b.design.rank) || 0) - ((a.design && a.design.rank) || 0));
    return r.sort((a, b) => a.i - b.i); // as cited
  }, [rows, sortKey]);

  const withN = rows.filter((r) => r.n != null);
  const withDesign = rows.filter((r) => r.design);
  const dash = <span style={{ color: P.faint, opacity: 0.6 }}>—</span>;

  const th = { textAlign: "left", padding: "0 0 8px", fontSize: FONT_SIZES.micro, fontWeight: 700, color: P.faint, fontFamily: "var(--cb-body)", whiteSpace: "nowrap" };
  const td = { padding: "12px 0", fontSize: FONT_SIZES.caption, color: P.ink, verticalAlign: "top", fontFamily: "var(--cb-body)", borderTop: `1px solid ${P.line}` };

  return (
    <div onClick={close} role="dialog" aria-modal="true" aria-label="The evidence, side by side" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} className="cb-backdrop">
      <div ref={trapRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} style={{ background: P.bg, borderRadius: RADIUS.lg, maxWidth: 860, width: "100%", maxHeight: "86vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 80px rgba(0,0,0,0.5)", border: `1px solid ${P.line}`, outline: "none", overflow: "hidden" }} className="cb-modal">
        <div style={{ padding: "18px 22px 16px", borderBottom: `1px solid ${P.line}`, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: FONT_SIZES.body, fontWeight: 700, color: P.ink, fontFamily: "var(--cb-display)", letterSpacing: "-0.01em" }}>The evidence, side by side</div>
            <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, marginTop: 3, lineHeight: 1.5 }}>
              {rows.length} source{rows.length === 1 ? "" : "s"} behind this answer
              {withDesign.length > 0 && ` · design read for ${withDesign.length}`}
              {withN.length > 0 && ` · sample size stated in ${withN.length}`}
            </div>
          </div>
          <button onClick={close} aria-label="Close" style={{ background: "none", border: "none", color: P.faint, cursor: "pointer", padding: 4, display: "inline-flex", flexShrink: 0 }}><Icon name="close" size={18} /></button>
        </div>

        <div style={{ padding: "12px 22px 0", flexShrink: 0, display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[["cited", "As cited"], ["design", "Strongest design"], ["n", "Largest sample"], ["year", "Newest"]].map(([k, label]) => (
            <button key={k} onClick={() => setSortKey(k)} aria-pressed={sortKey === k}
              style={{
                padding: "5px 12px", borderRadius: RADIUS.pill, cursor: "pointer",
                fontSize: FONT_SIZES.caption, fontWeight: 600, fontFamily: "var(--cb-body)",
                background: sortKey === k ? withAlpha(accent, 0.14) : "transparent",
                color: sortKey === k ? P.ink : P.ink2,
                border: `1px solid ${sortKey === k ? withAlpha(accent, 0.42) : P.line}`,
              }}>{label}</button>
          ))}
        </div>

        <div style={{ overflowY: "auto", overflowX: "auto", padding: "8px 22px 22px", flex: 1, minHeight: 0 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 26 }}>#</th>
                <th style={th}>Study</th>
                <th style={{ ...th, width: 130 }}>Design</th>
                <th style={{ ...th, width: 76, textAlign: "right" }}>Sample</th>
                <th style={{ ...th, width: 58, textAlign: "right" }}>Year</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.i}>
                  <td style={{ ...td, color: accent, fontWeight: 700, fontFamily: "var(--cb-mono)" }}>{r.i}</td>
                  <td style={{ ...td, paddingRight: 14 }}>
                    <a href={safeHref(r.src.url)} target="_blank" rel="noreferrer" style={{ color: P.ink, textDecoration: "none", fontWeight: 600, lineHeight: 1.4, display: "block" }}>
                      {r.src.title ? renderCleanTitle(r.src.title) : r.src.url}
                    </a>
                    <div style={{ color: P.faint, marginTop: 3, fontSize: FONT_SIZES.micro, lineHeight: 1.45 }}>
                      {[r.src.authors, r.src.journal].filter(Boolean).join(" · ")}
                      {r.citations != null && ` · ${r.citations.toLocaleString()} citations`}
                    </div>
                  </td>
                  <td style={td}>
                    {r.design ? (
                      <span style={{
                        display: "inline-block", padding: "3px 9px", borderRadius: RADIUS.pill,
                        fontSize: FONT_SIZES.micro, fontWeight: 600, whiteSpace: "nowrap",
                        // Stronger designs read louder. Rank is the crude
                        // evidence-hierarchy position, not a quality score.
                        color: r.design.rank >= 5 ? accent : P.ink2,
                        background: r.design.rank >= 5 ? withAlpha(accent, 0.12) : (P.dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)"),
                        border: `1px solid ${r.design.rank >= 5 ? withAlpha(accent, 0.3) : P.line}`,
                      }}>{r.design.label}</span>
                    ) : dash}
                  </td>
                  <td style={{ ...td, textAlign: "right", fontFamily: "var(--cb-mono)", fontWeight: 600 }}>{r.n != null ? r.n.toLocaleString() : dash}</td>
                  <td style={{ ...td, textAlign: "right", fontFamily: "var(--cb-mono)", color: P.ink2 }}>{r.year || dash}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 16, fontSize: FONT_SIZES.micro, color: P.faint, lineHeight: 1.6, fontFamily: "var(--cb-body)" }}>
            Design and sample size are read from each abstract as written. A dash means the abstract did not state it — not that the study lacks one. Check the paper before relying on any row.
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
/* Commit 63 — generated cover art.
   Only the spaceflight source ships an image_url; journals and preprint
   servers don't publish thumbnails at all. So every biology, chemistry and
   preprint card rendered as a large empty grey rectangle with a broken-image
   glyph — the exact screenshot Dusty sent. Three quarters of the feed
   looked broken purely because it wasn't space news.

   This draws a cover instead of faking a photo: a deterministic gradient
   seeded by the title (so a given article always looks the same, and
   adjacent cards never collide), the discipline named, and the source's
   initials set large. It reads as a designed cover rather than a missing
   asset, and it never misrepresents a paper with an unrelated stock image —
   which is the thing a science tool must not do. */
/* Commit 81 — person avatars that look chosen rather than defaulted.
   ---------------------------------------------------------------------
   An initial on a flat accent-tinted circle is what every product does
   when it has no photograph, and it reads exactly that way: a fallback.
   Keeping the initial is right — it is genuinely how you pick a name out
   of a list — but the surface behind it does not have to be the same flat
   wash for everybody.

   This hashes the name to a stable hue and paints a two-stop gradient at
   an angle derived from the same hash. Deterministic, so a person looks
   the same everywhere in the app and on every device; no request, no
   third-party avatar service (this app removed its Dicebear dependency in
   Commit 54 for exactly that reason); and it makes a roster of people
   look like a roster rather than a column of identical discs. */
/* ══════════════════════════════════════════════════════════════════
   Commit 87 — the tonal palette.

   avatarSkin() and coverFor() both used to hash a string into a FREE hue:
   `const hue = h % 360`. That one line is responsible for most of what
   reads as amateur in this app. A free hue guarantees that some fraction
   of content comes out neon magenta, mustard, or — the one that actually
   got reported — blood red, and it does so inside a product whose entire
   identity is a single sage green. A 620px red gradient at the top of
   Trending is not a design decision anybody made; it is a hash landing on
   hue 0, and it looks like an error state.

   Replaced with a hand-authored set of twelve tones that all sit in the
   same cool/earthy register as the brand: moss, teal, slate, indigo,
   steel, plum, clay, sand, pine, denim, fern, stone. No pure reds, no
   neons, nothing above 44% saturation. The hash now picks an INDEX into
   that set rather than a point on the colour wheel, so every generated
   surface is still stable and distinct per item, but every possible
   outcome was chosen by a person and belongs to the same family.

   Chroma stays low on purpose. These are backdrops for white text and for
   photography; they are meant to sit behind content, never to compete with
   the accent, which remains the only saturated colour in the product.
   ══════════════════════════════════════════════════════════════════ */
const TONES = [
  { h: 152, s: 26 }, // moss
  { h: 186, s: 30 }, // teal
  { h: 210, s: 22 }, // slate
  { h: 232, s: 28 }, // indigo
  { h: 200, s: 18 }, // steel
  { h: 288, s: 20 }, // plum
  { h: 22,  s: 26 }, // clay
  { h: 40,  s: 24 }, // sand
  { h: 138, s: 22 }, // pine
  { h: 220, s: 32 }, // denim
  { h: 108, s: 24 }, // fern
  { h: 250, s: 14 }, // stone
];

function toneIndex(seed) {
  const str = String(seed == null || seed === "" ? "cerebrum" : seed);
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % TONES.length;
}

function avatarSkin(seed) {
  const t = TONES[toneIndex(seed)];
  return {
    // Two stops from the same hue rather than a hue + 38deg jump: a single
    // hue reads as a considered surface, two unrelated hues read as a
    // gradient generator.
    background: `linear-gradient(140deg, hsl(${t.h} ${t.s}% 36%), hsl(${t.h} ${Math.max(10, t.s - 8)}% 21%))`,
    color: `hsl(${t.h} 34% 90%)`,
  };
}

function coverFor(item) {
  const t = TONES[toneIndex(item && (item.title || item.url))];
  return {
    background: `linear-gradient(135deg, hsl(${t.h} ${t.s}% 20%) 0%, hsl(${t.h} ${Math.max(8, t.s - 10)}% 11%) 100%)`,
    tone: `hsl(${t.h} ${t.s}% 46%)`,
    initials: (item.source || item.category || "CB").replace(/[^A-Za-z ]/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "CB",
  };
}

/* Commit 81 — TrendCover is gone.
   It painted a colour field with a story's initials at 40px, and it was
   the last "letter placeholder" in the product. Every surface that used it
   now becomes a type card when there is no photograph instead (see
   TrendingHero, TrendingCard and DailyScience), which is a design, not an
   apology for a missing asset. coverFor() survives because the gradient
   itself is still used for the slim category strips. */

function TrendingHero({ P, accent, item, onExpand }) {
  // Commit 72 — same resolver as TrendingCard. The hero is the biggest
  // thing on the Trending page; a generated initials cover there is the
  // single most template-looking element in the app.
  const found = useResolvedImage(item.image_url ? "" : item.title, item.image_url, item.category);
  const media = item.image_url ? { url: item.image_url, type: "image" } : found;
  const [imgStatus, setImgStatus] = useState(item.image_url ? "loading" : "error");
  // A real photograph, loaded and decoded — not "we might find one".
  const hasPhoto = imgStatus === "ready";
  useEffect(() => { if (media && media.url) setImgStatus("loading"); }, [media && media.url]);
  return (
    <button
      type="button" onClick={() => onExpand(item)}
      style={{
        position: "relative", display: "block", width: "100%", borderRadius: 16, overflow: "hidden",
        /* Commit 79 — only reserve a picture's worth of height when there
           is a picture. A hard 16:9 with no photograph is ~600px of empty
           gradient with a headline adrift in it, which is precisely what
           made Trending read as chunky. With a photo it stays cinematic;
           without one it is a type hero and the words set the height. */
        /* Commit 87 — a bare 16/9 is 630px at desktop width, so the lead
           story ate the entire fold and the headline sat alone at the
           bottom of a colour field. Capped: still cinematic, still the
           biggest thing on the page, but the grid underneath it is now
           visible without scrolling, which is what makes Trending read as
           a publication rather than a slideshow. */
        ...(hasPhoto ? { aspectRatio: "16/9", maxHeight: 420 } : { minHeight: 190 }),
        background: P.dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
        textDecoration: "none", color: "inherit", border: `1px solid ${P.line}`, padding: 0,
        font: "inherit", cursor: "pointer", textAlign: "left",
      }}
      className="cb-trend-hero"
    >
      {media && media.url && imgStatus !== "error" && (
        <div style={{ position: "absolute", inset: 0, opacity: imgStatus === "ready" ? 1 : 0, transition: "opacity 0.5s ease" }}>
          <CardMedia media={media} onReady={() => setImgStatus("ready")} onFail={() => setImgStatus("error")} />
        </div>
      )}
      {/* Commit 79 — a type hero gets a quiet gradient, not a monogram.
          TrendCover paints a full-bleed colour field with two 40px letters
          in the middle of it. At hero size that is a 600px placeholder
          announcing that no picture was found, which is the last thing a
          lead story should say. */}
      {!hasPhoto && (
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: coverFor(item).background, opacity: 0.55 }} />
      )}
      {hasPhoto && !item.image_url && <ImageCredit image={found} />}
      {/* Always-on scrim (not opacity-gated to imgStatus) so the headline
          stays legible over the placeholder background too, not just once
          a real photo loads. */}
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "linear-gradient(0deg, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.35) 55%, rgba(0,0,0,0.05) 100%)" }} />
      <div style={{
        // With a photograph the text is pinned over the bottom of the
        // image; without one there is no image to pin to, so it simply
        // sits in the box and the box is as tall as the words need.
        ...(hasPhoto
          ? { position: "absolute", left: 0, right: 0, bottom: 0 }
          : { position: "relative" }),
        padding: "28px 28px 26px", display: "flex", flexDirection: "column", gap: 10,
      }}>
        {item.source && (
          <span style={{ display: "inline-flex", alignSelf: "flex-start", alignItems: "center", gap: 6, fontSize: FONT_SIZES.micro, fontWeight: 600, letterSpacing: "0.01em", color: "#fff", fontFamily: "var(--cb-body)" }}>
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
  // Commit 72 — "there's like no photo being imported for thumbnails
  // except for NASA" was reported back in Commit 62 and only half-solved
  // then, by adding a generated cover. A generated cover is a floor, not a
  // fix; this goes and finds a real, licensed picture for the ones the
  // upstream feed left bare. See useResolvedImage / functions/api/image.js.
  const found = useResolvedImage(item.image_url ? "" : item.title, item.image_url, item.category);
  const media = item.image_url ? { url: item.image_url, type: "image" } : found;
  const [imgStatus, setImgStatus] = useState(item.image_url ? "loading" : "error");
  // Commit 79 — same reasoning as TrendingHero: a card with no photograph
  // becomes a type card instead of a 16:10 monogram placeholder. The media
  // band collapses to a slim category strip, and the headline gets the
  // room. It makes the grid look edited rather than generated.
  const hasPhoto = imgStatus === "ready";
  useEffect(() => { if (media && media.url) setImgStatus("loading"); }, [media && media.url]);
  return (
    <button
      type="button" onClick={() => onExpand(item)}
      style={{
        borderRadius: 12, border: `1px solid ${P.line}`, overflow: "hidden",
        background: P.surface, display: "flex", flexDirection: "column",
        textDecoration: "none", color: "inherit", width: "100%", padding: 0,
        font: "inherit", cursor: "pointer", textAlign: "left",
      }}
      className="cb-trend-card"
    >
      {/* Commit 87 — the media band is now a CONSTANT height whether or not
          a photograph resolved. It used to be a 16:10 image on cards that
          found one and a 6px stripe on cards that did not, so a single row
          of three could contain a 200px picture, a hairline, and a
          hairline — three different objects wearing the same border. The
          summary then flexed to fill the difference and left a hole in the
          middle of the bare cards. With the tonal palette there is now
          something worth showing in that band when there is no photo (a
          quiet duotone field, still no monogram), so reserving it costs
          nothing and the row finally scans as one row. */}
      <div style={{ position: "relative", aspectRatio: "16/10", background: P.dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)", flexShrink: 0, overflow: "hidden" }}>
        {media && media.url && imgStatus !== "error" && (
          <div style={{ position: "absolute", inset: 0, opacity: imgStatus === "ready" ? 1 : 0, transition: "opacity 0.4s ease" }}>
            <CardMedia media={media} onReady={() => setImgStatus("ready")} onFail={() => setImgStatus("error")} />
          </div>
        )}
        {!hasPhoto && (
          /* A duotone field from the tonal palette plus one hairline rule —
             enough to read as a designed surface, not enough to pretend it
             is a photograph. Deliberately no monogram: initials in a
             coloured square is the single clearest "no asset found" tell
             in any feed UI. */
          <>
            <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: coverFor(item).background }} />
            <div aria-hidden="true" style={{ position: "absolute", left: 16, right: 16, bottom: 16, height: 1, background: `linear-gradient(90deg, ${withAlpha(coverFor(item).tone, 0.55)}, transparent)` }} />
          </>
        )}
        {hasPhoto && !item.image_url && <ImageCredit image={found} />}
        {hasPhoto && <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 50%, rgba(0,0,0,0.55) 100%)", opacity: imgStatus === "ready" ? 1 : 0 }} />}
        {item.source && <span style={{ position: "absolute", top: 10, left: 10, fontSize: FONT_SIZES.micro, fontWeight: 600, letterSpacing: "0.01em", color: "#fff", background: "rgba(0,0,0,0.55)", padding: "3px 8px", borderRadius: 100, fontFamily: "var(--cb-body)" }}>{item.source}</span>}
      </div>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
        {/* On a photo card the source sits on the image; on a type card
            there is no image to sit on, so it leads the text instead. */}
        {/* Commit 87 — the source used to appear here on bare cards and on
            the image on photo cards, i.e. in two different places in one
            grid. It now always sits on the band. */}
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
function TrendingArticleModal({ P, accent, at, item, close, onAsk, upNext = [], onOpenItem }) {
  // Commit 63 — the modal used to be a summary and a link straight off the
  // site. Every one of those clicks was someone leaving. It now carries the
  // three things that make staying the better option: explainer videos
  // playing inline, a one-tap route into Cerebrum's own literature search on
  // the same subject, and what to read next.
  const [videos, setVideos] = useState([]);
  useEffect(() => {
    let cancelled = false;
    const q = (item.title || "").slice(0, 120);
    if (!q) return;
    fetch(`/api/videos?q=${encodeURIComponent(q)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d && Array.isArray(d.videos)) setVideos(d.videos.slice(0, 2)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [item.title]);
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
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: FONT_SIZES.micro, fontWeight: 600, letterSpacing: "0.01em", color: accent, fontFamily: "var(--cb-body)" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: accent }} />
              {item.source}
            </span>
          )}
          <div style={{ fontSize: FONT_SIZES.display, fontWeight: 700, color: P.ink, lineHeight: 1.25, letterSpacing: "-0.015em", fontFamily: "var(--cb-display)", marginTop: 10 }}>{item.title}</div>
          {publishedLabel && <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, fontFamily: "var(--cb-mono)", marginTop: 8 }}>{publishedLabel}</div>}
          <div style={{ fontSize: FONT_SIZES.body, color: P.ink2, lineHeight: 1.7, marginTop: 18 }}>{item.summary}</div>
          {/* The primary action is now the one that keeps someone here and
              is genuinely more useful than the source page: Cerebrum can
              answer what the science actually says, with citations. Reading
              the original is still one tap away, just no longer the only
              thing on offer. */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 24 }}>
            <button
              onClick={() => { if (onAsk) { onAsk(`What does the research actually show about this: ${item.title}`); close(); } }}
              style={{
                display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 18px",
                fontSize: FONT_SIZES.small, fontWeight: 700, color: at, background: accent,
                borderRadius: 100, border: "none", cursor: "pointer", fontFamily: "var(--cb-body)",
              }}
            ><Icon name="sparkle" size={14} /> Explain with papers</button>
            <a href={safeHref(item.url)} target="_blank" rel="noreferrer" style={{
              display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 18px",
              fontSize: FONT_SIZES.small, fontWeight: 600, color: P.ink2, background: "transparent",
              border: `1px solid ${P.line2}`, borderRadius: 100, textDecoration: "none",
            }}>
              Read at source <Icon name="external" size={13} />
            </a>
          </div>

          {videos.length > 0 && (
            <div style={{ marginTop: 28 }}>
              <div style={{ fontSize: FONT_SIZES.micro, fontWeight: 700, letterSpacing: "0.1em", color: P.faint, fontFamily: "var(--cb-body)", marginBottom: 10 }}>Watch</div>
              {videos.map((v) => {
                const id = getYouTubeId(v);
                if (!id) return null;
                return (
                  <div key={id} style={{ position: "relative", aspectRatio: "16/9", marginBottom: 12, borderRadius: 12, overflow: "hidden", border: `1px solid ${P.line}` }}>
                    {/* youtube-nocookie, and no autoplay: a video that starts
                        talking the moment a card opens is the fastest way to
                        make someone close the tab. */}
                    <iframe
                      src={`https://www.youtube-nocookie.com/embed/${id}`}
                      title={v.title || "Related video"}
                      allow="accelerometer; encrypted-media; picture-in-picture"
                      allowFullScreen
                      loading="lazy"
                      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
                    />
                  </div>
                );
              })}
            </div>
          )}

          {upNext.length > 0 && (
            <div style={{ marginTop: 26 }}>
              <div style={{ fontSize: FONT_SIZES.micro, fontWeight: 700, letterSpacing: "0.1em", color: P.faint, fontFamily: "var(--cb-body)", marginBottom: 8 }}>Up next</div>
              {upNext.map((nx, i) => (
                <button key={nx.url || i} onClick={() => onOpenItem && onOpenItem(nx)}
                  style={{
                    display: "block", width: "100%", textAlign: "left", padding: "11px 0",
                    background: "transparent", border: "none", borderBottom: `1px solid ${P.line}`,
                    cursor: "pointer", fontFamily: "var(--cb-body)",
                  }}>
                  <span style={{ display: "block", fontSize: FONT_SIZES.small, fontWeight: 600, color: P.ink, lineHeight: 1.4 }}>{nx.title}</span>
                  <span style={{ display: "block", fontSize: FONT_SIZES.caption, color: P.faint, marginTop: 3 }}>{[nx.category, nx.source].filter(Boolean).join(" · ")}</span>
                </button>
              ))}
            </div>
          )}
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

/* ══════════════════════════════════════════════════════════════════
   Commit 88 — WorkspacePage.

   Cerebrum had two kinds of destination wearing one kind of sidebar row.
   Trending, Inbox, Settings and Profile were pages. Investigations, Saved,
   Collections and Find People were centred modal dialogs floating over
   whatever search happened to be underneath, dismissed by Escape or a
   click on the backdrop.

   That split is most of why the product read as a chatbot with features
   bolted on rather than an instrument. A modal is a thing that interrupts
   you; a page is a place you go. Your library of saved papers, your
   investigations, your collections and the people you follow are not
   interruptions — they are the work, and half the app's actual content
   lived in dialogs you could lose by pressing the wrong key. They were
   also capped at 520-560px wide with an internal 56vh scroll, so a
   forty-paper library was read through a letterbox on a 1440px screen.

   This is the shell all four now use, and it deliberately matches
   TrendingView's proportions so that every destination in the rail has the
   same margins, the same title size and the same rhythm. One page shape,
   used everywhere.
   ══════════════════════════════════════════════════════════════════ */
function WorkspacePage({ P, accent, isMobile, title, count, description, actions, children, wide = false }) {
  return (
    <div style={{ flex: 1, minHeight: 0 }}>
      <div style={{
        maxWidth: wide ? 1180 : 900, width: "100%", margin: "0 auto",
        // Commit 88 — the mobile menu button is fixed at top:14 left:14 and
        // is 38px square, so a page title starting at 24px from the top ran
        // straight underneath it. TrendingView already carried this offset;
        // every new page needs it too.
        padding: isMobile ? "66px 18px 60px" : "44px 32px 90px",
      }}>
        <div style={{ marginBottom: 26 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h1 style={{
              margin: 0, fontSize: FONT_SIZES.hero * 0.7, fontWeight: 700,
              letterSpacing: "-0.02em", color: P.ink, fontFamily: "var(--cb-display)", lineHeight: 1.1,
            }}>{title}</h1>
            {count != null && count > 0 && (
              <span style={{
                fontSize: FONT_SIZES.caption, fontWeight: 700, fontFamily: "var(--cb-mono)",
                color: P.faint, background: P.dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
                padding: "3px 10px", borderRadius: RADIUS.pill,
              }}>{count}</span>
            )}
            {actions && <div style={{ marginLeft: isMobile ? 0 : "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>{actions}</div>}
          </div>
          {description && (
            <p style={{
              margin: "10px 0 0", maxWidth: 620, fontSize: FONT_SIZES.small,
              color: P.ink2, lineHeight: 1.6, fontFamily: "var(--cb-body)",
            }}>{description}</p>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

/* One empty state for the whole workspace, so Library, Investigations and
   Collections agree with each other and with the profile tabs. */
function WorkspaceEmpty({ P, accent, icon, title, body, action }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center",
      padding: "56px 24px", borderRadius: RADIUS.lg,
      border: `1px dashed ${P.line2}`,
      background: P.dark ? "rgba(255,255,255,0.018)" : "rgba(0,0,0,0.012)",
    }}>
      <span aria-hidden="true" style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 46, height: 46, borderRadius: RADIUS.md, marginBottom: 15,
        color: accent, background: withAlpha(accent, 0.1),
        border: `1px solid ${withAlpha(accent, 0.22)}`,
      }}><Icon name={icon} size={20} /></span>
      <div style={{ fontSize: FONT_SIZES.subhead, fontWeight: 700, color: P.ink, fontFamily: "var(--cb-display)", letterSpacing: "-0.01em" }}>{title}</div>
      <div style={{ fontSize: FONT_SIZES.small, color: P.faint, lineHeight: 1.6, marginTop: 8, maxWidth: 400, fontFamily: "var(--cb-body)" }}>{body}</div>
      {action && <div style={{ marginTop: 18 }}>{action}</div>}
    </div>
  );
}

function TrendingView({ P, accent, at, isMobile, onAsk }) {
  const [status, setStatus] = useState("loading"); // "loading" | "ready" | "error"
  const [items, setItems] = useState([]);
  const [generatedAt, setGeneratedAt] = useState(0);
  const [expanded, setExpanded] = useState(null);
  // Forces the "Updated Xm ago" line to keep counting up between polls,
  // not just re-render whenever a fetch happens to land.
  const [, forceTick] = useState(0);
  // Bumped by the error state's "Try again" button below. The fetch lives
  // inside the effect (it owns the polling interval and the cancelled
  // flag), so a retry is expressed as a dependency change rather than by
  // hoisting load() out and losing that ownership.
  const [reloadTick, setReloadTick] = useState(0);
  // Commit 58 — Trending was one long column of large cards: enormous
  // vertical space, one story per screenful, and no way to get an overview
  // of what's happening today without scrolling for a minute. Two changes:
  // a Digest tab that lists everything compactly (the default, because the
  // first thing anyone wants from a feed is the shape of the day), and the
  // existing card layout kept as a second tab for browsing.
  // Browse is the default: the cards carry images and are what people
  // actually want to look at first — Digest is the scan-the-day view you
  // switch to deliberately.
  const [trendTab, setTrendTab] = useState("cards");
  // Commit 60 — the feed now spans disciplines (see functions/lib/
  // trendingSource.js), so it needs a way to narrow to one. Built from the
  // categories actually present rather than a hardcoded list, so a source
  // going down removes its chip instead of leaving a filter that finds
  // nothing.
  const [trendCat, setTrendCat] = useState("All");

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
  }, [reloadTick]);

  // Deduped here regardless of what the backend already did (see
  // dedupeTrendingItems above) — a safety net against a stale cache row or
  // a future source change, never a substitute for the server-side dedup.
  const deduped = useMemo(() => dedupeTrendingItems(items), [items]);
  // Commit 63 — the category filter used to be applied only inside the
  // digest branch, so clicking a chip did nothing at all in Browse: hero and
  // the card grid were still built from the unfiltered list. Filtering once,
  // here, means every view below is fed the same already-narrowed list and
  // no future view can forget to apply it.
  const visibleItems = deduped.filter((x) => trendCat === "All" || x.category === trendCat);
  const [hero, ...rest] = visibleItems;

  return (
    <div style={{ flex: 1, minHeight: 0 }}>
      <div style={{ maxWidth: 1180, width: "100%", margin: "0 auto", padding: isMobile ? "24px 18px 60px" : "44px 32px 90px" }}>
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {/* Commit 88 — an h1, like every other page title. This was a div,
                so Trending was the one destination a screen reader could not
                announce and the only one that broke the heading outline. */}
            <h1 style={{ margin: 0, fontSize: FONT_SIZES.hero * 0.7, fontWeight: 700, letterSpacing: "-0.02em", color: P.ink, fontFamily: "var(--cb-display)", lineHeight: 1.1 }}>Trending in Science</h1>
            {/* Commit 80 — out of preview. The label was honest while the
                feed was new; it now refreshes on a real hourly clock from
                fifteen sources and has been stable. Leaving a "Preview"
                badge on a shipped feature stops being modesty and starts
                being a reason for people not to trust it. */}
            {status === "ready" && (
              <span title="Refreshed automatically once an hour" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: FONT_SIZES.micro, fontWeight: 600, color: P.faint, fontFamily: "var(--cb-mono)" }}>
                <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: STATUS.good, flexShrink: 0, animation: "cbHuddlePulse 1.6s ease-in-out infinite" }} />
                Live{generatedAt ? " · updated " + relativeTime(generatedAt) : ""}
              </span>
            )}
          </div>
          <div style={{ fontSize: FONT_SIZES.body, color: P.faint, marginTop: 8, maxWidth: 640, lineHeight: 1.6 }}>
            Refreshed hourly from real science press. Not curated by us, not fact-checked like an answer. Read the source before you cite it.
          </div>
        </div>
        {status === "loading" && (
          <>
            <div style={{ borderRadius: 16, overflow: "hidden", aspectRatio: "16/9", background: P.skel, backgroundSize: "200% 100%", animation: "cbShimmer 1.8s ease-in-out infinite", marginBottom: 24 }} />
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(280px, 1fr))", gap: 24 }}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} style={{ borderRadius: 12, border: `1px solid ${P.line}`, overflow: "hidden" }}>
                  <div style={{ aspectRatio: "16/10", background: P.skel, backgroundSize: "200% 100%", animation: `cbShimmer 1.8s ease-in-out ${i * 120}ms infinite` }} />
                  <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ height: 14, width: "80%", borderRadius: 8, background: P.skel, backgroundSize: "200% 100%", animation: `cbShimmer 1.8s ease-in-out ${i * 120}ms infinite` }} />
                    <div style={{ height: 10, width: "100%", borderRadius: 8, background: P.skel, backgroundSize: "200% 100%", animation: `cbShimmer 1.8s ease-in-out ${i * 120}ms infinite` }} />
                    <div style={{ height: 10, width: "60%", borderRadius: 8, background: P.skel, backgroundSize: "200% 100%", animation: `cbShimmer 1.8s ease-in-out ${i * 120}ms infinite` }} />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {/* An error state is a screen a real person actually lands on, so it
            gets the same treatment as any other: a contained surface rather
            than text floating in the middle of an empty page, a headline
            separated from the explanation, and — the part that was actually
            missing — a way to act on it. Telling someone to "try again in a
            moment" without giving them a button to do it with is a dead
            end dressed up as guidance. */}
        {status === "error" && (
          <div style={{
            maxWidth: 460, margin: "56px auto", textAlign: "center",
            padding: "36px 32px", borderRadius: 12,
            background: P.dark ? "rgba(255,255,255,0.025)" : "rgba(0,0,0,0.015)",
            border: `1px solid ${P.line}`,
          }} className="cb-rise">
            <div aria-hidden="true" style={{
              width: 48, height: 48, borderRadius: "50%", margin: "0 auto 18px",
              display: "flex", alignItems: "center", justifyContent: "center",
              background: withAlpha(STATUS.bad, 0.1),
              border: `1px solid ${withAlpha(STATUS.bad, 0.25)}`,
            }}>
              <Icon name="warning" size={22} style={{ color: STATUS.bad }} />
            </div>
            <div style={{ fontSize: FONT_SIZES.subhead, fontWeight: 700, color: P.ink, marginBottom: 8 }}>
              Trending feed didn't load
            </div>
            <div style={{ fontSize: FONT_SIZES.small, color: P.ink2, lineHeight: 1.6, marginBottom: 22 }}>
              The upstream science feed didn't answer. It's usually busy rather than
              down, so a retry in a few seconds normally works.
            </div>
            <button
              onClick={() => setReloadTick((t) => t + 1)}
              style={{
                padding: "10px 22px", borderRadius: 100, cursor: "pointer",
                fontSize: FONT_SIZES.small, fontWeight: 600, fontFamily: "var(--cb-body)",
                background: accent, color: at, border: "none",
              }}
            >Try again</button>
          </div>
        )}
        {status === "ready" && (
          <>
            {/* ══════════════════════════════════════════════════════
                Commit 87 — one control row, not two.

                A category filter and a view switcher were stacked as two
                separate full-width rows of pills, one above the other,
                identically styled — so the page opened with four lines of
                chrome (title, standfirst, filters, tabs) before the first
                story, and nothing in the styling told you that the top row
                narrows WHAT you see while the bottom row changes HOW you
                see it. They are different kinds of control and they now
                look it: subjects on the left as filters, view mode on the
                right as a segmented control, on one line.
                ══════════════════════════════════════════════════════ */}
            <div style={{
              display: "flex", alignItems: "center", gap: 12, marginBottom: 20,
              flexWrap: "wrap", justifyContent: "space-between",
            }}>
              <div className="cb-scroll-x" style={{ display: "flex", gap: 6, flexWrap: isMobile ? "nowrap" : "wrap", overflowX: isMobile ? "auto" : "visible", minWidth: 0, maxWidth: "100%" }}>
                {["All", ...Array.from(new Set(deduped.map((x) => x.category).filter(Boolean)))].map((cat) => (
                  <button key={cat} onClick={() => setTrendCat(cat)}
                    style={{
                      padding: "6px 13px", borderRadius: RADIUS.pill, cursor: "pointer", flexShrink: 0,
                      whiteSpace: "nowrap",
                      fontSize: FONT_SIZES.caption, fontWeight: 600, fontFamily: "var(--cb-body)",
                      background: trendCat === cat ? withAlpha(accent, 0.16) : "transparent",
                      color: trendCat === cat ? P.ink : P.ink2,
                      border: `1px solid ${trendCat === cat ? withAlpha(accent, 0.4) : P.line}`,
                      transition: "background 0.2s ease, border-color 0.2s ease, color 0.2s ease",
                    }}>{cat}</button>
                ))}
              </div>
              {/* A real segmented control: one track, one moving fill.
                  Two separate outlined pills read as two independent
                  toggles, which is exactly the wrong mental model for a
                  pair of mutually exclusive views. */}
              <div style={{
                display: "inline-flex", flexShrink: 0, padding: 3, borderRadius: RADIUS.pill,
                background: P.dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
                border: `1px solid ${P.line}`,
              }}>
                {[["cards", "Browse"], ["digest", "Digest"]].map(([key, label]) => (
                  <button key={key} onClick={() => setTrendTab(key)}
                    aria-pressed={trendTab === key}
                    style={{
                      padding: "6px 16px", borderRadius: RADIUS.pill, cursor: "pointer", border: "none",
                      fontSize: FONT_SIZES.caption, fontWeight: 600, fontFamily: "var(--cb-body)",
                      background: trendTab === key ? (P.dark ? "rgba(255,255,255,0.10)" : "#fff") : "transparent",
                      color: trendTab === key ? P.ink : P.faint,
                      boxShadow: trendTab === key ? (P.dark ? "none" : "0 1px 3px rgba(0,0,0,0.10)") : "none",
                      transition: "background 0.22s ease, color 0.22s ease",
                    }}>{label}</button>
                ))}
              </div>
            </div>
            {trendTab === "digest" ? (
              /* One line per story: headline, source, age. The whole day
                 fits on a screen, which is the entire point of a digest —
                 you scan it, then open the two things worth reading. */
              <div style={{ borderTop: `1px solid ${P.line}` }} className="cb-stagger">
                {visibleItems.map((item, i) => (
                  <button key={item.url || i} onClick={() => setExpanded(item)}
                    style={{
                      display: "flex", alignItems: "baseline", gap: 14, width: "100%", textAlign: "left",
                      padding: "14px 4px", background: "transparent", border: "none",
                      borderBottom: `1px solid ${P.line}`, cursor: "pointer", fontFamily: "var(--cb-body)",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = withAlpha(accent, 0.05); }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  >
                    <span style={{ fontSize: FONT_SIZES.micro, color: P.faint, fontFamily: "var(--cb-mono)", width: 22, flexShrink: 0 }}>{String(i + 1).padStart(2, "0")}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: FONT_SIZES.small, fontWeight: 600, color: P.ink, lineHeight: 1.45 }}>{item.title}</span>
                      <span style={{ display: "block", fontSize: FONT_SIZES.caption, color: P.faint, marginTop: 3 }}>
                        {[item.category, item.source, item.publishedAt ? relativeTime(item.publishedAt) : null].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <>
                {hero && <div style={{ marginBottom: 24 }}><TrendingHero P={P} accent={accent} item={hero} onExpand={setExpanded} /></div>}
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(280px, 1fr))", gap: 24 }}>
                  {rest.map((item, i) => <TrendingCard key={item.url || i} P={P} accent={accent} at={at} item={item} onExpand={setExpanded} />)}
                </div>
              </>
            )}
          </>
        )}
      </div>
      {expanded && (
        <TrendingArticleModal
          P={P} accent={accent} at={at} item={expanded}
          close={() => setExpanded(null)}
          onAsk={onAsk}
          upNext={visibleItems.filter((x) => x.url !== expanded.url).slice(0, 4)}
          onOpenItem={(nx) => setExpanded(nx)}
        />
      )}
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
      <div ref={trapRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} style={{ background: P.bg, borderRadius: 8, maxWidth: 700, width: "100%", boxShadow: "0 24px 80px rgba(0,0,0,0.5)", border: `1px solid ${P.line}`, outline: "none" }} className="cb-modal">
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

function AuthModal({ P, accent, at, close, onAuthed, intent = "login" }) {
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

  const inputStyle = { width: "100%", padding: "11px 13px", fontSize: FONT_SIZES.body, borderRadius: 8, border: `1px solid ${P.line}`, background: P.dark ? "rgba(255,255,255,0.03)" : "#fff", color: P.ink, fontFamily: "var(--cb-body)", marginTop: 6 };
  const boxStyle = { width: 44, height: 52, textAlign: "center", fontSize: 22, fontWeight: 700, borderRadius: 8, border: `1px solid ${P.line}`, background: P.dark ? "rgba(255,255,255,0.03)" : "#fff", color: P.ink, fontFamily: "var(--cb-mono)", outline: "none" };

  return (
    <div onClick={close} role="dialog" aria-modal="true" aria-label="Sign in to Cerebrum" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 215, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} className="cb-backdrop">
      <div ref={trapRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} style={{ background: P.dark ? "rgba(15, 17, 26, 0.9)" : "rgba(255, 255, 255, 0.95)", backdropFilter: "blur(40px) saturate(150%)", WebkitBackdropFilter: "blur(40px) saturate(150%)", borderRadius: 8, maxWidth: 400, width: "100%", boxShadow: "0 24px 80px rgba(0,0,0,0.5)", border: P.dark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.08)", outline: "none" }} className="cb-modal">
        <div style={{ padding: "26px 26px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: FONT_SIZES.heading, fontWeight: 700, letterSpacing: "-0.02em", color: P.ink, fontFamily: "var(--cb-display)" }}>{step === "email" ? (intent === "signup" ? "Create your account" : "Sign in") : "Enter your code"}</div>
          <button onClick={close} aria-label="Close" style={{ background: "none", border: "none", color: P.faint, cursor: "pointer", padding: 4, display: "inline-flex" }}><Icon name="close" size={18} /></button>
        </div>

        {step === "email" ? (
          <form onSubmit={requestCode} style={{ padding: "18px 26px 26px" }}>
            <label style={{ display: "block", fontSize: FONT_SIZES.small, fontWeight: 600, color: P.ink2 }}>
              Email
              <input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} placeholder="you@example.com" aria-label="Email" />
            </label>
            <div style={{ fontSize: FONT_SIZES.small, color: P.faint, marginTop: 10, lineHeight: 1.5 }}>{intent === "signup" ? "No password to pick. We'll email you a 6-digit code and your account is made." : "No password to remember. We'll email you a 6-digit code that signs you in."}</div>
            {error && <div role="alert" style={{ marginTop: 14, padding: "9px 12px", borderRadius: 8, background: withAlpha(STATUS.bad, 0.1), color: STATUS.bad, fontSize: FONT_SIZES.small, lineHeight: 1.5 }}>{error}</div>}
            <button type="submit" disabled={busy} style={{ width: "100%", marginTop: 18, padding: "12px", fontSize: FONT_SIZES.body, fontWeight: 600, background: accent, color: at, border: "none", borderRadius: 8, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1, fontFamily: "var(--cb-body)" }}>
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
            {error && <div role="alert" style={{ marginTop: 16, padding: "9px 12px", borderRadius: 8, background: withAlpha(STATUS.bad, 0.1), color: STATUS.bad, fontSize: FONT_SIZES.small, lineHeight: 1.5, textAlign: "center" }}>{error}</div>}
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

// Commit 50 — VideoHuddle rebuilt on Cerebrum's own WebRTC signaling instead
// of embedding Jitsi's free public server (meet.jit.si).
//
// Root cause of the bug this replaces: on August 24, 2023, Jitsi permanently
// ended anonymous room creation on meet.jit.si — every room's first
// participant now has to authenticate via Google/GitHub/Facebook to become
// "moderator" before the call starts
// (https://jitsi.org/blog/authentication-on-meet-jit-si/,
// https://github.com/jitsi/jitsi-meet/issues/13753). That requirement is
// enforced on Jitsi's own server, not by anything this app's client code
// configured, so no JitsiMeetExternalAPI option could bypass it — the
// "please log-in" screen was Jitsi's 2023 policy showing up inside our
// embed, not a bug in the usual sense.
//
// This is a genuine from-scratch replacement, not a patch: real
// getUserMedia capture, a real RTCPeerConnection per call, and a real
// signaling channel of our own (functions/api/callsignal.js, backed by the
// call_signals D1 table) instead of a third party's server. No OAuth wall
// is possible here because there is no third party in the call path at all
// — only two browsers and Cerebrum's own backend relaying the small
// SDP/ICE messages needed to introduce them to each other. Media itself
// never touches Cerebrum's servers; it flows directly between the two
// browsers (or via a STUN-negotiated path — see functions/api/
// ice-servers.js) the same way FaceTime/Instagram's own calling does.
//
// Scope, stated plainly: this is peer-to-peer, built for the 1:1 calls the
// product actually surfaces today (the single "Video Huddle" button on a DM
// thread in InboxView) — a group call would need a media relay (SFU)
// fanning out N streams each way, a materially bigger project. There is
// also no TURN relay configured yet (see ice-servers.js for the env vars
// that turn one on with zero further code changes) — STUN alone already
// covers the large majority of home/mobile networks, but two callers both
// behind a restrictive/symmetric NAT (some corporate/hotel Wi-Fi) may fail
// to connect directly until TURN is added. And there is still no push
// notification when someone starts a huddle — both people have to already
// know to open it — pre-existing since the very first Jitsi version of this
// feature, unrelated to today's fix, flagged here rather than left for
// someone to rediscover.
//
// Commit 46: rebuilt as a dedicated full-screen overlay (FaceTime-style)
// instead of an inline panel confined to the Inbox's right pane — kept as-is
// below, only what's inside it changed.
/* ════════════════════════════════════════════════════════════════
   INCOMING CALL — the receiving half of a video huddle
   ════════════════════════════════════════════════════════════════
   Until this existed, "calling someone" in Cerebrum wasn't a thing that
   could happen: VideoHuddle assumed both people had already independently
   opened the same thread's huddle, and if they hadn't, both sides simply
   sat on "Waiting for X to join" until one of them gave up. That is the
   whole of the reported bug — the WebRTC handshake underneath was fine.

   The caller now emits a `ring` heartbeat (see VideoHuddle), every signed-in
   client polls "is anyone calling me" app-wide (see the effect in App), and
   this is what that poll puts on screen. Modeled on the incoming-call sheet
   every phone uses: who's calling, and two unmistakable choices.

   Declining posts a `bye` on the thread so the caller's own huddle closes
   immediately rather than ringing into a void — a decline the caller can't
   see is just a call that seems to go unanswered. */
function IncomingCall({ call, P, accent, at, isMobile, onAccept, onDecline }) {
  useCallTone("incoming", true);
  const initial = (call.fromName || "?").trim().charAt(0).toUpperCase();
  const skin = avatarSkin(call.fromName || call.fromId);
  const btn = (bg, color, label, icon, onClick) => (
    <button onClick={onClick} style={{
      display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
      background: "none", border: "none", cursor: "pointer", color: P.ink2,
      fontSize: FONT_SIZES.caption, fontWeight: 600, fontFamily: "var(--cb-body)",
    }}>
      <span style={{
        width: 58, height: 58, borderRadius: "50%", background: bg, color,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}><Icon name={icon} size={22} /></span>
      {label}
    </button>
  );
  return (
    <div role="dialog" aria-modal="true" aria-label={`Incoming call from ${call.fromName}`}
      style={{
        position: "fixed", zIndex: 320,
        // Phone-like placement: top sheet on mobile (where a call banner
        // belongs), bottom-right card on desktop (where it doesn't cover
        // what someone is reading).
        ...(isMobile
          ? { top: 12, left: 12, right: 12 }
          : { bottom: 24, right: 24, width: 340 }),
        padding: 20, borderRadius: 16,
        background: P.dark ? "rgba(18,19,24,0.96)" : "rgba(255,255,255,0.98)",
        border: `1px solid ${P.line2}`,
        boxShadow: "0 18px 60px rgba(0,0,0,0.4)",
        backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
      }}
      className="cb-modal"
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
        <span aria-hidden="true" style={{
          width: 52, height: 52, borderRadius: "50%", flexShrink: 0,
          background: withAlpha(accent, 0.2), border: `1px solid ${withAlpha(accent, 0.45)}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 20, fontWeight: 700, color: P.ink, fontFamily: "var(--cb-display)",
          animation: "cbHuddleRing 1.6s ease-in-out infinite",
        }}>{initial}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, fontFamily: "var(--cb-body)", letterSpacing: "0.01em" }}>Incoming call</div>
          <div style={{ fontSize: FONT_SIZES.subhead, fontWeight: 700, color: P.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{call.fromName}</div>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-evenly" }}>
        {btn(withAlpha(STATUS.bad, 0.16), STATUS.bad, "Decline", "phoneOff", onDecline)}
        {btn(accent, at, "Accept", "camera", onAccept)}
      </div>
    </div>
  );
}

let __cbHuddleClientSeq = 0;
function newHuddleClientId() {
  __cbHuddleClientSeq += 1;
  return `${Date.now().toString(36)}-${__cbHuddleClientSeq}-${Math.random().toString(36).slice(2, 8)}`;
}
// Returns true only if the signal actually landed. Commit 59: this used to
// be fire-and-forget, which is why a call could ring on the caller's screen
// while the ring POST was being rejected — nothing anywhere looked at the
// result, so a 404 (endpoint not deployed) and a 200 were indistinguishable.
// Commit 70 — returns `true` on success, or a short human-readable reason
// on failure, so the caller can say what actually went wrong instead of
// guessing. The old version returned a bare boolean, which is why a failed
// ring rendered as "Calls aren't fully set up on the server" whether the
// real cause was a missing table, a rate limit, a blocked user, an expired
// session, or a dropped connection — five very different problems, one
// misleading sentence, and no way to tell them apart from a screenshot.
/* ── API ROUTE NAMING: NO HYPHENS. EVER. ────────────────────────────────
   Cloudflare Pages maps functions/api/<name>.js to /api/<name>, literally
   and with no normalization. These endpoints were originally called
   call-signal, ice-servers and trending-refresh, and when the files were
   copied into the repo the hyphens were lost — so the files existed as
   callsignal.js and iceservers.js while the app kept asking for
   /api/call-signal. Nothing served those paths.

   That is not a small bug. Pages answers a request for a route no Function
   claims by falling back to the STATIC handler: a GET returns index.html
   with HTTP 200, and a POST returns 405. So the app got a 200 containing a
   web page where it expected JSON, and failed silently. Calling never
   worked at all, and Trending never showed a single picture, for weeks —
   while every health probe reported "live", because a 200 is a 200.

   The convention is now: API filenames are a single lowercase word, no
   hyphens, no underscores. It is not prettier. It is simply the only
   version of this that cannot be broken by a filename losing a character
   in transit, and a route name nobody can mistype is worth more than a
   route name that reads nicely.
   ─────────────────────────────────────────────────────────────────────── */
async function postCallSignal(threadId, clientId, type, payload) {
  try {
    const res = await fetch("/api/callsignal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId, clientId, type, payload }),
    });
    if (res.ok) return true;
    let reason = "";
    try { reason = (await res.json()).error || ""; } catch {}
    if (!reason) {
      reason = res.status === 401 ? "Your session expired: sign in again."
        : res.status === 403 ? "You're not authorized to call in this conversation."
        : res.status === 429 ? "Too many requests: wait a moment."
        : `Server returned ${res.status}.`;
    }
    return reason;
  } catch {
    // Best-effort. A dropped offer/answer/ICE post is recoverable — the
    // sender's own retry logic or the next natural signal covers it, except
    // `bye` on unmount, which is inherently best-effort everywhere (the tab
    // may already be closing when it fires).
    return false;
  }
}

function VideoHuddle({ P, accent, at, isMobile, name, roomSeed, currentUserId, audioOnly = false, onClose }) {
  const threadId = roomSeed; // roomSeed has always actually been the DM's thread id — see onStartHuddle in InboxView
  const videoARef = useRef(null); // "main stage" slot
  const videoBRef = useRef(null); // picture-in-picture slot
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const pcRef = useRef(null);
  const screenTrackRef = useRef(null);
  const clientIdRef = useRef(null);
  if (!clientIdRef.current) clientIdRef.current = newHuddleClientId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [status, setStatus] = useState("loading"); // loading | waiting | connecting | ready | error
  const [errorReason, setErrorReason] = useState("");
  const [retryTick, setRetryTick] = useState(0);
  const [micMuted, setMicMuted] = useState(false);
  // An audio call is a video call that opens with the camera already off —
  // same surface, same controls, so switching the camera on mid-call is one
  // tap rather than hanging up and calling back a different way.
  const [camMuted, setCamMuted] = useState(audioOnly);
  const [hasCamera, setHasCamera] = useState(true);
  // Repurposes the old Jitsi "tile view" toggle: with exactly two
  // participants and no SFU, a tile grid doesn't apply the way it did for
  // Jitsi's multi-party rooms — swapping which feed is the big one (the way
  // Instagram/Messenger's own video calls let you tap the small bubble) is
  // the equivalent that actually fits a 1:1 call.
  const [mainIsSelf, setMainIsSelf] = useState(false);
  const mainIsSelfRef = useRef(false);
  // Commit 47 — "amazing video call optimization":
  // - `minimized`: the call keeps running (same mounted RTCPeerConnection —
  //   nothing is torn down or recreated) while shrinking to a small floating
  //   bubble, so navigating to another tab doesn't hang up.
  // - `screenSharing`/`dataSaver`: both drive real, documented WebRTC
  //   primitives (`getDisplayMedia` + `replaceTrack` / `RTCRtpSender.
  //   setParameters` bitrate caps) — not new/speculative surface area.
  const [minimized, setMinimized] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [dataSaver, setDataSaver] = useState(false);
  // Commit 48: report this call — kind: "call" against content_reports,
  // scoped by thread_id rather than a specific user, since a call has no
  // single message to point at the way the Inbox's per-message report does.
  const [reportOpen, setReportOpen] = useState(false);
  // Refs don't re-render, and which slot each stream belongs in changes the
  // moment the remote track lands — so the arrival itself has to be state.
  const [hasRemote, setHasRemote] = useState(false);

  // Which physical <video> slot shows which stream. The `!remote` clause is
  // what makes the outgoing-call screen feel like FaceTime instead of a
  // loading spinner: until the other side's track actually arrives there is
  // nothing to put on the main stage, and the old code put that nothing
  // there anyway — a black rectangle with "Waiting for X to join" over it.
  // Every real calling app shows YOU full-screen while it's ringing out,
  // then demotes you to the corner the instant the other person appears.
  // That's exactly what this does, and it also means the call screen proves
  // your own camera and mic are working before the call ever connects.
  function assignVideos(isSelfMain) {
    const a = videoARef.current, b = videoBRef.current;
    const local = localStreamRef.current, remote = remoteStreamRef.current;
    const selfOnMain = isSelfMain || !remote;
    if (a) a.srcObject = selfOnMain ? local : remote;
    if (b) b.srcObject = selfOnMain ? remote : local;
  }

  useEffect(() => { mainIsSelfRef.current = mainIsSelf; assignVideos(mainIsSelf); }, [mainIsSelf]);

  useEffect(() => {
    let cancelled = false;
    let pc = null;
    let localStream = null;
    let pollTimer = null;
    let lastSeenId = 0;
    let peerId = null;
    let role = null; // 'offerer' | 'answerer', decided once the peer's first message is seen
    let madeOffer = false;
    let remoteDescSet = false;
    let connected = false;
    let pollFailures = 0;
    let ringTimer = null;
    const startedAt = Date.now();
    const pendingRemoteCandidates = [];
    const myClientId = clientIdRef.current;

    setStatus("loading");
    setErrorReason("");

    const postSignal = (type, payload) => postCallSignal(threadId, myClientId, type, payload);

    async function flushPendingCandidates() {
      while (pendingRemoteCandidates.length) {
        const c = pendingRemoteCandidates.shift();
        try { await pc.addIceCandidate(c); } catch {}
      }
    }

    async function makeOffer() {
      if (!pc) return;
      setStatus("connecting");
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await postSignal("offer", offer);
      } catch {}
    }

    async function handleMessage(msg) {
      // Commit 56 — ignore signals that predate this huddle. Rows live for
      // ten minutes (SIGNAL_TTL_MS in call-signal.js), so a thread that has
      // been called on recently still holds hello/ice/bye rows from an
      // abandoned attempt. Without this, a fresh call can latch its peer
      // identity onto a client that is no longer there — which decides the
      // offerer/answerer tie-break against a ghost, and then neither live
      // side ever sends an offer. That failure looks exactly like the
      // connection simply never establishing, and it gets MORE likely the
      // more times a pair retries, which is the worst possible property for
      // something someone is already struggling to get working.
      if (msg.created_at && msg.created_at < startedAt - 2000) return;
      if (peerId == null && msg.sender_id) {
        peerId = msg.sender_id;
        // Deterministic tie-break so exactly one side ever creates the
        // offer, computed identically on both sides with no coordination
        // beyond comparing two already-known, stable ids — avoids "glare"
        // from both peers racing to offer at once. Normally this compares
        // user ids, which are always distinct for two real participants in
        // a DM. If they're ever equal or missing (e.g. testing a call
        // against your own account from two tabs, where "currentUserId"
        // is identical on both sides and a plain user-id compare would
        // make BOTH sides "answerer" and neither would ever offer — the
        // exact failure mode that leaves a call stuck at "waiting"
        // forever), fall back to comparing the per-tab clientId instead,
        // which is always unique.
        const mine = (currentUserId != null && peerId != null && String(currentUserId) !== String(peerId))
          ? String(currentUserId) : myClientId;
        const theirs = (currentUserId != null && peerId != null && String(currentUserId) !== String(peerId))
          ? String(peerId) : String(msg.client_id || peerId);
        role = mine < theirs ? "offerer" : "answerer";
      }
      if (msg.type === "hello") {
        if (role === "offerer" && !madeOffer) { madeOffer = true; await makeOffer(); }
        else setStatus((s) => (s === "loading" || s === "waiting" ? "connecting" : s));
      } else if (msg.type === "offer") {
        setStatus("connecting");
        try {
          await pc.setRemoteDescription(msg.payload);
          remoteDescSet = true;
          await flushPendingCandidates();
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await postSignal("answer", answer);
        } catch {}
      } else if (msg.type === "answer") {
        try {
          await pc.setRemoteDescription(msg.payload);
          remoteDescSet = true;
          await flushPendingCandidates();
        } catch {}
      } else if (msg.type === "ice") {
        if (remoteDescSet) { try { await pc.addIceCandidate(msg.payload); } catch {} }
        else pendingRemoteCandidates.push(msg.payload);
      } else if (msg.type === "bye") {
        if (!cancelled) onCloseRef.current && onCloseRef.current();
      }
    }

    async function poll() {
      if (cancelled) return;
      try {
        const qs = new URLSearchParams({ threadId: String(threadId), since: String(lastSeenId), clientId: myClientId });
        const res = await fetch(`/api/callsignal?${qs.toString()}`);
        if (res.ok) {
          pollFailures = 0;
          const data = await res.json().catch(() => null);
          const messages = (data && data.messages) || [];
          for (const msg of messages) {
            lastSeenId = Math.max(lastSeenId, msg.id);
            await handleMessage(msg);
          }
        } else if (res.status === 404) {
          // The endpoint itself doesn't exist — this is a deploy problem
          // (call-signal.js missing from the live Functions), not a
          // networking blip. Surfacing it immediately, rather than
          // retrying into a silent "waiting" forever, is the difference
          // between "the call feature is broken" and "why didn't Dusty's
          // deploy work" being knowable at all from the UI.
          if (!cancelled) {
            setErrorReason("Video calling isn't set up on the server yet, /api/callsignal isn't answering. Check that functions/api/callsignal.js and iceservers.js are both deployed.");
            setStatus("error");
          }
          return;
        } else {
          pollFailures += 1;
        }
      } catch {
        pollFailures += 1;
      }
      if (cancelled) return;
      if (pollFailures >= 8) {
        // ~8 consecutive failures (a handful of seconds to over a minute,
        // depending on phase) is well past anything a transient blip
        // explains — surface it rather than spinning "Waiting…" forever
        // with no way for anyone to tell the call is actually broken.
        setErrorReason("Lost connection to the call signaling service. Check your connection and try again.");
        setStatus("error");
        return;
      }
      // Fast while establishing the call, slower once connected — from
      // there on the only thing still worth polling for is a hangup.
      pollTimer = setTimeout(poll, connected ? 3000 : 800);
    }

    async function start() {
      const icePromise = fetch("/api/iceservers").then((r) => (r.ok ? r.json() : null)).catch(() => null);
      try {
        // Commit 97 — do not ask for a camera on an audio call. This always
        // requested video first and fell back only after the request FAILED,
        // so an audio call still fired a camera permission prompt and, on a
        // machine with a camera that is present but busy, could hang there.
        localStream = await navigator.mediaDevices.getUserMedia({ video: !audioOnly, audio: true });
      } catch {
        try {
          localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
          if (!cancelled) setHasCamera(false);
        } catch {
          if (!cancelled) {
            setErrorReason(audioOnly
              ? "Cerebrum needs microphone access for this call. Allow it in your browser, then try again."
              : "Cerebrum needs camera and microphone access for this call. Allow them in your browser, then try again.");
            setStatus("error");
          }
          return;
        }
      }
      if (cancelled) { localStream.getTracks().forEach((t) => t.stop()); return; }
      localStreamRef.current = localStream;
      assignVideos(mainIsSelfRef.current);

      let iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
      const iceData = await icePromise;
      if (iceData && Array.isArray(iceData.iceServers) && iceData.iceServers.length) iceServers = iceData.iceServers;
      // "none" means /api/iceservers has no working relay configured. Held
      // here so the failure message below can say that instead of blaming
      // the network. See functions/api/iceservers.js.
      const relayKind = (iceData && iceData.relay) || "unknown";
      if (cancelled) return;

      let iceRestarted = false;
      pc = new RTCPeerConnection({ iceServers });

      /* Commit 85 — calls that ring, exchange signalling cleanly, and then
         never connect.

         Everything up to media was already observable: the ring arrives,
         /api/callsignal returns 200, the message cursor climbs. What was
         invisible was ICE. A relay that rejects its credentials reports
         that ONLY through onicecandidateerror, which nothing listened to,
         and a connection with no relay candidate on either side simply
         runs out of pairs and fails with no explanation. Both are now
         observed: `sawRelay` records whether a relay candidate was ever
         gathered, and the failure message distinguishes "your networks
         need a relay and none is configured" from a genuine network
         problem. That is the difference between a bug report saying "calls
         don't work" and one naming the variable to set. */
      let sawRelay = false;
      let iceErr = null;
      pc.onicecandidateerror = (e) => {
        // 701 is "STUN/TURN server unreachable"; 401/403 are credential
        // rejections. Anything in that range means the relay is the fault.
        if (e && (e.errorCode === 401 || e.errorCode === 403 || e.errorCode === 701)) {
          iceErr = { code: e.errorCode, url: e.url || "" };
        }
      };
      pcRef.current = pc;
      localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
      pc.ontrack = (e) => {
        remoteStreamRef.current = e.streams[0];
        if (!cancelled) setHasRemote(true);
        assignVideos(mainIsSelfRef.current);
      };
      pc.onicecandidate = (e) => {
        if (!e.candidate) return;
        if (e.candidate.type === "relay" || /\btyp relay\b/.test(e.candidate.candidate || "")) sawRelay = true;
        postSignal("ice", e.candidate.toJSON());
      };
      pc.onconnectionstatechange = () => {
        if (cancelled || !pc) return;
        if (pc.connectionState === "connected") {
          connected = true;
          if (ringTimer) { clearInterval(ringTimer); ringTimer = null; }
          setStatus("ready");
        }
        else if (pc.connectionState === "disconnected") {
          // A transient drop (a phone changing cell, Wi-Fi to LTE) recovers
          // on its own most of the time. Re-gather once rather than tearing
          // the call down on the first blip.
          connected = false;
          if (!iceRestarted) {
            iceRestarted = true;
            try { pc.restartIce(); } catch {}
          }
        }
        else if (pc.connectionState === "failed") {
          connected = false;
          if (!iceRestarted) {
            // One ICE restart before giving up — this alone recovers a
            // meaningful share of failures, and costs a couple of seconds.
            iceRestarted = true;
            try { pc.restartIce(); return; } catch {}
          }
          setErrorReason(
            relayKind === "none" || !sawRelay
              ? "This call needs a relay server and none is available. Two networks like a phone on mobile data and a computer behind a home router usually can't reach each other directly, so the call needs somewhere to bounce through. Set TURN_KEY_ID and TURN_KEY_API_TOKEN in the Cloudflare Pages environment to fix this for everyone."
              : iceErr
                ? `The relay server rejected the connection (code ${iceErr.code}). The TURN credentials in the Cloudflare Pages environment look wrong or expired.`
                : "Couldn't establish a connection to the other person. This can happen on some restrictive networks."
          );
          setStatus("error");
        }
      };

      setStatus("waiting");
      await postSignal("hello", {});
      // Commit 54 — this is the half of "call someone" that never existed.
      // Everything else in this component assumed both people had already
      // decided to be in the same huddle; nothing ever told the other
      // person a call was happening, so unless they independently clicked
      // Huddle on the same thread within seconds, both sides sat on
      // "Waiting for X to join" indefinitely. That's the reported bug, and
      // no amount of fixing the WebRTC handshake could have solved it.
      //
      // A repeating heartbeat rather than one "incoming call" row: hanging
      // up, closing the tab, a dead network and a killed browser all stop
      // it in exactly the same way, so the other end's ringing UI expires
      // by itself. There is no cleanup path that can fail and leave someone
      // with a phantom call ringing forever.
      // If the very first ring can't be delivered, the person on the other
      // end will never know they're being called no matter how long we spin.
      // Better to say so immediately than to show "Calling…" forever.
      let ringFailures = 0;
      let lastRingReason = "";
      const ring = async () => {
        if (cancelled || connected) return;
        /* Commit 97 — the ring now carries the call kind.
           An audio call was being answered as a VIDEO call. The caller
           picks "Start an audio call", but the ring payload was empty and
           incoming-calls returned only {threadId, fromId, fromName, at},
           so the callee had no way to know and its accept handler built a
           huddle with audioOnly undefined. The callee's browser then asked
           for a camera the caller never wanted, and on any machine without
           a working one the whole call died with "Camera/microphone access
           is required" instead of connecting as audio. */
        const ok = await postSignal("ring", { audioOnly: !!audioOnly });
        if (ok !== true) {
          ringFailures += 1;
          if (typeof ok === "string" && ok) lastRingReason = ok;
          if (ringFailures >= 3 && !cancelled) {
            // Commit 70 — say what the server actually said. Three failed
            // heartbeats means the other person genuinely will not be
            // notified, so the message still has to be blunt about that —
            // but the reason is now the real one, which is the difference
            // between a bug report someone can act on and a screenshot.
            setErrorReason(
              (lastRingReason || "The ring couldn't be delivered.") +
              " The other person won't be notified until this is resolved."
            );
            setStatus("error");
          }
        } else { ringFailures = 0; lastRingReason = ""; }
      };
      ring();
      ringTimer = setInterval(ring, 3000);
      poll();
    }

    start();

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (ringTimer) clearInterval(ringTimer);
      postSignal("bye", {});
      if (pc) { try { pc.close(); } catch {} }
      if (localStream) localStream.getTracks().forEach((t) => t.stop());
      if (screenTrackRef.current) { try { screenTrackRef.current.stop(); } catch {} screenTrackRef.current = null; }
      pcRef.current = null;
      localStreamRef.current = null;
      remoteStreamRef.current = null;
    };
  }, [threadId, currentUserId, retryTick]);

  const toggleMic = () => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicMuted(!track.enabled);
  };
  const toggleCam = () => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCamMuted(!track.enabled);
  };
  const toggleView = () => setMainIsSelf((v) => !v);
  const endCall = () => { postCallSignal(threadId, clientIdRef.current, "bye", {}); onClose(); };
  const stopScreenShare = () => {
    const camTrack = localStreamRef.current?.getVideoTracks()[0];
    const sender = pcRef.current?.getSenders().find((s) => s.track && s.track.kind === "video");
    if (sender && camTrack) sender.replaceTrack(camTrack).catch(() => {});
    if (screenTrackRef.current) { try { screenTrackRef.current.stop(); } catch {} screenTrackRef.current = null; }
    setScreenSharing(false);
  };
  const toggleScreenShare = async () => {
    if (screenSharing) { stopScreenShare(); return; }
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const screenTrack = screenStream.getVideoTracks()[0];
      const sender = pcRef.current?.getSenders().find((s) => s.track && s.track.kind === "video");
      if (sender) await sender.replaceTrack(screenTrack);
      screenTrackRef.current = screenTrack;
      // Real event, not polled/guessed — fires when the share ends via the
      // browser's own native "Stop sharing" bar, not just our own button.
      screenTrack.onended = () => stopScreenShare();
      setScreenSharing(true);
    } catch {}
  };
  // ~150kbps in Data saver vs ~2.5Mbps normally — real bitrate caps WebRTC's
  // own encoder honors (documented RTCRtpSender.setParameters), not a
  // cosmetic label.
  const toggleDataSaver = async () => {
    const next = !dataSaver;
    setDataSaver(next);
    const sender = pcRef.current?.getSenders().find((s) => s.track && s.track.kind === "video");
    if (sender) {
      try {
        const params = sender.getParameters();
        if (!params.encodings || !params.encodings.length) params.encodings = [{}];
        params.encodings[0].maxBitrate = next ? 150000 : 2500000;
        await sender.setParameters(params);
      } catch {}
    }
  };

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

  // Commit 47: minimized is a pure CSS/layout mode change, not a remount —
  // the `<video>` elements (and the RTCPeerConnection feeding them) stay
  // exactly where they are in the tree the whole time; only the wrapping
  // box's size and position change, and the chrome around it (top bar,
  // self-view PiP, full control island) is swapped for a compact bubble
  // overlay. That's what lets the call keep running while minimized instead
  // of dropping and reconnecting.
  // Self takes the main stage whenever there's no remote feed to put there
  // (ringing out, reconnecting), regardless of the manual swap state.
  // Ringback for the caller, but only while actually ringing out — the
  // moment a peer answers, status leaves "waiting" and the tone stops.
  useCallTone("outgoing", status === "waiting" && !minimized);
  const selfOnMain = mainIsSelf || !hasRemote;
  const bubbleSize = isMobile ? { width: 148, height: 108 } : { width: 220, height: 150 };
  const wrapStyle = minimized
    ? {
        position: "fixed", zIndex: 300, cursor: "pointer",
        bottom: isMobile ? 96 : 24, right: 20,
        width: bubbleSize.width, height: bubbleSize.height,
        borderRadius: 16, overflow: "hidden", background: "#0b0b0d",
        border: "1px solid rgba(255,255,255,0.16)", boxShadow: "0 14px 40px rgba(0,0,0,0.5)",
      }
    : { position: "fixed", inset: 0, zIndex: 300, background: "#0b0b0d" };

  return (
    <div role="dialog" aria-modal="true" aria-label={`Call with ${name}`} style={wrapStyle} onClick={minimized ? () => setMinimized(false) : undefined}>
      {/* Main stage — a plain <video> now instead of a Jitsi iframe mount;
          which stream (self or remote) plays here vs. in the PiP slot below
          is decided by mainIsSelf/assignVideos, not by which JSX slot this
          is. Muted here because the main slot can hold the self stream when
          swapped — the PiP slot's video carries the opposite mute value. */}
      <div style={{
        position: "absolute", inset: minimized ? 0 : (isMobile ? 0 : 16),
        borderRadius: minimized ? 0 : (isMobile ? 0 : 20), overflow: "hidden", background: "#000",
      }}>
        <video ref={videoARef} autoPlay playsInline muted={selfOnMain} style={{
          position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover",
          transform: selfOnMain ? "scaleX(-1)" : "none",
          opacity: selfOnMain && (!hasCamera || camMuted) ? 0 : 1,
        }} />
        {selfOnMain && (!hasCamera || camMuted) && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="cameraOff" size={28} style={{ color: "rgba(255,255,255,0.4)" }} />
          </div>
        )}
        {/* While ringing out, this sits ON TOP of your own live camera feed
            (see assignVideos) rather than replacing it, so the screen reads
            as "you, calling someone" the way FaceTime does. The scrim is a
            gradient weighted to the top and bottom edges — enough contrast
            for the status text and the End-call button without flattening
            the middle of your own picture into grey. The full-bleed opaque
            treatment stays for the states where there genuinely is nothing
            to look at yet (still acquiring the camera, or an error). */}
        {status !== "ready" && !minimized && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 12, padding: 24, textAlign: "center",
            background: (status === "waiting" || status === "connecting")
              ? "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.12) 35%, rgba(0,0,0,0.12) 62%, rgba(0,0,0,0.72) 100%)"
              : "rgba(11,11,13,0.92)",
          }}>
            {status === "loading" ? (<>
              <div style={{ width: 32, height: 32, border: "2px solid rgba(255,255,255,0.2)", borderTopColor: accent, borderRadius: "50%", animation: "cbspin 0.8s linear infinite" }} />
              <div style={{ fontSize: FONT_SIZES.small, color: "rgba(255,255,255,0.7)" }}>Getting camera ready…</div>
            </>) : status === "waiting" ? (<>
              {/* "Waiting for X to join" described the old behavior
                  accurately — nothing was calling anyone, it really was
                  just waiting. Now that starting a huddle actually rings
                  the other person (see the ring heartbeat in the effect
                  above), the copy says what is happening: it's calling. */}
              <div aria-hidden="true" style={{
                width: 84, height: 84, borderRadius: "50%", marginBottom: 4,
                background: withAlpha(accent, 0.22), border: `1px solid ${withAlpha(accent, 0.4)}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 30, fontWeight: 700, color: "#fff", fontFamily: "var(--cb-display)",
                animation: "cbHuddleRing 2s ease-in-out infinite",
              }}>{(name || "?").trim().charAt(0).toUpperCase()}</div>
              <div style={{ fontSize: FONT_SIZES.subhead, fontWeight: 700, color: "#fff" }}>Calling {name}…</div>
              <div style={{ fontSize: FONT_SIZES.caption, color: "rgba(255,255,255,0.6)" }}>Ringing on Cerebrum — they'll see it if they're online.</div>
              <button onClick={(e) => { e.stopPropagation(); onClose(); }} style={{ padding: "8px 18px", borderRadius: 100, border: "none", background: "rgba(255,255,255,0.14)", color: "#fff", cursor: "pointer", fontSize: FONT_SIZES.small, fontWeight: 600, fontFamily: "var(--cb-body)" }}>Back to chat</button>
            </>) : status === "connecting" ? (<>
              <div style={{ width: 32, height: 32, border: "2px solid rgba(255,255,255,0.2)", borderTopColor: accent, borderRadius: "50%", animation: "cbspin 0.8s linear infinite" }} />
              <div style={{ fontSize: FONT_SIZES.small, color: "rgba(255,255,255,0.7)" }}>Connecting…</div>
            </>) : (<>
              <Icon name="warning" size={22} style={{ color: "rgba(255,255,255,0.6)" }} />
              <div style={{ fontSize: FONT_SIZES.small, fontWeight: 600, color: "#fff" }}>{errorReason || "Couldn't reach the video call service."}</div>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={(e) => { e.stopPropagation(); setRetryTick((n) => n + 1); }} style={{ padding: "8px 18px", borderRadius: 100, border: "1px solid rgba(255,255,255,0.25)", background: "none", color: "#fff", cursor: "pointer", fontSize: FONT_SIZES.small, fontWeight: 600, fontFamily: "var(--cb-body)" }}>Retry</button>
                <button onClick={(e) => { e.stopPropagation(); onClose(); }} style={{ padding: "8px 18px", borderRadius: 100, border: "none", background: "rgba(255,255,255,0.14)", color: "#fff", cursor: "pointer", fontSize: FONT_SIZES.small, fontWeight: 600, fontFamily: "var(--cb-body)" }}>Back to chat</button>
              </div>
            </>)}
          </div>
        )}
      </div>

      {minimized ? (
        // Compact bubble chrome: name + a tiny mute/hangup/expand row. The
        // whole bubble is click-to-expand (see the wrapper's onClick above);
        // these three buttons stop propagation so they act on the call
        // directly instead of also re-expanding it.
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 8, pointerEvents: "none" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, pointerEvents: "none" }}>
            <span style={{ fontSize: FONT_SIZES.micro, fontWeight: 700, color: "#fff", background: "rgba(0,0,0,0.5)", padding: "3px 8px", borderRadius: 100, maxWidth: "70%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6, pointerEvents: "auto" }}>
            <button onClick={(e) => { e.stopPropagation(); toggleMic(); }} aria-label={micMuted ? "Unmute microphone" : "Mute microphone"} style={{ width: 30, height: 30, borderRadius: "50%", border: "none", cursor: "pointer", background: "rgba(0,0,0,0.55)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name={micMuted ? "micOff" : "mic"} size={14} />
            </button>
            <button onClick={(e) => { e.stopPropagation(); setMinimized(false); }} aria-label="Expand call" title="Expand" style={{ width: 30, height: 30, borderRadius: "50%", border: "none", cursor: "pointer", background: "rgba(0,0,0,0.55)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name="maximize2" size={14} />
            </button>
            <button onClick={(e) => { e.stopPropagation(); endCall(); }} aria-label="End call" title="End call" style={{ width: 30, height: 30, borderRadius: "50%", border: "none", cursor: "pointer", background: STATUS.bad, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name="phoneOff" size={14} />
            </button>
          </div>
        </div>
      ) : (<>
      {/* Top bar: who you're calling, reachable even before the call connects */}
      <div style={{ position: "absolute", top: isMobile ? 14 : 28, left: isMobile ? 14 : 28, display: "flex", alignItems: "center", gap: 8, padding: "6px 14px 6px 6px", borderRadius: 100, background: "rgba(0,0,0,0.4)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}>
        <span style={{ width: 26, height: 26, borderRadius: "50%", background: withAlpha(accent, 0.35), color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: FONT_SIZES.micro, fontWeight: 700, fontFamily: "var(--cb-mono)" }}>{(name || "?")[0]?.toUpperCase()}</span>
        <span style={{ fontSize: FONT_SIZES.small, fontWeight: 600, color: "#fff", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
        {dataSaver && <span title="Data saver is on: video quality lowered" style={{ fontSize: FONT_SIZES.micro, fontWeight: 700, color: accent, display: "inline-flex", alignItems: "center", gap: 3 }}><Icon name="zap" size={11} />Saver</span>}
      </div>

      {/* Minimize — keeps the call connected, shrinks to a floating bubble
          so the rest of the app is usable mid-call (see the block comment
          above this component for the FaceTime/Messenger-style rationale). */}
      {status === "ready" && (
        <button onClick={() => setMinimized(true)} aria-label="Minimize call" title="Minimize" style={{ position: "absolute", top: isMobile ? 14 : 28, right: isMobile ? 14 : 28, width: 36, height: 36, borderRadius: "50%", border: "none", cursor: "pointer", background: "rgba(0,0,0,0.4)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2 }}>
          <Icon name="minimize2" size={16} />
        </button>
      )}

      {/* Picture-in-picture slot — click to swap with the main stage (same
          gesture Instagram/Messenger's own calling uses). Whichever stream
          (self or remote) actually plays here is decided by
          mainIsSelf/assignVideos, matching the main-stage slot above. */}
      {status === "ready" && (
        <div onClick={(e) => { e.stopPropagation(); toggleView(); }} title="Switch view" style={{
          position: "absolute", top: isMobile ? 60 : 76, right: isMobile ? 14 : 28, width: isMobile ? 96 : 140, height: isMobile ? 128 : 104,
          borderRadius: 16, overflow: "hidden", background: "#18181c", cursor: "pointer",
          border: "1px solid rgba(255,255,255,0.22)", boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
        }}>
          <video ref={videoBRef} autoPlay playsInline muted={!selfOnMain} style={{
            width: "100%", height: "100%", objectFit: "cover",
            transform: !selfOnMain ? "scaleX(-1)" : "none",
            opacity: !selfOnMain && (!hasCamera || camMuted) ? 0 : 1,
            transition: "opacity 0.2s ease",
          }} />
          {!selfOnMain && (!hasCamera || camMuted) && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
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
          {!isMobile && controlBtn(screenSharing, toggleScreenShare, "screenShare", "screenShare", screenSharing ? "Stop sharing screen" : "Share screen")}
          {controlBtn(mainIsSelf, toggleView, "grid", "grid", "Switch view")}
          {controlBtn(dataSaver, toggleDataSaver, "zap", "zap", dataSaver ? "Turn off data saver" : "Turn on data saver (lower video quality)")}
          <button onClick={() => setReportOpen(true)} aria-label="Report this call" title="Report this call" style={{
            width: 48, height: 48, borderRadius: "50%", border: "none", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(255,255,255,0.14)", color: "#fff",
          }}>
            <Icon name="flag" size={18} />
          </button>
          <button onClick={endCall} aria-label="End call" title="End call" style={{ width: 54, height: 48, borderRadius: 100, border: "none", cursor: "pointer", background: STATUS.bad, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="phoneOff" size={20} />
          </button>
        </div>
      )}
      </>)}
      {reportOpen && (
        <ReportConductModal
          P={P} accent={accent} at={at} kind="call" targetLabel={name}
          threadId={roomSeed} onClose={() => setReportOpen(false)}
        />
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
// Commit 48 — one report dialog for all three conduct-report surfaces
// (a person, from the Inbox thread header; a single message, from its hover
// actions; a call, from the Video Huddle controls) instead of three near-
// identical modals, same "one table + a kind discriminator" reasoning as
// content_reports itself in schema.sql. Posts straight to file-report in
// functions/api/data.js — see the comment there for validation/scoping.
const REPORT_REASONS = [
  { id: "harassment", label: "Harassment or abuse" },
  { id: "spam", label: "Spam or scam" },
  { id: "inappropriate", label: "Inappropriate content" },
  { id: "impersonation", label: "Impersonation" },
  { id: "other", label: "Other" },
];

function ReportConductModal({ P, accent, at, kind, targetLabel, threadId, reportedUserId, messageId, onClose }) {
  const [reason, setReason] = useState("harassment");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const trapRef = useRef(null);

  useEffect(() => { if (trapRef.current) trapRef.current.focus(); }, []);

  const title = kind === "message" ? "Report message" : kind === "call" ? "Report this call" : `Report ${targetLabel || "this person"}`;

  const submit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      await apiDataAction("file-report", {
        kind, reason, note: note.trim(),
        reported_user_id: reportedUserId || null,
        thread_id: threadId || null,
        message_id: messageId || null,
      });
      setSubmitted(true);
      setTimeout(() => onClose(), 1600);
    } catch (err) {
      toast(err.message || "Couldn't send that report.", { tone: "error" });
      setSubmitting(false);
    }
  };

  return (
    <div onClick={onClose} role="dialog" aria-modal="true" aria-label={title} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 310, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} className="cb-backdrop">
      <div ref={trapRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} style={{
        background: P.dark ? "rgba(15, 17, 26, 0.9)" : "rgba(255, 255, 255, 0.95)",
        backdropFilter: "blur(40px) saturate(150%)", WebkitBackdropFilter: "blur(40px) saturate(150%)",
        border: P.dark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.08)",
        borderRadius: 8, maxWidth: 420, width: "100%", padding: "26px", outline: "none",
        boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
      }} className="cb-modal">
        {submitted ? (
          <div style={{ textAlign: "center", padding: "16px 0" }}>
            <div style={{ width: 40, height: 40, borderRadius: "50%", background: withAlpha(STATUS.good, 0.12), color: STATUS.good, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
              <Icon name="check" size={18} />
            </div>
            <div style={{ fontSize: FONT_SIZES.body, fontWeight: 600, color: P.ink }}>Report received</div>
            <div style={{ fontSize: FONT_SIZES.small, color: P.ink2, marginTop: 6 }}>Thanks for flagging this.</div>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
              <div style={{ fontSize: FONT_SIZES.heading, fontWeight: 700, letterSpacing: "-0.02em", color: P.ink, fontFamily: "var(--cb-display)" }}>{title}</div>
              <button type="button" onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: P.faint, cursor: "pointer", padding: 4, display: "inline-flex" }}><Icon name="close" size={18} /></button>
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: FONT_SIZES.small, fontWeight: 600, color: P.ink2, marginBottom: 8 }}>Reason</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {REPORT_REASONS.map((r) => (
                  <button key={r.id} type="button" onClick={() => setReason(r.id)} style={{
                    fontSize: FONT_SIZES.caption, padding: "6px 12px", borderRadius: 8, cursor: "pointer",
                    fontFamily: "var(--cb-mono)", fontWeight: 600, transition: "all 0.15s ease",
                    background: reason === r.id ? withAlpha(accent, 0.16) : "transparent",
                    color: reason === r.id ? accent : P.ink2,
                    border: `1px solid ${reason === r.id ? withAlpha(accent, 0.3) : P.line}`,
                  }}>{r.label}</button>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: FONT_SIZES.small, fontWeight: 600, color: P.ink2, marginBottom: 6 }}>Anything else? (optional)</div>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Add context for the review team" style={{
                width: "100%", padding: "11px 13px", fontSize: FONT_SIZES.body, borderRadius: 8,
                border: `1px solid ${P.line}`, background: P.dark ? "rgba(255,255,255,0.03)" : "#fff",
                color: P.ink, fontFamily: "var(--cb-body)", resize: "vertical", outline: "none",
              }} />
            </div>
            <button type="submit" disabled={submitting} style={{
              width: "100%", padding: "12px", fontSize: FONT_SIZES.body, fontWeight: 600,
              background: accent, color: at, border: "none", borderRadius: 8,
              cursor: submitting ? "default" : "pointer",
              opacity: submitting ? 0.6 : 1,
              fontFamily: "var(--cb-body)",
            }}>{submitting ? "Sending…" : "Submit report"}</button>
          </form>
        )}
      </div>
    </div>
  );
}

function InboxView({ P, accent, at, isMobile, threads, setThreads, initialThreadId, onConsumeInitialThread, onStartHuddle, activeHuddleRoomSeed, onCompose }) {
  const [activeId, setActiveId] = useState(null);
  const [activeThread, setActiveThread] = useState(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  // Commit 47: search-as-you-type filter over the already-loaded thread
  // list — no API round trip, this app has a handful of conversations per
  // person at most (same reasoning as the inbox N+1 query comment below),
  // so filtering client-side is both simpler and instant.
  const [threadQuery, setThreadQuery] = useState("");
  // Commit 48: block/report — a small overflow menu on the open thread's
  // header (Block/Unblock, Report this person), plus per-message hover
  // report actions. `reportModal` carries the target: { kind, messageId? } —
  // `kind: "user"` reports activeThread.otherId, `kind: "message"` also
  // carries which message.
  const [menuOpen, setMenuOpen] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);
  const [reportModal, setReportModal] = useState(null);
  const [hoverMsgId, setHoverMsgId] = useState(null);
  // Commit 56 — attachments. `attachBusy` covers both the compression pass
  // and the upload, so the composer can't fire twice on a slow phone.
  const msgPaneRef = useRef(null);
  const imageInputRef = useRef(null);
  const [attachBusy, setAttachBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const recRef = useRef(null);
  const [lightbox, setLightbox] = useState(null);

  // Downscales to fit inside 1400px and re-encodes as JPEG before upload.
  // A phone photo is several MB; a message row in D1 has roughly 1MB to
  // work with, so compressing here is what makes image messages possible at
  // all rather than a nice-to-have. 1400px is chosen to keep a figure or a
  // plot legible when opened full-screen — this is a science tool, and an
  // unreadable figure is a failed message.
  async function compressImageFile(file) {
    const dataUrl = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result); r.onerror = () => rej(new Error("Couldn't read that file."));
      r.readAsDataURL(file);
    });
    const img = await new Promise((res, rej) => {
      const el = new Image();
      el.onload = () => res(el); el.onerror = () => rej(new Error("That doesn't look like an image."));
      el.src = dataUrl;
    });
    const maxSide = 1400;
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").drawImage(img, 0, 0, w, h);
    // Step the quality down until it fits the server's cap rather than
    // sending something that will be refused — a person who picked a photo
    // should get the photo sent, not an error telling them to go resize it.
    for (const q of [0.82, 0.7, 0.58, 0.45, 0.34]) {
      const out = canvas.toDataURL("image/jpeg", q);
      if (out.length < 650000) return out;
    }
    throw new Error("That image is too detailed to send: try a smaller crop.");
  }

  async function handleImagePick(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file || !activeId) return;
    if (!file.type.startsWith("image/")) { toast("Please choose an image file.", { tone: "error" }); return; }
    setAttachBusy(true);
    try {
      const data = await compressImageFile(file);
      await sendMessage({ kind: "image", data, title: file.name.slice(0, 120) });
    } catch (err) {
      toast(err.message || "Couldn't attach that image.", { tone: "error" });
    } finally { setAttachBusy(false); }
  }

  // Voice notes record audio AND run speech recognition over the same take,
  // so the message arrives with a transcript attached. That is the whole
  // reason voice notes belong in a research tool rather than being a chat
  // gimmick: a transcript is skimmable, searchable, quotable and readable by
  // someone who can't play audio right now, while the recording keeps the
  // tone and emphasis a transcript loses.
  async function startRecording() {
    if (recording || !activeId) return;
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { toast("Microphone access is needed for a voice note.", { tone: "error" }); return; }
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) => {
      try { return window.MediaRecorder && MediaRecorder.isTypeSupported(m); } catch { return false; }
    });
    if (!mime) { stream.getTracks().forEach((t) => t.stop()); toast("Voice notes aren't supported in this browser.", { tone: "error" }); return; }
    const chunks = [];
    const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32000 });
    let transcript = "";
    let sr = null;
    try {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SR) {
        sr = new SR(); sr.continuous = true; sr.interimResults = false; sr.lang = navigator.language || "en-US";
        sr.onresult = (ev) => { for (let i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i].isFinal) transcript += ev.results[i][0].transcript; };
        sr.onerror = () => {};
        sr.start();
      }
    } catch {}
    const startedAt = Date.now();
    rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      try { sr && sr.stop(); } catch {}
      const durationMs = Date.now() - startedAt;
      if (durationMs < 700) return; // a mis-tap, not a message
      const blob = new Blob(chunks, { type: mime });
      const data = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
      if (data.length > 650000) { toast("That voice note is too long to send: try a shorter one.", { tone: "error" }); return; }
      setAttachBusy(true);
      try {
        await sendMessage({ kind: "audio", data, title: "Voice note", meta: { durationMs, transcript: transcript.trim().slice(0, 2000) } });
      } catch (err) { toast(err.message || "Couldn't send that voice note.", { tone: "error" }); }
      finally { setAttachBusy(false); }
    };
    // 90 seconds is the hard ceiling the D1 row size implies at this
    // bitrate; stopping automatically is friendlier than letting someone
    // record for three minutes and then telling them it can't be sent.
    recRef.current = { rec, timer: setInterval(() => setRecSeconds((v) => { const nv = v + 1; if (nv >= 90) stopRecording(); return nv; }), 1000) };
    rec.start();
    setRecSeconds(0);
    setRecording(true);
  }

  function stopRecording() {
    const cur = recRef.current;
    if (!cur) return;
    clearInterval(cur.timer);
    try { cur.rec.stop(); } catch {}
    recRef.current = null;
    setRecording(false);
    setRecSeconds(0);
  }

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
    const refresh = (isFirst) => {
      apiDataGet("thread", { thread_id: activeId }).then((data) => {
        if (cancelled) return;
        if (isFirst) setLoadingThread(false);
        // A message that arrives while you're on another tab should reach
        // you the same way any other app's would.
        setActiveThread((prevThread) => {
          const next = data && !data.error ? data : null;
          try {
            const prevMsgs = (prevThread && prevThread.messages) || [];
            const nextMsgs = (next && next.messages) || [];
            if (prevThread && nextMsgs.length > prevMsgs.length) {
              const fresh = nextMsgs[nextMsgs.length - 1];
              if (fresh && !fresh.mine) {
                cbBlip(660, 0.07, 0.045);
                cbNotify(fresh.who || next.name || "New message", (fresh.text || "Sent an attachment").slice(0, 140), "cb-msg-" + activeId, "message");
              }
            }
          } catch {}
          return next;
        });
        // The backend marks this thread read as part of that same GET (see
        // the "thread" resource handler in functions/api/data.js) — mirror it
        // here optimistically so the list's bold/dot treatment and the
        // Sidebar's unread-count badge clear immediately instead of waiting
        // for this view's next full inbox refetch.
        if (data && !data.error) {
          setThreads((prev) => prev.map((t) => (t.id === activeId ? { ...t, unread: false } : t)));
        }
      });
    };
    refresh(true);
    // Commit 51 — light polling while a thread stays open. Two real gaps
    // needed this, not just read receipts: without it, a message the other
    // person sends while you're already looking at this conversation never
    // shows up until you leave and come back (the fetch above used to run
    // once per activeId and never again), and "Seen" below would only ever
    // catch up the same way. Every poll also re-marks-as-read, which is the
    // right behavior, not a side effect to work around — staying on an open
    // thread should keep counting as "still reading it."
    const pollId = setInterval(() => refresh(false), 5000);
    return () => { cancelled = true; clearInterval(pollId); };
  }, [activeId]);

  const sendMessage = async (attachment) => {
    const text = draft.trim();
    // An attachment is a complete message on its own — a photo of a gel or
    // a ten-second voice note doesn't need a caption to be worth sending.
    if ((!text && !attachment) || !activeId || sending) return;
    setSending(true);
    setDraft("");
    try {
      // Commit 57 — a short confirmation blip on send. Silence after
      // pressing send leaves a half-second of "did that go?"; every
      // messaging app answers that with a sound, and it costs one
      // oscillator. Honors the app's mute setting like every other tone.
      cbBlip(880, 0.07, 0.05);
      const res = await apiDataAction("send-message", {
        thread_id: activeId, text,
        ...(attachment ? {
          attachment_kind: attachment.kind,
          attachment_title: attachment.title || "",
          attachment_data: attachment.data || "",
          attachment_url: attachment.url || "",
          attachment_meta: attachment.meta || null,
        } : {}),
      });
      setActiveThread((t) => (t ? { ...t, messages: [...t.messages, { ...res.message, who: "You" }] } : t));
      setThreads((prev) => prev.map((t) => (t.id === activeId ? { ...t, lastMessage: res.message } : t)));
    } catch (e) {
      setDraft(text);
      toast(e.message || "Couldn't send that message.", { tone: "error" });
    } finally {
      setSending(false);
    }
  };

  // Commit 48: flips the block for activeThread.otherId and mirrors the
  // result into both activeThread (so the composer/Huddle gate below reacts
  // immediately) and the thread list (so re-opening this conversation from
  // the sidebar doesn't need a fresh fetch to know it's blocked).
  const toggleBlock = async () => {
    if (!activeThread?.otherId || blockBusy) return;
    setBlockBusy(true);
    setMenuOpen(false);
    try {
      const res = await apiDataAction("toggle-block", { target_id: activeThread.otherId });
      setActiveThread((t) => (t ? { ...t, blocked: res.blocked } : t));
      setThreads((prev) => prev.map((t) => (t.id === activeId ? { ...t, blocked: res.blocked } : t)));
      toast(res.blocked ? "Blocked. They can no longer message or call you." : "Unblocked.");
    } catch (e) {
      toast(e.message || "Couldn't update that block.", { tone: "error" });
    } finally {
      setBlockBusy(false);
    }
  };

  const subtitle = activeThread
    ? (activeThread.kind === "group"
      ? `${activeThread.memberCount} member${activeThread.memberCount === 1 ? "" : "s"}`
      // Commit 100 — was [otherEmail, otherAffiliation]. The email is no
      // longer sent by the server at all, and the affiliation now arrives
      // already filtered by that person's show_affiliation setting. The
      // handle is what belongs here: public, stable, and the thing that
      // tells two people with the same name apart.
      : [activeThread.otherUsername ? "@" + activeThread.otherUsername : null, activeThread.otherAffiliation].filter(Boolean).join(" · "))
    : "";

  // Read receipts — DMs only (see the otherLastReadAt comment in
  // functions/api/data.js for why groups don't get this). "Seen" only ever
  // marks the single most recent message *you* sent, the same place every
  // real DM app (iMessage, WhatsApp) puts it — not a per-message checkmark
  // on everything you've ever sent.
  let lastMineMessage = null;
  if (activeThread?.messages) {
    for (let i = activeThread.messages.length - 1; i >= 0; i--) {
      if (activeThread.messages[i].mine) { lastMineMessage = activeThread.messages[i]; break; }
    }
  }
  const seenLastMine = !!(
    lastMineMessage && activeThread?.kind === "dm" &&
    activeThread.otherLastReadAt && activeThread.otherLastReadAt >= lastMineMessage.createdAt
  );

  // Mobile: show one pane at a time (list, or the open thread with a way
  // back) instead of squeezing both into one narrow column.
  const showList = !isMobile || !activeId;
  const showThread = !isMobile || !!activeId;

  const filteredThreads = threadQuery.trim()
    ? threads.filter((t) => (t.name || "").toLowerCase().includes(threadQuery.trim().toLowerCase()))
    : threads;

  return (
    <>
    {/* Commit 56 — was height:"100%". Its parent chain (S.pageView inside
        S.appMain) only ever sets minHeight, and a percentage height
        resolves against a parent's *height*, not its min-height — so this
        collapsed to the height of its own content. On screen that meant the
        conversation stopped a few hundred pixels down with the composer
        floating mid-page and the bottom half of the window empty, which is
        the single thing that made this screen look unfinished next to
        everything else. A viewport-relative height is resolvable no matter
        what the ancestors declare; dvh (not vh) so mobile browser chrome
        collapsing doesn't leave the composer under the address bar. */}
    <div style={{ height: "100dvh", maxHeight: "100dvh", display: "flex", flexDirection: isMobile ? "column" : "row" }}>
      {showList && (
        <div style={{ width: isMobile ? "100%" : 300, flexShrink: 0, borderRight: isMobile ? "none" : `1px solid ${P.line}`, display: "flex", flexDirection: "column", height: "100%" }}>
          <div style={{ padding: "22px 22px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={{ fontSize: FONT_SIZES.heading, fontWeight: 700, color: P.ink, fontFamily: "var(--cb-display)" }}>Inbox</div>
            <button onClick={onCompose} aria-label="New message" title="New message" style={{ width: 30, height: 30, borderRadius: "50%", border: "none", cursor: "pointer", background: withAlpha(accent, 0.12), color: accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icon name="edit" size={15} />
            </button>
          </div>
          {threads.length > 0 && (
            <div style={{ padding: "0 22px 12px" }}>
              <input
                value={threadQuery}
                onChange={(e) => setThreadQuery(e.target.value)}
                placeholder="Search conversations"
                aria-label="Search conversations"
                style={{ width: "100%", padding: "8px 12px", borderRadius: 100, border: `1px solid ${P.line}`, background: P.dark ? "rgba(255,255,255,0.03)" : "#fff", color: P.ink, fontFamily: "var(--cb-body)", fontSize: FONT_SIZES.caption }}
              />
            </div>
          )}
          <div style={{ flex: 1, overflowY: "auto", padding: "0 12px 12px" }}>
            {/* Commit 100 — "No conversations yet." followed by a <br> was
                the last hand-written empty state left in this file, and it
                sat in the narrowest column on the screen where a bare grey
                sentence reads as a rendering failure. It also had one job it
                was not doing: after this commit, whether a stranger can
                reach you is a setting, so the empty inbox is the natural
                place to say what that setting currently is. */}
            {threads.length === 0 && (
              <div style={{ padding: "18px 12px", lineHeight: 1.6 }}>
                <div style={{ fontSize: FONT_SIZES.small, fontWeight: 600, color: P.ink, marginBottom: 5 }}>No conversations yet</div>
                <div style={{ fontSize: FONT_SIZES.caption, color: P.faint }}>
                  Search for someone in Find people and start one. By default only people you follow can open a conversation with you.
                </div>
                <button onClick={onCompose} className="cb-press" style={{
                  marginTop: 12, padding: "7px 14px", borderRadius: RADIUS.pill, cursor: "pointer",
                  background: withAlpha(accent, 0.12), color: accent, border: "none",
                  fontSize: FONT_SIZES.caption, fontFamily: "var(--cb-body)", fontWeight: 700,
                }}>Find someone</button>
              </div>
            )}
            {threads.length > 0 && filteredThreads.length === 0 && (
              <div style={{ padding: "16px 12px", fontSize: FONT_SIZES.caption, color: P.faint }}>No conversations match "{threadQuery}".</div>
            )}
            {filteredThreads.map((t) => {
              const initials = (t.name || "?").split(" ").map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
              const preview = t.lastMessage
                ? (t.lastMessage.mine ? "You: " : "") + (t.lastMessage.text || (t.lastMessage.attachmentTitle ? `Attached: ${t.lastMessage.attachmentTitle}` : ""))
                : "No messages yet";
              // Commit 47: bold name/preview + an accent dot for a genuinely
              // unread thread (t.unread, backed by the real last_read_at
              // column now — see functions/api/data.js) instead of every
              // row rendering identically regardless of read state.
              return (
                <button key={t.id} onClick={() => setActiveId(t.id)} className="cb-row" style={{
                  width: "100%", textAlign: "left", padding: "12px 10px 12px 14px", borderRadius: 8, border: "none", cursor: "pointer",
                  background: activeId === t.id ? withAlpha(accent, 0.1) : "transparent",
                  display: "flex", gap: 10, alignItems: "flex-start", fontFamily: "var(--cb-body)",
                }}>
                  <span style={{ width: 38, height: 38, borderRadius: "50%", ...avatarSkin(t.name || t.id), display: "flex", alignItems: "center", justifyContent: "center", fontSize: FONT_SIZES.small, fontWeight: 700, fontFamily: "var(--cb-mono)", flexShrink: 0 }}>{initials}</span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                        {t.unread && <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: accent, flexShrink: 0 }} />}
                        <span style={{ fontSize: FONT_SIZES.small, fontWeight: t.unread ? 800 : 700, color: P.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.name}</span>
                      </span>
                      <span style={{ fontSize: FONT_SIZES.micro, color: P.faint, flexShrink: 0 }}>{relativeTime(t.lastMessage?.createdAt)}</span>
                    </span>
                    <span style={{ display: "block", fontSize: FONT_SIZES.caption, color: t.unread ? P.ink2 : P.faint, fontWeight: t.unread ? 600 : 400, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{preview}</span>
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
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                {/* Commit 57 — "Huddle" was internal vocabulary on the most
                    important button in a conversation. Nobody arrives at a
                    science tool knowing what a huddle is; everyone knows a
                    phone icon and a camera icon. Both open the same call
                    surface; the audio one starts with the camera off. */}
                <button
                  onClick={() => { if (!activeThread.blocked) onStartHuddle(activeThread.name, activeId, { audioOnly: true }); }}
                  disabled={activeThread.blocked}
                  aria-label="Start an audio call" title="Audio call"
                  style={{
                    background: withAlpha(accent, 0.1), border: "none", borderRadius: "50%", color: accent,
                    cursor: activeThread.blocked ? "default" : "pointer", opacity: activeThread.blocked ? 0.4 : 1,
                    width: 38, height: 38, display: "inline-flex", alignItems: "center", justifyContent: "center",
                  }}
                ><Icon name="phone" size={16} /></button>
                <button
                  onClick={() => { if (!activeThread.blocked) onStartHuddle(activeThread.name, activeId); }}
                  disabled={activeThread.blocked}
                  aria-label={activeThread.blocked ? "You've blocked this person: calling unavailable" : activeHuddleRoomSeed === activeId ? "Return to call" : "Start a video call"}
                  title={activeThread.blocked ? "You've blocked this person" : activeHuddleRoomSeed === activeId ? "Return to call" : "Video call"}
                  style={{
                    background: withAlpha(accent, activeHuddleRoomSeed === activeId ? 0.22 : 0.1), border: "none", borderRadius: "50%", color: accent,
                    cursor: activeThread.blocked ? "default" : "pointer", opacity: activeThread.blocked ? 0.4 : 1,
                    width: 38, height: 38, display: "inline-flex", alignItems: "center", justifyContent: "center",
                  }}
                ><Icon name="camera" size={16} /></button>
                {/* Commit 48: block/report menu — DM-only (see user_blocks'
                    scope note in schema.sql: groups have no membership-
                    removal flow to pair blocking with yet), and only once
                    the thread fetch has actually resolved who "the other
                    person" is. */}
                {activeThread.kind === "dm" && activeThread.otherId && (
                  <div style={{ position: "relative" }}>
                    <button onClick={() => setMenuOpen((v) => !v)} aria-label="Conversation options" aria-haspopup="true" aria-expanded={menuOpen} style={{ width: 34, height: 34, borderRadius: 8, border: "none", background: menuOpen ? withAlpha(accent, 0.12) : "transparent", color: P.ink2, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                      <Icon name="moreVertical" size={17} />
                    </button>
                    {menuOpen && (<>
                      <div onClick={() => setMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 30 }} />
                      <div style={{
                        position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 31, minWidth: 200,
                        background: P.dark ? "rgba(22,24,34,0.98)" : "#fff", border: `1px solid ${P.line}`, borderRadius: 8,
                        boxShadow: "0 12px 32px rgba(0,0,0,0.22)", padding: 6, display: "flex", flexDirection: "column",
                      }}>
                        <button onClick={toggleBlock} disabled={blockBusy} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 10px", borderRadius: 8, border: "none", background: "transparent", color: P.ink, fontFamily: "var(--cb-body)", fontSize: FONT_SIZES.small, fontWeight: 500, cursor: blockBusy ? "default" : "pointer", textAlign: "left" }}>
                          <Icon name="block" size={15} style={{ color: P.ink2, flexShrink: 0 }} /> {activeThread.blocked ? "Unblock" : "Block"} {activeThread.name}
                        </button>
                        <button onClick={() => { setMenuOpen(false); setReportModal({ kind: "user" }); }} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 10px", borderRadius: 8, border: "none", background: "transparent", color: STATUS.bad, fontFamily: "var(--cb-body)", fontSize: FONT_SIZES.small, fontWeight: 500, cursor: "pointer", textAlign: "left" }}>
                          <Icon name="flag" size={15} style={{ flexShrink: 0 }} /> Report {activeThread.name}
                        </button>
                      </div>
                    </>)}
                  </div>
                )}
              </div>
            </div>
            {activeThread.blocked && (
              <div style={{ padding: "10px 24px", background: withAlpha(STATUS.bad, 0.08), borderBottom: `1px solid ${P.line}`, fontSize: FONT_SIZES.caption, color: P.ink2, display: "flex", alignItems: "center", gap: 8 }}>
                <Icon name="block" size={14} style={{ color: STATUS.bad, flexShrink: 0 }} />
                You've blocked {activeThread.name}. Neither of you can message or call here until you unblock.
              </div>
            )}
            {/* Commit 87 — messages sat at the TOP of the pane.
                A conversation with four messages rendered them in the top
                quarter of a 900px column with the rest empty below, which
                is how no messaging app anywhere behaves and is most of why
                this screen read as a mock-up. `justifyContent: flex-end`
                keeps a short thread resting on the composer, exactly as it
                does everywhere else, and has no effect once the thread is
                long enough to scroll. */}
            <div ref={msgPaneRef} style={{ flex: 1, overflowY: "auto", padding: 24, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 14, minHeight: 0 }}>
              {activeThread.messages.length === 0 && (
                <div style={{ textAlign: "center", color: P.faint, fontSize: FONT_SIZES.small, marginTop: 20 }}>No messages yet. Say hello.</div>
              )}
              {activeThread.messages.map((m, i) => {
                const key = m.id || i;
                // Commit 56 — a date separator whenever the day changes, so
                // a conversation that spans weeks stops reading as one
                // undifferentiated column of bubbles with no sense of when
                // anything was said.
                const prev = i > 0 ? activeThread.messages[i - 1] : null;
                const dayOf = (ts) => (ts ? new Date(ts).toDateString() : "");
                const showDay = !!m.createdAt && dayOf(m.createdAt) !== dayOf(prev && prev.createdAt);
                const dayLabel = (() => {
                  if (!m.createdAt) return "";
                  const d = new Date(m.createdAt), now = new Date();
                  const days = Math.round((new Date(now.toDateString()) - new Date(d.toDateString())) / 86400000);
                  if (days === 0) return "Today";
                  if (days === 1) return "Yesterday";
                  return d.toLocaleDateString(undefined, { month: "long", day: "numeric", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
                })();
                const timeLabel = m.createdAt ? new Date(m.createdAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "";
                return (
                <React.Fragment key={key}>
                {showDay && (
                  <div style={{ alignSelf: "center", margin: "10px 0 2px", fontSize: FONT_SIZES.micro, fontWeight: 600, color: P.faint, fontFamily: "var(--cb-body)", letterSpacing: "0.01em" }}>{dayLabel}</div>
                )}
                <div style={{ maxWidth: 460, alignSelf: m.mine ? "flex-end" : "flex-start" }}
                  onMouseEnter={() => setHoverMsgId(key)} onMouseLeave={() => setHoverMsgId((h) => (h === key ? null : h))}
                >
                  {!m.mine && activeThread.kind === "group" && m.who && (
                    <div style={{ fontSize: FONT_SIZES.micro, fontWeight: 700, color: P.faint, marginBottom: 3, marginLeft: 4 }}>{m.who}</div>
                  )}
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 5, flexDirection: m.mine ? "row-reverse" : "row" }}>
                    <div style={{ minWidth: 0 }}>
                      {m.text && (
                        <div style={{
                          padding: "12px 16px", fontSize: FONT_SIZES.small, lineHeight: 1.6,
                          borderRadius: m.mine ? "16px 16px 2px 16px" : "16px 16px 16px 2px",
                          color: m.mine ? at : P.ink,
                          background: m.mine ? accent : (P.dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.04)"),
                          border: m.mine ? "none" : (P.dark ? "1px solid rgba(255,255,255,0.06)" : "1px solid rgba(0,0,0,0.05)"),
                        }}>{m.text}</div>
                      )}
                      {/* Image: shown at real size in the thread (a figure
                          you have to click to evaluate is a figure you
                          won't evaluate), click to open full-screen. */}
                      {m.attachmentKind === "image" && m.attachmentData && (
                        <img
                          src={m.attachmentData}
                          alt={m.attachmentTitle || "Attached image"}
                          onClick={() => setLightbox(m.attachmentData)}
                          style={{
                            marginTop: m.text ? 8 : 0, display: "block", maxWidth: "100%", maxHeight: 340,
                            borderRadius: 12, cursor: "zoom-in", border: `1px solid ${P.line}`, objectFit: "cover",
                          }}
                        />
                      )}
                      {/* Voice note: the player and, underneath it, the
                          transcript captured while recording. The transcript
                          is the point — it makes the note skimmable, and
                          readable at all by someone who can't play audio. */}
                      {m.attachmentKind === "audio" && m.attachmentData && (
                        <div style={{
                          marginTop: m.text ? 8 : 0, padding: "10px 12px", borderRadius: 12, minWidth: 220,
                          background: m.mine ? withAlpha(at, 0.14) : (P.dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)"),
                          border: `1px solid ${m.mine ? withAlpha(at, 0.25) : P.line}`,
                        }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <Icon name="mic" size={14} style={{ color: m.mine ? at : accent, flexShrink: 0 }} />
                            <audio controls src={m.attachmentData} style={{ height: 32, maxWidth: 210 }} />
                          </div>
                          {m.attachmentMeta && m.attachmentMeta.transcript && (
                            <div style={{ marginTop: 8, fontSize: FONT_SIZES.caption, lineHeight: 1.55, color: m.mine ? at : P.ink2, opacity: 0.92 }}>
                              “{m.attachmentMeta.transcript}”
                            </div>
                          )}
                        </div>
                      )}
                      {/* A shared paper. Distinct from a plain link: it keeps
                          the citation metadata, so a source sent in a DM
                          still reads like a source. */}
                      {m.attachmentKind === "paper" && m.attachmentTitle && (
                        <a
                          href={m.attachmentUrl || "#"} target="_blank" rel="noopener noreferrer"
                          style={{
                            marginTop: m.text ? 8 : 0, padding: "12px 14px", borderRadius: 12, display: "block",
                            background: withAlpha(accent, 0.08), border: `1px solid ${withAlpha(accent, 0.28)}`, textDecoration: "none",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
                            <Icon name="bookOpen" size={13} style={{ color: accent, flexShrink: 0 }} />
                            <span style={{ fontSize: FONT_SIZES.micro, fontWeight: 700, color: accent, fontFamily: "var(--cb-body)", letterSpacing: "0.01em" }}>Paper</span>
                          </div>
                          <div style={{ fontSize: FONT_SIZES.small, fontWeight: 600, color: P.ink, lineHeight: 1.4 }}>{m.attachmentTitle}</div>
                          {m.attachmentMeta && (m.attachmentMeta.journal || m.attachmentMeta.year) && (
                            <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, marginTop: 4 }}>
                              {[m.attachmentMeta.journal, m.attachmentMeta.year].filter(Boolean).join(" · ")}
                            </div>
                          )}
                        </a>
                      )}
                      {m.attachmentKind !== "image" && m.attachmentKind !== "audio" && m.attachmentKind !== "paper" && m.attachmentTitle && (
                        <div style={{
                          marginTop: 8, padding: "10px 14px", borderRadius: 8, display: "flex", alignItems: "center", gap: 10,
                          background: withAlpha(accent, 0.06), border: `1px solid ${withAlpha(accent, 0.2)}`,
                        }}>
                          <Icon name="external" size={15} style={{ color: accent, flexShrink: 0 }} />
                          <span style={{ fontSize: FONT_SIZES.small, color: P.ink, fontWeight: 500 }}>Attached: {m.attachmentTitle}</span>
                        </div>
                      )}
                    </div>
                    {/* Commit 48: per-message report — someone else's message
                        only (m.id is always set for a real row; the || i
                        fallback key above never has one), faded in on hover
                        rather than a permanent extra icon on every bubble. */}
                    {!m.mine && m.id && (
                      <button
                        onClick={() => setReportModal({ kind: "message", messageId: m.id })}
                        aria-label="Report this message" title="Report this message"
                        style={{
                          opacity: hoverMsgId === key ? 1 : 0, transition: "opacity 0.15s ease",
                          background: "none", border: "none", color: P.faint, cursor: "pointer", padding: 4, flexShrink: 0,
                        }}
                      >
                        <Icon name="flag" size={13} />
                      </button>
                    )}
                  </div>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 6, marginTop: 4,
                    justifyContent: m.mine ? "flex-end" : "flex-start",
                    fontSize: FONT_SIZES.micro, color: P.faint,
                  }}>
                    {/* A message with no time on it is a message you can't
                        place in a conversation. */}
                    {timeLabel && <span style={{ fontFamily: "var(--cb-mono)" }}>{timeLabel}</span>}
                    {m.mine && m.id && lastMineMessage?.id === m.id && (
                      <span>· {seenLastMine ? "Seen" : "Delivered"}</span>
                    )}
                  </div>
                </div>
                </React.Fragment>
                );
              })}
            </div>
            <div style={{ padding: "14px 24px 18px", borderTop: `1px solid ${P.line}` }}>
              {activeThread.blocked ? (
                <div style={{ textAlign: "center", fontSize: FONT_SIZES.caption, color: P.faint, padding: "8px 0" }}>
                  You've blocked {activeThread.name} — unblock above to send a message.
                </div>
              ) : (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input ref={imageInputRef} type="file" accept="image/*" onChange={handleImagePick} style={{ display: "none" }} aria-hidden="true" />
                  {/* While recording, the composer becomes the recorder —
                      one obvious thing to look at and one obvious way out,
                      rather than a record button competing with a text field
                      nobody is going to use mid-sentence. */}
                  {recording ? (
                    <div style={{
                      flex: 1, display: "flex", alignItems: "center", gap: 10, padding: "9px 16px", borderRadius: 100,
                      background: withAlpha(STATUS.bad, 0.1), border: `1px solid ${withAlpha(STATUS.bad, 0.35)}`,
                    }}>
                      <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: "50%", background: STATUS.bad, animation: "cbMicPulse 1.4s ease-in-out infinite" }} />
                      <span style={{ fontSize: FONT_SIZES.small, color: P.ink, fontWeight: 600 }}>Recording</span>
                      <span style={{ fontSize: FONT_SIZES.small, color: P.ink2, fontFamily: "var(--cb-mono)" }}>
                        {String(Math.floor(recSeconds / 60)).padStart(2, "0")}:{String(recSeconds % 60).padStart(2, "0")}
                      </span>
                      <span style={{ marginLeft: "auto", fontSize: FONT_SIZES.caption, color: P.faint }}>Max 90s</span>
                    </div>
                  ) : (<>
                  <button
                    onClick={() => imageInputRef.current?.click()}
                    disabled={attachBusy || sending}
                    aria-label="Attach an image" title="Attach an image"
                    style={{ width: 38, height: 38, borderRadius: "50%", flexShrink: 0, background: "transparent", border: `1px solid ${P.line}`, color: P.ink2, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                  ><Icon name={attachBusy ? "refresh" : "image"} size={16} className={attachBusy ? "cb-spin" : undefined} /></button>
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={`Message ${activeThread.name}…`}
                    aria-label="Reply"
                    disabled={sending}
                    style={{ flex: 1, padding: "10px 14px", borderRadius: 100, border: `1px solid ${P.line}`, background: P.dark ? "rgba(255,255,255,0.03)" : "#fff", color: P.ink, fontFamily: "var(--cb-body)", fontSize: FONT_SIZES.small }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); sendMessage(); } }}
                  />
                  </>)}
                  {/* Record / stop. Recording is the one action here that
                      benefits from being a toggle rather than press-and-hold:
                      a research note is often 30-60 seconds, and holding a
                      button that long while thinking is genuinely awkward. */}
                  <button
                    onClick={() => (recording ? stopRecording() : startRecording())}
                    disabled={attachBusy || sending}
                    aria-label={recording ? "Send voice note" : "Record a voice note"}
                    title={recording ? "Stop and send" : "Record a voice note"}
                    style={{
                      width: 40, height: 40, borderRadius: "50%", flexShrink: 0, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: recording ? STATUS.bad : "transparent",
                      border: recording ? "none" : `1px solid ${P.line}`,
                      color: recording ? "#fff" : P.ink2,
                    }}
                  ><Icon name={recording ? "send" : "mic"} size={16} /></button>
                  {!recording && <button onClick={() => sendMessage()} disabled={!draft.trim() || sending} aria-label="Send" style={{ width: 40, height: 40, borderRadius: "50%", background: accent, color: at, border: "none", cursor: draft.trim() && !sending ? "pointer" : "default", opacity: draft.trim() && !sending ? 1 : 0.5, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Icon name="send" size={16} />
                  </button>}
                </div>
              )}
            </div>
          </>) : (
            /* Commit 100 — this pane is the largest single area on the
               Inbox and it held one grey sentence, centred, with nothing
               else. "Nothing here yet." in the middle of a 900px column is
               indistinguishable from a page that failed to load. */
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 32, gap: 10 }}>
              {loadingThread ? (
                <div style={{ color: P.faint, fontSize: FONT_SIZES.small }}>Loading…</div>
              ) : threads.length === 0 ? (
                <>
                  <div style={{
                    width: 46, height: 46, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                    background: withAlpha(accent, 0.1), color: accent, marginBottom: 2,
                  }}><Icon name="mail" size={20} /></div>
                  <div style={{ fontSize: FONT_SIZES.subhead, fontWeight: 700, color: P.ink, fontFamily: "var(--cb-display)", letterSpacing: "-0.01em" }}>Your conversations live here</div>
                  <div style={{ fontSize: FONT_SIZES.small, color: P.faint, lineHeight: 1.65, maxWidth: 380 }}>
                    Messages, shared papers, and calls with other researchers. Nothing you say here is used to train anything or shown on your profile.
                  </div>
                  <button onClick={onCompose} className="cb-press" style={{
                    marginTop: 8, padding: "9px 20px", borderRadius: RADIUS.pill, cursor: "pointer",
                    background: accent, color: at, border: "none",
                    fontSize: FONT_SIZES.caption, fontFamily: "var(--cb-body)", fontWeight: 700,
                  }}>Find someone to message</button>
                </>
              ) : (
                <div style={{ color: P.faint, fontSize: FONT_SIZES.small }}>Pick a conversation on the left.</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
    {/* Full-screen image view. A figure shared in a conversation has to be
        inspectable at full size — a 340px-tall thumbnail is a notification
        that an image exists, not the image. */}
    {lightbox && (
      <div
        role="dialog" aria-modal="true" aria-label="Attached image"
        onClick={() => setLightbox(null)}
        style={{ position: "fixed", inset: 0, zIndex: 260, background: "rgba(0,0,0,0.9)", display: "flex", alignItems: "center", justifyContent: "center", padding: 28, cursor: "zoom-out" }}
        className="cb-backdrop"
      >
        <img src={lightbox} alt="Attached" style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 12, objectFit: "contain" }} />
      </div>
    )}
    {reportModal && activeThread && (
      <ReportConductModal
        P={P} accent={accent} at={at}
        kind={reportModal.kind}
        targetLabel={activeThread.name}
        threadId={activeId}
        reportedUserId={activeThread.otherId}
        messageId={reportModal.messageId}
        onClose={() => setReportModal(null)}
      />
    )}
    </>
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
/* Commit 74 — badges.

   `verified` is a blue check and it means one specific, checkable thing:
   the server matched this account's email against FOUNDER_EMAIL, an
   environment variable only the operator can set. It is not for sale, it
   cannot be requested, and no client-side value can produce it. A check
   mark that anyone can obtain is decoration; this one is a fact.

   `founder` is the same grant, said in words rather than a glyph. */
/* ═══════════════════════════════════════════════════════════════════════
   Commit 84 — THE PRIMITIVE LAYER.

   The honest diagnosis of why this app kept "feeling AI-coded" no matter
   how many times its surfaces were polished: there were no shared
   components. Thirteen thousand lines, inline styles on nearly every
   element, and no <Button>, no <Card>, no <Label>. So every surface
   invented its own padding, its own radius, its own hover, its own type
   scale — and every polish pass was a manual sweep that the next feature
   silently undid.

   That is not a metaphor for machine-written code. It is literally its
   signature: locally correct everywhere, globally inconsistent.

   These five primitives are where the design system now lives. They are
   deliberately small and unclever — no variant explosion, no styled-
   components, no theme provider. Each takes the palette it is handed and
   returns one well-made thing. New surfaces should reach for these first;
   a one-off inline style is now a decision to justify, not the default.
   ═══════════════════════════════════════════════════════════════════════ */

/* Type scale — one place, four steps, so a heading is never "18px because
   that looked right here". */
const TYPE = {
  display: { fontFamily: "var(--cb-display)", fontWeight: 700, letterSpacing: "-0.025em", lineHeight: 1.15 },
  heading: { fontFamily: "var(--cb-display)", fontWeight: 700, letterSpacing: "-0.015em", lineHeight: 1.25 },
  body:    { fontFamily: "var(--cb-body)", fontWeight: 400, letterSpacing: "0", lineHeight: 1.6 },
  label:   { fontFamily: "var(--cb-body)", fontWeight: 600, letterSpacing: "0.01em", lineHeight: 1.35 },
  mono:    { fontFamily: "var(--cb-mono)", fontWeight: 500, letterSpacing: "0.01em", lineHeight: 1.4 },
};

/* Spacing — a 4px scale. Referenced by name so "a bit more room" is a
   step, not a new number nobody else knows about. */
const SP = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

/* ── Button ──────────────────────────────────────────────────────────
   Three kinds, one shape language, press feedback for free. Everything
   in the app that is a button should be this. */
function UIButton({
  children, onClick, variant = "secondary", size = "md",
  P, accent, at, icon, disabled, title, ariaLabel, full, type = "button", style,
}) {
  const pad = size === "sm" ? "6px 13px" : size === "lg" ? "12px 22px" : "9px 17px";
  const fs = size === "sm" ? FONT_SIZES.caption : FONT_SIZES.small;
  const skins = {
    primary:     { background: accent, color: at, border: "1px solid transparent" },
    secondary:   { background: "transparent", color: P.ink, border: `1px solid ${P.line2}` },
    ghost:       { background: "transparent", color: P.ink2, border: "1px solid transparent" },
    destructive: { background: "transparent", color: STATUS.bad, border: `1px solid ${withAlpha(STATUS.bad, 0.35)}` },
  };
  return (
    <button
      type={type} onClick={onClick} disabled={disabled} title={title} aria-label={ariaLabel}
      className="cb-press"
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: SP.sm,
        padding: pad, borderRadius: RADIUS.pill, cursor: disabled ? "not-allowed" : "pointer",
        fontSize: fs, ...TYPE.label, fontWeight: 700,
        width: full ? "100%" : undefined,
        opacity: disabled ? 0.5 : 1,
        ...skins[variant],
        ...style,
      }}
    >
      {icon && <Icon name={icon} size={size === "sm" ? 13 : 15} />}
      {children}
    </button>
  );
}

/* ── Card ────────────────────────────────────────────────────────────
   The surface everything sits on. `pad={false}` for media that must go
   edge to edge. */
function UICard({ children, P, pad = true, className = "", style, onClick }) {
  return (
    <div
      onClick={onClick}
      className={"cb-card " + className}
      style={{
        borderRadius: RADIUS.md,
        background: P.dark ? "rgba(255,255,255,0.028)" : "rgba(0,0,0,0.018)",
        border: `1px solid ${P.line}`,
        padding: pad ? `${SP.lg}px ${SP.lg + 3}px ${SP.lg - 1}px` : 0,
        overflow: "hidden", minWidth: 0,
        cursor: onClick ? "pointer" : undefined,
        ...style,
      }}
    >{children}</div>
  );
}

/* ── Label ───────────────────────────────────────────────────────────
   The section marker. Sentence case, body face, one accent dot — the
   pattern that replaced five different shouted uppercase-mono eyebrows.
   There is exactly one of these now, so it can never drift again. */
function UILabel({ children, P, accent, right, style }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: SP.sm, marginBottom: SP.md,
      fontSize: FONT_SIZES.micro, ...TYPE.label, color: P.faint, ...style,
    }}>
      <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: "50%", background: accent, flexShrink: 0 }} />
      <span>{children}</span>
      {right && <span style={{ marginLeft: "auto" }}>{right}</span>}
    </div>
  );
}

/* ── Row ─────────────────────────────────────────────────────────────
   A line item in a list: label, optional description, optional control.
   Inbox threads, settings rows, saved papers and watched topics were all
   hand-built versions of this with slightly different padding. */
function UIRow({ label, desc, control, onClick, P, accent, last, tone, style }) {
  return (
    <div
      onClick={onClick}
      className={onClick ? "cb-row" : undefined}
      style={{
        display: "flex", alignItems: "center", gap: SP.md,
        padding: `${SP.md}px ${SP.lg}px ${SP.md}px ${SP.lg - 2}px`,
        borderBottom: last ? "none" : `1px solid ${P.line}`,
        cursor: onClick ? "pointer" : "default", minWidth: 0, ...style,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: FONT_SIZES.body, ...TYPE.label, fontWeight: 500, color: tone === "bad" ? STATUS.bad : P.ink }}>{label}</div>
        {desc && <div style={{ fontSize: FONT_SIZES.small, color: P.faint, lineHeight: 1.45, marginTop: 2 }}>{desc}</div>}
      </div>
      {control && <div style={{ flexShrink: 0 }}>{control}</div>}
    </div>
  );
}

/* ── Field ───────────────────────────────────────────────────────────
   Text input and textarea, one look. Every form in the app had its own. */
function UIField({ value, onChange, placeholder, P, accent, multiline, rows = 3, ariaLabel, maxLength, style, onKeyDown }) {
  const base = {
    width: "100%", padding: `${SP.md - 2}px ${SP.md}px`, borderRadius: RADIUS.sm,
    background: P.dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
    border: `1px solid ${P.line}`, color: P.ink, outline: "none",
    fontSize: FONT_SIZES.small, ...TYPE.body, minWidth: 0, ...style,
  };
  const common = { value, onChange, placeholder, "aria-label": ariaLabel || placeholder, maxLength, onKeyDown, style: base };
  return multiline
    ? <textarea rows={rows} {...common} style={{ ...base, resize: "vertical" }} />
    : <input {...common} />;
}

/* Commit 77 — the radius scale.
   ---------------------------------------------------------------------
   An audit of this file found TWELVE different corner radii in use: 3
   (120 times), 100 (56), 8, 14, 2, 16, 12, 10, 4, 6, 18 and 0. That is
   not a style, it is the absence of one, and it is the loudest reason the
   interface reads as assembled rather than designed — a 3px modal corner
   next to a fully-round pill next to a 14px card tells the eye that
   nobody decided.

   Four tokens now, and every value in the file was normalized onto them:

     SM  8   chips, inputs, small controls, thumbnails      (was 2,3,4,6,8)
     MD  12  cards, panels, popovers, media blocks          (was 10,12,14)
     LG  16  modals, sheets, the largest surfaces           (was 16,18)
     PILL 100 buttons, tags, avatars, anything capsule      (unchanged)

   Use these when adding anything new. A fifth value is a decision to
   defend, not a default. */
const RADIUS = { sm: 8, md: 12, lg: 16, pill: 100 };

const BADGE_DISPLAY = {
  founder: { label: "Founder & Owner", icon: "sparkle", tint: "#c9a227" },
  verified: { label: "Verified", icon: "check", tint: "#2f7fe6" },
  early_adopter: { label: "Early adopter", icon: "zap", tint: "#b45309" },
};
// Sort order for a profile's badge row: identity first, achievements after.
const BADGE_ORDER = ["founder", "verified", "early_adopter"];

/* The blue check. Its own component because it appears inline next to a
   name in five different places, and a check that renders slightly
   differently in each of them reads as a sticker rather than a system
   mark. */
/* Commit 75 — profile covers.
   Eight named designs rather than free input, because a cover renders on a
   public page and a value the client can compose is a value the client can
   abuse. Each is a real composition — two or three layered gradients with
   different angles and stops — not one hue rotated eight times, which is
   what "customization" usually means and why it always feels cheap. The
   server validates the name against the same list (ALLOWED_COVERS). */
const PROFILE_COVERS = {
  aurora: { label: "Aurora", css: "radial-gradient(ellipse 90% 130% at 12% 8%, #1d7a63 0%, transparent 55%), radial-gradient(ellipse 80% 120% at 88% 20%, #2b4c8c 0%, transparent 55%), linear-gradient(160deg, #0b1418 0%, #101b22 100%)" },
  graphite: { label: "Graphite", css: "linear-gradient(135deg, #23282d 0%, #14171a 45%, #0d0f11 100%), radial-gradient(ellipse 70% 100% at 78% 10%, rgba(255,255,255,0.08), transparent 60%)" },
  ember: { label: "Ember", css: "radial-gradient(ellipse 90% 120% at 15% 10%, #8a3b12 0%, transparent 55%), radial-gradient(ellipse 70% 110% at 85% 30%, #b8621f 0%, transparent 50%), linear-gradient(155deg, #180d08 0%, #1e1310 100%)" },
  abyss: { label: "Abyss", css: "radial-gradient(ellipse 100% 130% at 20% 0%, #12324f 0%, transparent 60%), radial-gradient(ellipse 80% 100% at 90% 60%, #1b5566 0%, transparent 55%), linear-gradient(170deg, #060d14 0%, #0a141c 100%)" },
  moss: { label: "Moss", css: "radial-gradient(ellipse 95% 120% at 10% 15%, #2f5a34 0%, transparent 55%), radial-gradient(ellipse 75% 110% at 80% 75%, #4a7a42 0%, transparent 50%), linear-gradient(150deg, #0c130d 0%, #121a13 100%)" },
  violet: { label: "Violet", css: "radial-gradient(ellipse 90% 130% at 18% 5%, #4a2a7a 0%, transparent 55%), radial-gradient(ellipse 80% 100% at 85% 45%, #7a3f8f 0%, transparent 50%), linear-gradient(160deg, #0f0a16 0%, #16101f 100%)" },
  sandstone: { label: "Sandstone", css: "radial-gradient(ellipse 90% 120% at 12% 12%, #8a7038 0%, transparent 55%), radial-gradient(ellipse 70% 100% at 82% 70%, #a8894a 0%, transparent 50%), linear-gradient(155deg, #15120b 0%, #1b1710 100%)" },
  signal: { label: "Signal", css: "repeating-linear-gradient(115deg, rgba(255,255,255,0.045) 0 2px, transparent 2px 9px), radial-gradient(ellipse 90% 130% at 25% 0%, #1a4f4a 0%, transparent 60%), linear-gradient(165deg, #08100f 0%, #0d1614 100%)" },
};
const COVER_KEYS = Object.keys(PROFILE_COVERS);

function VerifiedCheck({ size = 15, title = "Verified: the owner of Cerebrum" }) {
  return (
    <span title={title} aria-label={title} role="img" style={{ display: "inline-flex", flexShrink: 0, verticalAlign: "middle" }}>
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#2f7fe6" d="M12 1.6l2.6 2.05 3.3-.2.55 3.27 2.85 1.68-1.3 3.05 1.3 3.05-2.85 1.68-.55 3.27-3.3-.2L12 22.4l-2.6-2.05-3.3.2-.55-3.27L2.7 15.6 4 12.55 2.7 9.5l2.85-1.68.55-3.27 3.3.2z" />
        <path fill="#fff" d="M10.9 15.4l-3-3 1.2-1.2 1.8 1.8 4.1-4.1 1.2 1.2z" />
      </svg>
    </span>
  );
}

/* The founder's avatar frame. A rotating conic ring rather than a static
   border: it is the one place in the app where a little ceremony is the
   point, and it makes the account visually unmistakable in a list without
   inventing a number to do it. */
function FounderFrame({ size = 96, children, accent }) {
  return (
    <span className="cb-founder-frame" style={{
      position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: size + 10, height: size + 10, borderRadius: "50%", flexShrink: 0,
    }}>
      <span aria-hidden="true" className="cb-founder-ring" style={{
        position: "absolute", inset: 0, borderRadius: "50%",
        background: "conic-gradient(from 0deg, #c9a227, #f4e2a1, #2f7fe6, #c9a227)",
      }} />
      <span aria-hidden="true" style={{
        position: "absolute", inset: 3, borderRadius: "50%",
        background: "var(--cb-bg, #0b0d0e)",
      }} />
      <span style={{ position: "relative", display: "inline-flex" }}>{children}</span>
    </span>
  );
}

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
  "Hebrew University of Jerusalem", "Technion: Israel Institute of Technology",
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
/* Commit 87 — one empty state, designed.

   The profile used to show three different "nothing here" strings at once,
   each a bare grey sentence inside its own card. An empty state is the
   screen a new account sees FIRST, so it is worth more than a grey
   sentence: an icon, a plain title, and one line explaining what will fill
   this space and how. Same component for every tab, so they agree. */
function ProfileEmpty({ P, accent, icon, title, body }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center",
      padding: "44px 24px", borderRadius: RADIUS.lg,
      border: `1px dashed ${P.line2}`,
      background: P.dark ? "rgba(255,255,255,0.018)" : "rgba(0,0,0,0.012)",
    }}>
      <span aria-hidden="true" style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 44, height: 44, borderRadius: RADIUS.md, marginBottom: 14,
        color: accent, background: withAlpha(accent, 0.1),
        border: `1px solid ${withAlpha(accent, 0.22)}`,
      }}><Icon name={icon} size={19} /></span>
      <div style={{ fontSize: FONT_SIZES.subhead, fontWeight: 700, color: P.ink, fontFamily: "var(--cb-display)", letterSpacing: "-0.01em" }}>{title}</div>
      <div style={{ fontSize: FONT_SIZES.small, color: P.faint, lineHeight: 1.6, marginTop: 7, maxWidth: 380, fontFamily: "var(--cb-body)" }}>{body}</div>
    </div>
  );
}

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
  // Commit 97 — avatarFailed removed: declared, never set, never read.
  const fileInputRef = useRef(null);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  // Commit 54 — a profile is a thing you LOOK at; editing it is a mode you
  // enter. Every field on this page used to be a permanently-open form
  // control, so the page you landed on to see who someone is was really a
  // settings screen wearing a cover photo: three empty input boxes with
  // placeholder text where a name, a degree and an institution should be.
  // That is the whole of "it looks basic and bare" — there was nothing to
  // read, only blanks to fill. Display by default, edit on request.
  const [editing, setEditing] = useState(false);
  const [profileTab, setProfileTab] = useState("investigations");
  const [tabScrollRef, tabMask] = useEdgeMask();

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
    if (file.size > 8 * 1024 * 1024) { setAvatarError("That photo is too large: try one under 8MB."); return; }
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
  // Commit 74 — identity badges first, then achievements, then the plain
  // "you are signed in" note last. It was leading with "Verified sign-in",
  // which is the least interesting true thing about anybody.
  const rawBadges = profileMeta?.badges || [];
  const isFounder = rawBadges.includes("founder");
  const isVerified = rawBadges.includes("verified");
  const badges = [
    ...BADGE_ORDER.filter((k) => rawBadges.includes(k)).map((k) => BADGE_DISPLAY[k]),
    ...rawBadges.filter((k) => !BADGE_ORDER.includes(k)).map((k) => BADGE_DISPLAY[k]).filter(Boolean),
    { label: "Verified sign-in", icon: "check", real: true },
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
  const cardStyle = { background: P.raised, border: `1px solid ${P.line}`, borderRadius: 12, padding: 18 };
  // Commit 75 — was uppercase mono at wide tracking on every panel header
  // (ACCOLADES, AFFILIATIONS, RECENT INVESTIGATIONS, SAVED COLLECTIONS),
  // the same shouted-eyebrow pattern Commit 71 removed from the home deck
  // and never came back for here. Sentence case in the body face.
  const cardLabel = { fontSize: FONT_SIZES.caption, fontWeight: 600, letterSpacing: "0.01em", color: P.faint, fontFamily: "var(--cb-body)", marginBottom: 12 };
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
        // Commit 87 — 230px of empty banner pushed the name, the stats and
        // the tabs so far down that a 1000px-tall window showed the header
        // and almost none of the work. A cover is a band of colour behind a
        // name, not a hero image; 168px is enough to read as one and leaves
        // the first tab's content above the fold.
        height: isMobile ? 128 : 168, width: "100%",
        // Commit 75 — the chosen cover, or the accent wash for anyone who
        // hasn't picked one yet.
        background: PROFILE_COVERS[profile.cover]
          ? PROFILE_COVERS[profile.cover].css
          : `linear-gradient(135deg, ${withAlpha(accent, 0.5)} 0%, ${P.raised} 60%, ${P.surface} 100%)`,
        position: "relative", overflow: "hidden",
      }}>
        {!PROFILE_COVERS[profile.cover] && (
        <div style={{ position: "absolute", inset: 0, opacity: 0.6, backgroundImage: `radial-gradient(circle at 15% 25%, ${withAlpha(accent, 0.45)}, transparent 45%), radial-gradient(circle at 85% 75%, ${withAlpha(accent, 0.3)}, transparent 42%)` }} />
        )}
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
        {/* Commit 75 — align to the TOP, not the bottom.
            flex-end worked while the identity column was three short lines.
            Adding a bio and a link row made it taller, so bottom-aligning
            pushed the avatar down the card while the name floated up out of
            the panel entirely — the two halves stopped looking like one
            block. Top alignment keeps the avatar and the name on the same
            line however long the bio gets. */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 20, marginTop: isMobile ? -46 : -64, marginBottom: 24 }}>
          <div className={isFounder ? "cb-founder-avatar" : undefined} style={{ position: "relative", width: isMobile ? 92 : 120, height: isMobile ? 92 : 120, flexShrink: 0 }}>
            {/* Commit 54: the fallback is now the DEFAULT, not the error
                path. This used to request a generated avatar from an
                external service (api.dicebear.com) on every profile view,
                which meant the most personal element on the page depended
                on a third party being reachable — and when it wasn't, the
                page rendered an empty ring (confirmed on screen). A
                locally-drawn initial always renders, costs no request, and
                leaks no one's profile view to another host. A real uploaded
                photo still wins over both. */}
            {!profile.avatar_base64 ? (
              <div style={{
                width: "100%", height: "100%", borderRadius: "50%",
                ...avatarSkin(displayName || user?.id), display: "flex", alignItems: "center", justifyContent: "center",
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
                /* Commit 100 — this branch only runs when avatar_base64 is
                   set, so the dicebear URL after the `||` was unreachable
                   dead code that still read like a live third-party call.
                   Removed: no avatar in this app is ever fetched from
                   another host. */
                src={profile.avatar_base64}
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
            {/* ══════════════════════════════════════════════════════
                Commit 87 — the profile said the same thing five times.

                Counted on the founder account: a gold "Founder & Owner of
                Cerebrum" banner above the name; a blue verified check
                beside the name; a green "Founder & Owner" pill on the
                handle line; a gold "Founder & Owner" pill in an Accolades
                card below; and a "Verified" pill next to it. One fact —
                this person runs Cerebrum and the server confirmed it —
                announced five times inside four hundred pixels.

                Repetition does not make a credential more credible; past
                about the second time it makes the page look like it is
                trying to convince you. Every real social product states
                identity ONCE and moves on. So: the check stays beside the
                name (that is where a reader looks for it), one role chip
                sits on the handle line, and the banner and the Accolades
                card are gone. Anything genuinely additional — early
                adopter, say — still shows on the About tab.
                ══════════════════════════════════════════════════════ */}
            {!editing ? (
              <div style={{
                fontSize: isMobile ? FONT_SIZES.heading : FONT_SIZES.display, fontWeight: 700,
                color: P.ink, fontFamily: "var(--cb-display)", letterSpacing: "-0.02em", lineHeight: 1.1,
                display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
              }}>
                {displayName}
                {isVerified && <VerifiedCheck size={isMobile ? 20 : 26} />}
              </div>
            ) : (
            <input
              value={profile.name || ""}
              onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))}
              placeholder={displayName}
              aria-label="Your name"
              style={{ display: "block", width: "100%", background: "transparent", border: "none", padding: 0, fontSize: isMobile ? FONT_SIZES.heading : FONT_SIZES.display, fontWeight: 700, color: P.ink, fontFamily: "var(--cb-display)", letterSpacing: "-0.01em" }}
            />
            )}
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 6, fontSize: FONT_SIZES.small, color: P.ink2, fontFamily: "var(--cb-mono)" }}>
              <span>{displayUsername}</span>
              {badges.length > 0 && (<>
                <span style={{ opacity: 0.4 }}>·</span>
                {/* Accolades were buried in a card below the fold. On every
                    social profile the verification mark sits next to the
                    handle, because that is where it does its job. */}
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "2px 9px", borderRadius: 100, color: accent,
                  background: withAlpha(accent, 0.12), border: `1px solid ${withAlpha(accent, 0.3)}`,
                  fontSize: FONT_SIZES.caption, fontWeight: 700,
                }}><Icon name="check" size={11} /> {badges[0].label || "Verified"}</span>
              </>)}
            </div>

            {/* The identity line a reader actually wants: who you are
                academically, as prose rather than three empty inputs. Parts
                that aren't filled in are simply absent — an empty profile
                shows one honest prompt instead of a row of blank boxes. */}
            {!editing && (
              (profile.degree || profile.affiliation || profile.grad_year) ? (
                <div style={{ marginTop: 10, fontSize: FONT_SIZES.small, color: P.ink2, lineHeight: 1.6 }}>
                  {[profile.degree, profile.affiliation, profile.grad_year].filter(Boolean).join(" · ")}
                </div>
              ) : (
                /* Commit 87 — this prompt sat at the same size and in the
                   same flow position as the bio directly beneath it, so a
                   profile opened with two full paragraphs where only one
                   was written by the person. A prompt addressed to the
                   owner is not profile content: it is smaller, quieter,
                   and marked as a suggestion. */
                <div style={{
                  marginTop: 10, fontSize: FONT_SIZES.caption, color: P.faint,
                  lineHeight: 1.5, display: "inline-flex", alignItems: "center", gap: 7,
                  // RADIUS.md rather than pill: at 390px this wraps to two
                  // lines, and a stadium shape around two lines of text is
                  // the shape of a mistake.
                  padding: "7px 12px", borderRadius: RADIUS.md,
                  border: `1px dashed ${P.line2}`, fontFamily: "var(--cb-body)",
                }}>
                  <Icon name="sparkle" size={12} />
                  Add your degree and institution so people know who they're reading
                </div>
              )
            )}

            {/* Commit 75 — bio and links.
                A profile with a name, an avatar and an institution is an
                account record. A sentence in your own words and a link to
                your actual work is a profile — and for researchers, ORCID
                and Scholar are the two links that matter most. */}
            {!editing && profile.bio && (
              <p style={{ fontSize: FONT_SIZES.small, color: P.ink2, lineHeight: 1.6, margin: "12px 0 0", maxWidth: 620, whiteSpace: "pre-wrap" }}>{profile.bio}</p>
            )}
            {!editing && (profile.link_site || profile.link_orcid || profile.link_scholar) && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                {[["link", "Website", profile.link_site], ["sparkle", "ORCID", profile.link_orcid], ["history", "Scholar", profile.link_scholar]]
                  .filter(([, , href]) => !!href)
                  .map(([icon, label, href]) => (
                    <a key={label} href={safeHref(href)} target="_blank" rel="noopener noreferrer nofollow" className="cb-press" style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      padding: "5px 13px", borderRadius: 100, textDecoration: "none",
                      border: `1px solid ${P.line2}`, color: P.ink2,
                      fontSize: FONT_SIZES.caption, fontWeight: 600,
                    }}><Icon name={icon} size={13} /> {label}</a>
                  ))}
              </div>
            )}
            {editing && (
              <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12, maxWidth: 620 }}>
                <div>
                  <div style={{ ...cardLabel, marginBottom: 6 }}>About you</div>
                  <textarea
                    value={profile.bio || ""}
                    onChange={(e) => setProfile((p2) => ({ ...p2, bio: e.target.value.slice(0, 400) }))}
                    placeholder="What do you work on? One or two sentences is plenty."
                    rows={3}
                    style={{
                      width: "100%", resize: "vertical", padding: "10px 12px", borderRadius: 12,
                      background: P.dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
                      border: `1px solid ${P.line}`, color: P.ink, outline: "none",
                      fontSize: FONT_SIZES.small, fontFamily: "var(--cb-body)", lineHeight: 1.6,
                    }}
                  />
                  <div style={{ fontSize: FONT_SIZES.micro, color: P.faint, fontFamily: "var(--cb-mono)", marginTop: 4 }}>
                    {(profile.bio || "").length}/400
                  </div>
                </div>
                <div style={{ display: "grid", gap: 8, gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr" }}>
                  {[["link_site", "Website"], ["link_orcid", "ORCID profile"], ["link_scholar", "Google Scholar"]].map(([field, label]) => (
                    <input key={field}
                      value={profile[field] || ""}
                      onChange={(e) => setProfile((p2) => ({ ...p2, [field]: e.target.value }))}
                      placeholder={label}
                      aria-label={label}
                      style={{
                        padding: "9px 12px", borderRadius: 12, minWidth: 0,
                        background: P.dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
                        border: `1px solid ${P.line}`, color: P.ink, outline: "none",
                        fontSize: FONT_SIZES.small, fontFamily: "var(--cb-body)",
                      }}
                    />
                  ))}
                </div>
                <div>
                  <div style={{ ...cardLabel, marginBottom: 8 }}>Cover</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {COVER_KEYS.map((k) => (
                      <button key={k} type="button"
                        onClick={() => setProfile((p2) => ({ ...p2, cover: p2.cover === k ? "" : k }))}
                        title={PROFILE_COVERS[k].label}
                        aria-label={PROFILE_COVERS[k].label}
                        aria-pressed={profile.cover === k}
                        style={{
                          width: 64, height: 40, borderRadius: 8, cursor: "pointer", padding: 0,
                          background: PROFILE_COVERS[k].css,
                          border: profile.cover === k ? `2px solid ${accent}` : `1px solid ${P.line2}`,
                          boxShadow: profile.cover === k ? `0 0 0 3px ${withAlpha(accent, 0.25)}` : "none",
                          transition: "box-shadow 0.2s ease, border-color 0.2s ease",
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Stats bar. A social profile leads with its numbers; this page
                previously mentioned a follower count mid-sentence in a
                metadata line and showed nothing else countable at all. */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: isMobile ? 20 : 34, marginTop: 16 }}>
              {/* Commit 87 — a stat that reads 0 is an accusation, not a
                  number. "0 Collections / 0 Followers" set in the same
                  weight as real counts made every new profile open with
                  two zeros, which is the single most discouraging thing a
                  profile can show its owner. Investigations and Saved
                  always render because they are the work; the social
                  counts appear once there is something to count. */}
              {[
                ["Investigations", history.length, true],
                ["Saved", saved.length, true],
                ["Collections", collections.length, false],
                ["Followers", followers, false],
              ].filter(([, value, always]) => always || value > 0).map(([label, value]) => (
                <div key={label}>
                  <div style={{ fontSize: FONT_SIZES.subhead, fontWeight: 700, color: P.ink, fontFamily: "var(--cb-display)", lineHeight: 1.1 }}>{value}</div>
                  <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, fontFamily: "var(--cb-body)", letterSpacing: "0.01em", fontWeight: 500, marginTop: 3 }}>{label}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 18 }}>
              <button
                onClick={() => setEditing((v) => !v)}
                style={{
                  padding: "9px 20px", borderRadius: 100, cursor: "pointer",
                  fontSize: FONT_SIZES.small, fontWeight: 600, fontFamily: "var(--cb-body)",
                  background: editing ? accent : "transparent", color: editing ? at : P.ink,
                  border: editing ? "none" : `1px solid ${P.line2}`,
                }}
              >{editing ? "Done editing" : "Edit profile"}</button>
              <button
                onClick={onManageAccount}
                style={{
                  padding: "9px 20px", borderRadius: 100, cursor: "pointer",
                  fontSize: FONT_SIZES.small, fontWeight: 600, fontFamily: "var(--cb-body)",
                  background: "transparent", color: P.ink2, border: `1px solid ${P.line2}`,
                }}
              >Account &amp; security</button>
            </div>
            {editing && (<div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
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
            </div>)}
          </div>

          {/* Commit 100 — the institution crest is gone. It was an initials
              badge fetched from api.dicebear.com with the institution name
              in the query string, so viewing any profile told a third party
              which university that person had written down. It also gave
              affiliation the visual weight of a logo, which is the wrong
              signal now that an institution is not an entity on Cerebrum —
              it does not have a page, a roster, or anything to click. It is
              a line of text on a person's profile, and only if they left it
              visible. */}
        </div>

        {avatarError && <div role="alert" style={{ fontSize: FONT_SIZES.caption, color: "#e05555", marginBottom: 16 }}>{avatarError}</div>}

        {editing && (<div style={{ position: "relative", marginBottom: 24 }}>
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
        </div>)}

        {/* ══════════════════════════════════════════════════════════
            Commit 87 — tabs, because this is a profile.

            The body was a two-column stack of loose cards: Affiliations
            (three lines) on the left, Recent Investigations and Saved
            Collections on the right. The columns had nothing to do with
            each other, they ended at wildly different heights, and the
            short one left a ~250px hole at the bottom-left of the page.
            Worse, three of the five panels on a new account were empty
            states, so the first thing a profile told its owner was three
            different versions of "there is nothing here."

            A profile in every product this one is trying to stand beside
            is a header and a set of tabs. That is not decoration: tabs
            mean exactly one section is on screen, so the page cannot be
            ragged and an empty section costs one empty state instead of
            three simultaneously. `profileTab` state already existed in
            this component and was never rendered — it has been sitting
            unused since the day it was added.
            ══════════════════════════════════════════════════════════ */}
        <div ref={tabScrollRef} role="tablist" aria-label="Profile sections" className="cb-scroll-x" style={{
          display: "flex", gap: 4, marginBottom: 18, overflowX: "auto",
          borderBottom: `1px solid ${P.line}`, WebkitOverflowScrolling: "touch",
          // Four tabs do not fit 390px; without the fade the row looks like
          // it ends at "Collection" and About is never found.
          ...(isMobile ? tabMask : null),
        }}>
          {[
            ["investigations", "Investigations", history.length],
            ["saved", "Saved", saved.length],
            ["collections", "Collections", collections.length],
            ["about", "About", null],
          ].map(([key, label, count]) => {
            const on = profileTab === key;
            return (
              <button
                key={key} role="tab" aria-selected={on}
                onClick={() => setProfileTab(key)}
                style={{
                  position: "relative", flexShrink: 0, whiteSpace: "nowrap",
                  padding: "10px 16px", border: "none", background: "transparent",
                  cursor: "pointer", fontFamily: "var(--cb-body)",
                  fontSize: FONT_SIZES.small, fontWeight: on ? 700 : 500,
                  color: on ? P.ink : P.faint,
                  borderBottom: `2px solid ${on ? accent : "transparent"}`,
                  marginBottom: -1,
                  transition: "color 0.2s ease, border-color 0.2s ease",
                }}
              >
                {label}
                {count > 0 && (
                  <span style={{ marginLeft: 7, fontSize: FONT_SIZES.micro, fontFamily: "var(--cb-mono)", color: on ? accent : P.faint }}>{count}</span>
                )}
              </button>
            );
          })}
        </div>

        {profileTab === "investigations" && (
          recentHistory.length === 0 ? (
            <ProfileEmpty P={P} accent={accent} icon="history"
              title="No investigations yet"
              body="Every question you ask is kept as an investigation: the thread, the papers it found, and what you saved from it." />
          ) : (
            <div style={cardStyle}>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {recentHistory.map((h, i) => (
                  <button key={h.id} onClick={() => onOpenHistory(h)} className="cb-row" style={{
                    textAlign: "left", background: "transparent", border: "none", cursor: "pointer",
                    padding: "12px 0", borderTop: i > 0 ? `1px solid ${P.line}` : "none",
                  }}>
                    <div style={{ fontSize: FONT_SIZES.small, fontWeight: 600, color: P.ink, lineHeight: 1.4 }}>{h.title}</div>
                    {/* Commit 87 — Commit 84 renamed this language everywhere
                        else and missed this one call site, so the profile was
                        still counting "exchanges" while the rest of the app
                        counted questions and papers. */}
                    <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, marginTop: 3, fontFamily: "var(--cb-body)" }}>
                      {(h.turns || []).length} question{(h.turns || []).length === 1 ? "" : "s"}
                      {(h.allSources || []).length > 0 && ` · ${(h.allSources || []).length} paper${(h.allSources || []).length === 1 ? "" : "s"}`}
                      {h.ts ? ` · ${new Date(h.ts).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )
        )}

        {profileTab === "saved" && (
          saved.length === 0 ? (
            <ProfileEmpty P={P} accent={accent} icon="bookmark"
              title="Nothing saved yet"
              body="Save a paper from any answer and it lands here, with the investigation that found it." />
          ) : (
            <div style={cardStyle}>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {saved.slice(0, 12).map((sv, i) => (
                  <div key={sv.id || i} style={{ padding: "12px 0", borderTop: i > 0 ? `1px solid ${P.line}` : "none" }}>
                    <div style={{ fontSize: FONT_SIZES.small, fontWeight: 600, color: P.ink, lineHeight: 1.4 }}>{renderCleanTitle(sv.title)}</div>
                    <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, marginTop: 3, fontFamily: "var(--cb-body)" }}>
                      {[sv.authors, sv.journal, sv.year].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        )}

        {profileTab === "collections" && (
          collectionCounts.length === 0 ? (
            <ProfileEmpty P={P} accent={accent} icon="folder"
              title="No collections yet"
              body="Collections group saved papers by question rather than by date. Make one from any paper you have saved." />
          ) : (
            <div style={cardStyle}>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {collectionCounts.map((c, i) => (
                  <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderTop: i > 0 ? `1px solid ${P.line}` : "none" }}>
                    <span style={{ fontSize: FONT_SIZES.small, fontWeight: 500, color: P.ink, display: "inline-flex", alignItems: "center", gap: 8 }}><Icon name="folder" size={14} style={{ color: P.faint }} />{c.name}</span>
                    <span style={{ fontSize: FONT_SIZES.caption, color: P.faint, fontFamily: "var(--cb-mono)" }}>{c.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        )}

        {profileTab === "about" && (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, alignItems: "start" }}>
            <div style={cardStyle}>
              <div style={cardLabel}>Affiliation</div>
              {profile.affiliation && profile.affiliation.trim() ? (
                <div style={{ fontSize: FONT_SIZES.small, color: P.ink, fontWeight: 500 }}>{profile.affiliation}</div>
              ) : (
                <div style={{ fontSize: FONT_SIZES.small, color: P.faint, lineHeight: 1.5 }}>Not set yet — add one from Edit profile.</div>
              )}
            </div>
            {badges.length > 1 && (
              <div style={cardStyle}>
                <div style={cardLabel}>Badges</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {badges.map((b) => (
                    <span key={b.label} style={{
                      display: "inline-flex", alignItems: "center", gap: 6, fontSize: FONT_SIZES.caption, fontWeight: 600,
                      padding: "6px 12px", borderRadius: RADIUS.pill,
                      color: b.real ? accent : (b.tint || P.ink2),
                      background: b.real ? withAlpha(accent, 0.1) : (P.dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)"),
                      border: b.real ? `1px solid ${withAlpha(accent, 0.3)}` : `1px solid ${P.line}`,
                    }}>
                      <Icon name={b.icon} size={13} />
                      {b.label}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        </div>
        {/* /Profile panel */}

        {/* The "Account & security" action moved up next to Edit profile,
            where a profile's own actions belong; this second copy of the
            same button at the bottom of the page is just a duplicate now. */}
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
function NetworkSearchModal({ P, accent, at, close, onMessage, onOpenProfile = () => {}, page = false }) {
  useEffect(() => { if (page) return; const onKey = (e) => { if (e.key === "Escape") close(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [close, page]);
  const trapRef = useFocusTrap();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  // Commit 74 — the founder, pinned. See search-users in data.js.
  const [founder, setFounder] = useState(null);
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
  /* Commit 100 — no query, no request, and no results.

     Commit 57 made an empty box browse the directory, to fix a real problem:
     "a social network that shows you nobody until you can name somebody has
     no way in." But the fix was to publish a roster of real accounts to
     anybody who opened the tab, and the people in that roster never asked to
     be listed. The cold-start problem is solved instead by the founder card,
     which is one account volunteering its own contact rather than a sample
     of everyone else's.

     The 2-character floor mirrors the server's. `hubs` is gone from the
     response entirely — see the endpoint. */
  useEffect(() => {
    clearTimeout(searchTimer.current);
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      // The founder card is still worth fetching with an empty box: it is
      // the one thing this screen shows before you type.
      apiDataGet("search-users", { q: "" }).then((d) => setFounder((d && d.founder) || null)).catch(() => {});
      return;
    }
    setLoading(true);
    searchTimer.current = setTimeout(async () => {
      const data = await apiDataGet("search-users", { q });
      setLoading(false);
      setResults(data && Array.isArray(data.items) ? data.items : []);
      setFounder((data && data.founder) || null);
    }, 300);
    return () => clearTimeout(searchTimer.current);
  }, [query]);

  const toggleFollow = async (r) => {
    if (followBusy.has(r.id)) return;
    setFollowBusy((prev) => new Set(prev).add(r.id));
    try {
      const res = await apiDataAction("toggle-follow", { target_id: r.id });
      /* ══════════════════════════════════════════════════════════════
         Commit 97 — the Follow button did nothing on the founder card.

         Two bugs stacked. First, this only ever wrote back into
         `results`, the searched-researcher list. The founder is rendered
         from its own `founder` state and is not a member of that array,
         so pressing Follow there fired the request, the server recorded
         it, and the UI never changed — the most confusing possible
         outcome, because it looks like the click was ignored.

         Second, the founder card reads `founder.isFollowing` while every
         other row derives from `r.following`. One field written, a
         different field read, so even a correct update would not have
         shown. Both surfaces now go through the same field. */
      setResults((prev) => prev.map((x) => (x.id === r.id ? { ...x, following: res.following, followers: res.followers } : x)));
      setFounder((prev) => (prev && prev.id === r.id ? { ...prev, following: res.following, followers: res.followers } : prev));
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
    /* Commit 88 — dialog when composing a message (that genuinely is an
       interruption), page when Find People is the destination. */
    <div
      onClick={page ? undefined : close}
      role={page ? undefined : "dialog"}
      aria-modal={page ? undefined : "true"}
      aria-label={page ? undefined : "Find researchers"}
      style={page
        ? { width: "100%" }
        : { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 214, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      className={page ? undefined : "cb-backdrop"}
    >
      <div ref={trapRef} tabIndex={-1} onClick={page ? undefined : ((e) => e.stopPropagation())} style={page ? {
        background: P.surface, border: `1px solid ${P.line}`, borderRadius: RADIUS.lg,
        width: "100%", maxHeight: "none", display: "flex", flexDirection: "column", overflow: "hidden", outline: "none",
      } : {
        background: P.dark ? "rgba(15, 17, 26, 0.9)" : "rgba(255, 255, 255, 0.95)",
        backdropFilter: "blur(40px) saturate(150%)", WebkitBackdropFilter: "blur(40px) saturate(150%)",
        border: P.dark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.08)",
        borderRadius: 12, maxWidth: 480, width: "100%", maxHeight: "80vh", display: "flex", flexDirection: "column",
        boxShadow: "0 24px 80px rgba(0,0,0,0.5)", overflow: "hidden", outline: "none",
      }} className={page ? undefined : "cb-modal"}>
        {/* Commit 88 — in page mode WorkspacePage already renders the title
            and the standfirst, so this header would print "Find people"
            twice, ten pixels apart, with a close button for a page that
            cannot be closed. */}
        {!page && (
          <div style={{ padding: "18px 20px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: P.dark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.08)" }}>
            <div>
              <div style={{ fontSize: FONT_SIZES.body, fontWeight: 700, color: P.ink }}>Find people</div>
              <div style={{ fontSize: FONT_SIZES.micro, color: P.faint, marginTop: 2, fontFamily: "var(--cb-body)", letterSpacing: "0.01em" }}>Search Cerebrum researchers</div>
            </div>
            <button onClick={close} aria-label="Close" style={{ background: "none", border: "none", color: P.faint, cursor: "pointer", padding: 4, display: "inline-flex" }}><Icon name="close" size={18} /></button>
          </div>
        )}

        <div style={{ padding: page ? "0 0 0" : "14px 20px 0" }}>
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: P.faint, display: "inline-flex" }}><Icon name="search" size={15} /></span>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search a name or @username"
              aria-label="Search researchers"
              style={{ width: "100%", padding: "10px 13px 10px 34px", fontSize: FONT_SIZES.small, borderRadius: 8, border: `1px solid ${P.line}`, background: P.dark ? "rgba(255,255,255,0.03)" : "#fff", color: P.ink, fontFamily: "var(--cb-body)" }}
            />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "12px 12px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
          {/* Commit 100 — the empty state is the honest explanation of why
              this screen is empty. Nothing here is a placeholder for a list
              that would appear if you waited: there is no list. Saying so
              plainly is better than a blank panel that reads as broken. */}
          {trimmed.length < 2 && (
            <div style={{ padding: "18px 14px 8px", fontSize: FONT_SIZES.caption, color: P.faint, lineHeight: 1.65 }}>
              <div style={{ fontWeight: 600, color: P.ink2, marginBottom: 4 }}>Cerebrum doesn't list its members.</div>
              There's no directory to scroll and no way to browse people by university. You find someone by searching their name or their @username, which means you already know who you're looking for. You can turn yourself off even from that in Settings.
            </div>
          )}
          {trimmed.length >= 2 && loading && results.length === 0 && (
            <div style={{ padding: "24px 12px", textAlign: "center", fontSize: FONT_SIZES.caption, color: P.faint }}>Searching…</div>
          )}
          {trimmed.length >= 2 && !loading && results.length === 0 && (
            <div style={{ padding: "24px 12px", textAlign: "center", fontSize: FONT_SIZES.caption, color: P.faint, lineHeight: 1.6 }}>
              Nobody matches that. Either they aren't on Cerebrum, or they've chosen not to be findable.
            </div>
          )}
          {/* Commit 74 — the founder's card, pinned above everything.
              A new account lands on an empty social graph with nobody to
              talk to. The person who built the thing is a genuinely useful
              first contact, and unlike a suggested-follow algorithm this
              card is honest about exactly who it is recommending and why. */}
          {founder && (
            <div className="cb-founder-card" style={{
              marginBottom: 10, padding: "14px 15px", borderRadius: 12,
              background: "linear-gradient(135deg, rgba(201,162,39,0.10), rgba(47,127,230,0.08))",
              border: "1px solid rgba(201,162,39,0.35)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <FounderFrame size={42} accent={accent}>
                  <span style={{
                    width: 42, height: 42, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                    ...avatarSkin(founder.name || founder.id), fontWeight: 700, fontFamily: "var(--cb-mono)", fontSize: 17,
                  }}>{(founder.name || "?").trim().charAt(0).toUpperCase()}</span>
                </FounderFrame>
                <div
                  role="button" tabIndex={0}
                  onClick={() => onOpenProfile(founder.id)}
                  onKeyDown={(e) => { if (e.key === "Enter") onOpenProfile(founder.id); }}
                  style={{ minWidth: 0, flex: 1, cursor: "pointer" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: FONT_SIZES.body, fontWeight: 700, color: P.ink }}>{founder.name}</span>
                    <VerifiedCheck size={15} />
                  </div>
                  <div style={{ fontSize: FONT_SIZES.micro, color: P.faint, fontFamily: "var(--cb-mono)" }}>
                    @{founder.username} · Founder &amp; Owner
                  </div>
                </div>
              </div>
              <div style={{ fontSize: FONT_SIZES.small, color: P.ink2, lineHeight: 1.5, margin: "11px 0 12px" }}>
                {founder.prompt || "Have a question for the owner?"} A message here goes straight to the person who builds this.
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={() => messageResearcher(founder)} disabled={messageBusy.has(founder.id)} className="cb-press" style={{
                  padding: "8px 16px", borderRadius: 100, border: "none", cursor: "pointer",
                  background: accent, color: at, fontSize: FONT_SIZES.caption, fontWeight: 700, fontFamily: "var(--cb-body)",
                }}>{messageBusy.has(founder.id) ? "Opening…" : "Ask a question"}</button>
                <button onClick={() => toggleFollow(founder)} disabled={followBusy.has(founder.id)} className="cb-press" style={{
                  padding: "8px 16px", borderRadius: 100, cursor: "pointer",
                  background: "transparent", color: P.ink2, border: `1px solid ${P.line2}`,
                  fontSize: FONT_SIZES.caption, fontWeight: 600, fontFamily: "var(--cb-body)",
                }}>{founder.following ? "Following" : "Follow"}</button>
              </div>
            </div>
          )}
          {results.map((r) => {
            const isFollowing = !!r.following;
            const isFollowBusy = followBusy.has(r.id);
            const isMessageBusy = messageBusy.has(r.id);
            const subtitle = [r.affiliation, r.followers ? `${r.followers} follower${r.followers === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ");
            return (
              /* Commit 100 — the row is the way into a profile. Before this
                 a search result was terminal: a name, an institution, and two
                 buttons, with nothing behind it, so you decided whether to
                 follow a stranger from one line of text. */
              <div
                key={r.id}
                role="button"
                tabIndex={0}
                onClick={() => onOpenProfile(r.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenProfile(r.id); } }}
                onMouseEnter={(e) => { e.currentTarget.style.background = P.dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 8px", borderRadius: 12, cursor: "pointer", transition: "background 0.15s ease" }}
              >
                {/* Commit 100 — this was `api.dicebear.com/...?seed=<username>`.
                    Every search sent the username of every person it matched
                    to a third-party host, from the searcher's browser, with
                    their IP attached. Nobody consented to that and nothing
                    needed it: the app already draws initial avatars locally
                    (avatarSkin), which is what the profile page has used
                    since Commit 54 for exactly this reason. */}
                <div aria-hidden="true" style={{
                  width: 40, height: 40, borderRadius: "50%", flexShrink: 0,
                  border: `1px solid ${P.line}`, display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 15, fontWeight: 700, fontFamily: "var(--cb-mono)",
                  ...avatarSkin(r.name || r.username || r.id),
                }}>{(r.name || r.username || "?").trim().charAt(0).toUpperCase()}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: FONT_SIZES.small, fontWeight: 700, color: P.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
                  {subtitle && <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{subtitle}</div>}
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); toggleFollow(r); }}
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
                  onClick={(e) => { e.stopPropagation(); messageResearcher(r); }}
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



/* Commit 100 — the privacy panel.

   These three switches are the settings side of the changes in
   functions/api/data.js. They are grouped and worded so that reading them
   tells you what the system does, not just what the toggle is named: a
   privacy control the person does not understand is a privacy control they
   will leave on the wrong setting.

   Each writes through the same `update-profile` action as the rest of the
   profile and re-reads nothing — the server resolves NULL to a default and
   sends the resolved value back on load (see `privacy` on the profile
   resource), so what shows here is always what the server will actually
   enforce. */
// Section, Row, Switch and Picker are locals inside SettingsView (they close
// over its palette and spacing), so they are handed in rather than
// re-implemented here — a privacy panel that looked subtly unlike every
// other settings block would read as bolted on, which is the opposite of the
// message it needs to send.
function PrivacySettings({ P, accent, at, sfx, Section, Row, Switch, Picker }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiDataGet("profile")
      .then((res) => { if (!cancelled && res && res.privacy) setState(res.privacy); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const write = async (patch, key) => {
    if (busy) return;
    setBusy(key);
    const prev = state;
    setState((s) => ({ ...s, ...patch }));
    try {
      await apiDataAction("update-profile", {
        ...(patch.discoverable !== undefined ? { discoverable: patch.discoverable } : {}),
        ...(patch.showAffiliation !== undefined ? { show_affiliation: patch.showAffiliation } : {}),
        ...(patch.dmPolicy !== undefined ? { dm_policy: patch.dmPolicy } : {}),
      });
      sfx();
    } catch (e) {
      // Roll the switch back rather than leaving it showing a setting that
      // did not save. A privacy toggle that lies is worse than one that
      // fails loudly.
      setState(prev);
      toast(e.message || "Couldn't save that setting.", { tone: "error" });
    } finally { setBusy(""); }
  };

  if (!state) {
    return (
      <Section title="Privacy">
        <Row label="Loading your privacy settings…" last />
      </Section>
    );
  }

  return (
    <Section
      title="Privacy"
      footer="Cerebrum has no member directory, no institution pages, and no follower lists. Nobody can browse their way to you. They have to search your name or your @username, and these settings decide whether even that works."
    >
      <Row
        label="Let people find me in search"
        desc="When this is off, searching your name or @username returns nothing and your profile link stops working, including for people who already have it. People already following you keep seeing you."
        control={<Switch on={state.discoverable} onChange={(v) => write({ discoverable: v }, "disc")} label="Findable in search" />}
      />
      <Row
        label="Show my institution on my profile"
        desc="Your affiliation is never searchable and never links anywhere, because there are no institution pages on Cerebrum. This only decides whether it appears on your profile at all."
        control={<Switch on={state.showAffiliation} onChange={(v) => write({ showAffiliation: v }, "aff")} label="Show institution" />}
      />
      <Row
        label="Who can start a conversation with you"
        desc={state.dmPolicy === "anyone"
          ? "Anyone signed in can message you out of the blue."
          : "Only people you follow can open a new conversation. Conversations you're already in stay open either way."}
        control={
          <Picker
            value={state.dmPolicy}
            options={[["following", "People I follow"], ["anyone", "Anyone"]]}
            onChange={(v) => write({ dmPolicy: v }, "dm")}
          />
        }
        last
      />
    </Section>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Commit 100 — PublicProfile: somebody else's profile, as a real page.

   Before this, viewing another person meant a row in a search result:
   name, institution, follower count, two buttons. There was no server
   endpoint for a profile that isn't your own (the `profile` resource is
   own-account only, and said so), so there was nothing richer to render.
   `public-profile` in functions/api/data.js is the other half of this.

   The layout is deliberately the one people already know from Instagram,
   Threads and X, because a profile is a solved layout and inventing a new
   one only makes people work: cover, avatar breaking the cover line,
   identity block, relationship buttons, counts, then the person's own
   words and links. What is NOT borrowed from those apps is what they put
   in the counts.

   Followers and following are numbers here, and nothing else. They are not
   buttons, because a tappable follower count is a follower LIST, and a
   follower list is how you walk a social graph — pick one account, open its
   followers, open each of those. That is the same enumeration problem as the
   institution roster this commit deleted, wearing different clothes. The
   count answers "is this person connected to anything?", which is the honest
   reason to show it. The list answers "who else can I go find?", which is
   not this app's business to answer.

   Nothing about the person's research activity appears here either: no
   searches, no saved papers, no collections, no history. A research question
   is often the most sensitive thing anyone types into this product.
   ════════════════════════════════════════════════════════════════════ */
function PublicProfile({ P, accent, at, isMobile, userId, onClose, onMessage }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [msgBusy, setMsgBusy] = useState(false);
  const trapRef = useFocusTrap();

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    apiDataGet("public-profile", { id: userId })
      .then((res) => { if (!cancelled) { setData(res); setLoading(false); } })
      .catch(() => {
        if (cancelled) return;
        // One message for every failure mode, matching the endpoint, which
        // returns the same 404 for "no such account", "opted out of being
        // found" and "one of you blocked the other". Distinguishing them
        // here would leak exactly what the shared 404 exists to hide.
        setError("This profile isn't available.");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [userId]);

  const u = data && data.user;
  const displayName = (u && u.name) || "Researcher";
  const initial = displayName.trim().charAt(0).toUpperCase() || "?";
  const isFounder = !!(data && data.badges || []).includes("founder");

  const toggleFollow = async () => {
    if (busy || !u) return;
    setBusy(true);
    try {
      const res = await apiDataAction("toggle-follow", { target_id: u.id });
      setData((prev) => prev && ({
        ...prev,
        isFollowing: res.following,
        followers: typeof res.followers === "number" ? res.followers : prev.followers,
        // Following someone can be what unlocks messaging them, when their
        // policy is "people I follow" and they already follow you. Recompute
        // optimistically so the button below stops lying immediately.
        canMessage: prev.canMessage || (res.following && prev.followsMe),
      }));
    } catch (e) {
      toast(e.message || "Couldn't update that follow.", { tone: "error" });
    } finally { setBusy(false); }
  };

  const message = async () => {
    if (msgBusy || !u) return;
    setMsgBusy(true);
    try {
      const res = await apiDataAction("start-thread", { target_id: u.id });
      onMessage(u, res.thread_id);
    } catch (e) {
      toast(e.message || "Couldn't start that conversation.", { tone: "error" });
      setMsgBusy(false);
    }
  };

  const links = u ? [
    u.link_site ? { label: "Website", href: u.link_site, icon: "link" } : null,
    u.link_orcid ? { label: "ORCID", href: u.link_orcid, icon: "check" } : null,
    u.link_scholar ? { label: "Scholar", href: u.link_scholar, icon: "bookOpen" } : null,
  ].filter(Boolean) : [];

  // Affiliation, degree and graduating year read as one line of context
  // about a person, not as three separate facets you could filter on. Any
  // of them can be absent, and affiliation is absent for anyone who chose
  // to hide it — the endpoint sends null and this simply doesn't render it.
  const context = u ? [u.degree, u.grad_year, u.affiliation].filter(Boolean).join(" · ") : "";

  const stat = (n, label) => (
    <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
      <span style={{ fontSize: FONT_SIZES.subhead, fontWeight: 700, color: P.ink, fontFamily: "var(--cb-mono)", letterSpacing: "-0.02em" }}>{n}</span>
      <span style={{ fontSize: FONT_SIZES.caption, color: P.faint }}>{label}</span>
    </div>
  );

  return (
    <div
      onClick={onClose}
      role="dialog" aria-modal="true" aria-label={`${displayName}'s profile`}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 216, display: "flex", alignItems: isMobile ? "flex-end" : "center", justifyContent: "center", padding: isMobile ? 0 : 20 }}
      className="cb-backdrop"
    >
      <div
        ref={trapRef} tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="cb-modal"
        style={{
          background: P.surface, border: `1px solid ${P.line}`,
          borderRadius: isMobile ? "16px 16px 0 0" : RADIUS.lg,
          width: "100%", maxWidth: 520, maxHeight: isMobile ? "92vh" : "86vh",
          display: "flex", flexDirection: "column", overflow: "hidden", outline: "none",
          boxShadow: "0 24px 80px rgba(0,0,0,0.45)",
        }}
      >
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading && (
            <div style={{ padding: "60px 20px", textAlign: "center", fontSize: FONT_SIZES.small, color: P.faint }}>Loading…</div>
          )}
          {!loading && error && (
            <div style={{ padding: "52px 28px", textAlign: "center" }}>
              <div style={{ fontSize: FONT_SIZES.body, fontWeight: 600, color: P.ink, marginBottom: 6 }}>{error}</div>
              <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, lineHeight: 1.6 }}>
                It may have been removed, or the person may have chosen not to be found.
              </div>
            </div>
          )}
          {!loading && !error && u && (
            <>
              {/* Cover. A person's own chosen image if they set one, and
                  otherwise a calm accent wash rather than a grey slab — the
                  profile should look composed before anyone has uploaded
                  anything to it. */}
              <div style={{
                height: isMobile ? 104 : 132,
                background: u.cover
                  ? `center/cover no-repeat url(${JSON.stringify(u.cover)})`
                  : `linear-gradient(135deg, ${withAlpha(accent, 0.32)}, ${withAlpha(accent, 0.08)})`,
                borderBottom: `1px solid ${P.line}`,
              }} />

              <div style={{ padding: isMobile ? "0 18px 22px" : "0 26px 26px" }}>
                <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginTop: isMobile ? -38 : -46 }}>
                  <div style={{ width: isMobile ? 78 : 96, height: isMobile ? 78 : 96, flexShrink: 0 }}>
                    {u.avatar_base64 ? (
                      <img
                        src={u.avatar_base64}
                        alt={`${displayName}'s avatar`}
                        style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover", display: "block", border: `4px solid ${P.surface}`, background: P.surface }}
                      />
                    ) : (
                      <div style={{
                        width: "100%", height: "100%", borderRadius: "50%",
                        ...avatarSkin(displayName || u.id),
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: isMobile ? 30 : 36, fontWeight: 700, fontFamily: "var(--cb-mono)",
                        border: `4px solid ${P.surface}`,
                      }}>{initial}</div>
                    )}
                  </div>

                  {/* Relationship buttons sit on the avatar's line, the way
                      every profile people already use puts them. */}
                  <div style={{ display: "flex", gap: 8, paddingBottom: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <button
                      onClick={toggleFollow}
                      disabled={busy}
                      className="cb-press"
                      style={{
                        padding: "8px 18px", borderRadius: 100, cursor: busy ? "default" : "pointer",
                        fontSize: FONT_SIZES.caption, fontWeight: 700, fontFamily: "var(--cb-body)",
                        opacity: busy ? 0.6 : 1,
                        background: data.isFollowing ? "transparent" : accent,
                        color: data.isFollowing ? P.ink2 : at,
                        border: data.isFollowing ? `1px solid ${P.line2}` : "none",
                      }}
                    >{data.isFollowing ? "Following" : "Follow"}</button>
                    <button
                      onClick={message}
                      disabled={msgBusy || !data.canMessage}
                      className="cb-press"
                      title={data.canMessage ? `Message ${displayName}` : "This person only accepts messages from people they follow"}
                      style={{
                        padding: "8px 16px", borderRadius: 100,
                        cursor: data.canMessage ? (msgBusy ? "default" : "pointer") : "not-allowed",
                        fontSize: FONT_SIZES.caption, fontWeight: 600, fontFamily: "var(--cb-body)",
                        background: "transparent", color: data.canMessage ? P.ink2 : P.faint,
                        border: `1px solid ${P.line}`, opacity: data.canMessage ? 1 : 0.65,
                      }}
                    >{msgBusy ? "Opening…" : "Message"}</button>
                  </div>
                </div>

                <div style={{ marginTop: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                    <h2 style={{ fontSize: isMobile ? 21 : 24, fontWeight: 700, color: P.ink, margin: 0, letterSpacing: "-0.02em", fontFamily: "var(--cb-display)" }}>{displayName}</h2>
                    {isFounder && <VerifiedCheck size={16} />}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3, flexWrap: "wrap" }}>
                    <span style={{ fontSize: FONT_SIZES.small, color: P.faint, fontFamily: "var(--cb-mono)" }}>@{u.username}</span>
                    {/* "Follows you" is the one piece of relationship context
                        worth surfacing before you decide to follow back, and
                        it is information the viewer is already entitled to —
                        it is about their own account, not a third party's. */}
                    {data.followsMe && (
                      <span style={{
                        fontSize: FONT_SIZES.micro, fontWeight: 600, color: P.ink2,
                        background: P.dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)",
                        padding: "2px 8px", borderRadius: RADIUS.pill,
                      }}>Follows you</span>
                    )}
                  </div>
                </div>

                {u.bio && (
                  <div style={{ fontSize: FONT_SIZES.small, color: P.ink, lineHeight: 1.65, marginTop: 12, whiteSpace: "pre-wrap" }}>{u.bio}</div>
                )}

                {context && (
                  <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, marginTop: 10, lineHeight: 1.5 }}>{context}</div>
                )}

                {links.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                    {links.map((l) => (
                      <a
                        key={l.label}
                        href={l.href}
                        target="_blank"
                        // noopener/noreferrer on every outbound link a person
                        // put on their own profile: without it the destination
                        // gets a referrer naming this app and a handle on the
                        // opener window.
                        rel="noopener noreferrer nofollow ugc"
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 6,
                          fontSize: FONT_SIZES.caption, fontWeight: 600, color: accent,
                          textDecoration: "none", padding: "5px 11px", borderRadius: RADIUS.pill,
                          border: `1px solid ${withAlpha(accent, 0.3)}`, background: withAlpha(accent, 0.07),
                        }}
                      ><Icon name={l.icon} size={12} />{l.label}</a>
                    ))}
                  </div>
                )}

                <div style={{ display: "flex", gap: 20, marginTop: 16, paddingTop: 14, borderTop: `1px solid ${P.line}` }}>
                  {stat(data.followers, data.followers === 1 ? "follower" : "followers")}
                  {stat(data.followingCount, "following")}
                </div>

                {(data.badges || []).length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 14 }}>
                    {data.badges.map((b) => (
                      <span key={b} style={{
                        fontSize: FONT_SIZES.micro, fontWeight: 600, color: P.ink2,
                        border: `1px solid ${P.line}`, padding: "3px 9px", borderRadius: RADIUS.pill,
                        textTransform: "capitalize",
                      }}>{String(b).replace(/[_-]+/g, " ")}</span>
                    ))}
                  </div>
                )}

                {/* Saying what a profile does NOT carry is part of the
                    product, not a disclaimer. Someone deciding how much to
                    put on their own profile is choosing based on what they
                    think other people can see. */}
                <div style={{ fontSize: FONT_SIZES.micro, color: P.faint, lineHeight: 1.6, marginTop: 18, paddingTop: 12, borderTop: `1px solid ${P.line}` }}>
                  Cerebrum profiles never show what someone searched for, saved, or read. Follower counts don't open into lists.
                </div>
              </div>
            </>
          )}
        </div>

        <div style={{ padding: "12px 18px", borderTop: `1px solid ${P.line}`, display: "flex", justifyContent: "flex-end", flexShrink: 0 }}>
          <button onClick={onClose} style={{
            background: "none", border: `1px solid ${P.line}`, color: P.ink2, cursor: "pointer",
            padding: "7px 16px", borderRadius: RADIUS.pill, fontSize: FONT_SIZES.caption, fontWeight: 600, fontFamily: "var(--cb-body)",
          }}>Close</button>
        </div>
      </div>
    </div>
  );
}

/* Commit 100 — InstitutionModal is deleted.

   It rendered a university's roster: every Cerebrum account sharing one
   affiliation string, up to a hundred of them, reachable by clicking an
   institution name in Find People or an affiliation on someone's profile.
   Reported directly: "if I go to find people, it shows up University of
   Tennessee. I should not be able to view the people at University of
   Tennessee. That is not safe."

   It is not, and there is no privacy setting that makes it safe, because
   the roster IS the feature. An institution is a fact about a person, not a
   place other people can be browsed from. The `hub` endpoint behind it is
   deleted too — see functions/api/data.js — so nothing can rebuild this
   view against the same data. Affiliation still appears on a profile, as
   plain text, and only if that person left it visible. */


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
/* pdf.js runs its parser in a Web Worker, and the worker file must be the
 * exact same version as the library. It used to be fetched from
 * cdn.jsdelivr.net at runtime, which had three problems: the package was
 * already installed locally so the download was pointless; a `^` version
 * range meant the bundled library and the CDN worker could silently drift
 * apart; and it made a third party a hard dependency of reading a PDF, which
 * for a document a researcher may consider confidential is the wrong shape.
 *
 * `new URL(..., import.meta.url)` is Vite's supported way to emit a worker as
 * a build asset: the file is hashed into /assets and served from our own
 * origin, so it is covered by the site's CSP and cannot be swapped upstream.
 *
 * The PDF itself never leaves the browser either way — extraction is local. */
let pdfjsLibPromise = null;
function loadPdfJs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import("pdfjs-dist").then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url
      ).toString();
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

function NotebookMode({ P, accent, at, close, asPage = false }) {
  // Escape closes the overlay form. As a page it must NOT: Escape inside a
  // destination that is not covering anything is a keystroke that throws
  // away whatever the person pasted.
  useEffect(() => {
    if (asPage) return;
    const onKey = (e) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, asPage]);
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
            setError("Couldn't find any text in that PDF. It may be a scanned or image-only document. Try a different file, or paste the text directly if you have it.");
            return;
          }
          setDocumentText(text);
          setLeftTab("paste");
        })
        .catch((e) => {
          console.error("PDF extraction failed:", e);
          setError("Couldn't read that PDF. It may be corrupted or password-protected. Try a different file, or paste the text directly instead.");
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
    /* Commit 99 — Document Mode was the last nav item still living in a
       full-screen `position: fixed; inset: 0; z-index: 300` overlay. Commit
       88 promoted History, Saved, Collections and Network Search out of
       modals and into real pages; this one was missed, and it is the worst
       of the set to leave behind, because the overlay paints over the entire
       sidebar. A person who clicked Document Mode lost the nav rail
       completely, and pressing any nav item did nothing — verified: with it
       open, Settings and Trending both left the view where it was. The only
       way out was a close button in its own header, and Escape. That is a
       dead end in the primary navigation, and it is the same report as
       "document mode doesn't work when I click on it."

       It is a page now, laid out in the app shell alongside the others, so
       the sidebar stays and you can leave the way you arrived. `asPage`
       keeps the modal form available for the command palette, which opens it
       deliberately as an interruption. */
    <div
      {...(asPage ? { role: "region", "aria-label": "Document Mode" } : { role: "dialog", "aria-modal": "true", "aria-label": "Document Mode" })}
      style={asPage
        ? { display: "flex", flexDirection: "column", minHeight: 0, height: "calc(100dvh - 96px)", background: P.bg }
        : { position: "fixed", inset: 0, zIndex: 300, background: P.bg, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: isMobile ? "14px 16px" : "16px 24px", borderBottom: `1px solid ${P.line}`, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Icon name="bookOpen" size={18} style={{ color: accent }} />
          <div>
            {/* Commit 99 — a page needs a real heading, not a styled div, or
                a screen reader and the browser's own outline see a page with
                no title. The description said "Deep summarization and Q&A over
                one document", which names the technique rather than the job.
                A person arrives here holding a PDF. */}
            <h1 style={{ fontSize: FONT_SIZES.subhead, fontWeight: 700, color: P.ink, fontFamily: "var(--cb-display)", margin: 0, letterSpacing: "-0.01em" }}>Document Mode</h1>
            {!isMobile && <div style={{ fontSize: FONT_SIZES.caption, color: P.faint }}>Put in one paper and ask questions about it</div>}
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
            {[["paste", "Paste text"], ["upload", "Upload a file"]].map(([key, label]) => (
              <button key={key} role="tab" aria-selected={leftTab === key} onClick={() => setLeftTab(key)}
                style={{
                  flex: 1, padding: "7px 10px", borderRadius: 8, border: "none", cursor: "pointer",
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
                flex: 1, width: "100%", resize: "none", padding: 14, borderRadius: 12, border: `1px solid ${P.line}`,
                background: inputBg, color: P.ink, fontFamily: "var(--cb-body)", fontSize: FONT_SIZES.small, lineHeight: 1.6, minHeight: isMobile ? 140 : 240,
              }}
            />
          )}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, flexShrink: 0, gap: 12 }}>
            {/* Commit 64 — a bare character count told a reader nothing they
                could act on. Words and an approximate read time are the units
                people actually think in, and the count no longer implies a
                limit is being approached: long documents are analyzed with a
                visible note rather than refused. */}
            <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, fontFamily: "var(--cb-mono)", display: "flex", gap: 10, flexWrap: "wrap" }}>
              {(() => {
                const t = documentText.trim();
                if (!t) return <span>Paste a paper, report, or any long document</span>;
                const words = t.split(/\s+/).length;
                const mins = Math.max(1, Math.round(words / 220));
                return <>
                  <span>{words.toLocaleString()} words</span>
                  <span style={{ opacity: 0.5 }}>·</span>
                  <span>~{mins} min read</span>
                </>;
              })()}
            </div>
            <button
              onClick={analyze}
              disabled={!documentText.trim() || analyzing}
              style={{
                padding: "10px 20px", borderRadius: 100, border: "none", cursor: (!documentText.trim() || analyzing) ? "default" : "pointer",
                background: (!documentText.trim() || analyzing) ? dimBtnBg : accent,
                color: (!documentText.trim() || analyzing) ? P.faint : at, fontWeight: 700, fontSize: FONT_SIZES.small, flexShrink: 0,
              }}
            >{analyzing ? "Reading it…" : "Read this document"}</button>
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
              <span aria-hidden="true" style={{
                width: 56, height: 56, borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center",
                background: withAlpha(accent, 0.1), border: `1px solid ${withAlpha(accent, 0.25)}`, marginBottom: 4,
              }}><Icon name="bookOpen" size={24} style={{ color: accent }} /></span>
              <div style={{ fontSize: FONT_SIZES.subhead, fontWeight: 700, color: P.ink }}>Read a paper with me</div>
              <div style={{ fontSize: FONT_SIZES.small, maxWidth: 320, textAlign: "center", lineHeight: 1.6, color: P.ink2 }}>
                Paste a paper on the left, or upload the PDF. You'll get what it found, how the study was done, and where it's weak. After that you can ask it questions, the way you'd ask a colleague who had just read it.
              </div>
            </div>
          )}
          {analyzing && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ fontSize: FONT_SIZES.body, fontWeight: 600, color: P.ink }}>Reading the document…</div>
              <div style={{ fontSize: FONT_SIZES.caption, color: P.faint }}>Racing five models — whichever answers first wins.</div>
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
                      return <div style={{ fontSize: FONT_SIZES.small, color: P.faint }}>No separate findings section this time — it's all in the summary.</div>;
                    }
                    return (
                      <>
                        {hasFindings && (<>
                          <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 600, letterSpacing: "0.01em", color: accent, fontFamily: "var(--cb-body)", marginBottom: 10 }}>Key Findings</div>
                          {renderAnswer(summary.keyFindings, [], P, accent, hoverCite, setHoverCite)}
                        </>)}
                        {hasLimitations && (<>
                          <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 600, letterSpacing: "0.01em", color: accent, fontFamily: "var(--cb-body)", marginTop: hasFindings ? 20 : 0, marginBottom: 10 }}>Limitations</div>
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
                    {qaHistory.length === 0 && <div style={{ fontSize: FONT_SIZES.small, color: P.faint }}>Answers come only from this document.</div>}
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
/* Commit 59 — live deploy status.
   Every backend feature in this app ships as a separate file that has to be
   pasted into the repo by hand, and a partial deploy fails silently: calling
   works on the caller's screen and simply never reaches anyone, because the
   one endpoint that was missed returns 404 and the client reads that as
   "nothing to report". Diagnosing that has cost more time than building the
   feature did. This asks each endpoint whether it exists and says so
   plainly, so "did my deploy land?" is a question the app answers itself. */
function SystemStatus({ P, accent }) {
  const [rows, setRows] = useState(null);
  const check = useCallback(async () => {
    // Commit 70 — these were all GETs, which only ever proved "the file is
    // deployed". A user hit "Calls aren't set up on the server" while this
    // panel cheerfully reported signaling as live, because the thing that
    // was failing was the WRITE path and nothing here ever wrote.
    //
    // The signaling probe is now a POST with deliberately invalid ids. It
    // exercises origin, session, rate limit, payload validation, the
    // self-healing schema, and the thread-membership query — everything a
    // real ring does except the final insert — and a healthy server answers
    // 403 ("not authorized for this call"), which is a pass. A 500 here
    // means the call path is genuinely broken, which is what we needed to
    // be able to see.
    const probes = [
      ["Calling: signaling", "/api/callsignal", "callsignal.js", "POST"],
      ["Calling: ring delivery", "/api/data?resource=incoming-calls", "data.js"],
      ["Calling: network relay", "/api/iceservers", "iceservers.js"],
      ["Trending feed", "/api/trending", "trending.js"],
      // Commit 76 — the card-imagery engine, checked end to end rather
      // than by existence. This is the probe that would have caught "no
      // images in Trending" before it shipped: it asks for a picture of
      // something every source should know about and reports which one
      // actually answered. (Renamed in Commit 92 — this was labelled
      // "Illustrations", which is now the name of a feature that no
      // longer exists. It has always been the photo resolver behind
      // trending cards, which is very much still here.)
      ["Card imagery", "/api/image?q=spiral%20galaxy&debug=1", "image.js", null, "image"],
    ];
    const out = [];
    for (const [label, url, file, method, kind] of probes) {
      let state = "down", detail = "";
      try {
        const res = method === "POST"
          ? await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ threadId: "__probe__", clientId: "__probe__", type: "bye", payload: {} }),
            })
          : await fetch(url);
        // Commit 77 — how "not deployed" actually presents on Cloudflare
        // Pages, learned from a real 405 in the wild.
        //
        // Pages falls back to the static asset handler for any path no
        // Function claims. That handler answers a GET with index.html
        // (HTTP 200 — which is why these probes cheerfully reported "live"
        // for an endpoint that did not exist) and answers a POST with
        // 405 Method Not Allowed, because you cannot POST to a static
        // file. Neither is a 404. So:
        //   • 405 on the POST probe  -> the Function file is missing
        //   • HTML body on a GET     -> the Function file is missing
        // Both now say so by name instead of showing a raw status code.
        const ctype = res.headers.get("content-type") || "";
        if (res.status === 404 || (method === "POST" && res.status === 405)) {
          state = "missing";
          detail = file + " isn't deployed, Cloudflare is serving the app shell for this path";
        }
        else if (res.ok && !ctype.includes("json")) {
          state = "missing";
          detail = file + " isn't deployed: this path returned the page, not the API";
        }
        // 401/403 mean the endpoint EXISTS and answered — it just wants a
        // session or rejected this probe's fake ids. For "is it deployed?"
        // that is a pass, and treating it as a failure would be a false
        // alarm for every signed-out visitor.
        else if (kind === "image" && res.ok) {
          // A 200 with no picture in it is not a healthy illustration
          // engine, it is the exact failure being diagnosed. Report which
          // source answered, or that none did.
          const d = await res.json().catch(() => null);
          const hits = ((d && d.sources) || []).filter((x) => x.result === "hit");
          const errs = ((d && d.sources) || []).filter((x) => x.result === "error");
          if (d && d.image && d.image.url) { state = "ok"; detail = "via " + (d.image.source || "?"); }
          else if (errs.length) { state = "down"; detail = errs[0].source + ": " + (errs[0].error || "error"); }
          else { state = "down"; detail = "no source returned a picture"; }
          if (hits.length) detail = "via " + hits[0].source;
        }
        else if (res.ok || res.status === 401 || res.status === 403 || res.status === 400) { state = "ok"; }
        else {
          state = "down";
          // Carry the server's own explanation through — "HTTP 500" tells
          // nobody anything, and this panel is where someone is sent when
          // a call fails.
          let msg = "";
          try { msg = (await res.json()).error || ""; } catch {}
          detail = msg ? msg.slice(0, 90) : "HTTP " + res.status;
        }
      } catch { state = "down"; detail = "no response"; }
      out.push({ label, state, detail, file });
    }
    setRows(out);
  }, []);
  useEffect(() => { check(); }, [check]);
  const tone = (st) => (st === "ok" ? STATUS.good : st === "missing" ? STATUS.bad : STATUS.warn);
  return (
    <div>
      {(rows || []).map((r) => (
        <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 0", borderBottom: `1px solid ${P.line}` }}>
          <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: tone(r.state), flexShrink: 0 }} />
          <span style={{ fontSize: FONT_SIZES.small, color: P.ink, flex: 1 }}>{r.label}</span>
          <span style={{ fontSize: FONT_SIZES.caption, color: r.state === "ok" ? P.faint : tone(r.state), fontFamily: "var(--cb-mono)" }}>
            {r.state === "ok" ? "live" : r.detail || r.state}
          </span>
        </div>
      ))}
      {!rows && <div style={{ fontSize: FONT_SIZES.small, color: P.faint, padding: "10px 0" }}>Checking…</div>}
      <button onClick={check} style={{
        marginTop: 14, padding: "8px 16px", borderRadius: 100, cursor: "pointer",
        background: "transparent", border: `1px solid ${P.line2}`, color: P.ink2,
        fontSize: FONT_SIZES.caption, fontWeight: 600, fontFamily: "var(--cb-body)",
      }}>Re-check</button>
    </div>
  );
}

/* Commit 91 — the configuration panel.

   Companion to SystemStatus. That one answers "is the code deployed";
   this one answers "did the variables land", which is the question that
   has actually been costing time. Founder-only, presence-only — the
   endpoint never returns a value, only whether one is there.

   The whitespace warning is the important row. A key pasted with a
   trailing newline looks completely correct in the Cloudflare dashboard
   and fails every request, which is exactly how the first TURN attempt
   went. */
function ConfigStatus({ P, accent }) {
  const [state, setState] = useState({ status: "loading", data: null });
  const load = useCallback(async () => {
    setState({ status: "loading", data: null });
    try {
      const r = await fetch("/api/config", { credentials: "include" });
      if (r.status === 403) return setState({ status: "forbidden", data: null });
      if (!r.ok) return setState({ status: "error", data: null });
      const ct = r.headers.get("content-type") || "";
      if (!ct.includes("json")) return setState({ status: "missing", data: null });
      setState({ status: "ready", data: await r.json() });
    } catch {
      setState({ status: "error", data: null });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (state.status === "loading") {
    return <div style={{ fontSize: FONT_SIZES.small, color: P.faint, padding: "10px 0" }}>Checking configuration…</div>;
  }
  if (state.status === "forbidden") {
    return <div style={{ fontSize: FONT_SIZES.small, color: P.faint, padding: "10px 0", lineHeight: 1.6 }}>
      Configuration is visible to the account listed in FOUNDER_EMAIL. If that should be you, check that the variable is set in Cloudflare and matches the address you signed in with.
    </div>;
  }
  if (state.status === "missing") {
    return <div style={{ fontSize: FONT_SIZES.small, color: P.faint, padding: "10px 0", lineHeight: 1.6 }}>
      /api/config isn't answering — functions/api/config.js may not be deployed yet.
    </div>;
  }
  if (state.status !== "ready" || !state.data) {
    return <div style={{ fontSize: FONT_SIZES.small, color: P.faint, padding: "10px 0" }}>
      Couldn't read the configuration just now. <button onClick={load} style={{ background: "none", border: "none", color: accent, cursor: "pointer", font: "inherit", textDecoration: "underline", padding: 0 }}>Try again</button>
    </div>;
  }

  const groups = [];
  for (const v of state.data.vars || []) {
    let g = groups.find((x) => x.name === v.group);
    if (!g) { g = { name: v.group, items: [] }; groups.push(g); }
    g.items.push(v);
  }
  const padded = (state.data.vars || []).filter((v) => v.trimmedDiffers);
  const bindings = state.data.bindings || {};

  const pill = (ok, label) => (
    <span style={{
      flexShrink: 0, fontSize: FONT_SIZES.micro, fontWeight: 700, fontFamily: "var(--cb-mono)",
      padding: "2px 9px", borderRadius: RADIUS.pill,
      color: ok ? accent : P.faint,
      background: ok ? withAlpha(accent, 0.12) : (P.dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)"),
      border: `1px solid ${ok ? withAlpha(accent, 0.3) : P.line}`,
    }}>{label}</span>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {padded.length > 0 && (
        <div style={{
          padding: "12px 14px", borderRadius: RADIUS.md,
          border: `1px solid ${withAlpha(STATUS.bad, 0.4)}`, background: withAlpha(STATUS.bad, 0.08),
          fontSize: FONT_SIZES.caption, color: P.ink, lineHeight: 1.6, fontFamily: "var(--cb-body)",
        }}>
          <strong>{padded.map((v) => v.name).join(", ")}</strong> {padded.length === 1 ? "has" : "have"} a space or newline around the value. That is invisible in the Cloudflare dashboard and will fail every request — re-paste without the trailing character.
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {[["Database", bindings.DB], ["Workers AI", bindings.AI], ["Shared rate limit", bindings.RATE_LIMIT_KV]].map(([label, ok]) => (
          <span key={label} style={{
            display: "inline-flex", alignItems: "center", gap: 7, fontSize: FONT_SIZES.caption,
            padding: "5px 11px", borderRadius: RADIUS.pill, fontFamily: "var(--cb-body)",
            color: ok ? P.ink : P.faint,
            border: `1px solid ${ok ? withAlpha(accent, 0.3) : P.line}`,
            background: ok ? withAlpha(accent, 0.08) : "transparent",
          }}>
            <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: "50%", background: ok ? accent : P.faint }} />
            {label}
          </span>
        ))}
      </div>

      {groups.map((g) => (
        <div key={g.name}>
          <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, color: P.faint, fontFamily: "var(--cb-body)", marginBottom: 6 }}>{g.name}</div>
          {g.items.map((v, i) => (
            <div key={v.name} style={{
              display: "flex", alignItems: "flex-start", gap: 12, padding: "9px 0",
              borderTop: i > 0 ? `1px solid ${P.line}` : "none",
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 600, color: v.present ? P.ink : P.ink2, fontFamily: "var(--cb-mono)" }}>{v.name}</div>
                <div style={{ fontSize: FONT_SIZES.micro, color: P.faint, marginTop: 3, lineHeight: 1.5, fontFamily: "var(--cb-body)" }}>
                  {v.present ? v.does : v.breaks}
                </div>
              </div>
              {pill(v.present, v.present ? "set" : "not set")}
            </div>
          ))}
        </div>
      ))}

      <button onClick={load} style={{
        alignSelf: "flex-start", background: "none", border: `1px solid ${P.line2}`,
        color: P.ink2, cursor: "pointer", fontSize: FONT_SIZES.caption, fontFamily: "var(--cb-body)",
        padding: "6px 14px", borderRadius: RADIUS.pill,
      }}>Re-check</button>
    </div>
  );
}

function SettingsView({ P, accent, at, S, PALETTES, ACCENTS, paletteName, setPaletteName, accentName, setAccentName, customAccent, setCustomAccent, answerLength, setAnswerLength, factCheck, setFactCheck, muted, setMuted, typewriter, setTypewriter, soundMode, setSoundMode, animationMode, setAnimationMode, animSpeed, setAnimSpeed, sfx, setSessions, setSaved, saved, history, setHistory, highContrast, setHighContrast, fontSize, setFontSize, reducedTransparency, setReducedTransparency, autoplay, setAutoplay, dyslexicFont, setDyslexicFont, lineSpacing, setLineSpacing, focusHighlight, setFocusHighlight, citationStyle, setCitationStyle, user, onSignOut, onAccountDeleted, onOpenAuth, initialTab, close, dataDensity, setDataDensity, collections, turns }) {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState(initialTab || "answers");
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false);
  // Commit 67
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState("");
  const [notify, setNotify] = useState(() => notifyPref());
  const [notifPerm, setNotifPerm] = useState(() => {
    try { return "Notification" in window ? Notification.permission : "unsupported"; } catch { return "unsupported"; }
  });
  const [confirmReset, setConfirmReset] = useState(false);
  // Commit 75 — founder diagnostics. Loaded only on the Account tab.
  const [founderStatus, setFounderStatus] = useState(null);
  useEffect(() => {
    if (tab !== "account" || !user) return;
    let dead = false;
    apiDataGet("founder-status").then((d) => { if (!dead && d) setFounderStatus(d); });
    return () => { dead = true; };
  }, [tab, user]);
  const setNotifyKind = (k, v) => {
    const next = { ...notify, [k]: v };
    setNotify(next); setNotifyPref(next); sfx();
  };

  // Commit 67 — watched-topic management on the History & Data tab.
  const [watchlist, setWatchlist] = useState([]);
  const [wlLoading, setWlLoading] = useState(false);
  const loadWatchlist = useCallback(async () => {
    if (!user) { setWatchlist([]); return; }
    setWlLoading(true);
    const d = await apiDataGet("watchlist");
    setWlLoading(false);
    setWatchlist(d && Array.isArray(d.items) ? d.items : []);
  }, [user]);
  // Only fetched when the tab is actually open — this costs a live
  // literature query per topic upstream, and paying for it on every visit
  // to Settings regardless of which tab you wanted would be rude to both
  // the user and Europe PMC.
  useEffect(() => { if (tab === "data") loadWatchlist(); }, [tab, loadWatchlist]);

  // Commit 67 — reset every preference to its default.
  //
  // Deliberately drives the React setters rather than deleting the cb_*
  // cookies and reloading: each setter is already wired to write its own
  // cookie AND apply its live effect (font swap, density, contrast class),
  // so going through them means the page reflects the reset instantly and
  // there is exactly one place that knows how each preference is stored.
  // A cookie-wipe-and-reload would drift the moment a preference gains a
  // side effect.
  function resetAllSettings() {
    // Every value below is copied from that preference's own useState
    // initializer in App() — the cookie-absent default. Getting one wrong
    // would make "reset" quietly set a NEW value rather than restore the
    // original, which is worse than having no reset at all.
    setPaletteName("Sage");         // cb_pal
    setAccentName("Sage");          // cb_accent
    setCustomAccent("");            // cb_ca
    setAnswerLength("medium");      // cb_len
    setFactCheck(true);             // not persisted
    setMuted(false);                // cb_muted !== "1"
    setTypewriter(true);            // cb_tw !== "0"
    setSoundMode("pulse");          // cb_snd
    setAnimationMode("cinematic");  // cb_anim2
    setAnimSpeed(1);                // cb_animS
    setHighContrast(false);         // cb_hc !== "1"
    setFontSize("medium");          // cb_fs
    setReducedTransparency(false);  // cb_rt !== "1"
    setAutoplay(false);             // cb_ap === "1"
    setDyslexicFont(false);         // cb_df !== "1"
    setLineSpacing("normal");       // cb_ls
    setFocusHighlight(false);       // cb_fh !== "1"
    setCitationStyle("vancouver");  // cb_cite
    setDataDensity("comfortable");  // cb_density
    const allOn = { call: true, message: true, watch: true };
    setNotify(allOn); setNotifyPref(allOn);
    setConfirmReset(false);
    sfx();
    toast("Settings reset to defaults.");
  }
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

  async function submitDeleteAccount() {
    setDelBusy(true);
    try { await apiAuth("delete-account", {}); onAccountDeleted(); close(); }
    catch (err) { setPwMsg(err.message || "Couldn't delete account."); setDelBusy(false); }
  }

  // Commit 67 — Notifications is new. Cerebrum raises three kinds of
  // desktop notification (calls, messages, watched-topic alerts) and until
  // now had no in-app control over any of them; see notifyPref/cbNotify.
  // Each tab carries an icon because the desktop layout below is a vertical
  // rail, and a rail of bare words reads as a list of links rather than as
  // navigation.
  /* ══════════════════════════════════════════════════════════════
     Commit 88 — four tabs, not seven.

     Seven sections held about twenty-five settings, so every single one
     was thin: General was four rows, Audio & Voice was three. On a 1000px
     window that rendered as a small block of controls with six hundred
     pixels of empty black beneath it, sitting beside a SECOND vertical
     navigation column immediately to the right of the app's primary one.
     Two rails and a void is what an unfinished settings screen looks
     like, and no amount of alignment fixes a page that has nothing on it.

     Regrouped by the question being asked rather than by the mechanism:
     Answers (what comes back, and how it is read aloud), Appearance (how
     it looks, including everything that was under Accessibility — the
     split between "appearance" and "accessibility" was ours, not the
     user's; someone turning up contrast is doing the same job as someone
     picking a theme), Notifications & data, and Account.

     Nothing was removed. SETTINGS_INDEX below still maps every individual
     row to its tab, so search jumps to the right place.
     ══════════════════════════════════════════════════════════════ */
  const TABS = [
    ["account", "Account", "user"],
    ["answers", "Answers", "settings"],
    ["appearance", "Appearance", "sparkle"],
    ["data", "Notifications & data", "bell"],
  ];

  // Commit 67 — settings search.
  //
  // Seven tabs is past the point where someone can be expected to guess
  // which one holds "reduce transparency". This index is maintained by
  // hand rather than derived from the rendered tree: deriving it would mean
  // rendering every tab's contents on every keystroke to read the labels
  // back out, and a hand-list is honest about the fact that a new setting
  // has to be registered here to be findable.
  const SETTINGS_INDEX = [
    ["Answer length", "answers", "concise standard detailed response verbosity"],
    ["Check answers against their sources", "answers", "verify verification accuracy claims fact check"],
    // Commit 100 — the privacy controls are findable by the words people
    // actually search for when they go looking for them, which is rarely
    // the word on the switch.
    ["Let people find me in search", "account", "privacy discoverable hidden invisible directory find people search"],
    ["Show my institution on my profile", "account", "privacy affiliation university college hide institution"],
    ["Who can start a conversation with you", "account", "privacy dm direct message strangers block messages"],
    ["Animated typing", "answers", "typewriter reveal progressive"],
    ["Citation format", "answers", "apa mla chicago vancouver bibtex reference style"],
    ["Theme", "appearance", "dark light palette colour color"],
    ["Accent color", "appearance", "colour highlight brand"],
    ["Background animation", "appearance", "motion particles effects reduce"],
    ["Data density", "appearance", "compact comfortable spacing padding layout"],
    ["Desktop notifications", "data", "permission browser alerts push"],
    ["Incoming calls", "data", "ring call video audio"],
    ["Direct messages", "data", "inbox dm chat message"],
    ["Watched topics", "data", "papers literature alerts new research"],
    ["High contrast", "appearance", "contrast vision legibility"],
    ["Text size", "appearance", "font size larger bigger zoom"],
    ["Line spacing", "appearance", "leading line height readability"],
    ["Reduce transparency", "appearance", "glass blur frosted solid"],
    ["Focus indicators", "appearance", "keyboard ring outline focus"],
    ["Dyslexia-friendly font", "appearance", "opendyslexic typeface reading"],
    ["Auto-read answers", "appearance", "speech tts read aloud voice"],
    ["Sound effects", "answers", "mute clicks sfx sounds"],
    ["Search ambience", "answers", "tone background ambient sound"],
    ["Text to speech", "answers", "elevenlabs voice narration tts"],
    ["Saved conversations", "data", "history conversations clear delete"],
    ["Saved articles", "data", "papers sources saved storage"],
    ["Watched topics list", "data", "watchlist unwatch topics manage"],
    ["Export workspace", "data", "backup download json export"],
    ["Import workspace", "data", "restore upload json import"],
    ["Reset all settings", "data", "defaults restore factory reset"],
    ["Keyboard shortcuts", "data", "hotkeys keys shortcuts"],
    ["System status", "data", "health uptime api diagnostics"],
    ["Sign out", "account", "logout leave session"],
    ["Delete account", "account", "remove erase danger"],
  ];
  const searchHits = query.trim().length < 2 ? [] : (() => {
    const q = query.trim().toLowerCase();
    return SETTINGS_INDEX
      .map(([label, tabId, kw]) => {
        const l = label.toLowerCase();
        // Rank a prefix match on the label itself above a hit that only
        // matched a keyword, so typing "text" surfaces "Text size" before
        // "Text to speech"'s keyword blob.
        const score = l.startsWith(q) ? 0 : l.includes(q) ? 1 : kw.includes(q) ? 2 : -1;
        return { label, tabId, score };
      })
      .filter((h) => h.score >= 0)
      .sort((a2, b2) => a2.score - b2.score)
      .slice(0, 7);
  })();
  const tabLabel = (id) => (TABS.find((t) => t[0] === id) || [null, id])[1];
  const jumpTo = (hit) => {
    sfx();
    setTab(hit.tabId);
    setQuery("");
    // Flash the row so the eye lands on it — arriving on a tab of twenty
    // controls with no indication which one you searched for is barely
    // better than not searching.
    setHighlight(hit.label);
    setTimeout(() => setHighlight(""), 2400);
  };

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
      {title && <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 600, color: P.faint, marginBottom: 8, paddingLeft: 2, fontFamily: "var(--cb-body)", letterSpacing: "0.01em" }}>{title}</div>}
      <div style={{ background: bg, border: glassBorderS, borderRadius: 8, overflow: "hidden", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}>{children}</div>
      {footer && <div style={{ fontSize: FONT_SIZES.small, color: P.faint, marginTop: 8, paddingLeft: 2, lineHeight: 1.5 }}>{footer}</div>}
    </div>
  );

  // Commit 67 — `highlight` is the label that settings-search just jumped
  // to. The row gets a ring and a wash for a couple of seconds so the eye
  // lands on it; without that, search drops you on a tab of twenty controls
  // with no idea which one you were looking for.
  /* Commit 84 — delegates to UIRow. The only thing this still owns is
     the search-jump highlight, which is Settings-specific. */
  const Row = ({ icon, label, desc, control, onClick, last, destructive }) => {
    const lit = highlight && highlight === label;
    return (
      <UIRow
        P={P} accent={accent} label={label} desc={desc} last={last}
        onClick={onClick} tone={destructive ? "bad" : undefined}
        control={control || (onClick ? <span style={{ color: P.faint, fontSize: FONT_SIZES.subhead }}>›</span> : null)}
        style={lit ? {
          background: withAlpha(accent, 0.16),
          boxShadow: `inset 0 0 0 1px ${withAlpha(accent, 0.6)}, inset 3px 0 0 ${accent}`,
          transition: "background-color 0.35s ease, box-shadow 0.35s ease",
        } : { transition: "background-color 0.35s ease, box-shadow 0.35s ease" }}
      />
    );
  };

  const Switch = ({ on, onChange, label }) => (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => { sfx(); onChange(!on); }}
      style={{ width: 52, height: 44, background: "transparent", border: "none", cursor: "pointer", padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
      <span aria-hidden="true" style={{ width: 44, height: 26, borderRadius: 100, position: "relative", flexShrink: 0, display: "block", background: on ? accent : P.dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.14)", transition: "background 220ms ease" }}>
        <span style={{ position: "absolute", top: 2, left: 2, width: 22, height: 22, borderRadius: "50%", background: "#fff", transform: on ? "translateX(18px)" : "translateX(0)", transition: "transform 220ms cubic-bezier(0.4, 0, 0.2, 1)", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} />
      </span>
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
      {/* 62px of top padding on mobile clears the fixed menu button — see
          pageViewInner's comment; Settings sets its own padding and so
          needed the same correction independently. */}
      <div style={{ width: "100%", maxWidth: isMobile ? 760 : 1020, margin: "0 auto", padding: isMobile ? "62px 18px 60px" : "44px 32px 90px", display: "flex", flexDirection: "column", fontFamily: "var(--cb-body)" }}>

        {/* Header. Settings became a full page (not a dialog) in Commit 62,
            but kept the dialog's horizontally-scrolling tab strip — a
            control that exists because a modal is short on width, on a page
            that has 1020px of it. Desktop now gets a vertical rail; mobile,
            where width really is scarce, keeps the strip. */}
        <div style={{ flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
            <div style={{ fontSize: FONT_SIZES.display, fontWeight: 700, color: P.ink, letterSpacing: "-0.02em", fontFamily: "var(--cb-display)" }}>Settings</div>

            {/* Commit 67 — search. See SETTINGS_INDEX. */}
            <div style={{ position: "relative", flex: isMobile ? "1 1 100%" : "0 1 320px", minWidth: 200 }}>
              <span aria-hidden="true" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: P.faint, display: "inline-flex", pointerEvents: "none" }}>
                <Icon name="search" size={15} />
              </span>
              <input
                value={query} onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { setQuery(""); e.currentTarget.blur(); }
                  if (e.key === "Enter" && searchHits.length) jumpTo(searchHits[0]);
                }}
                placeholder="Search settings"
                aria-label="Search settings"
                style={{
                  width: "100%", padding: "9px 12px 9px 34px", borderRadius: 100,
                  background: P.dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
                  border: `1px solid ${P.line}`, color: P.ink, outline: "none",
                  fontSize: FONT_SIZES.small, fontFamily: "var(--cb-body)",
                }}
              />
              {query.trim().length >= 2 && (
                <div className="cb-fade" style={{
                  position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 20,
                  background: P.bg, border: `1px solid ${P.line2}`, borderRadius: 12,
                  boxShadow: "0 18px 48px rgba(0,0,0,0.35)", overflow: "hidden",
                }}>
                  {searchHits.length === 0 ? (
                    <div style={{ padding: "12px 14px", fontSize: FONT_SIZES.small, color: P.faint }}>
                      Nothing matches that.
                    </div>
                  ) : searchHits.map((h) => (
                    <button key={h.tabId + h.label} onClick={() => jumpTo(h)} className="cb-row" style={{
                      display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", gap: 10,
                      padding: "10px 14px", background: "transparent", border: "none", cursor: "pointer",
                      textAlign: "left", fontFamily: "var(--cb-body)",
                    }}>
                      <span style={{ fontSize: FONT_SIZES.small, color: P.ink, fontWeight: 600 }}>{h.label}</span>
                      <span style={{ fontSize: FONT_SIZES.micro, color: P.faint, fontFamily: "var(--cb-body)", letterSpacing: "0.01em", whiteSpace: "nowrap" }}>{tabLabel(h.tabId)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {isMobile && (
            <div className="cb-scroll-x" style={{ position: "relative", display: "flex", borderBottom: `1px solid ${P.line}`, marginBottom: 18, overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
              {TABS.map(([id, label]) => (
                <button key={id} ref={(el) => { tabBtnRefs.current[id] = el; }} onClick={() => { sfx(); setTab(id); }}
                  style={{ flexShrink: 0, padding: "8px 10px 10px", fontSize: FONT_SIZES.caption, fontWeight: tab === id ? 700 : 500, background: "transparent", color: tab === id ? P.ink : P.faint, border: "none", cursor: "pointer", fontFamily: "var(--cb-body)", letterSpacing: "-0.01em", whiteSpace: "nowrap", transition: "color 200ms ease" }}>{label}</button>
              ))}
              <div aria-hidden="true" style={{ position: "absolute", bottom: -1, left: tabUnderline.left, width: tabUnderline.width, height: 2, background: accent, borderRadius: 8, transition: "left 250ms cubic-bezier(0.4, 0, 0.2, 1), width 250ms cubic-bezier(0.4, 0, 0.2, 1)" }} />
            </div>
          )}
        </div>

        {/* Commit 87 — the settings page used to be a 208px rail and a
            content column pinned to the left of a 1180px workspace, so the
            General tab (four rows) rendered as a small block of controls
            with roughly 600px of empty black to its right and below. Two
            vertical navigation columns side by side, then a void. Capping
            the pair and centring it makes the remaining space read as
            margin rather than as a page that failed to load. The real
            long-term fix is fewer, denser tabs — seven sections for about
            twenty-five settings is why any one of them looks empty. */}
        <div style={{ display: "flex", gap: 30, alignItems: "flex-start", maxWidth: 1000, margin: "0 auto", width: "100%" }}>
          {/* Desktop rail. Sticky, so the navigation stays reachable on the
              long tabs (Appearance and Accessibility both scroll well past
              a viewport) instead of scrolling away and forcing a trip back
              to the top to change section. */}
          {!isMobile && (
            <nav aria-label="Settings sections" style={{ position: "sticky", top: 44, flex: "0 0 208px", display: "flex", flexDirection: "column", gap: 2 }}>
              {TABS.map(([id, label, icon]) => (
                <button key={id} ref={(el) => { tabBtnRefs.current[id] = el; }} onClick={() => { sfx(); setTab(id); }}
                  aria-current={tab === id ? "page" : undefined}
                  className="cb-row"
                  style={{
                    display: "flex", alignItems: "center", gap: 11, width: "100%",
                    padding: "10px 12px", borderRadius: 8, border: "none", cursor: "pointer",
                    textAlign: "left", fontFamily: "var(--cb-body)",
                    fontSize: FONT_SIZES.small, fontWeight: tab === id ? 700 : 500,
                    letterSpacing: "-0.01em",
                    background: tab === id ? withAlpha(accent, 0.11) : "transparent",
                    color: tab === id ? P.ink : P.ink2,
                  }}>
                  <span style={{ display: "inline-flex", color: tab === id ? accent : P.faint, flexShrink: 0 }}>
                    <Icon name={icon} size={16} />
                  </span>
                  {label}
                </button>
              ))}
            </nav>
          )}

        {/* Content */}
        <div key={tab} className="cb-fade" style={{ flex: 1, minWidth: 0, padding: isMobile ? "0 0 16px" : "0 0 16px", overflowY: "auto", WebkitOverflowScrolling: "touch" }}>

          {tab === "account" && (<>
            {!user ? (
              <Section title="Account" footer="An account syncs your library across devices. Guest mode keeps working forever if you'd rather not.">
                <Row label="You're browsing as a guest" desc="Nothing here leaves this browser." control={
                  <button onClick={() => onOpenAuth("login")} style={{ padding: "8px 16px", fontSize: FONT_SIZES.small, fontWeight: 600, background: accent, color: at, border: "none", borderRadius: 8, cursor: "pointer" }}>Sign in</button>
                } last />
              </Section>
            ) : (<>
              <Section title="Account">
                <Row label={user.email} desc="Signed in" last />
              </Section>
              {/* Commit 100 — privacy sits directly under the account it
                  governs, above password and everything else. It is the
                  first thing someone should meet when they come looking for
                  it, not the last section on a scroll. */}
              <PrivacySettings P={P} accent={accent} at={at} sfx={sfx} Section={Section} Row={Row} Switch={Switch} Picker={Picker} />
              {/* The Password section is gone. Cerebrum signs you in with an
                  emailed code and nothing else; the password endpoints behind
                  this form created a credential that no sign-in path would
                  ever accept, while carrying PBKDF2 verification, an account-
                  existence oracle and an unverified-email signup route that
                  let someone claim an address they did not own. A control
                  that does nothing but add attack surface is not a feature. */}
              {/* Commit 75 — the founder badge depends on a Cloudflare
                  environment variable, and an env var is not part of a git
                  push. That is the failure this panel exists to make
                  visible, in the app, instead of over a screenshot. It
                  renders for everyone, because "not configured" is exactly
                  the state the operator needs to see. */}
              {founderStatus && (
                <Section
                  title="Owner verification"
                  footer={
                    !founderStatus.configured
                      ? "Set FOUNDER_EMAIL in Cloudflare Pages → Settings → Environment variables, then redeploy. Pushing code does not set environment variables. That is a separate step in the Cloudflare dashboard."
                      : founderStatus.youAreFounder
                        ? "This account carries the Founder & Owner badge and the verified check."
                        : "FOUNDER_EMAIL is set, but it doesn't match this account's email address. Either change the variable to this account's address, or sign in with the address the variable names."
                  }
                >
                  <Row
                    label="FOUNDER_EMAIL"
                    desc={founderStatus.configured ? `Set to ${founderStatus.configuredValue}` : "Not set on the server"}
                    control={
                      <span style={{
                        fontSize: FONT_SIZES.micro, fontFamily: "var(--cb-mono)", letterSpacing: "0.07em",
                        padding: "4px 10px", borderRadius: 100,
                        color: founderStatus.configured ? STATUS.good : STATUS.bad,
                        background: withAlpha(founderStatus.configured ? STATUS.good : STATUS.bad, 0.12),
                      }}>{founderStatus.configured ? "Configured" : "Missing"}</span>
                    }
                  />
                  <Row label="This account" desc={founderStatus.yourEmail || "—"} />
                  <Row
                    label="Match"
                    desc={founderStatus.matchedUser ? `Resolves to @${founderStatus.matchedUser}` : "No account matches that address"}
                    control={
                      <span style={{
                        fontSize: FONT_SIZES.micro, fontFamily: "var(--cb-mono)", letterSpacing: "0.07em",
                        padding: "4px 10px", borderRadius: 100,
                        color: founderStatus.youAreFounder ? STATUS.good : P.faint,
                        background: withAlpha(founderStatus.youAreFounder ? STATUS.good : P.faint, 0.12),
                      }}>{founderStatus.youAreFounder ? "You" : "No"}</span>
                    }
                    last
                  />
                </Section>
              )}

              <Section title="Session">
                <Row label="Sign out" desc="Switches this browser back to guest mode." onClick={() => { onSignOut(); close(); }} last />
              </Section>
              <Section title="Danger zone" footer="Deletes your email, password, library and history from our servers. Immediately, and for good.">
                {!confirmDeleteAccount ? (
                  <Row label="Delete account" destructive onClick={() => setConfirmDeleteAccount(true)} last />
                ) : (
                  <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <span style={{ fontSize: FONT_SIZES.small, color: STATUS.bad }}>Permanently delete your account and all its data?</span>
                    <span style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                      <button onClick={() => setConfirmDeleteAccount(false)} style={{ padding: "6px 12px", fontSize: FONT_SIZES.small, background: "transparent", color: P.ink2, border: `1px solid ${P.line}`, borderRadius: 8, cursor: "pointer" }}>Cancel</button>
                      <button onClick={submitDeleteAccount} disabled={delBusy} style={{ padding: "6px 12px", fontSize: FONT_SIZES.small, fontWeight: 600, background: STATUS.bad, color: "#fff", border: "none", borderRadius: 8, cursor: delBusy ? "default" : "pointer" }}>{delBusy ? "Deleting…" : "Confirm delete"}</button>
                    </span>
                  </div>
                )}
              </Section>
            </>)}
          </>)}

          {tab === "answers" && (<>
            <Section title="Responses">
              <Row label="Answer length" control={
                <Picker value={answerLength} options={[["short", "Concise"], ["medium", "Standard"], ["long", "Detailed"]]} onChange={setAnswerLength} />
              } />
              <Row label="Check answers against their sources" desc="Before showing an answer, go back through it and confirm each claim really appears in the papers it cites. Adds a few seconds." control={<Switch on={factCheck} onChange={(v) => { sfx(); setFactCheck(v); }} label="Fact-check pass" />} />
              <Row label="Animated typing" desc="Reveal the answer a few words at a time instead of all at once" control={<Switch on={typewriter} onChange={setTypewriter} label="Typing animation" />} />
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
                    style={{ flex: 1, padding: "14px 10px 10px", borderRadius: 8, cursor: "pointer", border: paletteName === pn ? `2px solid ${accent}` : `1px solid ${divider}`, background: PALETTES[pn].bg, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <span style={{ width: 22, height: 22, borderRadius: 8, background: PALETTES[pn].surface, border: `1px solid ${PALETTES[pn].line2}` }} />
                      <span style={{ width: 22, height: 22, borderRadius: 8, background: accent }} />
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
                    style={{ width: 30, height: 30, borderRadius: 8, background: ACCENTS[an], border: (!customAccent && accentName === an) ? "2px solid #fff" : "2px solid transparent", cursor: "pointer", boxShadow: (!customAccent && accentName === an) ? `0 0 0 2px ${ACCENTS[an]}` : "none", transition: "all 150ms ease" }} />
                ))}
                <label style={{ width: 30, height: 30, borderRadius: 8, border: `2px dashed ${P.faint}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }} title="Custom">
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
            <Section title="Motion" footer="Off kills the background entirely.">
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

            <Section title="Layout density" footer="Tighter spacing. Good for long source lists.">
              <Row label="Data density" control={
                <Picker value={dataDensity} options={[["comfortable", "Comfortable"], ["compact", "Compact"]]} onChange={(v) => { sfx(); setDataDensity(v); }} />
              } last />
            </Section>
          </>)}

          {tab === "data" && (<>
            {/* Commit 67. Cerebrum was raising three kinds of desktop
                notification with no way to turn any of them off short of
                revoking the browser permission for all three — see
                notifyPref/cbNotify. */}
            <Section
              title="Desktop notifications"
              footer={
                notifPerm === "unsupported" ? "This browser doesn't support desktop notifications."
                : notifPerm === "denied" ? "Your browser is blocking notifications for this site. Re-allow them in the padlock menu in the address bar: Cerebrum can't undo that from here."
                : notifPerm === "granted" ? "Cerebrum only notifies you while this tab is in the background. Nothing is sent while you're looking at it."
                : "Cerebrum will ask your browser for permission the first time it has something to tell you."
              }
            >
              <Row
                label="Desktop notifications"
                desc={
                  notifPerm === "granted" ? "Allowed by this browser"
                  : notifPerm === "denied" ? "Blocked by this browser"
                  : notifPerm === "unsupported" ? "Not available here"
                  : "Not yet requested"
                }
                control={
                  notifPerm === "default" ? (
                    <button onClick={() => {
                      sfx();
                      try {
                        Notification.requestPermission().then((perm) => setNotifPerm(perm));
                      } catch { setNotifPerm("unsupported"); }
                    }} style={{ padding: "7px 14px", fontSize: FONT_SIZES.small, fontWeight: 600, background: withAlpha(accent, 0.16), color: accent, border: `1px solid ${withAlpha(accent, 0.35)}`, borderRadius: 100, cursor: "pointer", fontFamily: "var(--cb-body)" }}>
                      Allow
                    </button>
                  ) : (
                    <span style={{
                      fontSize: FONT_SIZES.micro, fontFamily: "var(--cb-mono)", letterSpacing: "0.07em",
                      padding: "4px 10px", borderRadius: 100,
                      color: notifPerm === "granted" ? STATUS.good : P.faint,
                      background: withAlpha(notifPerm === "granted" ? STATUS.good : P.faint, 0.12),
                    }}>{notifPerm === "granted" ? "On" : notifPerm === "denied" ? "Blocked" : "Unavailable"}</span>
                  )
                }
                last
              />
            </Section>

            <Section
              title="What to notify me about"
              footer="These are per-browser, like every other preference here. Turning one off stops the notification only. The call still rings in the app, the message still arrives in your Inbox, and the papers still appear on your watchlist."
            >
              <Row label="Incoming calls" desc="Someone is calling you right now" control={
                <Switch on={notify.call} onChange={(v) => setNotifyKind("call", v)} label="Notify me about incoming calls" />
              } />
              <Row label="Direct messages" desc="A new message in a conversation you're part of" control={
                <Switch on={notify.message} onChange={(v) => setNotifyKind("message", v)} label="Notify me about direct messages" />
              } />
              <Row label="Watched topics" desc="New papers indexed on a topic you're watching" control={
                <Switch on={notify.watch} onChange={(v) => setNotifyKind("watch", v)} label="Notify me about watched topics" />
              } last />
            </Section>

            {notifPerm === "granted" && (
              <Section title="Test" footer="Switch tabs after pressing it. Notifications never fire on the page you're looking at.">
                <Row
                  label="Send a test notification"
                  desc="Confirms notifications actually reach your desktop"
                  onClick={() => {
                    sfx();
                    // No `kind`, so this is never filtered by the toggles
                    // above — a test that silently does nothing because of
                    // a setting is worse than no test.
                    setTimeout(() => cbNotify("Cerebrum", "Notifications are working.", "cb-test"), 2500);
                    toast("Switch away from this tab: the test fires in a few seconds.");
                  }}
                  last
                />
              </Section>
            )}
          </>)}

          {/* Commit 88 — folded into Appearance. */}
          {tab === "appearance" && (<>
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

            <Section title="Reading" footer="OpenDyslexic, designed for easier reading with dyslexia.">
              <Row label="Dyslexia-friendly font" desc="Uses OpenDyslexic typeface for body text" control={<Switch on={dyslexicFont} onChange={(v) => { sfx(); if (v) ensureDyslexicFont(); setDyslexicFont(v); }} label="Dyslexic font" />} last />
            </Section>

            <Section title="Audio assistance" footer="Voice selection and playback speed are on the Answers tab.">
              <Row label="Auto-read answers" desc="Reads new answers aloud automatically" control={<Switch on={autoplay} onChange={(v) => { sfx(); setAutoplay(v); }} label="Auto-read" />} last />
            </Section>
          </>)}

          {/* Commit 88 — folded into Answers: how an answer is spoken is part
              of what an answer is. */}
          {tab === "answers" && (<>
            <Section title="Interface sounds">
              <Row label="Sound effects" desc="Click sounds and ambient tones while searching" control={<Switch on={!muted} onChange={(v) => setMuted(!v)} label="Sound effects" />} />
              <Row label="Search ambience" desc="Background tone while a search runs" control={
                <Picker value={soundMode} options={[["pulse", "Pulse"], ["shimmer", "Shimmer"], ["warm", "Warm"], ["minimal", "Minimal"]]} onChange={(v) => { setSoundMode(v); Audio.preview(v); }} />
              } last />
            </Section>

            <Section title="Read answers aloud" footer="The built-in voice is free and needs no setup. ElevenLabs is a paid service with more natural voices; if you have an account there, paste your key and answers will use it instead. The key stays in this browser.">
              <TtsVoiceSetting P={P} accent={accent} at={at} S={S} sfx={sfx} />
              <ElevenLabsSetting P={P} accent={accent} at={at} S={S} sfx={sfx} />
            </Section>
          </>)}

          {tab === "data" && (<>
            <Section title="Conversation history" footer="Kept in this browser. They never leave your device.">
              <Row label="Saved conversations" desc={`${(history || []).length} conversation${(history || []).length === 1 ? "" : "s"} kept`} />
              {(history || []).length > 0 && (
                <Row label="Clear conversation history" destructive control={
                  <button onClick={() => { setHistory([]); sfx(); }} style={{ padding: "6px 14px", fontSize: FONT_SIZES.small, color: STATUS.bad, background: "transparent", border: "none", cursor: "pointer", fontWeight: 500, fontFamily: "var(--cb-body)" }}>Clear</button>
                } last />
              )}
            </Section>

            <Section title="Storage" footer="Stored in this browser. Queries go to our server to run the search: details in Privacy.">
              <Row label="Saved articles" desc={`${saved.length} article${saved.length === 1 ? "" : "s"} saved`} />
              <Row label="Clear all data" destructive control={
                confirmClear
                  ? <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => { setSessions([]); setSaved([]); setHistory([]); setConfirmClear(false); sfx(); }} style={{ padding: "6px 14px", fontSize: FONT_SIZES.small, fontWeight: 600, background: STATUS.bad, color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "var(--cb-body)" }}>Delete</button>
                      <button onClick={() => setConfirmClear(false)} style={{ padding: "6px 14px", fontSize: FONT_SIZES.small, color: P.ink2, background: "transparent", border: `1px solid ${P.line}`, borderRadius: 8, cursor: "pointer", fontFamily: "var(--cb-body)" }}>Cancel</button>
                    </div>
                  : <button onClick={() => setConfirmClear(true)} style={{ padding: "6px 14px", fontSize: FONT_SIZES.small, color: STATUS.bad, background: "transparent", border: "none", cursor: "pointer", fontWeight: 500, fontFamily: "var(--cb-body)" }}>Clear…</button>
              } last />
            </Section>

            {/* Commit 67 — watched topics were manageable only from the
                home screen's deck card, which meant no way to review or
                prune them once the deck stopped showing them all. */}
            {user && (
              <Section title="Watched topics" footer="You'll hear when new papers land. Silence means nothing was published.">
                {wlLoading ? (
                  <Row label="Loading your watchlist…" last />
                ) : watchlist.length === 0 ? (
                  <Row label="You're not watching any topics" desc="Finish an answer and press 'Watch this topic' to start." last />
                ) : (
                  watchlist.map((w, i) => (
                    <Row
                      key={w.id}
                      label={w.topic}
                      desc={
                        w.newCount > 0
                          ? `${w.newCount} new paper${w.newCount === 1 ? "" : "s"} since you looked`
                          : (w.live ? "Nothing new yet" : "Couldn't check just now")
                      }
                      control={
                        <button onClick={async () => {
                          sfx();
                          setWatchlist((prev) => prev.filter((x) => x.id !== w.id));
                          try { await apiDataAction("unwatch-topic", { topic: w.topic }); }
                          catch { loadWatchlist(); }
                        }} style={{ padding: "5px 12px", fontSize: FONT_SIZES.small, fontWeight: 600, background: "transparent", color: P.ink2, border: `1px solid ${P.line2}`, borderRadius: 100, cursor: "pointer", fontFamily: "var(--cb-body)" }}>
                          Unwatch
                        </button>
                      }
                      last={i === watchlist.length - 1}
                    />
                  ))
                )}
              </Section>
            )}

            <Section title="Workspace" footer="Everything, as JSON. Reimport it anywhere.">
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
                }} style={{ padding: "6px 14px", fontSize: FONT_SIZES.small, fontWeight: 600, background: withAlpha(accent, 0.12), color: accent, border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "var(--cb-body)" }}>Export JSON</button>
              } />
              <Row label="Import workspace" desc="Restore from a previously exported file" control={
                <label style={{ padding: "6px 14px", fontSize: FONT_SIZES.small, fontWeight: 600, background: withAlpha(accent, 0.12), color: accent, border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "var(--cb-body)", display: "inline-block" }}>
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

            {/* Commit 67 — there was no way back. Every control on the
                Appearance and Accessibility tabs writes a cookie, and a
                person who changed eight of them experimenting had to
                remember and reverse each one by hand. */}
            <Section title="Preferences" footer="Preferences only. Your library and history are untouched.">
              {!confirmReset ? (
                <Row label="Reset all settings" desc="Puts every preference back to its default" onClick={() => setConfirmReset(true)} last />
              ) : (
                <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: FONT_SIZES.small, color: P.ink2 }}>Reset every preference to its default? Your data stays.</span>
                  <span style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                    <button onClick={() => setConfirmReset(false)} style={{ padding: "6px 12px", fontSize: FONT_SIZES.small, background: "transparent", color: P.ink2, border: `1px solid ${P.line2}`, borderRadius: 100, cursor: "pointer", fontFamily: "var(--cb-body)" }}>Cancel</button>
                    <button onClick={resetAllSettings} style={{ padding: "6px 12px", fontSize: FONT_SIZES.small, fontWeight: 700, background: accent, color: at, border: "none", borderRadius: 100, cursor: "pointer", fontFamily: "var(--cb-body)" }}>Reset</button>
                  </span>
                </div>
              )}
            </Section>

            <Section title="Keyboard shortcuts">
              <div style={{ padding: "4px 0" }}>
                {[[kbdLabel("K"), "Search"], [kbdLabel("J"), "New investigation"], [kbdLabel("B"), "Saved articles"], [kbdLabel("/"), "Settings"], [kbdLabel("D"), "Toggle light / dark"], ["Esc", "Back to search"]].map(([key, desc], i, arr) => (
                  <div key={desc} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: i < arr.length - 1 ? `1px solid ${divider}` : "none" }}>
                    <span style={{ fontSize: FONT_SIZES.body, color: P.ink, fontWeight: 500, fontFamily: "var(--cb-body)" }}>{desc}</span>
                    <kbd style={{ fontSize: FONT_SIZES.small, fontFamily: "var(--cb-mono)", color: P.faint, background: P.dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)", padding: "3px 8px", borderRadius: 8, fontWeight: 500 }}>{key}</kbd>
                  </div>
                ))}
              </div>
            </Section>

            {/* Commit 59 — surfaced here rather than hidden behind a
                developer flag: on this project a feature can be fully built
                and still appear broken because one backend file didn't make
                it into the repo, and until now the only symptom was silence. */}
            <Section title="System status">
              <SystemStatus P={P} accent={accent} />
            </Section>

            {/* Commit 91 — presence of every environment variable the app
                reads, in one place. Founder-only. */}
            <Section title="Configuration" footer="Which environment variables Cloudflare is actually serving. Values are never shown, only whether one is present.">
              <ConfigStatus P={P} accent={accent} />
            </Section>

            <Section title="About">
              <Row label="Version" control={<span style={{ fontSize: FONT_SIZES.body, color: P.faint, fontFamily: "var(--cb-mono)" }}>{APP_VERSION}</span>} />
              <Row label="Built by" control={<span style={{ fontSize: FONT_SIZES.body, color: accent, fontWeight: 500 }}>Vaticay</span>} last />
            </Section>
          </>)}

        </div>
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
    cmdHint: { display: "flex", alignItems: "center", gap: 8, background: P.dark ? withAlpha(P.surface, 0.5) : P.surface, border: glassBorder, color: P.ink2, padding: "7px 10px 7px 14px", borderRadius: 8, cursor: "pointer", fontSize: FONT_SIZES.small, fontFamily: font, fontWeight: 500, letterSpacing: "-0.01em", boxShadow: P.shadowSm, marginRight: 4 },
    kbd: { fontSize: FONT_SIZES.micro, fontFamily: "var(--cb-mono)", color: P.faint, background: P.dark ? withAlpha(P.raised, 0.6) : P.bg, border: `1px solid ${P.line2}`, borderRadius: 8, padding: "2px 6px", fontWeight: 500 },
    ghostBtn: { background: "transparent", border: "none", color: P.ink2, padding: isMobile ? "8px" : "8px 12px", borderRadius: 8, cursor: "pointer", fontSize: FONT_SIZES.small, fontWeight: 500, fontFamily: font },
    iconBtn: { background: "transparent", border: "none", color: P.ink2, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, height: 38, minWidth: isMobile ? 40 : 38, padding: isMobile ? "0 8px" : "0 12px", borderRadius: 8, cursor: "pointer", fontSize: FONT_SIZES.small, fontWeight: 500, fontFamily: "var(--cb-body)", position: "relative" },
    iconBtnLabel: { lineHeight: 1 },
    countPill: { fontSize: FONT_SIZES.micro, fontWeight: 700, lineHeight: 1, background: accent, color: at, padding: "2px 6px", borderRadius: 8, minWidth: 16, textAlign: "center", marginLeft: isMobile ? 0 : -2, position: isMobile ? "absolute" : "static", top: isMobile ? 1 : undefined, right: isMobile ? 1 : undefined },

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
    sidebarSectionLabel: { fontSize: FONT_SIZES.micro, fontWeight: 600, letterSpacing: "0.01em", color: P.faint, fontFamily: "var(--cb-body)", padding: "14px 10px 6px" },
    sidebarItem: {
      display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left",
      padding: "10px 12px", borderRadius: 8, border: "none", background: "transparent",
      color: P.ink2, cursor: "pointer", fontSize: FONT_SIZES.small, fontWeight: 500,
      fontFamily: "var(--cb-body)", transition: "background 150ms ease, color 150ms ease",
    },
    // The active row used to be signalled by a tinted fill alone, which at
    // 14% alpha is nearly invisible against a dark surface and reads as a
    // hover state rather than "you are here." The inset edge is the part
    // that actually carries the signal (it's accent at full strength, and
    // it's the only element on the rail with that shape), with the fill
    // kept as a supporting wash. Two channels, not one — which also means
    // the state survives High Contrast mode flattening the tint.
    sidebarItemActive: {
      background: withAlpha(accent, 0.14), color: P.ink, fontWeight: 600,
      boxShadow: `inset 2px 0 0 ${accent}`,
    },
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
    // Commit 67 (mobile fix) — the floating menu button is fixed at
    // top:14 left:14 and is 38px square, so it occupies the first ~52px of
    // both axes. Page content started at 24px from the top and 18px from
    // the left, which put every page's H1 directly underneath it:
    // "Settings" rendered as "ttings" with a hamburger over the S. Content
    // now starts below the button on mobile.
    pageViewInner: { maxWidth: 920, width: "100%", margin: "0 auto", padding: isMobile ? "62px 18px 60px" : "40px 32px 80px" },
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
    // Commit 66 — compact variants used when the Home Deck has content.
    // See the comment at the hero's <Reveal>.
    heroCompact: {
      flex: "0 0 auto",
      padding: isMobile ? "18px 0 8px" : "20px 0 10px",
    },
    heroTitleCompact: {
      fontSize: isMobile ? 34 : 50,
      marginBottom: 12,
    },
    heroSubCompact: {
      fontSize: FONT_SIZES.small,
      marginBottom: 26,
      color: P.faint,
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
      // This is the one control the entire product exists to serve, and it
      // was the least defined element on the page: an 8%-alpha border and a
      // single 32px shadow at 8% opacity, sitting on top of the animated
      // WebGL field. Against the bright part of that field the border
      // disappeared completely and the bar read as a floating placeholder
      // string with no container around it — verified on a real render, not
      // assumed. Three changes, each doing a specific job:
      //   · the fill goes more opaque, so the aurora passing behind stops
      //     changing the control's own color as it drifts;
      //   · the border roughly doubles in strength, which is what actually
      //     draws the edge on a busy background;
      //   · the flat shadow becomes a layered one — a tight contact shadow
      //     that separates the pill from whatever is directly behind it,
      //     plus a wide ambient shadow that does the lifting, plus a 1px
      //     inset top highlight (the standard glass trick: a lit top edge
      //     is what makes a surface read as raised rather than printed).
      background: P.dark ? "rgba(15, 17, 26, 0.92)" : "rgba(255, 255, 255, 0.94)",
      border: P.dark ? "1px solid rgba(255,255,255,0.15)" : "1px solid rgba(0,0,0,0.13)",
      borderRadius: 100,
      padding: isMobile ? "8px 8px 8px 20px" : "10px 10px 10px 24px",
      boxShadow: P.dark
        ? "inset 0 1px 0 rgba(255,255,255,0.07), 0 2px 8px rgba(0,0,0,0.35), 0 18px 48px rgba(0,0,0,0.45)"
        : "inset 0 1px 0 rgba(255,255,255,0.9), 0 2px 8px rgba(0,0,0,0.06), 0 18px 44px rgba(0,0,0,0.10)",
      transition: "border-color 0.3s ease, box-shadow 0.3s ease, background 0.3s ease",
      position: "relative"
    },
    // Hover previously swapped in P.shadow, a smaller shadow than the rest
    // state above now carries — so hovering the search bar made it sit DOWN
    // rather than respond. Hover now reads as the accent waking up: the
    // border picks up accent tint and the ambient shadow deepens, with the
    // geometry unchanged so nothing shifts under the cursor.
    searchShellActive: {
      borderColor: withAlpha(accent, 0.55),
      boxShadow: P.dark
        ? `inset 0 1px 0 rgba(255,255,255,0.09), 0 2px 10px rgba(0,0,0,0.4), 0 22px 56px rgba(0,0,0,0.5), 0 0 0 4px ${withAlpha(accent, 0.1)}`
        : `inset 0 1px 0 rgba(255,255,255,0.95), 0 2px 10px rgba(0,0,0,0.07), 0 22px 52px rgba(0,0,0,0.12), 0 0 0 4px ${withAlpha(accent, 0.12)}`,
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
    trustItem: { fontSize: FONT_SIZES.caption, fontWeight: 500, color: P.ink2, letterSpacing: "0.01em", fontFamily: "var(--cb-body)" },

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
    workspace: { display: "flex", flexDirection: "column", gap: 0, padding: isMobile ? "32px 0" : "72px 0 48px", paddingBottom: isMobile ? 120 : 48, flex: 1, maxWidth: 980, margin: "0 auto", width: "100%" },
    workspaceMobile: { maxWidth: "100%" },
    // v5: on anything wide enough to spare the room, sources shouldn't live
    // behind a FAB the whole session — that was true on a phone (no room for
    // a second column) but never actually true on desktop, it was just the
    // one drawer pattern doing double duty. Widening the row and giving the
    // sidebar its own fixed column turns "tap to see your sources" into
    // "they're just there," which is the whole point of a research tool.
    workspaceWithSidebar: { flexDirection: "row", alignItems: "flex-start", gap: 44, maxWidth: 1320 },
    thread: { minWidth: 0, flex: 1 },
    sidebarCol: { width: 340, flexShrink: 0 },

    /* ── Turn: clean editorial brief ── */
    turn: { marginBottom: isMobile ? 40 : 56 },
    qLabel: {
      fontSize: FONT_SIZES.micro, fontWeight: 600, letterSpacing: "0.14em",
      color: accent,
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
      borderRadius: 8,
      padding: isCompact ? (isMobile ? "20px 16px" : "32px 40px") : (isMobile ? "32px 24px" : "56px 64px"),
      boxShadow: "0 8px 32px rgba(0,0,0,0.08)",
      lineHeight: 1.7,
      fontSize: isMobile ? FONT_SIZES.subhead : FONT_SIZES.heading,
    },
    byline: {
      fontSize: FONT_SIZES.micro, color: P.faint, 
      paddingTop: 16, marginTop: 20, 
      fontFamily: "var(--cb-mono)", display: "flex",
      letterSpacing: "0.01em",
    },
    aiTag: { fontSize: FONT_SIZES.micro, color: P.faint, fontWeight: 500, letterSpacing: "0.01em", fontFamily: "var(--cb-body)" },
    loading: { display: "flex", alignItems: "center", gap: 12, color: P.ink2, fontSize: FONT_SIZES.body, padding: "14px 0 0" },
    spinner: { width: 16, height: 16, border: `2px solid ${P.line2}`, borderTopColor: accent, borderRadius: "50%", display: "inline-block", animation: "cbspin 0.7s linear infinite" },
    error: {
      padding: "20px 24px", background: withAlpha(STATUS.bad, 0.06), color: STATUS.bad,
      borderRadius: 8, fontSize: FONT_SIZES.body, lineHeight: 1.6,
      border: `1px solid ${withAlpha(STATUS.bad, 0.2)}`,
      display: "flex", alignItems: "flex-start", gap: 12,
      backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
    },
    followShell: { display: "flex", alignItems: "center", gap: 8, background: P.dark ? "rgba(15, 17, 26, 0.75)" : "rgba(255, 255, 255, 0.85)", backdropFilter: "blur(40px) saturate(150%)", WebkitBackdropFilter: "blur(40px) saturate(150%)", border: P.dark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.08)", borderRadius: 8, padding: isMobile ? "10px 8px 10px 16px" : "12px 12px 12px 22px", boxShadow: "0 8px 32px rgba(0,0,0,0.08)", transition: "border-color 0.3s ease, box-shadow 0.3s ease", marginTop: 24 },
    relatedWrap: { marginTop: 32, paddingTop: 28, borderTop: `1px solid ${P.line}` },
    relatedLabel: { fontSize: FONT_SIZES.micro, fontWeight: 600, letterSpacing: "0.01em", color: P.faint, marginBottom: 16, fontFamily: "var(--cb-body)", display: "flex", alignItems: "center", gap: 8 },
    relatedList: { display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 },
    relatedBtn: {
      display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: 12, textAlign: "left", padding: "14px 18px",
      fontSize: FONT_SIZES.small, background: P.dark ? withAlpha(P.surface, 0.5) : P.surface, color: P.ink2,
      border: glassBorder, borderRadius: 8,
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
      borderRadius: 8,
      padding: "20px", boxShadow: "0 8px 32px rgba(0,0,0,0.08)",
      maxHeight: "calc(100dvh - 110px)", overflowY: "auto",
    },
    panelMobile: { position: "fixed", top: 0, right: 0, height: "100dvh", width: isMobile ? "88vw" : "380px", maxWidth: 400, borderRadius: 0, maxHeight: "none", zIndex: 30, boxShadow: "-8px 0 40px rgba(0,0,0,0.5)" },
    srcHead: { display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: FONT_SIZES.caption, fontWeight: 600, color: P.ink, marginBottom: 16, letterSpacing: "0.01em", fontFamily: "var(--cb-body)" },
    srcCount: { fontSize: FONT_SIZES.micro, fontWeight: 700, color: accent, background: withAlpha(accent, 0.1), padding: "3px 8px", borderRadius: 8, fontFamily: "var(--cb-mono)" },
    srcActions: { display: "flex", gap: 6, marginBottom: 12 },
    srcFilterInput: { width: "100%", padding: "9px 12px", fontSize: FONT_SIZES.small, border: glassBorder, background: P.dark ? withAlpha(P.bg, 0.5) : P.bg, color: P.ink, borderRadius: 8, outline: "none", fontFamily: "var(--cb-mono)", marginBottom: 10 },
    sortTabs: { display: "flex", gap: 2, background: P.dark ? withAlpha(P.bg, 0.4) : P.bg, padding: 3, borderRadius: 8, marginBottom: 14, border: `1px solid ${P.line}` },
    sortTab: { flex: 1, padding: "6px", fontSize: FONT_SIZES.caption, background: "transparent", color: P.ink2, border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "var(--cb-mono)", fontWeight: 600, transition: "all 0.2s ease" },
    sortTabActive: { background: P.dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)", color: P.ink, boxShadow: "none", fontWeight: 600 },
    srcGroupLabel: { fontSize: FONT_SIZES.micro, fontWeight: 600, letterSpacing: "0.01em", color: accent, margin: "16px 0 8px", paddingBottom: 6, borderBottom: `1px solid ${P.line}`, fontFamily: "var(--cb-body)" },
    sBtn: { flex: 1, fontSize: FONT_SIZES.caption, padding: "8px", background: P.dark ? withAlpha(P.bg, 0.5) : P.bg, color: P.ink2, border: glassBorder, borderRadius: 8, cursor: "pointer", fontFamily: "var(--cb-mono)", fontWeight: 600 },
    sBtnP: { flex: 1, fontSize: FONT_SIZES.caption, padding: "8px", background: P.ink, color: P.bg, border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontFamily: "var(--cb-mono)" },
    savedNote: { fontSize: FONT_SIZES.caption, color: accent, marginBottom: 12, fontFamily: "var(--cb-mono)" },
    zBox: { background: P.dark ? withAlpha(P.bg, 0.5) : P.bg, border: glassBorder, borderRadius: 8, padding: 12, marginBottom: 12, display: "flex", flexDirection: "column", gap: 8 },
    zIn: { padding: "9px 12px", fontSize: FONT_SIZES.small, border: glassBorder, background: P.dark ? withAlpha(P.surface, 0.4) : P.surface, color: P.ink, borderRadius: 8, outline: "none", fontFamily: "var(--cb-mono)" },
    zMsg: { fontSize: FONT_SIZES.caption, color: accent, fontFamily: "var(--cb-mono)" },
    srcList: { display: "flex", flexDirection: "column", gap: 2 },
    empty: { fontSize: FONT_SIZES.small, color: P.faint, lineHeight: 1.5, padding: "12px 0" },
    srcItem: { padding: isCompact ? "10px 14px" : "16px 14px", margin: "0 -14px", borderRadius: 8, transition: "background 0.25s ease, transform 0.2s ease", borderBottom: `1px solid ${P.line}` },
    // v31: srcTitle was already inheriting the page's body font (`font`,
    // set on `page:` at the root) — never mono to begin with, so nothing to
    // change there. srcMeta was the one actually set to mono; switched to
    // body, since long author lists/journal names in a monospace face read
    // cramped and harder to scan than the same text in the body sans-serif.
    srcTitle: { fontSize: FONT_SIZES.small, textDecoration: "none", lineHeight: 1.45, fontWeight: 600, display: "block", marginBottom: 6, transition: "color 0.2s ease", letterSpacing: "-0.01em" },
    srcMeta: { fontSize: FONT_SIZES.caption, color: P.ink2, lineHeight: 1.5, fontFamily: "var(--cb-body)" },
    srcRow: { display: "flex", gap: 6, marginTop: 10 },
    chipMini: { fontSize: FONT_SIZES.caption, padding: "4px 10px", border: "1px solid", borderRadius: 8, cursor: "pointer", fontFamily: "var(--cb-mono)", fontWeight: 600, background: "transparent", transition: "all 0.2s ease" },
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
    footDbs: { fontSize: FONT_SIZES.micro, letterSpacing: "0.01em", color: P.faint, lineHeight: 1.7, fontFamily: "var(--cb-body)" },

    /* ── Mobile sources FAB ── */
    mobSrcBtn: { position: "fixed", bottom: "calc(18px + env(safe-area-inset-bottom, 0px))", right: 18, background: accent, color: at, border: "none", borderRadius: 8, padding: "14px 20px", fontSize: FONT_SIZES.small, fontWeight: 600, cursor: "pointer", boxShadow: `0 6px 24px ${withAlpha(accent, 0.4)}, 0 2px 8px rgba(0,0,0,0.2)`, zIndex: 20, fontFamily: "var(--cb-mono)", display: "inline-flex", alignItems: "center", gap: 8, backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" },
    scrim: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", zIndex: 25 },

    /* ── Command palette ── */
    cmdWrap: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "14vh", zIndex: 50 },
    cmdBox: { width: 560, maxWidth: "92vw", background: P.dark ? P.surface : P.raised, border: glassBorder, borderRadius: 8, boxShadow: "0 24px 80px rgba(0,0,0,0.6)", overflow: "hidden", fontFamily: font },
    cmdInputRow: { display: "flex", alignItems: "center", gap: 12, padding: "16px 18px", borderBottom: `1px solid ${P.line}` },
    cmdInput: { flex: 1, border: "none", outline: "none", background: "transparent", fontSize: FONT_SIZES.subhead, color: P.ink, fontFamily: "var(--cb-mono)" },
    cmdList: { maxHeight: 340, overflowY: "auto", padding: 8 },
    cmdSection: { fontSize: FONT_SIZES.micro, fontWeight: 600, letterSpacing: "0.01em", color: P.faint, padding: "12px 14px 6px", fontFamily: "var(--cb-body)" },
    cmdItem: { width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", fontSize: FONT_SIZES.small, color: P.ink, background: "transparent", border: "none", borderRadius: 8, cursor: "pointer", fontFamily: font, textAlign: "left", transition: "background 0.15s" },

    /* ── Modals ── */
    modalWrap: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 40, padding: 16 },
    modal: { background: P.dark ? "rgba(15, 17, 26, 0.85)" : "rgba(255, 255, 255, 0.92)", backdropFilter: "blur(40px) saturate(150%)", WebkitBackdropFilter: "blur(40px) saturate(150%)", border: P.dark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.08)", borderRadius: 8, padding: 28, width: 480, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", fontFamily: font, boxShadow: "0 24px 80px rgba(0,0,0,0.6)" },
    modalTitle: { fontSize: FONT_SIZES.display, fontWeight: 400, color: P.ink, marginBottom: 24, letterSpacing: "-0.03em", fontFamily: "var(--cb-display)" },
    // v7.0 cleanup: setLabel/palRow/palCard/accentRow/accentDot/customDot
    // removed — leftovers from an older, untabbed Settings layout with an
    // inline palette/accent picker. The current tabbed Settings (Appearance
    // tab) has its own separate, actually-used markup for both; these six
    // were dead style objects with zero call sites anywhere in the file.
    modalClose: { width: "100%", padding: "13px", fontSize: FONT_SIZES.body, fontWeight: 600, background: accent, color: at, border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "var(--cb-display)" },
    soundGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 4 },
    soundBtn: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", fontSize: FONT_SIZES.small, background: P.dark ? withAlpha(P.bg, 0.5) : P.bg, color: P.ink2, border: glassBorder, borderRadius: 8, cursor: "pointer", fontFamily: "var(--cb-mono)", fontWeight: 600 },
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
      toast("Couldn't copy: try selecting the text manually", { tone: "error" });
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
          background: "rgba(18,20,32,0.96)", color: "#fff", padding: "10px 16px", borderRadius: 8,
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
const Sidebar = React.memo(function Sidebar({ P, accent, at, S, view, onNavigate, isMobile, mobileOpen, onCloseMobile, user, history, saved, collections, threads, muted, onToggleMute, onLogoClick }) {
  /* ══════════════════════════════════════════════════════════════
     Commit 88 — the rail is grouped, and its keys match the router.

     Two problems, one edit. First: this was a flat list of nine items in
     which "New investigation", "Trending", "Saved" and "Settings" carried
     identical weight — no grouping at all, so nothing in the navigation
     told you that three of these are places to work, three hold your own
     material, and two are other people. A flat list is what a nav looks
     like before anybody has thought about it, and at nine items it is past
     the point where scanning is free.

     Second, and load-bearing: the row keys used to be "history", "saved"
     and "findPeople" while the views they opened were modals with no view
     name at all. Now that they navigate, the key IS the view id, so the
     active-row highlight works by construction instead of by a lookup
     table that would silently rot the next time a view was renamed.
     ══════════════════════════════════════════════════════════════ */
  const NAV_GROUPS = [
    { label: null, items: [
      ["new", "New investigation", "plus", null],
      ["search", "Search", "search", null],
    ] },
    { label: "Explore", items: [
      ["document", "Document Mode", "bookOpen", null],
      ["trending", "Trending", "chart", null],
    ] },
    { label: "Your work", items: [
      ["investigations", "Investigations", "history", history.length || null],
      ["library", "Library", "bookmark", saved.length || null],
      ...(user ? [["collections", "Collections", "folder", (collections && collections.length) || null]] : []),
    ] },
    ...(user ? [{ label: "People", items: [
      ["inbox", "Inbox", "mail", threads.filter((t) => t.unread).length || null],
      ["people", "Find people", "network", null],
    ] }] : []),
  ];

  const hoverIn = (e) => { e.currentTarget.style.background = withAlpha(accent, 0.08); };
  const hoverOut = (key) => (e) => { if (view !== key) e.currentTarget.style.background = "transparent"; };
  const itemStyle = (key) => ({ ...S.sidebarItem, ...(view === key ? S.sidebarItemActive : {}) });

  // The rail is persistent chrome, so this fires once on mount rather than
  // on every navigation — a sidebar that re-animates each time you click an
  // item in it reads as a glitch, not as polish. Tighter offset and faster
  // stagger than a page body: chrome should feel like it's already there,
  // just settling, not making an entrance of its own.
  const navRevealRef = useGsapReveal([], { y: 8, stagger: 0.04, duration: 0.6, descend: false });

  const body = (
    <nav ref={navRevealRef} aria-label="Main" style={{ ...S.sidebar, ...(isMobile && mobileOpen ? S.sidebarMobileOpen : {}) }}>
      <div style={S.sidebarBrand} onClick={onLogoClick} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onLogoClick(); } }} aria-label="Back to landing page">
        <Mark size={18} accent={accent} glow={P.dark} />
        <span style={{ fontWeight: 700, fontSize: FONT_SIZES.subhead, color: P.ink, fontFamily: "var(--cb-display)" }}>Cerebrum</span>
      </div>
      <div style={S.sidebarNav}>
        {NAV_GROUPS.map((group, gi) => (
          <React.Fragment key={group.label || `g${gi}`}>
            {group.label && <div style={S.sidebarSectionLabel}>{group.label}</div>}
            {group.items.map(([key, label, icon, badge]) => (
              <button key={key} onClick={() => onNavigate(key)} style={itemStyle(key)} aria-current={view === key ? "page" : undefined}
                onMouseEnter={hoverIn} onMouseLeave={hoverOut(key)}>
                <Icon name={icon} size={17} />
                <span>{label}</span>
                {!!badge && <span style={S.sidebarItemBadge}>{badge}</span>}
              </button>
            ))}
          </React.Fragment>
        ))}
        {/* Settings is deliberately outside the groups and pushed to the
            bottom of the scrolling area: it is the one row that is not a
            place you work, and it was previously sandwiched between Find
            People and the mute toggle as though it were peer to both. */}
        <div style={{ marginTop: "auto", paddingTop: 10 }}>
          <button onClick={() => onNavigate("settings")} style={{ ...itemStyle("settings"), width: "100%" }} onMouseEnter={hoverIn} onMouseLeave={hoverOut("settings")}>
            <Icon name="settings" size={17} /><span>Settings</span>
          </button>
        </div>
      </div>
      {/* ══════════════════════════════════════════════════════════
          Commit 88 — the account is an identity, not a menu row.

          For a product that wants profiles, follows and messages, the
          signed-in person was a 20px circle and the word "Profile" in a
          row styled exactly like Mute directly above it — the two most
          different things in the rail, rendered identically. Every app
          with an account puts the account at one end of the navigation
          and shows you WHO you are signed in as, because the answer to
          "am I in the right account" should never require a click.

          Signed out, the same block is the sign-in call to action rather
          than a row you might not notice.
          ══════════════════════════════════════════════════════════ */}
      <div style={S.sidebarFooter}>
        <button onClick={onToggleMute} style={{ ...S.sidebarItem, marginBottom: 6 }} title={muted ? "Unmute" : "Mute"} onMouseEnter={hoverIn} onMouseLeave={hoverOut("__mute")}>
          <Icon name={muted ? "volumeOff" : "volumeOn"} size={17} />
          <span>{muted ? "Unmute" : "Mute"}</span>
        </button>
        {user ? (
          <button
            onClick={() => onNavigate("profile")}
            aria-current={view === "profile" ? "page" : undefined}
            title="Your profile"
            onMouseEnter={hoverIn} onMouseLeave={hoverOut("profile")}
            style={{
              display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
              padding: "9px 10px", borderRadius: RADIUS.md, cursor: "pointer",
              border: `1px solid ${view === "profile" ? withAlpha(accent, 0.35) : P.line}`,
              background: view === "profile" ? withAlpha(accent, 0.1) : "transparent",
              transition: "background 150ms ease, border-color 150ms ease",
            }}
          >
            <span aria-hidden="true" style={{
              width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              fontSize: FONT_SIZES.caption, fontWeight: 700, fontFamily: "var(--cb-mono)",
              ...avatarSkin(user.email || user.id || "cerebrum"),
            }}>{(user.email || "?")[0].toUpperCase()}</span>
            <span style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 1 }}>
              <span style={{
                fontSize: FONT_SIZES.caption, fontWeight: 700, color: P.ink,
                fontFamily: "var(--cb-body)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>{user.name || (user.email || "").split("@")[0] || "Your profile"}</span>
              <span style={{
                fontSize: FONT_SIZES.micro, color: P.faint, fontFamily: "var(--cb-body)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>{user.email || "Signed in"}</span>
            </span>
            <span aria-hidden="true" style={{ color: P.faint, display: "inline-flex", flexShrink: 0 }}><Icon name="chevronRight" size={14} /></span>
          </button>
        ) : (
          <button
            onClick={() => onNavigate("profile")}
            onMouseEnter={hoverIn} onMouseLeave={hoverOut("profile")}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%",
              padding: "10px 12px", borderRadius: RADIUS.md, cursor: "pointer",
              border: `1px solid ${withAlpha(accent, 0.4)}`, background: withAlpha(accent, 0.1),
              color: P.ink, fontSize: FONT_SIZES.small, fontWeight: 600, fontFamily: "var(--cb-body)",
            }}
          >
            <Icon name="user" size={15} />
            <span>Sign in</span>
          </button>
        )}
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

/* Commit 69 — the consent gate.
   ---------------------------------------------------------------------
   Nobody uses Cerebrum without having been shown, and having actively
   accepted, the Terms, Privacy Policy and Disclosures.

   Three deliberate choices about how this is built:

   1. It BLOCKS. It is not a dismissible banner and not a "by continuing
      you agree" footer, because neither of those is acceptance — they are
      a claim that silence is consent. There is a checkbox, it starts
      unticked, and the Accept button does nothing until it is ticked.

   2. It SUMMARIZES the parts that actually change someone's behaviour —
      AI-generated answers, not medical advice, verify against sources —
      instead of only linking out. A gate whose entire content is "I agree
      to the terms" teaches people to click through without reading. The
      full documents are one tap away and open in a new tab so nobody
      loses their place.

   3. It is KEYED TO A VERSION, not to a boolean. Bumping LEGAL_VERSION
      re-asks everyone, because an agreement to a document someone never
      saw is not an agreement.

   Acceptance is stored in the cb_legal cookie (gates the UI) and, for a
   signed-in account, written to the users row (the durable record — a
   cookie is deletable by the person it is meant to bind). */
function readLegalAccepted() {
  try {
    const raw = getCookie("cb_legal");
    if (!raw) return null;
    const [version, ts] = raw.split("|");
    return { version, acceptedAt: Number(ts) || 0 };
  } catch { return null; }
}
function writeLegalAccepted(version) {
  setCookie("cb_legal", version + "|" + Date.now());
}

function ConsentGate({ P, accent, at, user, serverVersion, onAccepted }) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [declined, setDeclined] = useState(false);
  const isMobile = useIsMobile();
  const panelRef = useRef(null);
  useEffect(() => { try { panelRef.current?.focus(); } catch {} }, []);
  // Nothing behind the gate should scroll while it's up.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const accept = async () => {
    if (!checked || busy) return;
    setBusy(true);
    writeLegalAccepted(LEGAL_VERSION);
    // The server record is best-effort: a signed-in user whose network
    // blips still gets through, because the cookie is what gates the UI
    // and blocking someone out of the app over a failed audit write would
    // be the wrong trade. The next profile load re-syncs it.
    if (user) {
      try { await apiDataAction("accept-terms", { version: LEGAL_VERSION }); } catch {}
    }
    setBusy(false);
    onAccepted();
  };

  const link = (href, label) => (
    <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: accent, textDecoration: "underline", textUnderlineOffset: 3 }}>{label}</a>
  );

  const point = (title, body) => (
    <li style={{ padding: "11px 0", borderTop: `1px solid ${P.line}`, listStyle: "none" }}>
      <div style={{ fontSize: FONT_SIZES.small, fontWeight: 700, color: P.ink, marginBottom: 3 }}>{title}</div>
      <div style={{ fontSize: FONT_SIZES.small, color: P.ink2, lineHeight: 1.55 }}>{body}</div>
    </li>
  );

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="cb-consent-title" style={{
      position: "fixed", inset: 0, zIndex: 9000,
      background: P.dark ? "rgba(0,0,0,0.86)" : "rgba(20,24,28,0.72)",
      backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: isMobile ? 16 : 28, overflowY: "auto",
    }}>
      <div ref={panelRef} tabIndex={-1} className="cb-modal" style={{
        width: "100%", maxWidth: 560, background: P.bg, color: P.ink,
        border: `1px solid ${P.line2}`, borderRadius: 16, outline: "none",
        boxShadow: "0 30px 90px rgba(0,0,0,0.55)",
        padding: isMobile ? "26px 20px 22px" : "32px 34px 26px",
        fontFamily: "var(--cb-body)", maxHeight: "94vh", overflowY: "auto",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 18 }}>
          <Mark size={26} accent={accent} glow={P.dark} />
          <span style={{ fontSize: FONT_SIZES.subhead, fontWeight: 700, fontFamily: "var(--cb-display)", letterSpacing: "-0.02em" }}>Cerebrum</span>
        </div>

        {declined ? (
          <>
            <h2 id="cb-consent-title" style={{ fontSize: FONT_SIZES.heading, fontWeight: 700, letterSpacing: "-0.02em", margin: "0 0 12px", fontFamily: "var(--cb-display)" }}>
              That's completely fine
            </h2>
            <p style={{ fontSize: FONT_SIZES.small, color: P.ink2, lineHeight: 1.65, margin: "0 0 20px" }}>
              Cerebrum can't be used without agreeing to these terms — that isn't a pressure tactic, it's just what the agreement is for. Nothing has been stored, and you can come back any time. If something in the documents is the reason you said no, {link("mailto:contact@askcerebrum.org", "tell us which part")} — that's genuinely useful feedback.
            </p>
            <button onClick={() => setDeclined(false)} className="cb-press" style={{
              width: "100%", padding: "12px 18px", borderRadius: 100, cursor: "pointer",
              background: "transparent", color: P.ink, border: `1px solid ${P.line2}`,
              fontSize: FONT_SIZES.small, fontWeight: 700, fontFamily: "var(--cb-body)",
            }}>Back</button>
          </>
        ) : (
          <>
            <h2 id="cb-consent-title" style={{ fontSize: FONT_SIZES.heading, fontWeight: 700, letterSpacing: "-0.02em", margin: "0 0 8px", fontFamily: "var(--cb-display)", lineHeight: 1.2 }}>
              {serverVersion ? "We've updated our terms" : "Before you start"}
            </h2>
            <p style={{ fontSize: FONT_SIZES.small, color: P.ink2, lineHeight: 1.65, margin: "0 0 4px" }}>
              {serverVersion
                ? "Our Terms, Privacy Policy and Disclosures have changed materially since you last accepted them. Please review and accept the new version to continue."
                : "Cerebrum is free and collects as little as it can. Three things are worth knowing before your first search. They take fifteen seconds and they matter."}
            </p>

            <ul style={{ margin: "16px 0 0", padding: 0 }}>
              {point("Answers are written by AI, not by scientists",
                "A language model summarizes papers it retrieved a moment ago. It can misread a study, merge two findings, or cite the wrong source in fluent, confident prose. Every claim is a lead to check, not a finding to quote.")}
              {point("This is not medical, legal, or financial advice",
                "Cerebrum is not a doctor, a lawyer, or an adviser, and no professional relationship is created by using it. Never delay or override professional advice because of something you read here. In an emergency, call your local emergency number.")}
              {point("Verify against the cited sources",
                "Every answer links to the papers behind it. Those links are the point of the product: if something matters, open it and read the original.")}
            </ul>

            <div style={{ borderTop: `1px solid ${P.line}`, marginTop: 4, paddingTop: 16 }}>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 11, cursor: "pointer" }}>
                <input
                  type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)}
                  style={{ width: 18, height: 18, minHeight: 18, marginTop: 2, accentColor: accent, cursor: "pointer", flexShrink: 0 }}
                />
                <span style={{ fontSize: FONT_SIZES.small, color: P.ink, lineHeight: 1.6 }}>
                  I have read and agree to the {link("/terms", "Terms of Service")}, the {link("/privacy", "Privacy Policy")}, and the {link("/disclosures", "Disclosures")}, and I understand that Cerebrum's answers are AI-generated and are not professional advice.
                </span>
              </label>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 20, flexWrap: "wrap" }}>
              <button
                onClick={accept} disabled={!checked || busy}
                className="cb-press"
                style={{
                  flex: 1, minWidth: 180, padding: "13px 20px", borderRadius: 100,
                  border: "none", cursor: checked && !busy ? "pointer" : "not-allowed",
                  background: checked ? accent : (P.dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)"),
                  color: checked ? at : P.faint,
                  fontSize: FONT_SIZES.small, fontWeight: 700, fontFamily: "var(--cb-body)",
                  transition: "background 0.22s ease, color 0.22s ease",
                }}
              >{busy ? "Saving…" : "Agree and continue"}</button>
              <button onClick={() => setDeclined(true)} className="cb-press" style={{
                padding: "13px 18px", borderRadius: 100, cursor: "pointer",
                background: "transparent", color: P.ink2, border: `1px solid ${P.line2}`,
                fontSize: FONT_SIZES.small, fontWeight: 600, fontFamily: "var(--cb-body)",
              }}>Decline</button>
            </div>

            <div style={{ fontSize: FONT_SIZES.micro, color: P.faint, fontFamily: "var(--cb-mono)", marginTop: 14, textAlign: "center" }}>
              Version {LEGAL_VERSION} · You must be 13 or older (16 in the EEA and UK)
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function App() {
  const isMobile = useIsMobile();
  const [entered, setEntered] = useState(false);
  // V5 "what's new" announcement — shows once per browser, the first time
  // someone lands on the main app after this ships. Keyed off its own
  // localStorage flag rather than the entry cookie above, since a returning
  // user who already has cb_entered_v5 set (nothing to re-trigger) still
  // needs to see it exactly once.
  /* ══════════════════════════════════════════════════════════════
     Commit 92 — the invisible modal that froze the page.

     `v5Open` was set to true on every first visit and NOTHING RENDERED IT.
     The what's-new announcement it belonged to was removed in an earlier
     refactor; this state, and its entry in the scroll-lock effect below,
     were left behind. Nothing ever wrote cb_seen_v6 either, so the flag
     could never clear.

     The consequence was not a stray popup. anyOverlayOpen went true, the
     scroll lock pinned document.body to position:fixed / overflow:hidden,
     and there was no dialog on screen to close — so every genuinely
     first-time visitor to askcerebrum.org got a page that could not be
     scrolled, with nothing to dismiss. Verified: body position fixed,
     overflow hidden, zero elements with role="dialog", scrollY stuck at 0
     through a 1200px wheel event.

     It survived this long because every test fixture in this project
     seeds cb_seen_v6 = "1" in localStorage before the first paint, which
     is the one value that hides it. A fixture written to skip an
     announcement was masking a bug that broke the whole page.
     ══════════════════════════════════════════════════════════════ */
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
  // Commit 100 — hubOpen/activeHubName removed with InstitutionModal.
  const [viewingProfileId, setViewingProfileId] = useState(null);
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
  // Commit 47: a huddle used to be InboxView-local state, which meant
  // navigating to any other tab unmounted InboxView and killed the call —
  // there was no way to keep talking while checking Settings or starting a
  // new search. Lifted to App level and rendered once at the app root (see
  // the bottom of this return) so the same mounted VideoHuddle survives a
  // `view` change; it minimizes to a small floating bubble instead of
  // disappearing. `null` = no call. `{ name, roomSeed }` = active.
  const [activeHuddle, setActiveHuddle] = useState(null);
  // The call currently ringing at THIS client, or null. Polled below.
  const [incomingCall, setIncomingCall] = useState(null);
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
  // Commit 92 — holds the source list for the evidence table (was the
  // query string for the illustration generator).
  const [evidenceTableSources, setEvidenceTableSources] = useState(null);

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
        bio: profileRes.user.bio || "",
        cover: profileRes.user.cover || "",
        link_site: profileRes.user.link_site || "",
        link_orcid: profileRes.user.link_orcid || "",
        link_scholar: profileRes.user.link_scholar || "",
      }));
      setProfileMeta({ followers: profileRes.followers || 0, badges: profileRes.badges || [] });
      // Accepted on another device? Don't ask again here — write the
      // cookie so this browser matches the account's real state. The
      // reverse (cookie accepted, account not) is handled when the gate
      // itself posts accept-terms.
      if (profileRes.termsVersion === LEGAL_VERSION) {
        try { writeLegalAccepted(LEGAL_VERSION); } catch {}
        setLegalOk(true);
      } else {
        // Reconciliation, and it matters more than it looks.
        //
        // The gate can be accepted BEFORE the session has resolved — on a
        // cold load the dialog is interactive within a frame or two, while
        // whoami is still in flight, so `user` is null when accept-terms
        // would have been posted and the durable record is silently never
        // written. It also covers the ordinary case of someone accepting
        // as a guest and signing in afterwards.
        //
        // So: whenever a profile loads and the account's recorded version
        // is behind what this browser has already accepted, write it. The
        // cookie is the claim; this is what makes it evidence.
        const local = readLegalAccepted();
        if (local && local.version === LEGAL_VERSION) {
          apiDataAction("accept-terms", { version: LEGAL_VERSION }).catch(() => {});
        }
      }
    }
    setThreads(inboxRes?.items || []);
    if (serverSaved.length > 0 || serverHist.length > 0) {
      // This account already has data (a returning session, or a second
      // device) — the server copy wins over whatever's in this browser.
      // Commit 66 — the server row's `id` and `createdAt` are dropped here
      // (they're server-side identity, and the client's replace-all sync
      // pushes this array straight back), but WHEN a paper was saved is real
      // information the interface needs: the Home Deck's "Saved, not
      // revisited" card is built on it, and stripping it meant nothing could
      // ever qualify. Carried across as `savedAt`, a plain field on the
      // source object, so it round-trips through source_json without
      // colliding with the server's own column.
      setSaved(serverSaved.map(({ id, createdAt, ...rest }) => (
        rest.savedAt ? rest : { ...rest, savedAt: createdAt }
      )));
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
  // v5: destructive-delete confirmation used to be inconsistent three ways —
  // Settings' "Clear all data" had a real inline confirm, Saved's "Clear
  // all" popped a jarring unstyled native browser confirm() (the only place
  // in this whole custom-designed app that happened), and History's
  // per-item "Delete" had no confirmation at all. One pattern now: an
  // inline Cancel/Delete swap, same as Settings already had.
  const [confirmClearSaved, setConfirmClearSaved] = useState(false);
  // Commit 88 — library page state. A modal that showed everything at once
  // never needed these; a page that can hold a few hundred papers does.
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
    if (file.size > 8_000_000) { setError("That image is too large: try one under 8MB."); return; }
    const reader = new FileReader();
    reader.onload = () => { setAttachedImage(reader.result); setAttachedImageName(file.name); };
    reader.onerror = () => setError("Couldn't read that image: try another file.");
    reader.readAsDataURL(file);
  }
  const [turns, setTurns] = useState([]);
  const [pinnedSources, setPinnedSources] = useState([]);
  const [corrections, setCorrections] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [allSources, setAllSources] = useState([]);
  const [saved, setSaved] = useState(() => { try { return JSON.parse(localStorage.getItem("cb_saved") || "[]"); } catch { return []; } });

  /* Commit 88 — these derive from `history` and `saved`, so they must be
     declared after both. Placing them next to confirmClearSaved (which is
     above the `saved` useState) put `saved` in its own temporal dead zone
     and the whole app threw on mount. */
  const [historyQuery, setHistoryQuery] = useState("");
  const visibleHistory = useMemo(() => {
    const q = historyQuery.trim().toLowerCase();
    if (!q) return history;
    return history.filter((h) => String(h.title || "").toLowerCase().includes(q)
      || (h.turns || []).some((t) => String(t.q || "").toLowerCase().includes(q)));
  }, [history, historyQuery]);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [librarySort, setLibrarySort] = useState("recent");
  const visibleSaved = useMemo(() => {
    const q = libraryQuery.trim().toLowerCase();
    const list = q
      ? saved.filter((sv) => [sv.title, sv.authors, sv.journal].filter(Boolean).join(" ").toLowerCase().includes(q))
      : saved.slice();
    if (librarySort === "title") return list.sort((x, y) => String(x.title || "").localeCompare(String(y.title || "")));
    if (librarySort === "year") return list.sort((x, y) => (Number(y.year) || 0) - (Number(x.year) || 0));
    // "recent" = when YOU saved it. savedAt was added in Commit 67; anything
    // predating that falls back to createdAt so old libraries still order.
    return list.sort((x, y) => (y.savedAt || y.createdAt || 0) - (x.savedAt || x.createdAt || 0));
  }, [saved, libraryQuery, librarySort]);

  const [sessions, setSessions] = useState([]);
  const [mobilePanel, setMobilePanel] = useState(false);
  const [suggestions, setSuggestions] = useState(pick());
  const chipsPausedRef = useRef(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState("answers");
  const [drawerSource, setDrawerSource] = useState(null);
  const [focusedSourceIdx, setFocusedSourceIdx] = useState(-1);
  const [evidenceFilter, setEvidenceFilter] = useState("all");
  /* Commit 83 — the instrument's operations.
     `askMode` is the verb the person picked on the welcome screen. It is
     sent with the query and changes the SHAPE of the answer server-side
     (see MODE_STRUCTURES in functions/api/search.js), not just the
     wording of the prompt — "compare" returns a comparison, "verify"
     returns a verdict. A chatbot has one output shape; this is what
     having more than one looks like. */
  const [askMode, setAskMode] = useState("explain");
  const [evidenceScrollRef, evidenceMask] = useEdgeMask();
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
  // Commit 67 — default flipped to OFF. It read `!== "0"` (default ON), which
  // was harmless only because nothing consumed it (see AnswerPlayer's
  // autoPlay comment). Now that the switch actually works, shipping it ON
  // would mean every existing user suddenly has answers read aloud at them
  // without ever having asked for it.
  /* Commit 85 — a one-time reset of "Auto-read answers".

     Before Commit 67 this preference defaulted to ON and wrote cb_ap=1 on
     first load, but nothing read it: it was a dead switch, so nobody ever
     heard anything and nobody ever turned it off. Commit 67 wired it up.
     The result is that every person who had opened Cerebrum even once
     before that was carrying cb_ap=1, and the moment narration started
     working they got answers read aloud at them unprompted, with no idea
     which setting was doing it.

     cb_ap_v marks a cb_ap value that was actually chosen by a human under
     the working switch. Without it the stored value is an artifact of the
     dead switch, not a preference, so it is discarded and auto-read starts
     off. Anyone who genuinely wants it turns it on once and it sticks. */
  const [askedThisSession, setAskedThisSession] = useState(false);
  const [autoplay, setAutoplay] = useState(() => {
    try {
      if (getCookie("cb_ap_v") !== "2") {
        setCookie("cb_ap", "0");
        setCookie("cb_ap_v", "2");
        return false;
      }
    } catch {}
    return getCookie("cb_ap") === "1";
  });
  const [dyslexicFont, setDyslexicFont] = useState(() => getCookie("cb_df") === "1");
  const [lineSpacing, setLineSpacing] = useState(() => getCookie("cb_ls") || "normal");
  const [focusHighlight, setFocusHighlight] = useState(() => getCookie("cb_fh") === "1");
  const [paletteName, setPaletteName] = useState(() => getCookie("cb_pal") || "Sage");
  const [accentName, setAccentName] = useState(() => getCookie("cb_accent") || "Sage");
  const [customAccent, setCustomAccent] = useState(() => getCookie("cb_ca") || "");
  const [hover, setHover] = useState("");
  const [hoverCite, setHoverCite] = useState(0);
  // Commit 65 — bumped whenever a topic is watched or unwatched, so the
  // home-screen watchlist reflects it without a page reload.
  const [watchKey, setWatchKey] = useState(0);
  // Commit 69 — the consent gate. `legalOk` is true once this browser has
  // accepted the current LEGAL_VERSION. It is seeded from the cookie so a
  // returning user never sees a flash of the gate before it resolves.
  const [legalOk, setLegalOk] = useState(() => {
    const a2 = readLegalAccepted();
    return !!(a2 && a2.version === LEGAL_VERSION);
  });
  // Commit 66 — true once this account has anything of its own to show on
  // the Home Deck. Drives the compact hero; see the comment at its
  // <Reveal>. Deliberately does NOT include the watchlist: that loads
  // asynchronously inside WatchList, and keying the hero's height on it
  // would make the whole page jump a second after paint.
  const deckHasContent = !!(user && ((history && history.length) || (saved && saved.length)));
  // Commit 87 — the greeting hero. A display name is whatever the person
  // actually put in their profile; falling back to the email local-part
  // would greet someone as "dustybreen2", which is worse than no name.
  const firstName = (() => {
    const raw = (profile && (profile.display_name || profile.displayName)) || (user && user.name) || "";
    const first = String(raw).trim().split(/\s+/)[0] || "";
    return first.length > 1 && first.length <= 18 ? first : "";
  })();
  const streakDays = (() => { try { return readStreak().days || 0; } catch { return 0; } })();
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
    // Counts a day only when a real investigation runs — not for opening
    // the app. See readStreak/bumpStreak for why that distinction matters.
    try { bumpStreak(); } catch {}
    const question = (q ?? input).trim();
    const imageToSend = attachedImage;
    if ((!question && !imageToSend) || busy) return;
    // Commit 85 — auto-read is for an answer the reader just asked for, not
    // for one restored from history. Reopening a saved investigation was
    // enough to start narrating its last answer at you, unprompted, which
    // is most of what "it is also automatically playing TTS" is. Narration
    // now requires an ask in THIS session.
    setAskedThisSession(true);
    if (!mutedRef.current) Audio.click();
    setInput(""); setAttachedImage(null); setAttachedImageName(""); setBusy(true); setError(""); setCmdOpen(false); if (isMobile) setMobilePanel(false);
    const prior = [];
    turns.slice(-10).forEach((t) => { prior.push({ role: "user", content: t.q }); prior.push({ role: "assistant", content: t.answer, sources: t.sources || [] }); });
    try {
      const priorUserTurn = [...turns].reverse().find((t) => t && t.q);
      const videoQuery = (priorUserTurn && priorUserTurn.q && looksLikeFollowupText(question)) ? priorUserTurn.q + " " + question : question;
      const videosPromise = imageToSend ? Promise.resolve({ videos: [] }) : fetch("/api/videos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: videoQuery }) }).then((r) => r.ok ? r.json() : { videos: [] }).catch(() => ({ videos: [] }));
      const res = await fetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: question, mode: askMode, image: imageToSend || undefined, history: prior, settings: { answerLength, factCheck, evidenceFilter: evidenceFilter !== "all" ? evidenceFilter : undefined }, pinnedSources, corrections }) });
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
      const nt = { id: turnId, answerId: data.answerId || "", sourcesQueried: Array.isArray(data.sourcesQueried) ? data.sourcesQueried : null, q: question || "What does this image show?", hasImage: !!imageToSend, answer: data.answer || "", sources: data.sources || [], videos: data.videos || [], source: data.source || "", factCheck: data.factCheck || null, literatureConflicts: data.literature_conflicts || null, related: data.related || [], suggestions: data.suggestions || [], fresh: typewriter };
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
      if (view !== "search" || cmdOpen || authOpen || collectionsOpen) return;
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
  }, [allSources, focusedSourceIdx, drawerSource, view, cmdOpen, authOpen, collectionsOpen]);

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
      const attributed = text + "\n\n, References, \n" + refs.join("\n") + "\n\nRetrieved via Cerebrum (askcerebrum.org)";
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
    const anyOverlayOpen = cmdOpen || howItWorksOpen || mobilePanel
      || authOpen || collectionsOpen || compareOpen || !!networkGraphSources || !!timelineSources || !!evidenceTableSources || !!importPrompt || !!drawerSource;
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
  }, [cmdOpen, howItWorksOpen, mobilePanel, authOpen, collectionsOpen, compareOpen, networkGraphSources, timelineSources, evidenceTableSources, importPrompt, drawerSource]);
  useEffect(() => { setCookie("cb_snd", soundMode); }, [soundMode]);
  useEffect(() => { setCookie("cb_len", answerLength); }, [answerLength]);
  useEffect(() => { setCookie("cb_fc", factCheck ? "1" : "0"); }, [factCheck]);
  useEffect(() => { setCookie("cb_muted", muted ? "1" : "0"); }, [muted]);
  useEffect(() => { setCookie("cb_tw", typewriter ? "1" : "0"); }, [typewriter]);
  useEffect(() => { setCookie("cb_cite", citationStyle); }, [citationStyle]);
  // Commit 54 — app-wide "is anyone calling me right now?" poll. This is
  // the piece that turns a video huddle into something you can actually
  // receive: it runs for any signed-in user on any screen, so a call
  // reaches someone reading a paper or in Settings, not only someone who
  // happens to be staring at the same Inbox thread.
  //
  // Suspended while a huddle is already open — you can't be rung by a call
  // you're on, and it stops the accepted call from immediately re-ringing
  // itself from its own leftover heartbeat rows.
  //
  // 3s matches the caller's ring heartbeat; the server only returns rings
  // from the last ~9s, so a caller who hangs up, closes the tab or drops
  // off the network stops ringing here within a poll or two with nothing to
  // clean up. No push notifications involved — this is in-app only, which
  // is exactly the "if they have Cerebrum open" case.
  const userId = user?.id ?? null;
  const huddleOpen = !!activeHuddle;
  useEffect(() => {
    if (!userId || huddleOpen) { setIncomingCall(null); return; }
    let cancelled = false;
    const tick = async () => {
      try {
        const data = await apiDataGet("incoming-calls");
        if (cancelled) return;
        const call = data && data.call ? data.call : null;
        // Only on the transition into ringing, not on every poll — the
        // poll runs every 3s and a notification per poll would be abuse.
        setIncomingCall((prev) => {
          if (call && (!prev || prev.threadId !== call.threadId)) {
            cbNotify("Incoming call", `${call.fromName} is calling you on Cerebrum`, "cb-call", "call");
          }
          return call;
        });
      } catch { /* a failed poll is just "no call right now" */ }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => { cancelled = true; clearInterval(id); };
    // Depends on primitives, NOT on the `user` / `activeHuddle` objects.
    // That is not a style preference — it was the bug. App rebuilds its
    // `user` object on its own cadence (profile refreshes, inbox polls), so
    // an effect keyed on the object identity tore down and restarted every
    // few hundred milliseconds. Each restart fired a fresh fetch and each
    // teardown flipped `cancelled`, so the in-flight poll was almost always
    // discarded on arrival: the request went out, the server answered with a
    // real ringing call, and the handler returned early without ever calling
    // setIncomingCall. Verified in a browser — the network tab showed the
    // call arriving while nothing appeared on screen. Keying on user.id and
    // a boolean keeps one long-lived interval that actually gets to finish.
  }, [userId, huddleOpen]);

  useEffect(() => { setCookie("cb_anim2", animationMode); }, [animationMode]);
  useEffect(() => { const t = setTimeout(() => setCookie("cb_animS", String(animSpeed)), 500); return () => clearTimeout(t); }, [animSpeed]);
  useEffect(() => { setCookie("cb_pal", paletteName); }, [paletteName]);
  useEffect(() => { setCookie("cb_accent", accentName); }, [accentName]);
  useEffect(() => { setCookie("cb_density", dataDensity); }, [dataDensity]);
  useEffect(() => { setCookie("cb_ca", customAccent); }, [customAccent]);
  useEffect(() => { setCookie("cb_hc", highContrast ? "1" : "0"); }, [highContrast]);
  useEffect(() => { setCookie("cb_fs", fontSize); }, [fontSize]);
  useEffect(() => { setCookie("cb_rt", reducedTransparency ? "1" : "0"); }, [reducedTransparency]);
  useEffect(() => { setCookie("cb_ap", autoplay ? "1" : "0"); setCookie("cb_ap_v", "2"); }, [autoplay]);
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
      // Commit 88 — Escape used to close the saved/history dialogs AND
      // reset the view. Those are pages now, so it just returns you to
      // search, and the two confirm-states are cleared so a half-armed
      // "delete everything" never survives a navigation.
      else if (e.key === "Escape") { setCmdOpen(false); setMobilePanel(false); setConfirmClearSaved(false); setHistoryConfirmId(null); setView((v) => (v === "search" ? v : "search")); }
      else if ((e.metaKey || e.ctrlKey) && e.key === "/") { e.preventDefault(); setView((v) => (v === "settings" ? "search" : "settings")); }
      else if ((e.metaKey || e.ctrlKey) && e.key === "j") { e.preventDefault(); newSession(); }
      else if ((e.metaKey || e.ctrlKey) && e.key === "d") { e.preventDefault(); setPaletteName(P.dark ? "Light" : "Dark"); }
      else if ((e.metaKey || e.ctrlKey) && e.key === "b") { e.preventDefault(); setView((v) => (v === "library" ? "search" : "library")); }
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
        bio: profile.bio || "",
        cover: profile.cover || "",
        link_site: profile.link_site || "",
        link_orcid: profile.link_orcid || "",
        link_scholar: profile.link_scholar || "",
      }).catch((e) => toast(e.message || "Couldn't save your profile changes.", { tone: "error" }));
    }, 900);
    return () => clearTimeout(profileSyncTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.name, profile.username, profile.affiliation, profile.degree, profile.grad_year, profile.bio, profile.cover, profile.link_site, profile.link_orcid, profile.link_scholar, user, syncReady]);

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
    setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, left: 0, behavior: "instant" }), 60);
  }
  // Single dispatch point for every Sidebar item. Four destinations (search,
  // trending, settings, profile) swap the full-page `view`; the rest open
  // their existing dialog exactly as the old header buttons did — moving
  // here only relocated the trigger, not the underlying feature.
  function handleSidebarNavigate(key) {
    sfx();
    if (isMobile) setSidebarMobileOpen(false);
    // Commit 99 — belt and braces. Document Mode's overlay used to eat every
    // nav press while it was up, and any future full-screen overlay would do
    // the same silently. Navigation is the one action that must always win,
    // so anything covering the shell is dismissed before the destination
    // changes rather than being left to each case to remember.
    setNotebookOpen(false);
    switch (key) {
      case "new": newSession(); setView("search"); break;
      case "search": setView("search"); break;
      case "document": setView("document"); break;
      case "trending": setView("trending"); break;
      /* Commit 88 — these four were setHistoryOpen(true), setSavedOpen(true),
         setCollectionsOpen(true) and setNetworkSearchOpen(true): four modal
         dialogs opened from rows that sat in the same rail, at the same
         weight, as four real pages. Half the app's content lived in
         overlays you could lose by pressing Escape. They are destinations
         now. The modal state below still exists because the command
         palette and the "add to collection" action on a source open the
         dialog form deliberately — there, interrupting you is correct. */
      case "investigations": setView("investigations"); break;
      case "library": setView("library"); break;
      case "collections": if (user) setView("collections"); else { setAuthInitialTab("login"); setAuthOpen(true); } break;
      case "settings": setSettingsInitialTab("answers"); setView("settings"); break;
      case "people": if (user) setView("people"); else { setAuthInitialTab("login"); setAuthOpen(true); } break;
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
  // Commit 66 — stamp savedAt on the way in, so a paper saved in this
  // session has a real timestamp immediately rather than waiting for the
  // next server round-trip to acquire one.
  function toggleSave(s) { sfx(); setSaved((prev) => { const k = sourceKey(s); return prev.some((x) => sourceKey(x) === k) ? prev.filter((x) => sourceKey(x) !== k) : [...prev, { ...s, savedAt: s.savedAt || Date.now() }]; }); }
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
      const human = /401|403|forbidden|unauthorized/i.test(raw) ? "That API key or user ID looks wrong: double-check them in your Zotero account settings."
        : /network|fetch|failed to fetch/i.test(raw) ? "Couldn't reach Zotero. Check your connection and try again."
        : "Couldn't save to Zotero right now. Try again in a moment.";
      setZMsg(human);
    }
  }

  const commands = [
    { label: "New investigation", hint: kbdLabel("J"), run: () => newSession() },
    { label: "Open your library", hint: kbdLabel("B"), run: () => { setCmdOpen(false); setView("library"); } },
    { label: "Open your investigations", run: () => { setCmdOpen(false); setView("investigations"); } },
    // Collections' header button is desktop-only (there's no room for it in
    // the mobile header), but this palette is available on every viewport —
    // it's a signed-in-only feature, hence gated on `user` here.
    ...(user ? [{ label: "Open collections", run: () => { setCmdOpen(false); setView("collections"); } }] : []),
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
    // Commit 69 — the gate rides above the Intro too. The Intro is a
    // landing screen rather than "use of the Service", but there is no
    // reason to let someone press START EXPLORING and land in the app a
    // frame before being asked; showing it here means the first
    // interactive thing anyone sees is the agreement.
    return (
      <>
        <Intro accent={accent} P={P} onEnter={() => { sfx(); setEntered(true); }} animationMode={animationMode} />
        {!legalOk && (
          <ConsentGate
            P={P} accent={accent} at={at} user={user}
            serverVersion={!!(readLegalAccepted() || {}).version}
            onAccepted={() => setLegalOk(true)}
          />
        )}
      </>
    );
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
        {s.type && <span style={{ fontSize: FONT_SIZES.micro, fontWeight: 600, letterSpacing: "0.01em", color: typeColor(s.type), background: withAlpha(typeColor(s.type), 0.1), padding: "2px 6px", borderRadius: 8, fontFamily: "var(--cb-body)" }}>{s.type}</span>}
        {/* v5: the "strong/partial/weak" word already existed (relLabel)
            but only ever reached a `title` tooltip — invisible to touch,
            keyboard, and screen-reader users, who only ever saw a bare
            color-coded percentage. Now it's always on screen. */}
        {typeof s.relevance === "number" && <span style={{ fontSize: FONT_SIZES.micro, fontWeight: 600, color: relColor(s.relevance), background: withAlpha(relColor(s.relevance), 0.1), padding: "2px 6px", borderRadius: 8, fontFamily: "var(--cb-mono)" }}>{s.relevance}% · {relLabel(s.relevance)}</span>}
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
      {pinnedSources.length > 0 && (<div style={{ padding: "7px 10px", margin: "0 0 8px", background: withAlpha(accent, 0.06), border: `1px solid ${withAlpha(accent, 0.25)}`, borderRadius: 8, fontSize: FONT_SIZES.caption, color: accent, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontFamily: "var(--cb-mono)" }}><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="pinFilled" size={11} />{pinnedSources.length} pinned</span><button onClick={() => setPinnedSources([])} style={{ background: "transparent", border: "none", color: accent, cursor: "pointer", fontSize: FONT_SIZES.caption, textDecoration: "underline" }}>Clear</button></div>)}
      {corrections.length > 0 && (<div style={{ padding: "7px 10px", margin: "0 0 8px", background: withAlpha(STATUS.warn, 0.06), border: `1px solid ${withAlpha(STATUS.warn, 0.25)}`, borderRadius: 8, fontSize: FONT_SIZES.caption, color: STATUS.warn, display: "flex", alignItems: "center", gap: 6, justifyContent: "space-between", fontFamily: "var(--cb-mono)" }}><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="edit" size={11} />{corrections.length} correction{corrections.length === 1 ? "" : "s"}</span><button onClick={() => setCorrections([])} style={{ background: "transparent", border: "none", color: STATUS.warn, cursor: "pointer", fontSize: FONT_SIZES.caption, textDecoration: "underline" }}>Clear</button></div>)}
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
        {allSources.length === 0 ? <div style={S.empty} className="cb-fade">Sources land here as you go.</div> :
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
      {/* ── The field, at application level ──────────────────────────────
          Three things drive it, and all three are real application state:

          mode    "ambient" on the entry screen, "reading" once there is an
                  answer on the page. Reading mode widens the contour spacing
                  and dims the ridge light so the surface stays present without
                  competing with text.
          energy  Rises only while a request is genuinely in flight (`busy`).
                  It is not a progress indicator and does not know how far
                  along anything is — it is on or off, damped.
          core    Prominent before the first question, then small and settled
                  near the top of the workspace once an investigation begins.

          It is NOT paused on other views. Pausing it made the atmosphere blink
          out whenever someone opened Settings, which is the opposite of a
          coherent environment; the renderer already stops on its own when the
          tab is hidden or the canvas is off-screen, which is the case that
          actually costs anything. */}
      <CerebrumFieldCanvas
        accent={accent}
        P={P}
        mode={started ? "reading" : "ambient"}
        energy={busy ? 1 : 0}
        core={started ? 0.34 : 0.85}
        corePos={started ? [0.72, 0.58] : [0, 0.08]}
        coreScale={started ? 0.42 : 0.9}
        animationMode={animationMode}
      />
      <div style={S.grain} />
      <GuidedTour P={P} accent={accent} />
      {started && <div className="cb-scroll-progress" style={{ transform: "scaleX(" + scrollProg + ")" }} />}
      {/* Back to top. Two mobile fixes: it sat at 10% white over the page,
          so the Home Deck's rows read straight through it (a watchlist
          entry's status line was legible *inside* the button); and on the
          left it landed on the deck cards' text column, while the right
          edge of a card is its quiet side. Opaque, shadowed, and on the
          right on mobile — desktop keeps the left, where nothing collides
          and the right is the sources panel's territory. */}
      {showScrollTop && <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} aria-label="Back to top" title="Back to top" style={{ position: "fixed", bottom: isMobile ? (started ? 80 : 24) /* clears the Sources FAB only when it exists */ : 24, [isMobile ? "right" : "left"]: isMobile ? 16 : 24, width: 38, height: 38, borderRadius: "50%", background: P.dark ? withAlpha(P.bg, 0.93) : withAlpha(P.bg, 0.95), border: `1px solid ${P.line}`, color: P.ink2, cursor: "pointer", zIndex: 15, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(16px) saturate(1.3)", WebkitBackdropFilter: "blur(16px) saturate(1.3)", boxShadow: P.dark ? "0 4px 16px rgba(0,0,0,0.5)" : "0 4px 16px rgba(0,0,0,0.14)", fontSize: FONT_SIZES.subhead }}>↑</button>}
      <Sidebar
        P={P} accent={accent} at={at} S={S}
        view={view} onNavigate={stableSidebarNavigate}
        isMobile={isMobile} mobileOpen={sidebarMobileOpen} onCloseMobile={handleSidebarCloseMobile}
        user={user} history={history} saved={saved} collections={collections} threads={threads} muted={muted}
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
            The announcement itself is gone as of Commit 92 — see the note
            where v5Open used to live for why it had to be.
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
            // Was 0.75/0.85 — translucent enough that the Home Deck's first
            // stat read straight through the button as it scrolled under.
            // A control that content shows through isn't glass, it's a
            // smudge.
            background: P.dark ? withAlpha(P.bg, 0.93) : withAlpha(P.bg, 0.95),
            border: `1px solid ${P.line}`,
            backdropFilter: "blur(16px) saturate(1.3)", WebkitBackdropFilter: "blur(16px) saturate(1.3)",
            boxShadow: P.dark ? "0 4px 16px rgba(0,0,0,0.5)" : "0 4px 16px rgba(0,0,0,0.14)",
            color: P.ink, cursor: "pointer",
          }}
        >
          <Icon name="menu" size={18} />
        </button>
      )}
      {view === "search" && (
      /* Commit 85 -- this container used to carry
         onDoubleClick={() => ask(selection)}. Double-click is how everyone
         selects a word to read it, copy it, or look it up, so the app fired
         a brand-new search on top of the answer being read every time
         someone did the most ordinary thing you can do with text. It is
         gone. Selecting text now does what selecting text does everywhere
         else; SelectionAsk offers the search as a button the reader has to
         actually press. */
      <div style={S.scroll} ref={threadRef}>
        <SelectionAsk onAsk={(q) => ask(q)} P={P} accent={accent} containerRef={threadRef} />
        <div style={S.container}>
          {!started ? (
            /* The home hero is the first thing anyone sees after the Intro
               hands off, so it's the one surface where the two motion
               languages colliding was most obvious: the Intro exits on a
               1.3-1.7s power3.inOut rise, and this used to arrive on a
               250ms CSS blur-fade. Same GSAP gesture, slightly quicker than
               the Intro itself (this is a return-to-home, not a curtain
               raise), so the handoff reads as one continuous motion. The
               glow layer is excluded from the stagger — it's a decorative
               backdrop, not a sequenced element, and having it rise with
               the content made the whole hero look like it was sliding. */
            /* Commit 66 — the returning-user hero.

               A signed-in person with history, saved papers or watched
               topics was getting the same full-height landing hero as a
               first-time visitor: an 84px wordmark, a 52px-margin tagline
               explaining what the product is, and a screen's worth of
               whitespace before anything about THEIR work appeared. The
               deck was real but below the fold, which made it useless.

               When there's a deck to show, the hero compacts — smaller
               wordmark, no "here's what this product does" tagline (they
               know), tighter padding — so the search bar and the first row
               of deck cards land on the first screen together. A visitor
               with nothing on the deck still gets the full curtain-raise. */
            <Reveal style={{ ...S.hero, ...(deckHasContent ? S.heroCompact : null) }} deps={[started, deckHasContent]} y={18} stagger={0.07} duration={1.05} descend={false}>
              <div style={S.heroGlow} className="cb-hero-glow" data-cb-no-reveal="" />
              {/* ══════════════════════════════════════════════════════
                  Commit 87 — the returning-user hero was still a brand
                  panel.

                  Commit 66 shrank it, but shrinking was the wrong move: it
                  was still a logo, the word "Cerebrum" at 50px, and a line
                  of copy, sitting directly beneath a sidebar whose first
                  element is a logo and the word "Cerebrum". Two logos and
                  two wordmarks on one screen, ~200px of vertical space,
                  spent telling a signed-in person the name of the app they
                  are already inside.

                  A workspace greets you; a marketing page introduces
                  itself. So for someone with work in progress this is now
                  a greeting and their standing — the same move every tool
                  that wants to feel like a place makes — and the brand
                  block is kept for the first-time visitor, who genuinely
                  has not been introduced yet.
                  ══════════════════════════════════════════════════════ */}
              {deckHasContent ? (
                <div style={{ marginBottom: 26, position: "relative" }}>
                  <h1 style={{
                    fontSize: isMobile ? 30 : 40, fontWeight: 700, letterSpacing: "-0.03em",
                    lineHeight: 1.1, color: P.ink, margin: "0 0 8px", fontFamily: "var(--cb-display)",
                  }}>
                    {greeting()}{firstName ? <>, <span style={{ color: accent }}>{firstName}</span></> : null}
                  </h1>
                  <p style={{
                    fontSize: FONT_SIZES.small, color: P.faint, margin: 0,
                    fontFamily: "var(--cb-body)", display: "flex", flexWrap: "wrap",
                    alignItems: "center", gap: 10, letterSpacing: "-0.005em",
                  }}>
                    <span>{todayLabel()}</span>
                    {streakDays > 0 && (
                      <>
                        <span aria-hidden="true" style={{ opacity: 0.4 }}>·</span>
                        <span style={{ color: P.ink2 }}>{streakDays}-day streak</span>
                      </>
                    )}
                  </p>
                </div>
              ) : (
                <>
                  <div style={{ ...S.heroMark, display: "inline-flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
                    <span aria-hidden="true" className="cb-hero-ring" style={{ position: "absolute", width: 74, height: 74, borderRadius: "50%", border: `1px solid ${withAlpha(accent, 0.4)}` }} />
                    <Mark size={44} accent={accent} glow={P.dark} />
                  </div>
                  <h1 style={S.heroTitle} className="cb-text-reveal"><KineticText text="Cerebrum" /></h1>
                  <p style={S.heroSub}>Ask a real research question. Every claim traces to a paper you can open.</p>
                </>
              )}
              <input ref={imageInputRef} type="file" accept="image/*" onChange={onImagePicked} style={{ display: "none" }} />
              {attachedImage && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, padding: "6px 10px 6px 6px", background: P.dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)", border: `1px solid ${P.line}`, borderRadius: 8, maxWidth: "fit-content" }}>
                  <img src={attachedImage} alt="Attached" style={{ width: 32, height: 32, borderRadius: 8, objectFit: "cover" }} />
                  <span style={{ fontSize: FONT_SIZES.small, color: P.ink2, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{attachedImageName}</span>
                  <button onClick={() => { setAttachedImage(null); setAttachedImageName(""); }} aria-label="Remove image" style={{ background: "none", border: "none", color: P.faint, cursor: "pointer", padding: 2, display: "inline-flex" }}><Icon name="close" size={14} /></button>
                </div>
              )}
              <div className="cb-search-glow cb-search-shell" style={{ ...S.searchShell, ...(hover === "in" ? S.searchShellActive : {}), width: "100%", maxWidth: 700 }} onMouseEnter={() => setHover("in")} onMouseLeave={() => setHover("")}>
                  <input ref={inputRef} style={S.searchInput} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) ask(); }} placeholder={(ASK_MODES.find((m) => m.key === askMode) || ASK_MODES[0]).placeholder} />
                  <button onClick={() => imageInputRef.current?.click()} title="Attach an image" aria-label="Attach an image" style={{ background: "none", border: "none", cursor: "pointer", color: attachedImage ? accent : P.faint, display: "flex", alignItems: "center", padding: 4, flexShrink: 0 }}><Icon name="image" size={17} /></button>
                  <MicButton onTranscript={(t) => setInput(t)} accent={accent} P={P} />
                  <button
                    style={S.searchBtn} onClick={() => ask()} title="Ask" aria-label="Ask"
                    onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.06)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
                  ><Icon name="arrowRight" size={17} /></button>
              </div>
              {/* Commit 83 — verbs, not suggested questions. See ASK_MODES. */}
              <AskModePicker mode={askMode} setMode={setAskMode} P={P} accent={accent} isMobile={isMobile} />
              <div style={{ fontSize: FONT_SIZES.micro, color: P.faint, marginTop: 10, textAlign: "center", minHeight: 16 }}>
                {(ASK_MODES.find((m) => m.key === askMode) || ASK_MODES[0]).blurb}
              </div>
              {/* ══════════════════════════════════════════════════════
                  Commit 87 — the evidence filter is a disclosure now.

                  Counting the chrome a signed-in person met before seeing
                  a single thing of their own: search bar, five verb pills,
                  a line of explanatory text under them, and then four
                  evidence chips. Four stacked rows of controls, roughly
                  190px, before the first card. Three of those rows are
                  things you use on most searches. This one is not: an
                  evidence-tier constraint is set BEFORE typing, which
                  almost nobody does, and it was holding prime vertical
                  space on every visit for a rare action.

                  It is not gone — narrowing to systematic reviews is one
                  of the genuinely instrument-like things this app can do,
                  and hiding it entirely would be worse. It is one line
                  that states the current setting and opens the chips when
                  you want them, and it announces itself when the filter is
                  NOT the default, which is the state that actually needs
                  to be visible.
                  ══════════════════════════════════════════════════════ */}
              <EvidenceFilter
                value={evidenceFilter}
                onChange={(v) => { sfx(); setEvidenceFilter(v); }}
                P={P} accent={accent} isMobile={isMobile}
              />

              {/* Commit 66 — the Home Deck replaces the loose stack of
                  cards that used to sit here. See HomeDeck. */}
              <HomeDeck
                P={P} accent={accent} at={at} user={user} isMobile={isMobile}
                history={history} saved={saved} sessions={sessions}
                watchKey={watchKey}
                onAsk={(q) => ask(q)}
                onOpenHistory={() => setView("investigations")}
                onOpenSaved={() => setView("library")}
              />
              {/* Commit 99 — this was six proper nouns and "+ 9 more", with
                  nothing saying what they are. Anyone who already knows what
                  Europe PMC is does not need the row; anyone who does not is
                  being shown a list of strangers. One line of framing turns it
                  from decoration into the reassurance it was meant to be.
                  (The stale comment this replaces claimed the backend queries
                  14 — `sourceNames` in functions/api/search.js lists 15, which
                  is what 6 named + 9 more already said. The count is right;
                  the note about it was not.) */}
              <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, textAlign: "center", marginBottom: 8, lineHeight: 1.5 }}>
                Every question is sent to 15 public research databases at once. These are the largest:
              </div>
              <div style={S.trustRow}>
                {["Europe PMC", "PubMed", "OpenAlex", "Crossref", "Semantic Scholar", "arXiv"].map((d) => <span key={d} style={S.trustItem}>{d}</span>)}
                <span style={{ ...S.trustItem, color: P.faint }}>and 9 others</span>
              </div>
            </Reveal>
          ) : (
            <div style={{ ...S.workspace, ...(isMobile ? S.workspaceMobile : S.workspaceWithSidebar) }} className="cb-page-enter">
              <div style={S.thread}>
                {turns.map((t, ti) => (<Turn key={t.id ?? ti} t={t} P={P} accent={accent} at={at} S={S} typewriter={typewriter && ti === turns.length - 1} last={ti === turns.length - 1} user={user} autoRead={autoplay && askedThisSession} onWatchChanged={() => setWatchKey((k) => k + 1)} hoverCite={hoverCite} setHoverCite={setHoverCite} onRelated={(q) => ask(q)} citationStyle={citationStyle} setCitationStyle={setCitationStyle} onShowNetwork={setNetworkGraphSources} onShowTimeline={setTimelineSources} onEvidenceTable={setEvidenceTableSources} />))}
                {busy && (<div style={S.turn}><div style={S.qLabel}><span style={S.qDot} /><span style={{ fontFamily: "var(--cb-body)", fontSize: FONT_SIZES.caption, letterSpacing: "0.01em" }}>Processing</span></div><Skeleton P={P} /><AgentTrace P={P} accent={accent} done={false} /></div>)}
                {error && <div role="alert" style={S.error} className="cb-fade"><span style={{ flexShrink: 0, display: "inline-flex" }}><Icon name="warning" size={18} /></span><div><div style={{ fontWeight: 600, marginBottom: 4 }}>Search failed</div><div style={{ opacity: 0.85 }}>{error}</div><button onClick={() => { setError(""); ask(turns.length ? turns[turns.length - 1].q : input); }} style={{ marginTop: 10, padding: "6px 14px", fontSize: FONT_SIZES.small, fontWeight: 600, background: withAlpha(STATUS.bad, 0.15), color: STATUS.bad, border: `1px solid ${withAlpha(STATUS.bad, 0.3)}`, borderRadius: 8, cursor: "pointer", fontFamily: "var(--cb-mono)" }}>Try again</button></div></div>}
                {turns.length > 0 && !busy && (<>
                  {attachedImage && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, padding: "6px 10px 6px 6px", background: P.dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)", border: `1px solid ${P.line}`, borderRadius: 8, maxWidth: "fit-content" }}>
                      <img src={attachedImage} alt="Attached" style={{ width: 32, height: 32, borderRadius: 8, objectFit: "cover" }} />
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
                    <input style={S.searchInput} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) ask(); }} placeholder="Follow up: I remember the whole thread" />
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
            <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, lineHeight: 1.55, maxWidth: 520, margin: "0 auto 14px", textAlign: "center" }}>Written by AI from real papers. Check the sources.</div>
            <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, fontFamily: "var(--cb-mono)", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: "8px 14px", maxWidth: 620, margin: "0 auto", padding: "0 12px", lineHeight: 1.6 }}>
              {[
                ["how", "How it works"],
                ["/about", "About"],
                ["/privacy", "Privacy"],
                ["/terms", "Terms"],
                ["/disclosures", "Disclosures"],
                ["/contact", "Contact"],
              ].map(([href, label], i2) => {
                const st = {
                  color: P.faint, background: "none", border: "none", padding: 0, margin: 0,
                  cursor: "pointer", font: "inherit", lineHeight: "inherit", whiteSpace: "nowrap",
                  // The mobile tap-target rule forces min-height:44px on links
                  // and buttons alike, but a block <a> puts its text at the top
                  // of that box while a <button> centres it — which is why this
                  // row used to render one link lower than its neighbours.
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  textDecoration: "underline", textDecorationStyle: "dotted",
                  textDecorationColor: withAlpha(P.faint, 0.55), textUnderlineOffset: "3px",
                };
                return href === "how"
                  ? <button key={label} type="button" onClick={() => setHowItWorksOpen(true)} style={st}>{label}</button>
                  : <a key={label} href={href} style={st}>{label}</a>;
              })}
              <span style={{ whiteSpace: "nowrap", opacity: 0.75 }}>© {new Date().getFullYear()} Cerebrum™ · v{APP_VERSION}</span>
            </div>
          </div>
        </div>
      </div>
      )}
      {view === "profile" && (
        <Reveal style={S.pageView} deps={[view]}>
          <ProfileView
            P={P} accent={accent} at={at} isMobile={isMobile}
            user={user} profile={profile} setProfile={setProfile} profileMeta={profileMeta}
            history={history} saved={saved} collections={collections}
            onOpenHistory={(h) => { openHistoryItem(h); setView("search"); }}
            onManageAccount={() => { setSettingsInitialTab("account"); setView("settings"); }}
          />
        </Reveal>
      )}
      {view === "settings" && (
        <Reveal deps={[view]} style={S.pageView}>
        <SettingsView {...{ P, accent, at, S, PALETTES, ACCENTS, paletteName, setPaletteName, accentName, setAccentName, customAccent, setCustomAccent, answerLength, setAnswerLength, factCheck, setFactCheck, muted, setMuted, typewriter, setTypewriter, soundMode, setSoundMode, animationMode, setAnimationMode, animSpeed, setAnimSpeed, sfx, setSessions, setSaved, saved, history, setHistory, highContrast, setHighContrast, fontSize, setFontSize, reducedTransparency, setReducedTransparency, autoplay, setAutoplay, dyslexicFont, setDyslexicFont, lineSpacing, setLineSpacing, focusHighlight, setFocusHighlight, citationStyle, setCitationStyle, user, onSignOut: signOut, onAccountDeleted, onOpenAuth: (tab) => { setAuthInitialTab(tab); setAuthOpen(true); }, initialTab: settingsInitialTab, close: () => setView("search"), dataDensity, setDataDensity, collections, turns }} />
        </Reveal>
      )}
      {view === "trending" && (
        <Reveal style={S.pageView} deps={[view]}><TrendingView P={P} accent={accent} at={at} isMobile={isMobile} onAsk={(q) => { setView("search"); ask(q); }} /></Reveal>
      )}
      {/* Commit 99 — Document Mode, as a destination. See NotebookMode's own
          comment for why it stopped being an overlay. */}
      {view === "document" && (
        <Reveal style={S.pageView} deps={[view]}>
          <NotebookMode P={P} accent={accent} at={at} asPage close={() => setView("search")} />
        </Reveal>
      )}
      {/* ══════════════════════════════════════════════════════════
          Commit 88 — the library is a page.

          This was a 520px modal with a 56vh internal scroll, so a library
          of forty papers was read through a letterbox on a 1440px screen,
          and Escape threw the whole thing away. It is now a real
          destination with a grid, a search field and a sort — the things
          you need when a library is large, which is exactly the case the
          modal handled worst.
          ══════════════════════════════════════════════════════════ */}
      {view === "library" && (
        <Reveal style={S.pageView} deps={[view]}>
          <WorkspacePage
            P={P} accent={accent} isMobile={isMobile} wide
            title="Your library" count={saved.length}
            description="Every paper you've saved, across every investigation. Exports carry the full record, not just the link."
            actions={saved.length > 0 ? (
              <>
                <UIButton P={P} accent={accent} at={at} size="sm" icon="download" onClick={() => { sfx(); download("cerebrum-saved.ris", toRIS(saved)); }}>RIS</UIButton>
                <UIButton P={P} accent={accent} at={at} size="sm" icon="download" onClick={() => { sfx(); download("cerebrum-saved.bib", toBibTeX(saved)); }}>BibTeX</UIButton>
                {confirmClearSaved ? (
                  <>
                    <UIButton P={P} accent={accent} at={at} size="sm" onClick={() => setConfirmClearSaved(false)}>Cancel</UIButton>
                    <UIButton P={P} accent={accent} at={at} size="sm" variant="destructive" onClick={() => { setSaved([]); setConfirmClearSaved(false); sfx(); }}>Delete everything</UIButton>
                  </>
                ) : (
                  <UIButton P={P} accent={accent} at={at} size="sm" variant="ghost" onClick={() => setConfirmClearSaved(true)}>Clear all</UIButton>
                )}
              </>
            ) : null}
          >
            {saved.length === 0 ? (
              <WorkspaceEmpty P={P} accent={accent} icon="bookmark"
                title="Nothing saved yet"
                body="Save a paper from any answer and it lands here, with its authors, journal and year intact so an export is citable straight away."
                action={<UIButton P={P} accent={accent} at={at} variant="primary" onClick={() => setView("search")}>Start an investigation</UIButton>} />
            ) : (
              <>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18, alignItems: "center" }}>
                  <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                    <UIField P={P} accent={accent} value={libraryQuery} onChange={setLibraryQuery}
                      placeholder="Filter by title, author or journal…" ariaLabel="Filter your library" />
                  </div>
                  {/* A library sorts by when you saved it or by how old the
                      work is — two genuinely different questions, and the
                      modal could answer neither. */}
                  <div style={{ display: "inline-flex", flexShrink: 0, padding: 3, borderRadius: RADIUS.pill, background: P.dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)", border: `1px solid ${P.line}` }}>
                    {[["recent", "Recently saved"], ["year", "Newest research"], ["title", "A-Z"]].map(([key, label]) => (
                      <button key={key} onClick={() => setLibrarySort(key)} aria-pressed={librarySort === key}
                        style={{
                          padding: "6px 13px", borderRadius: RADIUS.pill, border: "none", cursor: "pointer",
                          fontSize: FONT_SIZES.caption, fontWeight: 600, fontFamily: "var(--cb-body)", whiteSpace: "nowrap",
                          background: librarySort === key ? (P.dark ? "rgba(255,255,255,0.10)" : "#fff") : "transparent",
                          color: librarySort === key ? P.ink : P.faint,
                          transition: "background 0.22s ease, color 0.22s ease",
                        }}>{label}</button>
                    ))}
                  </div>
                </div>
                {visibleSaved.length === 0 ? (
                  <WorkspaceEmpty P={P} accent={accent} icon="search"
                    title="No matches"
                    body={`Nothing in your library matches "${libraryQuery}". Try an author surname or part of the journal name.`} />
                ) : (
                  <div style={{ display: "grid", gap: 12, gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(320px, 1fr))", alignItems: "start" }}>
                    {visibleSaved.map((sv, i) => (
                      <UICard key={sourceKey(sv) || i} P={P}>
                        <a href={safeHref(sv.url)} target="_blank" rel="noreferrer"
                          style={{ display: "block", fontSize: FONT_SIZES.small, fontWeight: 700, color: P.ink, textDecoration: "none", lineHeight: 1.4, letterSpacing: "-0.01em" }}>
                          {sv.title ? renderCleanTitle(sv.title) : sv.url}
                        </a>
                        <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, marginTop: 6, lineHeight: 1.5, fontFamily: "var(--cb-body)" }}>
                          {[sv.authors, sv.journal, sv.year].filter(Boolean).join(" · ")}
                          {typeof sv.citations === "number" && ` · ${sv.citations.toLocaleString()} citations`}
                        </div>
                        <div style={{ display: "flex", gap: 7, marginTop: 12, flexWrap: "wrap" }}>
                          {sv.authors && <UIButton P={P} accent={accent} at={at} size="sm" onClick={() => { setView("search"); ask(`papers by ${(sv.authors || "").replace(" et al.", "")}`); }}>More by these authors</UIButton>}
                          <UIButton P={P} accent={accent} at={at} size="sm" variant="ghost" onClick={() => setSaved((prev) => prev.filter((x) => sourceKey(x) !== sourceKey(sv)))}>Remove</UIButton>
                        </div>
                      </UICard>
                    ))}
                  </div>
                )}
              </>
            )}
          </WorkspacePage>
        </Reveal>
      )}
      {/* Commit 88 — investigations are a page. Same reasoning as the
          library: a 560px dialog with a 60vh internal scroll is the wrong
          container for the record of everything you have ever looked
          into. It now also gets a filter, because the moment this list is
          useful it is long. */}
      {view === "investigations" && (
        <Reveal style={S.pageView} deps={[view]}>
          <WorkspacePage
            P={P} accent={accent} isMobile={isMobile} wide
            title="Investigations" count={history.length}
            description="Every question you've asked, with the papers each one turned up. Open one to keep going from where you stopped."
            actions={history.length >= 2 ? (
              <UIButton P={P} accent={accent} at={at} size="sm" icon="compare" onClick={() => setCompareOpen(true)}>Compare two</UIButton>
            ) : null}
          >
            {history.length === 0 ? (
              <WorkspaceEmpty P={P} accent={accent} icon="history"
                title="No investigations yet"
                body="Ask a research question and one starts itself. The thread, the papers it found, and anything you save from it are kept together."
                action={<UIButton P={P} accent={accent} at={at} variant="primary" onClick={() => setView("search")}>Ask something</UIButton>} />
            ) : (
              <>
                {history.length > 6 && (
                  <div style={{ marginBottom: 16 }}>
                    <UIField P={P} accent={accent} value={historyQuery} onChange={setHistoryQuery}
                      placeholder="Filter investigations…" ariaLabel="Filter investigations" />
                  </div>
                )}
                {visibleHistory.length === 0 ? (
                  <WorkspaceEmpty P={P} accent={accent} icon="search" title="No matches"
                    body={`No investigation matches "${historyQuery}".`} />
                ) : (
                  /* Commit 88 — the PAGE is wide so that every destination in
                     the rail starts at the same left edge; the READING measure
                     is set here. A row of body text 1100px across is not a
                     list, it is a scan line. */
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 840 }}>
                    {visibleHistory.map((h) => (
                      <UICard key={h.id} P={P}>
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                          <button onClick={() => { openHistoryItem(h); setView("search"); }} style={{ flex: 1, minWidth: 0, textAlign: "left", background: "transparent", border: "none", cursor: "pointer", padding: 0, font: "inherit" }}>
                            <div style={{ fontSize: FONT_SIZES.small, fontWeight: 700, color: P.ink, lineHeight: 1.4, letterSpacing: "-0.01em" }}>{h.title}</div>
                            <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", fontSize: FONT_SIZES.caption, color: P.faint, marginTop: 5, fontFamily: "var(--cb-body)" }}>
                              <span>{(h.turns || []).length} question{(h.turns || []).length === 1 ? "" : "s"}</span>
                              {(h.allSources || []).length > 0 && (<>
                                <span aria-hidden="true" style={{ opacity: 0.5 }}>·</span>
                                <span style={{ color: accent, fontWeight: 600 }}>{h.allSources.length} paper{h.allSources.length === 1 ? "" : "s"}</span>
                              </>)}
                              {h.ts && (<>
                                <span aria-hidden="true" style={{ opacity: 0.5 }}>·</span>
                                <span>{relativeTime(h.ts)}</span>
                              </>)}
                            </div>
                          </button>
                          {historyConfirmId === h.id ? (
                            <span style={{ display: "inline-flex", gap: 6, flexShrink: 0 }}>
                              <UIButton P={P} accent={accent} at={at} size="sm" onClick={() => setHistoryConfirmId(null)}>Cancel</UIButton>
                              <UIButton P={P} accent={accent} at={at} size="sm" variant="destructive" onClick={() => { setHistory((prev) => prev.filter((x) => x.id !== h.id)); setHistoryConfirmId(null); }}>Confirm</UIButton>
                            </span>
                          ) : (
                            <UIButton P={P} accent={accent} at={at} size="sm" variant="ghost" ariaLabel={`Delete ${h.title}`} onClick={() => setHistoryConfirmId(h.id)}>Delete</UIButton>
                          )}
                        </div>
                      </UICard>
                    ))}
                  </div>
                )}
              </>
            )}
          </WorkspacePage>
        </Reveal>
      )}
      {view === "collections" && (
        <Reveal style={S.pageView} deps={[view]}>
          <WorkspacePage
            P={P} accent={accent} isMobile={isMobile} wide
            title="Collections" count={collections.length}
            description="Group saved papers by the question they answer rather than by the day you found them."
          >
            <CollectionsModal
              page narrow={isMobile}
              P={P} accent={accent} at={at} S={S} saved={saved} collections={collections}
              onCreateCollection={createCollection} onRenameCollection={renameCollection}
              onDeleteCollection={deleteCollection} onMoveSource={moveSourceToCollection}
              close={() => setView("search")}
            />
          </WorkspacePage>
        </Reveal>
      )}
      {view === "people" && (
        <Reveal style={S.pageView} deps={[view]}>
          <WorkspacePage
            P={P} accent={accent} isMobile={isMobile} wide
            title="Find people"
            description="Search for someone by name or @username. There is no member list, and no way to browse people by university."
          >
            <div style={{ maxWidth: 620 }}>
            <NetworkSearchModal
              page
              P={P} accent={accent} at={at}
              close={() => setView("search")}
              onMessage={(researcher, threadId) => { setPendingThreadId(threadId); setView("inbox"); }}
              onOpenProfile={(id) => setViewingProfileId(id)}
            />
            </div>
          </WorkspacePage>
        </Reveal>
      )}
      {view === "inbox" && (
        <Reveal style={S.pageView} deps={[view]}>
          <InboxView
            P={P} accent={accent} at={at} isMobile={isMobile}
            threads={threads} setThreads={setThreads}
            initialThreadId={pendingThreadId}
            onConsumeInitialThread={() => setPendingThreadId(null)}
            onStartHuddle={(name, roomSeed, opts) => setActiveHuddle({ name, roomSeed, audioOnly: !!(opts && opts.audioOnly) })}
            activeHuddleRoomSeed={activeHuddle?.roomSeed ?? null}
            onCompose={() => setNetworkSearchOpen(true)}
          />
        </Reveal>
      )}
      </div>
      {started && isMobile && (<button style={{ ...S.mobSrcBtn, "--fab-glow": withAlpha(accent, 0.35) }} className="cb-fab-pulse" onClick={() => setMobilePanel(true)} aria-label={`Sources${allSources.length ? `, ${allSources.length}` : ""}`}><Icon name="sparkle" size={14} /><span>Sources</span>{allSources.length > 0 && <span style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, background: withAlpha(at, 0.22), padding: "2px 6px", borderRadius: 8, lineHeight: 1.3 }}>{allSources.length}</span>}</button>)}
      {started && isMobile && mobilePanel && (<><div style={S.scrim} onClick={() => setMobilePanel(false)} className="cb-backdrop" /><aside role="dialog" aria-modal="true" aria-label="Sources" style={{ ...S.panel, ...S.panelMobile }} className="cb-modal"><button style={{ ...S.ghostBtn, marginBottom: 14, display: "inline-flex", alignItems: "center", gap: 6 }} onClick={() => setMobilePanel(false)}><Icon name="close" size={13} /> Close</button>{SourcesInner}</aside></>)}
      {cmdOpen && (<div role="dialog" aria-modal="true" aria-label="Command palette" style={S.cmdWrap} onClick={() => setCmdOpen(false)}><div style={S.cmdBox} onClick={(e) => e.stopPropagation()} className="cb-pop"><div style={S.cmdInputRow}><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke={P.faint} strokeWidth="1.8" /><path d="M21 21l-4-4" stroke={P.faint} strokeWidth="1.8" strokeLinecap="round" /></svg><input ref={cmdRef} style={S.cmdInput} value={cmdQuery} onChange={(e) => setCmdQuery(e.target.value)} onKeyDown={onCmdKeyDown} placeholder="Search or type a command…" /><kbd style={S.kbd}>esc</kbd></div><div style={S.cmdList}>{cmdSuggest.length > 0 && <div style={S.cmdSection}>Ask</div>}{cmdSuggest.map((s, i) => (<button key={s} style={{ ...S.cmdItem, background: cmdActive === i ? withAlpha(accent, 0.1) : "transparent" }} onClick={() => ask(s)} onMouseEnter={() => setCmdActive(i)}><span style={{ color: accent }}>→</span>{s}</button>))}<div style={S.cmdSection}>Commands</div>{filteredCmds.map((c, i) => { const flatIdx = cmdSuggest.length + i; return (<button key={c.label} style={{ ...S.cmdItem, background: cmdActive === flatIdx ? withAlpha(accent, 0.1) : "transparent" }} onClick={c.run} onMouseEnter={() => setCmdActive(flatIdx)}><span>{c.label}</span>{c.hint && <kbd style={{ ...S.kbd, marginLeft: "auto" }}>{c.hint}</kbd>}</button>); })}</div></div></div>)}
      {networkSearchOpen && (
        <NetworkSearchModal
          P={P} accent={accent} at={at}
          close={() => setNetworkSearchOpen(false)}
          onMessage={(researcher, threadId) => {
            setNetworkSearchOpen(false);
            setPendingThreadId(threadId);
            setView("inbox");
          }}
          onOpenProfile={(id) => { setNetworkSearchOpen(false); setViewingProfileId(id); }}
        />
      )}
      {/* Commit 100 — the profile viewer. Opened from a Find People result
          or the founder card; nothing else on the site links to a person, by
          design. */}
      {viewingProfileId && (
        <PublicProfile
          P={P} accent={accent} at={at} isMobile={isMobile}
          userId={viewingProfileId}
          onClose={() => setViewingProfileId(null)}
          onMessage={(researcher, threadId) => {
            setViewingProfileId(null);
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
      {/* Commit 92 — Document Mode did nothing when clicked.

          Same failure as the what's-new modal above and found the same
          afternoon: handleSidebarNavigate's "document" case calls
          setNotebookOpen(true), the NotebookMode component is fully
          written and sitting at the top of this file, and no line of JSX
          ever mounted it. The nav row has been inert since the refactor
          that dropped the old header. Nothing about NotebookMode itself
          needed fixing — it just needed rendering. */}
      {/* ══════════════════════════════════════════════════════════
          Commit 96 — nobody could sign in or sign up.

          The third instance of this exact bug, and by far the worst.
          `authOpen` was set to true by the Sign in button, by the
          "profile" nav case for a signed-out visitor, and by Settings'
          onOpenAuth — and NO LINE OF JSX EVER MOUNTED AuthModal. The
          component is fully written at line ~6734, handleAuthed is wired
          and correct, the whole one-time-code flow works. It was simply
          never rendered, so every one of those buttons set a boolean and
          did nothing visible.

          That means account creation has been impossible for every
          visitor since the refactor that dropped the old header, which
          also makes it the reason Resend looked like it was not sending:
          nothing was ever requesting a code. */}
      {authOpen && (
        <AuthModal
          P={P} accent={accent} at={at}
          close={() => setAuthOpen(false)}
          intent={authInitialTab === "signup" ? "signup" : "login"}
          onAuthed={(u) => handleAuthed(u, { checkImport: true })}
        />
      )}
      {notebookOpen && <NotebookMode P={P} accent={accent} at={at} close={() => setNotebookOpen(false)} />}
      {evidenceTableSources && <EvidenceTableModal P={P} accent={accent} at={at} sources={evidenceTableSources} close={() => setEvidenceTableSources(null)} />}
      {drawerSource && <PaperDrawer P={P} accent={accent} at={at} S={S} source={drawerSource} onAskScoped={(q) => ask(q)} close={() => setDrawerSource(null)} />}
      {/* Commit 47: rendered here, at the app root, specifically so it's not
          a child of the "inbox" view branch above — a component instance
          only exists in the DOM while its parent renders it, so nesting this
          inside `view === "inbox"` would tear down (and disconnect) the
          call the instant the sidebar navigated anywhere else. Being a
          sibling of every view instead means switching tabs mid-call can
          never unmount it; only `onClose`/hangup does. */}
      {incomingCall && !activeHuddle && (
        <IncomingCall
          call={incomingCall} P={P} accent={accent} at={at} isMobile={isMobile}
          onAccept={() => {
            sfx();
            // roomSeed has always been the thread id (see VideoHuddle) — so
            // accepting is just opening the same huddle the caller is
            // already sitting in, and the existing handshake takes over.
            // Commit 97 — carry the caller's audio-only intent through.
            setActiveHuddle({ name: incomingCall.fromName, roomSeed: incomingCall.threadId, audioOnly: !!incomingCall.audioOnly });
            setIncomingCall(null);
          }}
          onDecline={() => {
            sfx();
            postCallSignal(incomingCall.threadId, newHuddleClientId(), "bye", {});
            setIncomingCall(null);
          }}
        />
      )}
      {activeHuddle && (
        <VideoHuddle
          P={P} accent={accent} at={at} isMobile={isMobile}
          name={activeHuddle.name} roomSeed={activeHuddle.roomSeed} audioOnly={activeHuddle.audioOnly} currentUserId={user?.id}
          onClose={() => setActiveHuddle(null)}
        />
      )}
      {/* Commit 71 — see .cb-grain / .cb-vignette. Rendered near the end so
          they sit above the page but below modals and the consent gate. */}
      {/* Commit 82 — both texture layers now follow the Appearance >
          Background animation setting. Someone who turns effects off was
          still getting grain and a vignette over everything, which is not
          what "off" means. */}
      {animationMode !== "off" && <div className="cb-grain" aria-hidden="true" />}
      {animationMode !== "off" && <div className="cb-vignette" aria-hidden="true" />}
      <ToastHost P={P} accent={accent} />
      {/* Commit 69 — rendered last so it sits above every other layer, and
          unconditionally blocking: no query runs, no data loads into view,
          and nothing is written to an account until this is accepted. */}
      {!legalOk && (
        <ConsentGate
          P={P} accent={accent} at={at} user={user}
          serverVersion={!!(readLegalAccepted() || {}).version}
          onAccepted={() => setLegalOk(true)}
        />
      )}
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
  /* ══════════════════════════════════════════════════════════════
     Commit 96 — the typeface was the tell.

     This shipped on Space Grotesk + Inter + JetBrains Mono. That trio is
     the default of every Vercel starter, every YC SaaS landing page and
     every AI wrapper built between 2021 and 2024. None of the three is a
     bad typeface. Together they are ANONYMOUS, and anonymous is what
     "doesn't feel premium" actually means here: the page announces that it
     came out of a template before a single word is read.

     Replaced with a system where each face has one job:

       Newsreader   a screen-first serif with a real optical-size axis
                    (6..72) and weights 300-700. Headings AND, more
                    importantly, the answer prose. Setting eight hundred
                    words of research writing in a UI sans is what made
                    this read as a dashboard; setting it in a serif built
                    for reading is what makes it read as a publication.
                    This is the single biggest change in the commit.

       Inter Tight  chrome only. Buttons, labels, nav, chips, meta. Inter
                    is superb at small sizes and the Tight cut is drawn
                    for exactly this, so the interface stays crisp while
                    the reading surfaces get character.

       IBM Plex Mono  numbers, IDs, counts. Plex was drawn for a research
                    and technology company and carries that; JetBrains
                    Mono reads as a code editor, which this is not.

     --cb-read exists so the intent is legible at every call site: it is
     the same family as --cb-display, but it marks text a person actually
     reads at length rather than scans. ══════════════════════════════ */
  --cb-display: 'Newsreader', Georgia, 'Times New Roman', serif;
  --cb-read:    'Newsreader', Georgia, 'Times New Roman', serif;
  --cb-body:    'Inter Tight', 'Inter', system-ui, -apple-system, sans-serif;
  --cb-mono:    'IBM Plex Mono', 'SF Mono', ui-monospace, monospace;
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

/* Commit 98 — form controls do not inherit the display serif.
   Browsers default button/input/select/textarea to a system UI font, so
   nothing inherited before the type system landed. Now that ancestors set
   --cb-display on hero and article blocks, a plain <button> inside one
   picks up Newsreader and a control ends up set in a reading serif. A
   control is a control: it gets --cb-body. Call sites that genuinely want
   the display face set fontFamily inline, and an inline style outranks
   this rule, so the deliberate cases (the wordmark button, the headline
   links) are untouched. Verified: the landing "Start exploring" button
   was computing Newsreader and now computes Inter Tight. */
button, input, select, textarea, optgroup { font-family: var(--cb-body); }
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
@keyframes cbHuddleRing {
  0%, 100% { box-shadow: 0 0 0 0 rgba(255,255,255,0.18); }
  50%      { box-shadow: 0 0 0 16px rgba(255,255,255,0); }
}
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
/* ── Citation → source correspondence ─────────────────────────────────
   The source a reader just followed. A brief coordinated flash establishes
   the correspondence, then a persistent left border keeps it identifiable
   while they read, so the connection survives longer than the animation.

   The --cb-link-accent custom property is set on the element by revealSource,
   so this uses the
   reader's chosen accent without the stylesheet needing to know it.

   Under reduced motion the flash is removed and the marker appears instantly
   — the information is identical, only the transition is gone. */
.cb-source-linked {
  position: relative;
  animation: cbSourceLink 900ms cubic-bezier(0.16, 1, 0.3, 1) 1;
}
.cb-source-linked::before {
  content: "";
  position: absolute;
  left: 0; top: 6px; bottom: 6px;
  width: 2px;
  border-radius: 2px;
  background: var(--cb-link-accent, currentColor);
  opacity: 0.85;
}
@keyframes cbSourceLink {
  0%   { background: color-mix(in srgb, var(--cb-link-accent, transparent) 22%, transparent); }
  100% { background: transparent; }
}
@media (prefers-reduced-motion: reduce) {
  .cb-source-linked { animation: none; }
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

/* ── Entrance classes ──
   These used to be four durations (200/250/400/700ms) picked independently,
   which is why a card, a page and a modal all arriving at once looked like
   three unrelated animations firing. They're now one scale, sized by how
   much of the screen the element occupies — the same principle the GSAP
   reveal system at the top of this file follows, so CSS-driven and
   GSAP-driven entrances read as the same motion language:

     micro  (inline, in-place)      180ms
     object (a card, a row)         320ms
     region (a panel, a page area)  460ms
     surface(a modal, a full view)  560ms

   Longer than the old values on purpose: 200ms on a large surface doesn't
   read as "snappy," it reads as a jump cut. Small things stay fast. */
.cb-fade    { animation: cbFade  180ms var(--cb-ease) both; }
.cb-rise    { animation: cbRise  320ms var(--cb-ease) both; }
.cb-pop     { animation: cbPop   320ms var(--cb-ease) both; }
.cb-gate    { animation: cbGate  460ms var(--cb-ease) both; }
.cb-hero    { animation: cbHero  460ms var(--cb-ease) both; }
.cb-modal   { animation: cbModal 560ms var(--cb-ease) both; will-change: transform, opacity, filter; }
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

/* ── Stagger cascade ──
   This was a pure opacity fade: items appeared in sequence but never
   moved, which is exactly what made every list in the app feel flat next
   to the Intro's rise-and-fade. Now it runs cbRise (translateY + fade,
   same gesture as the GSAP reveal system), with delays tightened from 60ms
   to 45ms — a longer per-item animation needs a shorter gap between items
   or the tail of a long list arrives noticeably late.

   The nth-child ladder is capped at 8 deliberately: past ~350ms of
   accumulated delay a cascade stops reading as choreography and starts
   reading as lag, so everything from the 9th item on shares one delay
   rather than continuing to add up. */
.cb-stagger > * { opacity: 0; animation: cbRise 320ms var(--cb-ease) both; }
.cb-stagger > *:nth-child(1) { animation-delay: 0ms; }
.cb-stagger > *:nth-child(2) { animation-delay: 45ms; }
.cb-stagger > *:nth-child(3) { animation-delay: 90ms; }
.cb-stagger > *:nth-child(4) { animation-delay: 135ms; }
.cb-stagger > *:nth-child(5) { animation-delay: 180ms; }
.cb-stagger > *:nth-child(6) { animation-delay: 225ms; }
.cb-stagger > *:nth-child(7) { animation-delay: 270ms; }
.cb-stagger > *:nth-child(8) { animation-delay: 315ms; }
.cb-stagger > *:nth-child(n+9) { animation-delay: 360ms; }

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
/* The pill itself already draws the accent ring above the moment anything
   inside it takes focus, and the input is a borderless element filling that
   pill — so the global :focus-visible ring firing on the input too stacked a
   second ring inside the first (visible on a real render). One focus
   indicator per control: the wrapper's, since that is the shape a person
   reads as "the search bar". Only suppressed where a wrapper ring is
   guaranteed to be showing — every other input in the app keeps its own. */
.cb-search-glow input:focus-visible {
  outline: none;
  box-shadow: none;
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
  /* Two shadows, not one: a tight contact shadow that keeps the card's
     edge readable, plus the wide ambient one that sells the lift. A single
     40px-blur shadow at 15% is nearly invisible on a light surface, which
     is why hover felt like it did nothing in light mode. */
  box-shadow: 0 2px 8px rgba(0,0,0,0.08), 0 16px 40px rgba(0,0,0,0.14);
  /* Motion alone isn't a state change - the border responding is what
     makes a card feel interactive rather than just animated. --cb-accent
     is already set per-theme on :root, so this tracks the user's accent. */
  border-color: color-mix(in srgb, var(--cb-accent, #34d399) 38%, transparent);
}

/* Source card hover lift */
.cb-src-card {
  transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1),
              box-shadow 0.25s, border-color 0.25s;
}
.cb-src-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 2px 6px rgba(0,0,0,0.06), 0 10px 28px rgba(0,0,0,0.10);
  border-color: color-mix(in srgb, var(--cb-accent, #34d399) 32%, transparent);
}

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
:focus-visible {
  /* Was "currentColor", which resolves to the focused element's own text
     color - on the faint/ghost buttons this app uses everywhere, that's a
     low-contrast grey ring on a low-contrast surface, i.e. a focus
     indicator you can't find with the keyboard. The accent is the one
     color guaranteed to be legible against every surface in every palette
     (it's chosen for exactly that), and the paired dark/light halo keeps
     it visible whichever side of the theme it lands on. */
  outline: 2px solid var(--cb-accent, #34d399);
  outline-offset: 2px;
  border-radius: 6px;
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--cb-accent, #34d399) 22%, transparent);
}

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
  /* Commit 55: the badge used to reserve an 18px-wide box with 3px of side
     padding and a 1px margin on each side for what is usually a single
     digit — so a citation followed by a full stop rendered as "ends 1 3 ."
     with a visible gap before the punctuation (the answer text itself has
     no space there; renderAnswer strips it). Tightening the box to hug its
     own digits closes the gap without making the badge harder to hit: the
     tap target is padded, not the glyph box, and it still reads as a
     distinct chip rather than superscript text. */
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 0; height: 16px;
  font-size: 10px; font-weight: 700; font-family: var(--cb-mono);
  text-decoration: none;
  border-radius: 4px;
  vertical-align: super;
  padding: 0 4px;
  margin: 0;
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
   Turn's paperReady effect adds for exactly the duration of window.print().

   v6: this used to render deep inside the app tree and get lifted out with
   position:absolute + "visibility:hidden everything else" + a huge z-index,
   so it could visually overlay the (still in-flow) app underneath. That
   out-of-flow trick is what caused two real, user-visible bugs, confirmed
   by comparing a plain print-media style inspection (correct 7in width)
   against an actual paginated page.pdf() export (word-per-line columns):
   Chromium's print pagination computes an out-of-flow box's available
   width per page fragment wrong once its content spans more than one
   printed page, and an out-of-flow box never contributes to the document's
   flowed height, so the exported page count tracked the hidden chat
   underneath instead of the paper's real length (hence trailing blank
   pages too). Fixed at the root: the JSX now renders this node through a
   portal onto <body> (see Turn's return), so here it's a plain static,
   in-flow block with body as its only ancestor — ordinary multi-page
   article pagination, the kind every printable web page already relies
   on, lays it out correctly. */
.cb-print-paper-doc { display: none; }
@media print {
  /* The portal makes .cb-print-paper-doc a direct sibling of #root, so
     hiding #root (rather than "every element, then unhide one subtree")
     is both simpler and correct: nothing under #root can be this node's
     containing block or bleed a stray width/position into it anymore. */
  body.cb-printing-paper #root { display: none !important; }
  body.cb-printing-paper .cb-print-paper-doc {
    display: block !important; background: #fff !important;
  }
  .cb-paper-page {
    position: relative; z-index: 1; max-width: 7in; margin: 0 auto; padding: 0.6in 0 1in;
    font-family: "Times New Roman", Times, serif; color: #000 !important;
    /* Commit 51: this is what actually put the watermark "above the text
       and a little too visible." The blanket "body, div { background:
       white }" rule a few lines up gives THIS div an opaque white fill it
       never asked for; Commit 49 raised the watermark's z-index above it
       (to fix it disappearing behind that same opaque fill on every full
       page), which incidentally also raised it above this div's own
       children — i.e. the actual paragraph text — painting the watermark
       over every word instead of the page background. The real fix is
       here, not in the z-index: an explicit transparent background (more
       specific than the blanket div rule, so it wins) means there's no
       opaque layer left for anything to hide behind OR paint over. Verified
       against a real multi-page page.pdf() render: with this in place the
       watermark can go back to sitting behind the text (see z-index below)
       and still shows through correctly on every page, blank ones included. */
    background: transparent !important;
  }
  .cb-paper-masthead { display: flex; align-items: center; justify-content: center; gap: 7pt; margin: 0 0 16pt; }
  .cb-paper-masthead-text { font-family: "Helvetica Neue", Arial, sans-serif; font-size: 11pt; font-weight: 700; letter-spacing: 0.14em; color: #000 !important; }
  .cb-paper-title { font-size: 18pt; font-weight: 700; text-align: center; margin: 0 0 6pt; line-height: 1.3; }
  .cb-paper-byline { font-size: 10pt; text-align: center; color: #444 !important; margin: 0 0 28pt; font-style: italic; }
  .cb-paper-section-label { font-size: 12pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin: 22pt 0 8pt; border-bottom: 1pt solid #000; padding-bottom: 2pt; }
  .cb-paper-heading { font-size: 12pt; font-weight: 700; margin: 16pt 0 6pt; }
  .cb-paper-para { font-size: 11pt; line-height: 1.7; text-align: justify; text-indent: 0.3in; margin: 0 0 10pt; }
  .cb-paper-ref { font-size: 9.5pt; line-height: 1.5; text-indent: -0.25in; padding-left: 0.25in; margin: 0 0 6pt; text-align: left; }
  /* z-index: 0 — BELOW .cb-paper-page's z-index:1, so it sits behind the
     actual text like a real watermark should. This node repeats correctly
     on every printed page via position:fixed (verified). Commit 49 had put
     this ABOVE the page (z-index: 2) because .cb-paper-page's opaque
     "background: white" (from the blanket print rule) was painting over it
     on every full page — that's fixed at the source now (.cb-paper-page is
     explicitly transparent, above), so the watermark no longer needs to
     out-rank it to be visible, and can go back to reading as a background
     wash instead of a layer sitting on top of every word. Opacity dropped
     0.1 → 0.06 at the same time — "a lil too visible" even before this z-index
     issue, per Dusty's report. Verified against a real multi-page
     page.pdf() render, including the short/blank-space-below-the-text case
     Commit 49's comment called out. */
  .cb-paper-watermark {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-35deg);
    font-size: 90pt; font-weight: 800; color: rgba(0,0,0,0.06) !important; z-index: 0;
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



/* ══════════════════════════════════════════════════════════════════
   Commit 66 — the polish layer.

   Everything below is opt-in by class or scoped to a safe property. The
   app sets "transform" inline via JS on a few controls (the ask button's
   hover scale, for instance) and an inline style always beats a stylesheet
   rule — so a global button:active{transform:...} would look like it
   works everywhere and silently do nothing on exactly the buttons people
   press most. Press feedback is therefore a class you apply, not a
   blanket selector.
   ══════════════════════════════════════════════════════════════════ */

/* Every button gets its color/background changes eased. This is the single
   cheapest upgrade in the file: the difference between a UI that snaps and
   one that feels considered is usually 160ms on the properties that were
   already changing. "transform" is deliberately NOT in this list — see
   above. */
button, a, .cb-tap {
  transition: background-color 0.18s ease, border-color 0.18s ease,
              color 0.18s ease, opacity 0.18s ease, box-shadow 0.22s ease;
}

/* Opt-in press feedback. A control that doesn't move when you push it
   reads as a picture of a button. */
.cb-deck-btn, .cb-press {
  transition: transform 0.14s cubic-bezier(0.16, 1, 0.3, 1),
              background-color 0.18s ease, border-color 0.18s ease, color 0.18s ease;
}
.cb-deck-btn:hover, .cb-press:hover { transform: translateY(-1px); }
.cb-deck-btn:active, .cb-press:active { transform: translateY(0) scale(0.97); }

/* ── Home Deck cards ──
   .cb-card already supplies the lift, the two-layer shadow and the accent
   border on hover. What a deck cell adds is a hairline of accent along its
   top edge that wipes in from the left — a small "this one is live"
   signal that doesn't cost a color change or a size change. */
.cb-deck-card { position: relative; overflow: hidden; }
.cb-deck-card::before {
  content: '';
  position: absolute; top: 0; left: 0; right: 0; height: 1px;
  background: linear-gradient(90deg,
    color-mix(in srgb, var(--cb-accent, #34d399) 70%, transparent),
    transparent);
  transform: scaleX(0); transform-origin: left center;
  transition: transform 0.55s cubic-bezier(0.16, 1, 0.3, 1);
  pointer-events: none;
}
.cb-deck-card:hover::before { transform: scaleX(1); }

/* The stats strip lifts as one object rather than per-number — the four
   counts are one reading, not four cards. */
.cb-deck-stats { transition: border-color 0.3s ease; }
.cb-deck-stats:hover {
  border-color: color-mix(in srgb, var(--cb-accent, #34d399) 26%, transparent);
}

/* ── Selection ──
   Default browser blue on a themed dark surface is the one place the app
   still looked like an unstyled document. */
::selection {
  background: color-mix(in srgb, var(--cb-accent, #34d399) 30%, transparent);
  color: inherit;
}

/* ── Keyboard focus ──
   Scrollbars are hidden app-wide (see above), which makes keyboard
   navigation the only way some surfaces are reachable — so the focus ring
   has to be genuinely visible, and in the user's accent rather than the
   platform default. :focus-visible only, so it never fires on a mouse
   click. */
:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--cb-accent, #34d399) 70%, transparent);
  outline-offset: 2px;
  border-radius: 3px;
}

/* The existing reduced-motion block at the end of this stylesheet zeroes
   animations and transitions. The one thing it can't do is un-hide
   something whose resting state is "collapsed until hover" — so the deck
   card's accent hairline is pinned open here instead of never appearing. */
@media (prefers-reduced-motion: reduce) {
  .cb-deck-card::before { transform: scaleX(1); }
}


/* ── Trending cards ──
   .cb-trend-card and .cb-trend-hero were applied in the markup and had no
   rules anywhere in this stylesheet — dead class names, so the whole
   Trending grid was the one major surface in the app with no hover
   response at all. They behave like .cb-card, plus the thing a card with a
   photograph should do: the image scales inside its own frame while the
   card lifts, which reads as depth rather than as the card growing. */
.cb-trend-card, .cb-trend-hero {
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1),
              border-color 0.3s ease, box-shadow 0.3s ease;
  will-change: transform;
}
.cb-trend-card:hover, .cb-trend-hero:hover {
  transform: translateY(-3px);
  box-shadow: 0 2px 8px rgba(0,0,0,0.08), 0 16px 40px rgba(0,0,0,0.16);
  border-color: color-mix(in srgb, var(--cb-accent, #34d399) 38%, transparent);
}
.cb-trend-card img, .cb-trend-hero img {
  transition: transform 0.6s cubic-bezier(0.16, 1, 0.3, 1);
}
.cb-trend-card:hover img, .cb-trend-hero:hover img { transform: scale(1.045); }
.cb-trend-card:active, .cb-trend-hero:active { transform: translateY(-1px) scale(0.995); }

/* ── Interactive list rows ──
   For lists that aren't card grids — inbox threads, saved papers, history
   entries. A row shouldn't lift (it has neighbours directly above and
   below and lifting one shoves the eye), so it gets an inset accent rail
   on the left and a faint wash instead. Same interaction language, correct
   for the shape. */
.cb-row {
  position: relative;
  transition: background-color 0.2s ease, padding-left 0.24s cubic-bezier(0.16, 1, 0.3, 1);
}
.cb-row::before {
  content: '';
  position: absolute; left: 0; top: 6px; bottom: 6px; width: 2px;
  background: var(--cb-accent, #34d399);
  border-radius: 2px;
  transform: scaleY(0); transform-origin: center;
  transition: transform 0.28s cubic-bezier(0.16, 1, 0.3, 1);
  pointer-events: none;
}
.cb-row:hover {
  background: color-mix(in srgb, var(--cb-accent, #34d399) 6%, transparent);
}
.cb-row:hover::before { transform: scaleY(1); }


/* ══════════════════════════════════════════════════════════════════
   Commit 71 — texture.

   The single strongest "this was generated" tell in a dark UI is that it
   is perfectly, mathematically clean: flat fills, mathematically smooth
   gradients, not one pixel of noise anywhere. Real screens photographed,
   real print, real film all have grain, and the eye reads its absence as
   synthetic long before it can say why.

   This is a fixed, non-interactive film-grain layer at very low opacity
   over the whole app, plus a soft vignette that stops the corners from
   being the same value as the centre. Both are inline SVG turbulence and
   a radial gradient — no image request, no bytes over the wire, no
   layout cost. pointer-events:none so it can never eat a click.
   ══════════════════════════════════════════════════════════════════ */
/* Commit 79 — mix-blend-mode removed. It was a performance bug, not a
   style choice.
   A blend mode on a fixed, full-viewport layer forces the browser to
   composite the ENTIRE page against that layer, and to redo it on every
   scroll, every hover, every animation frame underneath. On a page that
   already runs a WebGL background and GSAP timelines, that is the
   difference between smooth and the reported "so laggy". Plain low-opacity
   noise gets ~90% of the texture for none of the compositing cost — the
   grain is a whisper either way, and a whisper is not worth a frame. */
.cb-grain {
  position: fixed;
  inset: 0;
  z-index: 9999;
  pointer-events: none;
  opacity: 0.03;
  /* Tell the compositor this layer never changes, so it can be uploaded
     once and left alone instead of being re-rasterized. */
  will-change: auto;
  contain: strict;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E");
  background-repeat: repeat;
  background-size: 160px 160px;
}
.cb-vignette {
  position: fixed;
  inset: 0;
  z-index: 9998;
  pointer-events: none;
  contain: strict;
  /* Commit 82 — was 0.28, which crushed the corners hard enough that the
     aurora behind the page read as flat: "the backgrounds are gone". A
     vignette is meant to be felt, not seen. */
  background: radial-gradient(ellipse 130% 100% at 50% 45%, transparent 55%, rgba(0,0,0,0.10) 100%);
}
/* On a light palette the same vignette reads as dirt rather than depth,
   so it lightens instead of darkening. */
:root[data-cb-light] .cb-vignette {
  background: radial-gradient(ellipse 120% 90% at 50% 40%, transparent 45%, rgba(0,0,0,0.06) 100%);
}
@media (prefers-reduced-transparency: reduce) {
  .cb-grain, .cb-vignette { display: none; }
}


/* ── Commit 74: the founder's frame ──
   A slowly rotating conic ring around the avatar. Slow on purpose — 12
   seconds, so it reads as a sheen catching the light rather than a
   spinner, which would say "loading" instead of "this is the owner".
   Honours reduced motion by simply not turning; the gradient ring is still
   there and still unmistakable. */
.cb-founder-ring { animation: cbFounderSpin 12s linear infinite; }
@keyframes cbFounderSpin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .cb-founder-ring { animation: none; } }

/* The profile avatar's own frame: a gradient halo drawn behind the
   existing photo/initial rather than replacing it, so nothing about the
   upload flow changes. */
.cb-founder-avatar::before {
  content: '';
  position: absolute;
  inset: -7px;
  border-radius: 50%;
  background: conic-gradient(from 0deg, #c9a227, #f4e2a1, #2f7fe6, #c9a227);
  animation: cbFounderSpin 12s linear infinite;
  z-index: -1;
}
@media (prefers-reduced-motion: reduce) { .cb-founder-avatar::before { animation: none; } }

.cb-founder-card { transition: border-color 0.3s ease, box-shadow 0.3s ease; }
.cb-founder-card:hover {
  border-color: rgba(201,162,39,0.6);
  box-shadow: 0 2px 8px rgba(0,0,0,0.08), 0 14px 36px rgba(0,0,0,0.16);
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


export { App, InfoPage, CSS };
