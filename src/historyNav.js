/**
 * historyNav.js — one small history helper for in app navigation.
 *
 * The mobile audit (2026 10 23) found that navigation was component
 * state and wrote no history entries, so the system back action
 * left the app instead of walking it. This helper is the single
 * place layers of the app register with the browser history:
 *
 *   pushLayer(kind, key, onClose, onRestore)
 *     Pushes one history entry for a layer (a view, an open thread,
 *     a dialog) and remembers what closing it means. Pushing the
 *     same kind and key as the current top layer only refreshes
 *     its handlers. The first push stamps the entry under it as
 *     depth 0, so a load that arrived by deep link keeps a known
 *     base and never gains a back trap.
 *
 *   closeLayer(kind, key)
 *     A programmatic close. The layer is marked dead so the
 *     popstate that follows cannot call its onClose a second time,
 *     and if the layer is the current top entry the browser steps
 *     back once to drop its entry. That is the loop guard: a close
 *     never pushes, and a pop never recloses.
 *
 *   releaseLayer(kind, key)
 *     Marks a layer dead without moving the browser, for unmounts
 *     and for switching straight from one item to another. When
 *     back later walks through a dead entry it is skipped in
 *     silence, and landing on one steps back once more so the
 *     user is not left pressing back on a screen that is gone.
 *
 *   requestBack(kind, key)
 *     Asks the browser to go back when the named layer is the
 *     current top entry. Its onClose then does the state change,
 *     exactly as if the user had pressed the system back action.
 *     Returns false when there is no such current layer, so the
 *     caller can fall back to changing state directly.
 *
 *   markRestore(kind, key) and consumeRestore(kind, key)
 *     A pop driven state change must not push a fresh entry.
 *     onClose handlers mark the state they are about to restore,
 *     and the effect that watches that state consumes the mark
 *     instead of pushing.
 *
 * Order comes from push order alone: dialogs are pushed after the
 * thread they sit over, and threads after the view, so one back
 * press closes a dialog first, then a thread back to its list,
 * then a view back to the previous view, and only then leaves the
 * app. Entries written by anyone else (the Trending story hash
 * sync, deep links) carry no cbNav depth and are ignored here, and
 * forward presses restore layers that supply an onRestore handler
 * instead of trapping the user on a stale entry.
 */

export function cbNavDepthOf(state) {
  const d = state && state.cbNav && state.cbNav.depth;
  return typeof d === "number" && Number.isFinite(d) ? d : null;
}

export function createHistoryNav(win) {
  const w = win || (typeof window !== "undefined" ? window : null);
  let layers = [];
  let redo = [];
  let currentDepth = 0;
  const restoreMarks = new Set();
  const markKey = (kind, key) => String(kind) + ":" + String(key == null ? "" : key);

  function safeState() {
    try { return w ? w.history.state : null; } catch { return null; }
  }
  if (w) {
    const d = cbNavDepthOf(safeState());
    if (d != null) currentDepth = d;
  }

  function stampBase() {
    if (!w) return;
    if (cbNavDepthOf(safeState()) != null) return;
    try {
      const s = safeState();
      const base = s && typeof s === "object" ? { ...s } : {};
      base.cbNav = { depth: 0 };
      w.history.replaceState(base, "");
    } catch { /* history is a nicety, not a dependency */ }
  }

  function pushLayer(kind, key, onClose, onRestore) {
    if (!w || !kind) return false;
    const k = key == null ? "" : String(key);
    const top = layers[layers.length - 1];
    if (top && top.alive && top.kind === kind && top.key === k) {
      if (onClose) top.onClose = onClose;
      if (onRestore) top.onRestore = onRestore;
      return false;
    }
    stampBase();
    layers.push({ kind, key: k, onClose: onClose || null, onRestore: onRestore || null, alive: true });
    redo = [];
    const depth = layers.length;
    try {
      const s = safeState();
      const base = s && typeof s === "object" ? { ...s } : {};
      base.cbNav = { depth, kind, key: k };
      w.history.pushState(base, "");
    } catch { /* history is a nicety, not a dependency */ }
    currentDepth = depth;
    return true;
  }

  function findLayer(kind, key) {
    const k = key == null ? "" : String(key);
    for (let i = layers.length - 1; i >= 0; i--) {
      if (layers[i].kind === kind && layers[i].key === k && layers[i].alive) return layers[i];
    }
    return null;
  }

  function killLayer(kind, key, moveBrowser) {
    const layer = findLayer(kind, key);
    if (!layer) return false;
    layer.alive = false;
    layer.onClose = null;
    layer.onRestore = null;
    const depth = layers.indexOf(layer) + 1;
    if (moveBrowser && w && depth === layers.length && currentDepth === depth) {
      try { w.history.back(); } catch { /* nothing to step back to */ }
    }
    return true;
  }

  function closeLayer(kind, key) { return killLayer(kind, key, true); }
  function releaseLayer(kind, key) { return killLayer(kind, key, false); }

  function requestBack(kind, key) {
    if (!w) return false;
    const layer = key === undefined
      ? [...layers].reverse().find((l) => l.kind === kind && l.alive)
      : findLayer(kind, key);
    if (!layer) return false;
    const depth = layers.indexOf(layer) + 1;
    if (depth !== layers.length || currentDepth !== depth) return false;
    try { w.history.back(); } catch { return false; }
    return true;
  }

  function onPopState() {
    if (!w) return;
    const d = cbNavDepthOf(safeState());
    if (d == null) return;
    if (d < layers.length) {
      const trimmed = layers.splice(d);
      for (let i = trimmed.length - 1; i >= 0; i--) {
        const layer = trimmed[i];
        redo.push(layer);
        /* A live layer closed by this pop stays marked live in
           the redo stack: it has left the layer stack, so nothing
           can close it twice from here, and if forward returns to
           its entry it can be restored. A layer killed before the
           pop stays dead and restores nothing. */
        if (layer.alive && layer.onClose) {
          try { layer.onClose(); } catch { /* a close handler must not break back */ }
        }
      }
      currentDepth = d;
      if (d > 0 && layers[d - 1] && !layers[d - 1].alive) {
        try { w.history.back(); } catch { /* nothing further to skip to */ }
      }
    } else if (d > layers.length) {
      let guard = 0;
      while (layers.length < d && redo.length > 0 && guard < 50) {
        guard++;
        const layer = redo.pop();
        layers.push(layer);
        if (layer.alive && layer.onRestore) {
          try { layer.onRestore(); } catch { /* a restore handler must not break forward */ }
        }
      }
      currentDepth = d;
    } else {
      currentDepth = d;
    }
  }

  if (w && w.addEventListener) w.addEventListener("popstate", onPopState);

  return {
    pushLayer,
    closeLayer,
    releaseLayer,
    requestBack,
    onPopState,
    markRestore(kind, key) { restoreMarks.add(markKey(kind, key)); },
    consumeRestore(kind, key) {
      const m = markKey(kind, key);
      if (!restoreMarks.has(m)) return false;
      restoreMarks.delete(m);
      return true;
    },
    depth() { return layers.length; },
    currentDepth() { return currentDepth; },
    layers() { return layers.map((l) => ({ kind: l.kind, key: l.key, alive: l.alive })); },
    dispose() { if (w && w.removeEventListener) w.removeEventListener("popstate", onPopState); },
  };
}

export const historyNav = createHistoryNav();
