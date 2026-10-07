/**
 * palettes.js — Theme palette definitions and accent set.
 *
 * Extracted from CerebrumApp.jsx (monolith split, 2026-10-07).
 * Pure data: PALETTES (all themes incl. 4 Pro-exclusive), PRO_PALETTE_NAMES,
 * isProPalette() helper, and ACCENTS. No dependencies.
 */

const PALETTES = {
  // Commit 46: REVERSED the "lift off pure black" direction from the two
  // rounds above, for Dark and Sage specifically — explicit follow-up
  // request for "razor-sharp, readable contrast" after the warm-charcoal
  // versions still read as low-contrast / muddy in practice, on top of
  // being the direct cause of the Commit 45 fog bug (a scrim tinted from
  // an accidentally-light `bg`). Back to a true near-black surface with
  // pure/near-pure white ink — Mid and Light are unaffected, this was
  // reported against Dark and Sage specifically.
  //
  // Older reasoning, kept for context now that it's been reversed: this
  // used to be lifted off pure black per explicit direction (Strike 5) on
  // the theory that near-black surfaces with stark white text read as
  // "cyberpunk terminal" rather than "premium research software," tuned to
  // sit at the lightness Apple/Linear/Notion's own dark surfaces use. That
  // reasoning didn't survive contact with actual use — hence this reversal.
  Dark:  { dark: true,  bg: "#09090b", surface: "#131316", raised: "#1c1c21", ink: "#ffffff", ink2: "#d4d4d8", faint: "#a1a1aa", line: "rgba(255,255,255,0.08)", line2: "rgba(255,255,255,0.15)", shadow: "none", shadowSm: "none", grain: 0, skel: "linear-gradient(90deg, #131316 25%, #1c1c21 50%, #131316 75%)" },
  // Slate: a cooler, blue-leaning dark surface (the Discord/Linear
  // register) for anyone who wants dark without Dark's neutral-grey cast —
  // kept deliberately cool rather than folded into the warm pair above, so
  // it stays a real alternative and not a fourth near-duplicate. Ink
  // softened off pure white to match the other three's restraint.
  Mid:   { dark: true,  bg: "#25262b", surface: "#303339", raised: "#3b3f46", ink: "#e8e7e5", ink2: "#a1a1aa", faint: "#aaabaf", line: "rgba(255,255,255,0.08)", line2: "rgba(255,255,255,0.14)", shadow: "none", shadowSm: "none", grain: 0, skel: "linear-gradient(90deg, #303339 25%, #3b3f46 50%, #303339 75%)" },
  /* Light — designed as its own material, not as dark mode inverted.
     Archival paper rather than white: a warm, slightly cool-shadowed stock
     at #f1f0ec, the colour of a journal offprint. Ink is graphite (#22252a)
     with a blue-grey cast rather than the old warm brown, because printed
     scientific text is cool and warm ink at this size reads as sepia.
     Borders are silver — a real hairline you can see — instead of a 7%
     wash that vanished on any screen not at full brightness. The shadows
     are wider and weaker than dark mode's: paper on a desk has a diffuse
     shadow, not a drop shadow. Grain stays, and slightly stronger, because
     it is what keeps large pale surfaces from looking like a blank div. */
  Light: { dark: false, bg: "#f1f0ec", surface: "#f9f9f7", raised: "#ffffff", ink: "#22252a", ink2: "#4b5058", faint: "#5f656d", line: "rgba(34,37,42,0.10)", line2: "rgba(34,37,42,0.17)", shadow: "0 1px 2px rgba(34,37,42,0.04), 0 10px 30px rgba(34,37,42,0.07)", shadowSm: "0 1px 2px rgba(34,37,42,0.05)", grain: 0.009, skel: "linear-gradient(90deg, #e9e8e3 25%, #f3f2ef 50%, #e9e8e3 75%)" },
  // Sage — "Modern Organic": near-black stone instead of neutral charcoal,
  // paired by default with the muted sage-green accent (ACCENTS.Sage)
  // instead of a neon hue. The fresh-browser default (restored Sep 2026
  // per Dusty: "bring back the default green").
  // Commit 46: lifted back toward near-black alongside Dark, same
  // "razor-sharp contrast" request and same fog-bug root cause — see the
  // comment on Dark above. `ink`/`line` keep Sage's own warm-green
  // undertone rather than going fully neutral, so it stays visibly a
  // different palette from Dark, not a re-skinned duplicate.
  Sage:  { dark: true, bg: "#0d0f0e", surface: "#151816", raised: "#1e221f", ink: "#f4f7f4", ink2: "#cbd5cd", faint: "#94a397", line: "rgba(139,168,136,0.12)", line2: "rgba(139,168,136,0.2)", shadow: "none", shadowSm: "none", grain: 0, skel: "linear-gradient(90deg, #151816 25%, #1e221f 50%, #151816 75%)" },
  // Pro — the members' palette (2026-09-15). Deep black-bronze with a
  // restrained gold register: premium without going "finance app". Gated:
  // the theme picker only offers it when user.isPro is true (see
  // SettingsView), and the P resolution below falls back to Dark for anyone
  // else holding the cookie — so the palette can never leak to free.
  Pro:   { dark: true, bg: "#0b0a07", surface: "#14110b", raised: "#1e1a11", ink: "#faf3e0", ink2: "#e6d6a8", faint: "#a2936b", line: "rgba(212,175,55,0.13)", line2: "rgba(212,175,55,0.24)", shadow: "none", shadowSm: "none", grain: 0.012, skel: "linear-gradient(90deg, #14110b 25%, #1e1a11 50%, #14110b 75%)" },
  // Pro Violet — members' palette. Deep black-violet with a restrained
  // violet register: the same premium-dark grammar as Pro, cooler mood.
  "Pro Violet": { dark: true, bg: "#0c0a11", surface: "#14101c", raised: "#1d1626", ink: "#f5f0ff", ink2: "#d5c8f0", faint: "#9a8fb5", line: "rgba(167,139,250,0.13)", line2: "rgba(167,139,250,0.24)", shadow: "none", shadowSm: "none", grain: 0.012, skel: "linear-gradient(90deg, #14101c 25%, #1d1626 50%, #14101c 75%)" },
  // Pro Abyss — members' palette. Deep ocean black-blue with a cyan
  // register: cold, deep, technical.
  "Pro Abyss": { dark: true, bg: "#070b10", surface: "#0e141b", raised: "#16202a", ink: "#eef7ff", ink2: "#c2dcee", faint: "#7e9ab0", line: "rgba(103,232,249,0.12)", line2: "rgba(103,232,249,0.22)", shadow: "none", shadowSm: "none", grain: 0.012, skel: "linear-gradient(90deg, #0e141b 25%, #16202a 50%, #0e141b 75%)" },
  // Pro Ember — members' palette. Deep charcoal-red with an ember-orange
  // register: warm, intense, the hot counterpart to Abyss.
  "Pro Ember": { dark: true, bg: "#0f0a08", surface: "#17100c", raised: "#211712", ink: "#fff4ec", ink2: "#eed3b8", faint: "#a88a6b", line: "rgba(251,146,60,0.13)", line2: "rgba(251,146,60,0.24)", shadow: "none", shadowSm: "none", grain: 0.012, skel: "linear-gradient(90deg, #17100c 25%, #211712 50%, #17100c 75%)" },
};
// Pro-exclusive palettes — the theme picker only offers these when
// user.isPro is true, and P resolution falls back to Dark for anyone else
// holding the cookie, so member-only chrome can never leak to free.
const PRO_PALETTE_NAMES = ["Pro", "Pro Violet", "Pro Abyss", "Pro Ember"];
const isProPalette = (pn) => PRO_PALETTE_NAMES.indexOf(pn) !== -1;
// Cyberpunk-leaning neon set — the two hues the blueprint calls out by name
// (Matrix Green, Cyberpunk Cyan) moved to the front and pushed slightly
// more saturated/electric; the rest of the wheel (Violet, Sky/Indigo,
// Amber, Rose) kept for real per-user customization but tuned a shade
// cooler/harder so none of them reads as a pastel accent next to the new
// obsidian base.
const ACCENTS = { Mono: "#ffffff", Sage: "#8ba888" };

export { PALETTES, PRO_PALETTE_NAMES, isProPalette, ACCENTS };
