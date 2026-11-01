/* ── The Home B register, as shared tokens (2026-10-31) ─────
   The register the owner approved on the title card door and
   ordered carried across the whole site: a deep neutral
   ground, one broad pool of light, the editorial serif, gold
   as the only warmth, restraint in everything else. Until
   now those values lived as literals inside the surfaces
   that speak the register (the door in intro.jsx, the split
   ground in CerebrumApp.jsx, the drop's own artwork). This
   module is their shared home, so the site wide pass the
   owner ordered inherits one source instead of retyping
   values surface by surface.

   What already lived shared stays where it lives: the theme
   palettes in palettes.js, and type, radius, and spacing in
   designSystem.jsx (its TYPE.reading already names the same
   serif through var(--cb-serif)). This module carries only
   what the register adds on top of those: the ground, the
   pool, the register gold, and the drop's derived artwork
   values.

   The gold here, #c89a3a, is the drop's gold, set by the
   owner's chosen artwork (Claude's SVG, picked 2026-10-31).
   The design system carried an older identity gold, #d4a437,
   and the accent set a plan gold, #c4a35a. The full site
   audit of 2026-10-31 ruled one gold, this one, because it is
   the value the owner himself picked, most recently, on the
   artwork: the audit wave of 2026-11-01 points PRO.identity,
   COLOR.accent, and ACCENTS.Amber at REGISTER_GOLD, and the
   old values stand retired in the design system. */

/* The ground every register surface sits on. */
export const REGISTER_GROUND = "#060606";

/* The editorial serif, the same custom property the reading
   roles in designSystem.jsx already use. */
export const REGISTER_SERIF = "var(--cb-serif)";

/* Gold: the register's only warmth. One gold, ruled by the
   2026-10-31 full site audit: this value, from the artwork
   the owner picked, with its bright step and a darkened step
   for text on light grounds (the same precedent as
   PRO.actionOnLight). The design system's older identity
   gold and the accent set's plan gold now point here. */
export const REGISTER_GOLD = "#c89a3a";
export const REGISTER_GOLD_BRIGHT = "#e0bd68";
/* Darkened for text on light grounds, where the base value
   cannot hold 4.5 to 1. */
export const REGISTER_GOLD_ON_LIGHT = "#8a6618";

/* The one broad pool of light. These values are the door's
   own non WebGL fallback (introAtmosphere.jsx ATMO_FALLBACK)
   and are the register's definition of the pool for every
   surface that cannot run the shader. Neutral leaning cool,
   centred, wider than tall, fading to zero with no edge.
   The first draft of this token described a warm, off centre,
   hard edged pool that never existed on the door; the audit
   of 2026-10-31 caught it, and the tokens were rewritten to
   the door as it renders. */
export const REGISTER_POOL_CSS = [
  "radial-gradient(ellipse 80% 58% at 50% 40%, rgba(198,204,212,0.13), rgba(198,204,212,0) 66%)",
  "radial-gradient(ellipse 120% 90% at 50% 112%, rgba(64,68,74,0.16), rgba(64,68,74,0) 62%)",
  REGISTER_GROUND,
].join(", ");

/* The shader's own parameters, for any surface that mounts
   the live atmosphere rather than the CSS stand in. The
   ceiling is the calm law in one number: the door clamps
   every pixel to 0.44, which is why it never gets bright and
   why the register reads as restrained. Any surface that
   paints a fill brighter than the ceiling on the ground is
   out of register by definition. */
export const REGISTER_POOL = {
  centre: [0, 0.13],   // aspect corrected, y up
  squashY: 1.18,
  falloff: 2.05,       // glow = exp(-dot(q,q) * falloff)
  amount: [0.235, 0.105],  // base, breath
  lightRGB: [0.80, 0.82, 0.84],
  groundRGB: [0.010, 0.010, 0.011],
  ceiling: 0.44,
};

/* The door's type, as roles rather than literals (the audit
   of 2026-10-31): the name at display size, its one line
   under it, and the single text affordance. A surface that
   speaks the register takes its sizes from here instead of
   inventing its own. */
export const REGISTER_SERIF_SCALE = {
  display: { fontSize: 104, mobileFontSize: 57, fontWeight: 500, letterSpacing: "0.008em", lineHeight: 1.04 },
  line: { fontSize: 17, mobileFontSize: 15, fontWeight: 400 },
  affordance: { fontSize: 14, fontWeight: 500 },
};

/* The three ink strengths the door actually uses: one ink at
   full, at 0.72, and at 0.55. These are not any palette's
   ink steps, and the difference is visible. */
export const REGISTER_INK = {
  ink: "#f3f3f1",
  ink72: "rgba(243,243,241,0.72)",
  ink55: "rgba(243,243,241,0.55)",
};

/* The register's edge, stated so it can be enforced: there
   is no edge. No border, no radius, no shadow. A surface
   that adds one is out of register by definition. */
export const REGISTER_EDGE = { border: "none", borderRadius: 0, boxShadow: "none" };

/* ── The drop's artwork values ──────────────────────────────
   Nova's settled form (the owner picked Claude's version,
   2026-10-31) is drawn from these values, transcribed from
   the authority artwork at
   ~/workspace/nova-bubble-claude-oct30/nova-claude.svg. They
   live here, not inside the figure component, so the figure
   and any future register surface read the same numbers.
   Geometry (paths, centres, lengths) stays in the figure,
   where it is drawn; what is shared is value: color,
   gradient, and light. */
export const NOVA_DROP_TOKENS = {
  /* The pool as it reads through the water: the register
     pool shifted across, compressed, and dimmer. */
  poolRefracted: {
    cx: "0.58",
    cy: "0.64",
    r: "0.52",
    stops: [
      [0, "#201c16"],
      [0.55, "#0c0c0c"],
      [1, "#050506"],
    ],
  },
  /* Dark water: core darker than rim. */
  water: {
    cx: "0.40",
    cy: "0.33",
    r: "0.78",
    stops: [
      [0, "#0c0e10"],
      [0.62, "#08090b"],
      [0.93, "#050607"],
      [1, "#0f0e0c"],
    ],
  },
  /* Filament value falls off with distance from the body.
     Centred on the body centre of the authority artwork,
     (240, 232), radius 215, in its own user space. */
  gill: {
    cx: 240,
    cy: 232,
    r: 215,
    stops: [
      [0.45, "#c0b199"],
      [0.68, "#8d8069"],
      [1, "#201c17"],
    ],
  },
  gold: REGISTER_GOLD,
  goldBright: REGISTER_GOLD_BRIGHT,
  mass: "#cfc1aa",
  massCore: "#ded2bd",
  massLobe: "#b7a893",
  lensMass: "#d8cbb4",
  lensMassRight: "#d2c5ae",
  lid: "#090a0c",
  root: "#6d6454",
  mouth: "#cabca5",
  sheen: "#2a251d",
  meniscus: "#1d1a16",
  rimArc: "#3a342b",
  specular: "#f2ead9",
};
