# Pixel-art "vibro-wand" (artifact_c) in the style of the ring and key: ~51 logical px across a 2048 canvas,
# dark 1-px outline, light from the top left, worn surface with scratches, a soft amber glow, #FF00FF backdrop.
import math, random, sys
from PIL import Image, ImageFilter, ImageChops
random.seed(7)
N = 52                 # logical grid
S = 40                 # screen px per logical px -> 2080, cropped to 2048
OUT = sys.argv[1] if len(sys.argv) > 1 else 'artifact_c.png'

cy = 26.0
x0, x1 = 4, 48
def radius(x):
    # pommel knob, ribbed handle, a shaft tapering to the head, a round head with the lens
    if x < 9: return 4.6
    if x < 10: return 4.0
    if x < 21: return 4.3
    if x < 23: return 4.8
    if x < 38: return 4.0 - (x - 23) / 15 * 1.1
    if x < 40: return 3.6
    return 5.0
def inside(x, y):
    px, py = x + 0.5, y + 0.5
    if px < x0 or px > x1: return False
    r = radius(px)
    # rounded caps
    if px < x0 + r: return math.hypot(px - (x0 + r), py - cy) <= r
    if px > x1 - r: return math.hypot(px - (x1 - r), py - cy) <= r
    return abs(py - cy) <= r

OUTL = (44, 34, 30)
body = [(150, 178, 160), (114, 148, 130), (88, 118, 104), (68, 92, 84), (50, 68, 64)]      # verdigris copper
grip = [(122, 92, 70), (100, 72, 54), (80, 56, 42), (60, 42, 32)]                           # dark leather wrap
metal = [(236, 206, 140), (204, 168, 100), (160, 126, 72), (120, 92, 52)]                    # brass
img = Image.new('RGBA', (N, N), (0, 0, 0, 0))
P = img.load()
for y in range(N):
    for x in range(N):
        if not inside(x, y): continue
        if not (inside(x - 1, y) and inside(x + 1, y) and inside(x, y - 1) and inside(x, y + 1)):
            P[x, y] = OUTL + (255,); continue
        r = radius(x + 0.5)
        t = (y + 0.5 - (cy - r)) / (2 * r)          # 0 top .. 1 bottom
        k = min(4, max(0, int(t * 4.6 - 0.3)))
        if 10 <= x <= 20:                            # wrapped grip, diagonal binding
            g = grip[min(3, k)]
            if (x + y) % 3 == 0: g = tuple(max(0, c - 18) for c in g)
            col = g
        elif x <= 9 or x in (21, 22) or x in (38, 39):   # brass pommel and collars
            col = metal[min(3, k)]
        else:
            col = body[k]
            # copper shows through where the patina is worn on the top
            if k == 0 and (x * 7 + y) % 5 == 0: col = (196, 140, 96)
        P[x, y] = col + (255,)
# rim light on the top edge, left half brighter
for x in range(N):
    for y in range(N):
        if P[x, y][3] and P[x, y][:3] != OUTL and not (P[x, y - 1][3] and P[x, y - 1][:3] != OUTL):
            if not (10 <= x <= 20): P[x, y] = (250, 236, 196, 255) if (x <= 9 or x in (21, 22, 38, 39)) else (184, 208, 190, 255)
# scratches and wear (short dark/light ticks), a few rust-brown specks like on the key
for _ in range(16):
    x = random.randint(8, 44); y = int(cy + random.uniform(-2.5, 2.5))
    if P[x, y][3] and P[x, y][:3] != OUTL and not (10 <= x <= 20):
        c = P[x, y][:3]
        P[x, y] = (tuple(max(0, v - 34) for v in c) if random.random() < 0.6 else tuple(min(255, v + 18) for v in c)) + (255,)
for (x, y) in [(27, 28), (33, 27), (44, 29), (6, 28)]:
    if P[x, y][3] and P[x, y][:3] != OUTL: P[x, y] = (150, 100, 66, 255)
# the button: a small amber lens on the head, the only bright point
for (x, y, c) in [(43, 24, (255, 226, 160)), (44, 24, (250, 192, 92)), (45, 24, (226, 150, 60)),
                  (43, 25, (246, 182, 80)), (44, 25, (232, 156, 62)), (45, 25, (196, 118, 40)),
                  (44, 26, (190, 112, 40)), (43, 26, (214, 138, 52))]:
    P[x, y] = c + (255,)
for (x, y) in [(42, 24), (42, 25), (42, 26), (46, 24), (46, 25), (46, 26), (43, 23), (44, 23), (45, 23), (43, 27), (44, 27), (45, 27)]:
    P[x, y] = (40, 52, 50, 255)   # the lens bezel

big = img.resize((N * S, N * S), Image.NEAREST)
canvas = Image.new('RGBA', big.size, (255, 0, 255, 255))
# soft amber glow around the lens (it bleeds into the backdrop, as on the ring)
glow = Image.new('RGBA', big.size, (0, 0, 0, 0))
from PIL import ImageDraw
d = ImageDraw.Draw(glow)
gx, gy = 44 * S, 25 * S
for i in range(14, 0, -1):
    a = int(10 + (14 - i) * 9)
    d.ellipse((gx - i * 22, gy - i * 22, gx + i * 22, gy + i * 22), fill=(255, 196, 120, min(150, a)))
glow = glow.filter(ImageFilter.GaussianBlur(60))
canvas = Image.alpha_composite(canvas, glow)
canvas = Image.alpha_composite(canvas, big)
# the glow also lifts the lens neighbourhood on the object a little
over = glow.copy(); over.putalpha(over.getchannel('A').point(lambda v: v // 2))
mask = big.getchannel('A')
lit = Image.alpha_composite(canvas, over)
canvas = Image.composite(lit, canvas, mask)
off = (N * S - 2048) // 2
canvas = canvas.crop((off, off, off + 2048, off + 2048)).convert('RGB')
canvas.save(OUT)
print('saved', OUT)
