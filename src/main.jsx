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

// ---------- Multi-Source CORS-Proxy Educational Video Engine ----------
async function fetchVideosMultiSource(query) {
  const clean = query.toLowerCase().replace(/[^\w\s-]/g, " ").trim();
  if (!clean) return [];

  const results = [];
  const seenIds = new Set();
  const searchTerms = [clean, `${clean} lecture`, `${clean} explanation`];

  for (const qTerm of searchTerms) {
    if (results.length >= 6) break;

    // Strategy 1: Piped / Invidious API through CORS Proxy
    const pipedEndpoints = [
      `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://pipedapi.kavin.rocks/search?q=${encodeURIComponent(qTerm)}&filter=videos`)}`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://api.piped.privacydev.net/search?q=${encodeURIComponent(qTerm)}&filter=videos`)}`
    ];

    for (const endpoint of pipedEndpoints) {
      if (results.length >= 6) break;
      try {
        const c = new AbortController();
        const t = setTimeout(() => c.abort(), 2500);
        const res = await fetch(endpoint, { signal: c.signal });
        clearTimeout(t);
        if (!res.ok) continue;
        const data = await res.json();
        const items = data?.items || [];
        for (const item of items) {
          const vId = item.url?.replace("/watch?v=", "") || "";
          if (vId && !seenIds.has(vId)) {
            seenIds.add(vId);
            results.push({
              title: item.title || "Educational Video",
              url: `https://www.youtube.com/watch?v=${vId}`,
              author: item.uploaderName || "Academic Channel",
              thumbnail: item.thumbnail || `https://i.ytimg.com/vi/${vId}/hqdefault.jpg`,
              id: vId
            });
          }
        }
      } catch {}
    }

    // Strategy 2: SepiaSearch (PeerTube Open University Videos)
    if (results.length < 6) {
      try {
        const c = new AbortController();
        const t = setTimeout(() => c.abort(), 2500);
        const res = await fetch(`https://sepiasearch.org/api/v1/search/videos?search=${encodeURIComponent(qTerm)}&count=4`, { signal: c.signal });
        clearTimeout(t);
        if (res.ok) {
          const data = await res.json();
          for (const item of (data?.data || [])) {
            if (item.uuid && !seenIds.has(item.uuid)) {
              seenIds.add(item.uuid);
              results.push({
                title: item.name || "PeerTube Academic Video",
                url: item.url || `https://${item.host}/w/${item.uuid}`,
                author: item.channel?.displayName || item.account?.displayName || "PeerTube Science",
                thumbnail: item.thumbnailPath ? (item.thumbnailPath.startsWith("http") ? item.thumbnailPath : `https://${item.host || "sepiasearch.org"}${item.thumbnailPath}`) : "https://joinpeertube.org/img/logo.svg",
                id: item.uuid
              });
            }
          }
        }
      } catch {}
    }

    // Strategy 3: Wikimedia Commons Open Scientific Media
    if (results.length < 6) {
      try {
        const c = new AbortController();
        const t = setTimeout(() => c.abort(), 2500);
        const url = "https://commons.wikimedia.org/w/api.php?" + new URLSearchParams({
          action: "query", generator: "search", gsrsearch: `${qTerm} filetype:video`, gsrnamespace: "6", prop: "imageinfo", iiprop: "url|thumburl", pithumbwidth: "400", format: "json", origin: "*"
        });
        const res = await fetch(url, { signal: c.signal });
        clearTimeout(t);
        if (res.ok) {
          const data = await res.json();
          const pages = Object.values(data?.query?.pages || {});
          for (const p of pages) {
            const info = p.imageinfo?.[0] || {};
            if (p.pageid && !seenIds.has(p.pageid)) {
              seenIds.add(p.pageid);
              results.push({
                title: (p.title || "").replace(/^File:/i, "").replace(/\.[^/.]+$/, ""),
                url: info.descriptionurl || info.url || "#",
                author: "Wikimedia Commons",
                thumbnail: info.thumburl || "https://upload.wikimedia.org/wikipedia/commons/4/4a/Commons-logo.svg",
                id: p.pageid
              });
            }
          }
        }
      } catch {}
    }
  }

  return results.slice(0, 8);
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
    const now = c.currentTime; const g = c.createGain(); g.gain.setValueAtTime(0.0001, now); g.connect(c.destination);
    const oscs = [];
    if (mode === "shimmer") {
      const o = c.createOscillator(), o2 = c.createOscillator(); o.type = "sine"; o.frequency.value = 587.33; o2.type = "sine"; o2.frequency.value = 880;
      o.connect(g); o2.connect(g); o.start(); o2.start(); oscs.push(o, o2);
      g.gain.exponentialRampToValueAtTime(0.02, now + 0.6);
    } else {
      const o = c.createOscillator(), o2 = c.createOscillator(); o.type = "sine"; o.frequency.value = 110; o2.type = "sine"; o2.frequency.value = 164.81;
      o.connect(g); o2.connect(g); o.start(); o2.start(); oscs.push(o, o2);
      g.gain.exponentialRampToValueAtTime(0.03, now + 0.8);
    }
    ambient = { g, oscs };
  }
  function stopAmbient() {
    if (!ambient || !ctx) return;
    try { ambient.g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4); ambient.oscs.forEach((o) => { try { o.stop(ctx.currentTime + 0.45); } catch {} }); } catch {}
    ambient = null;
  }
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
          {line.split(/(\*\*[^*]+\*\*|\[\d+\])/g).map((seg, si) => {
            const b = seg.match(/^\*\*([^*]+)\*\*$/);
            if (b) return <strong key={si} style={{ color: P.ink, fontWeight: 650 }}>{b[1]}</strong>;
            const c = seg.match(/^\[(\d+)\]$/);
            if (c) {
              const n = parseInt(c[1], 10); const src = sources[n - 1];
              return <a key={si} href={src?.url || "#"} target="_blank" rel="noreferrer" title={src?.title || ""} onMouseEnter={() => setHoverCite(n)} onMouseLeave={() => setHoverCite(0)} style={{ fontSize: 10.5, verticalAlign: "super", color: accent, textDecoration: "none", fontWeight: 700, padding: "1px 4px", borderRadius: 5, background: hoverCite === n ? withAlpha(accent, 0.16) : withAlpha(accent, 0.09), transition: "background 0.15s", cursor: "pointer" }}>{n}</a>;
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
  if (!fc) return null;
  const colors = { supported: "#10b981", partly: "#d9a520", unsupported: "#e5484d", thin: "#d9a520" };
  const label = { supported: "Supported by sources", partly: "Partly supported", unsupported: "Not supported by sources" };
  const oc = colors[fc.overall] || P.ink2;
  return (
    <div style={{ marginTop: 16, border: `1px solid ${P.line}`, borderRadius: 12, background: P.surface, padding: "16px 18px", boxShadow: P.shadowSm }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: oc }} />
        <span style={{ fontSize: 13, fontWeight: 650, color: oc }}>{label[fc.overall] || fc.overall}</span>
      </div>
      {fc.summary && <div style={{ fontSize: 13.5, color: P.ink2, marginTop: 8 }}>{fc.summary}</div>}
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

function LoadingLine({ P }) {
  const [msg, setMsg] = useState(() => LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)]);
  useEffect(() => {
    const id = setInterval(() => { setMsg(LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)]); }, 1800);
    return () => clearInterval(id);
  }, []);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, color: P.ink2, fontSize: 14, padding: "14px 0 0" }}>
      <span style={{ width: 16, height: 16, border: `2px solid ${P.line2}`, borderTopColor: P.ink, borderRadius: "50%", display: "inline-block", animation: "cbspin 0.7s linear infinite" }} />
      <span>{msg}…</span>
    </div>
  );
}

const FAQ_DATA = [
  { category: "Getting Started", q: "What is Cerebrum?", a: "Cerebrum is an independent, high-performance search instrument built exclusively for scientific research. It queries global scholarly archives in parallel, synthesizes factual answers grounded strictly in peer-reviewed literature, and provides verifiable inline citations." },
  { category: "Getting Started", q: "Do I need to create an account or pay to use Cerebrum?", a: "No account or login is required to search or read literature. Cerebrum runs completely free on client-side routing and edge serverless pathways, ensuring total privacy." },
  { category: "Data Sources", q: "Which scholarly databases does Cerebrum query?", a: "Cerebrum queries multiple global and open-access scientific indexes simultaneously: Europe PMC, PubMed, OpenAlex (250M+ multidisciplinary works), Crossref, arXiv, Semantic Scholar, DOAJ, Zenodo, DataCite, OpenAIRE, HAL, PLOS, BASE, and UTK TRACE." },
  { category: "Zotero Integration", q: "How do I connect Cerebrum to my Zotero account?", a: "To sync your saved articles directly to Zotero, click the 'Zotero' button in the Sources panel. You will need to input your Zotero User ID and a Private API Key." },
  { category: "Features & Output", q: "Where do the Related Videos come from?", a: "Cerebrum uses a multi-engine keyless discovery system querying Piped, Invidious, and PeerTube (Sepia Search) directly from your browser to pull educational videos and university lectures." }
];

function FAQView({ P, accent, at, onBack }) {
  const [search, setSearch] = useState("");
  const filtered = FAQ_DATA.filter((item) => item.q.toLowerCase().includes(search.toLowerCase()) || item.a.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{ minHeight: "100vh", background: P.bg, color: P.ink, padding: "40px 20px", fontFamily: "sans-serif" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <button onClick={onBack} style={{ background: "transparent", border: `1px solid ${P.line2}`, color: P.ink2, padding: "8px 16px", borderRadius: 9, cursor: "pointer", fontWeight: 600, fontSize: 13.5, marginBottom: 20 }}>
          ← Back to Cerebrum
        </button>
        <h1 style={{ fontSize: 36, fontWeight: 750, marginBottom: 10 }}>Frequently Asked Questions</h1>
        <input type="text" placeholder="Search documentation..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: "100%", padding: "14px 18px", fontSize: 15, background: P.surface, border: `1px solid ${P.line2}`, borderRadius: 12, color: P.ink, outline: "none", marginBottom: 24 }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {filtered.map((item, idx) => (
            <div key={idx} style={{ background: P.surface, border: `1px solid ${P.line}`, borderRadius: 14, padding: "20px 24px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: accent, textTransform: "uppercase", marginBottom: 6 }}>{item.category}</div>
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
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let raf;
    const draw = () => { ctx.clearRect(0, 0, canvas.width, canvas.height); raf = requestAnimationFrame(draw); };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: P.bg, fontFamily: "sans-serif", padding: 20 }}>
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} />
      <div style={{ textAlign: "center", zIndex: 1 }}>
        <Mark size={54} accent={accent} glow={P.dark} />
        <h1 style={{ fontSize: 52, fontWeight: 750, color: P.ink, margin: "16px 0 8px" }}>Cerebrum</h1>
        <p style={{ fontSize: 17, color: P.ink2, marginBottom: 32 }}>Peer-reviewed answers, on demand.</p>
        <button onClick={onEnter} style={{ padding: "14px 32px", fontSize: 15, fontWeight: 600, background: accent, color: accentText(accent), border: "none", borderRadius: 11, cursor: "pointer" }}>
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
  const [zKey, setZKey] = useState(""); const [zUser, setZUser] = useState(""); const [zMsg, setZMsg] = useState("");
  const [answerLength, setAnswerLength] = useState("medium");
  const [factCheck, setFactCheck] = useState(false);
  const [muted, setMuted] = useState(false);
  const [typewriter, setTypewriter] = useState(true);
  const [paletteName, setPaletteName] = useState("Light");
  const [accentName, setAccentName] = useState("Emerald");
  const [hoverCite, setHoverCite] = useState(0);

  const P = PALETTES[paletteName] || PALETTES.Light;
  const accent = ACCENTS[accentName] || ACCENTS.Emerald;
  const at = accentText(accent);

  const ask = useCallback(async (q) => {
    const question = (q ?? input).trim();
    if (!question || busy) return;
    if (!muted) Audio.click();
    setInput(""); setBusy(true); setError(""); setCmdOpen(false);

    try {
      const res = await fetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: question }) });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Search failed."); setBusy(false); return; }

      let rawAnswer = data.answer || "";
      rawAnswer = rawAnswer.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
      rawAnswer = rawAnswer.replace(/^.*?(Here is the answer|Protons are|Note:).*?[\r\n]+/i, (match) => match.includes("Note:") ? match : "").trim();

      // Execute Bulletproof Client-Side Video Search
      const videos = await fetchVideosMultiSource(question);

      const nt = { q: question, answer: rawAnswer, sources: data.sources || [], videos, fresh: typewriter };
      setTurns((t) => [...t, nt]);
      setAllSources((prev) => [...prev, ...(data.sources || [])]);
      if (!muted) Audio.pop();
    } catch (e) { setError(`Could not reach search service (${e.message})`); }
    finally { setBusy(false); }
  }, [input, busy, muted, typewriter]);

  function newSession() { setTurns([]); setAllSources([]); setInput(""); setError(""); }
  function toggleSave(s) { setSaved((prev) => prev.some((x) => x.title === s.title) ? prev.filter((x) => x.title !== s.title) : [...prev, s]); }
  const isSaved = (s) => saved.some((x) => x.title === s.title);

  if (!entered) return <Intro accent={accent} P={P} onEnter={() => setEntered(true)} />;
  if (currentView === "faq") return <FAQView P={P} accent={accent} at={at} onBack={() => setCurrentView("app")} />;

  const started = turns.length > 0 || busy;
  const currentVideos = turns.length > 0 ? (turns[turns.length - 1].videos || []) : [];

  return (
    <div style={{ minHeight: "100vh", background: P.bg, color: P.ink, fontFamily: "sans-serif", display: "flex", flexDirection: "column" }}>
      <header style={{ height: 58, borderBottom: `1px solid ${P.line}`, padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", background: P.surface }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={newSession}>
          <Mark size={24} accent={accent} />
          <span style={{ fontWeight: 700, fontSize: 18 }}>Cerebrum</span>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button style={{ background: "transparent", border: "none", color: P.ink2, cursor: "pointer" }} onClick={newSession}>New</button>
          <button style={{ background: "transparent", border: "none", color: P.ink2, cursor: "pointer" }} onClick={() => setCurrentView("faq")}>FAQ</button>
          <button style={{ background: "transparent", border: "none", color: P.ink2, cursor: "pointer" }} onClick={() => setSavedOpen(true)}>Saved ({saved.length})</button>
        </div>
      </header>

      <div style={{ flex: 1, padding: 24, maxWidth: 1100, margin: "0 auto", width: "100%" }}>
        {!started ? (
          <div style={{ textAlign: "center", padding: "60px 0" }}>
            <Mark size={48} accent={accent} />
            <h1 style={{ fontSize: 48, fontWeight: 750, margin: "16px 0 8px" }}>Cerebrum</h1>
            <p style={{ fontSize: 16, color: P.ink2, marginBottom: 30 }}>Your research sidekick.</p>
            <div style={{ display: "flex", gap: 8, maxWidth: 580, margin: "0 auto 20px" }}>
              <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} placeholder="Ask a question..." style={{ flex: 1, padding: "14px 18px", fontSize: 16, borderRadius: 12, border: `1px solid ${P.line2}`, outline: "none" }} />
              <button onClick={() => ask()} style={{ padding: "14px 24px", borderRadius: 12, background: accent, color: at, border: "none", fontWeight: 600, cursor: "pointer" }}>Inquire</button>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              {suggestions.map((s, i) => (
                <button key={i} onClick={() => ask(s)} style={{ padding: "8px 14px", borderRadius: 20, border: `1px solid ${P.line2}`, background: P.surface, color: P.ink2, cursor: "pointer" }}>{s}</button>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 320px", gap: 24 }}>
            <div>
              {turns.map((t, ti) => (
                <div key={ti} style={{ marginBottom: 32 }}>
                  <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>{t.q}</h2>
                  <div style={{ background: P.surface, border: `1px solid ${P.line}`, borderRadius: 16, padding: 24 }}>
                    {renderAnswer(t.answer, t.sources, P, accent, hoverCite, setHoverCite)}
                  </div>
                </div>
              ))}
              {busy && <Skeleton P={P} />}
              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} placeholder="Ask a follow-up..." style={{ flex: 1, padding: "12px 16px", borderRadius: 10, border: `1px solid ${P.line2}`, outline: "none" }} />
                <button onClick={() => ask()} style={{ padding: "12px 20px", borderRadius: 10, background: accent, color: at, border: "none", fontWeight: 600, cursor: "pointer" }}>Ask</button>
              </div>
            </div>

            <aside style={{ background: P.surface, border: `1px solid ${P.line}`, borderRadius: 16, padding: 16, height: "fit-content" }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                <button style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1px solid " + P.line2, background: panelTab === "sources" ? accent : P.bg, color: panelTab === "sources" ? at : P.ink, fontWeight: 600, cursor: "pointer" }} onClick={() => setPanelTab("sources")}>
                  Sources ({allSources.length})
                </button>
                <button style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1px solid " + P.line2, background: panelTab === "videos" ? accent : P.bg, color: panelTab === "videos" ? at : P.ink, fontWeight: 600, cursor: "pointer" }} onClick={() => setPanelTab("videos")}>
                  Related Videos ({currentVideos.length})
                </button>
              </div>

              {panelTab === "sources" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {allSources.length === 0 ? <div style={{ fontSize: 13, color: P.faint }}>Sources will appear here.</div> : (
                    allSources.map((s, i) => (
                      <div key={i} style={{ fontSize: 13, borderBottom: `1px solid ${P.line}`, paddingBottom: 8 }}>
                        <a href={s.url} target="_blank" rel="noreferrer" style={{ fontWeight: 600, color: accent, textDecoration: "none" }}>{s.title}</a>
                        <div style={{ fontSize: 11, color: P.faint, marginTop: 2 }}>{s.authors} · {s.journal}</div>
                        <button onClick={() => toggleSave(s)} style={{ fontSize: 11, background: "transparent", border: "none", color: accent, cursor: "pointer", marginTop: 4 }}>
                          {isSaved(s) ? "★ Saved" : "☆ Save"}
                        </button>
                      </div>
                    ))
                  )}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {currentVideos.length === 0 ? (
                    <div style={{ fontSize: 13, color: P.faint, padding: "12px 0", textAlign: "center" }}>No related educational videos found for this query.</div>
                  ) : (
                    currentVideos.map((v, i) => (
                      <a key={i} href={v.url} target="_blank" rel="noreferrer" style={{ textDecoration: "none", color: "inherit", border: `1px solid ${P.line}`, borderRadius: 8, overflow: "hidden", display: "block", background: P.bg }}>
                        <img src={v.thumbnail} alt={v.title} style={{ width: "100%", height: 110, objectFit: "cover" }} onError={(e) => e.target.style.display = 'none'} />
                        <div style={{ padding: 10 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.35, color: P.ink }}>{v.title}</div>
                          <div style={{ fontSize: 11, color: P.faint, marginTop: 4 }}>{v.author}</div>
                        </div>
                      </a>
                    ))
                  )}
                </div>
              )}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
