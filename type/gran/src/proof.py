"""Outline proof: HTML with every glyph in every master as SVG (points
shown), plus the variable font set live. Screenshot with proof_shot.cjs."""
import json, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
data = json.load(open(os.path.join(ROOT, "build", "outlines.json")))
MS = ["TextGrotesk", "TextAntiqua", "DisplayGrotesk", "DisplayAntiqua"]
order = ["H", "O", "Zhe-cy", "n", "o", "a", "de-cy", "h.sc", "o.sc", "zhe-cy.sc"]

def path_d(c):
    d = [f"M{c['start'][0]:.1f} {c['start'][1]:.1f}"]
    for s in c["segs"]:
        if s[0] == "L":
            d.append(f"L{s[1][0]:.1f} {s[1][1]:.1f}")
        else:
            d.append("C" + " ".join(f"{p[0]:.1f} {p[1]:.1f}" for p in s[1:]))
    return "".join(d) + "Z"

def svg(g, m, pts=True, scale=float(os.environ.get("SC","0.22"))):
    e = data[g][m]
    adv = e["adv"]
    W, H = adv * scale, 1200 * scale
    paths = "".join(path_d(c) for c in e["contours"])
    marks = ""
    if pts:
        for c in e["contours"]:
            for s in [("L", c["start"])] + c["segs"]:
                p = s[-1]
                marks += f'<circle cx="{p[0]:.0f}" cy="{p[1]:.0f}" r="5" fill="#e33"/>'
            for c2 in [c]:
                for s in c2["segs"]:
                    if s[0] == "C":
                        for q in s[1:3]:
                            marks += f'<circle cx="{q[0]:.0f}" cy="{q[1]:.0f}" r="3.5" fill="#39f"/>'
    lines = "".join(f'<line x1="0" x2="{adv}" y1="{y}" y2="{y}" stroke="#ccd" stroke-width="2"/>'
                    for y in (0, 500, 532, 700, -170))
    return (f'<svg width="{W:.0f}" height="{H:.0f}" viewBox="-0 -900 {adv} 1200">'
            f'<g transform="scale(1,-1)">{lines}'
            f'<rect x="0" y="-300" width="{adv}" height="1200" fill="none" stroke="#9ab" stroke-width="2"/>'
            f'<path d="{paths}" fill="#111" fill-opacity="{0.25 if pts else 1}" fill-rule="nonzero" stroke="{"#111" if pts else "none"}" stroke-width="2"/>{marks}</g></svg>')

mode = sys.argv[1] if len(sys.argv) > 1 else "outline"
rows = ""
for m in MS:
    rows += f"<h3>{m}</h3><div class=row>" + "".join(svg(g, m, pts=(mode=="outline")) for g in order) + "</div>"
font = os.path.join(ROOT, "fonts", "GranVF.ttf")
loc = {"TextGrotesk": (12, 0), "TextAntiqua": (12, 100), "DisplayGrotesk": (33, 0), "DisplayAntiqua": (33, 100)}
txt = ""
for m in MS:
    o, s = loc[m]
    st = f"font-variation-settings:'opsz' {o},'SERF' {s};"
    txt += f'<div class=t style="{st}"><span style="font-size:12px">HOnoaЖд НОЖ дао noon nano Hanna</span> &nbsp; <span style="font-size:33px">HOnoaЖд НОЖ дао</span> &nbsp; <span style="font-size:72px">Жад НОЖ <span style="font-variant-caps:all-small-caps">НОЖ</span></span></div>'
html = f"""<html><head><meta charset=utf-8><style>
@font-face{{font-family:G;src:url('file://{font}')}}
body{{font-family:sans-serif;margin:16px;background:#fff}} .row{{display:flex;gap:6px;flex-wrap:wrap}}
.t{{font-family:G;line-height:1.3;margin:10px 0}} h3{{margin:8px 0 2px;font-size:12px}}
</style></head><body>{rows}<hr>{txt}</body></html>"""
out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, "build", "proof.html")
open(out, "w").write(html)
print(out)
