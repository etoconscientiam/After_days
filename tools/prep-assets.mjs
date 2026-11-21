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
const KEY = [255, 0, 255], TOL = 40;

function nearest(r, g, b) {
  let best = 0, bd = 1e9;
  for (let i = 0; i < palette.length; i++) {
    const [pr, pg, pb] = palette[i];
    const d = (r - pr) ** 2 * 0.3 + (g - pg) ** 2 * 0.59 + (b - pb) ** 2 * 0.11;
    if (d < bd) { bd = d; best = i; }
  }
  return palette[best];
}

async function keyAndTrim(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    if (Math.abs(data[i] - KEY[0]) <= TOL && Math.abs(data[i + 1] - KEY[1]) <= TOL && Math.abs(data[i + 2] - KEY[2]) <= TOL) data[i + 3] = 0;
  }
  return sharp(data, { raw: info }).png().toBuffer().then((b) => sharp(b).trim({ threshold: 1 }).png().toBuffer()).catch(() => sharp(data, { raw: info }).png().toBuffer());
}

async function processOne(buf, t, outName) {
  const dest = join(ROOT, outName);
  mkdirSync(dirname(dest), { recursive: true });
  const [w, h] = t.size;
  if (t.type === 'world') {
    const { data, info } = await sharp(buf).resize(w, h, { fit: 'contain', kernel: 'nearest', background: { r: 0, g: 0, b: 0, alpha: 0 } }).raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) { data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0; continue; }
      const [r, g, b] = nearest(data[i], data[i + 1], data[i + 2]);
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
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
if (!files.length) console.log('assets/raw is empty — the game uses placeholders until files appear.');
for (const f of files) {
  const name = basename(f, extname(f));
  const t = cfg[name];
  if (!t) { console.log(`skip ${f}: no entry "${name}" in src/config/assets.json`); continue; }
  console.log(f);
  const keyed = await keyAndTrim(join(rawDir, f));
  if (t.grid) {
    const [cols, rows] = t.grid;
    const meta = await sharp(keyed).metadata();
    const cw = Math.floor(meta.width / cols), ch = Math.floor(meta.height / rows);
    let n = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const part = await sharp(keyed).extract({ left: c * cw, top: r * ch, width: cw, height: ch }).png().toBuffer();
      const trimmed = await sharp(part).trim({ threshold: 1 }).png().toBuffer().catch(() => part);
      const outName = t.names?.[n] ? cfg[t.names[n]]?.dest ?? t.dest.replace('{n}', String(n + 1)) : t.dest.replace('{n}', String(n + 1));
      await processOne(trimmed, t, outName);
      n++;
    }
  } else await processOne(keyed, t, t.dest);
}
