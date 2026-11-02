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

/* ── Surface classes (Wave Zero, 2026-11-02) ───────────────
   Every view the app can render belongs to exactly one of
   three classes, and the class, not the surface, decides
   where its ground and ink come from:

   Register: the door, the search home, sign in. Ground is
   REGISTER_GROUND under every palette, ink is REGISTER_INK,
   gold is text and rule only.
   Reading: the answer, the reader, Nova's page, the profile.
   The only class a palette may move: its ground and ink come
   from the selected palette, through the resolver.
   Instrument: the Library, Settings, the Inbox, Diagram
   Studio, Usage. Palette governed, like Reading (correct
   fix, 2026-11-02): the Wave Zero build aliased the
   Instrument ground to the Register ground, which is the
   mechanism the incident named F7 and M5, surfaces handed
   a black ground while their interiors kept palette ink.
   Option B as clarified by Claude and adopted by the owner
   gives palettes to Reading and Instrument both; only the
   Register class is fixed.

   The permanent record page is the named hybrid: public
   Reading on a Register ground. It is not a fourth class; it
   is Reading content whose ground resolves as Register,
   because the record page is a standalone function that
   cannot import this module and inlines these values. */

/* The Instrument ground (correct fix, 2026-11-02): there is
   no fixed Instrument ground any more. The export survives
   as a null marker so a stale import fails loudly in review
   rather than silently painting the register ground on a
   palette surface again. */
export const INSTRUMENT_GROUND = null;

/* The Reading measure: sustained reading columns cap at 72
   characters, the standing Reader rule. */
export const READING_MEASURE = "72ch";

/* The Nova notebook measure: her page column is 680px. */
export const NOTEBOOK_MEASURE = "680px";

/* The hairline the Register and Instrument classes rule
   with: the full ink at low alpha, no palette line. */
export const REGISTER_LINE = "rgba(243,243,241,0.14)";

/* The strong hairline: the same ink at section rule strength.
   Added at the Waves 0 to 2 merge (2026-11-02) so the Wave 2
   ledger components consume the token instead of carrying the
   literal the register gate forbids outside this file. */
export const REGISTER_LINE_STRONG = "rgba(243,243,241,0.28)";

export const SURFACE_CLASSES = {
  door: "Register",
  search: "Register",
  signin: "Register",
  answer: "Reading",
  document: "Reading",
  learn: "Reading",
  profile: "Reading",
  trending: "Reading",
  library: "Instrument",
  settings: "Instrument",
  inbox: "Instrument",
  studio: "Instrument",
  usage: "Instrument",
  investigations: "Instrument",
  people: "Instrument",
  record: "RecordHybrid",
};

const CLASS_NAMES = ["Register", "Reading", "Instrument"];

/* resolveSurface(view, palette): the one path from tokens to
   a surface. `view` is a view identifier from SURFACE_CLASSES
   or a class name itself. `palette` is a palette object from
   palettes.js (the fields a palette governed surface may
   read: bg, ink, ink2, faint, line, line2, dark); the
   Register resolution ignores it entirely, which is the
   Option B ruling in code: palettes govern Reading and
   Instrument surfaces, the Register is fixed. An unmapped
   view throws, so a new view cannot silently inherit a
   ground nobody chose for it. */
export function resolveSurface(view, palette = null) {
  const cls = CLASS_NAMES.includes(view) ? view : SURFACE_CLASSES[view];
  if (!cls) throw new Error("resolveSurface: unmapped view " + String(view));
  const base = {
    surface: CLASS_NAMES.includes(view) ? null : view,
    serif: REGISTER_SERIF,
    mono: "var(--cb-mono)",
    edge: REGISTER_EDGE,
  };
  if (cls === "Register") {
    return {
      ...base,
      class: "Register",
      ground: REGISTER_GROUND,
      ink: { ...REGISTER_INK },
      line: REGISTER_LINE,
      gold: REGISTER_GOLD,
      goldRole: "text, rule, and the single send word only, never a fill",
      measure: null,
      hybrid: null,
    };
  }
  if (cls === "Instrument") {
    /* Correct fix (2026-11-02): an Instrument surface
       resolves WITH its palette, ground and ink together,
       exactly as Reading does. The resolver never hands a
       surface a ground without the ink that belongs to it
       again (incident F7). Without a palette it falls back
       to the Register pair, ground and ink together. */
    const p = palette && typeof palette === "object" ? palette : null;
    return {
      ...base,
      class: "Instrument",
      ground: p ? p.bg : REGISTER_GROUND,
      ink: p
        ? { ink: p.ink, ink72: p.ink2, ink55: p.faint }
        : { ...REGISTER_INK },
      line: p ? p.line : REGISTER_LINE,
      gold: p && !p.dark ? REGISTER_GOLD_ON_LIGHT : REGISTER_GOLD,
      goldRole: "the surface accent paths, with fills permitted for primary actions",
      measure: null,
      hybrid: null,
    };
  }
  if (cls === "RecordHybrid") {
    const reading = resolveSurface("answer", palette);
    return {
      ...reading,
      surface: "record",
      ground: REGISTER_GROUND,
      hybrid: "public Reading on Register ground",
    };
  }
  /* Reading: the only class a palette moves. Without a
     palette it falls back to the Register ink family on the
     Register ground, so a Reading surface rendered before a
     palette resolves still sits on a named token ground. */
  const p = palette && typeof palette === "object" ? palette : null;
  return {
    ...base,
    class: "Reading",
    ground: p ? p.bg : REGISTER_GROUND,
    ink: p
      ? { ink: p.ink, ink72: p.ink2, ink55: p.faint }
      : { ...REGISTER_INK },
    line: p ? p.line : REGISTER_LINE,
    gold: p && !p.dark ? REGISTER_GOLD_ON_LIGHT : REGISTER_GOLD,
    goldRole: "citation and marginal marks only, never a fill",
    measure: view === "learn" ? NOTEBOOK_MEASURE : READING_MEASURE,
    hybrid: null,
  };
}
