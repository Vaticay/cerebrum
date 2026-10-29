// @ts-check
/**
 * intro.jsx — Intro (ceremonial door) and film helpers.
 *
 * Extracted 2026-10-07 (monolith split). The Intro is the app's ceremonial
 * entry: a cinematic door, NOT a search bar (per Dusty's product call).
 * Also home to the film-reel helpers (filmBlocked, filmPoster, etc.) and
 * the motion-preference hooks, which the App re-imports.
 */
import React, { useState, useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from "react";
import {
  FONT_SIZES, STATUS, COLOR, accentText, relLuminance, withAlpha, Icon,
  TYPE, SP, LAYOUT, SHADOW, UIButton, UICard, RADIUS, Z, TRACKING,
} from "./designSystem.jsx";
import { PALETTES } from "./palettes.js";
import {
  setCookie, getCookie, APP_VERSION_LABEL, useIsMobile, useWindowWidth, useWindowHeight,
} from "./appUtils.js";
import { safeHref } from "./textUtils.js";
import { staticFieldCss } from "./cerebrumField.js";
import { SCHOLARLY_SOURCES } from "../functions/lib/product.js";
import { IntroAtmosphere } from "./introAtmosphere.jsx";
import { cbMotionOff, Dialog } from "./flowcharts.jsx";

function InvestigationOpening({ accent, animationMode }) {
  const [gone, setGone] = useState(false);
  const skip = animationMode === "off" ||
    (typeof window !== "undefined" && window.matchMedia &&
     window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  useEffect(() => {
    if (skip) { setGone(true); return; }
    const t = setTimeout(() => setGone(true), 1100);
    return () => clearTimeout(t);
  }, [skip]);

  if (skip || gone) return null;
  return (
    <div aria-hidden="true" className="cb-open-veil" style={{
      position: "fixed", inset: 0, zIndex: Z.dialog, pointerEvents: "none",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <svg width="96" height="96" viewBox="0 0 24 24" fill="none"
        stroke={accent} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
        style={{ filter: "drop-shadow(0 0 26px " + withAlpha(accent, 0.55) + ")" }}>
        <path className="cb-open-stroke" d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1 0-4.12A2.5 2.5 0 0 1 7.5 11a2.5 2.5 0 0 1 0-4.12A2.5 2.5 0 0 1 9.5 2Z" />
        <path className="cb-open-stroke cb-open-stroke-b" d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 0-4.12A2.5 2.5 0 0 0 16.5 11a2.5 2.5 0 0 0 0-4.12A2.5 2.5 0 0 0 14.5 2Z" />
      </svg>
    </div>
  );
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
  });
  useEffect(() => {
    let mq;
    try { mq = window.matchMedia("(prefers-reduced-motion: reduce)"); } catch { return undefined; }
    const onChange = () => setReduced(mq.matches);
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);
      else if (mq.removeListener) mq.removeListener(onChange);
    };
  }, []);
  return reduced;
}

function useReducedMotion() {
  const osReduced = usePrefersReducedMotion();
  const [appOff, setAppOff] = useState(() => cbMotionOff());
  useEffect(() => {
    const onChg = () => setAppOff(cbMotionOff());
    window.addEventListener("cb:anim", onChg);
    return () => window.removeEventListener("cb:anim", onChg);
  }, []);
  return osReduced || appOff;
}

const FILM_CLIPS_LANDSCAPE = [
  /* 2026-10-05: the reel is now seven dark, slow ambient loops — real
     footage (ink, smoke, water, night sky), graded darker in the player.
     The previous thirty-odd bright nature clips are retired from the reel;
     their files and credit rows remain in the repo. */
  videoUrl("/assets/cinematic/ambient-01.mp4"), // Defocused sunset reflection on the sea — Mixkit
  videoUrl("/assets/cinematic/ambient-02.mp4"), // Metallic liquid, gray tones — Mixkit
  videoUrl("/assets/cinematic/ambient-03.mp4"), // Black and white ink cloud in water — Mixkit
  videoUrl("/assets/cinematic/ambient-04.mp4"), // Smoke in motion on black — Mixkit
  videoUrl("/assets/cinematic/ambient-05.mp4"), // Bubbles rising in water — Mixkit
  videoUrl("/assets/cinematic/ambient-06.mp4"), // Abstract smoke texture — Mixkit
  videoUrl("/assets/cinematic/ambient-07.mp4"), // Moonlit clouds timelapse — Mixkit
];

/* Portrait. Used when the window is taller than it is wide — a phone held
   upright, and nothing else. 2026-10-07: science-* portrait clips were 404,
   so portrait now uses the working ambient clips (cropped, but they play). */
const FILM_CLIPS_PORTRAIT = [
  videoUrl("/assets/cinematic/ambient-01.mp4"),
  videoUrl("/assets/cinematic/ambient-03.mp4"),
  videoUrl("/assets/cinematic/ambient-07.mp4"),
];

/* The intro reel is retired (2026-10-28, the owner's order on the
   reimagined door: "bring in all new cinematic elements and
   backgrounds, do not reuse any of the old ones"). The pair that
   played here (Mixkit 30563, dark matter flight, and 10011, the
   star field) is gone from the door with the grade that covered
   it; the door's background is now the authored atmosphere in
   introAtmosphere.jsx, rendered live, with no footage in it at
   all. The frame check history that chose those clips (the
   2026-10-12 burning book ban, the 2026-10-20 luminance
   measurements) stays on record in git history and in the film
   guard at scripts/check.mjs section 8, which still bans the
   banned ids everywhere. The calm reel below is the workspace's
   own material and is untouched by this order. */

/* Calm reel (2026-10-08, refreshed): quieter clips for the main search page.
   Dusty's note: "different ones (less eye sore for the main page)." Night
   skies, slow clouds, barely moving — atmosphere, not a show. All Mixkit
   (free for commercial use, no watermark). */
const FILM_CLIPS_CALM = [
  "https://assets.mixkit.co/videos/15711/15711-720.mp4", // Night clouds drifting — Mixkit
  "https://assets.mixkit.co/videos/10011/10011-720.mp4", // Stars rotating slowly in the night sky — Mixkit
  "https://assets.mixkit.co/videos/3147/3147-1080.mp4", // Clouds passing over the moon — Mixkit
  "https://assets.mixkit.co/videos/35007/35007-720.mp4", // Moon behind a cloudy night sky — Mixkit
];

/* Pro reel: retired 2026-10-12. The science-* files these lists pointed
   at were never uploaded to the CDN (every one 404s), and dead references
   are loaded guns: if a file ever lands under one of those names it would
   play unvetted. Pro members get the ambient reel (see filmReel). */

/* What the component actually reads. Landscape is the fallback when the
   orientation cannot be determined, because a landscape clip cropped on a
   phone still looks like footage; the reverse does not. `pro` selects the
   members-only reel (see FILM_CLIPS_PRO_* above) — offered only to Pro
   members, never to anyone else. `portrait` arrives from the caller,
   which reads it through the resize aware viewport hooks in appUtils
   (useWindowHeight against useWindowWidth), so the pick follows
   rotation and resize instead of freezing at first render; the hooks'
   windowless defaults land on landscape, the fallback above. */
function filmReel(pro, reel, portrait) {
  // Named reels (2026-10-08): "calm" for the quieter main-page
  // clips, bypassing the portrait check — the clips are chosen to
  // crop well. The "intro" pick retired 2026-10-28 with the door's
  // reel itself (see the note at the retired list's site): the door
  // plays no reel now, so nothing asks for it.
  if (reel === "calm") return FILM_CLIPS_CALM;
  // 2026-10-07: Pro clips (science-*) are 404 on the CDN — they were never
  // uploaded. Pro users get the working ambient reel until the Pro clips
  // actually exist. Selling a broken reel is worse than no Pro reel.
  return portrait && FILM_CLIPS_PORTRAIT.length ? FILM_CLIPS_PORTRAIT : FILM_CLIPS_LANDSCAPE;
}
/* Video CDN base. Build-time VITE_VIDEO_CDN_BASE is baked into
   __CB_VIDEO_CDN__ (vite.config.js); window.__CB_VIDEO_CDN__ overrides it at
   runtime (handy for testing). Empty string = same-origin
   /assets/cinematic/ as today. See docs/video-cdn.md. */
function videoUrl(path) {
  const base =
    (typeof window !== "undefined" && window.__CB_VIDEO_CDN__) ||
    (typeof __CB_VIDEO_CDN__ !== "undefined" ? __CB_VIDEO_CDN__ : "") ||
    "";
  return base ? String(base).replace(/\/+$/, "") + path : path;
}

const FILM_POSTER = videoUrl("/assets/cinematic/posters/ambient-01.jpg");
const FILM_HOLD_MS = 11000;

/* Attribution for the reel.

   Three of these clips are CC BY 4.0 and one is NASA material: showing
   them without naming the creator is a licence breach, so this list and
   the dialog that renders it are part of shipping the backdrop, not a
   nice-to-have. The Pexels clips do not require attribution and are
   credited anyway — the cost is one row each, and a credits page that
   lists only the clips it is legally forced to list is a strange thing to
   put in front of researchers. */
const FILM_CREDITS = [
  { n: "ambient-01", title: "Defocused sunset reflection on the sea", credit: "Mixkit", license: "Mixkit Free License", licenseUrl: "https://mixkit.co/license/", source: "https://mixkit.co/" },
  { n: "ambient-02", title: "Metallic liquid, gray tones", credit: "Mixkit", license: "Mixkit Free License", licenseUrl: "https://mixkit.co/license/", source: "https://mixkit.co/" },
  { n: "ambient-03", title: "Black and white ink cloud in water", credit: "Mixkit", license: "Mixkit Free License", licenseUrl: "https://mixkit.co/license/", source: "https://mixkit.co/" },
  { n: "ambient-04", title: "Smoke in motion", credit: "Mixkit", license: "Mixkit Free License", licenseUrl: "https://mixkit.co/license/", source: "https://mixkit.co/" },
  { n: "ambient-05", title: "Bubbles rising in water", credit: "Mixkit", license: "Mixkit Free License", licenseUrl: "https://mixkit.co/license/", source: "https://mixkit.co/" },
  { n: "ambient-06", title: "Abstract smoke texture", credit: "Mixkit", license: "Mixkit Free License", licenseUrl: "https://mixkit.co/license/", source: "https://mixkit.co/" },
  { n: "ambient-07", title: "Moonlit clouds timelapse", credit: "Mixkit", license: "Mixkit Free License", licenseUrl: "https://mixkit.co/license/", source: "https://mixkit.co/" },
  { n: "03", title: "Seedling growth timelapse", credit: "David Roberts", license: "Pexels", licenseUrl: "https://www.pexels.com/license/", source: "https://www.pexels.com/video/time-lapse-of-seedlings-8522207/" },
  { n: "04", title: "Sunlit green leaves", credit: "Pexels contributor; see source page", license: "Pexels", licenseUrl: "https://www.pexels.com/license/", source: "https://www.pexels.com/video/sunlight-filtering-through-green-leaves-in-forest-32208331/" },
  { n: "07", title: "Laboratory reaction", credit: "cottonbro studio", license: "Pexels", licenseUrl: "https://www.pexels.com/license/", source: "https://www.pexels.com/video/chemistry-laboratorio-6208946/" },
  { n: "08", title: "Blue ink dispersing in water", credit: "MART PRODUCTION", license: "Pexels", licenseUrl: "https://www.pexels.com/license/", source: "https://www.pexels.com/video/blue-ink-in-water-7565814/" },
  { n: "09", title: "Splashing volcanic lava", credit: "Martin Sanchez", license: "Pexels", licenseUrl: "https://www.pexels.com/license/", source: "https://www.pexels.com/video/close-up-view-of-splashing-lava-during-a-volcano-eruption-13456698/" },
  { n: "10", title: "Volcanic eruption at sunset", credit: "Gylfi Gylfason", license: "Pexels", licenseUrl: "https://www.pexels.com/license/", source: "https://www.pexels.com/video/red-smoke-coming-from-volcanic-eruption-16128318/" },
  { n: "11", title: "Greenland icebergs", credit: "Mikhail Nilov", license: "Pexels", licenseUrl: "https://www.pexels.com/license/", source: "https://www.pexels.com/video/drone-footage-of-glaciers-at-greenland-8318618/" },
  { n: "12", title: "Jellyfish", credit: "Chris Munnik (2)", license: "Pexels", licenseUrl: "https://www.pexels.com/license/", source: "https://www.pexels.com/video/a-group-of-jellyfish-swimming-underwater-at-display-in-an-aquarium-3297378/" },
  { n: "13", title: "Coral aquarium", credit: "Pexels contributor; see source page", license: "Pexels", licenseUrl: "https://www.pexels.com/license/", source: "https://www.pexels.com/video/a-fish-tank-with-coral-and-fish-9406677/" },
  { n: "15", title: "Laboratory sample work", credit: "Pexels contributor; see source page", license: "Pexels", licenseUrl: "https://www.pexels.com/license/", source: "https://www.pexels.com/video/scientists-working-in-a-lab-8852423/" },
  { n: "16", title: "Plasma globe", credit: "Mathias De Rivo", license: "Pexels", licenseUrl: "https://www.pexels.com/license/", source: "https://www.pexels.com/video/close-up-footage-of-a-plasma-ball-6738879/" },
  { n: "20", title: "Earth night lights rotating globe", credit: "NASA Scientific Visualization Studio; NASA Earth Observatory / NASA-NOAA Suomi NPP data", license: "NASA media-use guidelines", licenseUrl: "https://www.nasa.gov/nasa-brand-center/images-and-media/", source: "https://svs.gsfc.nasa.gov/30878/" },
  { n: "21", title: "Forest mushroom", credit: "Andrei Ignia", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/", source: "https://www.pexels.com/video/close-up-of-a-mushroom-4938893/" },
  { n: "22", title: "Droplets on a leaf", credit: "K", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/", source: "https://www.pexels.com/video/close-up-shot-of-water-droplets-from-a-leaf-5210325/" },
  { n: "24", title: "Coral reef close-up", credit: "JUN HO LEE", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/", source: "https://www.pexels.com/video/close-up-of-coral-reefs-underwater-34127729/" },
  { n: "25", title: "Yellowstone geyser", credit: "Rec Everywhere", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/", source: "https://www.pexels.com/video/spectacular-yellowstone-geyser-eruption-32608305/" },
  { n: "27", title: "Waterfall and river rapids", credit: "Ryan Klaus", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/", source: "https://www.pexels.com/video/a-river-with-a-waterfall-and-a-boat-24837086/" },
  { n: "28", title: "Butterfly feeding on a flower", credit: "Hao Le", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/", source: "https://www.pexels.com/video/macro-shot-of-butterfly-on-a-flower-38759167/" },
  { n: "29", title: "Ant colony entrance", credit: "Eclipse Chasers", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/", source: "https://www.pexels.com/video/ant-colony-26727295/" },
  { n: "31", title: "Ocean waves at rocks", credit: "Peter Fowler", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/", source: "https://www.pexels.com/video/ocean-waves-video-1093652/" },
  { n: "33", title: "Volcanic lava in slow motion", credit: "Anoop A Nair", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/", source: "https://www.pexels.com/video/lava-in-volcano-in-slow-motion-13438865/" },
  { n: "34", title: "Ferrofluid spikes under a magnet", credit: "Film Composite", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/", source: "https://www.pexels.com/video/inky-16296848/" },
  { n: "35", title: "Northern lights timelapse", credit: "T Honkamies", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/", source: "https://www.pexels.com/video/northern-lights-timelapse-28492331/" },
  { n: "36", title: "Soap bubble freezing, macro", credit: "Aaron Burden", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/", source: "https://www.pexels.com/video/a-macro-footage-of-a-water-bubble-slowly-freezing-on-a-cold-winter-s-day-2478688/" },
  { n: "37", title: "Nebula field with stars", credit: "Adis Resic", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/", source: "https://www.pexels.com/video/stunning-cosmic-nebula-with-stars-in-deep-space-31084223/" },
  { n: "38", title: "Ants on a tiny white flower", credit: "Vung Nguyen", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/", source: "https://www.pexels.com/video/ants-on-tiny-white-flower-18275131/" },
  { n: "59", title: "Planting seedlings by hand", credit: "Pexels contributor", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/" },
  { n: "60", title: "Deer grazing in a meadow", credit: "Pexels contributor", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/" },
  { n: "61", title: "Desert mesas at dusk", credit: "Pexels contributor", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/" },
  { n: "62", title: "Ocean waves at sunset", credit: "Pexels contributor", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/" },
  { n: "63", title: "Volcano eruption at night", credit: "Pexels contributor", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/" },
  { n: "64", title: "Aurora borealis, red and green", credit: "Pexels contributor", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/" },
  { n: "65", title: "Mountain ridge at sunrise", credit: "Pexels contributor", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/" },
  { n: "66", title: "Volcanic crater lake from the air", credit: "Pexels contributor", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/" },
  { n: "67", title: "Lava flow aerial at night", credit: "Pexels contributor", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/" },
  { n: "39", title: "DNA helix animation", credit: "Pexels contributor", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/" },
  { n: "40", title: "DNA strand of particles", credit: "Pexels contributor", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/" },
  { n: "41", title: "Earth at night, city lights", credit: "Pexels contributor", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/" },
  { n: "42", title: "Rotating Earth", credit: "Pexels contributor", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/" },
  { n: "43", title: "Milky Way over mountains", credit: "Pexels contributor", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/" },
  { n: "44", title: "Mountain lake under stars", credit: "Pexels contributor", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/" },
  { n: "45", title: "Starry night sky", credit: "Pexels contributor", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/" },
  { n: "48", title: "Lightning bolt in storm clouds", credit: "Pexels contributor", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/" },
  { n: "50", title: "Harvest moon rising", credit: "Pexels contributor", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/" },
  { n: "51", title: "Total lunar eclipse", credit: "Pexels contributor", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/" },
  { n: "52", title: "Partial lunar eclipse", credit: "Pexels contributor", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/" },
  { n: "53", title: "Shark swimming", credit: "Pexels contributor", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/" },
  { n: "54", title: "Storm clouds, monochrome timelapse", credit: "Pexels contributor", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/" },
  { n: "56", title: "Ink dispersing in water", credit: "Pexels contributor", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/" },
  { n: "57", title: "Moon behind clouds", credit: "Pexels contributor", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/" },
  { n: "58", title: "Ice cave interior", credit: "Pexels contributor", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/" },
];

/* What was done to the footage. Stated once, plainly, because "adapted"
   with no detail is not an adaptation notice. */
const FILM_MODIFICATIONS =
  "Each clip is a silent excerpt of up to 15 seconds, cut from the highest-resolution master " +
  "its source publishes, at its original speed and frame rate. Every clip ships in two " +
  "renditions: VP9 (.webm), preferred wherever the browser supports it, and H.264 (.mp4) as " +
  "the universal fallback: both 720p, because full resolution is invisible behind a grade " +
  "this dark and costs several times the decode. The cinematic grade (desaturated, contrast " +
  "raised, brightness reduced) is baked into the files rather than applied as a live filter, " +
  "so playback never pays a per-frame shader cost. Portrait clips keep their own orientation " +
  "rather than being stretched. No clip is re-timed or reversed, and no frames are composited " +
  "between clips.";

function FilmCreditsDialog({ onClose, accent }) {
  const link = { color: accent, textDecoration: "none", borderBottom: "1px solid " + withAlpha(accent, 0.4) };
  /* Text and line colors come from the Dark palette, the palette this
     marked media surface is set in. The panel ground itself stays the
     deliberate dark treatment named in the panel style below. */
  const FP = PALETTES.Dark;

  return (
    <Dialog
      label="Background film credits" onClose={onClose} zIndex={Z.selectMenu} width={680}
      panelStyle={{
        /* Media surface, marked the way ModalChrome marks its media
           flag: this panel is the background film's own credits and
           sits on the film, so it keeps the deliberate dark treatment
           in every palette. Text panels do not get this exemption;
           IntroModal below follows the palette like other dialogs. */
        background: "#0f1115",
        border: "1px solid " + FP.line2, borderRadius: 2,
        boxShadow: "none",
        padding: "26px 26px 22px", color: FP.ink, fontFamily: "var(--cb-font)",
      }}
    >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontSize: FONT_SIZES.section, fontWeight: 500, letterSpacing: TYPE.heading.letterSpacing, lineHeight: 1.3, flex: 1 }}>
            Background film credits
          </h2>
          <button onClick={onClose} aria-label="Close credits" style={{
            border: "1px solid " + FP.line2, background: FP.surface,
            color: FP.ink2, cursor: "pointer", borderRadius: 2,
            padding: "16px 16px", fontSize: 13, fontFamily: "var(--cb-font)",
          }}>Close</button>
        </div>

        <p style={{ margin: "0 0 18px", fontSize: FONT_SIZES.body, lineHeight: 1.55, color: FP.ink2 }}>
          {FILM_MODIFICATIONS}
        </p>

        <div style={{ display: "flex", flexDirection: "column" }}>
          {FILM_CREDITS.map((c) => (
            <div key={c.n} style={{
              display: "grid", gridTemplateColumns: "26px 1fr", gap: 12,
              padding: "11px 0", borderTop: "1px solid " + FP.line,
            }}>
              <span style={{
                fontFamily: "var(--cb-font)", fontSize: FONT_SIZES.caption, color: withAlpha(accent, 0.9),
                paddingTop: 2, fontVariantNumeric: "tabular-nums",
              }}>{c.n}</span>
              <div>
                <div style={{ fontSize: FONT_SIZES.body, fontWeight: 500, lineHeight: 1.55, marginBottom: 3 }}>{c.title}</div>
                <div style={{ fontSize: 12, color: FP.ink2, lineHeight: 1.55 }}>
                  {c.credit}
                  {c.source ? (<>{" · "}<a href={safeHref(c.source)} target="_blank" rel="noopener noreferrer" style={link}>Source</a></>) : null}
                  {" · "}
                  {c.licenseUrl
                    ? <a href={safeHref(c.licenseUrl)} target="_blank" rel="noopener noreferrer" style={link}>{c.license}</a>
                    : <span>{c.license}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>

        <p style={{ margin: "18px 0 0", fontSize: 12, lineHeight: 1.55, color: FP.faint }}>
          Clips are decorative. They are not data, not results, and not evidence of anything
          Cerebrum reports.
        </p>
    </Dialog>
  );
}

/* ════════════════════════════════════════════════════════════════
   WHAT YOU ARE LOOKING AT

   One broad subject and one real question per clip, so the backdrop can
   offer a way in rather than just being wallpaper.

   The rules these entries follow, because getting them wrong on a product
   about evidence would be worse than having no prompt at all:

   - The subject is the FIELD, not a claim about the footage. "Marine
     biology", never "a moon jellyfish off the Norwegian coast" — these are
     stock clips and nobody verified the species, the site or the setup.
   - The question is editorial and deliberately broad enough to be true of
     whatever the clip actually shows. It is a question a person could ask
     a librarian, not a caption.
   - Nothing here asserts a finding. The question is a question; the answer
     comes from the search, with sources, like every other answer.
   - A clip with no honest entry simply has none, and the prompt is hidden
     for that clip rather than filled with something vague.

   `pos` / `posMobile` are object-position values. They only do anything
   when the clip's aspect ratio differs from the viewport's — a 16:9 clip
   on a 16:9 window is not cropped, so nothing to position. They exist for
   the 4:3 and 1.9:1 clips, where the crop is real and the subject can end
   up behind the headline. */
const FILM_SCENES = {
  [videoUrl("/assets/cinematic/ambient-01.mp4")]: { subject: "Oceanography", question: "How does light scatter across a moving sea surface?" },
  [videoUrl("/assets/cinematic/ambient-02.mp4")]: { subject: "Fluid dynamics", question: "Why do liquid metals bead and flow the way they do?" },
  [videoUrl("/assets/cinematic/ambient-03.mp4")]: { subject: "Fluid dynamics", question: "Why does ink bloom into tendrils as it spreads through water?" },
  [videoUrl("/assets/cinematic/ambient-04.mp4")]: { subject: "Atmospheric science", question: "What decides whether smoke rises, curls, or disperses?" },
  [videoUrl("/assets/cinematic/ambient-05.mp4")]: { subject: "Physics", question: "Why do bubbles speed up as they rise through water?" },
  [videoUrl("/assets/cinematic/ambient-06.mp4")]: { subject: "Physics", question: "How do small disturbances grow into patterns in a fluid?" },
  [videoUrl("/assets/cinematic/ambient-07.mp4")]: { subject: "Atmospheric science", question: "How do clouds form, drift, and dissolve overnight?" },
  "https://assets.mixkit.co/videos/30563/30563-720.mp4": { subject: "Astronomy", question: "What fills the space between the stars?" },
  "https://assets.mixkit.co/videos/20231/20231-720.mp4": { subject: "Atmospheric science", question: "How do storm clouds build and turn?" },
  "https://assets.mixkit.co/videos/15711/15711-720.mp4": { subject: "Atmospheric science", question: "Why do clouds at different heights move at different speeds?" },
  "https://assets.mixkit.co/videos/10011/10011-720.mp4": { subject: "Astronomy", question: "Why do the stars appear to wheel across the night sky?" },
  "https://assets.mixkit.co/videos/3147/3147-1080.mp4": { subject: "Astronomy", question: "What is the Moon's surface actually made of?" },
  "https://assets.mixkit.co/videos/35007/35007-720.mp4": { subject: "Atmospheric science", question: "How does thin cloud scatter moonlight?" },
};

/* The poster is a frame of this clip, so when the reel is blocked and the
   still is all anyone sees, the prompt on screen is the prompt for the
   picture on screen. Checked against the file, not assumed. */
const FILM_POSTER_CLIP = videoUrl("/assets/cinematic/ambient-03.mp4");

/* RESTORED 2026-09-17: Document Mode's film — the door's opening clip, so
   stepping from the intro into a document keeps the same frame. The scrim
   does the legibility work; the clip just has to be calm. */
const DOC_FILM_SRC = videoUrl("/assets/cinematic/ambient-07.mp4");

/* Motion on a phone is opt-in, and the choice survives a reload — a
   preference someone has to set on every visit is not a preference. */
const FILM_OPT_IN_KEY = "cb_film_motion";
function filmForcedOn() {
  try { return localStorage.getItem(FILM_OPT_IN_KEY) === "1"; } catch { return false; }
}
function setFilmForcedOn(on) {
  try { on ? localStorage.setItem(FILM_OPT_IN_KEY, "1") : localStorage.removeItem(FILM_OPT_IN_KEY); } catch (cbErr) { console.error("[Cerebrum] CerebrumApp.jsx setFilmForcedOn: on ? localStorage.setItem(FILM_OPT_IN_KEY, '1') : localStorage.removeI:", cbErr); }
}

/* One answer to "may the reel run", shared by the component and by every
   call site that needs to know whether to mount the still fallback
   instead. Two copies of this rule is how a visitor who asked for reduced
   motion ends up with both backdrops mounted at once. */
function filmBlocked(animationMode, paused) {
  if (paused || animationMode === "off") return true;
  /* Phones get the full film, not the still poster. An earlier revision
     held motion back on coarse-pointer small screens to save battery and
     data, but the cinematic backdrop is the product's identity — a phone
     that shows a black void where desktop shows the reel reads as broken,
     not thrifty. Modern phone SoCs hardware-decode H.264 (which is what
     iOS is served — see filmFile) for a fraction of the cost this comment
     used to fear, and the guards below still protect the cases that truly
     need stillness: metered connections, very low-memory devices, reduced
     motion, and anyone who pauses the background. The footer control
     remembers a manual pause. */
  /* Genuinely low-end devices, where a full-viewport filtered video makes
     the whole interface stutter. Deliberately a hard floor rather than a
     guess at "slow": deviceMemory is only reported by Chromium and only in
     coarse buckets, so anything cleverer would be inventing a capability
     signal the browser is not giving us. Everyone else gets the film and
     the pause control. */
  if (typeof navigator !== "undefined" && typeof navigator.deviceMemory === "number" &&
      navigator.deviceMemory > 0 && navigator.deviceMemory <= 2) return true;
  if (typeof navigator !== "undefined" && navigator.connection && navigator.connection.saveData) return true;
  /* Reduced motion gets the still poster BY DEFAULT, not permanently.
     The setting means "do not surprise me with movement", and it is
     honoured on arrival; it is not a claim that the person can never
     choose to watch the footage. The Play background control sets an
     explicit opt-in flag, so a deliberate press wins over the default and
     survives a reload. */
  if (typeof window !== "undefined" && window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
      !filmForcedOn()) return true;
  return false;
}

/* Per-clip poster frames. A sibling pipeline extracts one graded still per
   clip at public/assets/cinematic/posters/<basename>.jpg (same basename as
   the .mp4, .jpg extension). The intro never opens onto black: every video
   element carries its clip's poster, and a poster layer sits behind the
   reel for first paint. */
function filmPoster(src) {
  const base = String(src || "").split("/").pop().replace(/\.(mp4|webm)$/i, "");
  return base ? videoUrl("/assets/cinematic/posters/" + base + ".jpg") : FILM_POSTER;
}

/* VP9-first delivery, owned by the one shared video layer (it used to live
   inside the reel effect). Every clip ships as science-NN.mp4 (H.264 — the
   universal fallback) and science-NN.webm (VP9 — same baked grade, better
   quality at roughly half the bytes). The clip lists keep the .mp4 paths
   because FILM_SCENES is keyed by them; only the element's src is remapped,
   and only when this browser can actually play VP9.

   iOS gets H.264 unconditionally. Its hardware decoder eats H.264 for
   breakfast, while canPlayType('video/webm; codecs="vp9"') has claimed VP9
   support on iOS releases that then fail to decode it — a phone that
   reports "maybe" and plays nothing. Support is probed once per session. */
let __filmVp9OK = null;
let __filmIosH264 = null;
function filmBestFile(el, mp4) {
  /* 2026-10-05: VP9 remap disabled. The reel is now the seven ambient
     clips, which ship as H.264 .mp4 only — no .webm versions exist on the
     CDN, so the old remap turned every desktop Chrome load into a 404
     and the reel stalled on the poster with a dead "tap to play" pill.
     H.264 hardware-decodes everywhere; the bandwidth delta is not worth
     a second encode pipeline. If .webm versions ever ship, gate the remap
     on their existence instead of re-enabling it blindly. */
  return mp4;
}

function IntroModal({ label, title, onClose, accent, P = null, children, width = 620 }) {
  /* A text panel (Sources): it follows the active
     palette like every other dialog, surface, ink, and line from P
     when the caller passes it, and the Dialog default's own variable
     treatment when it does not. The hard coded near black it carried
     until 2026-10-14 ignored Light palettes entirely. */
  return (
    <Dialog label={label} onClose={onClose} zIndex={Z.selectMenu} width={width}
      panelStyle={{
        background: P ? P.surface : "var(--cb-surface, #767676)",
        border: `1px solid ${P ? P.line : "rgba(255,255,255,0.10)"}`, borderRadius: RADIUS.xl,
        boxShadow: "none",
        padding: "22px 22px 24px", color: P ? P.ink : "var(--cb-ink, #f4f4f2)", fontFamily: "var(--cb-font)",
      }}
    >
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: FONT_SIZES.section, fontWeight: 500, letterSpacing: TYPE.heading.letterSpacing, flex: 1, lineHeight: 1.3 }}>{title}</h2>
          <button onClick={onClose} aria-label={"Close " + label} style={{ minHeight: 44,
            border: `1px solid ${P ? P.line : "rgba(255,255,255,0.12)"}`, background: P ? P.surface : "rgba(255,255,255,0.06)",
            color: P ? P.ink2 : "rgba(242,244,242,0.78)", cursor: "pointer", borderRadius: 2,
            padding: "7px 15px", fontSize: 13, fontFamily: "var(--cb-font)", flexShrink: 0,
          }}>Close</button>
        </div>
        {children}
    </Dialog>
  );
}

function SourcesDialog({ onClose, accent, P = null }) {
  const GROUPS = [
    ["biomedical", "Biomedical"],
    ["multi", "Multidisciplinary"],
    ["open-access", "Open access"],
    ["preprint", "Preprints"],
    ["aggregator", "Aggregators"],
    ["repository", "Repositories"],
  ];
  const PEER = { yes: "Peer reviewed", mostly: "Mostly peer reviewed", mixed: "Mixed", no: "Not peer reviewed" };
  return (
    <IntroModal label="research sources" title="Research sources" onClose={onClose} accent={accent} P={P}>
      <p style={{ margin: "0 0 16px", fontSize: FONT_SIZES.body, lineHeight: 1.55, color: P ? P.ink2 : "rgba(242,244,242,0.68)" }}>
        Cerebrum queries these {SCHOLARLY_SOURCES.length} sources and merges the results, removing the
        same paper when it appears in more than one. Preprints are included and are labelled as
        preprints. They have not been through peer review.
      </p>
      {GROUPS.map(([key, heading]) => {
        const rows = SCHOLARLY_SOURCES.filter((x) => x.category === key);
        if (!rows.length) return null;
        return (
          <div key={key} style={{ paddingTop: 14, borderTop: `1px solid ${P ? P.line : "rgba(255,255,255,0.07)"}`, marginBottom: 4 }}>
            <div style={{
              /* Pass 3 (2026-09-17): Inter Tight label, not a tracked-out eyebrow. */
              fontFamily: "var(--cb-font)", fontSize: FONT_SIZES.caption,
              color: P ? P.faint : "rgba(242,244,242,0.44)", marginBottom: 9,
            }}>{heading}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 14 }}>
              {rows.map((r) => (
                <div key={r.id} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  gap: 14, flexWrap: "wrap",
                }}>
                  <span style={{ fontSize: 15, color: P ? P.ink : "#f2f4f2" }}>{r.name}</span>
                  <span style={{ fontSize: 12, color: P ? P.faint : "rgba(242,244,242,0.5)" }}>{PEER[r.peerReviewed] || ""}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </IntroModal>
  );
}


/* The specimen claims that stood on every door from 2026-10-08 to
   this night are retired from this file (2026-10-28, the owner's
   concept pick: "Title card, Cerebrum as the film title"). The
   door they demonstrated is gone; the title card carries no claim,
   no citation, and no proof line, because the proof now lives
   inside the app, on the search stage and the answer, where a
   visitor can act on it. The claims themselves are not lost: the
   stage's placeholder questions and the document fallback in
   index.html carry findings from the same literature, each traced
   to its paper. Deleting the list with the door it served keeps
   this file honest about what the door is now. */
/* ════════════════════════════════════════════════════════════════════
   PlateFrame: the shared plate language (2026-10-13 plate redesign).

   The empty search stage sits inside this frame as Plate II, and the
   consent gate borrows it on the way in. (Plate I was the intro for a
   day; the door below is the restored film door, and it does not use
   the frame.) Registration corner marks and a mono running head, and
   no border box: a plate is registered by its corners, not fenced by
   a rectangle. Colours arrive as props so the stage and the consent
   plate share one component across palettes.
   ════════════════════════════════════════════════════════════════════ */
export const plateHead = (color) => ({
  fontFamily: "var(--cb-mono)", fontSize: 11, letterSpacing: "0.14em",
  textTransform: "uppercase", color, whiteSpace: "nowrap",
});

/* PlateFrame, the plate era's corner registered frame component, was
   removed with the frontend audit: it rendered nowhere in the app (the
   restored film door never used it), and the one frame language that
   remains live is TickFrame on the answer viewport. plateHead above
   stays: the home stage running heads use it. */

/* ════════════════════════════════════════════════════════════════════
   DotField: the plate ambient (2026-10-13).

   A faint field of dots at reading distance, a few joined by hairlines
   the way papers in a citation graph are joined: the shape of the
   literature, drawn at five to eight percent opacity. The drift is so
   slow it is felt rather than seen, one full cycle over forty to sixty
   seconds. Canvas 2D, device pixel ratio capped at 1.5, paused while
   the tab is hidden, and a single still frame when motion is off or
   reduced. If canvas is unavailable the vignette and grain behind it
   still hold the door, so the plate never renders broken.
   ════════════════════════════════════════════════════════════════════ */
export function DotField({ still = false, dotRgb = "232,228,218", accentRgb = "139,168,136", count = 76 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.getContext) return undefined;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    let raf = 0;
    let running = false;
    let W = 0;
    let H = 0;
    let dots = [];
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    /* Seeded, so every visitor gets the same plate rather than a
       random scatter, and the field is stable across resizes of the
       same aspect. */
    let seed = 20261013;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const build = () => {
      W = canvas.clientWidth || window.innerWidth;
      H = canvas.clientHeight || window.innerHeight;
      canvas.width = Math.max(1, Math.round(W * dpr));
      canvas.height = Math.max(1, Math.round(H * dpr));
      dots = [];
      for (let i = 0; i < count; i++) {
        dots.push({
          x: rnd() * W, y: rnd() * H,
          r: 0.8 + rnd() * 1.3,
          a: 0.05 + rnd() * 0.03,
          ph: rnd() * Math.PI * 2,
          sp: (Math.PI * 2) / (40000 + rnd() * 20000),
          amp: 6 + rnd() * 10,
          acc: i % 9 === 4,
        });
      }
    };
    const pos = (d, t) => [
      d.x + Math.sin(t * d.sp + d.ph) * d.amp,
      d.y + Math.cos(t * d.sp * 0.9 + d.ph) * d.amp * 0.7,
    ];
    const draw = (t) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      for (let i = 0; i < dots.length; i++) {
        const [x1, y1] = pos(dots[i], t);
        for (let j = i + 1; j < dots.length; j++) {
          const dx = dots[i].x - dots[j].x;
          const dy = dots[i].y - dots[j].y;
          if (dx * dx + dy * dy < 22500) {
            const [x2, y2] = pos(dots[j], t);
            ctx.strokeStyle = "rgba(" + dotRgb + ",0.028)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
          }
        }
      }
      for (const d of dots) {
        const [x, y] = pos(d, t);
        ctx.fillStyle = "rgba(" + (d.acc ? accentRgb : dotRgb) + "," + d.a + ")";
        ctx.beginPath();
        ctx.arc(x, y, d.r, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    const loop = (t) => {
      draw(t || 0);
      if (running) raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (still || running) return;
      running = true;
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };
    const onVis = () => { if (document.hidden) stop(); else start(); };
    const onResize = () => { build(); if (still || !running) draw(0); };
    build();
    draw(0);
    if (!still) {
      start();
      document.addEventListener("visibilitychange", onVis);
      window.addEventListener("resize", onResize);
    }
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("resize", onResize);
    };
  }, [still, dotRgb, accentRgb, count]);

  return (
    <canvas ref={canvasRef} aria-hidden="true" style={{
      position: "fixed", inset: 0, width: "100%", height: "100%",
      zIndex: 1, pointerEvents: "none", display: "block",
    }} />
  );
}

/* ════════════════════════════════════════════════════════════════════
   Intro as Plate I (2026-10-13 plate redesign).

   The door is a plate in a bound volume of plates: registration marks,
   a running head, and one traced claim set as a figure. The wordmark
   and its two clause definition come first, in the manner of a
   dictionary entry. Then the specimen: one claim at a time, stepped
   by hand, carrying a miniature of the Search record beneath it
   (indexes searched, papers cited, the paper itself) so the door
   previews the trust data the product keeps. One way in, labelled
   Enter, also fired by the Return key. No composer here: the intro
   stays a ceremonial door (standing product call, 2026-10-05).

   The ambient is the DotField over a static vignette and the existing
   grain: calm, dark, slow, atmospheric, per the standing ruling. The
   film reel still serves the workspace; it no longer plays the door.
   ════════════════════════════════════════════════════════════════════ */
/* ════════════════════════════════════════════════════════════
   NovaDoorSection (2026-10-19 redesign): the Nova specific intro
   the owner asked to try. One section, self contained: her figure
   (figure only, no speech controller, no bubble), the NOVA
   wordmark in the face reserved for that word, one short line in
   her voice presenting the specimens on the table, and one plain
   line saying what she is inside the product, the tagline
   included. The text sits on the solid card surface, like every
   text carrying surface in the app. One figure on the screen:
   nothing else on the door draws her. She is a candidate for the
   owner's live check, not a settled taste call: delete this
   component and its one mount in Intro and the rest of the door
   is untouched.
   ════════════════════════════════════════════════════════════ */
/* ════════════════════════════════════════════════════════════════════
   Intro — the title card (2026-10-28, the owner's concept pick).

   History, short form: the door was a calibration chamber over film
   (2026-10-08), a specimen plate for a day (2026-10-13), the film
   door restored and rebuilt several times since, a two column
   ledger room rejected on sight (2026-10-20), a film frame with a
   title block and a caption strip (2026-10-28 noon), and the same
   staging over an authored shader atmosphere (2026-10-28 evening).
   Every one of those doors carried the same visible list: a
   masthead, a headline sentence, a filled way in, a Nova row, and
   a specimen with its proof. The owner's verdict that evening,
   with phone and desktop photos: "its bad and you didn't listen",
   and then "This all looks so bad still". Three builds in one day
   had changed the arrangement, then the staging, then the
   material, and never changed what the screen is, because the
   element list itself was being protected as identity.

   So the concept was put to him as a choice between genuinely
   different doors, and he picked this one in his own words:
   "Title card, Cerebrum as the film title."

   The door is now a film title card, and that is the whole screen:
   - The word Cerebrum, set like the title of a film in the reading
     serif, at the centre of a living dark background (the authored
     atmosphere in introAtmosphere.jsx, reworked the same night
     around this card: neutral palette, its light at the centre
     behind the title, its mist shaping the light instead of
     forming clouds of its own).
   - One small line under the title, saying what Cerebrum is in
     plain words.
   - A press anywhere begins. Under the line, one quiet text
     affordance names the press; it is not a filled button, and
     nothing else on the card is a control.

   There is no headline sentence, no specimen block, no proof line,
   no Nova row, no masthead, and no nav links on this door. The
   proof and the specimens live inside the app now, where a visitor
   can act on them. Nova lives inside the app too; her figure and
   her line leave the door with the staging they belonged to.

   Amended 2026-10-29 (the owner's order: the copyright and
   privacy tabs and what not, added back onto the intro): one
   quiet legal row stands at the foot of the card, the app
   footer's page links and its copyright notice, placed and
   behaved as its own comment below describes. Nothing else in
   this contract moved: no header or masthead returns with the
   row, and it is foot furniture, not a nav.

   Standing behaviour, unchanged: the card is dark for everyone;
   the session flag collapses the ceremony for returning visitors;
   reduced motion gets one composed still of the same material;
   leaving runs the door opening, two black leaves parting over
   the swelling light, and the no motion paths enter instantly;
   consent appears on the way in, in the shell, never on this door.
   Entry is never gated by any of the visuals.
   ════════════════════════════════════════════════════════════════════ */
function Intro({ accent, P, onEnter, animationMode = "off", user = null }) {
  /* Cinema mode, 2026-10-28 (the owner's call, for commercial
     takes): ?cinema locks the door into a fixed recordable frame,
     9 by 16 by default, 16 by 9 with ?cinema=wide. Restaged the
     same night onto the title card: inside the frame the staged
     entrance runs once on its fixed clock whatever the session
     flag says, and the card then holds for the whole take. The
     title, the line, the fonts, and the palette are exactly the
     live door's; the atmosphere's clock starts from its fixed
     take time, so the take's light is the same on every
     recording. */
  const [cinema] = useState(() => {
    try {
      const v = new URLSearchParams(window.location.search).get("cinema");
      if (v === "wide" || v === "169") return "wide";
      if (v !== null && v !== "" && v !== "0" && v !== "off") return "portrait";
    } catch { /* no location to read: no cinema */ }
    return null;
  });
  const isMobileWin = useIsMobile();
  const isMobile = isMobileWin || cinema === "portrait";
  const reduced = useReducedMotion();
  /* The frame swallows the page scroll: the take is the frame and
     nothing outside it. */
  useEffect(() => {
    if (!cinema) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [cinema]);
  /* Stepping through: the door opens (2026-10-28, the owner's call:
     two black leaves part over the light, 720ms, and the app
     is entered at 700ms). The no-motion path is untouched:
     animation off or reduced motion goes straight through,
     instantly, and never mounts the split. A second press while
     leaving is ignored. */
  const [leaving, setLeaving] = useState(false);
  const leaveTimer = useRef(null);
  useEffect(() => () => clearTimeout(leaveTimer.current), []);

  /* A repeat visit in the same session skips the ceremony: the flag
     is set on the way in, and a returning door renders composed at
     once, with the way in already focused. Carried over from the
     plate door (2026-10-13) into every door since. */
  const [enteredBefore] = useState(() => {
    try { return sessionStorage.getItem("cerebrum-entered") === "1"; } catch { return false; }
  });

  /* ── The door rule ──
     This screen is a threshold, not a search screen: there is no
     composer here, deliberately. The whole card is the way in: a
     press anywhere on it begins, and the one quiet text affordance
     under the line is the same press, named. Entry fires on the
     leave timer whatever the opening visuals do, so nothing on
     this card can gate or delay the way in. */
  const go = (q, submit) => {
    const payload = typeof q === "string" ? q : "";
    if (leaving) return;
    try { sessionStorage.setItem("cerebrum-entered", "1"); } catch { /* private mode: the ceremony simply repeats */ }
    if (animationMode === "off" || reduced) { onEnter(payload, !!submit, null); return; }
    setLeaving(true);
    clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => onEnter(payload, !!submit, null), 700);
  };

  /* Animations on the card pause while the tab is hidden: the wrap
     takes cb-door-hidden and the CSS stands them down. */
  const [docHidden, setDocHidden] = useState(false);
  useEffect(() => {
    const onVis = () => setDocHidden(typeof document !== "undefined" && !!document.hidden);
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const animate = animationMode !== "off" && !reduced;
  /* The ceremony is the staged entrance on a first visit (the
     atmosphere, then the title rising, the line, the affordance,
     on one curve in the cb-door-stage rules). Returning visitors
     skip it: the card renders composed, the wrap takes the still
     class, and only the atmosphere runs, as it does for everyone. */
  const ceremony = animate && !enteredBefore;
  /* Cinema takes run the staged entrance once per load whatever
     the session flag says, so the wrap takes the ceremony class
     there too. */
  const doorIn = ceremony || (!!cinema && animate);
  /* The title card's own values: a clean, deep, neutral darkness,
     and text in a neutral white with no hue worth naming. The
     doors before this one wore a murky tinted wash in the owner's
     photos (a blue green ground, a green tinted light, a sage
     button); nothing on this card takes an accent at all, so
     there is no tint left to wash the words. The line takes the
     0.72 alpha and the affordance the 0.55, both of which clear
     their contrast floors against the atmosphere's clamped
     centre, measured on rendered captures (see the addendum). */
  const ink = "#f3f3f1";
  const ink2 = "rgba(243,243,241,0.72)";
  const faint = "rgba(243,243,241,0.55)";

  const [beginHover, setBeginHover] = useState(false);

  const wrapCls = [leaving ? "cb-intro-leaving" : "", (reduced || enteredBefore) && !leaving ? "cb-intro-still" : "", doorIn ? "cb-door-in" : "", docHidden ? "cb-door-hidden" : ""]
    .filter(Boolean).join(" ") || undefined;

  const doorRoot = (
    <div id="cb-intro-wrap" className={wrapCls} onClick={() => go("", false)} style={{
      minHeight: cinema ? "100%" : "100dvh", height: cinema ? "100%" : undefined, position: "relative", overflowX: "clip",
      display: "flex", flexDirection: "column", cursor: "pointer",
      WebkitTapHighlightColor: "transparent",
      fontFamily: "var(--cb-font)", background: "#060606", color: ink,
    }}>
      {/* The atmosphere (2026-10-28, the owner's material order;
          reworked the same night for the title card): the card's
          background is IntroAtmosphere, authored for this door and
          rendered live: a breathing neutral light at the centre of
          the frame, mist shaping it, motes, and fine grain (see
          introAtmosphere.jsx for the world and its contracts).
          There is no footage, no file, and no filter behind the
          title: the darkness is the material's own palette,
          clamped in the shader. Reduced motion, animation off, and
          Save-Data draw one composed still of the same world, so
          the card never opens onto black and never moves for a
          visitor who asked it not to. While the card is leaving,
          the light swells, so the parting leaves below open over
          this material brightening, not over a painted light
          layer. */}
      <div aria-hidden="true" className="cb-door-atmo" style={{
        position: cinema ? "absolute" : "fixed", inset: 0, zIndex: 0, pointerEvents: "none",
      }}>
        <IntroAtmosphere
          animationMode={animationMode}
          still={reduced || animationMode === "off"}
          swell={leaving}
          fixedClock={!!cinema}
        />
      </div>

      {/* ── The title card itself: the word set like a film title
          at the centre of the frame, one small line under it, and
          one quiet text affordance under the line. Below the
          centred card, at the foot of the frame, stands the legal
          row (2026-10-29, the owner's order; its own comment
          below carries the terms). The beats of the staged entrance
          follow the old order's timing (atmosphere, title, line,
          affordance) on the shared stage classes. */}
      <main className="cb-intro-chrome" style={{
        position: "relative", zIndex: 20, flex: 1,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        textAlign: "center",
        padding: isMobile ? "24px 20px" : "32px 24px",
      }}>
        <h1 className="cb-door-stage-2" style={{
          margin: 0,
          fontFamily: "var(--cb-serif)", fontWeight: 500,
          fontSize: isMobile ? 57 : 104, lineHeight: 1.04, letterSpacing: "0.008em",
          color: ink,
        }}>Cerebrum</h1>

        <p className="cb-door-stage-3" style={{
          margin: isMobile ? "18px 0 0" : "22px 0 0",
          fontFamily: "var(--cb-font)", fontSize: isMobile ? 15 : 17, fontWeight: 400,
          lineHeight: 1.5, color: ink2,
        }}>
          Answers from published research.
        </p>

        {/* The one visible way in: a quiet line of text, not a
            filled button. It is the same press the whole card
            takes; its stopPropagation keeps the card's own press
            from firing twice on the instant paths. Returning
            visitors land with it focused, so the keyboard way in
            is the same one press. */}
        <div className="cb-door-stage-4" style={{ marginTop: isMobile ? 28 : 36 }}>
          <button type="button" className="cb-door-begin"
            onClick={(e) => { e.stopPropagation(); go("", false); }}
            autoFocus={enteredBefore || undefined}
            onMouseEnter={() => setBeginHover(true)}
            onMouseLeave={() => setBeginHover(false)}
            style={{
              background: "none", border: "none", cursor: "pointer",
              padding: "14px 18px", minHeight: 48,
              fontFamily: "var(--cb-font)", fontSize: FONT_SIZES.label, fontWeight: 500,
              letterSpacing: "0.01em", color: beginHover ? ink : faint,
              transition: "color 200ms ease-out",
            }}>Tap to begin</button>
        </div>
      </main>

      {/* The door's legal row (2026-10-29, the owner's order: the
          copyright and privacy tabs and what not, added back onto
          the intro). The title card retired the door's header links
          the night it shipped; this order returns the site's
          standing footer set at the foot of the card instead. The
          set mirrored is the app footer's own row (the cb-appfoot
          links in CerebrumApp.jsx): About, Privacy, Terms,
          Disclosures, Contact, and its copyright notice. There is
          no separate copyright page on the site; the notice is its
          copyright element, and it stands here the way it stands
          in the footer, as quiet text after the links. No product
          links join them: the footers group those separately, and
          the door takes only the set that travels together.
          Register: the card's own faint ink at caption size, no
          fill, no band, no rule, and the last beat of the staged
          entrance (stage 5, kept in the CSS since the title card
          and taken by nothing until now). Placement: a footer
          block under the centred card in the wrap's column, so
          the title, the line, and the way in keep the middle of
          the frame and the row takes its own line at the bottom;
          on a short phone screen the centred stack shrinks into
          the space above it and nothing overlaps or is pushed
          off. Behaviour: each link stops its press from reaching
          the card, so a tap on a link goes to its page and never
          fires the way in; the rest of the card begins on tap
          exactly as before. The row is part of this door wherever
          the door renders, cinema frame included: the frame holds
          this same live door, and the cinema spec excludes no
          part of it. */}
      <footer className="cb-intro-chrome cb-door-stage-5 cb-door-legal" style={{
        position: "relative", zIndex: 20,
        display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center",
        gap: isMobile ? "2px 16px" : "4px 20px",
        padding: isMobile ? "6px 16px 16px" : "8px 24px 20px",
        fontFamily: "var(--cb-font)", fontSize: FONT_SIZES.caption, color: faint,
        textAlign: "center",
      }}>
        {[
          ["/about", "About"],
          ["/privacy", "Privacy"],
          ["/terms", "Terms"],
          ["/disclosures", "Disclosures"],
          ["/contact", "Contact"],
        ].map(([href, label]) => (
          <a key={href} href={href}
            onClick={(e) => e.stopPropagation()}
            style={{
              color: faint, textDecoration: "none", fontFamily: "var(--cb-font)",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              minHeight: 44, padding: "0 2px", whiteSpace: "nowrap",
            }}>{label}</a>
        ))}
        <span style={{ whiteSpace: "nowrap", opacity: 0.75 }}>© {new Date().getFullYear()} Cerebrum™</span>
      </footer>

      {/* The door opening (2026-10-28): mounted only on the animated
          way in, purely visual, pointer events off. Entry fires on
          the leave timer in go() whatever this overlay does, and
          the no motion paths never mount it. On the title card the
          leaves part over the card's own light swelling, through
          the swell prop on the atmosphere mount above. */}
      {leaving && animate && (
        <div aria-hidden="true" className="cb-door-split" style={cinema ? { position: "absolute" } : undefined}>
          <div className="cb-split-half cb-split-l" />
          <div className="cb-split-half cb-split-r" />
        </div>
      )}

    </div>
  );

  if (!cinema) return doorRoot;
  /* The cinema frame: a fixed recordable box on a black stage. The
     title card inside it is the live door, laid out in the frame
     (the portrait frame takes the phone arrangement), its
     atmosphere bound to the frame instead of the viewport. What
     the frame holds after the entrance is the held end frame: the
     title over the atmosphere still breathing on its fixed clock,
     ready to loop or to cut into the app on the way in. */
  return (
    <div style={{
      position: "fixed", inset: 0, background: "#000",
      display: "flex", alignItems: "center", justifyContent: "center",
      overflow: "hidden",
    }}>
      <div style={{
        position: "relative", overflow: "hidden", background: "#060606", flex: "0 0 auto",
        width: cinema === "wide" ? "min(100vw, calc(100dvh * 16 / 9))" : "min(100vw, calc(100dvh * 9 / 16))",
        height: cinema === "wide" ? "min(100dvh, calc(100vw * 9 / 16))" : "min(100dvh, calc(100vw * 16 / 9))",
      }}>
        {doorRoot}
      </div>
    </div>
  );
}


function CerebrumFieldCanvas({
  accent,
  P,
  mode = "ambient",
  energy = 0,
  core = 0,
  corePos = [0, 0],
  coreScale = 1,
  animationMode = "cinematic",
}) {
  const canvasRef = useRef(null);
  const fieldRef = useRef(null);
  const [failed, setFailed] = useState(false);

  /* The field inverts its polarity for light palettes rather than painting a
     dark sheet behind a pale interface — see the uLight branch in the shader.
     `deep` is still passed because the CSS fallback needs a ground colour. */
  const isLight = !!(P && P.dark === false);
  const deep = isLight ? (P.bg || "#f5f4f1") : ((P && P.bg) || "#0a1020");

  // Create once. Deliberately NOT keyed on accent/mode — those are pushed
  // through setState below, because tearing down a GPU context to change a
  // colour is how you end up leaking contexts on a settings screen.
  useEffect(() => {
    if (animationMode === "off") return undefined;
    let disposed = false;
    let handle = null;

    (async () => {
      try {
        const { createField } = await import("./cerebrumField.js");
        if (disposed || !canvasRef.current) return;
        handle = await createField(canvasRef.current, {
          accent, deep, mode, core, corePos, coreScale, light: isLight,
        });
        if (disposed) { if (handle) handle.destroy(); return; }
        if (!handle) { setFailed(true); return; }
        fieldRef.current = handle;
      } catch {
        if (!disposed) setFailed(true);
      }
    })();

    return () => {
      disposed = true;
      if (fieldRef.current) { fieldRef.current.destroy(); fieldRef.current = null; }
      else if (handle) handle.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animationMode]);

  // Push state changes without recreating anything.
  useEffect(() => {
    if (fieldRef.current) {
      fieldRef.current.setState({ accent, deep, mode, energy, core, corePos, coreScale, light: isLight });
    }
  }, [accent, deep, mode, energy, core, corePos[0], corePos[1], coreScale, isLight]);

  const fallbackStyle = {
    position: "fixed", inset: 0, zIndex: Z.base, pointerEvents: "none",
    background: staticFieldCss(accent, deep),
  };

  // Animation off, or WebGL unavailable: the same palette and roughly the
  // same composition, painted in CSS. The page should look deliberate, not
  // like something failed to load.
  if (animationMode === "off" || failed) {
    return <div aria-hidden="true" style={fallbackStyle} />;
  }

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: "fixed", inset: 0, width: "100%", height: "100%",
        zIndex: Z.base, pointerEvents: "none", display: "block",
        // Painted underneath while the shader module loads, so there is never
        // a black rectangle between first paint and first frame.
        background: staticFieldCss(accent, deep),
      }}
    />
  );
}


export function Mark({ size = 26, accent, glow, className = "", style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} style={{ filter: glow ? `drop-shadow(0 0 8px ${withAlpha(accent, 0.35)})` : "none", ...style }}>
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1 0-4.12A2.5 2.5 0 0 1 7.5 11a2.5 2.5 0 0 1 0-4.12A2.5 2.5 0 0 1 9.5 2Z" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 0-4.12A2.5 2.5 0 0 0 16.5 11a2.5 2.5 0 0 0 0-4.12A2.5 2.5 0 0 0 14.5 2Z" />
    </svg>
  );
}

/* MarkBreathe — the living mark for search loading. The two hemispheres
   breathe out of phase on a 4s cycle (opacity only, no transform, so it
   stays calm and never reads as a spinner). Reduced motion: renders the
   static mark with no animation. The keyframes live in the app
   stylesheet next to the other cb-* motion (see cbMarkBreatheA/B). */
export function MarkBreathe({ size = 40, accent, className = "", style }) {
  const reduced = useReducedMotion();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={accent}
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
      className={("cb-mark-breathe " + className).trim()} style={style} aria-hidden="true">
      <path className={reduced ? undefined : "cb-mark-breath-a"} d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1 0-4.12A2.5 2.5 0 0 1 7.5 11a2.5 2.5 0 0 1 0-4.12A2.5 2.5 0 0 1 9.5 2Z" />
      <path className={reduced ? undefined : "cb-mark-breath-b"} d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 0-4.12A2.5 2.5 0 0 0 16.5 11a2.5 2.5 0 0 0 0-4.12A2.5 2.5 0 0 0 14.5 2Z" />
    </svg>
  );
}

/* ProMark — the same brain geometry in the Pro gold register (#d4af37,
   the Pro palette's restrained gold). Pro surfaces are recognizable by
   the mark alone, without a badge. */
export function ProMark({ size = 26, glow = false, className = "", style }) {
  return <Mark size={size} accent="#d4af37" glow={glow} className={className} style={style} />;
}

export const FilmLayer = forwardRef(function FilmLayer({
  src = null, poster = null,
  active = true, visible = true,
  loop = true, preload = "metadata",
  fadeMs = 2200, objectPosition = "50% 50%",
  pinned = true, dim = 0, dimColor = "#0b0d10",
  className = "", style = {},
  manageVisibility = true, stallMs = 9000,
  onLoadedData, onError, onReady, onStalled,
  onAutoplayBlocked, onPlaybackChange, onPlayState,
}, ref) {
  const vref = useRef(null);
  const layerRef = useRef(null);
  const [posterUrl, setPosterUrl] = useState(poster || null);
  const readyRef = useRef(false);
  const srcRef = useRef(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const visibleTargetRef = useRef(!!visible);
  const stallRef = useRef(0);
  const notifiedRef = useRef(false);
  const playingRef = useRef(null);
  const reduceMotion = cbMotionOff();

  /* Callbacks are read through refs: a fresh callback identity must never
     restart a reel or reload a clip. */
  const onLoadedDataRef = useRef(onLoadedData); onLoadedDataRef.current = onLoadedData;
  const onErrorRef = useRef(onError); onErrorRef.current = onError;
  const onReadyRef = useRef(onReady); onReadyRef.current = onReady;
  const onStalledRef = useRef(onStalled); onStalledRef.current = onStalled;
  const onAutoplayBlockedRef = useRef(onAutoplayBlocked); onAutoplayBlockedRef.current = onAutoplayBlocked;
  const onPlaybackChangeRef = useRef(onPlaybackChange); onPlaybackChangeRef.current = onPlaybackChange;
  const onPlayStateRef = useRef(onPlayState); onPlayStateRef.current = onPlayState;

  const declarative = src != null;

  /* The single funnel for the video's opacity: on only when the layer
     wants to be seen AND there are usable frames to show. Before canplay
     the poster layer beneath holds the frame — poster-first, always. */
  const applyVisibility = () => {
    const el = vref.current;
    if (!el) return;
    try { el.style.opacity = (visibleTargetRef.current && readyRef.current) ? "1" : "0"; } catch (cbErr) { console.error("[Cerebrum] CerebrumApp.jsx applyVisibility: el.style.opacity = (visibleTargetRef.current && readyRef.current) ? '1:", cbErr); }
  };

  /* The muted-inline play sequence (§5). The IDL properties are reinforced
     on the element before every play() — React's muted JSX attribute sets
     the content attribute, which iOS ignores. */
  const guardedPlay = () => {
    const el = vref.current;
    if (!el || !activeRef.current) return;
    try {
      el.muted = true;
      el.defaultMuted = true;
      const p = el.play();
      if (p && p.catch) p.catch((err) => {
        /* Rejected (Low Power Mode, data-saver vetoes): settle on the
           poster. The video never left opacity 0, so there is no blank
           layer — and with no controls attribute, no native play icon. */
        if (!notifiedRef.current) {
          notifiedRef.current = true;
          try { if (onAutoplayBlockedRef.current) onAutoplayBlockedRef.current(err); } catch (cbErr) { console.error("[Cerebrum] CerebrumApp.jsx if: if (onAutoplayBlockedRef.current) onAutoplayBlockedRef.current(err); }:", cbErr); }
        }
      });
    } catch (cbErr) { console.error("[Cerebrum] CerebrumApp.jsx if: if (onAutoplayBlockedRef.current) onAutoplayBlockedRef.current(err); }:", cbErr); }
  };

  const pause = () => { try { if (vref.current) vref.current.pause(); } catch (cbErr) { console.error("[Cerebrum] CerebrumApp.jsx pause: if (vref.current) vref.current.pause(); }:", cbErr); } };

  /* Load a clip and run the full guarded sequence — or, with
     preloadOnly, buffer it into a hidden slot without playing (the
     reel warms the next clip while the current one holds the screen). */
  const loadClip = (clipSrc, opts = {}) => {
    const el = vref.current;
    if (!el || !clipSrc) return;
    const { objectPosition: pos, preloadOnly = false } = opts;
    const file = filmBestFile(el, clipSrc);
    let sameFile = false;
    try { sameFile = el.getAttribute("src") === file; } catch (cbErr) { console.error("[Cerebrum] CerebrumApp.jsx loadClip: sameFile = el.getAttribute('src') === file; }:", cbErr); }
    if (sameFile && srcRef.current === clipSrc) {
      /* Already on this clip (a warmed preload promoted to current, or a
         resume re-issuing play): do not tear down the decoder, restart
         the stall clock, or touch ready state — just make sure it plays. */
      if (!preloadOnly) guardedPlay();
      return;
    }
    srcRef.current = clipSrc;
    readyRef.current = false;
    clearTimeout(stallRef.current);
    /* The poster always matches the clip being loaded: a clip that fails
       to decode leaves its own graded still behind, never a gray plane. */
    setPosterUrl(filmPoster(clipSrc));
    if (pos) { try { el.style.objectPosition = pos; } catch (cbErr) { console.error("[Cerebrum] CerebrumApp.jsx if: el.style.objectPosition = pos; }:", cbErr); } }
    if (preloadOnly) { try { el.preload = "auto"; } catch (cbErr) { console.error("[Cerebrum] CerebrumApp.jsx if: el.preload = 'auto'; }:", cbErr); } }
    try { el.src = file; el.load(); } catch (cbErr) { console.error("[Cerebrum] CerebrumApp.jsx if: el.src = file; el.load(); }:", cbErr); }
    stallRef.current = setTimeout(() => {
      /* Stall guard: never playable -> hold the poster. The video stays
         at opacity 0 over its poster layer; the parent may move to
         another source via onStalled. */
      if (!readyRef.current) {
        try { if (onStalledRef.current) onStalledRef.current(clipSrc); } catch (cbErr) { console.error("[Cerebrum] CerebrumApp.jsx if: if (onStalledRef.current) onStalledRef.current(clipSrc); }:", cbErr); }
      }
    }, stallMs);
    if (!preloadOnly) guardedPlay();
  };

  /* Leave no dead src behind: a clip that 404s must unload so a later
     load takes the normal path instead of fading up black. */
  const unload = () => {
    const el = vref.current;
    if (!el) return;
    clearTimeout(stallRef.current);
    readyRef.current = false;
    srcRef.current = null;
    visibleTargetRef.current = false;
    try { el.removeAttribute("src"); el.load(); } catch (cbErr) { console.error("[Cerebrum] CerebrumApp.jsx unload: el.removeAttribute('src'); el.load(); }:", cbErr); }
    applyVisibility();
  };

  /* Element listeners, mounted once. canplay is the poster's release:
     only usable media data lets the video fade up. */
  useEffect(() => {
    const el = vref.current;
    if (!el) return;
    const onCanPlay = () => {
      clearTimeout(stallRef.current);
      readyRef.current = true;
      applyVisibility();
      try { if (onReadyRef.current) onReadyRef.current(); } catch (cbErr) { console.error("[Cerebrum] CerebrumApp.jsx onCanPlay: if (onReadyRef.current) onReadyRef.current(); }:", cbErr); }
    };
    const onLd = () => { try { if (onLoadedDataRef.current) onLoadedDataRef.current(); } catch (cbErr) { console.error("[Cerebrum] CerebrumApp.jsx onLd: if (onLoadedDataRef.current) onLoadedDataRef.current(); }:", cbErr); } };
    const onErr = () => {
      clearTimeout(stallRef.current);
      try { if (onErrorRef.current) onErrorRef.current(); } catch (cbErr) { console.error("[Cerebrum] CerebrumApp.jsx onErr: if (onErrorRef.current) onErrorRef.current(); }:", cbErr); }
    };
    const onPS = () => {
      try { if (onPlayStateRef.current) onPlayStateRef.current(); } catch (cbErr) { console.error("[Cerebrum] CerebrumApp.jsx onPS: if (onPlayStateRef.current) onPlayStateRef.current(); }:", cbErr); }
      let playing = false;
      try { playing = !el.paused; } catch (cbErr) { console.error("[Cerebrum] CerebrumApp.jsx onPS: playing = !el.paused; }:", cbErr); }
      if (playingRef.current !== playing) {
        playingRef.current = playing;
        try { if (onPlaybackChangeRef.current) onPlaybackChangeRef.current(playing); } catch (cbErr) { console.error("[Cerebrum] CerebrumApp.jsx if: if (onPlaybackChangeRef.current) onPlaybackChangeRef.current(playing);:", cbErr); }
      }
    };
    el.addEventListener("canplay", onCanPlay);
    el.addEventListener("loadeddata", onLd);
    el.addEventListener("error", onErr);
    el.addEventListener("play", onPS);
    el.addEventListener("playing", onPS);
    el.addEventListener("pause", onPS);
    return () => {
      clearTimeout(stallRef.current);
      el.removeEventListener("canplay", onCanPlay);
      el.removeEventListener("loadeddata", onLd);
      el.removeEventListener("error", onErr);
      el.removeEventListener("play", onPS);
      el.removeEventListener("playing", onPS);
      el.removeEventListener("pause", onPS);
    };
  }, []);

  /* Declarative drive: a src prop means the parent is not driving the
     slot API — the layer loads the clip itself. */
  useEffect(() => {
    if (!declarative) return;
    loadClip(src, { objectPosition });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, declarative]);
  useEffect(() => {
    if (!declarative) return;
    visibleTargetRef.current = !!visible;
    applyVisibility();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, declarative]);
  useEffect(() => {
    if (!declarative) return;
    if (!active) pause();
    else if (srcRef.current) guardedPlay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, declarative]);

  /* The visibility contract (§5): pause the decoder the moment the tab
     hides; on foreground, re-run the muted-inline play sequence rather
     than assuming playback resumed. The reel passes
     manageVisibility={false} and runs its own (it also has timers to
     restart); everyone else gets this. */
  useEffect(() => {
    if (!manageVisibility) return;
    const onVis = () => {
      const el = vref.current;
      if (!el) return;
      if (document.hidden) { try { el.pause(); } catch (cbErr) { console.error("[Cerebrum] CerebrumApp.jsx if: el.pause(); }:", cbErr); } }
      else if (activeRef.current && visibleTargetRef.current && srcRef.current) guardedPlay();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [manageVisibility]);

  /* The slot API for the reel: everything the old code did by touching
     the <video> directly, now behind named operations. */
  useImperativeHandle(ref, () => ({
    loadClip: (s, opts) => loadClip(s, opts),
    preloadClip: (s, opts) => loadClip(s, { ...(opts || {}), preloadOnly: true }),
    unload: () => unload(),
    guardedPlay: () => guardedPlay(),
    /* Gesture-context playback: runs inside the tap's own window, the one
       place iOS Low Power Mode honours play(). */
    playNow: () => { notifiedRef.current = false; guardedPlay(); return true; },
    pause: () => pause(),
    setVisible: (v) => { visibleTargetRef.current = !!v; applyVisibility(); },
    /* zIndex staging for the dip-free dissolve: the incoming slot rises
       above the outgoing while it fades in over it. */
    setZ: (z) => { try { if (layerRef.current) layerRef.current.style.zIndex = String(z); } catch (cbErr) { console.error("[Cerebrum] CerebrumApp.jsx: if (layerRef.current) layerRef.current.style.zIndex = String(z); }:", cbErr); } },
    /* After the crossfade the outgoing slot is fully covered: drop it
       instantly (no second fade) and pause its decoder — this is the
       "pause offscreen video after crossfades" half of the contract. */
    snapHide: () => {
      visibleTargetRef.current = false;
      const el = vref.current;
      if (!el) return;
      try {
        const t = el.style.transition;
        el.style.transition = "none";
        el.style.opacity = "0";
        void el.offsetWidth;
        el.style.transition = t;
      } catch (cbErr) { console.error("[Cerebrum] CerebrumApp.jsx: const t = el.style.transition;:", cbErr); }
    },
    isPaused: () => { try { return !vref.current || vref.current.paused; } catch { return true; } },
  }));

  const wrapStyle = {
    position: pinned ? "fixed" : "absolute",
    inset: 0,
    overflow: "hidden",
    pointerEvents: "none",
    ...style,
  };
  return (
    <div ref={layerRef} className={"cb-film-layer " + className} aria-hidden="true" style={wrapStyle}>
      {/* Poster beneath the video, always: first paint, blocked reel,
          and the frames before a decoder produces a picture — a graded
          still, never a gray plane. */}
      <div className="cb-film-layer-poster" style={posterUrl ? { backgroundImage: `url("${posterUrl}")` } : undefined} />
      <video
        ref={vref}
        className="cb-film-layer-video"
        muted
        autoPlay
        loop={loop}
        playsInline
        webkit-playsinline="true"
        disablePictureInPicture
        preload={preload}
        poster={posterUrl || undefined}
        tabIndex={-1}
        aria-hidden="true"
        style={{
          objectPosition,
          opacity: 0,
          transition: reduceMotion ? "none" : `opacity ${fadeMs}ms var(--cb-ease)`,
        }}
      />
      {dim > 0 && (
        <div className="cb-film-layer-dim" style={{ background: dimColor, opacity: dim }} />
      )}
    </div>
  );
});

export const CinematicFilm = forwardRef(function CinematicFilm({ intensity = 1, animationMode = "off", paused = false, onClip, onAutoplayBlocked, onPlaybackChange, startAt = null, holdMs = FILM_HOLD_MS, proReel = false, reel = null }, ref) {
  const aRef = useRef(null);
  const bRef = useRef(null);
  const curRef = useRef(0);
  const idxRef = useRef(0);
  const missRef = useRef(0);
  const timerRef = useRef(0);
  const fadeRef = useRef(0);
  const orderRef = useRef(null);
  const orderProRef = useRef(null);
  /* Video-CDN lazy gate: the kickoff effect below observes this container
     and assigns the first <video> src only once the film is near the
     viewport — zero video bytes for pages where it never scrolls in. */
  const reelRef = useRef(null);
  // Reshuffle when the reel switches between free and Pro. The reel effect
  // below is keyed on proReel too, so the switch takes effect at once: the
  // member sees the members-only backdrop immediately, not after the
  // current free clip's hold expires. idxRef restarts at the head of the
  // new order (the lists are disjoint, so no index can carry over).
  /* Orientation comes from the resize aware viewport hooks in
     appUtils, so the reel pick below follows rotation and resize.
     First paint reads the same values the old one shot window read
     did; the hooks' windowless defaults keep the landscape fallback. */
  const winW = useWindowWidth();
  const winH = useWindowHeight();
  const portrait = winH > winW;
  /* The reshuffle keys on the picked list itself: a new pick (a reel
     switch, a Pro switch, or an orientation flip on the unnamed reel)
     reshuffles at once, exactly as the Pro switch always has, while a
     named reel's list is orientation blind and never restarts on a
     rotation. */
  const reelClips = filmReel(proReel, reel, portrait);
  if (!orderRef.current || orderProRef.current !== proReel || orderRef.current._clips !== reelClips) {
    const o = reelClips.slice();
    o._clips = reelClips;
    for (let i = o.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = o[i]; o[i] = o[j]; o[j] = t;
    }
    orderRef.current = o;
    orderProRef.current = proReel;
    idxRef.current = 0;
  }
  /* `startAt` keeps the same background frame across the intro →
     workspace handoff: the workspace mounts its own reel instance opening
     on the given clip (see enterClip in App). */
  if (startAt) {
    const si = orderRef.current.indexOf(startAt);
    if (si >= 0) idxRef.current = si;
  }

  /* One honest test for "should this be playing at all", consulted by the
     effect below and by every event that can change the answer. A visitor
     who asked for less motion, or whose phone is on a metered connection,
     gets the still ground — the same contract every other animated surface
     in this file follows. */
  const blocked = filmBlocked(animationMode, paused);

  /* onClip is read through a ref on purpose. The reel effect below is keyed
     on `blocked` alone; letting a fresh callback identity into its
     dependency list would tear down and restart the whole reel — new
     decoders, a jump back to clip one — every time the parent re-rendered
     for an unrelated reason. */
  const clipCbRef = useRef(onClip);
  clipCbRef.current = onClip;
  const report = (src) => { const f = clipCbRef.current; if (f) f(src); };
  /* Same treatment for the autoplay-blocked callback: read through a ref so
     a fresh callback identity never restarts the reel. */
  const autoplayCbRef = useRef(onAutoplayBlocked);
  autoplayCbRef.current = onAutoplayBlocked;
  /* Fires at most once per mount — the parent shows a tap-to-play pill on
     the first rejection and clears it on success. */
  const autoplayNotifiedRef = useRef(false);
  /* Playback truth, reported to the parent: read through a ref for the same
     reason. Dwell time is static per mount, also read through a ref. */
  const playbackCbRef = useRef(onPlaybackChange);
  playbackCbRef.current = onPlaybackChange;
  const holdMsRef = useRef(holdMs);
  holdMsRef.current = holdMs;
  /* Last reported playback state — the parent only re-renders on change. */
  const playingNotifiedRef = useRef(null);

  /* ── Reel orchestration, component-level ──
     Every callback the two FilmLayer slots call (onLoadedData, onError,
     onAutoplayBlocked, onPlaybackChange) is read through the layer's own
     callback refs, so these plain functions can live here at component
     level and the reel effect below stays keyed on `blocked` alone: a
     fresh parent render never tears down and restarts the reel. The
     layer owns everything the <video> element itself does (muted-inline
     setup, play() promise, stall guard, poster-first fade); what stays
     here is the reel's own orchestration — shuffle order, dip-free
     dissolve, warm preloads. */

  const slotsOf = () => [aRef.current, bRef.current];

  /* Object-position is applied when a clip is assigned to a slot, not
     restyled onto a playing video mid resize: `narrow` tracks the
     resize aware width hook above, at the same 900px line the old one
     shot matchMedia read drew (max-width, boundary included), and
     framePos reads it fresh each time a slot takes a clip. */
  const narrow = winW <= 900;
  const framePos = (src) => {
    const scene = FILM_SCENES[src];
    if (!scene) return "50% 50%";
    return (narrow ? (scene.posMobile || scene.pos) : scene.pos) || "50% 50%";
  };

  /* The single source of truth for "is footage actually moving": the
     current slot's own paused flag, sampled on every play-state event
     and whenever the reel is deliberately stopped. The parent's labels
     (footer toggle, tap-to-play pill) derive from this — never from
     intent flags — so they cannot claim "paused" while the picture moves.
     The outgoing slot is paused 2.4s after every dissolve, but by then
     curRef already points at the incoming slot, so that pause never
     flips this to false mid-transition. */
  const reportPlaying = () => {
    const f = playbackCbRef.current;
    if (!f) return;
    let playing = false;
    try { playing = !slotsOf()[curRef.current].isPaused(); } catch (cbErr) { console.error("[Cerebrum] CerebrumApp.jsx reportPlaying: playing = !slotsOf()[curRef.current].isPaused(); }:", cbErr); }
    if (playingNotifiedRef.current !== playing) {
      playingNotifiedRef.current = playing;
      try { f(playing); } catch (cbErr) { console.error("[Cerebrum] CerebrumApp.jsx if: f(playing); }:", cbErr); }
    }
  };
  const onSlotPlayState = () => reportPlaying();

  const stop = () => {
    clearTimeout(timerRef.current);
    clearTimeout(fadeRef.current);
    for (const slot of slotsOf()) { try { if (slot) slot.pause(); } catch (cbErr) { console.error("[Cerebrum] CerebrumApp.jsx stop: if (slot) slot.pause(); }:", cbErr); } }
  };

  /* Which slot is buffering the clip after next, if any. */
  const preloadingRef = useRef(null);

  const onSlotAutoplayBlocked = (err) => {
    /* A rejected play while the reel is supposed to be running is the
       signature of an autoplay policy (Low Power Mode on iOS): the file
       and decoder are fine, the phone just vetoed a programmatic start.
       Tell the parent once so it can offer a tap-to-play affordance — a
       still poster with no explanation reads as "clips aren't playing".
       A later successful play clears the flag via playNow. */
    if (!autoplayNotifiedRef.current && autoplayCbRef.current) {
      autoplayNotifiedRef.current = true;
      try { autoplayCbRef.current(err); } catch (cbErr) { console.error("[Cerebrum] CerebrumApp.jsx if: autoplayCbRef.current(err); }:", cbErr); }
    }
  };

  /* The play path, through the slot. The layer owns the muted-inline
     sequence, the play() promise, and the poster-first fade; the reel
     owns when the dissolve starts. */
  const playSlot = (slot, src) => {
    if (!slot || !src) return;
    if (preloadingRef.current === slot) preloadingRef.current = null;
    slot.loadClip(src, { objectPosition: framePos(src) });
  };

  const onSlotError = (slot) => {
    if (!slot) return;
    if (preloadingRef.current === slot) {
      /* A preload that 404s stays silent: the upcoming cycle() requests
         the same file through the play path and advances past it there.
         Leave no dead src behind so cycle time takes the normal load
         path instead of fading up black. */
      preloadingRef.current = null;
      missRef.current++;
      slot.unload();
      return;
    }
    /* One unplayable clip must not take the backdrop down with it. */
    if (++missRef.current < orderRef.current.length) {
      idxRef.current = (idxRef.current + 1) % orderRef.current.length;
      playSlot(slot, orderRef.current[idxRef.current]);
    } else {
      /* The whole reel failed — no codec, blocked assets, an offline
         cache miss. Leave the poster frame visible rather than fading
         to the bare ground: a still graded frame is a better backdrop
         than a gradient, and it costs nothing once decoding has been
         abandoned. */
      stop();
      slot.setVisible(true);
    }
  };

  /* Buffer the clip after next into the free slot without playing it.
     Called once the outgoing clip's fade has finished — setting src
     earlier would unload the clip mid-dissolve and kill the fade. */
  const preloadInto = (slot, src) => {
    if (!slot || !src) return;
    preloadingRef.current = slot;
    /* At most the next clip is ever buffered: both slots start at
       preload="none" so nothing else fetches until it is a slot's turn. */
    slot.preloadClip(src, { objectPosition: framePos(src) });
  };

  const cycle = () => {
    const slots = slotsOf();
    const next = 1 - curRef.current;
    const incoming = slots[next];
    const outgoing = slots[curRef.current];
    if (!incoming || !outgoing) return;
    idxRef.current = (idxRef.current + 1) % orderRef.current.length;
    /* Dip-free dissolve. The old code faded the outgoing to 0 at the same
       moment it faded the incoming to 1: mid-transition the two opacities
       summed below 1 and the black ground showed through — the visible
       "black fade" between clips. Now the outgoing stays fully opaque
       underneath while the incoming fades up OVER it (staged above via
       zIndex), so the frame is always fully covered and brightness never
       dips. Once the incoming is opaque, the outgoing is taken out
       instantly — invisible, because it is completely hidden behind. */
    incoming.setZ(2);
    outgoing.setZ(1);
    playSlot(incoming, orderRef.current[idxRef.current]);
    /* Poster-first: the incoming slot's own layer holds its graded still
       until canplay, then runs the fade — the old code faded the video
       element itself up over bytes that were still arriving. */
    incoming.setVisible(true);
    report(orderRef.current[idxRef.current]);
    curRef.current = next;
    /* Stop decoding the clip nobody can see. The delay clears the 2.2s
       dissolve; pausing immediately would freeze the outgoing frame
       mid-fade. */
    fadeRef.current = setTimeout(() => {
      try { outgoing.pause(); } catch (cbErr) { console.error("[Cerebrum] CerebrumApp.jsx: outgoing.pause(); }:", cbErr); }
      /* Fully covered: hide without a transition so there is no second
         fade — then buffer the clip after next so the following dissolve
         starts from a warm decoder. The incoming clip used to begin
         loading at the exact moment its 2.2s fade started — fading up
         over bytes that were still arriving was the visible hitch on
         every transition. */
      try { outgoing.snapHide(); } catch (cbErr) { console.error("[Cerebrum] CerebrumApp.jsx: outgoing.snapHide(); }:", cbErr); }
      preloadInto(outgoing, orderRef.current[(idxRef.current + 1) % orderRef.current.length]);
    }, 2400);
    timerRef.current = setTimeout(cycle, holdMsRef.current);
  };

  /* Gesture-context playback for the parent's Play control (see the
     forwardRef note above). Returns true when a play was issued. The
     slot re-runs the muted-inline sequence inside the tap's own gesture
     window — the one place iOS Low Power Mode honours it. */
  useImperativeHandle(ref, () => ({
    playNow: () => {
      const slot = slotsOf()[curRef.current];
      if (!slot) return false;
      try {
        slot.playNow();
        autoplayNotifiedRef.current = false;
        return true;
      } catch { return false; }
    },
  }), []);

  useEffect(() => {
    const slots = slotsOf();
    if (!slots[0] || !slots[1]) return;

    if (blocked) {
      stop();
      /* Deliberately stopped: report it, so a label that read "Pause
         background" flips to "Play background" instead of lying. */
      reportPlaying();
      /* The still IS a frame of a real clip, so the centered title card
         above it is still describing what is on screen. The clip's graded
         still shows with no decoding at all — each slot carries its own
         poster layer now, so the old separate backdrop div is gone. */
      report(FILM_POSTER_CLIP);
      slots[curRef.current].setVisible(true);
      slots[1 - curRef.current].setVisible(false);
      return;
    }

    /* Video-CDN lazy gate (docs/video-cdn-frontend-map.md §4): the first
       src assignment — and every byte it fetches — waits until the film
       layer is near the viewport (rootMargin warms it ~2 viewports early,
       so the poster→video fade is ready on arrival). Until then only the
       poster still is on screen, already the designed first-paint state.
       The prefers-reduced-motion / filmOff paths returned above, so they
       never even reach this observer. */
    /* The reel runs its own visibility contract (the layers' is disabled
       via manageVisibility={false}): pause the decoders the moment the
       tab hides; on foreground re-run the muted-inline play sequence and
       restart the cycle timer. */
    const onVis = () => {
      if (document.hidden) stop();
      else {
        try { slots[curRef.current].guardedPlay(); } catch (cbErr) { console.error("[Cerebrum] CerebrumApp.jsx onVis: slots[curRef.current].guardedPlay(); }:", cbErr); }
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(cycle, holdMsRef.current);
      }
    };
    /* Autoplay-policy recovery. iOS Low Power Mode rejects programmatic
       play() but honours the identical call issued from a real
       touch/click handler. So when the first user gesture arrives, retry
       playback and — if this reel was started while blocked by policy —
       kick the cycle timer so the reel advances instead of sitting on
       its first frame forever. */
    const tryResume = () => {
      try { slots[curRef.current].guardedPlay(); } catch (cbErr) { console.error("[Cerebrum] CerebrumApp.jsx tryResume: slots[curRef.current].guardedPlay(); }:", cbErr); }
      reportPlaying();
      if (!timerRef.current) timerRef.current = setTimeout(cycle, holdMsRef.current);
    };
    let io = null;
    let began = false;
    const begin = () => {
      if (began) return;
      began = true;
      if (io) { try { io.disconnect(); } catch (cbErr) { console.error("[Cerebrum] CerebrumApp.jsx if: io.disconnect(); }:", cbErr); } io = null; }
      slots[curRef.current].setZ(2);
      slots[1 - curRef.current].setZ(1);
      playSlot(slots[curRef.current], orderRef.current[idxRef.current]);
      slots[curRef.current].setVisible(true);
      slots[1 - curRef.current].setVisible(false);
      report(orderRef.current[idxRef.current]);
      /* Playback truth lives on the slots from here on (each layer reports
         play/playing/pause through onPlaybackChange). */
      reportPlaying();
      /* Warm the very first dissolve too: the hidden slot buffers clip
         #2 during the opening hold instead of cold-fetching at cycle time. */
      preloadInto(slots[1 - curRef.current], orderRef.current[(idxRef.current + 1) % orderRef.current.length]);
      timerRef.current = setTimeout(cycle, holdMsRef.current);
      document.addEventListener("visibilitychange", onVis);
      window.addEventListener("pointerdown", tryResume);
      window.addEventListener("touchend", tryResume);
    };
    if (reelRef.current && typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) begin();
      }, { rootMargin: "1200px 0px" });
      io.observe(reelRef.current);
    } else {
      begin();
    }
    return () => {
      if (io) { try { io.disconnect(); } catch (cbErr) { console.error("[Cerebrum] CerebrumApp.jsx if: io.disconnect(); }:", cbErr); } }
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointerdown", tryResume);
      window.removeEventListener("touchend", tryResume);
      clearTimeout(timerRef.current);
      clearTimeout(fadeRef.current);
      for (const slot of slots) { try { if (slot) slot.pause(); } catch (cbErr) { console.error("[Cerebrum] CerebrumApp.jsx for: if (slot) slot.pause(); }:", cbErr); } }
      /* Mobile Safari keeps decoding a detached <video> in the
         background, burning battery on a backdrop nobody can see. */
      for (const slot of slots) { try { if (slot) slot.unload(); } catch (cbErr) { console.error("[Cerebrum] CerebrumApp.jsx for: if (slot) slot.unload(); }:", cbErr); } }
    };
  }, [blocked, proReel]);

  return (
    <div className="cb-film" aria-hidden="true" ref={reelRef}>
      {/* Two crossfading slots of the one shared video layer. The layer
         owns the muted-inline setup, the play() promise, the stall guard,
         and the poster-first fade; the reel staggers the slots for the
         dip-free dissolve. `intensity` dims the room as the opacity of one
         solid layer — a compositor-thread property — rather than by
         re-grading every frame (the grade is baked into the files by the
         same ffmpeg pass that cuts them). */}
      <FilmLayer
        ref={aRef}
        pinned={false}
        manageVisibility={false}
        preload="none"
        fadeMs={2200}
        poster={filmPoster(orderRef.current[idxRef.current])}
        onLoadedData={() => { missRef.current = 0; }}
        onError={() => onSlotError(aRef.current)}
        onAutoplayBlocked={onSlotAutoplayBlocked}
        onPlaybackChange={onSlotPlayState}
      />
      <FilmLayer
        ref={bRef}
        pinned={false}
        manageVisibility={false}
        preload="none"
        fadeMs={2200}
        poster={filmPoster(orderRef.current[idxRef.current])}
        onLoadedData={() => { missRef.current = 0; }}
        onError={() => onSlotError(bRef.current)}
        onAutoplayBlocked={onSlotAutoplayBlocked}
        onPlaybackChange={onSlotPlayState}
      />
      {/* Cinematic vignette: clear in the middle, falling off to darkness at
          the frame edges. It focuses the eye on the interface floating over
          the footage and keeps bright clips from washing out the edges. */}
      <div className="cb-film-vignette" />
      <div className="cb-film-dim" style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: "#0b0d10",
        opacity: Math.max(0, Math.min(1, 1 - intensity)),
        transition: "opacity 1.2s var(--cb-ease)",
      }} />
    </div>
  );
});

export {
  InvestigationOpening,
  usePrefersReducedMotion,
  useReducedMotion,
  // Film block (4076-4465): constants + helpers
  FILM_CLIPS_LANDSCAPE,
  FILM_CLIPS_PORTRAIT,
  FILM_CLIPS_CALM,
  videoUrl,
  filmReel,
  FILM_POSTER,
  FILM_HOLD_MS,
  FILM_CREDITS,
  FILM_MODIFICATIONS,
  FilmCreditsDialog,
  FILM_SCENES,
  FILM_POSTER_CLIP,
  DOC_FILM_SRC,
  FILM_OPT_IN_KEY,
  filmForcedOn,
  setFilmForcedOn,
  filmBlocked,
  filmPoster,
  __filmVp9OK,
  __filmIosH264,
  filmBestFile,
  IntroModal,
  SourcesDialog,
  Intro,
  CerebrumFieldCanvas,
};
