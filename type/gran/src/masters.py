"""Design parameters of the four Gran masters (v0.02, "Резец").

Design space: opsz 12..33 (CSS px) x SERF 0..100 (0 Grotesk, 100 Antiqua).
Vertical metrics change with optical size only, so the genres mix in a line.

The idea of v0.02: one knife. Every cut in the family (stem tops, the slit
where an arch leaves a stem, terminals, descenders, serifs) is made by the
same blade. At text size the blade is blunt and functional; at display size
it becomes the expression. Curves are drawn with a pen whose angle turns
from 0 (rational, Grotesk) to 18-24 degrees (broad nib, Antiqua).
"""

SIZE = {
    12: dict(cap=700, xh=532, sc=552, dd=-170, ov=12, ovl=11,
             wH=566, wO=700, wo=520, wn=470, wa=470, wd=488, wZ=806,
             sb=66),
    33: dict(cap=700, xh=500, sc=518, dd=-150, ov=10, ovl=9,
             wH=528, wO=666, wo=480, wn=436, wa=436, wd=456, wZ=764,
             sb=44),
}

GENRE = {
    (12, "G"): dict(
        V=96, v=90, Hc=82, hl=76, phi=0, oTilt=0, pinch=0.0, kpen=1.4, tens=0.60, tensIn=0.06, tensR=0.62,
        slope=0.20,          # stem-top cut, rise per unit of width
        knifeD=0.26, knifeM=18,   # slit depth (x stem) and mouth
        join=0.56,           # arch join thickness (x stem)
        aTop=0.12, aFoot=0.20, termCut=18,
        zOver=0.30, zRound=0.30, zThick=0.96, zThin=0.90,
        dLegThin=0.90, descCut=0.40, flare=0,
        proj=0, tt=0, bh=0, cut=0, lproj=0, ltt=0, lbh=0,
        hp=0, htt=0, hbh=0, beak=0),
    (33, "G"): dict(
        V=88, v=82, Hc=68, hl=62, phi=0, oTilt=0, pinch=0.6, kpen=1.5, tens=0.635, tensIn=0.06, tensR=0.66,
        slope=0.30, knifeD=0.58, knifeM=10, join=0.50,
        aTop=0.16, aFoot=0.30, termCut=24,
        zOver=-0.11, zRound=0.52, zThick=0.96, zThin=0.88,
        dLegThin=0.88, descCut=0.60, flare=0,
        proj=0, tt=0, bh=0, cut=0, lproj=0, ltt=0, lbh=0,
        hp=0, htt=0, hbh=0, beak=0),
    (12, "A"): dict(
        V=98, v=92, Hc=46, hl=42, phi=18, oTilt=9, pinch=0.15, kpen=1.0, tens=0.565, tensIn=0.03, tensR=0.58,
        slope=0.34, knifeD=0.24, knifeM=14, join=0.40,
        aTop=0.20, aFoot=0.0, termCut=26,
        zOver=0.26, zRound=0.20, zThick=1.00, zThin=0.42,
        dLegThin=0.55, descCut=0.50, flare=14,
        proj=46, tt=22, bh=30, cut=4, lproj=40, ltt=20, lbh=24,
        hp=46, htt=18, hbh=34, beak=40),
    (33, "A"): dict(
        V=94, v=88, Hc=22, hl=20, phi=24, oTilt=15, pinch=0.85, kpen=0.9, tens=0.56, tensIn=0.025, tensR=0.57,
        slope=0.42, knifeD=0.50, knifeM=8, join=0.30,
        aTop=0.24, aFoot=0.0, termCut=32,
        zOver=-0.07, zRound=0.55, zThick=1.00, zThin=0.22,
        dLegThin=0.42, descCut=0.62, flare=26,
        proj=62, tt=9, bh=46, cut=6, lproj=54, ltt=8, lbh=40,
        hp=60, htt=8, hbh=46, beak=62),
}

MASTERS = [
    # name, opsz, SERF, genre (+K = Black, wght 900)
    ("TextGrotesk", 12, 0, "G"),
    ("TextAntiqua", 12, 100, "A"),
    ("DisplayGrotesk", 33, 0, "G"),
    ("DisplayAntiqua", 33, 100, "A"),
    ("TextGroteskBlack", 12, 0, "GK"),
    ("TextAntiquaBlack", 12, 100, "AK"),
    ("DisplayGroteskBlack", 33, 0, "GK"),
    ("DisplayAntiquaBlack", 33, 100, "AK"),
]


def wght_of(genre):
    return 900 if genre.endswith("K") else 400


def black(p):
    """Black: woodcut mass. Stems roughly double; in the Antiqua the
    hairlines grow much less, so the contrast rises (a fat face cut in
    wood). Letters widen by most of the added stem weight, sidebearings
    tighten, the knife cuts deeper and counters get sharper."""
    A = p["genre"] == "A"
    dV = p["V"] * (1.10 if A else 1.02)
    dv = p["v"] * (1.12 if A else 1.06)
    p["V"] += dV
    p["v"] += dv
    p["Hc"] *= 1.40 if A else 1.80
    p["hl"] *= 1.45 if A else 1.80
    p["wH"] += dV * 1.05
    p["wO"] += dV * 1.10
    p["wo"] += dv * 1.10
    p["wn"] += dv * 1.10
    p["wa"] += dv * 1.10
    p["wd"] += dv * 1.05
    p["wZ"] += dV * 1.45
    p["sb"] *= 0.78
    p["knifeD"] = min(0.78, p["knifeD"] * 1.5)
    p["knifeM"] *= 1.6
    p["join"] *= 0.80
    p["pinch"] = min(0.95, p["pinch"] + 0.15)
    p["zOver"] = p["zOver"] + (0.10 if p["zOver"] > 0 else -0.03)
    for k in ("proj", "lproj", "hp"):
        p[k] *= 1.18
    for k in ("tt", "ltt", "htt"):
        p[k] *= 1.6
    p["beak"] *= 1.2
    p["flare"] *= 1.3
    p["bold"] = 1.0
    return p


def params(opsz, genre):
    base = genre[0]
    p = dict(SIZE[opsz])
    p.update(GENRE[(opsz, base)])
    p["opsz"] = opsz
    p["genre"] = base
    p["bold"] = 0.0
    if genre.endswith("K"):
        black(p)
    p["sbStem"] = p["sb"] + (0.30 * p["proj"] if base == "A" else 0)
    return p
