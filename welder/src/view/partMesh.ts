import * as THREE from 'three';
import type { PartDef } from '../data/types';
import { lambert } from './ps1';
import type { Textures } from './textures';
import { SKIN } from '../skin/default';

/** A part on the bench: a mesh in metres (y = 0 at the bench top) and its top surface height in mm. */
export interface PartMesh {
  group: THREE.Group;
  heightAt: (x: number, z: number) => number;
  /** Highest point (mm), for particles landing on it. */
  top: number;
  /** Footprint half-size (mm). */
  half: [number, number];
}

const MM = 0.001;
type Builder = (p: Record<string, number>, mat: Mats) => PartMesh;
interface Mats {
  iron: THREE.Material;
  dark: THREE.Material;
  copper: THREE.Material;
  steel: THREE.Material;
}

function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const g = new THREE.BoxGeometry(w * MM, h * MM, d * MM);
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(x * MM, (y + h / 2) * MM, z * MM);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

/** A surface y = f(x, z) over a rectangle, with a thin skirt so it reads as a plate. */
function heightField(w: number, d: number, f: (x: number, z: number) => number, t: number, m: THREE.Material, sx = 14, sz = 6): THREE.Mesh {
  const g = new THREE.PlaneGeometry(w * MM, d * MM, sx, sz);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / MM, z = pos.getZ(i) / MM;
    pos.setY(i, f(x, z) * MM);
  }
  g.computeVertexNormals();
  const top = new THREE.Mesh(g, m);
  top.castShadow = top.receiveShadow = true;
  // Skirt along the four edges.
  const skirt: number[] = [];
  const edge = (x0: number, z0: number, x1: number, z1: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const a = i / n, b = (i + 1) / n;
      const xa = x0 + (x1 - x0) * a, za = z0 + (z1 - z0) * a;
      const xb = x0 + (x1 - x0) * b, zb = z0 + (z1 - z0) * b;
      const ya = f(xa, za), yb = f(xb, zb);
      skirt.push(xa, ya, za, xb, yb, zb, xb, ya - t * 3, zb, xa, ya, za, xb, ya - t * 3, zb, xa, ya - t * 3, za);
    }
  };
  edge(-w / 2, d / 2, w / 2, d / 2, sx);
  edge(w / 2, -d / 2, -w / 2, -d / 2, sx);
  edge(-w / 2, -d / 2, -w / 2, d / 2, sz);
  edge(w / 2, d / 2, w / 2, -d / 2, sz);
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(skirt.map((v) => v * MM), 3));
  sg.computeVertexNormals();
  const sk = new THREE.Mesh(sg, m);
  sk.material = m;
  (sk.material as THREE.Material).side = THREE.DoubleSide;
  top.add(sk);
  return top;
}

function curve(r: number, w: number, t: number) {
  const base = Math.sqrt(r * r - (w / 2) * (w / 2));
  return (x: number) => Math.sqrt(Math.max(0, r * r - x * x)) - base + t;
}

const BUILDERS: Record<string, Builder> = {
  curvedPlate(p, m) {
    const f = curve(p.r, p.w, p.t);
    const g = new THREE.Group();
    g.add(heightField(p.w, p.d, (x) => f(x), p.t, p.dark ? m.dark : m.iron));
    // Rivets along one edge: it used to be a boiler.
    for (let i = -4; i <= 4; i++) {
      const x = i * (p.w / 10);
      const r = box(6, 4, 6, m.dark, x, f(x) - 1, -p.d / 2 + 10);
      g.add(r);
    }
    return { group: g, heightAt: (x) => f(x), top: f(0), half: [p.w / 2, p.d / 2] };
  },

  bars(p, m) {
    const g = new THREE.Group();
    g.add(box(p.len, p.size, p.size, m.iron, 0, 0, -p.size / 2 - 0.5));
    g.add(box(p.len * 0.96, p.size, p.size, m.iron, 6, 0, p.size / 2 + 0.5));
    const h = () => p.size;
    return { group: g, heightAt: h, top: p.size, half: [p.len / 2, p.size] };
  },

  rim(p, m) {
    const g = new THREE.Group();
    const N = 22;
    const pos: number[] = [];
    const ri = p.R - p.width / 2, ro = p.R + p.width / 2;
    const P = (a: number, r: number, y: number) => [Math.sin(a) * r, y, p.R - Math.cos(a) * r];
    for (let i = 0; i < N; i++) {
      const a0 = -p.arc / 2 + (p.arc * i) / N, a1 = -p.arc / 2 + (p.arc * (i + 1)) / N;
      const quad = (A: number[], B: number[], C: number[], D: number[]) => pos.push(...A, ...B, ...C, ...A, ...C, ...D);
      quad(P(a0, ri, p.t), P(a0, ro, p.t), P(a1, ro, p.t), P(a1, ri, p.t));
      quad(P(a0, ro, p.t), P(a0, ro, 0), P(a1, ro, 0), P(a1, ro, p.t));
      quad(P(a0, ri, 0), P(a0, ri, p.t), P(a1, ri, p.t), P(a1, ri, 0));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos.map((v) => v * MM), 3));
    geo.computeVertexNormals();
    const uv: number[] = [];
    for (let i = 0; i < pos.length / 3; i++) uv.push(pos[i * 3] * 0.01, pos[i * 3 + 2] * 0.01);
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const mesh = new THREE.Mesh(geo, m.iron);
    (m.iron as THREE.MeshLambertMaterial).side = THREE.DoubleSide;
    mesh.castShadow = mesh.receiveShadow = true;
    g.add(mesh);
    // A few spokes' stubs of the old wooden wheel.
    for (const a of [-0.2, 0.08]) {
      const s = box(14, 10, 40, m.dark, Math.sin(a) * (ri - 20), 0, p.R - Math.cos(a) * (ri - 20));
      s.rotation.y = -a;
      g.add(s);
    }
    return { group: g, heightAt: () => p.t, top: p.t, half: [Math.sin(p.arc / 2) * ro, p.width] };
  },

  axle(p, m) {
    const g = new THREE.Group();
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(p.r * MM, p.r * MM, p.len * MM, 10), m.iron);
    cyl.rotation.z = Math.PI / 2;
    cyl.position.y = p.r * MM;
    cyl.castShadow = cyl.receiveShadow = true;
    g.add(cyl);
    g.add(box(30, p.r * 2.4, p.r * 2.4, m.dark, -p.len / 2 + 10, -p.r * 0.2, 0));
    g.add(box(30, p.r * 2.4, p.r * 2.4, m.dark, p.len / 2 - 10, -p.r * 0.2, 0));
    const h = (_x: number, z: number) => p.r + Math.sqrt(Math.max(0, p.r * p.r - z * z));
    return { group: g, heightAt: h, top: p.r * 2, half: [p.len / 2, p.r] };
  },

  damper(p, m) {
    const g = new THREE.Group();
    g.add(box(p.w, p.t, p.d, m.iron));
    g.add(box(120, 3, 14, m.dark, -6, p.t, -46));
    g.add(box(14, 3, 104, m.dark, 48, p.t, -2));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(18 * MM, 3 * MM, 4, 10), m.dark);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(-40 * MM, (p.t + 3) * MM, 40 * MM);
    g.add(ring);
    const h = (x: number, z: number) => ((Math.abs(z + 46) < 8 && x < 56) || (Math.abs(x - 48) < 8 && z > -54) ? p.t + 3 : p.t);
    return { group: g, heightAt: h, top: p.t + 3, half: [p.w / 2, p.d / 2] };
  },

  plates(p, m) {
    const g = new THREE.Group();
    g.add(box(p.w, p.t, p.d / 2 - 1, m.iron, 0, 0, -p.d / 4 - 0.5));
    g.add(box(p.w * 0.97, p.t, p.d / 2 - 1, m.iron, 4, 0, p.d / 4 + 0.5));
    for (let i = -3; i <= 3; i++) g.add(box(6, 3, 6, m.dark, i * 34, p.t, -p.d / 2 + 12));
    return { group: g, heightAt: () => p.t, top: p.t, half: [p.w / 2, p.d / 2] };
  },

  patch(p, m) {
    const f = curve(p.r, p.w, 2);
    const g = new THREE.Group();
    g.add(heightField(p.w, p.d, (x) => f(x), 2, m.steel));
    g.add(heightField(p.pw, p.pd, (x) => f(x) + 2, 2, m.iron, 6, 4));
    const h = (x: number, z: number) => f(x) + (Math.abs(x) < p.pw / 2 && Math.abs(z) < p.pd / 2 ? 2 : 0);
    return { group: g, heightAt: h, top: f(0) + 2, half: [p.w / 2, p.d / 2] };
  },

  spear(p, m) {
    const g = new THREE.Group();
    const sock = new THREE.Mesh(new THREE.CylinderGeometry(p.r * MM, p.r * 1.15 * MM, 110 * MM, 8), m.iron);
    sock.rotation.z = Math.PI / 2;
    sock.position.set(-40 * MM, p.r * MM, 0);
    sock.castShadow = sock.receiveShadow = true;
    g.add(sock);
    const bladeShape = new THREE.Shape();
    bladeShape.moveTo(0, -p.r * 1.6);
    bladeShape.lineTo(90, 0);
    bladeShape.lineTo(0, p.r * 1.6);
    bladeShape.lineTo(-6, 0);
    const bg = new THREE.ExtrudeGeometry(bladeShape, { depth: 5, bevelEnabled: false });
    bg.scale(MM, MM, MM);
    bg.rotateX(-Math.PI / 2);
    const blade = new THREE.Mesh(bg, m.steel);
    blade.position.set(16 * MM, (p.r - 2) * MM, 0);
    blade.castShadow = blade.receiveShadow = true;
    g.add(blade);
    const h = (x: number, z: number) => (x < 16 ? p.r + Math.sqrt(Math.max(0, p.r * p.r - z * z)) : p.r + 3);
    return { group: g, heightAt: h, top: p.r * 2, half: [p.len / 2, p.r * 2] };
  },

  grate(p, m) {
    const g = new THREE.Group();
    const b = p.bar;
    const xs = [-195, -130, -65, 0, 65, 130, 195];
    for (const x of xs) g.add(box(b, b, p.d, m.iron, x, 0, 0));
    for (const z of [-110, 110]) g.add(box(p.w, b, b, m.iron, 0, b, z));
    // The broken middle bar: two pieces that don't quite meet, and a splint along them.
    g.add(box(p.w / 2 - 6, b, b, m.iron, -p.w / 4 - 3, b, 5));
    const right = box(p.w / 2 - 6, b, b, m.iron, p.w / 4 + 3, b, 5);
    right.rotation.y = 0.012;
    g.add(right);
    for (const x of xs) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(b * 0.7 * MM, 40 * MM, 4), m.dark);
      spike.rotation.x = -Math.PI / 2;
      spike.position.set(x * MM, (b / 2) * MM, (p.d / 2 + 20) * MM);
      g.add(spike);
    }
    const h = (x: number, z: number) => {
      if (Math.abs(z - 5) < b / 2 + 4 || Math.abs(Math.abs(z) - 110) < b / 2 + 2) return 2 * b;
      for (const bx of xs) if (Math.abs(x - bx) < b / 2) return b;
      return 0;
    };
    return { group: g, heightAt: h, top: 2 * b, half: [p.w / 2, p.d / 2 + 30] };
  },
};

let shared: Mats | null = null;
export function partMaterials(tx: Textures): Mats {
  if (shared) return shared;
  const P = SKIN.palette;
  const fine = tx.part.clone();
  fine.repeat.set(3, 3);
  fine.needsUpdate = true;
  const fineSteel = tx.steel.clone();
  fineSteel.repeat.set(3, 3);
  fineSteel.needsUpdate = true;
  shared = {
    iron: lambert({ map: fine, color: '#d8d2ca' }),
    dark: lambert({ color: P.iron }),
    copper: lambert({ color: P.copper }),
    steel: lambert({ map: fineSteel, color: '#c8c8cc' }),
  };
  return shared;
}

export function buildPart(def: PartDef, tx: Textures): PartMesh {
  const b = BUILDERS[def.shape] ?? BUILDERS.plates;
  const pm = b(def.params, partMaterials(tx));
  pm.group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.userData.pick = 'part';
    }
  });
  return pm;
}
