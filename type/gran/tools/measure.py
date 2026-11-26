"""Measure reference fonts (or Gran masters) the way a type designer does:
stems, horizontals, widths, sidebearings, overshoots, join depth.
Usage: measure.py FONT 'tag=val,tag=val' [glyphs...]"""
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.basePen import BasePen


class Flat(BasePen):
    def __init__(self, gs, n=24):
        super().__init__(gs)
        self.polys, self.cur, self.n = [], [], n

    def _moveTo(self, p):
        self.cur = [p]

    def _lineTo(self, p):
        self.cur.append(p)

    def _curveToOne(self, a, b, c):
        p0 = self.cur[-1]
        for i in range(1, self.n + 1):
            t = i / self.n; m = 1 - t
            self.cur.append((m**3*p0[0]+3*m*m*t*a[0]+3*m*t*t*b[0]+t**3*c[0],
                             m**3*p0[1]+3*m*m*t*a[1]+3*m*t*t*b[1]+t**3*c[1]))

    def _qCurveToOne(self, a, b):
        p0 = self.cur[-1]
        for i in range(1, self.n + 1):
            t = i / self.n; m = 1 - t
            self.cur.append((m*m*p0[0]+2*m*t*a[0]+t*t*b[0], m*m*p0[1]+2*m*t*a[1]+t*t*b[1]))

    def _closePath(self):
        if self.cur:
            self.polys.append(self.cur)
        self.cur = []
    _endPath = _closePath


def load(path, loc):
    f = TTFont(path)
    if loc and 'fvar' in f:
        f = instantiateVariableFont(f, loc)
    return f


def polys(f, g):
    gs = f.getGlyphSet()
    pen = Flat(gs)
    gs[g].draw(pen)
    return pen.polys, gs[g].width


def runs_h(P, y):
    """Filled x-runs along horizontal line y (nonzero)."""
    xs = []
    for poly in P:
        for i in range(len(poly)):
            (x0, y0), (x1, y1) = poly[i], poly[(i + 1) % len(poly)]
            if (y0 <= y < y1) or (y1 <= y < y0):
                x = x0 + (y - y0) * (x1 - x0) / (y1 - y0)
                xs.append((x, 1 if y1 > y0 else -1))
    xs.sort()
    out, w, start = [], 0, None
    for x, d in xs:
        nw = w + d
        if w == 0 and nw != 0:
            start = x
        elif w != 0 and nw == 0:
            out.append((start, x))
        w = nw
    return out


def runs_v(P, x):
    T = [[(q[1], q[0]) for q in p] for p in P]
    return runs_h(T, x)


def bounds(P):
    xs = [q[0] for p in P for q in p]; ys = [q[1] for p in P for q in p]
    return min(xs), min(ys), max(xs), max(ys)


def report(path, loc, names):
    f = load(path, loc)
    upm = f['head'].unitsPerEm
    k = 1000 / upm
    cmap = f.getBestCmap()
    def gname(ch):
        return cmap.get(ord(ch))
    out = {}
    xg = gname('x') or gname('х')
    xh = bounds(polys(f, xg)[0])[3] * k
    cap = bounds(polys(f, gname('H') or gname('Н'))[0])[3] * k
    out['xh'] = round(xh); out['cap'] = round(cap)
    for ch in names:
        g = gname(ch)
        if not g:
            continue
        P, adv = polys(f, g)
        P = [[(x * k, y * k) for x, y in p] for p in P]
        adv *= k
        x0, y0, x1, y1 = bounds(P)
        d = dict(adv=round(adv), lsb=round(x0), rsb=round(adv - x1), w=round(x1 - x0),
                 top=round(y1), bot=round(y0))
        H = cap if ch.isupper() else xh
        mid = runs_h(P, H * 0.5)
        d['runs_mid'] = [(round(a), round(b - a)) for a, b in mid]
        cx = (x0 + x1) / 2
        vr = runs_v(P, cx)
        d['runs_vcenter'] = [(round(a), round(b - a)) for a, b in vr]
        if ch in 'nh':
            # join: lowest point where the arch's inner edge meets the stem
            st = runs_h(P, H * 0.3)[0]
            xs = st[1] + 1
            col = runs_v(P, xs)
            d['join_inner_y'] = round(col[-1][0]) if col else None
            d['arch_top_thick'] = round(vr[-1][1]) if vr else None
        out[ch] = d
    return out


if __name__ == '__main__':
    path = sys.argv[1]
    loc = {}
    if len(sys.argv) > 2 and sys.argv[2]:
        for kv in sys.argv[2].split(','):
            a, b = kv.split('=')
            loc[a] = float(b)
    names = sys.argv[3] if len(sys.argv) > 3 else 'HOnoaЖд'
    import json
    print(json.dumps(report(path, loc, names), ensure_ascii=False))
