"""Build Gran: 4 masters -> variable TTF + WOFF2 (opsz x SERF).

python3 type/gran/src/build.py
"""
import json
import os
import sys

from fontTools.cu2qu import curves_to_quadratic
from fontTools.designspaceLib import (AxisDescriptor, DesignSpaceDocument,
                                      InstanceDescriptor, SourceDescriptor)
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.fontBuilder import FontBuilder
from fontTools.otlLib.builder import buildStatTable
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables import ttProgram
from fontTools.ttLib.tables._g_l_y_f import (Glyph, GlyphCoordinates,
                                             flagOnCurve, flagOverlapSimple)
from fontTools import varLib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from geom import reverse, signed_area  # noqa: E402
from letters import ALIASES, GLYPHS  # noqa: E402
from masters import MASTERS, params  # noqa: E402

ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "fonts")
MDIR = os.path.join(ROOT, "build", "masters")
FAMILY = "Gran"
UPM = 1000
TOL = 0.8  # cu2qu tolerance, font units


def outlines():
    """{glyph: {master: (contours, advance)}} with orientation fixed."""
    res = {}
    for gname, _, fn in GLYPHS:
        per = {}
        for mname, opsz, serf, genre in MASTERS:
            per[mname] = fn(params(opsz, genre))
        # orientation decided once per contour from the master where it is
        # largest, then applied everywhere (collapsed serifs have no area)
        n = len(per[MASTERS[0][0]][0])
        for mname in per:
            assert len(per[mname][0]) == n, (gname, mname)
        for i in range(n):
            areas = [signed_area(per[m][0][i]) for m in per]
            ref = max(areas, key=abs)
            kind = per[MASTERS[0][0]][0][i]["kind"]
            want_cw = kind == "fill"   # TrueType: filled = clockwise
            is_cw = ref < 0
            if is_cw != want_cw:
                for m in per:
                    cs = per[m][0]
                    cs[i] = reverse(cs[i])
        res[gname] = per
    return res


def to_glyf(gname, per):
    """Joint cubic->quadratic conversion, so all masters stay compatible."""
    mnames = list(per)
    ncont = len(per[mnames[0]][0])
    coords = {m: [] for m in mnames}
    flags = []
    ends = []
    for ci in range(ncont):
        cons = [per[m][0][ci] for m in mnames]
        segs0 = cons[0]["segs"]
        for c in cons:
            assert [s[0] for s in c["segs"]] == [s[0] for s in segs0], \
                f"{gname}: contour {ci} incompatible"
        for m, c in zip(mnames, cons):
            coords[m].append(c["start"])
        flags.append(flagOnCurve)
        cur = [c["start"] for c in cons]
        nseg = len(segs0)
        for si in range(nseg):
            kind = segs0[si][0]
            last = si == nseg - 1
            if kind == "L":
                if not last:
                    for m, c in zip(mnames, cons):
                        coords[m].append(c["segs"][si][1])
                    flags.append(flagOnCurve)
            else:
                curves = [[cur[k]] + list(cons[k]["segs"][si][1:])
                          for k in range(len(cons))]
                splines = curves_to_quadratic(curves, [TOL] * len(curves))
                for k, m in enumerate(mnames):
                    sp = splines[k]
                    pts = sp[1:] if not last else sp[1:-1]
                    coords[m].extend(pts)
                nq = len(splines[0]) - 2  # off-curve count
                flags.extend([0] * nq)
                if not last:
                    flags.append(flagOnCurve)
            cur = [c["segs"][si][-1] for c in cons]
        ends.append(len(flags) - 1)
    out = {}
    for m in mnames:
        g = Glyph()
        g.numberOfContours = ncont
        g.coordinates = GlyphCoordinates([(round(x), round(y)) for x, y in coords[m]])
        fl = bytearray(flags)
        if fl:
            fl[0] |= flagOverlapSimple
        g.flags = fl
        g.endPtsOfContours = ends
        g.program = ttProgram.Program()
        g.program.fromBytecode(b"")
        out[m] = g
    return out


def notdef(p):
    pen = TTGlyphPen(None)
    w, h, t = 480, p["cap"], 50
    for (x0, y0, x1, y1, cw) in [(40, 0, 40 + w, h, True),
                                 (40 + t, t, 40 + w - t, h - t, False)]:
        pts = [(x0, y0), (x0, y1), (x1, y1), (x1, y0)]
        if not cw:
            pts = pts[::-1]
        pen.moveTo(pts[0])
        for q in pts[1:]:
            pen.lineTo(q)
        pen.closePath()
    return pen.glyph(), w + 80


def build_master(mname, opsz, genre, data, glyfs):
    p = params(opsz, genre)
    order = [".notdef", "space"] + [g for g, _, _ in GLYPHS] + [a for a, _, _ in ALIASES]
    cmap = {0x20: "space", 0xA0: "space"}
    for g, u, _ in GLYPHS:
        if u:
            cmap[u] = g
    for a_, u, _ in ALIASES:
        cmap[u] = a_
    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap)
    glyphs = {}
    metrics = {}
    nd, ndw = notdef(p)
    glyphs[".notdef"] = nd
    sp = Glyph()
    sp.numberOfContours = 0
    glyphs["space"] = sp
    space_w = round(p["wn"] * 0.52)
    for g, _, _ in GLYPHS:
        glyphs[g] = glyfs[g][mname]
    for a_, _, base in ALIASES:
        pen = TTGlyphPen(glyphs)
        pen.addComponent(base, (1, 0, 0, 1, 0, 0))
        glyphs[a_] = pen.glyph()
    fb.setupGlyf(glyphs)
    gl = fb.font["glyf"]
    metrics[".notdef"] = (ndw, 40)
    metrics["space"] = (space_w, 0)
    for g, _, _ in GLYPHS:
        gg = gl[g]
        gg.recalcBounds(gl)
        metrics[g] = (round(data[g][mname][1]), gg.xMin)
    for a_, _, base in ALIASES:
        metrics[a_] = metrics[base]
    fb.setupHorizontalMetrics(metrics)
    asc, desc = 940, -260
    fb.setupHorizontalHeader(ascent=asc, descent=desc, lineGap=0)
    import re as _re
    style = " ".join(_re.findall(r"[A-Z][a-z]+", mname))
    fb.setupNameTable({
        "familyName": FAMILY,
        "styleName": "Regular",
        "uniqueFontIdentifier": f"{FAMILY}-{mname};0.010",
        "fullName": f"{FAMILY} {style}",
        "psName": f"{FAMILY}-{mname}",
        "version": "Version 0.010",
        "copyright": "Gran prototype. Work in progress.",
        "designer": "Gran type studio prototype",
        "description": "Variable Cyrillic/Latin superfamily prototype: Grotesk to Antiqua, text to display.",
    })
    fb.setupOS2(version=4, sTypoAscender=760, sTypoDescender=-240, sTypoLineGap=200,
                usWinAscent=980, usWinDescent=300, sxHeight=p["xh"],
                sCapHeight=p["cap"], usWeightClass=400, achVendID="NONE",
                fsType=0, fsSelection=0x40 | 0x80,
                ulUnicodeRange1=(1 << 0) | (1 << 1) | (1 << 9),
                ulCodePageRange1=(1 << 0) | (1 << 2))
    fb.setupPost(keepGlyphNames=True)
    fb.setupHead(unitsPerEm=UPM, fontRevision=0.010)
    os.makedirs(MDIR, exist_ok=True)
    path = os.path.join(MDIR, f"{FAMILY}-{mname}.ttf")
    fb.save(path)
    return path


FEA = """
languagesystem DFLT dflt;
languagesystem latn dflt;
languagesystem cyrl dflt;

feature smcp {
  sub o by o.sc;
  sub o-cy by o.sc;
} smcp;

feature c2sc {
  sub H by h.sc;
  sub En-cy by h.sc;
  sub O by o.sc;
  sub O-cy by o.sc;
  sub Zhe-cy by zhe-cy.sc;
} c2sc;
"""


def main():
    data = outlines()
    glyfs = {g: to_glyf(g, data[g]) for g in data}
    ds = DesignSpaceDocument()
    ax1 = AxisDescriptor()
    ax1.tag, ax1.name, ax1.minimum, ax1.default, ax1.maximum = "opsz", "Optical size", 12, 12, 33
    ax2 = AxisDescriptor()
    ax2.tag, ax2.name, ax2.minimum, ax2.default, ax2.maximum = "SERF", "Serif", 0, 0, 100
    ds.addAxis(ax1)
    ds.addAxis(ax2)
    for mname, opsz, serf, genre in MASTERS:
        path = build_master(mname, opsz, genre, data, glyfs)
        s = SourceDescriptor()
        s.path = path
        s.name = mname
        s.location = {"Optical size": opsz, "Serif": serf}
        if mname == "TextGrotesk":
            s.copyInfo = True
        ds.addSource(s)
    for name, opsz, serf in [("Text Grotesk", 12, 0), ("Text Flare", 12, 50),
                             ("Text Antiqua", 12, 100),
                             ("Display Grotesk", 33, 0),
                             ("Display Flare", 33, 50),
                             ("Display Antiqua", 33, 100)]:
        i = InstanceDescriptor()
        i.familyName = FAMILY
        i.styleName = name
        i.location = {"Optical size": opsz, "Serif": serf}
        ds.addInstance(i)
    dspath = os.path.join(ROOT, "build", "Gran.designspace")
    ds.write(dspath)
    vf, _, _ = varLib.build(ds)
    addOpenTypeFeaturesFromString(vf, FEA)
    buildStatTable(vf, [
        dict(tag="opsz", name="Optical size", values=[
            dict(value=12, name="Text"), dict(value=33, name="Display")]),
        dict(tag="SERF", name="Serif", values=[
            dict(value=0, name="Grotesk", flags=0x2),
            dict(value=50, name="Flare"),
            dict(value=100, name="Antiqua")]),
    ])
    os.makedirs(OUT, exist_ok=True)
    ttf = os.path.join(OUT, "GranVF.ttf")
    vf.save(ttf)
    vf.flavor = "woff2"
    vf.save(os.path.join(OUT, "GranVF.woff2"))
    # outline dump for proofs
    dump = {g: {m: {"adv": data[g][m][1], "contours": data[g][m][0]}
                for m in data[g]} for g in data}
    with open(os.path.join(ROOT, "build", "outlines.json"), "w") as f:
        json.dump(dump, f)
    print("built", ttf, os.path.getsize(ttf), "bytes")


if __name__ == "__main__":
    main()
