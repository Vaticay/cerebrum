/**
 * flowcharts.jsx
 *
 * 2026 10 22: Diagram Studio rebuilt as one studio. The two old
 * editors are gone and one DiagramStudio works from an ordered
 * list of steps instead. Labels taken from source text only ever
 * delete words from that text through the fcLabel helpers, never
 * invent new ones. This file also keeps the Dialog primitive and
 * the shared diagram helpers other files import.
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { Icon, UIButton, UISelect, SHADOW, withAlpha, FONT_SIZES, STATUS, Z, TRACKING, RADIUS } from "./designSystem.jsx";
import { getCookie, __cbMotionCache, cbMotionCacheSet, download, toast } from "./appUtils.js";
import { cbDialogLockScroll, cbDialogUnlockScroll } from "./scrollLock.js";
import { fcExtractSteps, fcCompressStep } from "./fcLabel.js";
import { safeHref } from "./textUtils.js";


export function cbMotionOff() {
  // Cached ~1s: this runs in hot paths (pointer handlers, count-up hooks)
  // and each uncached call re-parses document.cookie plus a matchMedia
  // query. The setting only changes from Settings, which writes through
  // setCookie — that busts the cache (see setCookie below), so a 1s TTL
  // here is purely a hot-loop guard, never a staleness risk.
  const now = Date.now();
  if (__cbMotionCache && now - __cbMotionCache.t < 1000) return __cbMotionCache.v;
  let v = false;
  try {
    if (getCookie("cb_anim2") === "off") v = true;
    else v = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  } catch (cbErr) { console.error("[Cerebrum] flowcharts.jsx cbMotionOff: if (getCookie('cb_anim2') === 'off') v = true;:", cbErr); }
  try { cbMotionCacheSet({ v, t: now }); } catch (cbErr) { console.error("[Cerebrum] flowcharts.jsx cbMotionOff: cache set:", cbErr); }
  return v;
}

const cbDialogStack = [];
// Scroll locking is owned by src/scrollLock.js (the single ref-counted
// lock); the dialog stack here only tracks topmost/Escape/focus order.

const CB_FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({
  label, labelledBy, onClose, children,
  width = 560, zIndex = 220, drawer = false,
  panelStyle = {}, scrimStyle = {},
  dismissable = true, initialFocus = null, panelClassName = "cb-modal",
  // Optional Escape override: called instead of onClose when the dialog is
  // topmost (e.g. DiagramStudio dismisses its export menu first).
  onEscape = null,
}) {
  const panelRef = useRef(null);
  const idRef = useRef(null);
  if (idRef.current === null) idRef.current = "cbdlg-" + Math.random().toString(36).slice(2);
  const [entered, setEntered] = useState(false);
  const animate = !cbMotionOff();
  /* The key handler is registered once on mount (capture phase), but the
     callbacks it invokes must stay fresh — e.g. DiagramStudio's onEscape
     closes over the export menu's open state, and CollectionsModal's over
     the rename input. Refs keep the latest closure without re-registering. */
  const onEscapeRef = useRef(onEscape);
  const onCloseRef = useRef(onClose);
  onEscapeRef.current = onEscape;
  onCloseRef.current = onClose;

  useEffect(() => {
    const id = idRef.current;
    const record = { id };
    const prevActive = document.activeElement;
    cbDialogStack.push(record);
    cbDialogLockScroll();

    // Initial focus into the dialog: an explicit ref wins, then the
    // first focusable control, then the panel itself (tabIndex=-1).
    const panel = panelRef.current;
    const target =
      (initialFocus && initialFocus.current) ||
      (panel && panel.querySelector(CB_FOCUSABLE)) ||
      panel;
    try { if (target && target.focus) target.focus({ preventScroll: true }); } catch (cbErr) { console.error("[Cerebrum] flowcharts.jsx: if (target && target.focus) target.focus({ preventScroll: true }); }:", cbErr); }

    const onKey = (e) => {
      // Only the topmost stacked overlay responds to keys.
      if (cbDialogStack[cbDialogStack.length - 1]?.id !== id) return;
      if (e.key === "Escape") {
        // Bubble phase, deliberately: an inner widget that handles Escape
        // itself (citation chip, rename input, export menu) runs its React
        // onKeyDown first and stopPropagation()s, so it wins — exactly the
        // ordering the old window-level modal listeners had. Nested dialogs
        // are safe because only the topmost record answers, and the answer
        // stops the event before the outer dialog or any window-level
        // handler (command palette, notebook overlay) sees it.
        e.stopPropagation();
        if (onEscapeRef.current) onEscapeRef.current();
        else if (dismissable) onCloseRef.current();
        return;
      }
      if (e.key === "Tab" && panelRef.current) {
        const nodes = Array.from(panelRef.current.querySelectorAll(CB_FOCUSABLE))
          // offsetParent is null for position:fixed elements — excluding
          // them drops fixed-position focusables (sticky headers, floating
          // action buttons) out of the Tab cycle entirely. Keep fixed
          // elements; visibility is still enforced by the checks below.
          .filter((el) => !el.disabled && (el.offsetParent !== null || getComputedStyle(el).position === "fixed"))
          .filter((el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return cs.visibility !== "hidden" && cs.display !== "none" && (r.width > 0 || r.height > 0); });
        if (nodes.length === 0) { e.preventDefault(); return; }
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);

    let raf = 0;
    if (animate) raf = requestAnimationFrame(() => setEntered(true));
    else setEntered(true);

    return () => {
      document.removeEventListener("keydown", onKey);
      cancelAnimationFrame(raf);
      const i = cbDialogStack.findIndex((r) => r.id === id);
      if (i >= 0) cbDialogStack.splice(i, 1);
      cbDialogUnlockScroll();
      // Focus goes back where it came from.
      try {
        if (prevActive && prevActive.focus && document.contains(prevActive)) {
          prevActive.focus({ preventScroll: true });
        }
      } catch (cbErr) { console.error("[Cerebrum] flowcharts.jsx if: if (prevActive && prevActive.focus && document.contains(prevActive)) {:", cbErr); }
    };
    // onClose identity is caller-owned; mount/unmount semantics only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const basePanel = drawer ? {
    width: "min(480px, 94vw)", height: "100%", overflowY: "auto", outline: "none",
    display: "flex", flexDirection: "column",
  } : {
    width: `min(${width}px, 100%)`, maxHeight: "86dvh", overflowY: "auto", outline: "none",
    display: "flex", flexDirection: "column",
  };

  return createPortal(
    <div
      role="dialog" aria-modal="true"
      // A dialog with neither label nor labelledBy gets no accessible name
      // — default to a generic one so AT always announces something.
      aria-label={labelledBy ? undefined : (label || "Dialog")}
      aria-labelledby={labelledBy}
      onMouseDown={(e) => { if (e.target === e.currentTarget) { if (onEscapeRef.current) onEscapeRef.current(); else if (dismissable) onCloseRef.current(); } }}
      style={{
        position: "fixed", inset: 0, zIndex, display: "flex",
        alignItems: drawer ? "stretch" : "center", justifyContent: drawer ? "flex-end" : "center",
        padding: drawer ? 0 : "max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom))",
        // Controlled dim — no backdrop-filter blur on the scrim (§4).
        background: "rgba(0,0,0,0.65)",
        opacity: animate ? (entered ? 1 : 0) : 1,
        transition: animate ? "opacity 280ms ease" : "none",
        ...scrimStyle,
      }}
    >
      <div
        ref={panelRef} tabIndex={-1}
        className={panelClassName}
        style={{
          ...basePanel,
          // Default panel treatment: every dialog gets a visible panel even
          // when the caller forgets panelStyle. Uses theme CSS variables
          // (Dialog portals to body; the app mirrors --cb-surface onto
          // the document element so the variable does reach here). The
          // fallback constant is the system surface literal #1c1b19
          // (COLOR.surface1, the Dark surface): if the variable ever
          // does go missing, the fallback ink #f4f4f2 stays fully
          // readable on it. The old mid grey #767676 left both the
          // light and the dark ink nearly unreadable (M3, 2026-10-18).
          background: "var(--cb-surface, #1c1b19)",
          border: "1px solid var(--cb-line, rgba(255,255,255,0.12))",
          borderRadius: RADIUS.lg,
          // The Dialog primitive owns the one allowed modal shadow
          // (SHADOW.xl, 2026-10-18). Callers pass panelStyle last and
          // can still override it for named media surfaces.
          boxShadow: SHADOW.xl(null),
          color: "var(--cb-ink, #f4f4f2)",
          // The class brings the shared panel treatment; the keyframe
          // entrance is neutralized in favor of this state-driven one.
          animation: "none",
          opacity: animate ? (entered ? 1 : 0) : 1,
          transform: animate ? (entered ? "translateY(0) scale(1)" : "translateY(10px) scale(0.985)") : "none",
          transition: animate ? "opacity 280ms ease, transform 280ms cubic-bezier(0.16, 1, 0.3, 1)" : "none",
          ...panelStyle,
        }}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}



/* ══════════════════════════════════════════════════════════════════
   Flowchart Studio

   A real diagram instrument: typed nodes (start / process / decision /
   input-output / evidence / end), connectable labeled edges,
   auto-layout, undo/redo, pan/zoom, and honest exports (SVG, PNG,
   Markdown outline). "Draft from answer" turns the current answer's
   steps into a starting graph — always labelled a draft, always
   reviewable, because a flowchart that invents structure is worse
   than no flowchart. Charts persist to localStorage (cb_flowcharts) as the
   offline cache and sync to the account (user_flowcharts) when signed in,
   and surface in the Library.
   ══════════════════════════════════════════════════════════════════ */

/* Node geometry, redesigned for terse labels: wider, taller, more air —
   a 52-char label sets in two calm lines at 15px with a mono step kicker
   above it, instead of four cramped lines at 13.5px. */
const FC_NODE_TYPES = {
  start:    { name: "Start",          w: 148, h: 58  },
  process:  { name: "Process",        w: 200, h: 92  },
  decision: { name: "Decision",       w: 200, h: 132 },
  io:       { name: "Input / Output", w: 200, h: 80  },
  evidence: { name: "Evidence",       w: 208, h: 104 },
  end:      { name: "End",            w: 148, h: 58  },
};
const FC_ORDER = ["start", "process", "decision", "io", "evidence", "end"];
const FC_GAP_Y = 104;

let fcSeq = 0;
function fcId(p) { fcSeq += 1; return `fc-${p}-${Date.now().toString(36)}-${fcSeq.toString(36)}`; }

// Sign-in merge for evidence maps: the account's copy wins on id conflicts,
// charts that exist only in this browser are kept (never silently dropped),
// and the result is most-recent-first. Pure so the sync tests can cover it.
function mergeFlowcharts(serverCharts, localCharts) {
  const server = Array.isArray(serverCharts) ? serverCharts : [];
  const local = Array.isArray(localCharts) ? localCharts : [];
  const serverIds = new Set(server.map((c) => c && c.id));
  const merged = [...server, ...local.filter((c) => c && !serverIds.has(c.id))];
  merged.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return merged;
}

function fcNewNode(type, x, y, label, extra = {}) {
  const t = FC_NODE_TYPES[type] || FC_NODE_TYPES.process;
  return { id: fcId("n"), type, x: Math.round(x), y: Math.round(y), w: t.w, h: t.h, label: label || t.name, ...extra };
}
function fcNewEdge(from, to, label = "") { return { id: fcId("e"), from, to, label }; }
function fcNodeById(nodes, id) { return nodes.find((n) => n.id === id); }
function fcSlug(s) { return (s || "flowchart").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase().slice(0, 60) || "flowchart"; }

/* Word-wrap a label into lines that fit ~maxChars each. */
function fcWrap(label, maxChars) {
  const words = String(label || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? cur + " " + w : w;
    if (next.length > maxChars && cur) { lines.push(cur); cur = w; }
    else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

/* ── Edge geometry: pick the closest port pair, route a bezier ── */
function fcPorts(n) {
  const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
  return [
    { x: cx, y: n.y, side: "t" },
    { x: n.x + n.w, y: cy, side: "r" },
    { x: cx, y: n.y + n.h, side: "b" },
    { x: n.x, y: cy, side: "l" },
  ];
}
function fcEdgeGeom(a, b) {
  const pa = fcPorts(a), pb = fcPorts(b);
  let best = null;
  for (const p of pa) for (const q of pb) {
    const d = (p.x - q.x) * (p.x - q.x) + (p.y - q.y) * (p.y - q.y);
    if (!best || d < best.d) best = { p, q, d };
  }
  const { p, q } = best;
  const dir = (pt) => (pt.side === "t" ? [0, -1] : pt.side === "b" ? [0, 1] : pt.side === "l" ? [-1, 0] : [1, 0]);
  const [dx1, dy1] = dir(p), [dx2, dy2] = dir(q);
  const dist = Math.sqrt(best.d) || 1;
  const k = Math.min(90, Math.max(30, dist * 0.35));
  return {
    d: `M ${p.x} ${p.y} C ${p.x + dx1 * k} ${p.y + dy1 * k}, ${q.x + dx2 * k} ${q.y + dy2 * k}, ${q.x} ${q.y}`,
    mx: (p.x + q.x) / 2, my: (p.y + q.y) / 2,
  };
}

/* ── Layered auto-layout: topological layers, centered ── */
function fcAutoLayout(nodes, edges) {
  if (!nodes.length) return nodes;
  const result = nodes.map((n) => ({ ...n }));
  /* No connections yet: a single centered column reads better than a
     1200px-wide row that pushes nodes off-screen. */
  if (!edges.length) {
    let y = 60;
    const cx = 600;
    [...result].sort((a, b) => a.y - b.y || a.x - b.x).forEach((n) => {
      n.x = Math.round(cx - n.w / 2);
      n.y = Math.round(y);
      y += n.h + FC_GAP_Y;
    });
    return result;
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const incoming = new Map(nodes.map((n) => [n.id, 0]));
  const out = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (e.from !== e.to && byId.has(e.from) && byId.has(e.to)) {
      out.get(e.from).push(e.to);
      incoming.set(e.to, incoming.get(e.to) + 1);
    }
  }
  const order = [...nodes].sort((a, b) => a.x - b.x);
  const layer = new Map();
  const queue = order.filter((n) => incoming.get(n.id) === 0);
  queue.forEach((n) => layer.set(n.id, 0));
  const q = [...queue];
  const inQueue = new Set(q.map((n) => n.id));
  while (q.length) {
    const n = q.shift();
    for (const t of out.get(n.id)) {
      const nl = layer.get(n.id) + 1;
      if (!layer.has(t) || layer.get(t) < nl) layer.set(t, nl);
      if (!inQueue.has(t)) { inQueue.add(t); q.push(byId.get(t)); }
    }
  }
  let maxL = 0;
  for (const v of layer.values()) maxL = Math.max(maxL, v);
  for (const n of nodes) if (!layer.has(n.id)) layer.set(n.id, maxL + 1);
  const layers = new Map();
  for (const n of order) {
    const l = layer.get(n.id);
    if (!layers.has(l)) layers.set(l, []);
    layers.get(l).push(n);
  }
  const rById = new Map(result.map((n) => [n.id, n]));
  const totalW = 1200;
  [...layers.keys()].sort((a, b) => a - b).forEach((l, li) => {
    const arr = layers.get(l);
    const y = 60 + li * 172;
    arr.forEach((n, i) => {
      const c = rById.get(n.id);
      const slotW = totalW / arr.length;
      c.x = Math.round(slotW * i + slotW / 2 - c.w / 2);
      c.y = Math.round(y + (104 - Math.min(c.h, 104)) / 2);
    });
  });
  return result;
}

/* ── Draft from answer: extract steps, never invent them ──
   Labels go through fcCompressStep (src/fcLabel.js): a few words per node,
   compressed by deleting filler — never a 96-char slice with "…". Steps
   that carried citations in the answer become evidence nodes grounded to
   the real paper (sourceIdx into `sources`); the full source sentence is
   kept on node.detail so the inspector can show what the label compressed. */
function fcDraftFromAnswer(text, sources) {
  const rawSteps = fcExtractSteps(text, 7);
  if (!rawSteps.length) return null;
  const srcCount = Array.isArray(sources) ? sources.length : 0;
  const nodes = [];
  const edges = [];
  const cx = 600;
  let y = 60;
  const addStep = (type, label, extra = {}) => {
    const t = FC_NODE_TYPES[type];
    const n = fcNewNode(type, cx - t.w / 2, y, label, extra);
    nodes.push(n);
    y += t.h + FC_GAP_Y;
    return n;
  };
  const start = addStep("start", "Start");
  let prev = start;
  rawSteps.forEach((st, i) => {
    const label = fcCompressStep(st.text);
    const isDecision = /^(if|when|whether)\b/i.test(st.text) || /\bdepends on\b/i.test(st.text);
    // A step that cited a paper is evidence, not prose: ground the node to
    // the real source. Citation indices are 1-based; anything out of range
    // is ignored rather than guessed at.
    const citeIdx = st.cites.find((n) => n >= 1 && n <= srcCount);
    const type = typeof citeIdx === "number" ? "evidence" : isDecision ? "decision" : "process";
    const n = addStep(type, label, {
      step: i + 1,
      ...(st.text !== label ? { detail: st.text } : {}),
      ...(typeof citeIdx === "number" ? { sourceIdx: citeIdx - 1 } : {}),
    });
    edges.push(fcNewEdge(prev.id, n.id, prev.type === "decision" ? "yes" : ""));
    prev = n;
  });
  const end = addStep("end", "End");
  edges.push(fcNewEdge(prev.id, end.id, prev.type === "decision" ? "yes" : ""));
  return { nodes: fcAutoLayout(nodes, edges), edges, isDraft: true };
}

/* ── Export helpers ── */
function fcEsc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function fcBounds(nodes, pad = 60) {
  if (!nodes.length) return { x: 0, y: 0, w: 800, h: 600 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of nodes) {
    x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y);
    x1 = Math.max(x1, n.x + n.w); y1 = Math.max(y1, n.y + n.h);
  }
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
}
/* Standalone file default only: an exported SVG that leaves the app
   cannot read a live palette, so fcSvgString keeps these literal
   values as its fallback. Every in app export passes palette colors
   instead (fcPaletteColors, M38, 2026-10-19). */
const FC_EXPORT_COLORS = {
  bg: "#ffffff", fill: "#f6f7f6", stroke: "#232723", text: "#161916",
  accent: "#2e7d52", accentText: "#ffffff", edge: "#5b625b", decisionFill: "#eef4ef",
};
/* The live palette as export colors, built from tokens only. */
function fcPaletteColors(P, accent, at) {
  return {
    bg: P.bg, fill: P.surface, stroke: P.ink2, text: P.ink,
    accent, accentText: at, edge: P.faint, decisionFill: withAlpha(accent, 0.14),
  };
}
function fcNodeSvg(n, colors) {
  const C = colors || FC_EXPORT_COLORS;
  const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
  const lines = fcWrap(n.label, Math.max(8, Math.floor((n.w - 30) / 7)));
  const lh = 16;
  const ty = cy - ((lines.length - 1) * lh) / 2 + 5;
  const isAccent = n.type === "start" || n.type === "end";
  const textFill = isAccent ? C.accentText : C.text;
  const text = lines.map((ln, i) => `<text x="${cx}" y="${(ty + i * lh).toFixed(1)}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="13" font-weight="500" fill="${textFill}">${fcEsc(ln)}</text>`).join("");
  let shape = "";
  if (n.type === "start" || n.type === "end") {
    shape = `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${n.h / 2}" fill="${C.accent}"/>`;
  } else if (n.type === "decision") {
    shape = `<polygon points="${cx},${n.y} ${n.x + n.w},${cy} ${cx},${n.y + n.h} ${n.x},${cy}" fill="${C.decisionFill}" stroke="${C.accent}" stroke-width="1.6"/>`;
  } else if (n.type === "io") {
    const s = 22;
    shape = `<polygon points="${n.x + s},${n.y} ${n.x + n.w},${n.y} ${n.x + n.w - s},${n.y + n.h} ${n.x},${n.y + n.h}" fill="${C.fill}" stroke="${C.stroke}" stroke-width="1.5"/>`;
  } else if (n.type === "evidence") {
    shape = `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="10" fill="${C.fill}" stroke="${C.accent}" stroke-width="1.6"/><rect x="${n.x}" y="${n.y}" width="5" height="${n.h}" rx="2.5" fill="${C.accent}"/>`;
  } else {
    shape = `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="10" fill="${C.fill}" stroke="${C.stroke}" stroke-width="1.5"/>`;
  }
  return `<g>${shape}${text}</g>`;
}
function fcSvgString(nodes, edges, title, colors) {
  const C = colors || FC_EXPORT_COLORS;
  const b = fcBounds(nodes);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edgeSvg = edges.map((e) => {
    const a = byId.get(e.from), bb = byId.get(e.to);
    if (!a || !bb) return "";
    const g = fcEdgeGeom(a, bb);
    const lbl = e.label ? `<text x="${g.mx}" y="${(g.my - 7).toFixed(1)}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="11" font-style="italic" fill="${C.edge}">${fcEsc(e.label)}</text>` : "";
    return `<path d="${g.d}" fill="none" stroke="${C.edge}" stroke-width="1.6" marker-end="url(#fcArrow)"/>${lbl}`;
  }).join("");
  const nodeSvg = nodes.map((n) => fcNodeSvg(n, C)).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(b.w)}" height="${Math.ceil(b.h)}" viewBox="${b.x} ${b.y} ${b.w} ${b.h}"><title>${fcEsc(title || "Flowchart")}</title><defs><marker id="fcArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" fill="${C.edge}"/></marker></defs><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${C.bg}"/>${edgeSvg}${nodeSvg}</svg>`;
}
function fcToMarkdown(nodes, edges, title) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map(nodes.map((n) => [n.id, []]));
  const incoming = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of edges) {
    if (e.from !== e.to && byId.has(e.from) && byId.has(e.to)) {
      out.get(e.from).push(e);
      incoming.set(e.to, incoming.get(e.to) + 1);
    }
  }
  const roots = nodes.filter((n) => incoming.get(n.id) === 0);
  const startNodes = roots.length ? roots : nodes.slice(0, 1);
  const lines = [`# ${title || "Flowchart"}`, ""];
  const seen = new Set();
  const tag = { start: "Start", end: "End", decision: "Decision", io: "Input/Output", evidence: "Evidence", process: "Step" };
  const walk = (n, depth, viaLabel) => {
    if (!n) return;
    if (seen.has(n.id)) { lines.push(`${"  ".repeat(depth)}- ↺ *${n.label}* (see above)`); return; }
    seen.add(n.id);
    lines.push(`${"  ".repeat(depth)}- ${viaLabel ? `*${viaLabel}* → ` : ""}**${tag[n.type] || "Step"}:** ${n.label}`);
    for (const e of out.get(n.id)) walk(byId.get(e.to), depth + 1, e.label);
  };
  startNodes.forEach((n) => walk(n, 0, ""));
  return lines.join("\n");
}

/* Mini static preview for Library cards. */
function FcThumb({ chart, accent }) {
  const nodes = chart.nodes || [];
  if (!nodes.length) return null;
  const b = fcBounds(nodes, 30);
  const scale = Math.min(1, 280 / b.w, 120 / b.h);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return (
    <svg viewBox={`${b.x} ${b.y} ${b.w} ${b.h}`} style={{ width: "100%", height: 96, display: "block", background: withAlpha(accent, 0.06), borderRadius: RADIUS.md }}>
      {(chart.edges || []).map((e) => {
        const a = byId.get(e.from), bb = byId.get(e.to);
        if (!a || !bb) return null;
        const g = fcEdgeGeom(a, bb);
        return <path key={e.id} d={g.d} fill="none" stroke={accent} strokeWidth={3} opacity={0.45} />;
      })}
      {nodes.map((n) => {
        const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
        const fill = n.type === "start" || n.type === "end" ? accent : n.type === "decision" ? withAlpha(accent, 0.35) : withAlpha(accent, 0.14);
        if (n.type === "decision") return <polygon key={n.id} points={`${cx},${n.y} ${n.x + n.w},${cy} ${cx},${n.y + n.h} ${n.x},${cy}`} fill={fill} />;
        if (n.type === "io") { const s = 22; return <polygon key={n.id} points={`${n.x + s},${n.y} ${n.x + n.w},${n.y} ${n.x + n.w - s},${n.y + n.h} ${n.x},${n.y + n.h}`} fill={fill} />; }
        return <rect key={n.id} x={n.x} y={n.y} width={n.w} height={n.h} rx={n.type === "start" || n.type === "end" ? n.h / 2 : 10} fill={fill} />;
      })}
    </svg>
  );
}


/* In-canvas node shape (JSX). Flat (H19, 2026-10-18): one solid fill,
   one hairline stroke, corners on the radius token. No gradient sheen,
   no drop shadow filter, no glow ring. Start and end keep their pill
   geometry because that shape is what makes them terminals. */
function FcNodeShape({ n, P, accent, selected, pending }) {
  const cx = n.w / 2, cy = n.h / 2;
  const isAccent = n.type === "start" || n.type === "end";
  /* Canvas values on palette tokens (M38, 2026-10-19): the regular
     node fill is P.surface and its stroke is P.line2, so switching
     palettes restyles the canvas with the chrome. */
  const fill = isAccent ? accent : n.type === "decision" ? withAlpha(accent, 0.14) : n.type === "evidence" ? withAlpha(accent, 0.12) : P.surface;
  const stroke = selected ? accent : pending ? accent : isAccent ? accent : n.type === "decision" || n.type === "evidence" ? accent : P.line2;
  const sw = selected || pending ? 2.6 : 1.5;
  const shape = (() => {
    if (n.type === "decision") return <polygon points={`${cx},0 ${n.w},${cy} ${cx},${n.h} 0,${cy}`} />;
    if (n.type === "io") { const s = 20; return <polygon points={`${s},0 ${n.w},0 ${n.w - s},${n.h} 0,${n.h}`} />; }
    if (n.type === "evidence") return <rect x={0} y={0} width={n.w} height={n.h} rx={RADIUS.lg} />;
    return <rect x={0} y={0} width={n.w} height={n.h} rx={isAccent ? n.h / 2 : RADIUS.lg} />;
  })();
  return (
    <g>
      {selected && (
        <g opacity={0.55}>
          {n.type === "decision"
            ? <polygon points={`${cx},-7 ${n.w + 7},${cy} ${cx},${n.h + 7} -7,${cy}`} fill="none" stroke={accent} strokeWidth={2.4} />
            : <rect x={-7} y={-7} width={n.w + 14} height={n.h + 14} rx={(isAccent ? n.h / 2 : RADIUS.lg) + 7} fill="none" stroke={accent} strokeWidth={2.4} />}
        </g>
      )}
      {React.cloneElement(shape, { fill, stroke, strokeWidth: sw })}
      {n.type === "evidence" && <rect x={0} y={0} width={5} height={n.h} rx={RADIUS.lg} fill={accent} stroke="none" pointerEvents="none" />}
    </g>
  );
}


/* ══════════════════════════════════════════════════════════════════
   Diagram Studio

   One studio, one model: an ordered list of steps shown as a chain
   of boxes with arrows. Steps carry a label, a kind, the full source
   text as detail, and a source index when the step came from a
   paper. Labels taken from an answer or a paper go through the
   fcLabel helpers, which only delete words from the source text
   and never invent new ones.
   ══════════════════════════════════════════════════════════════════ */

function dsCoerceType(t) {
  return t === "decision" || t === "evidence" ? t : "process";
}

function dsStepFromNode(n) {
  return {
    id: n.id || fcId("s"),
    label: n.label || "",
    type: dsCoerceType(n.type),
    detail: n.detail || "",
    sourceIdx: typeof n.sourceIdx === "number" ? n.sourceIdx : undefined,
  };
}

/* Order chart nodes along their edges from a root, a node with no
   incoming edge. Anything the walk cannot reach falls back to
   sorting by y then x. Start and end nodes are skipped. */
function dsStepsFromChart(chart) {
  if (!chart || !Array.isArray(chart.nodes)) return [];
  const all = chart.nodes.filter((n) => n && n.id);
  const edges = Array.isArray(chart.edges) ? chart.edges : [];
  const byId = new Map(all.map((n) => [n.id, n]));
  const incoming = new Set();
  const outMap = new Map();
  for (const e of edges) {
    if (!e || !byId.has(e.from) || !byId.has(e.to)) continue;
    incoming.add(e.to);
    if (!outMap.has(e.from)) outMap.set(e.from, []);
    outMap.get(e.from).push(e.to);
  }
  const byPos = (a, b) => (a.y || 0) - (b.y || 0) || (a.x || 0) - (b.x || 0);
  const roots = all.filter((n) => !incoming.has(n.id)).sort(byPos);
  const ordered = [];
  const visited = new Set();
  const visit = (startId) => {
    const stack = [startId];
    while (stack.length) {
      const id = stack.shift();
      if (!id || visited.has(id)) continue;
      visited.add(id);
      const node = byId.get(id);
      if (!node) continue;
      ordered.push(node);
      const outs = outMap.get(id) || [];
      for (const outId of outs) if (!visited.has(outId)) stack.push(outId);
    }
  };
  for (const root of roots) visit(root.id);
  const rest = all.filter((n) => !visited.has(n.id)).sort(byPos);
  for (const n of rest) ordered.push(n);
  return ordered
    .filter((n) => n.type !== "start" && n.type !== "end")
    .map(dsStepFromNode);
}

function dsStepsFromDraft(draft) {
  if (!draft || !Array.isArray(draft.nodes)) return [];
  return dsStepsFromChart(draft);
}

/* Turn steps into the node and edge chain the canvas and the
   exports share. Node ids and edge ids are built from the step
   ids and the position in the chain, so they stay steady while
   the steps stay the same. */
function dsBuild(steps, direction) {
  const nodes = steps.map((step, i) => {
    const x = direction === "across" ? 40 + i * 300 : 420;
    const y = direction === "across" ? 140 : 40 + i * 196;
    const extra = {};
    if (step.detail) extra.detail = step.detail;
    if (typeof step.sourceIdx === "number") extra.sourceIdx = step.sourceIdx;
    const node = fcNewNode(dsCoerceType(step.type), x, y, step.label || "", extra);
    node.id = "dsn-" + step.id;
    return node;
  });
  const edges = [];
  for (let i = 0; i + 1 < nodes.length; i += 1) {
    const edge = fcNewEdge(nodes[i].id, nodes[i + 1].id, "");
    edge.id = "dse-" + i;
    edges.push(edge);
  }
  return { nodes, edges };
}

function dsPaperText(paper) {
  if (!paper) return "";
  return paper.abstract || paper.summary || paper.snippet || "";
}

export function DiagramStudio({ P, accent, at, isMobile, dialog = false, initial = null, docTitle = "", answerText = "", sources = [], latestAnswer = null, savedPapers = [], diagrams = [], onSave = null, onClose = null }) {
  const bootRef = useRef(null);
  if (bootRef.current === null) {
    const propSources = Array.isArray(sources) ? sources : [];
    let bootSteps = [];
    let bootTitle = "";
    let bootId = null;
    let bootSources = propSources;
    let bootMode = "write";
    let bootUsedAnswer = false;
    if (initial && Array.isArray(initial.nodes)) {
      bootSteps = dsStepsFromChart(initial);
      bootTitle = initial.title || docTitle || "";
      bootId = initial.id || null;
      bootMode = "saved";
      if (!propSources.length && Array.isArray(initial.sources)) bootSources = initial.sources;
    } else if (answerText) {
      bootSteps = dsStepsFromDraft(fcDraftFromAnswer(answerText, propSources));
      bootTitle = docTitle || "";
      bootMode = "answer";
      bootUsedAnswer = true;
    }
    bootRef.current = { steps: bootSteps, title: bootTitle, id: bootId, sources: bootSources, mode: bootMode, usedAnswer: bootUsedAnswer };
  }
  const boot = bootRef.current;

  const [steps, setSteps] = useState(boot.steps);
  const [title, setTitle] = useState(boot.title);
  const [currentId, setCurrentId] = useState(boot.id);
  const [activeSources, setActiveSources] = useState(boot.sources);
  const [mode, setMode] = useState(boot.mode);
  const [direction, setDirection] = useState("down");
  const [selectedId, setSelectedId] = useState(boot.steps.length ? boot.steps[0].id : null);
  const [writeText, setWriteText] = useState(boot.steps.map((s) => s.label).join("\n"));
  const [paperPick, setPaperPick] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [saveState, setSaveState] = useState("idle");

  const built = dsBuild(steps, direction);
  const nodes = built.nodes;
  const edges = built.edges;
  const bounds = fcBounds(nodes, 48);
  const selectedStep = steps.find((s) => s.id === selectedId) || null;
  const selectedSource = selectedStep && typeof selectedStep.sourceIdx === "number" && Array.isArray(activeSources)
    ? activeSources[selectedStep.sourceIdx] || null
    : null;
  const eligiblePapers = (Array.isArray(savedPapers) ? savedPapers : []).filter((paper) => dsPaperText(paper));

  const applySteps = (next) => {
    setSteps(next);
    setWriteText(next.map((s) => s.label).join("\n"));
    setSaveState("idle");
  };

  const loadSteps = (next, nextTitle, nextSources, nextId, nextMode) => {
    applySteps(next);
    if (typeof nextTitle === "string") setTitle(nextTitle);
    if (Array.isArray(nextSources)) setActiveSources(nextSources);
    setCurrentId(nextId || null);
    setSelectedId(next.length ? next[0].id : null);
    if (nextMode) setMode(nextMode);
    setExportOpen(false);
  };

  const loadLatest = () => {
    if (!latestAnswer) return;
    const latestSources = Array.isArray(latestAnswer.sources) ? latestAnswer.sources : [];
    const next = dsStepsFromDraft(fcDraftFromAnswer(latestAnswer.answerText || "", latestSources));
    loadSteps(next, latestAnswer.title || "", latestSources, null, "answer");
  };

  const loadPaper = (paper) => {
    const text = dsPaperText(paper);
    const next = fcExtractSteps(text, 7).map((st) => ({
      id: fcId("s"),
      label: fcCompressStep(st.text),
      type: "process",
      detail: st.text,
      sourceIdx: 0,
    }));
    loadSteps(next, paper.title || "", [paper], null, "paper");
  };

  const loadDiagram = (chart) => {
    const next = dsStepsFromChart(chart);
    loadSteps(next, chart.title || "", Array.isArray(chart.sources) ? chart.sources : activeSources, chart.id || null, "saved");
  };

  const onWriteChange = (e) => {
    const raw = e.target.value;
    setWriteText(raw);
    const lines = raw.split("\n").filter((line) => line.trim().length > 0);
    const next = lines.map((line, i) => {
      if (steps[i]) return { ...steps[i], label: line };
      return { id: fcId("s"), label: line, type: "process", detail: "", sourceIdx: undefined };
    });
    setSteps(next);
    setSaveState("idle");
    if (selectedId && !next.some((s) => s.id === selectedId)) setSelectedId(next.length ? next[0].id : null);
  };

  const updateStep = (id, patch) => {
    const next = steps.map((s) => (s.id === id ? { ...s, ...patch } : s));
    applySteps(next);
  };

  const deleteStep = (id) => {
    const next = steps.filter((s) => s.id !== id);
    applySteps(next);
    if (selectedId === id) setSelectedId(next.length ? next[0].id : null);
  };

  const addStep = () => {
    const step = { id: fcId("s"), label: "", type: "process", detail: "", sourceIdx: undefined };
    const next = [...steps, step];
    applySteps(next);
    setSelectedId(step.id);
  };

  const doSave = async () => {
    const fresh = dsBuild(steps, direction);
    setSaveState("saving");
    try {
      let result;
      if (onSave) {
        result = await onSave({ id: currentId, title: title.trim() || "Diagram", nodes: fresh.nodes, edges: fresh.edges, sources: activeSources });
      }
      if (result === false) {
        setSaveState("blocked");
        return;
      }
      /* The app save handler returns the saved diagram id as a
         string; an object with an id is adopted the same way, so a
         second save updates the same record instead of metering a
         new diagram. */
      if (typeof result === "string" && result) setCurrentId(result);
      else if (result && typeof result === "object" && result.id) setCurrentId(result.id);
      setSaveState("saved");
    } catch (dsErr) {
      setSaveState("blocked");
    }
  };

  const exportColors = () => fcPaletteColors(P, accent, at);

  const doExportSVG = () => {
    const fresh = dsBuild(steps, direction);
    download(fcSlug(title) + ".svg", fcSvgString(fresh.nodes, fresh.edges, title, exportColors()));
    setExportOpen(false);
  };

  const doExportPNG = () => {
    const fresh = dsBuild(steps, direction);
    const svg = fcSvgString(fresh.nodes, fresh.edges, title, exportColors());
    const b = fcBounds(fresh.nodes);
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    const img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); setExportOpen(false); toast("Export failed. Try again.", { tone: "error" }); };
    img.onload = () => {
      try {
        const scale = 2;
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.ceil(b.w * scale));
        canvas.height = Math.max(1, Math.ceil(b.h * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("canvas unavailable");
        ctx.fillStyle = P.bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          setExportOpen(false);
          if (blob) {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = fcSlug(title) + ".png";
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 4000);
          } else {
            toast("Export failed. Try again.", { tone: "error" });
          }
        });
      } catch (dsErr) {
        URL.revokeObjectURL(url);
        setExportOpen(false);
        toast("Export failed. Try again.", { tone: "error" });
      }
    };
    img.src = url;
  };

  const doExportText = () => {
    const fresh = dsBuild(steps, direction);
    download(fcSlug(title) + ".md", fcToMarkdown(fresh.nodes, fresh.edges, title));
    setExportOpen(false);
  };

  const btnStyle = {
    minHeight: 44, padding: "0 14px", borderRadius: RADIUS.sm, cursor: "pointer",
    background: "transparent", color: P.ink, border: `1px solid ${P.line2}`,
    fontSize: FONT_SIZES.label, fontWeight: 500, fontFamily: "var(--cb-font)",
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, whiteSpace: "nowrap",
  };
  const tabStyle = (active) => ({
    ...btnStyle,
    background: active ? withAlpha(accent, 0.14) : "transparent",
    border: `1px solid ${active ? accent : P.line2}`,
    color: P.ink,
  });
  const fieldStyle = {
    boxSizing: "border-box", background: P.bg, border: `1px solid ${P.line}`,
    borderRadius: RADIUS.md, color: P.ink, padding: "8px 12px",
    fontSize: FONT_SIZES.body, fontFamily: "var(--cb-font)",
  };

  const selectedDoi = selectedSource ? (selectedSource.doi || "") : "";
  const selectedHref = selectedSource
    ? safeHref(selectedSource.url || (selectedDoi ? (String(selectedDoi).startsWith("http") ? selectedDoi : "https://doi.org/" + selectedDoi) : ""))
    : "#";

  const content = (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, fontFamily: "var(--cb-font)", color: P.ink }}>
      {/* Header block */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {!dialog && (
          <div style={{ fontSize: FONT_SIZES.section, fontWeight: 500, color: P.ink, lineHeight: 1.3 }}>Diagram Studio</div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <input
            value={title}
            onChange={(e) => { setTitle(e.target.value); setSaveState("idle"); }}
            placeholder="Diagram title"
            aria-label="Diagram title"
            style={{ ...fieldStyle, flex: "1 1 180px", minWidth: 0, background: P.surface }}
          />
          <div role="group" aria-label="Direction" style={{ display: "inline-flex", border: `1px solid ${P.line2}`, borderRadius: RADIUS.sm, padding: 3, gap: 2 }}>
            <button type="button" aria-pressed={direction === "down"}
              onClick={() => { setDirection("down"); setSaveState("idle"); }}
              style={{ minHeight: 38, padding: "0 14px", borderRadius: RADIUS.sm, border: "none", cursor: "pointer", fontSize: FONT_SIZES.label, fontWeight: 500, fontFamily: "var(--cb-font)", background: direction === "down" ? accent : "transparent", color: direction === "down" ? at : P.ink }}>
              Down
            </button>
            <button type="button" aria-pressed={direction === "across"}
              onClick={() => { setDirection("across"); setSaveState("idle"); }}
              style={{ minHeight: 38, padding: "0 14px", borderRadius: RADIUS.sm, border: "none", cursor: "pointer", fontSize: FONT_SIZES.label, fontWeight: 500, fontFamily: "var(--cb-font)", background: direction === "across" ? accent : "transparent", color: direction === "across" ? at : P.ink }}>
              Across
            </button>
          </div>
          <div style={{ position: "relative" }}>
            <button type="button" onClick={() => setExportOpen((v) => !v)} aria-expanded={exportOpen} style={btnStyle}>
              Export
            </button>
            {exportOpen && (
              <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 20, display: "flex", flexDirection: "column", gap: 6, padding: 8, background: P.surface, border: `1px solid ${P.line}`, borderRadius: RADIUS.md, minWidth: 160 }}>
                <button type="button" onClick={doExportSVG} style={btnStyle}>SVG</button>
                <button type="button" onClick={doExportPNG} style={btnStyle}>PNG</button>
                <button type="button" onClick={doExportText} style={btnStyle}>Text outline</button>
              </div>
            )}
          </div>
          <button type="button" onClick={doSave} disabled={saveState === "saving"}
            style={{ ...btnStyle, background: accent, color: at, border: `1px solid ${accent}`, opacity: saveState === "saving" ? 0.6 : 1 }}>
            Save
          </button>
          {dialog && onClose && (
            <button type="button" onClick={onClose} style={btnStyle}>Close</button>
          )}
        </div>
        <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, lineHeight: 1.4 }}>
          Free accounts can save 1 diagram every 5 days.
        </div>
        {saveState === "saving" && (
          <div style={{ fontSize: FONT_SIZES.body, color: P.ink2 }}>Saving</div>
        )}
        {saveState === "saved" && (
          <div style={{ fontSize: FONT_SIZES.body, color: accent, fontWeight: 500 }}>Saved</div>
        )}
        {saveState === "blocked" && (
          <div style={{ fontSize: FONT_SIZES.body, color: P.ink2 }}>
            Save did not go through. Check that you are signed in and that your plan still has room.
          </div>
        )}
      </div>

      {/* Source choices */}
      {!dialog && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" aria-pressed={mode === "write"} onClick={() => { setMode("write"); setWriteText(steps.map((s) => s.label).join("\n")); }} style={tabStyle(mode === "write")}>
              Write it
            </button>
            <button type="button" aria-pressed={mode === "answer"} disabled={!latestAnswer}
              onClick={loadLatest}
              style={{ ...tabStyle(mode === "answer"), opacity: latestAnswer ? 1 : 0.5, cursor: latestAnswer ? "pointer" : "not-allowed" }}>
              From your last answer
            </button>
            <button type="button" aria-pressed={mode === "paper"} onClick={() => setMode("paper")} style={tabStyle(mode === "paper")}>
              From a saved paper
            </button>
            <button type="button" aria-pressed={mode === "saved"} onClick={() => setMode("saved")} style={tabStyle(mode === "saved")}>
              Saved diagrams
            </button>
          </div>
          {mode === "paper" && (
            <select
              aria-label="Saved paper"
              value={paperPick}
              onChange={(e) => {
                setPaperPick(e.target.value);
                const paper = eligiblePapers[Number(e.target.value)];
                if (paper) loadPaper(paper);
              }}
              style={{ ...fieldStyle, width: "100%", background: P.surface }}
            >
              <option value="">Choose a paper</option>
              {eligiblePapers.map((paper, i) => (
                <option key={paper.id || paper.title || i} value={i}>{paper.title || "Untitled"}</option>
              ))}
            </select>
          )}
          {mode === "saved" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {diagrams.length === 0 && (
                <div style={{ fontSize: FONT_SIZES.body, color: P.faint }}>No saved diagrams yet.</div>
              )}
              {diagrams.map((chart, i) => {
                const count = dsStepsFromChart(chart).length;
                return (
                  <button key={chart.id || chart.title || i} type="button" onClick={() => loadDiagram(chart)}
                    style={{ ...btnStyle, justifyContent: "flex-start" }}>
                    {`${chart.title || "Diagram"} · ${count} step${count === 1 ? "" : "s"}`}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
      {dialog && (
        <div style={{ fontSize: FONT_SIZES.label, color: P.faint, lineHeight: 1.5 }}>
          {boot.usedAnswer
            ? "Diagram from this answer. Check each box before you save it."
            : initial
              ? `Reopened diagram: ${initial.title || title || "Diagram"}`
              : "Add steps below. Check each box before you save it."}
        </div>
      )}

      {/* Main area */}
      <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 16, alignItems: "stretch" }}>
        <div style={{ flex: "1 1 auto", minWidth: 0, background: P.surface, border: `1px solid ${P.line}`, borderRadius: RADIUS.lg, padding: 12, overflow: "auto" }}>
          {steps.length === 0 ? (
            <div style={{ fontSize: FONT_SIZES.body, color: P.faint, lineHeight: 1.55, padding: 12 }}>
              Add a step to start the diagram.
            </div>
          ) : (
            <svg viewBox={`${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`} width="100%" style={{ display: "block" }} role="img" aria-label={title || "Diagram"}>
              <defs>
                <marker id="dsArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M 0 1 L 9 5 L 0 9 z" fill={P.faint} />
                </marker>
              </defs>
              {edges.map((e) => {
                const a = fcNodeById(nodes, e.from);
                const b = fcNodeById(nodes, e.to);
                if (!a || !b) return null;
                const g = fcEdgeGeom(a, b);
                return <path key={e.id} d={g.d} fill="none" stroke={P.faint} strokeWidth={1.6} markerEnd="url(#dsArrow)" />;
              })}
              {nodes.map((n, i) => {
                const step = steps[i];
                if (!step) return null;
                const lines = fcWrap(n.label || "", 24);
                const lineHeight = 18;
                const startY = n.h / 2 - ((lines.length - 1) * lineHeight) / 2 + 5;
                return (
                  <g key={n.id} transform={`translate(${n.x} ${n.y})`} onClick={() => setSelectedId(step.id)} style={{ cursor: "pointer" }}>
                    <FcNodeShape n={n} P={P} accent={accent} selected={selectedId === step.id} />
                    <text x={n.w / 2} y={startY} textAnchor="middle" fontSize={14} fill={P.ink} fontFamily="var(--cb-font)" fontWeight={500}>
                      {lines.map((ln, li) => (
                        <tspan key={li} x={n.w / 2} dy={li === 0 ? 0 : lineHeight}>{ln}</tspan>
                      ))}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>

        <div style={{ width: isMobile ? "auto" : 340, flexShrink: 0, background: P.surface, border: `1px solid ${P.line}`, borderRadius: RADIUS.lg, padding: 14 }}>
          {mode === "write" ? (
            <div>
              <label htmlFor="dsWriteSteps" style={{ display: "block", fontSize: FONT_SIZES.label, fontWeight: 500, color: P.ink, marginBottom: 8 }}>
                Your steps, one per line
              </label>
              <textarea
                id="dsWriteSteps"
                value={writeText}
                onChange={onWriteChange}
                rows={10}
                style={{ ...fieldStyle, width: "100%", resize: "vertical", lineHeight: 1.55 }}
              />
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {steps.map((step, i) => (
                <div key={step.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: FONT_SIZES.body, color: P.faint, minWidth: 22, textAlign: "right" }}>{i + 1}</span>
                  <input
                    value={step.label}
                    onChange={(e) => updateStep(step.id, { label: e.target.value })}
                    aria-label={`Step ${i + 1} label`}
                    style={{ ...fieldStyle, flex: "1 1 auto", minWidth: 0, fontSize: 16, background: P.surface }}
                  />
                  <select
                    value={step.type}
                    onChange={(e) => updateStep(step.id, { type: e.target.value })}
                    aria-label={`Step ${i + 1} kind`}
                    style={{ ...fieldStyle, flexShrink: 0, fontSize: 16, background: P.surface }}
                  >
                    <option value="process">Step</option>
                    <option value="decision">Decision</option>
                    <option value="evidence">Evidence</option>
                  </select>
                  <button type="button" onClick={() => deleteStep(step.id)} aria-label={`Delete step ${i + 1}`} style={{ ...btnStyle, flexShrink: 0 }}>
                    Delete
                  </button>
                </div>
              ))}
              <button type="button" onClick={addStep} style={{ ...btnStyle, alignSelf: "flex-start" }}>
                Add step
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Selected step detail */}
      {selectedStep && (selectedStep.detail || selectedSource) && (
        <div style={{ background: P.surface, border: `1px solid ${P.line}`, borderRadius: RADIUS.lg, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          {selectedStep.detail && (
            <div style={{ fontSize: FONT_SIZES.body, color: P.ink, lineHeight: 1.55 }}>{selectedStep.detail}</div>
          )}
          {selectedSource && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ fontSize: FONT_SIZES.body, fontWeight: 500, color: P.ink }}>{selectedSource.title || "Untitled"}</div>
              {(selectedSource.year || selectedSource.journal || selectedSource.source) && (
                <div style={{ fontSize: FONT_SIZES.label, color: P.faint }}>
                  {[selectedSource.year, selectedSource.journal || selectedSource.source].filter(Boolean).join(" · ")}
                </div>
              )}
              {(selectedSource.url || selectedSource.doi) && (
                <a href={selectedHref} target="_blank" rel="noreferrer" style={{ fontSize: FONT_SIZES.label, color: accent, fontWeight: 500 }}>
                  Open the paper
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );

  if (dialog) {
    return (
      <Dialog label="Diagram Studio" onClose={onClose || (() => {})} width={1240} panelStyle={{ background: P.surface, color: P.ink }}>
        <div style={{ overflowY: "auto", padding: 20, minHeight: 0 }}>
          {content}
        </div>
      </Dialog>
    );
  }

  return (
    <div style={{ padding: isMobile ? 16 : 24, background: P.bg, color: P.ink, fontFamily: "var(--cb-font)" }}>
      {content}
    </div>
  );
}


function ChromeHeader({ eyebrow, title, onClose, accent, label, drawer = false, P = null }) {
  // P provided (drawers and themed centered panels) → theme-aware
  // ink; otherwise the dark instrument treatment of media surfaces.
  const ink = P ? P.ink : "#f2f4f2";
  const subInk = P ? P.ink2 : "rgba(242,244,242,0.75)";
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 8,
      ...(drawer ? { borderLeft: `2px solid ${withAlpha(accent, 0.55)}`, paddingLeft: 14 } : null),
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {eyebrow && (
          <div style={{
            fontFamily: "var(--cb-font)", fontSize: FONT_SIZES.caption, fontWeight: 500,
            letterSpacing: "normal", textTransform: "none",
            color: withAlpha(accent, 0.9), marginBottom: 5,
          }}>{eyebrow}</div>
        )}
        {title ? (
        <div style={{
          fontSize: FONT_SIZES.subhead, fontWeight: 500, color: ink,
          letterSpacing: "-0.015em", lineHeight: 1.3, fontFamily: "var(--cb-font)",
        }}>{title}</div>
        ) : null}
      </div>
      <UIButton P={P} variant="ghost"
        onClick={onClose}
        aria-label={label || title ? "Close " + (label || title) : "Close"}
        /* 44px hit area; the visible 30px circle is drawn by the inner
           span so the touch target meets the minimum without changing
           the chrome's look. */
        style={{
          border: "none", background: "transparent",
          color: subInk, cursor: "pointer", borderRadius: RADIUS.sm,
          width: 44, height: 44, display: "inline-flex", alignItems: "center",
          justifyContent: "center", flexShrink: 0, padding: 0,
        }}
      >
        <span
          style={{
            border: `1px solid ${P ? P.line : "rgba(255,255,255,0.12)"}`,
            background: P ? "transparent" : "rgba(255,255,255,0.05)",
            borderRadius: RADIUS.sm, width: 30, height: 30, display: "inline-flex",
            alignItems: "center", justifyContent: "center", fontSize: 16,
            lineHeight: 1, fontFamily: "var(--cb-font)",
            transition: "background 150ms ease",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = P ? withAlpha(accent, 0.1) : "rgba(255,255,255,0.12)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = P ? "transparent" : "rgba(255,255,255,0.05)"; }}
        >×</span>
      </UIButton>
    </div>
  );
}

function ModalChrome({ label, eyebrow, title, actions, onClose, accent, zIndex = 220, width = 640, ticks = false, tall = false, drawer = false, media = false, P = null, children }) {
  // Panels that carry text follow the active palette: drawers read
  // P.bg, centered panels read P.surface, both with the palette's own
  // ink and line. Only media surfaces keep the deliberate dark
  // instrument treatment, and they opt in with the media flag (the
  // citation network and the literature arc force a dark palette for
  // their bodies in every theme). Until 2026-10-14 every centered
  // panel was hard coded #0f1115 in every palette, Light included,
  // while the drawers beside them honored the theme. A caller that
  // forgets the palette entirely gets the Dialog default's own
  // treatment (the --cb-surface variable with its system surface
  // fallback #1c1b19, and the matching ink and line variables), never the
  // near black constant: only the media flag earns that now.
  const themed = !!P && !media;
  const panelBg = media ? "#0f1115" : drawer && P ? P.bg : themed ? P.surface : "var(--cb-surface, #1c1b19)";
  const panelInk = media ? "#f2f4f2" : P ? P.ink : "var(--cb-ink, #f4f4f2)";
  const panelBorder = media ? "rgba(255,255,255,0.10)" : P ? P.line : "var(--cb-line, rgba(255,255,255,0.12))";
  return (
    <Dialog
      label={label || title} onClose={onClose} zIndex={zIndex} drawer={drawer}
      width={width} panelClassName={ticks ? "cb-modal cb-specimen" : "cb-modal"}
      panelStyle={drawer ? {
        background: panelBg, borderLeft: `1px solid ${panelBorder}`,
        boxShadow: "none",
        padding: "24px 26px 48px", color: panelInk, fontFamily: "var(--cb-font)",
      } : {
        ...(tall ? { height: "min(760px, 86dvh)" } : {}),
        background: panelBg,
        border: `1px solid ${panelBorder}`, borderRadius: RADIUS.lg,
        boxShadow: "none",
        padding: "24px 22px 22px", color: panelInk, fontFamily: "var(--cb-font)",
      }}
    >
      <ChromeHeader eyebrow={eyebrow} title={title} onClose={onClose} accent={accent} label={label || title} drawer={drawer} P={drawer || themed ? P : null} />
      {actions && <div style={{ margin: "6px 0 14px" }}>{actions}</div>}
      <div style={{ minHeight: 0, flex: 1, display: "flex", flexDirection: "column" }}>{children}</div>
    </Dialog>
  );
}

export { ChromeHeader, ModalChrome };
export { fcId, mergeFlowcharts, fcSlug, fcSvgString };
