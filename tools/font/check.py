#!/usr/bin/env python3
"""Checks for Strata Pixel.
1. The TTF rasterises to exactly the source bitmaps at 16 px (no stray or half-covered pixels).
2. No kerned pair makes two glyphs touch (incl. diagonally).
3. Every character the game's texts use is in the font.
python3 tools/font/check.py"""
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
FONT = ROOT / "assets/fonts/strata-pixel"
data = json.loads((FONT / "StrataPixel-Regular.json").read_text(encoding="utf-8"))
asc = data["lineAscent"]
bad = 0

# 1. raster == bitmap (FreeType directly, at 16/32/48 px, in the hinting modes browsers use)
import freetype  # pip install freetype-py
face = freetype.Face(str(FONT / "StrataPixel-Regular.ttf"))
MODES = {"default": freetype.FT_LOAD_DEFAULT, "light": freetype.FT_LOAD_TARGET_LIGHT,
         "unhinted": freetype.FT_LOAD_NO_HINTING}


def raster(ch, size, flags):
    face.set_pixel_sizes(0, size)
    face.load_char(ch, flags | freetype.FT_LOAD_RENDER)
    b, s = face.glyph.bitmap, size // 16
    out, grey = set(), 0
    for r in range(b.rows):
        for c in range(b.width):
            v = b.buffer[r * b.pitch + c]
            if 0 < v < 255:
                grey += 1
            if v > 127 and r % s == 0 and c % s == 0:
                out.add(((face.glyph.bitmap_left + c) // s, (face.glyph.bitmap_top - 1 - r) // s))
    return out, grey


for ch, g in data["glyphs"].items():
    if not g["rows"]:
        continue
    want = {(g["x"] + x, g["top"] - r) for r, line in enumerate(g["rows"]) for x, c in enumerate(line) if c == "#"}
    got, grey = want, 0
    for size in (16, 32, 48):
        for mode, fl in MODES.items():
            got, grey = raster(ch, size, fl)
            if got != want or grey:
                break
        if got != want or grey:
            break
    if got != want or grey:
        bad += 1
        print(f"raster mismatch U+{ord(ch):04X} {ch}: missing {len(want - got)}, extra {len(got - want)}, grey {len(grey)}")

# 2. kerned pairs keep at least one empty pixel between glyphs (8-neighbourhood)
def ink(ch, dx):
    g = data["glyphs"][ch]
    return {(dx + g["x"] + x, g["top"] - r) for r, line in enumerate(g["rows"]) for x, c in enumerate(line) if c == "#"}

touch = 0
for a, row in data["kerning"].items():
    A = ink(a, 0)
    for b, k in row.items():
        B = ink(b, data["glyphs"][a]["adv"] + k)
        if any((x + dx, y + dy) in A for (x, y) in B for dx in (-1, 0, 1) for dy in (-1, 0, 1)):
            touch += 1
            if touch < 20:
                print(f"kerned pair touches: {a}{b} ({k})")
bad += touch

# 3. coverage of the game's own texts
need = set()
for f in (ROOT / "src/config/i18n").glob("*.json"):
    need |= set(f.read_text(encoding="utf-8"))
missing = sorted(c for c in need if c not in data["glyphs"] and c not in "\n\r\t" and ord(c) >= 32)
if missing:
    print("missing for game texts:", "".join(missing), [f"U+{ord(c):04X}" for c in missing])
    bad += len(missing)

print(f"{len(data['glyphs'])} glyphs, {sum(len(v) for v in data['kerning'].values())} kerning pairs checked;",
      "OK" if not bad else f"{bad} problems")
sys.exit(1 if bad else 0)
