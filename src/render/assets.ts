// Skin registry: any PNG present in assets/world or assets/ui is picked up at build time (import.meta.glob).
// Code asks for a skin by path; if the file is missing it gets null and draws its procedural placeholder.
const files = import.meta.glob('/assets/{world,ui}/**/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const images = new Map<string, HTMLImageElement>();

/** URL of an asset like 'ui/portraits/fish.png', or null when the file is not there yet. */
export function assetUrl(path: string): string | null {
  return files['/assets/' + path] ?? null;
}

/** A loaded image for an asset, or null (missing file, or still loading). */
export function skin(path: string): HTMLImageElement | null {
  const url = assetUrl(path);
  if (!url) return null;
  let img = images.get(path);
  if (!img) {
    img = new Image();
    img.src = url;
    images.set(path, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

export function hasAsset(path: string): boolean {
  return assetUrl(path) !== null;
}

/** Pixels of a loaded asset as packed ABGR (canvas ImageData order), for code that writes pixel buffers. */
export interface SkinPixels { w: number; h: number; px: Uint32Array }
const pixelCache = new Map<string, SkinPixels | null>();
export function skinPixels(path: string): SkinPixels | null {
  const hit = pixelCache.get(path);
  if (hit !== undefined) return hit;
  const img = skin(path);
  if (!img) { if (!hasAsset(path)) pixelCache.set(path, null); return null; }
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height);
  const res = { w: c.width, h: c.height, px: new Uint32Array(d.data.buffer.slice(0)) };
  pixelCache.set(path, res);
  return res;
}

/** Start loading a group of skins early (images load asynchronously; code falls back until they arrive). */
export function preloadSkins(prefix: string): void {
  for (const k of Object.keys(files)) if (k.startsWith('/assets/' + prefix)) skin(k.slice('/assets/'.length));
}
