#!/usr/bin/env python3
"""Pixel frames for the interface (9-slice, used with CSS border-image, one art pixel = 2 UI units): slabs of the
strata's own stone — a dark slate face with a dither of grains, a sandstone rim catching the light at the top left,
a dark edge at the bottom right, a black outline with chipped corners.

    python3 tools/draw_ui_frames.py   # writes assets/ui/frames/<name>.png (16x16, slice 5)
"""
import random
from pathlib import Path
from PIL import Image

OUT = Path(__file__).resolve().parent.parent / 'assets' / 'ui' / 'frames'
N = 16


def hx(h):
    h = h.lstrip('#')
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)


def slab(face, grain_a, grain_b, rim_hi, rim_lo, edge, outline='#0c0a09', vein=None, seed=1):
    img = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    p = img.load()
    rnd = random.Random(seed)
    for y in range(N):
        for x in range(N):
            # chipped corners: the outer corner pixel is gone, the next one is outline
            if (x in (0, N - 1)) and (y in (0, N - 1)):
                continue
            if x == 0 or y == 0 or x == N - 1 or y == N - 1:
                p[x, y] = hx(outline); continue
            if (x in (1, N - 2)) and (y in (1, N - 2)):
                p[x, y] = hx(outline); continue
            c = face
            r = rnd.random()
            if r < 0.12: c = grain_a
            elif r < 0.2: c = grain_b
            if y == 1 or x == 1: c = rim_hi                       # light on the top and left
            if y == 2 and 2 <= x <= N - 3 and rnd.random() < 0.5: c = rim_hi
            if y == N - 2 or x == N - 2: c = edge                 # shade at the bottom and right
            if y == N - 3 and 2 <= x <= N - 3 and rnd.random() < 0.4: c = rim_lo
            p[x, y] = hx(c)
    if vein:
        for x in range(2, N - 2):                                 # a vein of amber along the top
            p[x, 2] = hx(vein)
    return img


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    slab('#2c2622', '#352e28', '#241f1b', '#6e604e', '#1f1a17', '#15110f', seed=3).save(OUT / 'slab.png')
    slab('#3a2c1e', '#45341f', '#30241a', '#f2b54a', '#8a5a24', '#2a1c10', vein='#ffd88a', seed=5).save(OUT / 'slab_amber.png')
    slab('#1f1b18', '#26211d', '#1a1714', '#3e362e', '#151210', '#0f0c0b', seed=7).save(OUT / 'slab_sunk.png')
    # a grain to lay over flat tiles: light and dark specks with alpha, so any colour under it reads as sediment
    g = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    gp = g.load()
    rnd = random.Random(11)
    for y in range(N):
        for x in range(N):
            r = rnd.random()
            if r < 0.10: gp[x, y] = (255, 245, 225, 34)
            elif r < 0.22: gp[x, y] = (0, 0, 0, 40)
            elif r < 0.26: gp[x, y] = (0, 0, 0, 70)
    g.save(OUT / 'grain.png')
    print('frames: slab, slab_amber, slab_sunk, grain')


if __name__ == '__main__':
    main()
