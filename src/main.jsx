import React, { useState, useRef, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";

function setCookie(k, v) { try { document.cookie = `${k}=${encodeURIComponent(v)}; path=/; max-age=31536000; SameSite=Lax`; } catch {} }
function getCookie(k) { try { const m = document.cookie.match(new RegExp("(?:^|; )" + k + "=([^;]*)")); return m ? decodeURIComponent(m[1]) : null; } catch { return null; } }

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");
const MOD = IS_MAC ? "⌘" : "Ctrl";
const kbdLabel = (key) => `${MOD}${IS_MAC ? "" : "+"}${key}`;

const LOADING_MESSAGES = [
  "Looking through the microscope",
  "Consulting the literature",
  "Cross-referencing citations",
  "Peering into petri dishes",
  "Aligning the sequences",
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

// ---------- Sound Generator API ----------
const Audio = (() => {
  let ctx = null, ambient = null, lfoTimer = null;
  function ac() { if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { ctx = null; } } return ctx; }
  function tone(freq, dur, vol) { const c = ac(); if (!c) return; const o = c.createOscillator(), g = c.createGain(); o.type = "sine"; o.frequency.value = freq; g.gain.setValueAtTime(0.0001, c.currentTime); g.gain.exponentialRampToValueAtTime(vol, c.currentTime + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur); o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + dur + 0.02); }
  function click() { tone(660, 0.08, 0.045); }
  function pop() { tone(880, 0.06, 0.04); }
  function startAmbient(mode = "pulse") {
    const c = ac(); if (!c || ambient) return;
    if (mode === "minimal") { tone(523.25, 0.5, 0.05); return; }
    const now = c.currentTime; const g = c.createGain(); g.gain.setValueAtTime(0.0001, now); g.connect(c.destination);
    const oscs = [];
    if (mode === "shimmer") {
      const o = c.createOscillator(), o2 = c.createOscillator(); o.type = "sine"; o.frequency.value = 587.33; o2.type = "sine"; o2.frequency.value = 880;
      o.connect(g); o2.connect(g); o.start(); o2.start(); oscs.push(o, o2);
      g.gain.exponentialRampToValueAtTime(0.02, now + 0.6);
    } else if (mode === "warm") {
      [98, 146.83, 196].forEach((freq) => { const o = c.createOscillator(); o.type = "sine"; o.frequency.value = freq; o.connect(g); o.start(); oscs.push(o); });
      g.gain.exponentialRampToValueAtTime(0.024, now + 0.5);
    } else {
      const o = c.createOscillator(), o2 = c.createOscillator(); o.type = "sine"; o.frequency.value = 110; o2.type = "sine"; o2.frequency.value = 164.81;
      o.connect(g); o2.connect(g); o.start(); o2.start(); oscs.push(o, o2);
      let up = true; g.gain.exponentialRampToValueAtTime(0.03, now + 0.8);
      lfoTimer = setInterval(() => {
        if (!ctx) return; const t = ctx.currentTime;
        g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t);
        g.gain.exponentialRampToValueAtTime(up ? 0.012 : 0.032, t + 1.4); up = !up;
      }, 1400);
    }
    ambient = { g, oscs };
  }
  function stopAmbient() {
    if (lfoTimer) { clearInterval(lfoTimer); lfoTimer = null; }
    if (!ambient || !ctx) return;
    try { ambient.g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4); ambient.oscs.forEach((o) => { try { o.stop(ctx.currentTime + 0.45); } catch {} }); } catch {}
    ambient = null;
  }
  function preview(mode) { startAmbient(mode); setTimeout(stopAmbient, 1400); }
  return { click, pop, startAmbient, stopAmbient, preview };
})();

// ---------- Multi-Engine Video Discovery with Unique Thumbnails ----------
const STOPWORDS = new Set([
  "what","whats","how","does","do","did","is","are","was","were","the","a","an",
  "of","in","on","for","to","and","or","with","by","about","tell","me","explain",
  "why","when","where","which","who","can","you","please","give","show","find",
  "search","look","up","that","this","these","those","it","its","work","works"
]);

async function fetchVideosMultiSource(query) {
  const cleanTokens = query.toLowerCase().replace(/[^\w\s-]/g, " ").split(/\s+/).filter(w => w.length > 2 && !STOPWORDS.has(w));
  const coreTopic = cleanTokens.length > 0 ? cleanTokens.join(" ") : query;
  const searchTerms = [coreTopic, `${coreTopic} university lecture`, `${coreTopic} science tutorial`];

  let results = [];
  let seenIds = new Set();

  for (const term of searchTerms) {
    if (results.length >= 6) break;

    const endpoints = [
      `https://corsproxy.io/?${encodeURIComponent(`https://pipedapi.kavin.rocks/search?q=${encodeURIComponent(term)}&filter=videos`)}`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://pipedapi.kavin.rocks/search?q=${encodeURIComponent(term)}&filter=videos`)}`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://inv.nadeko.net/api/v1/search?q=${encodeURIComponent(term)}&type=video`)}`
    ];

    for (const endpoint of endpoints) {
      if (results.length >= 6) break;
      try {
        const c = new AbortController();
        const t = setTimeout(() => c.abort(), 3000);
        const res = await fetch(endpoint, { signal: c.signal });
        clearTimeout(t);
        if (!res.ok) continue;
        const data = await res.json();

        let items = [];
        if (Array.isArray(data)) items = data;
        else if (data?.items && Array.isArray(data.items)) items = data.items;

        for (const item of items) {
          const vId = item.videoId || item.url?.replace("/watch?v=", "") || "";
          const vTitle = item.title || "";
          const vAuthor = item.author || item.uploaderName || "Academic Lecture";

          if (vId && !seenIds.has(vId)) {
            seenIds.add(vId);
            const thumbnail = `https://i.ytimg.com/vi/${vId}/hqdefault.jpg`;
            results.push({
              title: vTitle,
              url: `https://www.youtube.com/watch?v=${vId}`,
              author: vAuthor,
              thumbnail,
              id: vId
            });
          }
        }
      } catch {}
    }
  }

  return results.slice(0, 6);
}

function Mark({ size = 26, accent, glow }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ filter: glow ? `drop-shadow(0 0 10px ${withAlpha(accent, 0.45)})` : "none" }}>
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
  const clean = (text || "").replace(/^#{1,6}\s*/gm, "");
  return clean.split(/\n{2,}/).map((para, pi) => (
    <p key={pi} style={{ fontSize: 16.5, lineHeight: 1.85, margin: "0 0 20px", color: P.ink, letterSpacing: "-0.004em" }}>
      {para.split("\n").map((line, li) => (
        <React.Fragment key={li}>
          {line.split(/(\*\*[^*]+\*\*|\[\d+\])/g).map((seg, si) => {
            const b = seg.match(/^\*\*([^*]+)\*\*$/);
            if (b) return <strong key={si} style={{ color: P.ink, fontWeight: 700 }}>{b[1]}</strong>;
            const c = seg.match(/^\[(\d+)\]$/);
            if (c) {
              const n = parseInt(c[1], 10); const src = sources[n - 1];
              return <a key={si} href={src?.url || "#"} target="_blank" rel="noreferrer" title={src?.title || ""} onMouseEnter={() => setHoverCite(n)} onMouseLeave={() => setHoverCite(0)} style={{ fontSize: 11, verticalAlign: "super", color: accent, textDecoration: "none", fontWeight: 700, padding: "1px 5px", borderRadius: 5, background: hoverCite === n ? withAlpha(accent, 0.16) : withAlpha(accent, 0.09), transition: "background 0.15s", cursor: "pointer" }}>{n}</a>;
            }
            return <span key={si}>{seg}</span>;
          })}
          {li < para.split("\n").length - 1 && <br />}
        </React.Fragment>
      ))}
    </p>
  ));
}

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
    <div style={{ marginTop: 20, border: `1px solid ${P.line}`, borderRadius: 14, background: P.surface, padding: "20px 22px", boxShadow: P.shadowSm }} className="cb-rise">
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
        <span style={{ width: 18, height: 18, borderRadius: "50%", background: withAlpha(oc, 0.15), display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: oc }} /></span>
        <span style={{ fontSize: 13, fontWeight: 650, color: oc }}>{label[fc.overall] || fc.overall}</span>
        <span style={{ fontSize: 11, color: P.faint, marginLeft: "auto" }}>checked vs. cited abstracts</span>
      </div>

      {score !== null && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 26, fontWeight: 750, color: scoreColor }}>{score}<span style={{ fontSize: 15, fontWeight: 600 }}>%</span></span>
            <span style={{ fontSize: 13, color: P.ink2, fontWeight: 550 }}>source support</span>
          </div>
          <div style={{ display: "flex", height: 7, borderRadius: 4, overflow: "hidden", background: P.line, gap: 1.5 }}>
            {nSup > 0 && <div style={{ flex: nSup, background: "#10b981" }} />}
            {nThin > 0 && <div style={{ flex: nThin, background: "#d9a520" }} />}
            {nUns > 0 && <div style={{ flex: nUns, background: "#e5484d" }} />}
          </div>
        </div>
      )}

      {fc.summary && <div style={{ fontSize: 14, color: P.ink2, marginBottom: claims.length ? 12 : 0, lineHeight: 1.6 }}>{fc.summary}</div>}
    </div>
  );
}

function Skeleton({ P }) {
  const bar = (w) => <div style={{ height: 14, width: w, borderRadius: 6, background: P.skel, backgroundSize: "200% 100%", animation: "cbShimmer 1.3s infinite" }} />;
  return (
    <div style={{ background: P.surface, border: `1px solid ${P.line}`, borderRadius: 20, padding: "32px 38px", boxShadow: P.shadow, display: "flex", flexDirection: "column", gap: 14 }}>
      {bar("92%")}{bar("98%")}{bar("85%")}<div style={{ height: 6 }} />{bar("95%")}{bar("70%")}
    </div>
  );
}

function useIsMobile() {
  const [m, setM] = useState(typeof window !== "undefined" ? window.innerWidth < 900 : false);
  useEffect(() => { const onR = () => setM(window.innerWidth < 900); window.addEventListener("resize", onR); return () => window.removeEventListener("resize", onR); }, []);
  return m;
}

function LoadingLine({ P }) {
  const [msg, setMsg] = useState(() => LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)]);
  useEffect(() => {
    const id = setInterval(() => { setMsg(LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)]); }, 1800);
    return () => clearInterval(id);
  }, []);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, color: P.ink2, fontSize: 14, padding: "16px 0 0" }}>
      <span style={{ width: 16, height: 16, border: `2px solid ${P.line2}`, borderTopColor: P.ink, borderRadius: "50%", display: "inline-block", animation: "cbspin 0.7s linear infinite" }} />
      <span key={msg} className="cb-fade">{msg}…</span>
    </div>
  );
}

const FAQ_DATA = [
  { category: "Getting Started", q: "What is Cerebrum?", a: "Cerebrum is an independent, high-performance search instrument built exclusively for scientific research." },
  { category: "Zotero Integration", q: "How do I connect Zotero?", a: "Click the Zotero button in the Sources panel and input your User ID and API key." }
];

function FAQView({ P, accent, at, onBack }) {
  return (
    <div style={{ minHeight: "100vh", background: P.bg, color: P.ink, padding: "40px 20px", fontFamily: "sans-serif" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <button onClick={onBack} style={{ background: "transparent", border: `1px solid ${P.line2}`, color: P.ink2, padding: "8px 16px", borderRadius: 9, cursor: "pointer", fontWeight: 600, fontSize: 13.5, marginBottom: 20 }}>
          ← Back to Cerebrum
        </button>
        <h1 style={{ fontSize: 36, fontWeight: 750, marginBottom: 10 }}>Frequently Asked Questions</h1>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 20 }}>
          {FAQ_DATA.map((item, idx) => (
            <div key={idx} style={{ background: P.surface, border: `1px solid ${P.line}`, borderRadius: 14, padding: "20px 24px" }}>
              <h3 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 8px 0" }}>{item.q}</h3>
              <p style={{ fontSize: 14.5, color: P.ink2, margin: 0, lineHeight: 1.6 }}>{item.a}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Intro({ accent, P, onEnter }) {
  const canvasRef = useRef(null);
  const [phase, setPhase] = useState("idle");
  const rafRef = useRef(0);
  const startRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => { canvas.width = canvas.offsetWidth * dpr; canvas.height = canvas.offsetHeight * dpr; };
    resize(); window.addEventListener("resize", resize);
    const ctx = canvas.getContext("2d");

    const CX = () => canvas.width / 2, CY = () => canvas.height / 2;
    const R = () => Math.min(canvas.width, canvas.height) * 0.26;
    const N = 22;
    const nodes = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 * 3 + i;
      const rr = R() * (0.35 + 0.65 * ((i * 7) % N) / N);
      const tx = Math.cos(a) * rr, ty = Math.sin(a) * rr * 0.72;
      nodes.push({ tx, ty, sx: (Math.random() - 0.5) * canvas.width * 1.6, sy: (Math.random() - 0.5) * canvas.height * 1.6, r: 2.2 * dpr + Math.random() * 2.4 * dpr, delay: Math.random() * 0.35 });
    }
    const bonds = [];
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
      if (Math.hypot(nodes[i].tx - nodes[j].tx, nodes[i].ty - nodes[j].ty) < R() * 0.55) bonds.push([i, j]);
    }

    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const h = accent.replace("#", ""); const [ar, ag, ab] = [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];

    function draw(now) {
      if (!startRef.current) startRef.current = now;
      const elapsed = (now - startRef.current) / 1000;
      const assembling = phase === "assembling";
      const prog = assembling ? Math.min(1, elapsed / 1.1) : Math.min(1, elapsed / 2.2);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const spin = assembling ? elapsed * 1.4 : elapsed * 0.25;
      const cx = CX(), cy = CY();

      const pos = nodes.map((n) => {
        const t = ease(Math.max(0, Math.min(1, (prog - n.delay) / (1 - n.delay))));
        const bx = n.sx * (1 - t) + n.tx * t, by = n.sy * (1 - t) + n.ty * t;
        const ca = Math.cos(spin), sa = Math.sin(spin);
        return { x: cx + (bx * ca - by * sa), y: cy + (bx * sa + by * ca), t };
      });

      for (const [i, j] of bonds) {
        const a = pos[i], b = pos[j]; const alpha = Math.min(a.t, b.t);
        if (alpha <= 0.02) continue;
        ctx.strokeStyle = `rgba(${ar},${ag},${ab},${0.28 * alpha})`; ctx.lineWidth = 1.1 * dpr;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      for (let i = 0; i < pos.length; i++) {
        const p = pos[i]; if (p.t <= 0.02) continue;
        ctx.fillStyle = `rgba(${ar},${ag},${ab},${p.t})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, nodes[i].r, 0, Math.PI * 2); ctx.fill();
      }
      if (assembling && elapsed >= 1.1) {
        if ((elapsed - 1.1) / 0.35 >= 1) { cancelAnimationFrame(rafRef.current); onEnter(); return; }
      }
      rafRef.current = requestAnimationFrame(draw);
    }
    rafRef.current = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(rafRef.current); window.removeEventListener("resize", resize); };
  }, [phase, accent, onEnter]);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: P.bg, fontFamily: "'Inter', sans-serif", position: "relative", overflow: "hidden", padding: 20 }}>
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.9 }} />
      <div style={{ position: "relative", zIndex: 1, textAlign: "center", opacity: phase === "assembling" ? 0 : 1, transition: "opacity 0.5s" }}>
        <Mark size={54} accent={accent} glow={P.dark} />
        <h1 style={{ fontSize: 52, fontWeight: 750, color: P.ink, margin: "16px 0 8px" }}>Cerebrum</h1>
        <p style={{ fontSize: 17, color: P.ink2, marginBottom: 32 }}>Peer-reviewed answers, on demand.</p>
        <button onClick={() => setPhase("assembling")} style={{ padding: "14px 32px", fontSize: 15, fontWeight: 600, background: accent, color: accentText(accent), border: "none", borderRadius: 11, cursor: "pointer", boxShadow: `0 6px 24px ${withAlpha(accent, 0.4)}` }}>
          Initialize →
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const isMobile = useIsMobile();
  const [entered, setEntered] = useState(false);
  const [currentView, setCurrentView] = useState("app");
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [allSources, setAllSources] = useState([]);
  const [saved, setSaved] = useState(() => { try { return JSON.parse(localStorage.getItem("cb_saved") || "[]"); } catch { return []; } });
  const [savedOpen, setSavedOpen] = useState(false);
  const [suggestions] = useState(pick());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdQuery, setCmdQuery] = useState("");
  const [zoteroOpen, setZoteroOpen] = useState(false);
  const [panelTab, setPanelTab] = useState("sources");
  const [srcFilter, setSrcFilter] = useState("");
  const [zKey, setZKey] = useState(""); const [zUser, setZUser] = useState(""); const [zMsg, setZMsg] = useState("");
  const [answerLength, setAnswerLength] = useState(() => getCookie("cb_len") || "medium");
  const [factCheck, setFactCheck] = useState(() => getCookie("cb_fc") === "1");
  const [muted, setMuted] = useState(() => getCookie("cb_muted") === "1");
  const [soundMode, setSoundMode] = useState(() => getCookie("cb_snd") || "pulse");
  const [typewriter, setTypewriter] = useState(() => getCookie("cb_tw") !== "0");
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

  const ask = useCallback(async (q) => {
    const question = (q ?? input).trim();
    if (!question || busy) return;
    if (!mutedRef.current) Audio.click();
    setInput(""); setBusy(true); setError(""); setCmdOpen(false);
    const prior = [];
    turns.forEach((t) => { prior.push({ role: "user", content: t.q }); prior.push({ role: "assistant", content: t.answer }); });
    try {
      const res = await fetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: question, history: prior, settings: { answerLength, factCheck } }) });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Search failed."); setBusy(false); return; }

      let rawAnswer = data.answer || "";
      rawAnswer = rawAnswer.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

      const videos = await fetchVideosMultiSource(question);

      const nt = { 
        q: question, 
        answer: rawAnswer, 
        sources: data.sources || [], 
        videos, 
        source: data.source || "", 
        factCheck: data.factCheck || null, 
        related: data.related || [], 
        fresh: typewriter 
      };
      setTurns((t) => [...t, nt]);
      setAllSources((prev) => { const seen = new Set(prev.map((s) => (s.title || "").toLowerCase())); return [...prev, ...(data.sources || []).filter((s) => !seen.has((s.title || "").toLowerCase()))]; });
      if (!mutedRef.current) Audio.pop();
    } catch (e) { setError(`Could not reach the backend. (${e.message})`); }
    finally { setBusy(false); }
  }, [input, busy, turns, answerLength, factCheck, typewriter]);

  useEffect(() => { if (entered && !isMobile && !cmdOpen) inputRef.current?.focus(); }, [entered, isMobile, cmdOpen]);
  useEffect(() => { if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight; }, [turns, busy]);
  useEffect(() => { if (busy && !muted) Audio.startAmbient(soundMode); else Audio.stopAmbient(); return () => Audio.stopAmbient(); }, [busy, muted, soundMode]);
  useEffect(() => { document.body.style.background = P.bg; }, [P]);
  useEffect(() => { setCookie("cb_snd", soundMode); setCookie("cb_len", answerLength); setCookie("cb_fc", factCheck ? "1" : "0"); setCookie("cb_muted", muted ? "1" : "0"); setCookie("cb_tw", typewriter ? "1" : "0"); setCookie("cb_pal", paletteName); setCookie("cb_accent", accentName); setCookie("cb_ca", customAccent); }, [soundMode, answerLength, factCheck, muted, typewriter, paletteName, accentName, customAccent]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setCmdOpen((v) => !v); setTimeout(() => cmdRef.current?.focus(), 40); }
      else if (e.key === "Escape") { setCmdOpen(false); setSettingsOpen(false); setSavedOpen(false); }
      else if ((e.metaKey || e.ctrlKey) && e.key === "/") { e.preventDefault(); setSettingsOpen((v) => !v); }
      else if ((e.metaKey || e.ctrlKey) && e.key === "j") { e.preventDefault(); setTurns([]); setAllSources([]); }
      else if ((e.metaKey || e.ctrlKey) && e.key === "b") { e.preventDefault(); setSavedOpen((v) => !v); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function toggleSave(s) { sfx(); setSaved((prev) => { const k = (s.title || "").toLowerCase(); return prev.some((x) => (x.title || "").toLowerCase() === k) ? prev.filter((x) => (x.title || "").toLowerCase() !== k) : [...prev, s]; }); }
  const isSaved = (s) => saved.some((x) => (x.title || "").toLowerCase() === (s.title || "").toLowerCase());
  async function doZotero() { setZMsg(""); const list = saved.length ? saved : allSources; if (!zKey || !zUser) { setZMsg("Enter your Zotero API key and user ID."); return; } try { await saveToZotero(list, zKey.trim(), zUser.trim()); setZMsg(`Saved ${list.length} items.`); } catch (e) { setZMsg(`Failed: ${e.message}`); } }

  const commands = [
    { label: "New investigation", hint: kbdLabel("J"), run: () => { setTurns([]); setAllSources(); setCmdOpen(false); } },
    { label: "Open saved articles", hint: kbdLabel("B"), run: () => { setCmdOpen(false); setSavedOpen(true); } },
    { label: "Open FAQ & Docs", run: () => { setCmdOpen(false); setCurrentView("faq"); } },
    { label: "Open settings", hint: kbdLabel("/"), run: () => { setCmdOpen(false); setSettingsOpen(true); } },
    { label: muted ? "Unmute sound" : "Mute sound", run: () => { setMuted(!muted); setCmdOpen(false); } },
    { label: "Toggle light / dark", run: () => { setPaletteName(P.dark ? "Light" : "Dark"); setCmdOpen(false); } },
  ];
  const filteredCmds = commands.filter((c) => c.label.toLowerCase().includes(cmdQuery.toLowerCase()));

  if (!entered) return <Intro accent={accent} P={P} onEnter={() => { sfx(); setEntered(true); }} />;
  if (currentView === "faq") return <FAQView P={P} accent={accent} at={at} onBack={() => setCurrentView("app")} />;

  const started = turns.length > 0 || busy;
  const exportList = saved.length ? saved : allSources;
  const currentVideos = turns.length > 0 ? (turns[turns.length - 1].videos || []) : [];

  const filteredSources = allSources.filter((s) => {
    if (!srcFilter.trim()) return true;
    const f = srcFilter.toLowerCase();
    return (s.title || "").toLowerCase().includes(f) || (s.authors || "").toLowerCase().includes(f) || (s.journal || "").toLowerCase().includes(f);
  });

  const SourceCard = (s, i) => (
    <div key={i} style={{ ...S.srcItem, background: hoverCite === i + 1 ? withAlpha(accent, 0.07) : "transparent" }}>
      <a href={s.url} target="_blank" rel="noreferrer" style={{ ...S.srcTitle, color: P.ink }}>{s.title || s.url}</a>
      <div style={S.srcMeta}>{[s.authors, s.journal].filter(Boolean).join(" · ")}</div>
      <div style={{ marginTop: 6 }}>
        <button style={{ ...S.chipMini, color: isSaved(s) ? at : P.ink2, background: isSaved(s) ? accent : "transparent", borderColor: isSaved(s) ? accent : P.line2 }} onClick={() => toggleSave(s)}>{isSaved(s) ? "★ Saved" : "☆ Save"}</button>
      </div>
    </div>
  );

  const SourcesInner = (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button style={{ ...S.sortTab, ...(panelTab === "sources" ? S.sortTabActive : {}) }} onClick={() => setPanelTab("sources")}>
          Sources ({allSources.length})
        </button>
        <button style={{ ...S.sortTab, ...(panelTab === "videos" ? S.sortTabActive : {}) }} onClick={() => setPanelTab("videos")}>
          Videos ({currentVideos.length})
        </button>
      </div>

      {panelTab === "sources" ? (
        <>
          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            <button style={S.sBtn} onClick={() => { sfx(); download("cerebrum.ris", toRIS(exportList)); }}>RIS</button>
            <button style={S.sBtn} onClick={() => { sfx(); download("cerebrum.bib", toBibTeX(exportList)); }}>BibTeX</button>
            <button style={S.sBtnP} onClick={() => { sfx(); setZoteroOpen(!zoteroOpen); }}>Zotero</button>
          </div>
          {zoteroOpen && (
            <div style={S.zBox}>
              <input style={S.zIn} placeholder="Zotero API key" value={zKey} onChange={(e) => setZKey(e.target.value)} />
              <input style={S.zIn} placeholder="Zotero user ID" value={zUser} onChange={(e) => setZUser(e.target.value)} />
              <button style={S.sBtnP} onClick={doZotero}>Save {exportList.length}</button>
              {zMsg && <div style={S.zMsg}>{zMsg}</div>}
            </div>
          )}
          <input style={S.srcFilterInput} placeholder="Filter sources…" value={srcFilter} onChange={(e) => setSrcFilter(e.target.value)} />
          <div style={S.srcList}>
            {allSources.length === 0 ? <div style={S.empty}>Sources will collect here as you research.</div> :
              filteredSources.map((s) => SourceCard(s, allSources.indexOf(s)))}
          </div>
        </>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {currentVideos.length === 0 ? (
            <div style={S.empty}>No related educational videos found for this query.</div>
          ) : (
            currentVideos.map((vid, i) => (
              <a key={i} href={vid.url} target="_blank" rel="noreferrer" style={{ textDecoration: "none", color: "inherit", display: "flex", flexDirection: "column", background: P.raised, borderRadius: 12, overflow: "hidden", border: `1px solid ${P.line2}`, boxShadow: P.shadowSm, transition: "transform 0.15s" }}>
                <div style={{ position: "relative", width: "100%", height: 140, background: P.dark ? "#181b1f" : "#e5e7eb" }}>
                  <img src={vid.thumbnail} alt={vid.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e) => { e.target.style.display = 'none'; }} />
                  <div style={{ position: "absolute", bottom: 8, right: 8, background: "rgba(0,0,0,0.8)", color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4, letterSpacing: "0.04em" }}>
                    LECTURE
                  </div>
                </div>
                <div style={{ padding: "14px 16px" }}>
                  <div style={{ fontSize: 14, fontWeight: 650, color: P.ink, lineHeight: 1.4, marginBottom: 8, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{vid.title}</div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 11.5, color: accent, fontWeight: 600 }}>{vid.author}</span>
                    <span style={{ fontSize: 11, color: P.faint, fontWeight: 500 }}>Watch →</span>
                  </div>
                </div>
              </a>
            ))
          )}
        </div>
      )}
    </>
  );

  return (
    <div style={S.page}>
      <div style={S.grain} />
      <header style={S.header}>
        <div style={S.headInner}>
          <div style={S.brandRow} onClick={() => { sfx(); setTurns([]); setAllSources([]); }}><Mark size={22} accent={accent} glow={P.dark} /><span style={S.brand}>Cerebrum</span></div>
          <div style={S.headActions}>
            <button style={S.cmdHint} onClick={() => { setCmdOpen(true); setTimeout(() => cmdRef.current?.focus(), 40); }}><span>Search</span><kbd style={S.kbd}>{kbdLabel("K")}</kbd></button>
            <button style={S.ghostBtn} onClick={() => { sfx(); setTurns([]); setAllSources([]); }}>New</button>
            <button style={S.ghostBtn} onClick={() => { sfx(); setCurrentView("faq"); }}>FAQ</button>
            <button style={S.ghostBtn} onClick={() => { sfx(); setSavedOpen(true); }}>Saved ({saved.length})</button>
            <button style={S.iconBtn} onClick={() => setMuted(!muted)}>{muted ? "🔇" : "🔊"}</button>
            <button style={S.ghostBtn} onClick={() => { sfx(); setSettingsOpen(true); }}>Settings</button>
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
              <p style={S.heroSub}>Your research sidekick.</p>
              <div style={{ ...S.searchShell, ...(hover === "in" ? S.searchShellActive : {}) }} onMouseEnter={() => setHover("in")} onMouseLeave={() => setHover("")}>
                <input ref={inputRef} style={S.searchInput} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} placeholder="Ask a research question..." />
                <button style={S.searchBtn} onClick={() => ask()}>Inquire</button>
              </div>
              <div style={S.chips}>
                {suggestions.map((s, i) => (<button key={s} className="cb-fade" style={S.chip} onClick={() => ask(s)}>{s}</button>))}
              </div>
            </div>
          ) : (
            <div style={S.workspace}>
              <div style={S.thread}>
                {turns.map((t, ti) => (
                  <Turn key={ti} t={t} P={P} accent={accent} at={at} S={S} typewriter={typewriter && ti === turns.length - 1} hoverCite={hoverCite} setHoverCite={setHoverCite} onRelated={(q) => ask(q)} />
                ))}
                {busy && (
                  <div style={S.turn}>
                    <div style={S.qLabel}><span style={S.qDot} />Searching</div>
                    <Skeleton P={P} />
                    <LoadingLine P={P} />
                  </div>
                )}
                {error && <div style={S.error}>{error}</div>}
              </div>
              <aside style={S.panel}>{SourcesInner}</aside>
            </div>
          )}
        </div>
      </div>

      {cmdOpen && (
        <div style={S.cmdWrap} onClick={() => setCmdOpen(false)}>
          <div style={S.cmdBox} onClick={(e) => e.stopPropagation()} className="cb-pop">
            <div style={S.cmdInputRow}>
              <input ref={cmdRef} style={S.cmdInput} value={cmdQuery} onChange={(e) => setCmdQuery(e.target.value)} placeholder="Type a command…" />
              <kbd style={S.kbd}>esc</kbd>
            </div>
            <div style={S.cmdList}>
              {filteredCmds.map((c) => (<button key={c.label} style={S.cmdItem} onClick={c.run}><span>{c.label}</span>{c.hint && <kbd style={{ ...S.kbd, marginLeft: "auto" }}>{c.hint}</kbd>}</button>))}
            </div>
          </div>
        </div>
      )}

      {savedOpen && (
        <div style={S.modalWrap} onClick={() => setSavedOpen(false)} className="cb-fade">
          <div style={S.modal} onClick={(e) => e.stopPropagation()} className="cb-pop">
            <div style={S.modalTitle}>Saved articles ({saved.length})</div>
            <button style={{ ...S.modalClose, marginTop: 16 }} onClick={() => setSavedOpen(false)}>Done</button>
          </div>
        </div>
      )}

      {settingsOpen && <Settings {...{ P, accent, at, S, PALETTES, ACCENTS, paletteName, setPaletteName, accentName, setAccentName, customAccent, setCustomAccent, answerLength, setAnswerLength, factCheck, setFactCheck, muted, setMuted, typewriter, setTypewriter, soundMode, setSoundMode, sfx, setSaved, close: () => setSettingsOpen(false) }} />}
    </div>
  );
}

function Turn({ t, P, accent, at, S, typewriter, hoverCite, setHoverCite, onRelated }) {
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
            <span style={S.aiTag}>AI-generated · verified with literature</span>
            <span style={{ marginLeft: "auto", color: P.faint }}>{readingTime(t.answer)}</span>
          </div>
        )}
      </div>
      {done && t.factCheck && <FactCheck fc={t.factCheck} P={P} accent={accent} />}
      {done && t.related && t.related.length > 0 && (
        <div style={S.relatedWrap} className="cb-fade">
          <div style={S.relatedLabel}>Continue the investigation</div>
          <div style={S.relatedList}>
            {t.related.map((r, i) => (
              <button key={i} style={S.relatedBtn} onClick={() => onRelated(r)}>
                <span>{r}</span><span style={{ color: accent }}>→</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Settings({ P, accent, at, S, PALETTES, ACCENTS, paletteName, setPaletteName, accentName, setAccentName, customAccent, setCustomAccent, answerLength, setAnswerLength, factCheck, setFactCheck, muted, setMuted, typewriter, setTypewriter, soundMode, setSoundMode, sfx, setSaved, close }) {
  const SOUND_MODES = [["pulse", "Soft pulse"], ["shimmer", "Airy shimmer"], ["warm", "Warm hum"], ["minimal", "Minimal"]];
  return (
    <div style={S.modalWrap} onClick={close} className="cb-fade">
      <div style={S.modal} onClick={(e) => e.stopPropagation()} className="cb-pop">
        <div style={S.modalTitle}>Settings</div>
        <div style={S.setLabel}>Appearance</div>
        <div style={S.palRow}>
          {Object.keys(PALETTES).map((pn) => (
            <button key={pn} style={{ ...S.palCard, background: PALETTES[pn].bg, borderColor: paletteName === pn ? accent : PALETTES[pn].line2 }} onClick={() => { sfx(); setPaletteName(pn); }}>
              <span style={{ fontSize: 12, color: PALETTES[pn].ink, fontWeight: 550 }}>{pn}</span>
            </button>
          ))}
        </div>
        <div style={S.setLabel}>Sound Mode</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 20 }}>
          {SOUND_MODES.map(([id, name]) => (
            <button key={id} style={{ padding: "10px", background: soundMode === id ? accent : P.bg, color: soundMode === id ? at : P.ink, border: `1px solid ${P.line2}`, borderRadius: 8, cursor: "pointer", fontWeight: 550 }} onClick={() => { setSoundMode(id); Audio.preview(id); }}>
              {name}
            </button>
          ))}
        </div>
        <button style={S.modalClose} onClick={close}>Done</button>
      </div>
    </div>
  );
}

function makeStyles(P, accent, at, isMobile = false) {
  const font = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  const pad = isMobile ? 16 : 28;
  return {
    page: { minHeight: "100vh", height: "100vh", background: P.bg, color: P.ink, fontFamily: font, display: "flex", flexDirection: "column", position: "relative" },
    grain: { position: "fixed", inset: 0, pointerEvents: "none", opacity: P.grain, zIndex: 100, backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")" },
    header: { flexShrink: 0, borderBottom: `1px solid ${P.line}`, background: withAlpha(P.bg, 0.8), backdropFilter: "blur(12px)", position: "sticky", top: 0, zIndex: 20 },
    headInner: { maxWidth: 1140, margin: "0 auto", padding: `0 ${pad}px`, height: 62, display: "flex", alignItems: "center", justifyContent: "space-between" },
    brandRow: { display: "flex", alignItems: "center", gap: 10, cursor: "pointer" },
    brand: { fontWeight: 700, fontSize: 19, color: P.ink },
    headActions: { display: "flex", alignItems: "center", gap: 8 },
    cmdHint: { display: "flex", alignItems: "center", gap: 8, background: P.surface, border: `1px solid ${P.line2}`, color: P.ink2, padding: "7px 10px 7px 14px", borderRadius: 9, cursor: "pointer", fontSize: 13, fontFamily: font },
    kbd: { fontSize: 11, fontFamily: font, color: P.faint, background: P.bg, border: `1px solid ${P.line2}`, borderRadius: 5, padding: "1px 6px", fontWeight: 550 },
    ghostBtn: { background: "transparent", border: "none", color: P.ink2, padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 550 },
    iconBtn: { background: "transparent", border: "none", color: P.ink2, width: 38, height: 38, borderRadius: 8, cursor: "pointer", fontSize: 16 },
    scroll: { flex: 1, overflowY: "auto" },
    container: { maxWidth: 1140, margin: "0 auto", padding: `0 ${pad}px`, minHeight: "100%", display: "flex", flexDirection: "column" },
    hero: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "60px 0 80px", position: "relative" },
    heroGlow: { position: "absolute", width: 520, height: 520, borderRadius: "50%", background: `radial-gradient(circle, ${withAlpha(accent, 0.08)}, transparent 65%)`, top: "8%", filter: "blur(40px)", pointerEvents: "none" },
    heroMark: { marginBottom: 26, position: "relative" },
    heroTitle: { fontSize: 72, fontWeight: 750, color: P.ink, marginBottom: 14, lineHeight: 1, letterSpacing: "-0.03em" },
    heroSub: { fontSize: 18, color: P.ink2, maxWidth: 500, lineHeight: 1.65, marginBottom: 40 },
    searchShell: { display: "flex", alignItems: "center", gap: 12, width: "100%", maxWidth: 620, background: P.surface, border: `1px solid ${P.line2}`, borderRadius: 16, padding: "9px 9px 9px 18px", boxShadow: P.shadow },
    searchShellActive: { borderColor: accent, boxShadow: `${P.shadow}, 0 0 0 3px ${withAlpha(accent, 0.12)}` },
    searchInput: { flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 16.5, color: P.ink },
    searchBtn: { fontSize: 14.5, fontWeight: 600, background: accent, color: at, border: "none", padding: "12px 24px", borderRadius: 10, cursor: "pointer", boxShadow: `0 2px 10px ${withAlpha(accent, 0.3)}` },
    chips: { display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center", marginTop: 26, maxWidth: 660 },
    chip: { fontSize: 14, color: P.ink2, background: P.surface, border: `1px solid ${P.line}`, borderRadius: 22, padding: "10px 18px", cursor: "pointer", boxShadow: P.shadowSm },
    workspace: { display: "grid", gridTemplateColumns: "1fr 340px", gap: 48, alignItems: "start", padding: "48px 0 30px", flex: 1 },
    thread: { minWidth: 0 },
    turn: { marginBottom: 48 },
    qLabel: { fontSize: 12, fontWeight: 650, letterSpacing: "0.08em", textTransform: "uppercase", color: accent, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 },
    qDot: { width: 6, height: 6, borderRadius: "50%", background: accent },
    headline: { fontWeight: 750, fontSize: 30, lineHeight: 1.25, marginBottom: 22, color: P.ink, letterSpacing: "-0.02em" },
    answerCard: { background: P.surface, border: `1px solid ${P.line}`, borderRadius: 20, padding: "32px 38px", boxShadow: P.shadow },
    byline: { fontSize: 12, color: P.faint, borderTop: `1px solid ${P.line}`, paddingTop: 16, marginTop: 22, display: "flex" },
    aiTag: { fontSize: 11.5, color: P.faint, fontWeight: 550 },
    relatedWrap: { marginTop: 22 },
    relatedLabel: { fontSize: 12, fontWeight: 650, letterSpacing: "0.06em", textTransform: "uppercase", color: P.faint, marginBottom: 12 },
    relatedList: { display: "flex", flexDirection: "column", gap: 10 },
    relatedBtn: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, textAlign: "left", padding: "14px 18px", fontSize: 14.5, background: P.surface, color: P.ink2, border: `1px solid ${P.line2}`, borderRadius: 12, cursor: "pointer", boxShadow: P.shadowSm },
    panel: { position: "sticky", top: 28, background: P.surface, border: `1px solid ${P.line}`, borderRadius: 20, padding: "20px", boxShadow: P.shadow, maxHeight: "calc(100vh - 120px)", overflowY: "auto" },
    sortTab: { flex: 1, padding: "8px", fontSize: 12, background: "transparent", color: P.ink2, border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 },
    sortTabActive: { background: P.surface, color: P.ink, boxShadow: P.shadowSm },
    srcFilterInput: { width: "100%", padding: "10px 14px", fontSize: 13, border: `1px solid ${P.line2}`, background: P.bg, color: P.ink, borderRadius: 10, outline: "none", marginBottom: 14 },
    srcList: { display: "flex", flexDirection: "column", gap: 6 },
    empty: { fontSize: 13.5, color: P.faint, padding: "20px 0", textAlign: "center" },
    srcItem: { padding: "14px 14px", borderRadius: 12, borderBottom: `1px solid ${P.line}` },
    srcTitle: { fontSize: 14, textDecoration: "none", fontWeight: 600, display: "block", marginBottom: 6, lineHeight: 1.4 },
    srcMeta: { fontSize: 12, color: P.ink2 },
    sBtn: { flex: 1, fontSize: 11.5, padding: "7px", background: P.bg, color: P.ink2, border: `1px solid ${P.line2}`, borderRadius: 7, cursor: "pointer", fontWeight: 600 },
    sBtnP: { flex: 1, fontSize: 11.5, padding: "7px", background: accent, color: at, border: "none", borderRadius: 7, cursor: "pointer", fontWeight: 600 },
    zBox: { background: P.bg, border: `1px solid ${P.line}`, borderRadius: 10, padding: 10, marginBottom: 12, display: "flex", flexDirection: "column", gap: 6 },
    zIn: { padding: "8px", fontSize: 12, border: `1px solid ${P.line2}`, background: P.surface, color: P.ink, borderRadius: 6, outline: "none" },
    zMsg: { fontSize: 11, color: accent },
    cmdWrap: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "12vh", zIndex: 50, backdropFilter: "blur(6px)" },
    cmdBox: { width: 520, maxWidth: "92vw", background: P.surface, border: `1px solid ${P.line2}`, borderRadius: 16, boxShadow: "0 24px 70px rgba(0,0,0,0.45)", overflow: "hidden" },
    cmdInputRow: { display: "flex", alignItems: "center", gap: 11, padding: "14px 18px", borderBottom: `1px solid ${P.line}` },
    cmdInput: { flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 15, color: P.ink },
    cmdList: { maxHeight: 300, overflowY: "auto", padding: 8 },
    cmdItem: { width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", fontSize: 13.5, color: P.ink, background: "transparent", border: "none", borderRadius: 8, cursor: "pointer", textAlign: "left" },
    modalWrap: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 40, padding: 16 },
    modal: { background: P.surface, border: `1px solid ${P.line2}`, borderRadius: 20, padding: 32, width: 460, maxWidth: "100%" },
    modalTitle: { fontSize: 22, fontWeight: 700, color: P.ink, marginBottom: 24 },
    setLabel: { fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: P.faint, marginBottom: 12, fontWeight: 650 },
    palRow: { display: "flex", gap: 10, marginBottom: 24 },
    palCard: { flex: 1, padding: "14px", borderRadius: 12, cursor: "pointer", border: "1px solid" },
    modalClose: { width: "100%", padding: "14px", fontSize: 15, fontWeight: 600, background: accent, color: at, border: "none", borderRadius: 12, cursor: "pointer" }
  };
}

createRoot(document.getElementById("root")).render(<App />);
