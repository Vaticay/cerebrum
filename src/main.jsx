import React, { useState, useRef, useEffect } from "react";
import { createRoot } from "react-dom/client";

const SUGGESTIONS = [
  "How does CRISPR-Cas9 achieve target specificity?",
  "Mechanism of quorum sensing in bacteria",
  "Why is the SN2 reaction stereospecific?",
  "How do chaperone proteins prevent misfolding?",
];

function Logo({ size = 26, color = "#ffffff" }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1 0-4.12A2.5 2.5 0 0 1 7.5 11a2.5 2.5 0 0 1 0-4.12A2.5 2.5 0 0 1 9.5 2Z" />
        <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 0-4.12A2.5 2.5 0 0 0 16.5 11a2.5 2.5 0 0 0 0-4.12A2.5 2.5 0 0 0 14.5 2Z" />
      </svg>
      <span style={{ fontSize: size * 0.72, fontWeight: 700, letterSpacing: "-0.5px", color }}>Cerebrum</span>
    </span>
  );
}

function host(url) {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return "";
  }
}

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
    const key = `cerebrum${s.year || ""}_${i + 1}`;
    const fields = [];
    if (s.authors) fields.push(`  author = {${s.authors}}`);
    if (s.title) fields.push(`  title = {${s.title}}`);
    if (s.journal) fields.push(`  journal = {${s.journal}}`);
    if (s.year) fields.push(`  year = {${s.year}}`);
    if (s.url) fields.push(`  url = {${s.url}}`);
    return `@article{${key},\n${fields.join(",\n")}\n}`;
  }).join("\n\n");
}

function download(filename, text) {
  const blob = new Blob([text], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function saveToZotero(sources, apiKey, userId) {
  const items = sources.map((s) => ({
    itemType: "journalArticle",
    title: s.title || "",
    creators: (s.authors || "").split(/,| and /).map((a) => a.trim()).filter(Boolean).map((name) => ({ creatorType: "author", name })),
    publicationTitle: s.journal || "",
    date: String(s.year || ""),
    url: s.url || "",
  }));
  const res = await fetch(`https://api.zotero.org/users/${userId}/items`, {
    method: "POST",
    headers: { "Zotero-API-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(items),
  });
  if (!res.ok) throw new Error(`Zotero ${res.status}`);
  return res.json();
}

function Answer({ text, sources }) {
  return text.split("\n").map((line, li) => {
    if (!line.trim()) return null;
    const parts = line.split(/(\[\d+\])/g);
    return (
      <p key={li} style={S.para}>
        {parts.map((part, pi) => {
          const m = part.match(/^\[(\d+)\]$/);
          if (m) {
            const n = parseInt(m[1], 10);
            const src = sources[n - 1];
            return (
              <a key={pi} href={src?.url || "#"} target="_blank" rel="noreferrer" title={src?.title || ""} style={S.cite}>{n}</a>
            );
          }
          return <span key={pi}>{part}</span>;
        })}
      </p>
    );
  });
}

function Welcome({ onStart }) {
  return (
    <div style={S.welcomeOverlay}>
      <div style={S.welcomeCard}>
        <Logo size={44} color="#12261f" />
        <h2 style={S.welcomeTitle}>Your science research companion</h2>
        <p style={S.welcomeBio}>
          Cerebrum searches real scientific literature across fourteen databases including Europe PMC, PubMed, OpenAlex, Crossref, arXiv, Semantic Scholar, and the University of Tennessee's TRACE repository, then writes a clear, cited answer grounded in what it finds. Ask a research question, get a plain-language explanation with numbered citations, browse the ranked source papers, and export them straight to Zotero.
        </p>
        <div style={S.welcomeFeatures}>
          <div style={S.feat}><span style={S.featDot} />14 scientific databases, ranked by relevance</div>
          <div style={S.feat}><span style={S.featDot} />Answers written by AI, grounded in sources</div>
          <div style={S.feat}><span style={S.featDot} />One-click Zotero export</div>
        </div>
        <button style={S.welcomeBtn} onClick={onStart}>Enter as Guest</button>
        <div style={S.welcomeNote}>Guest mode. Your search history stays in this browser only and is not an account.</div>
      </div>
    </div>
  );
}

function App() {
  const [started, setStarted] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("idle");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState([]);
  const [dbSource, setDbSource] = useState("");
  const [error, setError] = useState("");
  const [history, setHistory] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [zoteroOpen, setZoteroOpen] = useState(false);
  const [zKey, setZKey] = useState("");
  const [zUser, setZUser] = useState("");
  const [zMsg, setZMsg] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (started) inputRef.current?.focus();
  }, [started]);

  async function run(q) {
    const question = (q ?? query).trim();
    if (!question) return;
    setQuery(question);
    setStatus("searching");
    setAnswer("");
    setSources([]);
    setDbSource("");
    setError("");

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: question }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Search failed.");
        setStatus("error");
        return;
      }
      setAnswer(data.answer || "");
      setSources(data.sources || []);
      setDbSource(data.source || "");
      setStatus("done");
      setHistory((h) => [{ q: question, answer: data.answer || "", sources: data.sources || [], source: data.source || "" }, ...h].slice(0, 30));
    } catch (e) {
      setError(`Could not reach the search backend. (${e.message})`);
      setStatus("error");
    }
  }

  function openHistory(item) {
    setQuery(item.q);
    setAnswer(item.answer);
    setSources(item.sources);
    setDbSource(item.source);
    setStatus("done");
  }

  async function handleZoteroSave() {
    setZMsg("");
    if (!zKey || !zUser) {
      setZMsg("Enter your Zotero API key and user ID first.");
      return;
    }
    try {
      await saveToZotero(sources, zKey.trim(), zUser.trim());
      setZMsg("Saved to your Zotero library.");
    } catch (e) {
      setZMsg(`Save failed: ${e.message}`);
    }
  }

  async function browseAll() {
    if (!query.trim()) return;
    setBrowsing(true);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim(), mode: "browse" }),
      });
      const data = await res.json();
      setSources(data.sources || []);
      setDbSource(data.source || "");
    } catch (e) {
      setError(`Could not load publications. (${e.message})`);
    } finally {
      setBrowsing(false);
    }
  }

  if (!started) return <Welcome onStart={() => setStarted(true)} />;

  return (
    <div style={S.layout}>
      <aside style={{ ...S.sidebar, width: sidebarOpen ? 260 : 0, padding: sidebarOpen ? "20px 16px" : 0 }}>
        {sidebarOpen && (
          <>
            <div style={S.sideHeader}><Logo size={24} /></div>
            <div style={S.guestPlate}>
              <div style={S.guestAvatar}>G</div>
              <div>
                <div style={S.guestName}>Guest</div>
                <div style={S.guestStatus}>Local session</div>
              </div>
            </div>
            <div style={S.sideLabel}>History</div>
            <div style={S.histList}>
              {history.length === 0 ? (
                <div style={S.histEmpty}>No searches yet.</div>
              ) : (
                history.map((item, i) => (
                  <button key={i} style={S.histItem} onClick={() => openHistory(item)}>{item.q}</button>
                ))
              )}
            </div>
          </>
        )}
      </aside>

      <main style={S.main}>
        <button style={S.toggle} onClick={() => setSidebarOpen(!sidebarOpen)}>☰</button>

        <div style={S.content}>
          <div style={S.inputWrap}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
              <circle cx="11" cy="11" r="7" stroke="#9aa0a6" strokeWidth="2" />
              <path d="M21 21l-4-4" stroke="#9aa0a6" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input ref={inputRef} style={S.input} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} placeholder="Ask a science question" />
            {query && <button style={S.go} onClick={() => run()}>→</button>}
          </div>

          {status === "idle" && (
            <div style={S.suggWrap}>
              {SUGGESTIONS.map((s) => (
                <button key={s} style={S.sugg} onClick={() => run(s)}>{s}</button>
              ))}
            </div>
          )}

          {status === "searching" && (
            <div style={S.loading}><span style={S.spinner} />searching databases and writing your answer</div>
          )}

          {error && <div style={S.error}>{error}</div>}

          {status === "done" && (
            <div style={{ marginTop: 24 }}>
              {answer && <div style={S.answerBox}><Answer text={answer} sources={sources} /></div>}
              {sources.length > 0 && (
                <div style={S.sources}>
                  <div style={S.sourcesHead}>
                    <div style={S.sourcesLabel}>Sources{dbSource && <span style={S.dbTag}>via {dbSource}</span>}</div>
                    <div style={S.exportRow}>
                      <button style={S.exportBtn} onClick={browseAll} disabled={browsing}>{browsing ? "Loading…" : "Browse all publications"}</button>
                      <button style={S.exportBtn} onClick={() => download("cerebrum.ris", toRIS(sources))}>Export RIS</button>
                      <button style={S.exportBtn} onClick={() => download("cerebrum.bib", toBibTeX(sources))}>Export BibTeX</button>
                      <button style={S.exportBtnPrimary} onClick={() => setZoteroOpen(!zoteroOpen)}>Save to Zotero</button>
                    </div>
                  </div>

                  {zoteroOpen && (
                    <div style={S.zoteroPanel}>
                      <div style={S.zoteroTitle}>Save all sources to your Zotero library</div>
                      <input style={S.zInput} placeholder="Zotero API key" value={zKey} onChange={(e) => setZKey(e.target.value)} />
                      <input style={S.zInput} placeholder="Zotero user ID (number)" value={zUser} onChange={(e) => setZUser(e.target.value)} />
                      <button style={S.exportBtnPrimary} onClick={handleZoteroSave}>Save {sources.length} items</button>
                      {zMsg && <div style={S.zMsg}>{zMsg}</div>}
                      <div style={S.zHelp}>Get a key at zotero.org/settings/keys (check "Allow write access"). Your user ID is shown on that same page. These are used only in your browser to save to your own library.</div>
                    </div>
                  )}

                  {sources.map((s, i) => (
                    <a key={i} href={s.url} target="_blank" rel="noreferrer" style={S.source}>
                      <span style={S.num}>{i + 1}</span>
                      <span style={S.sBody}>
                        <span style={S.sTitle}>{s.title || s.url}</span>
                        <span style={S.sMeta}>{[s.authors, s.journal, s.year].filter(Boolean).join(" · ")}{typeof s.citations === "number" && <span style={S.cc}> · cited {s.citations}×</span>}</span>
                        <span style={S.sHost}>{host(s.url)}</span>
                      </span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={S.attribution}>
          All publications provided by Europe PMC · PubMed · OpenAlex · Crossref · arXiv · Semantic Scholar · DOAJ · Zenodo · DataCite · OpenAIRE · HAL · UTK TRACE
        </div>
      </main>
    </div>
  );
}

const S = {
  layout: { display: "flex", minHeight: "100vh", background: "#fff", color: "#202124", fontFamily: "system-ui, 'Segoe UI', Arial, sans-serif" },
  welcomeOverlay: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg,#0d1f19,#1b3a2e)", padding: 20, fontFamily: "system-ui, 'Segoe UI', Arial, sans-serif" },
  welcomeCard: { background: "#fff", borderRadius: 18, padding: "40px 36px", maxWidth: 480, textAlign: "center", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" },
  welcomeTitle: { fontSize: 22, fontWeight: 700, margin: "20px 0 12px", color: "#12261f" },
  welcomeBio: { fontSize: 15, lineHeight: 1.6, color: "#44514b", margin: "0 0 22px" },
  welcomeFeatures: { display: "flex", flexDirection: "column", gap: 10, textAlign: "left", marginBottom: 26 },
  feat: { display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "#2c3a34" },
  featDot: { width: 8, height: 8, borderRadius: "50%", background: "#1b6b5a", flexShrink: 0 },
  welcomeBtn: { width: "100%", padding: "13px", fontSize: 15, fontWeight: 600, background: "#1b6b5a", color: "#fff", border: "none", borderRadius: 10, cursor: "pointer" },
  welcomeNote: { fontSize: 12, color: "#8a938e", marginTop: 14, lineHeight: 1.4 },
  sidebar: { background: "#12261f", color: "#fff", flexShrink: 0, overflow: "hidden", transition: "width 0.2s", display: "flex", flexDirection: "column" },
  sideHeader: { marginBottom: 20 },
  guestPlate: { display: "flex", alignItems: "center", gap: 10, padding: "10px", background: "#1c3428", borderRadius: 8, marginBottom: 20 },
  guestAvatar: { width: 34, height: 34, borderRadius: "50%", background: "#1b6b5a", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 },
  guestName: { fontSize: 14, fontWeight: 600, color: "#fff" },
  guestStatus: { fontSize: 11, color: "#7fa99a" },
  sideLabel: { fontSize: 11, textTransform: "uppercase", letterSpacing: "1px", color: "#7fa99a", marginBottom: 10 },
  histList: { display: "flex", flexDirection: "column", gap: 4, overflowY: "auto" },
  histEmpty: { fontSize: 13, color: "#5f7a70" },
  histItem: { textAlign: "left", background: "transparent", border: "none", color: "#cfe0d9", fontSize: 13, padding: "8px 10px", borderRadius: 6, cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  main: { flex: 1, position: "relative", display: "flex", flexDirection: "column", minHeight: "100vh" },
  toggle: { position: "absolute", top: 16, left: 16, background: "#f1f3f4", border: "none", width: 36, height: 36, borderRadius: 8, cursor: "pointer", fontSize: 16, zIndex: 2 },
  content: { flex: 1, width: "100%", maxWidth: 720, margin: "0 auto", padding: "80px 20px 40px" },
  inputWrap: { display: "flex", alignItems: "center", gap: 12, padding: "0 16px", height: 50, border: "1px solid #dfe1e5", borderRadius: 25, boxShadow: "0 1px 6px rgba(32,33,36,0.10)" },
  input: { flex: 1, border: "none", outline: "none", fontSize: 16, background: "transparent", color: "#202124" },
  go: { border: "none", background: "#1b6b5a", color: "#fff", width: 32, height: 32, borderRadius: "50%", cursor: "pointer", fontSize: 17 },
  suggWrap: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 24 },
  sugg: { padding: "8px 14px", fontSize: 13, background: "#f1f3f4", color: "#3c4043", border: "none", borderRadius: 16, cursor: "pointer" },
  loading: { display: "flex", alignItems: "center", gap: 10, color: "#5f6368", fontSize: 14, marginTop: 30 },
  spinner: { width: 16, height: 16, border: "2px solid #dfe1e5", borderTopColor: "#1b6b5a", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" },
  error: { marginTop: 26, padding: 14, background: "#fce8e6", color: "#c5221f", borderRadius: 8, fontSize: 14 },
  answerBox: { background: "#f8faf9", border: "1px solid #e6efec", borderLeft: "3px solid #1b6b5a", borderRadius: 8, padding: "18px 22px" },
  para: { fontSize: 16, lineHeight: 1.7, margin: "0 0 14px" },
  cite: { fontSize: 11, verticalAlign: "super", color: "#1b6b5a", textDecoration: "none", fontWeight: 700, marginLeft: 1 },
  sources: { marginTop: 28, paddingTop: 20, borderTop: "1px solid #ececec" },
  sourcesHead: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 14 },
  sourcesLabel: { fontSize: 13, fontWeight: 600, color: "#5f6368", display: "flex", alignItems: "center", gap: 8 },
  exportRow: { display: "flex", gap: 8, flexWrap: "wrap" },
  exportBtn: { fontSize: 12, padding: "6px 12px", background: "#f1f3f4", color: "#3c4043", border: "none", borderRadius: 8, cursor: "pointer" },
  exportBtnPrimary: { fontSize: 12, padding: "6px 12px", background: "#1b6b5a", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" },
  zoteroPanel: { background: "#f8faf9", border: "1px solid #e6efec", borderRadius: 8, padding: 16, marginBottom: 18, display: "flex", flexDirection: "column", gap: 8 },
  zoteroTitle: { fontSize: 13, fontWeight: 600, color: "#2c3a34" },
  zInput: { padding: "8px 10px", fontSize: 13, border: "1px solid #dfe1e5", borderRadius: 6, outline: "none" },
  zMsg: { fontSize: 12, color: "#1b6b5a" },
  zHelp: { fontSize: 11, color: "#8a938e", lineHeight: 1.4 },
  dbTag: { fontSize: 11, fontWeight: 500, color: "#1b6b5a", background: "#e8f3ef", padding: "2px 8px", borderRadius: 10 },
  source: { display: "flex", gap: 12, padding: "10px 0", textDecoration: "none", color: "#202124", alignItems: "flex-start" },
  num: { fontSize: 12, fontWeight: 600, color: "#1b6b5a", background: "#e8f3ef", minWidth: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" },
  sBody: { display: "flex", flexDirection: "column", gap: 2 },
  sTitle: { fontSize: 15, color: "#1a0dab", lineHeight: 1.35 },
  sMeta: { fontSize: 12.5, color: "#3c4043", lineHeight: 1.4 },
  sHost: { fontSize: 12, color: "#5f6368", marginTop: 2 },
  cc: { color: "#1b6b5a", fontWeight: 500 },
  attribution: { flexShrink: 0, borderTop: "1px solid #ececec", padding: "14px 20px", textAlign: "center", fontSize: 12, color: "#7a8078", background: "#fafafa" },
};

if (typeof document !== "undefined" && !document.getElementById("spin-style")) {
  const st = document.createElement("style");
  st.id = "spin-style";
  st.textContent = "@keyframes spin{to{transform:rotate(360deg)}} *{box-sizing:border-box} body{margin:0}";
  document.head.appendChild(st);
}

createRoot(document.getElementById("root")).render(<App />);
