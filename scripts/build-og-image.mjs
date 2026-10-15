#!/usr/bin/env node
/* Rebuild Cerebrum's og-image (1200x630 social card).
 *
 * History: scripts/build-og-image.py drew the previous card in PIL
 * from public/og-image-prev.png (long deleted) and shipped the
 * stale "15 databases" count. This generator replaces it:
 *
 *   - The scene (near black gradient ground, warm halo, the repo's
 *     brain mark, and Nova) is one SVG rendered by resvg. The mark
 *     is public/favicon.svg's own path geometry stroked in the
 *     flat foundation gold #C4A35A.
 *   - Nova stands at the right in her current shipped form: the
 *     owner's v3 design (clay rose axolotl, parchment lab coat,
 *     gold glasses, CEREBRUM ID badge), embedded as vectors from
 *     the canonical sheet at
 *     ~/workspace/nova-rive/model-sheet/nova-model-sheet.svg, the
 *     same art rigged in public/nova/nova.riv. Vector in, vector
 *     scaled, so she stays crisp at card size. No raster poses, no
 *     hand drawing. The halo behind her is a faint radial
 *     (#F7E9C9 falling to transparent), never a hard disc.
 *   - Type is drawn with PIL because resvg's fontdb will not load
 *     the site's subset variable font instances; the TTFs are
 *     Inter Tight instantiated from the site's own self hosted
 *     variable font (public/fonts/, weights 400/500/600), so the
 *     card still sets in the site's real face.
 *   - Copy: headline unchanged ("Science search with real
 *     citations.", the period in gold); the subline carries the
 *     canonical source count from functions/lib/product.js
 *     (SOURCE_COUNT = 14). No dashes anywhere in new copy.
 *
 * Usage: node scripts/build-og-image.mjs [nova v3 svg path] [out.png]
 * Defaults: ~/workspace/nova-rive/model-sheet/nova-model-sheet.svg
 * -> public/og-image.png
 * After redrawing, bump the ?v= cache buster in index.html and
 * scripts/prerender.mjs or edges keep serving the old art.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { execFileSync } from "child_process";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const ROOT = process.env.HOME + "/workspace/cerebrum";
const { Resvg } = require(process.env.HOME + "/workspace/nova-avatar-harness/node_modules/@resvg/resvg-js");

const novaSvgPath = process.argv[2] || process.env.HOME + "/workspace/nova-rive/model-sheet/nova-model-sheet.svg";
const outPath = process.argv[3] || ROOT + "/public/og-image.png";

/* 1. Inter Tight static instances from the site's variable font. */
const FONT_SRC = ROOT + "/public/fonts/NGSwv5HMAFg6IuGlBNMjxLsH8ag.woff2";
for (const w of [400, 500, 600]) {
  const ttf = "/tmp/InterTight-" + w + ".ttf";
  if (!existsSync(ttf)) {
    execFileSync("python3", ["-m", "fontTools.varLib.instancer", FONT_SRC, "wght=" + w, "-o", ttf],
      { stdio: "pipe" });
  }
}

/* 2. Nova's v3 art, straight from the canonical sheet. The sheet
      is a full 1024 square with the character centred; take its
      inner markup (dropping the root tag and the c2pa metadata
      block) and re-emit it inside the scene at card scale. Her
      badge lettering is live text in the sheet; resvg sets it
      with the system sans, the same as the sheet's own renders. */
const novaSvg = readFileSync(novaSvgPath, "utf8");
const vbMatch = novaSvg.match(/viewBox="([^"]+)"/);
if (!vbMatch) throw new Error("nova v3 svg has no viewBox: " + novaSvgPath);
const NOVA_VB = vbMatch[1]; // "0 0 1024 1024"
let groundStrips = 0;
const novaInner = novaSvg
  .replace(/<metadata>[\s\S]*?<\/metadata>/, "")
  .replace(/<svg[^>]*>/, "")
  .replace(/<\/svg>\s*$/, "")
  /* The sheet's own ground rect (full canvas, #2E2A26) is sheet
     furniture, not character: drop it so she stands on the card's
     halo like the previous card. The badge's dark photo panel is
     a different, smaller rect and stays. */
  .replace(/<rect[^>]*width="1024"[^>]*height="1024"[^>]*>/, () => { groundStrips++; return ""; });
if (groundStrips !== 1) throw new Error("expected exactly one sheet ground rect to strip, stripped " + groundStrips);
if (!novaInner.includes('id="Keycard"')) throw new Error("nova v3 svg does not look like the v3 sheet (no Keycard group)");

/* 3. The scene: ground, halo, mark, footer rule, Nova.
      Text geometry (measured on the instantiated 600 weight):
      "Science search" 564 and "real citations." 585 at 82px,
      inside the 600px text column that ends where Nova begins. */
const GOLD = "#C4A35A";
const scene = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#0D1016"/>
    <stop offset="1" stop-color="#06080C"/>
  </linearGradient>
  <radialGradient id="halo">
    <stop offset="0%" stop-color="#F7E9C9" stop-opacity="0.50"/>
    <stop offset="55%" stop-color="#F7E9C9" stop-opacity="0.16"/>
    <stop offset="74%" stop-color="#F7E9C9" stop-opacity="0"/>
  </radialGradient>
</defs>
<rect width="1200" height="630" fill="url(#bg)"/>
<circle cx="930" cy="315" r="330" fill="url(#halo)"/>
<svg x="695" y="80" width="470" height="470" viewBox="${NOVA_VB}">${novaInner}</svg>
<g fill="none" stroke="${GOLD}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" transform="translate(49 41) scale(4.41)">
  <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1 0-4.12A2.5 2.5 0 0 1 7.5 11a2.5 2.5 0 0 1 0-4.12A2.5 2.5 0 0 1 9.5 2Z"/>
  <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 0-4.12A2.5 2.5 0 0 0 16.5 11a2.5 2.5 0 0 0 0-4.12A2.5 2.5 0 0 0 14.5 2Z"/>
</g>
<line x1="80" y1="566" x2="1120" y2="566" stroke="#FFFFFF" stroke-opacity="0.14" stroke-width="1"/>
</svg>`;
const scenePng = Buffer.from(new Resvg(scene, {
  fitTo: { mode: "width", value: 1200 },
  background: "#06080C",
}).render().asPng());
writeFileSync("/tmp/og-scene.png", scenePng);

/* 4. Type, drawn with PIL (see header: resvg will not load the
      subset instances). Baselines match the scene geometry. */
const typeset = `
from PIL import Image, ImageDraw, ImageFont
img = Image.open("/tmp/og-scene.png").convert("RGB")
d = ImageDraw.Draw(img)
CREAM = (247, 243, 233); SUB = (168, 164, 154); FAINT = (130, 134, 140)
GOLD = (196, 163, 90); FOOTCREAM = (217, 211, 195)
def F(w, s): return ImageFont.truetype("/tmp/InterTight-%d.ttf" % w, s)
word = F(500, 52)
d.text((142, 108), "Cerebrum", font=word, fill=CREAM, anchor="ls")
d.text((142 + d.textlength("Cerebrum", font=word) + 8, 84), "TM", font=F(400, 19), fill=FAINT, anchor="ls")
head = F(600, 82)
for y, line in ((252, "Science"), (342, "search with")):
    d.text((80, y), line, font=head, fill=CREAM, anchor="ls")
d.text((80, 432), "real citations", font=head, fill=CREAM, anchor="ls")
d.text((80 + d.textlength("real citations", font=head), 432), ".", font=head, fill=GOLD, anchor="ls")
sub = F(400, 27)
d.text((80, 494), "Ask any question. Answers built from peer reviewed", font=sub, fill=SUB, anchor="ls")
d.text((80, 530), "literature across 14 open scholarly databases.", font=sub, fill=SUB, anchor="ls")
foot = F(400, 21)
x = 80
for text, color in (("askcerebrum.org", FOOTCREAM), ("  ·  ", GOLD), ("Peer reviewed sources", FAINT), ("  ·  ", GOLD), ("No ads", FAINT)):
    d.text((x, 602), text, font=foot, fill=color, anchor="ls")
    x += d.textlength(text, font=foot)
d.text((1120, 602), "© 2026 Cerebrum", font=foot, fill=FAINT, anchor="rs")
img.save("${outPath}", optimize=True)
print("typeset ok")
`;
execFileSync("python3", ["-c", typeset], { stdio: "inherit" });
console.log("wrote", outPath);
