import React, { useState, useRef, useEffect } from "react";
import { createRoot } from "react-dom/client";

function setCookie(k, v) { try { document.cookie = `${k}=${encodeURIComponent(v)}; path=/; max-age=31536000; SameSite=Lax`; } catch {} }
function getCookie(k) { try { const m = document.cookie.match(new RegExp("(?:^|; )" + k + "=([^;]*)")); return m ? decodeURIComponent(m[1]) : null; } catch { return null; } }

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

// ---------- Palettes: light (paper) + dark, each with the editorial structure ----------
const PALETTES = {
  Paper: { light: true, bg: "#f3efe7", panel: "#fbf8f2", card: "#ece5d8", ink: "#232a25", ink2: "#57605a", faint: "#98a09a", rule: "#e0dccf", rule2: "#cfcabb", link: "#1a5fb4" },
  Slate: { light: false, bg: "#14181c", panel: "#1b2127", card: "#232a31", ink: "#e4e9ec", ink2: "#9aa6ad", faint: "#5f6d75", rule: "#2a323a", rule2: "#3a444d", link: "#7fb0d4" },
  Ink:   { light: false, bg: "#0f1210", panel: "#171b18", card: "#1f2521", ink: "#e6ebe6", ink2: "#9aa69e", faint: "#5c6961", rule: "#232a25", rule2: "#333c35", link: "#8fc7a8" },
};
const ACCENTS = { Forest: "#1f7a5a", Oxblood: "#8a3b2e", Neon: "#12b886", Cobalt: "#2f6fd0", Amber: "#b8791f", Plum: "#7b4a8a", Slate: "#3f5847" };

function accentText(hex) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#111" : "#fff";
}
function withAlpha(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
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

const Audio = (() => {
  let ctx = null, ambient = null;
  function ac() { if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { ctx = null; } } return ctx; }
  function click() {
    const c = ac(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = "sine"; o.frequency.value = 620;
    g.gain.setValueAtTime(0.0001, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.06, c.currentTime + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.09);
    o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + 0.1);
  }
  function startAmbient() {
    const c = ac(); if (!c || ambient) return;
    const o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain();
    o.type = "sine"; o.frequency.value = 110; o2.type = "sine"; o2.frequency.value = 164.81;
    g.gain.setValueAtTime(0.0001, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.03, c.currentTime + 0.4);
    o.connect(g); o2.connect(g); g.connect(c.destination); o.start(); o2.start();
    ambient = { o, o2, g };
  }
  function stopAmbient() {
    if (!ambient || !ctx) return;
    const { o, o2, g } = ambient;
    try { g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3); o.stop(ctx.currentTime + 0.35); o2.stop(ctx.currentTime + 0.35); } catch {}
    ambient = null;
  }
  return { click, startAmbient, stopAmbient };
})();

function Mark({ size = 26, accent, glow }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ filter: glow ? `drop-shadow(0 0 6px ${withAlpha(accent, 0.5)})` : "none" }}>
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1 0-4.12A2.5 2.5 0 0 1 7.5 11a2.5 2.5 0 0 1 0-4.12A2.5 2.5 0 0 1 9.5 2Z" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 0-4.12A2.5 2.5 0 0 0 16.5 11a2.5 2.5 0 0 0 0-4.12A2.5 2.5 0 0 0 14.5 2Z" />
    </svg>
  );
}

function renderAnswer(text, sources, P, accent) {
  const clean = (text || "").replace(/^#{1,6}\s*/gm, "");
  return clean.split(/\n{2,}/).map((para, pi) => (
    <p key={pi} style={{ fontSize: 16.5, lineHeight: 1.72, margin: "0 0 15px", color: P.ink }}>
      {para.split("\n").map((line, li) => (
        <React.Fragment key={li}>
          {line.split(/(\*\*[^*]+\*\*|\[\d+\])/g).map((seg, si) => {
            const b = seg.match(/^\*\*([^*]+)\*\*$/);
            if (b) return <strong key={si} style={{ color: P.ink, fontWeight: 600 }}>{b[1]}</strong>;
            const c = seg.match(/^\[(\d+)\]$/);
            if (c) { const n = parseInt(c[1], 10); const src = sources[n - 1]; return <a key={si} href={src?.url || "#"} target="_blank" rel="noreferrer" title={src?.title || ""} style={{ fontSize: 11, verticalAlign: "super", color: accent, textDecoration: "none", fontWeight: 700 }}>{n}</a>; }
            return <span key={si}>{seg}</span>;
          })}
          {li < para.split("\n").length - 1 && <br />}
        </React.Fragment>
      ))}
    </p>
  ));
}

function FactCheck({ fc, P, accent }) {
  const colors = { supported: "#3faa6a", partly: "#c9a227", unsupported: "#c0533f", thin: "#c9a227" };
  const label = { supported: "Supported by sources", partly: "Partly supported", unsupported: "Not supported by sources" };
  const oc = colors[fc.overall] || P.ink2;
  return (
    <div style={{ marginTop: 14, border: `1px solid ${P.rule}`, borderLeft: `3px solid ${oc}`, borderRadius: 4, background: P.panel, padding: "13px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: fc.claims && fc.claims.length ? 10 : 0 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: oc }} />
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: oc }}>{label[fc.overall] || fc.overall}</span>
        <span style={{ fontSize: 11.5, color: P.faint, marginLeft: "auto" }}>checked against cited abstracts</span>
      </div>
      {fc.summary && <div style={{ fontSize: 13.5, color: P.ink2, marginBottom: fc.claims && fc.claims.length ? 10 : 0, lineHeight: 1.5 }}>{fc.summary}</div>}
      {fc.claims && fc.claims.map((c, i) => {
        const cc = colors[c.status] || P.ink2;
        return (
          <div key={i} style={{ display: "flex", gap: 9, padding: "7px 0", borderTop: i ? `1px solid ${P.rule}` : "none" }}>
            <span style={{ color: cc, fontSize: 13, flexShrink: 0, fontWeight: 700 }}>{c.status === "supported" ? "✓" : c.status === "thin" ? "~" : "✕"}</span>
            <div>
              <div style={{ fontSize: 13.5, color: P.ink, lineHeight: 1.4 }}>{c.claim}</div>
              {c.note && <div style={{ fontSize: 12, color: P.faint, marginTop: 2, lineHeight: 1.4 }}>{c.note}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function useIsMobile() {
  const [m, setM] = useState(typeof window !== "undefined" ? window.innerWidth < 860 : false);
  useEffect(() => { const onR = () => setM(window.innerWidth < 860); window.addEventListener("resize", onR); return () => window.removeEventListener("resize", onR); }, []);
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
  const [panelOpen, setPanelOpen] = useState(true);
  const [mobilePanel, setMobilePanel] = useState(false);
  const [suggestions, setSuggestions] = useState(pick());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [zoteroOpen, setZoteroOpen] = useState(false);
  const [zKey, setZKey] = useState(""); const [zUser, setZUser] = useState(""); const [zMsg, setZMsg] = useState("");
  const [answerLength, setAnswerLength] = useState(() => getCookie("cb_len") || "medium");
  const [factCheck, setFactCheck] = useState(() => getCookie("cb_fc") === "1");
  const [muted, setMuted] = useState(() => getCookie("cb_muted") === "1");
  const [paletteName, setPaletteName] = useState(() => getCookie("cb_pal") || "Paper");
  const [accentName, setAccentName] = useState(() => getCookie("cb_accent") || "Forest");
  const [customAccent, setCustomAccent] = useState(() => getCookie("cb_ca") || "");
  const [hover, setHover] = useState("");
  const inputRef = useRef(null);
  const threadRef = useRef(null);
  const mutedRef = useRef(false);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  const P = PALETTES[paletteName] || PALETTES.Paper;
  const accent = customAccent && /^#[0-9a-fA-F]{6}$/.test(customAccent) ? customAccent : (ACCENTS[accentName] || ACCENTS.Forest);
  const at = accentText(accent);
  const S = makeStyles(P, accent, at);

  const sfx = () => { if (!mutedRef.current) Audio.click(); };

  useEffect(() => { if (entered && !isMobile) inputRef.current?.focus(); }, [entered, isMobile]);
  useEffect(() => { if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight; }, [turns, busy]);
  useEffect(() => { if (busy && !muted) Audio.startAmbient(); else Audio.stopAmbient(); return () => Audio.stopAmbient(); }, [busy, muted]);
  useEffect(() => { document.body.style.background = P.bg; }, [P]);
  useEffect(() => { setCookie("cb_len", answerLength); }, [answerLength]);
  useEffect(() => { setCookie("cb_fc", factCheck ? "1" : "0"); }, [factCheck]);
  useEffect(() => { setCookie("cb_muted", muted ? "1" : "0"); }, [muted]);
  useEffect(() => { setCookie("cb_pal", paletteName); }, [paletteName]);
  useEffect(() => { setCookie("cb_accent", accentName); }, [accentName]);
  useEffect(() => { setCookie("cb_ca", customAccent); }, [customAccent]);

  async function ask(q) {
    const question = (q ?? input).trim();
    if (!question || busy) return;
    sfx(); setInput(""); setBusy(true); setError("");
    const priorThread = [];
    turns.forEach((t) => { priorThread.push({ role: "user", content: t.q }); priorThread.push({ role: "assistant", content: t.answer }); });
    try {
      const res = await fetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: question, history: priorThread, settings: { answerLength, factCheck } }) });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Search failed."); setBusy(false); return; }
      const nt = { q: question, answer: data.answer || "", sources: data.sources || [], source: data.source || "", factCheck: data.factCheck || null };
      setTurns((t) => [...t, nt]);
      setAllSources((prev) => { const seen = new Set(prev.map((s) => (s.title || "").toLowerCase())); return [...prev, ...(data.sources || []).filter((s) => !seen.has((s.title || "").toLowerCase()))]; });
      if (turns.length === 0) setSessions((s) => [{ q: question, ts: Date.now() }, ...s].slice(0, 30));
    } catch (e) { setError(`Could not reach the backend. (${e.message})`); }
    finally { setBusy(false); }
  }

  function newSession() { sfx(); setTurns([]); setAllSources([]); setInput(""); setError(""); setSuggestions(pick()); setTimeout(() => inputRef.current?.focus(), 50); }
  function toggleSave(s) { sfx(); setSaved((prev) => { const k = (s.title || "").toLowerCase(); return prev.some((x) => (x.title || "").toLowerCase() === k) ? prev.filter((x) => (x.title || "").toLowerCase() !== k) : [...prev, s]; }); }
  const isSaved = (s) => saved.some((x) => (x.title || "").toLowerCase() === (s.title || "").toLowerCase());
  async function doZotero() { setZMsg(""); const list = saved.length ? saved : allSources; if (!zKey || !zUser) { setZMsg("Enter your Zotero API key and user ID."); return; } try { await saveToZotero(list, zKey.trim(), zUser.trim()); setZMsg(`Saved ${list.length} items.`); } catch (e) { setZMsg(`Failed: ${e.message}`); } }

  if (!entered) {
    return (
      <div style={S.gate}>
        <div style={S.gateInner}>
          <div style={{ marginBottom: 18 }}><Mark size={54} accent={accent} glow={!P.light} /></div>
          <div style={S.gateTitle}>Cerebrum</div>
          <div style={S.gateSub}>the scientific literature, read closely and cited plainly</div>
          <button style={S.gateBtn} onClick={() => { sfx(); setEntered(true); }}>Enter as guest</button>
          <div style={S.gateNote}>No account. Nothing stored on a server.</div>
        </div>
      </div>
    );
  }

  const started = turns.length > 0 || busy;
  const exportList = saved.length ? saved : allSources;

  const SourcesInner = (
    <>
      <div style={S.srcHead}>Sources cited · {allSources.length}</div>
      {allSources.length > 0 && (
        <div style={S.srcActions}>
          <button style={S.sBtn} onClick={() => { sfx(); download("cerebrum.ris", toRIS(exportList)); }}>RIS</button>
          <button style={S.sBtn} onClick={() => { sfx(); download("cerebrum.bib", toBibTeX(exportList)); }}>BibTeX</button>
          <button style={S.sBtnP} onClick={() => { sfx(); setZoteroOpen(!zoteroOpen); }}>Zotero</button>
        </div>
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
          allSources.map((s, i) => (
            <div key={i} style={S.srcItem}>
              <a href={s.url} target="_blank" rel="noreferrer" style={S.srcTitle}>{s.title || s.url}</a>
              <div style={S.srcMeta}>{[s.authors, s.journal, s.year].filter(Boolean).join(" · ")}{typeof s.citations === "number" && ` · cited ${s.citations}×`}</div>
              <div style={S.srcRow}>
                <button style={{ ...S.star, color: isSaved(s) ? accent : P.faint }} onClick={() => toggleSave(s)}>{isSaved(s) ? "★ saved" : "☆ save"}</button>
                {s.authors && <button style={S.authorLink} onClick={() => { setMobilePanel(false); ask(`papers by ${(s.authors || "").replace(" et al.", "")}`); }}>author →</button>}
              </div>
            </div>
          ))}
      </div>
    </>
  );

  return (
    <div style={S.page}>
      <div style={S.wrap}>
        <div style={S.masthead}>
          <div style={S.mastTop}>
            <button style={S.mastBtn} onClick={() => { sfx(); newSession(); }}>New</button>
            <span style={S.mastMeta}>A Research Instrument · 2026</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={S.mastBtn} onClick={() => setMuted(!muted)}>{muted ? "🔇" : "🔊"}</button>
              <button style={S.mastBtn} onClick={() => { sfx(); setSettingsOpen(true); }}>Settings</button>
            </div>
          </div>
          <div style={S.brandRow}><Mark size={26} accent={accent} glow={!P.light} /><span style={S.brand}>Cerebrum</span></div>
          <div style={S.tagline}>the scientific literature, read closely and cited plainly</div>
          <div style={S.ruleThin} />
        </div>

        <div style={S.searchBand}>
          <div style={{ ...S.search, boxShadow: hover === "in" ? `0 0 0 1px ${accent}${P.light ? "" : ", 0 0 20px " + withAlpha(accent, 0.25)}` : "none" }} onMouseEnter={() => setHover("in")} onMouseLeave={() => setHover("")}>
            <input ref={inputRef} style={S.searchInput} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} placeholder="Ask a question, or search a researcher by name" />
            <button style={S.searchBtn} onClick={() => ask()}>Inquire</button>
          </div>
          {!started && (
            <div style={S.chips}>
              {suggestions.map((s, i) => (
                <button key={s} className="cb-fade" style={{ ...S.chip, ...(hover === "c" + i ? S.chipHover : {}), animationDelay: `${i * 70}ms` }} onMouseEnter={() => setHover("c" + i)} onMouseLeave={() => setHover("")} onClick={() => ask(s)}>{s}</button>
              ))}
            </div>
          )}
        </div>

        {started && (
          <div style={S.article}>
            <div style={S.column} ref={threadRef}>
              {turns.map((t, ti) => (
                <div key={ti} style={S.turn} className="cb-rise">
                  <div style={S.qLabel}><span style={S.qDot} />On the question of</div>
                  <div style={S.headline}>{t.q}</div>
                  <div style={S.body}>{renderAnswer(t.answer, t.sources, P, accent)}</div>
                  {t.factCheck && <FactCheck fc={t.factCheck} P={P} accent={accent} />}
                  {t.source && <div style={S.byline}>{t.source}</div>}
                </div>
              ))}
              {busy && <div style={S.loading}><span style={S.spinner} />searching 14 databases…</div>}
              {error && <div style={S.error}>{error}</div>}
              {turns.length > 0 && !busy && (
                <div style={S.followRow}>
                  <input style={S.followIn} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} placeholder="Ask a follow-up… (remembers the thread)" />
                  <button style={S.searchBtn} onClick={() => ask()}>Ask</button>
                </div>
              )}
            </div>

            {!isMobile && panelOpen && <aside style={S.sources}>{SourcesInner}</aside>}
          </div>
        )}

        <div style={S.foot}>Europe PMC · PubMed · OpenAlex · Crossref · arXiv · Semantic Scholar · DOAJ · Zenodo · DataCite · OpenAIRE · HAL · UTK TRACE</div>
      </div>

      {started && isMobile && (
        <button style={S.mobSrcBtn} onClick={() => setMobilePanel(true)}>Sources · {allSources.length}</button>
      )}
      {started && isMobile && mobilePanel && (
        <>
          <div style={S.scrim} onClick={() => setMobilePanel(false)} />
          <aside style={{ ...S.sources, ...S.sourcesMobile }}><button style={S.mastBtn} onClick={() => setMobilePanel(false)}>✕ Close</button>{SourcesInner}</aside>
        </>
      )}

      {settingsOpen && (
        <div style={S.modalWrap} onClick={() => setSettingsOpen(false)}>
          <div style={S.modal} onClick={(e) => e.stopPropagation()}>
            <div style={S.modalTitle}>Settings</div>

            <div style={S.setLabel}>Palette</div>
            <div style={S.palRow}>
              {Object.keys(PALETTES).map((pn) => (
                <button key={pn} style={{ ...S.palSwatch, background: PALETTES[pn].panel, color: PALETTES[pn].ink, border: paletteName === pn ? `2px solid ${accent}` : `1px solid ${PALETTES[pn].rule2}` }} onClick={() => { sfx(); setPaletteName(pn); }}>
                  <span style={{ width: 12, height: 12, borderRadius: "50%", background: PALETTES[pn].bg, border: `1px solid ${PALETTES[pn].rule2}` }} />{pn}
                </button>
              ))}
            </div>

            <div style={S.setLabel}>Accent</div>
            <div style={S.accentRow}>
              {Object.keys(ACCENTS).map((an) => (
                <button key={an} title={an} style={{ ...S.accentDot, background: ACCENTS[an], outline: (!customAccent && accentName === an) ? `2px solid ${P.ink}` : "none", outlineOffset: 2 }} onClick={() => { sfx(); setCustomAccent(""); setAccentName(an); }} />
              ))}
            </div>

            <div style={S.setLabel}>Custom accent</div>
            <div style={S.pickRow}>
              <input type="color" value={accent} onChange={(e) => setCustomAccent(e.target.value)} style={S.colorInput} />
              <input type="text" value={customAccent || accent} onChange={(e) => /^#[0-9a-fA-F]{0,6}$/.test(e.target.value) && setCustomAccent(e.target.value)} style={S.hexInput} />
              {customAccent && <button style={S.clearBtn} onClick={() => setCustomAccent("")}>reset</button>}
            </div>

            <div style={S.setLabel}>Answer length</div>
            <div style={S.setRow}>{["short", "medium", "long"].map((v) => (<button key={v} style={{ ...S.setOpt, ...(answerLength === v ? S.setOptActive : {}) }} onClick={() => { sfx(); setAnswerLength(v); }}>{v}</button>))}</div>

            <div style={S.setLabel}>Fact-check</div>
            <button style={{ ...S.setOpt, width: "100%", marginBottom: 8, ...(factCheck ? S.setOptActive : {}) }} onClick={() => { sfx(); setFactCheck(!factCheck); }}>{factCheck ? "Verification on" : "Verification off"}</button>
            <div style={{ ...S.setNote, marginBottom: 16 }}>When on, a second model checks each claim against the cited abstracts and flags anything the sources don't support. It verifies source-support, not real-world truth, and adds a few seconds.</div>

            <div style={S.setLabel}>Sound</div>
            <button style={{ ...S.setOpt, width: "100%", marginBottom: 16, ...(muted ? {} : S.setOptActive) }} onClick={() => setMuted(!muted)}>{muted ? "Sound off" : "Sound on"}</button>

            <button style={S.clearAll} onClick={() => { setSessions([]); setSaved([]); }}>Clear sessions & saved</button>
            <button style={S.modalClose} onClick={() => setSettingsOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

function makeStyles(P, accent, at) {
  const serifless = "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif";
  return {
    gate: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: P.light ? "linear-gradient(160deg,#f0ebe1,#e6dfd1)" : `linear-gradient(160deg,${P.panel},${P.bg})`, padding: 20, fontFamily: serifless },
    gateInner: { textAlign: "center", maxWidth: 420 },
    gateTitle: { fontSize: 42, fontWeight: 800, letterSpacing: "-0.02em", color: P.ink, marginBottom: 8 },
    gateSub: { fontSize: 15, color: P.ink2, marginBottom: 30, lineHeight: 1.5 },
    gateBtn: { padding: "13px 30px", fontSize: 15, fontWeight: 600, background: accent, color: at, border: "none", borderRadius: 8, cursor: "pointer" },
    gateNote: { fontSize: 12, color: P.faint, marginTop: 14 },

    page: { minHeight: "100vh", background: P.bg, color: P.ink, fontFamily: serifless, WebkitFontSmoothing: "antialiased" },
    wrap: { maxWidth: 960, margin: "0 auto", padding: "0 28px" },
    masthead: { borderBottom: `2px solid ${P.ink}`, paddingTop: 22, paddingBottom: 12 },
    mastTop: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: P.faint },
    mastMeta: { fontSize: 11, letterSpacing: "0.14em" },
    mastBtn: { background: "transparent", border: `1px solid ${P.rule2}`, color: P.ink2, padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600, fontFamily: "inherit" },
    brandRow: { display: "flex", alignItems: "center", justifyContent: "center", gap: 11, margin: "14px 0 6px" },
    brand: { fontWeight: 800, fontSize: 38, letterSpacing: "-0.02em", color: P.ink },
    tagline: { textAlign: "center", fontSize: 14, color: P.ink2 },
    ruleThin: { borderBottom: `1px solid ${P.ink}`, marginTop: 12 },

    searchBand: { padding: "30px 0 6px", textAlign: "center" },
    search: { display: "flex", alignItems: "center", gap: 10, maxWidth: 600, margin: "0 auto", background: P.panel, border: `1px solid ${P.rule2}`, borderRadius: 10, padding: "5px 6px 5px 18px", transition: "box-shadow 0.2s" },
    searchInput: { flex: 1, border: "none", outline: "none", background: "transparent", fontFamily: "inherit", fontSize: 16, color: P.ink, minWidth: 0 },
    searchBtn: { fontSize: 13, fontWeight: 600, background: accent, color: at, border: "none", padding: "11px 18px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 },
    chips: { display: "flex", flexWrap: "wrap", gap: 9, justifyContent: "center", marginTop: 18 },
    chip: { fontSize: 13, color: P.ink2, background: P.panel, border: `1px solid ${P.rule2}`, borderRadius: 20, padding: "8px 14px", cursor: "pointer", transition: "all 0.18s", fontFamily: "inherit" },
    chipHover: { borderColor: accent, color: accent },

    article: { marginTop: 34, display: "grid", gridTemplateColumns: "1fr 250px", gap: 34, alignItems: "start" },
    column: { minWidth: 0 },
    turn: { marginBottom: 34 },
    qLabel: { fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: accent, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 },
    qDot: { width: 7, height: 7, borderRadius: "50%", background: accent, boxShadow: P.light ? "none" : `0 0 8px ${accent}` },
    headline: { fontWeight: 700, fontSize: 26, lineHeight: 1.24, marginBottom: 16, color: P.ink, letterSpacing: "-0.01em" },
    body: {},
    byline: { fontSize: 12, color: P.faint, letterSpacing: "0.02em", borderTop: `1px solid ${P.rule}`, paddingTop: 12, marginTop: 20 },
    loading: { display: "flex", alignItems: "center", gap: 12, color: P.ink2, fontSize: 14, padding: "10px 0" },
    spinner: { width: 16, height: 16, border: `2px solid ${P.rule2}`, borderTopColor: accent, borderRadius: "50%", display: "inline-block", animation: "cbspin 0.7s linear infinite" },
    error: { padding: 14, background: withAlpha("#c0533f", 0.12), color: "#c0533f", borderRadius: 8, fontSize: 14, border: `1px solid ${withAlpha("#c0533f", 0.3)}` },
    followRow: { display: "flex", gap: 8, marginTop: 10, marginBottom: 20 },
    followIn: { flex: 1, padding: "11px 15px", fontSize: 15, background: P.panel, color: P.ink, border: `1px solid ${P.rule2}`, borderRadius: 8, outline: "none", fontFamily: "inherit" },

    sources: { borderLeft: `1px solid ${P.rule2}`, paddingLeft: 22, position: "sticky", top: 20 },
    sourcesMobile: { position: "fixed", top: 0, right: 0, height: "100vh", width: "86vw", maxWidth: 340, background: P.bg, borderLeft: `1px solid ${P.rule2}`, padding: "18px 18px", overflowY: "auto", zIndex: 30, boxShadow: "-6px 0 30px rgba(0,0,0,0.3)" },
    srcHead: { fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: P.faint, borderBottom: `1px solid ${P.ink}`, paddingBottom: 7, marginBottom: 14, fontWeight: 700 },
    srcActions: { display: "flex", gap: 6, marginBottom: 10 },
    sBtn: { flex: 1, fontSize: 12, padding: "7px", background: P.panel, color: P.ink2, border: `1px solid ${P.rule2}`, borderRadius: 6, cursor: "pointer", fontFamily: "inherit" },
    sBtnP: { flex: 1, fontSize: 12, padding: "7px", background: accent, color: at, border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontFamily: "inherit" },
    savedNote: { fontSize: 11, color: accent, marginBottom: 10 },
    zBox: { background: P.panel, border: `1px solid ${P.rule}`, borderRadius: 8, padding: 12, marginBottom: 12, display: "flex", flexDirection: "column", gap: 7 },
    zIn: { padding: "8px 10px", fontSize: 12, border: `1px solid ${P.rule2}`, background: P.bg, color: P.ink, borderRadius: 6, outline: "none", fontFamily: "inherit" },
    zMsg: { fontSize: 11, color: accent },
    srcList: { display: "flex", flexDirection: "column", gap: 15 },
    empty: { fontSize: 12.5, color: P.faint, fontStyle: "italic", lineHeight: 1.5 },
    srcItem: { paddingBottom: 14, borderBottom: `1px solid ${P.rule}` },
    srcTitle: { fontSize: 14, color: P.link, textDecoration: "none", lineHeight: 1.35, fontWeight: 500, display: "block", marginBottom: 4 },
    srcMeta: { fontSize: 12, color: P.ink2 },
    srcRow: { display: "flex", gap: 12, marginTop: 6 },
    star: { background: "none", border: "none", cursor: "pointer", fontSize: 12, padding: 0, fontFamily: "inherit" },
    authorLink: { background: "none", border: "none", color: accent, fontSize: 12, cursor: "pointer", padding: 0, fontFamily: "inherit", fontWeight: 500 },

    foot: { marginTop: 46, borderTop: `2px solid ${P.ink}`, padding: "12px 0 30px", textAlign: "center", fontSize: 10.5, letterSpacing: "0.06em", color: P.faint, textTransform: "uppercase" },

    mobSrcBtn: { position: "fixed", bottom: 18, right: 18, background: accent, color: at, border: "none", borderRadius: 24, padding: "12px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer", boxShadow: "0 6px 20px rgba(0,0,0,0.25)", zIndex: 20, fontFamily: "inherit" },
    scrim: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 25 },

    modalWrap: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 40, padding: 16, backdropFilter: "blur(3px)" },
    modal: { background: P.panel, border: `1px solid ${P.rule2}`, borderRadius: 14, padding: 26, width: 420, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", fontFamily: serifless },
    modalTitle: { fontSize: 20, fontWeight: 700, color: P.ink, marginBottom: 20 },
    setLabel: { fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: P.faint, marginBottom: 9, marginTop: 6, fontWeight: 600 },
    palRow: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 },
    palSwatch: { display: "flex", alignItems: "center", gap: 7, padding: "8px 12px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontFamily: "inherit" },
    accentRow: { display: "flex", flexWrap: "wrap", gap: 11, marginBottom: 18 },
    accentDot: { width: 26, height: 26, borderRadius: "50%", border: "none", cursor: "pointer" },
    pickRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 18 },
    colorInput: { width: 42, height: 36, padding: 0, border: `1px solid ${P.rule2}`, borderRadius: 8, background: "none", cursor: "pointer" },
    hexInput: { width: 96, padding: "8px 10px", fontSize: 13, border: `1px solid ${P.rule2}`, background: P.bg, color: P.ink, borderRadius: 6, outline: "none", fontFamily: "monospace" },
    clearBtn: { fontSize: 12, background: "transparent", border: `1px solid ${P.rule2}`, color: P.ink2, borderRadius: 6, padding: "7px 10px", cursor: "pointer", fontFamily: "inherit" },
    setRow: { display: "flex", gap: 8, marginBottom: 16 },
    setOpt: { flex: 1, padding: "10px", fontSize: 13, background: P.bg, color: P.ink2, border: `1px solid ${P.rule2}`, borderRadius: 8, cursor: "pointer", textTransform: "capitalize", fontFamily: "inherit" },
    setOptActive: { background: accent, color: at, borderColor: accent, fontWeight: 600 },
    setNote: { fontSize: 12, color: P.faint, lineHeight: 1.5 },
    clearAll: { width: "100%", padding: "10px", fontSize: 13, background: P.bg, color: "#c0533f", border: `1px solid ${withAlpha("#c0533f", 0.4)}`, borderRadius: 8, cursor: "pointer", marginBottom: 16, fontFamily: "inherit" },
    modalClose: { width: "100%", padding: "13px", fontSize: 14, fontWeight: 600, background: accent, color: at, border: "none", borderRadius: 10, cursor: "pointer", fontFamily: "inherit" },
  };
}

if (typeof document !== "undefined") {
  if (!document.getElementById("cb-fonts")) {
    const l = document.createElement("link");
    l.id = "cb-fonts"; l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap";
    document.head.appendChild(l);
  }
  if (!document.getElementById("cb-anim")) {
    const st = document.createElement("style");
    st.id = "cb-anim";
    st.textContent = `
      @keyframes cbspin { to { transform: rotate(360deg); } }
      @keyframes cbFade { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes cbRise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
      .cb-fade { opacity: 0; animation: cbFade 0.5s ease forwards; }
      .cb-rise { animation: cbRise 0.45s cubic-bezier(.2,.8,.2,1) forwards; }
      * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
      html, body { margin: 0; }
      input { font-size: 16px; }
      @media (max-width: 860px) { .cb-article { grid-template-columns: 1fr !important; } }
      ::-webkit-scrollbar { width: 8px; }
      ::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.3); border-radius: 4px; }
    `;
    document.head.appendChild(st);
  }
}

createRoot(document.getElementById("root")).render(<App />);
