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
    if
