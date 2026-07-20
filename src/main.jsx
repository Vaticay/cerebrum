import React, { useState } from 'react';

// --- Premium Client-Side Markdown Parser Utility ---
function formatResponseText(text) {
  if (!text) return "";
  
  return text
    // Replace markdown headers (### Text) with styled HTML headings
    .replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
    // Replace structured bullet lists (- **Bold**: Body)
    .replace(/^-\s+\*\*(.+?)\*\*:\s*(.+)$/gm, '<li><strong>$1</strong>: $2</li>')
    // Replace stand-alone bold marks (**Text**)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // Replace blockquotes (> Text)
    .replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>')
    // Convert regular line breaks into clean vertical element spacing
    .replace(/\n/g, '<br />');
}

export default function App() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    setData(null);

    try {
      // Direct connection to your serverless Cloudflare API endpoint
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
    } catch (err) {
      setError(err.message || "An unexpected error occurred within the search grid pipeline.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-container">
      {/* Brand Header */}
      <header className="brand-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#4a5d4e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/>
            <path d="M12 6v6l4 2"/>
          </svg>
          <h1>cerebrum</h1>
        </div>
      </header>

      {/* Modern Search Wrapper */}
      <form onSubmit={handleSearch} className="search-wrapper">
        <input
          type="text"
          className="search-input"
          placeholder="Ask anything... (e.g., Why is the SN2 reaction stereospecific?)"
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
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"></line>
              <polyline points="12 5 19 12 12 19"></polyline>
            </svg>
          )}
        </button>
      </form>

      {/* Loading State Skeleton */}
      {loading && (
        <div className="answer-box">
          <div className="loading-shimmer" style={{ width: '40%' }}></div>
          <div className="loading-shimmer" style={{ width: '90%' }}></div>
          <div className="loading-shimmer" style={{ width: '85%' }}></div>
          <div className="loading-shimmer" style={{ width: '60%' }}></div>
        </div>
      )}

      {/* Error Presentation Module */}
      {error && (
        <div className="answer-box" style={{ borderLeft: '4px solid #d97741' }}>
          <h3 style={{ color: '#d97741', margin: 0 }}>⚠️ Engine Pipeline Alert</h3>
          <p style={{ marginTop: '10px', marginBottom: 0 }}>{error}</p>
        </div>
      )}

      {/* AI Synthesis Output Results */}
      {data && !loading && (
        <>
          <div 
            className="answer-box"
            dangerouslySetInnerHTML={{ __html: formatResponseText(data.answer) }}
          />

          {/* Sources Footprint Layout */}
          {data.sources && data.sources.length > 0 && (
            <div className="sources-section">
              <div className="sources-header">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
                  <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
                </svg>
                Verified Matrix Context
              </div>
              <div className="sources-grid">
                {data.sources.map((src, index) => (
                  <a 
                    key={index} 
                    href={src.url} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="source-card"
                  >
                    <div className="source-title">{src.title}</div>
                    <div className="source-meta">
                      <span className="citation-tag" style={{ margin: '0 4px 0 0', verticalAlign: 'middle' }}>
                        {index + 1}
                      </span>
                      {src.journal || src.authors || "Resource Link"}
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
