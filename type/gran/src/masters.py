"""Gran 0.04 masters: strict, calibrated against professional references.

Proportions and spacing were measured on Inter (opsz 14/32) and Source
Serif 4 (opsz 12/36) with tools/measure.py and adapted, not copied: our
cap height is 700, x-height 0.75 cap for text and 0.71 cap for display.

Character lives in two quiet details only: terminals are cut at a fixed
angle, and the Antiqua's lowercase head serif is a sharp flag that
continues the slanted cut of the stem top.
"""

M = {
    "G12": dict(
        cap=700, xh=526, dd=-160, ov=10, ovl=10,
        V=92, v=86, Hc=82, hl=76, sideK=1.03, topK=0.93,
        wH=548, wO=624, wo=480, wn=421, wa=424, wd=468, wZ=868,
        sbH=80, sbnL=74, sbnR=70, sbo=49, sbO=52, sbZ=18, sbd=16,
        tensO=0.575, tensI=0.61, tilt=0,
        yJo=0.865, yC=0.615, ySh=0.50, xT=0.47, joinK=1.0,
        cut=24, armK=0.86, legK=0.95, armThin=0.86, legThin=0.95, slope=0.0,
        proj=0, tt=0, bh=0, lproj=0, ltt=0, lbh=0, hp=0, htt=0, hbh=0,
        flare=0),
    "G33": dict(
        cap=700, xh=496, dd=-152, ov=11, ovl=9,
        V=86, v=81, Hc=76, hl=70, sideK=1.03, topK=0.90,
        wH=538, wO=636, wo=461, wn=407, wa=401, wd=452, wZ=859,
        sbH=62, sbnL=60, sbnR=56, sbo=34, sbO=40, sbZ=10, sbd=10,
        tensO=0.585, tensI=0.625, tilt=0,
        yJo=0.87, yC=0.62, ySh=0.50, xT=0.47, joinK=0.94,
        cut=24, armK=0.84, legK=0.94, armThin=0.84, legThin=0.94, slope=0.0,
        proj=0, tt=0, bh=0, lproj=0, ltt=0, lbh=0, hp=0, htt=0, hbh=0,
        flare=0),
    "A12": dict(
        cap=700, xh=526, dd=-160, ov=15, ovl=12,
        V=100, v=92, Hc=58, hl=54, sideK=1.06, topK=None,
        wH=560, wO=660, wo=512, wn=447, wa=430, wd=476, wZ=900,
        sbH=34, sbnL=34, sbnR=28, sbo=46, sbO=48, sbZ=10, sbd=14,
        tensO=0.56, tensI=0.575, tilt=8,
        yJo=0.84, yC=0.66, ySh=0.50, xT=0.49, joinK=0.70,
        cut=24, armK=0.98, legK=1.02, armThin=0.48, legThin=0.46, slope=0.20,
        proj=62, tt=22, bh=36, lproj=50, ltt=20, lbh=30, hp=48, htt=20, hbh=34,
        flare=14),
    "A33": dict(
        cap=700, xh=496, dd=-152, ov=15, ovl=13,
        V=88, v=82, Hc=38, hl=34, sideK=1.06, topK=None,
        wH=520, wO=620, wo=471, wn=400, wa=405, wd=450, wZ=880,
        sbH=40, sbnL=32, sbnR=28, sbo=44, sbO=46, sbZ=6, sbd=12,
        tensO=0.555, tensI=0.57, tilt=12,
        yJo=0.83, yC=0.68, ySh=0.50, xT=0.50, joinK=0.55,
        cut=24, armK=0.98, legK=1.02, armThin=0.30, legThin=0.28, slope=0.26,
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
