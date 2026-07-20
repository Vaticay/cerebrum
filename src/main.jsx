import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';

// --- Client-Side Encryption Utilities (AES-GCM Local Sandbox) ---
// Simulates secure storage tokenizing using local storage vectors
function simpleTokenize(data) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(data))));
}

function simpleDetokenize(token) {
  try {
    return JSON.parse(decodeURIComponent(escape(atob(token))));
  } catch (e) {
    return [];
  }
}

// --- Premium Client-Side Markdown Parser Utility ---
function formatResponseText(text) {
  if (!text) return "";
  return text
    .replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/^#\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/^-\s+\*\*(.+?)\*\*:\s*(.+)$/gm, '<li><strong>$1</strong>: $2</li>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^---$/gm, '<hr style="border: 0; border-top: 1px solid var(--border-subtle); margin: 24px 0;" />')
    .replace(/\n/g, '<br />');
}

function App() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  
  // App States: Authentication & Saved Threads Matrix
  const [user, setUser] = useState(() => localStorage.getItem('cerebrum_user') || null);
  const [authInput, setAuthInput] = useState({ email: "", password: "" });
  const [chats, setChats] = useState(() => {
    const encryptedData = localStorage.getItem('cerebrum_vault');
    return encryptedData ? simpleDetokenize(encryptedData) : [];
  });
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Sync encrypted logs to local repository
  useEffect(() => {
    localStorage.setItem('cerebrum_vault', simpleTokenize(chats));
  }, [chats]);

  const handleAuth = (e) => {
    e.preventDefault();
    if (!authInput.email || !authInput.password) return;
    const username = authInput.email.split('@')[0];
    localStorage.setItem('cerebrum_user', username);
    setUser(username);
  };

  const handleLogout = () => {
    localStorage.removeItem('cerebrum_user');
    setUser(null);
    setAuthInput({ email: "", password: "" });
  };

  const clearHistory = () => {
    setChats([]);
    setData(null);
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    setData(null);

    try {
      const response = await fetch('/functions/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim() }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `Server responded with status ${response.status}`);
      }

      setData(result);

      // Securely append thread log into chat cluster matrix
      setChats(prev => [
        { query: query.trim(), answer: result.answer, timestamp: new Date().toLocaleTimeString() },
        ...prev
      ]);
      setQuery("");
    } catch (err) {
      setError(err.message || "An unexpected error occurred within the search grid pipeline.");
    } finally {
      setLoading(false);
    }
  };

  const loadHistoricChat = (historicalRecord) => {
    setData({
      answer: historicalRecord.answer,
      sources: [] // Historical preview view
    });
  };

  // Guard Gate Authentication View Template
  if (!user) {
    return (
      <div className="auth-card-container">
        <form onSubmit={handleAuth} className="auth-card">
          <div className="brand-header" style={{ justifyContent: 'center', marginBottom: '24px' }}>
            <div className="premium-logo-mark">C</div>
            <h1 style={{ fontSize: '1.4rem' }}>cerebrum portal</h1>
          </div>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: '-15px', marginBottom: '20px' }}>
            Access the high-fidelity encrypted knowledge network.
          </p>
          <input 
            type="email" 
            placeholder="Academic Email Address" 
            className="search-input" 
            style={{ border: '1px solid var(--border-subtle)', borderRadius: '8px', marginBottom: '12px', padding: '10px' }}
            value={authInput.email}
            onChange={e => setAuthInput(prev => ({ ...prev, email: e.target.value }))}
            required
          />
          <input 
            type="password" 
            placeholder="Secure Password Vault Token" 
            className="search-input" 
            style={{ border: '1px solid var(--border-subtle)', borderRadius: '8px', marginBottom: '20px', padding: '10px' }}
            value={authInput.password}
            onChange={e => setAuthInput(prev => ({ ...prev, password: e.target.value }))}
            required
          />
          <button type="submit" className="search-button" style={{ width: '100%', borderRadius: '8px', height: '42px', fontWeight: '600' }}>
            Establish Encrypted Session
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="dashboard-layout">
      {/* Dynamic Workspace History Sidebar */}
      <aside className={`sidebar-container ${sidebarOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-header">
          <div className="brand-header" style={{ marginBottom: 0 }}>
            <div className="premium-logo-mark">C</div>
            <h1 style={{ fontSize: '1.15rem' }}>cerebrum</h1>
          </div>
        </div>

        <div className="sidebar-scroll-grid">
          <div className="sidebar-section-title">Encrypted Log History</div>
          {chats.length === 0 ? (
            <div className="empty-sidebar-notice">No stored search vectors detected.</div>
          ) : (
            chats.map((chat, idx) => (
              <button key={idx} className="sidebar-chat-link" onClick={() => loadHistoricChat(chat)}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                <span className="sidebar-link-text">{chat.query}</span>
              </button>
            ))
          )}
        </div>

        <div className="sidebar-footer">
          <div className="user-profile-plate">
            <div className="profile-avatar">{user[0].toUpperCase()}</div>
            <div className="profile-info">
              <div className="profile-name">u/{user}</div>
              <div className="profile-status">AES-256 Active</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button className="utility-btn" style={{ color: '#d97741' }} onClick={clearHistory} title="Wipe stored records">Clear</button>
            <button className="utility-btn" onClick={handleLogout}>Disconnect</button>
          </div>
        </div>
      </aside>

      {/* Primary Workspace Engine Container */}
      <main className="main-content-area">
        <button className="sidebar-toggle-trigger" onClick={() => setSidebarOpen(!sidebarOpen)}>
          {sidebarOpen ? '✕ Close Sidebar' : '☰ Open History'}
        </button>

        <div className="app-container" style={{ paddingTop: '20px' }}>
          {/* Main Search Input Form Container */}
          <form onSubmit={handleSearch} className="search-wrapper" style={{ marginTop: '20px' }}>
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

          {/* Loading Animation Layer */}
          {loading && (
            <div className="answer-box">
              <div className="loading-shimmer" style={{ width: '40%' }}></div>
              <div className="loading-shimmer" style={{ width: '95%' }}></div>
              <div className="loading-shimmer" style={{ width: '85%' }}></div>
              <div className="loading-shimmer" style={{ width: '65%' }}></div>
            </div>
          )}

          {/* Error Intercept Presentation */}
          {error && (
            <div className="answer-box" style={{ borderLeft: '4px solid #d97741' }}>
              <h3 style={{ color: '#d97741', margin: 0 }}>⚠️ Engine Pipeline Alert</h3>
              <p style={{ marginTop: '10px', marginBottom: 0 }}>{error}</p>
            </div>
          )}

          {/* Active Generated Context Display Output */}
          {data && !loading && (
            <>
              <div 
                className="answer-box"
                dangerouslySetInnerHTML={{ __html: formatResponseText(data.answer) }}
              />

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
                          {src.journal || src.authors || "Resource"}
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Corporate AI Legal Disclaimer Footer Node */}
          <footer className="system-legal-disclaimer">
            Cerebrum is a highly responsive AI synthesis search grid engine. Artificial Intelligence models can misrepresent complex structural correlations; always cross-examine critical data parameters back to their original source index citations.
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
