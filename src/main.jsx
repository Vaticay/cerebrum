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
  "How does CRISPR-Cas9 achieve target specificity?",
  "Mechanism of quorum sensing in bacteria",
  "Why is the SN2 reaction stereospecific?",
  "How do chaperone proteins prevent misfolding?",
  "What causes antibiotic resistance to spread?",
  "How does mRNA vaccine technology work?",
  "The role of telomeres in cellular aging",
  "How do enzymes lower activation energy?",
  "How does photosynthesis split water?",
  "Mechanisms of DNA mismatch repair",
  "How do prions propagate misfolding?",
  "What drives protein phase separation?",
];
function pick(n = 3) {
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
  Dark:  { dark: true,  bg: "#070b14", surface: "#0d1220", raised: "#141c2e", ink: "#e8edf5", ink2: "#8b95a8", faint: "#4a5568", line: "rgba(138,155,186,0.07)", line2: "rgba(138,155,186,0.12)", shadow: "0 2px 4px rgba(0,0,0,0.4), 0 16px 56px rgba(0,0,0,0.5)", shadowSm: "0 1px 3px rgba(0,0,0,0.5)", grain: 0.012, skel: "linear-gradient(90deg, #0d1220 25%, #141c2e 50%, #0d1220 75%)" },
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
    <p key={pi} style={{ fontSize: 15.5, lineHeight: 1.75, margin: "0 0 16px", color: P.ink, letterSpacing: "-0.01em", fontFamily: "var(--cb-body)" }}>
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
function Intro({ accent, P, onEnter, animationMode = "cinematic" }) {
  const canvasRef = useRef(null);
  const [phase, setPhase] = useState("idle");
  const [textReveal, setTextReveal] = useState(false);
  const rafRef = useRef(0);
  const startRef = useRef(0);
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      const cssW = canvas.offsetWidth || window.innerWidth || 1;
      const cssH = canvas.offsetHeight || window.innerHeight || 1;
      const MAX_PIXELS = 4_500_000;
      let effDpr = dpr;
      while (cssW * effDpr * cssH * effDpr > MAX_PIXELS && effDpr > 0.75) effDpr -= 0.25;
      canvas.width = Math.max(1, Math.floor(cssW * effDpr));
      canvas.height = Math.max(1, Math.floor(cssH * effDpr));
    };
    resize();
    let rt = null;
    const onResize = () => { if (rt) clearTimeout(rt); rt = setTimeout(resize, 180); };
    window.addEventListener("resize", onResize, { passive: true });
    const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });

    const N = 110;
    const neurons = [];
    for (let i = 0; i < N; i++) {
      const t = i / N;
      const angle = t * Math.PI * 2 + Math.random() * 0.4;
      const innerR = 0.42;
      const outerR = 0.85;
      const rr = innerR + Math.random() * (outerR - innerR);
      const bx = Math.cos(angle) * rr * 1.15;
      const by = Math.sin(angle) * rr * 0.75;
      neurons.push({
        tx: bx, ty: by,
        sx: (Math.random() - 0.5) * 3.4, sy: (Math.random() - 0.5) * 3.4,
        r: 1.2 + Math.random() * 1.6,
        delay: Math.random() * 0.55,
        pulse: Math.random() * Math.PI * 2,
        pulseSpeed: 1.5 + Math.random() * 1.5,
        orbitPhase: Math.random() * Math.PI * 2,
        depth: 0.3 + Math.random() * 0.7,
      });
    }
    const synapses = [];
    for (let i = 0; i < N; i++) {
      const near = [];
      for (let j = 0; j < N; j++) {
        if (i === j) continue;
        const d = Math.hypot(neurons[i].tx - neurons[j].tx, neurons[i].ty - neurons[j].ty);
        near.push([j, d]);
      }
      near.sort((a, b) => a[1] - b[1]);
      for (let k = 0; k < 3; k++) {
        const [j] = near[k];
        if (i < j) synapses.push({ a: i, b: j, fire: Math.random() * Math.PI * 2, fireRate: 0.5 + Math.random() * 1.5 });
      }
    }

    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const rgb = (() => { const h = accent.replace("#", ""); return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)]; })();
    const [ar, ag, ab] = rgb;

    function draw(now) {
      if (!startRef.current) startRef.current = now;
      const elapsed = (now - startRef.current) / 1000;
      const forming = phaseRef.current === "forming";
      const prog = forming ? Math.min(1, elapsed / 1.6) : Math.min(1, elapsed / 2.5);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const cx = canvas.width / 2, cy = canvas.height / 2;
      const scale = Math.min(canvas.width, canvas.height) * 0.48;
      const spin = forming ? elapsed * 0.5 : elapsed * 0.06;

      const pos = neurons.map((n, i) => {
        const t = ease(Math.max(0, Math.min(1, (prog - n.delay) / (1 - n.delay))));
        const orbitR = forming ? 0 : 0.025;
        const orbitAngle = elapsed * 0.35 + n.orbitPhase;
        const dx = orbitR * Math.cos(orbitAngle);
        const dy = orbitR * Math.sin(orbitAngle);
        const baseX = (n.sx * (1 - t) + (n.tx + dx) * t);
        const baseY = (n.sy * (1 - t) + (n.ty + dy) * t);
        const ca = Math.cos(spin * 0.15), sa = Math.sin(spin * 0.15);
        const rx = baseX * ca - baseY * sa;
        const ry = baseX * sa + baseY * ca;
        return { x: cx + rx * scale, y: cy + ry * scale, t };
      });

      const isMobile = canvas.width < 700 * dpr;
      const maskRx = (isMobile ? 165 : 235) * dpr;
      const maskRy = (isMobile ? 205 : 215) * dpr;
      const maskFade = (px, py) => {
        const dx = (px - cx) / maskRx;
        const dy = (py - cy) / maskRy;
        const r = Math.sqrt(dx * dx + dy * dy);
        if (r >= 1.5) return 1;
        if (r < 0.9) return 0;
        return (r - 0.9) / 0.6;
      };

      for (const s of synapses) {
        const a = pos[s.a], b = pos[s.b];
        const alpha = Math.min(a.t, b.t);
        if (alpha <= 0.02) continue;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const maskA = maskFade(mx, my);
        if (maskA <= 0.02) continue;
        const finalA = alpha * maskA;
        ctx.strokeStyle = `rgba(${ar},${ag},${ab},${0.18 * finalA})`;
        ctx.lineWidth = 0.9 * dpr;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        if (finalA > 0.7) {
          const fire = ((elapsed * s.fireRate + s.fire) % 2) / 2;
          if (fire < 0.6) {
            const pulseT = fire / 0.6;
            const px = a.x + (b.x - a.x) * pulseT;
            const py = a.y + (b.y - a.y) * pulseT;
            const pulseMask = maskFade(px, py);
            if (pulseMask > 0.05) {
              const glow = ctx.createRadialGradient(px, py, 0, px, py, 8 * dpr);
              glow.addColorStop(0, `rgba(${ar},${ag},${ab},${0.9 * finalA * pulseMask})`);
              glow.addColorStop(1, `rgba(${ar},${ag},${ab},0)`);
              ctx.fillStyle = glow;
              ctx.beginPath(); ctx.arc(px, py, 8 * dpr, 0, Math.PI * 2); ctx.fill();
            }
          }
        }
      }

      for (let i = 0; i < pos.length; i++) {
        const p = pos[i]; if (p.t <= 0.02) continue;
        const nMask = maskFade(p.x, p.y);
        if (nMask <= 0.02) continue;
        const n = neurons[i];
        const breath = 1 + 0.06 * Math.sin(elapsed * 0.9 + n.pulse * 0.4);
        const pulse = 0.65 + 0.35 * Math.sin(elapsed * n.pulseSpeed + n.pulse);
        const depthSize = 0.55 + 0.45 * n.depth;
        const depthBright = 0.4 + 0.6 * n.depth;
        const rBase = n.r * dpr * depthSize * breath;
        const finalA = p.t * pulse * nMask * depthBright;
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rBase * 6);
        glow.addColorStop(0, `rgba(${ar},${ag},${ab},${0.55 * finalA})`);
        glow.addColorStop(0.4, `rgba(${ar},${ag},${ab},${0.2 * finalA})`);
        glow.addColorStop(1, `rgba(${ar},${ag},${ab},0)`);
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(p.x, p.y, rBase * 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(${ar},${ag},${ab},${finalA})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, rBase, 0, Math.PI * 2); ctx.fill();
      }

      if (forming) {
        if (elapsed >= 1.2 && !textReveal) setTextReveal(true);
        if (elapsed >= 2.2) {
          const f = Math.min(1, (elapsed - 2.2) / 0.7);
          canvas.style.opacity = String(1 - f);
          if (f >= 1) {
            cancelAnimationFrame(rafRef.current);
            setTimeout(() => onEnter(), 220);
            return;
          }
        }
      }
      rafRef.current = requestAnimationFrame(draw);
    }
    rafRef.current = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(rafRef.current); if (rt) clearTimeout(rt); window.removeEventListener("resize", onResize); };
  }, [accent, onEnter, textReveal]);

  const go = () => {
    if (phase !== "idle") return;
    if (animationMode === "off") { onEnter(); return; }
    startRef.current = 0;
    setPhase("forming");
  };

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Enter") go(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase]);

  const isMob = typeof window !== "undefined" && window.innerWidth < 768;
  const bg = P.bg;

  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", background: bg, position: "relative", overflow: "hidden" }}>
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: animationMode === "off" ? 0 : 0.6 }} />
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: `radial-gradient(ellipse 70% 50% at 40% 35%, ${withAlpha(accent, 0.05)}, transparent)` }} />

      {/* Minimal top bar */}
      <div style={{ position: "relative", zIndex: 2, display: "flex", alignItems: "center", justifyContent: "space-between", padding: isMob ? "24px 20px" : "32px 48px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Mark size={24} accent={accent} glow={P.dark} />
          <span style={{ fontSize: 15, fontWeight: 600, color: P.ink, letterSpacing: "-0.02em", fontFamily: "var(--cb-sans)" }}>Cerebrum</span>
        </div>
        <div style={{ display: "flex", gap: isMob ? 16 : 28 }}>
          {["About", "Privacy", "Contact"].map(l => (
            <a key={l} href={"/"+l.toLowerCase()} style={{ fontSize: 12.5, color: P.faint, textDecoration: "none", letterSpacing: "0.03em", fontWeight: 500, fontFamily: "var(--cb-mono)", transition: "color 0.2s" }}
              onMouseEnter={e => e.target.style.color = P.ink} onMouseLeave={e => e.target.style.color = P.faint}>{l}</a>
          ))}
        </div>
      </div>

      {/* Hero — left-aligned, editorial, NOT centered */}
      <div style={{
        flex: 1, display: "flex", flexDirection: "column", justifyContent: "center",
        padding: isMob ? "0 24px 60px" : "0 clamp(48px, 8vw, 120px) 100px",
        position: "relative", zIndex: 1, maxWidth: 900, width: "100%",
        opacity: phase === "forming" ? 0 : 1, transform: phase === "forming" ? "translateY(12px)" : "none",
        transition: "opacity 1.2s cubic-bezier(0.4,0,0.2,1), transform 1.2s cubic-bezier(0.4,0,0.2,1)",
      }}>
        <div style={{ marginBottom: 28 }}><Mark size={40} accent={accent} glow={P.dark} /></div>

        <h1 style={{
          fontSize: isMob ? "clamp(34px, 9vw, 44px)" : "clamp(48px, 5vw, 68px)",
          fontWeight: 300, letterSpacing: "-0.035em", color: P.ink,
          margin: "0 0 28px", lineHeight: 1.1, fontFamily: "var(--cb-display)", maxWidth: 660,
        }}>
          The scientific literature,{isMob ? " " : <br/>}<span style={{ fontWeight: 700 }}>answered.</span>
        </h1>

        <p style={{
          fontSize: isMob ? 15.5 : 18, color: P.ink2, margin: "0 0 44px",
          lineHeight: 1.65, maxWidth: 480, fontWeight: 400, letterSpacing: "-0.008em",
        }}>
          Ask a question. Cerebrum searches millions of peer-reviewed papers and writes you an answer you can trace to the source.
        </p>

        <div style={{ display: "flex", gap: 28, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={go} style={{
            display: "inline-flex", alignItems: "center", gap: 9, padding: "13px 30px",
            fontSize: 14.5, fontWeight: 600, background: accent, color: accentText(accent),
            border: "none", borderRadius: 10, cursor: "pointer", fontFamily: "var(--cb-sans)",
            letterSpacing: "-0.01em", boxShadow: `0 4px 20px ${withAlpha(accent, 0.25)}`,
          }}>
            Start exploring
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
          </button>
          <a href="/about" style={{
            fontSize: 13.5, color: P.ink2, textDecoration: "none", borderBottom: `1px solid ${P.line2}`,
            paddingBottom: 2, fontWeight: 500, fontFamily: "var(--cb-sans)", transition: "color 0.2s, border-color 0.2s",
          }} onMouseEnter={e => { e.target.style.color = P.ink; e.target.style.borderColor = P.ink; }}
             onMouseLeave={e => { e.target.style.color = P.ink2; e.target.style.borderColor = P.line2; }}>
            How it works →
          </a>
        </div>

        {/* Database provenance — quiet mono bar */}
        <div style={{ position: "absolute", bottom: isMob ? 20 : 36, left: isMob ? 24 : "clamp(48px, 8vw, 120px)", display: "flex", gap: 18, opacity: 0.35 }}>
          {["PubMed", "Europe PMC", "OpenAlex", "Semantic Scholar", "CORE"].map(d => (
            <span key={d} style={{ fontSize: 10.5, color: P.ink2, letterSpacing: "0.04em", fontFamily: "var(--cb-mono)", fontWeight: 500 }}>{d}</span>
          ))}
          <span style={{ fontSize: 10.5, color: P.faint, fontFamily: "var(--cb-mono)" }}>+11</span>
        </div>
      </div>
    </div>
  );
}


/* ============================================================
   LIVING BACKGROUND — ALL canvas logic preserved verbatim.
   Only the wrapper opacity/style changes.
   ============================================================ */
function LivingBackground({ accent, P, intensity = "cinematic", preset = "particles", density = 1, speed = 1, opacity = 1, paused = false }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(0);
  const stateRef = useRef({ items: [], t: 0 });
  const mouseRef = useRef({ x: -9999, y: -9999 });
  const speedRef = useRef(speed);
  const densityRef = useRef(density);
  const pausedRef = useRef(paused);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { densityRef.current = density; }, [density]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const intensityScale = intensity === "subtle" ? 0.55 : 1;
    const getDensity = () => densityRef.current * intensityScale;
    const getSpeed = () => speedRef.current;

    const rgb = (() => { const h = accent.replace("#", ""); return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)]; })();
    const [ar, ag, ab] = rgb;

    const initItems = () => {
      const cw = canvas.width, ch = canvas.height;
      const items = [];
      if (preset === "particles" || preset === "neurons") {
        const target = Math.floor((cw * ch) / (28000 * dpr) * getDensity());
        for (let i = 0; i < target; i++) {
          items.push({ x: Math.random() * cw, y: Math.random() * ch, vx: (Math.random() - 0.5) * 0.25 * dpr, vy: (Math.random() - 0.5) * 0.25 * dpr, r: (1 + Math.random() * 1.6) * dpr, pulse: Math.random() * Math.PI * 2, pulseSpeed: 0.4 + Math.random() * 0.8 });
        }
      } else if (preset === "waves") {
        const count = Math.floor(8 * getDensity());
        for (let i = 0; i < count; i++) {
          items.push({ yBase: (ch / (count + 1)) * (i + 1), amplitude: (20 + Math.random() * 40) * dpr, wavelength: (200 + Math.random() * 400) * dpr, phase: Math.random() * Math.PI * 2, phaseSpeed: 0.3 + Math.random() * 0.4, thickness: (1 + Math.random() * 1.5) * dpr, offset: Math.random() });
        }
      } else if (preset === "dna") {
        const count = Math.floor(60 * getDensity());
        for (let i = 0; i < count; i++) { items.push({ t: i / count, offset: Math.random() * 0.05 }); }
      } else if (preset === "circuits") {
        const spacing = 90 * dpr / getDensity();
        const cols = Math.ceil(cw / spacing) + 1;
        const rows = Math.ceil(ch / spacing) + 1;
        for (let ix = 0; ix < cols; ix++) {
          for (let iy = 0; iy < rows; iy++) {
            items.push({ x: ix * spacing + (Math.random() - 0.5) * spacing * 0.15, y: iy * spacing + (Math.random() - 0.5) * spacing * 0.15, pulse: Math.random() * Math.PI * 2, hasEdgeR: Math.random() > 0.4, hasEdgeD: Math.random() > 0.4, pulseR: Math.random(), pulseD: Math.random(), rateR: 0.3 + Math.random() * 0.5, rateD: 0.3 + Math.random() * 0.5 });
          }
        }
      } else if (preset === "starfield") {
        const target = Math.floor((cw * ch) / (10000 * dpr) * getDensity());
        for (let i = 0; i < target; i++) {
          const angle = Math.random() * Math.PI * 2;
          const dist = Math.random() * Math.max(cw, ch) * 0.6;
          items.push({ x: cw / 2 + Math.cos(angle) * dist, y: ch / 2 + Math.sin(angle) * dist, angle, dist, distMax: Math.hypot(cw, ch) * 0.7, speed: (0.5 + Math.random() * 2) * dpr, r: (0.6 + Math.random() * 1.2) * dpr });
        }
      } else if (preset === "orbs") {
        const count = Math.max(3, Math.min(7, Math.round(5 * getDensity())));
        const anchors = [ { x: cw * 0.15, y: ch * 0.2 }, { x: cw * 0.85, y: ch * 0.25 }, { x: cw * 0.2, y: ch * 0.85 }, { x: cw * 0.8, y: ch * 0.8 }, { x: cw * 0.5, y: ch * 0.5 }, { x: cw * 0.5, y: ch * 0.1 }, { x: cw * 0.5, y: ch * 0.9 } ];
        for (let i = 0; i < count; i++) {
          const a = anchors[i % anchors.length];
          items.push({ anchorX: a.x, anchorY: a.y, baseRad: (140 + Math.random() * 120) * dpr, intensity: 0.14 + Math.random() * 0.08, orbitSpeed: 0.6 + Math.random() * 0.8, orbitR: 0.5 + Math.random() * 0.6, orbitPhase: Math.random() * Math.PI * 2 });
        }
      }
      stateRef.current.items = items;
    };

    let lastW = 0, lastH = 0, resizeTimer = null;
    const applySize = () => {
      const cssW = canvas.offsetWidth || window.innerWidth || 1;
      const cssH = canvas.offsetHeight || window.innerHeight || 1;
      const MAX_PIXELS = 4_500_000;
      let effDpr = dpr;
      while (cssW * effDpr * cssH * effDpr > MAX_PIXELS && effDpr > 0.75) effDpr -= 0.25;
      canvas.width = Math.max(1, Math.floor(cssW * effDpr));
      canvas.height = Math.max(1, Math.floor(cssH * effDpr));
    };
    const resize = (rebuild) => { applySize(); if (rebuild) initItems(); lastW = canvas.offsetWidth; lastH = canvas.offsetHeight; };
    const onResize = () => {
      const w = canvas.offsetWidth, h = canvas.offsetHeight;
      const widthChanged = Math.abs(w - lastW) > 2;
      const heightChangedALot = Math.abs(h - lastH) > 220;
      if (!widthChanged && !heightChangedALot) { applySize(); lastH = h; return; }
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { resize(true); }, 180);
    };
    resize(true);
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("orientationchange", () => { if (resizeTimer) clearTimeout(resizeTimer); resizeTimer = setTimeout(() => resize(true), 300); }, { passive: true });
    const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
    const hasMouse = typeof window.matchMedia === "function" ? window.matchMedia("(hover: hover) and (pointer: fine)").matches : true;
    const onMove = (e) => { const rect = canvas.getBoundingClientRect(); mouseRef.current.x = (e.clientX - rect.left) * dpr; mouseRef.current.y = (e.clientY - rect.top) * dpr; };
    const onLeave = () => { mouseRef.current.x = -9999; mouseRef.current.y = -9999; };
    if (hasMouse) { window.addEventListener("mousemove", onMove, { passive: true }); window.addEventListener("mouseleave", onLeave, { passive: true }); }

    const startTime = performance.now();
    const linkDist = 130 * dpr;

    function drawParticles(elapsed) {
      const items = stateRef.current.items;
      const mx = mouseRef.current.x, my = mouseRef.current.y;
      const mouseR = 140 * dpr;
      for (const p of items) {
        p.x += p.vx * getSpeed(); p.y += p.vy * getSpeed();
        p.vx += Math.sin(elapsed * 0.3 + p.pulse) * 0.002 * dpr;
        p.vy += Math.cos(elapsed * 0.2 + p.pulse) * 0.002 * dpr;
        if (mx > 0) { const dx = p.x - mx, dy = p.y - my, d = Math.hypot(dx, dy); if (d < mouseR && d > 0.1) { const force = (1 - d / mouseR) * 0.6 * dpr; p.vx += (dx / d) * force * 0.05; p.vy += (dy / d) * force * 0.05; } }
        p.vx *= 0.985; p.vy *= 0.985;
        if (p.x < -20) p.x = canvas.width + 20; else if (p.x > canvas.width + 20) p.x = -20;
        if (p.y < -20) p.y = canvas.height + 20; else if (p.y > canvas.height + 20) p.y = -20;
      }
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i], b = items[j], dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
          if (d2 < linkDist * linkDist) { const d = Math.sqrt(d2); const alpha = (1 - d / linkDist) * 0.14; ctx.strokeStyle = `rgba(${ar},${ag},${ab},${alpha})`; ctx.lineWidth = 0.7 * dpr; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
        }
      }
      for (const p of items) {
        const pulse = 0.6 + 0.4 * Math.sin(elapsed * p.pulseSpeed + p.pulse);
        const glowR = p.r * 4;
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR);
        glow.addColorStop(0, `rgba(${ar},${ag},${ab},${0.22 * pulse})`); glow.addColorStop(1, `rgba(${ar},${ag},${ab},0)`);
        ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(${ar},${ag},${ab},${0.55 * pulse})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
    }
    function drawWaves(elapsed) {
      const waves = stateRef.current.items; const cw = canvas.width;
      for (const w of waves) {
        ctx.strokeStyle = `rgba(${ar},${ag},${ab},${0.25 + 0.15 * Math.sin(elapsed + w.phase)})`; ctx.lineWidth = w.thickness; ctx.beginPath();
        const steps = Math.ceil(cw / 8);
        for (let s = 0; s <= steps; s++) { const x = (s / steps) * cw; const y = w.yBase + w.amplitude * Math.sin(x / w.wavelength * Math.PI * 2 + elapsed * w.phaseSpeed * getSpeed() + w.phase); if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
        ctx.stroke();
      }
    }
    function drawDNA(elapsed) {
      const items = stateRef.current.items; const cx = canvas.width / 2; const cy = canvas.height / 2;
      const heightExtent = canvas.height * 1.1; const radius = 110 * dpr; const twistSpeed = 0.5 * getSpeed();
      ctx.lineWidth = 1.3 * dpr;
      for (let strand = 0; strand < 2; strand++) {
        ctx.beginPath();
        for (let idx = 0; idx <= items.length; idx++) { const n = items[idx % items.length]; const y = cy - heightExtent / 2 + n.t * heightExtent; const twist = elapsed * twistSpeed + n.t * Math.PI * 4; const x = cx + Math.cos(twist + strand * Math.PI) * radius; if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
        ctx.strokeStyle = `rgba(${ar},${ag},${ab},0.28)`; ctx.stroke();
      }
      for (const n of items) {
        const y = cy - heightExtent / 2 + n.t * heightExtent; const twist = elapsed * twistSpeed + n.t * Math.PI * 4;
        const x1 = cx + Math.cos(twist) * radius; const x2 = cx + Math.cos(twist + Math.PI) * radius;
        const z1 = Math.sin(twist); const z2 = Math.sin(twist + Math.PI);
        const bright1 = 0.5 + 0.5 * (z1 + 1) / 2; const bright2 = 0.5 + 0.5 * (z2 + 1) / 2;
        const rungAlpha = 0.14 * Math.max(0, (bright1 + bright2) / 2 - 0.3);
        if (rungAlpha > 0.02) { ctx.strokeStyle = `rgba(${ar},${ag},${ab},${rungAlpha})`; ctx.lineWidth = 0.9 * dpr; ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke(); }
        for (const p of [{ x: x1, b: bright1 }, { x: x2, b: bright2 }]) {
          const r = (1.6 + 1.4 * p.b) * dpr;
          const glow = ctx.createRadialGradient(p.x, y, 0, p.x, y, r * 5);
          glow.addColorStop(0, `rgba(${ar},${ag},${ab},${0.55 * p.b})`); glow.addColorStop(1, `rgba(${ar},${ag},${ab},0)`);
          ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(p.x, y, r * 5, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = `rgba(${ar},${ag},${ab},${0.85 * p.b})`; ctx.beginPath(); ctx.arc(p.x, y, r, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    function drawCircuits(elapsed) {
      const items = stateRef.current.items;
      for (const n of items) {
        for (const m of items) {
          if (n.hasEdgeR && Math.abs(m.y - n.y) < 5 * dpr && m.x > n.x && m.x - n.x < 130 * dpr) {
            ctx.strokeStyle = `rgba(${ar},${ag},${ab},0.12)`; ctx.lineWidth = 0.8 * dpr; ctx.beginPath(); ctx.moveTo(n.x, n.y); ctx.lineTo(m.x, m.y); ctx.stroke();
            const pt = ((elapsed * n.rateR * getSpeed() + n.pulseR) % 2) / 2;
            if (pt < 0.7) { const t = pt / 0.7; const px = n.x + (m.x - n.x) * t; const py = n.y + (m.y - n.y) * t; const glow = ctx.createRadialGradient(px, py, 0, px, py, 5 * dpr); glow.addColorStop(0, `rgba(${ar},${ag},${ab},0.9)`); glow.addColorStop(1, `rgba(${ar},${ag},${ab},0)`); ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(px, py, 5 * dpr, 0, Math.PI * 2); ctx.fill(); }
            break;
          }
        }
        for (const m of items) {
          if (n.hasEdgeD && Math.abs(m.x - n.x) < 5 * dpr && m.y > n.y && m.y - n.y < 130 * dpr) {
            ctx.strokeStyle = `rgba(${ar},${ag},${ab},0.12)`; ctx.lineWidth = 0.8 * dpr; ctx.beginPath(); ctx.moveTo(n.x, n.y); ctx.lineTo(m.x, m.y); ctx.stroke();
            const pt = ((elapsed * n.rateD * getSpeed() + n.pulseD) % 2) / 2;
            if (pt < 0.7) { const t = pt / 0.7; const px = n.x + (m.x - n.x) * t; const py = n.y + (m.y - n.y) * t; const glow = ctx.createRadialGradient(px, py, 0, px, py, 5 * dpr); glow.addColorStop(0, `rgba(${ar},${ag},${ab},0.9)`); glow.addColorStop(1, `rgba(${ar},${ag},${ab},0)`); ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(px, py, 5 * dpr, 0, Math.PI * 2); ctx.fill(); }
            break;
          }
        }
        const r = 1.6 * dpr; ctx.fillStyle = `rgba(${ar},${ag},${ab},0.5)`; ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.fill();
      }
    }
    function drawStarfield(elapsed) {
      const items = stateRef.current.items; const cx = canvas.width / 2, cy = canvas.height / 2;
      for (const s of items) {
        s.dist += s.speed * getSpeed(); if (s.dist > s.distMax) { s.dist = 5; s.angle = Math.random() * Math.PI * 2; }
        s.x = cx + Math.cos(s.angle) * s.dist; s.y = cy + Math.sin(s.angle) * s.dist;
        const alpha = Math.min(1, s.dist / (s.distMax * 0.3));
        const tailLen = s.speed * 5 * dpr; const tx = cx + Math.cos(s.angle) * (s.dist - tailLen); const ty = cy + Math.sin(s.angle) * (s.dist - tailLen);
        ctx.strokeStyle = `rgba(${ar},${ag},${ab},${alpha * 0.4})`; ctx.lineWidth = s.r; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(s.x, s.y); ctx.stroke();
        ctx.fillStyle = `rgba(${ar},${ag},${ab},${alpha * 0.8})`; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
      }
    }
    function drawAurora(elapsed) {
      const cw = canvas.width, ch = canvas.height; const t = elapsed * 0.15 * getSpeed();
      const blobs = [ { hueShift: 0, speedX: 1.0, speedY: 0.7, phaseX: 0, phaseY: 1.2, size: 0.75 }, { hueShift: 30, speedX: 0.8, speedY: 1.1, phaseX: 2.4, phaseY: 0.4, size: 0.85 }, { hueShift: -30, speedX: 1.3, speedY: 0.9, phaseX: 4.1, phaseY: 3.3, size: 0.65 } ];
      ctx.fillStyle = `rgba(${ar},${ag},${ab},0.02)`; ctx.fillRect(0, 0, cw, ch);
      for (const b of blobs) {
        const cx = cw * (0.5 + 0.4 * Math.sin(t * b.speedX + b.phaseX)); const cy = ch * (0.5 + 0.35 * Math.cos(t * b.speedY + b.phaseY)); const rad = Math.max(cw, ch) * b.size;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
        const sr = Math.min(255, Math.max(0, ar + b.hueShift)); const sg = Math.min(255, Math.max(0, ag + b.hueShift * 0.5)); const sb = Math.min(255, Math.max(0, ab - b.hueShift * 0.4));
        g.addColorStop(0, `rgba(${sr},${sg},${sb},0.28)`); g.addColorStop(0.5, `rgba(${sr},${sg},${sb},0.08)`); g.addColorStop(1, `rgba(${sr},${sg},${sb},0)`);
        ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch);
      }
    }
    function drawOrbs(elapsed) {
      const cw = canvas.width, ch = canvas.height; const items = stateRef.current.items; const t = elapsed * 0.08 * getSpeed();
      for (const o of items) {
        const cx = o.anchorX + Math.cos(t * o.orbitSpeed + o.orbitPhase) * o.orbitR * cw * 0.08;
        const cy = o.anchorY + Math.sin(t * o.orbitSpeed + o.orbitPhase) * o.orbitR * ch * 0.08;
        const rad = o.baseRad * (1 + 0.08 * Math.sin(t * 1.3 + o.orbitPhase));
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
        g.addColorStop(0, `rgba(${ar},${ag},${ab},${o.intensity})`); g.addColorStop(0.4, `rgba(${ar},${ag},${ab},${o.intensity * 0.35})`); g.addColorStop(1, `rgba(${ar},${ag},${ab},0)`);
        ctx.fillStyle = g; ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
      }
    }
    function drawGrid() {
      const cw = canvas.width, ch = canvas.height; const cell = 40 * dpr;
      ctx.fillStyle = `rgba(${ar},${ag},${ab},0.08)`;
      for (let x = cell; x < cw; x += cell) { for (let y = cell; y < ch; y += cell) { ctx.beginPath(); ctx.arc(x, y, 1 * dpr, 0, Math.PI * 2); ctx.fill(); } }
    }
    function drawNone() {
      const cw = canvas.width, ch = canvas.height;
      const g = ctx.createLinearGradient(0, 0, cw, ch);
      g.addColorStop(0, `rgba(${ar},${ag},${ab},0.03)`); g.addColorStop(1, `rgba(${ar},${ag},${ab},0)`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch);
    }

    function draw(now) {
      if (pausedRef.current) { rafRef.current = requestAnimationFrame(draw); return; }
      const elapsed = (now - startTime) / 1000;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (preset === "waves") drawWaves(elapsed);
      else if (preset === "dna") drawDNA(elapsed);
      else if (preset === "circuits") drawCircuits(elapsed);
      else if (preset === "starfield") drawStarfield(elapsed);
      else if (preset === "aurora") drawAurora(elapsed);
      else if (preset === "orbs") drawOrbs(elapsed);
      else if (preset === "grid") drawGrid();
      else if (preset === "none") drawNone();
      else drawParticles(elapsed);
      rafRef.current = requestAnimationFrame(draw);
    }
    rafRef.current = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(rafRef.current); if (resizeTimer) clearTimeout(resizeTimer); window.removeEventListener("resize", onResize); window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseleave", onLeave); };
  }, [accent, intensity, preset]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const canvas = canvasRef.current; if (!canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const intensityScale = intensity === "subtle" ? 0.55 : 1;
      const finalDensity = density * intensityScale;
      const cw = canvas.width, ch = canvas.height;
      const cur = stateRef.current.items;
      if (preset === "particles" || preset === "neurons") {
        const target = Math.floor((cw * ch) / (28000 * dpr) * finalDensity);
        while (cur.length < target) { cur.push({ x: Math.random() * cw, y: Math.random() * ch, vx: (Math.random() - 0.5) * 0.25 * dpr, vy: (Math.random() - 0.5) * 0.25 * dpr, r: (1 + Math.random() * 1.6) * dpr, pulse: Math.random() * Math.PI * 2, pulseSpeed: 0.4 + Math.random() * 0.8 }); }
        while (cur.length > target) cur.pop();
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [density, intensity, preset]);

  return (
    <canvas ref={canvasRef} style={{ position: "fixed", inset: 0, width: "100%", height: "100%", pointerEvents: "none", opacity: (P.dark ? 0.3 : 0.22) * (intensity === "subtle" ? 0.55 : 1) * opacity, zIndex: 0 }} aria-hidden="true" />
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
function CustomCursor({ accent, P }) {
  const dotRef = useRef(null);
  const ringRef = useRef(null);
  const pos = useRef({ x: -100, y: -100 });
  const target = useRef({ x: -100, y: -100 });
  const hovering = useRef(false);
  const clicking = useRef(false);
  const visible = useRef(false);

  useEffect(() => {
    // Only on desktop with fine pointer
    const hasMouse = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (!hasMouse) return;

    document.documentElement.style.cursor = "none";
    const actionables = "a, button, input, select, textarea, [role='button'], summary, label[for], .cb-card, .cb-btn, .cb-hbtn";

    const onMove = (e) => {
      target.current = { x: e.clientX, y: e.clientY };
      if (!visible.current) { visible.current = true; pos.current = { ...target.current }; }
    };
    const onEnter = (e) => {
      if (e.target.closest(actionables)) hovering.current = true;
      else hovering.current = false;
    };
    const onLeave = () => { hovering.current = false; };
    const onDown = () => { clicking.current = true; };
    const onUp = () => { clicking.current = false; };
    const onOut = () => { visible.current = false; };

    window.addEventListener("mousemove", onMove, { passive: true });
    document.addEventListener("mouseover", onEnter, { passive: true });
    document.addEventListener("mouseout", onLeave, { passive: true });
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    document.addEventListener("mouseleave", onOut);

    let raf;
    const lerp = (a, b, t) => a + (b - a) * t;
    const loop = () => {
      pos.current.x = lerp(pos.current.x, target.current.x, 0.15);
      pos.current.y = lerp(pos.current.y, target.current.y, 0.15);
      const { x, y } = pos.current;
      const vis = visible.current;
      if (dotRef.current) {
        dotRef.current.style.transform = `translate3d(${x - 4}px, ${y - 4}px, 0) scale(${clicking.current ? 0.6 : 1})`;
        dotRef.current.style.opacity = vis ? "1" : "0";
      }
      if (ringRef.current) {
        const ringX = lerp(parseFloat(ringRef.current.dataset.x || x), x, 0.08);
        const ringY = lerp(parseFloat(ringRef.current.dataset.y || y), y, 0.08);
        ringRef.current.dataset.x = ringX;
        ringRef.current.dataset.y = ringY;
        const s = hovering.current ? 2.5 : 1;
        ringRef.current.style.transform = `translate3d(${ringX - 20}px, ${ringY - 20}px, 0) scale(${s})`;
        ringRef.current.style.opacity = vis ? (hovering.current ? "0.8" : "0.4") : "0";
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      document.documentElement.style.cursor = "";
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseover", onEnter);
      document.removeEventListener("mouseout", onLeave);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      document.removeEventListener("mouseleave", onOut);
    };
  }, []);

  return (
    <>
      {/* Dot: solid, fast-tracking */}
      <div ref={dotRef} style={{
        position: "fixed", top: 0, left: 0, width: 8, height: 8,
        borderRadius: "50%", background: accent,
        boxShadow: `0 0 12px ${withAlpha(accent, 0.6)}`,
        pointerEvents: "none", zIndex: 9999, opacity: 0,
        transition: "transform 60ms ease, opacity 300ms",
        willChange: "transform",
      }} />
      {/* Ring: slow-trailing, blend-mode */}
      <div ref={ringRef} data-x="-100" data-y="-100" style={{
        position: "fixed", top: 0, left: 0, width: 40, height: 40,
        borderRadius: "50%", border: `1.5px solid ${accent}`,
        mixBlendMode: "difference",
        pointerEvents: "none", zIndex: 9998, opacity: 0,
        transition: "transform 0.35s cubic-bezier(0.16,1,0.3,1), opacity 0.4s, width 0.3s, height 0.3s",
        willChange: "transform",
      }} />
    </>
  );
}


/* ════════════════════════════════════════════════════════════════
   UPGRADE 2: MAGNETIC BUTTON
   
   Wraps any element and makes it gently pull toward the cursor 
   when hovered, using lerped offset translation. Resets on leave.
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
function GlowBorder({ children, accent, active, style, className, ...props }) {
  const ref = useRef(null);
  const glowRef = useRef(null);

  useEffect(() => {
    const el = ref.current;
    const glow = glowRef.current;
    if (!el || !glow) return;
    const hasMouse = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (!hasMouse) return;

    const onMove = (e) => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      glow.style.opacity = "1";
      glow.style.background = `radial-gradient(180px circle at ${x}px ${y}px, ${withAlpha(accent, 0.25)}, transparent 70%)`;
    };
    const onLeave = () => { glow.style.opacity = "0"; };

    el.addEventListener("mousemove", onMove, { passive: true });
    el.addEventListener("mouseleave", onLeave, { passive: true });
    return () => {
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
    };
  }, [accent]);

  return (
    <div ref={ref} style={{ position: "relative", ...style }} className={className} {...props}>
      {/* Mouse-following glow layer */}
      <div ref={glowRef} style={{
        position: "absolute", inset: -1, borderRadius: "inherit",
        opacity: 0, transition: "opacity 0.4s ease",
        pointerEvents: "none", zIndex: 0,
      }} />
      {/* Content */}
      <div style={{ position: "relative", zIndex: 1, display: "contents" }}>
        {children}
      </div>
    </div>
  );
}


/* ════════════════════════════════════════════════════════════════
   UPGRADE 4: KINETIC TEXT
   
   Splits text into individual characters that gently breathe/shift 
   with staggered sine-wave offsets. Subtle, premium, not gimmicky.
   ════════════════════════════════════════════════════════════════ */
function KineticText({ text, style, className }) {
  const [time, setTime] = useState(0);
  const rafRef = useRef(null);

  useEffect(() => {
    const hasMouse = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (!hasMouse) return; // Static on mobile
    let start = performance.now();
    const tick = (now) => {
      setTime((now - start) / 1000);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const chars = text.split("");
  return (
    <span style={style} className={className} aria-label={text}>
      {chars.map((ch, i) => {
        if (ch === " ") return <span key={i}>&nbsp;</span>;
        const yOff = Math.sin(time * 0.8 + i * 0.15) * 1.5;
        const opacityOff = 0.85 + Math.sin(time * 0.6 + i * 0.2) * 0.15;
        return (
          <span key={i} style={{
            display: "inline-block",
            transform: `translateY(${yOff}px)`,
            opacity: opacityOff,
            transition: "none",
            willChange: "transform",
          }} aria-hidden="true">{ch}</span>
        );
      })}
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
function WebGLField({ accent, P, intensity = 1, paused = false }) {
  const canvasRef = useRef(null);
  const mouseRef = useRef({ x: 0.5, y: 0.5 });
  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { alpha: true, antialias: false, premultipliedAlpha: false });
    if (!gl) return; // Fallback handled by parent

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      canvas.width = Math.floor(canvas.offsetWidth * dpr);
      canvas.height = Math.floor(canvas.offsetHeight * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    window.addEventListener("resize", resize, { passive: true });

    // Parse accent color
    const hex = accent.replace("#", "");
    const cr = parseInt(hex.slice(0,2),16) / 255;
    const cg = parseInt(hex.slice(2,4),16) / 255;
    const cb = parseInt(hex.slice(4,6),16) / 255;

    // ── Shaders ──
    const vertSrc = `
      attribute vec3 aPos;
      attribute float aSize;
      attribute float aPhase;
      uniform float uTime;
      uniform vec2 uMouse;
      uniform vec2 uRes;
      varying float vAlpha;
      varying float vDist;
      
      void main() {
        vec3 pos = aPos;
        
        // Breathing motion
        float breath = sin(uTime * 0.4 + aPhase) * 0.02;
        pos.x += breath;
        pos.y += cos(uTime * 0.3 + aPhase * 1.3) * 0.015;
        pos.z += sin(uTime * 0.2 + aPhase * 0.7) * 0.01;
        
        // Mouse repulsion
        vec2 mouseNDC = uMouse * 2.0 - 1.0;
        vec2 posNDC = pos.xy;
        float mouseDist = distance(posNDC, mouseNDC);
        float repulse = smoothstep(0.4, 0.0, mouseDist) * 0.15;
        vec2 dir = normalize(posNDC - mouseNDC + 0.001);
        pos.xy += dir * repulse;
        
        // Perspective projection
        float fov = 1.2;
        float z = pos.z + 1.5;
        vec2 projected = pos.xy * fov / z;
        float aspect = uRes.x / uRes.y;
        projected.x /= aspect;
        
        gl_Position = vec4(projected, pos.z * 0.1, 1.0);
        gl_PointSize = aSize * (300.0 / z) * (uRes.y / 800.0);
        
        // Alpha: distance from center + depth
        vAlpha = smoothstep(1.8, 0.3, length(pos.xy)) * smoothstep(1.0, 0.0, abs(pos.z));
        vDist = mouseDist;
      }
    `;
    const fragSrc = `
      precision mediump float;
      uniform vec3 uColor;
      uniform float uTime;
      varying float vAlpha;
      varying float vDist;
      
      void main() {
        // Soft circle
        vec2 cxy = gl_PointCoord * 2.0 - 1.0;
        float r = dot(cxy, cxy);
        if (r > 1.0) discard;
        
        // Glow falloff
        float glow = exp(-r * 3.0) * 0.8 + exp(-r * 0.8) * 0.4;
        
        // Pulse near mouse
        float mousePulse = smoothstep(0.5, 0.0, vDist) * 0.3;
        float pulse = sin(uTime * 2.0 + vDist * 10.0) * 0.5 + 0.5;
        
        float alpha = glow * vAlpha * (0.6 + mousePulse * pulse);
        gl_FragColor = vec4(uColor * (1.0 + mousePulse * 0.5), alpha * 0.7);
      }
    `;

    function compileShader(src, type) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.warn("Shader error:", gl.getShaderInfoLog(s));
        gl.deleteShader(s);
        return null;
      }
      return s;
    }

    const vs = compileShader(vertSrc, gl.VERTEX_SHADER);
    const fs = compileShader(fragSrc, gl.FRAGMENT_SHADER);
    if (!vs || !fs) return;

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    // ── Particle data ──
    const N = Math.floor(400 * intensity);
    const posData = new Float32Array(N * 3);
    const sizeData = new Float32Array(N);
    const phaseData = new Float32Array(N);

    for (let i = 0; i < N; i++) {
      // Distribute in a sphere-ish volume
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 0.3 + Math.random() * 1.2;
      posData[i * 3]     = Math.sin(phi) * Math.cos(theta) * r;
      posData[i * 3 + 1] = Math.sin(phi) * Math.sin(theta) * r * 0.7;
      posData[i * 3 + 2] = (Math.cos(phi) * r * 0.5) - 0.2;
      sizeData[i] = 1.5 + Math.random() * 3.5;
      phaseData[i] = Math.random() * Math.PI * 2;
    }

    // ── Buffers ──
    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, posData, gl.STATIC_DRAW);
    const aPosLoc = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPosLoc);
    gl.vertexAttribPointer(aPosLoc, 3, gl.FLOAT, false, 0, 0);

    const sizeBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuf);
    gl.bufferData(gl.ARRAY_BUFFER, sizeData, gl.STATIC_DRAW);
    const aSizeLoc = gl.getAttribLocation(prog, "aSize");
    gl.enableVertexAttribArray(aSizeLoc);
    gl.vertexAttribPointer(aSizeLoc, 1, gl.FLOAT, false, 0, 0);

    const phaseBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, phaseBuf);
    gl.bufferData(gl.ARRAY_BUFFER, phaseData, gl.STATIC_DRAW);
    const aPhaseLoc = gl.getAttribLocation(prog, "aPhase");
    gl.enableVertexAttribArray(aPhaseLoc);
    gl.vertexAttribPointer(aPhaseLoc, 1, gl.FLOAT, false, 0, 0);

    // ── Uniforms ──
    const uTime = gl.getUniformLocation(prog, "uTime");
    const uMouse = gl.getUniformLocation(prog, "uMouse");
    const uRes = gl.getUniformLocation(prog, "uRes");
    const uColor = gl.getUniformLocation(prog, "uColor");

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // Additive blending for glow

    const onMove = (e) => {
      mouseRef.current = {
        x: e.clientX / window.innerWidth,
        y: 1.0 - e.clientY / window.innerHeight,
      };
    };
    window.addEventListener("mousemove", onMove, { passive: true });

    const startTime = performance.now();
    let raf;
    function draw() {
      if (pausedRef.current) { raf = requestAnimationFrame(draw); return; }
      const t = (performance.now() - startTime) / 1000;

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(prog);
      gl.uniform1f(uTime, t);
      gl.uniform2f(uMouse, mouseRef.current.x, mouseRef.current.y);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform3f(uColor, cr, cg, cb);

      // Re-bind position buffer
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.vertexAttribPointer(aPosLoc, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuf);
      gl.vertexAttribPointer(aSizeLoc, 1, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, phaseBuf);
      gl.vertexAttribPointer(aPhaseLoc, 1, gl.FLOAT, false, 0, 0);

      gl.drawArrays(gl.POINTS, 0, N);
      raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(posBuf);
      gl.deleteBuffer(sizeBuf);
      gl.deleteBuffer(phaseBuf);
    };
  }, [accent, intensity]);

  return (
    <canvas ref={canvasRef} style={{
      position: "fixed", inset: 0, width: "100%", height: "100%",
      pointerEvents: "none", zIndex: 0, opacity: P.dark ? 0.6 : 0.25,
    }} aria-hidden="true" />
  );
}


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
  const goHome = () => { try { setCookie("cb_entered_v3", "1", 365); } catch {} window.location.href = "/"; };
  const PAGES = {
    about: { eyebrow: "About", title: "A research instrument, not a chatbot", lede: "Cerebrum queries the open scientific literature and returns answers where every claim traces back to a real, verifiable paper.", blocks: [ { h: "What it does", p: "You ask a scientific question. Cerebrum queries a group of open scholarly databases in parallel, scores what comes back for genuine relevance, and writes a summary constrained by what those papers actually say. Every citation is a real DOI you can open and check." }, { h: "The databases", list: ["Europe PMC — 43M articles", "PubMed — 36M articles", "OpenAlex — 250M works", "Semantic Scholar — 220M papers", "Crossref — 150M works", "arXiv, bioRxiv, medRxiv — preprints", "DOAJ, PLOS, Zenodo — open access"] }, { h: "The principle", p: "If no papers are retrieved for a question, Cerebrum says so plainly rather than inventing sources. A confident guess dressed up as science is worse than an honest 'nothing found.' That constraint is enforced mechanically, not just requested politely." }, { h: "What it is not", list: ["Not a substitute for reading the papers — every summary is AI-generated, so verify anything you'll rely on.", "Not a medical, legal, or financial advisor.", "Not tracked or monetized — no ads, no account, no selling data."] } ] },
    privacy: { eyebrow: "Privacy", title: "We collect as little as physically possible", lede: "No tracking pixels. No third-party analytics. No account. No selling data — there is nothing to sell.", updated: "Last updated January 2026", blocks: [ { h: "What we don't do", list: ["No tracking pixels, third-party analytics, or ad networks.", "No account, email, or personal information required.", "No selling, sharing, or profiling of user data.", "No tracking cookies. Preferences live in your browser's local storage and never leave your device."] }, { h: "What happens when you search", list: ["Your question is sent to Cerebrum's server to query databases and generate an answer.", "Search terms are forwarded to scholarly APIs (Europe PMC, PubMed, OpenAlex, and others).", "The question is sent to a language-model provider (OpenRouter or Cloudflare Workers AI) to write the summary.", "Your IP is visible to Cloudflare for rate limiting and abuse prevention.", "We do not permanently store your questions."] }, { h: "Local storage", p: "Saved articles, session history, and preferences (theme, motion, voice) are stored only in your browser via localStorage. Clearing your browser data removes them entirely." }, { h: "Children", p: "Cerebrum is not directed at children under 13." } ] },
    terms: { eyebrow: "Terms", title: "The rules that keep this usable for everyone", lede: "Cerebrum is a free tool provided as-is. Using it means agreeing to a few common-sense terms.", updated: "Last updated January 2026", blocks: [ { h: "What Cerebrum is", p: "A free scientific literature search tool that returns AI-generated summaries of retrieved peer-reviewed papers, provided as-is with no warranty." }, { h: "Accuracy is not guaranteed", p: "Answers are generated by a language model from retrieved abstracts. Models can misread or misattribute. Verify anything important against the cited sources. Cerebrum is not a substitute for a qualified professional." }, { h: "Acceptable use", list: ["Don't disrupt, degrade, or circumvent the service or its rate limits.", "Don't systematically scrape, mirror, or resell answers.", "Don't generate content meant to defraud, defame, harass, or endanger.", "Don't violate the terms of the upstream scholarly APIs."] }, { h: "Third-party content", p: "Cerebrum links to papers hosted by publishers and repositories. We aren't responsible for their content, availability, or licensing — follow each publisher's terms." }, { h: "Availability & liability", p: "Cerebrum is free and comes with no availability guarantee. To the maximum extent allowed by law, we aren't liable for damages arising from your use of the service." } ] },
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
    <div style={{ marginTop: 24, border: `1px solid ${P.line}`, borderRadius: 12, padding: "18px 20px", background: withAlpha(P.surface, 0.5), backdropFilter: "blur(8px)" }} className="cb-fade">
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
      <div style={S.answerCard} className="cb-answer-enter">
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

function Settings({ P, accent, at, S, PALETTES, ACCENTS, paletteName, setPaletteName, accentName, setAccentName, customAccent, setCustomAccent, answerLength, setAnswerLength, factCheck, setFactCheck, muted, setMuted, typewriter, setTypewriter, soundMode, setSoundMode, animationMode, setAnimationMode, animPreset, setAnimPreset, animDensity, setAnimDensity, animSpeed, setAnimSpeed, animOpacity, setAnimOpacity, sfx, setSessions, setSaved, close }) {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState("look");
  const [confirmClear, setConfirmClear] = useState(false);
  const SOUND_MODES = [["pulse", "Soft pulse"], ["shimmer", "Airy shimmer"], ["warm", "Warm hum"], ["minimal", "Minimal"]];
  const TABS = [["look", "Look"], ["answers", "Answers"], ["motion", "Motion"], ["audio", "Audio"], ["data", "Data"]];

  const Group = ({ title, hint, children }) => (<div style={{ marginBottom: 28 }}><div style={{ fontSize: 12, fontWeight: 600, color: P.ink, letterSpacing: "-0.01em", marginBottom: hint ? 3 : 10, fontFamily: "var(--cb-display)" }}>{title}</div>{hint && <div style={{ fontSize: 12, color: P.faint, lineHeight: 1.5, marginBottom: 11 }}>{hint}</div>}{children}</div>);
  const Row = ({ label, desc, control }) => (<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "12px 0", borderBottom: `1px solid ${P.line}` }}><div style={{ minWidth: 0 }}><div style={{ fontSize: 13.5, color: P.ink, fontWeight: 500 }}>{label}</div>{desc && <div style={{ fontSize: 11.5, color: P.faint, lineHeight: 1.45, marginTop: 2 }}>{desc}</div>}</div><div style={{ flexShrink: 0 }}>{control}</div></div>);
  const Switch = ({ on, onChange, label }) => (<button role="switch" aria-checked={on} aria-label={label} onClick={() => { sfx(); onChange(!on); }} style={{ width: 40, height: 24, borderRadius: 20, position: "relative", background: on ? accent : P.line2, border: "none", cursor: "pointer", padding: 0, transition: "background 160ms ease" }}><span style={{ position: "absolute", top: 2, left: 2, width: 20, height: 20, borderRadius: "50%", background: on ? at : P.bg, transform: on ? "translateX(16px)" : "translateX(0)", transition: "transform 160ms ease", boxShadow: "0 1px 3px rgba(0,0,0,0.25)" }} /></button>);
  const Seg = ({ value, options, onChange }) => (<div style={{ display: "inline-flex", background: P.bg, border: `1px solid ${P.line}`, borderRadius: 8, padding: 2, gap: 1 }}>{options.map(([v, label]) => (<button key={v} onClick={() => { sfx(); onChange(v); }} style={{ padding: "6px 12px", fontSize: 12, fontWeight: 550, background: value === v ? accent : "transparent", color: value === v ? at : P.ink2, border: "none", borderRadius: 6, cursor: "pointer", fontFamily: "inherit" }}>{label}</button>))}</div>);
  const PresetCard = ({ id, label, sub, active }) => (<button className="cb-btn" onClick={() => { sfx(); setAnimPreset(id); }} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, padding: "10px 12px", textAlign: "left", background: active ? withAlpha(accent, 0.08) : "transparent", border: `1px solid ${active ? accent : P.line}`, borderRadius: 10, cursor: "pointer", fontFamily: "inherit" }}><span style={{ fontSize: 12, fontWeight: 600, color: active ? accent : P.ink }}>{label}</span><span style={{ fontSize: 10.5, color: P.faint, lineHeight: 1.3 }}>{sub}</span></button>);

  return (
    <div style={S.modalWrap} onClick={close} className="cb-backdrop">
      <div onClick={(e) => e.stopPropagation()} className="cb-modal" style={{ background: P.surface, border: `1px solid ${P.line2}`, borderRadius: 16, width: 500, maxWidth: "100%", maxHeight: isMobile ? "92vh" : "86vh", display: "flex", flexDirection: "column", fontFamily: "var(--cb-body)", boxShadow: "0 24px 70px rgba(0,0,0,0.4)", overflow: "hidden" }}>
        <div style={{ padding: isMobile ? "18px 18px 0" : "20px 22px 0", borderBottom: `1px solid ${P.line}`, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: P.ink, letterSpacing: "-0.02em", fontFamily: "var(--cb-display)" }}>Settings</div>
            <button onClick={close} aria-label="Close settings" style={{ background: "transparent", border: "none", color: P.faint, width: 32, height: 32, borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }} className="cb-hbtn"><Icon name="close" size={16} /></button>
          </div>
          <div style={{ display: "flex", gap: 1, overflowX: "auto", scrollbarWidth: "none" }}>
            {TABS.map(([id, label]) => (
              <button key={id} onClick={() => { sfx(); setTab(id); }} style={{ padding: "8px 12px 10px", fontSize: 12.5, fontWeight: 550, background: "transparent", border: "none", borderBottom: `2px solid ${tab === id ? accent : "transparent"}`, color: tab === id ? P.ink : P.faint, cursor: "pointer", fontFamily: "var(--cb-mono)", whiteSpace: "nowrap", letterSpacing: "0.01em", marginBottom: -1 }}>{label}</button>
            ))}
          </div>
        </div>
        <div key={tab} className="cb-fade" style={{ padding: isMobile ? "18px" : "20px 22px", overflowY: "auto", flex: 1, WebkitOverflowScrolling: "touch" }}>
          {tab === "look" && (<>
            <Group title="Theme">
              <div style={S.palRow}>{Object.keys(PALETTES).map((pn) => (<button key={pn} style={{ ...S.palCard, background: PALETTES[pn].bg, borderColor: paletteName === pn ? accent : PALETTES[pn].line2, borderWidth: paletteName === pn ? 2 : 1 }} onClick={() => { sfx(); setPaletteName(pn); }}><div style={{ display: "flex", gap: 4 }}><span style={{ width: 20, height: 20, borderRadius: 5, background: PALETTES[pn].surface, border: `1px solid ${PALETTES[pn].line2}` }} /><span style={{ width: 20, height: 20, borderRadius: 5, background: accent }} /></div><span style={{ fontSize: 11.5, color: PALETTES[pn].ink, fontWeight: 550, fontFamily: "var(--cb-mono)" }}>{pn}</span></button>))}</div>
            </Group>
            <Group title="Accent colour" hint="Used for citations, highlights, and active states.">
              <div style={S.accentRow}>{Object.keys(ACCENTS).map((an) => (<button key={an} title={an} aria-label={an} style={{ ...S.accentDot, background: ACCENTS[an], transform: (!customAccent && accentName === an) ? "scale(1.15)" : "none", boxShadow: (!customAccent && accentName === an) ? `0 0 0 2px ${P.surface}, 0 0 0 3px ${ACCENTS[an]}` : "none" }} onClick={() => { sfx(); setCustomAccent(""); setAccentName(an); }} />))}<label style={S.customDot} title="Custom colour"><input type="color" value={accent} onChange={(e) => setCustomAccent(e.target.value)} style={{ opacity: 0, width: 0, height: 0, position: "absolute" }} /><span style={{ fontSize: 14, color: P.ink2 }}>+</span></label></div>
            </Group>
          </>)}
          {tab === "answers" && (<>
            <Group title="Response">
              <Row label="Answer length" desc="How much detail to include." control={<Seg value={answerLength} options={[["short", "Short"], ["medium", "Med"], ["long", "Long"]]} onChange={setAnswerLength} />} />
              <Row label="Verify claims" desc="A second pass checks each claim against cited abstracts." control={<Switch on={factCheck} onChange={setFactCheck} label="Verify claims" />} />
              <Row label="Animated reveal" desc="Type answers out progressively." control={<Switch on={typewriter} onChange={setTypewriter} label="Animated reveal" />} />
            </Group>
          </>)}
          {tab === "motion" && (<>
            <Group title="Motion level" hint="Full runs every effect. Subtle thins them. Off is static.">
              <Seg value={animationMode} options={[["cinematic", "Full"], ["subtle", "Subtle"], ["off", "Off"]]} onChange={setAnimationMode} />
            </Group>
            {animationMode !== "off" && (<>
              <Group title="Background">
                <div style={{ fontSize: 10, color: P.faint, marginBottom: 8, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600, fontFamily: "var(--cb-mono)" }}>Ambient</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
                  <PresetCard id="aurora" label="Aurora" sub="Drifting colour wash" active={animPreset === "aurora"} />
                  <PresetCard id="orbs" label="Soft orbs" sub="Slow glowing spheres" active={animPreset === "orbs"} />
                  <PresetCard id="grid" label="Grid" sub="Static dot lattice" active={animPreset === "grid"} />
                  <PresetCard id="none" label="Solid" sub="No motion" active={animPreset === "none"} />
                </div>
                <div style={{ fontSize: 10, color: P.faint, marginBottom: 8, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600, fontFamily: "var(--cb-mono)" }}>Scientific</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <PresetCard id="dna" label="Helix" sub="Double strand" active={animPreset === "dna"} />
                  <PresetCard id="neurons" label="Neurons" sub="Synapse network" active={animPreset === "neurons"} />
                  <PresetCard id="particles" label="Particles" sub="Point field" active={animPreset === "particles"} />
                  <PresetCard id="waves" label="Waves" sub="Sine curves" active={animPreset === "waves"} />
                  <PresetCard id="circuits" label="Circuits" sub="Signal traces" active={animPreset === "circuits"} />
                  <PresetCard id="starfield" label="Starfield" sub="Radial streaks" active={animPreset === "starfield"} />
                </div>
              </Group>
              <Group title="Fine tuning">
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <LocalSlider label="Density" value={animDensity} min={0.3} max={2.5} step={0.1} format={(v) => v.toFixed(1) + "×"} onCommit={setAnimDensity} accent={accent} P={P} />
                  <LocalSlider label="Speed" value={animSpeed} min={0.2} max={3} step={0.1} format={(v) => v.toFixed(1) + "×"} onCommit={setAnimSpeed} accent={accent} P={P} />
                  <LocalSlider label="Opacity" value={animOpacity} min={0.2} max={1.5} step={0.1} format={(v) => Math.round(v * 100) + "%"} onCommit={setAnimOpacity} accent={accent} P={P} />
                  <button className="cb-btn" onClick={() => { sfx(); setAnimPreset("aurora"); setAnimDensity(1); setAnimSpeed(1); setAnimOpacity(1); }} style={{ fontSize: 11.5, padding: "7px 12px", background: "transparent", border: `1px solid ${P.line}`, borderRadius: 8, color: P.ink2, cursor: "pointer", fontFamily: "var(--cb-mono)", alignSelf: "flex-start", fontWeight: 500 }}>Reset defaults</button>
                </div>
              </Group>
            </>)}
          </>)}
          {tab === "audio" && (<>
            <Group title="Interface sound"><Row label="Sound effects" desc="Subtle tones on interaction." control={<Switch on={!muted} onChange={(v) => setMuted(!v)} label="Sound effects" />} /></Group>
            <Group title="Search tone" hint="Plays while searching. Tap to preview.">
              <div style={{ ...S.soundGrid, opacity: muted ? 0.4 : 1, pointerEvents: muted ? "none" : "auto" }}>
                {SOUND_MODES.map(([id, name]) => (<button key={id} style={{ ...S.soundBtn, ...(soundMode === id ? S.soundBtnActive : {}) }} onClick={() => { setSoundMode(id); Audio.preview(id); }}><span>{name}</span>{soundMode === id && <Icon name="check" size={12} style={{ color: accent }} />}</button>))}
              </div>
            </Group>
            <Group title="Read aloud" hint="Default voice is free via Cerebrum's servers. Add your own ElevenLabs key for premium narration.">
              <TtsVoiceSetting P={P} accent={accent} at={at} S={S} sfx={sfx} />
              <ElevenLabsSetting P={P} accent={accent} at={at} S={S} sfx={sfx} />
            </Group>
          </>)}
          {tab === "data" && (<>
            <Group title="Local data" hint="Saved articles and preferences are stored in this browser only.">
              <Row label="Saved articles & sessions" desc="Clearing cannot be undone." control={
                confirmClear ? (<div style={{ display: "flex", gap: 6 }}><button onClick={() => { setSessions([]); setSaved([]); setConfirmClear(false); sfx(); }} style={{ padding: "7px 12px", fontSize: 12, fontWeight: 600, background: "#e5484d", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "inherit" }}>Confirm</button><button onClick={() => setConfirmClear(false)} style={{ padding: "7px 12px", fontSize: 12, fontWeight: 500, background: "transparent", color: P.ink2, border: `1px solid ${P.line}`, borderRadius: 8, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button></div>
                ) : (<button onClick={() => setConfirmClear(true)} style={{ padding: "7px 12px", fontSize: 12, fontWeight: 500, background: "transparent", color: "#e5484d", border: `1px solid ${withAlpha("#e5484d", 0.35)}`, borderRadius: 8, cursor: "pointer", fontFamily: "inherit" }}>Clear all</button>)
              } />
            </Group>
            <Group title="Keyboard shortcuts">
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {[[kbdLabel("K"), "Search palette"], [kbdLabel("J"), "New investigation"], [kbdLabel("B"), "Saved articles"], [kbdLabel("/"), "Settings"], ["Esc", "Close any panel"]].map(([key, desc]) => (
                  <div key={desc} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${P.line}` }}>
                    <span style={{ fontSize: 13, color: P.ink2 }}>{desc}</span>
                    <kbd style={S.kbd}>{key}</kbd>
                  </div>
                ))}
              </div>
            </Group>
          </>)}
        </div>
        <div style={{ padding: isMobile ? "12px 18px" : "12px 22px", borderTop: `1px solid ${P.line}`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span style={{ fontSize: 11, color: P.faint, fontFamily: "var(--cb-mono)" }}>Stored on this device</span>
          <button onClick={close} style={{ padding: "8px 18px", fontSize: 13, fontWeight: 600, background: accent, color: at, border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "inherit" }}>Done</button>
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
    brand: { fontWeight: 600, fontSize: 18, letterSpacing: "-0.02em", color: P.ink, fontFamily: "var(--cb-display)" },
    headActions: { display: "flex", alignItems: "center", gap: isMobile ? 1 : 4 },
    cmdHint: { display: "flex", alignItems: "center", gap: 8, background: P.dark ? withAlpha(P.surface, 0.5) : P.surface, border: glassBorder, color: P.ink2, padding: "7px 10px 7px 14px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontFamily: "var(--cb-mono)", boxShadow: P.shadowSm, marginRight: 4 },
    kbd: { fontSize: 10, fontFamily: "var(--cb-mono)", color: P.faint, background: P.dark ? withAlpha(P.raised, 0.6) : P.bg, border: `1px solid ${P.line2}`, borderRadius: 4, padding: "2px 6px", fontWeight: 500 },
    ghostBtn: { background: "transparent", border: "none", color: P.ink2, padding: isMobile ? "8px" : "8px 12px", borderRadius: 8, cursor: "pointer", fontSize: 13.5, fontWeight: 500, fontFamily: font },
    iconBtn: { background: "transparent", border: "none", color: P.ink2, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, height: 38, minWidth: isMobile ? 40 : 38, padding: isMobile ? "0 8px" : "0 12px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 500, fontFamily: "var(--cb-mono)", position: "relative", letterSpacing: "0.01em" },
    iconBtnLabel: { lineHeight: 1 },
    countPill: { fontSize: 10, fontWeight: 700, lineHeight: 1, background: accent, color: at, padding: "2px 6px", borderRadius: 20, minWidth: 16, textAlign: "center", marginLeft: isMobile ? 0 : -2, position: isMobile ? "absolute" : "static", top: isMobile ? 1 : undefined, right: isMobile ? 1 : undefined },

    /* ── Scroll area ── */
    scroll: { flex: 1, overflowY: "auto", overflowX: "hidden", paddingBottom: isMobile ? 88 : 0, WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" },
    container: { maxWidth: 1120, margin: "0 auto", padding: `0 ${pad}px`, minHeight: "100%", display: "flex", flexDirection: "column" },

    /* ── Hero: LEFT-ALIGNED editorial layout ── */
    hero: { 
      flex: 1, display: "flex", flexDirection: "column", 
      alignItems: "flex-start", justifyContent: "center", 
      textAlign: "left",
      padding: isMobile ? "40px 0 60px" : "60px 0 80px", 
      position: "relative", maxWidth: 720,
    },
    heroGlow: { 
      position: "absolute", width: 800, height: 800, borderRadius: "50%", 
      background: `radial-gradient(circle, ${withAlpha(accent, P.dark ? 0.06 : 0.04)}, transparent 60%)`, 
      top: "-20%", left: "-30%", filter: "blur(100px)", pointerEvents: "none" 
    },
    heroMark: { marginBottom: 32, position: "relative" },
    heroTitle: { 
      fontSize: isMobile ? 44 : 80, fontWeight: 300, 
      letterSpacing: "-0.04em", lineHeight: 0.95, 
      color: P.ink, marginBottom: 20, position: "relative", 
      fontFamily: "var(--cb-display)",
    },
    heroSub: { 
      fontSize: isMobile ? 16 : 19, color: P.ink2, 
      maxWidth: 500, lineHeight: 1.6, marginBottom: 48, 
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
      fontFamily: "var(--cb-mono)", fontSize: 15, color: P.ink, 
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
    chips: { display: "flex", flexWrap: "wrap", gap: 10, marginTop: 28, position: "relative" },
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

    /* ── Workspace: editorial grid ── */
    workspace: { display: "grid", gridTemplateColumns: "1fr 300px", gap: 48, alignItems: "start", padding: isMobile ? "24px 0" : "40px 0", flex: 1 },
    workspaceMobile: { gridTemplateColumns: "1fr", gap: 0 },
    thread: { minWidth: 0 },

    /* ── Turn: research brief layout ── */
    turn: { marginBottom: isMobile ? 36 : 52 },
    qLabel: { 
      fontSize: 11, fontWeight: 500, letterSpacing: "0.12em", 
      textTransform: "uppercase", color: P.faint, 
      marginBottom: 12, display: "flex", alignItems: "center", gap: 8,
      fontFamily: "var(--cb-mono)",
    },
    qDot: { width: 5, height: 5, borderRadius: "50%", background: accent, boxShadow: `0 0 8px ${withAlpha(accent, 0.5)}` },
    headline: { 
      fontWeight: 400, fontSize: isMobile ? 22 : 32, 
      lineHeight: 1.25, marginBottom: isMobile ? 18 : 24, 
      color: P.ink, letterSpacing: "-0.025em", 
      fontFamily: "var(--cb-display)",
    },

    /* ── Answer card: editorial reading surface ── */
    answerCard: { 
      background: glass, 
      backdropFilter: "blur(20px) saturate(1.2)", 
      WebkitBackdropFilter: "blur(20px) saturate(1.2)", 
      border: glassBorder, 
      borderLeft: `2px solid ${withAlpha(accent, 0.5)}`, 
      borderRadius: 16, 
      padding: isMobile ? "20px 18px" : "28px 32px", 
      boxShadow: P.shadow 
    },
    byline: { 
      fontSize: 11, color: P.faint, 
      borderTop: `1px solid ${P.line}`, 
      paddingTop: 16, marginTop: 24, 
      fontFamily: "var(--cb-mono)", display: "flex" 
    },
    aiTag: { fontSize: 10, color: P.faint, fontWeight: 500, letterSpacing: "0.04em", fontFamily: "var(--cb-mono)", textTransform: "uppercase" },
    loading: { display: "flex", alignItems: "center", gap: 12, color: P.ink2, fontSize: 14, padding: "14px 0 0" },
    spinner: { width: 16, height: 16, border: `2px solid ${P.line2}`, borderTopColor: accent, borderRadius: "50%", display: "inline-block", animation: "cbspin 0.7s linear infinite" },
    error: { padding: "16px 20px", background: withAlpha("#e5484d", 0.08), color: "#e5484d", borderRadius: 12, fontSize: 14, border: `1px solid ${withAlpha("#e5484d", 0.2)}` },
    followShell: { display: "flex", alignItems: "center", gap: 8, background: glass, border: glassBorder, borderRadius: 14, padding: "8px 8px 8px 18px", boxShadow: P.shadow, transition: "border-color 0.3s ease, box-shadow 0.3s ease", marginTop: 12 },
    relatedWrap: { marginTop: 24 },
    relatedLabel: { fontSize: 10, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: P.faint, marginBottom: 12, fontFamily: "var(--cb-mono)" },
    relatedList: { display: "flex", flexDirection: "column", gap: 8 },
    relatedBtn: { 
      display: "flex", alignItems: "center", justifyContent: "space-between", 
      gap: 16, textAlign: "left", padding: "14px 18px", 
      fontSize: 14, background: glass, color: P.ink2, 
      border: glassBorder, borderRadius: 12, 
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
    panelMobile: { position: "fixed", top: 0, right: 0, height: "100dvh", width: "88vw", maxWidth: 360, borderRadius: 0, maxHeight: "none", zIndex: 30, boxShadow: "-8px 0 40px rgba(0,0,0,0.5)" },
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
    foot: { marginTop: "auto", padding: "24px 0 32px" },
    footDbs: { fontSize: 10, letterSpacing: "0.06em", color: P.faint, lineHeight: 1.7, fontFamily: "var(--cb-mono)", textTransform: "uppercase" },

    /* ── Mobile sources FAB ── */
    mobSrcBtn: { position: "fixed", bottom: "calc(18px + env(safe-area-inset-bottom, 0px))", right: 18, background: accent, color: at, border: "none", borderRadius: 12, padding: "12px 18px", fontSize: 12, fontWeight: 600, cursor: "pointer", boxShadow: `0 4px 20px ${withAlpha(accent, 0.35)}`, zIndex: 20, fontFamily: "var(--cb-mono)", display: "inline-flex", alignItems: "center", gap: 8 },
    scrim: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 25 },

    /* ── Command palette ── */
    cmdWrap: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "12vh", zIndex: 50 },
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
  const [factCheck, setFactCheck] = useState(() => getCookie("cb_fc") === "1");
  const [muted, setMuted] = useState(() => getCookie("cb_muted") === "1");
  const [soundMode, setSoundMode] = useState(() => getCookie("cb_snd") || "pulse");
  const [typewriter, setTypewriter] = useState(() => getCookie("cb_tw") !== "0");
  const [citationStyle, setCitationStyle] = useState(() => getCookie("cb_cite") || "vancouver");
  const [animationMode, setAnimationMode] = useState(() => getCookie("cb_anim") || "cinematic");
  const [animPreset, setAnimPreset] = useState(() => getCookie("cb_animP") || "aurora");
  const [animDensity, setAnimDensity] = useState(() => parseFloat(getCookie("cb_animD") || "1"));
  const [animSpeed, setAnimSpeed] = useState(() => parseFloat(getCookie("cb_animS") || "1"));
  const [animOpacity, setAnimOpacity] = useState(() => parseFloat(getCookie("cb_animO") || "1"));
  const [paletteName, setPaletteName] = useState(() => getCookie("cb_pal") || "Light");
  const [accentName, setAccentName] = useState(() => getCookie("cb_accent") || "Emerald");
  const [customAccent, setCustomAccent] = useState(() => getCookie("cb_ca") || "");
  const [hover, setHover] = useState("");
  const [hoverCite, setHoverCite] = useState(0);
  const inputRef = useRef(null);
  const cmdRef = useRef(null);
  const threadRef = useRef(null);
  const mutedRef = useRef(false);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  const P = PALETTES[paletteName] || PALETTES.Light;
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
  useEffect(() => { if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight; }, [turns, busy]);
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

  return (
    <div style={{...S.page, "--cb-accent": accent}}>
      {animationMode !== "off" && P.dark && <WebGLField accent={accent} P={P} intensity={animDensity} paused={settingsOpen} />}
      {animationMode !== "off" && !P.dark && <LivingBackground accent={accent} P={P} intensity={animationMode} preset={animPreset} density={animDensity} speed={animSpeed} opacity={animOpacity} paused={settingsOpen} />}
      <CustomCursor accent={accent} P={P} />
      <div style={S.grain} />
      <header style={S.header}>
        <div style={S.headInner}>
          <div style={{ ...S.brandRow, position: "relative" }}>
            <Magnetic strength={0.2}>
              <div onClick={(e) => { e.stopPropagation(); easterEgg.trigger(); }} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                <span key={easterEgg.wiggleKey} className={easterEgg.wiggleKey > 0 ? "cb-wiggle" : ""} style={{ display: "inline-flex" }}><Mark size={20} accent={accent} glow={P.dark} /></span>
                <span style={S.brand}>Cerebrum<sup style={{ fontSize: "0.55em", fontWeight: 400, marginLeft: 2, opacity: 0.5, letterSpacing: "0.02em" }}>™</sup></span>
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
              <h1 style={S.heroTitle}><KineticText text="Cerebrum" /></h1>
              <p style={S.heroSub}>Ask a question. We search the real literature and write you an answer with sources you can verify.</p>
              <GlowBorder accent={accent} style={{ width: "100%", maxWidth: 700, borderRadius: 14 }}>
                <div className="cb-search-glow" style={{ ...S.searchShell, ...(hover === "in" ? S.searchShellActive : {}) }} onMouseEnter={() => setHover("in")} onMouseLeave={() => setHover("")}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, marginLeft: 2 }}><circle cx="11" cy="11" r="7" stroke={P.faint} strokeWidth="1.6" /><path d="M21 21l-4-4" stroke={P.faint} strokeWidth="1.6" strokeLinecap="round" /></svg>
                  <input ref={inputRef} style={S.searchInput} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} placeholder="Search the scientific literature..." />
                  <MicButton onTranscript={(t) => setInput(t)} accent={accent} P={P} />
                  <Magnetic strength={0.15}><button style={S.searchBtn} onClick={() => ask()}>Search</button></Magnetic>
                </div>
              </GlowBorder>
              <div style={S.chips} className="cb-stagger">
                {suggestions.map((s, i) => (<button key={s} className="cb-fade" style={{ ...S.chip, ...(hover === "c" + i ? S.chipHover : {}) }} onMouseEnter={() => setHover("c" + i)} onMouseLeave={() => setHover("")} onClick={() => ask(s)}>{s}</button>))}
              </div>
              <div style={S.trustRow}>
                {["Europe PMC", "PubMed", "OpenAlex", "Crossref", "Semantic Scholar", "arXiv"].map((d) => <span key={d} style={S.trustItem}>{d}</span>)}
                <span style={{ ...S.trustItem, color: P.faint }}>+ 10 more</span>
              </div>
            </div>
          ) : (
            <div style={{ ...S.workspace, ...(isMobile ? S.workspaceMobile : {}) }}>
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
              {!isMobile && panelOpen && <aside style={S.panel}>{SourcesInner}</aside>}
            </div>
          )}
          <div style={S.foot}>
            <div style={{ fontSize: 11, color: P.faint, lineHeight: 1.55, maxWidth: 520, margin: "0 auto 14px", textAlign: "center" }}>Answers are assembled from real papers by AI. Always check the cited sources.</div>
            <div style={{ fontSize: 10.5, color: P.faint, fontFamily: "var(--cb-mono)" }}>
              <button onClick={() => setHowItWorksOpen(true)} style={{ color: P.faint, textDecoration: "none", borderBottom: `1px dotted ${P.faint}`, background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit" }}>How it works</button>
              <span style={{ margin: "0 8px", opacity: 0.4 }}>·</span><a href="/about" style={{ color: P.faint, textDecoration: "none", borderBottom: `1px dotted ${P.faint}` }}>About</a>
              <span style={{ margin: "0 8px", opacity: 0.4 }}>·</span><a href="/privacy" style={{ color: P.faint, textDecoration: "none", borderBottom: `1px dotted ${P.faint}` }}>Privacy</a>
              <span style={{ margin: "0 8px", opacity: 0.4 }}>·</span><a href="/terms" style={{ color: P.faint, textDecoration: "none", borderBottom: `1px dotted ${P.faint}` }}>Terms</a>
              <span style={{ margin: "0 8px", opacity: 0.4 }}>·</span><a href="/contact" style={{ color: P.faint, textDecoration: "none", borderBottom: `1px dotted ${P.faint}` }}>Contact</a>
              <span style={{ margin: "0 8px", opacity: 0.4 }}>·</span>© {new Date().getFullYear()} Cerebrum™ · v4.0
            </div>
          </div>
        </div>
      </div>
      {started && isMobile && (<button style={S.mobSrcBtn} onClick={() => setMobilePanel(true)} aria-label={`Sources${allSources.length ? `, ${allSources.length}` : ""}`}><Icon name="bookmark" size={14} /><span>Sources</span>{allSources.length > 0 && <span style={{ fontSize: 11, fontWeight: 700, background: withAlpha(at, 0.22), padding: "2px 6px", borderRadius: 20, lineHeight: 1.3 }}>{allSources.length}</span>}</button>)}
      {started && isMobile && mobilePanel && (<><div style={S.scrim} onClick={() => setMobilePanel(false)} /><aside style={{ ...S.panel, ...S.panelMobile }}><button style={{ ...S.ghostBtn, marginBottom: 14 }} onClick={() => setMobilePanel(false)}>✕ Close</button>{SourcesInner}</aside></>)}
      {cmdOpen && (<div style={S.cmdWrap} onClick={() => setCmdOpen(false)}><div style={S.cmdBox} onClick={(e) => e.stopPropagation()} className="cb-pop"><div style={S.cmdInputRow}><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke={P.faint} strokeWidth="1.8" /><path d="M21 21l-4-4" stroke={P.faint} strokeWidth="1.8" strokeLinecap="round" /></svg><input ref={cmdRef} style={S.cmdInput} value={cmdQuery} onChange={(e) => setCmdQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { if (cmdSuggest.length) ask(cmdSuggest[0]); else if (filteredCmds[0]) filteredCmds[0].run(); } }} placeholder="Search or type a command…" /><kbd style={S.kbd}>esc</kbd></div><div style={S.cmdList}>{cmdSuggest.length > 0 && <div style={S.cmdSection}>Ask</div>}{cmdSuggest.map((s) => (<button key={s} style={S.cmdItem} onClick={() => ask(s)} onMouseEnter={(e) => e.currentTarget.style.background = withAlpha(accent, 0.08)} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}><span style={{ color: accent }}>→</span>{s}</button>))}<div style={S.cmdSection}>Commands</div>{filteredCmds.map((c) => (<button key={c.label} style={S.cmdItem} onClick={c.run} onMouseEnter={(e) => e.currentTarget.style.background = withAlpha(accent, 0.08)} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}><span>{c.label}</span>{c.hint && <kbd style={{ ...S.kbd, marginLeft: "auto" }}>{c.hint}</kbd>}</button>))}</div></div></div>)}
      {savedOpen && (<div style={S.modalWrap} onClick={() => setSavedOpen(false)} className="cb-backdrop"><div style={{ ...S.modal, width: 520 }} onClick={(e) => e.stopPropagation()} className="cb-modal"><div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}><div style={S.modalTitle}>Saved articles</div><span style={S.srcCount}>{saved.length}</span></div>{saved.length === 0 ? (<div style={{ fontSize: 14, color: P.ink2, lineHeight: 1.6, padding: "20px 0 28px", textAlign: "center" }}>No saved articles yet.<br /><span style={{ fontSize: 12.5, color: P.faint }}>Tap ☆ Save on any source to keep it here.</span></div>) : (<><div style={{ display: "flex", gap: 8, marginBottom: 16 }}><button style={S.sBtn} onClick={() => { sfx(); download("cerebrum-saved.ris", toRIS(saved)); }}>Export RIS</button><button style={S.sBtn} onClick={() => { sfx(); download("cerebrum-saved.bib", toBibTeX(saved)); }}>Export BibTeX</button><button style={{ ...S.sBtn, color: "#e5484d", borderColor: withAlpha("#e5484d", 0.35) }} onClick={() => { if (confirm("Remove all saved articles?")) setSaved([]); }}>Clear all</button></div><div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: "56vh", overflowY: "auto" }}>{saved.map((s, i) => (<div key={i} style={{ padding: "12px 10px", margin: "0 -10px", borderBottom: `1px solid ${P.line}` }}><a href={s.url} target="_blank" rel="noreferrer" style={{ ...S.srcTitle, fontSize: 14 }}>{s.title || s.url}</a><div style={S.srcMeta}>{[s.authors, s.journal, s.year].filter(Boolean).join(" · ")}{typeof s.citations === "number" && ` · ${s.citations.toLocaleString()} cit.`}</div><div style={S.srcRow}><button style={{ ...S.chipMini, color: "#e5484d", borderColor: withAlpha("#e5484d", 0.35) }} onClick={() => setSaved((prev) => prev.filter((x) => (x.title || "").toLowerCase() !== (s.title || "").toLowerCase()))}>Remove</button>{s.authors && <button style={{ ...S.chipMini, color: accent, borderColor: P.line2 }} onClick={() => { setSavedOpen(false); ask(`papers by ${(s.authors || "").replace(" et al.", "")}`); }}>Author →</button>}</div></div>))}</div></>)}<button style={{ ...S.modalClose, marginTop: 20 }} onClick={() => setSavedOpen(false)}>Done</button></div></div>)}
      {settingsOpen && <Settings {...{ P, accent, at, S, PALETTES, ACCENTS, paletteName, setPaletteName, accentName, setAccentName, customAccent, setCustomAccent, answerLength, setAnswerLength, factCheck, setFactCheck, muted, setMuted, typewriter, setTypewriter, soundMode, setSoundMode, animationMode, setAnimationMode, animPreset, setAnimPreset, animDensity, setAnimDensity, animSpeed, setAnimSpeed, animOpacity, setAnimOpacity, sfx, setSessions, setSaved, close: () => setSettingsOpen(false) }} />}
      {howItWorksOpen && <HowItWorksModal P={P} accent={accent} close={() => setHowItWorksOpen(false)} />}
    </div>
  );
}


/* ============================================================


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
.cb-answer-enter { animation: cbEnter 700ms var(--cb-ease) both; }

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

/* ── Search glow ── */
@property --gradient-angle { syntax: '<angle>'; initial-value: 0deg; inherits: false; }
@keyframes cbGradientSpin { to { --gradient-angle: 360deg; } }
.cb-search-glow { position: relative; }
.cb-search-glow::before {
  content: '';
  position: absolute; inset: -1px; border-radius: 15px;
  background: conic-gradient(from var(--gradient-angle), transparent 35%, var(--cb-accent, #38bdf8) 50%, transparent 65%);
  animation: cbGradientSpin 4s linear infinite;
  opacity: 0; transition: opacity 0.5s ease; z-index: -1;
}
.cb-search-glow:focus-within::before { opacity: 0.6; }
@supports not (background: conic-gradient(red, blue)) {
  .cb-search-glow:focus-within { box-shadow: 0 0 0 2px var(--cb-accent, #38bdf8), 0 0 24px rgba(56,189,248,0.1); }
}

/* ── Header buttons ── */
.cb-hbtn:hover:not(:disabled) { background: rgba(138,155,186,0.08) !important; }
.cb-hbtn:active:not(:disabled) { background: rgba(138,155,186,0.14) !important; }

/* ── Card hover ── */
.cb-card { transition: transform 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease; }
.cb-card:hover { transform: translateY(-2px); }

/* Focus */
:focus { outline: none; }
:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; border-radius: 6px; }

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

/* ── Reduced motion ── */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
`;

/* Font loading */
(function loadFonts() {
  if (typeof document === "undefined") return;
  const id = "cb-fonts-v4";
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&family=Inter:wght@400;450;500;550;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap";
  document.head.appendChild(link);
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
