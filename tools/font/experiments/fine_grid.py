#!/usr/bin/env python3
"""Experiment: Strata Pixel on a 2x finer grid (em 32 px instead of 16).
Cap height 16, x-height 12, ascenders 18, descenders 6, stems 2 px. Same visual weight as the
16 px font at the same size, but curves and diagonals get half-pixel steps.
    python3 tools/font/experiments/fine_grid.py   -> tools/font/build/fine-grid.png
"""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent.parent

# rows from the top; TOP = row index of the first line (baseline row is 0). FINE: stems 2 px, THIN: stems 1 px
FINE = {
    "a": (11, """
..#####..
.#######.
.##...###
.......##
.......##
..#######
.########
##....###
##.....##
##....###
.########
..####.##
"""),
    "Ж": (15, """
##....##....##
##....##....##
.##...##...##.
.##...##...##.
..##..##..##..
..##..##..##..
...##.##.##...
....######....
....######....
...##.##.##...
..##..##..##..
..##..##..##..
.##...##...##.
.##...##...##.
##....##....##
##....##....##
"""),
    "ფ": (11, """
..####..####..
.##..####..##.
##....##....##
##....##....##
##....##....##
##....##....##
##....##....##
##....##....##
.##..##.....##
..####......##
....##......##
....##......##
....##......##
....##......##
....##......##
....##......##
.....##....##.
......######..
"""),
}

THIN = {
    "a": (11, """
..####..
.#....#.
......#.
......#.
..#####.
.#....#.
#.....#.
#.....#.
#.....#.
#....##.
.#..#.#.
..##..##
"""),
    "Ж": (15, """
#.....#.....#
#.....#.....#
.#....#....#.
.#....#....#.
..#...#...#..
..#...#...#..
...#..#..#...
....#####....
...#..#..#...
..#...#...#..
..#...#...#..
.#....#....#.
.#....#....#.
#.....#.....#
#.....#.....#
#.....#.....#
"""),
    "ფ": (11, """
..###...###..
.#...#.#...#.
#.....#.....#
#.....#.....#
#.....#.....#
#.....#.....#
#.....#.....#
#.....#.....#
.#...#......#
..###.......#
...#........#
...#........#
...#........#
...#........#
...#........#
...#........#
....#......#.
.....######..
"""),
}

BG, CELL, INK, DIM, AMBER, SAGE = (14, 12, 16), (30, 27, 25), (237, 227, 208), (130, 120, 110), (242, 181, 74), (190, 205, 160)


def parse(src, top):
    rows = src.strip("\n").split("\n")
    return {(x, top - r) for r, line in enumerate(rows) for x, c in enumerate(line) if c == "#"}, max(map(len, rows))


def old_glyph(data, ch):
    g = data["glyphs"][ch]
    ink = {(g["x"] + c, g["top"] - r) for r, line in enumerate(g["rows"]) for c, v in enumerate(line) if v == "#"}
    return ink, max(len(l) for l in g["rows"])


def main():
    data = json.loads((ROOT / "assets/fonts/strata-pixel/StrataPixel-Regular.json").read_text(encoding="utf-8"))
    lab = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 19)
    small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 15)
    S = 8                                   # screen px per fine pixel (a 16-grid pixel = 2*S)
    variants = [
        ("Сейчас: сетка 16 (заглавные 8 пикселей), штрих 1", INK, 2, lambda ch: old_glyph(data, ch), 12, 4),
        ("Сетка 32 (заглавные 16 пикселей), штрих 2: тот же вес, плавнее", AMBER, 1, lambda ch: parse(*FINE[ch][::-1]), 24, 8),
        ("Сетка 32, штрих 1: тоньше и детальнее", SAGE, 1, lambda ch: parse(*THIN[ch][::-1]), 24, 8),
    ]
    W, rowh = 760, 24 * S + 8 * S + 70
    H = 30 + rowh * 3 + 260
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    y = 30
    for title, col, k, get, up, down in variants:
        d.text((30, y), title, font=lab, fill=col)
        x = 30
        base = y + 40 + up * k * S
        for ch in FINE:
            ink, w = get(ch)
            px = k * S
            for gy in range(-down, up):
                for gx in range(-1, w + 1):
                    x0, y0 = x + (gx + 1) * px, base - (gy + 1) * px
                    d.rectangle([x0, y0, x0 + px - 2, y0 + px - 2], fill=col if (gx, gy) in ink else CELL)
            x += (w + 2) * px + 40
        y += rowh
    # real size: font-size 32 px -> 16-grid pixel = 2 screen px, 32-grid pixel = 1 screen px; shown x1 and x3
    d.text((30, y), "Реальный размер при кегле 32 px (×1) и он же, увеличенный в 3 раза:", font=small, fill=DIM)
    strip = Image.new("RGB", (240, 44), BG)
    sx = 4
    for col, k, get in ((INK, 2, lambda ch: old_glyph(data, ch)), (AMBER, 1, lambda ch: parse(*FINE[ch][::-1])),
                        (SAGE, 1, lambda ch: parse(*THIN[ch][::-1]))):
        for ch in FINE:
            ink, w = get(ch)
            for (gx, gy) in ink:
                for a in range(k):
                    for b in range(k):
                        strip.putpixel((sx + gx * k + a, 32 - (gy + 1) * k + b), col)
            sx += (w + 1) * k + 3
        sx += 12
    im.paste(strip, (30, y + 30))
    im.paste(strip.resize((240 * 3, 44 * 3), Image.NEAREST), (30, y + 90))
    out = ROOT / "tools/font/build"
    out.mkdir(exist_ok=True)
    im = im.crop((0, 0, W, y + 90 + 44 * 3 + 20))
    im.save(out / "fine-grid.png")
    print("written tools/font/build/fine-grid.png")


if __name__ == "__main__":
    main()
