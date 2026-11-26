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
