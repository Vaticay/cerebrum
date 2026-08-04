import React, { useState, useRef, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";

function setCookie(k, v) { try { document.cookie = `${k}=${encodeURIComponent(v)}; path=/; max-age=31536000; SameSite=Lax`; } catch {} }
function getCookie(k) { try { const m = document.cookie.match(new RegExp("(?:^|; )" + k + "=([^;]*)")); return m ? decodeURIComponent(m[1]) : null; } catch { return null; } }

// Platform-aware modifier label: ⌘ on Mac, Ctrl elsewhere.
const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");
const MOD = IS_MAC ? "⌘" : "Ctrl";
const kbdLabel = (key) => `${MOD}${IS_MAC ? "" : "+"}${key}`;

const LOADING_MESSAGES = [
  // Pop culture
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
  // Signed
  "Dusty waz h3re",
  "Vaticay was here",
  // Academic suffering
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
  // Absurd
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

const PALETTES = {
  Light: { dark: false, bg: "#f6f5f2", surface: "#ffffff", raised: "#ffffff", ink: "#1a1c1e", ink2: "#565a5f", faint: "#9a9ea3", line: "#eceae5", line2: "#dfdcd5", shadow: "0 1px 2px rgba(20,22,25,.04), 0 8px 24px rgba(20,22,25,.06)", shadowSm: "0 1px 2px rgba(20,22,25,.05), 0 2px 8px rgba(20,22,25,.04)", grain: 0.015, skel: "linear-gradient(90deg, #eceae5 25%, #f3f1ec 50%, #eceae5 75%)" },
  Dark:  { dark: true, bg: "#0c0e10", surface: "#141719", raised: "#1a1e21", ink: "#eef1f3", ink2: "#a3abb2", faint: "#606970", line: "#20252a", line2: "#2b3237", shadow: "0 1px 2px rgba(0,0,0,.3), 0 12px 40px rgba(0,0,0,.4)", shadowSm: "0 1px 3px rgba(0,0,0,.3)", grain: 0.02, skel: "linear-gradient(90deg, #1a1e21 25%, #232a2f 50%, #1a1e21 75%)" },
  Mid:   { dark: true, bg: "#16130f", surface: "#1e1a15", raised: "#252019", ink: "#f0ebe3", ink2: "#b0a695", faint: "#6e6455", line: "#282219", line2: "#352e22", shadow: "0 1px 2px rgba(0,0,0,.3), 0 12px 40px rgba(0,0,0,.45)", shadowSm: "0 1px 3px rgba(0,0,0,.3)", grain: 0.022, skel: "linear-gradient(90deg, #252019 25%, #2f2820 50%, #252019 75%)" },
};
const ACCENTS = { Emerald: "#047857", Indigo: "#4338ca", Sky: "#0369a1", Amber: "#b45309", Rose: "#be123c", Violet: "#6d28d9", Teal: "#0f766e" };

// Pick readable text color for a given background. Uses a stricter luminance
// threshold than the naive "> 128" split so mid-luminance colors like amber
// (#d97706) get dark text rather than white — which fails WCAG AA at ~3:1.
// Threshold 175 pushes the crossover into a range where white-on-color
// reliably clears 4.5:1 for standard body text.
function accentText(hex) {
  if (!hex || hex[0] !== "#" || hex.length < 7) return "#111";
  const r = parseInt(hex.slice(1, 3), 16),
        g = parseInt(hex.slice(3, 5), 16),
        b = parseInt(hex.slice(5, 7), 16);
  // Relative luminance approximation per WCAG (sRGB linearization skipped for
  // speed; the 175 threshold accounts for it in practice).
  const L = (0.299 * r + 0.587 * g + 0.114 * b);
  return L > 175 ? "#111" : "#fff";
}
function withAlpha(hex, a) { const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16); return `rgba(${r},${g},${b},${a})`; }

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

// Citation formatters for the Bibliography section. Each takes a source object
// { title, authors, journal, year, url, citations } and returns a formatted string.
function formatCitation(source, style, index) {
  const s = source || {};
  const authors = s.authors || "";
  const title = s.title || "Untitled";
  const journal = s.journal || "";
  const year = s.year || "n.d.";
  const url = s.url || "";
  switch (style) {
    case "vancouver": {
      // Vancouver: 1. Author AA, Author BB. Title. Journal. Year;Vol(Issue):pages.
      const parts = [`${index}. ${authors ? authors + ". " : ""}${title}.`];
      if (journal) parts.push(` ${journal}.`);
      parts.push(` ${year}.`);
      return parts.join("");
    }
    case "apa": {
      // APA: Author, A. A. (Year). Title. Journal.
      return `${authors ? authors + ". " : ""}(${year}). ${title}. ${journal ? "*" + journal + "*." : ""}`.trim();
    }
    case "mla": {
      // MLA: Author. "Title." Journal, Year, URL.
      return `${authors ? authors + ". " : ""}"${title}." *${journal || "n.p."}*, ${year}${url ? ", " + url : ""}.`;
    }
    case "chicago": {
      // Chicago author-date: Author. Year. "Title." Journal.
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

// Format a full bibliography as plain text (for copy-to-clipboard)
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
  // mode: 'pulse' | 'shimmer' | 'warm' | 'minimal'
  function startAmbient(mode = "pulse") {
    const c = ac(); if (!c || ambient) return;
    if (mode === "minimal") { tone(523.25, 0.5, 0.05); return; } // one soft "thinking" tone, no loop
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
    } else { // pulse (default): low tone that breathes
      const o = c.createOscillator(), o2 = c.createOscillator();
      o.type = "sine"; o.frequency.value = 110; o2.type = "sine"; o2.frequency.value = 164.81;
      o.connect(g); o2.connect(g); o.start(); o2.start(); oscs.push(o, o2);
      // breathing via periodic gain ramps
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
  // Preview a mode briefly (for settings)
  function preview(mode) { startAmbient(mode); setTimeout(stopAmbient, 1400); }
  return { click, pop, startAmbient, stopAmbient, preview };
})();

// Minimal stroke-icon set. Replaces the emoji that were being used for header
// actions (🔇 ⚙ ★) — emoji render differently on every OS, break visual weight,
// and read as unfinished. These are 24x24, 1.7 stroke, matched to the wordmark.
function Icon({ name, size = 17, className, style }) {
  const common = {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round",
    strokeLinejoin: "round", className, style,
    "aria-hidden": true, focusable: false,
  };
  switch (name) {
    case "plus":
      return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
    case "bookmark":
      return <svg {...common}><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" /></svg>;
    case "bookmarkFilled":
      return <svg {...common} fill="currentColor" stroke="none"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" /></svg>;
    case "settings":
      return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>;
    case "volumeOn":
      return <svg {...common}><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13" /></svg>;
    case "volumeOff":
      return <svg {...common}><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M22 9l-6 6M16 9l6 6" /></svg>;
    case "search":
      return <svg {...common}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.2-4.2" /></svg>;
    case "close":
      return <svg {...common}><path d="M18 6L6 18M6 6l12 12" /></svg>;
    case "arrowRight":
      return <svg {...common}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
    case "mic":
      return <svg {...common}><path d="M12 15a3 3 0 003-3V6a3 3 0 00-6 0v6a3 3 0 003 3z" /><path d="M5 12a7 7 0 0014 0M12 19v3" /></svg>;
    case "check":
      return <svg {...common}><path d="M20 6L9 17l-5-5" /></svg>;
    case "external":
      return <svg {...common}><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><path d="M15 3h6v6M10 14L21 3" /></svg>;
    default:
      return null;
  }
}

function Mark({ size = 26, accent, glow }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ filter: glow ? `drop-shadow(0 0 10px ${withAlpha(accent, 0.45)})` : "none" }}>
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1 0-4.12A2.5 2.5 0 0 1 7.5 11a2.5 2.5 0 0 1 0-4.12A2.5 2.5 0 0 1 9.5 2Z" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 0-4.12A2.5 2.5 0 0 0 16.5 11a2.5 2.5 0 0 0 0-4.12A2.5 2.5 0 0 0 14.5 2Z" />
    </svg>
  );
}

// Typewriter reveal for answer text
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
  // The model sometimes writes citations as Markdown links: `[1](https://...)`
  // instead of bare `[1]`. Normalize them so the citation matcher below catches
  // the number. Also strip any full URLs the model appended to reference lines.
  let clean = (text || "")
    .replace(/^#{1,6}\s*/gm, "")
    // [1](url) → [1]
    .replace(/\[(\d+)\]\((?:https?:\/\/|#)[^\s)]+\)/g, "[$1]")
    // Kill "References:" / "Sources:" section headers when the model injects
    // them at the bottom — we render the real bibliography separately.
    .replace(/\n[-—]{2,}\s*\n/g, "\n\n")
    .replace(/\n\s*(references|sources|bibliography|citations|works cited)\s*:?\s*\n[\s\S]*$/i, "")
    .trim();
  return clean.split(/\n{2,}/).map((para, pi) => (
    <p key={pi} style={{ fontSize: "clamp(15px, 4vw, 16px)", lineHeight: 1.62, margin: "0 0 14px", color: P.ink, letterSpacing: "-0.006em" }}>
      {para.split("\n").map((line, li) => (
        <React.Fragment key={li}>
          {line.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*|\[\d+\])/g).map((seg, si) => {
            const b = seg.match(/^\*\*([^*]+)\*\*$/);
            if (b) return <strong key={si} style={{ color: P.ink, fontWeight: 650 }}>{b[1]}</strong>;
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
                style={{ fontSize: 10.5, verticalAlign: "super", color: accent, textDecoration: "none", fontWeight: 700, padding: "1px 4px", borderRadius: 5, background: hoverCite === n ? withAlpha(accent, 0.16) : withAlpha(accent, 0.09), transition: "background 0.15s cubic-bezier(0.16, 1, 0.3, 1)", cursor: "pointer" }}>{n}</a>;
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

function FactCheck({ fc, P, accent }) {
  const colors = { supported: "#10b981", partly: "#d9a520", unsupported: "#e5484d", thin: "#d9a520" };
  const label = { supported: "Supported by sources", partly: "Partly supported", unsupported: "Not supported by sources" };
  const oc = colors[fc.overall] || P.ink2;
  const claims = fc.claims || [];
  const nSup = claims.filter((c) => c.status === "supported").length;
  const nThin = claims.filter((c) => c.status === "thin").length;
  const nUns = claims.filter((c) => c.status === "unsupported").length;
  const total = claims.length;
  // Honest score: supported = full weight, thin = half, unsupported = zero.
  const score = total ? Math.round(((nSup + nThin * 0.5) / total) * 100) : null;
  const scoreColor = score === null ? P.ink2 : score >= 75 ? "#10b981" : score >= 45 ? "#d9a520" : "#e5484d";
  return (
    <div style={{ marginTop: 16, border: `1px solid ${P.line}`, borderRadius: 12, background: P.surface, padding: "16px 18px", boxShadow: P.shadowSm }} className="cb-rise">
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
        <span style={{ width: 18, height: 18, borderRadius: "50%", background: withAlpha(oc, 0.15), display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: oc }} /></span>
        <span style={{ fontSize: 12.5, fontWeight: 650, letterSpacing: "-0.01em", color: oc }}>{label[fc.overall] || fc.overall}</span>
        <span style={{ fontSize: 11, color: P.faint, marginLeft: "auto" }}>checked vs. cited abstracts</span>
      </div>

      {score !== null && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 26, fontWeight: 750, color: scoreColor, letterSpacing: "-0.02em" }}>{score}<span style={{ fontSize: 15, fontWeight: 600 }}>%</span></span>
            <span style={{ fontSize: 12.5, color: P.ink2, fontWeight: 550 }}>source support</span>
            <span style={{ fontSize: 11, color: P.faint, marginLeft: "auto" }}>{nSup} solid · {nThin} thin · {nUns} unsupported</span>
          </div>
          <div style={{ display: "flex", height: 7, borderRadius: 4, overflow: "hidden", background: P.line, gap: 1.5 }}>
            {nSup > 0 && <div style={{ flex: nSup, background: "#10b981" }} title={`${nSup} supported`} />}
            {nThin > 0 && <div style={{ flex: nThin, background: "#d9a520" }} title={`${nThin} thin`} />}
            {nUns > 0 && <div style={{ flex: nUns, background: "#e5484d" }} title={`${nUns} unsupported`} />}
          </div>
          <div style={{ fontSize: 10.5, color: P.faint, marginTop: 6, lineHeight: 1.4 }}>How well the cited abstracts back the answer's claims, not a measure of scientific truth.</div>
        </div>
      )}

      {fc.summary && <div style={{ fontSize: 13.5, color: P.ink2, marginBottom: claims.length ? 12 : 0, lineHeight: 1.55, paddingTop: score !== null ? 12 : 0, borderTop: score !== null ? `1px solid ${P.line}` : "none" }}>{fc.summary}</div>}
      {claims.map((c, i) => {
        const cc = colors[c.status] || P.ink2; const sym = c.status === "supported" ? "✓" : c.status === "thin" ? "~" : "✕";
        return (
          <div key={i} style={{ display: "flex", gap: 10, padding: "9px 0", borderTop: i ? `1px solid ${P.line}` : "none" }}>
            <span style={{ color: cc, fontSize: 12, flexShrink: 0, fontWeight: 700, width: 16, height: 16, borderRadius: 5, background: withAlpha(cc, 0.13), display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>{sym}</span>
            <div><div style={{ fontSize: 13.5, color: P.ink, lineHeight: 1.45 }}>{c.claim}</div>{c.note && <div style={{ fontSize: 12, color: P.faint, marginTop: 3, lineHeight: 1.45 }}>{c.note}</div>}</div>
          </div>
        );
      })}
    </div>
  );
}

function Skeleton({ P }) {
  const bar = (w) => <div style={{ height: 13, width: w, borderRadius: 6, background: P.skel, backgroundSize: "200% 100%", animation: "cbShimmer 1.3s infinite" }} />;
  return (
    <div style={{ background: P.surface, border: `1px solid ${P.line}`, borderRadius: 16, padding: "22px 26px", boxShadow: P.shadow, display: "flex", flexDirection: "column", gap: 11 }}>
      {bar("92%")}{bar("98%")}{bar("85%")}<div style={{ height: 6 }} />{bar("95%")}{bar("70%")}
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
  // What's actually happening, in order. Showing real stages makes a slow
  // search feel intentional rather than broken, and it's honest — these are
  // the genuine phases the backend moves through.
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
        // Avoid repeating the same line twice in a row
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
    <div style={{ padding: "18px 0 4px" }}>
      {/* Synapse loader: three nodes firing in sequence along a connecting
          line, matching the brain mark. Reads as signal transmission rather
          than a generic spinner. */}
      <div style={{ display: "flex", alignItems: "center", gap: 13, marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }} aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span key={i} style={{
              width: 7, height: 7, borderRadius: "50%",
              background: accent,
              animation: `cbSynapse 1.25s ${i * 0.18}s cubic-bezier(0.4, 0, 0.6, 1) infinite`,
            }} />
          ))}
        </div>
        <span key={msg} className="cb-fade" style={{ fontSize: 14.5, color: P.ink, letterSpacing: "-0.01em", fontWeight: 450 }}>
          {msg}
        </span>
      </div>

      {/* Honest stage indicator */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 1 }}>
        <div style={{ display: "flex", gap: 3 }} aria-hidden="true">
          {STAGES.map((_, i) => (
            <span key={i} style={{
              width: i === stage ? 16 : 5, height: 3, borderRadius: 2,
              background: i <= stage ? accent : P.line2,
              opacity: i <= stage ? 1 : 0.6,
              transition: "width 320ms cubic-bezier(0.16,1,0.3,1), background 320ms cubic-bezier(0.16,1,0.3,1)",
            }} />
          ))}
        </div>
        <span key={stage} className="cb-fade" style={{ fontSize: 11.5, color: P.faint, letterSpacing: "0.01em" }}>
          {STAGES[stage]}
        </span>
      </div>
    </div>
  );
}

// ============ CINEMATIC BRAIN INTRO ============
// Multi-phase sequence: neurons scatter in → electrical pulses fire along
// forming pathways → connections build the brain silhouette → text emerges → dissolves.
function Intro({ accent, P, onEnter, animationMode = "cinematic" }) {
  const canvasRef = useRef(null);
  const [phase, setPhase] = useState("idle"); // idle -> forming -> done
  const [textReveal, setTextReveal] = useState(false);
  const rafRef = useRef(0);
  const startRef = useRef(0);
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Mobile-safe sizing: cap total pixels and debounce, so the keyboard or the
    // URL bar collapsing doesn't thrash canvas allocation. See the matching
    // comment in LivingBackground for why this matters (iOS reload bug).
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

    // Distribute neurons in an ELLIPTICAL RING around the text zone. This means
    // the animation never draws through the title/subtitle/button area. Denser
    // toward the outside, sparser near the center (which stays clear for text).
    const N = 110;
    const neurons = [];
    for (let i = 0; i < N; i++) {
      // Golden-angle distribution around the ring, offset outward
      const t = i / N;
      const angle = t * Math.PI * 2 + Math.random() * 0.4;
      // Radius is between innerR and outerR (measured in canvas fractions)
      const innerR = 0.42; // Text sits in a rectangle inside this radius
      const outerR = 0.85;
      const rr = innerR + Math.random() * (outerR - innerR);
      // Elliptical squash so wider screens don't leave a giant top/bottom gap
      const bx = Math.cos(angle) * rr * 1.15;
      const by = Math.sin(angle) * rr * 0.75;
      neurons.push({
        tx: bx,
        ty: by,
        // start random far off-screen
        sx: (Math.random() - 0.5) * 3.4,
        sy: (Math.random() - 0.5) * 3.4,
        r: 1.2 + Math.random() * 1.6,
        delay: Math.random() * 0.55,
        pulse: Math.random() * Math.PI * 2,
        pulseSpeed: 1.5 + Math.random() * 1.5,
        // Persistent orbital angle for gentle drift
        orbitPhase: Math.random() * Math.PI * 2,
        // Fake depth: 0 = far/small/dim, 1 = near/big/bright
        depth: 0.3 + Math.random() * 0.7,
      });
    }
    // Synaptic connections: nearest neighbors
    const synapses = [];
    for (let i = 0; i < N; i++) {
      const near = [];
      for (let j = 0; j < N; j++) {
        if (i === j) continue;
        const d = Math.hypot(neurons[i].tx - neurons[j].tx, neurons[i].ty - neurons[j].ty);
        near.push([j, d]);
      }
      near.sort((a, b) => a[1] - b[1]);
      // 2-3 nearest per neuron
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
      // Idle: gentle drift. Forming: rapid assembly + firing pulses.
      const prog = forming ? Math.min(1, elapsed / 1.6) : Math.min(1, elapsed / 2.5);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const cx = canvas.width / 2, cy = canvas.height / 2;
      // Scale to canvas: bigger ring so it feels expansive
      const scale = Math.min(canvas.width, canvas.height) * 0.48;
      const spin = forming ? elapsed * 0.5 : elapsed * 0.06;

      // Compute positions, adding a persistent orbital wobble to each neuron
      const pos = neurons.map((n, i) => {
        const t = ease(Math.max(0, Math.min(1, (prog - n.delay) / (1 - n.delay))));
        // Gentle orbital drift once formed (each neuron circles slowly around its target)
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

      // ============ RADIAL MASK ============
      // Compute a fade factor per neuron so anything drawn near the text zone
      // is transparent. Text sits roughly in a horizontal band ~340px wide, ~280px
      // tall centered on the canvas. We fade neurons that fall inside that ellipse.
      const isMobile = canvas.width < 700 * dpr;
      // Sized to the actual content block (max 400px wide, ~340px tall).
      // An oversized mask erases most of the animation and leaves the page
      // looking blank; too small and neurons draw through the wordmark.
      const maskRx = (isMobile ? 165 : 235) * dpr;
      const maskRy = (isMobile ? 205 : 215) * dpr;
      const maskFade = (px, py) => {
        const dx = (px - cx) / maskRx;
        const dy = (py - cy) / maskRy;
        const r = Math.sqrt(dx * dx + dy * dy);
        // Fully invisible inside r<0.9, fades in from 0.9 to 1.5
        if (r >= 1.5) return 1;
        if (r < 0.9) return 0;
        return (r - 0.9) / 0.6;
      };

      // Synapses (edges) with electrical pulses traveling along them
      for (const s of synapses) {
        const a = pos[s.a], b = pos[s.b];
        const alpha = Math.min(a.t, b.t);
        if (alpha <= 0.02) continue;
        // Fade based on midpoint distance from center — keeps text zone clear
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const maskA = maskFade(mx, my);
        if (maskA <= 0.02) continue;
        const finalA = alpha * maskA;
        // base line
        ctx.strokeStyle = `rgba(${ar},${ag},${ab},${0.18 * finalA})`;
        ctx.lineWidth = 0.9 * dpr;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        // electrical pulse
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

      // Neurons with pulsing glow (depth-scaled for a fake 3D feel)
      for (let i = 0; i < pos.length; i++) {
        const p = pos[i]; if (p.t <= 0.02) continue;
        const nMask = maskFade(p.x, p.y);
        if (nMask <= 0.02) continue;
        const n = neurons[i];
        // Depth modulates size (near neurons look bigger) and brightness.
        // A very slow breathing pulse keeps things alive between beats.
        const breath = 1 + 0.06 * Math.sin(elapsed * 0.9 + n.pulse * 0.4);
        const pulse = 0.65 + 0.35 * Math.sin(elapsed * n.pulseSpeed + n.pulse);
        const depthSize = 0.55 + 0.45 * n.depth; // 0.55–1.0
        const depthBright = 0.4 + 0.6 * n.depth; // 0.4–1.0
        const rBase = n.r * dpr * depthSize * breath;
        const finalA = p.t * pulse * nMask * depthBright;
        // outer glow — larger radius for deeper visual weight
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rBase * 6);
        glow.addColorStop(0, `rgba(${ar},${ag},${ab},${0.55 * finalA})`);
        glow.addColorStop(0.4, `rgba(${ar},${ag},${ab},${0.2 * finalA})`);
        glow.addColorStop(1, `rgba(${ar},${ag},${ab},0)`);
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(p.x, p.y, rBase * 6, 0, Math.PI * 2); ctx.fill();
        // core
        ctx.fillStyle = `rgba(${ar},${ag},${ab},${finalA})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, rBase, 0, Math.PI * 2); ctx.fill();
      }

      // Text reveal + smooth handoff. No harsh color flash — just a graceful
      // fade of the neurons and let the container's CSS transition carry the
      // rest. Feels like the network dissolves, not like a camera bulb.
      if (forming) {
        if (elapsed >= 1.2 && !textReveal) setTextReveal(true);
        if (elapsed >= 2.2) {
          const f = Math.min(1, (elapsed - 2.2) / 0.7);
          // Fade the whole canvas out smoothly. The container itself keeps its
          // radial background, so there's never a hard color pop.
          canvas.style.opacity = String(1 - f);
          if (f >= 1) {
            cancelAnimationFrame(rafRef.current);
            // Small delay so the text fully fades in before the app mounts.
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

  const bg = P.dark
    ? `radial-gradient(circle at 50% 45%, ${withAlpha(accent, 0.10)}, ${P.bg} 65%)`
    : `radial-gradient(circle at 50% 45%, ${withAlpha(accent, 0.06)}, ${P.bg} 65%)`;

  return (
    <div style={{
      minHeight: "100dvh",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      background: bg,
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      position: "relative", overflow: "hidden",
      padding: "clamp(24px, 6vw, 48px) 22px",
      textAlign: "center",
    }}>
      <canvas ref={canvasRef} style={{
        position: "absolute", inset: 0, width: "100%", height: "100%",
        opacity: animationMode === "off" ? 0 : animationMode === "subtle" ? 0.4 : 0.85,
        transition: "opacity 0.7s cubic-bezier(0.4, 0, 0.2, 1)",
      }} />

      <div style={{
        position: "relative", zIndex: 1,
        maxWidth: 400, width: "100%",
        display: "flex", flexDirection: "column", alignItems: "center",
        transition: "opacity 0.9s cubic-bezier(0.4, 0, 0.2, 1), transform 0.9s cubic-bezier(0.4, 0, 0.2, 1)",
        opacity: phase === "forming" ? 0 : 1,
        transform: phase === "forming" ? "translateY(-6px)" : "none",
      }}>
        <div style={{ animation: "cb-float 5s ease-in-out infinite", marginBottom: "clamp(20px, 5vw, 28px)" }}>
          <Mark size={46} accent={accent} glow={P.dark} />
        </div>

        <h1 style={{
          fontSize: "clamp(40px, 12vw, 54px)",
          fontWeight: 700, letterSpacing: "-0.045em",
          color: P.ink, margin: "0 0 14px", lineHeight: 0.98,
        }}>
          Cerebrum
        </h1>

        <p style={{
          fontSize: "clamp(15px, 4.2vw, 17px)",
          color: P.ink2, margin: "0 0 clamp(28px, 7vw, 38px)",
          letterSpacing: "-0.012em", lineHeight: 1.5,
          maxWidth: 330,
        }}>
          Research questions in. Cited answers out.
        </p>

        <button onClick={go} className="cb-btn" style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 9,
          padding: "15px 34px", fontSize: 15.5, fontWeight: 600,
          background: accent, color: accentText(accent),
          border: "none", borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
          boxShadow: `0 8px 28px ${withAlpha(accent, 0.32)}`,
          letterSpacing: "-0.015em",
        }}>
          Begin
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h13M12 5.5l6.5 6.5-6.5 6.5" />
          </svg>
        </button>

        {/* One quiet line of provenance. Detail lives in How it works, not here. */}
        <div style={{
          marginTop: "clamp(26px, 6vw, 34px)",
          display: "flex", alignItems: "center", gap: 9,
          fontSize: 11.5, color: P.faint, letterSpacing: "0.005em",
        }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: accent, opacity: 0.8, flexShrink: 0 }} />
          <span>16 open indexes</span>
          <span style={{ opacity: 0.35 }}>/</span>
          <span>no account</span>
          <span style={{ opacity: 0.35 }}>/</span>
          <span>no ads</span>
        </div>
      </div>
    </div>
  );
}

// ============ LIVING MOLECULAR BACKGROUND ============
// Ambient always-on canvas: drifting particles with elastic connections,
// gentle currents, subtle firing pulses. Sits behind ALL app content at low opacity.
function LivingBackground({ accent, P, intensity = "cinematic", preset = "particles", density = 1, speed = 1, opacity = 1, paused = false }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(0);
  const stateRef = useRef({ items: [], t: 0 });
  const mouseRef = useRef({ x: -9999, y: -9999 });
  // These change frequently (slider drags) but shouldn't trigger effect re-runs.
  // Read them from refs inside the animation loop instead.
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
          items.push({
            x: Math.random() * cw, y: Math.random() * ch,
            vx: (Math.random() - 0.5) * 0.25 * dpr, vy: (Math.random() - 0.5) * 0.25 * dpr,
            r: (1 + Math.random() * 1.6) * dpr,
            pulse: Math.random() * Math.PI * 2,
            pulseSpeed: 0.4 + Math.random() * 0.8,
          });
        }
      } else if (preset === "waves") {
        // Waves: horizontal sine curves at various y
        const count = Math.floor(8 * getDensity());
        for (let i = 0; i < count; i++) {
          items.push({
            yBase: (ch / (count + 1)) * (i + 1),
            amplitude: (20 + Math.random() * 40) * dpr,
            wavelength: (200 + Math.random() * 400) * dpr,
            phase: Math.random() * Math.PI * 2,
            phaseSpeed: 0.3 + Math.random() * 0.4,
            thickness: (1 + Math.random() * 1.5) * dpr,
            offset: Math.random(),
          });
        }
      } else if (preset === "dna") {
        // DNA: two intertwined helical strands
        const count = Math.floor(60 * getDensity());
        for (let i = 0; i < count; i++) {
          items.push({
            t: i / count, // position along strand 0..1
            offset: Math.random() * 0.05,
          });
        }
      } else if (preset === "circuits") {
        // Circuits: grid intersections with data pulses along edges
        const spacing = 90 * dpr / getDensity();
        const cols = Math.ceil(cw / spacing) + 1;
        const rows = Math.ceil(ch / spacing) + 1;
        for (let ix = 0; ix < cols; ix++) {
          for (let iy = 0; iy < rows; iy++) {
            items.push({
              x: ix * spacing + (Math.random() - 0.5) * spacing * 0.15,
              y: iy * spacing + (Math.random() - 0.5) * spacing * 0.15,
              pulse: Math.random() * Math.PI * 2,
              hasEdgeR: Math.random() > 0.4, // edge to the right
              hasEdgeD: Math.random() > 0.4, // edge down
              pulseR: Math.random(),
              pulseD: Math.random(),
              rateR: 0.3 + Math.random() * 0.5,
              rateD: 0.3 + Math.random() * 0.5,
            });
          }
        }
      } else if (preset === "starfield") {
        // Starfield: stars streaking from center
        const target = Math.floor((cw * ch) / (10000 * dpr) * getDensity());
        for (let i = 0; i < target; i++) {
          const angle = Math.random() * Math.PI * 2;
          const dist = Math.random() * Math.max(cw, ch) * 0.6;
          items.push({
            x: cw / 2 + Math.cos(angle) * dist,
            y: ch / 2 + Math.sin(angle) * dist,
            angle, dist,
            distMax: Math.hypot(cw, ch) * 0.7,
            speed: (0.5 + Math.random() * 2) * dpr,
            r: (0.6 + Math.random() * 1.2) * dpr,
          });
        }
      } else if (preset === "orbs") {
        // Orbs: 5 large soft glows anchored in the corners + a floater.
        // Each has an orbital drift so it moves quietly without ever leaving
        // its zone. Density slider scales orb count from 3 to 7.
        const count = Math.max(3, Math.min(7, Math.round(5 * getDensity())));
        const anchors = [
          { x: cw * 0.15, y: ch * 0.2 },
          { x: cw * 0.85, y: ch * 0.25 },
          { x: cw * 0.2, y: ch * 0.85 },
          { x: cw * 0.8, y: ch * 0.8 },
          { x: cw * 0.5, y: ch * 0.5 },
          { x: cw * 0.5, y: ch * 0.1 },
          { x: cw * 0.5, y: ch * 0.9 },
        ];
        for (let i = 0; i < count; i++) {
          const a = anchors[i % anchors.length];
          items.push({
            anchorX: a.x,
            anchorY: a.y,
            baseRad: (140 + Math.random() * 120) * dpr,
            intensity: 0.14 + Math.random() * 0.08,
            orbitSpeed: 0.6 + Math.random() * 0.8,
            orbitR: 0.5 + Math.random() * 0.6,
            orbitPhase: Math.random() * Math.PI * 2,
          });
        }
      }
      stateRef.current.items = items;
    };

    // ---- Resize handling (mobile-crash fix) ----
    // Previously this was an undebounced listener that reallocated the canvas
    // backing store AND rebuilt every particle on every resize event. On mobile,
    // opening the keyboard fires dozens of resize events during the slide-up
    // animation. Each one allocated a fresh multi-megabyte canvas buffer, which
    // spiked memory hard enough that iOS Safari terminated and reloaded the page
    // — that's the "search, then the page refreshes" bug.
    //
    // Fixes: (1) ignore height-only changes, which is what a keyboard causes;
    // (2) debounce genuine resizes; (3) cap total canvas pixels so we never
    // exceed mobile GPU/memory limits.
    let lastW = 0;
    let lastH = 0;
    let resizeTimer = null;

    const applySize = () => {
      const cssW = canvas.offsetWidth || window.innerWidth || 1;
      const cssH = canvas.offsetHeight || window.innerHeight || 1;
      // iOS enforces a hard total-canvas-area limit. Stay well under it by
      // scaling dpr down if the buffer would get too large.
      const MAX_PIXELS = 4_500_000;
      let effDpr = dpr;
      while (cssW * effDpr * cssH * effDpr > MAX_PIXELS && effDpr > 0.75) {
        effDpr -= 0.25;
      }
      canvas.width = Math.max(1, Math.floor(cssW * effDpr));
      canvas.height = Math.max(1, Math.floor(cssH * effDpr));
    };

    const resize = (rebuild) => {
      applySize();
      if (rebuild) initItems();
      lastW = canvas.offsetWidth;
      lastH = canvas.offsetHeight;
    };

    const onResize = () => {
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      const widthChanged = Math.abs(w - lastW) > 2;
      // A mobile keyboard changes height only. Height-only changes get a cheap
      // buffer resize with NO particle rebuild — that alone prevents the crash.
      const heightChangedALot = Math.abs(h - lastH) > 220;
      if (!widthChanged && !heightChangedALot) {
        // Small height shift (keyboard, URL bar collapse). Just resize the
        // buffer, keep the existing particles.
        applySize();
        lastH = h;
        return;
      }
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { resize(true); }, 180);
    };

    resize(true);
    window.addEventListener("resize", onResize, { passive: true });
    // Track orientation separately — that IS a real layout change worth rebuilding.
    window.addEventListener("orientationchange", () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => resize(true), 300);
    }, { passive: true });

    const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });

    // Mouse-follow interaction is pointless on touch devices — these listeners
    // never fire but still cost memory and wake-ups. Only attach for real mice.
    const hasMouse = typeof window.matchMedia === "function"
      ? window.matchMedia("(hover: hover) and (pointer: fine)").matches
      : true;
    const onMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current.x = (e.clientX - rect.left) * dpr;
      mouseRef.current.y = (e.clientY - rect.top) * dpr;
    };
    const onLeave = () => { mouseRef.current.x = -9999; mouseRef.current.y = -9999; };
    if (hasMouse) {
      window.addEventListener("mousemove", onMove, { passive: true });
      window.addEventListener("mouseleave", onLeave, { passive: true });
    }

    const startTime = performance.now();
    const linkDist = 130 * dpr;

    function drawParticles(elapsed) {
      const items = stateRef.current.items;
      const mx = mouseRef.current.x, my = mouseRef.current.y;
      const mouseR = 140 * dpr;
      for (const p of items) {
        p.x += p.vx * getSpeed();
        p.y += p.vy * getSpeed();
        p.vx += Math.sin(elapsed * 0.3 + p.pulse) * 0.002 * dpr;
        p.vy += Math.cos(elapsed * 0.2 + p.pulse) * 0.002 * dpr;
        if (mx > 0) {
          const dx = p.x - mx, dy = p.y - my;
          const d = Math.hypot(dx, dy);
          if (d < mouseR && d > 0.1) {
            const force = (1 - d / mouseR) * 0.6 * dpr;
            p.vx += (dx / d) * force * 0.05;
            p.vy += (dy / d) * force * 0.05;
          }
        }
        p.vx *= 0.985; p.vy *= 0.985;
        if (p.x < -20) p.x = canvas.width + 20;
        else if (p.x > canvas.width + 20) p.x = -20;
        if (p.y < -20) p.y = canvas.height + 20;
        else if (p.y > canvas.height + 20) p.y = -20;
      }
      // Links
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i], b = items[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < linkDist * linkDist) {
            const d = Math.sqrt(d2);
            const alpha = (1 - d / linkDist) * 0.14;
            ctx.strokeStyle = `rgba(${ar},${ag},${ab},${alpha})`;
            ctx.lineWidth = 0.7 * dpr;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
      }
      for (const p of items) {
        const pulse = 0.6 + 0.4 * Math.sin(elapsed * p.pulseSpeed + p.pulse);
        const glowR = p.r * 4;
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR);
        glow.addColorStop(0, `rgba(${ar},${ag},${ab},${0.22 * pulse})`);
        glow.addColorStop(1, `rgba(${ar},${ag},${ab},0)`);
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(${ar},${ag},${ab},${0.55 * pulse})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
    }

    function drawWaves(elapsed) {
      const waves = stateRef.current.items;
      const cw = canvas.width;
      for (const w of waves) {
        ctx.strokeStyle = `rgba(${ar},${ag},${ab},${0.25 + 0.15 * Math.sin(elapsed + w.phase)})`;
        ctx.lineWidth = w.thickness;
        ctx.beginPath();
        const steps = Math.ceil(cw / 8);
        for (let s = 0; s <= steps; s++) {
          const x = (s / steps) * cw;
          const y = w.yBase + w.amplitude * Math.sin(x / w.wavelength * Math.PI * 2 + elapsed * w.phaseSpeed * getSpeed() + w.phase);
          if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }

    function drawDNA(elapsed) {
      const items = stateRef.current.items;
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const heightExtent = canvas.height * 1.1; // extend beyond viewport for endless feel
      const radius = 110 * dpr;
      const twistSpeed = 0.5 * getSpeed();

      // First pass: draw the two backbone strands as smooth curves
      ctx.lineWidth = 1.3 * dpr;
      for (let strand = 0; strand < 2; strand++) {
        ctx.beginPath();
        for (let idx = 0; idx <= items.length; idx++) {
          const n = items[idx % items.length];
          const y = cy - heightExtent / 2 + n.t * heightExtent;
          const twist = elapsed * twistSpeed + n.t * Math.PI * 4;
          const x = cx + Math.cos(twist + strand * Math.PI) * radius;
          if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(${ar},${ag},${ab},0.28)`;
        ctx.stroke();
      }

      // Second pass: rungs and nodes with depth-based brightness (front strands brighter)
      for (const n of items) {
        const y = cy - heightExtent / 2 + n.t * heightExtent;
        const twist = elapsed * twistSpeed + n.t * Math.PI * 4;
        const x1 = cx + Math.cos(twist) * radius;
        const x2 = cx + Math.cos(twist + Math.PI) * radius;
        // Depth: strand-1 z-depth ranges from -1 (far) to +1 (near) via sin(twist)
        const z1 = Math.sin(twist); // -1..1
        const z2 = Math.sin(twist + Math.PI);
        const bright1 = 0.5 + 0.5 * (z1 + 1) / 2; // 0.5..1
        const bright2 = 0.5 + 0.5 * (z2 + 1) / 2;
        // Rung — fades based on average brightness (only render if rungs face forward)
        const rungAlpha = 0.14 * Math.max(0, (bright1 + bright2) / 2 - 0.3);
        if (rungAlpha > 0.02) {
          ctx.strokeStyle = `rgba(${ar},${ag},${ab},${rungAlpha})`;
          ctx.lineWidth = 0.9 * dpr;
          ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
        }
        // Nodes with depth-scaled size and brightness
        const nodePairs = [
          { x: x1, b: bright1 },
          { x: x2, b: bright2 },
        ];
        for (const p of nodePairs) {
          const r = (1.6 + 1.4 * p.b) * dpr;
          const glow = ctx.createRadialGradient(p.x, y, 0, p.x, y, r * 5);
          glow.addColorStop(0, `rgba(${ar},${ag},${ab},${0.55 * p.b})`);
          glow.addColorStop(1, `rgba(${ar},${ag},${ab},0)`);
          ctx.fillStyle = glow;
          ctx.beginPath(); ctx.arc(p.x, y, r * 5, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = `rgba(${ar},${ag},${ab},${0.85 * p.b})`;
          ctx.beginPath(); ctx.arc(p.x, y, r, 0, Math.PI * 2); ctx.fill();
        }
      }
    }

    function drawCircuits(elapsed) {
      const items = stateRef.current.items;
      // Edges + pulses
      for (const n of items) {
        // Find right/down neighbors
        for (const m of items) {
          if (n.hasEdgeR && Math.abs(m.y - n.y) < 5 * dpr && m.x > n.x && m.x - n.x < 130 * dpr) {
            ctx.strokeStyle = `rgba(${ar},${ag},${ab},0.12)`;
            ctx.lineWidth = 0.8 * dpr;
            ctx.beginPath(); ctx.moveTo(n.x, n.y); ctx.lineTo(m.x, m.y); ctx.stroke();
            // pulse along edge
            const pt = ((elapsed * n.rateR * getSpeed() + n.pulseR) % 2) / 2;
            if (pt < 0.7) {
              const t = pt / 0.7;
              const px = n.x + (m.x - n.x) * t;
              const py = n.y + (m.y - n.y) * t;
              const glow = ctx.createRadialGradient(px, py, 0, px, py, 5 * dpr);
              glow.addColorStop(0, `rgba(${ar},${ag},${ab},0.9)`);
              glow.addColorStop(1, `rgba(${ar},${ag},${ab},0)`);
              ctx.fillStyle = glow;
              ctx.beginPath(); ctx.arc(px, py, 5 * dpr, 0, Math.PI * 2); ctx.fill();
            }
            break;
          }
        }
        for (const m of items) {
          if (n.hasEdgeD && Math.abs(m.x - n.x) < 5 * dpr && m.y > n.y && m.y - n.y < 130 * dpr) {
            ctx.strokeStyle = `rgba(${ar},${ag},${ab},0.12)`;
            ctx.lineWidth = 0.8 * dpr;
            ctx.beginPath(); ctx.moveTo(n.x, n.y); ctx.lineTo(m.x, m.y); ctx.stroke();
            const pt = ((elapsed * n.rateD * getSpeed() + n.pulseD) % 2) / 2;
            if (pt < 0.7) {
              const t = pt / 0.7;
              const px = n.x + (m.x - n.x) * t;
              const py = n.y + (m.y - n.y) * t;
              const glow = ctx.createRadialGradient(px, py, 0, px, py, 5 * dpr);
              glow.addColorStop(0, `rgba(${ar},${ag},${ab},0.9)`);
              glow.addColorStop(1, `rgba(${ar},${ag},${ab},0)`);
              ctx.fillStyle = glow;
              ctx.beginPath(); ctx.arc(px, py, 5 * dpr, 0, Math.PI * 2); ctx.fill();
            }
            break;
          }
        }
        // Node
        const r = 1.6 * dpr;
        ctx.fillStyle = `rgba(${ar},${ag},${ab},0.5)`;
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.fill();
      }
    }

    function drawStarfield(elapsed) {
      const items = stateRef.current.items;
      const cx = canvas.width / 2, cy = canvas.height / 2;
      for (const s of items) {
        s.dist += s.speed * getSpeed();
        if (s.dist > s.distMax) {
          s.dist = 5;
          s.angle = Math.random() * Math.PI * 2;
        }
        s.x = cx + Math.cos(s.angle) * s.dist;
        s.y = cy + Math.sin(s.angle) * s.dist;
        const alpha = Math.min(1, s.dist / (s.distMax * 0.3));
        // streak
        const tailLen = s.speed * 5 * dpr;
        const tx = cx + Math.cos(s.angle) * (s.dist - tailLen);
        const ty = cy + Math.sin(s.angle) * (s.dist - tailLen);
        ctx.strokeStyle = `rgba(${ar},${ag},${ab},${alpha * 0.4})`;
        ctx.lineWidth = s.r;
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(s.x, s.y); ctx.stroke();
        // head
        ctx.fillStyle = `rgba(${ar},${ag},${ab},${alpha * 0.8})`;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Stripe-style aurora: soft, slow, blurred color washes that drift diagonally.
    // Pure gradient fills, no particles. Feels premium and expensive to render
    // (it's not — it's just a handful of radial gradients).
    function drawAurora(elapsed) {
      const cw = canvas.width, ch = canvas.height;
      const t = elapsed * 0.15 * getSpeed();
      // Three overlapping blobs, each drifting on its own slow orbit
      const blobs = [
        { hueShift: 0,   speedX: 1.0, speedY: 0.7, phaseX: 0,       phaseY: 1.2, size: 0.75 },
        { hueShift: 30,  speedX: 0.8, speedY: 1.1, phaseX: 2.4,     phaseY: 0.4, size: 0.85 },
        { hueShift: -30, speedX: 1.3, speedY: 0.9, phaseX: 4.1,     phaseY: 3.3, size: 0.65 },
      ];
      // Base fill (subtle wash of accent so canvas isn't purely transparent)
      ctx.fillStyle = `rgba(${ar},${ag},${ab},0.02)`;
      ctx.fillRect(0, 0, cw, ch);
      for (const b of blobs) {
        const cx = cw * (0.5 + 0.4 * Math.sin(t * b.speedX + b.phaseX));
        const cy = ch * (0.5 + 0.35 * Math.cos(t * b.speedY + b.phaseY));
        const rad = Math.max(cw, ch) * b.size;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
        // Shift accent colors slightly per blob for that iridescent aurora feel
        const sr = Math.min(255, Math.max(0, ar + b.hueShift));
        const sg = Math.min(255, Math.max(0, ag + b.hueShift * 0.5));
        const sb = Math.min(255, Math.max(0, ab - b.hueShift * 0.4));
        g.addColorStop(0, `rgba(${sr},${sg},${sb},0.28)`);
        g.addColorStop(0.5, `rgba(${sr},${sg},${sb},0.08)`);
        g.addColorStop(1, `rgba(${sr},${sg},${sb},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, cw, ch);
      }
    }

    // Soft glowing orbs: 4-6 large, blurred orbs drift slowly in the corners.
    // No jitter, no lines, no particles. Just quiet ambient movement.
    function drawOrbs(elapsed) {
      const cw = canvas.width, ch = canvas.height;
      const items = stateRef.current.items;
      const t = elapsed * 0.08 * getSpeed();
      for (const o of items) {
        // Orbit each orb around its anchor point on a slow ellipse
        const cx = o.anchorX + Math.cos(t * o.orbitSpeed + o.orbitPhase) * o.orbitR * cw * 0.08;
        const cy = o.anchorY + Math.sin(t * o.orbitSpeed + o.orbitPhase) * o.orbitR * ch * 0.08;
        // Breathing radius for gentle life
        const rad = o.baseRad * (1 + 0.08 * Math.sin(t * 1.3 + o.orbitPhase));
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
        g.addColorStop(0, `rgba(${ar},${ag},${ab},${o.intensity})`);
        g.addColorStop(0.4, `rgba(${ar},${ag},${ab},${o.intensity * 0.35})`);
        g.addColorStop(1, `rgba(${ar},${ag},${ab},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
      }
    }

    // Static subtle grid: pure geometry, no motion. Cheapest option, most
    // "engineered" feel. Just draws a faint dot grid once per frame.
    function drawGrid() {
      const cw = canvas.width, ch = canvas.height;
      const cell = 40 * dpr;
      ctx.fillStyle = `rgba(${ar},${ag},${ab},0.08)`;
      for (let x = cell; x < cw; x += cell) {
        for (let y = cell; y < ch; y += cell) {
          ctx.beginPath();
          ctx.arc(x, y, 1 * dpr, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Solid background: just a single accent-tinted wash. Zero motion,
    // Linear-style clean canvas.
    function drawNone() {
      const cw = canvas.width, ch = canvas.height;
      // Very subtle diagonal gradient using accent, barely visible
      const g = ctx.createLinearGradient(0, 0, cw, ch);
      g.addColorStop(0, `rgba(${ar},${ag},${ab},0.03)`);
      g.addColorStop(1, `rgba(${ar},${ag},${ab},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cw, ch);
    }

    function draw(now) {
      // Skip repaint when paused (e.g. Settings modal open) so slider drags
      // don't compete with a full-viewport canvas for main-thread time.
      if (pausedRef.current) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }
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
      else drawParticles(elapsed); // particles + neurons default
      rafRef.current = requestAnimationFrame(draw);
    }
    rafRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafRef.current);
      if (resizeTimer) clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
    };
  }, [accent, intensity, preset]);

  // When density changes, throttle re-init to avoid lag from slider drags.
  useEffect(() => {
    const timer = setTimeout(() => {
      const canvas = canvasRef.current; if (!canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const intensityScale = intensity === "subtle" ? 0.55 : 1;
      const finalDensity = density * intensityScale;
      const cw = canvas.width, ch = canvas.height;
      const cur = stateRef.current.items;
      // Only adjust particle count for the "particle" family — other presets have
      // structural item lists that would need full re-init, and users rarely
      // change density mid-preset for those.
      if (preset === "particles" || preset === "neurons") {
        const target = Math.floor((cw * ch) / (28000 * dpr) * finalDensity);
        while (cur.length < target) {
          cur.push({
            x: Math.random() * cw, y: Math.random() * ch,
            vx: (Math.random() - 0.5) * 0.25 * dpr, vy: (Math.random() - 0.5) * 0.25 * dpr,
            r: (1 + Math.random() * 1.6) * dpr,
            pulse: Math.random() * Math.PI * 2,
            pulseSpeed: 0.4 + Math.random() * 0.8,
          });
        }
        while (cur.length > target) cur.pop();
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [density, intensity, preset]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        opacity: (P.dark ? 0.35 : 0.28) * (intensity === "subtle" ? 0.55 : 1) * opacity,
        zIndex: 0,
      }}
      aria-hidden="true"
    />
  );
}

// ============ LOGO WIGGLE (minimal) ============
// Just wiggles the logo on click. No popup, no quotes, no burst — quiet and professional.
function BrainEasterEgg() {
  const [wiggleKey, setWiggleKey] = useState(0);
  const trigger = () => setWiggleKey((k) => k + 1);
  return { trigger, wiggleKey, render: null };
}



// Voice dictation button using the browser's Web Speech API.
// Works in Chrome/Edge/Safari without any key or account. Falls back gracefully
// when unsupported (button hides itself). Streams interim results to the parent
// so the user sees words appear as they speak.
function MicButton({ onTranscript, accent, P }) {
  const [supported, setSupported] = useState(true);
  const [listening, setListening] = useState(false);
  const recRef = useRef(null);
  // The user's intent: are they trying to keep dictating? Used to distinguish
  // "user tapped stop" from "browser cut us off after a pause".
  const wantListenRef = useRef(false);
  // Accumulated finalized text across the whole session. We add newly-final
  // chunks here and stream that + current interim to the parent.
  const finalTextRef = useRef("");

  // Small Web Audio beeps for start/stop feedback — no bundled files.
  const beep = (freq, dur = 0.08, gain = 0.05) => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      g.gain.value = 0;
      osc.connect(g); g.connect(ctx.destination);
      const now = ctx.currentTime;
      g.gain.linearRampToValueAtTime(gain, now + 0.01);
      g.gain.linearRampToValueAtTime(0, now + dur);
      osc.start(now);
      osc.stop(now + dur + 0.02);
      setTimeout(() => { try { ctx.close(); } catch {} }, (dur + 0.1) * 1000);
    } catch {}
  };

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setSupported(false); return; }
    const rec = new SR();
    // continuous=true is REQUIRED for real dictation. With false, the browser
    // stops after the first pause (often a single word or syllable) and calls
    // onend, which was killing sessions instantly.
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";

    rec.onresult = (e) => {
      let interim = "";
      // Accumulate any newly-finalized chunks into the persistent buffer, so
      // if the browser restarts a segment we don't lose earlier words.
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          finalTextRef.current = (finalTextRef.current + " " + t).replace(/\s+/g, " ").trim();
        } else {
          interim += t;
        }
      }
      const combined = (finalTextRef.current + (interim ? " " + interim : "")).replace(/\s+/g, " ").trim();
      onTranscript(combined, false);
    };

    rec.onerror = (e) => {
      // "no-speech" and "aborted" are common non-fatal errors — don't kill the
      // session unless the user asked to stop.
      const err = e && e.error;
      if (err === "no-speech" || err === "aborted") return;
      if (err === "not-allowed" || err === "service-not-allowed") {
        wantListenRef.current = false;
        setListening(false);
      }
    };

    rec.onend = () => {
      // If the user still wants to listen but the browser cut us off (common
      // in Chrome after a few seconds of silence), immediately restart. This
      // is what makes dictation feel truly continuous.
      if (wantListenRef.current) {
        try { rec.start(); } catch {
          // If restart fails (rare), give up gracefully.
          wantListenRef.current = false;
          setListening(false);
        }
      } else {
        setListening(false);
      }
    };

    recRef.current = rec;
    return () => {
      wantListenRef.current = false;
      try { rec.abort(); } catch {}
    };
  }, [onTranscript]);

  if (!supported) return null;

  const toggle = () => {
    if (!recRef.current) return;
    if (listening) {
      // User is stopping. Suppress auto-restart, then stop, and finalize the
      // current buffer as the transcript so the parent gets a clean "final".
      wantListenRef.current = false;
      try { recRef.current.stop(); } catch {}
      setListening(false);
      onTranscript(finalTextRef.current.trim(), true);
      // Descending two-tone beep (stop)
      beep(660, 0.09);
      setTimeout(() => beep(440, 0.11), 90);
    } else {
      // Fresh session — clear the buffer.
      finalTextRef.current = "";
      wantListenRef.current = true;
      try {
        recRef.current.start();
        setListening(true);
        // Ascending two-tone beep (start)
        beep(523, 0.07);
        setTimeout(() => beep(784, 0.09), 70);
      } catch {
        wantListenRef.current = false;
        setListening(false);
      }
    }
  };

  return (
    <button
      onClick={toggle}
      title={listening ? "Stop dictation" : "Start voice dictation"}
      style={{
        width: 34, height: 34, borderRadius: 8,
        border: "none", cursor: "pointer",
        background: listening ? accent : "transparent",
        color: listening ? "#fff" : P.faint,
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0, transition: "background 0.15s cubic-bezier(0.16, 1, 0.3, 1), color 0.15s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.15s cubic-bezier(0.16, 1, 0.3, 1), transform 0.1s cubic-bezier(0.16, 1, 0.3, 1)",
        position: "relative",
      }}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
        <path d="M12 15a3 3 0 003-3V6a3 3 0 00-6 0v6a3 3 0 003 3z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5 12a7 7 0 0014 0M12 19v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {listening && (
        <span style={{
          position: "absolute", inset: -3, borderRadius: 10,
          border: `2px solid ${accent}`,
          animation: "cbPulse 1.4s ease-in-out infinite",
        }} />
      )}
    </button>
  );
}

// Text-to-speech player. Uses ElevenLabs when a user-supplied key is in
// localStorage; otherwise falls back to the browser's built-in SpeechSynthesis.
// Play/pause with visible progress bar. Never sends audio anywhere except to
// ElevenLabs directly if the user provides their own key.
function AnswerPlayer({ text, accent, P }) {
  const [status, setStatus] = useState("idle"); // idle | loading | playing | paused
  const [progress, setProgress] = useState(0);
  const audioRef = useRef(null);
  const utterRef = useRef(null);
  const [useElevenLabs, setUseElevenLabs] = useState(false);

  useEffect(() => {
    try { setUseElevenLabs(!!localStorage.getItem("cb_eleven_key")); } catch {}
  }, []);

  const stop = () => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    try { window.speechSynthesis.cancel(); } catch {}
    utterRef.current = null;
    setStatus("idle");
    setProgress(0);
  };

  const playBrowser = () => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.0;
    utter.pitch = 1.0;
    // Prefer a natural-sounding English voice if available
    const voices = window.speechSynthesis.getVoices();
    const pref = voices.find((v) => /Google.*(US|English)|Samantha|Alex|Karen|Daniel/i.test(v.name)) || voices.find((v) => /en/i.test(v.lang));
    if (pref) utter.voice = pref;
    utter.onstart = () => setStatus("playing");
    utter.onend = () => { setStatus("idle"); setProgress(0); };
    utter.onerror = () => { setStatus("idle"); setProgress(0); };
    utter.onboundary = (e) => {
      if (e.charIndex && text.length) setProgress(e.charIndex / text.length);
    };
    utterRef.current = utter;
    window.speechSynthesis.speak(utter);
  };

  const playEleven = async () => {
    const key = localStorage.getItem("cb_eleven_key");
    const voiceId = localStorage.getItem("cb_eleven_voice") || "21m00Tcm4TlvDq8ikWAM"; // Rachel default
    if (!key) return playBrowser();
    setStatus("loading");
    try {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
        method: "POST",
        headers: {
          "xi-api-key": key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_flash_v2_5",
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      });
      if (!res.ok) throw new Error("ElevenLabs error " + res.status);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.ontimeupdate = () => {
        if (audio.duration) setProgress(audio.currentTime / audio.duration);
      };
      audio.onended = () => { setStatus("idle"); setProgress(0); URL.revokeObjectURL(url); audioRef.current = null; };
      audio.onerror = () => { setStatus("idle"); playBrowser(); };
      await audio.play();
      setStatus("playing");
    } catch {
      // fall back gracefully
      playCerebrum();
    }
  };

  // Cloudflare Workers AI (MeloTTS) via our own /api/tts endpoint.
  // Free, keyless, works for every user. Falls back to browser voice on failure.
  const playCerebrum = async () => {
    setStatus("loading");
    try {
      // Voice preference stored in localStorage by Settings ("female" | "male")
      let voicePref = "";
      try { voicePref = localStorage.getItem("cb_tts_voice") || ""; } catch {}
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice: voicePref }),
      });
      if (!res.ok) throw new Error("TTS " + res.status);
      const ct = res.headers.get("content-type") || "";
      if (!ct.startsWith("audio/")) throw new Error("Non-audio response");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.ontimeupdate = () => {
        if (audio.duration) setProgress(audio.currentTime / audio.duration);
      };
      audio.onended = () => { setStatus("idle"); setProgress(0); URL.revokeObjectURL(url); audioRef.current = null; };
      audio.onerror = () => { setStatus("idle"); playBrowser(); };
      await audio.play();
      setStatus("playing");
    } catch {
      playBrowser();
    }
  };

  const onClick = () => {
    if (status === "playing") {
      if (audioRef.current) { audioRef.current.pause(); setStatus("paused"); return; }
      try { window.speechSynthesis.pause(); setStatus("paused"); } catch {}
      return;
    }
    if (status === "paused") {
      if (audioRef.current) { audioRef.current.play(); setStatus("playing"); return; }
      try { window.speechSynthesis.resume(); setStatus("playing"); } catch {}
      return;
    }
    // Priority: user's own ElevenLabs key (best) > shared Cerebrum TTS (free) > browser TTS
    if (useElevenLabs) playEleven();
    else playCerebrum();
  };

  useEffect(() => () => stop(), []);

  const label = status === "loading" ? "Loading..." :
                status === "playing" ? "Pause" :
                status === "paused" ? "Resume" : "Listen";

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 8 }}>
      <button onClick={onClick} style={{
        padding: "6px 12px", fontSize: 12, fontWeight: 500,
        background: status === "playing" || status === "paused" ? accent : "transparent",
        color: status === "playing" || status === "paused" ? "#fff" : P.ink2,
        border: `1px solid ${status === "playing" || status === "paused" ? accent : P.line}`,
        borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
        display: "inline-flex", alignItems: "center", gap: 6,
      }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          {status === "playing" ? (
            <><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></>
          ) : (
            <path d="M8 5v14l11-7z" />
          )}
        </svg>
        {label}
        {useElevenLabs && <span style={{ fontSize: 9, opacity: 0.7, marginLeft: 2, letterSpacing: "0.05em" }}>· 11</span>}
      </button>
      {(status === "playing" || status === "paused") && (
        <div style={{ width: 100, height: 3, background: P.line, borderRadius: 2, overflow: "hidden" }}>
          <div style={{ width: "100%", height: "100%", background: accent, transformOrigin: "left center", transform: `scaleX(${progress})`, transition: "transform 0.15s cubic-bezier(0.16, 1, 0.3, 1)" }} />
        </div>
      )}
      {(status === "playing" || status === "paused") && (
        <button onClick={stop} title="Stop" style={{
          background: "transparent", border: "none", cursor: "pointer",
          color: P.faint, padding: 2, fontSize: 14, lineHeight: 1,
        }}>×</button>
      )}
    </div>
  );
}

function TtsVoiceSetting({ P, accent, at, S, sfx }) {
  const [voice, setVoice] = useState(() => { try { return localStorage.getItem("cb_tts_voice") || "female"; } catch { return "female"; } });
  const set = (v) => {
    setVoice(v);
    try { localStorage.setItem("cb_tts_voice", v); } catch {}
    sfx();
  };
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
      {[["female", "Female"], ["male", "Male"]].map(([v, label]) => (
        <button key={v}
          onClick={() => set(v)}
          style={{
            flex: 1, padding: "9px 6px", fontSize: 12, fontWeight: 550,
            background: voice === v ? accent : "transparent",
            color: voice === v ? at : P.ink2,
            border: `1px solid ${voice === v ? accent : P.line}`,
            borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
            transition: "background 0.15s cubic-bezier(0.16, 1, 0.3, 1), color 0.15s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.15s cubic-bezier(0.16, 1, 0.3, 1), transform 0.1s cubic-bezier(0.16, 1, 0.3, 1)",
          }}>{label}</button>
      ))}
    </div>
  );
}

function ElevenLabsSetting({ P, accent, at, S, sfx }) {
  const [key, setKey] = useState(() => { try { return localStorage.getItem("cb_eleven_key") || ""; } catch { return ""; } });
  const [voice, setVoice] = useState(() => { try { return localStorage.getItem("cb_eleven_voice") || "21m00Tcm4TlvDq8ikWAM"; } catch { return "21m00Tcm4TlvDq8ikWAM"; } });
  const [saved, setSaved] = useState(false);

  // A few well-known ElevenLabs preset voices anyone can use with any key.
  const voices = [
    { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel (female, calm)" },
    { id: "AZnzlk1XvdvUeBnXmlld", name: "Domi (female, strong)" },
    { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella (female, soft)" },
    { id: "ErXwobaYiN019PkySvjV", name: "Antoni (male, well-rounded)" },
    { id: "MF3mGyEYCl7XYWbV9V6O", name: "Elli (female, emotional)" },
    { id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh (male, deep)" },
    { id: "VR6AewLTigWG4xSOukaG", name: "Arnold (male, crisp)" },
    { id: "pNInz6obpgDQGcFmaJgB", name: "Adam (male, narration)" },
    { id: "yoZ06aMxZJJ28mfd3POQ", name: "Sam (male, raspy)" },
  ];

  const save = () => {
    try {
      if (key.trim()) localStorage.setItem("cb_eleven_key", key.trim());
      else localStorage.removeItem("cb_eleven_key");
      localStorage.setItem("cb_eleven_voice", voice);
    } catch {}
    sfx();
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const clear = () => {
    setKey("");
    try { localStorage.removeItem("cb_eleven_key"); } catch {}
    sfx();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <input
        type="password"
        placeholder="ElevenLabs API key (optional — leave blank to use browser voice)"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        style={{
          padding: "10px 12px", fontSize: 12.5,
          background: P.surface, color: P.ink,
          border: `1px solid ${P.line}`, borderRadius: 8,
          fontFamily: "inherit", outline: "none",
        }}
      />
      <select value={voice} onChange={(e) => setVoice(e.target.value)} style={{
        padding: "10px 12px", fontSize: 12.5,
        background: P.surface, color: P.ink,
        border: `1px solid ${P.line}`, borderRadius: 8,
        fontFamily: "inherit", cursor: "pointer", outline: "none",
      }}>
        {voices.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select>
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={save} style={{ flex: 1, padding: "8px 12px", fontSize: 12, fontWeight: 600, background: accent, color: at, border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "inherit" }}>
          {saved ? "✓ Saved" : "Save"}
        </button>
        {key && (
          <button onClick={clear} style={{ padding: "8px 12px", fontSize: 12, fontWeight: 500, background: "transparent", color: P.ink2, border: `1px solid ${P.line}`, borderRadius: 8, cursor: "pointer", fontFamily: "inherit" }}>
            Clear key
          </button>
        )}
      </div>
    </div>
  );
}

// Detects follow-up messages that lack a topic of their own — "but you forgot
// about X", "what about that", "explain more". These carry no searchable
// content, so for the video query we merge in the previous user turn.
function looksLikeFollowupText(q) {
  if (!q) return false;
  const s = q.toLowerCase().trim();
  if (s.length < 8) return true;
  return /^(but|and|also|what about|how about|explain|tell me more|more on|also,|actually|wait|no,)/i.test(s)
      || /\b(you (forgot|missed)|the (paper|study|source|answer)|that (paper|study|source|answer)|this (paper|study))\b/i.test(s);
}

// ---- INFO PAGES (rendered inside the SPA) ----
// Cloudflare Pages' SPA mode serves index.html for every route, so standalone
// HTML files at /about, /privacy etc. never reach the browser. Instead we
// detect the path here and render the info page inside React. This is
// guaranteed to work regardless of Cloudflare routing config.
function InfoPage({ page }) {
  const pages = {
    about: {
      title: "About Cerebrum",
      content: `
        <p style="font-size:18px;color:#71717a;margin:0 0 28px">A free scientific literature search engine that returns cited answers from real peer-reviewed sources.</p>
        <h2>What Cerebrum is</h2>
        <p>Cerebrum is a research tool. You ask a scientific question and Cerebrum queries a group of open scholarly databases in parallel, then writes a summary with each claim linked to the paper it came from.</p>
        <p>The goal is honesty and traceability. Every citation is a real DOI. If no papers are retrieved for a question, the answer says so plainly rather than inventing sources.</p>
        <h2>How it works</h2>
        <p>When you submit a question, Cerebrum queries these open, non-proprietary indexes in parallel:</p>
        <ul>
          <li>Europe PMC (43 million articles)</li>
          <li>PubMed (36 million articles)</li>
          <li>OpenAlex (250 million works)</li>
          <li>Crossref (150 million works)</li>
          <li>Semantic Scholar (220 million papers)</li>
          <li>arXiv, bioRxiv, medRxiv (preprints)</li>
          <li>DOAJ, PLOS, Zenodo (open access)</li>
        </ul>
        <p>Results are merged, scored for relevance against the question's specific terminology, and passed to a language model that writes a summary constrained by what's actually in the retrieved abstracts.</p>
        <h2>What Cerebrum is not</h2>
        <ul>
          <li><strong>Not a substitute for reading the papers.</strong> Every summary is AI-generated. Verify anything you plan to rely on against the cited source.</li>
          <li><strong>Not a medical, legal, or financial advisor.</strong></li>
          <li><strong>Not tracked or monetized.</strong> No ads. No account. No analytics beyond basic uptime monitoring.</li>
        </ul>
      `,
    },
    privacy: {
      title: "Privacy Policy",
      content: `
        <p style="font-size:14px;color:#71717a">Last updated: January 2026</p>
        <p style="font-size:17px;color:#71717a;margin:0 0 24px">Cerebrum is designed to collect as little as possible.</p>
        <h2>What we don't do</h2>
        <ul>
          <li>We do not use tracking pixels, third-party analytics, or advertising networks.</li>
          <li>We do not require an account, email address, or personal information.</li>
          <li>We do not sell, share, or profile user data.</li>
          <li>We do not use cookies for tracking. Preferences are stored in your browser's local storage and never leave your device.</li>
        </ul>
        <h2>What is processed when you search</h2>
        <ul>
          <li>Your question is sent to Cerebrum's server to query scholarly databases and generate an answer.</li>
          <li>The question is forwarded to scholarly APIs (Europe PMC, PubMed, OpenAlex, etc.). They receive search terms only.</li>
          <li>The question is sent to a language model provider (OpenRouter or Cloudflare Workers AI) to generate the summary.</li>
          <li>Your IP address is visible to Cloudflare as part of standard web traffic for rate limiting and abuse prevention.</li>
          <li>We do not permanently store your questions on our servers.</li>
        </ul>
        <h2>Local browser storage</h2>
        <p>Cerebrum uses localStorage for saved articles, session history, and preferences. This data is stored only on your device.</p>
        <h2>Children</h2>
        <p>Cerebrum is not directed at children under 13.</p>
      `,
    },
    terms: {
      title: "Terms of Service",
      content: `
        <p style="font-size:14px;color:#71717a">Last updated: January 2026</p>
        <h2>1. What Cerebrum is</h2>
        <p>Cerebrum is a free scientific literature search tool. It returns AI-generated summaries of retrieved peer-reviewed papers. It is provided as-is, with no warranty.</p>
        <h2>2. Accuracy is not guaranteed</h2>
        <p>Answers are generated by a language model from retrieved abstracts. Language models can misread, misinterpret, or misattribute. Verify anything important against the cited sources.</p>
        <h2>3. Acceptable use</h2>
        <p>Do not use Cerebrum to disrupt the service, systematically scrape answers, generate harmful content, or violate the terms of upstream scholarly APIs.</p>
        <h2>4. Third-party content</h2>
        <p>Cerebrum links to papers hosted by third parties. We are not responsible for their content, availability, or licensing.</p>
        <h2>5. Availability</h2>
        <p>Cerebrum is free and comes with no availability guarantee. The service may change at any time.</p>
        <h2>6. Liability</h2>
        <p>To the maximum extent allowed by law, Cerebrum is not liable for any damages arising from your use of the service.</p>
      `,
    },
    contact: {
      title: "Contact",
      content: `
        <p style="font-size:17px;color:#71717a;margin:0 0 24px">Get in touch for bug reports, feature requests, or questions.</p>
        <div style="background:var(--surface,#f4f4f5);border:1px solid var(--line,#e4e4e7);border-radius:12px;padding:18px 22px;margin:18px 0">
          <h2 style="margin-top:0">Email</h2>
          <p style="font-family:monospace;font-size:15px"><a href="mailto:contact@askcerebrum.org" style="color:inherit">contact@askcerebrum.org</a></p>
          <p style="font-size:13px;color:#71717a">Include as much detail as you can — a bug report is much easier to act on with the exact query and what you expected to see.</p>
        </div>
        <h2>Reporting a bad answer</h2>
        <p>If you find a wrong species, invented citation, or misattributed finding — please email with the exact question and a short description. This is how the system improves.</p>
        <h2>Reputation and categorization</h2>
        <p>If your organization's web filter is blocking Cerebrum, email us and we can help get it recategorized correctly.</p>
      `,
    },
  };
  const data = pages[page];
  if (!data) return null;
  return (
    <div style={{ minHeight: "100dvh", background: "#fafaf9", color: "#18181b", fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', sans-serif", lineHeight: 1.6 }}>
      <style>{`
        @media (prefers-color-scheme: dark) {
          .cb-info-page { background: #0f0f10 !important; color: #e4e4e7 !important; }
          .cb-info-page a { color: #f97316; }
          .cb-info-header { border-color: rgba(128,128,128,0.2) !important; }
          .cb-info-footer { border-color: rgba(128,128,128,0.2) !important; color: #71717a !important; }
        }
        .cb-info-page h2 { font-size: 19px; font-weight: 650; letter-spacing: -0.015em; margin: 32px 0 10px; }
        .cb-info-page ul { padding-left: 22px; margin: 0 0 18px; }
        .cb-info-page li { margin-bottom: 8px; }
        .cb-info-page p { margin: 0 0 14px; }
      `}</style>
      <div className="cb-info-page" style={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
        <header className="cb-info-header" style={{ padding: "20px 24px", borderBottom: "1px solid rgba(128,128,128,0.15)" }}>
          <a href="/" style={{ display: "inline-flex", alignItems: "center", gap: 10, fontWeight: 700, color: "inherit", fontSize: 17, textDecoration: "none", letterSpacing: "-0.01em" }}>
            <Mark size={22} accent="#b45309" />
            Cerebrum
          </a>
        </header>
        <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px 96px", flex: 1, width: "100%" }}>
          <h1 style={{ fontSize: "clamp(30px, 5vw, 40px)", fontWeight: 750, letterSpacing: "-0.025em", margin: "0 0 16px", lineHeight: 1.1 }}>{data.title}</h1>
          <div dangerouslySetInnerHTML={{ __html: data.content }} />
        </main>
        <footer className="cb-info-footer" style={{ borderTop: "1px solid rgba(128,128,128,0.15)", padding: "24px", textAlign: "center", fontSize: 13, color: "#71717a" }}>
          <a href="/" style={{ color: "inherit", margin: "0 12px" }}>Home</a>·
          <a href="/about" style={{ color: "inherit", margin: "0 12px" }}>About</a>·
          <a href="/privacy" style={{ color: "inherit", margin: "0 12px" }}>Privacy</a>·
          <a href="/terms" style={{ color: "inherit", margin: "0 12px" }}>Terms</a>·
          <a href="/contact" style={{ color: "inherit", margin: "0 12px" }}>Contact</a>
          <div style={{ marginTop: 12 }}>© 2026 Cerebrum</div>
        </footer>
      </div>
    </div>
  );
}

function App() {
  const isMobile = useIsMobile();
  const [entered, setEntered] = useState(false);
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState([]);
  const [pinnedSources, setPinnedSources] = useState([]); // user-pinned sources persist across turns
  const [corrections, setCorrections] = useState([]);     // sticky user corrections for the session
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
  const [srcSort, setSrcSort] = useState("relevance"); // relevance | date | database
  const [srcFilter, setSrcFilter] = useState("");
  // Empty state cycling messages so it doesn't feel dead
  const [zKey, setZKey] = useState(""); const [zUser, setZUser] = useState(""); const [zMsg, setZMsg] = useState("");
  const [answerLength, setAnswerLength] = useState(() => getCookie("cb_len") || "medium");
  const [factCheck, setFactCheck] = useState(() => getCookie("cb_fc") === "1");
  const [muted, setMuted] = useState(() => getCookie("cb_muted") === "1");
  const [soundMode, setSoundMode] = useState(() => getCookie("cb_snd") || "pulse");
  const [typewriter, setTypewriter] = useState(() => getCookie("cb_tw") !== "0");
  const [citationStyle, setCitationStyle] = useState(() => getCookie("cb_cite") || "vancouver"); // vancouver | apa | mla | chicago | bibtex
  const [animationMode, setAnimationMode] = useState(() => getCookie("cb_anim") || "cinematic"); // cinematic | subtle | off
  const [animPreset, setAnimPreset] = useState(() => getCookie("cb_animP") || "aurora"); // aurora | orbs | grid | none | particles | waves | dna | circuits | neurons | starfield
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
    // Build history: each user turn contributes content; each assistant turn
    // contributes content AND its sources, so the backend can reuse them for
    // follow-ups without a fresh search. Trim to last 10 rounds (20 messages).
    const prior = [];
    turns.slice(-10).forEach((t) => {
      prior.push({ role: "user", content: t.q });
      prior.push({ role: "assistant", content: t.answer, sources: t.sources || [] });
    });
    try {
      // Videos search a smarter query than the raw question. A follow-up
      // message ("but it forgot about X") has no topic on its own, so we merge
      // the previous user turn in so the video query still knows the subject.
      const priorUserTurn = [...turns].reverse().find((t) => t && t.q);
      const videoQuery = (priorUserTurn && priorUserTurn.q && looksLikeFollowupText(question))
        ? priorUserTurn.q + " " + question
        : question;
      const videosPromise = fetch("/api/videos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: videoQuery }) })
        .then((r) => r.ok ? r.json() : { videos: [] })
        .catch(() => ({ videos: [] }));

      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: question,
          history: prior,
          settings: { answerLength, factCheck },
          pinnedSources,
          corrections,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Something went sideways. Try that again?"); setBusy(false); return; }
      const turnId = Date.now() + Math.random();
      const nt = { id: turnId, q: question, answer: data.answer || "", sources: data.sources || [], videos: data.videos || [], source: data.source || "", factCheck: data.factCheck || null, related: data.related || [], suggestions: data.suggestions || [], fresh: typewriter };
      // Auto-detect user corrections in the question and stash them so they
      // persist for the rest of the session. Very simple heuristic: if the
      // question starts with a correction opener or contains "actually" or
      // "that's wrong", store the full question as a correction.
      const q = question.toLowerCase();
      const looksLikeCorrection =
        /^(actually|no,?\s+it['']?s|no,?\s+they['']?re|correction[:,]|wrong\b|that['']?s\s+(wrong|incorrect|not right))/i.test(question) ||
        /you\s+(said|got|had|were)\s+.+\s+(wrong|actually|but|however)/i.test(question) ||
        /\bnot\s+\w+,?\s+(it['']?s|they['']?re|but)\s+/i.test(question);
      if (looksLikeCorrection) {
        setCorrections((prev) => [...prev, question].slice(-20));
      }
      setTurns((t) => [...t, nt]);
      setAllSources((prev) => { const seen = new Set(prev.map((s) => (s.title || "").toLowerCase())); return [...prev, ...(data.sources || []).filter((s) => !seen.has((s.title || "").toLowerCase()))]; });
      if (turns.length === 0) setSessions((s) => [{ q: question, ts: Date.now() }, ...s].slice(0, 40));
      if (!mutedRef.current) Audio.pop();

      // When videos arrive, merge into this turn's state
      videosPromise.then(({ videos }) => {
        if (videos && videos.length) {
          setTurns((prev) => prev.map((t) => t.id === turnId ? { ...t, videos } : t));
        }
      });
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
  // Debounce animation cookie writes: sliders fire many times per second while
  // dragging; writing to document.cookie on every tick contributes to lag.
  useEffect(() => {
    const t = setTimeout(() => setCookie("cb_animD", String(animDensity)), 500);
    return () => clearTimeout(t);
  }, [animDensity]);
  useEffect(() => {
    const t = setTimeout(() => setCookie("cb_animS", String(animSpeed)), 500);
    return () => clearTimeout(t);
  }, [animSpeed]);
  useEffect(() => {
    const t = setTimeout(() => setCookie("cb_animO", String(animOpacity)), 500);
    return () => clearTimeout(t);
  }, [animOpacity]);
  useEffect(() => { setCookie("cb_pal", paletteName); }, [paletteName]);
  useEffect(() => { setCookie("cb_accent", accentName); }, [accentName]);
  useEffect(() => { setCookie("cb_ca", customAccent); }, [customAccent]);
  useEffect(() => { try { localStorage.setItem("cb_saved", JSON.stringify(saved)); } catch {} }, [saved]);

    // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setCmdOpen((v) => !v); setTimeout(() => cmdRef.current?.focus(), 40); }
      else if (e.key === "Escape") { setCmdOpen(false); setSettingsOpen(false); setMobilePanel(false); setSavedOpen(false); }
      else if ((e.metaKey || e.ctrlKey) && e.key === "/") { e.preventDefault(); setSettingsOpen((v) => !v); }
      else if ((e.metaKey || e.ctrlKey) && e.key === "j") { e.preventDefault(); newSession(); }
      else if ((e.metaKey || e.ctrlKey) && e.key === "b") { e.preventDefault(); setSavedOpen((v) => !v); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
    return <Intro accent={accent} P={P} onEnter={() => { sfx(); setEntered(true); }} animationMode={animationMode} />;
  }

  const started = turns.length > 0 || busy;
  const exportList = saved.length ? saved : allSources;

  // Sort + filter + group the sources.
  const filteredSources = allSources.filter((s) => {
    if (!srcFilter.trim()) return true;
    const f = srcFilter.toLowerCase();
    return (s.title || "").toLowerCase().includes(f) || (s.authors || "").toLowerCase().includes(f) || (s.journal || "").toLowerCase().includes(f);
  });
  const sortedSources = [...filteredSources].sort((a, b) => {
    if (srcSort === "date") return (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0);
    if (srcSort === "database") return (a.journal || "").localeCompare(b.journal || "");
    return (b.relevance ?? 0) - (a.relevance ?? 0); // relevance
  });
  // Group when sorting by database or date.
  const grouped = (() => {
    if (srcSort === "database") {
      const g = {};
      for (const s of sortedSources) { const k = s.type || "Other"; (g[k] = g[k] || []).push(s); }
      return Object.entries(g);
    }
    if (srcSort === "date") {
      const g = {};
      for (const s of sortedSources) { const k = s.year || "Undated"; (g[k] = g[k] || []).push(s); }
      return Object.entries(g).sort((a, b) => (parseInt(b[0], 10) || 0) - (parseInt(a[0], 10) || 0));
    }
    return null; // relevance = flat list
  })();

  // Relevance is now an ABSOLUTE 0-100 score (70 pts topical match + 30 pts
  // source quality), not a relative ranking. Thresholds recalibrated to match:
  // 65+ is a genuinely strong match, 45-64 is partial, below 45 is tangential.
  const relColor = (r) => r >= 65 ? "#10b981" : r >= 45 ? "#d9a520" : "#9ca3af";
  const relLabel = (r) => r >= 65 ? "strong" : r >= 45 ? "partial" : "weak";
  const typeColor = (t) => t === "Preprint" ? "#d97706" : t === "Reference" ? "#7c3aed" : t === "Dataset" ? "#0284c7" : accent;

  const SourceCard = (s, i) => (
    <div key={i} className="cb-fade" style={{
      ...S.srcItem,
      background: hover === "src" + i ? withAlpha(accent, 0.06) : hoverCite === i + 1 ? withAlpha(accent, 0.07) : "transparent",
      transform: hover === "src" + i ? "translate3d(0, -1px, 0)" : "translate3d(0, 0, 0)",
    }} onMouseEnter={() => setHover("src" + i)} onMouseLeave={() => setHover("")}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5, flexWrap: "wrap" }}>
        {s.type && <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: typeColor(s.type), background: withAlpha(typeColor(s.type), 0.12), padding: "2px 6px", borderRadius: 5 }}>{s.type}</span>}
        {typeof s.relevance === "number" && <span title={`Relevance: ${relLabel(s.relevance)} match (absolute score, not relative to other results)`} style={{ fontSize: 9.5, fontWeight: 700, color: relColor(s.relevance), background: withAlpha(relColor(s.relevance), 0.12), padding: "2px 6px", borderRadius: 5 }}>{s.relevance}% {relLabel(s.relevance)}</span>}
        {s.year && <span style={{ fontSize: 10, color: P.faint }}>{s.year}</span>}
      </div>
      <a href={s.url} target="_blank" rel="noreferrer" style={{ ...S.srcTitle, color: hover === "src" + i ? accent : P.ink }}>{s.title || s.url}</a>
      <div style={S.srcMeta}>{[s.authors, s.journal].filter(Boolean).join(" · ")}{typeof s.citations === "number" && ` · ${s.citations.toLocaleString()} citations`}</div>
      <div style={S.srcRow}>
        <button style={{ ...S.chipMini, color: isSaved(s) ? at : P.ink2, background: isSaved(s) ? accent : "transparent", borderColor: isSaved(s) ? accent : P.line2 }} onClick={() => toggleSave(s)}>{isSaved(s) ? "★ Saved" : "☆ Save"}</button>
        <button
          style={{ ...S.chipMini, color: isPinned(s) ? at : P.ink2, background: isPinned(s) ? accent : "transparent", borderColor: isPinned(s) ? accent : P.line2 }}
          onClick={() => togglePin(s)}
          title={isPinned(s) ? "This source is pinned to the conversation" : "Pin this source so it stays in follow-ups"}
        >{isPinned(s) ? "📌 Pinned" : "📌 Pin"}</button>
        {s.authors && <button style={{ ...S.chipMini, color: accent, borderColor: P.line2 }} onClick={() => { setMobilePanel(false); ask(`papers by ${(s.authors || "").replace(" et al.", "")}`); }}>Author →</button>}
      </div>
    </div>
  );

  const SourcesInner = (
    <>
      <div style={S.srcHead}><span>Sources</span><span style={S.srcCount}>{allSources.length}</span></div>
      {pinnedSources.length > 0 && (
        <div style={{ padding: "8px 12px", margin: "0 0 10px", background: withAlpha(accent, 0.08), border: `1px solid ${withAlpha(accent, 0.3)}`, borderRadius: 8, fontSize: 12, color: accent, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span>📌 {pinnedSources.length} pinned {pinnedSources.length === 1 ? "source" : "sources"} — will stay in every follow-up</span>
          <button onClick={() => setPinnedSources([])} style={{ background: "transparent", border: "none", color: accent, cursor: "pointer", fontSize: 11, textDecoration: "underline" }}>Clear</button>
        </div>
      )}
      {corrections.length > 0 && (
        <div style={{ padding: "8px 12px", margin: "0 0 10px", background: withAlpha("#f59e0b", 0.08), border: `1px solid ${withAlpha("#f59e0b", 0.3)}`, borderRadius: 8, fontSize: 12, color: "#f59e0b", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span>✎ {corrections.length} {corrections.length === 1 ? "correction" : "corrections"} remembered</span>
          <button onClick={() => setCorrections([])} style={{ background: "transparent", border: "none", color: "#f59e0b", cursor: "pointer", fontSize: 11, textDecoration: "underline" }}>Clear</button>
        </div>
      )}
{allSources.length > 0 && (
        <>
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
        </>
      )}
      {saved.length > 0 && <div style={S.savedNote}>{saved.length} saved · exports use saved</div>}
      {zoteroOpen && (
        <div style={S.zBox}>
          <input style={S.zIn} placeholder="Zotero API key" value={zKey} onChange={(e) => setZKey(e.target.value)} />
          <input style={S.zIn} placeholder="Zotero user ID" value={zUser} onChange={(e) => setZUser(e.target.value)} />
          <button style={S.sBtnP} onClick={doZotero}>Save {exportList.length}</button>
          {zMsg && <div style={S.zMsg}>{zMsg}</div>}
        </div>
      )}
      <div style={S.srcList} className="cb-stagger">
        {allSources.length === 0 ? <div style={S.empty} className="cb-fade">Sources appear here as you research.</div> :
          sortedSources.length === 0 ? <div style={S.empty} className="cb-fade">No sources match "{srcFilter}".</div> :
          grouped ? grouped.map(([label, items]) => (
            <div key={label} className="cb-fade">
              <div style={S.srcGroupLabel}>{label} <span style={{ color: P.faint, fontWeight: 500 }}>· {items.length}</span></div>
              {items.map((s, i) => SourceCard(s, allSources.indexOf(s)))}
            </div>
          )) : sortedSources.map((s) => SourceCard(s, allSources.indexOf(s)))}
      </div>
    </>
  );

  return (
    <div style={S.page}>
      {animationMode !== "off" && <LivingBackground accent={accent} P={P} intensity={animationMode} preset={animPreset} density={animDensity} speed={animSpeed} opacity={animOpacity} paused={settingsOpen} />}
      <div style={S.grain} />
      <header style={S.header}>
        <div style={S.headInner}>
          <div style={{ ...S.brandRow, position: "relative" }}>
            <div
              onClick={(e) => {
                e.stopPropagation();
                easterEgg.trigger();
              }}
              style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}
            >
              <span key={easterEgg.wiggleKey} className={easterEgg.wiggleKey > 0 ? "cb-wiggle" : ""} style={{ display: "inline-flex" }}>
                <Mark size={22} accent={accent} glow={P.dark} />
              </span>
              <span style={S.brand}>Cerebrum<sup style={{ fontSize: "0.55em", fontWeight: 500, marginLeft: 2, opacity: 0.6, letterSpacing: "0.02em" }}>™</sup></span>
            </div>
            {easterEgg.render}
          </div>
          <div style={S.headActions}>
            {!isMobile && (
              <button className="cb-hbtn" style={S.cmdHint} onClick={() => { setCmdOpen(true); setTimeout(() => cmdRef.current?.focus(), 40); }} aria-label="Open search palette">
                <Icon name="search" size={14} />
                <span>Search</span>
                <kbd style={S.kbd}>{kbdLabel("K")}</kbd>
              </button>
            )}
            <button className="cb-hbtn" style={S.iconBtn} onClick={() => { sfx(); newSession(); }} title="New investigation" aria-label="New investigation">
              <Icon name="plus" size={17} />
              {!isMobile && <span style={S.iconBtnLabel}>New</span>}
            </button>
            <button
              className="cb-hbtn" style={{ ...S.iconBtn, ...(saved.length > 0 ? { color: accent } : {}) }}
              onClick={() => { sfx(); setSavedOpen(true); }}
              title={`Saved articles${saved.length ? ` (${saved.length})` : ""}`}
              aria-label={`Saved articles${saved.length ? `, ${saved.length}` : ""}`}
            >
              <Icon name={saved.length > 0 ? "bookmarkFilled" : "bookmark"} size={17} />
              {!isMobile && <span style={S.iconBtnLabel}>Saved</span>}
              {saved.length > 0 && <span style={S.countPill}>{saved.length}</span>}
            </button>
            <button className="cb-hbtn" style={S.iconBtn} onClick={() => setMuted(!muted)} title={muted ? "Unmute interface sounds" : "Mute interface sounds"} aria-label={muted ? "Unmute" : "Mute"}>
              <Icon name={muted ? "volumeOff" : "volumeOn"} size={17} />
            </button>
            <button className="cb-hbtn" style={S.iconBtn} onClick={() => { sfx(); setSettingsOpen(true); }} title="Settings" aria-label="Settings">
              <Icon name="settings" size={17} />
              {!isMobile && <span style={S.iconBtnLabel}>Settings</span>}
            </button>
          </div>
        </div>
      </header>

      <div style={S.scroll} ref={threadRef}>
        <div style={S.container}>
          {!started ? (
            <div style={S.hero} className="cb-hero">
              <div style={S.heroGlow} />
              <div style={S.heroMark}><Mark size={44} accent={accent} glow={P.dark} /></div>
              <h1 style={S.heroTitle}>Cerebrum</h1>
              <p style={{ fontSize: 17, color: P.ink2, maxWidth: 480, lineHeight: 1.6, marginBottom: 36, letterSpacing: "-0.01em" }}>AI-synthesized summaries of peer-reviewed literature.</p>
              <div style={{ ...S.searchShell, ...(hover === "in" ? S.searchShellActive : {}) }} onMouseEnter={() => setHover("in")} onMouseLeave={() => setHover("")}>
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, marginLeft: 4 }}><circle cx="11" cy="11" r="7" stroke={P.faint} strokeWidth="2" /><path d="M21 21l-4-4" stroke={P.faint} strokeWidth="2" strokeLinecap="round" /></svg>
                <input ref={inputRef} style={S.searchInput} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} placeholder="Ask a question, or search a researcher by name" />
                <MicButton onTranscript={(t) => setInput(t)} accent={accent} P={P} />
                <button style={S.searchBtn} onClick={() => ask()}>Inquire</button>
              </div>
              <div style={S.chips} className="cb-stagger">
                {suggestions.map((s, i) => (<button key={s} className="cb-fade" style={{ ...S.chip, ...(hover === "c" + i ? S.chipHover : {}) }} onMouseEnter={() => setHover("c" + i)} onMouseLeave={() => setHover("")} onClick={() => ask(s)}>{s}</button>))}
              </div>
              <div style={S.trustRow}>
                {["Europe PMC", "PubMed", "OpenAlex", "Crossref", "arXiv", "Semantic Scholar"].map((d) => <span key={d} style={S.trustItem}>{d}</span>)}
                <span style={{ ...S.trustItem, color: P.faint }}>+8 more</span>
              </div>
            </div>
          ) : (
            <div style={{ ...S.workspace, ...(isMobile ? S.workspaceMobile : {}) }}>
              <div style={S.thread}>
                {turns.map((t, ti) => (
                  <Turn key={ti} t={t} P={P} accent={accent} at={at} S={S} typewriter={typewriter && ti === turns.length - 1} last={ti === turns.length - 1} hoverCite={hoverCite} setHoverCite={setHoverCite} onRelated={(q) => ask(q)} citationStyle={citationStyle} setCitationStyle={setCitationStyle} />
                ))}
                {busy && (
                  <div style={S.turn}>
                    <div style={S.qLabel}><span style={S.qDot} />Searching</div>
                    <Skeleton P={P} />
                    <LoadingLine P={P} accent={accent} S={S} />
                  </div>
                )}
                {error && <div style={S.error}>{error}</div>}
                {turns.length > 0 && !busy && (
                  <div style={{ ...S.followShell, ...(hover === "f" ? S.searchShellActive : {}) }} onMouseEnter={() => setHover("f")} onMouseLeave={() => setHover("")}>
                    <input style={S.searchInput} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} placeholder="Ask a follow-up — it remembers the thread" />
                    <MicButton onTranscript={(t) => setInput(t)} accent={accent} P={P} />
                    <button style={S.searchBtn} onClick={() => ask()}>Ask</button>
                  </div>
                )}
              </div>
              {!isMobile && panelOpen && <aside style={S.panel}>{SourcesInner}</aside>}
            </div>
          )}
          <div style={S.foot}>
            <div style={{ fontSize: 11.5, color: P.faint, lineHeight: 1.55, maxWidth: 560, margin: "0 auto 14px", textAlign: "center" }}>
              AI-generated summaries from peer-reviewed literature. Always verify against the cited sources.
            </div>
            <div style={{ fontSize: 10.5, color: P.faint, letterSpacing: "0.02em" }}>
              <button onClick={() => setHowItWorksOpen(true)} style={{ color: P.faint, textDecoration: "none", borderBottom: `1px dotted ${P.faint}`, background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit" }}>How it works</button>
              <span style={{ margin: "0 8px" }}>·</span>
              <a href="/about" style={{ color: P.faint, textDecoration: "none", borderBottom: `1px dotted ${P.faint}` }}>About</a>
              <span style={{ margin: "0 8px" }}>·</span>
              <a href="/privacy" style={{ color: P.faint, textDecoration: "none", borderBottom: `1px dotted ${P.faint}` }}>Privacy</a>
              <span style={{ margin: "0 8px" }}>·</span>
              <a href="/terms" style={{ color: P.faint, textDecoration: "none", borderBottom: `1px dotted ${P.faint}` }}>Terms</a>
              <span style={{ margin: "0 8px" }}>·</span>
              <a href="/contact" style={{ color: P.faint, textDecoration: "none", borderBottom: `1px dotted ${P.faint}` }}>Contact</a>
              <span style={{ margin: "0 8px" }}>·</span>
              © {new Date().getFullYear()} Cerebrum™
            </div>
          </div>
        </div>
      </div>

      {started && isMobile && (
        <button style={S.mobSrcBtn} onClick={() => setMobilePanel(true)} aria-label={`Sources${allSources.length ? `, ${allSources.length}` : ""}`}>
          <Icon name="bookmark" size={15} />
          <span>Sources</span>
          {allSources.length > 0 && (
            <span style={{ fontSize: 11.5, fontWeight: 700, background: withAlpha(at, 0.22), padding: "2px 6px", borderRadius: 20, lineHeight: 1.3 }}>
              {allSources.length}
            </span>
          )}
        </button>
      )}
      {started && isMobile && mobilePanel && (<><div style={S.scrim} onClick={() => setMobilePanel(false)} /><aside style={{ ...S.panel, ...S.panelMobile }}><button style={{ ...S.ghostBtn, marginBottom: 14 }} onClick={() => setMobilePanel(false)}>✕ Close</button>{SourcesInner}</aside></>)}

      {cmdOpen && (
        <div style={S.cmdWrap} onClick={() => setCmdOpen(false)}>
          <div style={S.cmdBox} onClick={(e) => e.stopPropagation()} className="cb-pop">
            <div style={S.cmdInputRow}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke={P.faint} strokeWidth="2" /><path d="M21 21l-4-4" stroke={P.faint} strokeWidth="2" strokeLinecap="round" /></svg>
              <input ref={cmdRef} style={S.cmdInput} value={cmdQuery} onChange={(e) => setCmdQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { if (cmdSuggest.length) ask(cmdSuggest[0]); else if (filteredCmds[0]) filteredCmds[0].run(); } }} placeholder="Search or type a command…" />
              <kbd style={S.kbd}>esc</kbd>
            </div>
            <div style={S.cmdList}>
              {cmdSuggest.length > 0 && <div style={S.cmdSection}>Ask</div>}
              {cmdSuggest.map((s) => (<button key={s} style={S.cmdItem} onClick={() => ask(s)} onMouseEnter={(e) => e.currentTarget.style.background = withAlpha(accent, 0.1)} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}><span style={{ color: accent }}>→</span>{s}</button>))}
              <div style={S.cmdSection}>Commands</div>
              {filteredCmds.map((c) => (<button key={c.label} style={S.cmdItem} onClick={c.run} onMouseEnter={(e) => e.currentTarget.style.background = withAlpha(accent, 0.1)} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}><span>{c.label}</span>{c.hint && <kbd style={{ ...S.kbd, marginLeft: "auto" }}>{c.hint}</kbd>}</button>))}
            </div>
          </div>
        </div>
      )}

      {savedOpen && (
        <div style={S.modalWrap} onClick={() => setSavedOpen(false)} className="cb-backdrop">
          <div style={{ ...S.modal, width: 560 }} onClick={(e) => e.stopPropagation()} className="cb-modal">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <div style={S.modalTitle}>Saved articles</div>
              <span style={S.srcCount}>{saved.length}</span>
            </div>
            {saved.length === 0 ? (
              <div style={{ fontSize: 14, color: P.ink2, lineHeight: 1.6, padding: "20px 0 28px", textAlign: "center" }}>
                No saved articles yet.<br /><span style={{ fontSize: 13, color: P.faint }}>Tap ☆ Save on any source to keep it here. Saved articles stay on this device across sessions.</span>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                  <button style={S.sBtn} onClick={() => { sfx(); download("cerebrum-saved.ris", toRIS(saved)); }}>Export RIS</button>
                  <button style={S.sBtn} onClick={() => { sfx(); download("cerebrum-saved.bib", toBibTeX(saved)); }}>Export BibTeX</button>
                  <button style={{ ...S.sBtn, color: "#e5484d", borderColor: withAlpha("#e5484d", 0.35) }} onClick={() => { if (confirm("Remove all saved articles?")) setSaved([]); }}>Clear all</button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: "56vh", overflowY: "auto" }}>
                  {saved.map((s, i) => (
                    <div key={i} style={{ padding: "14px 12px", margin: "0 -12px", borderBottom: `1px solid ${P.line}` }}>
                      <a href={s.url} target="_blank" rel="noreferrer" style={{ ...S.srcTitle, fontSize: 14.5 }}>{s.title || s.url}</a>
                      <div style={S.srcMeta}>{[s.authors, s.journal, s.year].filter(Boolean).join(" · ")}{typeof s.citations === "number" && ` · ${s.citations.toLocaleString()} citations`}</div>
                      <div style={S.srcRow}>
                        <button style={{ ...S.chipMini, color: "#e5484d", borderColor: withAlpha("#e5484d", 0.35) }} onClick={() => setSaved((prev) => prev.filter((x) => (x.title || "").toLowerCase() !== (s.title || "").toLowerCase()))}>Remove</button>
                        {s.authors && <button style={{ ...S.chipMini, color: accent, borderColor: P.line2 }} onClick={() => { setSavedOpen(false); ask(`papers by ${(s.authors || "").replace(" et al.", "")}`); }}>Author →</button>}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            <button style={{ ...S.modalClose, marginTop: 20 }} onClick={() => setSavedOpen(false)}>Done</button>
          </div>
        </div>
      )}

      {settingsOpen && <Settings {...{ P, accent, at, S, PALETTES, ACCENTS, paletteName, setPaletteName, accentName, setAccentName, customAccent, setCustomAccent, answerLength, setAnswerLength, factCheck, setFactCheck, muted, setMuted, typewriter, setTypewriter, soundMode, setSoundMode, animationMode, setAnimationMode, animPreset, setAnimPreset, animDensity, setAnimDensity, animSpeed, setAnimSpeed, animOpacity, setAnimOpacity, sfx, setSessions, setSaved, close: () => setSettingsOpen(false) }} />}
      {howItWorksOpen && <HowItWorksModal P={P} accent={accent} close={() => setHowItWorksOpen(false)} />}
    </div>
  );
}


function Bibliography({ sources, P, accent, citationStyle, setCitationStyle }) {
  const [copied, setCopied] = useState(false);
  const styleOptions = [
    { key: "vancouver", label: "Vancouver" },
    { key: "apa", label: "APA" },
    { key: "mla", label: "MLA" },
    { key: "chicago", label: "Chicago" },
    { key: "bibtex", label: "BibTeX" },
  ];
  const copyAll = () => {
    const text = formatBibliography(sources, citationStyle);
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };
  const downloadFile = () => {
    const text = formatBibliography(sources, citationStyle);
    const ext = citationStyle === "bibtex" ? "bib" : "txt";
    download(`cerebrum-bibliography.${ext}`, text);
  };

  return (
    <div style={{ marginTop: 24, background: P.surface, border: `1px solid ${P.line}`, borderRadius: 12, padding: "18px 20px" }} className="cb-fade">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 4, height: 18, background: accent, borderRadius: 2 }} />
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-0.005em", color: P.ink }}>Bibliography</div>
          <div style={{ fontSize: 11.5, color: P.faint }}>{sources.length} source{sources.length === 1 ? "" : "s"}</div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <select value={citationStyle} onChange={(e) => setCitationStyle(e.target.value)} style={{
            padding: "6px 10px", fontSize: 12, fontWeight: 500,
            background: P.bg, color: P.ink, border: `1px solid ${P.line}`,
            borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
            outline: "none",
          }}>
            {styleOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          <button onClick={copyAll} style={bibBtn(P, accent)} title="Copy all citations">
            {copied ? "✓ Copied" : "Copy"}
          </button>
          <button onClick={downloadFile} style={bibBtn(P, accent)} title="Download as file">Download</button>
        </div>
      </div>
      <ol className="cb-stagger" style={{ margin: 0, padding: 0, listStyle: "none", counterReset: "biblio" }}>
        {sources.map((src, i) => (
          <BibEntry key={i} source={src} index={i + 1} P={P} accent={accent} style={citationStyle} className="cb-fade" />
        ))}
      </ol>
    </div>
  );
}

function BibEntry({ source, index, P, accent, style, className }) {
  const [hover, setHover] = useState(false);
  const formatted = formatCitation(source, style, index);
  return (
    <li id={`ref-${index}`} className={className} style={{
      padding: "12px 4px 12px 4px",
      borderTop: index === 1 ? "none" : `1px solid ${P.line}`,
      display: "flex", gap: 12, alignItems: "flex-start",
      transition: "background 0.15s cubic-bezier(0.16, 1, 0.3, 1)",
      background: hover ? withAlpha(accent, 0.03) : "transparent",
      borderRadius: 6,
      opacity: 0,
    }} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div style={{
        flexShrink: 0, minWidth: 26,
        color: accent, fontWeight: 700, fontSize: 12,
        fontVariantNumeric: "tabular-nums",
        paddingTop: 1,
      }}>{index}.</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {(source.retracted || source.concern) && (
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "3px 8px", marginBottom: 6,
            background: source.retracted ? "rgba(229, 72, 77, 0.12)" : "rgba(217, 165, 32, 0.14)",
            border: `1px solid ${source.retracted ? "#e5484d" : "#d9a520"}`,
            borderRadius: 6, fontSize: 11, fontWeight: 700,
            color: source.retracted ? "#e5484d" : "#d9a520",
            letterSpacing: "0.02em",
          }}>
            <span>⚠</span>
            <span>{source.retracted ? "RETRACTED" : "EXPRESSION OF CONCERN"}</span>
          </div>
        )}
        {style === "bibtex" ? (
          <pre style={{ fontSize: 11.5, fontFamily: "'JetBrains Mono', monospace", color: P.ink2, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{formatted}</pre>
        ) : (
          <div style={{ fontSize: 13, lineHeight: 1.55, color: P.ink }} dangerouslySetInnerHTML={{
            __html: formatted
              .replace(/\*([^*]+)\*/g, '<em style="font-style: italic;">$1</em>')
              .replace(/\n/g, "<br>")
          }} />
        )}
        {source.tldr && (
          <div style={{
            fontSize: 12.5, color: P.ink2, marginTop: 8,
            padding: "8px 12px", background: withAlpha(accent, 0.05),
            borderLeft: `2px solid ${accent}`, borderRadius: 4,
            lineHeight: 1.5, fontStyle: "italic",
          }}>
            <span style={{ fontWeight: 600, fontStyle: "normal", color: accent, fontSize: 10.5, letterSpacing: "0.05em", textTransform: "uppercase", marginRight: 6 }}>TL;DR</span>
            {source.tldr}
          </div>
        )}
        {source.url && (
          <a href={source.url} target="_blank" rel="noreferrer" style={{
            fontSize: 11.5, color: accent, textDecoration: "none",
            marginTop: 6, display: "inline-block",
            wordBreak: "break-all",
          }}>{source.url.replace(/^https?:\/\//, "").slice(0, 60)}{source.url.length > 60 ? "..." : ""} ↗</a>
        )}
        {(source.citations != null || source.type) && (
          <div style={{ fontSize: 10.5, color: P.faint, marginTop: 4, display: "flex", gap: 10 }}>
            {source.type && <span>{source.type}</span>}
            {source.citations != null && <span>{source.citations.toLocaleString()} citation{source.citations === 1 ? "" : "s"}</span>}
          </div>
        )}
      </div>
    </li>
  );
}
function bibBtn(P, accent) {
  return {
    padding: "6px 10px", fontSize: 12, fontWeight: 500,
    background: "transparent", color: P.ink2,
    border: `1px solid ${P.line}`, borderRadius: 8,
    cursor: "pointer", fontFamily: "inherit",
    transition: "border-color 0.15s cubic-bezier(0.16, 1, 0.3, 1), color 0.15s cubic-bezier(0.16, 1, 0.3, 1)",
  };
}

function Turn({ t, P, accent, at, S, typewriter, hoverCite, setHoverCite, onRelated, citationStyle, setCitationStyle }) {
  const shown = useTypewriter(t.answer, typewriter && t.fresh);
  const done = shown === t.answer;
  return (
    <div style={S.turn} className="cb-rise">
      <div style={S.qLabel}><span style={S.qDot} />Inquiry</div>
      <h2 style={S.headline}>{t.q}</h2>
      <div style={S.answerCard}>
        {renderAnswer(shown, t.sources, P, accent, hoverCite, setHoverCite)}
        {done && t.source && (
          <div style={S.byline}>
            <span style={S.aiTag}>AI-generated · verify with sources</span>
          </div>
        )}
        {done && t.answer && t.answer.length > 40 && <AnswerPlayer text={t.answer} accent={accent} P={P} />}
      </div>
      {done && t.factCheck && <FactCheck fc={t.factCheck} P={P} accent={accent} />}
      {done && t.suggestions && t.suggestions.length > 0 && (
        <div style={{ marginTop: 18, display: "flex", flexWrap: "wrap", gap: 8 }} className="cb-fade">
          {t.suggestions.map((s, i) => (
            <button
              key={i}
              onClick={() => s.query && onRelated && onRelated(s.query)}
              disabled={!s.query}
              style={{
                padding: "8px 14px", fontSize: 13, fontWeight: 500,
                background: s.query ? withAlpha(accent, 0.1) : "transparent",
                color: s.query ? accent : P.faint,
                border: `1px solid ${s.query ? withAlpha(accent, 0.3) : P.line}`,
                borderRadius: 20, cursor: s.query ? "pointer" : "default",
                fontFamily: "inherit", transition: "background 0.15s cubic-bezier(0.16, 1, 0.3, 1)",
              }}
            >
              {s.label} {s.query && <span style={{ opacity: 0.6, marginLeft: 4 }}>→</span>}
            </button>
          ))}
        </div>
      )}
      {done && t.sources && t.sources.length > 0 && (
        <Bibliography sources={t.sources} P={P} accent={accent} citationStyle={citationStyle} setCitationStyle={setCitationStyle} />
      )}
      {done && (
        <div style={{ marginTop: 20 }} className="cb-fade">
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: accent, marginBottom: 10 }}>Related videos</div>
          {t.videos && t.videos.length > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }} className="cb-stagger">
              {t.videos.slice(0, 6).map((v, i) => (
                <a key={v.id || i} href={v.url} target="_blank" rel="noreferrer" className="cb-fade cb-card" style={{ display: "block", background: P.surface, border: `1px solid ${P.line}`, borderRadius: 10, overflow: "hidden", textDecoration: "none", color: P.ink, opacity: 0 }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.boxShadow = P.shadow; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = P.line; e.currentTarget.style.boxShadow = "none"; }}>
                  <div style={{ position: "relative", width: "100%", aspectRatio: "16/9", background: P.bg, overflow: "hidden" }}>
                    <img src={v.thumbnail} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                  </div>
                  <div style={{ padding: "10px 12px" }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.35, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", marginBottom: 4 }}>{v.title}</div>
                    <div style={{ fontSize: 11, color: P.faint }}>{v.author}</div>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <a href={`https://www.youtube.com/results?search_query=${encodeURIComponent(t.q)}`} target="_blank" rel="noreferrer"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "16px 18px",
                background: P.surface,
                border: `1px solid ${P.line}`,
                borderRadius: 12,
                textDecoration: "none",
                color: P.ink,
                fontSize: 13.5,
                transition: "border-color 0.15s cubic-bezier(0.16, 1, 0.3, 1), transform 0.15s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.15s cubic-bezier(0.16, 1, 0.3, 1)",
                width: "100%",
                boxSizing: "border-box",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = P.shadow; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = P.line; e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}>
              <div style={{
                width: 44, height: 44, borderRadius: 8, flexShrink: 0,
                background: `linear-gradient(135deg, ${withAlpha(accent, 0.15)}, ${withAlpha(accent, 0.05)})`,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: accent, fontSize: 20,
              }}>▶</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, marginBottom: 3, color: P.ink }}>Search YouTube for this topic</div>
                <div style={{ fontSize: 12, color: P.faint }}>Video search proxies are unreliable, this opens YouTube directly</div>
              </div>
              <span style={{ color: accent, fontSize: 16, flexShrink: 0 }}>→</span>
            </a>
          )}
        </div>
      )}
      {done && t.related && t.related.length > 0 && (
        <div style={S.relatedWrap} className="cb-fade">
          <div style={S.relatedLabel}>Continue the investigation</div>
          <div style={S.relatedList}>
            {t.related.map((r, i) => (
              <button key={i} style={S.relatedBtn} onClick={() => onRelated(r)} onMouseEnter={(e) => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.color = accent; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = P.line2; e.currentTarget.style.color = P.ink2; }}>
                <span>{r}</span><span style={{ color: accent }}>→</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function HowItWorksModal({ P, accent, close }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const Section = ({ title, children }) => (
    <div style={{ marginBottom: 26 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.06em", color: accent, marginBottom: 8, textTransform: "uppercase" }}>{title}</div>
      <div style={{ fontSize: 14, lineHeight: 1.65, color: P.ink }}>{children}</div>
    </div>
  );
  const List = ({ items }) => (
    <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
      {items.map((it, i) => <li key={i} style={{ marginBottom: 6, fontSize: 13.5, lineHeight: 1.6, color: P.ink2 }}>{it}</li>)}
    </ul>
  );

  return (
    <div onClick={close} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} className="cb-backdrop">
      <div onClick={(e) => e.stopPropagation()} style={{ background: P.bg, borderRadius: 16, maxWidth: 640, width: "100%", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)", border: `1px solid ${P.line}` }} className="cb-modal">
        <div style={{ position: "sticky", top: 0, background: P.bg, padding: "20px 28px 16px", borderBottom: `1px solid ${P.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: "-0.01em", color: P.ink }}>How Cerebrum works</div>
            <div style={{ fontSize: 12.5, color: P.faint, marginTop: 2 }}>A short, honest technical explanation. No marketing.</div>
          </div>
          <button onClick={close} style={{ background: "none", border: "none", fontSize: 22, color: P.faint, cursor: "pointer", lineHeight: 1, padding: 4 }}>×</button>
        </div>
        <div style={{ padding: "22px 28px 30px" }}>
          <Section title="The retrieval layer">
            Every query fans out to 10-plus scholarly databases in parallel, all free and keyless.
            <List items={[
              <><strong>Europe PMC</strong> — biomedical, includes preprints</>,
              <><strong>PubMed</strong> (NCBI E-utilities) — biomedical, automatic term mapping</>,
              <><strong>OpenAlex</strong> — cross-disciplinary, concept graph</>,
              <><strong>Crossref</strong> — DOI-registered works, checked for retraction status</>,
              <><strong>arXiv</strong> — physics, math, CS, quantitative biology</>,
              <><strong>Semantic Scholar</strong> — includes auto-generated TL;DR summaries</>,
              <><strong>bioRxiv</strong> preprints (via OpenAlex)</>,
              <><strong>DOAJ, PLOS, Zenodo, DataCite</strong> — additional coverage</>,
            ]} />
          </Section>
          <Section title="Query intelligence">
            <List items={[
              <><strong>Species queries</strong> (Latin binomials like Populus angustifolia) are wrapped in quoted phrases with strict species-level filtering — sibling species in the same genus get dropped or flagged.</>,
              <><strong>Author queries</strong> hit OpenAlex's author disambiguation endpoint and require every name token to match. If no confirmed author is found, we say so honestly instead of guessing.</>,
              <><strong>Acronym expansion</strong> for common scientific abbreviations.</>,
              <><strong>Fallback ladder</strong>: if a strict query returns nothing, we retry looser, then plain — a search rarely comes back empty when papers exist.</>,
            ]} />
          </Section>
          <Section title="Trust and safety">
            <List items={[
              <><strong>Retraction flagging</strong> via Crossref's crossmark data on the top papers per query.</>,
              <><strong>No fabricated citations</strong> — the AI is instructed to never invent DOIs, authors, or journal names.</>,
              <><strong>Honest hedging</strong> — when literature is thin, the model says so instead of filling the gap with confidence.</>,
            ]} />
          </Section>
          <Section title="The AI layer">
            Answers are synthesized by free-tier language models, tried in order: OpenRouter free models (Gemini 2.0 Flash, Llama 3.3 70B, Qwen 2.5 72B, Mistral Small, DeepSeek Chat, Llama 3.1 8B), then Cloudflare Workers AI, then Pollinations as a keyless last resort. If everything fails, raw paper abstracts are shown instead of a fabricated answer.
          </Section>
          <Section title="Known limitations">
            <List items={[
              "New preprints may not be indexed anywhere for hours or days after posting.",
              "The AI can misinterpret papers — verify claims against the cited source.",
              "Free AI models rate-limit under load; answers may fall to slower fallback tiers.",
              "Non-English literature is under-indexed across most of these databases.",
            ]} />
          </Section>
          <Section title="What Cerebrum is not">
            <List items={[
              "Not a replacement for reading the actual papers",
              "Not a systematic review tool (helps scope one, but you still need PRISMA methodology)",
              "Not medical, legal, or financial advice",
              "Not paywalled or ad-supported",
            ]} />
          </Section>
          <div style={{ fontSize: 11.5, color: P.faint, marginTop: 24, paddingTop: 16, borderTop: `1px solid ${P.line}` }}>Cerebrum™ · Built by Vaticay</div>
        </div>
      </div>
    </div>
  );
}

// A slider that keeps drag state LOCAL. The parent's state only updates when
// the user releases the pointer, so dragging doesn't cause the whole app to
// re-render 60 times per second. This is the difference between silky and
// molasses when Settings is open.
function LocalSlider({ label, value, min, max, step, format, onCommit, accent, P }) {
  const [local, setLocal] = useState(value);
  // Sync down when the parent value changes (e.g. Reset button)
  useEffect(() => { setLocal(value); }, [value]);
  const commit = () => { if (local !== value) onCommit(local); };
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: P.ink2 }}>{label}</span>
        <span style={{ fontSize: 11, color: P.faint, fontVariantNumeric: "tabular-nums" }}>{format(local)}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={local}
        onChange={(e) => setLocal(parseFloat(e.target.value))}
        onMouseUp={commit}
        onTouchEnd={commit}
        onKeyUp={commit}
        style={{ width: "100%", accentColor: accent, cursor: "pointer" }}
      />
    </div>
  );
}

function Settings({ P, accent, at, S, PALETTES, ACCENTS, paletteName, setPaletteName, accentName, setAccentName, customAccent, setCustomAccent, answerLength, setAnswerLength, factCheck, setFactCheck, muted, setMuted, typewriter, setTypewriter, soundMode, setSoundMode, animationMode, setAnimationMode, animPreset, setAnimPreset, animDensity, setAnimDensity, animSpeed, setAnimSpeed, animOpacity, setAnimOpacity, sfx, setSessions, setSaved, close }) {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState("look");
  const [confirmClear, setConfirmClear] = useState(false);
  const SOUND_MODES = [["pulse", "Soft pulse"], ["shimmer", "Airy shimmer"], ["warm", "Warm hum"], ["minimal", "Minimal"]];

  const TABS = [
    ["look", "Look"],
    ["answers", "Answers"],
    ["motion", "Motion"],
    ["audio", "Audio"],
    ["data", "Data"],
  ];

  // --- shared local sub-components so every row reads the same ---
  const Group = ({ title, hint, children }) => (
    <div style={{ marginBottom: 26 }}>
      <div style={{ fontSize: 13, fontWeight: 650, color: P.ink, letterSpacing: "-0.01em", marginBottom: hint ? 3 : 10 }}>{title}</div>
      {hint && <div style={{ fontSize: 12, color: P.faint, lineHeight: 1.5, marginBottom: 11 }}>{hint}</div>}
      {children}
    </div>
  );

  const Row = ({ label, desc, control }) => (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: 16, padding: "12px 0",
      borderBottom: `1px solid ${P.line}`,
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, color: P.ink, fontWeight: 500, letterSpacing: "-0.005em" }}>{label}</div>
        {desc && <div style={{ fontSize: 11.5, color: P.faint, lineHeight: 1.45, marginTop: 2 }}>{desc}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{control}</div>
    </div>
  );

  const Switch = ({ on, onChange, label }) => (
    <button
      role="switch" aria-checked={on} aria-label={label}
      onClick={() => { sfx(); onChange(!on); }}
      style={{
        width: 44, height: 26, borderRadius: 20, position: "relative",
        background: on ? accent : P.line2,
        border: "none", cursor: "pointer", padding: 0,
        transition: "background var(--cb-quick, 160ms) var(--cb-out, ease)",
      }}
    >
      <span style={{
        position: "absolute", top: 3, left: 3,
        width: 20, height: 20, borderRadius: "50%",
        background: on ? at : P.bg,
        transform: on ? "translateX(18px)" : "translateX(0)",
        transition: "transform var(--cb-quick, 160ms) var(--cb-out, ease)",
        boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
      }} />
    </button>
  );

  const Seg = ({ value, options, onChange }) => (
    <div style={{ display: "inline-flex", background: P.bg, border: `1px solid ${P.line}`, borderRadius: 9, padding: 2, gap: 2 }}>
      {options.map(([v, label]) => (
        <button key={v} onClick={() => { sfx(); onChange(v); }}
          style={{
            padding: "6px 12px", fontSize: 12.5, fontWeight: 550,
            background: value === v ? accent : "transparent",
            color: value === v ? at : P.ink2,
            border: "none", borderRadius: 7, cursor: "pointer", fontFamily: "inherit",
            letterSpacing: "-0.005em",
          }}>{label}</button>
      ))}
    </div>
  );

  const PresetCard = ({ id, label, sub, active }) => (
    <button className="cb-btn" onClick={() => { sfx(); setAnimPreset(id); }}
      style={{
        display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2,
        padding: "11px 12px", textAlign: "left",
        background: active ? withAlpha(accent, 0.1) : "transparent",
        border: `1px solid ${active ? accent : P.line}`,
        borderRadius: 10, cursor: "pointer", fontFamily: "inherit",
      }}>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: active ? accent : P.ink }}>{label}</span>
      <span style={{ fontSize: 10.5, color: P.faint, lineHeight: 1.3 }}>{sub}</span>
    </button>
  );

  return (
    <div style={S.modalWrap} onClick={close} className="cb-backdrop">
      <div
        onClick={(e) => e.stopPropagation()}
        className="cb-modal"
        style={{
          background: P.surface,
          border: `1px solid ${P.line2}`,
          borderRadius: isMobile ? 18 : 18,
          width: 520, maxWidth: "100%",
          maxHeight: isMobile ? "92vh" : "86vh",
          display: "flex", flexDirection: "column",
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
          boxShadow: "0 24px 70px rgba(0,0,0,0.42)",
          overflow: "hidden",
        }}
      >
        {/* Header + tabs (sticky) */}
        <div style={{ padding: isMobile ? "18px 18px 0" : "22px 24px 0", borderBottom: `1px solid ${P.line}`, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div style={{ fontSize: 18, fontWeight: 680, color: P.ink, letterSpacing: "-0.02em" }}>Settings</div>
            <button onClick={close} aria-label="Close settings" style={{
              background: "transparent", border: "none", color: P.faint,
              width: 32, height: 32, borderRadius: 8, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }} className="cb-hbtn"><Icon name="close" size={17} /></button>
          </div>
          <div style={{ display: "flex", gap: 2, overflowX: "auto", scrollbarWidth: "none" }}>
            {TABS.map(([id, label]) => (
              <button key={id} onClick={() => { sfx(); setTab(id); }}
                style={{
                  padding: "9px 13px 11px", fontSize: 13, fontWeight: 550,
                  background: "transparent", border: "none",
                  borderBottom: `2px solid ${tab === id ? accent : "transparent"}`,
                  color: tab === id ? P.ink : P.faint,
                  cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
                  letterSpacing: "-0.01em", marginBottom: -1,
                }}>{label}</button>
            ))}
          </div>
        </div>

        {/* Scrollable body */}
        <div key={tab} className="cb-fade" style={{ padding: isMobile ? "18px" : "22px 24px", overflowY: "auto", flex: 1, WebkitOverflowScrolling: "touch" }}>

          {tab === "look" && (
            <>
              <Group title="Theme">
                <div style={S.palRow}>
                  {Object.keys(PALETTES).map((pn) => (
                    <button key={pn} style={{ ...S.palCard, background: PALETTES[pn].bg, borderColor: paletteName === pn ? accent : PALETTES[pn].line2, borderWidth: paletteName === pn ? 2 : 1 }} onClick={() => { sfx(); setPaletteName(pn); }}>
                      <div style={{ display: "flex", gap: 4 }}>
                        <span style={{ width: 22, height: 22, borderRadius: 6, background: PALETTES[pn].surface, border: `1px solid ${PALETTES[pn].line2}` }} />
                        <span style={{ width: 22, height: 22, borderRadius: 6, background: accent }} />
                      </div>
                      <span style={{ fontSize: 12, color: PALETTES[pn].ink, fontWeight: 550 }}>{pn}</span>
                    </button>
                  ))}
                </div>
              </Group>
              <Group title="Accent colour" hint="Used for citations, highlights, and the background wash.">
                <div style={S.accentRow}>
                  {Object.keys(ACCENTS).map((an) => (
                    <button key={an} title={an} aria-label={an} style={{ ...S.accentDot, background: ACCENTS[an], transform: (!customAccent && accentName === an) ? "scale(1.15)" : "none", boxShadow: (!customAccent && accentName === an) ? `0 0 0 2px ${P.surface}, 0 0 0 4px ${ACCENTS[an]}` : "none" }} onClick={() => { sfx(); setCustomAccent(""); setAccentName(an); }} />
                  ))}
                  <label style={S.customDot} title="Custom colour">
                    <input type="color" value={accent} onChange={(e) => setCustomAccent(e.target.value)} style={{ opacity: 0, width: 0, height: 0, position: "absolute" }} />
                    <span style={{ fontSize: 15, color: P.ink2 }}>+</span>
                  </label>
                </div>
              </Group>
            </>
          )}

          {tab === "answers" && (
            <>
              <Group title="Response">
                <Row label="Answer length"
                  desc="How much detail to write by default."
                  control={<Seg value={answerLength} options={[["short", "Short"], ["medium", "Medium"], ["long", "Long"]]} onChange={setAnswerLength} />} />
                <Row label="Verify claims"
                  desc="A second pass checks each claim against the cited abstracts and flags anything unsupported. Checks source-support, not real-world truth."
                  control={<Switch on={factCheck} onChange={setFactCheck} label="Verify claims" />} />
                <Row label="Animated reveal"
                  desc="Type answers out as they stream in."
                  control={<Switch on={typewriter} onChange={setTypewriter} label="Animated reveal" />} />
              </Group>
            </>
          )}

          {tab === "motion" && (
            <>
              <Group title="Motion level" hint="Full runs every effect. Subtle thins them out. Off makes the background static — best for low-power devices.">
                <Seg value={animationMode} options={[["cinematic", "Full"], ["subtle", "Subtle"], ["off", "Off"]]} onChange={setAnimationMode} />
              </Group>
              {animationMode !== "off" && (
                <>
                  <Group title="Background">
                    <div style={{ fontSize: 10.5, color: P.faint, marginBottom: 8, letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 650 }}>Ambient</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
                      <PresetCard id="aurora" label="Aurora" sub="Drifting colour wash" active={animPreset === "aurora"} />
                      <PresetCard id="orbs" label="Soft orbs" sub="Slow glowing spheres" active={animPreset === "orbs"} />
                      <PresetCard id="grid" label="Grid" sub="Static dot lattice" active={animPreset === "grid"} />
                      <PresetCard id="none" label="Solid" sub="No motion at all" active={animPreset === "none"} />
                    </div>
                    <div style={{ fontSize: 10.5, color: P.faint, marginBottom: 8, letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 650 }}>Scientific</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <PresetCard id="dna" label="Helix" sub="Rotating double strand" active={animPreset === "dna"} />
                      <PresetCard id="neurons" label="Neurons" sub="Linked synapse network" active={animPreset === "neurons"} />
                      <PresetCard id="particles" label="Particles" sub="Drifting point field" active={animPreset === "particles"} />
                      <PresetCard id="waves" label="Waves" sub="Layered sine curves" active={animPreset === "waves"} />
                      <PresetCard id="circuits" label="Circuits" sub="Signal traces" active={animPreset === "circuits"} />
                      <PresetCard id="starfield" label="Starfield" sub="Radial streaks" active={animPreset === "starfield"} />
                    </div>
                  </Group>
                  <Group title="Fine tuning">
                    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                      <LocalSlider label="Density" value={animDensity} min={0.3} max={2.5} step={0.1} format={(v) => v.toFixed(1) + "\u00d7"} onCommit={setAnimDensity} accent={accent} P={P} />
                      <LocalSlider label="Speed" value={animSpeed} min={0.2} max={3} step={0.1} format={(v) => v.toFixed(1) + "\u00d7"} onCommit={setAnimSpeed} accent={accent} P={P} />
                      <LocalSlider label="Opacity" value={animOpacity} min={0.2} max={1.5} step={0.1} format={(v) => Math.round(v * 100) + "%"} onCommit={setAnimOpacity} accent={accent} P={P} />
                      <button className="cb-btn" onClick={() => { sfx(); setAnimPreset("aurora"); setAnimDensity(1); setAnimSpeed(1); setAnimOpacity(1); }}
                        style={{ fontSize: 12, padding: "8px 12px", background: "transparent", border: `1px solid ${P.line}`, borderRadius: 8, color: P.ink2, cursor: "pointer", fontFamily: "inherit", alignSelf: "flex-start", fontWeight: 500 }}>Reset to defaults</button>
                    </div>
                  </Group>
                </>
              )}
            </>
          )}

          {tab === "audio" && (
            <>
              <Group title="Interface sound">
                <Row label="Sound effects"
                  desc="Subtle tones on search, dictation, and selection."
                  control={<Switch on={!muted} onChange={(v) => setMuted(!v)} label="Sound effects" />} />
              </Group>
              <Group title="Search tone" hint="Plays while a search runs. Tap to preview.">
                <div style={{ ...S.soundGrid, opacity: muted ? 0.4 : 1, pointerEvents: muted ? "none" : "auto" }}>
                  {SOUND_MODES.map(([id, name]) => (
                    <button key={id} style={{ ...S.soundBtn, ...(soundMode === id ? S.soundBtnActive : {}) }} onClick={() => { setSoundMode(id); Audio.preview(id); }}>
                      <span>{name}</span>
                      {soundMode === id && <Icon name="check" size={13} style={{ color: accent }} />}
                    </button>
                  ))}
                </div>
              </Group>
              <Group title="Read answers aloud" hint="The default voice runs on Cerebrum's servers \u2014 free, no key required. For studio-grade narration, add your own ElevenLabs key; it never leaves this device.">
                <TtsVoiceSetting P={P} accent={accent} at={at} S={S} sfx={sfx} />
                <ElevenLabsSetting P={P} accent={accent} at={at} S={S} sfx={sfx} />
              </Group>
            </>
          )}

          {tab === "data" && (
            <>
              <Group title="Local data" hint="Cerebrum stores your saved articles, session history, and preferences in this browser only. Nothing is sent to a server or tied to an account.">
                <Row label="Saved articles & sessions"
                  desc="Clearing this cannot be undone."
                  control={
                    confirmClear ? (
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => { setSessions([]); setSaved([]); setConfirmClear(false); sfx(); }}
                          style={{ padding: "7px 12px", fontSize: 12.5, fontWeight: 600, background: "#e5484d", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "inherit" }}>Confirm</button>
                        <button onClick={() => setConfirmClear(false)}
                          style={{ padding: "7px 12px", fontSize: 12.5, fontWeight: 500, background: "transparent", color: P.ink2, border: `1px solid ${P.line}`, borderRadius: 8, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmClear(true)}
                        style={{ padding: "7px 12px", fontSize: 12.5, fontWeight: 500, background: "transparent", color: "#e5484d", border: `1px solid ${withAlpha("#e5484d", 0.4)}`, borderRadius: 8, cursor: "pointer", fontFamily: "inherit" }}>Clear all</button>
                    )
                  } />
              </Group>
              <Group title="Keyboard shortcuts">
                <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  {[
                    [kbdLabel("K"), "Open search palette"],
                    [kbdLabel("J"), "New investigation"],
                    [kbdLabel("B"), "Saved articles"],
                    [kbdLabel("/"), "Settings"],
                    ["Esc", "Close any panel"],
                  ].map(([key, desc]) => (
                    <div key={desc} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 0", borderBottom: `1px solid ${P.line}` }}>
                      <span style={{ fontSize: 13, color: P.ink2 }}>{desc}</span>
                      <kbd style={S.kbd}>{key}</kbd>
                    </div>
                  ))}
                </div>
              </Group>
            </>
          )}
        </div>

        {/* Footer (sticky) */}
        <div style={{ padding: isMobile ? "14px 18px" : "14px 24px", borderTop: `1px solid ${P.line}`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span style={{ fontSize: 11.5, color: P.faint }}>Stored on this device</span>
          <button onClick={close}
            style={{ padding: "9px 20px", fontSize: 13.5, fontWeight: 600, background: accent, color: at, border: "none", borderRadius: 9, cursor: "pointer", fontFamily: "inherit", letterSpacing: "-0.01em" }}>Done</button>
        </div>
      </div>
    </div>
  );
}


function makeStyles(P, accent, at, isMobile = false) {
  const font = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  const pad = isMobile ? 16 : 24;
  return {
    gate: { minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: P.bg, padding: 20, fontFamily: font, position: "relative", overflow: "hidden" },
    gateGlow: { position: "absolute", width: 600, height: 600, borderRadius: "50%", background: `radial-gradient(circle, ${withAlpha(accent, P.dark ? 0.14 : 0.08)}, transparent 68%)`, top: "20%", filter: "blur(30px)", pointerEvents: "none" },
    gateInner: { textAlign: "center", maxWidth: 440, position: "relative", zIndex: 1 },
    gateKicker: { fontSize: 12, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: accent, marginBottom: 14 },
    gateTitle: { fontSize: 46, fontWeight: 750, letterSpacing: "-0.03em", color: P.ink, marginBottom: 14, lineHeight: 1 },
    gateSub: { fontSize: 16, color: P.ink2, marginBottom: 32, lineHeight: 1.6, letterSpacing: "-0.01em" },
    gateBtn: { display: "inline-flex", alignItems: "center", gap: 10, padding: "13px 28px", fontSize: 15, fontWeight: 600, background: accent, color: at, border: "none", borderRadius: 10, cursor: "pointer", fontFamily: font, boxShadow: `0 4px 16px ${withAlpha(accent, 0.35)}`, letterSpacing: "-0.01em" },
    gateNote: { fontSize: 12.5, color: P.faint, marginTop: 18 },
    page: { minHeight: "100dvh", height: "100dvh", background: P.bg, color: P.ink, fontFamily: font, WebkitFontSmoothing: "antialiased", display: "flex", flexDirection: "column", position: "relative" },
    grain: { position: "fixed", inset: 0, pointerEvents: "none", opacity: P.grain, zIndex: 100, backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")" },
    header: { flexShrink: 0, borderBottom: `1px solid ${P.line}`, background: withAlpha(P.bg, 0.8), backdropFilter: "blur(12px)", position: "sticky", top: 0, zIndex: 20 },
    headInner: { maxWidth: 1080, margin: "0 auto", padding: `0 ${pad}px`, height: 58, display: "flex", alignItems: "center", justifyContent: "space-between" },
    brandRow: { display: "flex", alignItems: "center", gap: 10, cursor: "pointer" },
    brand: { fontWeight: 700, fontSize: 19, letterSpacing: "-0.02em", color: P.ink },
    headActions: { display: "flex", alignItems: "center", gap: isMobile ? 2 : 4 },
    cmdHint: { display: "flex", alignItems: "center", gap: 8, background: P.surface, border: `1px solid ${P.line2}`, color: P.ink2, padding: "7px 8px 7px 12px", borderRadius: 9, cursor: "pointer", fontSize: 13, fontFamily: font, boxShadow: P.shadowSm, marginRight: 4 },
    kbd: { fontSize: 11, fontFamily: font, color: P.faint, background: P.bg, border: `1px solid ${P.line2}`, borderRadius: 5, padding: "1px 6px", fontWeight: 550 },
    ghostBtn: { background: "transparent", border: "none", color: P.ink2, padding: isMobile ? "8px 8px" : "8px 12px", borderRadius: 8, cursor: "pointer", fontSize: isMobile ? 14 : 13.5, fontWeight: 550, fontFamily: font, letterSpacing: "-0.01em" },
    // Icon-first header button. On desktop it shows icon + label; on mobile it
    // collapses to a 40px square tap target (Apple HIG minimum is 44, we're at
    // 40 + 4 gap which reads correctly and keeps the bar compact).
    iconBtn: {
      background: "transparent", border: "none", color: P.ink2,
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      gap: 7,
      height: 38,
      minWidth: isMobile ? 40 : 38,
      padding: isMobile ? "0 8px" : "0 11px",
      borderRadius: 9, cursor: "pointer",
      fontSize: 13.5, fontWeight: 550, fontFamily: font,
      letterSpacing: "-0.01em",
      position: "relative",
    },
    iconBtnLabel: { lineHeight: 1 },
    countPill: {
      fontSize: 10.5, fontWeight: 700, lineHeight: 1,
      background: accent, color: at,
      padding: "3px 5px", borderRadius: 20,
      minWidth: 16, textAlign: "center",
      marginLeft: isMobile ? 0 : -2,
      position: isMobile ? "absolute" : "static",
      top: isMobile ? 2 : undefined,
      right: isMobile ? 2 : undefined,
    },
    scroll: { flex: 1, overflowY: "auto" , paddingBottom: isMobile ? 88 : 0},
    container: { maxWidth: 1080, margin: "0 auto", padding: `0 ${pad}px`, minHeight: "100%", display: "flex", flexDirection: "column" },
    hero: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "48px 0 72px", position: "relative" },
    heroGlow: { position: "absolute", width: 620, height: 620, borderRadius: "50%", background: `radial-gradient(circle, ${withAlpha(accent, P.dark ? 0.12 : 0.07)}, transparent 65%)`, top: "4%", filter: "blur(50px)", pointerEvents: "none" },
    heroMark: { marginBottom: 30, position: "relative" },
    heroTitle: { fontSize: isMobile ? 50 : 76, fontWeight: 750, letterSpacing: "-0.045em", lineHeight: 0.95, color: P.ink, marginBottom: 14, position: "relative" },
    heroSub: { fontSize: isMobile ? 15.5 : 18, color: P.ink2, maxWidth: 460, lineHeight: 1.5, marginBottom: 40, letterSpacing: "-0.012em", position: "relative", fontWeight: 400 },
    searchShell: { display: "flex", alignItems: "center", gap: 10, width: "100%", maxWidth: 620, background: P.surface, border: `1px solid ${P.line2}`, borderRadius: 16, padding: isMobile ? "7px 7px 7px 14px" : "8px 8px 8px 16px", boxShadow: P.shadow, transition: "border-color 0.15s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.15s cubic-bezier(0.16, 1, 0.3, 1)", position: "relative" },
    searchShellActive: { borderColor: accent, boxShadow: `${P.shadow}, 0 0 0 4px ${withAlpha(accent, 0.14)}` },
    searchInput: { flex: 1, border: "none", outline: "none", background: "transparent", fontFamily: font, fontSize: 16, color: P.ink, minWidth: 0, letterSpacing: "-0.01em" },
    searchBtn: { fontSize: 14.5, fontWeight: 600, background: accent, color: at, border: "none", padding: isMobile ? "12px 16px" : "12px 22px", borderRadius: 10, cursor: "pointer", fontFamily: font, flexShrink: 0, letterSpacing: "-0.01em", boxShadow: `0 2px 10px ${withAlpha(accent, 0.32)}` },
    chips: { display: "flex", flexWrap: "wrap", gap: 9, justifyContent: "center", marginTop: 24, maxWidth: 620, position: "relative" },
    chip: { fontSize: 13.5, color: P.ink2, background: P.surface, border: `1px solid ${P.line}`, borderRadius: 22, padding: "9px 15px", cursor: "pointer", transition: "background 0.15s cubic-bezier(0.16, 1, 0.3, 1), color 0.15s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.15s cubic-bezier(0.16, 1, 0.3, 1), transform 0.1s cubic-bezier(0.16, 1, 0.3, 1)", fontFamily: font, boxShadow: P.shadowSm, letterSpacing: "-0.01em" },
    chipHover: { borderColor: accent, color: accent, transform: "translate3d(0, -2px, 0)", boxShadow: `0 4px 12px ${withAlpha(accent, 0.15)}` },
    trustRow: { display: "flex", flexWrap: "wrap", gap: 18, justifyContent: "center", marginTop: 44, opacity: 0.7 },
    trustItem: { fontSize: 12, fontWeight: 550, color: P.ink2, letterSpacing: "0.015em" },
    workspace: { display: "grid", gridTemplateColumns: "1fr 288px", gap: 40, alignItems: "start", padding: isMobile ? "22px 0 20px" : "36px 0 20px", flex: 1 },
    workspaceMobile: { gridTemplateColumns: "1fr", gap: 0 },
    thread: { minWidth: 0 },
    turn: { marginBottom: isMobile ? 30 : 40 },
    qLabel: { fontSize: 12, fontWeight: 650, letterSpacing: "0.08em", textTransform: "uppercase", color: accent, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 },
    qDot: { width: 6, height: 6, borderRadius: "50%", background: accent, boxShadow: P.dark ? `0 0 8px ${accent}` : "none" },
    headline: { fontWeight: 680, fontSize: isMobile ? 19 : 26, lineHeight: 1.25, marginBottom: isMobile ? 14 : 18, color: P.ink, letterSpacing: "-0.022em" },
    answerCard: { background: P.surface, border: `1px solid ${P.line}`, borderRadius: isMobile ? 14 : 16, padding: isMobile ? "16px 15px" : "22px 26px", boxShadow: P.shadow },
    byline: { fontSize: 12, color: P.faint, letterSpacing: "0.01em", borderTop: `1px solid ${P.line}`, paddingTop: 13, marginTop: 18, display: "flex" },
    loading: { display: "flex", alignItems: "center", gap: 12, color: P.ink2, fontSize: 14, padding: "14px 0 0" },
    spinner: { width: 16, height: 16, border: `2px solid ${P.line2}`, borderTopColor: accent, borderRadius: "50%", display: "inline-block", animation: "cbspin 0.7s linear infinite" },
    error: { padding: "14px 16px", background: withAlpha("#e5484d", 0.1), color: "#e5484d", borderRadius: 12, fontSize: 14, border: `1px solid ${withAlpha("#e5484d", 0.25)}` },
    followShell: { display: "flex", alignItems: "center", gap: 8, background: P.surface, border: `1px solid ${P.line2}`, borderRadius: 13, padding: "6px 6px 6px 16px", boxShadow: P.shadow, transition: "border-color 0.15s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.15s cubic-bezier(0.16, 1, 0.3, 1)", marginTop: 8 },
    relatedWrap: { marginTop: 18 },
    relatedLabel: { fontSize: 11.5, fontWeight: 650, letterSpacing: "0.06em", textTransform: "uppercase", color: P.faint, marginBottom: 10 },
    relatedList: { display: "flex", flexDirection: "column", gap: 8 },
    relatedBtn: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, textAlign: "left", padding: "12px 16px", fontSize: 14, background: P.surface, color: P.ink2, border: `1px solid ${P.line2}`, borderRadius: 11, cursor: "pointer", fontFamily: font, transition: "background 0.15s cubic-bezier(0.16, 1, 0.3, 1), color 0.15s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.15s cubic-bezier(0.16, 1, 0.3, 1), transform 0.1s cubic-bezier(0.16, 1, 0.3, 1)", boxShadow: P.shadowSm, letterSpacing: "-0.01em" },
    panel: { position: "sticky", top: 24, background: P.surface, border: `1px solid ${P.line}`, borderRadius: 16, padding: "18px 18px", boxShadow: P.shadow, maxHeight: "calc(100dvh - 130px)", overflowY: "auto" },
    panelMobile: { position: "fixed", top: 0, right: 0, height: "100dvh", width: "88vw", maxWidth: 350, borderRadius: 0, maxHeight: "none", zIndex: 30, boxShadow: "-8px 0 40px rgba(0,0,0,0.35)" },
    srcHead: { display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 14, fontWeight: 650, color: P.ink, marginBottom: 14, letterSpacing: "-0.01em" },
    srcCount: { fontSize: 11.5, fontWeight: 600, color: accent, background: withAlpha(accent, 0.12), padding: "3px 9px", borderRadius: 20 },
    srcActions: { display: "flex", gap: 6, marginBottom: 12 },
    srcFilterInput: { width: "100%", padding: "8px 11px", fontSize: 12.5, border: `1px solid ${P.line2}`, background: P.bg, color: P.ink, borderRadius: 8, outline: "none", fontFamily: font, marginBottom: 8 },
    sortTabs: { display: "flex", gap: 3, background: P.bg, padding: 3, borderRadius: 9, marginBottom: 14, border: `1px solid ${P.line}` },
    sortTab: { flex: 1, padding: "6px", fontSize: 11.5, background: "transparent", color: P.ink2, border: "none", borderRadius: 6, cursor: "pointer", fontFamily: font, fontWeight: 550, transition: "background 0.15s cubic-bezier(0.16, 1, 0.3, 1), color 0.15s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.15s cubic-bezier(0.16, 1, 0.3, 1), transform 0.1s cubic-bezier(0.16, 1, 0.3, 1)" },
    sortTabActive: { background: P.surface, color: P.ink, boxShadow: P.shadowSm, fontWeight: 600 },
    srcGroupLabel: { fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: accent, margin: "14px 0 8px", paddingBottom: 5, borderBottom: `1px solid ${P.line}` },
    sBtn: { flex: 1, fontSize: 12, padding: "8px", background: P.bg, color: P.ink2, border: `1px solid ${P.line2}`, borderRadius: 8, cursor: "pointer", fontFamily: font, fontWeight: 550 },
    sBtnP: { flex: 1, fontSize: 12, padding: "8px", background: accent, color: at, border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontFamily: font },
    savedNote: { fontSize: 11.5, color: accent, marginBottom: 12 },
    zBox: { background: P.bg, border: `1px solid ${P.line}`, borderRadius: 10, padding: 12, marginBottom: 12, display: "flex", flexDirection: "column", gap: 7 },
    zIn: { padding: "9px 11px", fontSize: 12.5, border: `1px solid ${P.line2}`, background: P.surface, color: P.ink, borderRadius: 7, outline: "none", fontFamily: font },
    zMsg: { fontSize: 11.5, color: accent },
    srcList: { display: "flex", flexDirection: "column", gap: 4 },
    empty: { fontSize: 13, color: P.faint, lineHeight: 1.5, padding: "8px 0" },
    srcItem: { padding: "13px 12px", margin: "0 -12px", borderRadius: 12, transition: "background 0.2s cubic-bezier(0.16, 1, 0.3, 1), transform 0.15s cubic-bezier(0.16, 1, 0.3, 1)", borderBottom: `1px solid ${P.line}` },
    srcTitle: { fontSize: 13.5, textDecoration: "none", lineHeight: 1.4, fontWeight: 550, display: "block", marginBottom: 5, transition: "color 0.15s cubic-bezier(0.16, 1, 0.3, 1)", letterSpacing: "-0.01em" },
    srcMeta: { fontSize: 12, color: P.ink2, lineHeight: 1.45 },
    srcRow: { display: "flex", gap: 7, marginTop: 9 },
    chipMini: { fontSize: 11.5, padding: "5px 10px", border: "1px solid", borderRadius: 7, cursor: "pointer", fontFamily: font, fontWeight: 550, background: "transparent", transition: "background 0.15s cubic-bezier(0.16, 1, 0.3, 1), color 0.15s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.15s cubic-bezier(0.16, 1, 0.3, 1), transform 0.1s cubic-bezier(0.16, 1, 0.3, 1)" },
    foot: { marginTop: "auto", padding: "20px 0 26px", textAlign: "center" },
    disclaimer: { fontSize: 11.5, color: P.ink2, lineHeight: 1.55, maxWidth: 560, margin: "0 auto 16px", padding: "10px 16px", background: withAlpha(accent, 0.05), border: `1px solid ${P.line}`, borderRadius: 10 },
    footDbs: { fontSize: 11, letterSpacing: "0.04em", color: P.faint, lineHeight: 1.7 },
    aiTag: { fontSize: 11, color: P.faint, fontWeight: 550, letterSpacing: "0.01em", display: "inline-flex", alignItems: "center", gap: 5 },
    mobSrcBtn: {
      position: "fixed",
      // Sit above the iOS home indicator / browser toolbar, not on top of it
      bottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
      right: 16,
      background: accent, color: at, border: "none", borderRadius: 24,
      padding: "11px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer",
      boxShadow: `0 6px 20px ${withAlpha(accent, 0.35)}`,
      zIndex: 20, fontFamily: font, letterSpacing: "-0.01em",
      display: "inline-flex", alignItems: "center", gap: 7,
    },
    scrim: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 25, },
    cmdWrap: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "12vh", zIndex: 50, },
    cmdBox: { width: 560, maxWidth: "92vw", background: P.surface, border: `1px solid ${P.line2}`, borderRadius: 16, boxShadow: "0 24px 70px rgba(0,0,0,0.45)", overflow: "hidden", fontFamily: font },
    cmdInputRow: { display: "flex", alignItems: "center", gap: 11, padding: "16px 18px", borderBottom: `1px solid ${P.line}` },
    cmdInput: { flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 16, color: P.ink, fontFamily: font },
    cmdList: { maxHeight: 340, overflowY: "auto", padding: 8 },
    cmdSection: { fontSize: 11, fontWeight: 650, letterSpacing: "0.06em", textTransform: "uppercase", color: P.faint, padding: "10px 12px 6px" },
    cmdItem: { width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "11px 12px", fontSize: 14, color: P.ink, background: "transparent", border: "none", borderRadius: 9, cursor: "pointer", fontFamily: font, textAlign: "left", transition: "background 0.12s" },
    modalWrap: { position: "fixed", inset: 0, background: P.dark ? "rgba(0,0,0,0.72)" : "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 40, padding: 16 },
    modal: { background: P.surface, border: `1px solid ${P.line2}`, borderRadius: 20, padding: 28, width: 440, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", fontFamily: font, boxShadow: "0 24px 70px rgba(0,0,0,0.4)" },
    modalTitle: { fontSize: 21, fontWeight: 700, color: P.ink, marginBottom: 22, letterSpacing: "-0.02em" },
    setLabel: { fontSize: 11.5, textTransform: "uppercase", letterSpacing: "0.08em", color: P.faint, marginBottom: 10, marginTop: 4, fontWeight: 650 },
    palRow: { display: "flex", gap: 10, marginBottom: 22 },
    palCard: { flex: 1, display: "flex", flexDirection: "column", gap: 10, padding: "12px", borderRadius: 12, cursor: "pointer", border: "1px solid", alignItems: "flex-start", fontFamily: font },
    accentRow: { display: "flex", flexWrap: "wrap", gap: 13, marginBottom: 22, alignItems: "center" },
    accentDot: { width: 26, height: 26, borderRadius: "50%", border: "none", cursor: "pointer", transition: "transform 0.15s" },
    customDot: { width: 26, height: 26, borderRadius: "50%", border: `1px dashed ${P.line2}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" },
    segment: { display: "flex", gap: 4, background: P.bg, padding: 4, borderRadius: 11, marginBottom: 22, border: `1px solid ${P.line}` },
    segBtn: { flex: 1, padding: "9px", fontSize: 13, background: "transparent", color: P.ink2, border: "none", borderRadius: 8, cursor: "pointer", textTransform: "capitalize", fontFamily: font, fontWeight: 550, transition: "background 0.15s cubic-bezier(0.16, 1, 0.3, 1), color 0.15s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.15s cubic-bezier(0.16, 1, 0.3, 1), transform 0.1s cubic-bezier(0.16, 1, 0.3, 1)" },
    segActive: { background: P.surface, color: P.ink, boxShadow: P.shadowSm, fontWeight: 600 },
    toggle: { width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", fontSize: 13.5, background: P.bg, color: P.ink2, border: `1px solid ${P.line2}`, borderRadius: 10, cursor: "pointer", fontFamily: font, fontWeight: 550, marginBottom: 8 },
    toggleOn: { color: P.ink, borderColor: withAlpha(accent, 0.4), background: withAlpha(accent, 0.06) },
    toggleKnob: { width: 34, height: 20, borderRadius: 12, position: "relative", transition: "border-color 0.15s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.15s cubic-bezier(0.16, 1, 0.3, 1)", display: "inline-block", flexShrink: 0 },
    setNote: { fontSize: 12, color: P.faint, lineHeight: 1.5, marginBottom: 18, marginTop: 2 },
    clearAll: { width: "100%", padding: "11px", fontSize: 13, background: "transparent", color: "#e5484d", border: `1px solid ${withAlpha("#e5484d", 0.35)}`, borderRadius: 10, cursor: "pointer", marginBottom: 12, marginTop: 8, fontFamily: font, fontWeight: 550 },
    modalClose: { width: "100%", padding: "13px", fontSize: 14.5, fontWeight: 600, background: accent, color: at, border: "none", borderRadius: 11, cursor: "pointer", fontFamily: font, letterSpacing: "-0.01em" },
    shortcuts: { fontSize: 11, color: P.faint, textAlign: "center", marginTop: 16, letterSpacing: "0.02em" },
    soundGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 4, transition: "opacity 0.15s" },
    soundBtn: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 13px", fontSize: 13, background: P.bg, color: P.ink2, border: `1px solid ${P.line2}`, borderRadius: 9, cursor: "pointer", fontFamily: font, fontWeight: 550 },
    soundBtnActive: { color: P.ink, borderColor: withAlpha(accent, 0.5), background: withAlpha(accent, 0.06) },
  };
}

if (typeof document !== "undefined") {
  if (!document.getElementById("cb-fonts")) {
    const l = document.createElement("link");
    l.id = "cb-fonts"; l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;550;600;650;700;750&display=swap";
    document.head.appendChild(l);
  }
  if (!document.getElementById("cb-anim")) {
    const st = document.createElement("style");
    st.id = "cb-anim";
    st.textContent = `
      /* ============================================================
         CEREBRUM MOTION SYSTEM
         Design tokens first, then keyframes, then utilities.
         Every animation touches only transform / opacity / filter.
         ============================================================ */
      :root {
        /* Durations */
        --cb-instant: 90ms;
        --cb-quick: 160ms;
        --cb-base: 280ms;
        --cb-slow: 460ms;
        --cb-ambient: 720ms;
        /* Easings */
        --cb-out: cubic-bezier(0.16, 1, 0.3, 1);        /* decisive ease-out */
        --cb-inout: cubic-bezier(0.65, 0, 0.35, 1);      /* symmetric */
        --cb-entrance: cubic-bezier(0.22, 1, 0.36, 1);   /* soft arrival */
        --cb-exit: cubic-bezier(0.4, 0, 1, 1);           /* accelerate away */
      }

      /* ---- Keyframes ---- */
      @keyframes cbspin { to { transform: rotate(360deg); } }
      @keyframes cbShimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
      @keyframes cbFade { from { opacity: 0; } to { opacity: 1; } }

      /* Blur-in entrances. The slight defocus on arrival reads as depth rather
         than as a slide, which is what separates crafted motion from templated
         motion. Blur is GPU-composited, same cost class as transform. */
      @keyframes cbRise {
        from { opacity: 0; transform: translate3d(0, 10px, 0); filter: blur(6px); }
        to   { opacity: 1; transform: translate3d(0, 0, 0);    filter: blur(0); }
      }
      @keyframes cbPop {
        from { opacity: 0; transform: translate3d(0, 6px, 0);  filter: blur(4px); }
        to   { opacity: 1; transform: translate3d(0, 0, 0);    filter: blur(0); }
      }
      @keyframes cbHero {
        from { opacity: 0; transform: translate3d(0, 14px, 0); filter: blur(8px); }
        to   { opacity: 1; transform: translate3d(0, 0, 0);    filter: blur(0); }
      }
      @keyframes cbGate {
        from { opacity: 0; transform: translate3d(0, 12px, 0); filter: blur(6px); }
        to   { opacity: 1; transform: translate3d(0, 0, 0);    filter: blur(0); }
      }
      @keyframes cbModal {
        from { opacity: 0; transform: translate3d(0, 14px, 0) scale(0.985); filter: blur(5px); }
        to   { opacity: 1; transform: translate3d(0, 0, 0) scale(1);        filter: blur(0); }
      }
      @keyframes cbBackdrop { from { opacity: 0; } to { opacity: 1; } }
      @keyframes cbPulse { 0%, 100% { opacity: 0.95; } 50% { opacity: 0.35; } }
      /* Synapse loader: each node brightens and swells as the signal passes */
      @keyframes cbSynapse {
        0%, 100% { opacity: 0.25; transform: scale(0.75); }
        30%      { opacity: 1;    transform: scale(1.25); }
        60%      { opacity: 0.4;  transform: scale(0.9); }
      }

      /* Ambient breathing for the logo — long, barely perceptible */
      @keyframes cb-float {
        0%, 100% { transform: translate3d(0, 0, 0); }
        50%      { transform: translate3d(0, -3px, 0); }
      }
      @keyframes cb-wiggle {
        0%, 100% { transform: rotate(0deg); }
        30%      { transform: rotate(-5deg); }
        70%      { transform: rotate(4deg); }
      }
      @keyframes cb-burst {
        0%   { opacity: 0; transform: translate3d(0, 0, 0) scale(0.4); }
        18%  { opacity: 1; }
        100% { opacity: 0; transform: translate3d(var(--cb-dx, 0), var(--cb-dy, 60px), 0) scale(0.7) rotate(var(--cb-rot, 24deg)); }
      }
      @keyframes cb-egg-in {
        from { opacity: 0; transform: translate3d(0, -6px, 0); filter: blur(4px); }
        to   { opacity: 1; transform: translate3d(0, 0, 0);    filter: blur(0); }
      }
      /* Caret for streaming text — soft breath, not a hard blink */
      @keyframes cbCaret { 0%, 45% { opacity: 1; } 55%, 100% { opacity: 0.15; } }

      /* ---- Entrance utilities ---- */
      .cb-fade   { animation: cbFade   var(--cb-base) var(--cb-out) both; }
      .cb-rise   { animation: cbRise   var(--cb-slow) var(--cb-entrance) both; }
      .cb-pop    { animation: cbPop    var(--cb-base) var(--cb-entrance) both; }
      .cb-gate   { animation: cbGate   var(--cb-ambient) var(--cb-entrance) both; }
      .cb-hero   { animation: cbHero   var(--cb-ambient) var(--cb-entrance) both; }
      .cb-modal  { animation: cbModal  var(--cb-base) var(--cb-entrance) both; will-change: transform, opacity, filter; }
      .cb-backdrop { animation: cbBackdrop var(--cb-quick) var(--cb-out) both; }
      .cb-wiggle { animation: cb-wiggle 380ms var(--cb-out); }

      /* ---- Staggered cascades ---- */
      .cb-stagger > *:nth-child(1)  { animation-delay: 0ms; }
      .cb-stagger > *:nth-child(2)  { animation-delay: 45ms; }
      .cb-stagger > *:nth-child(3)  { animation-delay: 90ms; }
      .cb-stagger > *:nth-child(4)  { animation-delay: 135ms; }
      .cb-stagger > *:nth-child(5)  { animation-delay: 180ms; }
      .cb-stagger > *:nth-child(6)  { animation-delay: 225ms; }
      .cb-stagger > *:nth-child(7)  { animation-delay: 270ms; }
      .cb-stagger > *:nth-child(8)  { animation-delay: 315ms; }
      .cb-stagger > *:nth-child(9)  { animation-delay: 360ms; }
      .cb-stagger > *:nth-child(10) { animation-delay: 405ms; }
      .cb-stagger > *:nth-child(n+11) { animation-delay: 450ms; }

      /* ---- Micro-interactions ---- */
      *, *::before, *::after { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
      button, a { -webkit-tap-highlight-color: transparent; }

      /* GLOBAL button physics. Applied to every <button> so the whole app feels
         consistent without having to tag each one. Transform-only, so it
         composites on the GPU and never triggers layout. */
      button {
        transition: transform var(--cb-instant) var(--cb-out),
                    opacity   var(--cb-quick)   var(--cb-out),
                    box-shadow var(--cb-quick)  var(--cb-out),
                    background-color var(--cb-quick) var(--cb-out),
                    border-color var(--cb-quick) var(--cb-out),
                    color var(--cb-quick) var(--cb-out);
      }
      button:not(:disabled):hover  { transform: translate3d(0, -1.5px, 0); }
      button:not(:disabled):active { transform: scale(0.975) translate3d(0, 0, 0); transition-duration: 60ms; }
      button:disabled { opacity: 0.5; cursor: not-allowed; }

      /* Header action buttons get a soft surface on hover. Inline React styles
         can't express :hover, so the affordance lives here. */
      .cb-hbtn:hover:not(:disabled) { background: var(--cb-hover-surface, rgba(128,128,128,0.10)) !important; }
      .cb-hbtn:active:not(:disabled) { background: var(--cb-hover-surface, rgba(128,128,128,0.16)) !important; }

      /* Opt-in class kept for elements that aren't <button> but should feel like one */
      .cb-btn {
        transition: transform var(--cb-instant) var(--cb-out),
                    opacity   var(--cb-quick)   var(--cb-out),
                    box-shadow var(--cb-quick)  var(--cb-out);
      }
      .cb-btn:hover:not(:disabled)  { transform: translate3d(0, -1.5px, 0); }
      .cb-btn:active:not(:disabled) { transform: scale(0.975); transition-duration: 60ms; }

      .cb-card {
        transition: transform var(--cb-quick) var(--cb-out),
                    border-color var(--cb-quick) var(--cb-out),
                    box-shadow var(--cb-quick) var(--cb-out);
      }
      .cb-card:hover  { transform: translate3d(0, -2px, 0); }
      .cb-card:active { transform: translate3d(0, -1px, 0) scale(0.995); transition-duration: 60ms; }

      /* Focus rings — visible for keyboard users, invisible for mouse users */
      :focus { outline: none; }
      :focus-visible {
        outline: 2px solid currentColor;
        outline-offset: 2px;
        border-radius: 6px;
      }

      /* Range sliders */
      input[type="range"] { -webkit-appearance: none; height: 4px; border-radius: 2px; }
      input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none; appearance: none;
        width: 16px; height: 16px; border-radius: 50%;
        background: currentColor; cursor: pointer;
        transition: transform var(--cb-instant) var(--cb-out);
      }
      input[type="range"]::-webkit-slider-thumb:hover  { transform: scale(1.18); }
      input[type="range"]::-webkit-slider-thumb:active { transform: scale(1.32); }

      /* Respect users who ask for reduced motion. Content still appears —
         it just arrives without travel or blur. */
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after {
          animation-duration: 0.01ms !important;
          animation-iteration-count: 1 !important;
          transition-duration: 0.01ms !important;
        }
        .cb-rise, .cb-pop, .cb-hero, .cb-gate, .cb-modal { filter: none !important; }
      }

      * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
      html, body {
        margin: 0;
        overflow-x: hidden;
        max-width: 100%;
        /* Prevent the browser's pull-to-refresh gesture. Swiping down at the top
           of the page was reloading the app mid-search on mobile, which is
           indistinguishable from a crash from the user's side. "contain" keeps
           scroll chaining inside the app without disabling normal scrolling. */
        overscroll-behavior-y: contain;
        /* Older engines that don't understand dvh fall back to vh via this var. */
        min-height: 100vh;
        min-height: 100dvh;
      }
      /* Respect notches and home indicators on phones */
      @supports (padding: max(0px)) {
        body {
          padding-left: env(safe-area-inset-left);
          padding-right: env(safe-area-inset-right);
        }
      }
      /* Prevent iOS from auto-zooming when focusing an input (any font-size
         below 16px triggers it, which then breaks the layout on return). */
      input, textarea, select { font-size: 16px; }
      html, body { margin: 0; overflow-x: hidden; max-width: 100%; }
      a, p, h1, h2, span { overflow-wrap: break-word; word-break: break-word; }
      /* superseded by the input/textarea/select rule above */
      input::placeholder { color: inherit; opacity: 0.5; }
      ::-webkit-scrollbar { width: 10px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.25); border-radius: 5px; border: 3px solid transparent; background-clip: padding-box; }
      ::-webkit-scrollbar-thumb:hover { background: rgba(128,128,128,0.4); background-clip: padding-box; }
    `;
    document.head.appendChild(st);
  }
}

// Route at the mount level. If the URL is an info page, render that instead
// of the full App. This avoids any React hook-ordering issues from returning
// early inside App, and guarantees the info page shows immediately with no
// intro screen flash.
function Root() {
  const p = typeof window !== "undefined"
    ? window.location.pathname.replace(/\.html$/, "").replace(/\/+$/, "")
    : "";
  if (p === "/about") return <InfoPage page="about" />;
  if (p === "/privacy") return <InfoPage page="privacy" />;
  if (p === "/terms") return <InfoPage page="terms" />;
  if (p === "/contact") return <InfoPage page="contact" />;
  return <App />;
}

createRoot(document.getElementById("root")).render(<Root />);
