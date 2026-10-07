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
 * S_toolbarBtnBase, VerifiedCheck, FounderFrame, BADGE_*).
 */

export const FONT_SIZES = {
  // The 6-role editorial scale (DESIGN_RESEARCH.md §7.1): every size in
  // the product maps to one of these roles. Near-duplicates were merged
  // (micro 11→caption 12, subhead 17→title 18; sectionHead 20 is gone).
  // Mono-for-data is a treatment, not a second family — tabular numerals
  // in --cb-font (standing law: one unified typeface). Weight contract
  // (§11): body 450–500, controls/labels 600, headings 650–700.
  caption: 12,      // caption/meta — timestamps, metadata, badges, eyebrows
  label: 13,        // label/control — form inputs, chips, tab labels, buttons
  body: 15,         // body — primary prose everywhere, 45–75ch, leading 1.5–1.65
  title: 18,        // title — section headings, ledes, card titles
  display: 24,      // display — mastheads, callouts, mobile hero titles
  hero: 34,         // display, large step — desktop hero titles, stat numbers
  // Legacy aliases — new code uses the six role names above.
  micro: 12, small: 13, subhead: 18, heading: 18,
};

export const STATUS = { good: "#10b981", warn: "#d9a520", bad: "#e5484d" };

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

export function Icon({ name, size = 17, className, style }) {
  const common = {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round",
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
    case "question": return <svg {...common}><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.6a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1.1.9-1.1 1.8" /><circle cx="12" cy="16.9" r="0.7" fill="currentColor" stroke="none" /></svg>;
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
    case "chevronLeft": return <svg {...common}><path d="M15 6l-6 6 6-6" /></svg>;
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
    case "pin": return <svg {...common}><path d="M12 21s-7-7.7-7-12.3A7 7 0 0119 8.7C19 13.3 12 21 12 21z" /><circle cx="12" cy="8.7" r="2.4" /></svg>;
    case "pinFilled": return <svg {...common} fill="currentColor" stroke="none"><path d="M12 21s-7-7.7-7-12.3A7 7 0 0119 8.7C19 13.3 12 21 12 21zm0-10a2.4 2.4 0 100-4.8 2.4 2.4 0 000 4.8z" /></svg>;
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
    case "speakerView": return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /></svg>;
    default: return null;
  }
}

export function S_toolbarBtnBase(P) { return { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 44, height: 44, background: "transparent", border: "none", borderRadius: 8, color: P.ink2, cursor: "pointer", fontFamily: "var(--cb-font)", transition: "background 0.15s ease, color 0.15s ease" }; }

export const TYPE = {
  display: { fontFamily: "var(--cb-font)", fontWeight: 700, letterSpacing: "-0.025em", lineHeight: 1.15 },
  heading: { fontFamily: "var(--cb-font)", fontWeight: 700, letterSpacing: "-0.015em", lineHeight: 1.25 },
  body:    { fontFamily: "var(--cb-font)", fontWeight: 450, letterSpacing: "0", lineHeight: 1.6 },
  label:   { fontFamily: "var(--cb-font)", fontWeight: 600, letterSpacing: "0.01em", lineHeight: 1.35 },
  mono:    { fontFamily: "var(--cb-font)", fontWeight: 500, letterSpacing: "0.01em", lineHeight: 1.4 },
};

export const SP = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

/* TRACKING scale: semantic letter-spacing for uppercase/label treatments.
   Use TRACKING.* instead of raw em values. The negative trackings live in
   TYPE (display/heading/body/label); these are the positive ones for
   eyebrows, badges, and small caps labels. */
export const TRACKING = {
  eyebrow: "0.12em",      // uppercase section headers, eyebrows
  eyebrowWide: "0.2em",   // large/wide uppercase treatments
  label: "0.06em",        // small labels, badges, pill text
  labelTight: "0.04em",   // tighter small labels
  tight: "0.01em",        // minimal positive (matches TYPE.label)
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
  overlayFixed: 240,// fixed full-screen overlays
  sheet: 260,       // bottom sheets (scrim is sheetScrim)
  sheetScrim: 258,  // bottom-sheet scrims (under the sheet)
  modal: 300,       // full-screen modals
  modalTop: 320,    // modals that must clear other modals
  toast: 9999,      // toasts and critical overlays
  max: 10000,       // absolute top (dev overlays only)
};

export function UIButton({
  children, onClick, variant = "secondary", size = "md",
  P, accent, at, icon, disabled, title, ariaLabel, full, type = "button", style,
  className = "", ...rest
}) {
  const pad = size === "sm" ? "6px 13px" : size === "lg" ? "12px 22px" : "9px 17px";
  const fs = size === "sm" ? FONT_SIZES.caption : FONT_SIZES.small;
  /* Every skin gets a lit top edge and a shadow that belongs to it.
     A primary button that is a flat block of accent with no highlight and
     no shadow is the default a framework gives you; the inset hairline and
     the tinted drop shadow are what make it look moulded from the same
     material as the panels around it. `secondary` stops being fully
     transparent so it holds its own shape over moving footage — a
     transparent outline over a bright frame is just an outline. */
  const skins = {
    primary: {
      background: accent, color: at, border: "1px solid transparent",
      boxShadow: `0 1px 2px rgba(0,0,0,0.18)`,
    },
    secondary: {
      background: P.dark ? "rgba(255,255,255,0.06)" : "#ffffff",
      color: P.ink, border: `1px solid ${P.line2}`,
      boxShadow: P.dark ? "inset 0 1px 0 rgba(255,255,255,0.06)" : "inset 0 1px 0 rgba(255,255,255,0.8)",
    },
    ghost:       { background: "transparent", color: P.ink2, border: "1px solid transparent" },
    destructive: { background: "transparent", color: STATUS.bad, border: `1px solid ${withAlpha(STATUS.bad, 0.35)}` },
  };
  return (
    <button
      type={type} onClick={onClick} disabled={disabled} title={title} aria-label={ariaLabel}
      className={("cb-press cb-glass-action cb-glass-action--" + variant + " " + className).trim()}
      {...rest}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: SP.sm,
        minHeight: 44,
        padding: pad, borderRadius: RADIUS.pill, cursor: disabled ? "not-allowed" : "pointer",
        fontSize: fs, ...TYPE.label, fontWeight: 600, letterSpacing: "-0.005em",
        transition: "transform 0.32s var(--cb-ease), box-shadow 0.32s var(--cb-ease), background 0.32s var(--cb-ease), border-color 0.32s var(--cb-ease), filter 0.32s var(--cb-ease)",
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

export function UICard({ children, P, pad = true, className = "", style, onClick, specimen = false }) {
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
        /* Opaque shell (2026-09-17 redesign pass 1): the ambient film is
           gone, so there is nothing behind these cards to frost. A solid
           surface, one hairline border, no shadow — the glass recipe's
           "real panel" comment below described a world with footage
           playing through the page, which no longer exists. */
        background: P.surface,
        border: P.dark ? "1px solid rgba(255,255,255,0.09)" : `1px solid ${P.line2}`,
        padding: pad ? SP.lg : 0,
        overflow: "hidden", minWidth: 0,
        cursor: onClick ? "pointer" : undefined,
        ...style,
      }}
    >{children}</div>
  );
}

export function UIRow({ label, desc, control, onClick, P, accent, last, tone, style, paletteName }) {
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
        borderBottom: last ? "none" : `1px solid ${P.line}`,
        cursor: onClick ? "pointer" : "default", minWidth: 0, ...style,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: FONT_SIZES.body, ...TYPE.label, fontWeight: 600, color: tone === "bad" ? statusBad(P, paletteName) : P.ink, overflowWrap: "anywhere" }}>{label}</div>
        {desc && <div style={{ fontSize: FONT_SIZES.small, fontWeight: 450, color: P.faint, lineHeight: 1.5, marginTop: 2, overflowWrap: "anywhere" }}>{desc}</div>}
      </div>
      {control && <div style={{ flexShrink: 0 }}>{control}</div>}
    </div>
  );
}

export function UIField({ value, onChange, placeholder, P, accent, multiline, rows = 3, ariaLabel, maxLength, style, onKeyDown }) {
  const base = {
    width: "100%", padding: `${SP.md - 2}px ${SP.md}px`, borderRadius: 8,
    background: P.dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
    border: `1px solid ${P.line}`, color: P.ink, outline: "none",
    /* 16px floor: iOS Safari zooms the viewport on focus for anything
       smaller, so every text input holds 16px on all viewports. */
    fontSize: 16, ...TYPE.body, minWidth: 0, ...style,
  };
  const common = { value, onChange, placeholder, "aria-label": ariaLabel || placeholder, maxLength, onKeyDown, style: base };
  return multiline
    ? <textarea rows={rows} {...common} style={{ ...base, resize: "vertical" }} />
    : <input {...common} />;
}

export const RADIUS = { sm: 6, md: 6, lg: 12, pill: 100 };

export const BADGE_DISPLAY = {
  founder: { label: "Founder & Owner", icon: "award", tint: "#c9a227" },
  verified: { label: "Verified", icon: "check", tint: "#34d399" },
  early_adopter: { label: "Early adopter", icon: "zap", tint: "#b45309" },
};

export const BADGE_ORDER = ["founder", "verified", "early_adopter"];

export function VerifiedCheck({ size = 15, title = "Verified: the owner of Cerebrum" }) {
  return (
    <span title={title} aria-label={title} role="img" style={{ display: "inline-flex", flexShrink: 0, verticalAlign: "middle" }}>
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#34d399" d="M12 1.6l2.6 2.05 3.3-.2.55 3.27 2.85 1.68-1.3 3.05 1.3 3.05-2.85 1.68-.55 3.27-3.3-.2L12 22.4l-2.6-2.05-3.3.2-.55-3.27L2.7 15.6 4 12.55 2.7 9.5l2.85-1.68.55-3.27 3.3.2z" />
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
      <span aria-hidden="true" className="cb-founder-ring" style={{
        position: "absolute", inset: 0, borderRadius: "50%",
        background: "conic-gradient(from 0deg, #c9a227, #f4e2a1, #34d399, #c9a227)",
      }} />
      <span aria-hidden="true" style={{
        position: "absolute", inset: 3, borderRadius: "50%",
        background: "var(--cb-bg, #0b0d0e)",
      }} />
      <span style={{ position: "relative", display: "inline-flex" }}>{children}</span>
    </span>
  );
}

