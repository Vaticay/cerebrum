/**
 * flowcharts.jsx — Flowchart Studio, Mermaid Studio, and Dialog primitive.
 *
 * Extracted from CerebrumApp.jsx (monolith split, 2026-10-07).
 * FlowchartStudio: SVG-based evidence map editor with pan/zoom, history.
 * MermaidStudio: mermaid.live-grade diagram editor with live preview.
 * Dialog: focus-trapped modal primitive used by both (and app-wide).
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { Icon, UIButton, withAlpha, FONT_SIZES, STATUS, Z, TRACKING } from "./designSystem.jsx";
import { getCookie, __cbMotionCache, cbMotionCacheSet, download } from "./appUtils.js";

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
let cbDialogLockDepth = 0;
let cbDialogSavedOverflow = "";
let cbDialogSavedPaddingRight = "";

function cbDialogLockScroll() {
  if (cbDialogLockDepth === 0) {
    try {
      cbDialogSavedOverflow = document.body.style.overflow;
      cbDialogSavedPaddingRight = document.body.style.paddingRight;
      const sw = window.innerWidth - document.documentElement.clientWidth;
      document.body.style.overflow = "hidden";
      if (sw > 0) document.body.style.paddingRight = `calc(${cbDialogSavedPaddingRight || "0px"} + ${sw}px)`;
    } catch (cbErr) { console.error("[Cerebrum] flowcharts.jsx cbDialogLockScroll:", cbErr); }
  }
  cbDialogLockDepth += 1;
}
function cbDialogUnlockScroll() {
  if (cbDialogLockDepth <= 0) return;
  cbDialogLockDepth -= 1;
  if (cbDialogLockDepth === 0) {
    try {
      document.body.style.overflow = cbDialogSavedOverflow;
      document.body.style.paddingRight = cbDialogSavedPaddingRight;
    } catch (cbErr) { console.error("[Cerebrum] flowcharts.jsx cbDialogUnlockScroll:", cbErr); }
  }
}

const CB_FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({
  label, labelledBy, onClose, children,
  width = 560, zIndex = 220, drawer = false,
  panelStyle = {}, scrimStyle = {},
  dismissable = true, initialFocus = null, panelClassName = "cb-modal",
  // Optional Escape override: called instead of onClose when the dialog is
  // topmost (e.g. FlowchartStudio dismisses its export menu first).
  onEscape = null,
}) {
  const panelRef = useRef(null);
  const idRef = useRef(null);
  if (idRef.current === null) idRef.current = "cbdlg-" + Math.random().toString(36).slice(2);
  const [entered, setEntered] = useState(false);
  const animate = !cbMotionOff();
  /* The key handler is registered once on mount (capture phase), but the
     callbacks it invokes must stay fresh — e.g. FlowchartStudio's onEscape
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
        transition: animate ? "opacity 200ms ease" : "none",
        ...scrimStyle,
      }}
    >
      <div
        ref={panelRef} tabIndex={-1}
        className={panelClassName}
        style={{
          ...basePanel,
          // The class brings the shared panel treatment; the keyframe
          // entrance is neutralized in favor of this state-driven one.
          animation: "none",
          opacity: animate ? (entered ? 1 : 0) : 1,
          transform: animate ? (entered ? "translateY(0) scale(1)" : "translateY(10px) scale(0.985)") : "none",
          transition: animate ? "opacity 200ms ease, transform 240ms cubic-bezier(0.16,1,0.3,1)" : "none",
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
const FC_EXPORT_COLORS = {
  bg: "#ffffff", fill: "#f6f7f6", stroke: "#232723", text: "#161916",
  accent: "#2e7d52", accentText: "#ffffff", edge: "#5b625b", decisionFill: "#eef4ef",
};
function fcNodeSvg(n) {
  const C = FC_EXPORT_COLORS;
  const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
  const lines = fcWrap(n.label, Math.max(8, Math.floor((n.w - 30) / 7)));
  const lh = 16;
  const ty = cy - ((lines.length - 1) * lh) / 2 + 5;
  const isAccent = n.type === "start" || n.type === "end";
  const textFill = isAccent ? C.accentText : C.text;
  const text = lines.map((ln, i) => `<text x="${cx}" y="${(ty + i * lh).toFixed(1)}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="13" fill="${textFill}">${fcEsc(ln)}</text>`).join("");
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
function fcSvgString(nodes, edges, title) {
  const C = FC_EXPORT_COLORS;
  const b = fcBounds(nodes);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edgeSvg = edges.map((e) => {
    const a = byId.get(e.from), bb = byId.get(e.to);
    if (!a || !bb) return "";
    const g = fcEdgeGeom(a, bb);
    const lbl = e.label ? `<text x="${g.mx}" y="${(g.my - 7).toFixed(1)}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="11" font-style="italic" fill="${C.edge}">${fcEsc(e.label)}</text>` : "";
    return `<path d="${g.d}" fill="none" stroke="${C.edge}" stroke-width="1.6" marker-end="url(#fcArrow)"/>${lbl}`;
  }).join("");
  const nodeSvg = nodes.map(fcNodeSvg).join("");
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
    <svg viewBox={`${b.x} ${b.y} ${b.w} ${b.h}`} style={{ width: "100%", height: 96, display: "block", background: "rgba(127,140,127,0.06)", borderRadius: 8 }}>
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

/* Small palette button showing the node shape. */
function FcPaletteBtn({ type, P, accent, selected, onClick, isMobile }) {
  const t = FC_NODE_TYPES[type];
  const isAccent = type === "start" || type === "end";
  const shape = (() => {
    if (type === "decision") return <polygon points="20,2 38,12 20,22 2,12" fill={isAccent ? accent : withAlpha(accent, 0.16)} stroke={accent} strokeWidth={1.4} />;
    if (type === "io") return <polygon points="8,3 34,3 30,21 4,21" fill={withAlpha(accent, 0.12)} stroke={P.faint} strokeWidth={1.4} />;
    if (type === "evidence") return (<g><rect x="3" y="3" width="34" height="18" rx="4" fill={withAlpha(accent, 0.10)} stroke={accent} strokeWidth={1.4} /><rect x="3" y="3" width="4" height="18" rx="2" fill={accent} /></g>);
    return <rect x="3" y="4" width="34" height="16" rx={isAccent ? 8 : 4} fill={isAccent ? accent : withAlpha(accent, 0.10)} stroke={isAccent ? accent : P.faint} strokeWidth={1.4} />;
  })();
  return (
    <button type="button" onClick={onClick} title={`Add ${t.name}: click to drop it on the canvas`}
      aria-label={`Add ${t.name} node`}
      style={{
        display: "flex", flexDirection: isMobile ? "row" : "column", alignItems: "center", gap: isMobile ? 7 : 5,
        padding: isMobile ? "8px 12px 8px 8px" : "10px 4px", borderRadius: 12, cursor: "pointer",
        background: selected ? withAlpha(accent, 0.12) : "transparent",
        border: `1px solid ${selected ? accent : "transparent"}`,
        transition: "background-color 0.15s ease, border-color 0.15s ease, transform 0.15s ease", flexShrink: 0,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = withAlpha(accent, 0.10); e.currentTarget.style.borderColor = withAlpha(accent, 0.35); e.currentTarget.style.transform = "translateY(-1px)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = selected ? withAlpha(accent, 0.12) : "transparent"; e.currentTarget.style.borderColor = selected ? accent : "transparent"; e.currentTarget.style.transform = "none"; }}>
      <svg width="40" height="24" viewBox="0 0 40 24" aria-hidden="true" style={{ filter: `drop-shadow(0 2px 4px ${withAlpha(accent, 0.25)})` }}>{shape}</svg>
      <span style={{ fontSize: 10, color: P.ink2, fontFamily: "var(--cb-font)", lineHeight: 1.2, textAlign: "center", fontWeight: 600 }}>{t.name}</span>
    </button>
  );
}

/* In-canvas node shape (JSX). Layered: base fill, top-light gradient sheen,
   soft drop shadow. Selected nodes get an accent glow ring.
   Redesigned pass: softer, deeper shadow; hairline 1.5px strokes; larger
   corner radii — the chrome gets out of the way of the terse labels. */
function FcNodeShape({ n, P, accent, selected, pending }) {
  const cx = n.w / 2, cy = n.h / 2;
  const isAccent = n.type === "start" || n.type === "end";
  const fill = isAccent ? accent : n.type === "decision" ? withAlpha(accent, 0.14) : n.type === "evidence" ? withAlpha(accent, 0.12) : (P.dark ? "rgba(255,255,255,0.055)" : "rgba(255,255,255,0.85)");
  const stroke = selected ? accent : pending ? accent : isAccent ? accent : n.type === "decision" || n.type === "evidence" ? accent : (P.dark ? "rgba(255,255,255,0.20)" : "rgba(20,30,20,0.24)");
  const sw = selected || pending ? 2.6 : 1.5;
  const shape = (() => {
    if (n.type === "decision") return <polygon points={`${cx},0 ${n.w},${cy} ${cx},${n.h} 0,${cy}`} />;
    if (n.type === "io") { const s = 20; return <polygon points={`${s},0 ${n.w},0 ${n.w - s},${n.h} 0,${n.h}`} />; }
    if (n.type === "evidence") return <rect x={0} y={0} width={n.w} height={n.h} rx={14} />;
    return <rect x={0} y={0} width={n.w} height={n.h} rx={isAccent ? n.h / 2 : 14} />;
  })();
  return (
    <g filter="url(#fcNodeShadow)">
      {selected && (
        <g opacity={0.55}>
          {n.type === "decision"
            ? <polygon points={`${cx},-7 ${n.w + 7},${cy} ${cx},${n.h + 7} -7,${cy}`} fill="none" stroke={accent} strokeWidth={2.4} />
            : <rect x={-7} y={-7} width={n.w + 14} height={n.h + 14} rx={(isAccent ? n.h / 2 : 14) + 7} fill="none" stroke={accent} strokeWidth={2.4} />}
        </g>
      )}
      {React.cloneElement(shape, { fill, stroke, strokeWidth: sw })}
      {React.cloneElement(shape, { fill: "url(#fcNodeGrad)", stroke: "none", pointerEvents: "none" })}
      {n.type === "evidence" && <rect x={0} y={0} width={5} height={n.h} rx={2.5} fill={accent} stroke="none" pointerEvents="none" />}
    </g>
  );
}

export function FlowchartStudio({ P, accent, at, isMobile, initial, docTitle, answerText, sources, onSave, onClose }) {
  /* Escape closes the studio. If the export menu is open, Escape dismisses
     it first — wired through Dialog's onEscape override so the primitive's
     topmost-only routing still owns the key. */
  const [exportOpen, setExportOpen] = useState(false);

  const [nodes, setNodes] = useState(() => (initial?.nodes || []).map((n) => ({ ...n })));
  const [edges, setEdges] = useState(() => (initial?.edges || []).map((e) => ({ ...e })));
  const [title, setTitle] = useState(docTitle || initial?.title || "Untitled evidence map");
  const [tool, setTool] = useState("select");
  const [selection, setSelection] = useState(null);
  const [pendingFrom, setPendingFrom] = useState(null);
  const [viewport, setViewport] = useState({ x: 40, y: 40, zoom: 1 });
  const [draftNotice, setDraftNotice] = useState(!!initial?.isDraft);
  const [savedFlash, setSavedFlash] = useState(false);
  const [, setHistTick] = useState(0);
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const panRef = useRef(null);
  const histRef = useRef({ stack: [], idx: -1 });
  const stateRef = useRef();
  stateRef.current = { nodes, edges };

  /* History */
  const snapshot = () => ({ nodes: stateRef.current.nodes.map((n) => ({ ...n })), edges: stateRef.current.edges.map((e) => ({ ...e })) });
  const pushHistory = useCallback(() => {
    const h = histRef.current;
    const stack = [...h.stack.slice(0, h.idx + 1), snapshot()].slice(-60);
    histRef.current = { stack, idx: stack.length - 1 };
    setHistTick((t) => t + 1);
  }, []);
  useEffect(() => { pushHistory(); /* seed with initial state */ }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const applySnap = (s) => {
    setNodes(s.nodes.map((n) => ({ ...n })));
    setEdges(s.edges.map((e) => ({ ...e })));
    setSelection(null);
    setPendingFrom(null);
  };
  const undo = () => {
    const h = histRef.current;
    if (h.idx <= 0) return;
    histRef.current = { ...h, idx: h.idx - 1 };
    applySnap(h.stack[h.idx - 1]);
    setHistTick((t) => t + 1);
  };
  const redo = () => {
    const h = histRef.current;
    if (h.idx >= h.stack.length - 1) return;
    histRef.current = { ...h, idx: h.idx + 1 };
    applySnap(h.stack[h.idx + 1]);
    setHistTick((t) => t + 1);
  };
  const canUndo = histRef.current.idx > 0;
  const canRedo = histRef.current.idx < histRef.current.stack.length - 1;

  /* Coordinate transform */
  const toWorld = (clientX, clientY) => {
    const r = svgRef.current.getBoundingClientRect();
    return { x: (clientX - r.left - viewport.x) / viewport.zoom, y: (clientY - r.top - viewport.y) / viewport.zoom };
  };

  /* Wheel zoom (non-passive so we can preventDefault) */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      setViewport((v) => {
        const z2 = Math.min(2.5, Math.max(0.3, v.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
        const wx = (mx - v.x) / v.zoom, wy = (my - v.y) / v.zoom;
        return { zoom: z2, x: mx - wx * z2, y: my - wy * z2 };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  /* Mutations (each commits to history) */
  const addNode = (type) => {
    const r = svgRef.current.getBoundingClientRect();
    const wx = (r.width / 2 - viewport.x) / viewport.zoom;
    const wy = (r.height / 2 - viewport.y) / viewport.zoom;
    const t = FC_NODE_TYPES[type];
    const n = fcNewNode(type, wx - t.w / 2 + (Math.random() * 40 - 20), wy - t.h / 2 + (Math.random() * 40 - 20));
    setNodes((prev) => [...prev, n]);
    setSelection({ kind: "node", id: n.id });
    setTimeout(pushHistory, 0);
  };
  const updateNode = (id, patch, commit = true) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
    if (commit) setTimeout(pushHistory, 0);
  };
  const deleteSelection = useCallback(() => {
    if (!selection) return;
    if (selection.kind === "node") {
      setNodes((prev) => prev.filter((n) => n.id !== selection.id));
      setEdges((prev) => prev.filter((e) => e.from !== selection.id && e.to !== selection.id));
    } else {
      setEdges((prev) => prev.filter((e) => e.id !== selection.id));
    }
    setSelection(null);
    setPendingFrom(null);
    setTimeout(pushHistory, 0);
  }, [selection, pushHistory]);

  /* Delete key (not while typing) */
  useEffect(() => {
    const onKey = (e) => {
      const tag = (document.activeElement?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if ((e.key === "Delete" || e.key === "Backspace") && selection) { e.preventDefault(); deleteSelection(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const doAutoLayout = () => {
    setNodes((prev) => fcAutoLayout(prev, stateRef.current.edges));
    setViewport({ x: 40, y: 40, zoom: 1 });
    setTimeout(pushHistory, 0);
  };
  const doDraft = () => {
    const d = fcDraftFromAnswer(answerText, sources);
    if (!d) return;
    setNodes(d.nodes);
    setEdges(d.edges);
    setViewport({ x: 40, y: 30, zoom: 1 });
    setDraftNotice(true);
    setSelection(null);
    setTimeout(pushHistory, 0);
  };
  const doSave = () => {
    onSave({ title: title.trim() || "Untitled evidence map", nodes, edges });
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
  };
  const doExportSVG = () => {
    download(fcSlug(title) + ".svg", fcSvgString(nodes, edges, title));
    setExportOpen(false);
  };
  const doExportPNG = () => {
    const b = fcBounds(nodes);
    const svg = fcSvgString(nodes, edges, title);
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    const img = new Image();
    // 2026-09-14: Surface export failures. The old code closed the menu
    // synchronously before async work finished, and swallowed all errors —
    // a failed export looked exactly like success.
    img.onerror = () => { URL.revokeObjectURL(url); setExportOpen(false); toast("Couldn't render the diagram image. Try again.", { tone: "error" }); };
    img.onload = () => {
      try {
        const scale = 2;
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.ceil(b.w * scale));
        c.height = Math.max(1, Math.ceil(b.h * scale));
        const ctx = c.getContext("2d");
        if (!ctx) throw new Error("canvas unavailable");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        c.toBlob((blob) => {
          URL.revokeObjectURL(url);
          setExportOpen(false);
          if (blob) {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = fcSlug(title) + ".png";
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 4000);
          } else {
            toast("Couldn't encode the PNG. Try again.", { tone: "error" });
          }
        });
      } catch (e) { URL.revokeObjectURL(url); setExportOpen(false); toast(e?.message || "Couldn't export the PNG. Try again.", { tone: "error" }); }
    };
    img.src = url;
  };
  const doExportMD = () => {
    download(fcSlug(title) + ".md", fcToMarkdown(nodes, edges, title));
    setExportOpen(false);
  };

  /* Canvas background interactions */
  const pinchRef = useRef(null);
  const onCanvasPointerDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    /* Two-finger pinch zoom on touch. */
    if (e.pointerType !== "mouse") {
      const pins = pinchRef.current?.pts || {};
      pins[e.pointerId] = { x: e.clientX, y: e.clientY };
      const ids = Object.keys(pins);
      if (ids.length === 2) {
        const [a, b] = ids.map((id) => pins[id]);
        pinchRef.current = { pts: pins, dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: viewport.zoom, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
        panRef.current = null;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        return;
      }
      pinchRef.current = { pts: pins };
    }
    setSelection(null);
    setPendingFrom(null);
    setExportOpen(false);
    panRef.current = { sx: e.clientX, sy: e.clientY, ox: viewport.x, oy: viewport.y, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onCanvasPointerMove = (e) => {
    /* Pinch zoom */
    const pinch = pinchRef.current;
    if (pinch?.pts?.[e.pointerId]) {
      pinch.pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      const ids = Object.keys(pinch.pts);
      if (ids.length === 2 && pinch.dist) {
        const [a, b] = ids.map((id) => pinch.pts[id]);
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (dist > 0) {
          const svg = svgRef.current;
          const r = svg.getBoundingClientRect();
          const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
          setViewport((v) => {
            const z2 = Math.min(2.5, Math.max(0.3, pinch.zoom * (dist / pinch.dist)));
            const wx = (mx - v.x) / v.zoom, wy = (my - v.y) / v.zoom;
            return { zoom: z2, x: mx - wx * z2, y: my - wy * z2 };
          });
        }
        return;
      }
    }
    const p = panRef.current;
    if (!p) return;
    const dx = e.clientX - p.sx, dy = e.clientY - p.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) p.moved = true;
    setViewport((v) => ({ ...v, x: p.ox + dx, y: p.oy + dy }));
  };
  const onCanvasPointerUp = (e) => {
    panRef.current = null;
    if (pinchRef.current?.pts) {
      delete pinchRef.current.pts[e.pointerId];
      if (Object.keys(pinchRef.current.pts).length < 2) pinchRef.current = null;
    }
  };
  const onCanvasPointerCancel = (e) => onCanvasPointerUp(e);

  const onNodePointerDown = (e, n) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.stopPropagation();
    if (tool === "connect") {
      if (!pendingFrom) { setPendingFrom(n.id); setSelection({ kind: "node", id: n.id }); }
      else if (pendingFrom !== n.id) {
        const from = fcNodeById(stateRef.current.nodes, pendingFrom);
        const label = from?.type === "decision" ? "yes" : "";
        setEdges((prev) => [...prev, fcNewEdge(pendingFrom, n.id, label)]);
        setPendingFrom(null);
        setTool("select");
        setTimeout(pushHistory, 0);
      } else { setPendingFrom(null); }
      return;
    }
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const w = toWorld(e.clientX, e.clientY);
    dragRef.current = { id: n.id, sx: w.x, sy: w.y, ox: n.x, oy: n.y, moved: false };
    setSelection({ kind: "node", id: n.id });
  };
  const onNodePointerMove = (e, n) => {
    const d = dragRef.current;
    if (!d || d.id !== n.id) return;
    const w = toWorld(e.clientX, e.clientY);
    const nx = d.ox + (w.x - d.sx), ny = d.oy + (w.y - d.sy);
    if (Math.abs(nx - d.ox) + Math.abs(ny - d.oy) > 2) d.moved = true;
    setNodes((prev) => prev.map((m) => (m.id === n.id ? { ...m, x: Math.round(nx), y: Math.round(ny) } : m)));
  };
  const lastTapRef = useRef({ id: null, t: 0 });
  const onNodePointerUp = (e, n) => {
    const d = dragRef.current;
    if (d && d.id === n.id) {
      dragRef.current = null;
      if (d.moved) pushHistory();
    }
    /* Double-tap to edit on touch (no double-click event on mobile). */
    if (e.pointerType !== "mouse" && !d?.moved) {
      const now = Date.now();
      const lt = lastTapRef.current;
      if (lt.id === n.id && now - lt.t < 350) {
        lastTapRef.current = { id: null, t: 0 };
        setSelection({ kind: "node", id: n.id });
        setTimeout(() => document.getElementById("fc-label-edit")?.focus(), 50);
      } else {
        lastTapRef.current = { id: n.id, t: now };
      }
    }
  };

  const selNode = selection?.kind === "node" ? fcNodeById(nodes, selection.id) : null;
  const selEdge = selection?.kind === "edge" ? edges.find((e) => e.id === selection.id) : null;
  const selSource = selNode && selNode.type === "evidence" && typeof selNode.sourceIdx === "number" ? sources?.[selNode.sourceIdx] : null;

  const hint = tool === "connect"
    ? (pendingFrom ? "Now click the target node. The arrow lands there. Esc cancels." : "Click the node the arrow starts from.")
    : "Drag nodes to move · scroll to zoom · drag the canvas to pan · double-click a node to edit it.";

  const studioBtn = (label, onClick, opts = {}) => (
    <UIButton P={P} variant="ghost" type="button" onClick={onClick} disabled={opts.disabled} title={opts.title || label}
      style={{
        padding: "12px 24px", borderRadius: 6, cursor: opts.disabled ? "default" : "pointer",
        fontSize: FONT_SIZES.caption, fontWeight: 650, fontFamily: "var(--cb-font)",
        background: opts.primary ? accent : withAlpha(accent, 0.07),
        color: opts.primary ? at : opts.disabled ? P.faint : P.ink2,
        border: `1px solid ${opts.primary ? accent : withAlpha(accent, 0.22)}`,
        boxShadow: "none",
        opacity: opts.disabled ? 0.45 : 1,
        display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
        transition: "background-color 0.15s ease, opacity 0.15s ease",
        minHeight: 44,
      }}
      onMouseEnter={(e) => { if (!opts.disabled) e.currentTarget.style.background = opts.primary ? accent : withAlpha(accent, 0.14); }}
      onMouseLeave={(e) => { if (!opts.disabled) e.currentTarget.style.background = opts.primary ? accent : withAlpha(accent, 0.07); }}>
      {opts.icon && <Icon name={opts.icon} size={14} />}
      {label}
    </UIButton>
  );
  const studioIconBtn = (icon, onClick, opts = {}) => (
    <UIButton P={P} variant="ghost" type="button" onClick={onClick} disabled={opts.disabled} title={opts.title || icon} aria-label={opts.title || icon}
      style={{
        width: 44, height: 44, borderRadius: 12, cursor: opts.disabled ? "default" : "pointer",
        background: "transparent", color: opts.disabled ? P.faint : P.ink2,
        border: "1px solid transparent", opacity: opts.disabled ? 0.4 : 1,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        transition: "background-color 0.15s ease, color 0.15s ease, opacity 0.15s ease",
      }}
      onMouseEnter={(e) => { if (!opts.disabled) { e.currentTarget.style.background = withAlpha(accent, 0.12); e.currentTarget.style.color = accent; } }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = P.ink2; }}>
      <Icon name={icon} size={15} />
    </UIButton>
  );

  return (
    <Dialog label="Evidence map studio" onClose={onClose} zIndex={300} width={1240}
      onEscape={() => { if (exportOpen) setExportOpen(false); else onClose(); }}
      panelStyle={{
        background: P.bg,
        borderRadius: 12, height: isMobile ? "96dvh" : "88dvh",
        display: "flex", flexDirection: "column", overflow: "hidden",
        border: `1px solid ${withAlpha(accent, 0.18)}`, boxShadow: "0 40px 120px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,0,0,0.4), 0 0 80px rgba(0,0,0,0.25)", outline: "none",
      }}
    >
        {/* ── Studio command bar ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: `1px solid ${P.line}`, flexShrink: 0, flexWrap: "wrap", background: P.bg }}>
          {/* identity */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <span style={{
              width: 34, height: 34, borderRadius: 12, display: "inline-flex", alignItems: "center", justifyContent: "center",
              background: `linear-gradient(135deg, ${withAlpha(accent, 0.28)}, ${withAlpha(accent, 0.10)})`,
              border: `1px solid ${withAlpha(accent, 0.4)}`, boxShadow: `0 2px 12px ${withAlpha(accent, 0.25)}`, flexShrink: 0,
            }}>
              <Icon name="flowchart" size={17} style={{ color: accent }} />
            </span>
            <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15, minWidth: 0 }}>
              <span className="cb-kicker">Studio</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: P.ink, fontFamily: "var(--cb-font)" }}>Evidence map</span>
            </div>
          </div>
          <div style={{ width: 1, height: 26, background: P.line, flexShrink: 0 }} />
          {/* title */}
          <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Evidence map title" placeholder="Untitled evidence map"
            title="Rename this evidence map"
            style={{
              flex: "1 1 140px", minWidth: 0, background: "transparent",
              border: "none", borderBottom: `1px dashed transparent`, outline: "none",
              color: P.ink, fontSize: 15, fontWeight: 650, fontFamily: "var(--cb-font)",
              padding: "4px 2px", transition: "border-color 0.15s ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderBottomColor = withAlpha(accent, 0.45); }}
            onMouseLeave={(e) => { if (document.activeElement !== e.currentTarget) e.currentTarget.style.borderBottomColor = "transparent"; }}
            onFocus={(e) => { e.currentTarget.style.borderBottomColor = accent; e.currentTarget.style.borderBottomStyle = "solid"; }}
            onBlur={(e) => { e.currentTarget.style.borderBottomColor = "transparent"; e.currentTarget.style.borderBottomStyle = "dashed"; }}
          />
          {savedFlash && <span style={{ fontSize: FONT_SIZES.caption, color: accent, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name="check" size={13} /> Saved</span>}
          {/* tool switcher */}
          {!isMobile && (
            <div role="toolbar" aria-label="Canvas tools" style={{
              display: "flex", alignItems: "center", background: P.dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.045)",
              border: `1px solid ${P.line}`, borderRadius: 6, padding: 3, gap: 2,
            }}>
              {[["select", "Select", "cursor"], ["connect", "Connect", "link"]].map(([key, label, icon]) => {
                const on = tool === key;
                return (
                  <UIButton P={P} variant="ghost" key={key} type="button" aria-pressed={on} title={key === "connect" ? "Connect: click a source node, then a target" : "Select and drag nodes"}
                    onClick={() => { setTool(key); setPendingFrom(null); }}
                    style={{ minHeight: 44,
                      display: "inline-flex", alignItems: "center", gap: 7, padding: "6px 16px", borderRadius: 6,
                      border: "none", cursor: "pointer", fontSize: FONT_SIZES.caption, fontWeight: 650, fontFamily: "var(--cb-font)",
                      background: on ? accent : "transparent", color: on ? at : P.ink2,
                      boxShadow: on ? `0 2px 10px ${withAlpha(accent, 0.4)}` : "none",
                      transition: "background-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease",
                    }}>
                    <Icon name={icon} size={13} />
                    {label}
                  </UIButton>
                );
              })}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", marginLeft: "auto" }}>
            {studioIconBtn("undo", undo, { disabled: !canUndo, title: "Undo (Ctrl+Z)" })}
            {studioIconBtn("redo", redo, { disabled: !canRedo, title: "Redo (Ctrl+Y)" })}
            <div style={{ width: 1, height: 22, background: P.line, margin: "0 6px", flexShrink: 0 }} />
            {studioBtn("Arrange", doAutoLayout, { icon: "wand", title: "Auto-arrange the chart top-down", disabled: nodes.length < 2 })}
            {answerText && studioBtn("Draft", doDraft, { icon: "edit", title: "Turn this answer's steps into a starting chart (marked as draft)" })}
            <div style={{ position: "relative" }}>
              {studioBtn("Export", () => setExportOpen((v) => !v), { icon: "download", title: "Export as SVG, PNG, or Markdown" })}
              {exportOpen && (
                <div style={{
                  position: "absolute", right: 0, top: "calc(100% + 8px)", zIndex: Z.sticky, minWidth: 220,
                  background: P.bg, border: `1px solid ${P.line}`, borderRadius: 12, padding: 6,
                  boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
                }}>
                  {[["SVG", "Vector: scales forever", doExportSVG], ["PNG", "Image: 2\u00d7 resolution", doExportPNG], ["Markdown", "Text outline", doExportMD]].map(([fmt, desc, fn]) => (
                    <button key={fmt} type="button" onClick={() => { setExportOpen(false); fn(); }}
                      style={{ minHeight: 44, display: "flex", alignItems: "baseline", gap: 10, width: "100%", textAlign: "left", padding: "9px 11px", borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", fontFamily: "var(--cb-font)" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = withAlpha(accent, 0.12); }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                      <span style={{ fontFamily: "var(--cb-font)", fontSize: 11, fontWeight: 700, color: accent, width: 74, flexShrink: 0 }}>{fmt}</span>
                      <span style={{ fontSize: FONT_SIZES.caption, color: P.ink2 }}>{desc}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {studioBtn("Save", doSave, { primary: true, icon: "check" })}
            <div style={{ width: 1, height: 22, background: P.line, margin: "0 6px", flexShrink: 0 }} />
            <UIButton P={P} variant="ghost" type="button" onClick={onClose} aria-label="Close studio" title="Close (Esc)"
              /* 44px hit area; the 32px hover circle is the inner span. */
              style={{
                width: 44, height: 44, border: "none", cursor: "pointer", padding: 0,
                background: "transparent", color: P.faint, display: "inline-flex", alignItems: "center", justifyContent: "center",
              }}>
              <span
                style={{
                  width: 32, height: 32, borderRadius: "50%", display: "inline-flex",
                  alignItems: "center", justifyContent: "center",
                  transition: "background-color 0.15s ease, color 0.15s ease",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(229,72,77,0.14)"; e.currentTarget.style.color = "#e5484d"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = P.faint; }}>
                <Icon name="close" size={16} />
              </span>
            </UIButton>
          </div>
        </div>

        {draftNotice && (
          <div style={{
            padding: "8px 16px", background: withAlpha(accent, 0.08), borderBottom: `1px solid ${P.line}`,
            fontSize: FONT_SIZES.caption, color: P.ink2, display: "flex", alignItems: "center", gap: 8, flexShrink: 0,
          }}>
            <Icon name="edit" size={13} />
            <span><strong>Draft.</strong> These steps were lifted from the answer — review every node before you trust the chart.</span>
            <button type="button" onClick={() => setDraftNotice(false)} style={{ marginLeft: "auto", background: "none", border: "none", color: P.faint, cursor: "pointer", fontSize: FONT_SIZES.caption }}>Dismiss</button>
          </div>
        )}

        {/* ── Body ── */}
        <div style={{ display: "flex", flex: 1, minHeight: 0, flexDirection: isMobile ? "column" : "row" }}>
          {/* Palette — node rail */}
          <div style={{
            flexShrink: 0, borderRight: isMobile ? "none" : `1px solid ${P.line}`,
            borderBottom: isMobile ? `1px solid ${P.line}` : "none",
            background: P.dark ? "rgba(0,0,0,0.22)" : "rgba(0,0,0,0.02)",
            padding: isMobile ? "8px 10px" : "12px 10px", display: "flex", flexDirection: isMobile ? "row" : "column", gap: 3,
            overflowX: isMobile ? "auto" : "visible", overflowY: isMobile ? "visible" : "auto", alignItems: isMobile ? "center" : "stretch",
          }}>
            {!isMobile && <div className="cb-kicker" style={{ padding: "2px 6px 12px" }}>Nodes</div>}
            {isMobile && (
              <div style={{ display: "flex", background: P.dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)", border: `1px solid ${P.line}`, borderRadius: 6, padding: 2, gap: 2, flexShrink: 0, marginRight: 4 }}>
                {[["select", "cursor"], ["connect", "link"]].map(([key, icon]) => (
                  <UIButton P={P} variant="ghost" key={key} type="button" aria-pressed={tool === key} title={key === "connect" ? "Connect nodes" : "Select nodes"}
                    onClick={() => { setTool(key); setPendingFrom(null); }}
                    style={{ minWidth: 44, minHeight: 44,
                      width: 30, height: 30, borderRadius: "50%", border: "none", cursor: "pointer",
                      background: tool === key ? accent : "transparent", color: tool === key ? at : P.ink2,
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                    }}>
                    <Icon name={icon} size={14} />
                  </UIButton>
                ))}
              </div>
            )}
            {FC_ORDER.map((t) => <FcPaletteBtn key={t} type={t} P={P} accent={accent} isMobile={isMobile} onClick={() => addNode(t)} />)}
            {!isMobile && (
              <div style={{ marginTop: "auto", padding: "12px 6px 2px", fontSize: 11, color: P.faint, lineHeight: 1.6, fontFamily: "var(--cb-font)" }}>
                <span style={{ color: P.ink2, fontWeight: 650 }}>Tip</span> — double-click a node to rename it.
              </div>
            )}
          </div>

          {/* Canvas */}
          <div style={{ flex: 1, position: "relative", minHeight: 0, minWidth: 0, background: P.dark ? "#0b0d0b" : "#eef0ec", overflow: "hidden" }}>
            {/* vignette for depth */}
            <div aria-hidden="true" style={{
              position: "absolute", inset: 0, pointerEvents: "none", zIndex: Z.raised,
              background: P.dark
                ? "radial-gradient(120% 120% at 50% 40%, transparent 55%, rgba(0,0,0,0.42) 100%)"
                : "radial-gradient(120% 120% at 50% 40%, transparent 60%, rgba(30,40,30,0.10) 100%)",
            }} />
            <svg ref={svgRef} style={{ width: "100%", height: "100%", display: "block", cursor: tool === "connect" ? "crosshair" : "grab", touchAction: "none" }}
              onPointerDown={onCanvasPointerDown} onPointerMove={onCanvasPointerMove} onPointerUp={onCanvasPointerUp} onPointerCancel={onCanvasPointerCancel}>
              <defs>
                <pattern id="fcGrid" width="28" height="28" patternUnits="userSpaceOnUse">
                  <circle cx="1.2" cy="1.2" r="1.1" fill={P.dark ? "rgba(255,255,255,0.055)" : "rgba(20,30,20,0.07)"} />
                </pattern>
                <pattern id="fcGridMajor" width="140" height="140" patternUnits="userSpaceOnUse">
                  <path d="M 140 0 L 0 0 0 140" fill="none" stroke={P.dark ? "rgba(255,255,255,0.045)" : "rgba(20,30,20,0.06)"} strokeWidth="1" />
                </pattern>
                {/* Arrowheads carry the accent now, not faint grey: the eye
                    follows the flow instead of hunting for it. */}
                <marker id="fcArrowHead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
                  <path d="M 0 1 L 9 5 L 0 9 z" fill={accent} />
                </marker>
                <filter id="fcNodeShadow" x="-30%" y="-30%" width="160%" height="160%">
                  <feDropShadow dx="0" dy="4" stdDeviation="8" floodColor="#000" floodOpacity={P.dark ? 0.32 : 0.13} />
                </filter>
                <linearGradient id="fcNodeGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#fff" stopOpacity={P.dark ? 0.10 : 0.55} />
                  <stop offset="1" stopColor="#fff" stopOpacity="0" />
                </linearGradient>
              </defs>
              <g transform={`translate(${viewport.x},${viewport.y}) scale(${viewport.zoom})`}>
                <rect x={-4000} y={-4000} width={12000} height={12000} fill="url(#fcGridMajor)" />
                <rect x={-4000} y={-4000} width={12000} height={12000} fill="url(#fcGrid)" />
                {/* edges */}
                {edges.map((e) => {
                  const a = fcNodeById(nodes, e.from), b = fcNodeById(nodes, e.to);
                  if (!a || !b) return null;
                  const g = fcEdgeGeom(a, b);
                  const sel = selection?.kind === "edge" && selection.id === e.id;
                  return (
                    <g key={e.id}>
                      <path d={g.d} fill="none" stroke="transparent" strokeWidth={16} style={{ cursor: "pointer" }}
                        onPointerDown={(ev) => { ev.stopPropagation(); setSelection({ kind: "edge", id: e.id }); }} />
                      <path d={g.d} fill="none" stroke={sel ? accent : withAlpha(accent, 0.45)} strokeWidth={sel ? 2.4 : 2} opacity={sel ? 1 : 0.9} markerEnd="url(#fcArrowHead)" style={{ pointerEvents: "none" }} />
                      {e.label && (
                        <text x={g.mx} y={g.my - 8} textAnchor="middle" fontSize={12} fontStyle="italic" fill={P.faint} style={{ pointerEvents: "none", fontFamily: "var(--cb-font)" }}>{e.label}</text>
                      )}
                    </g>
                  );
                })}
                {/* nodes */}
                {nodes.map((n) => {
                  const sel = selection?.kind === "node" && selection.id === n.id;
                  const pend = pendingFrom === n.id;
                  const lines = fcWrap(n.label, Math.max(8, Math.floor((n.w - 36) / 8)));
                  const lh = 21;
                  const isAccent = n.type === "start" || n.type === "end";
                  /* Draft scaffolds carry a mono step numeral as a kicker —
                     the number owns the sequence so the label only has to
                     own the meaning. User-built nodes have no step and
                     render label-only, as before. */
                  const kicker = typeof n.step === "number" && !isAccent ? String(n.step).padStart(2, "0") : null;
                  const blockH = (lines.length - 1) * lh + (kicker ? 22 : 0);
                  /* Evidence nodes carry a source-title caption along the
                     bottom edge — center the label block in the space above
                     it so a three-line label never collides with the caption. */
                  const capH = n.type === "evidence" && typeof n.sourceIdx === "number" && sources?.[n.sourceIdx] ? 16 : 0;
                  const ty = (n.h - capH) / 2 - blockH / 2 + 5;
                  const labelTop = ty + (kicker ? 22 : 0);
                  return (
                    <g key={n.id} transform={`translate(${n.x},${n.y})`}
                      onPointerDown={(e) => onNodePointerDown(e, n)}
                      onPointerMove={(e) => onNodePointerMove(e, n)}
                      onPointerUp={(e) => onNodePointerUp(e, n)}
                      onDoubleClick={(e) => { e.stopPropagation(); setSelection({ kind: "node", id: n.id }); setTimeout(() => document.getElementById("fc-label-edit")?.focus(), 50); }}
                      style={{ cursor: tool === "connect" ? "crosshair" : "grab" }}>
                      {pend && <rect x={-7} y={-7} width={n.w + 14} height={n.h + 14} rx={14} fill="none" stroke={accent} strokeWidth={1.6} strokeDasharray="6 4" opacity={0.8} />}
                      <FcNodeShape n={n} P={P} accent={accent} selected={sel} pending={pend} />
                      {kicker && (
                        <text x={n.w / 2} y={ty + 4} textAnchor="middle" fontSize={10.5} fill={accent}
                          style={{ pointerEvents: "none", userSelect: "none", fontFamily: "var(--cb-font)", fontWeight: 700, letterSpacing: TRACKING.eyebrowWide }}>
                          {kicker}
                        </text>
                      )}
                      {lines.map((ln, i) => (
                        <text key={i} x={n.w / 2} y={labelTop + i * lh} textAnchor="middle" fontSize={15}
                          fill={isAccent ? at : P.ink} style={{ pointerEvents: "none", userSelect: "none", fontFamily: "var(--cb-font)", fontWeight: 600, letterSpacing: "-0.015em" }}>
                          {ln}
                        </text>
                      ))}
                      {n.type === "evidence" && typeof n.sourceIdx === "number" && sources?.[n.sourceIdx] && (
                        <text x={n.w / 2} y={n.h - 10} textAnchor="middle" fontSize={10} fill={P.faint}
                          style={{ pointerEvents: "none", userSelect: "none", fontFamily: "var(--cb-font)", fontStyle: "italic" }}>
                          {String(sources[n.sourceIdx].title || "source").slice(0, 34)}{String(sources[n.sourceIdx].title || "").length > 34 ? "…" : ""}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            </svg>
            {nodes.length === 0 && (
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", padding: 24, zIndex: Z.overlay }}>
                <div style={{ textAlign: "center", maxWidth: 380 }}>
                  <svg width="220" height="86" viewBox="0 0 220 86" aria-hidden="true" style={{ margin: "0 auto 18px", display: "block", opacity: 0.9 }}>
                    <defs>
                      <linearGradient id="fcEmptyA" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor={accent} stopOpacity="0.85" /><stop offset="1" stopColor={accent} stopOpacity="0.55" />
                      </linearGradient>
                    </defs>
                    <rect x="8" y="28" width="52" height="30" rx="15" fill="url(#fcEmptyA)" opacity="0.9" />
                    <polygon points="110,8 142,36 110,64 78,36" fill={withAlpha(accent, 0.18)} stroke={accent} strokeWidth="1.5" />
                    <rect x="160" y="28" width="52" height="30" rx="8" fill={withAlpha(accent, 0.10)} stroke={P.faint} strokeWidth="1.5" strokeDasharray="5 4" />
                    <path d="M60 43 h14" stroke={P.faint} strokeWidth="1.5" /><path d="M71 39 l5 4 -5 4" fill="none" stroke={P.faint} strokeWidth="1.5" />
                    <path d="M146 43 h10" stroke={P.faint} strokeWidth="1.5" strokeDasharray="3 3" /><path d="M153 39 l5 4 -5 4" fill="none" stroke={P.faint} strokeWidth="1.5" />
                  </svg>
                  <div style={{ fontSize: 17, fontWeight: 700, color: P.ink, marginBottom: 8, fontFamily: "var(--cb-font)", letterSpacing: "-0.015em" }}>A blank bench</div>
                  <div style={{ fontSize: FONT_SIZES.small, color: P.faint, lineHeight: 1.65, marginBottom: answerText ? 16 : 0 }}>
                    Add nodes from the rail, or lift this answer's reasoning into a starting chart.
                  </div>
                  {answerText && (
                    <button type="button" onClick={doDraft} style={{ minHeight: 44, pointerEvents: "auto", display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 24px", borderRadius: 6, border: `1px solid ${accent}`, background: accent, color: at, fontSize: FONT_SIZES.small, fontWeight: 700, fontFamily: "var(--cb-font)", cursor: "pointer" }}>
                      <Icon name="edit" size={14} /> Draft from answer
                    </button>
                  )}
                </div>
              </div>
            )}
            {/* zoom controls */}
            <div style={{ position: "absolute", right: 14, bottom: 14, zIndex: Z.overlay, display: "flex", alignItems: "center", gap: 2, background: P.bg, border: `1px solid ${P.line}`, borderRadius: 6, padding: 4 }}>
              {[["−", 1 / 1.25, "Zoom out"], ["+", 1.25, "Zoom in"]].map(([label, f, t2]) => (
                <UIButton P={P} variant="ghost" key={label} type="button" title={t2} aria-label={t2}
                  onClick={() => setViewport((v) => ({ ...v, zoom: Math.min(2.5, Math.max(0.3, v.zoom * f)) }))}
                  style={{ minWidth: 44, minHeight: 44, width: 30, height: 30, borderRadius: 8, border: "none", background: "transparent", color: P.ink2, cursor: "pointer", fontSize: 16, fontWeight: 600, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = withAlpha(accent, 0.12); e.currentTarget.style.color = accent; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = P.ink2; }}>
                  {label}
                </UIButton>
              ))}
              <UIButton P={P} variant="ghost" type="button" title="Reset view" aria-label="Reset view"
                onClick={() => setViewport({ x: 40, y: 40, zoom: 1 })}
                style={{ minWidth: 44, minHeight: 44, height: 30, padding: "0 12px", borderRadius: 8, border: "none", background: "transparent", color: P.faint, cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: "var(--cb-font)", letterSpacing: TRACKING.labelTight }}
                onMouseEnter={(e) => { e.currentTarget.style.background = withAlpha(accent, 0.12); e.currentTarget.style.color = accent; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = P.faint; }}>
                {Math.round(viewport.zoom * 100)}%
              </UIButton>
            </div>
          </div>

          {/* Inspector */}
          <div style={{
            flexShrink: 0, width: isMobile ? "100%" : 264, maxHeight: isMobile ? 230 : "none", overflowY: "auto",
            borderLeft: isMobile ? "none" : `1px solid ${P.line}`, borderTop: isMobile ? `1px solid ${P.line}` : "none",
            background: P.dark ? "rgba(0,0,0,0.22)" : "rgba(0,0,0,0.02)",
            padding: 14,
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div className="cb-kicker">Inspector</div>
              {(selNode || selEdge) && (
                <div style={{ fontSize: 10, fontWeight: 700, color: accent, background: withAlpha(accent, 0.13), border: `1px solid ${withAlpha(accent, 0.3)}`, borderRadius: 9999, padding: "3px 12px", textTransform: "uppercase", letterSpacing: TRACKING.eyebrow }}>
                  {selNode ? FC_NODE_TYPES[selNode.type].name : "Arrow"}
                </div>
              )}
            </div>
            {!selection && (
              <div>
                <div style={{ fontSize: FONT_SIZES.small, color: P.ink2, fontWeight: 650, marginBottom: 6 }}>Nothing selected</div>
                <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, lineHeight: 1.7 }}>
                  Click a node or arrow to edit it here.
                </div>
                <div style={{ marginTop: 12, padding: 10, borderRadius: 12, background: withAlpha(accent, 0.07), border: `1px solid ${withAlpha(accent, 0.18)}`, fontSize: FONT_SIZES.caption, color: P.ink2, lineHeight: 1.65 }}>
                  <span style={{ fontWeight: 700, color: accent }}>Connect</span> links two nodes — click the source, then the target.
                  {sources && sources.length > 0 && <span> Evidence nodes can cite this answer's papers.</span>}
                </div>
              </div>
            )}
            {selNode && (
              <div style={{ background: withAlpha(P.bg, 0.7), border: `1px solid ${P.line}`, borderRadius: 12, padding: 12 }}>
                <label htmlFor="fc-label-edit" style={{ display: "block", fontSize: 11, fontWeight: 700, color: P.faint, marginBottom: 6, textTransform: "uppercase", letterSpacing: TRACKING.eyebrow }}>Label</label>
                <textarea id="fc-label-edit" value={selNode.label} rows={3}
                  onChange={(e) => updateNode(selNode.id, { label: e.target.value }, false)}
                  onBlur={pushHistory}
                  style={{
                    width: "100%", boxSizing: "border-box", background: P.dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)",
                    border: `1px solid ${P.line}`, borderRadius: 8, color: P.ink, padding: "8px 12px",
                    fontSize: FONT_SIZES.small, fontFamily: "var(--cb-font)", resize: "vertical",
                  }} />
                {/* The draft compresses answer sentences into terse labels;
                    the full source sentence lives here so the compression
                    never destroys information — it's one click away. */}
                {selNode.detail && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: P.faint, marginBottom: 6, textTransform: "uppercase", letterSpacing: TRACKING.eyebrow }}>Source sentence</div>
                    <div style={{ fontSize: FONT_SIZES.caption, color: P.ink2, lineHeight: 1.65, padding: "8px 12px", background: P.dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)", border: `1px solid ${P.line}`, borderRadius: 8 }}>
                      {selNode.detail}
                    </div>
                  </div>
                )}
                {selNode.type === "evidence" && sources && sources.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <label htmlFor="fc-source-pick" style={{ display: "block", fontSize: 11, fontWeight: 700, color: P.faint, marginBottom: 6, textTransform: "uppercase", letterSpacing: TRACKING.eyebrow }}>Cites paper</label>
                    <select id="fc-source-pick" value={typeof selNode.sourceIdx === "number" ? selNode.sourceIdx : ""}
                      onChange={(e) => updateNode(selNode.id, { sourceIdx: e.target.value === "" ? undefined : Number(e.target.value) })}
                      style={{
                        width: "100%", background: P.dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)",
                        border: `1px solid ${P.line}`, borderRadius: 8, color: P.ink, padding: "8px 12px",
                        fontSize: FONT_SIZES.caption, fontFamily: "var(--cb-font)",
                      }}>
                      <option value="">No citation</option>
                      {sources.slice(0, 12).map((s, i) => (
                        <option key={i} value={i}>{String(s.title || "Untitled").slice(0, 60)}{s.year ? ` (${s.year})` : ""}</option>
                      ))}
                    </select>
                    {selSource?.url && (
                      <a href={safeHref(selSource.url)} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 8, fontSize: FONT_SIZES.caption, color: accent, fontWeight: 600 }}>
                        Open the paper <Icon name="arrowUpRight" size={11} />
                      </a>
                    )}
                    {selSource && (
                      <div style={{ marginTop: 8, padding: "8px 12px", borderLeft: `2px solid ${accent}`, fontSize: FONT_SIZES.caption, color: P.ink2, lineHeight: 1.6, fontFamily: "var(--cb-font)" }}>
                        <div style={{ fontWeight: 700, color: P.ink }}>{selSource.title || "Untitled"}</div>
                        <div style={{ color: P.faint }}>
                          {[selSource.authors, selSource.journal || selSource.source, selSource.year].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <button type="button" onClick={deleteSelection}
                  style={{ minHeight: 44, marginTop: 14, width: "100%", background: "rgba(229,72,77,0.07)", border: "1px solid rgba(229,72,77,0.3)", borderRadius: 12, padding: "8px 16px", color: "#e5484d", fontSize: FONT_SIZES.caption, fontWeight: 650, cursor: "pointer", fontFamily: "var(--cb-font)", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(229,72,77,0.14)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(229,72,77,0.07)"; }}>
                  <Icon name="trash" size={13} /> Delete node
                </button>
              </div>
            )}
            {selEdge && (
              <div style={{ background: withAlpha(P.bg, 0.7), border: `1px solid ${P.line}`, borderRadius: 12, padding: 12 }}>
                <label htmlFor="fc-edge-edit" style={{ display: "block", fontSize: 11, fontWeight: 700, color: P.faint, marginBottom: 6, textTransform: "uppercase", letterSpacing: TRACKING.eyebrow }}>Label <span style={{ opacity: 0.6, fontWeight: 400, textTransform: "none", letterSpacing: "0" }}>(e.g. yes / no)</span></label>
                <input id="fc-edge-edit" value={selEdge.label} onChange={(e) => { setEdges((prev) => prev.map((x) => (x.id === selEdge.id ? { ...x, label: e.target.value } : x))); }} onBlur={pushHistory}
                  style={{
                    width: "100%", boxSizing: "border-box", background: P.dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)",
                    border: `1px solid ${P.line}`, borderRadius: 8, color: P.ink, padding: "8px 12px",
                    fontSize: FONT_SIZES.small, fontFamily: "var(--cb-font)",
                  }} />
                <div style={{ marginTop: 8, fontSize: FONT_SIZES.caption, color: P.faint, fontFamily: "var(--cb-font)" }}>
                  {(() => { const a = fcNodeById(nodes, selEdge.from), b = fcNodeById(nodes, selEdge.to); return a && b ? `${a.label.slice(0, 24)} → ${b.label.slice(0, 24)}` : ""; })()}
                </div>
                <button type="button" onClick={deleteSelection}
                  style={{ minHeight: 44, marginTop: 14, width: "100%", background: "rgba(229,72,77,0.07)", border: "1px solid rgba(229,72,77,0.3)", borderRadius: 12, padding: "8px 16px", color: "#e5484d", fontSize: FONT_SIZES.caption, fontWeight: 650, cursor: "pointer", fontFamily: "var(--cb-font)", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(229,72,77,0.14)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(229,72,77,0.07)"; }}>
                  <Icon name="trash" size={13} /> Delete arrow
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Status bar ── */}
        <div style={{
          display: "flex", alignItems: "center", gap: 14, padding: "8px 16px", borderTop: `1px solid ${P.line}`,
          fontSize: FONT_SIZES.caption, color: P.faint, flexShrink: 0, flexWrap: "wrap",
          fontFamily: "var(--cb-font)", background: P.dark ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0.02)",
        }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: nodes.length ? accent : P.faint, boxShadow: nodes.length ? `0 0 8px ${withAlpha(accent, 0.8)}` : "none" }} />
            {nodes.length} node{nodes.length === 1 ? "" : "s"} · {edges.length} arrow{edges.length === 1 ? "" : "s"}
          </span>
          {selection && <span style={{ color: accent }}>● {selection.kind === "node" ? "node" : "arrow"} selected</span>}
          <span style={{ flex: 1 }} />
          <span style={{ fontFamily: "var(--cb-font)" }}>{hint}</span>
        </div>
    </Dialog>
  );
}

/* ══════════════════════════════════════════════════════════════════
   Diagram Studio — a mermaid.live-grade diagram instrument as its own
   tab. A code editor with live preview, pan/zoom canvas, diagram-type
   templates, .mmd import/export, SVG/PNG export, and a local diagram
   library.

   Mermaid is lazy-loaded (dynamic import) so the main bundle never pays
   for it until the studio opens. Rendering runs at securityLevel
   "strict": diagram source can never inject scripts into the page.

   Imported .mmd files load VERBATIM — the studio never reformats,
   tidies, or "fixes" your source. What you wrote is what renders.
   ══════════════════════════════════════════════════════════════════ */

const MM_STORE_KEY = "cb_mermaid_diagrams";
const MM_DRAFT_KEY = "cb_mermaid_draft_v1";

const MM_DEFAULT_CODE = `flowchart TD
    A[Raw lignin] --> B{Enzyme attack}
    B -->|Laccase| C[Phenolic radicals]
    B -->|Peroxidase| D[Aryl fragments]
    C --> E[Repolymerization]
    D --> F[Ring cleavage]
    E --> G[Humic-like polymers]
    F --> H[Small organic acids]
    G --> I[Mineralization]
    H --> I
`;

const MERMAID_TEMPLATES = [
  { key: "flowchart", name: "Flowchart", code: `flowchart TD
    A[Start] --> B{Decide}
    B -->|Yes| C[Do it]
    B -->|No| D[Skip it]
    C --> E[End]
    D --> E` },
  { key: "sequence", name: "Sequence diagram", code: `sequenceDiagram
    participant U as User
    participant S as Server
    U->>S: Search request
    S->>S: Rank papers
    S-->>U: Results` },
  { key: "class", name: "Class diagram", code: `classDiagram
    class Paper {
        +String title
        +String authors
        +Int year
        +cite() String
    }
    class Preprint {
        +String server
    }
    Paper <|-- Preprint` },
  { key: "state", name: "State diagram", code: `stateDiagram-v2
    [*] --> Draft
    Draft --> Review : submit
    Review --> Published : accept
    Review --> Draft : revise
    Published --> [*]` },
  { key: "er", name: "Entity relationship", code: `erDiagram
    PAPER ||--o{ AUTHOR : has
    PAPER {
        string title
        int year
        string doi
    }
    AUTHOR {
        string name
    }` },
  { key: "gantt", name: "Gantt chart", code: `gantt
    title Research plan
    dateFormat YYYY-MM-DD
    section Phase 1
    Literature review :a1, 2026-09-01, 14d
    Experiments       :a2, after a1, 21d
    section Phase 2
    Analysis          :a3, after a2, 14d` },
  { key: "pie", name: "Pie chart", code: `pie title Funding split
    "Grants" : 45
    "Industry" : 30
    "Internal" : 25` },
  { key: "mindmap", name: "Mindmap", code: `mindmap
  root((Research question))
    Background
      Prior work
      Key papers
    Methods
    Evidence
    Open gaps` },
  { key: "timeline", name: "Timeline", code: `timeline
    title Discovery arc
    2024 : Hypothesis formed
    2025 : First results
    2026 : Independent replication` },
  { key: "journey", name: "User journey", code: `journey
    title Reading a paper
    section Skim
      Abstract: 5: Reader
      Figures: 4: Reader
    section Deep read
      Methods: 2: Reader
      References: 3: Reader` },
];

/* The studio's own mark: a node flowing into a decision diamond, set in
   a rounded frame. Distinct from the Cerebrum brain mark on purpose —
   the studio is its own instrument with its own identity. */
export function StudioMark({ size = 22, accent = "#fff" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" stroke={accent} strokeWidth="1.8" opacity="0.85" />
      <circle cx="8.4" cy="8.4" r="2.3" fill={accent} />
      <path d="M10.2 10.1l3.6 3.6" stroke={accent} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M15.2 12.4l3.4 3.4-3.4 3.4-3.4-3.4z" stroke={accent} strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

/* One-pass syntax highlighter: comments, strings, keywords, arrows.
   Single pass so inserted spans are never re-scanned. */
const MM_TOKEN_RE = /(%%[^\n]*)|("[^"\n]*")|\b(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|pie|mindmap|timeline|journey|gitGraph|subgraph|end|participant|actor|title|section|dateFormat|classDef|click|style|linkStyle|direction|TB|TD|BT|RL|LR)\b|(-->|==>|---|-\.->|~~~|:::|<-->)/g;
export function mmEscapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
export function mmHighlight(code) {
  let out = "";
  let last = 0;
  let m;
  MM_TOKEN_RE.lastIndex = 0;
  while ((m = MM_TOKEN_RE.exec(code))) {
    out += mmEscapeHtml(code.slice(last, m.index));
    const cls = m[1] ? "mm-cm" : m[2] ? "mm-st" : m[3] ? "mm-kw" : "mm-ar";
    out += `<span class="${cls}">${mmEscapeHtml(m[0])}</span>`;
    last = m.index + m[0].length;
    if (m[0].length === 0) MM_TOKEN_RE.lastIndex += 1;
  }
  out += mmEscapeHtml(code.slice(last));
  return out + "\n";
}

const MM_FONT = '13px/1.65 ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

/* Line-numbered code editor: a transparent textarea over a highlighted
   <pre>, metrics locked together so the highlight never drifts. */
export function MMCodeEditor({ P, accent, code, onChange }) {
  const taRef = useRef(null);
  const preRef = useRef(null);
  const gutterRef = useRef(null);
  const lineCount = code.split("\n").length;
  const syncScroll = () => {
    const ta = taRef.current;
    if (!ta) return;
    if (preRef.current) { preRef.current.scrollTop = ta.scrollTop; preRef.current.scrollLeft = ta.scrollLeft; }
    if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop;
  };
  const onKeyDown = (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = taRef.current;
      const s = ta.selectionStart;
      const en = ta.selectionEnd;
      const next = code.slice(0, s) + "  " + code.slice(en);
      onChange(next);
      requestAnimationFrame(() => { try { ta.selectionStart = ta.selectionEnd = s + 2; } catch (cbErr) { console.error("[Cerebrum] flowcharts.jsx if: ta.selectionStart = ta.selectionEnd = s + 2; }:", cbErr); } });
    }
  };
  const pad = "14px 16px";
  return (
    <div style={{ position: "relative", flex: 1, display: "flex", minHeight: 0, minWidth: 0 }}>
      <div ref={gutterRef} aria-hidden="true" style={{
        width: 46, flexShrink: 0, overflow: "hidden", padding: "16px 8px 14px 0",
        font: MM_FONT, textAlign: "right", color: P.faint, userSelect: "none",
        borderRight: `1px solid ${P.line}`, background: P.dark ? "rgba(255,255,255,0.015)" : "rgba(0,0,0,0.015)",
      }}>
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i} style={{ height: "21.45px" }}>{i + 1}</div>
        ))}
      </div>
      <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
        <pre ref={preRef} aria-hidden="true" dangerouslySetInnerHTML={{ __html: mmHighlight(code) }} style={{
          position: "absolute", inset: 0, margin: 0, padding: pad, overflow: "hidden",
          font: MM_FONT, whiteSpace: "pre", color: P.ink2, pointerEvents: "none",
        }} />
        <textarea ref={taRef} value={code} wrap="off"
          onChange={(e) => onChange(e.target.value)} onScroll={syncScroll} onKeyDown={onKeyDown}
          spellCheck={false} autoCapitalize="off" autoCorrect="off" autoComplete="off"
          aria-label="Diagram source code" placeholder="flowchart TD&#10;    A --> B"
          style={{
            position: "absolute", inset: 0, width: "100%", height: "100%", padding: pad,
            font: MM_FONT, whiteSpace: "pre", overflow: "auto", resize: "none",
            background: "transparent", color: "transparent", caretColor: accent,
            border: 0, outline: "none",
          }} />
      </div>
    </div>
  );
}

export function MermaidStudio({ P, accent, at, isMobile, initialCode }) {
  const [code, setCode] = useState(() => {
    try {
      const d = JSON.parse(localStorage.getItem(MM_DRAFT_KEY) || "null");
      if (d && typeof d.code === "string" && d.code.trim()) return d.code;
    } catch (cbErr) { console.error("[Cerebrum] flowcharts.jsx MermaidStudio: const d = JSON.parse(localStorage.getItem(MM_DRAFT_KEY) || 'null');:", cbErr); }
    return initialCode || MM_DEFAULT_CODE;
  });
  const [title, setTitle] = useState(() => {
    try {
      const d = JSON.parse(localStorage.getItem(MM_DRAFT_KEY) || "null");
      if (d && typeof d.title === "string" && d.title) return d.title;
    } catch (cbErr) { console.error("[Cerebrum] flowcharts.jsx MermaidStudio: const d = JSON.parse(localStorage.getItem(MM_DRAFT_KEY) || 'null');:", cbErr); }
    return "Untitled diagram";
  });
  const [activeId, setActiveId] = useState(() => {
    try {
      const d = JSON.parse(localStorage.getItem(MM_DRAFT_KEY) || "null");
      return (d && d.activeId) || null;
    } catch { return null; }
  });
  const [diagrams, setDiagrams] = useState(() => {
    try {
      const v = JSON.parse(localStorage.getItem(MM_STORE_KEY) || "[]");
      return Array.isArray(v) ? v : [];
    } catch { return []; }
  });
  const [mm, setMm] = useState(null);
  const [mmError, setMmError] = useState(null);
  const [svg, setSvg] = useState("");
  const [diagError, setDiagError] = useState(null);
  const [rendering, setRendering] = useState(false);
  const [pan, setPan] = useState({ x: 28, y: 28, k: 1 });
  const [mobilePane, setMobilePane] = useState("code");
  const [copied, setCopied] = useState(false);
  const [savedTick, setSavedTick] = useState(0);
  /* Instrument layout: left rail with library + template browser, and a
     proper export dialog instead of a dropdown. */
  const [railTab, setRailTab] = useState("diagrams");
  const [railOpen, setRailOpen] = useState(!isMobile);
  /* Pass 4: toolbar state. paneLayout toggles the work area between
     side-by-side and stacked (desktop); sourceOpen collapses the source
     pane so the preview gets the full width. */
  const [paneLayout, setPaneLayout] = useState("side");
  const [sourceOpen, setSourceOpen] = useState(true);
  /* Evidence inspector: deliberately absent from this studio. Mermaid
     renders raw source text — nodes carry no provenance, and this
     component receives no sources to link citation markers against.
     Parsing 【1】-style markers out of node labels and pretending they
     open papers would be fabricated evidence. FlowchartStudio owns
     selNode/selSource and is the surface that can carry an inspector. */
  const svgHostRef = useRef(null);
  const previewRef = useRef(null);
  const fileRef = useRef(null);
  const renderSeq = useRef(0);
  const dragRef = useRef(null);
  const autoFitDone = useRef(false);
  const dark = P.dark;

  /* Lazy-load the diagram engine: the main bundle never pays for it. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = await import("mermaid");
        if (cancelled) return;
        const mermaid = mod.default;
        mermaid.initialize({
          startOnLoad: false,
          /* strict: diagram source is untrusted text and is never allowed
             to run scripts, no matter what a pasted .mmd contains. */
          securityLevel: "strict",
          theme: "base",
          themeVariables: {
            darkMode: dark,
            background: "transparent",
            primaryColor: dark ? "#1c1c21" : "#ffffff",
            primaryBorderColor: accent,
            primaryTextColor: P.ink,
            secondaryColor: dark ? "#26262c" : "#f1f0ec",
            tertiaryColor: dark ? "#131316" : "#e9e7e2",
            lineColor: P.faint,
            textColor: P.ink,
            mainBkg: dark ? "#1c1c21" : "#ffffff",
            nodeBkg: dark ? "#1c1c21" : "#ffffff",
            nodeBorder: accent,
            clusterBkg: dark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.025)",
            clusterBorder: P.line2,
            titleColor: P.ink,
            edgeLabelBackground: dark ? "#131316" : "#f4f3ef",
            actorBkg: dark ? "#1c1c21" : "#ffffff",
            actorBorder: accent,
            actorTextColor: P.ink,
            signalColor: P.ink,
            signalTextColor: P.ink,
            labelBoxBkgColor: dark ? "#1c1c21" : "#ffffff",
            labelBoxBorderColor: P.line2,
            labelTextColor: P.ink,
            pie1: accent,
          },
          flowchart: { htmlLabels: true, curve: "basis", padding: 12 },
        });
        setMm(mermaid);
      } catch (e) {
        if (!cancelled) setMmError("The diagram engine could not be loaded. Check your connection and reload.");
      }
    })();
    return () => { cancelled = true; };
  }, [dark, accent, P.ink, P.faint, P.line2]);

  /* Debounced live render. */
  useEffect(() => {
    if (!mm) return;
    /* A blank source is the guided empty state, not a render — clear any
       stale output instead of throwing a syntax error at nothing. */
    if (!code.trim()) {
      setSvg("");
      setDiagError(null);
      setRendering(false);
      return;
    }
    setRendering(true);
    const t = setTimeout(() => {
      (async () => {
        const id = `mmd-${Date.now().toString(36)}-${(renderSeq.current += 1)}`;
        try {
          const { svg: out } = await mm.render(id, code);
          setSvg(out);
          setDiagError(null);
        } catch (e) {
          const msg = e && e.message ? String(e.message) : "Could not render this diagram.";
          setDiagError(msg.split("\n").slice(0, 5).join("\n"));
        } finally {
          setRendering(false);
        }
      })();
    }, 450);
    return () => clearTimeout(t);
  }, [code, mm]);

  /* Push rendered SVG into the canvas host (outside React's diffing so
     mermaid's markup is never re-parsed), then auto-fit once. */
  useEffect(() => {
    if (svgHostRef.current) svgHostRef.current.innerHTML = svg;
    if (svg && !autoFitDone.current) {
      autoFitDone.current = true;
      const host = svgHostRef.current;
      const wrap = previewRef.current;
      const svgEl = host && host.querySelector("svg");
      if (svgEl && wrap) {
        const vb = svgEl.viewBox && svgEl.viewBox.baseVal;
        const w = (vb && vb.width) || 800;
        const h = (vb && vb.height) || 600;
        const pad = 56;
        const k = Math.max(0.2, Math.min((wrap.clientWidth - pad) / w, (wrap.clientHeight - pad) / h, 2.5));
        setPan({
          k,
          x: Math.max(20, (wrap.clientWidth - w * k) / 2),
          y: Math.max(20, (wrap.clientHeight - h * k) / 2),
        });
      }
    }
  }, [svg]);

  const fitToView = useCallback(() => {
    const host = svgHostRef.current;
    const wrap = previewRef.current;
    const svgEl = host && host.querySelector("svg");
    if (!svgEl || !wrap || !wrap.clientWidth) return;
    autoFitDone.current = true;
    const vb = svgEl.viewBox && svgEl.viewBox.baseVal;
    const w = (vb && vb.width) || 800;
    const h = (vb && vb.height) || 600;
    const pad = 56;
    const k = Math.max(0.2, Math.min((wrap.clientWidth - pad) / w, (wrap.clientHeight - pad) / h, 2.5));
    setPan({
      k,
      x: Math.max(20, (wrap.clientWidth - w * k) / 2),
      y: Math.max(20, (wrap.clientHeight - h * k) / 2),
    });
  }, []);

  /* Wheel zoom needs a native non-passive listener to preventDefault. */
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      autoFitDone.current = true;
      setPan((p) => ({ ...p, k: Math.min(3, Math.max(0.2, p.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12))) }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onPreviewDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // Never start a canvas drag (or steal pointer capture) from an interactive
    // element: pointer capture retargets the click to the canvas, which silently
    // kills zoom/Fit button clicks.
    if (e.target && e.target.closest && e.target.closest("button, a, input, select, textarea, [contenteditable='true']")) return;
    dragRef.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (cbErr) { console.error("[Cerebrum] flowcharts.jsx onPreviewDown: e.currentTarget.setPointerCapture(e.pointerId); }:", cbErr); }
  };
  const onPreviewMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    autoFitDone.current = true;
    setPan((p) => ({ ...p, x: d.px + (e.clientX - d.sx), y: d.py + (e.clientY - d.sy) }));
  };
  const onPreviewUp = () => { dragRef.current = null; };

  /* Draft autosave + library persistence. */
  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(MM_DRAFT_KEY, JSON.stringify({ code, title, activeId, updatedAt: Date.now() })); } catch (cbErr) { console.error("[Cerebrum] flowcharts.jsx onPreviewUp: localStorage.setItem(MM_DRAFT_KEY, JSON.stringify({ code, title, activ:", cbErr); }
    }, 800);
    return () => clearTimeout(t);
  }, [code, title, activeId]);
  useEffect(() => {
    try { localStorage.setItem(MM_STORE_KEY, JSON.stringify(diagrams)); } catch (cbErr) { console.error("[Cerebrum] flowcharts.jsx onPreviewUp: localStorage.setItem(MM_STORE_KEY, JSON.stringify(diagrams)); }:", cbErr); }
  }, [diagrams]);

  const saveDiagram = useCallback(() => {
    const id = activeId || `mmd-${Date.now().toString(36)}`;
    const rec = { id, title: title.trim() || "Untitled diagram", code, updatedAt: Date.now() };
    setDiagrams((ds) => [{ ...rec }, ...ds.filter((d) => d.id !== id)].slice(0, 60));
    setActiveId(id);
    setSavedTick((t) => t + 1);
  }, [activeId, title, code]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveDiagram(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveDiagram]);

  /* .mmd import: verbatim. The studio never reformats your source. */
  const onImportFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      const text = String(r.result || "").replace(/^\uFEFF/, "");
      setCode(text);
      setTitle(f.name.replace(/\.(mmd|mermaid|txt)$/i, "") || "Imported diagram");
      setActiveId(null);
      autoFitDone.current = false;
      if (isMobile) setMobilePane("preview");
    };
    r.readAsText(f);
    e.target.value = "";
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch (cbErr) { console.error("[Cerebrum] flowcharts.jsx copyCode: document.execCommand('copy'); }:", cbErr); }
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const downloadBlob = (name, blob) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  const slug = fcSlug(title);
  const exportSVG = () => {
    const el = svgHostRef.current && svgHostRef.current.querySelector("svg");
    if (!el) return;
    const str = new XMLSerializer().serializeToString(el);
    downloadBlob(`${slug}.svg`, new Blob([str], { type: "image/svg+xml;charset=utf-8" }));
  };
  const exportMMD = () => { download(`${slug}.mmd`, code); };
  const exportPNG = async () => {
    const el = svgHostRef.current && svgHostRef.current.querySelector("svg");
    if (!el) return;
    // 2026-09-14: Surface export failures. The empty catch left the menu
    // closing with no file and no feedback.
    try {
      const clone = el.cloneNode(true);
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      const str = new XMLSerializer().serializeToString(clone);
      const url = URL.createObjectURL(new Blob([str], { type: "image/svg+xml;charset=utf-8" }));
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("image decode failed")); img.src = url; });
      const vb = el.viewBox && el.viewBox.baseVal;
      const w = Math.max(1, Math.round((vb && vb.width) || img.naturalWidth || 800));
      const h = Math.max(1, Math.round((vb && vb.height) || img.naturalHeight || 600));
      const scale = 3;
      const canvas = document.createElement("canvas");
      canvas.width = w * scale;
      canvas.height = h * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas unavailable");
      ctx.fillStyle = dark ? "#101013" : "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
      if (!blob) throw new Error("PNG encoding failed");
      downloadBlob(`${slug}.png`, blob);
    } catch (e) { toast(e?.message || "Couldn't export the PNG. Try again.", { tone: "error" }); }
  };

  const diagramKind = useMemo(() => {
    const line = (code.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("%%")) || "");
    const head = line.split(/\s+/)[0] || "";
    const known = {
      flowchart: "Flowchart", graph: "Flowchart", sequenceDiagram: "Sequence",
      classDiagram: "Class", "stateDiagram-v2": "State", stateDiagram: "State",
      erDiagram: "ER", gantt: "Gantt", pie: "Pie", mindmap: "Mindmap",
      timeline: "Timeline", journey: "Journey", gitGraph: "Git graph",
    };
    return known[head] || (head ? head : "Diagram");
  }, [code]);

  const loadTemplate = (t) => {
    setCode(t.code);
    setTitle(t.name);
    setActiveId(null);
    autoFitDone.current = false;
    if (isMobile) setMobilePane("preview");
  };
  const openDiagram = (d) => {
    setCode(d.code);
    setTitle(d.title);
    setActiveId(d.id);
    autoFitDone.current = false;
  };
  const deleteDiagram = (id) => {
    setDiagrams((ds) => ds.filter((d) => d.id !== id));
    if (activeId === id) setActiveId(null);
  };
  const newDiagram = () => {
    setCode(MM_DEFAULT_CODE);
    setTitle("Untitled diagram");
    setActiveId(null);
    autoFitDone.current = false;
  };

  const paneLabel = {
    fontSize: FONT_SIZES.micro, fontWeight: 700, letterSpacing: TRACKING.eyebrow, textTransform: "uppercase",
    color: P.faint, fontFamily: "var(--cb-font)", padding: "12px 16px",
    borderBottom: `1px solid ${P.line}`, display: "flex", alignItems: "center", gap: 8, flexShrink: 0,
  };
  /* Ruled lines, not dots: the canvas reads as a working surface, and the
     diagram stays the figure against it. */
  const ruledBg = dark
    ? "repeating-linear-gradient(to bottom, transparent 0, transparent 27px, rgba(255,255,255,0.05) 27px, rgba(255,255,255,0.05) 28px)"
    : "repeating-linear-gradient(to bottom, transparent 0, transparent 27px, rgba(0,0,0,0.055) 27px, rgba(0,0,0,0.055) 28px)";
  const status = mmError
    ? { dot: "#f87171", text: "Engine failed to load" }
    : !mm ? { dot: P.faint, text: "Loading engine…" }
    : rendering ? { dot: accent, text: "Rendering…" }
    : diagError ? { dot: "#f87171", text: "Syntax error" }
    : !code.trim() ? { dot: P.faint, text: "Empty canvas" }
    : { dot: "#4ade80", text: "Rendered" };
  /* Save state, derived — never asserted. A diagram is "Up to date" when
     the working code and title match its saved record (or the blank
     default for a new diagram); anything else is "Unsaved changes".
     Saving or opening a diagram re-syncs it, so no extra state is needed.
     A render error outranks both: it is the thing that needs attention. */
  const dirty = (() => {
    if (!activeId) return code !== MM_DEFAULT_CODE || title !== "Untitled diagram";
    const rec = diagrams.find((d) => d.id === activeId);
    if (!rec) return true;
    return rec.code !== code || rec.title !== (title.trim() || "Untitled diagram");
  })();
  const saveStatus = diagError
    ? { dot: "#f87171", text: "Syntax error" }
    : dirty
      ? { dot: STATUS.warn, text: "Unsaved changes" }
      : { dot: "#4ade80", text: "Up to date" };

  const railTabBtn = (key, label) => (
    <UIButton P={P} variant="ghost" key={key} onClick={() => setRailTab(key)}
      style={{
        flex: 1, minHeight: 44, border: 0, cursor: "pointer", fontFamily: "var(--cb-font)",
        fontSize: FONT_SIZES.small, fontWeight: 600,
        color: railTab === key ? P.ink : P.faint,
        background: "transparent",
        borderBottom: `2px solid ${railTab === key ? accent : "transparent"}`,
      }}>
      {label}
    </UIButton>
  );

  const railItem = {
    display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "12px 12px",
    borderRadius: 12, background: "transparent", border: 0, color: P.ink,
    fontSize: FONT_SIZES.small, cursor: "pointer", textAlign: "left",
    fontFamily: "var(--cb-font)", minHeight: 44,
  };

  const rail = (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%" }}>
      <div style={{ display: "flex", borderBottom: `1px solid ${P.line}`, flexShrink: 0 }}>
        {railTabBtn("diagrams", `Diagrams${diagrams.length ? ` (${diagrams.length})` : ""}`)}
        {railTabBtn("templates", "Templates")}
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 10, minHeight: 0 }}>
        {railTab === "diagrams" && (
          <>
            <button onClick={newDiagram} style={{ ...railItem, borderRadius: 6, border: `1px dashed ${P.line2}`, justifyContent: "center", color: accent, fontWeight: 600, marginBottom: 8 }}>
              <span aria-hidden="true">＋</span> New diagram
            </button>
            <button onClick={() => fileRef.current && fileRef.current.click()} title="Import a .mmd file — loaded verbatim"
              style={{ ...railItem, borderRadius: 6, border: `1px dashed ${P.line2}`, justifyContent: "center", color: P.ink2, fontWeight: 600, marginBottom: 8 }}>
              <span aria-hidden="true">⤒</span> Import .mmd
            </button>
            {diagrams.length === 0 && (
              <div style={{ padding: "12px 4px", fontSize: FONT_SIZES.caption, color: P.faint, fontFamily: "var(--cb-font)", lineHeight: 1.5 }}>
                Nothing saved yet. Press ⌘S or Ctrl+S any time to keep the diagram you are working on.
              </div>
            )}
            {diagrams.map((d) => (
              <div key={d.id} className="mm-railitem" style={{ display: "flex", alignItems: "center", borderRadius: 12, background: d.id === activeId ? withAlpha(accent, 0.08) : "transparent" }}>
                <button onClick={() => { openDiagram(d); if (isMobile) setRailOpen(false); }} style={{ ...railItem, flex: 1, minWidth: 0 }} title={d.code.slice(0, 120)}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", fontWeight: d.id === activeId ? 600 : 400 }}>{d.title}</span>
                    <span style={{ display: "block", fontSize: FONT_SIZES.micro, color: P.faint, marginTop: 2 }}>
                      {new Date(d.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {d.code.split("\n").length} lines
                    </span>
                  </span>
                  {d.id === activeId && <span style={{ color: accent, fontSize: 10, flexShrink: 0 }} aria-label="Open">●</span>}
                </button>
                <button onClick={() => deleteDiagram(d.id)} aria-label={`Delete ${d.title}`} title="Delete"
                  className="mm-rail-del"
                  style={{ background: "transparent", border: 0, color: P.faint, cursor: "pointer", minWidth: 44, minHeight: 44, fontSize: 14, opacity: 0.45 }}>
                  ✕
                </button>
              </div>
            ))}
          </>
        )}
        {railTab === "templates" && (
          <>
            <div style={{ padding: "4px 4px 12px", fontSize: FONT_SIZES.caption, color: P.faint, fontFamily: "var(--cb-font)", lineHeight: 1.5 }}>
              Start from a structure. Your source stays fully editable.
            </div>
            {MERMAID_TEMPLATES.map((t) => (
              <button key={t.key} onClick={() => { loadTemplate(t); if (isMobile) setRailOpen(false); }} className="mm-railitem" style={{ ...railItem, marginBottom: 2 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: accent, flexShrink: 0 }} aria-hidden="true" />
                <span style={{ flex: 1 }}>{t.name}</span>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: isMobile ? "calc(100dvh - 150px)" : "calc(100dvh - 110px)", minWidth: 0 }}>
      <style>{`
        .mm-kw { color: ${accent}; font-weight: 600; }
        .mm-st { color: ${dark ? "#a5d6a7" : "#2e7d32"}; }
        .mm-cm { color: ${P.faint}; font-style: italic; }
        .mm-ar { color: ${dark ? "#7dd3fc" : "#0369a1"}; font-weight: 600; }
        .mm-zoombtn { width: 44px; height: 44px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; background: ${P.surface}; border: 1px solid ${P.line2}; color: ${P.ink}; cursor: pointer; font-size: 16px; font-family: var(--cb-font); transition: border-color 0.2s ease, background-color 0.2s ease, color 0.2s ease, filter 0.2s ease; }
        .mm-zoombtn:hover { border-color: ${accent}; color: ${accent}; }
        .mm-railitem { transition: background 0.15s ease; }
        .mm-railitem:hover { background: ${dark ? "rgba(255,255,255,0.045)" : "rgba(0,0,0,0.035)"} !important; }
        .mm-rail-del { transition: opacity 0.15s ease; }
        .mm-railitem:hover .mm-rail-del { opacity: 1 !important; }
        .mm-topbtn { min-height: 44px; display: inline-flex; align-items: center; gap: 7px; padding: 0 14px; border-radius: 6px; font-size: ${FONT_SIZES.small}px; font-weight: 600; font-family: var(--cb-font); cursor: pointer; border: 1px solid ${P.line2}; background: ${P.dark ? "rgba(255,255,255,0.05)" : "#ffffff"}; color: ${P.ink}; white-space: nowrap; transition: border-color 0.2s ease, background-color 0.2s ease, color 0.2s ease, filter 0.2s ease; }
        .mm-topbtn:hover { border-color: ${accent}; background: ${P.dark ? "rgba(255,255,255,0.09)" : "#f4f4f2"}; }
        .mm-topbtn-primary { background: ${accent}; border-color: transparent; color: ${at}; }
        .mm-topbtn-primary:hover { background: ${accent}; border-color: transparent; filter: brightness(1.06); }
        /* Source pane focus: the textarea suppresses its own outline (the
           highlight layer sits under it), so the pane carries the
           keyboard-visible edge. !important wins over the inline border
           shorthand; same for the title input below. */
        .mm-srcpane:focus-within { border-color: ${withAlpha(accent, 0.45)} !important; }
        .mm-titleinput:focus { border-color: ${withAlpha(accent, 0.5)} !important; }
        /* Canvas loading hairline: a marker travels the 120px line and
           drains back — transform only, and still under reduced motion. */
        .mm-loadbar { animation: mmLoad 1.6s ease-in-out infinite; }
        @keyframes mmLoad {
          0% { transform: scaleX(0); transform-origin: 0 50%; }
          55% { transform: scaleX(1); transform-origin: 0 50%; }
          56% { transform-origin: 100% 50%; }
          100% { transform: scaleX(0); transform-origin: 100% 50%; }
        }
        @media (prefers-reduced-motion: reduce) { .mm-loadbar { animation: none; opacity: 0.4; } }
        /* Saved-line settle: the span remounts on each save (key), so the
           entrance replays — no timers, no behavior change. */
        .mm-saved { animation: mmSavedIn 0.3s ease both; }
        @keyframes mmSavedIn { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: none; } }
      `}</style>

      {/* ── Top bar: instrument chrome ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: isMobile ? "12px 14px" : "14px 24px", borderBottom: `1px solid ${P.line}`, flexShrink: 0, flexWrap: "wrap" }}>
        <UIButton P={P} variant="ghost" onClick={() => setRailOpen((v) => !v)} aria-label={railOpen ? "Hide side panel" : "Show side panel"} title={railOpen ? "Hide side panel" : "Show side panel"}
          style={{ minHeight: 44, minWidth: 44, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "transparent", border: `1px solid ${P.line}`, borderRadius: 6, color: P.ink2, cursor: "pointer", flexShrink: 0 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <line x1="9.5" y1="4" x2="9.5" y2="20" />
          </svg>
        </UIButton>
        <span style={{ display: "inline-flex", padding: 8, borderRadius: 12, background: withAlpha(accent, 0.1), border: `1px solid ${withAlpha(accent, 0.25)}`, flexShrink: 0 }}>
          <StudioMark size={22} accent={accent} />
        </span>
        <div style={{ minWidth: 0, flexShrink: 0 }}>
          <div style={{ fontFamily: "var(--cb-font)", fontWeight: 700, fontSize: FONT_SIZES.small, color: P.ink, letterSpacing: "-0.015em", lineHeight: 1.25 }}>Diagram Studio</div>
          <div style={{ fontSize: FONT_SIZES.micro, color: P.faint, fontFamily: "var(--cb-font)" }}>Mermaid, rendered live</div>
        </div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Diagram title" placeholder="Untitled diagram"
          className="mm-titleinput"
          style={{
            marginLeft: 4, flex: "1 1 160px", minWidth: 120, maxWidth: 320, background: "transparent",
            border: `1px solid ${P.line}`, borderRadius: 8, padding: "8px 12px", minHeight: 44,
            color: P.ink, fontSize: 16, fontFamily: "var(--cb-font)", outline: "none",
          }} />
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto", flexShrink: 0 }}>
          {/* The toolbar is four actions: arrange the panes, take the
              diagram out as SVG, save it, and toggle the source. Import
              lives in the library rail; Copy lives on the source pane;
              PNG and .mmd live in the status bar. */}
          {!isMobile && (
            <button className="mm-topbtn" onClick={() => setPaneLayout((v) => v === "side" ? "stack" : "side")}
              title={paneLayout === "side" ? "Stack source above preview" : "Show source beside preview"}
              aria-pressed={paneLayout === "stack"}>
              Layout
            </button>
          )}
          <button className="mm-topbtn" onClick={() => { exportSVG(); logExport("SVG", `${slug}.svg`); }} disabled={!svg}
            title="Download as SVG vector" style={!svg ? { opacity: 0.5, cursor: "not-allowed" } : undefined}>
            Export SVG
          </button>
          <button className="mm-topbtn" onClick={() => {
              if (isMobile) setMobilePane(mobilePane === "code" ? "preview" : "code");
              else setSourceOpen((v) => !v);
            }}
            title={isMobile ? "Switch between source and preview" : (sourceOpen ? "Hide the source pane" : "Show the source pane")}
            aria-pressed={isMobile ? mobilePane === "code" : sourceOpen}>
            Edit source
          </button>
          <button className="mm-topbtn mm-topbtn-primary" onClick={saveDiagram} title="Save (⌘S / Ctrl+S)">
            Save
          </button>
        </div>
      </div>

      {/* ── Body: rail + work area ── */}
      <div style={{ flex: 1, display: "flex", minHeight: 0, minWidth: 0 }}>
        {!isMobile && railOpen && (
          <aside style={{ width: 288, flexShrink: 0, borderRight: `1px solid ${P.line}`, background: P.surface, minHeight: 0 }} aria-label="Diagram library and templates">
            {rail}
          </aside>
        )}

        <div style={{ flex: 1, display: "flex", flexDirection: isMobile || paneLayout === "stack" ? "column" : "row", minWidth: 0, minHeight: 0 }}>
          {/* Mobile pane switch */}
          {isMobile && (
            <div style={{ display: "flex", gap: 6, padding: "12px 16px 0", flexShrink: 0 }}>
              {[["code", "Code"], ["preview", "Preview"]].map(([key, label]) => (
                <UIButton P={P} variant="ghost" key={key} onClick={() => setMobilePane(key)}
                  style={{
                    minHeight: 44, flex: 1, padding: "9px 0", borderRadius: 6,
                    fontSize: FONT_SIZES.small, fontWeight: 600, fontFamily: "var(--cb-font)", cursor: "pointer",
                    background: mobilePane === key ? withAlpha(accent, 0.14) : "transparent",
                    color: mobilePane === key ? accent : P.faint,
                    border: `1px solid ${mobilePane === key ? withAlpha(accent, 0.4) : P.line}`,
                  }}>
                  {label}
                </UIButton>
              ))}
            </div>
          )}

          {/* Editor pane */}
          <section aria-label="Diagram source" className="mm-srcpane" style={{
            display: isMobile ? (mobilePane === "code" ? "flex" : "none") : (sourceOpen ? "flex" : "none"),
            flexDirection: "column", flex: isMobile ? 1 : "0 0 42%", minWidth: 0, minHeight: 0,
            borderRight: isMobile || paneLayout === "stack" || !sourceOpen ? "none" : `1px solid ${P.line}`,
            borderBottom: !isMobile && paneLayout === "stack" && sourceOpen ? `1px solid ${P.line}` : "none",
            margin: isMobile ? "10px 14px 0" : 0,
            border: isMobile ? `1px solid ${P.line}` : undefined,
            borderRadius: isMobile ? 12 : 0, overflow: "hidden",
            background: P.surface,
          }}>
            <div style={paneLabel}>
              <span>Source</span>
              <button onClick={copyCode} title="Copy diagram source"
                style={{ minHeight: 44, padding: "6px 12px", background: "none", border: "none", cursor: "pointer", fontSize: FONT_SIZES.micro, fontWeight: 700, letterSpacing: TRACKING.eyebrow, textTransform: "uppercase", color: P.faint, fontFamily: "var(--cb-font)" }}>
                {copied ? "Copied ✓" : "Copy"}
              </button>
              <span style={{ marginLeft: "auto", fontWeight: 400, letterSpacing: TRACKING.tight, textTransform: "none" }}>{diagramKind} · {code.split("\n").length} lines</span>
            </div>
            <MMCodeEditor P={P} accent={accent} code={code} onChange={(v) => { setCode(v); }} />
          </section>

          {/* Preview pane */}
          <section aria-label="Diagram preview" style={{
            display: isMobile ? (mobilePane === "preview" ? "flex" : "none") : "flex",
            flex: 1, flexDirection: "column", minWidth: 0, minHeight: isMobile ? 420 : 0, position: "relative",
            margin: isMobile ? "10px 14px 0" : 0,
            border: isMobile ? `1px solid ${P.line}` : "none",
            borderRadius: isMobile ? 12 : 0, overflow: "hidden",
            background: P.surface,
          }}>
            <div style={paneLabel}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: status.dot }} aria-hidden="true" />
              <span>{status.text}</span>
              <span style={{ marginLeft: "auto", fontWeight: 400, letterSpacing: TRACKING.tight, textTransform: "none" }}>{Math.round(pan.k * 100)}%</span>
            </div>
            <div ref={previewRef}
              onPointerDown={onPreviewDown} onPointerMove={onPreviewMove} onPointerUp={onPreviewUp} onPointerCancel={onPreviewUp}
              style={{
                flex: 1, minHeight: 0, overflow: "hidden", position: "relative", cursor: "grab",
                touchAction: "none", backgroundImage: ruledBg,
              }}>
              <div ref={svgHostRef} style={{
                position: "absolute", left: 0, top: 0,
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${pan.k})`, transformOrigin: "0 0",
                pointerEvents: "none",
              }} />
              {mmError && (
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" }}>
                  <div style={{ fontSize: FONT_SIZES.small, color: P.ink2, fontFamily: "var(--cb-font)", maxWidth: 320 }}>{mmError}</div>
                </div>
              )}
              {/* Guided empty canvas: a blank source is a starting point, not a
                  render. Three real template buttons (wired to loadTemplate —
                  never dead) plus the Import hint, instead of "Rendering…". */}
              {!mmError && !code.trim() && (
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
                  <div style={{ textAlign: "center", maxWidth: 320 }}>
                    <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
                      <StudioMark size={28} accent={accent} />
                    </div>
                    <div style={{ fontSize: FONT_SIZES.small, color: P.ink2, fontFamily: "var(--cb-font)", marginBottom: 14 }}>
                      Describe a structure to see it
                    </div>
                    <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginBottom: 12 }}>
                      {[["flowchart", "Flowchart"], ["sequence", "Sequence"], ["mindmap", "Mindmap"]].map(([tkey, tlabel]) => {
                        const t = MERMAID_TEMPLATES.find((x) => x.key === tkey);
                        return t ? (
                          <button key={tkey} type="button" className="mm-topbtn" onClick={() => loadTemplate(t)}>
                            {tlabel}
                          </button>
                        ) : null;
                      })}
                    </div>
                    <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, fontFamily: "var(--cb-font)" }}>
                      or paste .mmd with Import
                    </div>
                  </div>
                </div>
              )}
              {!mmError && code.trim() && !svg && !diagError && (
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div style={{ fontSize: FONT_SIZES.small, color: P.faint, fontFamily: "var(--cb-font)" }}>
                      {mm ? "Rendering…" : "Loading diagram engine…"}
                    </div>
                    <div style={{ marginTop: 12, width: 120, height: 1, background: P.line, position: "relative", overflow: "hidden" }}>
                      <div className="mm-loadbar" style={{ position: "absolute", inset: 0, background: accent }} />
                    </div>
                  </div>
                </div>
              )}
              {diagError && (
                <div style={{
                  position: "absolute", top: 12, left: 12, right: 12, padding: "12px 16px", borderRadius: 12,
                  background: dark ? "rgba(60,16,16,0.92)" : "rgba(254,226,226,0.96)",
                  border: "1px solid rgba(248,113,113,0.5)", zIndex: Z.float,
                }}>
                  <div style={{ fontSize: FONT_SIZES.small, fontWeight: 700, color: dark ? "#fca5a5" : "#b91c1c", fontFamily: "var(--cb-font)", marginBottom: 4 }}>
                    Mermaid could not parse this
                  </div>
                  <pre style={{
                    margin: 0, fontSize: FONT_SIZES.caption, fontFamily: MM_FONT, whiteSpace: "pre-wrap",
                    color: dark ? "#fecaca" : "#7f1d1d",
                  }}>{diagError}</pre>
                </div>
              )}
              {/* Zoom controls — 44px targets, live percentage */}
              <div style={{ position: "absolute", right: 12, bottom: 12, display: "flex", gap: 6, alignItems: "center", zIndex: Z.float }}>
                <button className="mm-zoombtn" onClick={() => { autoFitDone.current = true; setPan((p) => ({ ...p, k: Math.max(0.2, p.k / 1.25) })); }} aria-label="Zoom out" title="Zoom out">−</button>
                <button className="mm-zoombtn" onClick={() => { autoFitDone.current = true; setPan((p) => ({ ...p, k: 1 })); }} aria-label="Reset zoom to 100 percent" title="Reset to 100%"
                  style={{ width: "auto", padding: "0 16px", fontSize: FONT_SIZES.small, fontWeight: 600 }}>{Math.round(pan.k * 100)}%</button>
                <button className="mm-zoombtn" onClick={() => { autoFitDone.current = true; setPan((p) => ({ ...p, k: Math.min(3, p.k * 1.25) })); }} aria-label="Zoom in" title="Zoom in">＋</button>
                <button className="mm-zoombtn" onClick={fitToView} aria-label="Fit diagram to view" title="Fit to view" style={{ width: "auto", padding: "0 16px", fontSize: FONT_SIZES.small, fontWeight: 600 }}>Fit</button>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* ── Status bar ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 14, padding: isMobile ? "10px 14px" : "10px 24px",
        borderTop: `1px solid ${P.line}`, flexShrink: 0, flexWrap: "wrap",
        fontSize: FONT_SIZES.caption, color: P.faint, fontFamily: "var(--cb-font)",
      }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: saveStatus.dot }} aria-hidden="true" />
          {saveStatus.text}
        </span>
        {savedTick > 0 && <span key={savedTick} className="mm-saved" style={{ color: accent }}>✓ Saved to your diagrams</span>}
        <span style={{ flex: 1 }} />
        <button onClick={() => { exportPNG(); logExport("PNG", `${slug}.png`); }} disabled={!svg}
          title="Export 3× PNG" style={{ minHeight: 44, padding: "6px 4px", background: "none", border: "none", cursor: svg ? "pointer" : "not-allowed", fontSize: FONT_SIZES.caption, color: P.faint, fontFamily: "var(--cb-font)", opacity: svg ? 1 : 0.5 }}>
          PNG
        </button>
        <button onClick={() => { exportMMD(); logExport("MMD", `${slug}.mmd`); }}
          title="Download the source (.mmd)" style={{ minHeight: 44, padding: "6px 4px", background: "none", border: "none", cursor: "pointer", fontSize: FONT_SIZES.caption, color: P.faint, fontFamily: "var(--cb-font)" }}>
          .mmd
        </button>
        <span>Drag to pan · Scroll to zoom · ⌘S saves</span>
      </div>

      {/* ── Export dialog ── */}

      {/* ── Mobile rail drawer ── */}
      {isMobile && railOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: Z.menu }}>
          <div onClick={() => setRailOpen(false)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }} aria-hidden="true" />
          <div style={{
            position: "absolute", top: 0, bottom: 0, left: 0, width: "min(320px, 85vw)",
            background: P.surface, borderRight: `1px solid ${P.line2}`,
            boxShadow: "24px 0 60px rgba(0,0,0,0.35)",
          }} role="dialog" aria-label="Diagram library and templates">
            <div style={{ display: "flex", alignItems: "center", padding: "12px 10px 0" }}>
              <UIButton P={P} variant="ghost" onClick={() => setRailOpen(false)} aria-label="Close panel"
                style={{ minWidth: 44, minHeight: 44, background: "transparent", border: 0, color: P.faint, fontSize: 16, cursor: "pointer", marginLeft: "auto" }}>✕</UIButton>
            </div>
            <div style={{ height: "calc(100% - 54px)" }}>{rail}</div>
          </div>
        </div>
      )}

      <input ref={fileRef} type="file" accept=".mmd,.mermaid,.txt,text/plain" onChange={onImportFile} style={{ display: "none" }} aria-hidden="true" tabIndex={-1} />
    </div>
  );
}



function ChromeHeader({ eyebrow, title, onClose, accent, label, drawer = false, P = null }) {
  // P provided (drawers) → theme-aware ink; otherwise the dark
  // instrument-glass treatment of centered modals.
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
            fontFamily: "var(--cb-font)", fontSize: FONT_SIZES.micro, fontWeight: 700,
            letterSpacing: TRACKING.eyebrowWide, textTransform: "uppercase",
            color: withAlpha(accent, 0.9), marginBottom: 5,
          }}>{eyebrow}</div>
        )}
        {title ? (
        <div style={{
          fontSize: 17, fontWeight: 650, color: ink,
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
          color: subInk, cursor: "pointer", borderRadius: 6,
          width: 44, height: 44, display: "inline-flex", alignItems: "center",
          justifyContent: "center", flexShrink: 0, padding: 0,
        }}
      >
        <span
          style={{
            border: `1px solid ${P ? P.line : "rgba(255,255,255,0.12)"}`,
            background: P ? "transparent" : "rgba(255,255,255,0.05)",
            borderRadius: 6, width: 30, height: 30, display: "inline-flex",
            alignItems: "center", justifyContent: "center", fontSize: 16,
            lineHeight: 1, fontFamily: "var(--cb-font)",
            transition: "background 0.15s ease",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = P ? withAlpha(accent, 0.1) : "rgba(255,255,255,0.12)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = P ? "transparent" : "rgba(255,255,255,0.05)"; }}
        >×</span>
      </UIButton>
    </div>
  );
}

function ModalChrome({ label, eyebrow, title, actions, onClose, accent, zIndex = 220, width = 640, ticks = false, tall = false, drawer = false, P = null, children }) {
  // Drawers are theme-aware (they read like a document); centered modals
  // keep the dark instrument-glass treatment.
  const panelBg = drawer && P ? P.bg : "rgba(15,17,21,0.97)";
  const panelInk = drawer && P ? P.ink : "#f2f4f2";
  const panelBorder = drawer && P ? P.line : "rgba(255,255,255,0.10)";
  return (
    <Dialog
      label={label || title} onClose={onClose} zIndex={zIndex} drawer={drawer}
      width={width} panelClassName={ticks ? "cb-modal cb-specimen" : "cb-modal"}
      panelStyle={drawer ? {
        background: panelBg, borderLeft: `1px solid ${panelBorder}`,
        boxShadow: "-24px 0 80px rgba(0,0,0,0.5)",
        padding: "24px 26px 48px", color: panelInk, fontFamily: "var(--cb-font)",
      } : {
        ...(tall ? { height: "min(760px, 86dvh)" } : {}),
        background: panelBg,
        border: "1px solid rgba(255,255,255,0.10)", borderRadius: 12,
        boxShadow: "0 40px 100px rgba(0,0,0,0.6)",
        padding: "24px 22px 22px", color: panelInk, fontFamily: "var(--cb-font)",
      }}
    >
      <ChromeHeader eyebrow={eyebrow} title={title} onClose={onClose} accent={accent} label={label || title} drawer={drawer} P={drawer ? P : null} />
      {actions && <div style={{ margin: "6px 0 14px" }}>{actions}</div>}
      <div style={{ minHeight: 0, flex: 1, display: "flex", flexDirection: "column" }}>{children}</div>
    </Dialog>
  );
}

export { ChromeHeader, ModalChrome };
export { fcId, mergeFlowcharts, fcSlug, fcSvgString };
