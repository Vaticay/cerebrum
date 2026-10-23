/**
 * keyboardInset.js — the shared visual viewport keyboard inset.
 *
 * The mobile audit (2026 10 23) found that no file in the tree read
 * the visual viewport, so on phones whose keyboard overlays the
 * layout viewport instead of shrinking it, composers and ask bars
 * sat under the keyboard and nothing moved them.
 *
 * This module is the one place that reads window.visualViewport.
 * The pure computation is separate from the DOM read so tests can
 * pin it with mocked numbers:
 *
 *   computeKeyboardInset({ innerHeight, visualHeight, visualOffsetTop })
 *     returns the pixels of layout viewport covered at the bottom:
 *     innerHeight minus the visual viewport height minus its top
 *     offset, clamped at zero. A gap under 2px is browser chrome
 *     jitter, not a keyboard, and reads as zero.
 *
 *   useKeyboardInset()
 *     React hook returning the current inset in pixels. It tracks
 *     visualViewport resize and scroll plus window resize, and
 *     returns 0 where there is no visual viewport (desktop browsers
 *     report a visual viewport the same size as the layout one, so
 *     the inset stays 0 there too).
 *
 * Consumers keep their composer or ask bar above the inset:
 * the Inbox root pads its bottom by it, the search stage composer
 * reserves scroll margin of it, and the Reader ask bar lifts its
 * bottom offset by it.
 */

import { useState, useEffect } from "react";

export function computeKeyboardInset(metrics) {
  if (!metrics) return 0;
  const inner = Number(metrics.innerHeight);
  const visual = Number(metrics.visualHeight);
  if (!Number.isFinite(inner) || !Number.isFinite(visual) || visual <= 0) return 0;
  const offsetTop = Number(metrics.visualOffsetTop) || 0;
  const raw = inner - visual - offsetTop;
  if (!Number.isFinite(raw) || raw < 2) return 0;
  return Math.round(raw);
}

export function readKeyboardInset(win) {
  try {
    const w = win || (typeof window !== "undefined" ? window : null);
    if (!w || !w.visualViewport) return 0;
    return computeKeyboardInset({
      innerHeight: w.innerHeight,
      visualHeight: w.visualViewport.height,
      visualOffsetTop: w.visualViewport.offsetTop,
    });
  } catch {
    return 0;
  }
}

export function useKeyboardInset() {
  const [inset, setInset] = useState(() => readKeyboardInset());
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const vv = window.visualViewport || null;
    const update = () => setInset(readKeyboardInset());
    update();
    if (vv) {
      vv.addEventListener("resize", update);
      vv.addEventListener("scroll", update);
    }
    window.addEventListener("resize", update);
    return () => {
      if (vv) {
        vv.removeEventListener("resize", update);
        vv.removeEventListener("scroll", update);
      }
      window.removeEventListener("resize", update);
    };
  }, []);
  return inset;
}
