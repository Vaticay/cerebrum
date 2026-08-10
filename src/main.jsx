import React, { useState, useRef, useEffect, useCallback } from "react";
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
function getCookie(k) { try { const m = document.cookie.match(new RegExp("(?:^|; )" + k + "=([^;]*)")); return m ? decodeURIComponent(m[1]) : null; } catch { return null; } }

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");
const MOD = IS_MAC ? "⌘" : "Ctrl";
const kbdLabel = (key) => `${MOD}${IS_MAC ? "" : "+"}${key}`;

const LOADING_MESSAGES = [
  "Is this the Krusty Krab? No, this is Cerebrum",
  "Reticulating splines (legally required)",
  "One does not simply search PubMed",
  "It's not a bug, it's peer review",
  "Enhancing... enhancing... enhancing",
  "Downloading more RAM for science",
  "Yes chef",
  "He who controls the citations controls the universe",
  "Somebody once told me the results are gonna roll in",
  "Loading... and my axe",
  "This is fine",
  "The cake is a preprint",
  "I'm sorry Dave, I'm afraid I found 47 papers",
  "Do a barrel roll through the literature",
  "It's dangerous to go alone, take this citation",
  "Achievement unlocked: asked a real question",
  "Press F to pay respects to null results",
  "Task failed successfully (just kidding, still loading)",
  "Vaticay was here",
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
  "Beeping. Also booping",
  "Aligning the chakras of the citation graph",
  "Doing the little citation dance",
  "Politely asking the electrons to hurry",
  "Consulting the ghost of Carl Sagan",
  "Sagan says: billions and billions of results",
  "Rolling for initiative against the paywall",
  "Sharpening the Occam's razor",
  "Applying Occam's razor. Ouch",
  "Dividing by n-1 out of respect",
  "Correcting for multiple comparisons, reluctantly",
  "Bonferroni is coming for your p-values",
  "Wondering if the mitochondria is still the powerhouse",
  "Confirming: mitochondria, still the powerhouse",
  "Checking if it's lupus. It's never lupus",
  "42",
  "Still 42",
  "Trust me, I'm a language model",
  "Making the little numbers go up",
  "Asking nicely. Now asking firmly",
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
function readingTime(text) { const w = (text || "").trim().split(/\s+/).length; const m = Math.max(1, Math.round(w / 220)); return `${m} min read`; }

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
      const key = "cerebrum" + year + "_" + index;
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
  Dark:  { dark: true,  bg: "#050816", surface: "#0c1222", raised: "#131c30", ink: "#f0f2f8", ink2: "#94a0b8", faint: "#4e5a70", line: "rgba(148,160,184,0.07)", line2: "rgba(148,160,184,0.12)", shadow: "0 2px 4px rgba(0,0,0,0.4), 0 16px 56px rgba(0,0,0,0.5)", shadowSm: "0 1px 3px rgba(0,0,0,0.5)", grain: 0.01, skel: "linear-gradient(90deg, #0c1222 25%, #131c30 50%, #0c1222 75%)" },
  Mid:   { dark: true,  bg: "#0a0d15", surface: "#111827", raised: "#1f2937", ink: "#f3f4f6", ink2: "#9ca3af", faint: "#4b5563", line: "rgba(156,163,175,0.08)", line2: "rgba(156,163,175,0.13)", shadow: "0 2px 4px rgba(0,0,0,0.4), 0 16px 56px rgba(0,0,0,0.5)", shadowSm: "0 1px 3px rgba(0,0,0,0.4)", grain: 0.014, skel: "linear-gradient(90deg, #111827 25%, #1f2937 50%, #111827 75%)" },
  Light: { dark: false, bg: "#f8f9fc", surface: "#ffffff", raised: "#ffffff", ink: "#0f172a", ink2: "#475569", faint: "#94a3b8", line: "rgba(15,23,42,0.06)", line2: "rgba(15,23,42,0.10)", shadow: "0 1px 2px rgba(0,0,0,0.04), 0 8px 32px rgba(0,0,0,0.07)", shadowSm: "0 1px 2px rgba(0,0,0,0.05)", grain: 0.006, skel: "linear-gradient(90deg, #f1f5f9 25%, #f8fafc 50%, #f1f5f9 75%)" },
};
const ACCENTS = { Emerald: "#34d399", Indigo: "#818cf8", Sky: "#38bdf8", Amber: "#fbbf24", Rose: "#fb7185", Violet: "#a78bfa", Teal: "#2dd4bf", Cyan: "#22d3ee" };

function accentText(hex) {
  if (!hex || hex[0] !== "#" || hex.length < 7) return "#111";
  const r = parseInt(hex.slice(1, 3), 16),
        g = parseInt(hex.slice(3, 5), 16),
        b = parseInt(hex.slice(5, 7), 16);
  const L = (0.299 * r + 0.587 * g + 0.114 * b);
  return L > 175 ? "#0f172a" : "#fff";
}
function withAlpha(hex, a) { const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16); return `rgba(${r},${g},${b},${a})`; }

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
    .replace(/\(([\d,\s]+)\)/g, (m, nums) => {
      const ds = nums.split(/[,\s]+/).map(n => parseInt(n,10)).filter(n => n > 0 && n <= (sources||[]).length);
      return ds.length ? ds.map(n => "["+n+"]").join("") : m;
    })
    .replace(/([a-z])\s+(\d(?:\s*,?\s*\d){0,8})\s*([.;,])/gi, (m, b, nums, p) => {
      const ds = nums.split(/[,\s]+/).map(n => parseInt(n,10)).filter(n => n > 0 && n <= (sources||[]).length);
      return ds.length >= 1 ? b + " " + ds.map(n => "["+n+"]").join("") + p : m;
    })
    .replace(/\n[-—]{2,}\s*\n/g, "\n\n")
    .replace(/\n\s*(references|sources|bibliography|citations|works cited)\s*:?\s*\n[\s\S]*$/i, "")
    .trim();
  return clean.split(/\n{2,}/).map((para, pi) => (
    <p key={pi} style={{ fontSize: 16, lineHeight: 1.8, margin: "0 0 18px", color: P.ink, letterSpacing: "-0.008em", fontFamily: "var(--cb-body)", fontWeight: 420 }}>
      {para.split("\n").map((line, li) => (
        <React.Fragment key={li}>
          {line.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*|\[\d+\])/g).map((seg, si) => {
            const b = seg.match(/^\*\*([^*]+)\*\*$/);
            if (b) return <strong key={si} style={{ color: P.ink, fontWeight: 600 }}>{b[1]}</strong>;
            const it = seg.match(/^\*([^*\n]+)\*$/);
            if (it) return <em key={si} style={{ fontStyle: "italic", color: P.ink }}>{it[1]}</em>;
            const c = seg.match(/^\[(\d+)\]$/);
            if (c) {
              const n = parseInt(c[1], 10); const src = sources[n - 1];
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
          })}
          {li < para.split("\n").length - 1 && <br />}
        </React.Fragment>
      ))}
    </p>
  ));
}
function at2(a) { return a; }


/* ============================================================
   FACT CHECK, SKELETON, LOADING — redesigned visuals, same logic
   ============================================================ */
function FactCheck({ fc, P, accent }) {
  const colors = { supported: "#10b981", partly: "#d9a520", unsupported: "#e5484d", thin: "#d9a520" };
  const label = { supported: "Supported by sources", partly: "Partly supported", unsupported: "Not supported by sources" };
  const oc = colors[fc.overall] || P.ink2;
  const claims = fc.claims || [];
  const nSup = claims.filter((c) => c.status === "supported").length;
  const nThin = claims.filter((c) => c.status === "thin").length;
  const nUns = claims.filter((c) => c.status === "unsupported").length;
  const total = claims.length;
  const score = total ? Math.round(((nSup + nThin * 0.5) / total) * 100) : null;
  const scoreColor = score === null ? P.ink2 : score >= 75 ? "#10b981" : score >= 45 ? "#d9a520" : "#e5484d";
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
            {nSup > 0 && <div style={{ flex: nSup, background: "#10b981", borderRadius: 2 }} title={`${nSup} supported`} />}
            {nThin > 0 && <div style={{ flex: nThin, background: "#d9a520", borderRadius: 2 }} title={`${nThin} thin`} />}
            {nUns > 0 && <div style={{ flex: nUns, background: "#e5484d", borderRadius: 2 }} title={`${nUns} unsupported`} />}
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 8, fontFamily: "var(--cb-mono)", fontSize: 10.5, color: P.faint }}>
            <span>{nSup} solid</span><span>{nThin} thin</span><span>{nUns} unsupported</span>
          </div>
        </div>
      )}
      {fc.summary && <div style={{ fontSize: 14, color: P.ink2, marginBottom: claims.length ? 14 : 0, lineHeight: 1.6, paddingTop: score !== null ? 14 : 0, borderTop: score !== null ? `1px solid ${P.line}` : "none" }}>{fc.summary}</div>}
      {claims.map((c, i) => {
        const cc = colors[c.status] || P.ink2; const sym = c.status === "supported" ? "✓" : c.status === "thin" ? "~" : "✕";
        return (
          <div key={i} style={{ display: "flex", gap: 12, padding: "10px 0", borderTop: i ? `1px solid ${P.line}` : "none" }}>
            <span style={{ color: cc, fontSize: 11, flexShrink: 0, fontWeight: 700, fontFamily: "var(--cb-mono)", width: 18, height: 18, borderRadius: 6, background: withAlpha(cc, 0.1), display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>{sym}</span>
            <div><div style={{ fontSize: 13.5, color: P.ink, lineHeight: 1.5 }}>{c.claim}</div>{c.note && <div style={{ fontSize: 12, color: P.faint, marginTop: 3, lineHeight: 1.5 }}>{c.note}</div>}</div>
          </div>
        );
      })}
    </div>
  );
}

function Skeleton({ P }) {
  const bar = (w) => <div style={{ height: 12, width: w, borderRadius: 4, background: P.skel, backgroundSize: "200% 100%", animation: "cbShimmer 1.3s infinite" }} />;
  return (
    <div style={{ background: P.surface, border: `1px solid ${P.line}`, borderRadius: 14, padding: "24px 28px", display: "flex", flexDirection: "column", gap: 12 }}>
      {bar("90%")}{bar("100%")}{bar("82%")}<div style={{ height: 4 }} />{bar("94%")}{bar("68%")}
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
  const STAGES = [
    "Querying 16 indexes",
    "Merging and de-duplicating",
    "Scoring relevance",
    "Checking for retractions",
    "Writing the answer",
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
    return () => { clearInterval(msgId); clearInterval(stageId); };
  }, []);

  return (
    <div style={{ padding: "20px 0 4px" }}>
      {/* Synapse loader */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }} aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span key={i} style={{
              width: 6, height: 6, borderRadius: "50%",
              background: accent,
              animation: `cbSynapse 1.25s ${i * 0.18}s cubic-bezier(0.4, 0, 0.6, 1) infinite`,
            }} />
          ))}
        </div>
        <span key={msg} className="cb-fade" style={{ fontSize: 13.5, color: P.ink2, letterSpacing: "-0.01em", fontWeight: 450, fontFamily: "var(--cb-body)" }}>
          {msg}
        </span>
      </div>
      {/* Stage progress */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, paddingLeft: 1 }}>
        <div style={{ display: "flex", gap: 3 }} aria-hidden="true">
          {STAGES.map((_, i) => (
            <span key={i} style={{
              width: i === stage ? 20 : 4, height: 3, borderRadius: 2,
              background: i <= stage ? accent : P.line2,
              opacity: i <= stage ? 1 : 0.5,
              transition: "width 320ms cubic-bezier(0.16,1,0.3,1), background 320ms",
            }} />
          ))}
        </div>
        <span key={stage} className="cb-fade" style={{ fontSize: 11, color: P.faint, fontFamily: "var(--cb-mono)", letterSpacing: "0.02em" }}>
          {STAGES[stage]}
        </span>
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
      <div ref={vantaRef} style={{ position: "absolute", inset: 0, zIndex: 0 }} />

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
            <a key={item} href={`/${item.toLowerCase()}`} style={{ fontSize: 13, color: "#6b7a90", textDecoration: "none", fontWeight: 450, transition: "color 0.2s" }}
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
          Cerebrum searches 16 scholarly databases in parallel and writes
          you an answer where every claim traces back to a real, citable source.
        </p>

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
        <span style={{ fontSize: 10, color: "#3d4a5c", fontFamily: "var(--cb-mono)", letterSpacing: "0.1em" }}>+10</span>
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
    ensureVanta().then(() => setLoaded(true));
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
          mouseControls: true,
          touchControls: true,
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
          mouseControls: true, touchControls: true, gyroControls: false,
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
          mouseControls: true, touchControls: true, gyroControls: false,
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

  return (
    <div ref={containerRef} style={{
      position: "fixed", inset: 0, width: "100%", height: "100%",
      pointerEvents: "none", zIndex: 0,
      opacity: intensity === "subtle" ? 0.35 : 0.65,
      transition: "opacity 0.5s ease",
    }} aria-hidden="true" />
  );
}

function BrainEasterEgg() {
  const [wiggleKey, setWiggleKey] = useState(0);
  const trigger = () => setWiggleKey((k) => k + 1);
  return { trigger, wiggleKey, render: null };
}


/* ════════════════════════════════════════════════════════════════
   UPGRADE 1: CUSTOM BLEND-MODE CURSOR
   
   Hides the default cursor. Renders a glowing dot with a trailing 
   ring that expands + inverts over actionable elements via 
   mix-blend-mode: difference. Pure React, no dependencies.
   ════════════════════════════════════════════════════════════════ */
function Magnetic({ children, strength = 0.3, style, className, ...props }) {
  const ref = useRef(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const animRef = useRef(null);
  const targetRef = useRef({ x: 0, y: 0 });
  const currentRef = useRef({ x: 0, y: 0 });

  const onMove = (e) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    targetRef.current = {
      x: (e.clientX - cx) * strength,
      y: (e.clientY - cy) * strength,
    };
  };
  const onLeave = () => {
    targetRef.current = { x: 0, y: 0 };
  };

  useEffect(() => {
    const hasMouse = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (!hasMouse) return;
    const lerp = (a, b, t) => a + (b - a) * t;
    const loop = () => {
      currentRef.current.x = lerp(currentRef.current.x, targetRef.current.x, 0.12);
      currentRef.current.y = lerp(currentRef.current.y, targetRef.current.y, 0.12);
      if (Math.abs(currentRef.current.x) > 0.05 || Math.abs(currentRef.current.y) > 0.05 ||
          Math.abs(targetRef.current.x) > 0.05 || Math.abs(targetRef.current.y) > 0.05) {
        setOffset({ x: currentRef.current.x, y: currentRef.current.y });
      }
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  return (
    <div ref={ref} onMouseMove={onMove} onMouseLeave={onLeave}
      style={{ display: "inline-flex", transform: `translate3d(${offset.x}px, ${offset.y}px, 0)`, transition: "transform 0.1s ease", ...style }}
      className={className} {...props}>
      {children}
    </div>
  );
}


/* ════════════════════════════════════════════════════════════════
   UPGRADE 3: MOUSE-TRACKING GLOW BORDER
   
   Wraps the search bar. Renders a radial glow that follows the 
   mouse X/Y along the border. Creates a localized light source.
   ════════════════════════════════════════════════════════════════ */
function KineticText({ text, style, className }) {
  return (
    <span className="cb-gradient-text" style={{ ...style, display: "inline-block" }} aria-label={text}>
      {text}
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
  const playBrowser = () => { if (!window.speechSynthesis) return; window.speechSynthesis.cancel(); const utter = new SpeechSynthesisUtterance(text); utter.rate = 1.0; utter.pitch = 1.0; const voices = window.speechSynthesis.getVoices(); const pref = voices.find((v) => /Google.*(US|English)|Samantha|Alex|Karen|Daniel/i.test(v.name)) || voices.find((v) => /en/i.test(v.lang)); if (pref) utter.voice = pref; utter.onstart = () => setStatus("playing"); utter.onend = () => { setStatus("idle"); setProgress(0); }; utter.onerror = () => { setStatus("idle"); setProgress(0); }; utter.onboundary = (e) => { if (e.charIndex && text.length) setProgress(e.charIndex / text.length); }; utterRef.current = utter; window.speechSynthesis.speak(utter); };
  const playEleven = async () => { const key = localStorage.getItem("cb_eleven_key"); const voiceId = localStorage.getItem("cb_eleven_voice") || "21m00Tcm4TlvDq8ikWAM"; if (!key) return playBrowser(); setStatus("loading"); try { const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, { method: "POST", headers: { "xi-api-key": key, "Content-Type": "application/json" }, body: JSON.stringify({ text, model_id: "eleven_flash_v2_5", voice_settings: { stability: 0.5, similarity_boost: 0.75 } }) }); if (!res.ok) throw new Error("ElevenLabs error " + res.status); const blob = await res.blob(); const url = URL.createObjectURL(blob); const audio = new Audio(url); audioRef.current = audio; audio.ontimeupdate = () => { if (audio.duration) setProgress(audio.currentTime / audio.duration); }; audio.onended = () => { setStatus("idle"); setProgress(0); URL.revokeObjectURL(url); audioRef.current = null; }; audio.onerror = () => { setStatus("idle"); playBrowser(); }; await audio.play(); setStatus("playing"); } catch { playCerebrum(); } };
  const playCerebrum = async () => { setStatus("loading"); try { let voicePref = ""; try { voicePref = localStorage.getItem("cb_tts_voice") || ""; } catch {} const res = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, voice: voicePref }) }); if (!res.ok) throw new Error("TTS " + res.status); const ct = res.headers.get("content-type") || ""; if (!ct.startsWith("audio/")) throw new Error("Non-audio response"); const blob = await res.blob(); const url = URL.createObjectURL(blob); const audio = new Audio(url); audioRef.current = audio; audio.ontimeupdate = () => { if (audio.duration) setProgress(audio.currentTime / audio.duration); }; audio.onended = () => { setStatus("idle"); setProgress(0); URL.revokeObjectURL(url); audioRef.current = null; }; audio.onerror = () => { setStatus("idle"); playBrowser(); }; await audio.play(); setStatus("playing"); } catch { playBrowser(); } };
  const onClick = () => { if (status === "playing") { if (audioRef.current) { audioRef.current.pause(); setStatus("paused"); return; } try { window.speechSynthesis.pause(); setStatus("paused"); } catch {} return; } if (status === "paused") { if (audioRef.current) { audioRef.current.play(); setStatus("playing"); return; } try { window.speechSynthesis.resume(); setStatus("playing"); } catch {} return; } if (useElevenLabs) playEleven(); else playCerebrum(); };
  useEffect(() => () => stop(), []);
  const label = status === "loading" ? "Loading..." : status === "playing" ? "Pause" : status === "paused" ? "Resume" : "Listen";
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 12 }}>
      <button onClick={onClick} style={{ padding: "6px 14px", fontSize: 11.5, fontWeight: 550, background: status === "playing" || status === "paused" ? accent : "transparent", color: status === "playing" || status === "paused" ? accentText(accent) : P.ink2, border: `1px solid ${status === "playing" || status === "paused" ? accent : P.line2}`, borderRadius: 8, cursor: "pointer", fontFamily: "var(--cb-mono)", display: "inline-flex", alignItems: "center", gap: 6, letterSpacing: "0.01em" }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">{status === "playing" ? (<><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></>) : (<path d="M8 5v14l11-7z" />)}</svg>
        {label}
      </button>
      {(status === "playing" || status === "paused") && (
        <div style={{ width: 80, height: 2, background: P.line, borderRadius: 1, overflow: "hidden" }}>
          <div style={{ width: "100%", height: "100%", background: accent, transformOrigin: "left", transform: `scaleX(${progress})`, transition: "transform 0.15s ease" }} />
        </div>
      )}
      {(status === "playing" || status === "paused") && (
        <button onClick={stop} title="Stop" style={{ background: "transparent", border: "none", cursor: "pointer", color: P.faint, padding: 2, fontSize: 13, lineHeight: 1 }}>×</button>
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
        <button key={v} onClick={() => set(v)} style={{ flex: 1, padding: "9px 6px", fontSize: 12, fontWeight: 550, background: voice === v ? accent : "transparent", color: voice === v ? at : P.ink2, border: `1px solid ${voice === v ? accent : P.line}`, borderRadius: 8, cursor: "pointer", fontFamily: "inherit" }}>{label}</button>
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
      <input type="password" placeholder="ElevenLabs API key (optional)" value={key} onChange={(e) => setKey(e.target.value)} style={{ padding: "10px 12px", fontSize: 12.5, background: P.surface, color: P.ink, border: `1px solid ${P.line}`, borderRadius: 8, fontFamily: "inherit", outline: "none" }} />
      <select value={voice} onChange={(e) => setVoice(e.target.value)} style={{ padding: "10px 12px", fontSize: 12.5, background: P.surface, color: P.ink, border: `1px solid ${P.line}`, borderRadius: 8, fontFamily: "inherit", cursor: "pointer", outline: "none" }}>
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
function InfoPage({ page }) {
  const paletteName = (() => { try { return getCookie("cb_palette") || "Dark"; } catch { return "Dark"; } })();
  const P = PALETTES[paletteName] || PALETTES.Dark;
  const accentName = (() => { try { return getCookie("cb_accent") || "Amber"; } catch { return "Amber"; } })();
  const customAccent = (() => { try { return getCookie("cb_accentCustom") || ""; } catch { return ""; } })();
  const accent = customAccent || ACCENTS[accentName] || ACCENTS.Amber;
  const at = accentText(accent);
  const isMobile = useIsMobile();
  const goHome = () => { try { setCookie("cb_entered_v4", "1", 365); } catch {} window.location.href = "/"; };
  const PAGES = {
    about: { eyebrow: "About", title: "A research instrument, not a chatbot", lede: "A research instrument that searches real scholarly databases and gives you answers you can trace to the source.", blocks: [ { h: "What it does", p: "You ask a scientific question. Cerebrum queries a group of open scholarly databases in parallel, scores what comes back for genuine relevance, and writes a summary constrained by what those papers actually say. Every citation is a real DOI you can open and check." }, { h: "The databases", list: ["Europe PMC — 43M articles", "PubMed — 36M articles", "OpenAlex — 250M works", "Semantic Scholar — 220M papers", "Crossref — 150M works", "arXiv, bioRxiv, medRxiv — preprints", "DOAJ, PLOS, Zenodo — open access"] }, { h: "The principle", p: "If no papers are retrieved for a question, Cerebrum says so plainly rather than inventing sources. A confident guess dressed up as science is worse than an honest 'nothing found.' That constraint is enforced mechanically, not just requested politely." }, { h: "What it is not", list: ["Not a substitute for reading the papers — every summary is AI-generated, so verify anything you'll rely on.", "Not a medical, legal, or financial advisor.", "Not tracked or monetized — no ads, no account, no selling data."] } ] },
    privacy: { eyebrow: "Privacy", title: "We collect as little as physically possible", lede: "No tracking pixels. No third-party analytics. No account. No selling data — there is nothing to sell.", updated: "Last updated August 2026", blocks: [ { h: "What we don't do", list: ["No tracking pixels, third-party analytics, or ad networks.", "No account, email, or personal information required.", "No selling, sharing, or profiling of user data.", "No tracking cookies. Preferences live in your browser's local storage and never leave your device."] }, { h: "What happens when you search", list: ["Your question is sent to Cerebrum's server to query databases and generate an answer.", "Search terms are forwarded to scholarly APIs (Europe PMC, PubMed, OpenAlex, and others).", "The question is sent to a language-model provider (OpenRouter or Cloudflare Workers AI) to write the summary.", "Your IP is visible to Cloudflare for rate limiting and abuse prevention.", "We do not permanently store your questions."] }, { h: "Local storage", p: "Saved articles, session history, and preferences (theme, motion, voice) are stored only in your browser via localStorage. Clearing your browser data removes them entirely." }, { h: "Children", p: "Cerebrum is not directed at children under 13." } ] },
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
        .cb-info-navlink { transition: color .15s, background .15s; }
        .cb-info-navlink:hover { color: ${accent} !important; background: ${withAlpha(accent, 0.08)}; }
        .cb-fadein { animation: cbInfoFade .6s cubic-bezier(0.16,1,0.3,1) both; }
        @keyframes cbInfoFade { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
      `}</style>
      <div style={{ position: "fixed", inset: 0, opacity: 0.4, pointerEvents: "none", zIndex: 0 }}>
        <LivingBackground accent={accent} P={P} intensity="subtle" preset="aurora" density={0.7} speed={0.6} opacity={0.7} paused={false} />
      </div>
      <header style={{ position: "sticky", top: 0, zIndex: 10, background: withAlpha(P.bg, 0.85), backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", borderBottom: `1px solid ${P.line}` }}>
        <div style={{ maxWidth: 760, margin: "0 auto", padding: isMobile ? "14px 20px" : "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <button onClick={goHome} style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600, color: P.ink, fontSize: 16, background: "none", border: "none", cursor: "pointer", fontFamily: "var(--cb-display)", letterSpacing: "-0.02em", padding: 0 }}>
            <Mark size={18} accent={accent} /> Cerebrum
          </button>
          <nav style={{ display: "flex", gap: 2 }}>
            {NAV.map(([slug, label]) => (
              <a key={slug} href={`/${slug}`} className="cb-info-navlink" style={{ fontSize: 13, color: page === slug ? accent : P.ink2, textDecoration: "none", padding: "6px 10px", borderRadius: 6, fontWeight: page === slug ? 600 : 450 }}>{label}</a>
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
            {NAV.map(([slug, label]) => (<a key={slug} href={`/${slug}`} className="cb-info-navlink" style={{ fontSize: 13, color: page === slug ? accent : P.ink2, textDecoration: "none", padding: "5px 10px", borderRadius: 6, fontWeight: page === slug ? 600 : 450 }}>{label}</a>))}
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
  const copyAll = () => { navigator.clipboard.writeText(formatBibliography(sources, citationStyle)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); };
  const downloadFile = () => { const ext = citationStyle === "bibtex" ? "bib" : "txt"; download(`cerebrum-bibliography.${ext}`, formatBibliography(sources, citationStyle)); };
  return (
    <div style={{ marginTop: 24, border: P.dark ? "1px solid rgba(255,255,255,0.08)" : `1px solid ${P.line}`, borderRadius: 14, padding: "20px 24px", background: P.dark ? "rgba(5,8,22,0.6)" : withAlpha(P.surface, 0.8), backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)" }} className="cb-fade">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 3, height: 16, background: accent, borderRadius: 2 }} />
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.04em", color: P.ink, textTransform: "uppercase", fontFamily: "var(--cb-mono)" }}>Bibliography</div>
          <div style={{ fontSize: 11, color: P.faint, fontFamily: "var(--cb-mono)" }}>{sources.length}</div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <select value={citationStyle} onChange={(e) => setCitationStyle(e.target.value)} style={{ padding: "5px 8px", fontSize: 11.5, fontWeight: 500, background: P.bg, color: P.ink, border: `1px solid ${P.line}`, borderRadius: 6, cursor: "pointer", fontFamily: "var(--cb-mono)", outline: "none" }}>
            {styleOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          <button onClick={copyAll} style={bibBtn(P, accent)}>{copied ? "✓" : "Copy"}</button>
          <button onClick={downloadFile} style={bibBtn(P, accent)}>Download</button>
        </div>
      </div>
      <ol className="cb-stagger" style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {sources.map((src, i) => <BibEntry key={i} source={src} index={i + 1} P={P} accent={accent} style={citationStyle} className="cb-fade" />)}
      </ol>
    </div>
  );
}

function BibEntry({ source, index, P, accent, style, className }) {
  const [hover, setHover] = useState(false);
  const formatted = formatCitation(source, style, index);
  return (
    <li id={`ref-${index}`} className={className} style={{ padding: "12px 4px", borderTop: index === 1 ? "none" : `1px solid ${P.line}`, display: "flex", gap: 12, alignItems: "flex-start", background: hover ? withAlpha(accent, 0.03) : "transparent", borderRadius: 6, opacity: 0 }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div style={{ flexShrink: 0, minWidth: 24, color: accent, fontWeight: 600, fontSize: 11, fontFamily: "var(--cb-mono)", paddingTop: 2 }}>{index}.</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {(source.retracted || source.concern) && (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 8px", marginBottom: 6, background: source.retracted ? "rgba(229, 72, 77, 0.12)" : "rgba(217, 165, 32, 0.14)", border: `1px solid ${source.retracted ? "#e5484d" : "#d9a520"}`, borderRadius: 6, fontSize: 10, fontWeight: 700, color: source.retracted ? "#e5484d" : "#d9a520", letterSpacing: "0.04em", fontFamily: "var(--cb-mono)", textTransform: "uppercase" }}>
            <span>⚠</span><span>{source.retracted ? "RETRACTED" : "EXPRESSION OF CONCERN"}</span>
          </div>
        )}
        {style === "bibtex" ? (
          <pre style={{ fontSize: 11.5, fontFamily: "var(--cb-mono)", color: P.ink2, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{formatted}</pre>
        ) : (
          <div style={{ fontSize: 13, lineHeight: 1.55, color: P.ink }} dangerouslySetInnerHTML={{ __html: formatted.replace(/\*([^*]+)\*/g, '<em style="font-style: italic;">$1</em>').replace(/\n/g, "<br>") }} />
        )}
        {source.tldr && (
          <div style={{ fontSize: 12, color: P.ink2, marginTop: 8, padding: "8px 12px", background: withAlpha(accent, 0.04), borderLeft: `2px solid ${withAlpha(accent, 0.4)}`, borderRadius: 4, lineHeight: 1.55, fontStyle: "italic" }}>
            <span style={{ fontWeight: 600, fontStyle: "normal", color: accent, fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", marginRight: 6, fontFamily: "var(--cb-mono)" }}>TL;DR</span>{source.tldr}
          </div>
        )}
        {source.url && <a href={source.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: accent, textDecoration: "none", marginTop: 6, display: "inline-block", wordBreak: "break-all", fontFamily: "var(--cb-mono)" }}>{source.url.replace(/^https?:\/\//, "").slice(0, 55)}{source.url.length > 55 ? "…" : ""} ↗</a>}
        {(source.citations != null || source.type) && (
          <div style={{ fontSize: 10.5, color: P.faint, marginTop: 4, display: "flex", gap: 10, fontFamily: "var(--cb-mono)" }}>
            {source.type && <span>{source.type}</span>}
            {source.citations != null && <span>{source.citations.toLocaleString()} citation{source.citations === 1 ? "" : "s"}</span>}
          </div>
        )}
      </div>
    </li>
  );
}
function bibBtn(P, accent) { return { padding: "5px 10px", fontSize: 11, fontWeight: 500, background: "transparent", color: P.ink2, border: `1px solid ${P.line}`, borderRadius: 6, cursor: "pointer", fontFamily: "var(--cb-mono)", letterSpacing: "0.01em" }; }

function Turn({ t, P, accent, at, S, typewriter, hoverCite, setHoverCite, onRelated, citationStyle, setCitationStyle }) {
  const shown = useTypewriter(t.answer, typewriter && t.fresh);
  const done = shown === t.answer;
  return (
    <div style={S.turn} className="cb-rise">
      {/* Query label — monospaced, quiet */}
      <div style={S.qLabel}>
        <span style={S.qDot} />
        <span style={{ fontFamily: "var(--cb-mono)", fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase" }}>Inquiry</span>
      </div>
      <h2 style={S.headline}>{t.q}</h2>
      {/* Answer card */}
      <div style={S.answerCard} className="cb-answer-enter cb-glass-panel">
        {renderAnswer(shown, t.sources, P, accent, hoverCite, setHoverCite)}
        {done && t.source && (
          <div style={S.byline}>
            <span style={S.aiTag}>AI-synthesized · verify against cited sources</span>
          </div>
        )}
        {done && t.answer && t.answer.length > 40 && <AnswerPlayer text={t.answer} accent={accent} P={P} />}
      </div>
      {done && t.factCheck && <FactCheck fc={t.factCheck} P={P} accent={accent} />}
      {/* AI suggestions */}
      {done && t.suggestions && t.suggestions.length > 0 && (
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
              <a key={v.id || i} href={v.url} target="_blank" rel="noreferrer" className="cb-fade cb-card" style={{ display: "block", background: P.surface, border: `1px solid ${P.line}`, borderRadius: 10, overflow: "hidden", textDecoration: "none", color: P.ink, opacity: 0 }}
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
      {done && t.related && t.related.length > 0 && (
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


/* ============================================================
   HOW IT WORKS MODAL + SETTINGS — same logic, new visual system
   ============================================================ */
function HowItWorksModal({ P, accent, close }) {
  useEffect(() => { const onKey = (e) => { if (e.key === "Escape") close(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [close]);
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
    <div onClick={close} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} className="cb-backdrop">
      <div onClick={(e) => e.stopPropagation()} style={{ background: P.bg, borderRadius: 16, maxWidth: 600, width: "100%", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)", border: `1px solid ${P.line}` }} className="cb-modal">
        <div style={{ position: "sticky", top: 0, background: P.bg, padding: "20px 24px 16px", borderBottom: `1px solid ${P.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em", color: P.ink, fontFamily: "var(--cb-display)" }}>How Cerebrum works</div>
            <div style={{ fontSize: 12, color: P.faint, marginTop: 2, fontFamily: "var(--cb-mono)" }}>A short, honest technical explanation.</div>
          </div>
          <button onClick={close} style={{ background: "none", border: "none", fontSize: 20, color: P.faint, cursor: "pointer", lineHeight: 1, padding: 4 }}>×</button>
        </div>
        <div style={{ padding: "24px 24px 32px" }}>
          <Section title="The retrieval layer">Every query fans out to 10-plus scholarly databases in parallel, all free and keyless.
            <List items={[<><strong>Europe PMC</strong> — biomedical, includes preprints</>,<><strong>PubMed</strong> (NCBI E-utilities) — biomedical, automatic term mapping</>,<><strong>OpenAlex</strong> — cross-disciplinary, concept graph</>,<><strong>Crossref</strong> — DOI-registered works, checked for retraction status</>,<><strong>arXiv</strong> — physics, math, CS, quantitative biology</>,<><strong>Semantic Scholar</strong> — includes auto-generated TL;DR summaries</>,<><strong>bioRxiv</strong> preprints (via OpenAlex)</>,<><strong>DOAJ, PLOS, Zenodo, DataCite</strong> — additional coverage</>]} />
          </Section>
          <Section title="Query intelligence"><List items={[<><strong>Species queries</strong> are wrapped in quoted phrases with strict species-level filtering.</>,<><strong>Author queries</strong> hit OpenAlex's author disambiguation endpoint.</>,<><strong>Acronym expansion</strong> for common scientific abbreviations.</>,<><strong>Fallback ladder</strong>: if a strict query returns nothing, we retry looser, then plain.</>]} /></Section>
          <Section title="Trust and safety"><List items={[<><strong>Retraction flagging</strong> via Crossref's crossmark data.</>,<><strong>No fabricated citations</strong> — the AI is instructed to never invent DOIs, authors, or journal names.</>,<><strong>Honest hedging</strong> — when literature is thin, the model says so.</>]} /></Section>
          <Section title="The AI layer">Answers are synthesized by free-tier language models, tried in order: OpenRouter free models (Gemini 2.0 Flash, Llama 3.3 70B, Qwen 2.5 72B, Mistral Small, DeepSeek Chat, Llama 3.1 8B), then Cloudflare Workers AI, then Pollinations as a keyless last resort.</Section>
          <Section title="Known limitations"><List items={["New preprints may not be indexed anywhere for hours or days.","The AI can misinterpret papers — verify claims.","Free AI models rate-limit under load.","Non-English literature is under-indexed."]} /></Section>
          <Section title="What Cerebrum is not"><List items={["Not a replacement for reading the actual papers","Not a systematic review tool","Not medical, legal, or financial advice","Not paywalled or ad-supported"]} /></Section>
          <div style={{ fontSize: 11, color: P.faint, marginTop: 24, paddingTop: 16, borderTop: `1px solid ${P.line}`, fontFamily: "var(--cb-mono)" }}>Cerebrum™ · Built by Vaticay</div>
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
function Settings({ P, accent, at, S, PALETTES, ACCENTS, paletteName, setPaletteName, accentName, setAccentName, customAccent, setCustomAccent, answerLength, setAnswerLength, factCheck, setFactCheck, muted, setMuted, typewriter, setTypewriter, soundMode, setSoundMode, animationMode, setAnimationMode, animPreset, setAnimPreset, animDensity, setAnimDensity, animSpeed, setAnimSpeed, animOpacity, setAnimOpacity, sfx, setSessions, setSaved, saved, highContrast, setHighContrast, fontSize, setFontSize, reducedTransparency, setReducedTransparency, autoplay, setAutoplay, dyslexicFont, setDyslexicFont, lineSpacing, setLineSpacing, focusHighlight, setFocusHighlight, close }) {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState("general");
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => { setCookie("cb_cite", citationStyle); }, [citationStyle]);

  const TABS = [
    ["general", "General"],
    ["appearance", "Appearance"],
    ["accessibility", "Accessibility"],
    ["audio", "Audio"],
    ["data", "Data & Privacy"],
  ];

  /* ── iOS building blocks ── */
  const bg = P.dark ? withAlpha(P.raised, 0.9) : "#fff";
  const divider = P.dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
  const sectionBg = P.dark ? P.surface : "#f2f2f7";

  const Section = ({ title, footer, children }) => (
    <div style={{ marginBottom: 24 }}>
      {title && <div style={{ fontSize: 13, fontWeight: 400, color: P.faint, marginBottom: 6, paddingLeft: 16, textTransform: "uppercase", fontFamily: "var(--cb-body)", letterSpacing: "0.02em" }}>{title}</div>}
      <div style={{ background: bg, borderRadius: 12, overflow: "hidden" }}>{children}</div>
      {footer && <div style={{ fontSize: 12, color: P.faint, marginTop: 6, paddingLeft: 16, lineHeight: 1.4 }}>{footer}</div>}
    </div>
  );

  const Row = ({ icon, label, desc, control, onClick, last, destructive }) => (
    <div onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", cursor: onClick ? "pointer" : "default", borderBottom: last ? "none" : `0.5px solid ${divider}` }}>
      {icon && <span style={{ fontSize: 18, width: 28, height: 28, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{icon}</span>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 16, color: destructive ? "#ff3b30" : P.ink, fontWeight: 400 }}>{label}</div>
        {desc && <div style={{ fontSize: 13, color: P.faint, lineHeight: 1.35, marginTop: 1 }}>{desc}</div>}
      </div>
      {control && <div style={{ flexShrink: 0 }}>{control}</div>}
      {onClick && !control && <span style={{ color: P.faint, fontSize: 16 }}>›</span>}
    </div>
  );

  const Switch = ({ on, onChange, label }) => (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => { sfx(); onChange(!on); }}
      style={{ width: 51, height: 31, borderRadius: 16, position: "relative", background: on ? "#34c759" : P.dark ? "rgba(120,120,128,0.32)" : "rgba(120,120,128,0.16)", border: "none", cursor: "pointer", padding: 0, transition: "background 250ms ease" }}>
      <span style={{ position: "absolute", top: 2, left: 2, width: 27, height: 27, borderRadius: "50%", background: "#fff", transform: on ? "translateX(20px)" : "translateX(0)", transition: "transform 250ms cubic-bezier(0.4, 0, 0.2, 1)", boxShadow: "0 3px 8px rgba(0,0,0,0.15), 0 1px 2px rgba(0,0,0,0.1)" }} />
    </button>
  );

  const Picker = ({ value, options, onChange }) => (
    <select value={value} onChange={(e) => { sfx(); onChange(e.target.value); }}
      style={{ padding: "6px 28px 6px 10px", fontSize: 15, color: accent, background: "transparent", border: "none", cursor: "pointer", fontFamily: "var(--cb-body)", fontWeight: 500, WebkitAppearance: "none", appearance: "none", backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%239ca3af'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 8px center", outline: "none" }}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: P.dark ? "rgba(0,0,0,0.65)" : "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 40, padding: 16 }} onClick={close} className="cb-backdrop">
      <div onClick={(e) => e.stopPropagation()} className="cb-modal" style={{ background: sectionBg, borderRadius: isMobile ? 14 : 16, width: 500, maxWidth: "100%", maxHeight: isMobile ? "92dvh" : "85vh", display: "flex", flexDirection: "column", fontFamily: "var(--cb-body)", boxShadow: "0 24px 80px rgba(0,0,0,0.5)", overflow: "hidden" }}>

        {/* Header */}
        <div style={{ padding: "16px 20px 0", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: P.ink, letterSpacing: "-0.02em" }}>Settings</div>
            <button onClick={close} aria-label="Close" style={{ background: P.dark ? "rgba(120,120,128,0.24)" : "rgba(120,120,128,0.12)", border: "none", width: 30, height: 30, borderRadius: "50%", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: P.ink2, fontSize: 14, fontWeight: 600 }}>✕</button>
          </div>

          {/* Tab bar — iOS segmented control style */}
          <div style={{ display: "flex", background: P.dark ? "rgba(120,120,128,0.2)" : "rgba(120,120,128,0.1)", borderRadius: 9, padding: 2, marginBottom: 16, gap: 1 }}>
            {TABS.map(([id, label]) => (
              <button key={id} onClick={() => { sfx(); setTab(id); }}
                style={{ flex: 1, padding: "7px 4px", fontSize: isMobile ? 11 : 12, fontWeight: tab === id ? 600 : 500, background: tab === id ? (P.dark ? P.raised : "#fff") : "transparent", color: tab === id ? P.ink : P.faint, border: "none", borderRadius: 7, cursor: "pointer", fontFamily: "var(--cb-body)", whiteSpace: "nowrap", boxShadow: tab === id ? "0 1px 3px rgba(0,0,0,0.1)" : "none", transition: "all 200ms ease" }}>{label}</button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div key={tab} className="cb-fade" style={{ padding: "0 16px 16px", overflowY: "auto", flex: 1, WebkitOverflowScrolling: "touch" }}>

          {tab === "general" && (<>
            <Section title="Responses">
              <Row label="Answer length" control={
                <Picker value={answerLength} options={[["short", "Concise"], ["medium", "Standard"], ["long", "Detailed"]]} onChange={setAnswerLength} />
              } />
              <Row label="Animated typing" desc="Reveals answers progressively" control={<Switch on={typewriter} onChange={setTypewriter} label="Typing animation" />} />
              <Row label="Citation format" control={
                <Picker value={citationStyle} options={[["vancouver", "Vancouver"], ["apa", "APA"], ["mla", "MLA"], ["chicago", "Chicago"], ["bibtex", "BibTeX"]]} onChange={setCitationStyle} />
              } last />
            </Section>

            <Section title="Search" footer="Cerebrum queries 16 scholarly databases including PubMed, Europe PMC, OpenAlex, and Semantic Scholar.">
              <Row label="Auto-play search tone" desc="Ambient sound while searching" control={<Switch on={!muted} onChange={(v) => setMuted(!v)} label="Sound effects" />} />
              <Row label="Search sound" control={
                <Picker value={soundMode} options={[["pulse", "Pulse"], ["shimmer", "Shimmer"], ["warm", "Warm"], ["minimal", "Minimal"]]} onChange={(v) => { setSoundMode(v); Audio.preview(v); }} />
              } last />
            </Section>

            <Section title="Motion">
              <Row label="Background effects" desc="Ambient particle animation" control={<Switch on={animationMode !== "off"} onChange={(v) => setAnimationMode(v ? "cinematic" : "off")} label="Animations" />} />
              <Row label="Reduced motion" desc="Minimizes entrance animations" control={<Switch on={animationMode === "subtle"} onChange={(v) => setAnimationMode(v ? "subtle" : "cinematic")} label="Reduced motion" />} last />
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
                    <span style={{ fontSize: 12, color: PALETTES[pn].ink, fontWeight: paletteName === pn ? 600 : 400 }}>{pn}</span>
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
              <Row label="Dyslexia-friendly font" desc="Uses OpenDyslexic typeface for body text" control={<Switch on={dyslexicFont} onChange={(v) => { sfx(); setDyslexicFont(v); }} label="Dyslexic font" />} />
              <Row label="Auto-read answers" desc="Reads answers aloud using text-to-speech" control={<Switch on={autoplay} onChange={(v) => { sfx(); setAutoplay(v); }} label="Auto-read" />} />
              <Row label="Animated typing" desc="Disable to show answers instantly" control={<Switch on={typewriter} onChange={(v) => { sfx(); setTypewriter(v); }} label="Typing animation" />} last />
            </Section>

            <Section title="Motion">
              <Row label="Reduce motion" desc="Disables background animations and entrance effects" control={<Switch on={animationMode === "off"} onChange={(v) => { sfx(); setAnimationMode(v ? "off" : "cinematic"); }} label="Reduce motion" />} last />
            </Section>

            <Section title="Voice">
              <div style={{ padding: "12px 16px" }}>
                <TtsVoiceSetting P={P} accent={accent} at={at} S={S} sfx={sfx} />
                <div style={{ height: 8 }} />
                <ElevenLabsSetting P={P} accent={accent} at={at} S={S} sfx={sfx} />
              </div>
            </Section>
          </>)}

          {tab === "audio" && (<>
            <Section title="Interface sounds">
              <Row label="Sound effects" desc="Subtle tones on click and hover" control={<Switch on={!muted} onChange={(v) => setMuted(!v)} label="Sound effects" />} />
              <Row label="Search ambience" desc="Background tone while searching" control={
                <Picker value={soundMode} options={[["pulse", "Pulse"], ["shimmer", "Shimmer"], ["warm", "Warm"], ["minimal", "Minimal"]]} onChange={(v) => { setSoundMode(v); Audio.preview(v); }} />
              } last />
            </Section>

            <Section title="Text to speech" footer="Default voice uses Cerebrum's free servers. Add an ElevenLabs key for premium narration.">
              <TtsVoiceSetting P={P} accent={accent} at={at} S={S} sfx={sfx} />
              <ElevenLabsSetting P={P} accent={accent} at={at} S={S} sfx={sfx} />
            </Section>
          </>)}

          {tab === "data" && (<>
            <Section title="Storage" footer="All data is stored locally in your browser. Cerebrum never sends your data to external servers.">
              <Row label="Saved articles" desc={`${saved.length} article${saved.length === 1 ? "" : "s"} saved`} />
              <Row label="Clear all data" destructive control={
                confirmClear
                  ? <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => { setSessions([]); setSaved([]); setConfirmClear(false); sfx(); }} style={{ padding: "6px 14px", fontSize: 13, fontWeight: 600, background: "#ff3b30", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}>Delete</button>
                      <button onClick={() => setConfirmClear(false)} style={{ padding: "6px 14px", fontSize: 13, color: P.ink2, background: "transparent", border: `1px solid ${P.line}`, borderRadius: 8, cursor: "pointer" }}>Cancel</button>
                    </div>
                  : <button onClick={() => setConfirmClear(true)} style={{ padding: "6px 14px", fontSize: 13, color: "#ff3b30", background: "transparent", border: "none", cursor: "pointer", fontWeight: 500 }}>Clear...</button>
              } last />
            </Section>

            <Section title="Keyboard shortcuts">
              <div style={{ padding: "4px 0" }}>
                {[[kbdLabel("K"), "Search"], [kbdLabel("J"), "New investigation"], [kbdLabel("B"), "Saved articles"], [kbdLabel("/"), "Settings"], ["Esc", "Close panel"]].map(([key, desc], i, arr) => (
                  <div key={desc} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: i < arr.length - 1 ? `0.5px solid ${divider}` : "none" }}>
                    <span style={{ fontSize: 15, color: P.ink }}>{desc}</span>
                    <kbd style={{ fontSize: 12, fontFamily: "var(--cb-mono)", color: P.faint, background: P.dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)", padding: "3px 8px", borderRadius: 6, fontWeight: 500 }}>{key}</kbd>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="About">
              <Row label="Version" control={<span style={{ fontSize: 15, color: P.faint }}>4.0</span>} />
              <Row label="Built by" control={<span style={{ fontSize: 15, color: accent }}>Vaticay</span>} last />
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
    ? `1px solid ${withAlpha("#8b95a8", 0.08)}`
    : `1px solid ${P.line2}`;

  return {
    /* ── Page shell ── */
    page: { minHeight: "100dvh", height: "100dvh", background: P.bg, color: P.ink, fontFamily: font, WebkitFontSmoothing: "antialiased", display: "flex", flexDirection: "column", position: "fixed", inset: 0, overflow: "hidden", touchAction: "pan-y", overscrollBehavior: "none" },
    grain: { position: "fixed", inset: 0, pointerEvents: "none", opacity: P.grain, zIndex: 100, backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")" },

    /* ── Header: dark glass bar, minimal ── */
    header: { 
      flexShrink: 0, 
      borderBottom: glassBorder, 
      background: P.dark ? withAlpha(P.bg, 0.75) : withAlpha(P.bg, 0.85), 
      backdropFilter: "blur(20px) saturate(1.3)", 
      WebkitBackdropFilter: "blur(20px) saturate(1.3)", 
      position: "sticky", top: 0, zIndex: 20 
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
    scroll: { flex: 1, overflowY: "auto", overflowX: "hidden", paddingBottom: isMobile ? 88 : 0, WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" },
    container: { maxWidth: 1120, margin: "0 auto", padding: `0 ${pad}px`, minHeight: "100%", display: "flex", flexDirection: "column" },

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
      fontSize: isMobile ? 48 : 80, fontWeight: 700, 
      letterSpacing: "-0.05em", lineHeight: 0.95, 
      color: P.ink, marginBottom: 20, position: "relative", 
      fontFamily: "var(--cb-body)",
    },
    heroSub: { 
      fontSize: isMobile ? 16 : 18, color: P.ink2, 
      maxWidth: 520, lineHeight: 1.6, marginBottom: 48, 
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

    /* ── Workspace: single-column editorial flow ── */
    workspace: { display: "flex", flexDirection: "column", gap: 0, padding: isMobile ? "24px 0" : "40px 0", flex: 1, maxWidth: 760, margin: "0 auto", width: "100%" },
    workspaceMobile: { maxWidth: "100%" },
    thread: { minWidth: 0 },

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
      background: P.dark ? "rgba(5,8,22,0.75)" : "rgba(255,255,255,0.85)", 
      backdropFilter: "blur(12px) saturate(1.1)",
      WebkitBackdropFilter: "blur(12px) saturate(1.1)",
      border: P.dark ? "1px solid rgba(255,255,255,0.08)" : `1px solid ${P.line}`,
      borderRadius: 16, 
      padding: isMobile ? "24px 20px" : "32px 36px", 
      boxShadow: P.dark 
        ? "0 0 0 0.5px rgba(255,255,255,0.04) inset, 0 8px 32px rgba(0,0,0,0.4), 0 2px 8px rgba(0,0,0,0.3)"
        : P.shadow,
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
    error: { padding: "16px 20px", background: withAlpha("#e5484d", 0.08), color: "#e5484d", borderRadius: 12, fontSize: 14, border: `1px solid ${withAlpha("#e5484d", 0.2)}` },
    followShell: { display: "flex", alignItems: "center", gap: 8, background: glass, border: glassBorder, borderRadius: 14, padding: "10px 10px 10px 20px", boxShadow: P.shadow, transition: "border-color 0.3s ease, box-shadow 0.3s ease", marginTop: 16 },
    relatedWrap: { marginTop: 28, paddingTop: 24, borderTop: `1px solid ${P.line}` },
    relatedLabel: { fontSize: 10, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: P.faint, marginBottom: 14, fontFamily: "var(--cb-mono)" },
    relatedList: { display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 8 },
    relatedBtn: { 
      display: "flex", alignItems: "center", justifyContent: "space-between", 
      gap: 12, textAlign: "left", padding: "12px 16px", 
      fontSize: 13.5, background: P.dark ? withAlpha(P.surface, 0.5) : P.surface, color: P.ink2, 
      border: glassBorder, borderRadius: 10, 
      cursor: "pointer", fontFamily: font, 
      transition: "all 0.25s ease", letterSpacing: "-0.01em" 
    },

    /* ── Sources panel: dark glass sidebar ── */
    panel: { 
      position: "sticky", top: 24, 
      background: glass, 
      backdropFilter: "blur(20px) saturate(1.15)", 
      WebkitBackdropFilter: "blur(20px) saturate(1.15)", 
      border: glassBorder, borderRadius: 16, 
      padding: "20px", boxShadow: P.shadow, 
      maxHeight: "calc(100dvh - 110px)", overflowY: "auto" 
    },
    panelMobile: { position: "fixed", top: 0, right: 0, height: "100dvh", width: isMobile ? "88vw" : "380px", maxWidth: 400, borderRadius: 0, maxHeight: "none", zIndex: 30, boxShadow: "-8px 0 40px rgba(0,0,0,0.5)" },
    srcHead: { display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, fontWeight: 600, color: P.ink, marginBottom: 16, letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: "var(--cb-mono)" },
    srcCount: { fontSize: 10, fontWeight: 700, color: accent, background: withAlpha(accent, 0.1), padding: "3px 8px", borderRadius: 20, fontFamily: "var(--cb-mono)" },
    srcActions: { display: "flex", gap: 6, marginBottom: 12 },
    srcFilterInput: { width: "100%", padding: "9px 12px", fontSize: 12, border: glassBorder, background: P.dark ? withAlpha(P.bg, 0.5) : P.bg, color: P.ink, borderRadius: 8, outline: "none", fontFamily: "var(--cb-mono)", marginBottom: 10 },
    sortTabs: { display: "flex", gap: 2, background: P.dark ? withAlpha(P.bg, 0.4) : P.bg, padding: 3, borderRadius: 10, marginBottom: 14, border: `1px solid ${P.line}` },
    sortTab: { flex: 1, padding: "6px", fontSize: 11, background: "transparent", color: P.ink2, border: "none", borderRadius: 7, cursor: "pointer", fontFamily: "var(--cb-mono)", fontWeight: 550, transition: "all 0.2s ease" },
    sortTabActive: { background: P.dark ? P.raised : P.surface, color: P.ink, boxShadow: P.shadowSm, fontWeight: 600 },
    srcGroupLabel: { fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: accent, margin: "16px 0 8px", paddingBottom: 6, borderBottom: `1px solid ${P.line}`, fontFamily: "var(--cb-mono)" },
    sBtn: { flex: 1, fontSize: 11.5, padding: "8px", background: P.dark ? withAlpha(P.bg, 0.5) : P.bg, color: P.ink2, border: glassBorder, borderRadius: 8, cursor: "pointer", fontFamily: "var(--cb-mono)", fontWeight: 550 },
    sBtnP: { flex: 1, fontSize: 11.5, padding: "8px", background: accent, color: at, border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontFamily: "var(--cb-mono)" },
    savedNote: { fontSize: 11, color: accent, marginBottom: 12, fontFamily: "var(--cb-mono)" },
    zBox: { background: P.dark ? withAlpha(P.bg, 0.5) : P.bg, border: glassBorder, borderRadius: 10, padding: 12, marginBottom: 12, display: "flex", flexDirection: "column", gap: 8 },
    zIn: { padding: "9px 12px", fontSize: 12, border: glassBorder, background: P.dark ? withAlpha(P.surface, 0.4) : P.surface, color: P.ink, borderRadius: 8, outline: "none", fontFamily: "var(--cb-mono)" },
    zMsg: { fontSize: 11, color: accent, fontFamily: "var(--cb-mono)" },
    srcList: { display: "flex", flexDirection: "column", gap: 2 },
    empty: { fontSize: 13, color: P.faint, lineHeight: 1.5, padding: "12px 0" },
    srcItem: { padding: "14px 12px", margin: "0 -12px", borderRadius: 10, transition: "background 0.25s ease", borderBottom: `1px solid ${P.line}` },
    srcTitle: { fontSize: 13.5, textDecoration: "none", lineHeight: 1.4, fontWeight: 550, display: "block", marginBottom: 4, transition: "color 0.2s ease", letterSpacing: "-0.01em" },
    srcMeta: { fontSize: 11, color: P.ink2, lineHeight: 1.45, fontFamily: "var(--cb-mono)" },
    srcRow: { display: "flex", gap: 6, marginTop: 10 },
    chipMini: { fontSize: 10.5, padding: "4px 10px", border: "1px solid", borderRadius: 6, cursor: "pointer", fontFamily: "var(--cb-mono)", fontWeight: 550, background: "transparent", transition: "all 0.2s ease" },

    /* ── Footer ── */
    foot: { marginTop: "auto", padding: "20px 0 28px", textAlign: "center" },
    footDbs: { fontSize: 10, letterSpacing: "0.06em", color: P.faint, lineHeight: 1.7, fontFamily: "var(--cb-mono)", textTransform: "uppercase" },

    /* ── Mobile sources FAB ── */
    mobSrcBtn: { position: "fixed", bottom: "calc(18px + env(safe-area-inset-bottom, 0px))", right: 18, background: accent, color: at, border: "none", borderRadius: 12, padding: "12px 18px", fontSize: 12, fontWeight: 600, cursor: "pointer", boxShadow: `0 4px 20px ${withAlpha(accent, 0.35)}`, zIndex: 20, fontFamily: "var(--cb-mono)", display: "inline-flex", alignItems: "center", gap: 8 },
    scrim: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 25 },

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
    soundBtn: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", fontSize: 12.5, background: P.dark ? withAlpha(P.bg, 0.5) : P.bg, color: P.ink2, border: glassBorder, borderRadius: 10, cursor: "pointer", fontFamily: "var(--cb-mono)", fontWeight: 550 },
    soundBtnActive: { color: P.ink, borderColor: withAlpha(accent, 0.4), background: withAlpha(accent, 0.06) },
  };
}

function App() {
  const isMobile = useIsMobile();
  const [entered, setEntered] = useState(() => { try { return getCookie("cb_entered_v4") === "1"; } catch { return false; } });
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState([]);
  const [pinnedSources, setPinnedSources] = useState([]);
  const [corrections, setCorrections] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [allSources, setAllSources] = useState([]);
  const [saved, setSaved] = useState(() => { try { return JSON.parse(localStorage.getItem("cb_saved") || "[]"); } catch { return []; } });
  const [savedOpen, setSavedOpen] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [panelOpen, setPanelOpen] = useState(true);
  const [mobilePanel, setMobilePanel] = useState(false);
  const [suggestions, setSuggestions] = useState(pick());
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const S = makeStyles(P, accent, at, isMobile);
  const sfx = () => { if (!mutedRef.current) Audio.click(); };
  const easterEgg = BrainEasterEgg({ accent, P, S });

  const ask = useCallback(async (q, opts = {}) => {
    const question = (q ?? input).trim();
    if (!question || busy) return;
    if (!mutedRef.current) Audio.click();
    setInput(""); setBusy(true); setError(""); setCmdOpen(false); if (isMobile) setMobilePanel(false);
    const prior = [];
    turns.slice(-10).forEach((t) => { prior.push({ role: "user", content: t.q }); prior.push({ role: "assistant", content: t.answer, sources: t.sources || [] }); });
    try {
      const priorUserTurn = [...turns].reverse().find((t) => t && t.q);
      const videoQuery = (priorUserTurn && priorUserTurn.q && looksLikeFollowupText(question)) ? priorUserTurn.q + " " + question : question;
      const videosPromise = fetch("/api/videos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: videoQuery }) }).then((r) => r.ok ? r.json() : { videos: [] }).catch(() => ({ videos: [] }));
      const res = await fetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: question, history: prior, settings: { answerLength, factCheck }, pinnedSources, corrections }) });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Something went sideways. Try that again?"); setBusy(false); return; }
      const turnId = Date.now() + Math.random();
      const nt = { id: turnId, q: question, answer: data.answer || "", sources: data.sources || [], videos: data.videos || [], source: data.source || "", factCheck: data.factCheck || null, related: data.related || [], suggestions: data.suggestions || [], fresh: typewriter };
      const looksLikeCorrection = /^(actually|no,?\s+it['']?s|no,?\s+they['']?re|correction[:,]|wrong\b|that['']?s\s+(wrong|incorrect|not right))/i.test(question) || /you\s+(said|got|had|were)\s+.+\s+(wrong|actually|but|however)/i.test(question) || /\bnot\s+\w+,?\s+(it['']?s|they['']?re|but)\s+/i.test(question);
      if (looksLikeCorrection) { setCorrections((prev) => [...prev, question].slice(-20)); }
      setTurns((t) => [...t, nt]);
      setAllSources((prev) => { const seen = new Set(prev.map((s) => (s.title || "").toLowerCase())); return [...prev, ...(data.sources || []).filter((s) => !seen.has((s.title || "").toLowerCase()))]; });
      if (turns.length === 0) setSessions((s) => [{ q: question, ts: Date.now() }, ...s].slice(0, 40));
      if (!mutedRef.current) Audio.pop();
      videosPromise.then(({ videos }) => { if (videos && videos.length) { setTurns((prev) => prev.map((t) => t.id === turnId ? { ...t, videos } : t)); } });
    } catch (e) { setError(`Couldn't reach the backend. Give it a second and try again. (${e.message})`); }
    finally { setBusy(false); }
  }, [input, busy, turns, answerLength, factCheck, typewriter, isMobile]);

  useEffect(() => { if (entered && !isMobile && !cmdOpen) inputRef.current?.focus(); }, [entered, isMobile, cmdOpen]);
  useEffect(() => { if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight; if (window.AOS) window.AOS.refresh(); }, [turns, busy]);
  useEffect(() => { if (busy && !muted) Audio.startAmbient(soundMode); else Audio.stopAmbient(); return () => Audio.stopAmbient(); }, [busy, muted, soundMode]);
  useEffect(() => { document.body.style.background = P.bg; }, [P]);
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
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setCmdOpen((v) => !v); setTimeout(() => cmdRef.current?.focus(), 40); }
      else if (e.key === "Escape") { setCmdOpen(false); setSettingsOpen(false); setMobilePanel(false); setSavedOpen(false); }
      else if ((e.metaKey || e.ctrlKey) && e.key === "/") { e.preventDefault(); setSettingsOpen((v) => !v); }
      else if ((e.metaKey || e.ctrlKey) && e.key === "j") { e.preventDefault(); newSession(); }
      else if ((e.metaKey || e.ctrlKey) && e.key === "b") { e.preventDefault(); setSavedOpen((v) => !v); }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);

  function newSession() { if (!mutedRef.current) Audio.click(); setTurns([]); setAllSources([]); setPinnedSources([]); setCorrections([]); setInput(""); setError(""); setSuggestions(pick()); setCmdOpen(false); setTimeout(() => inputRef.current?.focus(), 50); }
  function toggleSave(s) { sfx(); setSaved((prev) => { const k = (s.title || "").toLowerCase(); return prev.some((x) => (x.title || "").toLowerCase() === k) ? prev.filter((x) => (x.title || "").toLowerCase() !== k) : [...prev, s]; }); }
  function isPinned(s) { const k = (s.title || "").toLowerCase(); return pinnedSources.some((x) => (x.title || "").toLowerCase() === k); }
  function togglePin(s) { sfx(); setPinnedSources((prev) => { const k = (s.title || "").toLowerCase(); return prev.some((x) => (x.title || "").toLowerCase() === k) ? prev.filter((x) => (x.title || "").toLowerCase() !== k) : [...prev, s]; }); }
  const isSaved = (s) => saved.some((x) => (x.title || "").toLowerCase() === (s.title || "").toLowerCase());
  async function doZotero() { setZMsg(""); const list = saved.length ? saved : allSources; if (!zKey || !zUser) { setZMsg("Enter your Zotero API key and user ID."); return; } try { await saveToZotero(list, zKey.trim(), zUser.trim()); setZMsg(`Saved ${list.length} items.`); } catch (e) { setZMsg(`Failed: ${e.message}`); } }

  const commands = [
    { label: "New investigation", hint: kbdLabel("J"), run: () => newSession() },
    { label: "Open saved articles", hint: kbdLabel("B"), run: () => { setCmdOpen(false); setSavedOpen(true); } },
    { label: "Open settings", hint: kbdLabel("/"), run: () => { setCmdOpen(false); setSettingsOpen(true); } },
    { label: muted ? "Unmute sound" : "Mute sound", run: () => { setMuted(!muted); setCmdOpen(false); } },
    { label: "Toggle light / dark", run: () => { setPaletteName(P.dark ? "Light" : "Dark"); setCmdOpen(false); } },
    { label: factCheck ? "Turn off fact-check" : "Turn on fact-check", run: () => { setFactCheck(!factCheck); setCmdOpen(false); } },
    { label: "Export saved as BibTeX", run: () => { download("cerebrum.bib", toBibTeX(saved.length ? saved : allSources)); setCmdOpen(false); } },
  ];
  const filteredCmds = commands.filter((c) => c.label.toLowerCase().includes(cmdQuery.toLowerCase()));
  const cmdSuggest = SUGGESTION_POOL.filter((s) => cmdQuery && s.toLowerCase().includes(cmdQuery.toLowerCase())).slice(0, 4);

  if (!entered) {
    return <Intro accent={accent} P={P} onEnter={() => { sfx(); try { setCookie("cb_entered_v4", "1", 365); } catch {} setEntered(true); }} animationMode={animationMode} />;
  }

  const started = turns.length > 0 || busy;
  const exportList = saved.length ? saved : allSources;
  const filteredSources = allSources.filter((s) => { if (!srcFilter.trim()) return true; const f = srcFilter.toLowerCase(); return (s.title || "").toLowerCase().includes(f) || (s.authors || "").toLowerCase().includes(f) || (s.journal || "").toLowerCase().includes(f); });
  const sortedSources = [...filteredSources].sort((a, b) => { if (srcSort === "date") return (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0); if (srcSort === "database") return (a.journal || "").localeCompare(b.journal || ""); return (b.relevance ?? 0) - (a.relevance ?? 0); });
  const grouped = (() => { if (srcSort === "database") { const g = {}; for (const s of sortedSources) { const k = s.type || "Other"; (g[k] = g[k] || []).push(s); } return Object.entries(g); } if (srcSort === "date") { const g = {}; for (const s of sortedSources) { const k = s.year || "Undated"; (g[k] = g[k] || []).push(s); } return Object.entries(g).sort((a, b) => (parseInt(b[0], 10) || 0) - (parseInt(a[0], 10) || 0)); } return null; })();
  const relColor = (r) => r >= 65 ? "#10b981" : r >= 45 ? "#d9a520" : "#9ca3af";
  const relLabel = (r) => r >= 65 ? "strong" : r >= 45 ? "partial" : "weak";
  const typeColor = (t) => t === "Preprint" ? "#d97706" : t === "Reference" ? "#7c3aed" : t === "Dataset" ? "#0284c7" : accent;

  const SourceCard = (s, i) => (
    <div key={i} className="cb-fade" style={{ ...S.srcItem, background: hover === "src" + i ? withAlpha(accent, 0.05) : hoverCite === i + 1 ? withAlpha(accent, 0.06) : "transparent", transform: hover === "src" + i ? "translate3d(0, -1px, 0)" : "translate3d(0, 0, 0)" }} onMouseEnter={() => setHover("src" + i)} onMouseLeave={() => setHover("")}>
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 5, flexWrap: "wrap" }}>
        {s.type && <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: typeColor(s.type), background: withAlpha(typeColor(s.type), 0.1), padding: "2px 6px", borderRadius: 4, fontFamily: "var(--cb-mono)" }}>{s.type}</span>}
        {typeof s.relevance === "number" && <span title={`Relevance: ${relLabel(s.relevance)} match`} style={{ fontSize: 9, fontWeight: 600, color: relColor(s.relevance), background: withAlpha(relColor(s.relevance), 0.1), padding: "2px 6px", borderRadius: 4, fontFamily: "var(--cb-mono)" }}>{s.relevance}%</span>}
        {s.year && <span style={{ fontSize: 10, color: P.faint, fontFamily: "var(--cb-mono)" }}>{s.year}</span>}
      </div>
      <a href={s.url} target="_blank" rel="noreferrer" style={{ ...S.srcTitle, color: hover === "src" + i ? accent : P.ink }}>{s.title || s.url}</a>
      <div style={S.srcMeta}>{[s.authors, s.journal].filter(Boolean).join(" · ")}{typeof s.citations === "number" && ` · ${s.citations.toLocaleString()} cit.`}</div>
      <div style={S.srcRow}>
        <button style={{ ...S.chipMini, color: isSaved(s) ? at : P.ink2, background: isSaved(s) ? accent : "transparent", borderColor: isSaved(s) ? accent : P.line2 }} onClick={() => toggleSave(s)}>{isSaved(s) ? "★ Saved" : "☆ Save"}</button>
        <button style={{ ...S.chipMini, color: isPinned(s) ? at : P.ink2, background: isPinned(s) ? accent : "transparent", borderColor: isPinned(s) ? accent : P.line2 }} onClick={() => togglePin(s)} title={isPinned(s) ? "Pinned to conversation" : "Pin for follow-ups"}>{isPinned(s) ? "📌 Pinned" : "📌 Pin"}</button>
        {s.authors && <button style={{ ...S.chipMini, color: accent, borderColor: P.line2 }} onClick={() => { setMobilePanel(false); ask(`papers by ${(s.authors || "").replace(" et al.", "")}`); }}>Author →</button>}
      </div>
    </div>
  );

  const SourcesInner = (
    <>
      <div style={S.srcHead}><span>Sources</span><span style={S.srcCount}>{allSources.length}</span></div>
      {pinnedSources.length > 0 && (<div style={{ padding: "7px 10px", margin: "0 0 8px", background: withAlpha(accent, 0.06), border: `1px solid ${withAlpha(accent, 0.25)}`, borderRadius: 7, fontSize: 11, color: accent, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontFamily: "var(--cb-mono)" }}><span>📌 {pinnedSources.length} pinned</span><button onClick={() => setPinnedSources([])} style={{ background: "transparent", border: "none", color: accent, cursor: "pointer", fontSize: 10.5, textDecoration: "underline" }}>Clear</button></div>)}
      {corrections.length > 0 && (<div style={{ padding: "7px 10px", margin: "0 0 8px", background: withAlpha("#f59e0b", 0.06), border: `1px solid ${withAlpha("#f59e0b", 0.25)}`, borderRadius: 7, fontSize: 11, color: "#f59e0b", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontFamily: "var(--cb-mono)" }}><span>✎ {corrections.length} correction{corrections.length === 1 ? "" : "s"}</span><button onClick={() => setCorrections([])} style={{ background: "transparent", border: "none", color: "#f59e0b", cursor: "pointer", fontSize: 10.5, textDecoration: "underline" }}>Clear</button></div>)}
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
      {zoteroOpen && (<div style={S.zBox}><input style={S.zIn} placeholder="Zotero API key" value={zKey} onChange={(e) => setZKey(e.target.value)} /><input style={S.zIn} placeholder="Zotero user ID" value={zUser} onChange={(e) => setZUser(e.target.value)} /><button style={S.sBtnP} onClick={doZotero}>Save {exportList.length}</button>{zMsg && <div style={S.zMsg}>{zMsg}</div>}</div>)}
      <div style={S.srcList} className="cb-stagger">
        {allSources.length === 0 ? <div style={S.empty} className="cb-fade">Sources appear here as you research.</div> :
          sortedSources.length === 0 ? <div style={S.empty} className="cb-fade">No sources match "{srcFilter}".</div> :
          grouped ? grouped.map(([label, items]) => (<div key={label} className="cb-fade"><div style={S.srcGroupLabel}>{label} <span style={{ color: P.faint, fontWeight: 500 }}>· {items.length}</span></div>{items.map((s, i) => SourceCard(s, allSources.indexOf(s)))}</div>)) : sortedSources.map((s) => SourceCard(s, allSources.indexOf(s)))}
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
      <header style={S.header}>
        <div style={S.headInner}>
          <div style={{ ...S.brandRow, position: "relative" }}>
            <Magnetic strength={0.2}>
              <div onClick={(e) => { e.stopPropagation(); try { document.cookie = "cb_entered_v4=; path=/; max-age=0"; } catch {} window.location.reload(); }} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                <span key={easterEgg.wiggleKey} className={easterEgg.wiggleKey > 0 ? "cb-wiggle" : ""} style={{ display: "inline-flex" }}><Mark size={20} accent={accent} glow={P.dark} /></span>
                <span style={S.brand} className="cb-gradient-text">Cerebrum<sup style={{ fontSize: "0.55em", fontWeight: 400, marginLeft: 2, opacity: 0.5, letterSpacing: "0.02em", WebkitTextFillColor: "currentColor", background: "none" }}>™</sup></span>
              </div>
            </Magnetic>
            {easterEgg.render}
          </div>
          <div style={S.headActions}>
            {!isMobile && (<Magnetic strength={0.15}><button className="cb-hbtn" style={S.cmdHint} onClick={() => { setCmdOpen(true); setTimeout(() => cmdRef.current?.focus(), 40); }} aria-label="Open search palette"><Icon name="search" size={13} /><span>Search</span><kbd style={S.kbd}>{kbdLabel("K")}</kbd></button></Magnetic>)}
            <Magnetic strength={0.2}><button className="cb-hbtn" style={S.iconBtn} onClick={() => { sfx(); newSession(); }} title="New investigation" aria-label="New investigation"><Icon name="plus" size={16} />{!isMobile && <span style={S.iconBtnLabel}>New</span>}</button></Magnetic>
            <Magnetic strength={0.2}><button className="cb-hbtn" style={{ ...S.iconBtn, ...(saved.length > 0 ? { color: accent } : {}) }} onClick={() => { sfx(); setSavedOpen(true); }} title={`Saved articles${saved.length ? ` (${saved.length})` : ""}`} aria-label={`Saved articles${saved.length ? `, ${saved.length}` : ""}`}><Icon name={saved.length > 0 ? "bookmarkFilled" : "bookmark"} size={16} />{!isMobile && <span style={S.iconBtnLabel}>Saved</span>}{saved.length > 0 && <span style={S.countPill}>{saved.length}</span>}</button></Magnetic>
            <button className="cb-hbtn" style={S.iconBtn} onClick={() => setMuted(!muted)} title={muted ? "Unmute" : "Mute"} aria-label={muted ? "Unmute" : "Mute"}><Icon name={muted ? "volumeOff" : "volumeOn"} size={16} /></button>
            <Magnetic strength={0.2}><button className="cb-hbtn" style={S.iconBtn} onClick={() => { sfx(); setSettingsOpen(true); }} title="Settings" aria-label="Settings"><Icon name="settings" size={16} />{!isMobile && <span style={S.iconBtnLabel}>Settings</span>}</button></Magnetic>
          </div>
        </div>
      </header>
      <div style={S.scroll} ref={threadRef}>
        <div style={S.container}>
          {!started ? (
            <div style={S.hero} className="cb-hero">
              <div style={S.heroGlow} />
              <div style={S.heroMark}><Mark size={44} accent={accent} glow={P.dark} /></div>
              <h1 style={S.heroTitle} className="cb-text-reveal"><KineticText text="Cerebrum" /></h1>
              <p style={S.heroSub}>Ask a question. We search the real literature and write you an answer with sources you can verify.</p>
              <div className="cb-search-glow" style={{ ...S.searchShell, ...(hover === "in" ? S.searchShellActive : {}), width: "100%", maxWidth: 700, borderRadius: 14 }} onMouseEnter={() => setHover("in")} onMouseLeave={() => setHover("")}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, marginLeft: 2 }}><circle cx="11" cy="11" r="7" stroke={P.faint} strokeWidth="1.6" /><path d="M21 21l-4-4" stroke={P.faint} strokeWidth="1.6" strokeLinecap="round" /></svg>
                  <input ref={inputRef} style={S.searchInput} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} placeholder="What are you curious about?" />
                  <MicButton onTranscript={(t) => setInput(t)} accent={accent} P={P} />
                  <Magnetic strength={0.15}><button style={S.searchBtn} onClick={() => ask()}>Search</button></Magnetic>
              </div>
              <div style={S.chips} className="cb-stagger">
                {suggestions.map((s, i) => (<button key={s} className="cb-fade cb-chip-hover" style={{ ...S.chip, ...(hover === "c" + i ? S.chipHover : {}) }} onMouseEnter={() => setHover("c" + i)} onMouseLeave={() => setHover("")} onClick={() => ask(s)}>{s}</button>))}
              </div>
              <div style={S.trustRow}>
                {["Europe PMC", "PubMed", "OpenAlex", "Crossref", "Semantic Scholar", "arXiv"].map((d) => <span key={d} style={S.trustItem}>{d}</span>)}
                <span style={{ ...S.trustItem, color: P.faint }}>+ 10 more</span>
              </div>
            </div>
          ) : (
            <div style={{ ...S.workspace, ...(isMobile ? S.workspaceMobile : {}) }} className="cb-page-enter">
              <div style={S.thread}>
                {turns.map((t, ti) => (<Turn key={ti} t={t} P={P} accent={accent} at={at} S={S} typewriter={typewriter && ti === turns.length - 1} last={ti === turns.length - 1} hoverCite={hoverCite} setHoverCite={setHoverCite} onRelated={(q) => ask(q)} citationStyle={citationStyle} setCitationStyle={setCitationStyle} />))}
                {busy && (<div style={S.turn}><div style={S.qLabel}><span style={S.qDot} /><span style={{ fontFamily: "var(--cb-mono)", fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase" }}>Searching</span></div><Skeleton P={P} /><LoadingLine P={P} accent={accent} S={S} /></div>)}
                {error && <div style={S.error}>{error}</div>}
                {turns.length > 0 && !busy && (
                  <div style={{ ...S.followShell, ...(hover === "f" ? S.searchShellActive : {}) }} onMouseEnter={() => setHover("f")} onMouseLeave={() => setHover("")}>
                    <input style={S.searchInput} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} placeholder="Follow up — I remember the whole thread" />
                    <MicButton onTranscript={(t) => setInput(t)} accent={accent} P={P} />
                    <button style={S.searchBtn} onClick={() => ask()}>Ask</button>
                  </div>
                )}
              </div>
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
              <span style={{ margin: "0 8px", opacity: 0.4 }}>·</span>© {new Date().getFullYear()} Cerebrum™ · v4.0
            </div>
          </div>
        </div>
      </div>
      {started && (<button style={{ ...S.mobSrcBtn, "--fab-glow": withAlpha(accent, 0.35) }} className="cb-fab-pulse" onClick={() => setMobilePanel(true)} aria-label={`Sources${allSources.length ? `, ${allSources.length}` : ""}`}><Icon name="sparkle" size={14} /><span>Sources</span>{allSources.length > 0 && <span style={{ fontSize: 11, fontWeight: 700, background: withAlpha(at, 0.22), padding: "2px 6px", borderRadius: 20, lineHeight: 1.3 }}>{allSources.length}</span>}</button>)}
      {started && mobilePanel && (<><div style={S.scrim} onClick={() => setMobilePanel(false)} className="cb-backdrop" /><aside style={{ ...S.panel, ...S.panelMobile }} className="cb-modal"><button style={{ ...S.ghostBtn, marginBottom: 14 }} onClick={() => setMobilePanel(false)}>✕ Close</button>{SourcesInner}</aside></>)}
      {cmdOpen && (<div style={S.cmdWrap} onClick={() => setCmdOpen(false)}><div style={S.cmdBox} onClick={(e) => e.stopPropagation()} className="cb-pop"><div style={S.cmdInputRow}><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke={P.faint} strokeWidth="1.8" /><path d="M21 21l-4-4" stroke={P.faint} strokeWidth="1.8" strokeLinecap="round" /></svg><input ref={cmdRef} style={S.cmdInput} value={cmdQuery} onChange={(e) => setCmdQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { if (cmdSuggest.length) ask(cmdSuggest[0]); else if (filteredCmds[0]) filteredCmds[0].run(); } }} placeholder="Search or type a command…" /><kbd style={S.kbd}>esc</kbd></div><div style={S.cmdList}>{cmdSuggest.length > 0 && <div style={S.cmdSection}>Ask</div>}{cmdSuggest.map((s) => (<button key={s} style={S.cmdItem} onClick={() => ask(s)} onMouseEnter={(e) => e.currentTarget.style.background = withAlpha(accent, 0.08)} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}><span style={{ color: accent }}>→</span>{s}</button>))}<div style={S.cmdSection}>Commands</div>{filteredCmds.map((c) => (<button key={c.label} style={S.cmdItem} onClick={c.run} onMouseEnter={(e) => e.currentTarget.style.background = withAlpha(accent, 0.08)} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}><span>{c.label}</span>{c.hint && <kbd style={{ ...S.kbd, marginLeft: "auto" }}>{c.hint}</kbd>}</button>))}</div></div></div>)}
      {savedOpen && (<div style={S.modalWrap} onClick={() => setSavedOpen(false)} className="cb-backdrop"><div style={{ ...S.modal, width: 520 }} onClick={(e) => e.stopPropagation()} className="cb-modal"><div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}><div style={S.modalTitle}>Saved articles</div><span style={S.srcCount}>{saved.length}</span></div>{saved.length === 0 ? (<div style={{ fontSize: 14, color: P.ink2, lineHeight: 1.6, padding: "20px 0 28px", textAlign: "center" }}>No saved articles yet.<br /><span style={{ fontSize: 12.5, color: P.faint }}>Tap ☆ Save on any source to keep it here.</span></div>) : (<><div style={{ display: "flex", gap: 8, marginBottom: 16 }}><button style={S.sBtn} onClick={() => { sfx(); download("cerebrum-saved.ris", toRIS(saved)); }}>Export RIS</button><button style={S.sBtn} onClick={() => { sfx(); download("cerebrum-saved.bib", toBibTeX(saved)); }}>Export BibTeX</button><button style={{ ...S.sBtn, color: "#e5484d", borderColor: withAlpha("#e5484d", 0.35) }} onClick={() => { if (confirm("Remove all saved articles?")) setSaved([]); }}>Clear all</button></div><div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: "56vh", overflowY: "auto" }}>{saved.map((s, i) => (<div key={i} style={{ padding: "12px 10px", margin: "0 -10px", borderBottom: `1px solid ${P.line}` }}><a href={s.url} target="_blank" rel="noreferrer" style={{ ...S.srcTitle, fontSize: 14 }}>{s.title || s.url}</a><div style={S.srcMeta}>{[s.authors, s.journal, s.year].filter(Boolean).join(" · ")}{typeof s.citations === "number" && ` · ${s.citations.toLocaleString()} cit.`}</div><div style={S.srcRow}><button style={{ ...S.chipMini, color: "#e5484d", borderColor: withAlpha("#e5484d", 0.35) }} onClick={() => setSaved((prev) => prev.filter((x) => (x.title || "").toLowerCase() !== (s.title || "").toLowerCase()))}>Remove</button>{s.authors && <button style={{ ...S.chipMini, color: accent, borderColor: P.line2 }} onClick={() => { setSavedOpen(false); ask(`papers by ${(s.authors || "").replace(" et al.", "")}`); }}>Author →</button>}</div></div>))}</div></>)}<button style={{ ...S.modalClose, marginTop: 20 }} onClick={() => setSavedOpen(false)}>Done</button></div></div>)}
      {settingsOpen && <Settings {...{ P, accent, at, S, PALETTES, ACCENTS, paletteName, setPaletteName, accentName, setAccentName, customAccent, setCustomAccent, answerLength, setAnswerLength, factCheck, setFactCheck, muted, setMuted, typewriter, setTypewriter, soundMode, setSoundMode, animationMode, setAnimationMode, animPreset, setAnimPreset, animDensity, setAnimDensity, animSpeed, setAnimSpeed, animOpacity, setAnimOpacity, sfx, setSessions, setSaved, saved, highContrast, setHighContrast, fontSize, setFontSize, reducedTransparency, setReducedTransparency, autoplay, setAutoplay, dyslexicFont, setDyslexicFont, lineSpacing, setLineSpacing, focusHighlight, setFocusHighlight, close: () => setSettingsOpen(false) }} />}
      {howItWorksOpen && <HowItWorksModal P={P} accent={accent} close={() => setHowItWorksOpen(false)} />}
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
@supports (padding: max(0px)) {
  body { padding-left: env(safe-area-inset-left); padding-right: env(safe-area-inset-right); padding-bottom: env(safe-area-inset-bottom); }
}
input, textarea, select { font-size: 16px; }
a { color: inherit; text-decoration: none; }
input::placeholder, textarea::placeholder { color: inherit; opacity: 0.35; }
summary::-webkit-details-marker { display: none; }
::selection { background: rgba(56, 189, 248, 0.2); }

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
@keyframes cb-wiggle {
  0%, 100% { transform: rotate(0deg); }
  30%      { transform: rotate(-4deg); }
  70%      { transform: rotate(3deg); }
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
.cb-wiggle  { animation: cb-wiggle 400ms var(--cb-ease); }
.cb-answer-enter.cb-glass-panel { animation: cbEnter 700ms var(--cb-ease) both; }

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
  background: linear-gradient(270deg, #34d399, #38bdf8, #818cf8, #a78bfa, #fb7185, #fbbf24, #34d399);
  background-size: 400% 400%;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  animation: cbGradientShift 8s ease infinite;
}

/* Range sliders */
input[type="range"] { -webkit-appearance: none; height: 3px; border-radius: 2px; }
input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%;
  background: currentColor; cursor: pointer; transition: transform 120ms ease;
}
input[type="range"]::-webkit-slider-thumb:hover { transform: scale(1.2); }
input[type="range"]::-webkit-slider-thumb:active { transform: scale(1.35); }

/* Info page styles */
.cb-info-block h2 { font-size: 22px; font-weight: 400; letter-spacing: -0.02em; margin: 0 0 14px; font-family: var(--cb-display); }
.cb-info-block p { font-size: 15.5px; line-height: 1.7; margin: 0; }
.cb-info-block ul { margin: 0; padding: 0; list-style: none; }
.cb-info-block li { font-size: 15px; line-height: 1.65; padding: 12px 0 12px 24px; position: relative; }
.cb-info-block li:before { content: ""; position: absolute; left: 6px; top: 20px; width: 4px; height: 4px; border-radius: 50%; }
.cb-info-navlink { transition: color .2s, background .2s; }
.cb-fadein { animation: cbEnter .7s var(--cb-ease) both; }

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

/* ── Reduced motion ── */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
`;

/* Font + animation library loading */
(function loadFonts() {
  if (typeof document === "undefined") return;
  // Fonts
  const id = "cb-fonts-v4";
  if (!document.getElementById(id)) {
    const link = document.createElement("link");
    link.id = id; link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&family=Inter:wght@400;450;500;550;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap";
    document.head.appendChild(link);
  }
  // OpenDyslexic for accessibility
  if (!document.getElementById("cb-dyslexic-font")) {
    const df = document.createElement("link");
    df.id = "cb-dyslexic-font"; df.rel = "stylesheet";
    df.href = "https://fonts.cdnfonts.com/css/opendyslexic";
    document.head.appendChild(df);
  }
  // AOS — scroll-triggered animations
  if (!document.getElementById("cb-aos-css")) {
    const aosCSS = document.createElement("link");
    aosCSS.id = "cb-aos-css"; aosCSS.rel = "stylesheet";
    aosCSS.href = "https://cdn.jsdelivr.net/npm/aos@2.3.4/dist/aos.css";
    document.head.appendChild(aosCSS);
  }
  loadCDN("https://cdn.jsdelivr.net/npm/aos@2.3.4/dist/aos.js").then(() => {
    if (window.AOS) window.AOS.init({ duration: 600, easing: "ease-out-cubic", once: true, offset: 60 });
  }).catch(() => {});
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
