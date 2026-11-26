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
woff2 = base64.b64encode(open(os.path.join(ROOT, "fonts", "GranVF.woff2"), "rb").read()).decode()

ORDER = [("H", "H"), ("O", "O"), ("Zhe-cy", "Ж"), ("n", "n"), ("o", "o"),
         ("a", "a"), ("de-cy", "д"), ("h.sc", "н·sc"), ("o.sc", "о·sc"),
         ("zhe-cy.sc", "ж·sc")]
MLABEL = {"TextGrotesk": ("12 px", "Гротеск"), "TextAntiqua": ("12 px", "Антиква"),
          "DisplayGrotesk": ("33 px", "Гротеск"), "DisplayAntiqua": ("33 px", "Антиква")}


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
        for y in (0, p["xh"], p["cap"]) + ((p["sc"],) if g.endswith(".sc") else ()) + ((p["dd"],) if g == "de-cy" else ()))
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
    return fmt.format(P[m][k])


table_rows = [
    ("Высота строчных (x)", "xh"), ("Высота капители", "sc"),
    ("Штамб прописных V", "V"), ("Штамб строчных v", "v"),
    ("Горизонталь прописных", "Hc"), ("Горизонталь строчных", "hl"),
    ("Вынос засечки прописных", "proj"), ("Толщина засечки у кончика", "tt"),
    ("Глубина ловушки", "trapD"), ("Апрош у штамба H", "sb"),
]
order_m = ["TextGrotesk", "TextAntiqua", "DisplayGrotesk", "DisplayAntiqua"]
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
    return (adv / 2 - 190, c - 190, adv / 2 + 190, c + 190)


DETAILS = {
    "TRAP": detail("n", "TextGrotesk", nbox("TextGrotesk"), "12 px: глубокая ловушка")
    + detail("n", "DisplayGrotesk", nbox("DisplayGrotesk"), "33 px: ловушка стала гранью"),
    "SERIF": detail("H", "TextAntiqua", hbox("TextAntiqua"), "12 px: короткая, толстая, фаска 45°")
    + detail("H", "DisplayAntiqua", hbox("DisplayAntiqua"), "33 px: длинный клин, тонкий кончик"),
    "ZHE": detail("Zhe-cy", "TextGrotesk", zbox("TextGrotesk"), "Гротеск: три ловушки на сторону")
    + detail("Zhe-cy", "TextAntiqua", zbox("TextAntiqua"), "Антиква: контраст по перу"),
    "FACET": detail("n", "TextGrotesk", (P["TextGrotesk"]["sbStem"]*0.92 - 80, P["TextGrotesk"]["xh"] - 200, P["TextGrotesk"]["sbStem"]*0.92 + 200, P["TextGrotesk"]["xh"] + 60), "Гротеск: срез 10%")
    + detail("n", "TextAntiqua", (P["TextAntiqua"]["sbStem"]*0.92 - 80, P["TextAntiqua"]["xh"] - 200, P["TextAntiqua"]["sbStem"]*0.92 + 200, P["TextAntiqua"]["xh"] + 60), "Антиква: тот же срез вырос во флажок"),
}

tpl = open(os.path.join(HERE, "specimen.tpl.html"), encoding="utf-8").read()
html = (tpl.replace("{{WOFF2}}", woff2).replace("{{PROOFS}}", proof_rows)
        .replace("{{THEAD}}", thead)
        .replace("{{D_TRAP}}", DETAILS["TRAP"]).replace("{{D_SERIF}}", DETAILS["SERIF"])
        .replace("{{D_ZHE}}", DETAILS["ZHE"]).replace("{{D_FACET}}", DETAILS["FACET"]).replace("{{TBODY}}", tbody))
out = os.path.join(ROOT, "specimen.html")
open(out, "w", encoding="utf-8").write(html)
print(out, len(html) // 1024, "KB")
