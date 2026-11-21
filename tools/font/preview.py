#!/usr/bin/env python3
"""Specimens of Strata Pixel drawn from the built glyph data (StrataPixel-Regular.json): the same bitmaps
and kerning pairs that are in the TTF (check.py proves the TTF rasterises to exactly these pixels).
    python3 tools/font/preview.py            -> tools/font/build/chars-*.png
"""
import json
from pathlib import Path
from PIL import Image

HERE = Path(__file__).resolve().parent
DATA = json.loads((HERE.parent.parent / "assets/fonts/strata-pixel/StrataPixel-Regular.json").read_text(encoding="utf-8"))
G, K = DATA["glyphs"], DATA["kerning"]
BG = (24, 21, 26)
INK = (236, 226, 208)
AMBER = (242, 181, 74)
DIM = (120, 110, 100)


def layout(text, kern=True):
    """-> list of (x, char) pen positions, and total advance."""
    x, out, prev = 0, [], None
    for ch in text:
        g = G.get(ch) or G.get("\ufffd")
        if kern and prev is not None:
            x += K.get(prev, {}).get(ch, 0)
        out.append((x, ch if ch in G else "\ufffd"))
        x += g["adv"]
        prev = ch
    return out, x


def render(lines, scale=3, pad=8, line_h=None, kern=True, guides=False, features=None):
    if features and "-kern" in features:
        kern = False
    lh = line_h or DATA["lineHeight"]
    laid = [(layout(t, kern), col) for t, col in lines]
    w = max(adv for (_, adv), _ in laid) + pad * 2
    h = lh * len(lines) + pad * 2
    im = Image.new("RGB", (w, h), BG)
    px = im.load()
    for i, ((pos, _), col) in enumerate(laid):
        base = pad + i * lh + DATA["lineAscent"]
        if guides:
            for row, c in ((0, (70, 40, 40)), (DATA["xHeight"], (40, 55, 70)), (DATA["capHeight"], (40, 70, 45))):
                for xx in range(w):
                    px[xx, base - row] = c
        for x, ch in pos:
            g = G[ch]
            for r, line in enumerate(g["rows"]):
                for c, v in enumerate(line):
                    if v == "#":
                        X, Y = pad + x + g["x"] + c, base - 1 - (g["top"] - r)
                        if 0 <= X < w and 0 <= Y < h:
                            px[X, Y] = col
    return im.resize((w * scale, h * scale), Image.NEAREST)


SETS = {
    "latin": ["ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz", "0123456789 !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~",
              "¡¢£¤¥¦§©ª«¬®°±²³µ¶·¹º»¼½¾¿×÷ÆÐØÞßæðøþ",
              "ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ àáâãäåçèéêëìíîïñòóôõöùúûüýÿ",
              "ĀāĂăĄąĆćĈĉĊċČčĎďĐđĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĦħĨĩĪīĬĭĮįİıĲĳĴĵĶķĸĹĺĻļĽľĿŀŁł",
              "ŃńŅņŇňŉŊŋŌōŎŏŐőŒœŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŦŧŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽžſȘșȚț"],
    "cyrillic": ["АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ", "абвгдеёжзийклмнопрстуфхцчшщъыьэюя",
                 "ЀЂЃЄЅІЇЈЉЊЋЌЍЎЏҐ ѐђѓєѕіїјљњћќѝўџґ", "ҒҖҚҢҮҰҲҶҺӀӘӢӨӮ ғҗқңүұҳҷһӏәӣөӯ"],
    "georgian": ["".join(chr(c) for c in range(0x10D0, 0x10E8)), "".join(chr(c) for c in range(0x10E8, 0x10F9)) + "჻",
                 "".join(chr(c) for c in range(0x1C90, 0x1CA8)), "".join(chr(c) for c in range(0x1CA8, 0x1CB9))],
    "symbols": ["– — ‘’ “” „ ‚ « » ‹ › † ‡ • … ‰ ′ ″ ‼ № ™ ⁰¹²³⁴⁵⁶⁷⁸⁹ ₀₁₂₃₄₅₆₇₈₉",
                "€ ₽ ₾ ₴ ₸ $ £ ¥ ¢ ← ↑ → ↓ ↔ ↕ − × ÷ ± ≈ ≠ ≤ ≥ ∞ √ °",
                "■ □ ▲ ▼ ► ◄ ◆ ◇ ● ○ ★ ☆ ♥ ♪ ♫ ✓ ✗ ⟡ �"],
}

if __name__ == "__main__":
    out = HERE / "build"
    out.mkdir(exist_ok=True)
    for name, ls in SETS.items():
        render([(t, INK) for t in ls], scale=3, guides=True).save(out / f"chars-{name}.png")
    print("written", ", ".join(f"build/chars-{n}.png" for n in SETS))
