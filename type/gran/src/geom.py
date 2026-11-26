"""Geometry kit for Gran: contours, primitives, serifs, ink traps.

A contour is a dict {"kind": "fill"|"hole", "start": (x, y), "segs": [...]}
where segs are ("L", p) or ("C", c1, c2, p). The last segment always ends
exactly at the start point, so every master has the same point structure,
even where a feature (a serif, a trap) has collapsed to zero size.
"""
import math


def lerp(a, b, t):
    return a + (b - a) * t


def add(p, q):
    return (p[0] + q[0], p[1] + q[1])


def sub(p, q):
    return (p[0] - q[0], p[1] - q[1])


def mul(p, k):
    return (p[0] * k, p[1] * k)


def norm(v):
    l = math.hypot(v[0], v[1])
    return (0.0, 0.0) if l == 0 else (v[0] / l, v[1] / l)


def line_x(p, d, x):
    """Point on the line through p with direction d at abscissa x."""
    t = (x - p[0]) / d[0]
    return (x, p[1] + d[1] * t)


def line_y(p, d, y):
    t = (y - p[1]) / d[1]
    return (p[0] + d[0] * t, y)


def intersect(p1, d1, p2, d2):
    den = d1[0] * d2[1] - d1[1] * d2[0]
    if abs(den) < 1e-12:
        return p1
    t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den
    return (p1[0] + d1[0] * t, p1[1] + d1[1] * t)


class C:
    """Contour builder."""

    def __init__(self, start, kind="fill"):
        self.start = start
        self.kind = kind
        self.segs = []
        self.cur = start

    def L(self, p):
        self.segs.append(("L", p))
        self.cur = p
        return self

    def Ls(self, *pts):
        for p in pts:
            self.L(p)
        return self

    def Cu(self, c1, c2, p):
        self.segs.append(("C", c1, c2, p))
        self.cur = p
        return self

    def arc(self, p, t0, t1, k0, k1):
        """Cubic from cur to p. t0 = unit tangent leaving cur, t1 = unit
        tangent arriving at p, k0/k1 = handle lengths."""
        c1 = add(self.cur, mul(t0, k0))
        c2 = sub(p, mul(t1, k1))
        return self.Cu(c1, c2, p)

    def close(self):
        self.segs.append(("L", self.start))
        return {"kind": self.kind, "start": self.start, "segs": self.segs}


def poly(points, kind="fill"):
    c = C(points[0], kind)
    for p in points[1:]:
        c.L(p)
    return c.close()


def rect(x0, y0, x1, y1, kind="fill"):
    return poly([(x0, y0), (x0, y1), (x1, y1), (x1, y0)], kind)


def oval(x0, y0, x1, y1, kx, ky=None, kind="fill"):
    """Superelliptic oval from four cubics; kx/ky = handle fraction of radius
    (0.5523 = circle, higher = squarer). Starts at the top."""
    ky = kx if ky is None else ky
    xm, ym = (x0 + x1) / 2, (y0 + y1) / 2
    rx, ry = (x1 - x0) / 2, (y1 - y0) / 2
    c = C((xm, y1), kind)
    c.Cu((xm + rx * kx, y1), (x1, ym + ry * ky), (x1, ym))
    c.Cu((x1, ym - ry * ky), (xm + rx * kx, y0), (xm, y0))
    c.Cu((xm - rx * kx, y0), (x0, ym - ry * ky), (x0, ym))
    c.Cu((x0, ym + ry * ky), (xm - rx * kx, y1), (xm, y1))
    return {"kind": kind, "start": c.start, "segs": c.segs}


# ----------------------------------------------------------------- ink traps

def trap(X, u1, u2, depth, mouth):
    """Ink trap at a crotch X formed by two straight edges.

    u1, u2: unit directions from X along each edge into the open mouth.
    Returns points so that primitive 1 (owning edge 1) excludes
    triangle (A1, T, Y1) and primitive 2 excludes (A2, T, Y2); together they
    carve the V (A1, T, A2). With depth == mouth == 0 every point is X.
    """
    if depth <= 0 or mouth <= 0:
        return dict(A1=X, A2=X, T=X, Y1=X, Y2=X)
    bis = norm(add(u1, u2))
    T = sub(X, mul(bis, depth))
    A1 = add(X, mul(u1, mouth))
    A2 = add(X, mul(u2, mouth))
    Y1 = intersect(T, sub(A2, T), X, u1)
    Y2 = intersect(T, sub(A1, T), X, u2)
    return dict(A1=A1, A2=A2, T=T, Y1=Y1, Y2=Y2)


# --------------------------------------------------------------------- serifs

def serif(P, e, side, proj, tt, bh, fk=0.45, cut=0.0, inset=12.0):
    """Faceted wedge serif at the stroke-end corner P.

    e: unit vector from P along the stroke edge into the stroke.
    side: -1 projects left, +1 right. The serif face that touches the
    end line is flat; its inner face runs flat for proj*(1-fk) from the tip,
    then a straight chamfer (the 'facet bracket') climbs back to the stroke
    edge at height tt + bh. cut: tip slant (horizontal offset of the tip's
    inner corner). All sizes 0 = no serif (contour collapses onto P).
    """
    vs = 1.0 if e[1] > 0 else -1.0  # +1: bottom serif (grows up)
    s0 = (P[0] - side * inset, P[1])
    s1 = (P[0] + side * proj, P[1])
    s2 = (P[0] + side * (proj - cut), P[1] + vs * tt)
    s3 = (P[0] + side * proj * fk, P[1] + vs * tt)
    L = (tt + bh) / abs(e[1]) if (tt + bh) > 0 else 0.0
    s4 = add(P, mul(e, L))
    s5 = (s4[0] - side * inset, s4[1])
    if proj == 0 and tt == 0 and bh == 0:
        s0 = s5 = P
    return poly([s0, s1, s2, s3, s4, s5])


def mirror(contour, axis_x):
    def m(p):
        return (2 * axis_x - p[0], p[1])

    segs = []
    for s in contour["segs"]:
        segs.append((s[0],) + tuple(m(p) for p in s[1:]))
    return {"kind": contour["kind"], "start": m(contour["start"]), "segs": segs}


def shift(contour, dx, dy=0):
    def m(p):
        return (p[0] + dx, p[1] + dy)

    segs = [(s[0],) + tuple(m(p) for p in s[1:]) for s in contour["segs"]]
    return {"kind": contour["kind"], "start": m(contour["start"]), "segs": segs}


def flat_points(contour):
    pts = [contour["start"]]
    for s in contour["segs"]:
        pts.extend(s[1:])
    return pts


def signed_area(contour):
    """Polygon area through on- and off-curve points (orientation only)."""
    pts = [contour["start"]] + [s[-1] for s in contour["segs"]]
    # include controls for better robustness on curvy contours
    pts = flat_points(contour)
    a = 0.0
    for i in range(len(pts)):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % len(pts)]
        a += x0 * y1 - x1 * y0
    return a / 2


def reverse(contour):
    """Reverse direction, keeping the same start point."""
    start = contour["start"]
    segs = contour["segs"]
    # list of (from, seg)
    froms = [start] + [s[-1] for s in segs[:-1]]
    out = []
    for frm, s in reversed(list(zip(froms, segs))):
        if s[0] == "L":
            out.append(("L", frm))
        else:
            out.append(("C", s[2], s[1], frm))
    # out now starts from start (= end of last seg) and ends at start
    return {"kind": contour["kind"], "start": start, "segs": out}


# ------------------------------------------------------------ pen expansion
#
# A stroke is a chain of centerline cubics. Its width along the normal comes
# from a pen model: thin where the stroke runs parallel to the pen edge
# (angle phi), thick across it. phi = 0 gives vertical stress (rational,
# grotesk); phi = 20..30 deg gives the inclined stress of a broad nib.
# Each edge is fitted with a fixed number of cubics, so every master gets
# the same point structure.

def bz(b, t):
    p0, p1, p2, p3 = b
    m = 1 - t
    return (m * m * m * p0[0] + 3 * m * m * t * p1[0] + 3 * m * t * t * p2[0] + t * t * t * p3[0],
            m * m * m * p0[1] + 3 * m * m * t * p1[1] + 3 * m * t * t * p2[1] + t * t * t * p3[1])


def bzd(b, t):
    p0, p1, p2, p3 = b
    m = 1 - t
    return (3 * m * m * (p1[0] - p0[0]) + 6 * m * t * (p2[0] - p1[0]) + 3 * t * t * (p3[0] - p2[0]),
            3 * m * m * (p1[1] - p0[1]) + 6 * m * t * (p2[1] - p1[1]) + 3 * t * t * (p3[1] - p2[1]))


def pen_width(thick, thin, phi_deg, k=1.0):
    phi = math.radians(phi_deg)

    def f(d, i=0, t=0.0):
        th = math.atan2(d[1], d[0])
        s = abs(math.sin(th - phi)) ** k
        return thin + (thick - thin) * s
    return f


def _fit(Q, T0, T3):
    """Least-squares cubic through Q[0]..Q[-1] with fixed unit end tangents."""
    P0, P3 = Q[0], Q[-1]
    # chord-length parameters
    d = [0.0]
    for i in range(1, len(Q)):
        d.append(d[-1] + math.hypot(Q[i][0] - Q[i - 1][0], Q[i][1] - Q[i - 1][1]))
    L = d[-1] or 1.0
    u = [x / L for x in d]
    for _ in range(3):
        c11 = c12 = c22 = x1 = x2 = 0.0
        for uk, q in zip(u, Q):
            m = 1 - uk
            b0, b1, b2, b3 = m ** 3, 3 * m * m * uk, 3 * m * uk * uk, uk ** 3
            A1 = (T0[0] * b1, T0[1] * b1)
            A2 = (-T3[0] * b2, -T3[1] * b2)
            r = (q[0] - (b0 + b1) * P0[0] - (b2 + b3) * P3[0],
                 q[1] - (b0 + b1) * P0[1] - (b2 + b3) * P3[1])
            c11 += A1[0] * A1[0] + A1[1] * A1[1]
            c12 += A1[0] * A2[0] + A1[1] * A2[1]
            c22 += A2[0] * A2[0] + A2[1] * A2[1]
            x1 += A1[0] * r[0] + A1[1] * r[1]
            x2 += A2[0] * r[0] + A2[1] * r[1]
        det = c11 * c22 - c12 * c12
        if abs(det) < 1e-9:
            a = b = L / 3
        else:
            a = (x1 * c22 - x2 * c12) / det
            b = (c11 * x2 - c12 * x1) / det
        if not (0.02 * L < a < 0.9 * L) or not (0.02 * L < b < 0.9 * L):
            a = b = L / 3
        bez = (P0, add(P0, mul(T0, a)), sub(P3, mul(T3, b)), P3)
        # one Newton step of reparametrisation
        nu = []
        for uk, q in zip(u, Q):
            p = bz(bez, uk)
            dp = bzd(bez, uk)
            den = dp[0] * dp[0] + dp[1] * dp[1]
            if den > 0:
                uk = uk - ((p[0] - q[0]) * dp[0] + (p[1] - q[1]) * dp[1]) / den
            nu.append(min(1.0, max(0.0, uk)))
        nu[0], nu[-1] = 0.0, 1.0
        u = nu
    return bez


def _edge(segs, wfn, side, nsub, ns=14):
    """Offset edge of a centerline chain. side=+1 left, -1 right.
    Returns list of cubics (sub per centerline segment)."""
    out = []
    for i, b in enumerate(segs):
        for j in range(nsub):
            t0, t1 = j / nsub, (j + 1) / nsub

            def off(t):
                d = bzd(b, t)
                n_ = norm((-d[1], d[0]))
                w = wfn(d, i, t)
                c = bz(b, t)
                return (c[0] + side * n_[0] * w / 2, c[1] + side * n_[1] * w / 2)

            Q = [off(t0 + (t1 - t0) * k / ns) for k in range(ns + 1)]
            h = (t1 - t0) * 0.01
            T0 = norm(sub(off(t0 + h), off(t0)))
            T3 = norm(sub(off(t1), off(t1 - h)))
            out.append(_fit(Q, T0, T3))
    return out


def expand_loop(segs, wfn, nsub=2):
    """Closed clockwise centerline -> (outer fill, inner hole)."""
    outer = _edge(segs, wfn, +1, nsub)
    inner = _edge(segs, wfn, -1, nsub)
    res = []
    for kind, e in (("fill", outer), ("hole", inner)):
        # snap joins: average shared points so the contour closes exactly
        n_ = len(e)
        e = [list(x) for x in e]
        for k in range(n_):
            a_, b_ = e[k][3], e[(k + 1) % n_][0]
            m_ = ((a_[0] + b_[0]) / 2, (a_[1] + b_[1]) / 2)
            dd = sub(m_, a_)
            e[k][3] = m_
            e[k][2] = add(e[k][2], dd)
            dd2 = sub(m_, b_)
            e[(k + 1) % n_][0] = m_
            e[(k + 1) % n_][1] = add(e[(k + 1) % n_][1], dd2)
        c = C(e[0][0], kind)
        for x in e:
            c.Cu(x[1], x[2], x[3])
        res.append({"kind": kind, "start": c.start, "segs": c.segs})
    return res


def _snap_chain(e):
    e = [list(x) for x in e]
    for k in range(len(e) - 1):
        a_, b_ = e[k][3], e[k + 1][0]
        m_ = ((a_[0] + b_[0]) / 2, (a_[1] + b_[1]) / 2)
        e[k][2] = add(e[k][2], sub(m_, a_))
        e[k][3] = m_
        e[k + 1][1] = add(e[k + 1][1], sub(m_, b_))
        e[k + 1][0] = m_
    return e


def cap_points(b, t, wfn, i, cut):
    """End points of a stroke end cut along direction `cut` (unit vector),
    or perpendicular when cut is None. Returns (left, right)."""
    d = bzd(b, t)
    n_ = norm((-d[1], d[0]))
    w = wfn(d, i, t)
    c = bz(b, t)
    if cut is None:
        return add(c, mul(n_, w / 2)), sub(c, mul(n_, w / 2))
    dot = cut[0] * n_[0] + cut[1] * n_[1]
    s = (w / 2) / dot
    return add(c, mul(cut, s)), sub(c, mul(cut, s))


def expand_open(segs, wfn, nsub=2, cut0=None, cut1=None):
    """Open stroke -> one fill contour: left edge, end cut, right edge back,
    start cut. cut0/cut1: unit vectors of the end cuts (None = square)."""
    left = _snap_chain(_edge(segs, wfn, +1, nsub))
    right = _snap_chain(_edge(segs, wfn, -1, nsub))
    l0, r0 = cap_points(segs[0], 0.0, wfn, 0, cut0)
    l1, r1 = cap_points(segs[-1], 1.0, wfn, len(segs) - 1, cut1)
    # move edge ends onto the cut, keeping handle offsets
    left[0][1] = add(left[0][1], sub(l0, left[0][0]))
    left[0][0] = l0
    right[0][1] = add(right[0][1], sub(r0, right[0][0]))
    right[0][0] = r0
    left[-1][2] = add(left[-1][2], sub(l1, left[-1][3]))
    left[-1][3] = l1
    right[-1][2] = add(right[-1][2], sub(r1, right[-1][3]))
    right[-1][3] = r1
    c = C(l0)
    for x in left:
        c.Cu(x[1], x[2], x[3])
    c.L(r1)
    for x in reversed(right):
        c.Cu(x[2], x[1], x[0])
    return c.close()   # closing line r0 -> l0 is the start cut


def knife(X, u_in, mouth_dir, depth, mouth):
    """Knife incision at a crotch X: a slit that continues the incoming edge
    (direction u_in, pointing into the solid) for `depth`, opening by `mouth`
    along mouth_dir on the other edge. Returns (T, A). depth 0 -> X."""
    if depth <= 0:
        return X, X
    T = add(X, mul(u_in, depth))
    A = add(X, mul(mouth_dir, mouth))
    return T, A


def blade_serif(P, e, side, proj, tt, bh, cut=0.0, concave=0.55, inset=12.0):
    """Wedge serif with a concave bracket (a cubic sweeping from the tip back
    into the stem edge). Collapses onto P when proj = tt = bh = 0."""
    vs = 1.0 if e[1] > 0 else -1.0
    if proj == 0 and tt == 0 and bh == 0:
        return {"kind": "fill", "start": P,
                "segs": [("L", P), ("L", P), ("C", P, P, P), ("L", P), ("L", P)]}
    s0 = (P[0] - side * inset, P[1])
    s1 = (P[0] + side * proj, P[1])
    s2 = (P[0] + side * (proj - cut), P[1] + vs * tt)
    L = (tt + bh) / abs(e[1])
    s4 = add(P, mul(e, L))
    s5 = (s4[0] - side * inset, s4[1])
    # concave bracket: leaves the tip flat, arrives tangent to the stem
    c1 = (s2[0] - side * (proj - cut) * concave, s2[1])
    c2 = sub(s4, mul(e, L * concave * 0.9))
    c = C(s0)
    c.L(s1)
    c.L(s2)
    c.Cu(c1, c2, s4)
    c.L(s5)
    return c.close()
