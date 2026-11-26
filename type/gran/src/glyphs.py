"""Gran 0.04 glyph constructions: strict, drawn for quality.

Rules followed everywhere:
- on-curve points on extremes, smooth (collinear) handles through curves;
- round strokes slightly heavier than straight ones, overshoots on rounds;
- arches and bowls thin where they join a stem;
- outer curves a little rounder than the counters inside them;
- every master has the same point structure (serifs collapse to zero in
  the Grotesk).
"""
import math
from geom import C, poly, rect, oval, mirror, norm, add, sub, mul, \
    line_x, blade_serif


def rad(d):
    return math.radians(d)


def serifs_v(p, x0, x1, y, top, caps=True, sides=("l", "r"), k=1.0):
    if caps:
        pr, tt, bh = p["proj"] * k, p["tt"] * k, p["bh"] * k
    else:
        pr, tt, bh = p["lproj"] * k, p["ltt"] * k, p["lbh"] * k
    e = (0, -1) if top else (0, 1)
    cut = 3 if p["proj"] else 0
    out = []
    if "l" in sides:
        out.append(blade_serif((x0, y), e, -1, pr, tt, bh, cut))
    if "r" in sides:
        out.append(blade_serif((x1, y), e, +1, pr, tt, bh, cut))
    return out


def turned_counter(cx, cy, X, Y, tens, tilt_deg):
    """Counter oval whose horizontal/vertical reach after turning by tilt
    equals X/Y, so stroke weights stay as specified."""
    phi = rad(tilt_deg)
    c2, s2 = math.cos(phi) ** 2, math.sin(phi) ** 2
    a2 = (X * X * c2 - Y * Y * s2) / (c2 - s2)
    b2 = (Y * Y * c2 - X * X * s2) / (c2 - s2)
    a, b = math.sqrt(a2), math.sqrt(b2)
    inner = oval(cx - a, cy - b, cx + a, cy + b, tens, kind="hole")
    c, s = math.cos(phi), math.sin(phi)

    def rot(q):
        dx, dy = q[0] - cx, q[1] - cy
        return (cx + dx * c - dy * s, cy + dx * s + dy * c)
    return {"kind": "hole", "start": rot(inner["start"]),
            "segs": [(g[0],) + tuple(rot(q) for q in g[1:]) for g in inner["segs"]]}


def round_glyph(p, w, h, ov, side, top, sb, lc=False):
    x0, x1 = sb, sb + w
    y0, y1 = -ov, h + ov
    tO = p.get("tensOo", p["tensO"]) if lc else p["tensO"]
    tI = p.get("tensIo", p["tensI"]) if lc else p["tensI"]
    outer = oval(x0, y0, x1, y1, tO)
    inner = turned_counter((x0 + x1) / 2, (y0 + y1) / 2,
                           w / 2 - side, (y1 - y0) / 2 - top,
                           tI, p["tilt"])
    return [outer, inner], x1 + sb


# ------------------------------------------------------------------ capitals

def H(p, cap=None, V=None, Hc=None, w=None, sbk=1.0, sk=1.0):
    cap = cap or p["cap"]
    V = V or p["V"]
    Hc = Hc or p["Hc"]
    w = w or p["wH"]
    sb = p["sbStem"] * sbk
    L0, L1 = sb, sb + V
    R1 = sb + w
    R0 = R1 - V
    yc = cap * p.get("hY", 0.51 if p["genre"] == "G" else 0.515)
    cs = [rect(L0, 0, L1, cap), rect(R0, 0, R1, cap),
          rect(L1 - 6, yc - Hc / 2, R0 + 6, yc + Hc / 2)]
    q = dict(p, proj=p["proj"] * sk, tt=p["tt"] * sk, bh=p["bh"] * sk)
    for a_, b_ in ((L0, L1), (R0, R1)):
        cs += serifs_v(q, a_, b_, 0, False)
        cs += serifs_v(q, a_, b_, cap, True)
    return cs, R1 + sb


def O(p, cap=None, V=None, Hc=None, w=None, ov=None, sbk=1.0):
    cap = cap or p["cap"]
    V = V or p["V"]
    side = V * p.get("sideKO", p["sideK"])
    if p["genre"] == "G":
        top = side * p.get("topKO", p["topK"])
    else:
        top = (Hc or p["Hc"]) * 1.05
    return round_glyph(p, w or p["wO"], cap, p["ov"] if ov is None else ov,
                       side, top, p["sbO"] * sbk)


def _zhe_half(p, xc, W, cap, V, t_arm, t_leg, gap):
    """Right half of Zhe: a straight arm to the top right and a leg to the
    bottom right meeting just off the stem; both taper toward the joint."""
    xs1 = xc + V / 2
    yj = cap * 0.505
    Xs = (xs1 + gap, yj)
    TRa = (W - (W - xc) * 0.05, cap)
    da = norm(sub(TRa, Xs))
    sa = math.sin(math.atan2(da[1], da[0]))
    TLa = (TRa[0] - t_arm / sa, cap)
    # taper: the arm is 12% lighter where it meets the joint
    na = (-da[1], da[0])
    UJ = add(Xs, mul(na, t_arm * 0.88))
    du = norm(sub(TLa, UJ))
    UpC = line_x(UJ, du, xc)
    LowC = line_x(Xs, da, xc)
    BRl = (W, 0)
    dl = norm(sub(BRl, Xs))
    sl = abs(math.sin(math.atan2(dl[1], dl[0])))
    BLl = (W - t_leg / sl, 0)
    nl = (dl[1], -dl[0])
    LJ = add(Xs, mul(nl, t_leg * 0.90))
    dlo = norm(sub(BLl, LJ))
    LowLC = line_x(LJ, dlo, xc)
    UpLC = line_x(Xs, dl, xc)
    arm = poly([TLa, TRa, Xs, LowC, UpC])
    leg = poly([BLl, LowLC, UpLC, Xs, BRl])
    return arm, leg, (TLa, TRa, da), (BLl, BRl, dl)


def Zhe(p, cap=None, V=None, w=None, sbk=1.0, sk=1.0):
    cap = cap or p["cap"]
    V = V or p["V"]
    w = w or p["wZ"]
    q = dict(p, proj=p["proj"] * sk, tt=p["tt"] * sk, bh=p["bh"] * sk)
    sb = (p["sbZ"] + q["proj"] * 0.75) * sbk
    x0 = sb
    W = x0 + w
    xc = x0 + w / 2
    gap = V * (0.16 if p["genre"] == "G" else 0.10)
    # right side: rising arm light, falling leg heavy (pen logic)
    armR, legR, aR, lR = _zhe_half(p, xc, W, cap, V, V * p["armThin"],
                                   V * p["legK"], gap)
    armL, legL, aL, lL = _zhe_half(p, xc, W, cap, V, V * p["armK"],
                                   V * p["legThin"], gap)
    armL, legL = mirror(armL, xc), mirror(legL, xc)
    xs0, xs1 = xc - V / 2, xc + V / 2
    cs = [rect(xs0, 0, xs1, cap), armR, legR, armL, legL]
    cs += serifs_v(q, xs0, xs1, 0, False)
    cs += serifs_v(q, xs0, xs1, cap, True)

    def ends(corners, mx=None):
        a, b, d = corners
        e = (-d[0], -d[1])
        ct = 3 if q["proj"] else 0
        out = [blade_serif(a, e, -1, q["proj"] * 0.55, q["tt"], q["bh"] * 0.25, ct),
               blade_serif(b, e, +1, q["proj"] * 0.9, q["tt"], q["bh"], ct)]
        return [mirror(c, mx) for c in out] if mx is not None else out

    cs += ends(aR) + ends(lR) + ends(aL, xc) + ends(lL, xc)
    return cs, W + sb


# ----------------------------------------------------------------- lowercase

def n(p):
    xh, v, hl, ov = p["xh"], p["v"], p["hl"], p["ovl"]
    L0 = p["sbStemL"]
    L1 = L0 + v
    R1 = L0 + p["wn"]
    R0 = R1 - v
    top = xh + ov
    yJo = xh * p["yJo"]
    K = (L1, xh * p["yC"])
    ySh = xh * p["ySh"]
    xt = L1 + (R1 - L1) * p["xT"]
    hA = hl * (1.0 if p["genre"] == "G" else 1.25)
    ti = top - hA
    xti = (L1 + (R0 - L1) * p["xTi"]) if p["xTi"] > 0.2 else xt + (R0 - L1) * p["xTi"]
    s = p["slope"]
    yTL = xh - s * v

    tq = v * p.get("nTaper", 0.0)          # stem narrows into the notch
    stem = poly([(L0, 0), (L0, yTL), (L1 - tq, xh), (L1, yJo), (L1, 0)])
    rstem = rect(R0, 0, R1, ySh + 8)
    d0 = norm((0.40, 1.0))
    a = C((L1 - v * 0.5, yJo))
    a.L((L1, yJo))
    a.Cu(add((L1, yJo), mul(d0, (top - yJo) * p.get("nJoK", 0.95))),
         (xt - (xt - L1) * p.get("nLeftK", 0.52), top), (xt, top))
    a.Cu((xt + (R1 - xt) * p.get("nShK", 0.60), top), (R1, ySh + (top - ySh) * p.get("nShV", 0.56)), (R1, ySh))
    a.L((R0, ySh))
    a.Cu((R0, ySh + (ti - ySh) * 0.54), (xti + (R0 - xti) * 0.60, ti), (xti, ti))
    dK = norm((0.30 * p["joinK"], 1.0))
    a.Cu((xti - (xti - L1) * 0.58, ti), add(K, mul(dK, (ti - K[1]) * 0.50)), K)
    a.L((L1 - v * 0.5, K[1]))
    arch = a.close()

    # head serif: a flag that continues the slanted cut of the stem top
    hp, htt, hbh = p["hp"], p["htt"], p["hbh"]
    if hp:
        tipT = (L0 - hp, yTL - s * hp)
        tipB = (L0 - hp, tipT[1] - htt)
        D = (L0, tipB[1] - hbh)
        hc = C((L0 + 12, yTL + s * 12 - 1))
        hc.L(tipT)
        hc.L(tipB)
        hc.Cu((tipB[0] + hp * 0.55, tipB[1]), (L0, D[1] + hbh * 0.5), D)
        hc.L((L0 + 12, D[1]))
        head = hc.close()
    else:
        P = (L0, yTL)
        head = {"kind": "fill", "start": P,
                "segs": [("L", P), ("L", P), ("C", P, P, P), ("L", P), ("L", P)]}
    cs = [stem, rstem, arch, head]
    cs += serifs_v(p, L0, L1, 0, False, caps=False)
    cs += serifs_v(p, R0, R1, 0, False, caps=False)
    return cs, R1 + p["sbStemR"]


def o(p):
    side = p["v"] * p["sideK"]
    top = side * p["topK"] if p["genre"] == "G" else p["hl"] * 1.05
    side = side * p.get("oSideK", 1.0)
    return round_glyph(p, p["wo"], p["xh"], p["ovl"], side, top, p["sbo"], lc=True)


def a(p):
    xh, v, hl, ov = p["xh"], p["v"], p["hl"], p["ovl"]
    G = p["genre"] == "G"
    q = lambda k, d: p.get(k, d)  # noqa: E731
    x0 = p["sbaL"] if p.get("sbaL") else p["sbo"] * 0.90
    wa = p["wa"]
    Ra1 = x0 + wa
    Ra0 = Ra1 - v
    top = xh + ov
    tp = v * q("aTaper", 0.0)               # stem narrows toward the foot
    yBt = xh * p["aBt"]

    def Rx(y):                              # left edge of the stem at y
        return Ra0 + tp * max(0.0, 1 - y / yBt)

    # hook ---------------------------------------------------------------
    yHs = xh * p["aHs"]
    yHi = xh * p["aHi"]
    hk = hl * q("aHk", 0.98 if G else 1.15)
    TopO = (x0 + wa * p["aTopX"], top)
    TopI = (TopO[0] + wa * q("aTix", 0.035), top - hk)
    dS = norm((q("aDs", 0.30), 1.0))
    wT = v * (1.0 if G else 0.62)
    cutv = (math.cos(rad(p["cut"])), math.sin(rad(p["cut"])))
    Eo = (x0 + wa * q("aEx", 0.03), xh * p["aEy"])
    nS = (dS[1], -dS[0])
    cosang = abs(cutv[0] * nS[0] + cutv[1] * nS[1])
    Ei = add(Eo, mul(cutv, wT / max(cosang, 0.3)))
    h = C(Eo)
    h.Cu(add(Eo, mul(dS, (top - Eo[1]) * q("aO1", 0.66))),
         (TopO[0] - (TopO[0] - Eo[0]) * q("aO2", 0.56), top), TopO)
    h.Cu((TopO[0] + (Ra1 - TopO[0]) * q("aShK", 0.58), top),
         (Ra1, yHs + (top - yHs) * q("aShV", 0.56)), (Ra1, yHs))
    h.L((Ra0, yHs))
    h.L((Ra0, yHi))
    h.Cu((Ra0, yHi + (TopI[1] - yHi) * q("aI1", 0.55)),
         (TopI[0] + (Ra0 - TopI[0]) * q("aI2", 0.58), TopI[1]), TopI)
    h.Cu((TopI[0] - (TopI[0] - Ei[0]) * q("aI3", 0.56), TopI[1]),
         add(Ei, mul(dS, (TopI[1] - Ei[1]) * q("aI4", 0.55))), Ei)
    hook = h.close()
    r = v * (0.0 if G else (0.50 if p["opsz"] == 12 else 0.45))
    Bc = add(Eo, (r * 0.92, -r * 0.02))
    ball = oval(Bc[0] - r, Bc[1] - r * 1.08, Bc[0] + r, Bc[1] + r * 0.92, 0.56)

    # bowl ---------------------------------------------------------------
    yBm = xh * p["aBm"]
    yBb = xh * p["aBb"]
    bxm = x0 + (Ra0 - x0) * p["aBx"]
    dT = norm((-1.0, -p["aSlope"]))
    Pb = (Rx(yBb) + 1, yBb)
    b = C((Ra0 + v * 0.45, yBt))
    b.L((Ra0, yBt))
    # bowl top: from the stem to its highest point, then round to the left
    Tb = (x0 + (Ra0 - x0) * q("aTbx", 0.55), yBt + xh * q("aTbdy", 0.0))
    b.Cu((Ra0 - (Ra0 - Tb[0]) * q("aT1", 0.40), yBt + (Tb[1] - yBt) * q("aT1y", 0.9)),
         (Tb[0] + (Ra0 - Tb[0]) * q("aT2", 0.40), Tb[1]), Tb)
    b.Cu((Tb[0] - (Tb[0] - x0) * q("aL1", 0.56), Tb[1]),
         (x0, yBm + (Tb[1] - yBm) * q("aL2", 0.56)), (x0, yBm))
    b.Cu((x0, yBm - (yBm + ov) * q("aB2a", 0.56)),
         (bxm - (bxm - x0) * q("aB2b", 0.58), -ov), (bxm, -ov))
    b.Cu((bxm + (Ra0 - bxm) * q("aB3a", 0.55), -ov),
         add(Pb, mul(norm((-q("aB3d", 0.55), -1.0)), (yBb + ov) * q("aB3b", 0.75))), Pb)
    b.L((Ra0 + v * 0.45, yBb))
    bowl = b.close()

    htop = hl * q("aHtop", 1.0 if G else 0.95)
    vb = v * q("aVb", 1.0 if G else 1.04)
    hlb = hl * q("aHlb", 1.0 if G else 1.25)
    yCt = yBt - htop
    X = (Rx(yCt), yCt)
    cy0 = -ov + hlb
    yCm = yBm + hl * q("aCmy", 0.10)
    CL = (x0 + vb, yCm)
    cbx = bxm + (Ra0 - bxm) * q("aCbx", 0.06)
    yCb = xh * p["aCb"] if p.get("aCb") else yBb + hl * 1.20
    Pc = (Rx(yCb), yCb)
    k = C(X, kind="hole")
    Tc = (x0 + vb + (X[0] - x0 - vb) * q("aTcx", 0.50), yCt + xh * q("aTcdy", 0.0))
    k.Cu((X[0] - (X[0] - Tc[0]) * q("aTc1", 0.40), yCt + (Tc[1] - yCt) * q("aTc1y", 0.9)),
         (Tc[0] + (X[0] - Tc[0]) * q("aTc2", 0.40), Tc[1]), Tc)
    k.Cu((Tc[0] - (Tc[0] - CL[0]) * q("aCL1", 0.56), Tc[1]),
         (CL[0], yCm + (Tc[1] - yCm) * q("aCL2", 0.56)), CL)
    k.Cu((CL[0], yCm - (yCm - cy0) * q("aC2a", 0.56)),
         (cbx - (cbx - CL[0]) * q("aC2b", 0.58), cy0), (cbx, cy0))
    k.Cu((cbx + (Ra0 - cbx) * q("aC3a", 0.55), cy0),
         add(Pc, mul(norm((-q("aC3d", 0.55), -1.0)), (yCb - cy0) * q("aC3b", 0.70))), Pc)
    counter = k.close()

    stem = poly([(Ra0 + tp, 0), (Ra0, yBt), (Ra0, yHs + 10), (Ra1, yHs + 10), (Ra1, 0)])
    cs = [stem, hook, ball, bowl, counter]
    cs.append(blade_serif((Ra1, 0), (0, 1), +1, p["lproj"] * 0.85, p["ltt"],
                          p["lbh"] * 0.8, 3 if p["proj"] else 0))
    rsb = p["sbaR"] if p.get("sbaR") else p["sbnR"] * 0.9 + p["lproj"] * 0.85
    return cs, Ra1 + rsb


def de(p):
    """Cyrillic de, Russian form: a sabre leg, flat top, two short
    descenders (shorter than p/y descenders)."""
    xh, v, hl = p["xh"], p["v"], p["hl"]
    G = p["genre"] == "G"
    fl = p["flare"]
    Xl = p["sbd"] + fl
    Xr = Xl + p["wd"]
    R1 = Xr - v * 0.08
    R0 = R1 - v
    hb = hl * (1.05 if G else 1.35)
    ht = hl * (1.0 if G else 1.15)
    vd = v * (0.88 if G else 0.80)
    dd = p["dd"]
    Lb = Xl + v * 0.06
    lean = p["wd"] * 0.12
    Lt = Lb + lean
    tl = v * (0.94 if G else 0.52)           # leg weight
    dirB = norm((-0.42, -1.0))
    wb = tl / abs(dirB[1])                    # horizontal width at the foot
    yb = hb * 0.5
    hh = xh - yb
    # sabre: vertical under the bar, sweeping left into the foot
    leg = C((Lb, yb))
    leg.Cu(sub((Lb, yb), mul(dirB, hh * 0.40)), (Lt, xh - hh * 0.42), (Lt, xh))
    leg.L((Lt + tl, xh))
    leg.Cu((Lt + tl, xh - hh * 0.42), sub((Lb + wb, yb), mul(dirB, hh * 0.40)),
           (Lb + wb, yb))
    legc = leg.close()
    topb = rect(Lt + 4, xh - ht, R0 + 6, xh)
    stem = rect(R0, 0, R1, xh)
    base = rect(Xl, 0, Xr, hb)
    dl = poly([(Xl, hb - 4), (Xl + vd, hb - 4), (Xl + vd, dd), (Xl - fl, dd),
               (Xl, dd + fl * 1.6)])
    dr = poly([(Xr - vd, hb - 4), (Xr, hb - 4), (Xr, dd + fl * 1.6),
               (Xr + fl, dd), (Xr - vd, dd)])
    cs = [legc, topb, stem, base, dl, dr]
    cs += serifs_v(p, R0, R1, xh, True, caps=False, sides=("r",), k=0.85)
    cs.append(blade_serif((Lt, xh), (0, -1), -1, p["lproj"] * 0.7, p["ltt"],
                          p["lbh"] * 0.5, 3 if p["proj"] else 0))
    return cs, Xr + fl + p["sbd"]


# ---------------------------------------------------------------- small caps

def sc_params(p):
    sc = p["xh"] + (22 if p["opsz"] == 12 else 20)
    return dict(cap=sc, V=p["v"] * 1.04, Hc=p["hl"] * 1.05, k=sc / p["cap"])


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
    return Zhe(p, cap=s["cap"], V=s["V"], w=p["wZ"] * s["k"] * 1.06, sbk=1.06,
               sk=0.82)


GLYPHS = [
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

ALIASES = [
    ("En-cy", 0x041D, "H"),
    ("O-cy", 0x041E, "O"),
    ("o-cy", 0x043E, "o"),
    ("a-cy", 0x0430, "a"),
]
