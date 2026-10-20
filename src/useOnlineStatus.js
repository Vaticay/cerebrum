// @ts-check
/**
 * useOnlineStatus.js — the shell connection monitor (2026-10-20,
 * design audit M6: the shell had no designed offline state and no
 * connection handling at all).
 *
 * Two pieces, one contract:
 *
 *   createConnectionMonitor({ target, readOnLine })
 *     A small state machine with an injectable event target and an
 *     injectable online reading, so tests drive it with a fake target
 *     and never touch a real window. It reads the current state once
 *     at creation, then follows the target's "online" and "offline"
 *     events. Subscribers are notified only when the state actually
 *     changes, so a duplicate event cannot re-render the shell or
 *     flash the notice.
 *
 *   useOnlineStatus()
 *     The React hook the shell mounts. It owns one monitor bound to
 *     the real window and navigator, subscribes the component, and
 *     returns a boolean: true while the browser reports a connection.
 *
 * The monitor never guesses beyond what the browser reports. A true
 * reading means the browser believes it is online, not that any
 * service is reachable; the search flow keeps its own failure panel
 * for that case.
 */

import { useEffect, useState } from "react";

/**
 * @param {{ target?: any, readOnLine?: () => boolean }} [options]
 *   target: anything with addEventListener/removeEventListener for
 *   "online" and "offline" (the window in the app, a fake in tests).
 *   readOnLine: returns the current online reading (navigator.onLine
 *   in the app, a stub in tests). Defaults to reading true.
 */
export function createConnectionMonitor(options = {}) {
  const target = options.target || null;
  const readOnLine = typeof options.readOnLine === "function" ? options.readOnLine : () => true;
  let online = !!readOnLine();
  let started = false;
  const listeners = new Set();

  function setOnline(next) {
    const value = !!next;
    if (value === online) return;
    online = value;
    for (const fn of [...listeners]) {
      try { fn(online); } catch (err) { console.error("[Cerebrum] useOnlineStatus.js listener:", err); }
    }
  }

  function handleOnline() { setOnline(true); }
  function handleOffline() { setOnline(false); }

  return {
    /** Current reading: true while the browser reports a connection. */
    isOnline() { return online; },
    /** Follow the target's online and offline events. Idempotent. */
    start() {
      if (started || !target || typeof target.addEventListener !== "function") return;
      started = true;
      target.addEventListener("online", handleOnline);
      target.addEventListener("offline", handleOffline);
      /* Re-read on start: the state may have moved between creation
         and subscription, and the mount reading is the honest one. */
      setOnline(!!readOnLine());
    },
    /** Stop following the target. The last reading is kept. */
    stop() {
      if (!started || !target || typeof target.removeEventListener !== "function") return;
      started = false;
      target.removeEventListener("online", handleOnline);
      target.removeEventListener("offline", handleOffline);
    },
    /**
     * Subscribe to changes. The listener receives the new boolean and
     * fires only on an actual change. Returns an unsubscribe function.
     */
    subscribe(fn) {
      if (typeof fn !== "function") return () => {};
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
  };
}

/**
 * The shell hook: one monitor per mounted component, bound to the
 * real window and navigator when they exist. Outside a browser (a
 * server render, a test harness) it reports online and stays quiet,
 * so nothing renders the offline state by accident.
 */
export function useOnlineStatus() {
  const [monitor] = useState(() => createConnectionMonitor({
    target: typeof window !== "undefined" ? window : null,
    readOnLine: () => (typeof navigator !== "undefined" && typeof navigator.onLine === "boolean" ? navigator.onLine : true),
  }));
  const [online, setOnline] = useState(() => monitor.isOnline());
  useEffect(() => {
    const unsubscribe = monitor.subscribe(setOnline);
    monitor.start();
    setOnline(monitor.isOnline());
    return () => { unsubscribe(); monitor.stop(); };
  }, [monitor]);
  return online;
}
