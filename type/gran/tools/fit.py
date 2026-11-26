"""Fit Gran construction parameters to a reference glyph by comparing
scan-line profiles (horizontal and vertical runs). Coordinate descent.
Usage: fit.py MASTER(G12|G33) GLYPH REF_OPSZ param1 param2 ..."""
import sys, os, json
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(os.path.dirname(HERE), 'src'))
from measure import load, polys, runs_h, runs_v
import masters, glyphs

REF = sys.argv[-1]


def flatten(contours, n=16):
    out = []
    for c in contours:
        pts = [c["start"]]
        cur = c["start"]
        for s in c["segs"]:
            if s[0] == "L":
                pts.append(s[1])
            else:
                p0, a, b, p3 = cur, s[1], s[2], s[3]
                for i in range(1, n + 1):
                    t = i / n; m = 1 - t
                    pts.append((m**3*p0[0]+3*m*m*t*a[0]+3*m*t*t*b[0]+t**3*p3[0],
                                m**3*p0[1]+3*m*m*t*a[1]+3*m*t*t*b[1]+t**3*p3[1]))
            cur = s[-1]
        area = sum(pts[i][0]*pts[(i+1)%len(pts)][1]-pts[(i+1)%len(pts)][0]*pts[i][1] for i in range(len(pts)))
        if abs(area) < 1e-6:
            continue
        want_ccw = c["kind"] == "fill"      # any consistent rule works for nonzero
        if (area > 0) != want_ccw:
            pts = pts[::-1]
        out.append(pts)
    return out


def profile(P, ys, xs):
    return [runs_h(P, y) for y in ys], [runs_v(P, x) for x in xs]


def err(A, B):
    e = 0.0
    for ra, rb in zip(A, B):
        if len(ra) != len(rb):
            e += 120 * abs(len(ra) - len(rb))
        for (a0, a1), (b0, b1) in zip(ra, rb):
            e += abs(a0 - b0) + abs(a1 - b1)
    return e


def main():
    mkey, gname, ropsz = sys.argv[1], sys.argv[2], float(sys.argv[3])
    names = sys.argv[4].split(',')
    ref = load(REF, dict(opsz=ropsz, wght=400))
    RP, _ = polys(ref, ref.getBestCmap()[ord(gname)])
    fn = dict(H=glyphs.H, O=glyphs.O, n=glyphs.n, o=glyphs.o, a=glyphs.a)[gname]
    genre, opsz = mkey[0], int(mkey[1:])
    base = masters.M[mkey]
    top = 720 if gname.isupper() else 530
    ys = list(range(-14, top, 6))
    xs = list(range(0, 760, 8))
    RA, RB = profile(RP, ys, xs)

    def cost(p):
        P = flatten(fn(masters.params(opsz, genre) | p)[0])
        A, B = profile(P, ys, xs)
        return err(A, RA) + err(B, RB)

    mp = masters.params(opsz, genre)
    cur = {k: mp.get(k, None) for k in names}
    # defaults from glyph code when absent
    defaults = dict(aHk=0.98, aTix=0.035, aDs=0.30, aEx=0.03, aO1=0.66, aO2=0.56, aShK=0.58, aShV=0.56,
                    aI1=0.55, aI2=0.58, aI3=0.56, aI4=0.55, aB2a=0.56, aB2b=0.58, aB3a=0.55, aB3d=0.55,
                    aB3b=0.75, aHtop=1.0, aVb=1.0, aHlb=1.0, aCmy=0.10, aCbx=0.06, aC2a=0.56, aC2b=0.58,
                    aC3a=0.55, aC3d=0.55, aC3b=0.70, aFlatC=0.95, aCornerC=0.80,
                    nTaper=0.0, nLeftK=0.52, nJoK=0.95, nShK=0.60, nShV=0.56,
                    tensOo=0.572, tensIo=0.572, oSideK=1.0, sideKO=1.025, topKO=0.85, hY=0.51,
                    aTbx=0.55, aTbdy=0.0, aT1=0.40, aT1y=0.9, aT2=0.40, aL1=0.56, aL2=0.56,
                    aTcx=0.50, aTcdy=0.0, aTc1=0.40, aTc1y=0.9, aTc2=0.40, aCL1=0.56, aCL2=0.56)
    for k in names:
        if cur[k] is None:
            cur[k] = defaults[k]
    best = cost(cur)
    print('start', round(best))
    step = {k: max(0.02, abs(cur[k]) * 0.12) for k in names}
    for it in range(14):
        improved = False
        for k in names:
            for sgn in (+1, -1):
                trial = dict(cur); trial[k] = cur[k] + sgn * step[k]
                try:
                    c = cost(trial)
                except Exception:
                    continue
                if c < best - 0.5:
                    best, cur, improved = c, trial, True
                    break
        if not improved:
            step = {k: s * 0.5 for k, s in step.items()}
            if max(step.values()) < 0.002:
                break
    print('end', round(best))
    print(json.dumps({k: round(v, 4) for k, v in cur.items()}))


main()
