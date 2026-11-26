"""Generate the Gran specimen page (type/gran/specimen.html): research notes,
concept, live variable font, outline proofs of all four masters."""
import base64
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from masters import MASTERS, params  # noqa: E402

data = json.load(open(os.path.join(ROOT, "build", "outlines.json")))
woff2_old = base64.b64encode(open(os.path.join(ROOT, "fonts", "archive", "GranVF-0.01.woff2"), "rb").read()).decode()
woff2_old2 = base64.b64encode(open(os.path.join(ROOT, "fonts", "archive", "GranVF-0.02.woff2"), "rb").read()).decode()
woff2_old3 = base64.b64encode(open(os.path.join(ROOT, "fonts", "archive", "GranVF-0.03.woff2"), "rb").read()).decode()
woff2_old4 = base64.b64encode(open(os.path.join(ROOT, "fonts", "archive", "GranVF-0.04.woff2"), "rb").read()).decode()
dmcmp = base64.b64encode(open(os.path.join(ROOT, "research", "dm-sans-vs-gran.png"), "rb").read()).decode()
sent = base64.b64encode(open(os.path.join(ROOT, "research", "dm-sans-line.png"), "rb").read()).decode()
calib = base64.b64encode(open(os.path.join(ROOT, "research", "calibration-overlay.png"), "rb").read()).decode()
study = base64.b64encode(open(os.path.join(ROOT, "research", "velvetyne-study.png"), "rb").read()).decode()
woff2 = base64.b64encode(open(os.path.join(ROOT, "fonts", "GranVF.woff2"), "rb").read()).decode()

ORDER = [(g, g) for g in "H O W n o a h m u r i l d p g c e s t f v".split()] + [
         ("Zhe-cy", "Ж"), ("de-cy", "д"), ("h.sc", "н·sc"), ("o.sc", "о·sc"), ("zhe-cy.sc", "ж·sc")]
MLABEL = {"TextGrotesk": ("12 px", "Гротеск"), "TextAntiqua": ("12 px", "Антиква"),
          "DisplayGrotesk": ("33 px", "Гротеск"), "DisplayAntiqua": ("33 px", "Антиква"),
          "TextGroteskBlack": ("12 px", "Гротеск Black"), "TextAntiquaBlack": ("12 px", "Антиква Black"),
          "DisplayGroteskBlack": ("33 px", "Гротеск Black"), "DisplayAntiquaBlack": ("33 px", "Антиква Black")}


def path_d(c):
    d = [f"M{c['start'][0]:.0f} {c['start'][1]:.0f}"]
    for s in c["segs"]:
        if s[0] == "L":
            d.append(f"L{s[1][0]:.0f} {s[1][1]:.0f}")
        else:
            d.append("C" + " ".join(f"{p[0]:.0f} {p[1]:.0f}" for p in s[1:]))
    return "".join(d) + "Z"


def glyph_svg(g, m, box=None, cls="gs"):
    e = data[g][m]
    p = params(*[(o, gg) for (mm, o, s, gg) in MASTERS if mm == m][0])
    adv = e["adv"]
    d = "".join(path_d(c) for c in e["contours"])
    on, off, handles = [], [], []
    for c in e["contours"]:
        prev = c["start"]
        on.append(prev)
        for s in c["segs"]:
            if s[0] == "C":
                off.extend([s[1], s[2]])
                handles.append((prev, s[1]))
                handles.append((s[3], s[2]))
            on.append(s[-1])
            prev = s[-1]
    uniq = {(round(x), round(y)) for x, y in on}
    pts = "".join(f'<rect x="{x-6}" y="{y-6}" width="12" height="12"/>' for x, y in uniq)
    offs = "".join(f'<circle cx="{x:.0f}" cy="{y:.0f}" r="6"/>' for x, y in off)
    hs = "".join(f'<line x1="{a[0]:.0f}" y1="{a[1]:.0f}" x2="{b[0]:.0f}" y2="{b[1]:.0f}"/>' for a, b in handles)
    guides = "".join(
        f'<line x1="-40" x2="{adv+40}" y1="{y}" y2="{y}"/>'
        for y in (0, p["xh"], p["cap"]) + ((p["xh"] + (22 if p["opsz"] == 12 else 20),) if g.endswith(".sc") else ()) + ((p["dd"],) if g == "de-cy" else ()))
    vb = f"-40 -260 {adv+80} 1060"
    if box:
        x0, y0, x1, y1 = box
        vb = f"{x0:.0f} {540-y1:.0f} {x1-x0:.0f} {y1-y0:.0f}"
    return (f'<svg class="{cls}" viewBox="{vb}" role="img" aria-label="{g}">'
            f'<g transform="translate(0 540) scale(1 -1)">'
            f'<g class="gd">{guides}<line x1="0" x2="0" y1="-230" y2="770"/><line x1="{adv}" x2="{adv}" y1="-230" y2="770"/></g>'
            f'<path class="ink" d="{d}"/>'
            f'<g class="hd">{hs}</g><g class="on">{pts}</g><g class="off">{offs}</g></g></svg>')


proof_rows = ""
for m, o, s, g in MASTERS:
    size, genre = MLABEL[m]
    cells = "".join(f'<figure>{glyph_svg(gname, m)}<figcaption>{lab}</figcaption></figure>'
                    for gname, lab in ORDER)
    proof_rows += (f'<div class="prow"><div class="plabel"><b>{genre}</b><span>opsz {o} · SERF {s}</span></div>'
                   f'<div class="pcells">{cells}</div></div>')


def prow(m):
    o, g = [(oo, gg) for (mm, oo, ss, gg) in MASTERS if mm == m][0]
    p = params(o, g)
    return p


P = {m: prow(m) for m, *_ in MASTERS}


def cell(m, k, fmt="{:.0f}"):
    v = P[m][k]
    return f"{v:.2f}" if isinstance(v, float) and v < 1.5 else fmt.format(v)


table_rows = [
    ("Высота строчных (x)", "xh"),
    ("Штамб прописных V", "V"), ("Штамб строчных v", "v"),
    ("Горизонталь прописных", "Hc"), ("Горизонталь строчных", "hl"),
    ("Вынос засечки прописных", "proj"), ("Толщина засечки у кончика", "tt"),
    ("Ширина n (штамб—штамб)", "wn"), ("Ширина o", "wo"), ("Ширина O", "wO"),
    ("Наклон оси контраста O, °", "tilt"), ("Апрош H (от края знака)", "sbH"),
    ("Апрош n слева / справа", "sbnL"), ("Апрош o", "sbo"),
]
order_m = [m for m, *_ in MASTERS]
thead = "".join(f"<th>{MLABEL[m][1]}<br><span>{MLABEL[m][0]}</span></th>" for m in order_m)
tbody = ""
for lab, k in table_rows:
    tbody += f"<tr><th>{lab}</th>" + "".join(f"<td>{cell(m, k)}</td>" for m in order_m) + "</tr>"
tbody += "<tr><th>Контраст (гориз. / верт.)</th>" + "".join(
    f"<td>{P[m]['hl']/P[m]['v']:.2f}</td>" for m in order_m) + "</tr>"
tbody += "<tr><th>Скос верха штамба</th>" + "".join(
    f"<td>{P[m]['slope']*100:.0f}%</td>" for m in order_m) + "</tr>"

def detail(g, m, box, cap):
    return f'<figure class="det">{glyph_svg(g, m, box, "dz")}<figcaption>{cap}</figcaption></figure>'


def nbox(m):
    p = P[m]
    x = p["sbStem"] * 0.92
    return (x - 60, p["xh"] - 330, x + 250, p["xh"] + 40)


def hbox(m):
    p = P[m]
    x = p["sbStem"]
    return (x - 110, -40, x + 190, 260)


def zbox(m):
    adv = data["Zhe-cy"][m]["adv"]
    c = P[m]["cap"] / 2
    return (adv / 2 - 260, c - 260, adv / 2 + 260, c + 260)


def facet_box(m):
    x = P[m]["sbStem"] * 0.92
    return (x - 90, P[m]["xh"] - 210, x + 200, P[m]["xh"] + 80)


def de_box(m):
    adv = data["de-cy"][m]["adv"]
    return (-20, P[m]["dd"] - 40, adv + 20, P[m]["dd"] + adv + 60)


def o_box(m):
    adv = data["O"][m]["adv"]
    return (-10, -50, adv + 10, P[m]["cap"] + 50)


def o_box2(m):
    adv = data["o"][m]["adv"]
    return (-10, -60, adv + 10, P[m]["xh"] + 60)


def a_box(m, g):
    adv = data[g][m]["adv"]
    return (-10, -80, adv + 10, P[m]["xh"] + 80)


def a_box(m, g="a"):
    adv = data[g][m]["adv"]
    return (-10, -80, adv + 10, P[m]["xh"] + 80)


DETAILS = {
    "N": detail("n", "TextGrotesk", nbox("TextGrotesk"), "Гротеск 12: узел плеча")
    + detail("n", "DisplayAntiqua", facet_box("DisplayAntiqua"), "Антиква 33: срез и флажок"),
    "A": detail("a", "TextGrotesk", a_box("TextGrotesk"), "Гротеск: срез 24°")
    + detail("a", "TextAntiqua", a_box("TextAntiqua"), "Антиква: капля"),
    "O": detail("O", "DisplayGrotesk", o_box("DisplayGrotesk"), "Гротеск: ось 0°")
    + detail("O", "DisplayAntiqua", o_box("DisplayAntiqua"), "Антиква 33: ось 12°"),
    "ZHE": detail("Zhe-cy", "TextGrotesk", zbox("TextGrotesk"), "Гротеск: сужение к узлу")
    + detail("Zhe-cy", "TextAntiqua", zbox("TextAntiqua"), "Антиква: контраст по перу"),
    "DE": detail("de-cy", "TextGrotesk", de_box("TextGrotesk"), "Гротеск 12")
    + detail("de-cy", "DisplayAntiqua", de_box("DisplayAntiqua"), "Антиква 33"),
}

tpl = open(os.path.join(HERE, "specimen.tpl.html"), encoding="utf-8").read()
html = (tpl.replace("{{WOFF2}}", woff2).replace("{{PROOFS}}", proof_rows)
        .replace("{{THEAD}}", thead).replace("{{TBODY}}", tbody)
        .replace("{{D_N}}", DETAILS["N"]).replace("{{D_A}}", DETAILS["A"])
        .replace("{{D_O}}", DETAILS["O"]).replace("{{D_ZHE}}", DETAILS["ZHE"])
        .replace("{{D_DE}}", DETAILS["DE"])
        .replace("{{WOFF2OLD}}", woff2_old).replace("{{WOFF2OLD2}}", woff2_old2)
        .replace("{{WOFF2OLD3}}", woff2_old3).replace("{{WOFF2OLD4}}", woff2_old4)
        .replace("{{DMCMP}}", dmcmp).replace("{{SENT}}", sent)
        .replace("{{STUDY}}", study).replace("{{CALIB}}", calib))
out = os.path.join(ROOT, "specimen.html")
open(out, "w", encoding="utf-8").write(html)
print(out, len(html) // 1024, "KB")
