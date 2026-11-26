"""Design parameters of the four Gran masters.

Design space: opsz 12..33 (optical size in CSS px) x SERF 0..100
(0 = Grotesk, 100 = Antiqua). Vertical metrics are shared along SERF so the
two genres can be mixed inside one line; they change only with optical size.

Units: 1000 UPM. v/V = lowercase/capital vertical stems, hl/Hc = horizontal
strokes. Serif sizes at 0 make the serif contours collapse (Grotesk).
"""

SIZE = {
    # text size: bigger x-height, heavier and lower-contrast strokes,
    # wider letters, looser spacing, deep ink traps
    12: dict(cap=700, xh=532, sc=552, dd=-170, ov=12, ovl=11,
             wH=566, wO=712, wo=536, wn=474, wa=468, wd=500, wZ=830,
             sb=66, trapD=24, trapS=22, slopeS=0.10, gapZ=0.34),
    # display size: lower x-height, finer strokes, more contrast,
    # narrower letters, tight spacing, traps shrink to small facets
    33: dict(cap=700, xh=500, sc=518, dd=-152, ov=10, ovl=9,
             wH=528, wO=676, wo=494, wn=440, wa=438, wd=466, wZ=780,
             sb=44, trapD=9, trapS=17, slopeS=0.15, gapZ=0.20),
}

GENRE = {
    (12, "G"): dict(V=96, v=90, Hc=82, hl=76, ko=0.60, ki=0.665,
                    zArmA=0.86, zArmB=0.86, zLegA=0.92, zLegB=0.92,
                    dLeg=0.90,
                    proj=0, tt=0, bh=0, fk=0.5, cut=0,
                    lproj=0, ltt=0, lbh=0, hp=0, htt=0, hbh=0, slope=None,
                    beak=0, flare=0, trapK=1.0),
    (12, "A"): dict(V=98, v=92, Hc=50, hl=46, ko=0.565, ki=0.60,
                    # Antiqua contrast follows the broad pen: strokes falling
                    # to the right are heavy, rising ones are hairlines
                    zArmA=0.96, zArmB=0.52, zLegA=0.50, zLegB=0.98,
                    dLeg=0.74,
                    proj=50, tt=30, bh=26, fk=0.52, cut=6,
                    lproj=42, ltt=26, lbh=20, hp=44, htt=28, hbh=22, slope=0.20,
                    beak=34, flare=16, trapK=0.75),
    (33, "G"): dict(V=88, v=82, Hc=70, hl=64, ko=0.625, ki=0.695,
                    zArmA=0.86, zArmB=0.86, zLegA=0.93, zLegB=0.93,
                    dLeg=0.90,
                    proj=0, tt=0, bh=0, fk=0.5, cut=0,
                    lproj=0, ltt=0, lbh=0, hp=0, htt=0, hbh=0, slope=None,
                    beak=0, flare=0, trapK=1.0),
    (33, "A"): dict(V=94, v=88, Hc=26, hl=24, ko=0.565, ki=0.585,
                    zArmA=0.95, zArmB=0.30, zLegA=0.28, zLegB=0.97,
                    dLeg=0.52,
                    proj=64, tt=15, bh=42, fk=0.42, cut=9,
                    lproj=54, ltt=14, lbh=34, hp=54, htt=15, hbh=34, slope=0.24,
                    beak=50, flare=24, trapK=0.5),
}

MASTERS = [
    # name, opsz, SERF, genre key
    ("TextGrotesk", 12, 0, "G"),
    ("TextAntiqua", 12, 100, "A"),
    ("DisplayGrotesk", 33, 0, "G"),
    ("DisplayAntiqua", 33, 100, "A"),
]


def params(opsz, genre):
    p = dict(SIZE[opsz])
    p.update(GENRE[(opsz, genre)])
    p["opsz"] = opsz
    p["genre"] = genre
    if p["slope"] is None:
        p["slope"] = p["slopeS"]
    p["trapD"] *= p["trapK"]
    p["trapS"] *= p["trapK"] if genre == "A" else 1.0
    # Antiqua needs room for serif tips: stem sidebearing grows a little
    p["sbStem"] = p["sb"] + (0.30 * p["proj"] if genre == "A" else 0)
    return p
