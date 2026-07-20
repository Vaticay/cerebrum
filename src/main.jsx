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

function App() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("idle");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState([]);
  const [dbSource, setDbSource] = useState("");
  const [error, setError] = useState("");
  const [history, setHistory] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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

  return (
    <div style={S.layout}>
      <aside style={{ ...S.sidebar, width: sidebarOpen ? 260 : 0, padding: sidebarOpen ? "20px 16px" : 0 }}>
        {sidebarOpen && (
          <>
            <div style={S.sideHeader}><Logo size={24} /></div>
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
                  <div style={S.sourcesLabel}>Sources{dbSource && <span style={S.dbTag}>via {dbSource}</span>}</div>
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
          All publications provided by Europe PMC · PubMed · OpenAlex · UTK TRACE
        </div>
      </main>
    </div>
  );
}

const S = {
  layout: { display: "flex", minHeight: "100vh", background: "#fff", color: "#202124", fontFamily: "system-ui, 'Segoe UI', Arial, sans-serif" },
  sidebar: { background: "#12261f", color: "#fff", flexShrink: 0, overflow: "hidden", transition: "width 0.2s", display: "flex", flexDirection: "column" },
  sideHeader: { marginBottom: 24 },
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
  sourcesLabel: { fontSize: 13, fontWeight: 600, color: "#5f6368", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 },
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
