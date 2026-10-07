/**
 * scrollLock.js — THE single scroll-lock mechanism for the Cerebrum app.
 *
 * History: the app previously had THREE competing implementations —
 *  1. a ref-counted `overflow:hidden` lock in CerebrumApp.jsx
 *     (cbDialogLockScroll / cbDialogUnlockScroll),
 *  2. an identical duplicate of that lock in flowcharts.jsx (left behind by
 *     the monolith split), and
 *  3. a non-ref-counted "pin" effect keyed on the anyOverlayOpen boolean.
 * They "composed safely" only by luck: (1) and (2) each kept their own
 * depth counter, so a dialog opened from the flowchart studio double-locked
 * the body and a single unlock stranded it.
 *
 * This module replaces all three. One ref-counted lock, one implementation:
 *
 *   lockScroll()   — acquire the lock (depth 0 → 1 pins the body)
 *   unlockScroll() — release the lock (depth 1 → 0 restores everything)
 *   useScrollLock(active) — React hook: lock while `active` is truthy
 *
 * The pin pattern (position:fixed + explicit scrollY restore) is used
 * instead of a plain overflow:hidden toggle because several browsers —
 * notably iOS Safari — do not reliably preserve the exact scroll offset
 * across a plain toggle, which presents as the page snapping back to the
 * top when a modal closes. The removed scrollbar's width is added back as
 * padding so desktop layout doesn't shift sideways when the scrollbar
 * vanishes.
 *
 * All style writes are wrapped in try/catch with contextual logging,
 * matching the app's error-handling convention.
 */

/* eslint-disable no-console */
import { useEffect } from "react";

let depth = 0;
/** @type {{overflow:string,position:string,top:string,width:string,paddingRight:string,scrollY:number}|null} */
let saved = null;

function log(where, err) {
  try {
    console.error(`[Cerebrum] scrollLock.js ${where}:`, err);
  } catch {
    /* logging must never throw */
  }
}

/**
 * Acquire the body scroll lock. Ref-counted: call unlockScroll() once per
 * lockScroll() call. The first acquire pins the body; nested acquires only
 * bump the counter.
 */
export function lockScroll() {
  if (depth === 0) {
    try {
      const body = document.body;
      const scrollY = window.scrollY || 0;
      saved = {
        overflow: body.style.overflow,
        position: body.style.position,
        top: body.style.top,
        width: body.style.width,
        paddingRight: body.style.paddingRight,
        scrollY,
      };
      // Scrollbar-width compensation: the removed scrollbar's width gets
      // added back as padding so the page behind the overlay doesn't jump
      // sideways on desktop.
      const sw = window.innerWidth - document.documentElement.clientWidth;
      body.style.overflow = "hidden";
      body.style.position = "fixed";
      body.style.top = `-${scrollY}px`;
      body.style.width = "100%";
      if (sw > 0) {
        body.style.paddingRight = `calc(${saved.paddingRight || "0px"} + ${sw}px)`;
      }
    } catch (err) {
      log("lockScroll: pin body", err);
    }
  }
  depth += 1;
}

/**
 * Release one body scroll lock acquisition. When the last holder releases,
 * the body's original styles are restored and the exact pre-lock scroll
 * position is restored with an instant (non-animated) scrollTo.
 * Unbalanced calls (unlock without lock) are ignored — they must never
 * touch the body's styles.
 */
export function unlockScroll() {
  if (depth <= 0) return; // Unbalanced unlock: never held a lock, leave styles alone.
  depth -= 1;
  if (depth === 0 && saved) {
    try {
      const body = document.body;
      const scrollY = saved.scrollY;
      body.style.overflow = saved.overflow;
      body.style.position = saved.position;
      body.style.top = saved.top;
      body.style.width = saved.width;
      body.style.paddingRight = saved.paddingRight;
      saved = null;
      // Silent technical restore (putting the page back exactly where it was
      // before an overlay locked it), not a user-facing glide — invisible,
      // never animated.
      window.scrollTo({ top: scrollY, left: 0, behavior: "instant" });
    } catch (err) {
      log("unlockScroll: restore body", err);
    }
  }
}

/**
 * @returns {number} current lock depth (0 = unlocked). Exposed for tests
 * and for debugging overlay-stack issues.
 */
export function scrollLockDepth() {
  return depth;
}

/**
 * React hook: hold the scroll lock while `active` is truthy.
 * Safe to use from many components at once — acquisitions nest via the
 * shared ref count, so overlapping overlays can't strand the body.
 *
 * @param {boolean} active
 */
export function useScrollLock(active) {
  useEffect(() => {
    if (!active) return undefined;
    lockScroll();
    return () => {
      unlockScroll();
    };
  }, [active]);
}

// Backwards-compatible aliases for the pre-unification names used across
// the codebase. New code should use lockScroll/unlockScroll.
export const cbDialogLockScroll = lockScroll;
export const cbDialogUnlockScroll = unlockScroll;
