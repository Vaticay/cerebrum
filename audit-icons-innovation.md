# Auditor #10: ICONS, LOGOS & VISUAL ASSETS — INNOVATION DEEP DIVE

Cerebrum, October 8 2026. Mission: not cleanup. Make every icon and visual
asset iconic.

## What the best in the world do, and where Cerebrum sits

**Linear** treats its mark like a precision instrument: one shape, one weight,
animated with surgical easing everywhere. Its icons are in-house, geometric,
and slightly narrower than stock, so the whole UI feels machined.

**Vercel** built a triangle into a cultural object. The mark is 3 lines of SVG
and people tattoo it. Lesson: a great mark is simple enough to redraw from
memory and confident enough to never explain itself.

**Arc** gave every feature a tiny moment of motion. Icons are static in the
toolbar but come alive on hover and during state changes. The product feels
alive because the pixels move with intent.

**Feather** (what Cerebrum's 71 icons are derived from) is the safe default
of the internet. Clean, legible, forgettable. Every SaaS uses it, which means
no user can tell your app from any other by looking at an icon.

**NASA mission patches** are the real benchmark for Cerebrum. Each patch is a
self contained story: the mission's purpose, its crew, its destination, told
in a circle people wear on their jackets. Cerebrum is in the mission business.
Science questions are missions. The iconography should feel like mission
patches, not settings gears.

**Current state:** Cerebrum has a good Mark (two brain hemispheres, honest
and ownable), a clean Feather-derived icon set (consistent, legible), and
strong social assets. Innovativeness is low because nothing in the icon
system could only belong to Cerebrum. Replace the icons with Feather defaults
and nobody would notice.

## Scores

- **Current icon innovativeness: 4800/10000** (brutal but fair: the system is
  7600 well built, and 4800 original)
- **Proposed version: 9400/10000** (the last 600 is taste plus time in the
  wild; you cannot fully judge iconography until users start screenshotting it)

## THE BIG IDEA: an evidence icon language

No product on earth has icons that mean "how sure science is." That is
Cerebrum's open lane.

**The verdict glyphs.** Four shapes that become the brand's most recognized
asset, seen next to every claim in every answer:

1. **Supported** — a solid ring with a check drawn through it. The ring is
   the Mark's lobe curve, so it reads as Cerebrum's own shape, not a stock
   checkmark.
2. **Mixed** — a half filled ring. The "partial" wave icon already in the
   system is the seed: evolve it into a ring half solid, half dashed.
3. **Contradicted** — a ring broken at the top, ends slightly flared. Not an
   X, not red panic. Science contradicting itself is normal and the glyph
   should say "keep reading" not "error."
4. **Unverified** — a hollow dotted ring. Honest emptiness, drawn the same
   weight as the others so it never looks like a missing icon.

All four drawn at stroke 1.4 on the 24 grid, sharing the ring geometry.
Researchers will learn them in one answer and then see them everywhere. This
is the tattoo candidate. A ring half solid half dashed meaning "the evidence
is mixed" is a glyph worth wearing.

**The citation ring.** Citation chips [n] get a companion micro glyph: a
tiny ring whose fill encodes evidence strength at a glance. Strong evidence:
nearly full ring. Weak: thin arc. It is a sparkline for trust, 12px wide,
readable without reading. Put it on bibliography rows, on the evidence
drawer header, on Trending stories ("how verified is this press story?").

## THE MARK: make it a living instrument

The Mark (intro.jsx:1272) is two mirrored brain hemispheres at stroke 1.6.
Good bones. Three treatments exist (1.6 canonical, 1.2 on the opening veil,
2.3 effective in the favicon). Step one is one weight everywhere.

Then make it move like it thinks:

- **Draw-on boot.** The boot splash currently shows a spinner. Replace it
  with the Mark drawing itself: stroke-dashoffset animation, left hemisphere
  then right, 900ms, ending in a soft glow settle. The app literally assembles
  its own brain before it speaks. Linear's mark reveal is the reference; the
  brain version is better because the shape tells a story while it draws.
- **Breathing load.** During search, the two hemispheres gently pulse
  out of phase, like breathing. Slow, calm, 4 second cycle. It replaces
  the generic spinner and says "thinking" in a way no spinner can.
- **Verdict wink.** When an answer lands with strong support, the Mark does
  a single 300ms "settle" pulse in the header. Subtle. Users will feel it
  before they notice it.
- **Pro lineage.** Pro keeps the same geometry in gold. Not a different
  logo, the same brain wearing the Pro color. Researchers will recognize
  a Pro answer screenshot by the gold mark alone.
- **The mark as favicon, animated (where supported).** A two frame
  favicon: hemispheres alternating emphasis. Subtle enough for a tab,
  alive enough to spot your Cerebrum tab in a sea of tabs.

The goal: within a year, a researcher doodles those two hemispheres in a
lab notebook margin. That is the Vercel test and it is winnable.

## FIELD GLYPHS: give science its own alphabet

Trending categories currently use text pills. Build 12 custom field glyphs,
stroke 1.4, 24 grid, each one a tiny mission patch for a discipline:

- **Biology:** a cell with a nucleus dot, lobe-curved walls (echo the Mark)
- **Medicine:** a pulse line through a circle, the circle drawn with the
  Mark's lobe curve
- **Physics:** an atom, but drawn as three lobe-curved orbits, not the
  stock atom
- **Chemistry:** a flask whose liquid line is the partial wave from the
  existing icon set
- **AI / Computing:** a chip with the Mark's hemispheres as the die
- **Climate:** a globe with a rising arc
- **Neuroscience:** a single Mark hemisphere, filled
- **Astronomy:** a ringed planet, ring in lobe curve
- **Genetics:** a DNA helix, two strokes twisting, endpoints rounded
- **Psychology:** a head silhouette in profile drawn from one lobe curve
- **Ecology:** a leaf with a vein that is the network icon's branch
- **Mathematics:** a sigma drawn at 1.4 weight, not a font glyph

These ship in Trending, in the category filter, on article cards, and as
the empty state art for each field. A physics major sees the physics glyph
and feels seen. Nobody else's category pills do that.

## MODE ICONS: the product's three verbs, made unmistakable

The search modes are the product's core verbs. They currently have no
icons of their own. Give them three marks that teach the mental model:

- **Ask (explain):** a speech bubble whose tail becomes a question mark's
  dot. Curiosity, open ended.
- **Verify (check a claim):** the verdict ring with a check. This is the
  same ring as the evidence language, so the mode and the answer share a
  symbol. The product teaches its own alphabet.
- **Explore (compare / map):** a branching path, the network icon's DNA
  but drawn as a map route with a destination dot.

These three appear in the composer, in starter questions, in the intro's
"how it works" strip. A new user learns the whole product from three
shapes.

## EVERY ICON, FAMILY BY FAMILY

All 71 current names plus the 5 missing. Utilitarian icons get the
"Cerebrum cut": keep them boring, but tune the geometry so they feel like
family, not Feather. Signature icons get real innovation.

### Navigation and chrome

- **search:** Add a variant "search-depth." When Pro deep search runs, the
  magnifier's handle extends into a small depth gauge (two ticks). The icon
  tells you which engine is running.
- **menu, close, chevronDown, chevronRight, chevronLeft, arrowRight,
  arrowUpRight, external, moreVertical:** the Cerebrum cut only. One
  tweak with outsized effect: draw all chevrons and arrows with the same
  45 degree geometry so directional icons feel like one family. No
  innovation needed, consistency is the innovation.
- **panelLeft** (missing, add it): the sidebar toggle. Draw it as a
  rectangle with the left third shaded in the lobe curve. Make it the
  prettiest panel icon in software.

### Actions

- **plus, edit, trash, copy, download, upload, send, refresh, check,
  warning, flag, block:** Cerebrum cut. One real innovation: **copy**
  gets a success state built in, the two rects briefly become the verdict
  check ring. Copying a citation feels like certifying it.
- **send:** the paper plane is fine, but tilt it 12 degrees upward and
  add a tiny motion trail variant for the "asking" state. The plane
  launches when you press Ask.
- **refresh:** during re-search, the arrows chase each other (already
  standard). Innovation: the refresh arrowheads are lobe curves.
- **warning:** keep the triangle, but the exclamation becomes a verdict
  dot. Warnings in Cerebrum are about evidence, so the icon should speak
  evidence.
- **pause** (missing, add it): for the intro film and Listen. Draw it as
  two lobe-curved bars, not rectangles. Even pause should look like
  Cerebrum.

### Library

- **bookmark, bookmarkFilled, pin, pinFilled:** the filled states are
  good. Innovation: bookmark fill animates as a pour, top to bottom,
  250ms, like ink filling the shape. Saving a paper feels physical.
- **folder:** collections deserve better than a manila folder. Draw it
  as a specimen tray: a rectangle with three small lobe-curved dividers.
  Collections are curated specimens, not file folders.
- **history:** the clock arrow is fine. Add a subtle variant: the clock
  face shows the Mark's hemispheres as hands at 10:10 (the watch-ad
  position). Only visible at large sizes, a wink for the careful.
- **image, document, bookOpen, table, link:** Cerebrum cut, except:
- **bookOpen:** the open book becomes the product's "reading list" mark.
  Add a small verdict dot on the spine: a reading list with verified
  papers shows the solid dot. The icon carries the list's trust.
- **table:** evidence tables are core to Cerebrum. Give the table icon a
  header row drawn heavier than the body rows, and make the first column
  the verdict ring column. The icon previews the feature.

### Evidence and answers (the signature family)

- **sparkle:** currently the generic "AI did this" sparkle. Reclaim it.
  The Cerebrum sparkle gets four points instead of the usual four,
  asymmetric, with the top point elongated like a pipette drop. It means
  "synthesized from papers," not "magic." Never use it for generic AI
  glitter again.
- **wand:** the Draft button's wand. Make it a **specimen wand**: the
  wand tip holds a tiny verdict ring instead of sparkles. Drafting a
  flowchart from an answer is evidence work, and the icon says so.
- **gauge:** quotas and usage. Innovation: the gauge needle position is
  data driven wherever it appears, the icon is a real instrument, not a
  decoration. At 80 percent the needle enters an amber arc. The icon
  *is* the meter.
- **chart:** keep, Cerebrum cut.
- **network:** the source relevance network. Draw the nodes as tiny
  verdict rings, edges as citation lines. The icon is a thumbnail of the
  feature.
- **timeline:** "the arc of this literature." Draw the timeline as a
  rising arc with the three dots as papers growing larger toward now.
  The icon tells the story of science accumulating.
- **flowchart:** good already. Add the studioMark variant (below) as its
  filled sibling.
- **studioMark** (missing, add it): the Studio brand mark. The Mark's two
  hemispheres, but connected by a small edge line with an arrowhead:
  a brain that is also a node graph. This is the second tattoo candidate.
- **compare:** two rectangles side by side is honest but dull. Overlap
  them slightly and put a small verdict ring in the overlap: comparison
  is where verdicts meet.
- **partial:** this wave is the seed of the whole evidence language.
  Promote it: rename conceptually to the "mixed" glyph and let it grow
  into the half filled verdict ring.
- **shield:** privacy and vault. Draw the shield from two lobe curves
  meeting at the bottom point. The vault icon should feel like the Mark
  standing guard.
- **lock:** Cerebrum cut, keep it boring. Locks should be boring.
- **award:** profile badges. Redesign the badge set as mission patches:
  circular, each with a field glyph at center and a ring showing tier.
  "First verified answer" becomes a patch worth displaying.
- **question:** the help icon. Make the question mark's dot a tiny
  verdict hollow ring: even asking is part of the evidence ritual.
- **star, starFilled** (missing, add them): paper ratings. The star gets
  five lobe-curved points, slightly plump, friendly. The filled state
  pours like the bookmark.

### Media and communication

- **mic, micOff:** voice input. Innovation: while listening, the mic
  icon grows a radiating ring animated at speech cadence, drawn with the
  lobe curve. The app visibly listens.
- **volumeOn, volumeOff:** Cerebrum cut.
- **camera, cameraOff, image:** the attach-image flow. When an image is
  attached, the image icon's mountain becomes a thumbnail frame with a
  check: the icon shows attached state, not just the button color.
- **phone, phoneOff, screenShare, screenShareOff, speakerView, play:**
  huddle icons. Cerebrum cut, with **play** getting the lobe treatment:
  the play triangle's corners rounded to match the Mark's curves.
  **pause** (new) matches it.
- **mail:** Cerebrum cut.
- **user:** the account icon. When signed in, the shoulders become the
  Mark's lobe curves: the user icon literally carries the brand.

### The rest

- **settings:** the gear is the most overused icon in software. Replace
  it with a **calibration dial**: a circle with lobe-curved tick marks
  and a needle. Settings in a research tool is calibration, not
  machinery.
- **bell:** the inbox bell. Unread state: the clapper becomes a solid
  dot and a tiny verdict ring appears at the bell's shoulder. The bell
  tells you *what kind* of news: evidence updates get the ring.
- **filter:** the evidence filter. Draw the funnel with three horizontal
  lines that are actually tiny verdict rings: the filter filters by
  evidence strength, and the icon says so.
- **grid:** Cerebrum cut.
- **printer:** keep boring. Printing should feel reliable, not clever.
- **minimize2, maximize2:** Cerebrum cut.

## EMPTY STATES: the specimen cabinet

Every empty state in the app is currently a text card (AnswerStateCard).
Text is honest, but a dead end is a dead end. The innovation: empty
states become **specimen cards**.

- Each empty state gets a small line illustration in the field glyph
  style: an empty evidence tray, a hollow verdict ring, a specimen jar
  with nothing in it yet.
- The copy stays honest ("This answer cites no papers") but the art
  makes it a beginning, not a failure. The empty library shows an open
  specimen tray with three empty slots: "Your first saved paper goes
  here."
- The zero sources state shows the hollow dotted verdict ring at 64px
  with the retry action beneath it. The ring is the same glyph as the
  evidence language, so the empty state teaches the system.
- These illustrations are collectible in feeling: users will screenshot
  the "first investigation" specimen card the way gamers screenshot
  achievements.

## THE BOOT AND THE SOCIAL LAYER

- **Boot splash:** the Mark draw-on described above. Kill the teal
  spinner forever. The first thing every user sees is the brain
  assembling itself.
- **Favicon:** one stroke weight (1.6) everywhere, theme aware: the SVG
  favicon reads `prefers-color-scheme` and shifts the green for dark
  tabs. A Pro variant in gold for Pro members' pinned tabs.
- **OG image v2:** keep the current card, it is strong. Add **answer
  share cards**: when a user shares an answer, generate a 1200x630 card
  with the claim, the verdict glyph, the citation count, and the Mark.
  "Science search with real citations" becomes "this specific answer,
  with its evidence, as an image." Every share is an ad drawn by the
  icon system.
- **apple-touch-icon:** the Mark on the app's deep background, not
  transparency. Home screen icons need the tile.
- **The 404:** the hollow verdict ring at large size with "No paper
  found at these coordinates." A lost page becomes a lab joke.

## MOTION SIGNATURE

Three rules, applied to every icon that moves:

1. Icons animate on **state change**, never decoratively. Bookmark pours
   when saved. The verdict ring draws when the verdict arrives. The mic
   radiates while listening.
2. One easing, the app's curve, 150 to 280ms. Icons are not cartoons.
3. Reduced motion kills all of it, replaced by instant state changes.
   The glyphs must read statically too, which is why the evidence
   language is shape based, not animation based.

## BUILD GUARDS (Dusty's "never again" rule)

1. A test that fails the build on any `<svg>` outside `Icon`,
   `Mark`/`StudioMark`, and the documented export string allowlist.
2. A test that every `Icon` name used in JSX exists in the switch
   (the dev warning exists; promote it to a build failure).
3. A snapshot test rendering all 71+ icons plus the 4 verdict glyphs
   plus the 12 field glyphs at 16px and 44px, catching visual drift.
4. A lint rule: no icon ships at a size off the 12/16/20/24/32 scale.

## TOP 10 HIGHEST LEVERAGE INNOVATIONS, RANKED

1. **The verdict glyph system** (supported / mixed / contradicted /
   unverified rings). Signature asset, visible in every answer, the
   tattoo candidate. Impact: defines the brand's visual identity for
   years.
2. **The living Mark** (draw-on boot, breathing load, Pro gold
   lineage, one stroke weight). Turns the logo from a static asset into
   the product's heartbeat.
3. **Field glyphs for Trending** (12 discipline mission patches).
   Gives the content surfaces a voice no competitor has.
4. **Mode icons as teachers** (Ask / Verify / Explore). The three
   verbs of the product, learned as shapes.
5. **Answer share cards** (per answer OG art with verdict glyph).
   Every share markets the icon system itself.
6. **Empty states as specimen cards** (illustrated, collectible).
   Turns dead ends into the product's most screenshotted moments.
7. **The calibration dial** (replacing the settings gear) plus the
   **specimen tray** (replacing the folder). Two small swaps that kill
   the two most generic icons in the app.
8. **Data driven gauge and bell** (icons that are instruments, showing
   real state). Icons stop decorating and start informing.
9. **Bookmark pour and copy certify** (state change micro animations).
   Cheap to build, felt everywhere, the Arc-style aliveness.
10. **Icon discipline** (kill the 9 duplicate SVGs, add the 5 missing
    icons, one size scale, build guards). Unblocks everything above;
    without it the innovation rots back into sprawl.

## What stays boring on purpose

Lock, printer, chevrons, phone, mail, volume. Infrastructure icons
should be invisible. Innovation budget goes to the glyphs that carry
meaning: evidence, the Mark, the fields, the modes. A product where
every icon screams is a product where no icon is heard.

---

**Bottom line:** the icon system today is a well built set of stock
parts (4800 innovativeness). The path to 9400 is not more icons, it is
fewer, more meaningful ones: an evidence language only Cerebrum could
own, a Mark that behaves like a living thing, field glyphs with the
soul of mission patches, and the discipline to keep the boring icons
boring. Build the verdict rings first. Everything else orbits them.
