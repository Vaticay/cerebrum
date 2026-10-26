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
  // 2026-10-14: wave 1 foundation aligns the default dark palette to the overhaul plan tokens (text #E8E6E3, secondary #A8A49E, tertiary #6B6762, Surface 1 #1C1B19, Surface 2 #242320, borders #2E2C29 and #252422) on the unchanged background.
  // Look modernization, 2026-10-26 (owner order): every palette is
  // re-skinned. Dark leaves warm charcoal for a deep ink ground with
  // steel surfaces and brighter warm white ink, so the default theme
  // reads as a different product next to the old one. Contrast holds
  // the standing bar: ink, ink2 and faint each clear 4.5 to 1 on bg,
  // surface and raised (verified by script for this wave).
  Dark:  { dark: true,  bg: "#0c0d10", surface: "#16181d", raised: "#1f232b", ink: "#f4f2ec", ink2: "#b3b6bd", faint: "#9aa0a8", line: "#23262e", line2: "#2b303a", shadow: "0 24px 54px rgba(0,0,0,0.36)", shadowSm: "0 6px 18px rgba(0,0,0,0.24)", grain: 0, skel: "linear-gradient(90deg, #16181d 25%, #1f232b 50%, #16181d 75%)" },
  // 2026-10-18 (H4): Dark faint lifted from #6b6762 to #96928c. The old
  // value computed to 2.80 to 1 on raised (#242320), under the 4.5 to 1
  // bar. #96928c computes to 5.08 to 1 on raised, 5.56 to 1 on surface
  // (#1c1b19) and 6.43 to 1 on bg (#09090b). Mirrored into COLOR.faint
  // in designSystem.jsx.
  // Slate: a cooler, blue-leaning dark surface (the Discord/Linear
  // register) for anyone who wants dark without Dark's neutral-grey cast —
  // kept deliberately cool rather than folded into the warm pair above, so
  // it stays a real alternative and not a fourth near-duplicate. Ink
  // softened off pure white to match the other three's restraint.
  // ink2 was #a1a1aa until 2026-10-14: on raised (#3b3f46) that computed
  // to 4.13 to 1, under the 4.5 body text bar. #adaeb4 computes to 4.78.
  Mid:   { dark: true,  bg: "#22242a", surface: "#2c2f37", raised: "#383c46", ink: "#f0efe9", ink2: "#b9bcc4", faint: "#a8acb4", line: "rgba(255,255,255,0.08)", line2: "rgba(255,255,255,0.14)", shadow: "0 24px 54px rgba(0,0,0,0.32)", shadowSm: "0 6px 18px rgba(0,0,0,0.22)", grain: 0, skel: "linear-gradient(90deg, #2c2f37 25%, #383c46 50%, #2c2f37 75%)" },
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
  // Look modernization, 2026-10-26: Light warms from cool gray
  // stock to true paper (warm cream ground, near white raised) with
  // warm brown ink, matching the editorial direction. The opaque
  // search stage panel behavior is unchanged; only its colors move.
  Light: { dark: false, bg: "#f6f1e7", surface: "#fcf8ef", raised: "#ffffff", ink: "#211c14", ink2: "#524739", faint: "#6e6050", line: "rgba(33,28,20,0.12)", line2: "rgba(33,28,20,0.20)", shadow: "0 24px 54px rgba(33,28,20,0.13)", shadowSm: "0 6px 18px rgba(33,28,20,0.07)", grain: 0.009, skel: "linear-gradient(90deg, #ece5d5 25%, #f6f1e7 50%, #ece5d5 75%)" },
  // Sage — "Modern Organic": near-black stone instead of neutral charcoal,
  // paired by default with the muted sage-green accent (ACCENTS.Sage)
  // instead of a neon hue. The fresh-browser default (restored Sep 2026
  // per Dusty: "bring back the default green").
  // Commit 46: lifted back toward near-black alongside Dark, same
  // "razor-sharp contrast" request and same fog-bug root cause — see the
  // comment on Dark above. `ink`/`line` keep Sage's own warm-green
  // undertone rather than going fully neutral, so it stays visibly a
  // different palette from Dark, not a re-skinned duplicate.
  Sage:  { dark: true, bg: "#0b100c", surface: "#141a15", raised: "#1e261f", ink: "#f2f5ee", ink2: "#c0cabb", faint: "#98a893", line: "rgba(139,168,136,0.13)", line2: "rgba(139,168,136,0.22)", shadow: "0 24px 54px rgba(0,0,0,0.36)", shadowSm: "0 6px 18px rgba(0,0,0,0.24)", grain: 0, skel: "linear-gradient(90deg, #141a15 25%, #1e261f 50%, #141a15 75%)" },
  // Pro — the members' palette (2026-09-15). Deep black-bronze with a
  // restrained gold register: premium without going "finance app". Gated:
  // the theme picker only offers it when user.isPro is true (see
  // SettingsView), and the P resolution below falls back to Dark for anyone
  // else holding the cookie — so the palette can never leak to free.
  Pro:   { dark: true, bg: "#0d0a06", surface: "#171208", raised: "#221a0e", ink: "#faf3e0", ink2: "#e6d6a8", faint: "#ac9b6e", line: "rgba(212,175,55,0.13)", line2: "rgba(212,175,55,0.24)", shadow: "0 24px 54px rgba(0,0,0,0.38)", shadowSm: "0 6px 18px rgba(0,0,0,0.26)", grain: 0.012, skel: "linear-gradient(90deg, #171208 25%, #221a0e 50%, #171208 75%)" },
  // Pro Violet — members' palette. Deep black-violet with a restrained
  // violet register: the same premium-dark grammar as Pro, cooler mood.
  "Pro Violet": { dark: true, bg: "#0d0a13", surface: "#171221", raised: "#221831", ink: "#f5f0ff", ink2: "#d5c8f0", faint: "#a397be", line: "rgba(167,139,250,0.13)", line2: "rgba(167,139,250,0.24)", shadow: "0 24px 54px rgba(0,0,0,0.38)", shadowSm: "0 6px 18px rgba(0,0,0,0.26)", grain: 0.012, skel: "linear-gradient(90deg, #171221 25%, #221831 50%, #171221 75%)" },
  // Pro Abyss — members' palette. Deep ocean black-blue with a cyan
  // register: cold, deep, technical.
  "Pro Abyss": { dark: true, bg: "#060b11", surface: "#0d1620", raised: "#16232f", ink: "#eef7ff", ink2: "#c2dcee", faint: "#86a4b9", line: "rgba(103,232,249,0.12)", line2: "rgba(103,232,249,0.22)", shadow: "0 24px 54px rgba(0,0,0,0.38)", shadowSm: "0 6px 18px rgba(0,0,0,0.26)", grain: 0.012, skel: "linear-gradient(90deg, #0d1620 25%, #16232f 50%, #0d1620 75%)" },
  // Pro Ember — members' palette. Deep charcoal-red with an ember-orange
  // register: warm, intense, the hot counterpart to Abyss.
  "Pro Ember": { dark: true, bg: "#100906", surface: "#1a110a", raised: "#261910", ink: "#fff4ec", ink2: "#eed3b8", faint: "#b2906e", line: "rgba(251,146,60,0.13)", line2: "rgba(251,146,60,0.24)", shadow: "0 24px 54px rgba(0,0,0,0.38)", shadowSm: "0 6px 18px rgba(0,0,0,0.26)", grain: 0.012, skel: "linear-gradient(90deg, #1a110a 25%, #261910 50%, #1a110a 75%)" },
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
// 2026-10-14: Amber moves to the plan gold, desaturated.
const ACCENTS = { Mono: "#ffffff", Sage: "#8ba888", Amber: "#c4a35a" };

export { PALETTES, PRO_PALETTE_NAMES, isProPalette, ACCENTS };
