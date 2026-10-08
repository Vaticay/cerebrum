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
  FONT_SIZES, STATUS, accentText, relLuminance, withAlpha, Icon,
  TYPE, SP, SHADOW, UIButton, UICard, RADIUS, Z, TRACKING, TickFrame,
} from "./designSystem.jsx";
import {
  setCookie, getCookie, APP_VERSION_LABEL, useIsMobile,
} from "./appUtils.js";
import { safeHref } from "./textUtils.js";
import { staticFieldCss } from "./cerebrumField.js";
import { SCHOLARLY_SOURCES } from "../functions/lib/product.js";
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

/* Pro reel (2026-09-15) — the members' backdrop. Ten landscape and two
   portrait clips moved OUT of the free lists above, so they play only for
   Pro members. These are the strongest frames in the set — aurora, nebula,
   eclipse, DNA, lightning — which is exactly why they're the perk, not the
   default. The reel switches automatically from user.isPro (2026-10-07);
   there is no manual toggle. Attribution for every clip still lives in
   FILM_CREDITS below; moving a clip between lists does not move its credit
   row. */
const FILM_CLIPS_PRO_LANDSCAPE = [
  videoUrl("/assets/cinematic/science-12.mp4"), // Jellyfish — Chris Munnik
  videoUrl("/assets/cinematic/science-35.mp4"), // Northern lights timelapse — T Honkamies
  videoUrl("/assets/cinematic/science-37.mp4"), // Nebula field with stars — Adis Resic
  videoUrl("/assets/cinematic/science-40.mp4"), // Glowing blue DNA strand — Pressmaster
  videoUrl("/assets/cinematic/science-41.mp4"), // Sun illuminating Earth's surface — Ingrid
  videoUrl("/assets/cinematic/science-44.mp4"), // Milky Way over mountain lake — Dmitry Varennikov
  videoUrl("/assets/cinematic/science-64.mp4"), // Aurora borealis, red and green (replaces 46)
  videoUrl("/assets/cinematic/science-50.mp4"), // Orange lunar eclipse — Kindel Media
  videoUrl("/assets/cinematic/science-54.mp4"), // Grayscale cloud timelapse — CESAR A RAMIREZ VALLEJO TRAPHITHO
  videoUrl("/assets/cinematic/science-67.mp4"), // Lava flow aerial at night (replaces 55)
];
const FILM_CLIPS_PRO_PORTRAIT = [
  videoUrl("/assets/cinematic/science-57.mp4"), // Moon behind clouds — ren lavsad
  videoUrl("/assets/cinematic/science-58.mp4"), // Ice cave — Nadezhda Moryak
];

/* What the component actually reads. Landscape is the fallback when the
   orientation cannot be determined, because a landscape clip cropped on a
   phone still looks like footage; the reverse does not. `pro` selects the
   members-only reel (see FILM_CLIPS_PRO_* above) — offered only to Pro
   members, never to anyone else. */
function filmReel(pro) {
  if (typeof window === "undefined") return FILM_CLIPS_LANDSCAPE;
  const portrait = window.innerHeight > window.innerWidth;
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

const FILM_POSTER = videoUrl("/assets/cinematic/poster.webp");
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

  return (
    <Dialog
      label="Background film credits" onClose={onClose} zIndex={400} width={680}
      panelStyle={{
        background: "rgba(15, 17, 21, 0.96)",
        backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
        border: "1px solid rgba(255,255,255,0.10)", borderRadius: 12,
        boxShadow: "0 40px 100px rgba(0,0,0,0.6)",
        padding: "26px 26px 22px", color: "#f2f4f2", fontFamily: "var(--cb-font)",
      }}
    >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontSize: 19, fontWeight: 600, letterSpacing: TYPE.heading.letterSpacing, flex: 1 }}>
            Background film credits
          </h2>
          <button onClick={onClose} aria-label="Close credits" style={{
            border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)",
            color: "rgba(242,244,242,0.72)", cursor: "pointer", borderRadius: 9999,
            padding: "16px 16px", fontSize: 13, fontFamily: "var(--cb-font)",
          }}>Close</button>
        </div>

        <p style={{ margin: "0 0 18px", fontSize: 13, lineHeight: 1.6, color: "rgba(242,244,242,0.62)" }}>
          {FILM_MODIFICATIONS}
        </p>

        <div style={{ display: "flex", flexDirection: "column" }}>
          {FILM_CREDITS.map((c) => (
            <div key={c.n} style={{
              display: "grid", gridTemplateColumns: "26px 1fr", gap: 12,
              padding: "11px 0", borderTop: "1px solid rgba(255,255,255,0.07)",
            }}>
              <span style={{
                fontFamily: "var(--cb-font)", fontSize: FONT_SIZES.caption, color: withAlpha(accent, 0.9),
                paddingTop: 2, fontVariantNumeric: "tabular-nums",
              }}>{c.n}</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.4, marginBottom: 3 }}>{c.title}</div>
                <div style={{ fontSize: 12, color: "rgba(242,244,242,0.62)", lineHeight: 1.55 }}>
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

        <p style={{ margin: "18px 0 0", fontSize: 12, lineHeight: 1.6, color: "rgba(242,244,242,0.46)" }}>
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
      [videoUrl("/assets/cinematic/science-03.mp4")]: { subject: "Plant science", question: "How does a seedling know which way is up?", pos: "58% 55%", posMobile: "50% 62%" },
  [videoUrl("/assets/cinematic/science-04.mp4")]: { subject: "Plant science", question: "How efficient is photosynthesis compared with a solar panel?" },
  [videoUrl("/assets/cinematic/science-07.mp4")]: { subject: "Chemistry", question: "What makes a chemical reaction speed up or stall?", pos: "50% 42%" },
  [videoUrl("/assets/cinematic/science-08.mp4")]: { subject: "Fluid dynamics", question: "Why does a drop of dye spread through water the way it does?", pos: "50% 45%" },
  [videoUrl("/assets/cinematic/science-09.mp4")]: { subject: "Volcanology", question: "What decides whether an eruption flows or explodes?" },
  [videoUrl("/assets/cinematic/science-10.mp4")]: { subject: "Volcanology", question: "How far does volcanic ash travel, and what does it do to the atmosphere?" },
  [videoUrl("/assets/cinematic/science-11.mp4")]: { subject: "Glaciology", question: "How fast is the Greenland ice sheet losing mass?" },
  [videoUrl("/assets/cinematic/science-12.mp4")]: { subject: "Marine biology", question: "How do jellyfish move without a brain?" },
  [videoUrl("/assets/cinematic/science-13.mp4")]: { subject: "Marine biology", question: "What makes coral bleach, and can it recover?", pos: "50% 45%" },
    [videoUrl("/assets/cinematic/science-15.mp4")]: { subject: "Research methods", question: "How do labs tell a real result from a fluke?" },
  [videoUrl("/assets/cinematic/science-16.mp4")]: { subject: "Physics", question: "What is plasma, and where does it occur naturally?" },
  [videoUrl("/assets/cinematic/science-20.mp4")]: { subject: "Earth observation", question: "What does artificial light at night do to ecosystems?" },
  [videoUrl("/assets/cinematic/science-21.mp4")]: { subject: "Mycology", question: "How do fungi move nutrients through a forest?" },
  [videoUrl("/assets/cinematic/science-22.mp4")]: { subject: "Plant science", question: "Why does water bead up on some leaves and not others?" },
  [videoUrl("/assets/cinematic/science-24.mp4")]: { subject: "Marine biology", question: "What lives on a coral reef besides the coral?" },
  [videoUrl("/assets/cinematic/science-25.mp4")]: { subject: "Geothermal science", question: "What makes a geyser erupt on a schedule?" },
      [videoUrl("/assets/cinematic/science-27.mp4")]: { subject: "Hydrology", question: "How does flowing water reshape the rock beneath it?" },
  [videoUrl("/assets/cinematic/science-28.mp4")]: { subject: "Entomology", question: "How do pollinators find the flowers they visit?" },
  [videoUrl("/assets/cinematic/science-29.mp4")]: { subject: "Entomology", question: "How does an ant colony make decisions without a leader?" },
    [videoUrl("/assets/cinematic/science-31.mp4")]: { subject: "Oceanography", question: "How do waves carry energy across an entire ocean?" },
    [videoUrl("/assets/cinematic/science-33.mp4")]: { subject: "Volcanology", question: "How hot is lava, and how is that measured safely?" },
  [videoUrl("/assets/cinematic/science-34.mp4")]: { subject: "Physics", question: "How does a magnetic field sculpt a liquid into spikes?" },
  [videoUrl("/assets/cinematic/science-35.mp4")]: { subject: "Atmospheric science", question: "What paints the aurora's curtains of light across the sky?" },
  [videoUrl("/assets/cinematic/science-36.mp4")]: { subject: "Thermodynamics", question: "What decides the exact moment water becomes ice?" },
  [videoUrl("/assets/cinematic/science-37.mp4")]: { subject: "Astronomy", question: "What is a nebula made of, and how are stars born inside one?" },
  [videoUrl("/assets/cinematic/science-38.mp4")]: { subject: "Entomology", question: "How do ants coordinate without a leader or words?" },
  [videoUrl("/assets/cinematic/science-59.mp4")]: { subject: "Plant science", question: "How does a seedling know which way is up?", pos: "50% 55%" },
  [videoUrl("/assets/cinematic/science-60.mp4")]: { subject: "Zoology", question: "How do grazing animals shape a grassland?", pos: "50% 45%" },
  [videoUrl("/assets/cinematic/science-61.mp4")]: { subject: "Geology", question: "What sculpted these desert mesas?", pos: "50% 40%" },
  [videoUrl("/assets/cinematic/science-62.mp4")]: { subject: "Oceanography", question: "How do waves carry energy across an ocean?", pos: "50% 50%" },
  [videoUrl("/assets/cinematic/science-63.mp4")]: { subject: "Volcanology", question: "What decides whether an eruption flows or explodes?", pos: "50% 45%" },
  [videoUrl("/assets/cinematic/science-64.mp4")]: { subject: "Atmospheric science", question: "What paints the aurora\u2019s curtains of light across the sky?", pos: "50% 40%" },
  [videoUrl("/assets/cinematic/science-65.mp4")]: { subject: "Earth science", question: "How does elevation reshape climate, light, and life?", pos: "50% 45%" },
  [videoUrl("/assets/cinematic/science-66.mp4")]: { subject: "Volcanology", question: "How does a lake form inside a volcano\u2019s crater?", pos: "50% 50%" },
  [videoUrl("/assets/cinematic/science-67.mp4")]: { subject: "Volcanology", question: "What drives lava fountains hundreds of meters into the air?", pos: "50% 50%" },
  [videoUrl("/assets/cinematic/science-39.mp4")]: { subject: "Genetics", question: "How does DNA store the instructions for a cell?" },
  [videoUrl("/assets/cinematic/science-40.mp4")]: { subject: "Genetics", question: "What does DNA look like at the molecular scale?" },
  [videoUrl("/assets/cinematic/science-41.mp4")]: { subject: "Earth observation", question: "What does artificial light at night do to ecosystems?" },
  [videoUrl("/assets/cinematic/science-42.mp4")]: { subject: "Planetary science", question: "How does Earth\u2019s rotation shape its climate?" },
  [videoUrl("/assets/cinematic/science-43.mp4")]: { subject: "Astronomy", question: "How many stars are in the Milky Way?" },
  [videoUrl("/assets/cinematic/science-44.mp4")]: { subject: "Astronomy", question: "Why do some mountain lakes mirror the night sky?" },
  [videoUrl("/assets/cinematic/science-45.mp4")]: { subject: "Astronomy", question: "How dark does the sky get far from city lights?" },
  [videoUrl("/assets/cinematic/science-48.mp4")]: { subject: "Atmospheric science", question: "What triggers a lightning strike?" },
  [videoUrl("/assets/cinematic/science-50.mp4")]: { subject: "Astronomy", question: "Why does the Moon look bigger near the horizon?" },
  [videoUrl("/assets/cinematic/science-51.mp4")]: { subject: "Astronomy", question: "What turns the Moon red during a lunar eclipse?" },
  [videoUrl("/assets/cinematic/science-52.mp4")]: { subject: "Astronomy", question: "What is happening during a partial lunar eclipse?" },
  [videoUrl("/assets/cinematic/science-53.mp4")]: { subject: "Marine biology", question: "How do sharks sense prey they cannot see?" },
  [videoUrl("/assets/cinematic/science-54.mp4")]: { subject: "Atmospheric science", question: "How do storm clouds build into thunderheads?" },
  [videoUrl("/assets/cinematic/science-56.mp4")]: { subject: "Fluid dynamics", question: "Why does ink bloom into smoke-like tendrils in water?" },
  [videoUrl("/assets/cinematic/science-57.mp4")]: { subject: "Astronomy", question: "Why does the Moon glow through thin cloud?" },
  [videoUrl("/assets/cinematic/science-58.mp4")]: { subject: "Glaciology", question: "How do ice caves form inside glaciers?" },
};

/* The poster is a frame of this clip, so when the reel is blocked and the
   still is all anyone sees, the prompt on screen is the prompt for the
   picture on screen. Checked against the file, not assumed. */
const FILM_POSTER_CLIP = videoUrl("/assets/cinematic/science-61.mp4");

/* RESTORED 2026-09-17: Document Mode's film — the door's opening clip, so
   stepping from the intro into a document keeps the same frame. The scrim
   does the legibility work; the clip just has to be calm. */
const DOC_FILM_SRC = videoUrl("/assets/cinematic/science-66.mp4");

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

function IntroModal({ label, title, onClose, accent, children, width = 620 }) {
  return (
    <Dialog label={label} onClose={onClose} zIndex={400} width={width}
      panelStyle={{
        background: "rgba(15, 17, 21, 0.96)",
        border: "1px solid rgba(255,255,255,0.10)", borderRadius: RADIUS.xl,
        boxShadow: "0 40px 100px rgba(0,0,0,0.6)",
        padding: "22px 22px 24px", color: "#f2f4f2", fontFamily: "var(--cb-font)",
      }}
    >
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 19, fontWeight: 600, letterSpacing: TYPE.heading.letterSpacing, flex: 1, lineHeight: 1.25 }}>{title}</h2>
          <button onClick={onClose} aria-label={"Close " + label} style={{ minHeight: 44,
            border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)",
            color: "rgba(242,244,242,0.78)", cursor: "pointer", borderRadius: 9999,
            padding: "7px 15px", fontSize: 13, fontFamily: "var(--cb-font)", flexShrink: 0,
          }}>Close</button>
        </div>
        {children}
    </Dialog>
  );
}

function HowItWorksDialog({ onClose, accent }) {
  const steps = [
    { n: "1", h: "Ask in plain language",
      b: "A question the way you would ask a colleague. No boolean operators, no field codes, no learning a query syntax first." },
    { n: "2", h: "Cerebrum searches the literature",
      b: "The question is run against " + SCHOLARLY_SOURCES.length + " scholarly sources: Europe PMC, PubMed, OpenAlex, Crossref, arXiv and the rest. The results are deduplicated across them." },
    { n: "3", h: "Every claim carries its source",
      b: "The answer is written from those papers, and each statement is numbered to the paper it came from. Open a citation to see the passage it rests on." },
  ];
  return (
    <IntroModal label="how Cerebrum works" title="How Cerebrum works" onClose={onClose} accent={accent}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {steps.map((st) => (
          <div key={st.n} style={{
            display: "grid", gridTemplateColumns: "26px 1fr", gap: 14,
            padding: "16px 0", borderTop: "1px solid rgba(255,255,255,0.07)",
          }}>
            <span style={{
              fontFamily: "var(--cb-font)", fontSize: 12, color: withAlpha(accent, 0.9),
              paddingTop: 2, fontVariantNumeric: "tabular-nums",
            }}>{st.n}</span>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.35, marginBottom: 5 }}>{st.h}</div>
              <div style={{ fontSize: 14, color: "rgba(242,244,242,0.68)", lineHeight: 1.6 }}>{st.b}</div>
            </div>
          </div>
        ))}
      </div>

    </IntroModal>
  );
}

function SourcesDialog({ onClose, accent }) {
  const GROUPS = [
    ["biomedical", "Biomedical"],
    ["multi", "Multidisciplinary"],
    ["open-access", "Open access"],
    ["preprint", "Preprints"],
    ["aggregator", "Aggregators"],
    ["repository", "Repositories"],
  ];
  const PEER = { yes: "Peer-reviewed", mostly: "Mostly peer-reviewed", mixed: "Mixed", no: "Not peer-reviewed" };
  return (
    <IntroModal label="research sources" title="Research sources" onClose={onClose} accent={accent}>
      <p style={{ margin: "0 0 16px", fontSize: 14, lineHeight: 1.65, color: "rgba(242,244,242,0.68)" }}>
        Cerebrum queries these {SCHOLARLY_SOURCES.length} sources and merges the results, removing the
        same paper when it appears in more than one. Preprints are included and are labelled as
        preprints — they have not been peer-reviewed.
      </p>
      {GROUPS.map(([key, heading]) => {
        const rows = SCHOLARLY_SOURCES.filter((x) => x.category === key);
        if (!rows.length) return null;
        return (
          <div key={key} style={{ paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.07)", marginBottom: 4 }}>
            <div style={{
              /* Pass 3 (2026-09-17): mono label, not a tracked-out eyebrow. */
              fontFamily: "var(--cb-mono)", fontSize: FONT_SIZES.caption,
              color: "rgba(242,244,242,0.44)", marginBottom: 9,
            }}>{heading}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 14 }}>
              {rows.map((r) => (
                <div key={r.id} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  gap: 14, flexWrap: "wrap",
                }}>
                  <span style={{ fontSize: 15, color: "#f2f4f2" }}>{r.name}</span>
                  <span style={{ fontSize: 12, color: "rgba(242,244,242,0.5)" }}>{PEER[r.peerReviewed] || ""}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </IntroModal>
  );
}

function playEnterThoom() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    if (ctx.state === "suspended") ctx.resume();
    const t = ctx.currentTime;
    // Low boom
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.9);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t); osc.stop(t + 1.3);
    // Airy shimmer
    const len = Math.floor(ctx.sampleRate * 0.6);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const noise = ctx.createBufferSource(); noise.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 2400; bp.Q.value = 0.8;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.08, t + 0.05);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    noise.connect(bp).connect(ng).connect(ctx.destination);
    noise.start(t);
    setTimeout(() => { try { ctx.close(); } catch (e) { console.error("[Cerebrum] CerebrumApp.jsx: ctx.close(); }:", e); } }, 2000);
  } catch (e) { /* audio is enhancement, never a blocker */ }
}

const SPECIMENS = [
  {
    claim: "Two weeks of six-hour nights impairs your thinking as much as two nights with no sleep at all.",
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
];

/* ════════════════════════════════════════════════════════════════════
   Intro — the calibration chamber (redesigned 2026-10-08).

   Dusty's verdict on the cinematic door: "looks the same and not good,"
   and the background film is "too distracting." So the film is gone from
   this screen entirely — no reel, no scrim, no motion behind the type.
   What remains is a still precision instrument: a calibration grid bed,
   corner ticks framing the viewport, a depth rail marking the descent
   motif, mono readouts as the machine voice, and one specimen slide
   under glass.

   What survived the redesign, and why:
   - SPECIMENS (real verified claims): the product demonstrating itself
     instead of describing itself. The concept was right; the execution
     (museum label floating on movie footage) was the problem.
   - 9s rotation with hold/dialog/reduced-motion pauses: calm, tested.
   - "Traced to a direct finding" + "Start researching": locked copy.
   - The door rule: no composer here, one way in, ceremonial.
   - playEnterThoom: the entry cue. A door should sound like a door.
   ════════════════════════════════════════════════════════════════════ */
function Intro({ accent, P, onEnter, animationMode = "off", user = null }) {
  const isMobile = useIsMobile();
  const reduced = useReducedMotion();
  const [howOpen, setHowOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  /* Stepping through: the whole chamber descends 6vh and fades (CSS,
     420ms) — the Dive motif in reverse, sinking into the workspace.
     The no-motion path is untouched: animation off or reduced motion
     goes straight through. A second press while leaving is ignored. */
  const [leaving, setLeaving] = useState(false);
  const leaveTimer = useRef(null);
  useEffect(() => () => clearTimeout(leaveTimer.current), []);

  /* The intro uses Cerebrum's sage, not the visitor's chosen accent.
     The front door is the brand, and it is the same for everyone. */
  const introAccent = (accent && relLuminance(accent) >= 0.15 && relLuminance(accent) <= 0.82)
    ? accent
    : "#A3B899";

  /* Specimen rotation: advance every 9s, paused while a dialog is open,
     while the visitor holds the specimen, or under reduced motion.
     Numbered tabs select directly. */
  const [specimenIdx, setSpecimenIdx] = useState(0);
  const [specimenHeld, setSpecimenHeld] = useState(false);
  const specimenCount = SPECIMENS.length;
  useEffect(() => {
    if (reduced || animationMode === "off") return undefined;
    if (specimenHeld || howOpen || sourcesOpen) return undefined;
    const t = setInterval(() => setSpecimenIdx((i) => (i + 1) % specimenCount), 9000);
    return () => clearInterval(t);
  }, [reduced, animationMode, specimenHeld, howOpen, sourcesOpen, specimenCount]);
  const specimen = SPECIMENS[specimenIdx];

  /* ── The door rule ──
     This screen is a threshold, not a search screen: there is no composer
     here, deliberately. The way through is "Start researching" — the
     workspace opens with its cursor in the real composer. */

  const go = (q, submit) => {
    const payload = typeof q === "string" ? q : "";
    if (leaving) return;
    // The boom: synthesized thoom on the user's gesture
    playEnterThoom();
    if (animationMode === "off" || reduced) { onEnter(payload, !!submit, null); return; }
    setLeaving(true);
    clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => onEnter(payload, !!submit, null), 420);
  };

  const animate = animationMode !== "off" && !reduced;
  const mono = "var(--cb-mono)";
  const serif = "var(--cb-serif)";
  const ink = "#eef1ee";
  const faint = "rgba(238,241,238,0.52)";
  const hairline = "rgba(255,255,255,0.08)";

  const readout = {
    fontFamily: mono, fontSize: 11, letterSpacing: "0.18em",
    color: faint, fontWeight: 500, whiteSpace: "nowrap",
    fontVariantNumeric: "tabular-nums",
  };
  const navLink = {
    fontFamily: mono, fontSize: 11, letterSpacing: "0.18em",
    color: "rgba(238,241,238,0.72)", textDecoration: "none",
    fontWeight: 500, padding: "10px 6px", whiteSpace: "nowrap",
  };

  const cls = ["cb-intro-chrome"];
  const wrapCls = [leaving ? "cb-intro-leaving" : "", reduced && !leaving ? "cb-intro-still" : ""]
    .filter(Boolean).join(" ") || undefined;

  return (
    <div id="cb-intro-wrap" className={wrapCls} style={{
      minHeight: "100dvh", position: "relative", overflowX: "clip",
      display: "flex", flexDirection: "column",
      fontFamily: "var(--cb-font)", background: "#05070a", color: ink,
    }}>
      {/* The instrument bed: static calibration grid on near-black, held
          by a vignette. No footage, no motion — still and precise. */}
      <div aria-hidden="true" className="cb-instr-bed" />
      {/* Grain without the jitter: texture, not weather. */}
      <div aria-hidden="true" className="cb-intro-grain" style={{ animation: "none" }} />
      {/* Corner ticks frame the viewport itself: the whole screen is the
          instrument, not just the panel. */}
      <TickFrame P={P} tickColor={withAlpha(introAccent, 0.55)} border={false}
        className="cb-instr-viewport" aria-hidden="true" />

      {/* Depth rail: the descent motif as a static scale. The door sits at
          the surface (000M); the workspace is the descent. */}
      {!isMobile && (
        <div aria-hidden="true" className="cb-depth-rail">
          <div className="cb-depth-mark cb-depth-here"><span>000M</span><i /></div>
          <div className="cb-depth-mark"><span>200M</span><i /></div>
          <div className="cb-depth-mark"><span>400M</span><i /></div>
          <div className="cb-depth-mark"><span>600M</span><i /></div>
          <div className="cb-depth-mark"><span>800M</span><i /></div>
          <div className="cb-depth-surface">SURFACE</div>
        </div>
      )}

      {/* ── Instrument header ──
          Readouts, not navigation chrome. The machine voice is mono. */}
      <header className={animate ? "cb-intro-chrome cb-focus-in" : "cb-intro-chrome"} style={{
        position: "relative", zIndex: 30,
        borderBottom: "1px solid " + hairline,
        background: "rgba(5,7,10,0.72)",
        ...(animate ? { animationDelay: "0.15s" } : null),
      }}>
        <div style={{
          maxWidth: 1440, margin: "0 auto", padding: "13px 26px",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <Mark size={19} accent={introAccent} glow />
            <span style={{
              fontFamily: mono, fontSize: 13, fontWeight: 600,
              letterSpacing: "0.34em", textIndent: "0.06em", color: "#ffffff",
            }}>CEREBRUM</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 10 : 22 }}>
            <span style={readout}>SPEC {String(specimenIdx + 1).padStart(2, "0")}/03</span>
            {!isMobile && <span style={readout}>15 SOURCES</span>}
            <span style={{ ...readout, color: withAlpha(introAccent, 0.9) }}>CAL · VERIFIED</span>
            {!isMobile && ["About", "Privacy", "Contact"].map((item) => (
              <a key={item} href={"/" + item.toLowerCase()} className="cb-intro-navlink" style={navLink}>{item}</a>
            ))}
            {isMobile && (
              <button type="button" onClick={() => setNavOpen((v) => !v)}
                aria-expanded={navOpen} aria-controls="cb-intro-navmenu"
                style={{ ...navLink, background: "none", border: "1px solid " + hairline, borderRadius: 3, cursor: "pointer" }}>
                MORE
              </button>
            )}
          </div>
        </div>
        {isMobile && navOpen && (
          <div id="cb-intro-navmenu" style={{
            maxWidth: 1440, margin: "0 auto", padding: "0 26px 14px",
            display: "flex", gap: 4, flexWrap: "wrap",
          }}>
            {["About", "Privacy", "Contact"].map((item) => (
              <a key={item} href={"/" + item.toLowerCase()} style={{ ...navLink, border: "1px solid " + hairline, borderRadius: 3 }}>{item}</a>
            ))}
          </div>
        )}
      </header>

      {/* ── The specimen slide ──
          One verified claim under glass: the product at specimen scale,
          framed by instrument ticks. */}
      <main className="cb-intro-chrome" style={{
        position: "relative", zIndex: 20, flex: 1,
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        padding: isMobile ? "40px 20px 36px" : "56px 26px 48px",
        textAlign: "center",
      }}>
        <TickFrame P={P} accent={introAccent}
          className={animate ? "cb-focus-in" : undefined}
          style={{
            width: "100%", maxWidth: 920,
            padding: isMobile ? "38px 26px 34px" : "60px 72px 52px",
            background: "rgba(8,11,14,0.82)",
            ...(animate ? { animationDelay: "0.35s" } : null),
          }}>
          <div
            onMouseEnter={() => setSpecimenHeld(true)}
            onMouseLeave={() => setSpecimenHeld(false)}
            onFocus={() => setSpecimenHeld(true)}
            onBlur={() => setSpecimenHeld(false)}
            style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}
          >
            <div style={{
              fontFamily: mono, fontSize: 11, letterSpacing: "0.42em",
              textIndent: "0.42em", fontWeight: 600,
              textTransform: "uppercase", color: faint,
              fontVariantNumeric: "tabular-nums",
            }}>
              Specimen {String(specimenIdx + 1).padStart(2, "0")} · Verified claim
            </div>
            <div key={specimenIdx} className={animate ? "cb-specimen-in" : undefined} style={{
              display: "flex", flexDirection: "column", alignItems: "center", width: "100%",
            }}>
              <p style={{
                fontFamily: serif,
                fontSize: isMobile ? "clamp(26px, 7vw, 34px)" : "clamp(32px, 4.2vw, 54px)",
                fontWeight: 560, letterSpacing: "-0.01em", lineHeight: 1.24,
                color: "#ffffff", margin: "30px auto 0", maxWidth: "22ch",
                textAlign: "center", textWrap: "balance",
              }}>
                &ldquo;{specimen.claim}&rdquo;
              </p>
              <div style={{
                marginTop: 28, display: "flex", alignItems: "center", justifyContent: "center", gap: 11,
              }}>
                <span style={{
                  color: introAccent, display: "inline-flex", lineHeight: 0,
                  filter: "drop-shadow(0 0 9px " + withAlpha(introAccent, 0.55) + ")",
                }}>
                  <Icon name="verdictSupported" size={19} />
                </span>
                <span style={{
                  fontFamily: mono, fontSize: 12, fontWeight: 600,
                  letterSpacing: "0.26em", textIndent: "0.26em",
                  textTransform: "uppercase", color: introAccent,
                }}>
                  Traced to a direct finding
                </span>
              </div>
              <p style={{
                margin: "20px auto 0", maxWidth: "62ch",
                fontSize: isMobile ? 13.5 : 14.5, lineHeight: 1.7,
                color: "rgba(238,241,238,0.66)",
              }}>
                {specimen.paper}{" "}
                <a href={specimen.doi} target="_blank" rel="noopener noreferrer"
                  style={{ color: introAccent, fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}>
                  Open the paper &#8599;
                </a>
              </p>
            </div>
            {/* Specimen selector: numbered instrument tabs, not dots. */}
            <div role="tablist" aria-label="Verified claims" style={{
              marginTop: 32, display: "flex", alignItems: "center", gap: 8,
            }}>
              {SPECIMENS.map((sp, i) => {
                const activeTab = i === specimenIdx;
                return (
                  <button key={i} type="button" role="tab" aria-selected={activeTab}
                    aria-label={"Claim " + (i + 1) + ": " + sp.claim.slice(0, 60) + "\u2026"}
                    onClick={() => setSpecimenIdx(i)}
                    style={{
                      minWidth: 44, minHeight: 44, padding: "0 12px", cursor: "pointer",
                      fontFamily: mono, fontSize: 12, fontWeight: 600, letterSpacing: "0.1em",
                      color: activeTab ? introAccent : "rgba(238,241,238,0.38)",
                      background: activeTab ? withAlpha(introAccent, 0.08) : "transparent",
                      border: "1px solid " + (activeTab ? withAlpha(introAccent, 0.55) : "rgba(255,255,255,0.12)"),
                      borderRadius: 3,
                    }}>
                    {String(i + 1).padStart(2, "0")}
                  </button>
                );
              })}
            </div>
          </div>
        </TickFrame>

        {/* The single way in. */}
        <div className={animate ? cls.concat("cb-focus-in").join(" ") : cls.join(" ")}
          style={animate ? { animationDelay: "0.9s" } : undefined}>
          <button type="button" onClick={() => go("", false)} className="cb-intro-go" style={{
            marginTop: 42, cursor: "pointer", color: "#f2f4f2",
            padding: isMobile ? "15px 34px" : "16px 52px",
            fontSize: 12.5, fontWeight: 600, fontFamily: "var(--cb-font)",
            letterSpacing: "0.24em", textIndent: "0.24em",
            textTransform: "uppercase", whiteSpace: "nowrap",
          }}>Start researching</button>
          <div style={{ marginTop: 20 }}>
            <button type="button" onClick={() => setHowOpen(true)} style={{
              background: "none", border: "none", cursor: "pointer",
              fontFamily: mono, fontSize: 12, letterSpacing: "0.16em",
              color: faint, textDecoration: "underline", textUnderlineOffset: 5,
              textTransform: "uppercase", padding: "10px 8px",
            }}>How it works</button>
          </div>
        </div>
      </main>

      {/* ── Readout strip ──
          The honesty content, compressed to instrument readouts. A door
          does not scroll through marketing sections. */}
      <section aria-label="How Cerebrum holds itself" className="cb-intro-chrome" style={{
        position: "relative", zIndex: 20,
        borderTop: "1px solid " + hairline,
        background: "rgba(255,255,255,0.014)",
      }}>
        <div style={{
          maxWidth: 1200, margin: "0 auto", padding: isMobile ? "22px 24px" : "26px 26px",
          display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)",
          gap: isMobile ? 16 : 28, textAlign: "left",
        }}>
          {[
            ["METHOD", "One search across 15 scholarly sources. Deduplicated, then synthesized."],
            ["EVIDENCE", "Every claim traces to a paper you can open."],
            ["TERMS", "No ads. No engagement farming. The truth is the job."],
          ].map(([k, v]) => (
            <div key={k} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{
                fontFamily: mono, fontSize: 10.5, fontWeight: 600,
                letterSpacing: "0.3em", color: withAlpha(introAccent, 0.85),
              }}>{k}</span>
              <span style={{ fontSize: 14.5, lineHeight: 1.6, color: "rgba(238,241,238,0.78)" }}>{v}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className={animate ? "cb-intro-chrome cb-focus-in" : "cb-intro-chrome"} style={{
        position: "relative", zIndex: 20,
        borderTop: "1px solid " + hairline,
        background: "rgba(5,7,10,0.85)",
        paddingBottom: "max(16px, env(safe-area-inset-bottom))",
        ...(animate ? { animationDelay: "1.2s" } : null),
      }}>
        <div style={{
          maxWidth: 1440, margin: "0 auto", padding: "16px 26px 0",
          display: "flex", alignItems: "center", flexWrap: "wrap",
          gap: "10px 22px",
          fontFamily: mono, fontSize: 10.5, letterSpacing: "0.14em",
          color: "rgba(238,241,238,0.42)",
        }}>
          <button type="button" onClick={() => setSourcesOpen(true)} style={{
            background: "none", border: "none", padding: "10px 0", cursor: "pointer",
            fontFamily: mono, fontSize: 10.5, letterSpacing: "0.14em",
            color: "rgba(238,241,238,0.66)", fontWeight: 600,
          }}>RESEARCH SOURCES &#8599;</button>
          <span style={{ flex: 1 }} />
          {["About", "Privacy", "Terms", "Disclosures", "Contact"].map((item) => (
            <a key={item} href={"/" + item.toLowerCase()} style={{
              color: "rgba(238,241,238,0.42)", textDecoration: "none", padding: "10px 0",
              textTransform: "uppercase",
            }}>{item}</a>
          ))}
          <span>© {new Date().getFullYear()} CEREBRUM · {APP_VERSION_LABEL}</span>
        </div>
      </footer>

      {sourcesOpen && <SourcesDialog accent={introAccent} onClose={() => setSourcesOpen(false)} />}
      {howOpen && <HowItWorksDialog accent={introAccent} onClose={() => setHowOpen(false)} />}

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

export const CinematicFilm = forwardRef(function CinematicFilm({ intensity = 1, animationMode = "off", paused = false, onClip, onAutoplayBlocked, onPlaybackChange, startAt = null, holdMs = FILM_HOLD_MS, proReel = false }, ref) {
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
  if (!orderRef.current || orderProRef.current !== proReel) {
    const o = filmReel(proReel).slice();
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

  /* Object-position is decided once per mount rather than per frame: the
     crop only changes when the window's aspect ratio does, and a resize
     listener writing inline styles onto a playing video is a repaint
     nobody asked for. */
  const narrow = typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(max-width: 900px)").matches : false;
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
  FILM_CLIPS_PRO_LANDSCAPE,
  FILM_CLIPS_PRO_PORTRAIT,
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
  HowItWorksDialog,
  SourcesDialog,
  playEnterThoom,
  SPECIMENS,
  Intro,
  CerebrumFieldCanvas,
};
