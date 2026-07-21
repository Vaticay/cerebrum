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
  "How does photosynthesis split water?",
  "Mechanisms of DNA mismatch repair",
  "How do prions propagate misfolding?",
  "What drives protein phase separation?",
];
function pick(n = 4) {
  const a = [...SUGGESTION_POOL];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}

// ---------- Audio: synthesized clicks + ambient search hum ----------
const Audio = (() => {
  let ctx = null;
  let ambient = null;
  function ac() {
    if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { ctx = null; } }
    return ctx;
  }
  function click() {
    const c = ac(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = "sine"; o.frequency.value = 620;
    g.gain.setValueAtTime(0.0001, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.08, c.currentTime + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.09);
    o.connect(g); g.connect(c.destination);
    o.start(); o.stop(c.currentTime + 0.1);
  }
  function startAmbient() {
    const c = ac(); if (!c || ambient) return;
    const o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain();
    o.type = "sine"; o.frequency.value = 110;
    o2.type = "sine"; o2.frequency.value = 164.81;
    g.gain.setValueAtTime(0.0001, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.035, c.currentTime + 0.4);
    o.connect(g); o2.connect(g); g.connect(c.destination);
    o.start(); o2.start();
    ambient = { o, o2, g };
  }
  function stopAmbient() {
    if (!ambient || !ctx) return;
    const { o, o2, g } = ambient;
    try {
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
      o.stop(ctx.currentTime + 0.35); o2.stop(ctx.currentTime + 0.35);
    } catch {}
    ambient = null;
  }
  return { click, startAmbient, stopAmbient };
})();

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
    const fields = [];
    if (s.authors) fields.push(`  author = {${s.authors}}`);
    if (s.title) fields.push(`  title = {${s.title}}`);
    if (s.journal) fields.push(`  journal = {${s.journal}}`);
    if (s.year) fields.push(`  year = {${s.year}}`);
    if (s.url) fields.push(`  url = {${s.url}}`);
    return `@article{cerebrum${s.year || ""}_${i + 1},\n${fields.join(",\n")}\n}`;
  }).join("\n\n");
}
function download(fn, text) {
  const blob = new Blob([text], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = fn; a.click();
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
function renderAnswer(text, sources) {
  const clean = (text || "").replace(/^#{1,6}\s*/gm, "");
  return clean.split(/\n{2,}/).map((para, pi) => (
    <p key={pi} style={S.para}>
      {para.split("\n").map((line, li) => (
        <React.Fragment key={li}>
          {line.split(/(\*\*[^*]+\*\*|\[\d+\])/g).map((seg, si) => {
            const b = seg.match(/^\*\*([^*]+)\*\*$/);
            if (b) return <strong key={si} style={{ color: "#e6fffa" }}>{b[1]}</strong>;
            const c = seg.match(/^\[(\d+)\]$/);
            if (c) { const n = parseInt(c[1], 10); const src = sources[n - 1]; return <a key={si} href={src?.url || "#"} target="_blank" rel="noreferrer" title={src?.title || ""} style={S.cite}>{n}</a>; }
            return <span key={si}>{seg}</span>;
          })}
          {li < para.split("\n").length - 1 && <br />}
        </React.Fragment>
      ))}
    </p>
  ));
}

function Intro({ onDone }) {
  const [p, setP] = useState(0);
  useEffect(() => {
    const t = [setTimeout(() => setP(1), 400), setTimeout(() => setP(2), 1300), setTimeout(() => setP(3), 2100)];
    return () => t.forEach(clearTimeout);
  }, []);
  return (
    <div style={S.introWrap}>
      <div style={S.introGlow} />
      <div style={{ ...S.introLogo, opacity: p >= 1 ? 1 : 0, transform: p >= 1 ? "scale(1) translateY(0)" : "scale(0.8) translateY(20px)" }}><Logo size={56} /></div>
      <div style={{ ...S.introTag, opacity: p >= 2 ? 1 : 0, transform: p >= 2 ? "translateY(0)" : "translateY(16px)" }}>The scientific mind, searchable.</div>
      <button style={{ ...S.introBtn, opacity: p >= 3 ? 1 : 0, transform: p >= 3 ? "translateY(0)" : "translateY(16px)" }} onClick={onDone}>Enter Cerebrum</button>
      <div style={{ ...S.introSub, opacity: p >= 3 ? 0.6 : 0 }}>Guest mode · no account needed</div>
    </div>
  );
}

function useIsMobile() {
  const [m, setM] = useState(typeof window !== "undefined" ? window.innerWidth < 820 : false);
  useEffect(() => {
    const onR = () => setM(window.innerWidth < 820);
    window.addEventListener("resize", onR);
    return () => window.removeEventListener("resize", onR);
  }, []);
  return m;
}

function App() {
  const isMobile = useIsMobile();
  const [entered, setEntered] = useState(false);
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [allSources, setAllSources] = useState([]);
  const [saved, setSaved] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  const [panelOpen, setPanelOpen] = useState(!isMobile);
  const [mobilePanel, setMobilePanel] = useState(false);
  const [suggestions, setSuggestions] = useState(pick());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [zoteroOpen, setZoteroOpen] = useState(false);
  const [zKey, setZKey] = useState(""); const [zUser, setZUser] = useState(""); const [zMsg, setZMsg] = useState("");
  const [answerLength, setAnswerLength] = useState("medium");
  const [muted, setMuted] = useState(false);
  const [hover, setHover] = useState("");
  const inputRef = useRef(null);
  const threadRef = useRef(null);
  const mutedRef = useRef(false);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  const sfx = () => { if (!mutedRef.current) Audio.click(); };

  useEffect(() => { if (entered && !isMobile) inputRef.current?.focus(); }, [entered, isMobile]);
  useEffect(() => { if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight; }, [turns, busy]);
  useEffect(() => {
    if (busy && !muted) Audio.startAmbient(); else Audio.stopAmbient();
    return () => Audio.stopAmbient();
  }, [busy, muted]);

  async function ask(q) {
    const question = (q ?? input).trim();
    if (!question || busy) return;
    sfx();
    setInput(""); setBusy(true); setError(""); if (isMobile) setSidebarOpen(false);
    const priorThread = [];
    turns.forEach((t) => { priorThread.push({ role: "user", content: t.q }); priorThread.push({ role: "assistant", content: t.answer }); });
    try {
      const res = await fetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: question, history: priorThread, settings: { answerLength } }) });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Search failed."); setBusy(false); return; }
      const nt = { q: question, answer: data.answer || "", sources: data.sources || [], source: data.source || "" };
      setTurns((t) => [...t, nt]);
      setAllSources((prev) => {
        const seen = new Set(prev.map((s) => (s.title || "").toLowerCase()));
        return [...prev, ...(data.sources || []).filter((s) => !seen.has((s.title || "").toLowerCase()))];
      });
      if (turns.length === 0) setSessions((s) => [{ q: question, ts: Date.now() }, ...s].slice(0, 30));
    } catch (e) { setError(`Could not reach the backend. (${e.message})`); }
    finally { setBusy(false); }
  }

  function newSession() { sfx(); setTurns([]); setAllSources([]); setInput(""); setError(""); setSuggestions(pick()); if (isMobile) setSidebarOpen(false); setTimeout(() => inputRef.current?.focus(), 50); }
  function toggleSave(s) {
    sfx();
    setSaved((prev) => {
      const k = (s.title || "").toLowerCase();
      return prev.some((x) => (x.title || "").toLowerCase() === k) ? prev.filter((x) => (x.title || "").toLowerCase() !== k) : [...prev, s];
    });
  }
  const isSaved = (s) => saved.some((x) => (x.title || "").toLowerCase() === (s.title || "").toLowerCase());
  async function doZotero() {
    setZMsg(""); const list = saved.length ? saved : allSources;
    if (!zKey || !zUser) { setZMsg("Enter your Zotero API key and user ID."); return; }
    try { await saveToZotero(list, zKey.trim(), zUser.trim()); setZMsg(`Saved ${list.length} items.`); }
    catch (e) { setZMsg(`Failed: ${e.message}`); }
  }

  if (!entered) return <Intro onDone={() => { sfx(); setEntered(true); }} />;

  const started = turns.length > 0 || busy;
  const exportList = saved.length ? saved : allSources;

  const SourcesPanelInner = (
    <>
      <div style={S.panelHead}>
        <span style={S.panelTitle}>Sources</span>
        <span style={S.panelCount}>{allSources.length}</span>
      </div>
      {allSources.length > 0 && (
        <div style={S.panelActions}>
          <button style={S.pBtn} onClick={() => { sfx(); download("cerebrum.ris", toRIS(exportList)); }}>RIS</button>
          <button style={S.pBtn} onClick={() => { sfx(); download("cerebrum.bib", toBibTeX(exportList)); }}>BibTeX</button>
          <button style={S.pBtnPrimary} onClick={() => { sfx(); setZoteroOpen(!zoteroOpen); }}>Zotero</button>
        </div>
      )}
      {saved.length > 0 && <div style={S.savedNote}>{saved.length} saved · exports use saved only</div>}
      {zoteroOpen && (
        <div style={S.zoteroPanel}>
          <input style={S.zInput} placeholder="Zotero API key" value={zKey} onChange={(e) => setZKey(e.target.value)} />
          <input style={S.zInput} placeholder="Zotero user ID" value={zUser} onChange={(e) => setZUser(e.target.value)} />
          <button style={S.pBtnPrimary} onClick={doZotero}>Save {exportList.length}</button>
          {zMsg && <div style={S.zMsg}>{zMsg}</div>}
        </div>
      )}
      <div style={S.panelList}>
        {allSources.length === 0 ? <div style={S.histEmpty}>Sources appear here as you research.</div> :
          allSources.map((s, i) => (
            <div key={i} style={S.pSource}>
              <div style={S.pSrcTop}>
                <a href={s.url} target="_blank" rel="noreferrer" style={S.pSrcTitle}>{s.title || s.url}</a>
                <button style={{ ...S.star, color: isSaved(s) ? "#5eead4" : "#3f5c54" }} onClick={() => toggleSave(s)}>{isSaved(s) ? "★" : "☆"}</button>
              </div>
              <div style={S.pSrcMeta}>{[s.authors, s.journal, s.year].filter(Boolean).join(" · ")}{typeof s.citations === "number" && ` · cited ${s.citations}×`}</div>
              {s.authors && <button style={S.authorLink} onClick={() => { setMobilePanel(false); ask(`papers by ${(s.authors || "").replace(" et al.", "")}`); }}>see author's work →</button>}
            </div>
          ))}
      </div>
    </>
  );

  return (
    <div style={S.layout}>
      {/* LEFT sidebar */}
      {sidebarOpen && isMobile && <div style={S.scrim} onClick={() => setSidebarOpen(false)} />}
      <aside style={{ ...S.sidebar, ...(isMobile ? S.sidebarMobile : {}), width: sidebarOpen ? (isMobile ? 260 : 240) : 0, padding: sidebarOpen ? "18px 14px" : 0, transform: isMobile ? (sidebarOpen ? "translateX(0)" : "translateX(-100%)") : "none" }}>
        {sidebarOpen && (
          <>
            <div style={S.sideHeader}><Logo size={20} /></div>
            <button style={S.newBtn} onClick={newSession}>+ New investigation</button>
            <div style={S.guestPlate}><div style={S.guestAvatar}>G</div><div><div style={S.guestName}>Guest</div><div style={S.guestStatus}>Local session</div></div></div>
            <div style={S.sideLabel}>Recent</div>
            <div style={S.histList}>
              {sessions.length === 0 ? <div style={S.histEmpty}>No investigations yet.</div> :
                sessions.map((s, i) => <div key={i} style={S.histItem} title={s.q}>{s.q}</div>)}
            </div>
            <button style={S.settingsBtn} onClick={() => { sfx(); setSettingsOpen(true); }}>⚙ Settings</button>
          </>
        )}
      </aside>

      {/* CENTER */}
      <main style={S.main}>
        <div style={S.bgGlow} />
        <div style={S.topBar}>
          <button style={S.iconBtn} onClick={() => { sfx(); setSidebarOpen(!sidebarOpen); }}>☰</button>
          <div style={{ flex: 1 }} />
          <button style={S.iconBtn} onClick={() => { setMuted(!muted); }} title={muted ? "Unmute" : "Mute"}>{muted ? "🔇" : "🔊"}</button>
          {started && (isMobile
            ? <button style={S.iconBtn} onClick={() => setMobilePanel(true)}>❋ {allSources.length}</button>
            : <button style={S.iconBtn} onClick={() => setPanelOpen(!panelOpen)}>{panelOpen ? "⇥" : "⇤"}</button>)}
        </div>

        {!started ? (
          <div style={S.homeWrap}>
            <div style={S.hero}><Logo size={isMobile ? 32 : 40} /><div style={S.heroTag}>Ask a question, follow a thread, or search a researcher by name.</div></div>
            <div style={{ ...S.inputWrap, ...S.inputHero, boxShadow: hover === "in" ? "0 0 0 1px #5eead4, 0 0 28px rgba(94,234,212,0.25)" : "0 0 0 1px #1e3a32" }} onMouseEnter={() => setHover("in")} onMouseLeave={() => setHover("")}>
              <SearchIcon />
              <input ref={inputRef} style={S.input} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} placeholder={isMobile ? "Ask or search a name" : "Ask a question or search a researcher's name"} />
              {input && <button style={S.go} onClick={() => ask()}>→</button>}
            </div>
            <div style={S.suggWrap}>
              {suggestions.map((s, i) => (
                <button key={s} className="cb-fade" style={{ ...S.sugg, ...(hover === "s" + i ? S.suggHover : {}), animationDelay: `${i * 80}ms` }} onMouseEnter={() => setHover("s" + i)} onMouseLeave={() => setHover("")} onClick={() => ask(s)}>{s}</button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div style={S.thread} ref={threadRef}>
              {turns.map((t, ti) => (
                <div key={ti} style={S.turn} className="cb-rise">
                  <div style={S.qRow}><span style={S.qBadge}>You</span><span style={S.qText}>{t.q}</span></div>
                  <div style={S.answerBox}>{renderAnswer(t.answer, t.sources)}{t.source && <div style={S.srcTag}>{t.source}</div>}</div>
                </div>
              ))}
              {busy && <div style={S.loading}><span style={S.spinner} />searching 14 databases…</div>}
              {error && <div style={S.error}>{error}</div>}
            </div>
            <div style={S.followBar}>
              <div style={{ ...S.inputWrap, boxShadow: hover === "f" ? "0 0 0 1px #5eead4, 0 0 20px rgba(94,234,212,0.2)" : "0 0 0 1px #1e3a32" }} onMouseEnter={() => setHover("f")} onMouseLeave={() => setHover("")}>
                <SearchIcon />
                <input ref={inputRef} style={S.input} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} placeholder="Ask a follow-up…" />
                {input && <button style={S.go} onClick={() => ask()}>→</button>}
              </div>
            </div>
          </>
        )}
        <div style={S.attribution}>Europe PMC · PubMed · OpenAlex · Crossref · arXiv · Semantic Scholar · DOAJ · Zenodo · DataCite · OpenAIRE · HAL · UTK TRACE</div>
      </main>

      {/* RIGHT panel: desktop inline, mobile overlay */}
      {started && !isMobile && panelOpen && <aside style={S.panel}>{SourcesPanelInner}</aside>}
      {started && isMobile && mobilePanel && (
        <>
          <div style={S.scrim} onClick={() => setMobilePanel(false)} />
          <aside style={{ ...S.panel, ...S.panelMobile }}>
            <button style={S.panelClose} onClick={() => setMobilePanel(false)}>✕ Close</button>
            {SourcesPanelInner}
          </aside>
        </>
      )}

      {settingsOpen && (
        <div style={S.modalWrap} onClick={() => setSettingsOpen(false)}>
          <div style={S.modal} onClick={(e) => e.stopPropagation()}>
            <div style={S.modalTitle}>Settings</div>
            <div style={S.setLabel}>Answer length</div>
            <div style={S.setRow}>{["short", "medium", "long"].map((v) => (
              <button key={v} style={{ ...S.setOpt, ...(answerLength === v ? S.setOptActive : {}) }} onClick={() => { sfx(); setAnswerLength(v); }}>{v}</button>))}</div>
            <div style={S.setLabel}>Sound</div>
            <button style={{ ...S.setOpt, width: "100%", marginBottom: 18, ...(muted ? {} : S.setOptActive) }} onClick={() => setMuted(!muted)}>{muted ? "Sound off" : "Sound on"}</button>
            <div style={S.setLabel}>Data</div>
            <button style={S.setClear} onClick={() => { setSessions([]); setSaved([]); }}>Clear all sessions & saved</button>
            <div style={S.setNote}>Guest mode. Nothing is stored on a server; everything lives in this browser only.</div>
            <button style={S.modalClose} onClick={() => setSettingsOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="11" cy="11" r="7" stroke="#5eead4" strokeWidth="2" /><path d="M21 21l-4-4" stroke="#5eead4" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const teal = "#5eead4";
const S = {
  layout: { display: "flex", minHeight: "100vh", height: "100vh", background: "#08110e", color: "#d7e5e0", fontFamily: "system-ui, 'Segoe UI', Arial, sans-serif", overflow: "hidden" },
  introWrap: { minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "radial-gradient(circle at 50% 40%, #0d2620, #08110e 70%)", position: "relative", overflow: "hidden", padding: 20 },
  introGlow: { position: "absolute", width: 420, height: 420, borderRadius: "50%", background: "radial-gradient(circle, rgba(94,234,212,0.18), transparent 70%)", filter: "blur(20px)", animation: "cbpulse 4s ease-in-out infinite" },
  introLogo: { transition: "all 0.9s cubic-bezier(.2,.8,.2,1)", zIndex: 1 },
  introTag: { marginTop: 24, fontSize: 17, color: "#8fd8c9", transition: "all 0.8s cubic-bezier(.2,.8,.2,1)", zIndex: 1, textAlign: "center" },
  introBtn: { marginTop: 36, padding: "13px 30px", fontSize: 15, fontWeight: 600, color: "#08110e", background: teal, border: "none", borderRadius: 30, cursor: "pointer", transition: "all 0.8s cubic-bezier(.2,.8,.2,1)", boxShadow: "0 0 30px rgba(94,234,212,0.4)", zIndex: 1 },
  introSub: { marginTop: 16, fontSize: 12, color: "#5a8078", transition: "opacity 1s ease 0.3s", zIndex: 1 },
  sidebar: { background: "#0b1a15", borderRight: "1px solid #16332a", flexShrink: 0, overflow: "hidden", transition: "all 0.25s cubic-bezier(.2,.8,.2,1)", display: "flex", flexDirection: "column", height: "100vh" },
  sidebarMobile: { position: "fixed", top: 0, left: 0, zIndex: 30, boxShadow: "6px 0 30px rgba(0,0,0,0.5)" },
  scrim: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 25, backdropFilter: "blur(2px)" },
  sideHeader: { marginBottom: 16 },
  newBtn: { width: "100%", padding: "11px", fontSize: 13, fontWeight: 600, background: "#12291f", color: teal, border: "1px solid #1c3a30", borderRadius: 10, cursor: "pointer", marginBottom: 16 },
  guestPlate: { display: "flex", alignItems: "center", gap: 10, padding: "9px", background: "#12291f", borderRadius: 10, marginBottom: 18, border: "1px solid #1c3a30" },
  guestAvatar: { width: 32, height: 32, borderRadius: "50%", background: teal, color: "#08110e", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 },
  guestName: { fontSize: 13, fontWeight: 600, color: "#e6fffa" },
  guestStatus: { fontSize: 11, color: "#5a8078" },
  sideLabel: { fontSize: 11, textTransform: "uppercase", letterSpacing: "1.5px", color: "#4a7268", marginBottom: 8 },
  histList: { display: "flex", flexDirection: "column", gap: 2, overflowY: "auto", flex: 1 },
  histEmpty: { fontSize: 12.5, color: "#3f5c54", lineHeight: 1.5 },
  histItem: { color: "#a9c9c0", fontSize: 13, padding: "8px 10px", borderRadius: 8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  settingsBtn: { marginTop: 10, padding: "11px", fontSize: 13, background: "transparent", color: "#8fd8c9", border: "1px solid #1c3a30", borderRadius: 10, cursor: "pointer" },
  main: { flex: 1, position: "relative", display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", minWidth: 0 },
  bgGlow: { position: "absolute", top: -150, right: -150, width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(94,234,212,0.06), transparent 70%)", pointerEvents: "none" },
  topBar: { display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", flexShrink: 0, zIndex: 3 },
  iconBtn: { background: "#12291f", border: "1px solid #1c3a30", color: teal, minWidth: 40, height: 40, padding: "0 10px", borderRadius: 10, cursor: "pointer", fontSize: 15 },
  homeWrap: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 18px", zIndex: 1 },
  hero: { display: "flex", flexDirection: "column", alignItems: "center", gap: 14, marginBottom: 30 },
  heroTag: { fontSize: 14.5, color: "#8fd8c9", textAlign: "center", maxWidth: 400, lineHeight: 1.5 },
  inputWrap: { display: "flex", alignItems: "center", gap: 12, padding: "0 16px", height: 52, background: "#0d1f19", borderRadius: 28, transition: "box-shadow 0.25s", width: "100%", maxWidth: 620 },
  inputHero: { height: 58 },
  input: { flex: 1, border: "none", outline: "none", fontSize: 16, background: "transparent", color: "#e6fffa", minWidth: 0 },
  go: { border: "none", background: teal, color: "#08110e", width: 36, height: 36, borderRadius: "50%", cursor: "pointer", fontSize: 17, fontWeight: 700, flexShrink: 0 },
  suggWrap: { display: "flex", flexWrap: "wrap", gap: 9, marginTop: 22, justifyContent: "center", maxWidth: 620 },
  sugg: { padding: "10px 15px", fontSize: 13, background: "#0d1f19", color: "#a9c9c0", border: "1px solid #1c3a30", borderRadius: 20, cursor: "pointer", transition: "all 0.2s" },
  suggHover: { background: "#16332a", color: "#e6fffa", borderColor: teal, boxShadow: "0 0 16px rgba(94,234,212,0.2)" },
  thread: { flex: 1, overflowY: "auto", padding: "8px 18px 16px", maxWidth: 760, width: "100%", margin: "0 auto", zIndex: 1 },
  turn: { marginBottom: 26 },
  qRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" },
  qBadge: { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", color: "#08110e", background: teal, padding: "3px 8px", borderRadius: 6 },
  qText: { fontSize: 16.5, fontWeight: 600, color: "#e6fffa" },
  answerBox: { background: "#0d1f19", border: "1px solid #16332a", borderLeft: `3px solid ${teal}`, borderRadius: 12, padding: "16px 20px", boxShadow: "0 4px 24px rgba(0,0,0,0.25)" },
  para: { fontSize: 15.5, lineHeight: 1.75, margin: "0 0 14px", color: "#d7e5e0" },
  cite: { fontSize: 11, verticalAlign: "super", color: teal, textDecoration: "none", fontWeight: 700, marginLeft: 1 },
  srcTag: { marginTop: 10, fontSize: 11, color: "#4a7268" },
  loading: { display: "flex", alignItems: "center", gap: 12, color: "#8fd8c9", fontSize: 14, padding: "10px 0" },
  spinner: { width: 18, height: 18, border: "2px solid #16332a", borderTopColor: teal, borderRadius: "50%", display: "inline-block", animation: "cbspin 0.7s linear infinite", boxShadow: "0 0 10px rgba(94,234,212,0.3)" },
  error: { padding: 14, background: "#2a1414", color: "#ff9b8a", borderRadius: 10, fontSize: 14, border: "1px solid #4a2020" },
  followBar: { flexShrink: 0, padding: "10px 18px", maxWidth: 760, width: "100%", margin: "0 auto", zIndex: 1 },
  attribution: { flexShrink: 0, borderTop: "1px solid #16332a", padding: "9px 14px", textAlign: "center", fontSize: 10, color: "#3f5c54", background: "#0b1a15", zIndex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  panel: { width: 320, flexShrink: 0, background: "#0b1a15", borderLeft: "1px solid #16332a", height: "100vh", display: "flex", flexDirection: "column", padding: "18px 16px" },
  panelMobile: { position: "fixed", top: 0, right: 0, zIndex: 30, width: "86vw", maxWidth: 340, boxShadow: "-6px 0 30px rgba(0,0,0,0.5)" },
  panelClose: { alignSelf: "flex-end", background: "#12291f", border: "1px solid #1c3a30", color: teal, padding: "7px 12px", borderRadius: 8, cursor: "pointer", fontSize: 12, marginBottom: 12 },
  panelHead: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  panelTitle: { fontSize: 14, fontWeight: 700, color: "#e6fffa" },
  panelCount: { fontSize: 12, color: teal, background: "#12291f", padding: "2px 9px", borderRadius: 10, border: "1px solid #1c3a30" },
  panelActions: { display: "flex", gap: 6, marginBottom: 10 },
  pBtn: { flex: 1, fontSize: 12, padding: "8px", background: "#0d1f19", color: "#a9c9c0", border: "1px solid #1c3a30", borderRadius: 7, cursor: "pointer" },
  pBtnPrimary: { flex: 1, fontSize: 12, padding: "8px", background: teal, color: "#08110e", border: "none", borderRadius: 7, cursor: "pointer", fontWeight: 600 },
  savedNote: { fontSize: 11, color: teal, marginBottom: 10 },
  zoteroPanel: { background: "#0d1f19", border: "1px solid #16332a", borderRadius: 8, padding: 12, marginBottom: 12, display: "flex", flexDirection: "column", gap: 7 },
  zInput: { padding: "9px 10px", fontSize: 13, border: "1px solid #1c3a30", background: "#08110e", color: "#e6fffa", borderRadius: 6, outline: "none" },
  zMsg: { fontSize: 11, color: teal },
  panelList: { flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 },
  pSource: { paddingBottom: 12, borderBottom: "1px solid #12291f" },
  pSrcTop: { display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" },
  pSrcTitle: { fontSize: 13, color: "#7fd4f5", textDecoration: "none", lineHeight: 1.4, flex: 1 },
  star: { background: "none", border: "none", cursor: "pointer", fontSize: 18, padding: 0, lineHeight: 1, minWidth: 28 },
  pSrcMeta: { fontSize: 11.5, color: "#8fbdb1", marginTop: 4, lineHeight: 1.4 },
  authorLink: { background: "none", border: "none", color: teal, fontSize: 12, cursor: "pointer", padding: "6px 0 0", textAlign: "left" },
  modalWrap: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 40, backdropFilter: "blur(4px)", padding: 16 },
  modal: { background: "#0d1f19", border: "1px solid #1c3a30", borderRadius: 16, padding: 26, width: 380, maxWidth: "100%" },
  modalTitle: { fontSize: 20, fontWeight: 700, color: "#e6fffa", marginBottom: 20 },
  setLabel: { fontSize: 12, textTransform: "uppercase", letterSpacing: "1px", color: "#4a7268", marginBottom: 10, marginTop: 8 },
  setRow: { display: "flex", gap: 8, marginBottom: 18 },
  setOpt: { flex: 1, padding: "10px", fontSize: 13, background: "#08110e", color: "#a9c9c0", border: "1px solid #1c3a30", borderRadius: 8, cursor: "pointer", textTransform: "capitalize" },
  setOptActive: { background: teal, color: "#08110e", borderColor: teal, fontWeight: 600 },
  setClear: { width: "100%", padding: "11px", fontSize: 13, background: "#08110e", color: "#ff9b8a", border: "1px solid #4a2020", borderRadius: 8, cursor: "pointer", marginBottom: 18 },
  setNote: { fontSize: 12, color: "#5a8078", lineHeight: 1.5, marginBottom: 20 },
  modalClose: { width: "100%", padding: "13px", fontSize: 14, fontWeight: 600, background: teal, color: "#08110e", border: "none", borderRadius: 10, cursor: "pointer" },
};

if (typeof document !== "undefined" && !document.getElementById("cb-anim")) {
  const st = document.createElement("style");
  st.id = "cb-anim";
  st.textContent = `
    @keyframes cbspin { to { transform: rotate(360deg); } }
    @keyframes cbpulse { 0%,100% { transform: scale(1); opacity: 0.6; } 50% { transform: scale(1.15); opacity: 1; } }
    @keyframes cbFade { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes cbRise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
    .cb-fade { opacity: 0; animation: cbFade 0.5s ease forwards; }
    .cb-rise { animation: cbRise 0.45s cubic-bezier(.2,.8,.2,1) forwards; }
    html, body, #root { height: 100%; }
    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    body { margin: 0; background: #08110e; }
    input { font-size: 16px; }
    ::placeholder { color: #4a7268; }
    ::-webkit-scrollbar { width: 7px; }
    ::-webkit-scrollbar-thumb { background: #16332a; border-radius: 4px; }
  `;
  document.head.appendChild(st);
}

createRoot(document.getElementById("root")).render(<App />);
