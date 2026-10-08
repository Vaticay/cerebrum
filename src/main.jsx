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
import { classifyRoute, INFO_SLUGS } from "./routeClassify.js";
import { PALETTES, isProPalette, ACCENTS } from "./palettes.js";

/**
 * Catches a render error anywhere below it.
 *
 * Without this, one exception in a deeply nested component unmounts the whole
 * tree and leaves a blank white page with no indication of what happened —
 * the worst possible failure for a research tool someone is mid-way through
 * using. This keeps the page, says plainly that something broke, and offers
 * the two actions that actually help.
 *
 * It shows only a short snippet (the first 220 characters) of the error
 * message — enough to recognize the failure — plus a "Copy details" button
 * for the full text. The snippet may include the person's own search words,
 * which the copy button's label discloses; the full message and stack go to
 * the console, where they can be retrieved when reporting a bug.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false, error: null, info: null, copied: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error, info) {
    console.error("Cerebrum: render error", error, info && info.componentStack);
    this.setState({ error, info });
  }
  copyDetails() {
    const { error, info } = this.state;
    const text = [
      "Cerebrum render error",
      "Message: " + (error && error.message ? error.message : String(error)),
      "Stack: " + (error && error.stack ? error.stack : "(none)"),
      "Component stack: " + (info && info.componentStack ? info.componentStack : "(none)"),
      "URL: " + (typeof window !== "undefined" ? window.location.href : "(unknown)"),
      "Time: " + new Date().toISOString(),
    ].join("\n");
    const done = () => this.setState({ copied: true });
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => this.setState({ copied: "failed" }));
    } else {
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); } catch { this.setState({ copied: "failed" }); }
      document.body.removeChild(ta);
    }
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
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 10, fontFamily: "'Inter Tight', 'Inter', system-ui, sans-serif", letterSpacing: "-0.015em" }}>
            Something broke on this screen
          </div>
          <p style={{ fontSize: 15, lineHeight: 1.65, color: "rgba(232,230,225,0.72)", margin: "0 0 22px" }}>
            Your saved work is unaffected. Reloading usually clears it. If it keeps
            happening, the console has the details and we would like to see them.
          </p>
          {this.state.error && (
            <p style={{ fontSize: 13, lineHeight: 1.6, color: "rgba(232,230,225,0.55)", margin: "0 0 18px", wordBreak: "break-word" }}>
              {String((this.state.error && this.state.error.message) || this.state.error).slice(0, 220)}
            </p>
          )}
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
              href="mailto:dusty@askcerebrum.org?subject=Cerebrum%20error"
              style={{
                padding: "10px 20px", borderRadius: 999, cursor: "pointer",
                border: "1px solid rgba(232,230,225,0.25)", color: "rgba(232,230,225,0.85)",
                fontWeight: 600, fontSize: 14, textDecoration: "none",
              }}
            >
              Tell us
            </a>
            <button
              onClick={() => this.copyDetails()}
              style={{
                padding: "10px 20px", borderRadius: 999, cursor: "pointer",
                border: "1px solid rgba(232,230,225,0.25)", color: "rgba(232,230,225,0.85)",
                background: "transparent", fontWeight: 600, fontSize: 14,
              }}
            >
              {this.state.copied === true ? "Copied ✓" : this.state.copied === "failed" ? "Copy failed" : "Copy details"}
            </button>
          </div>
          <p style={{ fontSize: 12, lineHeight: 1.6, color: "rgba(232,230,225,0.4)", margin: "18px 0 0" }}>
            Copy details grabs the technical error text (it may include your search words) so you can paste it to us.
          </p>
        </div>
      </div>
    );
  }
}

/**
 * Client-side 404 view.
 *
 * Every unknown path serves the SPA shell (the `_redirects` catch-all), so
 * without this an invented URL renders the search UI with a 200 — a soft
 * 404. This gives crawlers and humans a real "not here" page: the correct
 * <title>, plain wording, and links to the places that do exist.
 *
 * A server-side 404 status is deliberately NOT implemented: no edge code
 * can distinguish "unknown path" from "static asset that Pages would have
 * served" without a build-time allowlist, and a catch-all Function route
 * would shadow real static files. This view is the safe half; see the
 * ship report for the deferred edge half.
 *
 * The view is theme aware: it reads the visitor's palette cookie like
 * InfoPage does instead of hardcoding dark, so light mode users do not get
 * a jarring black page. It also earns its keep: a working search box that
 * deep links into the app (?q= prefills the composer and runs once, per
 * src/deepLink.js), a fuzzy "did you mean" suggestion for mistyped slugs,
 * and the full sitemap so a lost visitor can browse instead of bounce.
 */
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

function bestRouteMatch(path) {
  if (!path) return null;
  let best = null, bestD = Infinity;
  for (const r of INFO_SLUGS) {
    const d = levenshtein(path.toLowerCase(), r);
    if (d < bestD) { bestD = d; best = r; }
  }
  if (best && bestD <= Math.max(2, Math.floor(best.length / 3))) return best;
  return null;
}

function readCookie(k) {
  try {
    const m = document.cookie.match(new RegExp("(?:^|; )" + k + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : null;
  } catch { return null; }
}

function NotFound() {
  React.useEffect(() => {
    try { document.title = "Page not found — Cerebrum"; } catch (cbErr) { console.error("[Cerebrum] main.jsx NotFound: document.title = 'Page not found — Cerebrum'; }:", cbErr); }
  }, []);
  const paletteName = readCookie("cb_pal") || "Dark";
  const P = PALETTES[isProPalette(paletteName) ? "Dark" : paletteName] || PALETTES.Dark;
  const accentName = readCookie("cb_accent") || "Mono";
  const customAccent = readCookie("cb_accentCustom") || "";
  const accent = customAccent || ACCENTS[accentName] || ACCENTS.Mono;
  const [q, setQ] = React.useState("");
  const deadPath = (() => {
    try { return window.location.pathname.replace(/^\//, "").replace(/\.html$/, "").replace(/\/+$/, ""); }
    catch { return ""; }
  })();
  const suggestion = bestRouteMatch(deadPath);
  const go = () => {
    const query = q.trim();
    if (query) window.location.href = "/?q=" + encodeURIComponent(query);
  };
  const link = {
    color: accent, textDecoration: "underline",
    textUnderlineOffset: 3, textDecorationColor: "rgba(128,128,128,0.4)",
    fontWeight: 600,
  };
  const groups = [
    { h: "Product", links: [["Features", "/features"], ["Pricing", "/pricing"], ["Document Mode", "/document-mode"], ["Diagram Studio", "/diagram-studio"], ["Investigations", "/investigations"]] },
    { h: "Company", links: [["About", "/about"], ["Contact", "/contact"]] },
    { h: "Legal", links: [["Privacy", "/privacy"], ["Terms", "/terms"], ["Disclosures", "/disclosures"]] },
  ];
  return (
    <div style={{
      minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center",
      background: P.bg, color: P.ink, padding: 24,
      fontFamily: "var(--cb-font, 'Inter Tight', system-ui, sans-serif)",
    }}>
      <div style={{ maxWidth: 560, width: "100%", textAlign: "center", padding: "48px 0" }}>
        <div style={{ fontSize: 13, letterSpacing: "0.14em", color: P.faint, marginBottom: 14, fontWeight: 600 }}>
          404
        </div>
        <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.015em", margin: "0 0 12px", color: P.ink }}>
          We don&rsquo;t invent pages either.
        </h1>
        <p style={{ fontSize: 15, lineHeight: 1.65, color: P.ink2, margin: "0 0 8px" }}>
          That address doesn&rsquo;t match anything here. We could guess what you
          meant, but we&rsquo;d rather say so.
        </p>
        {suggestion && (
          <p style={{ fontSize: 15, lineHeight: 1.65, color: P.ink2, margin: "0 0 8px" }}>
            Did you mean <a href={"/" + suggestion} style={link}>/{suggestion}</a>?
          </p>
        )}
        <div style={{ display: "flex", gap: 8, margin: "24px auto 0", maxWidth: 440 }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") go(); }}
            placeholder="Or search the literature directly"
            aria-label="Search the literature"
            style={{
              flex: 1, minHeight: 44, padding: "0 16px", borderRadius: 12,
              border: `1px solid ${P.line2}`, background: P.surface, color: P.ink,
              fontSize: 16, fontFamily: "var(--cb-font)", outline: "none",
            }}
          />
          <button
            onClick={go}
            style={{
              minHeight: 44, minWidth: 44, padding: "0 20px", borderRadius: 12,
              border: "none", background: accent, color: "#0b0b0e",
              fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "var(--cb-font)",
            }}
          >
            Search
          </button>
        </div>
        <div style={{ display: "flex", gap: 18, justifyContent: "center", flexWrap: "wrap", fontSize: 14, marginTop: 26 }}>
          <a href="/" style={link}>Back to search</a>
          <a href="/about" style={link}>About Cerebrum</a>
          <a href="/contact" style={link}>Contact</a>
        </div>
        <div style={{
          marginTop: 40, paddingTop: 24, borderTop: `1px solid ${P.line}`,
          display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, textAlign: "left",
        }}>
          {groups.map((g) => (
            <div key={g.h}>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", color: P.faint, marginBottom: 10 }}>
                {g.h.toUpperCase()}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {g.links.map(([label, href]) => (
                  <a key={href} href={href} style={{ fontSize: 14, color: P.ink2, textDecoration: "none", fontWeight: 500 }}>{label}</a>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 13, color: P.faint, marginTop: 32, lineHeight: 1.6 }}>
          Think this page should exist? <a href="/contact" style={link}>Tell us</a>.
        </p>
      </div>
    </div>
  );
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
  const { kind, slug } = classifyRoute(
    typeof window !== "undefined" ? window.location.pathname : ""
  );
  /* "/" and "/index.html" are the application. The app never reads the
     pathname for routing (it only ever clears or rewrites it), so any other
     path that reaches the SPA shell has no static file and no function
     behind it — it is a dead end, not a deep link. Render the 404 view
     instead of the search UI. */
  const content = kind === "info" ? <InfoPage page={slug} /> : kind === "app" ? <App /> : <NotFound />;
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      {/* Screen-reader-only h1 for the application route. The app shell is
          a ceremonial intro with no visible heading by design; InfoPage
          routes render their own visible h1, and the 404 view has its own
          visible h1, so this only fills the gap where crawlers and
          assistive tech would otherwise find no top-level heading at all.
          Zero visual impact. */}
      {kind === "app" && (
        <h1 style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 }}>
          Cerebrum — free scientific literature search
        </h1>
      )}
      {content}
    </>
  );
}

createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <Root />
  </ErrorBoundary>
);

/**
 * Service worker registration — push notifications for closed tabs.
 *
 * The in-app poll and cbNotify only fire while a tab is open; public/sw.js
 * is what reaches someone with no tab open at all. Registered on window
 * load (never blocking first paint), and only where the browser actually
 * supports service workers. A failed registration is not fatal — the app
 * keeps working with background-tab notifications only.
 */
if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    try {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    } catch { /* unsupported environment */ }
  });
  // The service worker forwards push events to us instead of notifying
  // when a tab is already visible (see public/sw.js) — a push arriving
  // here means "something happened while you were looking elsewhere in
  // the app". Bumping a revision counter lets the inbox and call UI
  // refresh without polling faster.
  try {
    navigator.serviceWorker.addEventListener("message", (event) => {
      const data = event && event.data;
      if (data && data.type === "cb-push-message") {
        try {
          window.dispatchEvent(new CustomEvent("cb:push-message", { detail: data }));
        } catch { /* noop */ }
      }
    });
  } catch { /* noop */ }
}
