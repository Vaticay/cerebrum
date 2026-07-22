import React, { useState, useRef, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";

function setCookie(k, v) { try { document.cookie = `${k}=${encodeURIComponent(v)}; path=/; max-age=31536000; SameSite=Lax`; } catch {} }
function getCookie(k) { try { const m = document.cookie.match(new RegExp("(?:^|; )" + k + "=([^;]*)")); return m ? decodeURIComponent(m[1]) : null; } catch { return null; } }

// Platform-aware modifier label: ⌘ on Mac, Ctrl elsewhere.
const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");
const MOD = IS_MAC ? "⌘" : "Ctrl";
const kbdLabel = (key) => `${MOD}${IS_MAC ? "" : "+"}${key}`;

const LOADING_MESSAGES = [
  "Looking through the microscope",
  "Consulting the literature",
  "Cross-referencing citations",
  "Peering into petri dishes",
  "Dusty Waz H3rE",
  "Calibrating the spectrometer",
  "Sifting through preprints",
  "Interrogating the abstracts",
  "Following the paper trail",
  "Centrifuging the results",
  "Decoding the methods sections",
  "Chasing down DOIs",
  "Scanning the stacks",
  "Titrating the findings",
  "Querying fourteen databases",
  "Reading between the citations",
  "Isolating the signal",
  "Culturing conclusions",
  "Amplifying the relevant hits",
  "Filtering out the noise",
  "Consulting the peer reviewers",
  "Dusting off the journals",
  "Mining the metadata",
  "Sequencing the sources",
  "Distilling the abstracts",
  "Weighing the evidence",
  "Tracing the references",
  "Pipetting the papers",
  "Surveying the field",
  "Parsing the preprints",
  "Examining the specimens",
  "Reviewing the methodology",
  "Synthesizing the studies",
  "Gathering the citations",
  "Focusing the lens",
  "Running the analysis",
  "Cataloguing the results",
  "Combing the archives",
  "Digging through the data",
  "Assembling the bibliography",
  "Checking the replication",
  "Measuring the effect sizes",
  "Extracting the key findings",
  "Screening the abstracts",
  "Collating the research",
  "Verifying the sources",
  "Indexing the literature",
  "Untangling the results",
  "Polishing the conclusions",
  "Consulting fourteen databases at once",
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
const ACCENTS = { Emerald: "#059669", Indigo: "#4f46e5", Sky: "#0284c7", Amber: "#d97706", Rose: "#e11d48", Violet: "#7c3aed", Teal: "#0d9488" };

function accentText(hex) { const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16); return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#111" : "#fff"; }
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
  const clean = (text || "").replace(/^#{1,6}\s*/gm, "");
  return clean.split(/\n{2,}/).map((para, pi) => (
    <p key={pi} style={{ fontSize: 16, lineHeight: 1.7, margin: "0 0 16px", color: P.ink, letterSpacing: "-0.006em" }}>
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
                style={{ fontSize: 10.5, verticalAlign: "super", color: accent, textDecoration: "none", fontWeight: 700, padding: "1px 4px", borderRadius: 5, background: hoverCite === n ? withAlpha(accent, 0.16) : withAlpha(accent, 0.09), transition: "background 0.15s", cursor: "pointer" }}>{n}</a>;
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
  useEffect(() => {
    const id = setInterval(() => { setMsg(LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)]); }, 1800);
    return () => clearInterval(id);
  }, []);
  return (
    <div style={S.loading}>
      <span style={S.spinner} />
      <span key={msg} className="cb-fade">{msg}…</span>
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
    const resize = () => { canvas.width = canvas.offsetWidth * dpr; canvas.height = canvas.offsetHeight * dpr; };
    resize(); window.addEventListener("resize", resize);
    const ctx = canvas.getContext("2d");

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
      const maskRx = (isMobile ? 160 : 240) * dpr; // horizontal radius of the text zone
      const maskRy = (isMobile ? 140 : 180) * dpr; // vertical radius
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

      // Neurons with pulsing glow
      for (let i = 0; i < pos.length; i++) {
        const p = pos[i]; if (p.t <= 0.02) continue;
        const nMask = maskFade(p.x, p.y);
        if (nMask <= 0.02) continue;
        const n = neurons[i];
        const pulse = 0.7 + 0.3 * Math.sin(elapsed * n.pulseSpeed + n.pulse);
        const rBase = n.r * dpr;
        const finalA = p.t * pulse * nMask;
        // outer glow
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rBase * 5);
        glow.addColorStop(0, `rgba(${ar},${ag},${ab},${0.5 * finalA})`);
        glow.addColorStop(1, `rgba(${ar},${ag},${ab},0)`);
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(p.x, p.y, rBase * 5, 0, Math.PI * 2); ctx.fill();
        // core
        ctx.fillStyle = `rgba(${ar},${ag},${ab},${finalA})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, rBase, 0, Math.PI * 2); ctx.fill();
      }

      // Text reveal trigger + final flash + finish
      if (forming) {
        if (elapsed >= 1.2 && !textReveal) setTextReveal(true);
        if (elapsed >= 1.9) {
          const f = Math.min(1, (elapsed - 1.9) / 0.6);
          ctx.fillStyle = `rgba(${ar},${ag},${ab},${0.6 * (1 - Math.abs(f - 0.5) * 2)})`;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          if (f >= 1) { cancelAnimationFrame(rafRef.current); onEnter(); return; }
        }
      }
      rafRef.current = requestAnimationFrame(draw);
    }
    rafRef.current = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(rafRef.current); window.removeEventListener("resize", resize); };
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
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: bg, fontFamily: "'Inter', -apple-system, sans-serif", position: "relative", overflow: "hidden", padding: 20 }}>
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: animationMode === "off" ? 0 : animationMode === "subtle" ? 0.45 : 0.95 }} />
      <div style={{ position: "relative", zIndex: 1, textAlign: "center", transition: "opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1), transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)", opacity: phase === "forming" ? 0 : 1, transform: phase === "forming" ? "scale(0.92) translateY(10px)" : "scale(1)" }}>
        <div style={{ marginBottom: 22, animation: "cb-float 4s ease-in-out infinite" }}><Mark size={54} accent={accent} glow={P.dark} /></div>
        <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", color: accent, marginBottom: 14 }}>A Research Instrument</div>
        <div style={{ fontSize: 52, fontWeight: 750, letterSpacing: "-0.035em", color: P.ink, marginBottom: 12, lineHeight: 1 }}>Cerebrum</div>
        <div style={{ fontSize: 17, color: P.ink2, marginBottom: 34, letterSpacing: "-0.01em" }}>Peer-reviewed answers, on demand.</div>
        <button onClick={go} style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "14px 32px", fontSize: 15, fontWeight: 600, background: accent, color: accentText(accent), border: "none", borderRadius: 11, cursor: "pointer", fontFamily: "inherit", boxShadow: `0 6px 24px ${withAlpha(accent, 0.4)}`, letterSpacing: "-0.01em", transition: "transform 0.15s, box-shadow 0.15s" }}
          onMouseDown={(e) => { e.currentTarget.style.transform = "scale(0.97)"; }}
          onMouseUp={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}>
          Initialize <span>→</span>
        </button>
        <div style={{ fontSize: 12.5, color: P.faint, marginTop: 18 }}>No account · nothing stored on a server</div>
      </div>
    </div>
  );
}

// ============ LIVING MOLECULAR BACKGROUND ============
// Ambient always-on canvas: drifting particles with elastic connections,
// gentle currents, subtle firing pulses. Sits behind ALL app content at low opacity.
function LivingBackground({ accent, P, intensity = "cinematic", preset = "particles", density = 1, speed = 1, opacity = 1 }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(0);
  const stateRef = useRef({ items: [], t: 0 });
  const mouseRef = useRef({ x: -9999, y: -9999 });
  // These change frequently (slider drags) but shouldn't trigger effect re-runs.
  // Read them from refs inside the animation loop instead.
  const speedRef = useRef(speed);
  const densityRef = useRef(density);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { densityRef.current = density; }, [density]);

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
      }
      stateRef.current.items = items;
    };

    const resize = () => {
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
      initItems();
    };
    resize();
    window.addEventListener("resize", resize);
    const ctx = canvas.getContext("2d");

    const onMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current.x = (e.clientX - rect.left) * dpr;
      mouseRef.current.y = (e.clientY - rect.top) * dpr;
    };
    const onLeave = () => { mouseRef.current.x = -9999; mouseRef.current.y = -9999; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseleave", onLeave);

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
      const heightExtent = canvas.height * 0.85;
      const radius = 90 * dpr;
      const twistSpeed = 0.6 * getSpeed();
      // Draw connecting rungs
      for (const n of items) {
        const y = cy - heightExtent / 2 + n.t * heightExtent;
        const twist = elapsed * twistSpeed + n.t * Math.PI * 4;
        const x1 = cx + Math.cos(twist) * radius;
        const x2 = cx + Math.cos(twist + Math.PI) * radius;
        // Rung
        ctx.strokeStyle = `rgba(${ar},${ag},${ab},0.18)`;
        ctx.lineWidth = 0.8 * dpr;
        ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
        // Nodes
        const r = 2 * dpr;
        for (const x of [x1, x2]) {
          const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
          glow.addColorStop(0, `rgba(${ar},${ag},${ab},0.45)`);
          glow.addColorStop(1, `rgba(${ar},${ag},${ab},0)`);
          ctx.fillStyle = glow;
          ctx.beginPath(); ctx.arc(x, y, r * 4, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = `rgba(${ar},${ag},${ab},0.75)`;
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
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

    function draw(now) {
      const elapsed = (now - startTime) / 1000;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (preset === "waves") drawWaves(elapsed);
      else if (preset === "dna") drawDNA(elapsed);
      else if (preset === "circuits") drawCircuits(elapsed);
      else if (preset === "starfield") drawStarfield(elapsed);
      else drawParticles(elapsed); // particles + neurons default
      rafRef.current = requestAnimationFrame(draw);
    }
    rafRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
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



function App() {
  const isMobile = useIsMobile();
  const [entered, setEntered] = useState(false);
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState([]);
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
  const [animPreset, setAnimPreset] = useState(() => getCookie("cb_animP") || "dna"); // particles | waves | dna | circuits | neurons | starfield
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
    turns.forEach((t) => { prior.push({ role: "user", content: t.q }); prior.push({ role: "assistant", content: t.answer }); });
    try {
      // Fire search and videos in parallel. The answer arrives from /api/search;
      // videos arrive independently and get merged into the turn when they show up.
      const videosPromise = fetch("/api/videos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: question }) })
        .then((r) => r.ok ? r.json() : { videos: [] })
        .catch(() => ({ videos: [] }));

      const res = await fetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: question, history: prior, settings: { answerLength, factCheck } }) });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Something went sideways. Try that again?"); setBusy(false); return; }
      const turnId = Date.now() + Math.random();
      const nt = { id: turnId, q: question, answer: data.answer || "", sources: data.sources || [], videos: data.videos || [], source: data.source || "", factCheck: data.factCheck || null, related: data.related || [], fresh: typewriter };
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
  useEffect(() => { setCookie("cb_animD", String(animDensity)); }, [animDensity]);
  useEffect(() => { setCookie("cb_animS", String(animSpeed)); }, [animSpeed]);
  useEffect(() => { setCookie("cb_animO", String(animOpacity)); }, [animOpacity]);
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


  function newSession() { if (!mutedRef.current) Audio.click(); setTurns([]); setAllSources([]); setInput(""); setError(""); setSuggestions(pick()); setCmdOpen(false); setTimeout(() => inputRef.current?.focus(), 50); }
  function toggleSave(s) { sfx(); setSaved((prev) => { const k = (s.title || "").toLowerCase(); return prev.some((x) => (x.title || "").toLowerCase() === k) ? prev.filter((x) => (x.title || "").toLowerCase() !== k) : [...prev, s]; }); }
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

  const relColor = (r) => r >= 75 ? "#10b981" : r >= 45 ? "#d9a520" : P.faint;
  const typeColor = (t) => t === "Preprint" ? "#d97706" : t === "Reference" ? "#7c3aed" : t === "Dataset" ? "#0284c7" : accent;

  const SourceCard = (s, i) => (
    <div key={i} style={{ ...S.srcItem, background: hoverCite === i + 1 ? withAlpha(accent, 0.07) : "transparent" }} onMouseEnter={() => setHover("src" + i)} onMouseLeave={() => setHover("")}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5, flexWrap: "wrap" }}>
        {s.type && <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: typeColor(s.type), background: withAlpha(typeColor(s.type), 0.12), padding: "2px 6px", borderRadius: 5 }}>{s.type}</span>}
        {typeof s.relevance === "number" && <span style={{ fontSize: 9.5, fontWeight: 700, color: relColor(s.relevance), background: withAlpha(relColor(s.relevance), 0.12), padding: "2px 6px", borderRadius: 5 }}>{s.relevance}% match</span>}
        {s.year && <span style={{ fontSize: 10, color: P.faint }}>{s.year}</span>}
      </div>
      <a href={s.url} target="_blank" rel="noreferrer" style={{ ...S.srcTitle, color: hover === "src" + i ? accent : P.ink }}>{s.title || s.url}</a>
      <div style={S.srcMeta}>{[s.authors, s.journal].filter(Boolean).join(" · ")}{typeof s.citations === "number" && ` · ${s.citations.toLocaleString()} citations`}</div>
      <div style={S.srcRow}>
        <button style={{ ...S.chipMini, color: isSaved(s) ? at : P.ink2, background: isSaved(s) ? accent : "transparent", borderColor: isSaved(s) ? accent : P.line2 }} onClick={() => toggleSave(s)}>{isSaved(s) ? "★ Saved" : "☆ Save"}</button>
        {s.authors && <button style={{ ...S.chipMini, color: accent, borderColor: P.line2 }} onClick={() => { setMobilePanel(false); ask(`papers by ${(s.authors || "").replace(" et al.", "")}`); }}>Author →</button>}
      </div>
    </div>
  );

  const SourcesInner = (
    <>
      <div style={S.srcHead}><span>Sources</span><span style={S.srcCount}>{allSources.length}</span></div>
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
      <div style={S.srcList}>
        {allSources.length === 0 ? <div style={S.empty}>Sources appear here as you research.</div> :
          sortedSources.length === 0 ? <div style={S.empty}>No sources match "{srcFilter}".</div> :
          grouped ? grouped.map(([label, items]) => (
            <div key={label}>
              <div style={S.srcGroupLabel}>{label} <span style={{ color: P.faint, fontWeight: 500 }}>· {items.length}</span></div>
              {items.map((s, i) => SourceCard(s, allSources.indexOf(s)))}
            </div>
          )) : sortedSources.map((s) => SourceCard(s, allSources.indexOf(s)))}
      </div>
    </>
  );

  return (
    <div style={S.page}>
      {animationMode !== "off" && <LivingBackground accent={accent} P={P} intensity={animationMode} preset={animPreset} density={animDensity} speed={animSpeed} opacity={animOpacity} />}
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
            {!isMobile && <button style={S.cmdHint} onClick={() => { setCmdOpen(true); setTimeout(() => cmdRef.current?.focus(), 40); }}><span>Search</span><kbd style={S.kbd}>{kbdLabel("K")}</kbd></button>}
            <button style={S.ghostBtn} onClick={() => { sfx(); newSession(); }}>New</button>
            <button style={S.ghostBtn} onClick={() => { sfx(); setSavedOpen(true); }}>{isMobile ? "★" : "Saved"}{saved.length > 0 ? (isMobile ? ` ${saved.length}` : ` · ${saved.length}`) : ""}</button>
            <button style={S.iconBtn} onClick={() => setMuted(!muted)} title={muted ? "Unmute" : "Mute"}>{muted ? "🔇" : "🔊"}</button>
            <button style={S.ghostBtn} onClick={() => { sfx(); setSettingsOpen(true); }}>{isMobile ? "⚙" : "Settings"}</button>
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
                <button style={S.searchBtn} onClick={() => ask()}>Inquire</button>
              </div>
              <div style={S.chips}>
                {suggestions.map((s, i) => (<button key={s} className="cb-fade" style={{ ...S.chip, ...(hover === "c" + i ? S.chipHover : {}), animationDelay: `${120 + i * 70}ms` }} onMouseEnter={() => setHover("c" + i)} onMouseLeave={() => setHover("")} onClick={() => ask(s)}>{s}</button>))}
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
              <a href="/how-it-works" style={{ color: P.faint, textDecoration: "none", borderBottom: `1px dotted ${P.faint}` }}>How it works</a>
              <span style={{ margin: "0 8px" }}>·</span>
              © {new Date().getFullYear()} Cerebrum™
            </div>
          </div>
        </div>
      </div>

      {started && isMobile && <button style={S.mobSrcBtn} onClick={() => setMobilePanel(true)}>Sources · {allSources.length}</button>}
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
        <div style={S.modalWrap} onClick={() => setSavedOpen(false)} className="cb-fade">
          <div style={{ ...S.modal, width: 560 }} onClick={(e) => e.stopPropagation()} className="cb-pop">
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

      {settingsOpen && <Settings {...{ P, accent, at, S, PALETTES, ACCENTS, paletteName, setPaletteName, accentName, setAccentName, customAccent, setCustomAccent, answerLength, setAnswerLength, factCheck, setFactCheck, muted, setMuted, typewriter, setTypewriter, soundMode, setSoundMode, animationMode, setAnimationMode, animPreset, setAnimPreset, animDensity, setAnimDensity, animSpeed, setAnimSpeed, animOpacity, setAnimOpacity, sfx, setSessions, setSaved, close: () => setSettingsOpen(false) }} />}    </div>
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
      <ol style={{ margin: 0, padding: 0, listStyle: "none", counterReset: "biblio" }}>
        {sources.map((src, i) => (
          <BibEntry key={i} source={src} index={i + 1} P={P} accent={accent} style={citationStyle} />
        ))}
      </ol>
    </div>
  );
}

function BibEntry({ source, index, P, accent, style }) {
  const [hover, setHover] = useState(false);
  const formatted = formatCitation(source, style, index);
  // Break long URLs to prevent overflow
  return (
    <li id={`ref-${index}`} style={{
      padding: "12px 4px 12px 4px",
      borderTop: index === 1 ? "none" : `1px solid ${P.line}`,
      display: "flex", gap: 12, alignItems: "flex-start",
      transition: "background 0.15s",
      background: hover ? withAlpha(accent, 0.03) : "transparent",
      borderRadius: 6,
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
    transition: "border-color 0.15s, color 0.15s",
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
      </div>
      {done && t.factCheck && <FactCheck fc={t.factCheck} P={P} accent={accent} />}
      {done && t.sources && t.sources.length > 0 && (
        <Bibliography sources={t.sources} P={P} accent={accent} citationStyle={citationStyle} setCitationStyle={setCitationStyle} />
      )}
      {done && (
        <div style={{ marginTop: 20 }} className="cb-fade">
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: accent, marginBottom: 10 }}>Related videos</div>
          {t.videos && t.videos.length > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
              {t.videos.slice(0, 6).map((v, i) => (
                <a key={v.id || i} href={v.url} target="_blank" rel="noreferrer" style={{ display: "block", background: P.surface, border: `1px solid ${P.line}`, borderRadius: 10, overflow: "hidden", textDecoration: "none", color: P.ink, transition: "transform 0.15s, box-shadow 0.15s, border-color 0.15s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.borderColor = accent; e.currentTarget.style.boxShadow = P.shadow; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.borderColor = P.line; e.currentTarget.style.boxShadow = "none"; }}>
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
                transition: "border-color 0.15s, transform 0.15s, box-shadow 0.15s",
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

function Settings({ P, accent, at, S, PALETTES, ACCENTS, paletteName, setPaletteName, accentName, setAccentName, customAccent, setCustomAccent, answerLength, setAnswerLength, factCheck, setFactCheck, muted, setMuted, typewriter, setTypewriter, soundMode, setSoundMode, animationMode, setAnimationMode, animPreset, setAnimPreset, animDensity, setAnimDensity, animSpeed, setAnimSpeed, animOpacity, setAnimOpacity, sfx, setSessions, setSaved, close }) {
  const SOUND_MODES = [["pulse", "Soft pulse"], ["shimmer", "Airy shimmer"], ["warm", "Warm hum"], ["minimal", "Minimal"]];
  return (
    <div style={S.modalWrap} onClick={close} className="cb-fade">
      <div style={S.modal} onClick={(e) => e.stopPropagation()} className="cb-pop">
        <div style={S.modalTitle}>Settings</div>
        <div style={S.setLabel}>Appearance</div>
        <div style={S.palRow}>
          {Object.keys(PALETTES).map((pn) => (
            <button key={pn} style={{ ...S.palCard, background: PALETTES[pn].bg, borderColor: paletteName === pn ? accent : PALETTES[pn].line2, borderWidth: paletteName === pn ? 2 : 1 }} onClick={() => { sfx(); setPaletteName(pn); }}>
              <div style={{ display: "flex", gap: 4 }}><span style={{ width: 22, height: 22, borderRadius: 6, background: PALETTES[pn].surface, border: `1px solid ${PALETTES[pn].line2}` }} /><span style={{ width: 22, height: 22, borderRadius: 6, background: accent }} /></div>
              <span style={{ fontSize: 12, color: PALETTES[pn].ink, fontWeight: 550 }}>{pn}</span>
            </button>
          ))}
        </div>
        <div style={S.setLabel}>Accent</div>
        <div style={S.accentRow}>
          {Object.keys(ACCENTS).map((an) => (<button key={an} title={an} style={{ ...S.accentDot, background: ACCENTS[an], transform: (!customAccent && accentName === an) ? "scale(1.15)" : "none", boxShadow: (!customAccent && accentName === an) ? `0 0 0 2px ${P.surface}, 0 0 0 4px ${ACCENTS[an]}` : "none" }} onClick={() => { sfx(); setCustomAccent(""); setAccentName(an); }} />))}
          <label style={S.customDot} title="Custom"><input type="color" value={accent} onChange={(e) => setCustomAccent(e.target.value)} style={{ opacity: 0, width: 0, height: 0, position: "absolute" }} /><span style={{ fontSize: 15, color: P.ink2 }}>+</span></label>
        </div>
        <div style={S.setLabel}>Answer length</div>
        <div style={S.segment}>{["short", "medium", "long"].map((v) => (<button key={v} style={{ ...S.segBtn, ...(answerLength === v ? S.segActive : {}) }} onClick={() => { sfx(); setAnswerLength(v); }}>{v}</button>))}</div>
        <div style={S.setLabel}>Fact-check</div>
        <button style={{ ...S.toggle, ...(factCheck ? S.toggleOn : {}) }} onClick={() => { sfx(); setFactCheck(!factCheck); }}><span>{factCheck ? "Verification on" : "Verification off"}</span><span style={{ ...S.toggleKnob, transform: factCheck ? "translateX(20px)" : "none", background: factCheck ? at : P.faint }} /></button>
        <div style={S.setNote}>A second model checks each claim against the cited abstracts and flags anything unsupported. It verifies source-support, not real-world truth.</div>
        <div style={S.setLabel}>Typewriter reveal</div>
        <button style={{ ...S.toggle, ...(typewriter ? S.toggleOn : {}) }} onClick={() => { sfx(); setTypewriter(!typewriter); }}><span>{typewriter ? "Animated reveal on" : "Instant answers"}</span><span style={{ ...S.toggleKnob, transform: typewriter ? "translateX(20px)" : "none", background: typewriter ? at : P.faint }} /></button>
        <div style={S.setLabel}>Animations</div>
        <div style={S.segment}>{[["cinematic", "Full"], ["subtle", "Subtle"], ["off", "Off"]].map(([v, label]) => (<button key={v} style={{ ...S.segBtn, ...(animationMode === v ? S.segActive : {}) }} onClick={() => { sfx(); setAnimationMode(v); }}>{label}</button>))}</div>
        <div style={S.setNote}>Full: all effects active. Subtle: fewer particles, quieter. Off: static.</div>
        {animationMode !== "off" && (
          <>
            <div style={S.setLabel}>Background style</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 10 }}>
              {[
                ["particles", "Particles"],
                ["neurons", "Neurons"],
                ["waves", "Waves"],
                ["dna", "DNA"],
                ["circuits", "Circuits"],
                ["starfield", "Starfield"],
              ].map(([v, label]) => (
                <button key={v}
                  style={{ padding: "9px 6px", fontSize: 12, fontWeight: 550, background: animPreset === v ? accent : "transparent", color: animPreset === v ? at : P.ink2, border: `1px solid ${animPreset === v ? accent : P.line}`, borderRadius: 8, cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s" }}
                  onClick={() => { sfx(); setAnimPreset(v); }}>{label}</button>
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 6 }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: P.ink2 }}>Density</span>
                  <span style={{ fontSize: 11, color: P.faint }}>{animDensity.toFixed(1)}x</span>
                </div>
                <input type="range" min="0.3" max="2.5" step="0.1" value={animDensity} onChange={(e) => setAnimDensity(parseFloat(e.target.value))}
                  style={{ width: "100%", accentColor: accent, cursor: "pointer" }} />
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: P.ink2 }}>Speed</span>
                  <span style={{ fontSize: 11, color: P.faint }}>{animSpeed.toFixed(1)}x</span>
                </div>
                <input type="range" min="0.2" max="3" step="0.1" value={animSpeed} onChange={(e) => setAnimSpeed(parseFloat(e.target.value))}
                  style={{ width: "100%", accentColor: accent, cursor: "pointer" }} />
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: P.ink2 }}>Opacity</span>
                  <span style={{ fontSize: 11, color: P.faint }}>{Math.round(animOpacity * 100)}%</span>
                </div>
                <input type="range" min="0.2" max="1.5" step="0.1" value={animOpacity} onChange={(e) => setAnimOpacity(parseFloat(e.target.value))}
                  style={{ width: "100%", accentColor: accent, cursor: "pointer" }} />
              </div>
              <button onClick={() => { sfx(); setAnimPreset("particles"); setAnimDensity(1); setAnimSpeed(1); setAnimOpacity(1); }}
                style={{ fontSize: 11, padding: "6px 10px", background: "transparent", border: `1px solid ${P.line}`, borderRadius: 6, color: P.faint, cursor: "pointer", fontFamily: "inherit", alignSelf: "flex-start" }}>Reset</button>
            </div>
          </>
        )}
        <div style={S.setLabel}>Sound</div>
        <button style={{ ...S.toggle, ...(!muted ? S.toggleOn : {}) }} onClick={() => setMuted(!muted)}><span>{muted ? "Sound off" : "Sound on"}</span><span style={{ ...S.toggleKnob, transform: !muted ? "translateX(20px)" : "none", background: !muted ? at : P.faint }} /></button>
        <div style={{ ...S.setLabel, opacity: muted ? 0.4 : 1 }}>Search sound</div>
        <div style={{ ...S.soundGrid, opacity: muted ? 0.4 : 1, pointerEvents: muted ? "none" : "auto" }}>
          {SOUND_MODES.map(([id, name]) => (
            <button key={id} style={{ ...S.soundBtn, ...(soundMode === id ? S.soundBtnActive : {}) }} onClick={() => { setSoundMode(id); Audio.preview(id); }}>
              <span>{name}</span>
              {soundMode === id && <span style={{ color: accent, fontSize: 12 }}>♪</span>}
            </button>
          ))}
        </div>
        <div style={S.setNote}>Plays while searching. Tap a style to preview it.</div>
        <button style={S.clearAll} onClick={() => { setSessions([]); setSaved([]); }}>Clear sessions & saved</button>
        <button style={S.modalClose} onClick={close}>Done</button>
        <div style={S.shortcuts}>{kbdLabel("K")} search · {kbdLabel("J")} new · {kbdLabel("B")} saved · {kbdLabel("/")} settings · esc close</div>
      </div>
    </div>
  );
}

function makeStyles(P, accent, at, isMobile = false) {
  const font = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  const pad = isMobile ? 16 : 24;
  return {
    gate: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: P.bg, padding: 20, fontFamily: font, position: "relative", overflow: "hidden" },
    gateGlow: { position: "absolute", width: 600, height: 600, borderRadius: "50%", background: `radial-gradient(circle, ${withAlpha(accent, P.dark ? 0.14 : 0.08)}, transparent 68%)`, top: "20%", filter: "blur(30px)", pointerEvents: "none" },
    gateInner: { textAlign: "center", maxWidth: 440, position: "relative", zIndex: 1 },
    gateKicker: { fontSize: 12, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: accent, marginBottom: 14 },
    gateTitle: { fontSize: 46, fontWeight: 750, letterSpacing: "-0.03em", color: P.ink, marginBottom: 14, lineHeight: 1 },
    gateSub: { fontSize: 16, color: P.ink2, marginBottom: 32, lineHeight: 1.6, letterSpacing: "-0.01em" },
    gateBtn: { display: "inline-flex", alignItems: "center", gap: 10, padding: "13px 28px", fontSize: 15, fontWeight: 600, background: accent, color: at, border: "none", borderRadius: 10, cursor: "pointer", fontFamily: font, boxShadow: `0 4px 16px ${withAlpha(accent, 0.35)}`, letterSpacing: "-0.01em" },
    gateNote: { fontSize: 12.5, color: P.faint, marginTop: 18 },
    page: { minHeight: "100vh", height: "100vh", background: P.bg, color: P.ink, fontFamily: font, WebkitFontSmoothing: "antialiased", display: "flex", flexDirection: "column", position: "relative" },
    grain: { position: "fixed", inset: 0, pointerEvents: "none", opacity: P.grain, zIndex: 100, backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")" },
    header: { flexShrink: 0, borderBottom: `1px solid ${P.line}`, background: withAlpha(P.bg, 0.8), backdropFilter: "blur(12px)", position: "sticky", top: 0, zIndex: 20 },
    headInner: { maxWidth: 1080, margin: "0 auto", padding: `0 ${pad}px`, height: 58, display: "flex", alignItems: "center", justifyContent: "space-between" },
    brandRow: { display: "flex", alignItems: "center", gap: 10, cursor: "pointer" },
    brand: { fontWeight: 700, fontSize: 19, letterSpacing: "-0.02em", color: P.ink },
    headActions: { display: "flex", alignItems: "center", gap: 6 },
    cmdHint: { display: "flex", alignItems: "center", gap: 8, background: P.surface, border: `1px solid ${P.line2}`, color: P.ink2, padding: "7px 10px 7px 14px", borderRadius: 9, cursor: "pointer", fontSize: 13, fontFamily: font, boxShadow: P.shadowSm },
    kbd: { fontSize: 11, fontFamily: font, color: P.faint, background: P.bg, border: `1px solid ${P.line2}`, borderRadius: 5, padding: "1px 6px", fontWeight: 550 },
    ghostBtn: { background: "transparent", border: "none", color: P.ink2, padding: isMobile ? "8px 8px" : "8px 12px", borderRadius: 8, cursor: "pointer", fontSize: isMobile ? 14 : 13.5, fontWeight: 550, fontFamily: font, letterSpacing: "-0.01em" },
    iconBtn: { background: "transparent", border: "none", color: P.ink2, width: 36, height: 36, borderRadius: 8, cursor: "pointer", fontSize: 15 },
    scroll: { flex: 1, overflowY: "auto" },
    container: { maxWidth: 1080, margin: "0 auto", padding: `0 ${pad}px`, minHeight: "100%", display: "flex", flexDirection: "column" },
    hero: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "40px 0 60px", position: "relative" },
    heroGlow: { position: "absolute", width: 520, height: 520, borderRadius: "50%", background: `radial-gradient(circle, ${withAlpha(accent, P.dark ? 0.1 : 0.06)}, transparent 65%)`, top: "8%", filter: "blur(40px)", pointerEvents: "none" },
    heroMark: { marginBottom: 26, position: "relative" },
    heroTitle: { fontSize: isMobile ? 46 : 68, fontWeight: 750, letterSpacing: "-0.04em", lineHeight: 1, color: P.ink, marginBottom: 12, position: "relative" },
    heroSub: { fontSize: 17, color: P.ink2, maxWidth: 480, lineHeight: 1.6, marginBottom: 36, letterSpacing: "-0.01em", position: "relative" },
    searchShell: { display: "flex", alignItems: "center", gap: 10, width: "100%", maxWidth: 580, background: P.surface, border: `1px solid ${P.line2}`, borderRadius: 14, padding: isMobile ? "6px 6px 6px 12px" : "7px 7px 7px 14px", boxShadow: P.shadow, transition: "all 0.2s", position: "relative" },
    searchShellActive: { borderColor: accent, boxShadow: `${P.shadow}, 0 0 0 3px ${withAlpha(accent, 0.12)}` },
    searchInput: { flex: 1, border: "none", outline: "none", background: "transparent", fontFamily: font, fontSize: 16, color: P.ink, minWidth: 0, letterSpacing: "-0.01em" },
    searchBtn: { fontSize: 14, fontWeight: 600, background: accent, color: at, border: "none", padding: isMobile ? "11px 14px" : "11px 20px", borderRadius: 9, cursor: "pointer", fontFamily: font, flexShrink: 0, letterSpacing: "-0.01em", boxShadow: `0 2px 8px ${withAlpha(accent, 0.3)}` },
    chips: { display: "flex", flexWrap: "wrap", gap: 9, justifyContent: "center", marginTop: 22, maxWidth: 600, position: "relative" },
    chip: { fontSize: 13.5, color: P.ink2, background: P.surface, border: `1px solid ${P.line}`, borderRadius: 20, padding: "9px 15px", cursor: "pointer", transition: "all 0.18s", fontFamily: font, boxShadow: P.shadowSm, letterSpacing: "-0.01em" },
    chipHover: { borderColor: accent, color: accent, transform: "translateY(-1px)" },
    trustRow: { display: "flex", flexWrap: "wrap", gap: 18, justifyContent: "center", marginTop: 40, opacity: 0.65 },
    trustItem: { fontSize: 12, fontWeight: 550, color: P.ink2, letterSpacing: "0.01em" },
    workspace: { display: "grid", gridTemplateColumns: "1fr 288px", gap: 40, alignItems: "start", padding: isMobile ? "22px 0 20px" : "36px 0 20px", flex: 1 },
    workspaceMobile: { gridTemplateColumns: "1fr", gap: 0 },
    thread: { minWidth: 0 },
    turn: { marginBottom: 40 },
    qLabel: { fontSize: 12, fontWeight: 650, letterSpacing: "0.08em", textTransform: "uppercase", color: accent, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 },
    qDot: { width: 6, height: 6, borderRadius: "50%", background: accent, boxShadow: P.dark ? `0 0 8px ${accent}` : "none" },
    headline: { fontWeight: 700, fontSize: isMobile ? 21 : 27, lineHeight: 1.2, marginBottom: 18, color: P.ink, letterSpacing: "-0.025em" },
    answerCard: { background: P.surface, border: `1px solid ${P.line}`, borderRadius: 16, padding: isMobile ? "18px 18px" : "22px 26px", boxShadow: P.shadow },
    byline: { fontSize: 12, color: P.faint, letterSpacing: "0.01em", borderTop: `1px solid ${P.line}`, paddingTop: 13, marginTop: 18, display: "flex" },
    loading: { display: "flex", alignItems: "center", gap: 12, color: P.ink2, fontSize: 14, padding: "14px 0 0" },
    spinner: { width: 16, height: 16, border: `2px solid ${P.line2}`, borderTopColor: accent, borderRadius: "50%", display: "inline-block", animation: "cbspin 0.7s linear infinite" },
    error: { padding: "14px 16px", background: withAlpha("#e5484d", 0.1), color: "#e5484d", borderRadius: 12, fontSize: 14, border: `1px solid ${withAlpha("#e5484d", 0.25)}` },
    followShell: { display: "flex", alignItems: "center", gap: 8, background: P.surface, border: `1px solid ${P.line2}`, borderRadius: 13, padding: "6px 6px 6px 16px", boxShadow: P.shadow, transition: "all 0.2s", marginTop: 8 },
    relatedWrap: { marginTop: 18 },
    relatedLabel: { fontSize: 11.5, fontWeight: 650, letterSpacing: "0.06em", textTransform: "uppercase", color: P.faint, marginBottom: 10 },
    relatedList: { display: "flex", flexDirection: "column", gap: 8 },
    relatedBtn: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, textAlign: "left", padding: "12px 16px", fontSize: 14, background: P.surface, color: P.ink2, border: `1px solid ${P.line2}`, borderRadius: 11, cursor: "pointer", fontFamily: font, transition: "all 0.15s", boxShadow: P.shadowSm, letterSpacing: "-0.01em" },
    panel: { position: "sticky", top: 24, background: P.surface, border: `1px solid ${P.line}`, borderRadius: 16, padding: "18px 18px", boxShadow: P.shadow, maxHeight: "calc(100vh - 130px)", overflowY: "auto" },
    panelMobile: { position: "fixed", top: 0, right: 0, height: "100vh", width: "88vw", maxWidth: 350, borderRadius: 0, maxHeight: "none", zIndex: 30, boxShadow: "-8px 0 40px rgba(0,0,0,0.35)" },
    srcHead: { display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 14, fontWeight: 650, color: P.ink, marginBottom: 14, letterSpacing: "-0.01em" },
    srcCount: { fontSize: 11.5, fontWeight: 600, color: accent, background: withAlpha(accent, 0.12), padding: "3px 9px", borderRadius: 20 },
    srcActions: { display: "flex", gap: 6, marginBottom: 12 },
    srcFilterInput: { width: "100%", padding: "8px 11px", fontSize: 12.5, border: `1px solid ${P.line2}`, background: P.bg, color: P.ink, borderRadius: 8, outline: "none", fontFamily: font, marginBottom: 8 },
    sortTabs: { display: "flex", gap: 3, background: P.bg, padding: 3, borderRadius: 9, marginBottom: 14, border: `1px solid ${P.line}` },
    sortTab: { flex: 1, padding: "6px", fontSize: 11.5, background: "transparent", color: P.ink2, border: "none", borderRadius: 6, cursor: "pointer", fontFamily: font, fontWeight: 550, transition: "all 0.15s" },
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
    srcItem: { padding: "13px 12px", margin: "0 -12px", borderRadius: 12, transition: "background 0.15s", borderBottom: `1px solid ${P.line}` },
    srcTitle: { fontSize: 13.5, textDecoration: "none", lineHeight: 1.4, fontWeight: 550, display: "block", marginBottom: 5, transition: "color 0.15s", letterSpacing: "-0.01em" },
    srcMeta: { fontSize: 12, color: P.ink2, lineHeight: 1.45 },
    srcRow: { display: "flex", gap: 7, marginTop: 9 },
    chipMini: { fontSize: 11.5, padding: "5px 10px", border: "1px solid", borderRadius: 7, cursor: "pointer", fontFamily: font, fontWeight: 550, background: "transparent", transition: "all 0.15s" },
    foot: { marginTop: "auto", padding: "20px 0 26px", textAlign: "center" },
    disclaimer: { fontSize: 11.5, color: P.ink2, lineHeight: 1.55, maxWidth: 560, margin: "0 auto 16px", padding: "10px 16px", background: withAlpha(accent, 0.05), border: `1px solid ${P.line}`, borderRadius: 10 },
    footDbs: { fontSize: 11, letterSpacing: "0.04em", color: P.faint, lineHeight: 1.7 },
    aiTag: { fontSize: 11, color: P.faint, fontWeight: 550, letterSpacing: "0.01em", display: "inline-flex", alignItems: "center", gap: 5 },
    mobSrcBtn: { position: "fixed", bottom: 20, right: 20, background: accent, color: at, border: "none", borderRadius: 26, padding: "13px 22px", fontSize: 13.5, fontWeight: 600, cursor: "pointer", boxShadow: `0 8px 24px ${withAlpha(accent, 0.4)}`, zIndex: 20, fontFamily: font },
    scrim: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 25, backdropFilter: "blur(3px)" },
    cmdWrap: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "12vh", zIndex: 50, backdropFilter: "blur(6px)" },
    cmdBox: { width: 560, maxWidth: "92vw", background: P.surface, border: `1px solid ${P.line2}`, borderRadius: 16, boxShadow: "0 24px 70px rgba(0,0,0,0.45)", overflow: "hidden", fontFamily: font },
    cmdInputRow: { display: "flex", alignItems: "center", gap: 11, padding: "16px 18px", borderBottom: `1px solid ${P.line}` },
    cmdInput: { flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 16, color: P.ink, fontFamily: font },
    cmdList: { maxHeight: 340, overflowY: "auto", padding: 8 },
    cmdSection: { fontSize: 11, fontWeight: 650, letterSpacing: "0.06em", textTransform: "uppercase", color: P.faint, padding: "10px 12px 6px" },
    cmdItem: { width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "11px 12px", fontSize: 14, color: P.ink, background: "transparent", border: "none", borderRadius: 9, cursor: "pointer", fontFamily: font, textAlign: "left", transition: "background 0.12s" },
    modalWrap: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 40, padding: 16, backdropFilter: "blur(6px)" },
    modal: { background: P.surface, border: `1px solid ${P.line2}`, borderRadius: 20, padding: 28, width: 440, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", fontFamily: font, boxShadow: "0 24px 70px rgba(0,0,0,0.4)" },
    modalTitle: { fontSize: 21, fontWeight: 700, color: P.ink, marginBottom: 22, letterSpacing: "-0.02em" },
    setLabel: { fontSize: 11.5, textTransform: "uppercase", letterSpacing: "0.08em", color: P.faint, marginBottom: 10, marginTop: 4, fontWeight: 650 },
    palRow: { display: "flex", gap: 10, marginBottom: 22 },
    palCard: { flex: 1, display: "flex", flexDirection: "column", gap: 10, padding: "12px", borderRadius: 12, cursor: "pointer", border: "1px solid", alignItems: "flex-start", fontFamily: font },
    accentRow: { display: "flex", flexWrap: "wrap", gap: 13, marginBottom: 22, alignItems: "center" },
    accentDot: { width: 26, height: 26, borderRadius: "50%", border: "none", cursor: "pointer", transition: "transform 0.15s" },
    customDot: { width: 26, height: 26, borderRadius: "50%", border: `1px dashed ${P.line2}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" },
    segment: { display: "flex", gap: 4, background: P.bg, padding: 4, borderRadius: 11, marginBottom: 22, border: `1px solid ${P.line}` },
    segBtn: { flex: 1, padding: "9px", fontSize: 13, background: "transparent", color: P.ink2, border: "none", borderRadius: 8, cursor: "pointer", textTransform: "capitalize", fontFamily: font, fontWeight: 550, transition: "all 0.15s" },
    segActive: { background: P.surface, color: P.ink, boxShadow: P.shadowSm, fontWeight: 600 },
    toggle: { width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", fontSize: 13.5, background: P.bg, color: P.ink2, border: `1px solid ${P.line2}`, borderRadius: 10, cursor: "pointer", fontFamily: font, fontWeight: 550, marginBottom: 8 },
    toggleOn: { color: P.ink, borderColor: withAlpha(accent, 0.4), background: withAlpha(accent, 0.06) },
    toggleKnob: { width: 34, height: 20, borderRadius: 12, position: "relative", transition: "all 0.2s", display: "inline-block", flexShrink: 0 },
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
      @keyframes cbspin { to { transform: rotate(360deg); } }
      @keyframes cbShimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
      @keyframes cbFade { from { opacity: 0; } to { opacity: 1; } }
      @keyframes cbRise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes cbPop { from { opacity: 0; transform: scale(0.96) translateY(8px); } to { opacity: 1; transform: scale(1) translateY(0); } }
      @keyframes cbGate { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes cbHero { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes cb-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
      @keyframes cb-burst {
        0% { opacity: 0; transform: translate(0, 0) scale(0.3); }
        15% { opacity: 1; transform: translate(0, 0) scale(1); }
        100% { opacity: 0; transform: translate(var(--cb-dx, 0), var(--cb-dy, 60px)) scale(0.6) rotate(var(--cb-rot, 30deg)); }
      }
      @keyframes cb-egg-in {
        from { opacity: 0; transform: translateY(-6px) scale(0.96); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      }
      @keyframes cb-wiggle {
        0%, 100% { transform: rotate(0deg) scale(1); }
        30% { transform: rotate(-10deg) scale(1.08); }
        60% { transform: rotate(8deg) scale(1.05); }
        85% { transform: rotate(-3deg) scale(1.02); }
      }
      .cb-wiggle { animation: cb-wiggle 0.55s cubic-bezier(0.34, 1.56, 0.64, 1); }
      .cb-fade { animation: cbFade 0.4s ease forwards; }
      .cb-rise { animation: cbRise 0.5s cubic-bezier(.2,.8,.2,1) forwards; }
      .cb-pop { animation: cbPop 0.28s cubic-bezier(.2,.9,.3,1) forwards; }
      .cb-gate { animation: cbGate 0.7s cubic-bezier(.2,.8,.2,1) forwards; }
      .cb-hero { animation: cbHero 0.6s cubic-bezier(.2,.8,.2,1) forwards; }
      * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
      html, body { margin: 0; overflow-x: hidden; max-width: 100%; }
      a, p, h1, h2, span { overflow-wrap: break-word; word-break: break-word; }
      input { font-size: 16px; }
      input::placeholder { color: inherit; opacity: 0.5; }
      ::-webkit-scrollbar { width: 10px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.25); border-radius: 5px; border: 3px solid transparent; background-clip: padding-box; }
      ::-webkit-scrollbar-thumb:hover { background: rgba(128,128,128,0.4); background-clip: padding-box; }
    `;
    document.head.appendChild(st);
  }
}

createRoot(document.getElementById("root")).render(<App />);
