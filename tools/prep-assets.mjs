// npm run prep-assets: assets/raw/*.png (e.g. from Gemini) -> assets/world, assets/ui.
// Chroma-key #FF00FF (±40) -> transparent, trim, then:
//   world: nearest-neighbour to the target size, colours snapped to config/palette.json, alpha 0 or 1;
//   ui:    Lanczos to size ×2 (sharp on retina), soft edges kept.
// Targets (name -> dest, size, type, optional grid) are read from src/config/assets.json.
import sharp from 'sharp';
import { readFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';

const ROOT = 'assets';
const cfg = JSON.parse(readFileSync('src/config/assets.json', 'utf8')).assets;
const palette = JSON.parse(readFileSync('src/config/palette.json', 'utf8')).colors.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));

function nearest(r, g, b) {
  let best = 0, bd = 1e9;
  for (let i = 0; i < palette.length; i++) {
    const [pr, pg, pb] = palette[i];
    const d = (r - pr) ** 2 * 0.3 + (g - pg) ** 2 * 0.59 + (b - pb) ** 2 * 0.11;
    if (d < bd) { bd = d; best = i; }
  }
  return palette[best];
}

/** Magenta backdrop (JPEG-safe): strong red and blue, little green — also the darker grid lines between sheet cells. */
const isKey = (r, g, b) => (r > 110 && b > 110 && g < 0.62 * Math.min(r, b) && Math.abs(r - b) < 90)
  // the soft pink halo where a glow met the backdrop is backdrop too (nothing in the art is magenta)
  || (r > g + 45 && b > g + 45 && b > 0.55 * r)
  // JPEG fringe along edges: pinkish-lilac pixels (red and blue clearly above green)
  || (r > g + 28 && b > g + 22 && b > 0.6 * r && r > 120);

async function keyAndTrim(input, trim = true, crop = null) {
  let img = sharp(input).ensureAlpha();
  if (crop) {
    const m = await sharp(input).metadata();
    const [x0, y0, x1, y1] = crop;
    img = img.extract({ left: Math.round(x0 * m.width), top: Math.round(y0 * m.height), width: Math.round((x1 - x0) * m.width), height: Math.round((y1 - y0) * m.height) });
  }
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    if (isKey(data[i], data[i + 1], data[i + 2])) data[i + 3] = 0;
  }
  const png = await sharp(data, { raw: info }).png().toBuffer();
  if (!trim) return png;
  return sharp(png).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 }).png().toBuffer().catch(() => png);
}

/** Shift every column up so its first opaque pixel is on row 0 (a flat top edge; the game bends it to the terrain). */
async function straighten(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const out = Buffer.alloc(data.length);
  let maxH = 0;
  for (let x = 0; x < w; x++) {
    let top = 0;
    while (top < h && data[(top * w + x) * 4 + 3] < 128) top++;
    for (let y = top; y < h; y++) data.copy(out, ((y - top) * w + x) * 4, (y * w + x) * 4, (y * w + x) * 4 + 4);
    maxH = Math.max(maxH, h - top);
  }
  // height: what most columns reach (thin tails, e.g. the end of a slope, stay shorter and transparent below)
  const hs = [];
  for (let x = 0; x < w; x++) { let top = 0; while (top < h && data[(top * w + x) * 4 + 3] < 128) top++; if (top < h) hs.push(h - top); }
  hs.sort((a, b) => a - b);
  const minH = hs.length ? hs[Math.floor(hs.length * 0.4)] : h;
  return sharp(out, { raw: info }).extract({ left: 0, top: 0, width: w, height: Math.max(1, minH) }).png().toBuffer();
}

/**
 * Layer texture: remove the painted light falloff (divide by a heavy blur), scale to the tile, then make it
 * seamless by cross-fading with a half-shifted copy near the edges.
 */
async function makeTile(buf, w, h) {
  // flatten at full resolution (the light falloff is wide; the pixel blocks are not), then nearest down to the tile
  const m = await sharp(buf).metadata();
  const base = await sharp(buf).removeAlpha().raw().toBuffer();
  const blur = await sharp(buf).removeAlpha().blur(Math.max(20, m.width / 14)).raw().toBuffer();
  const mean = [0, 0, 0], N = m.width * m.height;
  for (let i = 0; i < base.length; i += 3) for (let c = 0; c < 3; c++) mean[c] += base[i + c] / N;
  const flat = Buffer.alloc(base.length);
  for (let i = 0; i < base.length; i += 3) for (let c = 0; c < 3; c++) flat[i + c] = Math.max(0, Math.min(255, Math.round((base[i + c] * mean[c]) / Math.max(8, blur[i + c]))));
  const small = await sharp(flat, { raw: { width: m.width, height: m.height, channels: 3 } }).resize(w, h, { fit: 'fill', kernel: 'nearest' }).raw().toBuffer();
  const out = Buffer.alloc(w * h * 4);
  const F = Math.max(3, Math.round(w / 5));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ex = Math.min(x, w - 1 - x), ey = Math.min(y, h - 1 - y);
    const k = Math.max(0, 1 - Math.min(ex, ey) / F);              // 1 at the edges, 0 inside
    const sx = (x + (w >> 1)) % w, sy = (y + (h >> 1)) % h;
    // dithered cross-fade keeps hard pixels (no blur)
    const useShift = k > 0 && ((x * 7 + y * 13) % 11) / 11 < k * 0.5;
    const src = useShift ? (sy * w + sx) * 3 : (y * w + x) * 3;
    out[(y * w + x) * 4] = small[src]; out[(y * w + x) * 4 + 1] = small[src + 1]; out[(y * w + x) * 4 + 2] = small[src + 2]; out[(y * w + x) * 4 + 3] = 255;
  }
  return sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

async function processOne(buf, t, outName, size = t.size) {
  const dest = join(ROOT, outName);
  mkdirSync(dirname(dest), { recursive: true });
  let [w, h] = size;
  if (t.tile) { await sharp(await makeTile(buf, w, h)).toFile(dest); console.log('  ->', dest); return; }
  if (t.straighten) buf = await straighten(buf);
  if (t.fit === 'width') {
    // keep the aspect: scale to the target width, height follows (capped by the target height)
    const m = await sharp(buf).metadata();
    h = Math.max(1, Math.min(h * 2, Math.round((m.height / m.width) * w)));
  }
  const fit = t.fit === 'fill' ? 'fill' : 'contain';
  if (t.type === 'world') {
    // pixel art: area-average down (keeps the look of large source pixels), then hard alpha and the palette
    const kernel = t.kernel ?? 'nearest';
    const { data, info } = await sharp(buf).resize(w, h, { fit, kernel, background: { r: 0, g: 0, b: 0, alpha: 0 } }).raw().toBuffer({ resolveWithObject: true });
    // erode: peel the outer ring of pixels (a halo left from the backdrop)
    for (let pass = 0; pass < (t.erode ?? 0); pass++) {
      const a0 = Buffer.from(data);
      for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
        const i = (y * info.width + x) * 4;
        if (a0[i + 3] < 128) continue;
        const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const xx = x + dx, yy = y + dy; return xx < 0 || yy < 0 || xx >= info.width || yy >= info.height || a0[((yy * info.width + xx) * 4) + 3] < 128; });
        if (edge) data[i + 3] = 0;
      }
    }
    // defringe: pixels on the edge that drifted toward the magenta backdrop (JPEG blends the art into it) take the
    // colour of their inner neighbours; 'all' repaints the whole outer ring from inside (no dark rim against a glow)
    if (t.defringe !== false) {
      const W = info.width, Hh = info.height;
      const op = (x, y) => x >= 0 && y >= 0 && x < W && y < Hh && data[(y * W + x) * 4 + 3] >= 128;
      for (let pass = 0; pass < (t.defringe === 'all' ? 1 : 3); pass++) {
        const src = Buffer.from(data);
        const opS = (x, y) => x >= 0 && y >= 0 && x < W && y < Hh && src[(y * W + x) * 4 + 3] >= 128;
        for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
          if (!opS(x, y)) continue;
          const edge = !opS(x + 1, y) || !opS(x - 1, y) || !opS(x, y + 1) || !opS(x, y - 1);
          if (!edge) continue;
          // inner neighbours: opaque and themselves not on the edge
          let r = 0, g = 0, b = 0, n = 0;
          for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
            const xx = x + dx, yy = y + dy;
            if ((dx || dy) && opS(xx, yy) && opS(xx + 1, yy) && opS(xx - 1, yy) && opS(xx, yy + 1) && opS(xx, yy - 1)) {
              const j = (yy * W + xx) * 4; r += src[j]; g += src[j + 1]; b += src[j + 2]; n++;
            }
          }
          if (!n) continue;
          r /= n; g /= n; b /= n;
          const i = (y * W + x) * 4;
          const pink = (src[i] + src[i + 2]) / 2 - src[i + 1], pinkIn = (r + b) / 2 - g;
          if (t.defringe === 'all' || pink - pinkIn > 14) { data[i] = r; data[i + 1] = g; data[i + 2] = b; }
        }
        void op;
      }
    }
    // despeck: lone pixels much darker than their neighbours (leftovers of an outline) take the neighbours' colour
    if (t.despeck) {
      const W = info.width, Hh = info.height;
      const L = (j) => data[j] * 0.3 + data[j + 1] * 0.59 + data[j + 2] * 0.11;
      const src = Buffer.from(data);
      for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        if (src[i + 3] < 128) continue;
        let r = 0, g = 0, b = 0, n = 0, l = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if ((!dx && !dy) || xx < 0 || yy < 0 || xx >= W || yy >= Hh) continue;
          const j = (yy * W + xx) * 4;
          if (src[j + 3] < 128) continue;
          r += src[j]; g += src[j + 1]; b += src[j + 2]; l += src[j] * 0.3 + src[j + 1] * 0.59 + src[j + 2] * 0.11; n++;
        }
        if (n >= 3 && L(i) < (l / n) * t.despeck) { data[i] = r / n; data[i + 1] = g / n; data[i + 2] = b / n; }
      }
    }
    // softTop: the top few pixels of every column blend toward the colour just below (no bright rim line on a crest)
    if (t.softTop) {
      const W = info.width, Hh = info.height;
      for (let x = 0; x < W; x++) {
        let top = 0;
        while (top < Hh && data[(top * W + x) * 4 + 3] < 128) top++;
        const ref = Math.min(Hh - 1, top + t.softTop + 1);
        const j = (ref * W + x) * 4;
        if (data[j + 3] < 128) continue;
        for (let d = 0; d < t.softTop; d++) {
          const i = ((top + d) * W + x) * 4;
          if (data[i + 3] < 128) continue;
          const k = 0.75 * (1 - d / (t.softTop + 1));
          for (let c = 0; c < 3; c++) data[i + c] = data[i + c] * (1 - k) + data[j + c] * k;
        }
      }
    }
    // depink: anywhere in the picture, pixels pulled toward magenta take the colour of their non-pink neighbours
    if (t.depink) {
      const W = info.width, Hh = info.height;
      const pk = (j) => (data[j] + data[j + 2]) / 2 - data[j + 1];
      for (let pass = 0; pass < 3; pass++) {
        const src = Buffer.from(data);
        for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          if (src[i + 3] < 128 || pk(i) < t.depink) continue;
          let r = 0, g = 0, b = 0, n = 0;
          for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= W || yy >= Hh) continue;
            const j = (yy * W + xx) * 4;
            if (src[j + 3] < 128 || (src[j] + src[j + 2]) / 2 - src[j + 1] >= t.depink) continue;
            r += src[j]; g += src[j + 1]; b += src[j + 2]; n++;
          }
          if (n) { data[i] = r / n; data[i + 1] = g / n; data[i + 2] = b / n; }
        }
      }
    }
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) { data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0; continue; }
      if (t.palette !== false) { const [r, g, b] = nearest(data[i], data[i + 1], data[i + 2]); data[i] = r; data[i + 1] = g; data[i + 2] = b; }
      data[i + 3] = 255;
    }
    await sharp(data, { raw: info }).png().toFile(dest);
  } else {
    await sharp(buf).resize(w * 2, h * 2, { fit: 'contain', kernel: 'lanczos3', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(dest);
  }
  console.log('  ->', dest);
}

const rawDir = join(ROOT, 'raw');
if (!existsSync(rawDir)) { console.log('no assets/raw folder'); process.exit(0); }
const files = readdirSync(rawDir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
// any layer texture without its own entry: tex_<material>.png -> world/tex/<material>.png
for (const f of files) {
  const name = basename(f, extname(f));
  if (!cfg[name] && name.startsWith('tex_')) cfg[name] = { dest: `world/tex/${name.slice(4)}.png`, size: [64, 64], type: 'world', fit: 'fill', trim: false, palette: false, tile: true };
}
if (!files.length) console.log('assets/raw is empty — the game uses placeholders until files appear.');
for (const f of files) {
  const name = basename(f, extname(f));
  const t = cfg[name];
  if (!t) { console.log(`skip ${f}: no entry "${name}" in src/config/assets.json`); continue; }
  console.log(f);
  const keyed = await keyAndTrim(join(rawDir, f), t.trim !== false && !t.tile, t.crop ?? null);
  if (t.grid) {
    const [cols, rows] = t.grid;
    const meta = await sharp(keyed).metadata();
    const cw = Math.floor(meta.width / cols), ch = Math.floor(meta.height / rows);
    let n = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const part = await sharp(keyed).extract({ left: c * cw, top: r * ch, width: cw, height: ch }).png().toBuffer();
      const trimmed = t.trim === false ? part : await sharp(part).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 }).png().toBuffer().catch(() => part);
      const outName = t.names?.[n] ? cfg[t.names[n]]?.dest ?? t.dest.replace('{n}', String(n + 1)) : t.dest.replace('{n}', String(n + 1));
      await processOne(trimmed, t, outName);
      n++;
    }
  } else {
    await processOne(keyed, t, t.dest);
    for (const v of t.variants ?? []) await processOne(keyed, t, v.dest, v.size);
  }
}
