#!/usr/bin/env python3
"""Tab icons as pixel medallions, in the family of the species portraits (tools/draw_portraits.py): a round scene,
the subject on top with light from the top left and a selective outline, a dark ring and a rim light.

    python3 tools/draw_tab_icons.py            # writes assets/ui/icons/tab_<id>.png (48x48)
    python3 tools/draw_tab_icons.py --sheet x  # also a contact sheet at 4x
"""
import math
import random
import sys
from pathlib import Path
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from draw_portraits import S, Canvas, dither_v, bg_land, finish_creature, medallion, hx, mix, mul  # noqa: E402

OUT = Path(__file__).resolve().parent.parent / 'assets' / 'ui' / 'icons'


# ---------- backgrounds ----------
def bg_storm(cv):
    dither_v(cv, 0, S - 1, '#2a3348', '#6a7488', bands=6)
    rnd = random.Random(5)
    for x in range(S):  # a dark sea under the storm
        h = 38 + int(1.5 * math.sin(x * 0.25))
        for y in range(h, S):
            cv.px(x, y, mix(hx('#24425a'), hx('#0e1e2c'), (y - h) / 10))
        if x % 5 == 0:
            cv.px(x, h, '#8fb8cc')
    for _ in range(26):  # rain streaks
        x, y = rnd.randint(0, 46), rnd.randint(16, 38)
        cv.px(x, y, '#9fb4c8'); cv.px(x - 1, y + 1, '#7f94aa')


def bg_amber(cv):
    dither_v(cv, 0, S - 1, '#3a2a1c', '#120d0a', bands=5)
    for r in range(20, 0, -1):  # the glow of the thing below
        for y in range(S):
            for x in range(S):
                if (x - 24) ** 2 + (y - 40) ** 2 <= r * r and (x + y) % 2 == 0:
                    cv.px(x, y, mix(cv.p[x, y], (242, 170, 70), 0.045))
    for y in range(38, S):  # strata at the bottom
        for x in range(S):
            band = (y - 38 + int(1.5 * math.sin(x * 0.2))) // 3
            cv.px(x, y, ('#6a4a30', '#8a6a44', '#4a3a2c', '#9a7a50')[band % 4])


def bg_study(cv):
    dither_v(cv, 0, S - 1, '#3a2c22', '#15100c', bands=5)
    for x in range(0, S, 7):  # shelves of a dim library behind
        for y in range(6, 30):
            if (y // 8) % 2 == 0 and (x + y) % 3:
                cv.px(x, y, '#2a2018')
    for r in range(16, 0, -1):  # a candle's warm light
        for y in range(S):
            for x in range(S):
                if (x - 34) ** 2 + (y - 14) ** 2 <= r * r and (x + y) % 2 == 0:
                    cv.px(x, y, mix(cv.p[x, y], (255, 190, 110), 0.05))


def bg_strata(cv):
    cols = ['#7a5a3e', '#c6a872', '#9a6e52', '#e2dccb', '#6f7a74', '#b88a4a', '#4f5c28', '#8c8f99']
    for y in range(S):
        for x in range(S):
            k = (y + int(2 * math.sin(x * 0.16 + y * 0.05))) // 6
            c = hx(cols[k % len(cols)])
            if (x * 7 + y * 13) % 9 == 0:
                c = mul(c, 0.88)
            cv.px(x, y, mul(c, 0.72))


# ---------- subjects ----------
def leaf(a, b, w):
    """A lens-shaped leaf from a (stalk) to b (tip), w px wide at its middle, a little curled."""
    (ax, ay), (bx, by) = a, b
    dx, dy = bx - ax, by - ay
    ln = math.hypot(dx, dy)
    nx, ny = -dy / ln, dx / ln
    side1, side2 = [], []
    for k in range(13):
        t = k / 12
        bulge = w * math.sin(math.pi * t) * (1 - 0.25 * t)
        curl = 2.0 * math.sin(math.pi * t) * t
        cx, cy = ax + dx * t + nx * curl, ay + dy * t + ny * curl
        side1.append((cx + nx * bulge, cy + ny * bulge))
        side2.append((cx - nx * bulge * 0.8, cy - ny * bulge * 0.8))
    return side1 + side2[::-1]



def f_life():
    cv = Canvas()
    # a sprout out of a small mound: a curled stem, two leaves, a bud
    cv.ell(24, 41, 10, 3, '#6a4a2e')
    cv.line([24, 40, 24, 30, 25, 24, 24, 19], '#5a8a3a', 2)
    cv.poly(leaf((24, 31), (10, 22), 4.5), '#6aa840')                          # left leaf
    cv.poly(leaf((25, 27), (39, 17), 4.5), '#7abc48')                          # right leaf
    cv.ell(24, 17, 3, 3, '#9ad060')
    finish_creature(cv, light=0.22)
    for x, y in ((14, 25), (16, 27), (35, 21), (33, 23)):                     # leaf veins
        cv.px(x, y, '#4a7a2c')
    cv.px(23, 16, '#d8f0a0')
    return cv


def f_elements():
    cv = Canvas()
    # a heavy cloud and a lightning bolt
    for cx, cy, rx, ry in ((16, 14, 9, 6), (27, 11, 11, 8), (36, 15, 8, 5), (24, 17, 14, 5)):
        cv.ell(cx, cy, rx, ry, '#c8ccd8')
    cv.ell(26, 19, 13, 3, '#8a90a2')
    cv.poly([(27, 20), (20, 31), (25, 31), (19, 43), (31, 28), (26, 28), (31, 20)], '#ffd860')
    finish_creature(cv, light=0.25)
    cv.line([26, 22, 22, 30], '#fff4c0')
    cv.line([24, 33, 21, 40], '#fff4c0')
    return cv


def f_upgrades():
    cv = Canvas()
    # a stone arrow pointing up, with amber light in its grooves
    cv.poly([(24, 6), (37, 21), (29, 21), (29, 40), (19, 40), (19, 21), (11, 21)], '#a89880')
    finish_creature(cv, light=0.3, dark=0.28)
    for y in range(22, 39, 4):
        cv.line([21, y, 27, y], '#f2b54a')
    cv.line([24, 9, 24, 19], '#ffe2a0')
    for x, y in ((9, 10), (39, 8), (41, 30), (6, 28)):                         # sparks rising
        cv.px(x, y, '#ffe2a0'); cv.px(x, y - 1, '#f2b54a')
    return cv


def f_book():
    cv = Canvas()
    # an open book: two pages, a spine, a ribbon
    cv.poly([(24, 16), (8, 12), (7, 36), (24, 40)], '#e8dcc0')
    cv.poly([(24, 16), (40, 12), (41, 36), (24, 40)], '#f2e8d0')
    cv.poly([(8, 36), (24, 40), (40, 36), (41, 38), (24, 42), (7, 38)], '#7a5a3c')
    finish_creature(cv, light=0.12, dark=0.15)
    for y in range(18, 36, 3):                                                 # lines of text
        cv.line([11, y - 2 + (y - 18) // 9, 21, y], '#a89878')
        cv.line([27, y, 37, y - 2 + (y - 18) // 9], '#b4a484')
    cv.line([24, 16, 24, 40], '#8a7458')
    cv.line([30, 13, 30, 44], '#b5523b'); cv.px(29, 44, '#b5523b'); cv.px(31, 44, '#b5523b')   # ribbon
    return cv


def f_epoch():
    cv = Canvas()
    # an hourglass of bronze and glass, sand running down
    cv.rect(13, 6, 35, 9, '#8a6a44'); cv.rect(13, 39, 35, 42, '#8a6a44')
    cv.poly([(15, 10), (33, 10), (25, 24), (33, 38), (15, 38), (23, 24)], '#bcd8e0')
    finish_creature(cv, light=0.2)
    cv.poly([(18, 12), (30, 12), (24, 21)], '#e8c87a')                         # sand above
    cv.poly([(17, 37), (31, 37), (24, 30)], '#e8c87a')                         # the heap below
    cv.line([24, 22, 24, 31], '#e8c87a')
    cv.px(17, 12, '#ffffff'); cv.px(16, 14, '#ffffff')                         # a glint on the glass
    return cv


TABS = {
    'life': (bg_land, f_life),
    'elements': (bg_storm, f_elements),
    'upgrades': (bg_amber, f_upgrades),
    'book': (bg_study, f_book),
    'epoch': (bg_strata, f_epoch),
}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    tiles = []
    for tid, (bgf, fgf) in TABS.items():
        bg = Canvas(); bgf(bg)
        img = medallion(bg.img, fgf().img)
        img.save(OUT / f'tab_{tid}.png')
        tiles.append(img)
    if '--sheet' in sys.argv:
        Z = 4
        sh = Image.new('RGBA', (len(tiles) * (S * Z + 8), S * Z), (46, 41, 37, 255))
        for i, t in enumerate(tiles):
            big = t.resize((S * Z, S * Z), Image.NEAREST)
            sh.paste(big, (i * (S * Z + 8), 0), big)
        sh.save(sys.argv[sys.argv.index('--sheet') + 1])
    print('tab icons:', ', '.join(TABS))


if __name__ == '__main__':
    main()
