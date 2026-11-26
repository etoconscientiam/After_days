"""Overlay Gran masters on reference fonts, scaled to the same x-height
(lowercase) or cap height (capitals), aligned on the left of the glyph.
Gray fill = Gran, red outline = reference. Usage: overlay.py OUT.html"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from measure import load, polys, bounds
R = sys.argv[2]
GRAN = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'fonts', 'GranVF.ttf')
PAIRS = [
    ("Text Grotesk / Inter 14", dict(opsz=12, SERF=0), "inter-5.3.0/package/files/inter-%s-standard-normal.woff2", dict(opsz=14, wght=400)),
    ("Display Grotesk / Inter 32", dict(opsz=33, SERF=0), "inter-5.3.0/package/files/inter-%s-standard-normal.woff2", dict(opsz=32, wght=400)),
    ("Text Antiqua / Source Serif 4 opsz 12", dict(opsz=12, SERF=100), "source-serif-4-5.3.1/package/files/source-serif-4-%s-standard-normal.woff2", dict(opsz=12, wght=400)),
    ("Display Antiqua / Source Serif 4 opsz 36", dict(opsz=33, SERF=100), "source-serif-4-5.3.1/package/files/source-serif-4-%s-standard-normal.woff2", dict(opsz=36, wght=400)),
]
CH = "HOnoaЖд"
if len(sys.argv) > 3 and sys.argv[3] == "mix":
    PAIRS = [
        ("Text Grotesk / DM Sans opsz 14", dict(opsz=12, SERF=0), "dm-sans-5.3.0/package/files/dm-sans-%s-standard-normal.woff2", dict(opsz=14, wght=400)),
        ("Display Grotesk / DM Sans opsz 33", dict(opsz=33, SERF=0), "dm-sans-5.3.0/package/files/dm-sans-%s-standard-normal.woff2", dict(opsz=33, wght=400)),
    ] + PAIRS[2:]
elif len(sys.argv) > 3 and sys.argv[3] == "dm":
    PAIRS = [
        ("Text Grotesk / DM Sans opsz 14", dict(opsz=12, SERF=0), "dm-sans-5.3.0/package/files/dm-sans-%s-standard-normal.woff2", dict(opsz=14, wght=400)),
        ("Display Grotesk / DM Sans opsz 33", dict(opsz=33, SERF=0), "dm-sans-5.3.0/package/files/dm-sans-%s-standard-normal.woff2", dict(opsz=33, wght=400)),
    ]
    CH = "HOnoa"
def d_of(P, sx, sy, dx):
    s = ''
    for p in P:
        s += 'M' + ' L'.join(f"{(x*sx+dx):.1f} {(-y*sy):.1f}" for x, y in p) + 'Z'
    return s
html = '<html><body style="margin:8px;font:12px monospace">'
for label, gl, refpat, rl in PAIRS:
    g = load(GRAN, gl)
    gcm = g.getBestCmap()
    gxh = bounds(polys(g, gcm[ord('o')])[0])[3]
    gcap = bounds(polys(g, gcm[ord('H')])[0])[3]
    html += f'<div>{label}</div><div style="display:flex;gap:4px;flex-wrap:wrap">'
    for ch in CH:
        cyr = ord(ch) > 0x400
        rpath = os.path.join(R, refpat % ('cyrillic' if cyr else 'latin'))
        if not os.path.exists(rpath):
            continue
        rf = load(rpath, rl)
        rcm = rf.getBestCmap()
        if ord(ch) not in rcm:
            continue
        ro = rcm.get(ord('о')) or rcm.get(ord('o'))
        rxh = bounds(polys(rf, ro)[0])[3]
        rH = rcm.get(ord('Н')) or rcm.get(ord('H'))
        rcap = bounds(polys(rf, rH)[0])[3]
        GP, gadv = polys(g, gcm[ord(ch)])
        RP, radv = polys(rf, rcm[ord(ch)])
        up = ch.isupper()
        k = (gcap / rcap) if up else (gxh / rxh)
        gb = bounds(GP); rb = bounds(RP)
        # align centers of ink boxes
        dx = ((gb[0] + gb[2]) / 2) - ((rb[0] + rb[2]) / 2) * k
        W = max(gadv, radv * k) + 40
        html += (f'<svg width="{W*0.28:.0f}" height="{1000*0.28:.0f}" viewBox="-20 -820 {W} 1000">'
                 f'<path d="{d_of(GP,1,1,0)}" fill="#999" fill-opacity=".55" fill-rule="nonzero"/>'
                 f'<path d="{d_of(RP,k,k,dx)}" fill="none" stroke="#e22" stroke-width="3"/>'
                 f'<line x1="0" x2="{W}" y1="0" y2="0" stroke="#ccc"/></svg>')
    html += '</div>'
open(sys.argv[1], 'w').write(html + '</body></html>')
