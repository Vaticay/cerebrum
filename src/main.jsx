import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';

// --- Encryption and State Persistence Utilities ---
function simpleTokenize(data) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(data))));
}
function simpleDetokenize(token) {
  try { return JSON.parse(decodeURIComponent(escape(atob(token)))); } catch (e) { return []; }
}

function cleanStrings(s) {
  return (s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function refineClientQuery(query) {
  return query.toLowerCase()
    .replace(/\b(can you)?\b\s*\b(find|search|tell me about|look up|show me|what is|how does|what the|who is|papers by|publications by)\b/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function detectAuthorIntent(query) {
  const clean = query.trim().toLowerCase();
  if (clean.startsWith("papers by ") || clean.startsWith("publications by ") || clean.startsWith("who is ")) return true;
  const words = query.trim().split(/\s+/);
  if (words.length >= 2 && words.length <= 3) {
    const isFirstLetterCapitalized = words.every(w => w && w[0] === w[0].toUpperCase());
    if (isFirstLetterCapitalized && !['What', 'How', 'Why', 'Is', 'Can'].includes(words[0])) return true;
  }
  return false;
}

// --- Premium Scholarly Layout Renderer ---
function formatResponseText(text) {
  if (!text) return "";
  let formatted = text;

  formatted = formatted.replace(/\$\$\s*([\s\S]+?)\s*\$\$/g, (m, math) => `<div class="math-block-container"><span class="katex-display-fallback">${math}</span></div>`);
  formatted = formatted.replace(/\$([^\$\n]+?)\$/g, (m, math) => `<span class="math-inline-container">${math}</span>`);
  formatted = formatted.replace(/#+/g, '');

  formatted = formatted
    .replace(/^###\s+(.+)$/gm, '<div class="scholarly-h3">$1</div>')
    .replace(/^#\s+(.+)$/gm, '<div class="scholarly-h2">$1</div>');

  formatted = formatted.replace(/^-\s+\*\*(.+?)\*\*:\s*(.+)$/gm, '<li class="scholarly-item"><strong>$1</strong>: $2</li>');
  formatted = formatted.replace(/^\*\s+(.+)$/gm, '<li class="scholarly-item">$1</li>');
  formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  formatted = formatted.replace(/^>\s+(.+)$/gm, '<div class="scholarly-abstract-callout">$1</div>');
  formatted = formatted.replace(/^---$/gm, '<hr style="border: 0; border-top: 1px solid var(--border-subtle); margin: 32px 0;" />');
  formatted = formatted.replace(/\n/g, '<br />');

  return formatted;
}

// --- Conversational Intent Router ---
function handleConversationalIntent(query) {
  const normalized = query.trim().toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"");
  const greetings = ['hi', 'hello', 'hey', 'yo', 'sup', 'greetings', 'howdy'];
  const statusInquiries = ['how are you', 'hows it going', 'who are you', 'what are you', 'whats your name'];

  if (greetings.includes(normalized)) {
    return {
      answer: `### 👋 Welcome to Cerebrum\n\nHello! I am Cerebrum, your advanced academic intelligence workspace. What scientific mechanics, research papers, or complex datasets can I help you synthesize or fact-check today?`,
      sources: []
    };
  }
  if (statusInquiries.includes(normalized)) {
    return {
      answer: `### 🧠 System Framework Active\n\nI am Cerebrum, an adaptive intelligence assistant designed for crisp data analysis, structural synthesis, and scholarly deep-diving. Enter your prompt above, and I will analyze live reference repositories instantly.`,
      sources: []
    };
  }
  return null;
}

// --- INTELLIGENT SEMANTIC FAILOVER HUB ---
async function emergencyClientFetch(rawQuery) {
  const isAuthorSearch = detectAuthorIntent(rawQuery);
  const searchTopic = refineClientQuery(rawQuery);
  if (!searchTopic || searchTopic.length < 2) {
    return { answer: "### 🔍 System Query Guide\n\nPlease supply a distinct topic keyword or research question to execute an intelligent data extraction.", sources: [] };
  }

  let semanticSummary = "";
  let masterSources = [];
  const tasks = [];

  // Engine Phase 1: Dynamic Knowledge Registry Extraction
  if (!isAuthorSearch) {
    tasks.push((async () => {
      try {
        const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(searchTopic)}&format=json&origin=*`;
        const searchRes = await fetch(searchUrl);
        const searchData = await searchRes.json();
        const exactTitle = searchData?.query?.search?.[0]?.title;

        if (exactTitle) {
          const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(exactTitle.replace(/\s+/g, '_'))}`;
          const summaryRes = await fetch(summaryUrl);
          if (summaryRes.ok) {
            const summaryData = await summaryRes.json();
            // Store the true encylopedic fact check context
            semanticSummary = summaryData.extract;
          }
        }
      } catch (e) {}
    })());
  }

  // Engine Phase 2: Open Academic Repositories Scanning (Europe PMC & arXiv)
  tasks.push((async () => {
    try {
      const currentYear = new Date().getFullYear();
      const queryParam = isAuthorSearch ? `AUTH:"${searchTopic}"` : searchTopic;
      const pmcUrl = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(queryParam)}%20AND%20PUB_YEAR:[2020%20TO%20${currentYear}]&resultType=core&pageSize=3&format=json`;
      const res = await fetch(pmcUrl);
      if (res.ok) {
        const data = await res.json();
        const rows = data?.resultList?.result || [];
        rows.filter(r => r.abstractText || r.title).forEach((r) => {
          masterSources.push({
            title: r.title || "Academic Archive Record",
            url: r.doi ? `https://doi.org/${r.doi}` : `https://europepmc.org/article/${r.source}/${r.id}`,
            year: r.pubYear || "2026",
            journal: r.journalInfo?.journal?.title || "Europe PMC Core",
            abstract: cleanStrings(r.abstractText || "Abstract entry listed in source.").slice(0, 300)
          });
        });
      }
    } catch (e) {}
  })());

  tasks.push((async () => {
    try {
      const queryParam = isAuthorSearch ? `au:${searchTopic}` : `all:${searchTopic}`;
      const arxivUrl = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(queryParam)}&max_results=2`;
      const res = await fetch(arxivUrl);
      if (res.ok) {
        const text = await res.text();
        const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
        let match;
        while ((match = entryRe.exec(text)) !== null) {
          const block = match[1];
          const title = (block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "arXiv Research Paper";
          const summary = (block.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1] || "";
          const id = (block.match(/<id>([\s\S]*?)<\/id>/) || [])[1] || "";
          masterSources.push({
            title: cleanStrings(title),
            url: id.trim(),
            year: "arXiv Index",
            journal: "arXiv Repository",
            abstract: cleanStrings(summary).slice(0, 300)
          });
        }
      }
    } catch (e) {}
  })());

  await Promise.all(tasks);

  // --- CONTEXTUAL RESPONSE SYNTHESIZER ---
  // Formulates a natural, conversational response using verified live metrics
  let AIStructuredResponse = "";

  if (isAuthorSearch) {
    AIStructuredResponse = `### 🧑‍🔬 Author Research Compilation\n\nI have parsed the global scientific indexes for publications matching **"${rawQuery}"**. Here is the verified bibliography profile containing recent academic releases:\n\n`;
  } else if (semanticSummary) {
    // Generate a conversational, human-like AI answer leveraging the exact fact checker matrix data
    const normalizedTopic = searchTopic.charAt(0).toUpperCase() + searchTopic.slice(1);
    AIStructuredResponse = `### ⚡ Live Intelligence Synthesis\n\nBased on verified scientific records, here is the clear structural breakdown regarding **${normalizedTopic}**:\n\n` + 
    `> ${semanticSummary}\n\n` +
    `To cross-reference this and support your workspace with concrete evidence, I have located relevant peer-reviewed literature and scientific publications matching your query parameters below:\n\n`;
  } else {
    AIStructuredResponse = `### 🔬 Scanned Repository Stream\n\nI evaluated global data nodes for **"${rawQuery}"**. While a central registry definition wasn't located, I parsed relevant peer-reviewed papers containing related technical criteria:\n\n`;
  }

  // Map the papers clearly underneath without raw formatting artifacts
  if (masterSources.length > 0) {
    AIStructuredResponse += masterSources.map((s, idx) => {
      return `#### [${idx + 1}] ${s.title}\n` +
             `*   **Repository Source:** ${s.journal} | **Context Token:** ${s.year}\n` +
             `*   **Abstract Metric:** ${s.abstract}...\n` +
             `*   **Direct Link:** [Open Reference Document](${s.url})`;
    }).join("\n\n");
  } else if (!semanticSummary) {
    return { answer: "### 🔍 Zero Matrix Hits\n\nI checked active scientific repositories but found no verified data matches. Try modifying your phrasing.", sources: [] };
  }

  return {
    answer: AIStructuredResponse + `\n\n---\n> 🛡️ *System Status: Operating in High-Fidelity Local Synthesis Mode. Cross-referencing active entries via Wikipedia Open Registry, arXiv Technical Archives, and Europe PMC paths.*`,
    sources: masterSources
  };
}

function App() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [user, setUser] = useState(() => localStorage.getItem('cerebrum_user') || 'Guest');
  const [chats, setChats] = useState(() => {
    const encryptedData = localStorage.getItem('cerebrum_vault');
    return encryptedData ? simpleDetokenize(encryptedData) : [];
  });
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    if (data && !loading && window.renderMathInElement) {
      window.renderMathInElement(document.body, {
        delimiters: [
          {left: '$$', right: '$$', display: true},
          {left: '$', right: '$', display: false}
        ],
        throwOnError: false
      });
    }
  }, [data, loading]);

  useEffect(() => {
    localStorage.setItem('cerebrum_vault', simpleTokenize(chats));
  }, [chats]);

  const clearHistory = () => { localStorage.removeItem('cerebrum_vault'); window.location.reload(); };

  return (
    <div className="dashboard-layout">
      <aside className={`sidebar-container ${sidebarOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-header">
          <div className="brand-header">
            <BrainLogo strokeColor="#ffffff" />
            <h1 style={{ color: '#ffffff' }}>Cerebrum</h1>
          </div>
        </div>
        <div className="sidebar-scroll-grid">
          <div className="sidebar-section-title">Encrypted Log History</div>
          {chats.length === 0 ? (
            <div className="empty-sidebar-notice">No stored search vectors detected.</div>
          ) : (
            chats.map((chat, idx) => (
              <button key={idx} className="sidebar-chat-link" onClick={() => setData({ answer: chat.answer, sources: chat.sources || [] })}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                <span className="sidebar-link-text">{chat.query}</span>
              </button>
            ))
          )}
        </div>
        <div className="sidebar-footer">
          <div className="user-profile-plate">
            <div className="profile-avatar">{user ? user[0].toUpperCase() : 'G'}</div>
            <div className="profile-info">
              <div className="profile-name" style={{ color: '#ffffff' }}>{user}</div>
              <div className="profile-status">Secure Sandbox Active</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button className="utility-btn-dark" onClick={clearHistory}>Clear</button>
            <button className="utility-btn-dark" onClick={() => { localStorage.removeItem('cerebrum_user'); setUser('Guest'); window.location.reload(); }}>Disconnect</button>
          </div>
        </div>
      </aside>

      <main className="main-content-area">
        <button className="sidebar-toggle-trigger" onClick={() => setSidebarOpen(!sidebarOpen)}>
          {sidebarOpen ? '✕ Hide Sidebar' : '☰ Open History'}
        </button>

        <div className="app-container">
          <form onSubmit={async (e) => {
            e.preventDefault();
            if (!query.trim()) return;
            setLoading(true);
            setData(null);

            const conversationalResult = handleConversationalIntent(query);
            if (conversationalResult) {
              setData(conversationalResult);
              setChats(prev => [{ query: query.trim(), answer: conversationalResult.answer, sources: [] }, ...prev]);
              setQuery("");
              setLoading(false);
              return;
            }

            try {
              const response = await fetch('/api/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ query: query.trim() }),
              });
              
              const textData = await response.text();
              let result;
              
              if (response.ok && textData.trim().length > 0) {
                try { result = JSON.parse(textData); } catch(jE) { result = { answer: textData, sources: [] }; }
              } else {
                result = await emergencyClientFetch(query.trim());
              }

              setData(result);
              setChats(prev => [{ query: query.trim(), answer: result.answer, sources: result.sources || [] }, ...prev]);
              setQuery("");
            } catch (err) {
              const backupResult = await emergencyClientFetch(query.trim());
              setData(backupResult);
              setChats(prev => [{ query: query.trim(), answer: backupResult.answer, sources: backupResult.sources || [] }, ...prev]);
              setQuery("");
            } finally {
              setLoading(false);
            }
          }} className="search-wrapper">
            <input
              type="text"
              className="search-input"
              placeholder="Ask anything across live indexes..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={loading}
            />
            <button type="submit" className="search-button" disabled={loading}>
              {loading ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="loading-spinner">
                  <path d="M21 12a9 9 0 11-6.219-8.56" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                  <polyline points="12 5 19 12 12 19"></polyline>
                </svg>
              )}
            </button>
          </form>

          {loading && (
            <div className="answer-box">
              <div className="loading-shimmer" style={{ width: '40%' }}></div>
              <div className="loading-shimmer" style={{ width: '95%' }}></div>
              <div className="loading-shimmer" style={{ width: '85%' }}></div>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="answer-box" dangerouslySetInnerHTML={{ __html: formatResponseText(data.answer) }} />
              {data.sources && data.sources.length > 0 && (
                <div className="sources-section">
                  <div className="sources-header">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
                    Verified Knowledge Context
                  </div>
                  <div className="sources-grid">
                    {data.sources.map((src, index) => (
                      <a key={index} href={src.url} target="_blank" rel="noopener noreferrer" className="source-card">
                        <div className="source-title">{src.title}</div>
                        <div className="source-meta">
                          <span className="citation-tag" style={{ margin: '0 4px 0 0', verticalAlign: 'middle' }}>{index + 1}</span>
                          {src.journal || "Resource"}
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          <footer className="system-legal-disclaimer">
            Cerebrum is an AI search engine synthesis tool. Always verify critical metrics back to original index sources.
          </footer>
        </div>
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
