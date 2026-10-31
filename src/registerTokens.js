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
   The design system carries an older identity gold, #d4a437,
   for tier labels and marks. The two sit a few points apart;
   reconciling them is the site wide phase's call, not this
   lane's, so both stand named rather than one silently
   swallowing the other. */

/* The ground every register surface sits on. */
export const REGISTER_GROUND = "#060606";

/* The editorial serif, the same custom property the reading
   roles in designSystem.jsx already use. */
export const REGISTER_SERIF = "var(--cb-serif)";

/* Gold: the register's only warmth. */
export const REGISTER_GOLD = "#c89a3a";
export const REGISTER_GOLD_BRIGHT = "#e0bd68";

/* The one broad pool of light: a radial fall from a warm
   neutral core to the ground, centred high and left of
   centre, the door's pool geometry. Stops are
   [offset, color] pairs. */
export const REGISTER_POOL = {
  cx: "0.42",
  cy: "0.34",
  r: "0.72",
  stops: [
    [0, "#17140f"],
    [0.46, "#0d0c0a"],
    [1, "#060606"],
  ],
};

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
