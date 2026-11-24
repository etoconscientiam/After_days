import * as THREE from 'three';
import { Rng } from '../core/rng';
import { SKIN } from '../skin/default';

/** Procedural low-res textures. Seeded so the workshop looks the same every time. */
const P = SKIN.palette;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, repeat = 1): THREE.Texture {
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function noise(ctx: CanvasRenderingContext2D, w: number, h: number, r: Rng, amt: number): void {
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r.next() - 0.5) * amt;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

function shade(c: string, k: number): string {
  const [r, g, b] = hex(c);
  return `rgb(${Math.min(255, r * k) | 0},${Math.min(255, g * k) | 0},${Math.min(255, b * k) | 0})`;
}

export function makeTextures() {
  const r = new Rng(424242);

  const stone = (() => {
    const [c, x] = canvas(64, 64);
    x.fillStyle = P.mortar;
    x.fillRect(0, 0, 64, 64);
    let y = 0;
    while (y < 64) {
      const bh = r.int(9, 14);
      let bx = -r.int(0, 12);
      while (bx < 64) {
        const bw = r.int(14, 24);
        x.fillStyle = shade(P.stone, r.range(0.7, 1.15));
        x.fillRect(bx + 1, y + 1, bw - 1, bh - 1);
        x.fillStyle = shade(P.stone, r.range(1.05, 1.25));
        x.fillRect(bx + 1, y + 1, bw - 1, 1);
        bx += bw;
      }
      y += bh;
    }
    noise(x, 64, 64, r, 26);
    return tex(c);
  })();

  const floor = (() => {
    const [c, x] = canvas(64, 64);
    x.fillStyle = P.mortar;
    x.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        x.fillStyle = shade(P.stoneDark, r.range(0.8, 1.2));
        x.fillRect(i * 16 + 1, j * 16 + 1, 15, 15);
      }
    noise(x, 64, 64, r, 22);
    return tex(c);
  })();

  const wood = (() => {
    const [c, x] = canvas(32, 64);
    for (let i = 0; i < 4; i++) {
      x.fillStyle = shade(P.wood, r.range(0.75, 1.1));
      x.fillRect(i * 8, 0, 8, 64);
      x.fillStyle = shade(P.woodDark, 0.8);
      x.fillRect(i * 8, 0, 1, 64);
      for (let k = 0; k < 6; k++) {
        x.fillStyle = shade(P.woodDark, r.range(0.9, 1.3));
        x.fillRect(i * 8 + r.int(2, 6), r.int(0, 60), 1, r.int(4, 14));
      }
    }
    noise(x, 32, 64, r, 18);
    return tex(c);
  })();

  const steel = (() => {
    const [c, x] = canvas(64, 64);
    x.fillStyle = P.steelDark;
    x.fillRect(0, 0, 64, 64);
    for (let k = 0; k < 40; k++) {
      x.fillStyle = shade(P.steel, r.range(0.6, 1.0));
      x.fillRect(r.int(0, 63), r.int(0, 63), r.int(2, 10), 1);
    }
    for (let k = 0; k < 7; k++) {
      x.fillStyle = shade(P.rust, r.range(0.7, 1.1));
      x.globalAlpha = 0.5;
      x.fillRect(r.int(0, 60), r.int(0, 60), r.int(2, 8), r.int(2, 6));
    }
    x.globalAlpha = 1;
    noise(x, 64, 64, r, 20);
    return tex(c);
  })();

  const iron = (() => {
    const [c, x] = canvas(32, 32);
    x.fillStyle = P.iron;
    x.fillRect(0, 0, 32, 32);
    for (let k = 0; k < 12; k++) {
      x.fillStyle = shade(P.rust, r.range(0.7, 1.0));
      x.globalAlpha = 0.25;
      x.fillRect(r.int(0, 30), r.int(0, 30), r.int(1, 5), r.int(1, 4));
    }
    x.globalAlpha = 1;
    noise(x, 32, 32, r, 12);
    return tex(c);
  })();

  const paper = (() => {
    const [c, x] = canvas(16, 16);
    x.fillStyle = P.paper;
    x.fillRect(0, 0, 16, 16);
    x.fillStyle = shade(P.paper, 0.55);
    for (let k = 0; k < 4; k++) x.fillRect(2, 3 + k * 3, r.int(6, 12), 1);
    noise(x, 16, 16, r, 16);
    return tex(c);
  })();

  const leather = (() => {
    const [c, x] = canvas(16, 16);
    x.fillStyle = P.leather;
    x.fillRect(0, 0, 16, 16);
    noise(x, 16, 16, r, 30);
    return tex(c);
  })();

  /** Night sky with a faint band of cloud, used on a far backdrop. */
  const sky = (() => {
    const [c, x] = canvas(4, 64);
    const g = x.createLinearGradient(0, 64, 0, 0);
    g.addColorStop(0, P.sky[0]);
    g.addColorStop(0.45, P.sky[1]);
    g.addColorStop(1, P.sky[2]);
    x.fillStyle = g;
    x.fillRect(0, 0, 4, 64);
    const t = tex(c);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  })();

  return { stone, floor, wood, steel, iron, paper, leather, sky };
}

export type Textures = ReturnType<typeof makeTextures>;
