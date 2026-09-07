/**
 * Cerebrum — application bootstrap.
 *
 * Everything that must happen before the interface can exist, and nothing
 * else: the React root, an error boundary, the dispatch between the static
 * informational routes and the application, and the startup side effects.
 *
 * The interface itself is in CerebrumApp.jsx.
 */

import React from "react";
import { createRoot } from "react-dom/client";
import { App, InfoPage, CSS } from "./CerebrumApp.jsx";

/**
 * Catches a render error anywhere below it.
 *
 * Without this, one exception in a deeply nested component unmounts the whole
 * tree and leaves a blank white page with no indication of what happened —
 * the worst possible failure for a research tool someone is mid-way through
 * using. This keeps the page, says plainly that something broke, and offers
 * the two actions that actually help.
 *
 * It deliberately does NOT show the error message: that text can contain
 * anything the failing component was holding, which may include the person's
 * own research. It goes to the console, where they can retrieve it if they
 * are reporting a bug.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error, info) {
    console.error("Cerebrum: render error", error, info && info.componentStack);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        role="alert"
        style={{
          minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center",
          background: "#0a0d14", color: "#e8e6e1", padding: 24,
          fontFamily: "'Inter Tight', system-ui, sans-serif", textAlign: "center",
        }}
      >
        <div style={{ maxWidth: 460 }}>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 10, fontFamily: "Newsreader, Georgia, serif" }}>
            Something broke on this screen
          </div>
          <p style={{ fontSize: 15, lineHeight: 1.65, color: "rgba(232,230,225,0.72)", margin: "0 0 22px" }}>
            Your saved work is unaffected. Reloading usually clears it. If it keeps
            happening, the console has the details and we would like to see them.
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: "10px 20px", borderRadius: 999, border: "none", cursor: "pointer",
                background: "#e8e6e1", color: "#0a0d14", fontWeight: 700, fontSize: 14,
              }}
            >
              Reload
            </button>
            <a
              href="mailto:contact@askcerebrum.org?subject=Cerebrum%20error"
              style={{
                padding: "10px 20px", borderRadius: 999, cursor: "pointer",
                border: "1px solid rgba(232,230,225,0.25)", color: "rgba(232,230,225,0.85)",
                fontWeight: 600, fontSize: 14, textDecoration: "none",
              }}
            >
              Tell us
            </a>
          </div>
        </div>
      </div>
    );
  }
}

/**
 * Route dispatch.
 *
 * The informational routes are also prerendered to static HTML at build time
 * (scripts/prerender.mjs) so they are readable without JavaScript; this is
 * what takes over once React has loaded, from the same content module, so the
 * two cannot drift.
 */
function Root() {
  const path = typeof window !== "undefined"
    ? window.location.pathname.replace(/\.html$/, "").replace(/\/+$/, "")
    : "";
  const INFO = ["about", "privacy", "terms", "disclosures", "contact"];
  const slug = path.replace(/^\//, "");
  const content = INFO.includes(slug) ? <InfoPage page={slug} /> : <App />;
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      {content}
    </>
  );
}

createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <Root />
  </ErrorBoundary>
);
