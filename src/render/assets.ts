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
