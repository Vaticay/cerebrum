import React, { useState, useRef, useEffect } from "react";
import { createRoot } from "react-dom/client";

const SUGGESTION_POOL = [
  "How does CRISPR-Cas9 achieve target specificity?",
  "Mechanism of quorum sensing in bacteria",
  "Why is the SN2 reaction stereospecific?",
  "How do chaperone proteins prevent misfolding?",
  "What causes antibiotic resistance to spread?",
  "How does mRNA vaccine technology work?",
  "The role of telomeres in cellular aging",
  "How do enzymes lower activation energy?",
  "What is the proton-motive force in respiration?",
  "How does photosynthesis split water?",
  "Mechanisms of DNA mismatch repair",
  "How do prions propagate misfolding?",
  "What drives protein phase separation?",
  "How does CRISPR base editing differ from cutting?",
  "The chemistry of atmospheric ozone depletion",
  "How do neurons encode information in spikes?",
];

function pickSuggestions(n = 4) {
  const arr = [...SUGGESTION_POOL];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, n);
}

function Logo({ size = 26, glow = true }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#5eead4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ filter: glow ? "drop-shadow(0 0 6px rgba(94,234,212,0.7))" : "none" }}>
        <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1 0-4.12A2.5 2.5 0 0 1 7.5 11a2.5 2.5 0 0 1 0-4.12A2.5 2.5 0 0 1 9.5 2Z" />
        <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 0-4.12A2.5 2.5 0 0 0 16.5 11a2.5 2.5 0 0 0 0-4.12A2.5 2.5 0 0 0 14.5 2Z" />
      </svg>
      <span style={{ fontSize: size * 0.7, fontWeight: 700, letterSpacing: "0.5px", color: "#e6fffa", textShadow: glow ? "0 0 18px rgba(94,234,212,0.4)" : "none" }}>Cerebrum</span>
    </span>
  );
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
  a.download = filename; a.click();
  URL.revokeObjectURL(a.href);
}
async function saveToZotero(sources, apiKey, userId) {
  const items = sources.map((s) => ({
    itemType: "journalArticle", title: s.title || "",
    creators: (s.authors || "").split(/,| and /).map((a) => a.trim()).filter(Boolean).map((name) => ({ creatorType: "author", name })),
    publicationTitle: s.journal || "", date: String(s.year || ""), url: s.url || "",
  }));
  const res = await fetch(`https://api.zotero.org/users/${userId}/items`, {
    method: "POST", headers: { "Zotero-API-Key": apiKey, "Content-Type": "application/json" }, body: JSON.stringify(items),
  });
  if (!res.ok) throw new Error(`Zotero ${res.status}`);
  return res.json();
}

// Clean markdown: strip # headers, render **bold**, keep paragraphs, linkify [n].
function renderAnswer(text, sources) {
  const clean = (text || "").replace(/^#{1,6}\s*/gm, "");
  return clean.split(/\n{2,}/).map((para, pi) => {
    const lines = para.split("\n");
    return (
      <p key={pi} style={S.para}>
        {lines.map((line, li) => {
          const segs = line.split(/(\*\*[^*]+\*\*|\[\d+\])/g);
          return (
            <React.Fragment key={li}>
              {segs.map((seg, si) => {
                const b = seg.match(/^\*\*([^*]+)\*\*$/);
                if (b) return <strong key={si} style={{ color: "#e6fffa" }}>{b[1]}</strong>;
                const c = seg.match(/^\[(\d+)\]$/);
                if (c) {
                  const n = parseInt(c[1], 10);
                  const src = sources[n - 1];
                  return <a key={si} href={src?.url || "#"} target="_blank" rel="noreferrer" title={src?.title || ""} style={S.cite}>{n}</a>;
                }
                return <span key={si}>{seg}</span>;
              })}
              {li < lines.length - 1 && <br />}
            </React.Fragment>
          );
        })}
      </p>
    );
  });
}

function Intro({ onDone }) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const t = [setTimeout(() => setPhase(1), 400), setTimeout(() => setPhase(2), 1300), setTimeout(() => setPhase(3), 2100)];
    return () => t.forEach(clearTimeout);
  }, []);
  return (
    <div style={S.introWrap}>
      <div style={S.introGlow} />
      <div style={{ ...S.introLogo, opacity: phase >= 1 ? 1 : 0, transform: phase >= 1 ? "scale(1) translateY(0)" : "scale(0.8) translateY(20px)" }}><Logo size={64} /></div>
      <div style={{ ...S.introTag, opacity: phase >= 2 ? 1 : 0, transform: phase >= 2 ? "translateY(0)" : "translateY(16px)" }}>The scientific mind, searchable.</div>
      <button style={{ ...S.introBtn, opacity: phase >= 3 ? 1 : 0, transform: phase >= 3 ? "translateY(0)" : "translateY(16px)" }} onClick={onDone}>Enter Cerebrum</button>
      <div style={{ ...S.introSub, opacity: phase >= 3 ? 0.6 : 0 }}>Guest mode · no account needed</div>
    </div>
  );
}

function App() {
  const [entered, setEntered] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("idle");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState([]);
  const [dbSource, setDbSource] = useState("");
  const [error, setError] = useState("");
  const [thread, setThread] = useState([]); // {role, content} for follow-ups
  const [history, setHistory] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [zoteroOpen, setZoteroOpen] = useState(false);
  const [zKey, setZKey] = useState("");
  const [zUser, setZUser] = useState("");
  const [zMsg, setZMsg] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const [hover, setHover] = useState("");
  const [suggestions, setSuggestions] = useState(pickSuggestions());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [answerLength, setAnswerLength] = useState("medium");
  const [followUp, setFollowUp] = useState("");
  const inputRef = useRef(null);

  useEffect(() => { if (entered) { inputRef.current?.focus(); setSuggestions(pickSuggestions()); } }, [entered]);

  async function run(q, isFollow = false) {
    const question = (q ?? query).trim();
    if (!question) return;
    if (!isFollow) { setThread([]); }
    setStatus("searching"); setAnswer(""); setSources([]); setDbSource(""); setError("");
    const priorThread = isFollow ? thread : [];
    try {
      const res = await fetch("/api/search", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: question, history: priorThread, settings: { answerLength } }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Search failed."); setStatus("error"); return; }
      setAnswer(data.answer || ""); setSources(data.sources || []); setDbSource(data.source || ""); setStatus("done");
      setThread((t) => [...t, { role: "user", content: question }, { role: "assistant", content: data.answer || "" }]);
      if (!isFollow) setHistory((h) => [{ q: question, answer: data.answer || "", sources: data.sources || [], source: data.source || "" }, ...h].slice(0, 30));
      setFollowUp("");
    } catch (e) { setError(`Could not reach the search backend. (${e.message})`); setStatus("error"); }
  }

  function newSearch() {
    setStatus("idle"); setAnswer(""); setSources([]); setQuery(""); setThread([]); setError("");
    setSuggestions(pickSuggestions()); setTimeout(() => inputRef.current?.focus(), 50);
  }

  function openHistory(item) {
    setQuery(item.q); setAnswer(item.answer); setSources(item.sources); setDbSource(item.source); setStatus("done"); setThread([]);
  }

  async function handleZoteroSave() {
    setZMsg("");
    if (!zKey || !zUser) { setZMsg("Enter your Zotero API key and user ID first."); return; }
    try { await saveToZotero(sources, zKey.trim(), zUser.trim()); setZMsg("Saved to your Zotero library."); }
    catch (e) { setZMsg(`Save failed: ${e.message}`); }
  }

  async function browseAll() {
    if (!query.trim()) return;
    setBrowsing(true);
    try {
      const res = await fetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: query.trim(), mode: "browse" }) });
      const data = await res.json();
      setSources(data.sources || []); setDbSource(data.source || "");
    } catch (e) { setError(`Could not load publications. (${e.message})`); }
    finally { setBrowsing(false); }
  }

  if (!entered) return <Intro onDone={() => setEntered(true)} />;

  const isHome = status === "idle";

  return (
    <div style={S.layout}>
      <aside style={{ ...S.sidebar, width: sidebarOpen ? 260 : 0, padding: sidebarOpen ? "22px 16px" : 0 }}>
        {sidebarOpen && (
          <>
            <div style={S.sideHeader}><Logo size={22} /></div>
            <button style={S.newBtn} onClick={newSearch}>+ New search</button>
            <div style={S.guestPlate}>
              <div style={S.guestAvatar}>G</div>
              <div><div style={S.guestName}>Guest</div><div style={S.guestStatus}>Local session</div></div>
            </div>
            <div style={S.sideLabel}>History</div>
            <div style={S.histList}>
              {history.length === 0 ? <div style={S.histEmpty}>No searches yet.</div> :
                history.map((item, i) => (
                  <button key={i} style={{ ...S.histItem, background: hover === "h" + i ? "#1c3a30" : "transparent" }} onMouseEnter={() => setHover("h" + i)} onMouseLeave={() => setHover("")} onClick={() => openHistory(item)}>{item.q}</button>
                ))}
            </div>
            <button style={S.settingsBtn} onClick={() => setSettingsOpen(true)}>⚙ Settings</button>
          </>
        )}
      </aside>

      <main style={S.main}>
        <div style={S.bgGlow} />
        <button style={S.toggle} onClick={() => setSidebarOpen(!sidebarOpen)}>☰</button>

        <div style={{ ...S.content, justifyContent: isHome ? "center" : "flex-start", paddingTop: isHome ? 0 : 90 }}>
          {isHome && <div style={S.hero}><Logo size={40} /><div style={S.heroTag}>Search 14 scientific databases. Get cited answers.</div></div>}

          <div style={{ ...S.inputWrap, ...(isHome ? S.inputHero : {}), boxShadow: hover === "input" ? "0 0 0 1px #5eead4, 0 0 28px rgba(94,234,212,0.25)" : "0 0 0 1px #1e3a32" }} onMouseEnter={() => setHover("input")} onMouseLeave={() => setHover("")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
              <circle cx="11" cy="11" r="7" stroke="#5eead4" strokeWidth="2" /><path d="M21 21l-4-4" stroke="#5eead4" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input ref={inputRef} style={S.input} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} placeholder="Ask a question, or search a researcher's name" />
            {query && <button style={S.go} onClick={() => run()}>→</button>}
          </div>

          {isHome && (
            <div style={S.suggWrap}>
              {suggestions.map((s, i) => (
                <button key={s} style={{ ...S.sugg, ...(hover === "s" + i ? S.suggHover : {}), animationDelay: `${i * 80}ms` }} className="cb-fade" onMouseEnter={() => setHover("s" + i)} onMouseLeave={() => setHover("")} onClick={() => run(s)}>{s}</button>
              ))}
            </div>
          )}

          {status === "searching" && <div style={S.loading}><span style={S.spinner} />searching 14 databases…</div>}
          {error && <div style={S.error}>{error}</div>}

          {status === "done" && (
            <div style={S.resultWrap} className="cb-rise">
              {answer && <div style={S.answerBox}>{renderAnswer(answer, sources)}</div>}

              {answer && (
                <div style={S.followRow}>
                  <input style={S.followInput} value={followUp} onChange={(e) => setFollowUp(e.target.value)} onKeyDown={(e) => e.key === "Enter" && followUp.trim() && run(followUp, true)} placeholder="Ask a follow-up…" />
                  <button style={S.followBtn} onClick={() => followUp.trim() && run(followUp, true)}>Ask</button>
                </div>
              )}

              {sources.length > 0 && (
                <div style={S.sources}>
                  <div style={S.sourcesHead}>
                    <div style={S.sourcesLabel}>Sources{dbSource && <span style={S.dbTag}>{dbSource}</span>}</div>
                    <div style={S.exportRow}>
                      <button style={{ ...S.exportBtn, ...(hover === "browse" ? S.exportHover : {}) }} onMouseEnter={() => setHover("browse")} onMouseLeave={() => setHover("")} onClick={browseAll} disabled={browsing}>{browsing ? "Loading…" : "Browse all"}</button>
                      <button style={{ ...S.exportBtn, ...(hover === "ris" ? S.exportHover : {}) }} onMouseEnter={() => setHover("ris")} onMouseLeave={() => setHover("")} onClick={() => download("cerebrum.ris", toRIS(sources))}>RIS</button>
                      <button style={{ ...S.exportBtn, ...(hover === "bib" ? S.exportHover : {}) }} onMouseEnter={() => setHover("bib")} onMouseLeave={() => setHover("")} onClick={() => download("cerebrum.bib", toBibTeX(sources))}>BibTeX</button>
                      <button style={S.exportPrimary} onClick={() => setZoteroOpen(!zoteroOpen)}>Zotero</button>
                    </div>
                  </div>

                  {zoteroOpen && (
                    <div style={S.zoteroPanel}>
                      <div style={S.zoteroTitle}>Save all sources to your Zotero library</div>
                      <input style={S.zInput} placeholder="Zotero API key" value={zKey} onChange={(e) => setZKey(e.target.value)} />
                      <input style={S.zInput} placeholder="Zotero user ID (number)" value={zUser} onChange={(e) => setZUser(e.target.value)} />
                      <button style={S.exportPrimary} onClick={handleZoteroSave}>Save {sources.length} items</button>
                      {zMsg && <div style={S.zMsg}>{zMsg}</div>}
                      <div style={S.zHelp}>Get a key at zotero.org/settings/keys (Allow write access). User ID is on that page. Used only in your browser.</div>
                    </div>
                  )}

                  {sources.map((s, i) => (
                    <a key={i} href={s.url} target="_blank" rel="noreferrer" style={{ ...S.source, ...(hover === "src" + i ? S.sourceHover : {}) }} onMouseEnter={() => setHover("src" + i)} onMouseLeave={() => setHover("")}>
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

        <div style={S.attribution}>Europe PMC · PubMed · OpenAlex · Crossref · arXiv · Semantic Scholar · DOAJ · Zenodo · DataCite · OpenAIRE · HAL · UTK TRACE</div>
      </main>

      {settingsOpen && (
        <div style={S.modalWrap} onClick={() => setSettingsOpen(false)}>
          <div style={S.modal} onClick={(e) => e.stopPropagation()}>
            <div style={S.modalTitle}>Settings</div>
            <div style={S.setLabel}>Answer length</div>
            <div style={S.setRow}>
              {["short", "medium", "long"].map((v) => (
                <button key={v} style={{ ...S.setOpt, ...(answerLength === v ? S.setOptActive : {}) }} onClick={() => setAnswerLength(v)}>{v}</button>
              ))}
            </div>
            <div style={S.setLabel}>Search history</div>
            <button style={S.setClear} onClick={() => { setHistory([]); }}>Clear history ({history.length})</button>
            <div style={S.setNote}>Cerebrum runs in guest mode. Nothing is stored on a server; history lives only in this browser tab.</div>
            <button style={S.modalClose} onClick={() => setSettingsOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

const teal = "#5eead4";
const S = {
  layout: { display: "flex", minHeight: "100vh", background: "#08110e", color: "#d7e5e0", fontFamily: "system-ui, 'Segoe UI', Arial, sans-serif" },
  introWrap: { minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "radial-gradient(circle at 50% 40%, #0d2620, #08110e 70%)", position: "relative", overflow: "hidden" },
  introGlow: { position: "absolute", width: 500, height: 500, borderRadius: "50%", background: "radial-gradient(circle, rgba(94,234,212,0.18), transparent 70%)", filter: "blur(20px)", animation: "cbpulse 4s ease-in-out infinite" },
  introLogo: { transition: "all 0.9s cubic-bezier(.2,.8,.2,1)", zIndex: 1 },
  introTag: { marginTop: 26, fontSize: 18, color: "#8fd8c9", letterSpacing: "0.5px", transition: "all 0.8s cubic-bezier(.2,.8,.2,1)", zIndex: 1 },
  introBtn: { marginTop: 40, padding: "13px 32px", fontSize: 15, fontWeight: 600, color: "#08110e", background: teal, border: "none", borderRadius: 30, cursor: "pointer", transition: "all 0.8s cubic-bezier(.2,.8,.2,1)", boxShadow: "0 0 30px rgba(94,234,212,0.4)", zIndex: 1 },
  introSub: { marginTop: 18, fontSize: 12, color: "#5a8078", transition: "opacity 1s ease 0.3s", zIndex: 1 },
  sidebar: { background: "#0b1a15", borderRight: "1px solid #16332a", flexShrink: 0, overflow: "hidden", transition: "width 0.25s cubic-bezier(.2,.8,.2,1)", display: "flex", flexDirection: "column" },
  sideHeader: { marginBottom: 18 },
  newBtn: { width: "100%", padding: "10px", fontSize: 13, fontWeight: 600, background: "#12291f", color: teal, border: "1px solid #1c3a30", borderRadius: 10, cursor: "pointer", marginBottom: 18 },
  guestPlate: { display: "flex", alignItems: "center", gap: 10, padding: "10px", background: "#12291f", borderRadius: 10, marginBottom: 22, border: "1px solid #1c3a30" },
  guestAvatar: { width: 34, height: 34, borderRadius: "50%", background: teal, color: "#08110e", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 },
  guestName: { fontSize: 14, fontWeight: 600, color: "#e6fffa" },
  guestStatus: { fontSize: 11, color: "#5a8078" },
  sideLabel: { fontSize: 11, textTransform: "uppercase", letterSpacing: "1.5px", color: "#4a7268", marginBottom: 10 },
  histList: { display: "flex", flexDirection: "column", gap: 2, overflowY: "auto", flex: 1 },
  histEmpty: { fontSize: 13, color: "#3f5c54" },
  histItem: { textAlign: "left", border: "none", color: "#a9c9c0", fontSize: 13, padding: "9px 10px", borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", transition: "background 0.15s" },
  settingsBtn: { marginTop: 12, padding: "10px", fontSize: 13, background: "transparent", color: "#8fd8c9", border: "1px solid #1c3a30", borderRadius: 10, cursor: "pointer" },
  main: { flex: 1, position: "relative", display: "flex", flexDirection: "column", minHeight: "100vh", overflow: "hidden" },
  bgGlow: { position: "absolute", top: -150, right: -150, width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(94,234,212,0.08), transparent 70%)", pointerEvents: "none" },
  toggle: { position: "absolute", top: 18, left: 18, background: "#12291f", border: "1px solid #1c3a30", color: teal, width: 38, height: 38, borderRadius: 10, cursor: "pointer", fontSize: 16, zIndex: 3 },
  content: { flex: 1, width: "100%", maxWidth: 720, margin: "0 auto", padding: "0 20px 40px", position: "relative", zIndex: 1, display: "flex", flexDirection: "column" },
  hero: { display: "flex", flexDirection: "column", alignItems: "center", gap: 14, marginBottom: 34 },
  heroTag: { fontSize: 15, color: "#8fd8c9", letterSpacing: "0.3px" },
  inputWrap: { display: "flex", alignItems: "center", gap: 12, padding: "0 18px", height: 54, background: "#0d1f19", borderRadius: 28, transition: "box-shadow 0.25s" },
  inputHero: { height: 60 },
  input: { flex: 1, border: "none", outline: "none", fontSize: 16, background: "transparent", color: "#e6fffa" },
  go: { border: "none", background: teal, color: "#08110e", width: 34, height: 34, borderRadius: "50%", cursor: "pointer", fontSize: 17, fontWeight: 700 },
  suggWrap: { display: "flex", flexWrap: "wrap", gap: 10, marginTop: 26, justifyContent: "center" },
  sugg: { padding: "10px 16px", fontSize: 13, background: "#0d1f19", color: "#a9c9c0", border: "1px solid #1c3a30", borderRadius: 20, cursor: "pointer", transition: "all 0.2s" },
  suggHover: { background: "#16332a", color: "#e6fffa", borderColor: teal, boxShadow: "0 0 16px rgba(94,234,212,0.2)" },
  loading: { display: "flex", alignItems: "center", gap: 12, color: "#8fd8c9", fontSize: 14, marginTop: 34 },
  spinner: { width: 18, height: 18, border: "2px solid #16332a", borderTopColor: teal, borderRadius: "50%", display: "inline-block", animation: "cbspin 0.7s linear infinite", boxShadow: "0 0 10px rgba(94,234,212,0.3)" },
  error: { marginTop: 28, padding: 14, background: "#2a1414", color: "#ff9b8a", borderRadius: 10, fontSize: 14, border: "1px solid #4a2020" },
  resultWrap: { marginTop: 26 },
  answerBox: { background: "#0d1f19", border: "1px solid #16332a", borderLeft: `3px solid ${teal}`, borderRadius: 12, padding: "20px 24px", boxShadow: "0 4px 30px rgba(0,0,0,0.3)" },
  para: { fontSize: 16, lineHeight: 1.75, margin: "0 0 14px", color: "#d7e5e0" },
  cite: { fontSize: 11, verticalAlign: "super", color: teal, textDecoration: "none", fontWeight: 700, marginLeft: 1 },
  followRow: { display: "flex", gap: 8, marginTop: 16 },
  followInput: { flex: 1, padding: "12px 16px", fontSize: 14, background: "#0d1f19", color: "#e6fffa", border: "1px solid #1c3a30", borderRadius: 24, outline: "none" },
  followBtn: { padding: "0 20px", fontSize: 14, fontWeight: 600, background: teal, color: "#08110e", border: "none", borderRadius: 24, cursor: "pointer" },
  sources: { marginTop: 30, paddingTop: 22, borderTop: "1px solid #16332a" },
  sourcesHead: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  sourcesLabel: { fontSize: 13, fontWeight: 600, color: "#8fd8c9", display: "flex", alignItems: "center", gap: 8 },
  dbTag: { fontSize: 11, fontWeight: 500, color: teal, background: "#12291f", padding: "3px 10px", borderRadius: 12, border: "1px solid #1c3a30" },
  exportRow: { display: "flex", gap: 8, flexWrap: "wrap" },
  exportBtn: { fontSize: 12, padding: "7px 14px", background: "#0d1f19", color: "#a9c9c0", border: "1px solid #1c3a30", borderRadius: 8, cursor: "pointer", transition: "all 0.18s" },
  exportHover: { background: "#16332a", color: "#e6fffa", borderColor: teal },
  exportPrimary: { fontSize: 12, padding: "7px 14px", background: teal, color: "#08110e", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 },
  zoteroPanel: { background: "#0d1f19", border: "1px solid #16332a", borderRadius: 10, padding: 16, marginBottom: 18, display: "flex", flexDirection: "column", gap: 8 },
  zoteroTitle: { fontSize: 13, fontWeight: 600, color: "#8fd8c9" },
  zInput: { padding: "9px 11px", fontSize: 13, border: "1px solid #1c3a30", background: "#08110e", color: "#e6fffa", borderRadius: 6, outline: "none" },
  zMsg: { fontSize: 12, color: teal },
  zHelp: { fontSize: 11, color: "#5a8078", lineHeight: 1.4 },
  source: { display: "flex", gap: 14, padding: "12px", margin: "0 -12px", borderRadius: 10, textDecoration: "none", color: "#d7e5e0", alignItems: "flex-start", transition: "background 0.15s" },
  sourceHover: { background: "#0d1f19" },
  num: { fontSize: 12, fontWeight: 700, color: teal, background: "#12291f", minWidth: 24, height: 24, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #1c3a30" },
  sBody: { display: "flex", flexDirection: "column", gap: 3 },
  sTitle: { fontSize: 15, color: "#7fd4f5", lineHeight: 1.35 },
  sMeta: { fontSize: 12.5, color: "#a9c9c0", lineHeight: 1.4 },
  sHost: { fontSize: 12, color: "#5a8078", marginTop: 2 },
  cc: { color: teal, fontWeight: 500 },
  attribution: { flexShrink: 0, borderTop: "1px solid #16332a", padding: "14px 20px", textAlign: "center", fontSize: 11, color: "#4a7268", background: "#0b1a15", position: "relative", zIndex: 1 },
  modalWrap: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10, backdropFilter: "blur(4px)" },
  modal: { background: "#0d1f19", border: "1px solid #1c3a30", borderRadius: 16, padding: 28, width: 380, maxWidth: "90vw", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" },
  modalTitle: { fontSize: 20, fontWeight: 700, color: "#e6fffa", marginBottom: 20 },
  setLabel: { fontSize: 12, textTransform: "uppercase", letterSpacing: "1px", color: "#4a7268", marginBottom: 10, marginTop: 8 },
  setRow: { display: "flex", gap: 8, marginBottom: 18 },
  setOpt: { flex: 1, padding: "9px", fontSize: 13, background: "#08110e", color: "#a9c9c0", border: "1px solid #1c3a30", borderRadius: 8, cursor: "pointer", textTransform: "capitalize" },
  setOptActive: { background: teal, color: "#08110e", borderColor: teal, fontWeight: 600 },
  setClear: { width: "100%", padding: "10px", fontSize: 13, background: "#08110e", color: "#ff9b8a", border: "1px solid #4a2020", borderRadius: 8, cursor: "pointer", marginBottom: 18 },
  setNote: { fontSize: 12, color: "#5a8078", lineHeight: 1.5, marginBottom: 20 },
  modalClose: { width: "100%", padding: "12px", fontSize: 14, fontWeight: 600, background: teal, color: "#08110e", border: "none", borderRadius: 10, cursor: "pointer" },
};

if (typeof document !== "undefined" && !document.getElementById("cb-anim")) {
  const st = document.createElement("style");
  st.id = "cb-anim";
  st.textContent = `
    @keyframes cbspin { to { transform: rotate(360deg); } }
    @keyframes cbpulse { 0%,100% { transform: scale(1); opacity: 0.6; } 50% { transform: scale(1.15); opacity: 1; } }
    @keyframes cbFade { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes cbRise { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: translateY(0); } }
    .cb-fade { opacity: 0; animation: cbFade 0.5s ease forwards; }
    .cb-rise { animation: cbRise 0.5s cubic-bezier(.2,.8,.2,1) forwards; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #08110e; }
    ::placeholder { color: #4a7268; }
    ::-webkit-scrollbar { width: 8px; }
    ::-webkit-scrollbar-thumb { background: #16332a; border-radius: 4px; }
  `;
  document.head.appendChild(st);
}

createRoot(document.getElementById("root")).render(<App />);
