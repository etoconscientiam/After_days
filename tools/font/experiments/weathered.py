#!/usr/bin/env python3
"""Experiment: "weathered stone" treatment of the 2x-grid glyphs (fine_grid.FINE, stems 2 px).

Three kinds of damage, all seeded so every glyph is reproducible:
  chips   edge pixels knocked out (the stroke behind them always stays, so a stem never drops below 1 px)
  bumps   single pixels added on the outside of a stroke, never into a counter (gap stays >= 2 px)
  fault   the glyph above one row is displaced by 1 px sideways, like strata along a fault
Guards: number of ink parts and of counters (holes) must not change, baseline untouched.
    python3 tools/font/experiments/weathered.py  -> tools/font/build/weathered.png
"""
import random
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import fine_grid as fg

ROOT = Path(__file__).resolve().parents[3]
N4 = ((1, 0), (-1, 0), (0, 1), (0, -1))
N8 = N4 + ((1, 1), (1, -1), (-1, 1), (-1, -1))


def parts(cells, nb):
    seen, n = set(), 0
    for c in cells:
        if c in seen:
            continue
        n += 1
        stack = [c]
        seen.add(c)
        while stack:
            x, y = stack.pop()
            for dx, dy in nb:
                q = (x + dx, y + dy)
                if q in cells and q not in seen:
                    seen.add(q)
                    stack.append(q)
    return n


def topology(ink):
    xs = [x for x, _ in ink]
    ys = [y for _, y in ink]
    box = {(x, y) for x in range(min(xs) - 1, max(xs) + 2) for y in range(min(ys) - 1, max(ys) + 2)}
    return parts(ink, N8), parts(box - ink, N4)   # ink pieces, background pieces (= 1 + counters)


def weather(ink, seed, chips=0.08, bumps=0.04, fault=True):
    rnd = random.Random(seed)
    ink = set(ink)
    topo = topology(ink)
    if fault:
        ys = sorted({y for _, y in ink})
        lo, hi = ys[0], ys[-1]
        cut = rnd.randint(lo + (hi - lo) // 3, lo + 2 * (hi - lo) // 3)
        shift = rnd.choice((-1, 1))
        moved = {((x + shift) if y > cut else x, y) for x, y in ink}
        if topology(moved) == topo:
            ink = moved
    edge = sorted(p for p in ink if any((p[0] + dx, p[1] + dy) not in ink for dx, dy in N4))
    rnd.shuffle(edge)
    for (x, y) in edge:
        if rnd.random() > chips or y == 0 and (x, -1) not in ink:   # keep the baseline row whole
            continue
        out = [(dx, dy) for dx, dy in N4 if (x + dx, y + dy) not in ink]
        # the pixel behind the chip must be ink, so the stroke keeps at least 1 px
        if not all((x - dx, y - dy) in ink for dx, dy in out):
            continue
        trial = ink - {(x, y)}
        if topology(trial) == topo:
            ink = trial
    for (x, y) in sorted(ink):
        if rnd.random() > bumps:
            continue
        for dx, dy in rnd.sample(N4, 4):
            q = (x + dx, y + dy)
            if q in ink or q[1] < 0 <= y:
                continue
            # outward only: two more pixels in that direction and both sides of it are empty
            ahead = [(q[0] + dx * k + sx, q[1] + dy * k + sy) for k in (0, 1, 2) for sx, sy in
                     ((0, 0), (dy, dx), (-dy, -dx)) if (k, sx, sy) != (0, 0, 0)]
            if any(a in ink for a in ahead):
                continue
            trial = ink | {q}
            if topology(trial) == topo:
                ink = trial
                break
    return ink


def main():
    lab = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 19)
    small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 15)
    S, up, down = 7, 24, 8
    glyphs = {ch: fg.parse(src, top) for ch, (top, src) in fg.FINE.items()}
    rows = [
        ("Чистый (сетка 32, штрих 2)", fg.AMBER, {ch: [g[0]] for ch, g in glyphs.items()}),
        ("Лёгкое выветривание: сколы и наплывы", fg.AMBER,
         {ch: [weather(g[0], f"{ch}1", 0.06, 0.03, False)] for ch, g in glyphs.items()}),
        ("Среднее: + сдвиг по разлому на 1 пиксель; три варианта каждой буквы", fg.AMBER,
         {ch: [weather(g[0], f"{ch}{k}", 0.10, 0.05, True) for k in (1, 2, 3)] for ch, g in glyphs.items()}),
    ]
    W = 1240
    rowh = (up + down) * S + 70
    im = Image.new("RGB", (W, 30 + rowh * len(rows) + 300), fg.BG)
    d = ImageDraw.Draw(im)
    y = 30
    for title, col, sets in rows:
        d.text((30, y), title, font=lab, fill=col)
        x, base = 30, y + 40 + up * S
        for ch, variants in sets.items():
            for ink in variants:
                w = glyphs[ch][1]
                for gy in range(-down, up):
                    for gx in range(-1, w + 2):
                        x0, y0 = x + (gx + 1) * S, base - (gy + 1) * S
                        d.rectangle([x0, y0, x0 + S - 2, y0 + S - 2], fill=col if (gx, gy) in ink else fg.CELL)
                x += (w + 3) * S + 10
            x += 24
        y += rowh
    # real size at font-size 32 (1 fine pixel = 1 screen px), then x3
    d.text((30, y), "Реальный размер при кегле 32 px и он же ×3 (чистый / лёгкий / средний с чередованием вариантов):",
           font=small, fill=fg.DIM)
    strip = Image.new("RGB", (400, 44), fg.BG)
    sx = 4
    for i, (_, col, sets) in enumerate(rows):
        seq = "aЖფaЖფ"
        for j, ch in enumerate(seq):
            vs = sets[ch]
            ink = vs[(j // 3) % len(vs)]
            for gx, gy in ink:
                if 0 <= sx + gx < 400:
                    strip.putpixel((sx + gx, 32 - gy - 1), col)
            sx += glyphs[ch][1] + 3
        sx += 14
    im.paste(strip, (30, y + 30))
    im.paste(strip.resize((1200, 132), Image.NEAREST), (30, y + 90))
    im = im.crop((0, 0, W, y + 90 + 132 + 20))
    out = ROOT / "tools/font/build"
    out.mkdir(exist_ok=True)
    im.save(out / "weathered.png")
    print("written tools/font/build/weathered.png")


if __name__ == "__main__":
    main()
