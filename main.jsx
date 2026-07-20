import React, { useState, useRef, useEffect } from "react";

const SUGGESTIONS = [
  "How does CRISPR-Cas9 achieve target specificity?",
  "Mechanism of quorum sensing in bacteria",
  "Why is the SN2 reaction stereospecific?",
  "How do chaperone proteins prevent misfolding?",
];

export default function Cerebrum() {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | searching | done | error
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState([]);
  const [dbSource, setDbSource] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [submitted]);

  async function run(q) {
    const question = (q ?? query).trim();
    if (!question) return;
    setQuery(question);
    setSubmitted(true);
    setStatus("searching");
    setAnswer("");
    setSources([]);
    setDbSource("");
    setNote("");
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
      setNote(data.note || "");
      setStatus("done");
    } catch (e) {
      setError(`Could not reach the backend. Is it running? (${e.message})`);
      setStatus("error");
    }
  }

  function renderAnswer(txt) {
    return txt.split("\n").map((line, li) => {
      if (!line.trim()) return null;
      const parts = line.split(/(\[\d+\])/g);
      return (
        <p key={li} style={styles.para}>
          {parts.map((part, pi) => {
            const m = part.match(/^\[(\d+)\]$/);
            if (m) {
              const n = parseInt(m[1], 10);
              const src = sources[n - 1];
              return (
                <a
                  key={pi}
                  href={src?.url || "#"}
                  target="_blank"
                  rel="noreferrer"
                  title={src?.title || ""}
                  style={styles.cite}
                >
                  {n}
                </a>
              );
            }
            return <span key={pi}>{part}</span>;
          })}
        </p>
      );
    });
  }

  const compact = submitted;

  return (
    <div style={styles.page}>
      <div style={{ ...styles.wrap, paddingTop: compact ? 24 : 120 }}>
        <div
          style={{
            ...styles.brandRow,
            justifyContent: compact ? "flex-start" : "center",
            marginBottom: compact ? 18 : 28,
          }}
        >
          <Logo size={compact ? 26 : 40} />
        </div>

        <div
          style={{
            ...styles.searchRow,
            maxWidth: compact ? "100%" : 560,
            margin: compact ? "0" : "0 auto",
          }}
        >
          <div style={styles.inputWrap}>
            <SearchIcon />
            <input
              ref={inputRef}
              style={styles.input}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && run()}
              placeholder="Search the scientific literature"
            />
            {query && (
              <button style={styles.goBtn} onClick={() => run()}>
                →
              </button>
            )}
          </div>
        </div>

        {!compact && (
          <div style={styles.suggWrap}>
            {SUGGESTIONS.map((s) => (
              <button key={s} style={styles.sugg} onClick={() => run(s)}>
                {s}
              </button>
            ))}
          </div>
        )}

        {status === "searching" && (
          <div style={styles.loading}>
            <span style={styles.spinner} />
            searching databases and reading papers
          </div>
        )}

        {error && <div style={styles.error}>{error}</div>}

        {status === "done" && (
          <div style={styles.result}>
            {note && <div style={styles.note}>{note}</div>}

            {answer && <div style={styles.answer}>{renderAnswer(answer)}</div>}

            {sources.length > 0 && (
              <div style={styles.sources}>
                <div style={styles.sourcesLabel}>
                  Sources
                  {dbSource && <span style={styles.dbTag}>via {dbSource}</span>}
                </div>
                {sources.map((s, i) => (
                  <a
                    key={i}
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    style={styles.source}
                  >
                    <span style={styles.sourceNum}>{i + 1}</span>
                    <span style={styles.sourceBody}>
                      <span style={styles.sourceTitle}>
                        {s.title || s.url}
                      </span>
                      <span style={styles.sourceMeta}>
                        {[s.authors, s.journal, s.year]
                          .filter(Boolean)
                          .join(" · ")}
                        {typeof s.citations === "number" && (
                          <span style={styles.citeCount}>
                            {" "}
                            · cited {s.citations}×
                          </span>
                        )}
                      </span>
                      <span style={styles.sourceHost}>{host(s.url)}</span>
                    </span>
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function host(url) {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return "";
  }
}

function Logo({ size }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
        <path
          d="M20 4c-6 0-10 4-10 8 0 2 1 3 1 4-2 1-4 3-4 6s2 5 4 6c0 3 3 6 9 6s9-3 9-6c2-1 4-3 4-6s-2-5-4-6c0-1 1-2 1-4 0-4-4-8-10-8z"
          stroke="#1b6b5a"
          strokeWidth="1.6"
          fill="#e8f3ef"
        />
        <path
          d="M20 8v24M13 16c3 0 4 2 7 2s4-2 7-2M13 24c3 0 4-2 7-2s4 2 7 2"
          stroke="#1b6b5a"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
      <span
        style={{
          fontSize: size * 0.66,
          fontWeight: 600,
          letterSpacing: "-0.5px",
          color: "#202124",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        Cerebrum
      </span>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="11" cy="11" r="7" stroke="#9aa0a6" strokeWidth="2" />
      <path d="M21 21l-4-4" stroke="#9aa0a6" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "#fff",
    color: "#202124",
    fontFamily: "system-ui, 'Segoe UI', sans-serif",
  },
  wrap: { maxWidth: 720, margin: "0 auto", padding: "0 20px 80px" },
  brandRow: { display: "flex", alignItems: "center" },
  searchRow: { width: "100%" },
  inputWrap: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "0 16px",
    height: 48,
    border: "1px solid #dfe1e5",
    borderRadius: 24,
    background: "#fff",
    boxShadow: "0 1px 6px rgba(32,33,36,0.08)",
  },
  input: {
    flex: 1,
    border: "none",
    outline: "none",
    fontSize: 16,
    background: "transparent",
    color: "#202124",
  },
  goBtn: {
    border: "none",
    background: "#1b6b5a",
    color: "#fff",
    width: 30,
    height: 30,
    borderRadius: "50%",
    cursor: "pointer",
    fontSize: 16,
    lineHeight: 1,
  },
  suggWrap: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "center",
    marginTop: 24,
    maxWidth: 560,
    marginLeft: "auto",
    marginRight: "auto",
  },
  sugg: {
    padding: "7px 14px",
    fontSize: 13,
    background: "#f1f3f4",
    color: "#3c4043",
    border: "none",
    borderRadius: 16,
    cursor: "pointer",
  },
  loading: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    color: "#5f6368",
    fontSize: 14,
    marginTop: 28,
  },
  spinner: {
    width: 16,
    height: 16,
    border: "2px solid #dfe1e5",
    borderTopColor: "#1b6b5a",
    borderRadius: "50%",
    display: "inline-block",
    animation: "cbspin 0.7s linear infinite",
  },
  error: {
    marginTop: 24,
    padding: 14,
    background: "#fce8e6",
    color: "#c5221f",
    borderRadius: 8,
    fontSize: 14,
  },
  note: {
    marginBottom: 16,
    padding: 12,
    background: "#fef7e0",
    color: "#7a5b00",
    borderRadius: 8,
    fontSize: 13,
  },
  result: { marginTop: 28 },
  answer: { marginBottom: 8 },
  para: { fontSize: 16, lineHeight: 1.7, margin: "0 0 14px", color: "#202124" },
  cite: {
    fontSize: 11,
    verticalAlign: "super",
    color: "#1b6b5a",
    textDecoration: "none",
    fontWeight: 600,
    padding: "0 1px",
    marginLeft: 1,
  },
  sources: { marginTop: 28, paddingTop: 20, borderTop: "1px solid #ececec" },
  sourcesLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: "#5f6368",
    marginBottom: 12,
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  dbTag: {
    fontSize: 11,
    fontWeight: 500,
    color: "#1b6b5a",
    background: "#e8f3ef",
    padding: "2px 8px",
    borderRadius: 10,
  },
  source: {
    display: "flex",
    gap: 12,
    padding: "10px 0",
    textDecoration: "none",
    color: "#202124",
    alignItems: "flex-start",
  },
  sourceNum: {
    fontSize: 12,
    fontWeight: 600,
    color: "#1b6b5a",
    background: "#e8f3ef",
    minWidth: 22,
    height: 22,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  sourceBody: { display: "flex", flexDirection: "column", gap: 2 },
  sourceTitle: { fontSize: 15, color: "#1a0dab", lineHeight: 1.35 },
  sourceMeta: { fontSize: 12.5, color: "#3c4043", lineHeight: 1.4 },
  sourceHost: { fontSize: 12, color: "#5f6368", marginTop: 2 },
  citeCount: { color: "#1b6b5a", fontWeight: 500 },
};

if (typeof document !== "undefined" && !document.getElementById("cbspin")) {
  const st = document.createElement("style");
  st.id = "cbspin";
  st.textContent = "@keyframes cbspin{to{transform:rotate(360deg)}}";
  document.head.appendChild(st);
}
