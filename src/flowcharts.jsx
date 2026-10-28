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
import { Icon, UIButton, UISelect, SHADOW, withAlpha, FONT_SIZES, STATUS, Z, TRACKING, RADIUS, TYPE } from "./designSystem.jsx";
import { getCookie, __cbMotionCache, cbMotionCacheSet, download, toast } from "./appUtils.js";
import { cbDialogLockScroll, cbDialogUnlockScroll } from "./scrollLock.js";
import { historyNav } from "./historyNav.js";
import { fcExtractSteps, fcCompressStep, fcLabelFromSentence, fcWrapBounded, fcCoerceStepType, fcStepFromNode, fcStepsFromChart, fcChartSources, fcHasLabelledStep, fcMoveStep, fcChartNeedsConversion, fcSplitSentences, fcBuildChain, FC_LABEL_MAX } from "./fcLabel.js";
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
    /* History: a dismissable dialog is the topmost back layer, so
       the system back action closes it before anything under it.
       A dialog that cannot be dismissed pushes nothing, so a
       consent gate or an import step never gains a back trap.
       The cleanup below closes the layer on unmount: when the
       close came from a pop, the layer is already gone and the
       close is a no op; when it came from the app, closeLayer
       steps the browser back once and the dead layer makes the
       resulting pop a no op too, so neither path can loop. */
    if (dismissable) {
      historyNav.pushLayer("dialog", id, () => { onCloseRef.current(); });
    }

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
      if (dismissable) historyNav.closeLayer("dialog", id);
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
        transition: animate ? "opacity 280ms var(--cb-ease)" : "none",
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
          background: "var(--cb-surface, #16181d)",
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
          transition: animate ? "opacity 280ms var(--cb-ease), transform 280ms var(--cb-ease)" : "none",
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
  const localById = new Map(local.filter((c) => c && c.id).map((c) => [c.id, c]));
  const merged = server.map((c) => {
    if (!c || !c.id) return c;
    const alt = localById.get(c.id);
    if (!alt) return c;
    /* Grounding preservation (mobile lane item 1, 2026 10 23): a copy
       with no sources never overwrites a copy that has them. The
       account copy still wins every other field, but when it carries
       no source list and the browser copy does, the browser sources
       ride along instead of being lost. Direction is kept the same
       way, from whichever copy has it. */
    let out = c;
    if (!(Array.isArray(c.sources) && c.sources.length) && Array.isArray(alt.sources) && alt.sources.length) {
      out = { ...out, sources: alt.sources };
    }
    if (!out.direction && alt.direction) out = { ...out, direction: alt.direction };
    return out;
  });
  const serverIds = new Set(server.map((c) => c && c.id));
  const all = [...merged, ...local.filter((c) => c && !serverIds.has(c.id))];
  all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return all;
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
    // L7-13 (2026-10-23): an empty label means the sentence was unsafe
    // to compress (contrast, negation or comparator qualifier); the
    // step is skipped, not shortened.
    const label = fcLabelFromSentence(st.text);
    if (!label) return;
    // A step that cited a paper is evidence, not prose: ground the node to
    // the real source. Citation indices are 1-based; anything out of range
    // is ignored rather than guessed at.
    const citeIdx = st.cites.find((n) => n >= 1 && n <= srcCount);
    const type = typeof citeIdx === "number" ? "evidence" : "process";
    const n = addStep(type, label, {
      step: i + 1,
      ...(st.text !== label ? { detail: st.text } : {}),
      ...(typeof citeIdx === "number" ? { sourceIdx: citeIdx - 1 } : {}),
    });
    edges.push(fcNewEdge(prev.id, n.id, ""));
    prev = n;
  });
  const end = addStep("end", "End");
  edges.push(fcNewEdge(prev.id, end.id, ""));
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
  accent: "#2e7d52", accentText: "#ffffff", edge: "#232723", decisionFill: "#eef4ef",
  shadow: "#232723",
};
/* The live palette as export colors, built from tokens only. The
   drafting register (composition wave, 2026-10-26): the paper tone
   fill is the raised surface, the edge color carries the ink weight
   the canvas uses, and the shadow color backs the offset copy of
   every node shape. */
function fcPaletteColors(P, accent, at) {
  return {
    bg: P.bg, fill: P.raised, stroke: P.ink2, text: P.ink,
    accent, accentText: at, edge: P.ink2, decisionFill: withAlpha(accent, 0.14),
    shadow: P.ink,
  };
}
function fcNodeSvg(n, colors, index) {
  const C = colors || FC_EXPORT_COLORS;
  const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
  const lines = fcWrapBounded(n.label, Math.max(8, Math.floor((n.w - 30) / 7)), Math.max(1, Math.floor(((n.h || 92) - 18) / 16)));
  const lh = 16;
  const ty = cy - ((lines.length - 1) * lh) / 2 + 5;
  const isAccent = n.type === "start" || n.type === "end";
  const textFill = isAccent ? C.accentText : C.text;
  const text = lines.map((ln, i) => `<text x="${cx}" y="${(ty + i * lh).toFixed(1)}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="13" font-weight="600" fill="${textFill}">${fcEsc(ln)}</text>`).join("");
  const shapeFor = (fill, stroke, sw) => {
    if (n.type === "start" || n.type === "end") {
      return `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${n.h / 2}" fill="${fill}"/>`;
    }
    if (n.type === "decision") {
      return `<polygon points="${cx},${n.y} ${n.x + n.w},${cy} ${cx},${n.y + n.h} ${n.x},${cy}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
    }
    if (n.type === "io") {
      const s = 22;
      return `<polygon points="${n.x + s},${n.y} ${n.x + n.w},${n.y} ${n.x + n.w - s},${n.y + n.h} ${n.x},${n.y + n.h}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
    }
    return `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
  };
  const mainFill = isAccent ? C.accent : n.type === "decision" ? C.decisionFill : C.fill;
  const mainStroke = isAccent ? C.accent : n.type === "decision" || n.type === "evidence" ? C.accent : C.stroke;
  const shape = shapeFor(mainFill, mainStroke, 2);
  const spine = n.type === "evidence" ? `<rect x="${n.x}" y="${n.y}" width="5" height="${n.h}" rx="2.5" fill="${C.accent}"/>` : "";
  const shadow = `<g transform="translate(4 4)" opacity="0.16">${shapeFor(C.shadow || C.stroke, "none", 0)}</g>`;
  const badge = !isAccent && typeof index === "number"
    ? `<circle cx="${n.x}" cy="${n.y}" r="10.5" fill="${C.stroke}"/><text x="${n.x}" y="${n.y + 3.5}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="11" font-weight="500" fill="${C.bg}">${index + 1}</text>`
    : "";
  return `<g>${shadow}${shape}${spine}${badge}${text}</g>`;
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
    return `<path d="${g.d}" fill="none" stroke="${C.edge}" stroke-width="2" marker-end="url(#fcArrow)"/>${lbl}`;
  }).join("");
  const nodeSvg = nodes.map((n, i) => fcNodeSvg(n, C, i)).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(b.w)}" height="${Math.ceil(b.h)}" viewBox="${b.x} ${b.y} ${b.w} ${b.h}"><title>${fcEsc(title || "Untitled diagram")}</title><defs><marker id="fcArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" fill="${C.edge}"/></marker></defs><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${C.bg}"/>${edgeSvg}${nodeSvg}</svg>`;
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
  const lines = [`# ${title || "Untitled diagram"}`, ""];
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
function FcNodeShape({ n, P, accent, selected, pending, index }) {
  const cx = n.w / 2, cy = n.h / 2;
  const isAccent = n.type === "start" || n.type === "end";
  /* Composition wave, 2026-10-26: the canvas carries a drafting
     register of its own instead of borrowing the app chrome. Plain
     steps sit on the raised paper tone with an ink weight stroke and
     a hard offset shadow, and every step wears its number in a disc
     at its corner, the same number the step list beside the canvas
     uses. Decision and evidence steps keep their accent language on
     top of that register. The export mirror in fcNodeSvg paints the
     same values, so the file that leaves the app matches the canvas. */
  const fill = isAccent ? accent : n.type === "decision" ? withAlpha(accent, 0.14) : n.type === "evidence" ? withAlpha(accent, 0.12) : P.raised;
  const stroke = selected ? accent : pending ? accent : isAccent ? accent : n.type === "decision" || n.type === "evidence" ? accent : P.ink2;
  const sw = selected || pending ? 2.6 : 2;
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
      {React.cloneElement(shape, { fill: withAlpha(P.ink, 0.16), stroke: "none", transform: "translate(4 4)", pointerEvents: "none" })}
      {React.cloneElement(shape, { fill, stroke, strokeWidth: sw })}
      {n.type === "evidence" && <rect x={0} y={0} width={5} height={n.h} rx={RADIUS.lg} fill={accent} stroke="none" pointerEvents="none" />}
      {!isAccent && typeof index === "number" && (
        <g pointerEvents="none">
          <circle cx={0} cy={0} r={10.5} fill={P.ink} />
          <text x={0} y={3.5} textAnchor="middle" fontSize={11} fontWeight={500} fill={P.bg} fontFamily="var(--cb-font)">{index + 1}</text>
        </g>
      )}
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

/* The step model itself lives in src/fcLabel.js as pure helpers, so
   the grounding contract is testable without a browser. These names
   stay as the studio local spelling of the same functions. */
function dsCoerceType(t) {
  return fcCoerceStepType(t);
}

function dsStepFromNode(n) {
  return fcStepFromNode(n, fcId("s"));
}

/* Order chart nodes along their edges from a root and turn them into
   steps. The walk lives in fcStepsFromChart (src/fcLabel.js). */
function dsStepsFromChart(chart) {
  return fcStepsFromChart(chart, () => fcId("s"));
}

function dsStepsFromDraft(draft) {
  if (!draft || !Array.isArray(draft.nodes)) return [];
  return dsStepsFromChart(draft);
}

/* Turn steps into the node and edge chain the canvas and the exports
   share, through fcBuildChain (src/fcLabel.js). */
function dsBuild(steps, direction) {
  return fcBuildChain(steps, direction, fcNewNode);
}

function dsPaperText(paper) {
  if (!paper) return "";
  return paper.abstract || paper.summary || paper.snippet || "";
}

export function DiagramStudio({ P, accent, at, isMobile, dialog = false, initial = null, docTitle = "", answerText = "", sources = [], latestAnswer = null, savedPapers = [], diagrams = [], onSave = null, onClose = null, tier = "free", resetSignal = 0 }) {
  const bootRef = useRef(null);
  if (bootRef.current === null) {
    const propSources = Array.isArray(sources) ? sources : [];
    let bootSteps = [];
    let bootTitle = "";
    let bootId = null;
    let bootSources = propSources;
    let bootDirection = "down";
    let bootUsedAnswer = false;
    let bootReadOnly = false;
    let bootNote = null;
    if (initial && Array.isArray(initial.nodes)) {
      bootSteps = dsStepsFromChart(initial);
      bootTitle = initial.title || docTitle || "";
      bootId = initial.id || null;
      /* A reopened chart loads with exactly the sources stored on its
         own record. No stored sources means an empty list, never the
         list that happens to be active (huge audit Bugs 2 and 3). */
      bootSources = fcChartSources(initial);
      bootDirection = isMobile ? "down" : (initial.direction === "across" ? "across" : "down");
      bootReadOnly = fcChartNeedsConversion(initial);
    } else if (answerText) {
      bootSteps = dsStepsFromDraft(fcDraftFromAnswer(answerText, propSources));
      bootTitle = docTitle || "";
      bootUsedAnswer = true;
      if (bootSteps.length < 2) {
        bootNote = { text: answerText, sentences: fcSplitSentences(answerText), kind: "answer", sources: propSources, used: [] };
      }
    }
    bootRef.current = { steps: bootSteps, title: bootTitle, id: bootId, sources: bootSources, direction: bootDirection, usedAnswer: bootUsedAnswer, readOnly: bootReadOnly, note: bootNote };
  }
  const boot = bootRef.current;

  const [steps, setSteps] = useState(boot.steps);
  const [title, setTitle] = useState(boot.title);
  const [currentId, setCurrentId] = useState(boot.id);
  const [activeSources, setActiveSources] = useState(boot.sources);
  const [sourceTab, setSourceTab] = useState(null);
  const [direction, setDirection] = useState(boot.direction);
  const [selectedId, setSelectedId] = useState(boot.steps.length ? boot.steps[0].id : null);
  const [paperPick, setPaperPick] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [saveState, setSaveState] = useState("idle");
  const [saveNote, setSaveNote] = useState("");
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const [pendingLoad, setPendingLoad] = useState(null);
  const [extractNote, setExtractNote] = useState(boot.note);
  const [readOnly, setReadOnly] = useState(boot.readOnly);
  const [zoom, setZoom] = useState(1);
  const canvasBoxRef = useRef(null);
  const saveInFlightRef = useRef(false);
  const exportWrapRef = useRef(null);
  const topFocusRef = useRef(null);
  const touchRef = useRef(null);

  const snapOf = (st, ti, so, id, dir, ro) => JSON.stringify({ steps: st, title: ti, sources: so, id, direction: dir, readOnly: ro });
  const baselineRef = useRef(snapOf(boot.steps, boot.title, boot.sources, boot.id, boot.direction, boot.readOnly));
  const currentSnap = () => snapOf(steps, title, activeSources, currentId, direction, readOnly);
  const dirtyRef = useRef(false);
  dirtyRef.current = currentSnap() !== baselineRef.current;
  const dirty = dirtyRef.current;

  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (dirtyRef.current) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  /* The export menu closes when the user taps or clicks anywhere
     else, not only when Export is tapped again (mobile lane item 7). */
  useEffect(() => {
    if (!exportOpen) return;
    const onDoc = (e) => {
      if (exportWrapRef.current && !exportWrapRef.current.contains(e.target)) setExportOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
    };
  }, [exportOpen]);

  /* On a phone the step editor sits above the canvas, so selecting a
     node brings its own row into view instead of changing a panel far
     below the picture (mobile Bug 2). */
  useEffect(() => {
    if (!isMobile || !selectedId) return;
    const el = document.getElementById("ds-step-" + selectedId);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }, [selectedId, isMobile]);

  const built = dsBuild(steps, direction);
  const nodes = built.nodes;
  const edges = built.edges;
  const bounds = fcBounds(nodes, 48);
  const selectedStep = steps.find((s) => s.id === selectedId) || null;
  const selectedSource = selectedStep && typeof selectedStep.sourceIdx === "number" && Array.isArray(activeSources)
    ? activeSources[selectedStep.sourceIdx] || null
    : null;
  const eligiblePapers = (Array.isArray(savedPapers) ? savedPapers : []).filter((paper) => dsPaperText(paper));

  /* Composition wave, 2026-10-26: the empty state shows a real
     example when one exists. The example is the first saved paper the
     studio can already read, run through the same extraction the
     paper loader uses, and opening it is the paper loader itself.
     Nothing is drawn from anywhere else. When no saved source
     exists, or the extraction finds fewer than two steps, the empty
     state stays the plain one it was. */
  const examplePaper = eligiblePapers[0] || null;
  const exampleSteps = examplePaper
    ? fcExtractSteps(dsPaperText(examplePaper), 7).map((st) => ({
        id: fcId("s"),
        label: fcLabelFromSentence(st.text),
        type: "process",
        detail: st.text,
        sourceIdx: 0,
      })).filter((st) => st.label)
    : [];
  const exampleBuilt = exampleSteps.length >= 2 ? dsBuild(exampleSteps, "down") : null;

  const pushHistory = () => {
    setPast((prev) => [...prev.slice(-49), { steps, title, sources: activeSources, id: currentId, direction, readOnly }]);
    setFuture([]);
  };

  const restoreSnap = (snap) => {
    setSteps(snap.steps);
    setTitle(snap.title);
    setActiveSources(snap.sources);
    setCurrentId(snap.id);
    setDirection(snap.direction);
    setReadOnly(snap.readOnly);
    setSelectedId(snap.steps.length ? snap.steps[0].id : null);
    setExtractNote(null);
    setSaveState("idle");
    setSaveNote("");
  };

  const undo = () => {
    if (!past.length) return;
    const target = past[past.length - 1];
    setPast(past.slice(0, -1));
    setFuture((prev) => [...prev, { steps, title, sources: activeSources, id: currentId, direction, readOnly }]);
    restoreSnap(target);
  };

  const redo = () => {
    if (!future.length) return;
    const target = future[future.length - 1];
    setFuture(future.slice(0, -1));
    setPast((prev) => [...prev, { steps, title, sources: activeSources, id: currentId, direction, readOnly }]);
    restoreSnap(target);
  };

  const applySteps = (next) => {
    if (readOnly) return;
    pushHistory();
    setSteps(next);
    setSaveState("idle");
    setSaveNote("");
  };

  /* One load path for every source. It always sets the full state,
     including an empty source list when the thing being loaded has
     none, and it records the loaded state as the saved baseline. */
  const doLoadSteps = (next, opts) => {
    pushHistory();
    const nextSources = Array.isArray(opts.sources) ? opts.sources : [];
    const nextDirection = isMobile ? "down" : (opts.direction === "across" ? "across" : "down");
    const nextReadOnly = !!opts.readOnly;
    setSteps(next);
    setTitle(opts.title || "");
    setActiveSources(nextSources);
    setCurrentId(opts.id || null);
    setDirection(nextDirection);
    setReadOnly(nextReadOnly);
    setSelectedId(next.length ? next[0].id : null);
    setExportOpen(false);
    setSaveState("idle");
    setSaveNote("");
    setExtractNote(opts.note || null);
    baselineRef.current = snapOf(next, opts.title || "", nextSources, opts.id || null, nextDirection, nextReadOnly);
  };

  /* Any load that would replace work that is not saved asks first. */
  const guardLoad = (label, run) => {
    if (dirtyRef.current) setPendingLoad({ label, run });
    else run();
  };
  const guardRef = useRef(guardLoad);
  guardRef.current = guardLoad;

  const noteFor = (text, extracted, kind, srcs) => {
    if (extracted.length >= 2) return null;
    return { text, sentences: fcSplitSentences(text), kind, sources: srcs, used: [] };
  };

  const loadLatest = () => {
    if (!latestAnswer) return;
    guardLoad("your last answer", () => {
      const latestSources = Array.isArray(latestAnswer.sources) ? latestAnswer.sources : [];
      const next = dsStepsFromDraft(fcDraftFromAnswer(latestAnswer.answerText || "", latestSources));
      doLoadSteps(next, { title: latestAnswer.title || "", sources: latestSources, id: null, note: noteFor(latestAnswer.answerText || "", next, "answer", latestSources) });
    });
  };

  const loadPaper = (paper) => {
    guardLoad("that paper", () => {
      const text = dsPaperText(paper);
      const next = fcExtractSteps(text, 7).map((st) => ({
        id: fcId("s"),
        label: fcLabelFromSentence(st.text),
        type: "process",
        detail: st.text,
        sourceIdx: 0,
      })).filter((st) => st.label);
      doLoadSteps(next, { title: paper.title || "", sources: [paper], id: null, note: noteFor(text, next, "paper", [paper]) });
    });
  };

  const loadDiagram = (chart) => {
    guardLoad("that saved diagram", () => {
      const next = dsStepsFromChart(chart);
      doLoadSteps(next, {
        title: chart.title || "",
        sources: fcChartSources(chart),
        id: chart.id || null,
        direction: chart.direction,
        readOnly: fcChartNeedsConversion(chart),
      });
    });
  };

  const resetStudio = () => {
    doLoadSteps([], { title: "", sources: [], id: null, direction: "down" });
    setSourceTab(null);
    setPaperPick("");
  };
  const resetRef = useRef(resetStudio);
  resetRef.current = resetStudio;

  /* The command palette new diagram command bumps resetSignal. The
     studio answers by resetting, through the same unsaved work guard
     as every other load (huge audit Bug 15). */
  const resetSeenRef = useRef(resetSignal);
  useEffect(() => {
    if (resetSeenRef.current === resetSignal) return;
    resetSeenRef.current = resetSignal;
    guardRef.current("a new diagram", () => resetRef.current());
  }, [resetSignal]);

  const addSentenceStep = (idx) => {
    if (!extractNote || readOnly) return;
    const sent = extractNote.sentences[idx];
    if (!sent) return;
    const label = fcLabelFromSentence(sent.text);
    if (!label) return;
    let sourceIdx;
    if (extractNote.kind === "paper") sourceIdx = 0;
    else {
      const cite = sent.cites.find((n) => n >= 1 && n <= (extractNote.sources || []).length);
      if (typeof cite === "number") sourceIdx = cite - 1;
    }
    const step = { id: fcId("s"), label, type: typeof sourceIdx === "number" ? "evidence" : "process", detail: sent.text, sourceIdx };
    pushHistory();
    const next = [...steps, step];
    setSteps(next);
    setSelectedId(step.id);
    setSaveState("idle");
    setExtractNote({ ...extractNote, used: [...(extractNote.used || []), idx] });
  };

  const updateStep = (id, patch) => {
    applySteps(steps.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const deleteStep = (id) => {
    const next = steps.filter((s) => s.id !== id);
    applySteps(next);
    if (selectedId === id) setSelectedId(next.length ? next[0].id : null);
  };

  const moveStep = (id, delta) => {
    const next = fcMoveStep(steps, id, delta);
    applySteps(next);
    setSelectedId(id);
  };

  const addStep = () => {
    const step = { id: fcId("s"), label: "", type: "process", detail: "", sourceIdx: undefined };
    const next = [...steps, step];
    applySteps(next);
    setSelectedId(step.id);
  };

  const doSave = async () => {
    /* Synchronous in flight guard: a second activation inside the same
       render pass never reaches the save handler, so a new diagram can
       never be metered twice (huge audit Bug 14). */
    if (saveInFlightRef.current) return;
    if (readOnly) return;
    if (!fcHasLabelledStep(steps)) {
      setSaveState("empty");
      setSaveNote("");
      return;
    }
    saveInFlightRef.current = true;
    setSaveState("saving");
    setSaveNote("");
    const snapAtSave = currentSnap();
    try {
      const fresh = dsBuild(steps, direction);
      let result = null;
      if (onSave) {
        result = await onSave({ id: currentId, title: title.trim() || "Untitled diagram", nodes: fresh.nodes, edges: fresh.edges, sources: activeSources, direction });
      }
      if (result === false) { setSaveState("blocked"); return; }
      if (result && typeof result === "object") {
        if (result.ok === false) {
          if (result.reason === "network") setSaveState("network");
          else if (result.reason === "empty") setSaveState("empty");
          else setSaveState("blocked");
          return;
        }
        if (result.id) setCurrentId(result.id);
        /* The baseline takes the adopted id, so a first save does not
           read as unsaved work the moment it lands. */
        baselineRef.current = snapOf(steps, title, activeSources, result.id || currentId, direction, readOnly);
        if (result.synced) { setSaveState("saved"); setSaveNote(""); }
        else if (result.syncError) { setSaveState("savedLocal"); setSaveNote("Saved in this browser. It did not reach your account. Check your connection, then save again."); }
        else if (result.pending) { setSaveState("savedLocal"); setSaveNote("Saved in this browser. Your account is not ready to receive it yet, so this copy stays in this browser for now."); }
        else { setSaveState("savedLocal"); setSaveNote("Saved in this browser only."); }
        return;
      }
      if (typeof result === "string" && result) {
        setCurrentId(result);
        baselineRef.current = snapOf(steps, title, activeSources, result, direction, readOnly);
      } else {
        baselineRef.current = snapAtSave;
      }
      setSaveState("savedLocal");
      setSaveNote("Saved in this browser.");
    } catch (dsErr) {
      setSaveState("network");
    } finally {
      saveInFlightRef.current = false;
    }
  };

  const exportColors = () => fcPaletteColors(P, accent, at);

  const guardExport = () => {
    if (fcHasLabelledStep(steps)) return true;
    setSaveState("empty");
    setExportOpen(false);
    return false;
  };

  const doExportSVG = () => {
    if (!guardExport()) return;
    const fresh = dsBuild(steps, direction);
    download(fcSlug(title) + ".svg", fcSvgString(fresh.nodes, fresh.edges, title, exportColors()));
    setExportOpen(false);
  };

  const doExportPNG = () => {
    if (!guardExport()) return;
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
    if (!guardExport()) return;
    const fresh = dsBuild(steps, direction);
    download(fcSlug(title) + ".md", fcToMarkdown(fresh.nodes, fresh.edges, title));
    setExportOpen(false);
  };

  const fitZoom = () => {
    const box = canvasBoxRef.current;
    const w = box ? box.clientWidth : 0;
    if (!w || !bounds.w) return;
    setZoom(Math.min(1.5, Math.max(0.3, (w - 24) / bounds.w)));
  };

  /* The canvas frame owns its gestures (mobile Bug 1): one finger
     pans by moving the frame scroll, two fingers pinch to zoom, and
     the frame never hands the gesture to the page scroll. */
  const onCanvasTouchStart = (e) => {
    const box = canvasBoxRef.current;
    if (!box) return;
    if (e.touches.length === 1) {
      const t = e.touches[0];
      touchRef.current = { mode: "pan", x: t.clientX, y: t.clientY, sl: box.scrollLeft, st: box.scrollTop };
    } else if (e.touches.length === 2) {
      const a = e.touches[0], b = e.touches[1];
      touchRef.current = { mode: "pinch", d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z: zoom };
    }
  };
  const onCanvasTouchMove = (e) => {
    const box = canvasBoxRef.current;
    const tr = touchRef.current;
    if (!box || !tr) return;
    if (tr.mode === "pan" && e.touches.length === 1) {
      const t = e.touches[0];
      box.scrollLeft = tr.sl - (t.clientX - tr.x);
      box.scrollTop = tr.st - (t.clientY - tr.y);
    } else if (tr.mode === "pinch" && e.touches.length === 2) {
      const a = e.touches[0], b = e.touches[1];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (tr.d > 0) setZoom(Math.min(2, Math.max(0.3, tr.z * (d / tr.d))));
    }
  };

  /* The rendered canvas never drops under a 640 wide floor, so a wide
     diagram scrolls and pans at a readable size instead of shrinking
     to fit a phone (mobile Bug 1). labelPx is the on screen size of
     the 14 unit node text at the current scale. */
  const displayW = steps.length ? Math.max(Math.round(bounds.w * zoom), 640) : 0;
  const displayScale = bounds.w ? displayW / bounds.w : 1;
  const displayH = Math.round(bounds.h * displayScale);
  const labelPx = 14 * displayScale;
  const acrossTooSmall = direction === "across" && steps.length > 0 && labelPx < 10;

  /* Share sits beside the downloads (mobile lane item 7): the SVG
     file when the platform can share files, the text outline when it
     can only share text. */
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const doShare = async () => {
    if (!guardExport()) return;
    const fresh = dsBuild(steps, direction);
    try {
      if (typeof navigator.canShare === "function") {
        const file = new File([fcSvgString(fresh.nodes, fresh.edges, title, exportColors())], fcSlug(title) + ".svg", { type: "image/svg+xml" });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: title || "Untitled diagram" });
          setExportOpen(false);
          return;
        }
      }
      await navigator.share({ title: title || "Untitled diagram", text: fcToMarkdown(fresh.nodes, fresh.edges, title) });
    } catch (shareErr) { /* the user closed the share sheet: nothing to report */ }
    setExportOpen(false);
  };

  /* Fitted polish, 2026-10-28: every studio control a thumb hits
     stands at the 48 floor, primary and small alike (the small style
     sat at 36 before this pass). */
  const btnStyle = {
    minHeight: 48, padding: "0 14px", borderRadius: RADIUS.sm, cursor: "pointer",
    background: "transparent", color: P.ink, border: `1px solid ${P.line2}`,
    fontSize: FONT_SIZES.label, fontWeight: 500, fontFamily: "var(--cb-font)",
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, whiteSpace: "nowrap",
    transition: "background-color 200ms var(--cb-ease), border-color 200ms var(--cb-ease), opacity 200ms var(--cb-ease)",
  };
  const smallBtnStyle = { ...btnStyle, minHeight: 48, padding: "0 12px", fontSize: FONT_SIZES.caption };
  const tabStyle = (active) => ({
    ...btnStyle,
    background: active ? withAlpha(accent, 0.14) : "transparent",
    border: `1px solid ${active ? accent : P.line2}`,
    color: P.ink,
  });
  /* Composition wave, 2026-10-26: the header controls group by the
     job they do (Start, Arrange, Finish), each under its own quiet
     caption, instead of one flat row of peers. Every handler below is
     the one it always was. */
  const groupLabelStyle = {
    fontSize: FONT_SIZES.caption, fontWeight: 500, letterSpacing: TRACKING.labelTight,
    color: P.faint, fontFamily: "var(--cb-font)", textTransform: "uppercase",
  };
  const fieldStyle = {
    boxSizing: "border-box", background: P.bg, border: `1px solid ${P.line}`,
    borderRadius: RADIUS.md, color: P.ink, padding: "8px 12px", minHeight: 48,
    fontSize: FONT_SIZES.body, fontFamily: "var(--cb-font)",
    transition: "border-color 200ms var(--cb-ease)",
  };

  const quotaLine = tier === "pro"
    ? "Pro plan: you can save as many new diagrams as you want. There is no limit."
    : tier === "lite"
      ? "Lite plan: you can save 10 new diagrams every 5 days. Saving changes to a diagram you already saved does not count."
      : "Free plan: you can save 1 new diagram every 5 days. Saving changes to a diagram you already saved does not count.";

  const selectedDoi = selectedSource ? (selectedSource.doi || "") : "";
  const selectedHref = selectedSource
    ? safeHref(selectedSource.url || (selectedDoi ? (String(selectedDoi).startsWith("http") ? selectedDoi : "https://doi.org/" + selectedDoi) : ""))
    : "#";

  const requestClose = () => {
    if (!onClose) return;
    guardLoad("closing", () => onClose());
  };

  /* Fitted polish, 2026-10-28: the page studio stages in through the
     cb-ds classes (global style block in CerebrumApp.jsx). In dialog
     mode the Dialog panel already carries the entrance, so the inner
     staging stays off and nothing double moves. */
  const dsPanel = dialog ? undefined : "cb-ds-panel";
  const dsPanelD1 = dialog ? undefined : "cb-ds-panel cb-ds-d1";
  const dsPanelD2 = dialog ? undefined : "cb-ds-panel cb-ds-d2";

  const content = (
    <div className={dialog ? undefined : "cb-ds-in"} style={{ display: "flex", flexDirection: "column", gap: 14, fontFamily: "var(--cb-font)", color: P.ink }}>
      {/* Header block */}
      <div className={dsPanel} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {!dialog && (
          <div style={{ fontSize: FONT_SIZES.section, fontWeight: 500, color: P.ink, lineHeight: 1.3 }}>Diagram Studio</div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <input
            value={title}
            onChange={(e) => { setTitle(e.target.value); setSaveState("idle"); }}
            placeholder="Give your diagram a title"
            aria-label="Give your diagram a title"
            disabled={readOnly}
            style={{ ...fieldStyle, flex: "1 1 180px", minWidth: 0, background: P.surface }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={groupLabelStyle}>Arrange</span>
            <div role="group" aria-label="Which way the steps run" style={{ display: "inline-flex", border: `1px solid ${P.line2}`, borderRadius: RADIUS.sm, padding: 3, gap: 2 }}>
              <button type="button" aria-pressed={direction === "down"}
                onClick={() => { pushHistory(); setDirection("down"); setSaveState("idle"); }}
                style={{ minHeight: 48, padding: "0 14px", borderRadius: RADIUS.sm, border: "none", cursor: "pointer", fontSize: FONT_SIZES.label, fontWeight: 500, fontFamily: "var(--cb-font)", background: direction === "down" ? accent : "transparent", color: direction === "down" ? at : P.ink, transition: "background-color 200ms var(--cb-ease), color 200ms var(--cb-ease)" }}>
                Top to bottom
              </button>
              <button type="button" aria-pressed={direction === "across"}
                onClick={() => { pushHistory(); setDirection("across"); setSaveState("idle"); }}
                style={{ minHeight: 48, padding: "0 14px", borderRadius: RADIUS.sm, border: "none", cursor: "pointer", fontSize: FONT_SIZES.label, fontWeight: 500, fontFamily: "var(--cb-font)", background: direction === "across" ? accent : "transparent", color: direction === "across" ? at : P.ink, transition: "background-color 200ms var(--cb-ease), color 200ms var(--cb-ease)" }}>
                Left to right
              </button>
            </div>
          </div>
          {dialog && (
            <button type="button" onClick={() => guardLoad("a new diagram", resetStudio)} style={btnStyle}>
              Make a diagram in Diagram Studio
            </button>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginLeft: "auto" }}>
            <span style={groupLabelStyle}>Finish</span>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div ref={exportWrapRef} style={{ position: "relative" }}>
                <button type="button" onClick={() => setExportOpen((v) => !v)} aria-expanded={exportOpen} style={btnStyle}>
                  Export
                </button>
                {exportOpen && (
                  <div className="cb-ds-menu" style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 20, display: "flex", flexDirection: "column", gap: 6, padding: 8, background: P.surface, border: `1px solid ${P.line}`, borderRadius: RADIUS.md, minWidth: 160 }}>
                    <button type="button" onClick={doExportSVG} style={btnStyle}>SVG file</button>
                    <button type="button" onClick={doExportPNG} style={btnStyle}>PNG image</button>
                    <button type="button" onClick={doExportText} style={btnStyle}>Text outline</button>
                    {canShare && (
                      <button type="button" onClick={doShare} style={btnStyle}>Share</button>
                    )}
                  </div>
                )}
              </div>
              <button type="button" onClick={doSave} disabled={saveState === "saving" || readOnly}
                style={{ ...btnStyle, background: accent, color: at, border: `1px solid ${accent}`, opacity: saveState === "saving" || readOnly ? 0.6 : 1 }}>
                Save
              </button>
              {dialog && onClose && (
                <button type="button" onClick={requestClose} style={btnStyle}>Close</button>
              )}
            </div>
          </div>
        </div>
        <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, lineHeight: 1.4 }}>
          {quotaLine}
        </div>
        {dirty && saveState !== "saving" && (
          <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, lineHeight: 1.4 }}>You have changes that are not saved yet. Press Save to keep them.</div>
        )}
        {saveState === "saving" && (
          <div style={{ fontSize: FONT_SIZES.body, color: P.ink2 }}>Saving your diagram…</div>
        )}
        {saveState === "saved" && (
          <div style={{ fontSize: FONT_SIZES.body, color: accent, fontWeight: 500 }}>Saved to your account.</div>
        )}
        {saveState === "savedLocal" && (
          <div style={{ fontSize: FONT_SIZES.body, color: P.ink2 }}>{saveNote || "Saved in this browser."}</div>
        )}
        {saveState === "network" && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: FONT_SIZES.body, color: P.ink2 }}>Save did not go through. The connection failed, so nothing was counted against your plan.</span>
            <button type="button" onClick={doSave} style={smallBtnStyle}>Try saving again</button>
          </div>
        )}
        {saveState === "blocked" && (
          <div style={{ fontSize: FONT_SIZES.body, color: P.ink2 }}>
            Save did not go through. You may need to sign in first, or your plan may have no room left for a new diagram.
          </div>
        )}
        {saveState === "empty" && (
          <div style={{ fontSize: FONT_SIZES.body, color: P.ink2 }}>
            Write words in at least one step first. A diagram whose steps have no words cannot be saved or exported.
          </div>
        )}
      </div>

      {/* Unsaved work guard */}
      {pendingLoad && (
        <div role="alertdialog" aria-label="Unsaved work" className="cb-ds-detail" style={{ background: P.surface, border: `1px solid ${accent}`, borderRadius: RADIUS.lg, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: FONT_SIZES.body, color: P.ink, lineHeight: 1.5 }}>
            {pendingLoad.label === "closing" ? "Closing now will leave work that is not saved." : `Loading ${pendingLoad.label} will replace work that is not saved.`}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" style={{ ...smallBtnStyle, background: accent, color: at, border: `1px solid ${accent}` }}
              onClick={() => { const run = pendingLoad.run; setPendingLoad(null); run(); }}>
              {pendingLoad.label === "closing" ? "Close without saving" : "Replace my work"}
            </button>
            <button type="button" style={smallBtnStyle} onClick={() => setPendingLoad(null)}>
              {pendingLoad.label === "closing" ? "Keep working" : "Keep my work"}
            </button>
          </div>
        </div>
      )}

      {/* Older format notice */}
      {readOnly && (
        <div className="cb-ds-detail" style={{ background: P.surface, border: `1px solid ${P.line}`, borderRadius: RADIUS.lg, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: FONT_SIZES.body, color: P.ink, lineHeight: 1.5 }}>
            This diagram was made with an older version of Diagram Studio. It uses branches or words on its arrows. This version works as one list of steps in order, so it cannot keep those parts. It is open for reading only, so nothing gets changed by accident.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" style={{ ...smallBtnStyle, background: accent, color: at, border: `1px solid ${accent}` }}
              onClick={() => { setReadOnly(false); setSaveState("idle"); }}>
              Turn it into a list of steps
            </button>
          </div>
          <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, lineHeight: 1.4 }}>
            This keeps the steps in the order they are in now. Branches, words on arrows, and special boxes will not be kept. If you then save, the saved copy will use the new list instead of the old one.
          </div>
        </div>
      )}

      {/* Source choices, the Start group of the toolbar */}
      {!dialog && (
        <div className={dsPanelD1} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={groupLabelStyle}>Start</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => guardLoad("a new diagram", resetStudio)} style={tabStyle(false)}>
              Make a diagram in Diagram Studio
            </button>
            <button type="button" aria-pressed={false} disabled={!latestAnswer}
              onClick={loadLatest}
              style={{ ...tabStyle(false), opacity: latestAnswer ? 1 : 0.5, cursor: latestAnswer ? "pointer" : "not-allowed" }}>
              Start from your last answer
            </button>
            <button type="button" aria-pressed={sourceTab === "paper"} onClick={() => setSourceTab(sourceTab === "paper" ? null : "paper")} style={tabStyle(sourceTab === "paper")}>
              Start from a saved paper
            </button>
            <button type="button" aria-pressed={sourceTab === "saved"} onClick={() => setSourceTab(sourceTab === "saved" ? null : "saved")} style={tabStyle(sourceTab === "saved")}>
              Open a diagram you saved
            </button>
          </div>
          {sourceTab === "paper" && (
            eligiblePapers.length === 0 ? (
              <div className="cb-ds-detail" style={{ fontSize: FONT_SIZES.body, color: P.faint, lineHeight: 1.5 }}>
                None of your saved papers has the words we need yet. Save a paper from an answer first, then pick it here.
              </div>
            ) : (
              <select
                className="cb-ds-detail"
                aria-label="Saved paper"
                value={paperPick}
                onChange={(e) => {
                  const v = e.target.value;
                  setPaperPick(v);
                  if (v === "") return;
                  const paper = eligiblePapers[Number(v)];
                  if (paper) loadPaper(paper);
                }}
                style={{ ...fieldStyle, width: "100%", background: P.surface }}
              >
                <option value="">Pick a paper</option>
                {eligiblePapers.map((paper, i) => (
                  <option key={paper.id || paper.title || i} value={i}>{paper.title || "Untitled"}</option>
                ))}
              </select>
            )
          )}
          {sourceTab === "saved" && (
            <div className="cb-ds-detail" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {diagrams.length === 0 && (
                <div style={{ fontSize: FONT_SIZES.body, color: P.faint }}>You have not saved a Diagram Studio diagram yet. When you save one, it will appear here and in your Library.</div>
              )}
              {diagrams.map((chart, i) => {
                const count = dsStepsFromChart(chart).length;
                return (
                  <button key={chart.id || chart.title || i} type="button" onClick={() => loadDiagram(chart)}
                    style={{ ...btnStyle, justifyContent: "flex-start" }}>
                    {`${chart.title || "Untitled diagram"} · ${count} step${count === 1 ? "" : "s"}`}
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
            ? "This diagram came from this answer. Read each step, fix any words that are wrong, then press Save."
            : initial
              ? `You reopened a saved diagram: ${initial.title || title || "Untitled diagram"}`
              : "Add steps in the Steps list, then press Save when you are ready."}
        </div>
      )}

      {/* Extraction found too little: say so, show the source text, and
          let the user pick sentences from it as steps. */}
      {extractNote && (
        <div className="cb-ds-detail" style={{ background: P.surface, border: `1px solid ${P.line}`, borderRadius: RADIUS.lg, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: FONT_SIZES.body, color: P.ink, lineHeight: 1.5 }}>
            {steps.length === 0
              ? "We could not find any steps in this text. It may be written as long sentences with no list. The text is below. Press Use this as a step next to any sentence you want in your diagram."
              : "We found only one step in this text. The text it came from is below. Press Use this as a step next to any other sentences you want in your diagram."}
          </div>
          <div style={{ fontSize: FONT_SIZES.label, color: P.faint, lineHeight: 1.55, maxHeight: 140, overflowY: "auto", border: `1px solid ${P.line}`, borderRadius: RADIUS.md, padding: 10 }}>
            {extractNote.text}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {extractNote.sentences.map((sent, i) => {
              const used = (extractNote.used || []).includes(i);
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ flex: "1 1 auto", minWidth: 0, fontSize: FONT_SIZES.label, color: P.ink2, lineHeight: 1.45 }}>{sent.text}</span>
                  <button type="button" disabled={used || readOnly} onClick={() => addSentenceStep(i)}
                    style={{ ...smallBtnStyle, flexShrink: 0, opacity: used ? 0.5 : 1 }}>
                    {used ? "Added" : "Use this as a step"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Main area */}
      <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", flexWrap: "wrap", gap: 14, alignItems: "stretch" }}>
        <div className={dsPanelD2} style={{ order: isMobile ? 3 : 1, flex: "1 1 auto", minWidth: 0, background: P.surface, border: `1px solid ${P.line}`, borderRadius: RADIUS.lg, padding: 14, boxShadow: P.shadowSm, backgroundImage: `radial-gradient(${P.line2} 1px, transparent 1.2px)`, backgroundSize: "22px 22px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <button type="button" onClick={fitZoom} style={smallBtnStyle}>Fit whole diagram</button>
            <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.3, Math.round((z - 0.1) * 100) / 100))} style={smallBtnStyle}>Zoom out</button>
            <span style={{ fontSize: FONT_SIZES.caption, color: P.faint, minWidth: 44, textAlign: "center" }}>{`${Math.round(zoom * 100)}%`}</span>
            <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(2, Math.round((z + 0.1) * 100) / 100))} style={smallBtnStyle}>Zoom in</button>
          </div>
          {acrossTooSmall && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
              <span style={{ fontSize: FONT_SIZES.body, color: P.ink2, lineHeight: 1.45 }}>
                {`This diagram runs left to right, and at this size its words are about ${Math.max(1, Math.round(labelPx))} px tall, too small to read. Zoom in or switch it to Top to bottom.`}
              </span>
              <button type="button" onClick={() => setZoom((z) => Math.min(2, z * 1.5))} style={smallBtnStyle}>Zoom in</button>
            </div>
          )}
          <div ref={canvasBoxRef} onTouchStart={onCanvasTouchStart} onTouchMove={onCanvasTouchMove} style={{ overflow: "auto", overscrollBehavior: "contain", touchAction: "none", maxHeight: isMobile ? "62vh" : "76vh" }}>
            {steps.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start", padding: 12 }}>
                <div style={{ fontSize: FONT_SIZES.body, fontWeight: 500, color: P.ink, lineHeight: 1.4 }}>No steps yet</div>
                <div style={{ fontSize: FONT_SIZES.body, color: P.faint, lineHeight: 1.55 }}>
                  A diagram here is a list of steps in order. Add a step and write what happens first.{dialog ? " Then add more steps for what happens next." : " Or start from your last answer or from a saved paper, using the choices above."}
                </div>
                <button type="button" onClick={addStep} disabled={readOnly}
                  style={{ ...btnStyle, background: accent, color: at, border: `1px solid ${accent}`, opacity: readOnly ? 0.5 : 1 }}>
                  Add your first step
                </button>
                {exampleBuilt && examplePaper && (
                  <div style={{ marginTop: 10, width: "100%", maxWidth: 520 }}>
                    <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 500, color: P.faint, fontFamily: "var(--cb-font)", marginBottom: 6 }}>
                      Example, from {examplePaper.title || "a saved paper"}
                    </div>
                    <FcThumb chart={exampleBuilt} accent={accent} />
                    <button type="button" onClick={() => loadPaper(examplePaper)} disabled={readOnly}
                      style={{ ...smallBtnStyle, marginTop: 8, opacity: readOnly ? 0.5 : 1 }}>
                      Open this example
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <svg key={`${steps.length}:${direction}`} className="cb-ds-canvas-in" viewBox={`${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`} width={Math.max(1, displayW)} height={Math.max(1, displayH)} style={{ display: "block" }} role="img" aria-label={title || "Untitled diagram"}>
                <defs>
                  <marker id="dsArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M 0 1 L 9 5 L 0 9 z" fill={P.ink2} />
                  </marker>
                </defs>
                {edges.map((e) => {
                  const a = fcNodeById(nodes, e.from);
                  const b = fcNodeById(nodes, e.to);
                  if (!a || !b) return null;
                  const g = fcEdgeGeom(a, b);
                  return <path key={e.id} d={g.d} fill="none" stroke={P.ink2} strokeWidth={2} markerEnd="url(#dsArrow)" />;
                })}
                {nodes.map((n, i) => {
                  const step = steps[i];
                  if (!step) return null;
                  const lines = fcWrapBounded(n.label || "", 24, Math.max(1, Math.floor(((n.h || 92) - 16) / 18)));
                  const lineHeight = 18;
                  const startY = n.h / 2 - ((lines.length - 1) * lineHeight) / 2 + 5;
                  return (
                    <g key={n.id} transform={`translate(${n.x} ${n.y})`} onClick={() => setSelectedId(step.id)} style={{ cursor: "pointer" }}>
                      <FcNodeShape n={n} P={P} accent={accent} selected={selectedId === step.id} index={i} />
                      <text x={n.w / 2} y={startY} textAnchor="middle" fontSize={14} fill={P.ink} fontFamily="var(--cb-font)" fontWeight={600}>
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
        </div>

        {/* The one step list, always visible. Each row owns its label,
            kind, detail, and source as one unit. */}
        <div className={dsPanelD2} style={{ order: isMobile ? 1 : 2, width: isMobile ? "auto" : 360, flexShrink: 0, background: P.surface, border: `1px solid ${P.line}`, borderRadius: RADIUS.lg, padding: 14, boxShadow: P.shadowSm }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ ...TYPE.subhead, color: P.ink, flex: "1 1 auto" }}>Steps, in order</span>
            <button type="button" onClick={undo} disabled={!past.length} style={{ ...smallBtnStyle, opacity: past.length ? 1 : 0.5 }}>Undo</button>
            <button type="button" onClick={redo} disabled={!future.length} style={{ ...smallBtnStyle, opacity: future.length ? 1 : 0.5 }}>Redo</button>
          </div>
          <div style={{ fontSize: FONT_SIZES.label, color: P.faint, lineHeight: 1.55, marginBottom: 10 }}>
            The picture is drawn from this list, in order. Step 1 is at the top, and an arrow joins each step to the next one. Pick Plain step for your own words, or Step backed by a paper when the words come from a paper.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {steps.map((step, i) => {
              const stepSource = typeof step.sourceIdx === "number" && Array.isArray(activeSources) ? activeSources[step.sourceIdx] || null : null;
              const kindSelect = (
                <select
                  value={step.type}
                  onChange={(e) => updateStep(step.id, { type: e.target.value })}
                  aria-label={`Step ${i + 1} kind`}
                  disabled={readOnly}
                  style={{ ...fieldStyle, flexShrink: 0, fontSize: 16, background: P.surface }}
                >
                  <option value="process">Plain step</option>
                  <option value="evidence">Step backed by a paper</option>
                </select>
              );
              return (
                <div key={step.id} id={`ds-step-${step.id}`} className="cb-ds-step" onClick={() => setSelectedId(step.id)} style={{ display: "flex", flexDirection: "column", gap: 6, border: `1px solid ${selectedId === step.id ? accent : P.line}`, borderRadius: RADIUS.md, padding: 10, background: selectedId === step.id ? P.raised : "transparent", transition: "border-color 200ms var(--cb-ease), background-color 200ms var(--cb-ease)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {/* Interiors wave, 2026-10-26: the step number
                        wears the same disc the canvas puts on the
                        node itself (ink filled, the number in the
                        ground color), so the list and the picture
                        read as one instrument. */}
                    <span aria-hidden="true" style={{ width: 21, height: 21, borderRadius: RADIUS.pill, background: P.ink, color: P.bg, fontSize: 11, fontWeight: 500, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontVariantNumeric: "tabular-nums", fontFamily: "var(--cb-font)" }}>{i + 1}</span>
                    <input
                      value={step.label}
                      onChange={(e) => updateStep(step.id, { label: e.target.value })}
                      aria-label={`Step ${i + 1} label`}
                      maxLength={FC_LABEL_MAX}
                      disabled={readOnly}
                      placeholder="Write this step in a few words"
                      style={{ ...fieldStyle, flex: "1 1 auto", minWidth: 0, fontSize: 16, background: P.surface }}
                    />
                    {!isMobile && kindSelect}
                  </div>
                  <input
                    value={step.detail}
                    onChange={(e) => updateStep(step.id, { detail: e.target.value })}
                    aria-label={`Step ${i + 1} detail`}
                    placeholder="The full sentence this step came from, or your own note"
                    disabled={readOnly}
                    style={{ ...fieldStyle, width: "100%", fontSize: 16, background: P.surface }}
                  />
                  {stepSource && (
                    <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, lineHeight: 1.4 }}>
                      {`Source: ${stepSource.title || "Untitled"}`}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    {isMobile && kindSelect}
                    <button type="button" onClick={() => moveStep(step.id, -1)} disabled={readOnly || i === 0} aria-label={`Move step ${i + 1} up`} style={{ ...smallBtnStyle, opacity: readOnly || i === 0 ? 0.5 : 1 }}>
                      Move up
                    </button>
                    <button type="button" onClick={() => moveStep(step.id, 1)} disabled={readOnly || i === steps.length - 1} aria-label={`Move step ${i + 1} down`} style={{ ...smallBtnStyle, opacity: readOnly || i === steps.length - 1 ? 0.5 : 1 }}>
                      Move down
                    </button>
                    <button type="button" onClick={() => deleteStep(step.id)} disabled={readOnly} aria-label={`Delete step ${i + 1}`} style={{ ...smallBtnStyle, opacity: readOnly ? 0.5 : 1 }}>
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
            <button type="button" onClick={addStep} disabled={readOnly} style={{ ...btnStyle, alignSelf: "flex-start", opacity: readOnly ? 0.5 : 1 }}>
              Add step
            </button>
          </div>
        </div>

      {/* Selected step detail. It lives inside the main flex area: on a
          phone it orders between the step editor and the canvas, so a
          tap on a node shows its detail without scrolling past the
          picture (mobile Bug 2). On a wide screen it wraps onto its
          own full width row under both. */}
      {selectedStep && (selectedStep.detail || selectedSource) && (
        <div key={selectedStep.id} className="cb-ds-detail" style={{ order: isMobile ? 2 : 3, flex: isMobile ? undefined : "1 1 100%", background: P.surface, border: `1px solid ${P.line}`, borderRadius: RADIUS.lg, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: FONT_SIZES.label, fontWeight: 500, color: P.ink }}>More about the step you picked</div>
          {selectedStep.detail && (
            <div style={{ fontSize: FONT_SIZES.body, color: P.ink, lineHeight: 1.55 }}>{selectedStep.detail}</div>
          )}
          {selectedSource && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ fontSize: FONT_SIZES.caption, color: P.faint }}>From this paper</div>
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
    </div>
  );

  if (dialog) {
    return (
      <Dialog label="Diagram Studio" onClose={requestClose} width={1240} panelStyle={{ background: P.surface, color: P.ink }} initialFocus={topFocusRef}>
        <div ref={topFocusRef} tabIndex={-1} style={{ overflowY: "auto", padding: 20, minHeight: 0, outline: "none" }}>
          {content}
        </div>
      </Dialog>
    );
  }

  return (
    /* Fitted polish, 2026-10-28: on a phone the page studio pads its
       foot with the safe area inset, so the last step controls never
       sit in the home indicator zone. */
    <div style={{ padding: isMobile ? "16px 16px calc(16px + env(safe-area-inset-bottom))" : 24, background: P.bg, color: P.ink, fontFamily: "var(--cb-font)" }}>
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
  const panelBg = media ? "#0f1115" : drawer && P ? P.bg : themed ? P.surface : "var(--cb-surface, #16181d)";
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
