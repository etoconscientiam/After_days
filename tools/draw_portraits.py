#!/usr/bin/env python3
"""Pixel portraits of every species for the Life cards (48x48, shown at 2x).

Each portrait is a round medallion with a little scene of the species' habitat and the creature on top. Creatures
are built from simple shapes on a 48x48 grid (no anti-aliasing), then get a selective outline (a darker shade of
their own colour), light from the top left and hand-placed details (eyes, glints, patterns).

    python3 tools/draw_portraits.py            # writes assets/ui/portraits/<id>.png and <id>_locked.png
    python3 tools/draw_portraits.py --sheet x  # also a contact sheet at 4x
"""
import math
import random
import sys
from pathlib import Path
from PIL import Image, ImageDraw

S = 48
C = (S - 1) / 2
OUT = Path(__file__).resolve().parent.parent / 'assets' / 'ui' / 'portraits'
BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]


def hx(h, a=255):
    h = h.lstrip('#')
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


def mix(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3)) + (255,)


def mul(c, f):
    return tuple(max(0, min(255, int(c[i] * f))) for i in range(3)) + (c[3] if len(c) > 3 else 255,)


class Canvas:
    def __init__(self):
        self.img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.img)
        self.p = self.img.load()

    def ell(self, cx, cy, rx, ry, col):
        self.d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=hx(col) if isinstance(col, str) else col)

    def poly(self, pts, col):
        self.d.polygon(pts, fill=hx(col) if isinstance(col, str) else col)

    def rect(self, x0, y0, x1, y1, col):
        self.d.rectangle([x0, y0, x1, y1], fill=hx(col) if isinstance(col, str) else col)

    def line(self, pts, col, w=1):
        self.d.line(pts, fill=hx(col) if isinstance(col, str) else col, width=w)

    def px(self, x, y, col):
        if 0 <= x < S and 0 <= y < S:
            self.p[x, y] = hx(col) if isinstance(col, str) else col

    def pxs(self, pts, col):
        for x, y in pts:
            self.px(x, y, col)

    def filled(self, x, y):
        return 0 <= x < S and 0 <= y < S and self.p[x, y][3] > 0


def finish_creature(cv, light=0.16, dark=0.22, outline=0.42, skip_outline=()):
    """Light from the top left, shade to the bottom right, then a selective outline in a darker own colour."""
    src = cv.img.copy()
    sp = src.load()
    f = lambda x, y: 0 <= x < S and 0 <= y < S and sp[x, y][3] > 0
    for y in range(S):
        for x in range(S):
            if not f(x, y):
                continue
            c = sp[x, y]
            if not f(x - 1, y - 1) or not f(x, y - 1):
                cv.p[x, y] = mix(c, (255, 250, 230), light)
            elif not f(x + 1, y + 1) or not f(x, y + 1):
                cv.p[x, y] = mul(c, 1 - dark)
    out = []
    for y in range(S):
        for x in range(S):
            if f(x, y):
                continue
            nb = [sp[xx, yy] for xx, yy in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)) if f(xx, yy)]
            if nb:
                r = sum(c[0] for c in nb) / len(nb); g = sum(c[1] for c in nb) / len(nb); b = sum(c[2] for c in nb) / len(nb)
                out.append((x, y, (int(r * outline * 0.8), int(g * outline * 0.75), int(b * outline * 0.85), 255)))
    for x, y, c in out:
        if (x, y) not in skip_outline:
            cv.p[x, y] = c


def dither_v(cv, y0, y1, top, bot, x0=0, x1=S - 1, bands=5):
    """Vertical gradient in a few bands, ordered dither between them."""
    top, bot = hx(top), hx(bot)
    for y in range(y0, y1 + 1):
        t = (y - y0) / max(1, y1 - y0)
        k = t * (bands - 1)
        lo = math.floor(k)
        fr = k - lo
        for x in range(x0, x1 + 1):
            idx = lo + (1 if fr * 16 > BAYER[y % 4][x % 4] else 0)
            cv.px(x, y, mix(top, bot, min(1, idx / (bands - 1))))


# ---------- habitat backgrounds ----------
def bg_water(cv, deep=False):
    dither_v(cv, 0, S - 1, '#5fb4c4' if not deep else '#3a8496', '#0f2e38' if not deep else '#081c24', bands=6)
    rnd = random.Random(3)
    for k in range(3):  # light shafts from the surface
        x0 = 6 + k * 15
        for y in range(0, 30):
            for w in range(3):
                x = x0 + w + y // 3
                if 0 <= x < S and (x + y) % 2 == 0:
                    c = cv.p[x, y]
                    cv.px(x, y, mix(c, (200, 240, 245), 0.18 * (1 - y / 30)))
    for y in range(40, S):  # seabed
        for x in range(S):
            h = 40 + int(2 * math.sin(x * 0.3) + 1.5 * math.sin(x * 0.11 + 1))
            if y >= h:
                cv.px(x, y, mix(hx('#5a5a44'), hx('#2e3426'), (y - h) / 6 + (0.15 if (x * 7 + y * 3) % 5 == 0 else 0)))
    for _ in range(7):  # bubbles
        x, y = rnd.randint(4, 43), rnd.randint(4, 36)
        cv.px(x, y, '#c8eef4')


def bg_shore(cv):
    dither_v(cv, 0, 17, '#9fd2e4', '#e6f0e0', bands=4)
    dither_v(cv, 18, 25, '#6fbccb', '#3f93a6', bands=3)
    for x in range(S):
        if (x // 3) % 2 == 0:
            cv.px(x, 18, '#f2fbfc')
    for y in range(26, S):
        for x in range(S):
            edge = 26 + int(3 * math.sin(x * 0.12))
            if y >= edge:
                t = (y - edge) / 20
                c = mix(hx('#f0dca4'), hx('#b0904f'), t)
                if (x * 13 + y * 7) % 11 == 0:
                    c = mul(c, 0.86)
                cv.px(x, y, c)
            else:
                cv.px(x, y, '#8fd0d8' if (x + y) % 3 else '#f2fbfc')


def bg_land(cv, autumn=False):
    dither_v(cv, 0, 26, '#8ec4e0', '#e4efe6', bands=5)
    for x in range(S):  # far hills
        h = 24 + int(3 * math.sin(x * 0.15) + 2 * math.sin(x * 0.07 + 2))
        for y in range(h, 32):
            cv.px(x, y, '#8fb09a')
    for x in range(S):  # near meadow
        h = 30 + int(2 * math.sin(x * 0.1 + 1))
        for y in range(h, S):
            t = (y - h) / (S - h)
            c = mix(hx('#9ccc6a' if not autumn else '#c8b060'), hx('#4a7a34' if not autumn else '#7a6a30'), t)
            if (x * 5 + y * 11) % 9 == 0:
                c = mul(c, 0.85)
            cv.px(x, y, c)
    for x in range(1, S, 4):  # grass tufts on the crest
        h = 30 + int(2 * math.sin(x * 0.1 + 1))
        cv.px(x, h - 1, '#b8e07a'); cv.px(x + 1, h - 2, '#b8e07a')


def bg_sky(cv):
    dither_v(cv, 0, S - 1, '#5aa0d0', '#e8f0ec', bands=6)
    for cx, cy, w in ((10, 34, 10), (36, 40, 12)):
        for x in range(cx - w, cx + w):
            for y in range(cy - 2, cy + 3):
                if abs(x - cx) / w + abs(y - cy) / 3 < 1:
                    cv.px(x, y, '#ffffff' if y < cy else '#dce6f0')


def bg_night(cv, fire=False):
    dither_v(cv, 0, S - 1, '#0e1430', '#2a2a48', bands=5)
    rnd = random.Random(11)
    for _ in range(26):
        x, y = rnd.randint(2, 45), rnd.randint(2, 30)
        cv.px(x, y, '#ffffff' if rnd.random() < 0.3 else '#a8b4e0')
    for x in range(S):
        h = 36 + int(2 * math.sin(x * 0.12))
        for y in range(h, S):
            cv.px(x, y, mix(hx('#2a2c3c'), hx('#14141e'), (y - h) / 12))
    if fire:
        for r in range(14, 0, -1):
            for y in range(S):
                for x in range(S):
                    if (x - 24) ** 2 + (y - 38) ** 2 <= r * r and (x + y) % 2 == 0:
                        cv.px(x, y, mix(cv.p[x, y], (255, 150, 60), 0.05))


# ---------- the medallion ----------
def medallion(bg, fg, locked=False):
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    if locked:
        st = Canvas()
        dither_v(st, 0, S - 1, '#4a423a', '#16120f', bands=5)
        bg = st.img
        sil = fg.copy()
        px = sil.load()
        for y in range(S):
            for x in range(S):
                if px[x, y][3]:
                    px[x, y] = (14, 11, 10, 255)
        fg = sil
    base = Image.alpha_composite(bg, fg)
    bp = base.load()
    p = img.load()
    for y in range(S):
        for x in range(S):
            d = math.hypot(x - C, y - C)
            if d <= 23.0:
                c = bp[x, y]
                if d > 21.9:
                    c = (27, 21, 18, 255)                       # outer ring
                elif d > 20.9:
                    ang = math.atan2(y - C, x - C)
                    c = mix(c, (255, 244, 220), 0.35) if -2.6 < ang < -0.6 else mul(c, 0.7)   # rim light top-left
                p[x, y] = c
    return img


# ---------- creatures ----------
def c_mats():
    cv = Canvas()
    # stromatolites: domed mounds built of fine layers, a living green film on top, oxygen rising
    mounds = ((15, 40, 10, 18), (31, 40, 12, 24), (42, 41, 6, 11))
    for cx, base, w, h in mounds:
        for y in range(base - h, base + 1):
            for x in range(cx - w - 1, cx + w + 2):
                u = (x - cx) / w
                top = base - h * max(0, 1 - u * u) ** 0.8
                if y < top or abs(u) > 1:
                    continue
                depth = y - top
                band = int(depth + 0.6 * math.sin(x * 0.7)) % 3
                col = ['#9a9468', '#b8ae80', '#7a7650'][band]
                if depth < 1.5:
                    col = '#58b860'
                elif depth < 2.5:
                    col = '#88c870'
                cv.px(x, y, col)
    finish_creature(cv, light=0.12)
    for x, y in ((30, 12), (31, 8), (29, 4), (33, 13), (15, 19), (16, 15), (14, 11), (42, 27), (43, 23)):
        cv.px(x, y, '#e8fbff'); cv.px(x + 1, y, '#a8e0ec'); cv.px(x, y + 1, '#a8e0ec')
    return cv


def c_plankton():
    cv = Canvas()
    # a radiolarian (spiked sphere), two diatoms, a copepod
    cx, cy = 22, 20
    for a in range(0, 360, 30):
        r = math.radians(a)
        cv.line([cx + math.cos(r) * 6, cy + math.sin(r) * 6, cx + math.cos(r) * 11, cy + math.sin(r) * 11], '#cfeef0')
    cv.ell(cx, cy, 6, 6, '#7fd8c8')
    cv.ell(cx, cy, 3, 3, '#c8f4e8')
    cv.ell(36, 33, 6, 3, '#d8c870'); cv.rect(30, 33, 42, 33, '#a89848')       # pennate diatom
    cv.ell(11, 34, 4, 4, '#b8d880'); cv.ell(11, 34, 2, 2, '#e8f4b0')          # centric diatom
    cv.ell(36, 13, 3, 2, '#f0a060'); cv.ell(32, 14, 2, 2, '#f0a060')          # copepod
    cv.line([38, 12, 43, 8], '#f0c090'); cv.line([38, 14, 43, 17], '#f0c090'); cv.line([30, 15, 27, 18], '#f0c090')
    finish_creature(cv, outline=0.35)
    cv.px(cx - 2, cy - 2, '#ffffff'); cv.px(37, 13, '#1a1010'); cv.px(11, 33, '#ffffff')
    for x, y in ((6, 10), (42, 26), (18, 40), (28, 6)):
        cv.px(x, y, '#e8fff4')
    return cv


def c_molluscs():
    cv = Canvas()
    # an ammonite: a ribbed spiral shell with the soft body and tentacles reaching out
    cx, cy = 26, 24
    for r in range(13, 0, -1):
        cv.ell(cx, cy, r, r, '#d8b888' if r % 3 else '#b89060')
    for k in range(240):
        t = k / 240 * 4.2 * math.pi
        rr = 1.5 + t * 0.9
        x, y = cx + math.cos(t) * rr, cy + math.sin(t) * rr
        cv.px(int(round(x)), int(round(y)), '#7a5a38')
    for a in range(0, 360, 24):  # ribs
        r = math.radians(a)
        cv.line([cx + math.cos(r) * 9, cy + math.sin(r) * 9, cx + math.cos(r) * 12, cy + math.sin(r) * 12], '#a07a4e')
    cv.ell(13, 31, 5, 4, '#c88a8a')                                          # body at the opening
    for k, (dx, dy) in enumerate(((-6, 4), (-8, 1), (-7, 7), (-4, 8))):
        cv.line([12, 32, 12 + dx, 32 + dy], '#d89c9c')
    finish_creature(cv)
    cv.px(14, 29, '#101010'); cv.px(15, 29, '#ffffff')
    cv.pxs(((21, 13), (22, 12), (23, 12)), '#fff0d0')
    return cv


def c_fish():
    cv = Canvas()
    # an early armoured fish: bony head shield, spindle body with a pale belly, fins, a forked tail
    cv.ell(24, 24, 15, 7, '#6f939a')
    cv.ell(24, 27, 13, 4, '#a8c4c4')                                             # belly
    cv.poly([(37, 24), (46, 15), (43, 24), (46, 33)], '#5f8288')                 # tail
    cv.poly([(19, 18), (24, 9), (29, 17)], '#557a80')                            # dorsal fin
    cv.poly([(18, 29), (21, 36), (25, 30)], '#557a80')                           # pelvic fin
    cv.ell(12, 24, 7, 6, '#a89c80')                                              # head shield
    finish_creature(cv)
    for x in range(21, 37, 3):  # scales
        for y in range(19, 30, 2):
            if (x - 24) ** 2 / 225 + (y - 24) ** 2 / 49 < 0.8:
                cv.px(x + (y // 2) % 2, y, '#5a7c82')
    cv.pxs(((10, 19), (12, 19), (14, 20), (16, 22), (16, 26), (14, 28), (11, 29)), '#7a7058')   # plate seams
    cv.line([18, 19, 18, 29], '#8a8068')
    cv.ell(11, 22, 1, 1, '#f2efe0'); cv.px(11, 22, '#101010'); cv.px(10, 21, '#ffffff')
    cv.line([6, 26, 10, 27], '#4a4234')                                          # mouth
    for x in range(20, 34, 2):
        cv.px(x, 23, '#9ab8bc')                                                  # lateral line
    return cv


def c_mosses():
    cv = Canvas()
    # a fern frond unrolling and a cushion of moss with spore capsules
    cv.ell(14, 39, 10, 4, '#4e8a3a'); cv.ell(31, 40, 13, 4, '#5e9a44')
    for x in range(5, 44, 2):
        cv.px(x, 36 + (x % 3), '#7ab85a')
    stem = [(26, 40), (25, 34), (24, 28), (24, 22), (25, 16), (27, 11), (30, 8)]
    cv.line(sum(stem, ()), '#4a7a30', 1)
    for i, (x, y) in enumerate(stem[1:-1]):
        L = 7 - i
        cv.line([x, y, x - L, y - 3], '#5e9a3e'); cv.line([x, y, x + L, y - 2], '#5e9a3e')
        for k in range(1, L, 2):
            cv.px(x - k, y - 3 * k // L - 1, '#7ab85a'); cv.px(x + k, y - 2 * k // L - 1, '#7ab85a')
    cv.ell(31, 8, 3, 3, '#5e9a3e'); cv.ell(31, 8, 1, 1, '#3f7a30')                 # the fiddlehead
    cv.ell(10, 24, 5, 3, '#4e8a3a')                                                 # a second, smaller frond
    cv.line([10, 27, 12, 38], '#4a7a30')
    finish_creature(cv, light=0.2)
    for x, y in ((8, 33), (13, 32), (36, 34)):                                       # moss capsules on stalks
        cv.line([x, y + 3, x, y], '#a08040'); cv.px(x, y - 1, '#c8a050'); cv.px(x + 1, y - 1, '#e0c070')
    return cv


def c_trees():
    cv = Canvas()
    # an early tree (a tall lycopsid-like trunk with a layered crown)
    cv.poly([(22, 44), (23, 24), (26, 24), (28, 44)], '#6a4a2e')
    cv.ell(24, 18, 13, 9, '#3f7a30')
    cv.ell(17, 21, 7, 5, '#4a8a36'); cv.ell(31, 21, 7, 5, '#4a8a36')
    cv.ell(24, 13, 9, 6, '#5a9a40')
    cv.ell(21, 11, 4, 3, '#78b850')
    finish_creature(cv, light=0.2)
    for y in range(26, 44, 3):                                                       # bark scars in a diamond pattern
        cv.px(24 + (y // 3) % 2, y, '#4a3420'); cv.px(26 - (y // 3) % 2, y + 1, '#8a6a46')
    for x, y in ((18, 10), (28, 9), (14, 19), (33, 18), (22, 16), (27, 15)):
        cv.px(x, y, '#9ad068')
    cv.line([20, 44, 17, 46], '#5a3e26'); cv.line([29, 44, 33, 46], '#5a3e26')      # roots
    return cv


def c_insects():
    cv = Canvas()
    # a giant dragonfly: four veined wings, long segmented abdomen, big eyes
    for (x0, y0, x1, y1) in ((24, 20, 4, 13), (24, 20, 44, 13), (24, 23, 5, 28), (24, 23, 43, 28)):
        mx, my = (x0 + x1) / 2, (y0 + y1) / 2
        cv.poly([(x0, y0), (mx, my - 3), (x1, y1), (mx, my + 3)], (210, 232, 236, 255))
    cv.line([24, 21, 24, 44], '#3a7a8a', 2)
    cv.ell(24, 19, 3, 4, '#4a8a9a')
    finish_creature(cv, light=0.1, outline=0.55)
    for (x0, y0, x1, y1) in ((24, 20, 4, 13), (24, 20, 44, 13), (24, 23, 5, 28), (24, 23, 43, 28)):
        cv.line([x0, y0, x1, y1], '#8aa8b0')                                           # main vein
        for k in range(1, 5):
            t = k / 5
            x, y = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
            cv.px(int(x), int(y) - 1, '#a8c4ca'); cv.px(int(x), int(y) + 1, '#a8c4ca')
    for y in range(24, 44, 3):
        cv.px(24, y, '#245a68'); cv.px(25, y, '#245a68')                                 # abdomen segments
    cv.ell(22, 15, 1, 1, '#2a5a40'); cv.ell(26, 15, 1, 1, '#2a5a40')
    cv.px(21, 14, '#c8f0d8'); cv.px(25, 14, '#c8f0d8')
    return cv


def c_birds():
    cv = Canvas()
    # a bird gliding: broad wings, fanned tail, head turned toward us a little
    cv.poly([(24, 22), (4, 12), (8, 18), (16, 22), (24, 26)], '#8a6a4a')               # left wing
    cv.poly([(24, 22), (44, 10), (40, 18), (32, 22), (24, 26)], '#8a6a4a')             # right wing
    cv.ell(24, 25, 8, 5, '#b08a60')                                                   # body
    cv.poly([(17, 25), (10, 22), (11, 29)], '#7a5a3e')                                 # tail
    cv.ell(31, 21, 4, 4, '#c8a070')                                                   # head
    cv.poly([(34, 21), (39, 22), (34, 23)], '#e0a040')                                 # beak
    finish_creature(cv)
    for k in range(4):                                                                 # feather tips
        cv.px(5 + k * 3, 13 + k * 2, '#5a4430'); cv.px(43 - k * 3, 11 + k * 2, '#5a4430')
    cv.line([10, 16, 20, 22], '#c8a882'); cv.line([40, 14, 28, 22], '#c8a882')
    cv.px(32, 20, '#101010'); cv.px(31, 19, '#ffffff')
    cv.ell(24, 27, 4, 1, '#e0c8a0')                                                   # pale breast
    return cv


def c_herds():
    cv = Canvas()
    # a grazer's head and shoulders: long muzzle, ears, short horns, a mane
    cv.poly([(30, 46), (28, 30), (36, 24), (44, 30), (46, 46)], '#a07448')             # neck and shoulder
    cv.poly([(12, 30), (16, 20), (26, 14), (34, 18), (34, 28), (24, 34), (14, 36)], '#b88a58')   # head
    cv.ell(13, 33, 5, 4, '#9a7048')                                                   # muzzle
    cv.poly([(30, 15), (33, 6), (35, 15)], '#b88a58'); cv.poly([(24, 14), (25, 6), (28, 14)], '#a07448')   # ears
    cv.line([28, 12, 31, 4], '#e8dcc0', 2)                                            # horn
    finish_creature(cv)
    cv.ell(24, 22, 2, 2, '#f2ead8'); cv.px(24, 22, '#101010'); cv.px(23, 21, '#ffffff')
    cv.pxs(((10, 32), (11, 31)), '#3a2618')                                           # nostril
    cv.line([10, 36, 16, 36], '#6a4a30')                                              # mouth
    for y in range(26, 44, 2):
        cv.px(36 + (y % 4) // 2, y, '#6a4a2e')                                        # mane
    cv.line([20, 26, 30, 30], '#d8b080')                                              # cheek light
    return cv


def c_predators():
    cv = Canvas()
    # a big cat with sabre teeth, snarling
    cv.poly([(30, 46), (30, 30), (40, 24), (46, 32), (46, 46)], '#a06a3a')
    cv.poly([(8, 28), (12, 18), (22, 12), (34, 14), (38, 24), (32, 34), (16, 36), (8, 34)], '#c08848')
    cv.poly([(28, 14), (31, 5), (35, 14)], '#c08848'); cv.poly([(20, 13), (22, 5), (25, 13)], '#a87040')
    cv.ell(12, 31, 5, 4, '#d8b080')                                                   # muzzle
    finish_creature(cv)
    cv.poly([(11, 34), (12, 42), (13, 34)], '#f4ecd8'); cv.poly([(16, 34), (17, 41), (18, 34)], '#f4ecd8')   # sabres
    cv.line([9, 34, 19, 34], '#5a2a1a')                                               # open mouth line
    cv.pxs(((8, 29), (9, 29)), '#2a1810')                                             # nose
    cv.line([20, 21, 25, 22], '#3a2010')                                              # brow
    cv.px(23, 23, '#f0d040'); cv.px(24, 23, '#101010'); cv.px(22, 23, '#f0d040')      # eye
    for (x, y) in ((26, 18), (28, 26), (30, 22), (22, 30), (34, 30), (38, 36), (42, 34)):
        cv.px(x, y, '#7a4a22'); cv.px(x + 1, y, '#7a4a22')                            # spots
    cv.pxs(((7, 32), (5, 31), (6, 34), (4, 34)), '#f4ecd8')                            # whiskers
    return cv


def hominid(skin, hair, cloth, style, extra):
    """Head and shoulders of an early human. style: long / bun / wet / short — each species wears its own."""
    skin = mix(hx(skin), hx('#c89a74'), 0.45)                                          # tinted, but still skin
    hair_c = hx(hair)
    cv = Canvas()
    cv.poly([(8, 47), (11, 38), (19, 34), (30, 34), (38, 38), (41, 47)], cloth)        # shoulders in a hide
    cv.rect(20, 29, 28, 36, mul(skin, 0.92))                                          # neck
    cv.ell(24, 22, 9, 10, skin)                                                       # skull
    cv.poly([(16, 24), (18, 31), (24, 33), (30, 31), (32, 24)], skin)                  # strong jaw
    cv.ell(15, 23, 2, 3, mul(skin, 0.9)); cv.ell(33, 23, 2, 3, mul(skin, 0.9))         # ears
    if style == 'long':
        cv.ell(24, 14, 11, 6, hair_c)
        cv.poly([(13, 14), (12, 34), (16, 30), (16, 18)], hair_c); cv.poly([(35, 14), (36, 34), (32, 30), (32, 18)], hair_c)
    elif style == 'bun':
        cv.ell(24, 14, 10, 5, hair_c); cv.ell(24, 7, 4, 3, hair_c)                    # hair gathered on top
    elif style == 'wet':
        cv.ell(24, 14, 10, 5, hair_c)
        for x in range(15, 34, 3):
            cv.line([x, 15, x - 1 + (x % 2) * 2, 24 + (x % 4)], hair_c)               # wet strands
    else:
        cv.ell(24, 14, 9, 4, hair_c)
    extra(cv, 'shape')
    finish_creature(cv, light=0.14)
    brow = mul(skin, 0.68)
    cv.line([18, 18, 22, 18], brow); cv.line([26, 18, 30, 18], brow)                  # heavy brow ridge
    cv.line([18, 19, 22, 19], mul(hair_c, 0.8)); cv.line([26, 19, 30, 19], mul(hair_c, 0.8))
    cv.px(19, 21, '#efe6d2'); cv.px(20, 21, '#1a1008'); cv.px(21, 21, '#3a2818')
    cv.px(27, 21, '#3a2818'); cv.px(28, 21, '#1a1008'); cv.px(29, 21, '#efe6d2')
    cv.pxs(((24, 21), (24, 22), (23, 24), (24, 24), (25, 24)), mul(skin, 0.74))        # broad nose
    cv.line([21, 28, 27, 28], mul(skin, 0.55)); cv.line([22, 29, 26, 29], mul(skin, 0.85))   # mouth and lip
    cv.pxs(((18, 25), (30, 25)), mul(skin, 1.08))                                     # cheek light
    cv.line([13, 41, 35, 41], mul(hx(cloth), 0.75))                                   # hide seam
    for x in range(14, 35, 4):
        cv.px(x, 42, mul(hx(cloth), 0.6))                                             # stitches
    extra(cv, 'detail')
    return cv


def c_fossor():
    def ex(cv, stage):
        if stage == 'shape':
            cv.line([38, 47, 44, 18], '#8a6a46', 2); cv.poly([(42, 20), (47, 13), (45, 24)], '#a8a8a8')   # digging stick, stone tip
        else:
            cv.pxs(((16, 36), (31, 33), (19, 31), (30, 27)), '#7a5a3a')                   # earth on skin and hide
            cv.px(46, 15, '#e0e0e0')
    return hominid('#c8a070', '#4a3420', '#8a6a44', 'long', ex)


def c_vigil():
    def ex(cv, stage):
        if stage == 'shape':
            cv.line([27, 7, 33, 1], '#e8e0c8', 1)                                         # a feather in the knot
        else:
            for x, y in ((6, 8), (40, 5), (44, 13), (4, 17), (12, 4)):
                cv.px(x, y, '#ffffff')
            cv.px(20, 20, '#1a1008'); cv.px(28, 20, '#1a1008')                          # eyes lifted to the sky
            cv.px(20, 21, '#efe6d2'); cv.px(28, 21, '#efe6d2')
            cv.line([17, 38, 31, 38], '#c8c0a8'); cv.px(24, 39, '#ffe680'); cv.px(24, 40, '#c8a030')   # cord, bright stone
    return hominid('#a0b0e0', '#2a2a44', '#4a4a6a', 'bun', ex)


def c_litoralis():
    def ex(cv, stage):
        if stage == 'detail':
            for k, x in enumerate(range(15, 34, 4)):                                    # shell necklace
                y = 37 + (1 if k % 2 else 0)
                cv.px(x, y, '#fbeee6'); cv.px(x + 1, y, '#d99a86'); cv.px(x, y + 1, '#b87a66')
            cv.pxs(((16, 26), (33, 22), (15, 19)), '#a8e0d8')                           # water drops in the hair
    return hominid('#80c0b0', '#24403e', '#5a7a70', 'wet', ex)


def c_lapis():
    def ex(cv, stage):
        if stage == 'shape':
            cv.ell(38, 39, 8, 6, '#8a8a92')                                               # a stone on the shoulder
        else:
            cv.pxs(((35, 36), (36, 35), (40, 37)), '#c0c0c8'); cv.pxs(((39, 43), (41, 42), (43, 40)), '#5a5a64')
            cv.line([18, 24, 19, 27], '#b04a3a'); cv.line([30, 24, 29, 27], '#b04a3a')   # ochre stripes
    return hominid('#b09090', '#3a2626', '#7a5a50', 'short', ex)


def c_tribe():
    cv = Canvas()
    # three figures around a fire, their sides lit by it
    figs = ((12, 15), (36, 14), (24, 9))
    for (x, h) in figs:
        top = 42 - h
        cv.ell(x, top + 2, 3, 3, '#3a2c26')
        cv.poly([(x - 4, 44), (x - 3, top + 5), (x + 3, top + 5), (x + 4, 44)], '#3a2c26')
    cv.poly([(18, 45), (24, 28), (30, 45)], '#f08a30')
    cv.poly([(20, 45), (24, 33), (28, 45)], '#ffd060')
    cv.line([15, 46, 33, 44], '#6a4a2e', 2); cv.line([15, 44, 33, 46], '#5a3e26', 2)
    finish_creature(cv, light=0.0, dark=0.05)
    for (x, h) in figs[:2]:                                                               # firelight on the side facing the fire
        top = 42 - h
        side = 1 if x < 24 else -1
        for y in range(top, 45):
            xx = x + side * (3 if y > top + 4 else 2)
            if cv.filled(xx, y):
                cv.px(xx, y, '#e8904a' if y % 3 else '#ffb060')
    cv.pxs(((24, 38), (23, 41), (25, 40)), '#fff4c0')
    for (x, y) in ((22, 25), (26, 22), (24, 18), (28, 27), (20, 21)):
        cv.px(x, y, '#ffb050')                                                            # sparks
    return cv


SPECIES = {
    'mats': ('water', c_mats),
    'plankton': ('water_deep', c_plankton),
    'molluscs': ('water', c_molluscs),
    'fish': ('water', c_fish),
    'mosses': ('shore', c_mosses),
    'trees': ('land', c_trees),
    'insects': ('shore', c_insects),
    'birds': ('sky', c_birds),
    'herds': ('land', c_herds),
    'predators': ('land_autumn', c_predators),
    'fossor': ('land', c_fossor),
    'vigil': ('night', c_vigil),
    'litoralis': ('shore', c_litoralis),
    'lapis': ('land_autumn', c_lapis),
    'tribe': ('night_fire', c_tribe),
}

BG = {
    'water': lambda cv: bg_water(cv), 'water_deep': lambda cv: bg_water(cv, deep=True), 'shore': bg_shore,
    'land': lambda cv: bg_land(cv), 'land_autumn': lambda cv: bg_land(cv, autumn=True), 'sky': bg_sky,
    'night': lambda cv: bg_night(cv), 'night_fire': lambda cv: bg_night(cv, fire=True),
}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    sheet_path = sys.argv[sys.argv.index('--sheet') + 1] if '--sheet' in sys.argv else None
    tiles = []
    for sid, (bgk, fn) in SPECIES.items():
        bg = Canvas(); BG[bgk](bg)
        fg = fn()
        img = medallion(bg.img, fg.img)
        img.save(OUT / f'{sid}.png')
        lk = medallion(bg.img, fg.img, locked=True)
        lk.save(OUT / f'{sid}_locked.png')
        tiles += [img, lk]
    if sheet_path:
        Z = 4
        n = len(tiles)
        cols = 6
        rows = (n + cols - 1) // cols
        sh = Image.new('RGBA', (cols * (S * Z + 8), rows * (S * Z + 8)), (46, 41, 37, 255))
        for i, t in enumerate(tiles):
            sh.paste(t.resize((S * Z, S * Z), Image.NEAREST), ((i % cols) * (S * Z + 8), (i // cols) * (S * Z + 8)), t.resize((S * Z, S * Z), Image.NEAREST))
        sh.save(sheet_path)
    print('portraits:', ', '.join(SPECIES))


if __name__ == '__main__':
    main()
