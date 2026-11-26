"""Gran lowercase and the rest of the set needed for the reference line
"Whereas disregard and contempt for human rights have resulted".

The grotesk follows the client's reference (DM Sans): widths, sidebearings
and vertical metrics below were measured on DM Sans at opsz 14 and 33;
curves are then fitted per glyph (tools/fit.py -> fitted.json). The
antiqua gets serifs, flags and teardrops on the same skeletons; in the
grotesk those features collapse to zero size, so all masters stay
compatible.
"""
import math
from geom import C, poly, rect, oval, mirror, norm, add, sub, mul, \
    blade_serif, expand_open, cap_points, pen_width
import glyphs as G0
from glyphs import serifs_v

# ink width, left and right sidebearing, measured on the reference
LC = {
    12: {'h': (444, 70, 61), 'r': (275, 70, 25), 's': (408, 43, 51), 'd': (509, 49, 70),
         'i': (116, 62, 62), 'g': (493, 38, 27), 'c': (475, 49, 49), 't': (318, 34, 40),
         'm': (761, 70, 61), 'p': (508, 70, 48), 'f': (287, 21, 31), 'u': (443, 61, 69),
         'v': (479, 24, 24), 'l': (84, 70, 69), 'W': (916, 27, 25), 'e': (477, 49, 43)},
    33: {'h': (445, 56, 46), 'r': (269, 53, 13), 's': (407, 27, 33), 'd': (511, 35, 56),
         'i': (117, 50, 49), 'g': (489, 37, 26), 'c': (474, 35, 35), 't': (316, 17, 20),
         'm': (768, 53, 45), 'p': (511, 56, 36), 'f': (281, 15, 19), 'u': (445, 45, 53),
         'v': (467, 13, 13), 'l': (84, 56, 56), 'W': (939, 14, 14), 'e': (479, 35, 30)},
}
VM = {12: dict(asc=720, tT=626, gB=-232, pB=-220, iT=725),
      33: dict(asc=709, tT=615, gB=-221, pB=-209, iT=716)}


def q(p, k, d):
    return p.get(k, d)


def met(p, ch):
    """(ink width, lsb, rsb) for this master. The antiqua adds room for
    serifs on stem sides."""
    w, l, r = LC[p["opsz"]][ch]
    if p["genre"] == "A":
        w *= 0.99
    return w, l, r


def stem_sb(p, sb):
    return sb * (0.55 if p["genre"] == "A" else 1.0) + p["lproj"] * 0.85


def V(p, k):
    return VM[p["opsz"]][k]


def null_c(P, n_l=2, n_c=1):
    """A degenerate contour with a fixed structure (for features absent in a
    master that are drawn by a branch)."""
    return {"kind": "fill", "start": P,
            "segs": [("L", P)] * n_l + [("C", P, P, P)] * n_c + [("L", P)]}


def flag(p, L0, L1, yTop):
    """Antiqua head serif on a stem whose top is at yTop (stem top slanted
    by the same slope); a point in the grotesk."""
    s, hp, htt, hbh = p["slope"], p["hp"], p["htt"], p["hbh"]
    v = L1 - L0
    yTL = yTop - s * v
    if not hp:
        P = (L0, yTL)
        return {"kind": "fill", "start": P,
                "segs": [("L", P), ("L", P), ("C", P, P, P), ("L", P), ("L", P)]}
    tipT = (L0 - hp, yTL - s * hp)
    tipB = (L0 - hp, tipT[1] - htt)
    D = (L0, tipB[1] - hbh)
    hc = C((L0 + 12, yTL + s * 12 - 1))
    hc.L(tipT)
    hc.L(tipB)
    hc.Cu((tipB[0] + hp * 0.55, tipB[1]), (L0, D[1] + hbh * 0.5), D)
    hc.L((L0 + 12, D[1]))
    return hc.close()


def stem_top(p, L0, L1, yTop, notch=False):
    """Stem polygon from the baseline to yTop: slanted top in the antiqua."""
    v = L1 - L0
    yTL = yTop - p["slope"] * v
    return poly([(L0, 0), (L0, yTL), (L1, yTop), (L1, 0)])


def beak(p, P, side, h, w):
    """Antiqua beak: a wedge hanging from a horizontal terminal cut at P,
    growing downward on the outer side; a point in the grotesk."""
    if p["genre"] == "G" or h <= 0:
        return poly([P, P, P])
    return poly([(P[0] - side * w, P[1]), P, (P[0] + side * w * 0.15, P[1] - h)])


def ball(p, at, r):
    """Teardrop terminal (antiqua); a point in the grotesk."""
    if r <= 0:
        r = 0.0
    return oval(at[0] - r, at[1] - r * 1.06, at[0] + r, at[1] + r * 0.94, 0.56)


def arch(p, L1, R0, R1, top_stem=None, pre=""):
    """The n shoulder between a left stem (right edge L1) and a right stem
    [R0, R1]; same construction and fitted parameters as n."""
    xh, v, hl, ov = p["xh"], p["v"], p["hl"], p["ovl"]
    top = xh + ov
    yJo = xh * p["yJo"]
    K = (L1, xh * p["yC"])
    ySh = xh * p["ySh"]
    xt = L1 + (R1 - L1) * p["xT"]
    hA = hl * (1.0 if p["genre"] == "G" else 1.25)
    ti = top - hA
    xti = (L1 + (R0 - L1) * p["xTi"]) if p["xTi"] > 0.2 else xt + (R0 - L1) * p["xTi"]
    d0 = norm((0.40, 1.0))
    a = C((L1 - v * 0.5, yJo))
    a.L((L1, yJo))
    a.Cu(add((L1, yJo), mul(d0, (top - yJo) * q(p, "nJoK", 0.95))),
         (xt - (xt - L1) * q(p, "nLeftK", 0.52), top), (xt, top))
    a.Cu((xt + (R1 - xt) * q(p, "nShK", 0.60), top), (R1, ySh + (top - ySh) * q(p, "nShV", 0.56)), (R1, ySh))
    a.L((R0, ySh))
    a.Cu((R0, ySh + (ti - ySh) * 0.54), (xti + (R0 - xti) * 0.60, ti), (xti, ti))
    dK = norm((0.30 * p["joinK"], 1.0))
    a.Cu((xti - (xti - L1) * 0.58, ti), add(K, mul(dK, (ti - K[1]) * 0.50)), K)
    a.L((L1 - v * 0.5, K[1]))
    return a.close(), ySh, yJo


# ------------------------------------------------------------- straight ones

def l_(p):
    w, lsb, rsb = met(p, 'l')
    v = p["v"]
    L0 = stem_sb(p, lsb)
    L1 = L0 + v
    asc = V(p, "asc")
    cs = [stem_top(p, L0, L1, asc), flag(p, L0, L1, asc)]
    cs += serifs_v(p, L0, L1, 0, False, caps=False)
    return cs, L1 + stem_sb(p, rsb)


def i_(p):
    w, lsb, rsb = met(p, 'i')
    v, xh = p["v"], p["xh"]
    d = w * q(p, "iDot", 1.0) if p["genre"] == "G" else v * 1.30
    L0 = stem_sb(p, lsb) + (d - v) / 2
    L1 = L0 + v
    cx = (L0 + L1) / 2
    top = V(p, "iT")
    dot = oval(cx - d / 2, top - d, cx + d / 2, top, q(p, "iTens", 0.60))
    cs = [stem_top(p, L0, L1, xh), flag(p, L0, L1, xh), dot]
    cs += serifs_v(p, L0, L1, 0, False, caps=False)
    return cs, L1 + (d - v) / 2 + stem_sb(p, rsb)


def h_(p):
    w, lsb, rsb = met(p, 'h')
    v = p["v"]
    L0 = stem_sb(p, lsb)
    L1 = L0 + v
    R1 = L0 + w
    R0 = R1 - v
    asc = V(p, "asc")
    a, ySh, yJo = arch(p, L1, R0, R1)
    cs = [stem_top(p, L0, L1, asc), rect(R0, 0, R1, ySh + 8), a, flag(p, L0, L1, asc)]
    cs += serifs_v(p, L0, L1, 0, False, caps=False)
    cs += serifs_v(p, R0, R1, 0, False, caps=False)
    return cs, R1 + stem_sb(p, rsb)


def m_(p):
    w, lsb, rsb = met(p, 'm')
    v, xh = p["v"], p["xh"]
    L0 = stem_sb(p, lsb)
    L1 = L0 + v
    R1 = L0 + w
    R0 = R1 - v
    M0 = (L0 + R1) / 2 - v / 2 + q(p, "mMid", 0.0)
    M1 = M0 + v
    a1, ySh, yJo = arch(p, L1, M0, M1)
    a2, _, _ = arch(p, M1, R0, R1)
    tq = v * p.get("nTaper", 0.0)
    stem = poly([(L0, 0), (L0, xh - p["slope"] * v), (L1 - tq, xh), (L1, yJo), (L1, 0)])
    cs = [stem, rect(M0, 0, M1, ySh + 8), rect(R0, 0, R1, ySh + 8), a1, a2,
          flag(p, L0, L1, xh)]
    for x0_, x1_ in ((L0, L1), (M0, M1), (R0, R1)):
        cs += serifs_v(p, x0_, x1_, 0, False, caps=False)
    return cs, R1 + stem_sb(p, rsb)


def u_(p):
    """u is n turned by 180 degrees (stems, shoulder, serifs, flag)."""
    w, lsb, rsb = met(p, 'u')
    pp = dict(p, wn=w)
    cs, adv = G0.n(pp)
    xh = p["xh"]
    L0 = pp["sbStemL"]
    R1 = L0 + w
    # rotate around the centre of the ink box
    cx = (L0 + R1) / 2

    def rot(c):
        f = lambda P: (2 * cx - P[0], xh - P[1])  # noqa: E731
        return {"kind": c["kind"], "start": f(c["start"]),
                "segs": [(s[0],) + tuple(f(P) for P in s[1:]) for s in c["segs"]]}
    cs = [rot(c) for c in cs]
    # place with the reference sidebearings
    dx = stem_sb(p, lsb) - L0
    cs = [G0_shift(c, dx) for c in cs]
    return cs, stem_sb(p, lsb) + w + stem_sb(p, rsb)


def G0_shift(c, dx, dy=0):
    f = lambda P: (P[0] + dx, P[1] + dy)  # noqa: E731
    return {"kind": c["kind"], "start": f(c["start"]),
            "segs": [(s[0],) + tuple(f(P) for P in s[1:]) for s in c["segs"]]}


def r_(p):
    w, lsb, rsb = met(p, 'r')
    xh, v, hl, ov = p["xh"], p["v"], p["hl"], p["ovl"]
    Gn = p["genre"] == "G"
    L0 = stem_sb(p, lsb)
    L1 = L0 + v
    Re = L0 + w                              # end of the arm
    top = xh + ov
    yJo = xh * q(p, "rJo", p["yJo"])
    K = (L1, xh * q(p, "rC", p["yC"]))
    xt = L1 + (Re - L1) * q(p, "rXt", 0.55)
    hA = hl * q(p, "rHa", 1.0 if Gn else 1.2)
    yEo = xh * q(p, "rEo", 0.86)             # arm end, outer (upper) corner
    yEi = yEo - hl * q(p, "rEw", 1.0)        # arm end, inner corner
    tq = v * p.get("nTaper", 0.0)
    stem = poly([(L0, 0), (L0, xh - p["slope"] * v), (L1 - tq, xh), (L1, yJo), (L1, 0)])
    a = C((L1 - v * 0.5, yJo))
    a.L((L1, yJo))
    a.Cu(add((L1, yJo), mul(norm((0.40, 1.0)), (top - yJo) * q(p, "rJoK", 0.9))),
         (xt - (xt - L1) * q(p, "rLk", 0.45), top), (xt, top))
    a.Cu((xt + (Re - xt) * q(p, "rRk", 0.55), top),
         (Re, yEo + (top - yEo) * q(p, "rRv", 0.45)), (Re, yEo))
    a.L((Re, yEi))
    ti = top - hA
    xti = xt + (Re - xt) * 0.05
    a.Cu((Re, yEi + (ti - yEi) * q(p, "rIv", 0.5)), (xti + (Re - xti) * q(p, "rIk", 0.45), ti), (xti, ti))
    a.Cu((xti - (xti - L1) * 0.58, ti), add(K, mul(norm((0.30, 1.0)), (ti - K[1]) * 0.50)), K)
    a.L((L1 - v * 0.5, K[1]))
    arm = a.close()
    cs = [stem, arm, flag(p, L0, L1, xh), beak(p, (Re, yEi), +1, v * 0.45, v * 0.6)]
    cs += serifs_v(p, L0, L1, 0, False, caps=False)
    return cs, Re + rsb * (0.6 if not Gn else 1.0)


# ----------------------------------------------------------- stem + bowl

def bowl(p, Sx, x0, yb, yt, pre="b", jt=0.83, jb=0.17, ct=0.62, cb=0.32):
    """Bowl attached to a stem standing on its right (stem left edge Sx).
    Outer contour and counter; both join the stem with thin crotches.
    yb/yt: bottom and top of the bowl (overshoots included)."""
    xh, v, hl = p["xh"], p["v"], p["hl"]
    k = lambda n, d: q(p, pre + n, d)  # noqa: E731
    H = yt - yb
    yJt = yb + H * k("Jt", jt)
    yJb = yb + H * k("Jb", jb)
    ym = yb + H * k("M", 0.5)
    xT = x0 + (Sx - x0) * k("Tx", 0.55)
    xB = x0 + (Sx - x0) * k("Bx", 0.55)
    o = C((Sx + v * 0.45, yJt))
    o.L((Sx, yJt))
    o.Cu(add((Sx, yJt), mul(norm((-k("Jd", 0.4), 1.0)), (yt - yJt) * k("J1", 0.9))),
         (xT + (Sx - xT) * k("T1", 0.5), yt), (xT, yt))
    o.Cu((xT - (xT - x0) * k("T2", 0.56), yt), (x0, ym + (yt - ym) * k("L1", 0.56)), (x0, ym))
    o.Cu((x0, ym - (ym - yb) * k("L2", 0.56)), (xB - (xB - x0) * k("B2", 0.56), yb), (xB, yb))
    o.Cu((xB + (Sx - xB) * k("B1", 0.5), yb),
         add((Sx, yJb), mul(norm((-k("Jd2", 0.4), -1.0)), (yJb - yb) * k("J2", 0.9))), (Sx, yJb))
    o.L((Sx + v * 0.45, yJb))
    outer = o.close()
    side = v * k("Side", 1.02)
    th = hl * k("Th", 1.0)
    bh = hl * k("Bh", 1.0)
    yCt = yb + H * k("Ct", ct)
    yCb = yb + H * k("Cb", cb)
    cyT, cyB = yt - th, yb + bh
    cx0 = x0 + side
    cym = cyB + (cyT - cyB) * k("CM", 0.5)
    cxT = cx0 + (Sx - cx0) * k("CTx", 0.5)
    cxB = cx0 + (Sx - cx0) * k("CBx", 0.5)
    c = C((Sx, yCt), kind="hole")
    c.Cu(add((Sx, yCt), mul(norm((-k("Cd", 0.3), 1.0)), (cyT - yCt) * k("C1", 0.9))),
         (cxT + (Sx - cxT) * k("CT1", 0.5), cyT), (cxT, cyT))
    c.Cu((cxT - (cxT - cx0) * k("CT2", 0.56), cyT), (cx0, cym + (cyT - cym) * k("CL1", 0.56)), (cx0, cym))
    c.Cu((cx0, cym - (cym - cyB) * k("CL2", 0.56)), (cxB - (cxB - cx0) * k("CB2", 0.56), cyB), (cxB, cyB))
    c.Cu((cxB + (Sx - cxB) * k("CB1", 0.5), cyB),
         add((Sx, yCb), mul(norm((-k("Cd2", 0.3), -1.0)), (yCb - cyB) * k("C2", 0.9))), (Sx, yCb))
    counter = c.close()
    return outer, counter


def d_(p):
    w, lsb, rsb = met(p, 'd')
    xh, v, ov = p["xh"], p["v"], p["ovl"]
    x0 = lsb
    R1 = x0 + w
    R0 = R1 - v
    asc = V(p, "asc")
    outer, counter = bowl(p, R0, x0, -ov, xh + ov, "b")
    stem = poly([(R0, 0), (R0, asc - p["slope"] * v), (R1, asc), (R1, 0)])
    cs = [stem, outer, counter, flag(p, R0, R1, asc)]
    cs.append(blade_serif((R1, 0), (0, 1), +1, p["lproj"] * 0.85, p["ltt"], p["lbh"] * 0.8,
                          3 if p["proj"] else 0))
    return cs, R1 + stem_sb(p, rsb)


def p_(p):
    w, lsb, rsb = met(p, 'p')
    xh, v, ov = p["xh"], p["v"], p["ovl"]
    L0 = stem_sb(p, lsb)
    L1 = L0 + v
    xR = L0 + w                              # right edge of the bowl
    desc = V(p, "pB")
    # build the bowl as if it hung left of a stem, then mirror it
    ax = (L1 + xR) / 2
    Sx_m = 2 * ax - L1
    x0_m = 2 * ax - xR
    outer, counter = bowl(p, Sx_m, x0_m, -ov, xh + ov, "p")
    outer, counter = mirror(outer, ax), mirror(counter, ax)
    tq = v * p.get("nTaper", 0.0)
    yJ = (xh + 2 * ov) * q(p, "pJt", 0.83) - ov
    stem = poly([(L0, desc), (L0, xh - p["slope"] * v), (L1 - tq, xh), (L1, yJ), (L1, desc)])
    cs = [stem, outer, counter, flag(p, L0, L1, xh)]
    cs += serifs_v(p, L0, L1, desc, False, caps=False)
    return cs, xR + rsb


def g_(p):
    """Double-storey g, as in the reference: a small upper bowl with a flat
    ear at the x-height, a link and a wide lower loop below the baseline."""
    w, lsb, rsb = met(p, 'g')
    xh, v, hl, ov = p["xh"], p["v"], p["hl"], p["ovl"]
    Gn = p["genre"] == "G"
    x0, x1 = lsb, lsb + w
    gB = V(p, "gB")
    # upper bowl
    ux0 = x0 + w * q(p, "gUx0", 0.04)
    ux1 = x0 + w * q(p, "gUx1", 0.70)
    uy0 = xh * q(p, "gUy0", 0.20)
    uy1 = xh + ov
    us = v * q(p, "gUs", 1.0)
    ut = hl * q(p, "gUt", 0.95)
    uo = oval(ux0, uy0, ux1, uy1, q(p, "gUto", 0.57))
    ui = oval(ux0 + us, uy0 + ut, ux1 - us, uy1 - ut, q(p, "gUti", 0.57), kind="hole")
    # ear
    eh = hl * q(p, "gEh", 0.95)
    ear = rect(ux1 - v * q(p, "gEi", 1.2), xh - eh, x1, xh)
    # lower loop
    lx0 = x0 + w * q(p, "gLx0", 0.0)
    lx1 = x1 - w * q(p, "gLx1", 0.03)
    ly1 = xh * q(p, "gLy1", 0.07)
    ls = v * q(p, "gLs", 1.0)
    lo = oval(lx0, gB, lx1, ly1, q(p, "gLto", 0.58))
    li = oval(lx0 + ls, gB + hl * q(p, "gLb", 1.0), lx1 - ls, ly1 - hl * q(p, "gLt", 0.95),
              q(p, "gLti", 0.6), kind="hole")
    # link from the upper bowl down into the loop
    S = (ux0 + w * q(p, "gKsx", 0.12), uy0 + (uy1 - uy0) * q(p, "gKsy", 0.10))
    T = (lx0 + w * q(p, "gKtx", 0.14), ly1 - hl * q(p, "gKty", 0.45))
    d = norm(sub(T, S))
    nrm = (-d[1], d[0])
    kw = v * q(p, "gKw", 0.9) / 2
    link = poly([add(S, mul(nrm, kw)), add(T, mul(nrm, kw)), sub(T, mul(nrm, kw)), sub(S, mul(nrm, kw))])
    cs = [uo, ui, ear, lo, li, link, beak(p, (x1, xh - eh), +1, v * 0.40, v * 0.5)]
    return cs, x1 + rsb


# ------------------------------------------------------------ round, open

def _split(b, t):
    p0, p1, p2, p3 = b
    l = lambda a, c: (a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t)  # noqa: E731
    a = l(p0, p1); bb = l(p1, p2); c = l(p2, p3)
    d = l(a, bb); e = l(bb, c); f = l(d, e)
    return (p0, a, d, f), (f, e, c, p3)


def _pt(b, t):
    return _split(b, t)[0][3]


def _segs(ov):
    out, prev = [], ov["start"]
    for s in ov["segs"]:
        out.append((prev, s[1], s[2], s[3]))
        prev = s[3]
    return out


def _rev(b):
    return (b[3], b[2], b[1], b[0])


def _solve(f, a=0.0, b=1.0, n=40):
    fa = f(a)
    for _ in range(n):
        m = (a + b) / 2
        fm = f(m)
        if (fm > 0) == (fa > 0):
            a, fa = m, fm
        else:
            b = m
    return (a + b) / 2


def _cut_t(seg, P, u):
    """Parameter where a cubic crosses the line through P with direction u."""
    def f(t):
        X = _pt(seg, t)
        return u[0] * (X[1] - P[1]) - u[1] * (X[0] - P[0])
    return _solve(f)


def _y_t(seg, y):
    return _solve(lambda t: _pt(seg, t)[1] - y)


def rings(p, w, x0, pre):
    xh, v, hl, ov = p["xh"], p["v"], p["hl"], p["ovl"]
    k = lambda n, d: q(p, pre + n, d)  # noqa: E731
    side = v * p["sideK"] * k("Side", 1.0)
    top = side * p["topK"] if p["genre"] == "G" else hl * 1.05
    top *= k("Top", 1.0)
    x1 = x0 + w
    y0, y1 = -ov, xh + ov
    outer = oval(x0, y0, x1, y1, k("To", p.get("tensOo", p["tensO"])))
    inner = oval(x0 + side, y0 + top * k("Bot", 1.0), x1 - side, y1 - top,
                 k("Ti", p.get("tensIo", p["tensI"])))
    return _segs(outer), _segs(inner), (x0, x1, y0, y1)


def _path(c, segs):
    for b in segs:
        c.Cu(b[1], b[2], b[3])


def c_(p):
    w, lsb, rsb = met(p, 'c')
    Gn = p["genre"] == "G"
    so, si, (x0, x1, y0, y1) = rings(p, w, lsb, "c")
    # top terminal: on the outer top-right quarter, cut at an angle
    tTo = q(p, "cTt", 0.62)
    To = _pt(so[0], tTo)
    ua = math.radians(q(p, "cTa", 90.0))          # 90 = horizontal cut
    uT = (math.sin(ua), -math.cos(ua))
    tTi = _cut_t(si[0], To, uT)
    tBo = q(p, "cBt", 0.38)
    Bo = _pt(so[1], tBo)
    ub = math.radians(q(p, "cBa", 90.0))
    uB = (math.sin(ub), math.cos(ub))
    tBi = _cut_t(si[1], Bo, uB)
    o0a, _ = _split(so[0], tTo)                  # top .. terminal
    _, o1b = _split(so[1], tBo)                  # terminal .. bottom
    i0a, _ = _split(si[0], tTi)
    _, i1b = _split(si[1], tBi)
    c = C(To)
    _path(c, [_rev(o0a), _rev(so[3]), _rev(so[2]), _rev(o1b)])
    c.L(i1b[0])
    _path(c, [i1b, si[2], si[3], i0a])
    body = c.close()
    bk = beak(p, To, +1, p["v"] * 0.55, p["v"] * 0.9)
    return [body, bk], x1 + rsb


def e_(p):
    w, lsb, rsb = met(p, 'e')
    xh, hl = p["xh"], p["hl"]
    so, si, (x0, x1, y0, y1) = rings(p, w, lsb, "e")
    bar = hl * q(p, "eBar", 0.95)
    yBb = xh * q(p, "eBy", 0.465)
    yBt = yBb + bar
    tBo = q(p, "eBt", 0.40)
    Bo = _pt(so[1], tBo)
    ub = math.radians(q(p, "eBa", 90.0))
    uB = (math.sin(ub), math.cos(ub))
    tBi = _cut_t(si[1], Bo, uB)
    _, o1b = _split(so[1], tBo)
    _, i1b = _split(si[1], tBi)
    t2 = _y_t(si[2], yBb) if si[2][3][1] >= yBb else 0.999
    i2a, _ = _split(si[2], t2)
    Pbl = i2a[3]
    ym = so[0][3][1]
    c = C(so[0][3])                              # right extreme
    _path(c, [_rev(so[0]), _rev(so[3]), _rev(so[2]), _rev(o1b)])
    c.L(i1b[0])
    _path(c, [i1b, i2a])
    c.L((x1, yBb))
    body = c.close()
    # eye: inner upper arc above the bar
    t3 = _y_t(si[3], yBt)
    _, i3b = _split(si[3], t3)
    t0 = _y_t(si[0], yBt)
    i0a, _ = _split(si[0], t0)
    k = C(i3b[0], kind="hole")
    _path(k, [i3b, i0a])
    eye = k.close()
    return [body, eye], x1 + rsb


def s_(p):
    """s as one pen stroke along an S-shaped spine."""
    w, lsb, rsb = met(p, 's')
    xh, v, hl, ov = p["xh"], p["v"], p["hl"], p["ovl"]
    Gn = p["genre"] == "G"
    x0, x1 = lsb, lsb + w
    thick = v * q(p, "sThick", 0.98)
    thin = hl * q(p, "sThin", 0.95)
    f = pen_width(thick, thin, p.get("tilt", 0), q(p, "sK", 1.4))
    wt = f((1, 0))
    top, bot = xh + ov - wt / 2, -ov + wt / 2
    Ts = (x1 - thick * q(p, "sTx", 0.45), xh * q(p, "sTy", 0.74))
    Tp = (x0 + w * q(p, "sTopX", 0.52), top)
    UL = (x0 + f((0, -1)) / 2 + w * q(p, "sULx", 0.0), xh * q(p, "sULy", 0.71))
    LR = (x1 - f((0, -1)) / 2 - w * q(p, "sLRx", 0.0), xh * q(p, "sLRy", 0.28))
    Bt = (x0 + w * q(p, "sBotX", 0.48), bot)
    Te = (x0 + thick * q(p, "sEx", 0.45), xh * q(p, "sEy", 0.25))
    k1, k2, k3 = q(p, "sk1", 0.55), q(p, "sk2", 0.55), q(p, "sk3", 0.6)
    segs = [
        (Ts, (Ts[0], Ts[1] + (top - Ts[1]) * k1), (Tp[0] + (Ts[0] - Tp[0]) * k2, top), Tp),
        (Tp, (Tp[0] - (Tp[0] - UL[0]) * k2, top), (UL[0], UL[1] + (top - UL[1]) * k1), UL),
        (UL, (UL[0], UL[1] - (UL[1] - LR[1]) * k3 * 0.55), (LR[0], LR[1] + (UL[1] - LR[1]) * k3 * 0.55), LR),
        (LR, (LR[0], LR[1] - (LR[1] - bot) * k1), (Bt[0] + (LR[0] - Bt[0]) * k2, bot), Bt),
        (Bt, (Bt[0] - (Bt[0] - Te[0]) * k2, bot), (Te[0], Te[1] - (Te[1] - bot) * k1), Te),
    ]
    a0 = math.radians(q(p, "sCa", 20.0))      # cut angle from the horizontal
    cut0 = (math.cos(a0), math.sin(a0))
    cut1 = (math.cos(a0), math.sin(a0))
    body = expand_open(segs, f, nsub=2, cut0=cut0, cut1=cut1)
    return [body], x1 + rsb


def t_(p):
    w, lsb, rsb = met(p, 't')
    xh, v, hl, ov = p["xh"], p["v"], p["hl"], p["ovl"]
    tT = V(p, "tT")
    x0 = lsb
    L0 = x0 + w * q(p, "tStem", 0.27)
    L1 = L0 + v
    xe = x0 + w                                   # tail end
    yT = xh * q(p, "tTail", 0.24)
    stem = poly([(L0, yT), (L0, tT - v * q(p, "tCut", 0.35)), (L1, tT), (L1, yT)])
    bar = rect(x0, xh - hl * q(p, "tBar", 1.0), x0 + w * q(p, "tBarR", 0.93), xh)
    xb = L0 + (xe - L0) * q(p, "tBx", 0.45)
    yEo = xh * q(p, "tEy", 0.03)
    hk = hl * q(p, "tHk", 1.0)
    t = C((L0, yT))
    t.Cu((L0, yT - (yT + ov) * q(p, "tO1", 0.6)), (xb - (xb - L0) * q(p, "tO2", 0.55), -ov), (xb, -ov))
    t.Cu((xb + (xe - xb) * q(p, "tO3", 0.5), -ov), (xe, yEo - (yEo + ov) * 0.4), (xe, yEo))
    t.L((xe, yEo + hk * q(p, "tEw", 0.98)))
    bi = -ov + hk
    xbi = xb + (xe - xb) * 0.02
    yEi = yEo + hk * q(p, "tEw", 0.98)
    t.Cu((xe, yEi - (yEi - bi) * 0.4), (xbi + (xe - xbi) * q(p, "tI3", 0.5), bi), (xbi, bi))
    t.Cu((xbi - (xbi - L1) * q(p, "tI2", 0.55), bi), (L1, yT - (yT - bi) * q(p, "tI1", 0.6)), (L1, yT))
    tail = t.close()
    return [stem, bar, tail], xe + rsb


def f_(p):
    w, lsb, rsb = met(p, 'f')
    xh, v, hl, ov = p["xh"], p["v"], p["hl"], p["ovl"]
    Gn = p["genre"] == "G"
    asc = V(p, "asc")
    x0 = lsb
    L0 = x0 + w * q(p, "fStem", 0.22)
    L1 = L0 + v
    xe = x0 + w
    yF = xh * q(p, "fJoin", 1.15)
    top = asc + q(p, "fOv", 0)
    xt = L0 + (xe - L0) * q(p, "fTx", 0.5)
    yEo = asc - (asc - xh) * q(p, "fEy", 0.18)
    hk = hl * q(p, "fHk", 1.0)
    stem = rect(L0, 0, L1, yF + 4)
    bar = rect(x0, xh - hl * q(p, "fBar", 1.0), x0 + w * q(p, "fBarR", 0.83), xh)
    h = C((L0, yF))
    h.Cu((L0, yF + (top - yF) * q(p, "fO1", 0.6)), (xt - (xt - L0) * q(p, "fO2", 0.55), top), (xt, top))
    h.Cu((xt + (xe - xt) * q(p, "fO3", 0.5), top), (xe, yEo + (top - yEo) * 0.4), (xe, yEo))
    yEi = yEo - hk * q(p, "fEw", 0.98)
    h.L((xe, yEi))
    ti = top - hk
    xti = xt + (xe - xt) * 0.02
    h.Cu((xe, yEi + (ti - yEi) * 0.4), (xti + (xe - xti) * q(p, "fI3", 0.5), ti), (xti, ti))
    h.Cu((xti - (xti - L1) * q(p, "fI2", 0.55), ti), (L1, yF + (ti - yF) * q(p, "fI1", 0.6)), (L1, yF))
    hook = h.close()
    cs = [stem, bar, hook, beak(p, (xe, yEi), +1, v * 0.45, v * 0.6)]
    cs += serifs_v(p, L0, L1, 0, False, caps=False)
    return cs, xe + rsb


# ------------------------------------------------------------- diagonals

def v_(p):
    w, lsb, rsb = met(p, 'v')
    xh, v = p["xh"], p["v"]
    Gn = p["genre"] == "G"
    x0, x1 = lsb, lsb + w
    xm = (x0 + x1) / 2
    wt = v * q(p, "vWt", 1.12)                     # horizontal width at the top
    wtR = wt * (1.0 if Gn else q(p, "vThinR", 0.45))
    wb = v * q(p, "vWb", 0.9)                      # flat vertex at the baseline
    yi = xh * q(p, "vYi", 0.26)                    # inner crotch height
    body = poly([(x0, xh), (x0 + wt, xh), (xm, yi), (x1 - wtR, xh), (x1, xh),
                 (xm + wb / 2, 0), (xm - wb / 2, 0)])
    cs = [body]
    dl = norm(((xm - wb / 2) - x0, -xh))
    dr = norm(((xm + wb / 2) - x1, -xh))
    ct = 3 if p["proj"] else 0
    for P, e, side, k in (((x0, xh), dl, -1, 0.8), ((x0 + wt, xh), dl, +1, 0.45),
                          ((x1 - wtR, xh), dr, -1, 0.45), ((x1, xh), dr, +1, 0.8)):
        cs.append(blade_serif(P, e, side, p["lproj"] * k, p["ltt"], p["lbh"] * 0.5, ct))
    return cs, x1 + rsb


def W_(p):
    w, lsb, rsb = met(p, 'W')
    cap, V_ = p["cap"], p["V"]
    Gn = p["genre"] == "G"
    x0, x1 = lsb, lsb + w
    xm = (x0 + x1) / 2
    b1 = x0 + w * q(p, "Wb", 0.27)
    b2 = x1 - w * q(p, "Wb", 0.27)
    wt = V_ * q(p, "WWt", 1.0)
    thin = 1.0 if Gn else q(p, "WThin", 0.45)
    wb = V_ * q(p, "WWb", 0.85)
    wm = V_ * q(p, "WWm", 0.85)                     # middle apex, flat
    mh = cap * q(p, "WMh", 1.0)                     # middle apex height

    def stroke(xt, wtop, xb, wbot, ytop):
        return poly([(xt - wtop / 2, ytop), (xt + wtop / 2, ytop),
                     (xb + wbot / 2, 0), (xb - wbot / 2, 0)])
    wi = q(p, "WWi", 1.0)                           # inner strokes lighter
    vw = V_ * q(p, "WVx", 1.4)                      # flat bottom vertex width
    wo_, wn_ = wt, wt * thin * wi
    s1 = stroke(x0 + wt / 2, wt, b1 - (vw - wo_) / 2, wo_ * q(p, "WWb", 1.0), cap)
    s2 = stroke(xm - wm / 2 + wn_ / 2, wn_, b1 + (vw - wn_) / 2, wn_ * q(p, "WWb", 1.0), mh)
    s3 = stroke(xm + wm / 2 - wt * wi / 2, wt * wi, b2 - (vw - wt * wi) / 2, wt * wi * q(p, "WWb", 1.0), mh)
    s4 = stroke(x1 - wt * thin / 2, wt * thin, b2 + (vw - wt * thin) / 2, wt * thin * q(p, "WWb", 1.0), cap)
    cs = [s1, s2, s3, s4]
    ct = 3 if p["proj"] else 0
    d1 = norm((b1 - (x0 + wt / 2), -cap))
    d4 = norm((b2 - (x1 - wt * thin / 2), -cap))
    cs.append(blade_serif((x0, cap), d1, -1, p["proj"] * 0.8, p["tt"], p["bh"] * 0.4, ct))
    cs.append(blade_serif((x0 + wt, cap), d1, +1, p["proj"] * 0.45, p["tt"], p["bh"] * 0.2, ct))
    cs.append(blade_serif((x1 - wt * thin, cap), d4, -1, p["proj"] * 0.45, p["tt"], p["bh"] * 0.2, ct))
    cs.append(blade_serif((x1, cap), d4, +1, p["proj"] * 0.8, p["tt"], p["bh"] * 0.4, ct))
    return cs, x1 + rsb


EXTRA = [
    ("h", 0x68, h_), ("r", 0x72, r_), ("s", 0x73, s_), ("d", 0x64, d_),
    ("i", 0x69, i_), ("g", 0x67, g_), ("c", 0x63, c_), ("t", 0x74, t_),
    ("m", 0x6D, m_), ("p", 0x70, p_), ("f", 0x66, f_), ("u", 0x75, u_),
    ("v", 0x76, v_), ("l", 0x6C, l_), ("W", 0x57, W_), ("e", 0x65, e_),
]

GLYPHS = G0.GLYPHS + EXTRA
ALIASES = G0.ALIASES + [
    ("es-cy", 0x0441, "c"), ("ie-cy", 0x0435, "e"), ("er-cy", 0x0440, "p"),
]
