"""Gran v0.02 glyph constructions ("Резец": one knife, one pen).

Every function returns (contours, advance) with the same point structure in
every master. Features a master lacks collapse to zero size.
"""
import math
from geom import (C, poly, rect, oval, mirror, norm, add, sub, mul,
                  pen_width, expand_loop, expand_open, cap_points, knife,
                  blade_serif)


def rad(d):
    return math.radians(d)


def pen(p, thick, thin):
    return pen_width(thick, thin, p["phi"], p["kpen"])


def serifs_v(p, x0, x1, y, top, caps=True, sides=("l", "r"), k=1.0):
    """Blade serifs on a vertical stem end at height y."""
    if caps:
        pr, tt, bh = p["proj"] * k, p["tt"] * k, p["bh"] * k
    else:
        pr, tt, bh = p["lproj"] * k, p["ltt"] * k, p["lbh"] * k
    e = (0, -1) if top else (0, 1)
    out = []
    if "l" in sides:
        out.append(blade_serif((x0, y), e, -1, pr, tt, bh, p["cut"]))
    if "r" in sides:
        out.append(blade_serif((x1, y), e, +1, pr, tt, bh, p["cut"]))
    return out


def loop_centerline(x0, y0, x1, y1, k):
    o = oval(x0, y0, x1, y1, k)
    segs, prev = [], o["start"]
    for s in o["segs"]:
        segs.append((prev, s[1], s[2], s[3]))
        prev = s[3]
    return segs


def round_letter(p, w, h, ov, thick, thin, sb):
    """O/o: smooth outer superellipse; the counter is a squarer oval turned
    by the pen angle, which moves the thin points to 11 and 5 o'clock in
    the Antiqua and keeps them at 12 and 6 in the Grotesk."""
    x0, x1 = sb, sb + w
    y0, y1 = -ov, h + ov
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    outer = oval(x0, y0, x1, y1, p["tens"])
    phi = math.radians(p["oTilt"])
    # a turned counter reaches wider: shrink it so the sides keep weight
    X = w / 2 - thick
    Y = (y1 - y0) / 2 - thin
    c2, s2 = math.cos(phi) ** 2, math.sin(phi) ** 2
    a2 = (X * X * c2 - Y * Y * s2) / (c2 - s2)
    b2 = (Y * Y * c2 - X * X * s2) / (c2 - s2)
    iw, ih = 2 * math.sqrt(a2), 2 * math.sqrt(b2)
    inner = oval(cx - iw / 2, cy - ih / 2, cx + iw / 2, cy + ih / 2,
                 p["tens"] + p["tensIn"], kind="hole")
    c, s_ = math.cos(phi), math.sin(phi)

    def rot(q):
        dx, dy = q[0] - cx, q[1] - cy
        return (cx + dx * c - dy * s_, cy + dx * s_ + dy * c)
    inner = {"kind": "hole", "start": rot(inner["start"]),
             "segs": [(sg[0],) + tuple(rot(q) for q in sg[1:]) for sg in inner["segs"]]}
    return [outer, inner], x1 + sb


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
    yc = cap * 0.52
    cs = [rect(L0, 0, L1, cap), rect(R0, 0, R1, cap),
          rect(L1 - 8, yc - Hc / 2, R0 + 8, yc + Hc / 2)]
    for x0, x1 in ((L0, L1), (R0, R1)):
        cs += serifs_v(p, x0, x1, 0, False, k=sk)
        cs += serifs_v(p, x0, x1, cap, True, k=sk)
    return cs, R1 + sb


def O(p, cap=None, V=None, Hc=None, w=None, ov=None, sbk=1.0):
    cap = cap or p["cap"]
    V = (V or p["V"]) * 1.06
    Hc = (Hc or p["Hc"]) * 1.05
    w = w or p["wO"]
    ov = p["ov"] if ov is None else ov
    return round_letter(p, w, cap, ov, V, Hc, p["sb"] * 0.58 * sbk)


def _bracket(p, xa, xm, xb, cap, f, roundness):
    """One half of Zhe as a single bow ')' : top end -> touch point -> bottom
    end. Returns centerline segments."""
    T = (xa, cap)
    M = (xm, cap * 0.5)
    B = (xb, 0)
    h = cap * 0.5
    d0 = norm((xm - xa, -h * 0.9))
    d3 = norm((xb - xm, -h * 0.9))
    s1 = (T, add(T, mul(d0, h * (0.62 - roundness * 0.35))),
          (xm, M[1] + h * roundness), M)
    s2 = (M, (xm, M[1] - h * roundness),
          sub(B, mul(d3, h * (0.62 - roundness * 0.35))), B)
    return [s1, s2]


def Zhe(p, cap=None, V=None, w=None, sbk=1.0, sk=1.0):
    """Zhe drawn as )|( : two bows kissing the stem. At text size they cut
    into the stem (no clogging, short crotches); at display size the knife
    separates them by a hairline gap."""
    cap = cap or p["cap"]
    V = V or p["V"]
    w = w or p["wZ"]
    sb = (p["sb"] * 0.20 + p["proj"] * 0.7 * sk) * sbk
    x0 = sb
    W = x0 + w
    xc = (x0 + W) / 2
    xs0, xs1 = xc - V / 2, xc + V / 2
    f = pen(p, V * p["zThick"], V * p["zThin"])
    wM = f((0, -1))
    xmL = xs0 - wM / 2 + V * p["zOver"]
    endL = f(norm((1, -1.2)))
    xaL = x0 + endL * 0.55 + w * 0.035      # arms lean in a little at top
    xbL = x0 + endL * 0.55
    left = _bracket(p, xaL, xmL, xbL, cap, f, p["zRound"])
    right = _bracket(p, 2 * xc - xaL, 2 * xc - xmL, 2 * xc - xbL, cap, f,
                     p["zRound"])
    flat = (1.0, 0.0)
    bl = expand_open(left, f, nsub=2, cut0=flat, cut1=flat)
    br = expand_open(right, f, nsub=2, cut0=flat, cut1=flat)
    cs = [rect(xs0, 0, xs1, cap), bl, br]
    q = dict(p, proj=p["proj"] * sk, tt=p["tt"] * sk, bh=p["bh"] * sk)
    cs += serifs_v(q, xs0, xs1, 0, False)
    cs += serifs_v(q, xs0, xs1, cap, True)
    # outward half-serifs on the bows
    for segs, side in ((left, -1), (right, +1)):
        for end in (0, 1):
            b = segs[0] if end == 0 else segs[-1]
            t = 0.0 if end == 0 else 1.0
            pl, pr_ = cap_points(b, t, f, 0, flat)
            P = min(pl, pr_) if side < 0 else max(pl, pr_)
            # direction along the outer edge into the stroke
            if end == 0:
                e = norm(sub(b[1], b[0]))
            else:
                e = norm(sub(b[2], b[3]))
            cs.append(blade_serif(P, e, side, q["proj"] * 0.85, q["tt"],
                                  q["bh"] * 0.8, q["cut"]))
    return cs, W + sb


# ------------------------------------------------------------------ lowercase

def n(p):
    xh, v, hl, ovl = p["xh"], p["v"], p["hl"], p["ovl"]
    sbl = p["sbStem"] * 0.92
    sbr = p["sbStem"] * 0.80
    L0, L1 = sbl, sbl + v
    R1 = sbl + p["wn"]
    R0 = R1 - v
    s = p["slope"]
    yTL = xh - s * v                       # knife cut of the stem top
    yJo = xh - 0.15 * xh                   # arch leaves the stem (outer)
    X = (L1, yJo - v * p["join"])          # crotch (inner)
    yR = xh * 0.47
    yTop = xh + ovl
    xt = L1 + (R1 - L1) * 0.42
    xti = xt + (R0 - L1) * 0.12
    yTi = yTop - hl * 1.02
    u2 = norm((0.52, 1.0))                 # inner edge leaving the crotch
    T, A1 = knife(X, (-u2[0], -u2[1]), (0, -1), v * p["knifeD"], p["knifeM"])

    stem = poly([(L0, 0), (L0, yTL), (L1, xh), X, T, A1, (L1, 0)])
    rstem = rect(R0, 0, R1, yR + 6)
    Lm = min(T[0], L1 - v * 0.5) - 6
    a = C((Lm, yJo))
    a.L((L1, yJo))
    a.arc((xt, yTop), norm((0.50, 1.0)), (1, 0), (yTop - yJo) * 0.62,
          (xt - L1) * 0.50)
    a.arc((R1, yR), (1, 0), (0, -1), (R1 - xt) * p["tensR"],
          (yTop - yR) * 0.60)
    a.L((R0, yR))
    a.arc((xti, yTi), (0, 1), (-1, 0), (yTi - yR) * 0.60, (R0 - xti) * 0.60)
    a.arc(X, (-1, 0), (-u2[0], -u2[1]), (xti - X[0]) * 0.62,
          (yTi - X[1]) * 0.42)
    a.L(T)
    a.L((Lm, T[1]))
    arch = a.close()

    # head serif: a blade that continues the knife cut of the stem top
    hp, htt, hbh = p["hp"], p["htt"], p["hbh"]
    yTip = yTL - s * hp
    tipTop = (L0 - hp + p["cut"], yTip + s * p["cut"])
    tipBot = (L0 - hp, yTip - htt)
    D = (L0, tipBot[1] - hbh)
    hc = C((L0 + 14, yTL + s * 14 - 1))
    hc.L(tipTop)
    hc.L(tipBot)
    hc.Cu((tipBot[0] + hp * 0.55, tipBot[1]), (L0, D[1] + hbh * 0.45), D)
    hc.L((L0 + 14, D[1]))
    head = hc.close()
    cs = [stem, rstem, arch, head]
    cs += serifs_v(p, L0, L1, 0, False, caps=False)
    cs += serifs_v(p, R0, R1, 0, False, caps=False)
    return cs, R1 + sbr


def o(p):
    return round_letter(p, p["wo"], p["xh"], p["ovl"], p["v"] * 1.06,
                        p["hl"] * 1.05, p["sb"] * 0.58)


def a(p):
    xh, v, hl, ovl = p["xh"], p["v"], p["hl"], p["ovl"]
    x0 = p["sb"] * 0.50
    wa = p["wa"]
    Ra1 = x0 + wa
    Ra0 = Ra1 - v
    sbr = p["sbStem"] * 0.62

    # --- bowl with a knife top: a straight line that slices into the stem
    tb = p["aTop"]                          # slope of the bowl top
    yBt = xh * 0.60
    lt = (Ra0 - x0) * 0.40
    P1 = (Ra0 - lt, yBt - lt * tb)
    yBm = yBt * 0.44
    bxm = x0 + (Ra0 - x0) * 0.50
    yBb = xh * 0.11
    b = C((Ra0 + v * 0.45, yBt))
    b.L((Ra0, yBt))
    b.L(P1)
    b.arc((x0, yBm), norm((-1, -tb)), (0, -1), (P1[0] - x0) * 0.62,
          (P1[1] - yBm) * 0.56)
    b.arc((bxm, -ovl), (0, -1), (1, 0), (yBm + ovl) * 0.56, (bxm - x0) * 0.58)
    b.arc((Ra0, yBb), (1, 0), norm((0.45, 1.0)), (Ra0 - bxm) * 0.52,
          (yBb + ovl) * 0.70)
    b.L((Ra0 + v * 0.45, yBb))
    bowl = b.close()

    htop = hl * (0.92 if p["genre"] == "G" else 1.05)
    X = (Ra0, yBt - htop)
    u_in = norm((1.0, tb))
    T, A1 = knife(X, u_in, (0, -1), v * p["knifeD"], p["knifeM"])
    vb = v * 0.98
    hlb = hl * 1.04
    cy0 = -ovl + hlb
    lti = lt * 0.85
    Q1 = (Ra0 - lti, X[1] - lti * tb)
    yCm = (X[1] + cy0) * 0.45
    CL = (x0 + vb, yCm)
    cbx = bxm + (Ra0 - bxm) * 0.10
    yCb = yBb + hl * 1.30
    k = C(X, kind="hole")
    k.L(Q1)
    k.arc(CL, norm((-1, -tb)), (0, -1), (Q1[0] - CL[0]) * 0.62,
          (Q1[1] - yCm) * 0.56)
    k.arc((cbx, cy0), (0, -1), (1, 0), (yCm - cy0) * 0.56, (cbx - CL[0]) * 0.60)
    k.arc((Ra0, yCb), (1, 0), norm((0.55, 1.0)), (Ra0 - cbx) * 0.52,
          (yCb - cy0) * 0.62)
    k.L(A1)
    k.L(T)
    counter = k.close()

    # --- hook: one pen stroke from a knife-cut terminal into the stem
    f = pen(p, v * 0.98, hl)
    w_top = f((1, 0))
    yS = max(T[1], X[1]) + 26
    E = (x0 + wa * 0.15, xh * 0.70)
    Top = (x0 + wa * 0.53, xh + ovl - w_top / 2)
    R = (Ra0 + v / 2, yS)
    s1 = (E, add(E, mul(norm((0.26, 1.0)), (Top[1] - E[1]) * 0.62)),
          (Top[0] - (Top[0] - E[0]) * 0.56, Top[1]), Top)
    s2 = (Top, (Top[0] + (R[0] - Top[0]) * 0.64, Top[1]),
          (R[0], R[1] + (Top[1] - R[1]) * 0.56), R)
    cutA = rad(p["termCut"])
    cutv = (math.cos(cutA), math.sin(cutA))
    hook = expand_open([s1, s2], f, nsub=2, cut0=cutv, cut1=None)
    l0, r0 = cap_points(s1, 0.0, f, 0, cutv)
    outer = l0 if l0[0] < r0[0] else r0
    inner = r0 if outer is l0 else l0
    if p["beak"] > 0:
        tip = add(outer, mul(norm((-0.30, -1.0)), p["beak"]))
    else:
        tip = ((outer[0] + inner[0]) / 2, (outer[1] + inner[1]) / 2)
    beak = poly([outer, inner, tip])

    # --- stem, with a knife-cut foot in the grotesk
    yST = yS + 34
    foot = v * p["aFoot"]
    stem = poly([(Ra0, 0), A1, T, X, (Ra0, yST), (Ra1, yST), (Ra1, foot)])
    cs = [stem, bowl, counter, hook, beak]
    cs.append(blade_serif((Ra1, 0), (0, 1), +1, p["lproj"] * 0.95, p["ltt"],
                          p["lbh"], p["cut"]))
    return cs, Ra1 + sbr


def de(p):
    """Cyrillic de: Russian trapezoid form with a sabre leg and knife-cut
    descenders."""
    xh, v, hl = p["xh"], p["v"], p["hl"]
    fl = p["flare"]
    x0 = p["sb"] * 0.16 + fl
    Xl = x0
    Lb = Xl + v * 0.12
    R1 = Lb + p["wd"]
    R0 = R1 - v
    Xr = R1 + v * 0.55
    hb = hl * 1.12
    ht = hl * 1.0
    vd = v * 0.82
    dd = p["dd"]
    f = pen(p, v * 0.96, v * p["dLegThin"])
    wtop = f((0, -1))
    lean = p["wd"] * 0.21
    Lt = Lb + lean
    Ttop = (Lt + wtop / 2, xh)
    dirB = norm((-0.55, -1.0))
    wbot = f(dirB)
    Bot = (Lb + wbot / 2, hb * 0.45)
    hh = xh - Bot[1]
    leg = expand_open([(Ttop, (Ttop[0], Ttop[1] - hh * 0.45),
                        sub(Bot, mul(dirB, hh * 0.42)), Bot)], f, nsub=3)
    top = rect(Lt + 6, xh - ht, R0 + 8, xh)
    stem = rect(R0, 0, R1, xh)
    base = rect(Xl, 0, Xr, hb)
    dc = vd * p["descCut"]
    dl = poly([(Xl, hb - 4), (Xl + vd, hb - 4), (Xl + vd, dd + dc), (Xl - fl, dd)])
    dr = poly([(Xr - vd, hb - 4), (Xr, hb - 4), (Xr + fl, dd), (Xr - vd, dd + dc)])
    cs = [leg, top, stem, base, dl, dr]
    cs += serifs_v(p, R0, R1, xh, True, caps=False, sides=("r",), k=0.9)
    cs.append(blade_serif((Lt, xh), (0, -1), -1, p["lproj"] * 0.75, p["ltt"],
                          p["lbh"] * 0.6, p["cut"]))
    return cs, Xr + fl + p["sb"] * 0.16


# ---------------------------------------------------------------- small caps

def sc_params(p):
    k = p["sc"] / p["cap"]
    return dict(cap=p["sc"], V=p["v"] * 1.04, Hc=p["hl"] * 1.06, k=k)


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
