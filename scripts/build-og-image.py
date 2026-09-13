#!/usr/bin/env python3
"""Rebuild Cerebrum's og-image at the correct 1200x630 social-card aspect.

The previous file was 1770x1784 (near-square) while the meta tags declare
1200x630, so networks center-cropped it unpredictably; it also went stale
on the edge reading "16 databases". This renders fresh 1200x630 art with
the correct "15" count in the brand voice, using the site's own Inter Tight.
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import math

W, H = 1200, 630
BG_TOP = (13, 16, 22)
BG_BOT = (6, 8, 12)
INK = (245, 247, 245)
SUB = (154, 160, 168)
FAINT = (110, 116, 124)
ACCENT = (52, 211, 153)

img = Image.new("RGB", (W, H), BG_BOT)
d = ImageDraw.Draw(img, "RGBA")

# vertical gradient
for y in range(H):
    t = y / (H - 1)
    d.line([(0, y), (W, y)], fill=tuple(int(BG_TOP[i] + (BG_BOT[i] - BG_TOP[i]) * t) for i in range(3)))

# faint emerald radial lift, top-left (echoes the favicon tile)
glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
for r in range(420, 0, -4):
    a = int(26 * (1 - r / 420) ** 2)
    gd.ellipse([150 - r, 60 - r, 150 + r, 60 + r], fill=(16, 185, 129, a))
img = Image.alpha_composite(img.convert("RGBA"), glow)
d = ImageDraw.Draw(img, "RGBA")

# brain mark, cropped from the current repo og art (vector-crisp source);
# feather the crop edges so the source background melts into the new art
src = Image.open("public/og-image-prev.png  # previous committed art; the mark is cropped from it").convert("RGBA")
mark = src.crop((282, 548, 362, 658))          # 80x110 incl. padding
mw, mh = mark.size
mask = Image.new("L", (mw, mh), 255)
md = ImageDraw.Draw(mask)
feather = 14
for i in range(feather):
    a = int(255 * (i / feather) ** 1.5)
    md.rectangle([i, i, mw - 1 - i, mh - 1 - i], outline=a)
mark.putalpha(mask)
mark = mark.resize((62, 85), Image.LANCZOS)
img.alpha_composite(mark, (84, 78))

f_word = ImageFont.truetype("/tmp/InterTight-Regular.ttf", 54)
f_head = ImageFont.truetype("/tmp/InterTight-Regular.ttf", 98)
f_sub = ImageFont.truetype("/tmp/InterTight-Regular.ttf", 33)
f_foot = ImageFont.truetype("/tmp/InterTight-Regular.ttf", 23)

d.text((170, 92), "Cerebrum", font=f_word, fill=INK)
tw = d.textlength("Cerebrum", font=f_word)
d.text((170 + tw + 6, 100), "TM", font=f_foot, fill=FAINT)

# headline, faux-semibold via stroke (only Regular weight ships locally)
d.text((80, 196), "Science search with", font=f_head, fill=INK,
       stroke_width=2, stroke_fill=INK)
d.text((80, 300), "real citations.", font=f_head, fill=INK,
       stroke_width=2, stroke_fill=INK)

d.text((84, 448), "Ask any question. Answers built from peer-reviewed literature", font=f_sub, fill=SUB)
d.text((84, 490), "across 15 open scholarly databases.", font=f_sub, fill=SUB)

d.line([(84, 556), (W - 84, 556)], fill=(255, 255, 255, 26), width=1)
d.text((84, 576), "askcerebrum.org    \u00b7    Peer-reviewed sources    \u00b7    No ads",
       font=f_foot, fill=FAINT)
foot_r = "\u00a9 2026 Cerebrum"
d.text((W - 84 - d.textlength(foot_r, font=f_foot), 576), foot_r, font=f_foot, fill=FAINT)

img.convert("RGB").save("/tmp/og-new.png", optimize=True)
print("wrote /tmp/og-new.png", img.size)
