#!/usr/bin/env python3
"""One-off: draft glyphs32/*.txt from glyphs/*.txt with Scale2x (EPX), which doubles every pixel and
rounds the corners of diagonals. The drafts are then redrawn by hand where the 32 grid allows a better
form; never re-run this over hand-edited files (it refuses to overwrite).
    python3 tools/font/scale2x_sources.py"""
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC, DST = HERE / "glyphs", HERE / "glyphs32"
HEADER = re.compile(r"^===\s+(\S+)(.*)$")


def scale2x(rows):
    h, w = len(rows), len(rows[0]) if rows else 0
    at = lambda x, y: 0 <= y < h and 0 <= x < w and rows[y][x] == "#"
    out = [[".."[0]] * (2 * w) for _ in range(2 * h)]
    for y in range(h):
        for x in range(w):
            p, A, B, C, D = at(x, y), at(x, y - 1), at(x + 1, y), at(x - 1, y), at(x, y + 1)
            e = [p, p, p, p]
            if C == A and C != D and A != B: e[0] = A
            if A == B and A != C and B != D: e[1] = B
            if D == C and D != B and C != A: e[2] = C
            if B == D and B != A and D != C: e[3] = D
            for i, (dx, dy) in enumerate(((0, 0), (1, 0), (0, 1), (1, 1))):
                out[2 * y + dy][2 * x + dx] = "#" if e[i] else "."
    return ["".join(r) for r in out]


def convert(text):
    lines, out, i = text.split("\n"), [], 0
    while i < len(lines):
        m = HEADER.match(lines[i])
        if not m:
            out.append(lines[i])
            i += 1
            continue
        opts = []
        for tok in m.group(2).split():
            if "=" in tok:
                k, v = tok.split("=", 1)
                if k in ("o", "adv", "w", "r"):
                    v = str(int(v) * 2)
                elif k == "top":
                    v = str(int(v) * 2 + 1)
                elif k == "cx":
                    v = str(float(v) * 2 + 0.5).rstrip("0").rstrip(".")
                tok = f"{k}={v}"
            opts.append(tok)
        out.append(" ".join(["===", m.group(1)] + opts))
        i += 1
        rows = []
        while i < len(lines) and lines[i].strip() and not lines[i].startswith("==="):
            if lines[i].startswith("//"):
                out.append(lines[i])
            else:
                rows.append(lines[i].rstrip())
            i += 1
        out.extend(scale2x(rows))
    return "\n".join(out)


if __name__ == "__main__":
    DST.mkdir(exist_ok=True)
    for f in sorted(SRC.glob("*.txt")):
        dst = DST / f.name
        if dst.exists():
            sys.exit(f"{dst} exists; refusing to overwrite hand-edited glyphs")
        text = convert(f.read_text(encoding="utf-8"))
        text = text.replace("Every block is 12 rows: row 8 (ascender) at the top ... row 0 on the baseline ... row -3 (descender).",
                            "Every block is 24 rows: row 17 (ascender) at the top ... row 0 on the baseline ... row -6 (descender).")
        dst.write_text(text, encoding="utf-8")
        print("drafted", dst.relative_to(HERE))
