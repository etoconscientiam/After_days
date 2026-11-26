"""Gran 0.04 masters: strict, calibrated against professional references.

Proportions and spacing were measured on Inter (opsz 14/32) and Source
Serif 4 (opsz 12/36) with tools/measure.py and adapted, not copied: our
cap height is 700, x-height 0.75 cap for text and 0.71 cap for display.

Character lives in two quiet details only: terminals are cut at a fixed
angle, and the Antiqua's lowercase head serif is a sharp flag that
continues the slanted cut of the stem top.
"""

M = {
    # Grotesk: geometric, after the reference the client chose (DM Sans,
    # measured at opsz 14 and 33). DM Sans has no Cyrillic: Zhe and de are
    # drawn here in the same geometric logic.
    "G12": dict(
        cap=700, xh=504, dd=-150, ov=12, ovl=12,
        V=84, v=84, Hc=69, hl=70, sideK=1.025, topK=0.85,
        wH=531, wO=679, wo=496, wn=445, wa=434, wd=492, wZ=860,
        sbH=75, sbnL=70, sbnR=61, sbo=49, sbO=48, sbZ=16, sbd=14,
        sbaL=51, sbaR=60,
        tensO=0.572, tensI=0.572, tilt=0,
        yJo=0.825, yC=0.57, ySh=0.60, xT=0.45, joinK=1.0, xTi=0.53,
        cut=0, armK=0.90, legK=0.98, armThin=0.90, legThin=0.98, slope=0.0,
        aBt=0.595, aHs=0.62, aHi=0.66, aEy=0.70, aTopX=0.52, aBb=0.18, aCb=0.20,
        aBm=0.28, aBx=0.50, aSlope=0.0, aFlat=0.95, aCorner=0.76, aFlatC=0.95, aCornerC=0.80, aTaper=0.14,
        nTaper=0.10, nLeftK=0.34, nJoK=0.80, nShK=0.68, nShV=0.62, aShK=0.66, aShV=0.60,
        proj=0, tt=0, bh=0, lproj=0, ltt=0, lbh=0, hp=0, htt=0, hbh=0,
        flare=0),
    "G33": dict(
        cap=700, xh=496, dd=-148, ov=12, ovl=12,
        V=84, v=84, Hc=69, hl=68, sideK=1.025, topK=0.82,
        wH=531, wO=690, wo=496, wn=445, wa=434, wd=490, wZ=860,
        sbH=58, sbnL=53, sbnR=45, sbo=35, sbO=40, sbZ=8, sbd=8,
        sbaL=39, sbaR=45,
        tensO=0.572, tensI=0.572, tilt=0,
        yJo=0.825, yC=0.57, ySh=0.60, xT=0.45, joinK=1.0, xTi=0.53,
        cut=0, armK=0.90, legK=0.98, armThin=0.90, legThin=0.98, slope=0.0,
        aBt=0.595, aHs=0.62, aHi=0.66, aEy=0.70, aTopX=0.52, aBb=0.18, aCb=0.20,
        aBm=0.28, aBx=0.50, aSlope=0.0, aFlat=0.95, aCorner=0.76, aFlatC=0.95, aCornerC=0.80, aTaper=0.14,
        nTaper=0.10, nLeftK=0.34, nJoK=0.80, nShK=0.68, nShV=0.62, aShK=0.66, aShV=0.60,
        proj=0, tt=0, bh=0, lproj=0, ltt=0, lbh=0, hp=0, htt=0, hbh=0,
        flare=0),
    "A12": dict(
        cap=700, xh=504, dd=-150, ov=15, ovl=12,
        V=100, v=92, Hc=58, hl=54, sideK=1.06, topK=None,
        wH=560, wO=660, wo=512, wn=447, wa=430, wd=476, wZ=900,
        sbH=34, sbnL=34, sbnR=28, sbo=46, sbO=48, sbZ=10, sbd=14,
        tensO=0.56, tensI=0.575, tilt=8,
        yJo=0.84, yC=0.66, ySh=0.50, xT=0.49, joinK=0.70,
        cut=24, armK=0.98, legK=1.02, armThin=0.48, legThin=0.46, slope=0.20,
        xTi=0.06, sbaL=None, sbaR=None,
        aBt=0.56, aHs=0.60, aHi=0.63, aEy=0.715, aTopX=0.50, aBb=0.11, aCb=None,
        aBm=0.245, aBx=0.56, aSlope=0.10, aFlat=0.52, aCorner=0.56,
        proj=62, tt=22, bh=36, lproj=50, ltt=20, lbh=30, hp=48, htt=20, hbh=34,
        flare=14),
    "A33": dict(
        cap=700, xh=496, dd=-148, ov=15, ovl=13,
        V=88, v=82, Hc=38, hl=34, sideK=1.06, topK=None,
        wH=520, wO=620, wo=471, wn=400, wa=405, wd=450, wZ=880,
        sbH=40, sbnL=32, sbnR=28, sbo=44, sbO=46, sbZ=6, sbd=12,
        tensO=0.555, tensI=0.57, tilt=12,
        yJo=0.83, yC=0.68, ySh=0.50, xT=0.50, joinK=0.55,
        cut=24, armK=0.98, legK=1.02, armThin=0.30, legThin=0.28, slope=0.26,
        xTi=0.06, sbaL=None, sbaR=None,
        aBt=0.56, aHs=0.60, aHi=0.63, aEy=0.715, aTopX=0.50, aBb=0.11, aCb=None,
        aBm=0.245, aBx=0.56, aSlope=0.10, aFlat=0.52, aCorner=0.56,
        proj=70, tt=12, bh=44, lproj=56, ltt=10, lbh=38, hp=56, htt=11, hbh=42,
        flare=20),
}

MASTERS = [
    ("TextGrotesk", 12, 0, "G"),
    ("TextAntiqua", 12, 100, "A"),
    ("DisplayGrotesk", 33, 0, "G"),
    ("DisplayAntiqua", 33, 100, "A"),
]


def wght_of(genre):
    return 400


def params(opsz, genre):
    p = dict(M[f"{genre[0]}{opsz}"])
    p["opsz"] = opsz
    p["genre"] = genre[0]
    if p["topK"] is None:
        p["topK"] = p["hl"] / (p["v"] * p["sideK"])
    # sidebearing measured from the stem: serif projection + gap to the tip
    p["sbStem"] = p["sbH"] + p["proj"]
    p["sbStemL"] = p["sbnL"] + p["lproj"]
    p["sbStemR"] = p["sbnR"] + p["lproj"]
    return p
