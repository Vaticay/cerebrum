/**
 * designSystem.js — Cerebrum's shared design primitives.
 *
 * Extracted from CerebrumApp.jsx (monolith split, 2026-10-07).
 * These are deliberately small and unclever — no variant explosion, no
 * styled-components, no theme provider. Each takes the palette it is
 * handed and returns one well-made thing.
 *
 * Contents: type scale (TYPE, FONT_SIZES), spacing (SP), radius (RADIUS),
 * color helpers (STATUS, accentText, relLuminance, withAlpha), Icon,
 * and the primitive components (UIButton, UICard, UIRow, UIField,
 * UISelect, S_toolbarBtnBase, VerifiedCheck, FounderFrame, BADGE_*).
 *
 * Wave 1 foundation, 2026-10-14: foundation tokens now follow the
 * overhaul plan, with the plan type scale, flat surfaces, and borders
 * over shadows. The learning art palette, Paper Cream #F5EFE2 and
 * friends in docs/cortex-style-guide.md, governs artwork only and is
 * deliberately NOT flattened by these UI tokens.
 */

import { useState, useRef, useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { PALETTES } from "./palettes.js";

export const FONT_SIZES = {
  // Plan scale, 2026-10-14: display 32/1.2/500, section 22/1.3/500,
  // subhead 17/1.4/500, body 15/1.55/400, label 13/1.4/400, caption
  // 12/1.3/400. Weights 400 and 500 only.
  // Folded 2026-10-19 (design audit M1): the old title and heading
  // size, 18, is a size the plan does not contain, so it is gone.
  // Title folded into subhead (card titles, ledes, prompts) and
  // heading folded into section. Every key below is either a plan
  // role or an exact plan value alias.
  caption: 12,      // caption and meta, timestamps, metadata, badges
  label: 13,        // label and control, form inputs, chips, buttons
  body: 15,         // body, primary prose everywhere
  subhead: 17,      // subhead, card titles, card subheads, ledes
  section: 22,      // section, plan role for section headings
  display: 32,      // display, mastheads, callouts, hero titles
  // The landing sweep finished 2026-10-19: every read site in the
  // app now names a plan role above, so the old alias keys (title,
  // heading, hero, small, micro) are deleted. FONT_SIZES carries
  // plan roles only (design audit M1, closed).
};

// Plan palette on the existing dark backgrounds, 2026-10-14.
export const COLOR = {
  ink: "#E8E6E3",
  ink2: "#A8A49E",
  faint: "#96928C",
  accent: "#C4A35A",
  accentInk: "#121110",
  surface1: "#1C1B19",
  surface2: "#242320",
  field: "#161513",
  line: "#2E2C29",
  lineSubtle: "#252422",
  support: "#7A9E7E",
  caution: "#B08B4F",
};

// Raw status hues. For status TEXT on a themed surface, never use these
// directly: the light theme variants live with statusBad/statusWarn/
// statusGood in appUtils.js (the raw warn and good fail 4.5:1 on light).
// Wave 1 arbitration, 2026-10-14: the plan support and caution tokens
// live on COLOR above for non text accents. These raw text hues stay at
// their contrast proven values on purpose: the plan caution and support
// compute to about 4.1 and 4.3 to 1 on the Mid palette surface, under
// the 4.5 to 1 status text law pinned in tests/core-identity.mjs, so
// unifying STATUS onto them would ship failing status text.
export const STATUS = { good: "#10b981", warn: "#d9a520", bad: "#e5484d" };

// Pro brand colors (M58, 2026-10-18): one color for identity and one
// color for action, named here so call sites stop mixing them. Identity
// is the gold #d4a437 (tier labels, identity marks). Action is the
// emerald #34d399 (purchase and upgrade buttons), and actionInk is the
// one ink that sits on that emerald fill. This is a brand decision, not
// the user's selected accent. The emerald names stay as aliases for the
// action pair because older call sites already read them.
export const PRO = {
  identity: "#d4a437",
  action: "#34d399",
  actionInk: "#06281c",
  // The action emerald darkened for light grounds (text links), where
  // the fill value cannot hold contrast (2026-10-19 landing, M58).
  actionOnLight: "#047857",
  emerald: "#34d399",
  emeraldInk: "#06281c",
};

export function accentText(hex) {
  if (!hex || hex[0] !== "#" || hex.length < 7) return "#111";
  // Pick whichever ink - white or #0f172a - has the stronger WCAG contrast
  // ratio against the accent. The old weighted-sum threshold handed white
  // text to mid-tone accents (Sage #8ba888: white 2.61:1, dark ink 6.85:1),
  // failing every primary button in every palette under Sage.
  const L = relLuminance(hex);
  const rWhite = 1.05 / (L + 0.05);
  const rDark = (L + 0.05) / (relLuminance("#0f172a") + 0.05);
  return rWhite >= rDark ? "#fff" : "#0f172a";
}

export function relLuminance(hex) {
  if (typeof hex !== "string" || !/^#[0-9a-fA-F]{6}$/.test(hex)) return 1;
  const c = (v) => { const n = parseInt(v, 16) / 255; return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4); };
  return 0.2126 * c(hex.slice(1, 3)) + 0.7152 * c(hex.slice(3, 5)) + 0.0722 * c(hex.slice(5, 7));
}

export function withAlpha(hex, a) {
  // Never throw: accent is optional at several call sites, and a crash here
  // takes down the whole render. Fall back to a neutral gray wash.
  if (typeof hex !== "string" || !/^#[0-9a-fA-F]{6}$/.test(hex)) return `rgba(128,128,128,${a})`;
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16); return `rgba(${r},${g},${b},${a})`;
}

export function Icon({ name, size = 18, className, style }) {
  const common = {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round",
    strokeLinejoin: "round", className, style,
    "aria-hidden": true, focusable: false,
  };
  switch (name) {
    case "plus": return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
    case "bookmark": return <svg {...common}><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" /></svg>;
    case "bookmarkFilled": return <svg {...common} fill="currentColor" stroke="none"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" /></svg>;
    case "settings": return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>;
    case "volumeOn": return <svg {...common}><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13" /></svg>;
    case "volumeOff": return <svg {...common}><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M22 9l-6 6M16 9l6 6" /></svg>;
    case "search": return <svg {...common}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.2-4.2" /></svg>;
    case "question": return <svg {...common}><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.6a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1.1.9-1.1 1.8" /><circle cx="12" cy="16.9" r="1" fill="currentColor" stroke="none" /></svg>;
    case "close": return <svg {...common}><path d="M18 6L6 18M6 6l12 12" /></svg>;
    case "menu": return <svg {...common}><path d="M4 6h16M4 12h16M4 18h16" /></svg>;
    case "arrowRight": return <svg {...common}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
    case "mic": return <svg {...common}><path d="M12 15a3 3 0 003-3V6a3 3 0 00-6 0v6a3 3 0 003 3z" /><path d="M5 12a7 7 0 0014 0M12 19v3" /></svg>;
    // Commit 65 — watched topics. A bell rather than a bookmark: watching a
    // topic isn't saving it, it's asking to be told when it changes.
    case "bell": return <svg {...common}><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 01-3.4 0" /></svg>;
    case "check": return <svg {...common}><path d="M20 6L9 17l-5-5" /></svg>;
    // v28: the toolbar's Copy button used to borrow "check" (a checkmark)
    // because it always had a visible "Copy answer" text label to carry the
    // actual meaning. Icon-only buttons can't lean on a label like that, so
    // Copy gets its own real clipboard glyph.
    case "copy": return <svg {...common}><rect x="8" y="8" width="12" height="12" rx="1.5" /><path d="M16 8V5.5A1.5 1.5 0 0014.5 4h-9A1.5 1.5 0 004 5.5v9A1.5 1.5 0 005.5 16H8" /></svg>;
    case "external": return <svg {...common}><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><path d="M15 3h6v6M10 14L21 3" /></svg>;
    case "chevronDown": return <svg {...common}><path d="M6 9l6 6 6-6" /></svg>;
    case "chevronRight": return <svg {...common}><path d="M9 6l6 6-6 6" /></svg>;
    case "chevronLeft": return <svg {...common}><path d="M15 18l-6-6 6-6" /></svg>;
    case "arrowUpRight": return <svg {...common}><path d="M7 17L17 7M7 7h10v10" /></svg>;
    case "trash": return <svg {...common}><path d="M3 6h18" /><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6M14 11v6" /></svg>;
    case "download": return <svg {...common}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>;
    // Commit 92 — the evidence table's toolbar button.
    case "table": return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 10v10" /></svg>;
    // Commit 87 — used by EvidenceFilter's disclosure trigger.
    case "filter": return <svg {...common}><path d="M3 5h18M7 12h10M11 19h2" /></svg>;
    case "sparkle": return <svg {...common}><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8L12 2z" /></svg>;
    // Human-audit: the Space trend category used to borrow "sparkle" — the
    // universal "an AI did this" badge. Space gets its own planet glyph.
    case "history": return <svg {...common}><path d="M3 12a9 9 0 109-9 9 9 0 00-9 9z" /><path d="M12 7v5l3 3" /><path d="M3 3v6h6" /><path d="M3 9a9 9 0 011.5-3.5" /></svg>;
    case "image": return <svg {...common}><rect x="3" y="3" width="18" height="18" rx="2.5" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>;
    case "pin": return <svg {...common}><path d="M12 21s-7-7.7-7-12.3A7 7 0 0 1 19 8.7C19 13.3 12 21 12 21z" /><circle cx="12" cy="8.7" r="2.4" /></svg>;
    case "pinFilled": return <svg {...common} fill="currentColor" stroke="none"><path d="M12 21s-7-7.7-7-12.3A7 7 0 0 1 19 8.7C19 13.3 12 21 12 21zm0-10a2.4 2.4 0 100-4.8 2.4 2.4 0 000 4.8z" /></svg>;
    case "warning": return <svg {...common}><path d="M12 3.5L21.5 20H2.5L12 3.5z" /><path d="M12 10v4M12 16.7h.01" /></svg>;
    case "edit": return <svg {...common}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>;
    case "link": return <svg {...common}><path d="M9.5 14.5l5-5" /><path d="M13.5 6l1.3-1.3a3.6 3.6 0 015 5L18.5 11" /><path d="M10.5 18l-1.3 1.3a3.6 3.6 0 01-5-5L5.5 13" /></svg>;
    case "chart": return <svg {...common}><path d="M3 3v18h18" /><path d="M7 17v-5M12 17V8M17 17v-9" /></svg>;
    case "gauge": return <svg {...common}><path d="M4.5 19a9 9 0 1115 0" /><path d="M12 15l4.5-4.5" /><circle cx="12" cy="15" r="1.3" fill="currentColor" stroke="none" /></svg>;
    case "shield": return <svg {...common}><path d="M12 2.5l8 3.2v5.8c0 5.2-3.4 8.9-8 10.3-4.6-1.4-8-5.1-8-10.3V5.7z" /></svg>;
    case "lock": return <svg {...common}><rect x="5" y="10.5" width="14" height="9.5" rx="2" /><path d="M8 10.5V7.5a4 4 0 018 0v3" /></svg>;
    case "partial": return <svg {...common}><path d="M4 13c1.6-2.6 3.2-2.6 4.8 0s3.2 2.6 4.8 0 3.2-2.6 4.8 0" /></svg>;
    case "printer": return <svg {...common}><path d="M6 9V3h12v6" /><rect x="4" y="9" width="16" height="8" rx="1.5" /><path d="M6 17v4h12v-4" /></svg>;
    case "eye": return <svg {...common}><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>;
    case "user": return <svg {...common}><circle cx="12" cy="8" r="3.5" /><path d="M4.5 20.5a7.5 7.5 0 0115 0" /></svg>;
    case "folder": return <svg {...common}><path d="M3 6.5A1.5 1.5 0 014.5 5h4.5l2 2.5H19.5A1.5 1.5 0 0121 9v9a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 18z" /></svg>;
    case "compare": return <svg {...common}><rect x="3" y="4" width="8" height="16" rx="1.5" /><rect x="13" y="4" width="8" height="16" rx="1.5" /></svg>;
    case "network": return <svg {...common}><circle cx="12" cy="4.5" r="2" /><circle cx="5" cy="18" r="2" /><circle cx="19" cy="18" r="2" /><path d="M12 6.5v5M12 11.5L6.3 16.3M12 11.5l5.7 4.8" /></svg>;
    case "refresh": return <svg {...common}><path d="M21 12a9 9 0 01-15.3 6.4M3 12a9 9 0 0115.3-6.4" /><path d="M21 4v6h-6M3 20v-6h6" /></svg>;
    case "wand": return <svg {...common}><path d="M4 20L18 6" /><path d="M15 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1z" /><path d="M6 15l.6 1.4L8 17l-1.4.6L6 19l-.6-1.4L4 17l1.4-.6z" /></svg>;
    case "timeline": return <svg {...common}><path d="M3 12h18" /><circle cx="6" cy="12" r="1.8" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" /><circle cx="18" cy="12" r="1.8" fill="currentColor" stroke="none" /></svg>;
    // Flowchart Studio: a process box flowing into a decision diamond flowing
    // into an output box — the three shapes read as "flowchart" at 17px.
    case "flowchart": return <svg {...common}><rect x="8.5" y="2.5" width="7" height="4.6" rx="1" /><path d="M12 7.1v1.6" /><path d="M12 8.7l4.6 3.4L12 15.5l-4.6-3.4z" /><path d="M12 15.5v1.6" /><rect x="7.5" y="17.1" width="9" height="4.4" rx="1" /></svg>;
    case "mail": return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3.5 6.5L12 13l8.5-6.5" /></svg>;
    case "send": return <svg {...common}><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" /></svg>;
    // Commit 98 — answer-quality feedback. /api/vote has existed since the
    // answer cache landed (and /api/search returns an answerId with the
    // comment "frontend can use this for upvote/downvote"), but nothing in
    // this file ever called it, so the score column that decides which
    // cached answers get served to everyone stayed permanently at 0.
    case "thumb-up": return <svg {...common}><path d="M7 20V10l4.2-7a2 2 0 013.6 1.5L14 9h4.6a2 2 0 011.95 2.45l-1.6 7A2 2 0 0117 20z" /><path d="M7 10H4v10h3z" /></svg>;
    case "thumb-down": return <svg {...common}><path d="M17 4v10l-4.2 7a2 2 0 01-3.6-1.5L10 15H5.4A2 2 0 013.45 12.55l1.6-7A2 2 0 017 4z" /><path d="M17 14h3V4h-3z" /></svg>;
    case "flag": return <svg {...common}><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" /></svg>;
    // Commit 48: standard "no entry" glyph (circle + diagonal bar) for
    // Block/Unblock controls — same off-slash language this file already
    // uses for micOff/cameraOff, applied to a plain circle instead of a
    // base glyph since "block" has no unblocked counterpart to slash.
    case "block": return <svg {...common}><circle cx="12" cy="12" r="9" /><line x1="5.5" y1="5.5" x2="18.5" y2="18.5" /></svg>;
    // Overflow "more actions" trigger — three dots, standard convention.
    case "moreVertical": return <svg {...common} fill="currentColor" stroke="none"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>;
    case "award": return <svg {...common}><circle cx="12" cy="8" r="6" /><path d="M15.5 12.9L17 22l-5-3-5 3 1.5-9.1" /></svg>;
    case "bookOpen": return <svg {...common}><path d="M12 7v14" /><path d="M3 18a1 1 0 01-1-1V4a1 1 0 011-1h5a4 4 0 014 4 4 4 0 014-4h5a1 1 0 011 1v13a1 1 0 01-1 1h-6a3 3 0 00-3 3 3 3 0 00-3-3z" /></svg>;
    // Cortex, the learning feature, gets its own mark: two open arcs
    // like cortical folds forming a C around a single point, the
    // finding at the center. Drawn to sit naturally beside bookOpen.
    case "cortex": return <svg {...common}><path d="M18.1 4.7A9.5 9.5 0 1 0 18.1 19.3" /><path d="M15.5 7.8A5.5 5.5 0 1 0 15.5 16.2" /><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" /></svg>;
    case "zap": return <svg {...common}><path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" /></svg>;
    case "camera": return <svg {...common}><path d="M4 8.5A1.5 1.5 0 015.5 7h2.2l1-1.6A1.5 1.5 0 0110 4.7h4a1.5 1.5 0 011.3.7l1 1.6h2.2A1.5 1.5 0 0120 8.5v10A1.5 1.5 0 0118.5 20h-13A1.5 1.5 0 014 18.5z" /><circle cx="12" cy="13" r="3.6" /></svg>;
    // Commit 46: added for VideoHuddle's FaceTime-style control island —
    // "off" variants follow this file's existing convention (see volumeOff
    // above) of the base glyph plus a diagonal slash, rather than a wholly
    // different symbol, so mic/camera on-vs-off reads as one pair at a
    // glance instead of two unrelated icons.
    case "micOff": return <svg {...common}><path d="M12 15a3 3 0 003-3V6a3 3 0 00-6 0v6a3 3 0 003 3z" /><path d="M5 12a7 7 0 0014 0M12 19v3" /><path d="M3 3l18 18" /></svg>;
    case "cameraOff": return <svg {...common}><path d="M4 8.5A1.5 1.5 0 015.5 7h2.2l1-1.6A1.5 1.5 0 0110 4.7h4a1.5 1.5 0 011.3.7l1 1.6h2.2A1.5 1.5 0 0120 8.5v10A1.5 1.5 0 0118.5 20h-13A1.5 1.5 0 014 18.5z" /><circle cx="12" cy="13" r="3.6" /><path d="M3 3l18 18" /></svg>;
    // Tile/grid view toggle for the huddle's "switch view" control.
    case "grid": return <svg {...common}><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" /></svg>;
    // End-call glyph: the standard rotated-handset silhouette (same shape
    // most icon sets use for "phone"), plus the same off-slash convention
    // as micOff/cameraOff above, for the red End Call button.
    case "phone": return <svg {...common}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z" /></svg>;
    case "phoneOff": return <svg {...common}><path d="M22 16.9v3a2 2 0 01-2.18 2 19.8 19.8 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.34 1.85.57 2.81.7a2 2 0 011.72 2.03z" /><path d="M2 2l20 20" /></svg>;
    // Huddle minimize/expand — four arrowheads pointing inward (shrink to a
    // bubble) or outward (back to full screen), the standard convention.
    case "minimize2": return <svg {...common}><path d="M8 3v4a1 1 0 01-1 1H3M16 3v4a1 1 0 001 1h4M8 21v-4a1 1 0 00-1-1H3M16 21v-4a1 1 0 011-1h4" /></svg>;
    case "maximize2": return <svg {...common}><path d="M3 8V5a2 2 0 012-2h3M21 8V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3M21 16v3a2 2 0 01-2 2h-3" /></svg>;
    // Screen-share control: a monitor with an upload arrow — this project's
    // existing convention (see "external") uses a rectangle+arrow language
    // for "send this out," reused here for the same reason.
    case "screenShare": return <svg {...common}><rect x="2" y="4" width="20" height="14" rx="2" /><path d="M12 15V8M9 11l3-3 3 3" /><path d="M8 21h8" /></svg>;
    // Slashed variant for the active-sharing state — same off-slash
    // convention as micOff/cameraOff above.
    case "screenShareOff": return <svg {...common}><rect x="2" y="4" width="20" height="14" rx="2" /><path d="M12 15V8M9 11l3-3 3 3" /><path d="M8 21h8" /><path d="M3 3l18 18" /></svg>;
    // Speaker-view glyph: one large tile, the counterpart to "grid" for
    // the huddle's switch-view toggle.
    case "speakerView": return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" /></svg>;
    case "document": return <svg {...common}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /></svg>;
    case "upload": return <svg {...common}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><path d="M17 8l-5-5-5 5" /><path d="M12 3v12" /></svg>;
    case "play": return <svg {...common} fill="currentColor" stroke="none"><path d="M8 5v14l11-7z" /></svg>;
    case "star": return <svg {...common}><path d="M12 2.8l2.8 5.8 6.4.9-4.7 4.5 1.1 6.3L12 17.3l-5.6 3 1.1-6.3L2.8 9.5l6.4-.9z" /></svg>;
    case "starFilled": return <svg {...common} fill="currentColor" stroke="none"><path d="M12 2.8l2.8 5.8 6.4.9-4.7 4.5 1.1 6.3L12 17.3l-5.6 3 1.1-6.3L2.8 9.5l6.4-.9z" /></svg>;
    case "pause": return <svg {...common}><path d="M9 5v14M15 5v14" strokeWidth={2.6} /></svg>;
    // Panel/sidebar toggle: a frame with its left panel divided off.
    case "panelLeft": return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9.5 4v16" /></svg>;
    // Studio brand mark: the two brain hemispheres joined by a link edge
    // with an arrowhead — the visual builder's "connect" in one glyph.
    case "studioMark": return <svg {...common}><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1 0-4.12A2.5 2.5 0 0 1 7.5 11a2.5 2.5 0 0 1 0-4.12A2.5 2.5 0 0 1 9.5 2Z" /><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 0-4.12A2.5 2.5 0 0 0 16.5 11a2.5 2.5 0 0 0 0-4.12A2.5 2.5 0 0 0 14.5 2Z" /><path d="M10.6 12h2.8M12.2 10.6l1.4 1.4-1.4 1.4" /></svg>;
    // Verdict glyphs: one shared ring geometry (r 8.5), four epistemic
    // states. Shape carries the meaning so no state depends on color
    // alone — colorblind-safe by construction.
    case "verdictSupported": return <svg {...common}><circle cx="12" cy="12" r="8.5" /><path d="M8.4 12.3l2.5 2.5 4.7-5.1" /></svg>;
    case "verdictMixed": return <svg {...common}><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5a8.5 8.5 0 010 17z" fill="currentColor" stroke="none" /></svg>;
    case "verdictContradicted": return <svg {...common}><path d="M16.25 4.64A8.5 8.5 0 1 1 7.75 4.64" /></svg>;
    case "verdictUnverified": return <svg {...common}><circle cx="12" cy="12" r="8.5" strokeDasharray="2.6 3.2" /></svg>;
    default: {
      if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn("[Cerebrum] Icon: unknown name", name);
      }
      return null;
    }
  }
}

export function S_toolbarBtnBase(P) { return { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 44, height: 44, background: "transparent", border: "none", borderRadius: 2, color: P.ink2, cursor: "pointer", fontFamily: "var(--cb-font)", transition: "background 150ms ease-out, color 150ms ease-out" }; }

/* TRACKING scale: tracking tokens now exist only for single word
   status labels, the one all caps case the plan allows. Headings and
   body carry no letterSpacing. Other files import these values, so
   the export and values stay. */
export const TRACKING = {
  eyebrow: "0.12em",      // uppercase section headers, eyebrows
  eyebrowWide: "0.2em",   // large/wide uppercase treatments
  label: "0.06em",        // small labels, badges, pill text
  labelTight: "0.04em",   // tighter small labels
  tight: "0.01em",        // minimal positive (matches TYPE.label)
};

/* TYPE roles carry their size since 2026-10-19 (design audit M1):
   a role spread now sets the full voice, family, size, weight and
   leading together, so a call site cannot pair a role with a raw
   numeric size and drift. Sizes are the plan sizes in FONT_SIZES.
   heading is the section role under its older name, kept because
   CerebrumApp.jsx reads TYPE.heading; section is the plan name. */
export const TYPE = {
  display: { fontFamily: "var(--cb-font)", fontSize: 32, fontWeight: 500, letterSpacing: 0, lineHeight: 1.2 },
  section: { fontFamily: "var(--cb-font)", fontSize: 22, fontWeight: 500, letterSpacing: 0, lineHeight: 1.3 },
  heading: { fontFamily: "var(--cb-font)", fontSize: 22, fontWeight: 500, letterSpacing: 0, lineHeight: 1.3 },
  subhead: { fontFamily: "var(--cb-font)", fontSize: 17, fontWeight: 500, letterSpacing: 0, lineHeight: 1.4 },
  body:    { fontFamily: "var(--cb-font)", fontSize: 15, fontWeight: 400, letterSpacing: 0, lineHeight: 1.55 },
  reading: { fontFamily: "var(--cb-serif)", fontSize: 15, fontWeight: 400, letterSpacing: 0, lineHeight: 1.55 }, // reading, answer body and lesson text only
  label:   { fontFamily: "var(--cb-font)", fontSize: 13, fontWeight: 500, letterSpacing: 0, lineHeight: 1.4 },
  caption: { fontFamily: "var(--cb-font)", fontSize: 12, fontWeight: 400, letterSpacing: 0, lineHeight: 1.3 },
  mono:    { fontFamily: "var(--cb-mono)", fontSize: 12, fontWeight: 500, letterSpacing: 0, lineHeight: 1.4 },
};

// 4px grid, rhythm 8/12/16/24/32/48.
export const SP = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };

export const LAYOUT = {
  prose: 720,
  answer: 1080,
  reader: 680,
  // Corrected to the shipped shell values, 2026-10-19 (design
  // audit M2): the sidebar ships at 216 and collapses to 68.
  sidebar: 216,
  sidebarCollapsed: 68,
  sources: 280,
  // Container widths in use, tokenized 2026-10-19 (M2). stage is
  // the 1160 column the intro door and the search stage share.
  // wide is the Nova home column, page the Settings column, stage
  // and lesson the two widths the lesson Player and path views
  // center on, screen the narrow centered screens (lesson intro,
  // lesson done, course complete), sheet the feedback sheet and
  // action bar column inside the lesson column, and measure the
  // capped measure inside centered screens.
  stage: 1160,
  wide: 1120,
  page: 760,
  lesson: 680,
  screen: 620,
  sheet: 640,
  measure: 520,
};

/* Z-index scale: every stacking layer in the app, named.
   Rules: use Z.* instead of raw numbers. Layers are ordered;
   within a layer, DOM order decides. Never invent a new number —
   if nothing fits, add a named slot here with a comment. */
export const Z = {
  behind: -1,       // decorative layers behind content
  base: 0,          // backgrounds, canvases
  content: 1,       // main content stacking contexts (load-bearing)
  raised: 2,        // raised in-flow elements (toolbars, close buttons)
  overlay: 3,       // in-flow overlays, hint badges
  float: 5,         // floating tooltips, small popovers in content
  sticky: 10,       // sticky elements inside scroll content
  fab: 15,          // small floating buttons (back-to-top)
  header: 20,       // sticky app headers and bars
  headerBar: 21,    // fixed mobile header bar
  backdrop: 29,     // mobile drawer backdrop (sits under the drawer)
  dropdown: 30,     // dropdown menus, popovers, sidebars
  dropdownMenu: 31, // dropdown panels above their trigger's layer
  popover: 40,      // popovers that must clear dropdowns
  popoverMenu: 41,  // popover panels
  fabPrimary: 50,   // primary floating action buttons
  tooltip: 60,      // tooltips, highlight menus
  menu: 70,         // floating menus above content
  badge: 90,        // inline badges above media
  grain: 100,       // film grain overlay
  banner: 150,      // fixed banners
  dialogScrim: 205, // dialog/drawer scrims (under the dialog)
  drawer: 210,      // drawers and bottom sheets
  dialog: 220,      // dialogs
  dialogBase: 214,  // dialogs that open under a standard dialog (2026-10-19 landing, audit M3: the dialog band named, values unchanged)
  dialogAuth: 215,  // the sign in modal, between dialogBase and dialogStep
  dialogStep: 216,  // profile dialogs, one step above dialogBase
  dialogMedia: 217, // media dialogs (video, article), one step above dialogStep
  dialogPlus: 230,  // dialogs that must clear a standard dialog (share, Zotero)
  overlayFixed: 240,// fixed full-screen overlays
  sheet: 260,       // bottom sheets (scrim is sheetScrim)
  sheetScrim: 258,  // bottom-sheet scrims (under the sheet)
  modal: 300,       // full-screen modals
  modalTop: 320,    // modals that must clear other modals
  consent: 330,     // the consent gate (2026-10-19, S7 shell lane, audit M3): above every dialog, below menus and toasts; Z.max stays dev overlays only
  selectMenu: 400,  // UISelect's portaled menu — must clear dialogs/modals
  toast: 9999,      // toasts and critical overlays
  max: 10000,       // absolute top (dev overlays only)
};

export function UIButton({
  children, onClick, variant = "secondary", size = "md",
  P = null, accent, at, icon, disabled, title, ariaLabel, full, type = "button", style,
  className = "", ...rest
}) {
  // Null-safe palette: components like ModalChrome/ChromeHeader pass P=null
  // for the dark instrument-glass treatment. Fall back to the dark palette
  // so variant skins never crash on pal.dark / pal.ink2.
  const pal = P || PALETTES.Dark;
  const pad = size === "sm" ? "6px 13px" : size === "lg" ? "12px 22px" : "9px 17px";
  const fs = size === "sm" ? FONT_SIZES.caption : FONT_SIZES.label;
  /* Flat skins, 2026-10-14: no gradients, no shadows, borders carry
     the edge. Primary is the flat accent, destructive is a flat tint. */
  const skins = {
    primary: {
      background: accent,
      color: at, border: "1px solid transparent",
      boxShadow: "none",
    },
    secondary: {
      background: pal.dark ? COLOR.surface1 : pal.surface,
      color: pal.ink, border: `1px solid ${pal.dark ? COLOR.line : pal.line2}`,
      boxShadow: "none",
    },
    ghost: {
      background: "transparent", color: pal.ink2, border: `1px solid ${pal.dark ? COLOR.line : pal.line2}`,
      boxShadow: "none",
    },
    destructive: {
      background: pal.dark
        ? withAlpha(STATUS.bad, 0.16)
        : withAlpha(STATUS.bad, 0.08),
      color: STATUS.bad, border: `1px solid ${withAlpha(STATUS.bad, 0.35)}`,
      boxShadow: "none",
    },
  };
  return (
    <button
      type={type} onClick={onClick} disabled={disabled} title={title} aria-label={ariaLabel}
      className={("cb-press " + className).trim()}
      {...rest}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: SP.sm,
        // Keep minHeight 44: the standing touch target floor outranks the plan's 36 to 40px visual height.
        minHeight: 44,
        padding: pad, borderRadius: RADIUS.md, cursor: disabled ? "not-allowed" : "pointer",
        ...TYPE.label, fontSize: fs, fontWeight: 500,
        transition: "background-color 150ms ease-out, border-color 150ms ease-out, color 150ms ease-out",
        width: full ? "100%" : undefined,
        opacity: disabled ? 0.5 : 1,
        ...skins[variant],
        ...style,
      }}
    >
      {icon && <Icon name={icon} size={size === "sm" ? 13 : 15} />}
      {children}
    </button>
  );
}

export function UICard({ children, P = null, pad = true, className = "", style, onClick, specimen = false }) {
  const pal = P || PALETTES.Dark;
  return (
    <div
      onClick={onClick}
      // Clickable cards are keyboard-operable: role + tabIndex + Enter/Space.
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(e); } } : undefined}
      className={"cb-card cb-material-panel " + (specimen ? "cb-specimen " : "") + className}
      style={{
        borderRadius: RADIUS.lg,
        background: pal.dark ? COLOR.surface1 : pal.surface,
        border: `1px solid ${pal.dark ? COLOR.line : pal.line2}`,
        boxShadow: "none",
        padding: pad ? "20px 24px" : 0,
        overflow: "hidden", minWidth: 0,
        cursor: onClick ? "pointer" : undefined,
        ...style,
      }}
    >{children}</div>
  );
}

export function UIRow({ label, desc, control, onClick, P = null, accent, last, tone, style, paletteName }) {
  const pal = P || PALETTES.Dark;
  return (
    <div
      onClick={onClick}
      // Clickable rows are keyboard-operable: role + tabIndex + Enter/Space.
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(e); } } : undefined}
      className={onClick ? "cb-row" : undefined}
      style={{
        display: "flex", alignItems: "center", gap: SP.md,
        padding: `${SP.md}px ${SP.lg}px ${SP.md}px ${SP.lg - 2}px`,
        minHeight: 46,
        borderBottom: last ? "none" : `1px solid ${pal.dark ? COLOR.lineSubtle : pal.line}`,
        cursor: onClick ? "pointer" : "default", minWidth: 0, ...style,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...TYPE.label, fontSize: FONT_SIZES.body, fontWeight: 500, color: tone === "bad" ? (pal.dark ? (paletteName === "Mid" ? "#ff7a7a" : STATUS.bad) : "#b92c31") : pal.ink, overflowWrap: "anywhere" }}>{label}</div>
        {desc && <div style={{ fontSize: FONT_SIZES.label, fontWeight: 400, color: pal.ink2, lineHeight: 1.5, marginTop: 2, overflowWrap: "anywhere" }}>{desc}</div>}
      </div>
      {control && <div style={{ flexShrink: 0 }}>{control}</div>}
    </div>
  );
}

export function UIField({ value, onChange, placeholder, P = null, accent, multiline, rows = 3, ariaLabel, maxLength, style, onKeyDown, className = "" }) {
  const pal = P || PALETTES.Dark;
  const base = {
    width: "100%", padding: `${SP.md - 2}px ${SP.md}px`, borderRadius: RADIUS.md,
    background: pal.dark ? COLOR.field : pal.surface,
    border: `1px solid ${pal.dark ? COLOR.line : pal.line}`, color: pal.ink, outline: "none",
    /* 16px floor: iOS Safari zooms the viewport on focus for anything
       smaller, so every text input holds 16px on all viewports. */
    ...TYPE.body, fontSize: 16, minWidth: 0, ...style,
  };
  const common = { value, onChange, placeholder, "aria-label": ariaLabel || placeholder, maxLength, onKeyDown, className: ("cb-field " + className).trim(), style: base };
  return multiline
    ? <textarea rows={rows} {...common} style={{ ...base, resize: "vertical" }} />
    : <input {...common} />;
}

export const RADIUS = {
  // Plan radius, 2026-10-14: the plan caps radius at 2px everywhere.
  // Token names are retained so call sites do not churn, and pill no
  // longer means round.
  sm: 2, md: 2, lg: 2, xl: 2, pill: 2,
  viewport: 2,
};

/* TICKS — the instrument registration-mark motif.
   Corner ticks (small L-shaped marks, 8px arms, 1.5px weight) frame
   viewports the way a microscope viewfinder or NASA targeting reticle
   does: answer cards, the composer, evidence drawers, specimen
   viewports. Controls (buttons, chips, inputs) stay rounded pills —
   controls are friendly, viewports are precise. The contrast between
   soft controls and ticked viewports is the recognizable grammar.
   Rule: ticks live on viewports or they mean nothing. Never on
   marketing buttons, toasts, or menus. */
export const TICKS = {
  arm: 8,      // length of each tick arm, px
  weight: 1.5, // tick stroke weight, px
  inset: -1,   // tick offset from the frame edge (negative straddles it)
};

/* TickFrame — a viewport framed by corner registration ticks.
   Hairline border plus four L-shaped ticks in the accent (or tickColor).
   Static: no animation, so nothing about it needs a reduced-motion
   fallback. Pass P for the hairline, accent for the ticks. */
export function TickFrame({ children, P = null, accent, tickColor, className = "", style, radius = RADIUS.viewport, border = true, ...rest }) {
  const pal = P || PALETTES.Dark;
  const tc = tickColor || accent || pal.ink2;
  const a = TICKS.arm, w = TICKS.weight, ins = TICKS.inset;
  // One L path (top-left corner); the other three corners reuse it via
  // rotation. Verified: rotate(90) puts the vertex top-right, 180
  // bottom-right, 270 bottom-left.
  const lPath = `M ${a} 0.75 H 0.75 V ${a}`;
  const corner = (key, pos, rotate) => (
    <svg key={key} aria-hidden="true" width={a} height={a} viewBox={`0 0 ${a} ${a}`}
      style={{
        position: "absolute", overflow: "visible", pointerEvents: "none",
        color: tc, flexShrink: 0,
        top: pos[0] === "t" ? ins : "auto",
        bottom: pos[0] === "b" ? ins : "auto",
        left: pos[1] === "l" ? ins : "auto",
        right: pos[1] === "r" ? ins : "auto",
        transform: rotate ? `rotate(${rotate}deg)` : undefined,
      }}>
      <path d={lPath} fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" />
    </svg>
  );
  return (
    <div
      className={("cb-tickframe " + className).trim()}
      {...rest}
      style={{
        position: "relative",
        borderRadius: radius,
        border: border ? `1px solid ${pal.line}` : "none",
        ...style,
      }}
    >
      {corner("tl", ["t", "l"], 0)}
      {corner("tr", ["t", "r"], 90)}
      {corner("br", ["b", "r"], 180)}
      {corner("bl", ["b", "l"], 270)}
      {children}
    </div>
  );
}

/* SHADOW scale: pass the palette P. Plan rule, 2026-10-14: borders
   carry depth, shadows are gone except the modal line. xs, sm, md,
   and lg return none for both dark and light, and xl returns the
   one allowed modal shadow. */
export const SHADOW = {
  xs: (P) => "none",
  sm: (P) => "none",
  md: (P) => "none",
  lg: (P) => "none",
  xl: (P) => "0 1px 0 rgba(0,0,0,0.4)",
};

export const BADGE_DISPLAY = {
  founder: { label: "Founder & Owner", icon: "award", tint: "#c9a227" },
  verified: { label: "Verified", icon: "check", tint: PRO.emerald },
  cortex_contributor: { label: "Nova Contributor", icon: "cortex", tint: "#A3B899" },
  early_adopter: { label: "Early adopter", icon: "zap", tint: "#b45309" },
  first_question: { label: "First question", icon: "history", tint: "#7ea6c9" },
  ten_questions: { label: "Ten investigations", icon: "history", tint: "#7ea6c9" },
  fifty_questions: { label: "Fifty investigations", icon: "history", tint: "#7ea6c9" },
  first_save: { label: "First paper saved", icon: "bookmark", tint: "#c97e7e" },
  ten_saves: { label: "Ten papers saved", icon: "bookmark", tint: "#c97e7e" },
  fifty_saves: { label: "Fifty papers saved", icon: "bookmarkFilled", tint: "#c97e7e" },
  first_collection: { label: "First collection", icon: "folder", tint: "#b39ddb" },
  first_watch: { label: "First watched topic", icon: "eye", tint: "#8fb8a8" },
  five_watches: { label: "Five watched topics", icon: "eye", tint: "#8fb8a8" },
  first_follow: { label: "First researcher followed", icon: "network", tint: "#d0a35f" },
};

export const BADGE_ORDER = [
  "founder", "verified", "cortex_contributor", "early_adopter",
  "first_question", "ten_questions", "fifty_questions",
  "first_save", "ten_saves", "fifty_saves",
  "first_collection", "first_watch", "five_watches", "first_follow",
];

export function VerifiedCheck({ size = 15, title = "Verified: the owner of Cerebrum" }) {
  return (
    <span title={title} aria-label={title} role="img" style={{ display: "inline-flex", flexShrink: 0, verticalAlign: "middle" }}>
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <path fill={PRO.emerald} d="M12 1.6l2.6 2.05 3.3-.2.55 3.27 2.85 1.68-1.3 3.05 1.3 3.05-2.85 1.68-.55 3.27-3.3-.2L12 22.4l-2.6-2.05-3.3.2-.55-3.27L2.7 15.6 4 12.55 2.7 9.5l2.85-1.68.55-3.27 3.3.2z" />
        <path fill="#fff" d="M10.9 15.4l-3-3 1.2-1.2 1.8 1.8 4.1-4.1 1.2 1.2z" />
      </svg>
    </span>
  );
}

export function FounderFrame({ size = 96, children, accent }) {
  return (
    <span className="cb-founder-frame" style={{
      position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: size + 10, height: size + 10, borderRadius: "50%", flexShrink: 0,
    }}>
      <span aria-hidden="true" style={{
        position: "absolute", inset: 0, borderRadius: "50%",
        border: "2px solid #c9a227", background: "transparent", boxSizing: "border-box",
      }} />
      <span aria-hidden="true" style={{
        position: "absolute", inset: 3, borderRadius: "50%",
        background: "var(--cb-bg, #0b0d0e)",
      }} />
      <span style={{ position: "relative", display: "inline-flex" }}>{children}</span>
    </span>
  );
}



function ProBadge({ style } = {}) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      fontSize: FONT_SIZES.caption, fontWeight: 500, letterSpacing: TRACKING.eyebrow,
      fontFamily: "var(--cb-font)", color: PRO.actionInk,
      background: PRO.action,
      borderRadius: 2, padding: "2px 8px 2px 9px",
      whiteSpace: "nowrap", ...style,
    }}>PRO</span>
  );
}

function TierBadge({ tier, style } = {}) {
  if (tier === "pro") return <ProBadge style={style} />;
  if (tier === "lite") return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      fontSize: FONT_SIZES.caption, fontWeight: 500, letterSpacing: TRACKING.eyebrow,
      fontFamily: "var(--cb-font)", color: "#c99a2e",
      border: "1px solid rgba(212,164,55,0.55)",
      borderRadius: 2, padding: "1px 8px 1px 9px",
      whiteSpace: "nowrap", ...style,
    }}>LITE</span>
  );
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      fontSize: FONT_SIZES.caption, fontWeight: 500, letterSpacing: TRACKING.eyebrow,
      fontFamily: "var(--cb-font)", color: "#9aa3a8",
      border: "1px solid rgba(150,160,165,0.4)",
      borderRadius: 2, padding: "1px 8px 1px 9px",
      whiteSpace: "nowrap", ...style,
    }}>FREE</span>
  );
}

export { ProBadge, TierBadge };

/* UISelect — the premium replacement for the native <select>.
   The design audit scored Settings 600/1000 and called the native select
   "the cheapest control in the app": even de-chromed with a custom chevron
   it still opened the browser's own dropdown. UISelect is a fully custom
   listbox. The trigger wears the UIButton secondary skin (lit top edge,
   moulded border, shared cb-glass-action hover lift) with a chevronDown
   Icon that rotates open; the menu speaks the same depth language
   (SHADOW.md, RADIUS.lg, 6px padding, RADIUS.md options) with an accent
   hover wash and a selected checkmark.
   The menu portals to document.body with fixed positioning so it is never
   clipped by an overflow:hidden ancestor (dialogs, scroll regions) — the
   native dropdown's one real advantage. It closes on scroll, resize,
   outside mousedown, Escape, or Tab, and flips upward when there is no
   room below. Keyboard: arrows/Home/End move, Enter/Space chooses,
   Escape closes. ARIA: trigger has listbox popup semantics with
   aria-activedescendant; the menu is role=listbox, options role=option.
   Options accept [{ value, label }] or [[value, label]] pairs. */
export function UISelect({
  P = null, accent, value, onChange, options = [], ariaLabel,
  disabled = false, size = "md", style, menuStyle, className = "",
}) {
  const pal = P || PALETTES.Dark;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const listId = `cb-uiselect-${uid}`;

  const opts = (options || []).map((o) => (Array.isArray(o) ? { value: o[0], label: o[1] } : o));
  const selIdx = opts.findIndex((o) => String(o.value) === String(value));
  const selected = selIdx >= 0 ? opts[selIdx] : null;

  const close = (refocus) => {
    setOpen(false);
    setActive(-1);
    setPos(null);
    if (refocus && triggerRef.current) triggerRef.current.focus();
  };
  const openMenu = (atIdx) => {
    if (disabled || opts.length === 0) return;
    const r = triggerRef.current ? triggerRef.current.getBoundingClientRect() : null;
    if (r) {
      const need = Math.min(280, opts.length * 44 + 12) + 12;
      const up = r.bottom + need > window.innerHeight && r.top > need;
      const width = Math.max(r.width, 180);
      setPos({
        left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
        width,
        ...(up ? { bottom: Math.max(8, window.innerHeight - r.top + 6) } : { top: r.bottom + 6 }),
      });
    }
    setActive(typeof atIdx === "number" ? atIdx : (selIdx >= 0 ? selIdx : 0));
    setOpen(true);
  };
  const choose = (i) => {
    const o = opts[i];
    close(true);
    if (o && String(o.value) !== String(value) && onChange) onChange(o.value);
  };
  const onKeyDown = (e) => {
    if (disabled) return;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openMenu(e.key === "ArrowUp" ? opts.length - 1 : undefined);
      }
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); close(true); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % opts.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + opts.length) % opts.length); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(opts.length - 1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(active >= 0 ? active : 0); }
    else if (e.key === "Tab") { close(false); }
  };

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (triggerRef.current && triggerRef.current.contains(e.target)) return;
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      close(false);
    };
    const onScroll = () => close(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open ]);

  useEffect(() => {
    if (!open || active < 0 || !menuRef.current) return;
    const el = menuRef.current.querySelector(`[data-idx="${active}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [open, active ]);

  const triggerFs = size === "sm" ? FONT_SIZES.caption : FONT_SIZES.label;
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        aria-activedescendant={open && active >= 0 ? `${listId}-opt-${active}` : undefined}
        onClick={() => { if (open) close(false); else openMenu(); }}
        onKeyDown={onKeyDown}
        className={("cb-press " + className).trim()}
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "space-between",
          /* 44px floor at every size (2026-10-14): the sm trigger used
             to be 36px, an interactive target under the floor. */
          gap: SP.sm, minHeight: 44,
          padding: size === "sm" ? "6px 10px" : "9px 12px",
          borderRadius: RADIUS.md,
          background: pal.dark ? COLOR.surface1 : pal.surface,
          color: pal.ink, border: `1px solid ${pal.dark ? COLOR.line : pal.line2}`,
          boxShadow: "none",
          fontSize: triggerFs, fontWeight: 500, letterSpacing: "-0.005em",
          fontFamily: "var(--cb-font)", textAlign: "left",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1, minWidth: 0,
          ...style,
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selected ? selected.label : ""}
        </span>
        <Icon name="chevronDown" size={14} style={{
          flexShrink: 0, color: pal.faint,
          transform: open ? "rotate(180deg)" : "none",
          transition: "transform 150ms ease-out",
        }} />
      </button>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          id={listId}
          aria-label={ariaLabel}
          style={{
            position: "fixed", zIndex: Z.selectMenu,
            left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width,
            maxHeight: 280, overflowY: "auto",
            background: pal.dark ? COLOR.surface1 : "#ffffff",
            border: `1px solid ${pal.dark ? COLOR.line : pal.line}`, borderRadius: RADIUS.lg, padding: 6,
            /* No shadow on menus (2026-10-19, S7 shell lane, audit M3):
               the 1px border carries the menu, like every other menu. */
            boxShadow: "none",
            ...menuStyle,
          }}
        >
          {opts.map((o, i) => {
            const isSel = i === selIdx;
            const isActive = i === active;
            return (
              <div
                key={`${o.value}:${i}`}
                id={`${listId}-opt-${i}`}
                data-idx={i}
                role="option"
                aria-selected={isSel}
                onClick={() => choose(i)}
                onMouseEnter={() => setActive(i)}
                style={{
                  minHeight: 44, display: "flex", alignItems: "center", gap: SP.sm,
                  padding: "8px 10px", borderRadius: RADIUS.md, cursor: "pointer",
                  background: isActive
                    ? (accent ? withAlpha(accent, 0.12) : pal.dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)")
                    : "transparent",
                  color: pal.ink, fontSize: FONT_SIZES.label, fontWeight: 500,
                  fontFamily: "var(--cb-font)",
                }}
              >
                <span style={{ width: 16, flexShrink: 0, display: "inline-flex", justifyContent: "center", color: accent || pal.ink }}>
                  {isSel ? <Icon name="check" size={14} /> : null}
                </span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.label}</span>
              </div>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}
