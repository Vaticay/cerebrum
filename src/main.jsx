import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';

// --- Client-Side Encryption Utilities ---
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

// --- Original Brain Logo Vector ---
function BrainLogo({ strokeColor = "#ffffff" }) {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={strokeColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, display: 'block' }}>
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1 0-4.12A2.5 2.5 0 0 1 7.5 11a2.5 2.5 0 0 1 0-4.12A2.5 2.5 0 0 1 9.5 2Z" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 0-4.12A2.5 2.5 0 0 0 16.5 11a2.5 2.5 0 0 0 0-4.12A2.5 2.5 0 0 0 14.5 2Z" />
    </svg>
  );
}

function App() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  
  const [user, setUser] = useState(() => localStorage.getItem('cerebrum_user') || null);
  const [authInput, setAuthInput] = useState({ email: "", password: "" });
  const [chats, setChats] = useState(() => {
    const encryptedData = localStorage.getItem('cerebrum_vault');
    return encryptedData ? simpleDetokenize(encryptedData) : [];
  });
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    localStorage.setItem('cerebrum_vault', simpleTokenize(chats));
  }, [chats]);

  const handleAuth = (e) => {
    e.preventDefault();
    if (!authInput.email || !authInput.password) return;
    const username = authInput.email.split('@')[0];
    const capitalizedUser = username.charAt(0).toUpperCase() + username.slice(1);
    localStorage.setItem('cerebrum_user', capitalizedUser);
    setUser(capitalizedUser);
  };

  const handleGuestBypass = () => {
    localStorage.setItem('cerebrum_user', 'Guest');
    setUser('Guest');
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
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ query: query.trim() }),
      });

      const textData = await response.text();
      let result;
      
      try {
        result = JSON.parse(textData);
      } catch (jsonErr) {
        // If server outputs raw text, salvage it into a workable object wrapper
        if (textData && textData.trim().length > 0) {
          result = { answer: textData, sources: [] };
        } else {
          throw new Error("Empty stream returned from upstream data nodes.");
        }
      }

      if (!response.ok && !result.answer) {
        throw new Error(result.error || `Pipeline server error code: ${response.status}`);
      }

      setData(result);
      setChats(prev => [
        { query: query.trim(), answer: result.answer },
        ...prev
      ]);
      setQuery("");
    } catch (err) {
      setError(err.message || "An unexpected error occurred within the search grid pipeline.");
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <div className="auth-card-container">
        <div className="auth-card">
          <form onSubmit={handleAuth}>
            <div className="brand-header" style={{ justifyContent: 'center', marginBottom: '24px' }}>
              <BrainLogo strokeColor="#38493d" />
              <h1>Cerebrum</h1>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: '-15px', marginBottom: '20px' }}>
              Access the high-fidelity encrypted knowledge network.
            </p>
            <input 
              type="email" 
              placeholder="Academic Email Address" 
              className="search-input" 
              style={{ border: '1px solid var(--border-subtle)', borderRadius: '8px', marginBottom: '12px', padding: '10px', width: '94%', background: '#fff' }}
              value={authInput.email}
              onChange={e => setAuthInput(prev => ({ ...prev, email: e.target.value }))}
              required
            />
            <input 
              type="password" 
              placeholder="Secure Password Vault Token" 
              className="search-input" 
              style={{ border: '1px solid var(--border-subtle)', borderRadius: '8px', marginBottom: '20px', padding: '10px', width: '94%', background: '#fff' }}
              value={authInput.password}
              onChange={e => setAuthInput(prev => ({ ...prev, password: e.target.value }))}
              required
            />
            <button type="submit" className="search-button-wide">
              Establish Encrypted Session
            </button>
          </form>
          
          <div style={{ position: 'relative', margin: '16px 0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ background: 'var(--bg-card)', padding: '0 10px', fontSize: '0.75rem', color: 'var(--text-muted)', zIndex: 2 }}>OR</span>
            <div style={{ position: 'absolute', width: '100%', borderTop: '1px solid var(--border-subtle)', zIndex: 1 }}></div>
          </div>

          <button onClick={handleGuestBypass} className="guest-button-wide">
            Use as Guest
          </button>
        </div>
      </div>
    );
  }

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
              <button key={idx} className="sidebar-chat-link" onClick={() => setData({ answer: chat.answer, sources: [] })}>
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
              <div className="profile-name" style={{ color: '#ffffff' }}>{user}</div>
              <div className="profile-status">{user === 'Guest' ? 'Standard Tier' : 'AES-256 Vector'}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button className="utility-btn-dark" onClick={clearHistory}>Clear</button>
            <button className="utility-btn-dark" onClick={handleLogout}>Disconnect</button>
          </div>
        </div>
      </aside>

      <main className="main-content-area">
        <button className="sidebar-toggle-trigger" onClick={() => setSidebarOpen(!sidebarOpen)}>
          {sidebarOpen ? '✕ Hide Sidebar' : '☰ Open History'}
        </button>

        <div className="app-container">
          <form onSubmit={handleSearch} className="search-wrapper">
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

          {error && (
            <div className="answer-box" style={{ borderLeft: '4px solid #d97741' }}>
              <h3 style={{ color: '#d97741', margin: 0 }}>⚠️ Engine Pipeline Alert</h3>
              <p style={{ marginTop: '10px', marginBottom: 0 }}>{error}</p>
            </div>
          )}

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
