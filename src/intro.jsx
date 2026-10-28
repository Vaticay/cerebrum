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
import { NovaRive } from "./NovaRive.jsx";
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

/* Intro reel for the ceremonial door. Dark, slow, atmospheric only.
   No literal footage of people, no bright scenes, and never, under any
   circumstances, fire or burning books. Dusty has ordered the burning
   books clip gone repeatedly; it kept surviving because the Mixkit URL
   below was labelled "storm clouds" in this file while the file it
   actually serves is a book on fire. Verified by pulling real frames
   from every clip on 2026-10-12:
   - Mixkit 52298 serves a BURNING BOOK. Never re add it, whatever any
     listing or comment claims it shows.
   - Mixkit 5774 is a bright lab scene with a man in a VR headset.
     Removed the same day: literal, bright, recognizable footage.
   Rule for anyone editing this list: pull a frame and look at it
   before the clip ships. A comment is not verification. */
/* Photo fix 2026-10-20 (owner photo of the door on a MacBook in
   Safari): the swirling clouds clip (20231) put large bright soft
   patches at placard height behind the sentence and the lockup.
   Measured, not guessed: five frames pulled across each clip on
   2026-10-20 (ffmpeg plus a PIL luminance pass, Rec.709 luma on a
   0 to 255 scale). 20231 opens as a bright daytime cloud scene and
   only darkens late: first frame mean 159.5, p95 234.8, placard
   band (middle 30 to 70 percent) mean 165.1, band p95 238.8; across
   five frames mean 80.0, p95 mean 127.2. Even under the new door
   grade below its band p95 still lands at 24.7, the brightest large
   region left on the door, so it is swapped out under the task
   rule, not merely graded harder. Its replacement is the darkest
   frame checked calm clip, 10011 (stars): five frames, mean 1.4,
   p95 mean 4.9, max p95 5.4, band mean 1.3, band p95 mean 4.5, and
   the frames were looked at: a near black star field, no large
   soft patches, nothing literal. The other calm candidates were
   measured and rejected the same day: 15711 (night clouds label,
   actually a literal dusk cityscape, mean 45.5, p95 142.7), 3147
   (moon clouds, a pink dusk scene, mean 35.7, early frame mean
   73.7), and 35007 (moon behind clouds, a blown bright moon disc,
   mean 77.0, p95 mean 184.8, band p95 mean 220.5). 30563 stays:
   mean 21.4, p95 mean 78.6, band p95 mean 102.5, and under the new
   grade its mean lands at 10.4 and its band p95 at 15.7. 10011 now
   appears in both the intro and calm reels; the lists are separate
   picks, so the calm reel is unchanged. */
const FILM_CLIPS_INTRO = [
  "https://assets.mixkit.co/videos/30563/30563-720.mp4", // Flying through dark matter in space. Frame checked 2026-10-12, measured again 2026-10-20.
  "https://assets.mixkit.co/videos/10011/10011-720.mp4", // Stars rotating slowly in the night sky. Frame checked and measured 2026-10-20: darkest calm clip, swapped in for 20231 above.
];

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
  // Named reels (2026-10-08): "intro" for the dramatic 4K door clips,
  // "calm" for the quieter main-page clips. These bypass the portrait
  // check — the clips are chosen to crop well.
  if (reel === "intro") return FILM_CLIPS_INTRO;
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


const SPECIMENS = [
  {
    /* 2026-10-28 (round 4 verify): the paper's conclusion is deficits
       equivalent to UP TO two nights of total sleep deprivation;
       "can impair" carries that qualifier in plain words. The flat
       "impairs" stated the maximum as the general value. */
    claim: "Two weeks of six-hour nights can impair your thinking as much as two nights with no sleep at all.",
    paper: "H. P. A. Van Dongen et al., \u201cThe cumulative cost of additional wakefulness,\u201d Sleep 26(2), 2003.",
    doi: "https://doi.org/10.1093/sleep/26.2.117",
  },
  {
    claim: "Distant exploding stars are dimmer than they should be, so the expansion of the universe is speeding up.",
    paper: "A. G. Riess et al., \u201cObservational evidence from supernovae for an accelerating universe,\u201d Astron. J. 116(3), 1998.",
    doi: "https://doi.org/10.1086/300499",
  },
  {
    claim: "Running grows new neurons in the adult brain, at least in mice.",
    paper: "H. van Praag et al., \u201cRunning increases cell proliferation and neurogenesis in the adult mouse dentate gyrus,\u201d Nat. Neurosci. 2(3), 1999.",
    doi: "https://doi.org/10.1038/6368",
  },
  {
    claim: "Four-year-olds who could wait for two marshmallows scored markedly higher on their SATs as teenagers.",
    paper: "Y. Shoda, W. Mischel & P. K. Peake, \u201cPredicting adolescent cognitive and self-regulatory competencies from preschool delay of gratification,\u201d J. Pers. Soc. Psychol. 57(6), 1990.",
    doi: "https://doi.org/10.1037/0022-3514.57.6.978",
  },
  {
    claim: "Cigarette smokers die of lung cancer at roughly ten times the rate of non-smokers.",
    paper: "R. Doll & A. B. Hill, \u201cSmoking and carcinoma of the lung,\u201d Br. Med. J. 2(4682), 1950.",
    doi: "https://doi.org/10.1136/bmj.2.4682.739",
  },
  {
    claim: "DNA is a double helix, with the two strands held together by paired bases.",
    paper: "J. D. Watson & F. H. C. Crick, \u201cMolecular structure of nucleic acids,\u201d Nature 171(4356), 1953.",
    doi: "https://doi.org/10.1038/171737a0",
  },
  {
    claim: "People fear a $100 loss about twice as much as they value a $100 gain.",
    paper: "D. Kahneman & A. Tversky, \u201cProspect theory: An analysis of decision under risk,\u201d Econometrica 47(2), 1979.",
    doi: "https://doi.org/10.2307/1914185",
  },
  {
    claim: "A bacterial immune system can be reprogrammed to cut any chosen DNA sequence.",
    paper: "M. Jinek et al., \u201cA programmable dual-RNA-guided DNA endonuclease in adaptive bacterial immunity,\u201d Science 337(6096), 2012.",
    doi: "https://doi.org/10.1126/science.1225829",
  },
  {
    claim: "Ripples in spacetime from two colliding black holes reached Earth after traveling over a billion years.",
    paper: "B. P. Abbott et al., \u201cObservation of gravitational waves from a binary black hole merger,\u201d Phys. Rev. Lett. 116(6), 2016.",
    doi: "https://doi.org/10.1103/PhysRevLett.116.061102",
  },
  {
    claim: "The shadow of a black hole 55 million light-years away was photographed for the first time.",
    paper: "Event Horizon Telescope Collaboration, \u201cFirst M87 event horizon telescope results,\u201d Astrophys. J. Lett. 875(1), 2019.",
    doi: "https://doi.org/10.3847/2041-8213/ab0ec7",
  },
  {
    claim: "Swapping one RNA building block lets synthetic messenger RNA slip past the immune system.",
    paper: "K. Karik\u00f3 et al., \u201cSuppression of RNA recognition by Toll-like receptors,\u201d Immunity 23(2), 2005.",
    doi: "https://doi.org/10.1016/j.immuni.2005.06.008",
  },
  {
    claim: "Stomach ulcers are caused by bacteria, not stress, and can be cured with antibiotics.",
    paper: "B. J. Marshall & J. R. Warren, \u201cUnidentified curved bacilli in the stomach of patients with gastritis and peptic ulceration,\u201d Lancet 323(8390), 1984.",
    doi: "https://doi.org/10.1016/S0140-6736(84)91816-6",
  },
  {
    claim: "Ordinary people will deliver what they believe are dangerous electric shocks when an authority figure tells them to.",
    paper: "S. Milgram, \u201cBehavioral study of obedience,\u201d J. Abnorm. Soc. Psychol. 67(4), 1963.",
    doi: "https://doi.org/10.1037/h0040525",
  },
  {
    claim: "Naming the ink color of a word is hard when the word itself spells a different color.",
    paper: "J. R. Stroop, \u201cStudies of interference in serial verbal reactions,\u201d J. Exp. Psychol. 18(6), 1935.",
    doi: "https://doi.org/10.1037/h0054651",
  },
  {
    claim: "The least competent people are the most confident about their abilities.",
    paper: "J. Kruger & D. Dunning, \u201cUnskilled and unaware of it,\u201d J. Pers. Soc. Psychol. 77(6), 1999.",
    doi: "https://doi.org/10.1037/0022-3514.77.6.1121",
  },
  {
    claim: "The more bystanders who witness an emergency, the less likely any one of them is to help.",
    paper: "J. M. Darley & B. Latan\u00e9, \u201cBystander intervention in emergencies: Diffusion of responsibility,\u201d J. Pers. Soc. Psychol. 8(4), 1968.",
    doi: "https://doi.org/10.1037/h0025589",
  },
  {
    claim: "People paid $1 to lie about a boring task later claimed they actually enjoyed it.",
    paper: "L. Festinger & J. M. Carlsmith, \u201cCognitive consequences of forced compliance,\u201d J. Abnorm. Soc. Psychol. 58(2), 1959.",
    doi: "https://doi.org/10.1037/h0046929",
  },
  {
    claim: "Antarctic ozone had dropped by a third, revealing a continent-sized hole in the ozone layer.",
    paper: "J. C. Farman, B. G. Gardiner & J. D. Shanklin, \u201cLarge losses of total ozone in Antarctica reveal seasonal ClOx/NOx interaction,\u201d Nature 315(6016), 1985.",
    doi: "https://doi.org/10.1038/315207a0",
  },
  {
    claim: "A Mediterranean diet with olive oil or nuts cut heart attacks and strokes by about 30 percent.",
    paper: "R. Estruch et al., \u201cPrimary prevention of cardiovascular disease with a Mediterranean diet,\u201d N. Engl. J. Med. 368, 2013.",
    doi: "https://doi.org/10.1056/NEJMoa1200303",
  },
  {
    claim: "Exercise works as an antidepressant, with larger benefits from more vigorous activity.",
    paper: "F. B. Schuch et al., \u201cExercise as a treatment for depression: A meta-analysis,\u201d Am. J. Psychiatry 175(7), 2018.",
    doi: "https://doi.org/10.1176/appi.ajp.2018.17111186",
  },
  {
    claim: "Deep sleep replays the day\u2019s experiences and moves them into long-term memory.",
    paper: "S. Diekelmann & J. Born, \u201cThe memory function of sleep,\u201d Nat. Rev. Neurosci. 11(2), 2010.",
    doi: "https://doi.org/10.1038/nrn2762",
  },
  {
    claim: "The human body carries roughly as many bacterial cells as human cells.",
    paper: "Human Microbiome Project Consortium, \u201cStructure, function and diversity of the healthy human microbiome,\u201d Nature 486(7402), 2012.",
    doi: "https://doi.org/10.1038/nature11234",
  },
  {
    claim: "Mold juice kills staphylococcus bacteria, the first observed antibiotic effect.",
    paper: "A. Fleming, \u201cOn the antibacterial action of cultures of a penicillium,\u201d Br. J. Exp. Pathol. 10(3), 1929.",
    doi: "https://doi.org/10.1111/j.1472-765X.1929.tb00571.x",
  },
  {
    claim: "About a third of patients improve on a sugar pill with no active ingredient.",
    paper: "H. K. Beecher, \u201cThe powerful placebo,\u201d J. Am. Med. Assoc. 159(17), 1955.",
    doi: "https://doi.org/10.1001/jama.1955.02960340022006",
  },
];

/* The intro's history, kept short: the door was a calibration chamber
   over film (2026-10-08), then a specimen placard over the returning
   cinema (2026-10-09 to 2026-10-12). The 2026-10-13 plate redesign
   replaced the door with a specimen plate for a day; Dusty's directive
   the same day ("Bring back the old intro page just make it better")
   restored the film door below, improved, and superseded the plate
   door. What carried through every version: SPECIMENS (real verified
   claims, the product demonstrating itself), "Traced to a direct
   finding", and the door rule: no composer here, one way in,
   ceremonial. The calm air rule also stands: atmospheric, very slow,
   very dark, never literal footage on the door. */
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
   Intro — the cinematic door, restored (2026-10-20).

   History, short form: the door was a calibration chamber over film
   (2026-10-08), a specimen plate for a day (2026-10-13), then the
   film door restored the same day on Dusty's directive ("Bring back
   the old intro page just make it better"). On 2026-10-16 his
   verdict on that door was that it looked AI generated and did not
   match the app, and the door was rebuilt flat in the app's design
   language (423ac66). On 2026-10-19, on his order to reimagine it
   again, the door became a two column room: a threshold column and
   a numbered evidence ledger with a Nova section (6004ede). He saw
   it live on 2026-10-20 and rejected it on sight: way too AI and
   busy. His order: bring back the cinematic.

   This is that restoration, and it is deliberately NOT the old film
   door's furniture returning with the film. What returns is the
   foundation only: the ambient science reel under a calm grade
   (brightness 0.30, saturate 0.60, blur 12px at restoration; the
   door grade was darkened later the same day, 2026-10-20, on the
   owner's photo: see the wrapper comment in Intro below for the
   shipped door values and the measurements behind them. The
   2026-10-08 ruling stands: atmospheric not literal, very dark,
   heavily blurred, nothing recognizable competing with the
   content). The DotField
   and the blurred haze fields leave the door: where the field and
   the film would fight, the film wins. The fanned glass cards, the
   gradients, the glow shadows, the sheen, and the tracked caps
   wordmark stay retired with the doors that carried them.

   What the door carries is the core list and nothing more:
   - The masthead lockup: the brain Mark at 22 in the accent and
     "Cerebrum" in Inter 500, the pairing the search stage carries,
     with the quiet links.
   - The one plain sentence, the stage's own, word for word.
   - ONE specimen at a time in the caption strip at the foot of
     the frame (2026-10-28 reimagination; the placard is retired),
     rotating on
     the same timer with the same pauses (hold, dialog, off
     screen, reduced motion). Not a set, not a ledger: one claim,
     its paper one tap away.
   - The honest proof line as the strip's last line, opening the sources
     dialog, its count from the real SCHOLARLY_SOURCES list.
   - The single way in, "Start researching". No composer on the
     door, ever.
   - Nova, quiet: her figure once and one short line in her dry
     voice. No section, no box, no wordmark; the ledger door's
     NovaDoorSection is gone with the ledger.
   - The footer: the year on one quiet line.

   Standing behavior, unchanged: the door is dark because the film
   door is the brand door, the same for everyone (the intro accent
   keeps its sage fallback); cerebrum-entered collapses the
   ceremony for returning visitors; reduced motion gets the graded
   poster still (filmBlocked's contract inside the reel) and one
   composed fade; leaving takes the 420ms descent; consent appears
   on the way in, in the shell, never on this door.
   ════════════════════════════════════════════════════════════════════ */
function Intro({ accent, P, onEnter, animationMode = "off", user = null }) {
  /* Cinema mode, 2026-10-28 (the owner's call, for commercial
     takes): ?cinema locks the door into a fixed recordable frame,
     9 by 16 by default, 16 by 9 with ?cinema=wide. Inside it the
     staged entrance runs once on its fixed clock whatever the
     session flag says, one specimen (the Van Dongen card the door
     opens on) is held for the whole take, and everything that is
     not part of the pitch (nav links, the footer line, the scroll
     cue) stays out of frame. The film, the arrangement, Nova's
     line, the fonts, and the palette are exactly the live door's. */
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
  const [sourcesOpen, setSourcesOpen] = useState(false);
  /* Stepping through: the door opens (2026-10-28, the owner's call:
     two black leaves part over the film light, 720ms, and the app
     is entered at 700ms; this replaced the 420ms chamber descent).
     The no-motion path is untouched: animation off or reduced motion
     goes straight through, instantly, and never mounts the split.
     A second press while leaving is ignored. */
  const [leaving, setLeaving] = useState(false);
  const leaveTimer = useRef(null);
  useEffect(() => () => clearTimeout(leaveTimer.current), []);

  /* A repeat visit in the same session skips the ceremony: the flag is
     set on the way in, and a returning door renders composed at once,
     with the way in already focused. Carried over from the plate door
     (2026-10-13) into every door since. */
  const [enteredBefore] = useState(() => {
    try { return sessionStorage.getItem("cerebrum-entered") === "1"; } catch { return false; }
  });

  /* The intro uses Cerebrum's sage, not the visitor's chosen accent.
     The front door is the brand, and it is the same for everyone. */
  const introAccent = (accent && relLuminance(accent) >= 0.15 && relLuminance(accent) <= 0.82)
    ? accent
    : "#8ba888";
  /* The accent at low alpha, for the paper link's underline. */
  const accentA = (a) => {
    const h = String(introAccent).replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  };

  /* Specimen rotation: ONE claim at a time (2026-10-20 restoration;
     the sets of three belonged to the busier doors), advancing every
     9s (desktop) or 12s (mobile), paused while a dialog is open,
     while the visitor holds the placard, while the placard is off
     screen, or under reduced motion. */
  const [specimenIdx, setSpecimenIdx] = useState(0);
  const [specimenHeld, setSpecimenHeld] = useState(false);
  const [doorHover, setDoorHover] = useState(false);
  const specimenCount = SPECIMENS.length;
  /* The rotation only runs while the placard is on screen (M10): an
     IntersectionObserver watches it; when it leaves the viewport the
     timer stands down, so phones no longer rotate a claim nobody can
     see. Reduced motion still stops the rotation entirely. */
  const specimenWrapRef = useRef(null);
  const [specimenVisible, setSpecimenVisible] = useState(true);
  /* The scroll cue and its proof line observer retired 2026-10-28
     with the reimagined door: the specimen stands in the caption
     strip at the foot of the flex frame, inside the first
     screenful on the phone range the cue served, so there is no
     below the fold evidence left to hint at. */
  useEffect(() => {
    const el = specimenWrapRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver((entries) => {
      setSpecimenVisible(entries.some((e) => e.isIntersecting));
    }, { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (cinema) return undefined;
    if (reduced || animationMode === "off") return undefined;
    if (specimenHeld || sourcesOpen) return undefined;
    if (!specimenVisible) return undefined;
    const t = setInterval(
      () => { if (typeof document !== "undefined" && document.hidden) return; setSpecimenIdx((i) => (i + 1) % specimenCount); },
      isMobile ? 12000 : 9000
    );
    return () => clearInterval(t);
  }, [reduced, animationMode, specimenHeld, sourcesOpen, specimenVisible, specimenCount, isMobile]);
  /* Cinema holds this binding at index 0, the Van Dongen card: the
     rotation effect above never runs in cinema, so the index never
     advances for the whole take. */
  const spec = SPECIMENS[specimenIdx % specimenCount];

  /* ── The door rule ──
     This screen is a threshold, not a search screen: there is no composer
     here, deliberately. The way through is "Start researching" — the
     workspace opens with its cursor in the real composer. */

  const go = (q, submit) => {
    const payload = typeof q === "string" ? q : "";
    if (leaving) return;
    try { sessionStorage.setItem("cerebrum-entered", "1"); } catch { /* private mode: the ceremony simply repeats */ }
    if (animationMode === "off" || reduced) { onEnter(payload, !!submit, null); return; }
    setLeaving(true);
    clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => onEnter(payload, !!submit, null), 700);
  };

  /* Loops on the door (the plate sheen, the scroll cue) pause while
     the tab is hidden: the wrap takes cb-door-hidden and the CSS
     stands their animations down. */
  const [docHidden, setDocHidden] = useState(false);
  useEffect(() => {
    const onVis = () => setDocHidden(typeof document !== "undefined" && !!document.hidden);
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const animate = animationMode !== "off" && !reduced;
  /* The ceremony is the staged entrance on a first visit (2026-10-28:
     film, wordmark, sentence, the way in, Nova, the specimen card,
     staged on one curve in the cb-door-stage rules; it replaced the
     single quiet fade of the whole room). Returning visitors skip
     it: chrome renders composed, the wrap takes the still class,
     and only the film and the rotation run, as they do for
     everyone. */
  const ceremony = animate && !enteredBefore;
  /* Cinema takes run the staged entrance once per load whatever the
     session flag says, so the wrap takes the ceremony class there
     too. */
  const doorIn = ceremony || (!!cinema && animate);
  /* The door's own darks, as the film doors always carried them: the
     film is graded to near black, and the chrome sits on these values
     in every palette. The smallest text (the proof line, the footer)
     takes the 0.58 alpha, which clears 4.5 to 1 against the graded
     ground; secondary text takes 0.72. */
  const ink = "#eef1ee";
  const ink2 = "rgba(238,241,238,0.72)";
  const faint = "rgba(238,241,238,0.58)";
  const hairline = "rgba(255,255,255,0.10)";
  /* The specimen's ground (2026-10-28, the reimagined door): the
     caption strip at the foot of the frame is the door's own solid
     ground, #05070a, fully opaque, so the claim and its proof sit
     on solid black exactly as the standing rule for text carrying
     surfaces requires, with no card between them and the frame. */

  const navLink = {
    fontFamily: "var(--cb-font)", fontSize: FONT_SIZES.label, letterSpacing: "normal",
    color: ink2, textDecoration: "none",
    fontWeight: 500, padding: "10px 6px", whiteSpace: "nowrap",
    display: "inline-flex", alignItems: "center", minHeight: 48,
  };

  const wrapCls = [leaving ? "cb-intro-leaving" : "", (reduced || enteredBefore) && !leaving ? "cb-intro-still" : "", doorIn ? "cb-door-in" : "", docHidden ? "cb-door-hidden" : ""]
    .filter(Boolean).join(" ") || undefined;

  const doorRoot = (
    <div id="cb-intro-wrap" className={wrapCls} style={{
      minHeight: cinema ? "100%" : "100dvh", height: cinema ? "100%" : undefined, position: "relative", overflowX: "clip",
      display: "flex", flexDirection: "column",
      fontFamily: "var(--cb-font)", background: "#05070a", color: ink,
    }}>
      {/* The film (restored 2026-10-20): the ambient science reel is
          the door's foundation again. The grade is the 2026-10-08
          ruling in values, darkened the same day (2026-10-20) on the
          owner's photo of this door, which showed large bright soft
          cloud patches at placard height behind the sentence and the
          lockup competing with the text. Door local grade only (the
          app home film keeps its own settings): brightness 0.22
          (very dark, down from 0.30), saturate 0.60, blur 12px
          (heavily blurred, so no clip reads as footage), over clips
          that hold 11 seconds each (very slow), and intensity 0.30
          below (down from 0.50), so the solid dim layer (#0b0d10,
          luminance 12.8) covers at opacity 0.70. Graded luminance is
          therefore 0.066 times frame luminance plus 8.95, against
          0.15 times plus 6.40 before. Measured 2026-10-20 on five
          pulled frames per clip (see FILM_CLIPS_INTRO): the kept
          dark matter clip lands at mean 10.4, p95 14.1; the swapped
          in stars clip at mean 9.0, p95 9.3; the removed clouds clip
          would still have landed at band p95 24.7, so it went.
          filmBlocked inside the reel stands it down to its graded
          poster still under reduced motion, Save-Data, or animation
          off, so the door never opens onto black and never moves for
          a visitor who asked it not to. No dot field, no haze fields,
          no grain: where they would fight the film, the film wins. */}
      <div aria-hidden="true" className="cb-door-film" style={{
        position: cinema ? "absolute" : "fixed", inset: 0, zIndex: 0, pointerEvents: "none",
        filter: "brightness(0.22) saturate(0.60) blur(12px)",
      }}>
        <CinematicFilm
          reel="intro"
          animationMode={animationMode}
          intensity={0.3}
          onAutoplayBlocked={() => {}}
          onPlaybackChange={() => {}}
        />
      </div>

      {/* Film grain, 2026-10-28 (round 4, allowed under the film
          laws): a static fractal noise tile at five percent over the
          graded band, texture only, never animated. It sits outside
          the graded wrapper so the blur cannot smear it, and above
          the film but below every chrome layer. */}
      <div aria-hidden="true" style={{
        position: cinema ? "absolute" : "fixed", inset: 0, zIndex: 1, pointerEvents: "none", opacity: 0.05,
        backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E\")",
        backgroundSize: "180px 180px",
      }} />

      {/* ── Header: the masthead lockup and quiet links. The lockup
          is the search stage's pairing (Mark at 22 in the accent,
          the name in Inter 500, title case), so the door opens with
          the same nameplate the app carries inside. */}
      <header className="cb-intro-chrome cb-door-stage-1" style={{
        position: "relative", zIndex: 30,
      }}>
        <div style={{
          maxWidth: LAYOUT.stage, margin: "0 auto", padding: "max(14px, env(safe-area-inset-top)) 24px 14px",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <Mark size={22} accent={introAccent} />
            <span style={{
              fontFamily: "var(--cb-font)", fontWeight: 500,
              fontSize: FONT_SIZES.section, color: ink, lineHeight: 1,
            }}>Cerebrum</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 10 : 22 }}>
            {!cinema && !isMobile && ["About", "Privacy", "Terms", "Contact"].map((item) => (
              <a key={item} href={"/" + item.toLowerCase()} className="cb-intro-navlink" style={navLink}>{item}</a>
            ))}
          </div>
        </div>
      </header>

      {/* ── The room, reimagined 2026-10-28 (the owner's redirect:
          "completely re imagined and cinematic, please stop just
          moving stuff around"). The October 23 arrangement (two
          quiet groups, film between, specimen plate at the foot)
          and the polish pass built on it the same morning are
          superseded. The door is now staged as a film frame. The
          graded reel fills the whole frame and the upper frame is
          left to it, empty. One title block stands low in the
          frame, the way a title sits in a title sequence: the
          sentence at title scale, the way in under it, and Nova's
          line under that, her voice the last thing before the
          evidence. The evidence itself is the frame's caption
          strip, a full width band of the door's solid ground at
          the foot (rendered after this main, below): the specimen
          set as captions are set, claim, citation, proof, no card,
          no plate, no border box. Nothing about the identity
          moved: the film and its grade, the sentence word for
          word, one way in, Nova once with her line word for word,
          real specimens with their papers one tap away. Phones:
          the whole frame fits the first screenful at 360 by 667
          (masthead near 57, the title block near 300, the strip
          near 230), so nothing on the door waits below a fold. */}
      <main className="cb-intro-chrome" style={{
        position: "relative", zIndex: 20, flex: 1,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end",
        padding: isMobile ? "16px 20px 26px" : "24px 24px 36px",
      }}>
      <div style={{ width: "100%", maxWidth: LAYOUT.stage }}>
        {/* The one plain sentence, the search home stage's own, word
            for word. */}
        <p className="cb-door-stage-2" style={{
          // Look modernization, 2026-10-26: the door sentence steps
          // up to a grand scale (42 desktop, 28 phones) with tighter
          // leading, answering the panel fault that the one surface
          // that should feel grand spoke at settings heading size.
          // Same words, same serif, same place in the arrangement;
          // phones keep the way in inside the first screenful.
          margin: 0, maxWidth: 780, textAlign: "left",
          fontFamily: "var(--cb-serif)",
          fontSize: isMobile ? 28 : 42, fontWeight: 400, lineHeight: 1.22,
          color: ink,
        }}>
          Ask a question and get an answer from the research papers, with the sources attached.
        </p>

        {/* The single way in: the app's primary button, the flat
            accent fill with its contrast ink. Nothing else on the
            door competes with it. */}
        <div className="cb-door-stage-3">
          <button type="button" onClick={() => go("", false)} className="cb-intro-go"
            autoFocus={enteredBefore || undefined}
            onMouseEnter={() => setDoorHover(true)}
            onMouseLeave={() => setDoorHover(false)}
            style={{
            marginTop: isMobile ? 28 : 32, cursor: "pointer",
            textTransform: "none", whiteSpace: "nowrap", letterSpacing: "normal",
            background: doorHover
              ? "color-mix(in srgb, " + introAccent + " 86%, #ffffff)"
              : introAccent,
            color: accentText(introAccent),
            border: "1px solid transparent", borderRadius: RADIUS.md,
            boxShadow: "none",
            padding: isMobile ? "14px 34px" : "14px 44px", minHeight: 48,
            width: isMobile ? "100%" : undefined,
            fontSize: FONT_SIZES.body, fontWeight: 500, fontFamily: "var(--cb-font)",
            transition: "background-color 150ms ease-out, transform 200ms var(--cb-ease)",
          }}>Start researching</button>
        </div>
        {/* Nova, quiet: her figure once and one short line in her dry
            voice. No section, no box, no wordmark. In the reimagined
            frame she closes the title block, her line the last voice
            before the evidence strip at the foot, and lifting her
            out touches nothing else on the door. */}
        <div className="cb-door-stage-4" style={{
          marginTop: isMobile ? 24 : 28, display: "flex", alignItems: "center",
          gap: isMobile ? 12 : 14, maxWidth: 520,
        }}>
          <span aria-hidden="true" style={{ display: "block", flex: "0 0 auto" }}>
            <NovaRive size={isMobile ? 64 : 76} framing="full" bubbleVariant={null} quips={false}
              reducedMotion={reduced || animationMode === "off"} />
          </span>
          <p style={{
            margin: 0, textAlign: "left",
            fontFamily: "var(--cb-serif)", fontSize: isMobile ? 15 : 16, fontWeight: 400,
            lineHeight: 1.5, color: ink2,
          }}>
            Good specimens, these. The lab is open when you are ready.
          </p>
        </div>

      </div>
      </main>

      {/* ── The caption strip (2026-10-28, the reimagined door): the
          specimen stands at the foot of the frame the way captions
          stand in a film, on a full width band of the door's own
          solid ground, a hard cut from the film above it. No card,
          no plate, no border box, no radius: the claim in the
          reading serif, the citation with the paper one tap away,
          and the honest proof line, three quiet lines of type on
          solid black. The ground is fully opaque, so the standing
          rule for text carrying surfaces holds without furniture.
          The change is a soft rise with a fade (cb-door-spec-in),
          a page turning, never a scene change; hover and focus
          hold the rotation. The claim zone holds a reserved height
          sized to the longest specimen, so the strip never changes
          height when the rotation turns and the film area above it
          never moves. */}
      <div
        ref={specimenWrapRef}
        className="cb-door-strip cb-door-stage-5"
        onMouseEnter={() => setSpecimenHeld(true)}
        onMouseLeave={() => setSpecimenHeld(false)}
        onFocus={() => setSpecimenHeld(true)}
        onBlur={() => setSpecimenHeld(false)}
        style={{
          position: "relative", zIndex: 20,
          background: "#05070a",
          borderTop: "1px solid " + hairline,
        }}
      >
        <div
          key={specimenIdx}
          className={animate ? "cb-door-spec-in" : undefined}
          style={{
            maxWidth: LAYOUT.stage, margin: "0 auto",
            padding: isMobile ? "20px 20px 6px" : "22px 24px 8px",
            textAlign: "left",
          }}
        >
          <p style={{
            fontFamily: "var(--cb-serif)",
            fontSize: FONT_SIZES.section,
            fontWeight: 400, lineHeight: 1.55,
            color: ink, margin: 0, textAlign: "left",
            minHeight: isMobile ? 124 : 62,
          }}>
            &ldquo;{spec.claim}&rdquo;
          </p>
          <p style={{
            margin: "14px 0 0",
            fontSize: FONT_SIZES.label, lineHeight: 1.6,
            color: ink2, textAlign: "left",
          }}>
            {spec.paper}{" "}
            <a href={spec.doi} target="_blank" rel="noopener noreferrer"
              style={{
                color: introAccent, fontWeight: 500,
                textDecoration: "none", whiteSpace: "nowrap",
                borderBottom: "1px solid " + accentA(0.4),
                display: "inline-block", padding: "14px 4px", margin: "-14px -4px",
              }}>
              Open the paper &#8599;
            </a>
          </p>
          {/* The honest proof, once, as the strip's last line: the
              claim traces to the real paper linked on it, and the
              index count is the product's real source list, the
              same SCHOLARLY_SOURCES the workspace searches. The
              line opens the Research sources dialog, so the count
              can be checked against the list. */}
          <div style={{ textAlign: "left", marginTop: 6 }}>
            <button type="button" onClick={() => setSourcesOpen(true)} aria-label="Research sources"
              style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                background: "none", border: "none", cursor: "pointer",
                padding: "12px 8px", minHeight: 48,
                fontFamily: "var(--cb-font)", fontSize: FONT_SIZES.caption, fontWeight: 400,
                lineHeight: 1.5, color: faint,
              }}>
              <span aria-hidden="true" style={{
                width: 7, height: 7, flex: "0 0 auto",
                background: introAccent,
              }} />
              <span>Traced to a real paper · Searched across {SCHOLARLY_SOURCES.length} scholarly indexes</span>
            </button>
          </div>
        </div>
      </div>

      {/* The scroll cue and the footer line retired 2026-10-28
          with the reimagined door: the caption strip is the foot
          of the frame and sits inside the first screenful on the
          phone range the cue served, and the frame carries no
          footer row under its captions. */}

      {/* The door opening (2026-10-28): mounted only on the animated
          way in, purely visual, pointer events off. Entry fires on
          the leave timer in go() whatever this overlay does, and
          the no motion paths never mount it. */}
      {leaving && animate && (
        <div aria-hidden="true" className="cb-door-split" style={cinema ? { position: "absolute" } : undefined}>
          <div className="cb-split-light" />
          <div className="cb-split-half cb-split-l" />
          <div className="cb-split-half cb-split-r" />
        </div>
      )}

      {sourcesOpen && <SourcesDialog P={P} accent={introAccent} onClose={() => setSourcesOpen(false)} />}

    </div>
  );

  if (!cinema) return doorRoot;
  /* The cinema frame: a fixed recordable box on a black stage. The
     door inside it is the live door, laid out in the frame (the
     portrait frame takes the phone arrangement), its film and grain
     bound to the frame instead of the viewport. What the frame
     holds after the entrance is the held end frame: film still
     turning, the Van Dongen card held, nothing rotating, ready to
     loop or to cut into the app on the way in. */
  return (
    <div style={{
      position: "fixed", inset: 0, background: "#000",
      display: "flex", alignItems: "center", justifyContent: "center",
      overflow: "hidden",
    }}>
      <div style={{
        position: "relative", overflow: "hidden", background: "#05070a", flex: "0 0 auto",
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
  FILM_CLIPS_INTRO,
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
  SPECIMENS,
  Intro,
  CerebrumFieldCanvas,
};
