// Painted world sprites (assets/world/...) drawn with a tint: the sprite is multiplied by a colour (time of day,
// night, era haze) while its own alpha is kept. Everything falls back to procedural drawing when a file is missing.
import { skin } from './assets';

const scratch = document.createElement('canvas');
const sx = scratch.getContext('2d')!;

/** A copy of img (or a region of it) multiplied by rgb, with an optional extra wash of the same colour. */
export function tintedCanvas(img: CanvasImageSource, w: number, h: number, rgb: number[], wash = 0, src?: [number, number, number, number]): HTMLCanvasElement {
  if (scratch.width < w || scratch.height < h) { scratch.width = Math.max(scratch.width, w); scratch.height = Math.max(scratch.height, h); }
  sx.imageSmoothingEnabled = false;
  sx.globalCompositeOperation = 'copy';
  if (src) sx.drawImage(img, src[0], src[1], src[2], src[3], 0, 0, w, h); else sx.drawImage(img, 0, 0, w, h);
  const col = `rgb(${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v)))).join(',')})`;
  sx.globalCompositeOperation = 'multiply';
  sx.fillStyle = col; sx.fillRect(0, 0, w, h);
  if (wash > 0) { sx.globalCompositeOperation = 'source-atop'; sx.globalAlpha = wash; sx.fillRect(0, 0, w, h); sx.globalAlpha = 1; }
  // multiply fills transparent pixels too: cut back to the sprite's own shape
  sx.globalCompositeOperation = 'destination-in';
  if (src) sx.drawImage(img, src[0], src[1], src[2], src[3], 0, 0, w, h); else sx.drawImage(img, 0, 0, w, h);
  sx.globalCompositeOperation = 'source-over';
  return scratch;
}

/** Draw a skin centred at (cx, cy) multiplied by rgb. Returns false when the file is missing (draw the placeholder). */
export function drawTinted(c: CanvasRenderingContext2D, path: string, cx: number, cy: number, rgb: number[], alpha = 1): boolean {
  const img = skin(path);
  if (!img) return false;
  const w = img.naturalWidth, h = img.naturalHeight;
  const t = tintedCanvas(img, w, h, rgb);
  c.globalAlpha = alpha;
  c.drawImage(t, 0, 0, w, h, Math.round(cx - w / 2), Math.round(cy - h / 2), w, h);
  c.globalAlpha = 1;
  return true;
}

/** Like tintedCanvas, but into a canvas of its own (kept between frames, sized to the image). */
export function tintInto(dst: HTMLCanvasElement | undefined, img: HTMLImageElement, rgb: number[]): HTMLCanvasElement {
  const d = dst ?? document.createElement('canvas');
  const w = img.naturalWidth, h = img.naturalHeight;
  if (d.width !== w || d.height !== h) { d.width = w; d.height = h; }
  const x = d.getContext('2d')!;
  x.clearRect(0, 0, w, h);
  x.drawImage(tintedCanvas(img, w, h, rgb), 0, 0, w, h, 0, 0, w, h);
  return d;
}
