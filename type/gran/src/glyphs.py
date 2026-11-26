"""Gran glyph constructions. Each function takes the master params and
returns (contours, advance). Every construction produces the same point
structure in every master; features that a genre lacks collapse to zero.
"""
import math
from geom import (C, poly, rect, oval, trap, serif, mirror, norm, add, sub,
                  mul, line_x, intersect)


def stem_serifs(p, x0, x1, y_bot, y_top, caps=True, bottom=True, top=True,
                which=("l", "r")):
    """Serifs on a vertical stem [x0, x1]."""
    proj, tt, bh = ((p["proj"], p["tt"], p["bh"]) if caps
                    else (p["lproj"], p["ltt"], p["lbh"]))
    out = []
    if bottom:
        if "l" in which:
            out.append(serif((x0, y_bot), (0, 1), -1, proj, tt, bh, p["fk"], p["cut"]))
        if "r" in which:
            out.append(serif((x1, y_bot), (0, 1), +1, proj, tt, bh, p["fk"], p["cut"]))
    if top:
        if "l" in which:
            out.append(serif((x0, y_top), (0, -1), -1, proj, tt, bh, p["fk"], p["cut"]))
        if "r" in which:
            out.append(serif((x1, y_top), (0, -1), +1, proj, tt, bh, p["fk"], p["cut"]))
    return out


# ------------------------------------------------------------------- capitals

def H(p, cap=None, V=None, Hc=None, w=None, sbk=1.0, sk=1.0):
    cap = cap or p["cap"]
    V = V or p["V"]
    Hc = Hc or p["Hc"]
    w = w or p["wH"]
    sb = p["sbStem"] * sbk
    L0, L1 = sb, sb + V
    R1 = sb + w
    R0 = R1 - V
    yc = cap * 0.515
    cs = [rect(L0, 0, L1, cap), rect(R0, 0, R1, cap),
          rect(L1 - 8, yc - Hc / 2, R0 + 8, yc + Hc / 2)]
    q = dict(p, proj=p["proj"] * sk, tt=p["tt"] * sk, bh=p["bh"] * sk)
    cs += stem_serifs(q, L0, L1, 0, cap)
    cs += stem_serifs(q, R0, R1, 0, cap)
    return cs, R1 + sb


def O(p, cap=None, V=None, Hc=None, w=None, ov=None, sbk=1.0):
    cap = cap or p["cap"]
    V = (V or p["V"]) * 1.05          # round strokes are heavier than straight
    Hc = (Hc or p["Hc"]) * 1.04
    w = w or p["wO"]
    ov = p["ov"] if ov is None else ov
    sb = p["sb"] * 0.60 * sbk
    x0, x1 = sb, sb + w
    y0, y1 = -ov, cap + ov
    cs = [oval(x0, y0, x1, y1, p["ko"]),
          oval(x0 + V, y0 + Hc, x1 - V, y1 - Hc, p["ki"], kind="hole")]
    return cs, x1 + sb


def _zhe_side(p, x0, xc, W, cap, V, thinA, thickL, gap):
    """Right half of Zhe: arm (to the top right) and leg (to the bottom
    right), meeting at a point just off the stem, with ink traps in the
    three crotches. Returns (arm, leg, stem_edge_points_top_to_bottom,
    arm-end corners, leg-end corners)."""
    xs1 = xc + V / 2
    yj = cap * 0.50
    Xs = (xs1 + gap, yj)
    TRa = (W - (W - xc) * 0.045, cap)
    da = norm(sub(TRa, Xs))
    wa_end = thinA / math.sin(math.atan2(da[1], da[0]))
    TLa = (TRa[0] - wa_end, cap)
    BRl = (W, 0)
    dl = norm(sub(BRl, Xs))
    wl_end = thickL / math.sin(abs(math.atan2(dl[1], dl[0])))
    BLl = (W - wl_end, 0)
    Xu = line_x(TLa, da, xs1)
    UpC = line_x(TLa, da, xc)
    LowC = line_x(Xs, da, xc)
    Xl = line_x(BLl, dl, xs1)
    LowLC = line_x(BLl, dl, xc)
    UpLC = line_x(Xs, dl, xc)

    D, S = p["trapD"], p["trapS"]
    ts = trap(Xs, da, dl, D, S)                 # arm = 1, leg = 2
    tu = trap(Xu, (0, 1), da, D * 0.8, S * 0.8)  # stem = 1, arm = 2
    tl = trap(Xl, (0, -1), dl, D * 0.8, S * 0.8)  # stem = 1, leg = 2

    arm = poly([TLa, TRa, ts["A1"], ts["T"], ts["Y1"], LowC, UpC,
                tu["Y2"], tu["T"], tu["A2"]])
    leg = poly([BLl, tl["A2"], tl["T"], tl["Y2"], LowLC, UpLC,
                ts["Y2"], ts["T"], ts["A2"], BRl])
    edge = [tu["A1"], tu["T"], tu["Y1"], tl["Y1"], tl["T"], tl["A1"]]
    return arm, leg, edge, (TLa, TRa, da), (BLl, BRl, dl)


def Zhe(p, cap=None, V=None, w=None, sbk=1.0, sk=1.0):
    cap = cap or p["cap"]
    V = V or p["V"]
    w = w or p["wZ"]
    q = dict(p, proj=p["proj"] * sk, tt=p["tt"] * sk, bh=p["bh"] * sk)
    sb = (p["sb"] * 0.16 + q["proj"] * 0.85) * sbk
    x0 = sb
    xc = x0 + w / 2
    W = x0 + w
    gap = V * p["gapZ"]
    # right side: rising arm is a hairline in Antiqua, falling leg is heavy
    armR, legR, edgeR, aR, lR = _zhe_side(p, x0, xc, W, cap, V,
                                          V * p["zArmB"], V * p["zLegB"], gap)
    # left side mirrored: falling arm heavy, rising leg thin
    armL, legL, edgeL, aL, lL = _zhe_side(p, x0, xc, W, cap, V,
                                          V * p["zArmA"], V * p["zLegA"], gap)
    armL, legL = mirror(armL, xc), mirror(legL, xc)
    xs0, xs1 = xc - V / 2, xc + V / 2
    left_edge = [(2 * xc - x, y) for (x, y) in reversed(edgeL)]
    stem = poly([(xs0, 0)] + left_edge + [(xs0, cap), (xs1, cap)] + edgeR
                + [(xs1, 0)])
    cs = [stem, armR, legR, armL, legL]
    cs += stem_serifs(q, xs0, xs1, 0, cap)

    def end_serifs(corners, top, mirror_x=None):
        a, b, d = corners
        out = []
        e = (-d[0], -d[1])  # back along the stroke
        pr, t, bhh = q["proj"], q["tt"], q["bh"]
        if top:
            # TL: acute side, TR: obtuse side
            out.append(serif(a, e, -1, pr * 0.7, t, 0, 0.6, q["cut"]))
            out.append(serif(b, e, +1, pr, t, bhh, q["fk"], q["cut"]))
        else:
            out.append(serif(a, e, -1, pr * 0.7, t, 0, 0.6, q["cut"]))
            out.append(serif(b, e, +1, pr, t, bhh, q["fk"], q["cut"]))
        if mirror_x is not None:
            out = [mirror(c, mirror_x) for c in out]
        return out

    cs += end_serifs(aR, True) + end_serifs(lR, False)
    cs += end_serifs(aL, True, xc) + end_serifs(lL, False, xc)
    return cs, W + sb


# ------------------------------------------------------------------ lowercase

def n(p):
    xh, v, hl, ovl = p["xh"], p["v"], p["hl"], p["ovl"]
    sbl = p["sbStem"] * 0.92
    sbr = p["sbStem"] * 0.80
    L0, L1 = sbl, sbl + v
    R1 = sbl + p["wn"]
    R0 = R1 - v
    slope = p["slope"]
    yTL = xh - slope * v                 # facet: stem top is cut at an angle
    yJo = xh - 0.165 * xh                # arch leaves the stem (outer)
    yX = yJo - v * 0.64                  # crotch (inner)
    yR = xh * 0.50
    xt = L1 + (R1 - L1) * 0.40
    xti = xt + (R0 - L1) * 0.10
    yTop = xh + ovl
    yTi = yTop - hl * 1.02
    u2 = norm((0.42, 1.0))
    tr = trap((L1, yX), (0, -1), u2, p["trapD"], p["trapS"])  # stem=1, arch=2

    stem = poly([(L0, 0), (L0, yTL), (L1, xh), tr["Y1"], tr["T"], tr["A1"],
                 (L1, 0)])
    rstem = rect(R0, 0, R1, yR + 6)

    a = C((L1 - v * 0.5, yJo))
    a.L((L1, yJo))
    a.arc((xt, yTop), norm((0.55, 1.0)), (1, 0), (yTop - yJo) * 0.62,
          (xt - L1) * 0.55)
    a.arc((R1, yR), (1, 0), (0, -1), (R1 - xt) * 0.60, (yTop - yR) * 0.56)
    a.L((R0, yR))
    a.arc((xti, yTi), (0, 1), (-1, 0), (yTi - yR) * 0.56, (R0 - xti) * 0.62)
    A2 = tr["A2"]
    a.arc(A2, (-1, 0), (-u2[0], -u2[1]), (xti - A2[0]) * 0.62,
          (yTi - A2[1]) * 0.40)
    a.L(tr["T"])
    a.L(tr["Y2"])
    a.L((L1 - v * 0.5, tr["Y2"][1]))
    arch = a.close()

    # head serif (flag): continues the stem's facet slope to the left
    hp, htt, hbh = p["hp"], p["htt"], p["hbh"]
    yB = xh - slope * (L1 - (L0 - hp + p["cut"]))
    B = (L0 - hp + p["cut"], yB)
    Cc = (L0 - hp, yB - htt)
    D = (L0, Cc[1] - hbh)
    head = poly([(L1, xh), B, Cc, D, (L0 + 12, D[1]), (L0 + 12, yTL - 6)])
    cs = [stem, rstem, arch, head]
    cs += stem_serifs(p, L0, L1, 0, xh, caps=False, top=False)
    cs += stem_serifs(p, R0, R1, 0, xh, caps=False, top=False)
    return cs, R1 + sbr


def o(p):
    xh, v, hl, ovl = p["xh"], p["v"] * 1.05, p["hl"] * 1.04, p["ovl"]
    sb = p["sb"] * 0.60
    x0, x1 = sb, sb + p["wo"]
    y0, y1 = -ovl, xh + ovl
    cs = [oval(x0, y0, x1, y1, p["ko"]),
          oval(x0 + v, y0 + hl, x1 - v, y1 - hl, p["ki"], kind="hole")]
    return cs, x1 + sb


def a(p):
    xh, v, hl, ovl = p["xh"], p["v"], p["hl"], p["ovl"]
    x0 = p["sb"] * 0.50
    wa = p["wa"]
    Ra1 = x0 + wa
    Ra0 = Ra1 - v
    sbr = p["sbStem"] * 0.62
    # --- hook
    yS = xh * 0.55
    yC = xh * 0.63
    TopO = (x0 + wa * 0.50, xh + ovl)
    hk = hl * 1.02
    TopI = (TopO[0] + wa * 0.035, xh + ovl - hk)
    Eo = (x0 + wa * 0.085, xh * 0.745)
    Ei = add(Eo, mul(norm((1.0, 0.34)), hk * 1.16))  # facet cut, ~19 deg
    if p["beak"] > 0:
        Bk = add(Eo, (p["beak"] * 0.05, -p["beak"]))
    else:
        Bk = ((Eo[0] + Ei[0]) / 2, (Eo[1] + Ei[1]) / 2)
    h = C(Eo)
    h.arc(TopO, norm((0.30, 1.0)), (1, 0), (TopO[1] - Eo[1]) * 0.58,
          (TopO[0] - Eo[0]) * 0.56)
    h.arc((Ra1, yS), (1, 0), (0, -1), (Ra1 - TopO[0]) * 0.58,
          (TopO[1] - yS) * 0.55)
    h.L((Ra0, yS))
    h.L((Ra0, yC))
    h.arc(TopI, (0, 1), (-1, 0), (TopI[1] - yC) * 0.55, (Ra0 - TopI[0]) * 0.58)
    h.arc(Ei, (-1, 0), norm((-0.40, -1.0)), (TopI[0] - Ei[0]) * 0.52,
          (TopI[1] - Ei[1]) * 0.50)
    h.L(Bk)
    hook = h.close()

    # --- bowl
    yBt = xh * 0.585
    yCt = yBt - hl * 0.80
    yBb = xh * 0.11
    yCb = yBb + hl * 1.30
    yBm = yBt * 0.47
    bxm = x0 + (Ra0 - x0) * 0.50
    vb = v * 0.97
    hlb = hl * 1.02
    b = C((Ra0 + v * 0.45, yBt))
    b.L((Ra0, yBt))
    b.arc((x0, yBm), (-1, 0), (0, -1), (Ra0 - x0) * 0.56, (yBt - yBm) * 0.56)
    b.arc((bxm, -ovl), (0, -1), (1, 0), (yBm + ovl) * 0.56, (bxm - x0) * 0.58)
    b.arc((Ra0, yBb), (1, 0), norm((0.50, 1.0)), (Ra0 - bxm) * 0.52,
          (yBb + ovl) * 0.70)
    b.L((Ra0 + v * 0.45, yBb))
    bowl = b.close()

    X = (Ra0, yCt)
    u2 = norm((-1.0, -0.10))
    tr = trap(X, (0, -1), u2, p["trapD"], p["trapS"])     # stem=1, counter=2
    cy0 = -ovl + hlb
    yCm = (yCt + cy0) * 0.46
    CL = (x0 + vb, yCm)
    cbx = bxm + (Ra0 - bxm) * 0.08
    k = C(tr["A2"], kind="hole")
    k.arc(CL, u2, (0, -1), (tr["A2"][0] - CL[0]) * 0.58, (tr["A2"][1] - yCm) * 0.56)
    k.arc((cbx, cy0), (0, -1), (1, 0), (yCm - cy0) * 0.56, (cbx - CL[0]) * 0.60)
    k.arc((Ra0, yCb), (1, 0), norm((0.55, 1.0)), (Ra0 - cbx) * 0.52,
          (yCb - cy0) * 0.62)
    k.L(tr["A1"])
    k.L(tr["T"])
    counter = k.close()

    stem = poly([(Ra0, 0), tr["A1"], tr["T"], tr["Y1"], (Ra0, yS + 8),
                 (Ra1, yS + 8), (Ra1, 0)])
    cs = [stem, hook, bowl, counter]
    cs.append(serif((Ra1, 0), (0, 1), +1, p["lproj"] * 0.95, p["ltt"],
                    p["lbh"], p["fk"], p["cut"]))
    return cs, Ra1 + sbr


def de(p):
    """Cyrillic de, Russian (trapezoid) form with two descenders."""
    xh, v, hl = p["xh"], p["v"], p["hl"]
    x0 = p["sb"] * 0.16 + p["flare"]
    Xl = x0
    Lb = Xl + v * 0.10
    R1 = Lb + p["wd"]
    R0 = R1 - v
    Xr = R1 + v * 0.55
    hb = hl * 1.10
    ht = hl * 1.0
    vd = v * 0.80
    dd = p["dd"]
    lean = p["wd"] * 0.17
    Lt = Lb + lean
    tl = v * p["dLeg"]
    dirL = norm((Lt - Lb, xh))
    wl = tl / math.sin(math.atan2(dirL[1], dirL[0]))
    leg = poly([(Lb, hb * 0.4), (Lt, xh), (Lt + wl, xh), (Lb + wl, hb * 0.4)])
    top = rect(Lt + 4, xh - ht, R0 + 8, xh)
    stem = rect(R0, 0, R1, xh)
    base = rect(Xl, 0, Xr, hb)
    fl = p["flare"]
    dl = poly([(Xl, hb - 4), (Xl + vd, hb - 4), (Xl + vd, dd),
               (Xl - fl, dd), (Xl, dd + fl * 1.6)])
    dr = poly([(Xr - vd, hb - 4), (Xr, hb - 4), (Xr, dd + fl * 1.6),
               (Xr + fl, dd), (Xr - vd, dd)])
    cs = [leg, top, stem, base, dl, dr]
    cs.append(serif((R1, xh), (0, -1), +1, p["lproj"] * 0.9, p["ltt"],
                    p["lbh"], p["fk"], p["cut"]))
    eL = (-dirL[0], -dirL[1])
    cs.append(serif((Lt, xh), eL, -1, p["lproj"] * 0.8, p["ltt"], 0,
                    0.6, p["cut"]))
    return cs, Xr + fl + p["sb"] * 0.16


# ---------------------------------------------------------------- small caps

def sc_params(p):
    k = p["sc"] / p["cap"]
    return dict(cap=p["sc"], V=p["v"] * 1.04, Hc=p["hl"] * 1.05, k=k)


def h_sc(p):
    s = sc_params(p)
    return H(p, cap=s["cap"], V=s["V"], Hc=s["Hc"], w=p["wH"] * s["k"] * 1.10,
             sbk=1.06, sk=0.82)


def o_sc(p):
    s = sc_params(p)
    return O(p, cap=s["cap"], V=s["V"], Hc=s["Hc"], w=p["wO"] * s["k"] * 1.08,
             ov=p["ovl"], sbk=1.06)


def zhe_sc(p):
    s = sc_params(p)
    return Zhe(p, cap=s["cap"], V=s["V"], w=p["wZ"] * s["k"] * 1.08, sbk=1.06,
               sk=0.82)


GLYPHS = [
    # name, unicode, builder
    ("H", 0x0048, H),
    ("O", 0x004F, O),
    ("n", 0x006E, n),
    ("o", 0x006F, o),
    ("a", 0x0061, a),
    ("Zhe-cy", 0x0416, Zhe),
    ("de-cy", 0x0434, de),
    ("h.sc", None, h_sc),
    ("o.sc", None, o_sc),
    ("zhe-cy.sc", None, zhe_sc),
]

# Cyrillic letters that share a drawing with Latin: separate glyphs built
# from components, so spacing and kerning can diverge later
ALIASES = [
    ("En-cy", 0x041D, "H"),
    ("O-cy", 0x041E, "O"),
    ("o-cy", 0x043E, "o"),
    ("a-cy", 0x0430, "a"),
]
