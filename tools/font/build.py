#!/usr/bin/env python3
"""Build the Strata pixel fonts from hand-drawn bitmaps.

Two grids share this code and compose.txt:
  python3 tools/font/build.py            Strata Pixel, 16 px grid   (glyphs/*.txt   -> assets/fonts/strata-pixel/)
  python3 tools/font/build.py --grid 32  Strata Stone, 32 px grid   (glyphs32/*.txt -> assets/fonts/strata-stone/)
                                         + worn levels 1..N from wear.json, each with alternates cycled by `calt`

Sources (plain text, edit by hand):
  glyphs*/*.txt  bitmaps, one block per glyph
  compose.txt    accented letters and aliases (offsets written in 16-grid pixels, scaled for the 32 grid)
  wear.json      weathering levels for Strata Stone: chips, bumps, fault shift, number of alternates

Outputs per font: .ttf / .woff2 / .woff, BMFont .fnt + _0.png, .json (bitmaps, metrics, kerning)
Needs: pip install fonttools brotli pillow
"""
from __future__ import annotations

import json
import math
import os
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
VERSION = "1.000"
NO_KERN_CATS = {"Nd", "Zs", "Mn", "Cc", "Cf"}


def configure(grid=16):
    """Set the grid. All metrics are written for the 16 grid and multiplied by G = grid / 16.
    Rows are counted from the baseline (row 0 sits on it)."""
    global G, PX, EM, CAP, XH, ASC, DESC, LINE_ASC, LINE_DESC, DEFAULT_TOP, BLOCK_ROWS, DEFAULT_RSB
    global KERN_TARGET, KERN_MAX, FAMILY, PS_NAME, OUT, SRC
    G = grid // 16
    EM = 16 * G             # pixels per em -> crisp at font-size EM, 2*EM ...
    PX = 1600 // EM         # font units per pixel; UPM stays 1600
    CAP, XH, ASC, DESC = 8 * G, 6 * G, 9 * G, 3 * G
    LINE_ASC, LINE_DESC = 12 * G, 4 * G   # hhea/typo: ascender incl. accents + air, descender + air
    DEFAULT_TOP = 9 * G - 1               # first row of a full bitmap block
    BLOCK_ROWS = 12 * G                   # rows ASC-1 .. -DESC
    DEFAULT_RSB = G                       # empty columns after every glyph
    KERN_TARGET = 2 * G                   # tighten only gaps wider than this
    KERN_MAX = 2 * G                      # never pull a pair closer than this
    if G == 1:
        FAMILY, PS_NAME, SRC = "Strata Pixel", "StrataPixel-Regular", HERE / "glyphs"
        OUT = ROOT / "assets" / "fonts" / "strata-pixel"
    else:
        FAMILY, PS_NAME, SRC = "Strata Stone", "StrataStone-Regular", HERE / "glyphs32"
        OUT = ROOT / "assets" / "fonts" / "strata-stone"


configure(16)


@dataclass
class Glyph:
    key: object                 # int code point, or str for unencoded glyphs (marks, alternates)
    ink: set = field(default_factory=set)   # {(x, row)} in glyph space, x relative to origin
    adv: int = 0
    name: str = ""
    mark: bool = False          # zero-width combining mark
    anchor_x: float | None = None
    round: str = "up"
    src: str = ""

    def bbox(self):
        if not self.ink:
            return None
        xs = [p[0] for p in self.ink]
        ys = [p[1] for p in self.ink]
        return min(xs), min(ys), max(xs), max(ys)


def die(msg):
    print("error:", msg, file=sys.stderr)
    sys.exit(1)


# ------------------------------------------------------------------ parsing
HEADER = re.compile(r"^===\s+(\S+)(.*)$")


def parse_key(tok):
    if tok.upper().startswith("U+"):
        return int(tok[2:], 16)
    return tok


def parse_files(paths):
    glyphs: dict[object, Glyph] = {}
    for path in paths:
        lines = path.read_text(encoding="utf-8").split("\n")
        i = 0
        while i < len(lines):
            line = lines[i]
            m = HEADER.match(line)
            if not m:
                if line.strip() and not line.startswith("//"):
                    die(f"{path.name}:{i+1}: stray line {line!r}")
                i += 1
                continue
            key = parse_key(m.group(1))
            opts = {}
            for tok in m.group(2).split():
                if "=" in tok:
                    k, v = tok.split("=", 1)
                    opts[k] = v
            i += 1
            rows = []
            while i < len(lines) and lines[i].strip() and not lines[i].startswith("==="):
                if not lines[i].startswith("//"):
                    rows.append(lines[i].rstrip())
                i += 1
            where = f"{path.name}:{key if isinstance(key, str) else f'U+{key:04X}'}"
            if key in glyphs:
                die(f"{where}: defined twice")
            top = int(opts.get("top", DEFAULT_TOP))
            if "top" not in opts and rows and len(rows) != BLOCK_ROWS:
                die(f"{where}: expected {BLOCK_ROWS} rows ({DEFAULT_TOP}..{-DESC}), got {len(rows)}")
            width = max((len(r) for r in rows), default=0)
            if any(len(r) != width for r in rows):
                die(f"{where}: ragged rows {[len(r) for r in rows]}")
            if rows and set("".join(rows)) - set("#."):
                die(f"{where}: only '#' and '.' allowed")
            if "w" in opts:
                width = int(opts["w"])
            origin = int(opts.get("o", 0))
            g = Glyph(key=key, src=where)
            for ri, r in enumerate(rows):
                for x, ch in enumerate(r):
                    if ch == "#":
                        g.ink.add((x + origin, top - ri))
            g.adv = int(opts["adv"]) if "adv" in opts else origin + width + int(opts.get("r", DEFAULT_RSB))
            if "cx" in opts:
                g.anchor_x = float(opts["cx"]) + origin
            g.mark = opts.get("mark") == "1"
            g.round = opts.get("round", "up")
            glyphs[key] = g
    return glyphs


# ------------------------------------------------------------------ composition
def ink_top(g, x0=None, x1=None):
    ys = [y for (x, y) in g.ink if (x0 is None or x0 <= x <= x1)]
    return max(ys) if ys else None


def ink_center(g):
    b = g.bbox()
    return (b[0] + b[2]) / 2 if b else g.adv / 2


def mark_center(m):
    if m.anchor_x is not None:
        return m.anchor_x
    b = m.bbox()
    return (b[0] + b[2]) / 2


def place(base: Glyph, mark: Glyph, kind: str, dx=0, dy=0, cx=None, over_all=False):
    """Return mark ink moved onto base. kind: top | bottom | right (caron-as-apostrophe) | ogonek."""
    mb = mark.bbox()
    bb = base.bbox()
    if kind == "right":
        # apostrophe-like caron: one empty column after the ink, top aligned to the ascender
        ox = bb[2] + 1 + G - mb[0]
        oy = bb[3] - mb[3]
    elif kind == "ogonek":
        ox = bb[2] - mb[2]
        oy = -1 - mb[3]
    else:
        c = ink_center(base) if cx is None else cx
        shift = c - mark_center(mark)
        ox = math.ceil(shift) if mark.round == "up" else math.floor(shift)
        span = (mb[0] + ox, mb[2] + ox)
        if kind == "top":
            # one empty row above the highest ink of the whole letter (open tops like H or J included)
            t = bb[3]
            oy = t + 1 + G - mb[1]
        else:  # bottom: under the baseline, 1 row under the lowest ink in the span
            ys = [y for (x, y) in base.ink if span[0] <= x <= span[1]]
            low = min(ys) if ys else 0
            oy = min(low, 0) - 1 - mb[3]
    return {(x + ox + dx, y + oy + dy) for (x, y) in mark.ink}


def pick_mark(glyphs, name, base):
    """name.odd / name.even by the parity of the base's ink width, else the plain mark."""
    if name in glyphs:
        return glyphs[name]
    b = base.bbox()
    w = b[2] - b[0] + 1
    first, second = (".odd", ".even") if w % 2 else (".even", ".odd")
    return glyphs.get(name + first) or glyphs.get(name + second)


COMPOSED = set()


def parse_compose(path, glyphs):
    """Lines:
         U+00C1  A + acute            accented letter (mark picked as acute.cap on capitals if it exists)
         U+0410  = U+0041             alias (same bitmap)
       Options after the parts: dx=, dy=, cx= (anchor column on the base), kind=top|bottom|right|ogonek
    """
    for ln, raw in enumerate(path.read_text(encoding="utf-8").split("\n"), 1):
        line = raw.split("//")[0].strip()
        if not line:
            continue
        toks = line.split()
        key = parse_key(toks[0])
        if key in glyphs:
            die(f"compose.txt:{ln}: U+{key:04X} already drawn")
        if toks[1] == "=":
            src = glyphs.get(parse_key(toks[2]))
            if src is None:
                die(f"compose.txt:{ln}: unknown alias source {toks[2]}")
            o = dict(t.split("=", 1) for t in toks[3:] if "=" in t)
            dx, dy = int(o.get("dx", 0)) * G, int(o.get("dy", 0)) * G
            glyphs[key] = Glyph(key=key, ink={(x + dx, y + dy) for (x, y) in src.ink}, adv=src.adv,
                                src=f"compose:{ln}")
            continue
        opts = {}
        parts = []
        for t in toks[1:]:
            if "=" in t:
                k, v = t.split("=", 1)
                opts[k] = v
            elif t != "+":
                parts.append(t)
        base_key = parts[0]
        base_key = parse_key(base_key) if base_key.upper().startswith("U+") else (
            ord(base_key) if len(base_key) == 1 else base_key)
        base = glyphs.get(base_key)
        if base is None and isinstance(base_key, str):
            base = glyphs.get({"dotlessi": 0x0131, "dotlessj": 0x0237}.get(base_key))
        if base is None:
            die(f"compose.txt:{ln}: unknown base {parts[0]}")
        g = Glyph(key=key, ink=set(base.ink), adv=base.adv, src=f"compose:{ln}")
        for mname in parts[1:]:
            mark = pick_mark(glyphs, mname, g)
            if mark is None:
                die(f"compose.txt:{ln}: unknown mark {mname}")
            kind = opts.get("kind") or ("bottom" if mname in ("cedilla", "commabelow", "dotbelow") else
                                         "ogonek" if mname == "ogonek" else
                                         "right" if mname == "caronright" else "top")
            cx = float(opts["cx"]) * G + (G - 1) / 2 if "cx" in opts else None
            add = place(Glyph(key=None, ink=g.ink, adv=g.adv), mark, kind,
                        int(opts.get("dx", 0)) * G, int(opts.get("dy", 0)) * G, cx, opts.get("over") == "all")
            g.ink |= add
            # a mark hanging left of the origin would touch the previous letter: move the letter right
            lo = min(x for x, _ in add)
            if lo < 0 and lo < min(x for x, _ in base.ink):
                g.ink = {(x - lo, y) for (x, y) in g.ink}
                g.adv -= lo
        b = g.bbox()
        if b[2] + 1 + DEFAULT_RSB > g.adv:
            g.adv = b[2] + 1 + DEFAULT_RSB
        glyphs[key] = g
        COMPOSED.add(key)


# ------------------------------------------------------------------ Mtavruli
def _runs(rows):
    runs, i = [], 0
    while i < len(rows):
        j = i
        while j + 1 < len(rows) and rows[j + 1] == rows[i]:
            j += 1
        runs.append((i, j))
        i = j + 1
    return runs


def _vertical_only(r):
    return "##" not in r


def fit_height(rows, target):
    """Squeeze or stretch a bitmap to `target` rows by dropping/doubling rows of straight vertical strokes."""
    rows = list(rows)
    mid = (len(rows) - 1) / 2
    while len(rows) > target:
        runs = [r for r in _runs(rows) if r[1] > r[0]]
        if runs:
            a, b = max(runs, key=lambda r: (r[1] - r[0], -abs((r[0] + r[1]) / 2 - mid)))
            del rows[(a + b) // 2]
        else:
            cand = [i for i in range(1, len(rows) - 1) if _vertical_only(rows[i])] or list(range(1, len(rows) - 1))
            del rows[min(cand, key=lambda i: abs(i - mid))]
        mid = (len(rows) - 1) / 2
    while len(rows) < target:
        cand = [i for i in range(1, len(rows) - 1) if _vertical_only(rows[i])] or list(range(1, len(rows) - 1))
        runs = [r for r in _runs(rows) if all(a in cand for a in range(r[0], r[1] + 1))]
        if runs:
            a, b = max(runs, key=lambda r: (r[1] - r[0], -abs((r[0] + r[1]) / 2 - mid)))
            i = (a + b) // 2
        else:
            i = min(cand, key=lambda i: abs(i - mid))
        rows.insert(i, rows[i])
        mid = (len(rows) - 1) / 2
    return rows


def derive_mtavruli(glyphs):
    pairs = [(cp, 0x1C90 + cp - 0x10D0) for cp in range(0x10D0, 0x10FB)]
    pairs += [(cp, 0x1CBD + cp - 0x10FD) for cp in range(0x10FD, 0x1100)]
    for src, dst in pairs:
        if dst in glyphs or src not in glyphs:
            continue
        g = glyphs[src]
        x0, y0, x1, y1 = g.bbox()
        rows = ["".join("#" if (x, y) in g.ink else "." for x in range(x0, x1 + 1)) for y in range(y1, y0 - 1, -1)]
        rows = fit_height(rows, CAP)
        ink = {(x0 + x, CAP - 1 - r) for r, line in enumerate(rows) for x, ch in enumerate(line) if ch == "#"}
        glyphs[dst] = Glyph(key=dst, ink=ink, adv=g.adv, src=f"mtavruli<-U+{src:04X}")


# ------------------------------------------------------------------ outlines
def trace(ink):
    """Union of unit squares -> closed contours, clockwise outside (TrueType convention)."""
    edges = {}
    for (x, y) in ink:
        sq = [((x, y), (x, y + 1)), ((x, y + 1), (x + 1, y + 1)),
              ((x + 1, y + 1), (x + 1, y)), ((x + 1, y), (x, y))]
        for a, b in sq:
            if (b, a) in edges:
                del edges[(b, a)]
            else:
                edges[(a, b)] = True
    out = {}
    for a, b in edges:
        out.setdefault(a, []).append(b)
    contours = []
    while out:
        start = next((v for v, n in out.items() if len(n) == 1), None) or next(iter(out))
        path = [start]
        prev = None
        cur = start
        while True:
            nxts = out[cur]
            if len(nxts) == 1 or prev is None:
                nxt = nxts[0]
            else:
                # ambiguous vertex (pixels touching at a corner): turn right to keep them apart
                dx0, dy0 = cur[0] - prev[0], cur[1] - prev[1]

                def turn(n):
                    dx1, dy1 = n[0] - cur[0], n[1] - cur[1]
                    return dx0 * dy1 - dy0 * dx1  # <0 = right turn in y-up space
                nxt = min(nxts, key=turn)
            nxts.remove(nxt)
            if not nxts:
                del out[cur]
            prev, cur = cur, nxt
            if cur == start:
                break
            path.append(cur)
        # drop collinear points
        simp = []
        n = len(path)
        for i in range(n):
            p0, p1, p2 = path[i - 1], path[i], path[(i + 1) % n]
            if (p1[0] - p0[0]) * (p2[1] - p1[1]) - (p1[1] - p0[1]) * (p2[0] - p1[0]) != 0:
                simp.append(p1)
        contours.append(simp)
    return contours


# ------------------------------------------------------------------ kerning
def profiles(g):
    left, right = {}, {}
    for (x, y) in g.ink:
        left[y] = min(left.get(y, 99), x)
        right[y] = max(right.get(y, -99), x)
    return left, right


def kern_value(L, R):
    _, lr = profiles(L)
    rl, _ = profiles(R)
    if not lr or not rl:
        return 0
    gaps = []
    for y, rx in rl.items():
        # dilate the left glyph by one row up and down so diagonal neighbours count as touching
        cand = [lr[yy] for yy in range(y - G, y + G + 1) if yy in lr]
        if not cand:
            continue
        gaps.append(L.adv + rx - max(cand) - 1)
    if not gaps:
        return 0
    g = min(gaps)
    if g <= KERN_TARGET:
        return 0
    return -min(g - KERN_TARGET, KERN_MAX)


def kerning(glyphs):
    def eligible(g):
        if g.mark or not g.ink or not isinstance(g.key, int):
            return False
        return unicodedata.category(chr(g.key)) not in NO_KERN_CATS
    gl = [g for g in glyphs.values() if eligible(g)]
    # classes: glyphs with identical side profiles kern identically
    lcls, rcls = {}, {}
    for g in gl:
        l, r = profiles(g)
        rk = (g.adv, tuple(sorted(r.items())))   # left side of a pair is described by its right edge
        lk = tuple(sorted(l.items()))
        lcls.setdefault(rk, []).append(g)
        rcls.setdefault(lk, []).append(g)
    lkeys, rkeys = list(lcls), list(rcls)
    m = {(lk, rk): kern_value(lcls[lk][0], rcls[rk][0]) for lk in lkeys for rk in rkeys}
    # merge classes that kern identically against everything; drop the ones that never kern
    def merge(keys, other, val, src):
        groups = {}
        for k in keys:
            vec = tuple(val(k, o) for o in other)
            if any(vec):
                groups.setdefault(vec, []).append(k)
        return {vec: [g for k in ks for g in src[k]] for vec, ks in groups.items()}
    L2 = merge(lkeys, rkeys, lambda k, o: m[(k, o)], lcls)
    rvec = {rk: tuple(m[(lk, rk)] for lk in lkeys) for rk in rkeys}
    R2 = merge(rkeys, lkeys, lambda k, o: m[(o, k)], rcls)
    pairs = {}
    for lv, Ls in L2.items():
        for rv, Rs in R2.items():
            # any member pair is representative: every member of a merged class has the same vector
            v = kern_value(Ls[0], Rs[0])
            if v:
                pairs[(lv, rv)] = v
    return L2, R2, pairs


# ------------------------------------------------------------------ names
def glyph_name(key):
    if isinstance(key, str):
        return key
    from fontTools.agl import UV2AGL
    if key in UV2AGL and key < 0x10000:
        return UV2AGL[key]
    return f"uni{key:04X}" if key < 0x10000 else f"u{key:05X}"


# ------------------------------------------------------------------ weathering (Strata Stone)
N4 = ((1, 0), (-1, 0), (0, 1), (0, -1))
N8 = N4 + ((1, 1), (1, -1), (-1, 1), (-1, -1))


def _parts(cells, nb):
    seen, n = set(), 0
    for c in cells:
        if c in seen:
            continue
        n += 1
        stack = [c]
        seen.add(c)
        while stack:
            x, y = stack.pop()
            for dx, dy in nb:
                q = (x + dx, y + dy)
                if q in cells and q not in seen:
                    seen.add(q)
                    stack.append(q)
    return n


def topology(ink):
    """(pieces of ink, pieces of background): counters and stroke continuity in one number pair."""
    if not ink:
        return (0, 0)
    xs = [x for x, _ in ink]
    ys = [y for _, y in ink]
    box = {(x, y) for x in range(min(xs) - 1, max(xs) + 2) for y in range(min(ys) - 1, max(ys) + 2)}
    return _parts(ink, N8), _parts(box - ink, N4)


def _h(*parts):
    """Stable pseudo-random number in [0, 1) for a tuple: the same pixel always gets the same value."""
    import hashlib
    d = hashlib.blake2b(repr(parts).encode(), digest_size=8).digest()
    return int.from_bytes(d, "big") / 2 ** 64


def weather(ink, seed, chips, bumps, fault):
    """Progressive weathering. Every pixel has a fixed random value, so a higher level only adds damage:
    a chip at level 1 is still there at level 4. Guards: a stroke never drops below 1 px, counters never
    open or close, nothing is added inside a counter, the baseline row stays whole."""
    ink = set(ink)
    if len(ink) < 8:
        return ink
    topo = topology(ink)
    # nothing may grow past the clean glyph's left and right edges, so spacing and kerning stay safe
    xmin, xmax = min(x for x, _ in ink), max(x for x, _ in ink)
    edge = [p for p in ink if any((p[0] + dx, p[1] + dy) not in ink for dx, dy in N4)]
    for p in sorted(edge, key=lambda p: _h(seed, "c", p)):
        if _h(seed, "c", p) >= chips:
            break
        x, y = p
        if y == 0 and (x, -1) not in ink:
            continue
        out = [(dx, dy) for dx, dy in N4 if (x + dx, y + dy) not in ink]
        if not out or not all((x - dx, y - dy) in ink for dx, dy in out):
            continue
        trial = ink - {p}
        if topology(trial) == topo:
            ink = trial
    cands = []
    for (x, y) in ink:
        for dx, dy in N4:
            q = (x + dx, y + dy)
            if q not in ink:
                cands.append((_h(seed, "b", (x, y), (dx, dy)), q, dx, dy, y))
    for v, q, dx, dy, y in sorted(cands):
        if v >= bumps:
            break
        if q in ink or (q[1] < 0 <= y) or not xmin <= q[0] <= xmax:
            continue
        ahead = [(q[0] + dx * k + sx, q[1] + dy * k + sy) for k in range(0, 1 + 2 * G)
                 for sx, sy in ((0, 0), (dy, dx), (-dy, -dx)) if (k, sx, sy) != (0, 0, 0)]
        if any(a in ink for a in ahead):
            continue
        trial = ink | {q}
        if topology(trial) == topo:
            ink = trial
    if fault:
        ys = sorted({y for _, y in ink})
        lo, hi = ys[0], ys[-1]
        if hi - lo >= 4 * G:
            span = max(1, (hi - lo) // 3)
            cut = lo + span + int(_h(seed, "f") * span)
            shift = fault if _h(seed, "d") < 0.5 else -fault
            for sh in (shift, -shift):
                moved = {((x + sh) if y > cut else x, y) for x, y in ink}
                if xmin <= min(x for x, _ in moved) and max(x for x, _ in moved) <= xmax \
                        and topology(moved) == topo:
                    ink = moved
                    break
    return ink


# ------------------------------------------------------------------ build
def load_glyphs():
    glyphs = parse_files(sorted(SRC.glob("*.txt")))
    COMPOSED.clear()
    parse_compose(HERE / "compose.txt", glyphs)
    derive_mtavruli(glyphs)

    # spacing copies of marks for the standalone accent characters
    spacing = {0x00B4: "acute", 0x0060: None, 0x00A8: "dieresis", 0x02C6: "circumflex", 0x02DC: "tilde",
               0x00AF: "macron", 0x02D8: "breve", 0x02D9: "dotaccent", 0x02DA: "ring", 0x02DD: "hungarumlaut",
               0x02C7: "caron", 0x00B8: "cedilla", 0x02DB: "ogonek"}

    def any_mark(mk):
        return glyphs.get(mk) or glyphs.get(mk + ".odd") or glyphs.get(mk + ".even")

    for cp, mk in spacing.items():
        if mk is None or cp in glyphs or any_mark(mk) is None:
            continue
        m = any_mark(mk)
        b = m.bbox()
        top = XH + G if mk not in ("cedilla", "ogonek") else -1
        dy = (top - b[1]) if mk not in ("cedilla", "ogonek") else (-1 - b[3])
        ink = {(x - b[0], y + dy) for (x, y) in m.ink}
        glyphs[cp] = Glyph(key=cp, ink=ink, adv=b[2] - b[0] + 1 + DEFAULT_RSB, src="spacing")

    # combining marks (zero width, positioned by GPOS mark feature)
    for cp, mk in COMBINING.items():
        m = any_mark(mk)
        if m is not None and cp not in glyphs:
            glyphs[cp] = Glyph(key=cp, ink=set(m.ink), adv=0, mark=True, anchor_x=m.anchor_x,
                               round=m.round, src="combining")
    for g in glyphs.values():
        g.name = glyph_name(g.key)
    return glyphs


COMBINING = {0x0300: "grave", 0x0301: "acute", 0x0302: "circumflex", 0x0303: "tilde", 0x0304: "macron",
             0x0306: "breve", 0x0307: "dotaccent", 0x0308: "dieresis", 0x030A: "ring",
             0x030B: "hungarumlaut", 0x030C: "caron", 0x0327: "cedilla", 0x0328: "ogonek"}


def wearable(g):
    if g.mark or not isinstance(g.key, int) or len(g.ink) < 8:
        return False
    return unicodedata.category(chr(g.key))[0] in "LNPS"


def make_font(glyphs, family, ps, out, level=None, alt_count=1):
    """Write one font. level: dict(chips, bumps, fault) to weather every glyph, with alt_count alternates
    per glyph cycled by `calt` so repeated letters differ."""
    from fontTools.fontBuilder import FontBuilder
    from fontTools.pens.ttGlyphPen import TTGlyphPen
    from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
    from fontTools.ttLib import newTable, TTFont
    from fontTools.ttLib.tables import ttProgram

    encoded = sorted([g for g in glyphs.values() if isinstance(g.key, int)], key=lambda g: g.key)
    # kerning and mark anchors come from the clean drawings, so every wear level spaces text identically
    lcls, rcls, pairs = kerning(glyphs)

    shapes = {g.name: g.ink for g in encoded}
    alts = {}                                  # base name -> [alt names]
    if level:
        for g in encoded:
            if not wearable(g):
                continue
            shapes[g.name] = weather(g.ink, (g.key, 0), level["chips"], level["bumps"], level["fault"])
            alts[g.name] = []
            for v in range(1, alt_count):
                n = f"{g.name}.v{v}"
                shapes[n] = weather(g.ink, (g.key, v), level["chips"], level["bumps"], level["fault"])
                alts[g.name].append(n)
    adv = {g.name: g.adv for g in encoded}
    for base, ns in alts.items():
        for n in ns:
            adv[n] = adv[base]

    order = [".notdef"] + [g.name for g in encoded] + [n for ns in alts.values() for n in ns]
    fb = FontBuilder(EM * PX, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap({g.key: g.name for g in encoded})

    def draw(ink):
        pen = TTGlyphPen(None)
        for c in trace(ink):
            pen.moveTo((c[0][0] * PX, c[0][1] * PX))
            for p in c[1:]:
                pen.lineTo((p[0] * PX, p[1] * PX))
            pen.closePath()
        return pen.glyph()

    ttglyphs, metrics = {}, {}
    nd = {(x, y) for x in range(5 * G) for y in range(CAP) if x < G or x >= 4 * G or y < G or y >= CAP - G}
    ttglyphs[".notdef"] = draw(nd)
    metrics[".notdef"] = (6 * G * PX, 0)
    for n in order[1:]:
        ink = shapes[n]
        ttglyphs[n] = draw(ink)
        metrics[n] = (adv[n] * PX, (min(x for x, _ in ink) if ink else 0) * PX)
    fb.setupGlyf(ttglyphs)
    fb.setupHorizontalMetrics(metrics)

    allink = [i for i in shapes.values() if i]
    maxy = max(max(y for _, y in i) + 1 for i in allink)
    miny = min(min(y for _, y in i) for i in allink)
    fb.setupHorizontalHeader(ascent=LINE_ASC * PX, descent=-LINE_DESC * PX, lineGap=0)
    fb.setupNameTable({
        "familyName": family,
        "styleName": "Regular",
        "uniqueFontIdentifier": f"{ps};{VERSION}",
        "fullName": f"{family} Regular",
        "version": f"Version {VERSION}",
        "psName": ps,
        "copyright": "Copyright 2026, the Strata authors",
        "licenseDescription": "This Font Software is licensed under the SIL Open Font License, Version 1.1.",
        "licenseInfoURL": "https://openfontlicense.org",
        "designer": "Strata team",
    })
    fb.setupOS2(
        sTypoAscender=LINE_ASC * PX, sTypoDescender=-LINE_DESC * PX, sTypoLineGap=0,
        usWinAscent=max(LINE_ASC, maxy) * PX, usWinDescent=max(LINE_DESC, -miny) * PX,
        sxHeight=XH * PX, sCapHeight=CAP * PX, achVendID="STRA",
        fsSelection=0x40 | 0x80,  # REGULAR | USE_TYPO_METRICS
        usWeightClass=400, usWidthClass=5,
        fsType=0,
        ulCodePageRange1=(1 << 0) | (1 << 1) | (1 << 2),
        yStrikeoutPosition=3 * G * PX, yStrikeoutSize=G * PX,
        ySubscriptYOffset=2 * G * PX, ySuperscriptYOffset=4 * G * PX,
        ySubscriptXSize=EM * PX // 2, ySubscriptYSize=EM * PX // 2,
        ySuperscriptXSize=EM * PX // 2, ySuperscriptYSize=EM * PX // 2,
        version=4,
    )
    fb.setupPost(underlinePosition=-2 * G * PX, underlineThickness=G * PX, isFixedPitch=0)
    gasp = newTable("gasp")
    gasp.version = 1
    gasp.gaspRange = {0xFFFF: 0x000A}
    fb.font["gasp"] = gasp
    # A (no-op) prep program marks the font as hinted, so FreeType (Linux, Android, ChromeOS) uses the
    # TrueType interpreter instead of its auto-hinter, which would otherwise nudge isolated accent
    # pixels by a row. The outlines are already on the pixel grid at every multiple of EM px.
    prep = newTable("prep")
    prep.program = ttProgram.Program()
    prep.program.fromAssembly(["SVTCA[0]"])
    fb.font["prep"] = prep

    # ---- features: calt (alternates) + kern + mark
    fea = ["languagesystem DFLT dflt;", "languagesystem latn dflt;", "languagesystem cyrl dflt;",
           "languagesystem geor dflt;", ""]
    if alts and alt_count > 1:
        bases = sorted(alts, key=order.index)
        for v in range(alt_count):
            names = bases if v == 0 else [alts[b][v - 1] for b in bases]
            fea.append(f"@ALT{v} = [{' '.join(names)}];")
        fea.append("feature calt {")
        fea.append("  lookup cycle {")
        for v in range(alt_count - 1):
            # the glyph after a variant-v glyph takes variant v+1; after the last variant it starts over
            fea.append(f"    sub @ALT{v} @ALT0' by @ALT{v + 1};")
        fea.append("  } cycle;")
        fea.append("} calt;")
        fea.append("")

    def with_alts(gs):
        return " ".join(n for g in gs for n in [g.name] + alts.get(g.name, []))
    lname, rname = {}, {}
    for i, (k, gs) in enumerate(lcls.items()):
        lname[k] = f"@kL{i}"
        fea.append(f"@kL{i} = [{with_alts(gs)}];")
    for i, (k, gs) in enumerate(rcls.items()):
        rname[k] = f"@kR{i}"
        fea.append(f"@kR{i} = [{with_alts(gs)}];")
    fea.append("feature kern {")
    for (lk, rk), v in sorted(pairs.items(), key=lambda kv: (lname[kv[0][0]], rname[kv[0][1]])):
        fea.append(f"  pos {lname[lk]} {rname[rk]} {v * PX};")
    fea.append("} kern;")

    marks = [g for g in encoded if g.mark]
    if marks:
        bottom_marks = {"cedilla", "ogonek"}
        fea.append("")
        for m in marks:
            mb = m.bbox()
            mc = mark_center(m)   # whole-pixel anchors only, or the mark would land between pixels
            cx = (math.floor(mc) if m.round == "up" else math.ceil(mc)) * PX
            if COMBINING[m.key] in bottom_marks:
                fea.append(f"markClass {m.name} <anchor {cx} {(mb[3] + 1 + G) * PX}> @BOTTOM;")
            else:
                fea.append(f"markClass {m.name} <anchor {cx} {(mb[1] - G) * PX}> @TOP;")
        fea.append("feature mark {")
        for g in encoded:
            if g.mark or not g.ink or not unicodedata.category(chr(g.key)).startswith("L"):
                continue
            b = g.bbox()
            cx = math.ceil(ink_center(g) - 0.5) * PX
            for n in [g.name] + alts.get(g.name, []):
                fea.append(f"  pos base {n} <anchor {cx} {(b[3] + 1) * PX}> mark @TOP "
                           f"<anchor {cx} {min(b[1], 0) * PX}> mark @BOTTOM;")
        fea.append("} mark;")

    fb.font["OS/2"].recalcUnicodeRanges(fb.font)
    fea_text = "\n".join(fea) + "\n"
    addOpenTypeFeaturesFromString(fb.font, fea_text)

    out.mkdir(parents=True, exist_ok=True)
    ttf = out / f"{ps}.ttf"
    fb.save(ttf)
    for flavor in ("woff2", "woff"):
        f = TTFont(ttf)
        f.flavor = flavor
        f.save(out / f"{ps}.{flavor}")
    (HERE / "build").mkdir(exist_ok=True)
    (HERE / "build" / f"{ps}.fea").write_text(fea_text, encoding="utf-8")

    kern_pairs = {}
    for (lk, rk), v in pairs.items():
        for a in lcls[lk]:
            for b in rcls[rk]:
                kern_pairs[(a.key, b.key)] = v
    if not level:   # BMFont and JSON only for the clean font; worn levels need calt, so they ship as TTF/WOFF
        view = [Glyph(key=g.key, ink=shapes[g.name], adv=g.adv, name=g.name, mark=g.mark) for g in encoded]
        write_bitmap_outputs(view, kern_pairs, family, ps, out)
        write_json(view, kern_pairs, family, out / f"{ps}.json")
    print(f"{ps}: {len(encoded)} glyphs + {sum(len(v) for v in alts.values())} alternates, "
          f"{len(pairs)} class kerning pairs ({len(kern_pairs)} glyph pairs), {len(lcls)}x{len(rcls)} classes")
    return kern_pairs


def build(grid=16):
    configure(grid)
    glyphs = load_glyphs()
    make_font(glyphs, FAMILY, PS_NAME, OUT)
    if G > 1:
        cfg = json.loads((HERE / "wear.json").read_text(encoding="utf-8"))
        for i, level in enumerate(cfg["levels"], 1):
            make_font(glyphs, f"{FAMILY} Worn {i}", f"{PS_NAME.split('-')[0]}Worn{i}-Regular", OUT,
                      level, cfg.get("alternates", 3))
    print("written to", OUT.relative_to(ROOT))
    return glyphs


def write_bitmap_outputs(encoded, kern_pairs, family, ps, out):
    """BMFont (text .fnt) with a 1x atlas; line height = em, base = line ascent."""
    from PIL import Image
    cells = [g for g in encoded if not g.mark]
    pad = 1
    W = 512 * G
    x = y = pad
    rowh = LINE_ASC + LINE_DESC
    placed = []
    for g in cells:
        b = g.bbox()
        w = (b[2] - b[0] + 1) if b else 0
        if x + w + pad > W:
            x = pad
            y += rowh + pad
        placed.append((g, x, y, w))
        x += w + pad
    H = 1
    while H < y + rowh + pad:
        H *= 2
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    px = img.load()
    lines = [
        f'info face="{family}" size={EM} bold=0 italic=0 charset="" unicode=1 stretchH=100 smooth=0 aa=1 '
        f'padding=0,0,0,0 spacing={pad},{pad} outline=0',
        f"common lineHeight={LINE_ASC + LINE_DESC} base={LINE_ASC} scaleW={W} scaleH={H} pages=1 packed=0",
        f'page id=0 file="{ps}_0.png"',
        f"chars count={len(placed)}",
    ]
    for g, gx, gy, w in placed:
        b = g.bbox()
        if b:
            for (ix, iy) in g.ink:
                px[gx + ix - b[0], gy + (LINE_ASC - 1 - iy)] = (255, 255, 255, 255)
            lines.append(f"char id={g.key} x={gx} y={gy} width={w} height={rowh} "
                         f"xoffset={b[0]} yoffset=0 xadvance={g.adv} page=0 chnl=15")
        else:
            lines.append(f"char id={g.key} x=0 y=0 width=0 height=0 xoffset=0 yoffset=0 "
                         f"xadvance={g.adv} page=0 chnl=15")
    lines.append(f"kernings count={len(kern_pairs)}")
    for (a, b), v in sorted(kern_pairs.items()):
        lines.append(f"kerning first={a} second={b} amount={v}")
    (out / f"{ps}.fnt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    img.save(out / f"{ps}_0.png")


def write_json(encoded, kern_pairs, family, path):
    data = {
        "family": family, "version": VERSION, "unitsPerPixel": PX, "em": EM,
        "capHeight": CAP, "xHeight": XH, "ascender": ASC, "descender": DESC,
        "lineAscent": LINE_ASC, "lineDescent": LINE_DESC, "lineHeight": LINE_ASC + LINE_DESC,
        "glyphs": {},
        "kerning": {},
    }
    for g in encoded:
        if g.mark:
            continue
        b = g.bbox()
        rows = []
        if b:
            for yy in range(b[3], b[1] - 1, -1):
                rows.append("".join("#" if (xx, yy) in g.ink else "." for xx in range(b[0], b[2] + 1)))
        data["glyphs"][chr(g.key)] = {"adv": g.adv, "x": b[0] if b else 0, "top": b[3] if b else 0, "rows": rows}
    for (a, b), v in kern_pairs.items():
        data["kerning"].setdefault(chr(a), {})[chr(b)] = v
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--grid", type=int, default=16, choices=(16, 32))
    build(ap.parse_args().grid)
