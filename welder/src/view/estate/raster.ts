/**
 * A tiny pixel raster for hand-made pixel art drawn in code: whole pixels only (no smoothing, no
 * half-covered edges), so a plan drawn small and blown up stays crisp. Colours are '#rrggbb' strings,
 * cached as packed RGBA.
 */
const cache = new Map<string, number>();
function pack(c: string): number {
  let v = cache.get(c);
  if (v !== undefined) return v;
  const h = c.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255;
  v = ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
  cache.set(c, v);
  return v;
}

/** 4×4 ordered dither: is this pixel on, for a fill of density k (0..1)? */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export function dither(x: number, y: number, k: number): boolean {
  return BAYER[(y & 3) * 4 + (x & 3)] < k * 16;
}

export class Raster {
  readonly data: Uint32Array;
  readonly img: ImageData;

  constructor(readonly w: number, readonly h: number) {
    this.img = new ImageData(w, h);
    this.data = new Uint32Array(this.img.data.buffer);
  }

  copyFrom(o: Raster): void {
    this.data.set(o.data);
  }

  px(x: number, y: number, c: string): void {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.data[y * this.w + x] = pack(c);
  }

  /** A pixel blended over what is there (a = 0..1), for shadows, glows and night. */
  blend(x: number, y: number, c: string, a: number): void {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
    const i = y * this.w + x;
    const d = this.data[i], s = pack(c);
    const k = Math.min(1, a);
    const r = (d & 255) * (1 - k) + (s & 255) * k;
    const g = ((d >> 8) & 255) * (1 - k) + ((s >> 8) & 255) * k;
    const b = ((d >> 16) & 255) * (1 - k) + ((s >> 16) & 255) * k;
    this.data[i] = ((255 << 24) | (Math.round(b) << 16) | (Math.round(g) << 8) | Math.round(r)) >>> 0;
  }

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.data[y * this.w + x];
  }

  rect(x: number, y: number, w: number, h: number, c: string): void {
    x = Math.round(x);
    y = Math.round(y);
    for (let j = Math.max(0, y); j < Math.min(this.h, y + h); j++) for (let i = Math.max(0, x); i < Math.min(this.w, x + w); i++) this.data[j * this.w + i] = pack(c);
  }

  /** A rectangle of a second colour dithered over the first at density k. */
  drect(x: number, y: number, w: number, h: number, c: string, k: number): void {
    x = Math.round(x);
    y = Math.round(y);
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (dither(i, j, k)) this.px(i, j, c);
  }

  line(x0: number, y0: number, x1: number, y1: number, c: string): void {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let e = dx + dy;
    for (;;) {
      this.px(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * e;
      if (e2 >= dy) {
        e += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        e += dx;
        y0 += sy;
      }
    }
  }

  /**
   * A filled polygon, pixel centres inside (even-odd). `shade(x, y)` may return a colour per pixel
   * (for dithered faces); else the flat colour.
   */
  poly(pts: [number, number][], c: string, shade?: (x: number, y: number) => string | null): void {
    let y0 = Infinity, y1 = -Infinity;
    for (const [, y] of pts) {
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    const xs: number[] = [];
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(this.h - 1, Math.ceil(y1)); y++) {
      const cy = y + 0.5;
      xs.length = 0;
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
        if ((ay <= cy && by > cy) || (by <= cy && ay > cy)) xs.push(ax + ((cy - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.ceil(xs[k] - 0.5); x <= Math.floor(xs[k + 1] - 0.5); x++) {
          const col = shade ? shade(x, y) : c;
          if (col) this.px(x, y, col);
        }
      }
    }
  }

  /** The outline of a polygon. */
  polyLine(pts: [number, number][], c: string): void {
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
      this.line(ax, ay, bx, by, c);
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, c: string): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.px(x, y, c);
      }
  }

  /** A soft round glow (blended), for lit windows and fires at night. */
  glow(cx: number, cy: number, r: number, c: string, a: number): void {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
        if (d < 1) this.blend(x, y, c, a * (1 - d) * (1 - d));
      }
  }

  /** Darken (or tint) the whole picture, e.g. toward night. */
  tint(c: string, a: number): void {
    if (a <= 0) return;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.blend(x, y, c, a);
  }

  /** Draw a 1-px dark outline round every pixel of colour-set `inside` that borders something else. */
  outline(x0: number, y0: number, w: number, h: number, isInside: (v: number) => boolean, c: string): void {
    const pts: number[] = [];
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++) {
        if (isInside(this.get(x, y))) continue;
        if (isInside(this.get(x + 1, y)) || isInside(this.get(x - 1, y)) || isInside(this.get(x, y + 1)) || isInside(this.get(x, y - 1))) pts.push(x, y);
      }
    for (let i = 0; i < pts.length; i += 2) this.px(pts[i], pts[i + 1], c);
  }
}

export { pack };
