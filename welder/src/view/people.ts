import * as THREE from 'three';
import { lambert } from './ps1';
import type { CustomerLook } from '../data/types';

/**
 * People: the customers at the door and in the queue, the apprentice, the hired hands. Built to read at the
 * game's 426×240: a big box head with a painted pixel face (eyes, brows, nose, mouth, beard, hair), a body
 * shaped by lathes, clothes by trade (cloak, kaftan, robe, leather apron), boots with wrapped shins, mittened
 * hands, and what each carries (the guard's spear, the carter's whip, the keeper's bundle...). They breathe,
 * look about, and at a bench lean in to the work.
 */


/** Everything a look may say; what it leaves out is picked from its colours, the same each time. */
export interface Look extends CustomerLook {
  /** Standing about, or at a bench with the hands on the work. */
  pose?: 'stand' | 'work';
}

/** Switch a person between standing about and working at a bench. */
export function setPose(g: THREE.Group, pose: 'stand' | 'work'): void {
  const r = g.userData.rig as Rig | undefined;
  if (!r || r.pose === pose) return;
  r.pose = pose;
  if (pose === 'stand') {
    r.armR.rotation.set(0, 0, 0.1);
    r.armL.rotation.set(0, 0, -0.1);
    r.head.rotation.set(0, 0, 0);
  }
}

const SKINS = ['#c8936c', '#b07a58', '#d8a582', '#9a6a4c', '#c08868'];
const HAIRS = ['#2a1d14', '#4a3020', '#6a4a2c', '#8a7a68', '#3a2a1c', '#b0a090'];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return '#' + c.getHexString();
}

// ------------------------------------------------------------------ painted textures

function canvasTex(w: number, h: number, paint: (x: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d')!;
  paint(x);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const px = (x: CanvasRenderingContext2D, c: string, X: number, Y: number, w = 1, h = 1) => {
  x.fillStyle = c;
  x.fillRect(X, Y, w, h);
};

interface FaceSpec {
  skin: string;
  hair: string;
  beard: NonNullable<Look['beard']>;
  female: boolean;
  hooded: boolean;
  goggles: boolean;
  seed: number;
}

/** The face, 16×16: hair line, brows, eyes with a catch of light, the nose's shadow, mouth, beard. */
function paintFace(x: CanvasRenderingContext2D, f: FaceSpec): void {
  const sk = f.skin, skD = shade(sk, 0.82), skDD = shade(sk, 0.66), skL = shade(sk, 1.1);
  const hr = f.hair, hrD = shade(hr, 0.7);
  px(x, sk, 0, 0, 16, 16);
  // Light from the upper left: a lit cheek, a shaded jaw and right side.
  px(x, skL, 2, 8, 3, 2);
  px(x, skD, 13, 4, 3, 12);
  px(x, skD, 0, 14, 16, 2);
  // Hair: a fringe with a ragged edge.
  px(x, hr, 0, 0, 16, 3);
  const fringe = [4, 3, 4, 5, 4, 3, 3, 4, 5, 4, 3, 4, 4, 5, 4, 4];
  for (let i = 0; i < 16; i++) px(x, (i + f.seed) % 3 === 0 ? hrD : hr, i, 0, 1, fringe[(i + f.seed) % 16]);
  if (f.female) {
    // Hair parted in the middle and down both sides of the face.
    px(x, hrD, 7, 0, 2, 3);
    px(x, hr, 0, 3, 2, 11);
    px(x, hr, 14, 3, 2, 11);
  }
  // Brows and eyes.
  const brow = shade(hr, 0.8);
  px(x, brow, 3, 6, 3, 1);
  px(x, brow, 10, 6, 3, 1);
  px(x, '#efe6d6', 3, 8, 3, 1);
  px(x, '#efe6d6', 10, 8, 3, 1);
  px(x, '#1a120c', 4, 8, 2, 2);
  px(x, '#1a120c', 10, 8, 2, 2);
  px(x, '#ffffff', 4, 8, 1, 1);
  px(x, '#ffffff', 10, 8, 1, 1);
  px(x, skD, 3, 10, 3, 1);
  px(x, skD, 10, 10, 3, 1);
  // The nose's shadow (the nose itself stands out of the head) and the mouth.
  px(x, skDD, 8, 9, 2, 3);
  px(x, skD, 7, 12, 2, 1);
  px(x, '#7a3a2c', 6, 13, 4, 1);
  if (f.female) {
    px(x, '#c8705c', 3, 11, 2, 1);
    px(x, '#c8705c', 11, 11, 2, 1);
    px(x, '#9a3a30', 6, 13, 4, 1);
  }
  // Beards.
  if (f.beard === 'stubble') for (let i = 0; i < 26; i++) px(x, shade(hr, 0.9 + ((i * 7) % 5) * 0.05), 2 + ((i * 5 + f.seed) % 12), 11 + ((i * 3) % 5));
  if (f.beard === 'mustache' || f.beard === 'short' || f.beard === 'long') {
    px(x, hr, 4, 12, 8, 1);
    px(x, hrD, 5, 12, 1, 1);
    px(x, hrD, 10, 12, 1, 1);
  }
  if (f.beard === 'short' || f.beard === 'long') {
    px(x, hr, 1, 11, 2, 5);
    px(x, hr, 13, 11, 2, 5);
    px(x, hr, 2, 14, 12, 2);
    px(x, hr, 5, 13, 1, 1);
    px(x, hr, 10, 13, 1, 1);
    px(x, hrD, 6, 15, 4, 1);
  }
  // In a hood's shadow: the top of the face darker.
  if (f.hooded) {
    x.fillStyle = 'rgba(10, 6, 4, 0.45)';
    x.fillRect(0, 0, 16, 7);
    x.fillStyle = 'rgba(10, 6, 4, 0.2)';
    x.fillRect(0, 7, 16, 3);
  }
  // Welding goggles pushed up on the brow.
  if (f.goggles) {
    px(x, '#2a2218', 0, 3, 16, 2);
    px(x, '#2e5a3e', 3, 2, 4, 3);
    px(x, '#2e5a3e', 9, 2, 4, 3);
    px(x, '#6aa07a', 3, 2, 1, 1);
    px(x, '#6aa07a', 9, 2, 1, 1);
  }
}

/** Side of the head: hair above and behind, skin with the ear below. */
function paintSide(x: CanvasRenderingContext2D, f: FaceSpec, flip: boolean): void {
  const sk = f.skin, hr = f.hair, hrD = shade(hr, 0.7);
  px(x, flip ? shade(sk, 0.78) : sk, 0, 0, 16, 16);
  px(x, hr, 0, 0, 16, 6);
  // Hair down the back of the head (toward the back edge of this face).
  const back = flip ? 0 : 10;
  px(x, hr, back, 0, 6, f.female ? 15 : 11);
  px(x, hrD, back + (flip ? 4 : 1), 2, 1, 8);
  px(x, shade(sk, 0.7), flip ? 9 : 5, 7, 2, 4);
  px(x, shade(sk, 0.9), flip ? 9 : 6, 8, 1, 2);
  if (f.beard === 'short' || f.beard === 'long') px(x, hr, flip ? 0 : 3, 11, 13, 5);
  if (f.beard === 'stubble') for (let i = 0; i < 10; i++) px(x, shade(hr, 0.95), (flip ? 0 : 4) + ((i * 5) % 11), 11 + ((i * 3) % 5));
}

function paintHair(x: CanvasRenderingContext2D, f: FaceSpec): void {
  const hr = f.hair;
  px(x, hr, 0, 0, 16, 16);
  for (let i = 0; i < 40; i++) px(x, shade(hr, 0.75 + ((i * 13) % 7) * 0.06), (i * 7 + f.seed) % 16, (i * 11) % 16, 1, 2);
}

/** A coarse weave for cloth: two tones in a broken twill, so a coat isn't one flat colour. */
const weaveCache = new Map<string, THREE.CanvasTexture>();
function weave(color: string): THREE.CanvasTexture {
  const hit = weaveCache.get(color);
  if (hit) return hit;
  const t = canvasTex(16, 16, (x) => {
    px(x, color, 0, 0, 16, 16);
    const d = shade(color, 0.86), l = shade(color, 1.08);
    for (let y = 0; y < 16; y++)
      for (let i = 0; i < 16; i++) {
        const k = (i + y * 3) % 7;
        if (k === 0) px(x, d, i, y);
        else if (k === 3 && (i * y) % 5 === 1) px(x, l, i, y);
      }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  weaveCache.set(color, t);
  return t;
}

/** Mail rings for the guard's coif. */
let mailTex: THREE.CanvasTexture | null = null;
function mail(): THREE.CanvasTexture {
  mailTex ??= canvasTex(8, 8, (x) => {
    px(x, '#3e4044', 0, 0, 8, 8);
    for (let y = 0; y < 8; y += 2) for (let i = (y / 2) % 2; i < 8; i += 2) px(x, '#7a7e84', i, y, 1, 1);
  });
  mailTex.wrapS = mailTex.wrapT = THREE.RepeatWrapping;
  mailTex.repeat.set(10, 4);
  return mailTex;
}

/** The town's arms on the guard's tabard: a white tower on red. */
let armsTex: THREE.CanvasTexture | null = null;
function arms(): THREE.CanvasTexture {
  armsTex ??= canvasTex(16, 20, (x) => {
    px(x, '#7a2a20', 0, 0, 16, 20);
    px(x, '#5a1c16', 0, 0, 1, 20);
    px(x, '#5a1c16', 15, 0, 1, 20);
    px(x, '#d8ccb0', 5, 6, 6, 9);
    for (const i of [4, 7, 10]) px(x, '#d8ccb0', i, 4, 2, 2);
    px(x, '#2a1a14', 7, 11, 2, 4);
    px(x, '#c8a040', 3, 17, 10, 1);
  });
  return armsTex;
}

// ------------------------------------------------------------------ building

const matCache = new Map<string, THREE.Material>();
function mat(color: string, map?: THREE.Texture | null, key = ''): THREE.Material {
  const k = color + '|' + (map ? map.uuid : '') + key;
  let m = matCache.get(k);
  if (!m) {
    m = lambert(map ? { color: '#ffffff', map } : { color });
    if (map) (m as THREE.MeshLambertMaterial).color.set(color);
    matCache.set(k, m);
  }
  return m;
}
function cloth(color: string): THREE.Material {
  return mat('#ffffff', weave(color), 'cloth' + color);
}

function M(g: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0, shadow = true): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = shadow;
  o.receiveShadow = true;
  return o;
}
const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => M(new THREE.BoxGeometry(w, h, d), m, x, y, z);
const cyl = (r0: number, r1: number, h: number, seg: number, m: THREE.Material, x: number, y: number, z: number) => M(new THREE.CylinderGeometry(r0, r1, h, seg), m, x, y, z);
function lathe(prof: [number, number][], seg: number, m: THREE.Material, flatZ = 0.78, phi0 = 0, phiLen = Math.PI * 2): THREE.Mesh {
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), seg, phi0, phiLen);
  g.scale(1, 1, flatZ);
  const o = M(g, m);
  if (phiLen < Math.PI * 2) (m as THREE.MeshLambertMaterial).side = THREE.DoubleSide;
  return o;
}

/** Picks the look's missing details from its colours, so the same person always comes out the same. */
function fill(look: Look): Required<Omit<Look, 'pose'>> & { pose: 'stand' | 'work' } {
  const s = hash(look.cloak + look.hood + look.hat + look.height);
  return {
    ...look,
    skin: look.skin ?? SKINS[s % SKINS.length],
    hair: look.hair ?? HAIRS[(s >> 3) % HAIRS.length],
    beard: look.beard ?? (look.female ? 'none' : (['none', 'stubble', 'short', 'long', 'mustache'] as const)[(s >> 6) % 5]),
    female: !!look.female,
    coat: look.coat ?? (look.hat === 'hood' ? 'cloak' : 'coat'),
    role: look.role ?? 'plain',
    trousers: look.trousers ?? ['#3a3430', '#2e2c2a', '#463a2e', '#34302a'][(s >> 9) % 4],
    pose: look.pose ?? 'stand',
  };
}

interface Rig {
  body: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  phase: number;
  hip: number;
  pose: 'stand' | 'work';
  look: number;
  lookT: number;
}

const people: THREE.Group[] = [];

/** A person, feet on the floor at the origin, facing +z. */
export function person(input: Look): THREE.Group {
  const L = fill(input);
  const seed = hash(L.cloak + L.hood + L.height);
  const g = new THREE.Group();
  const h = L.height;
  const hip = h * 0.5, knee = h * 0.27, chest = h * 0.7, shoulder = h * 0.8, neck = h * 0.84;
  const headY = h * 0.91;
  const HW = 0.175, HH = 0.205, HD = 0.175;

  const skinM = mat(L.skin);
  const trouM = cloth(L.trousers);
  const coatM = cloth(L.cloak);
  const accM = cloth(L.hood);
  const bootM = mat('#24190f');
  const soleM = mat('#120c08');
  const wrapM = mat('#8a7a62');
  const beltM = mat('#3a2616');
  const brassM = mat('#c8a040');
  const leatherM = mat('#6a4428');
  const mitts = L.role === 'smith' ? leatherM : L.role === 'guard' ? mat('#4a3a2a') : skinM;

  // --- Legs: thigh and shin, a wrap round the shin, boots with a sole.
  for (const sx of [-0.075, 0.075]) {
    g.add(cyl(0.062, 0.054, hip - knee, 6, trouM, sx, (hip + knee) / 2, 0));
    g.add(cyl(0.054, 0.046, knee - 0.1, 6, L.role === 'guard' ? trouM : wrapM, sx, (knee + 0.1) / 2, 0));
    if (L.role !== 'guard') for (const y of [0.15, 0.22]) g.add(cyl(0.056, 0.056, 0.012, 6, mat('#5a4a3a'), sx, y, 0));
    g.add(box(0.1, 0.12, 0.2, bootM, sx, 0.07, 0.025));
    g.add(box(0.105, 0.02, 0.205, soleM, sx, 0.01, 0.025));
    g.add(box(0.11, 0.03, 0.12, bootM, sx, 0.13, 0.0));
  }

  // --- Upper body: everything that breathes and leans moves with it.
  const body = new THREE.Group();
  body.position.y = hip;
  g.add(body);
  const B = (o: THREE.Object3D) => {
    o.position.y -= hip;
    body.add(o);
    return o;
  };
  // Tunic: waist, chest, shoulders.
  B(lathe([[0.14, hip - 0.06], [0.15, hip + 0.04], [0.14, (hip + chest) / 2], [0.168, chest], [0.165, shoulder - 0.03], [0.1, shoulder + 0.02], [0.05, neck]], 10, cloth(shade(L.trousers, 1.25)), 0.72));
  // The coat over it.
  if (L.coat === 'cloak') {
    // Open at the front: hangs from the shoulders to the knee.
    B(lathe([[0.27, knee - 0.02], [0.24, hip - 0.05], [0.2, chest], [0.19, shoulder - 0.02], [0.12, shoulder + 0.04], [0.07, neck + 0.01]], 12, cloth(L.cloak), 0.8, Math.PI * 0.62, Math.PI * 1.76));
    B(cyl(0.025, 0.025, 0.012, 6, brassM, 0, shoulder - 0.01, 0.14)).rotation.x = Math.PI / 2;
  } else if (L.coat === 'coat' || L.coat === 'robe') {
    const hem = L.coat === 'robe' ? 0.1 : knee + 0.02;
    B(lathe([[L.coat === 'robe' ? 0.27 : 0.23, hem], [0.19, hip - 0.04], [0.17, hip + 0.06], [0.18, chest], [0.175, shoulder - 0.03], [0.11, shoulder + 0.03], [0.07, neck]], 12, coatM, 0.76));
    // The fold down the front, a fur or dark trim at the hem and collar.
    B(box(0.035, chest - hem, 0.015, mat(shade(L.cloak, 0.7)), 0.02, (chest + hem) / 2, 0.15));
    const trim = L.role === 'carter' || L.role === 'north' ? cloth('#8a7058') : mat(shade(L.cloak, 0.6));
    const hemT = M(new THREE.TorusGeometry(L.coat === 'robe' ? 0.27 : 0.23, 0.022, 4, 12), trim, 0, hem + 0.01, 0);
    hemT.rotation.x = Math.PI / 2;
    hemT.scale.y = 0.76;
    B(hemT);
    const collar = M(new THREE.TorusGeometry(0.1, 0.03, 4, 10), trim, 0, shoulder + 0.03, 0);
    collar.rotation.x = Math.PI / 2;
    collar.scale.y = 0.8;
    B(collar);
  } else if (L.coat === 'apron') {
    // A smith's leather apron from chest to knee, on a strap round the neck.
    B(box(0.27, chest - knee + 0.02, 0.02, leatherM, 0, (chest + knee) / 2, 0.135)).rotation.x = -0.05;
    B(box(0.02, 0.2, 0.02, leatherM, -0.08, chest + 0.08, 0.12)).rotation.z = 0.35;
    B(box(0.02, 0.2, 0.02, leatherM, 0.08, chest + 0.08, 0.12)).rotation.z = -0.35;
  }
  // Belt with a buckle; a pouch.
  const belt = M(new THREE.TorusGeometry(0.155, 0.02, 4, 12), beltM, 0, hip + 0.02, 0);
  belt.rotation.x = Math.PI / 2;
  belt.scale.y = 0.76;
  B(belt);
  B(box(0.04, 0.035, 0.012, brassM, 0, hip + 0.02, 0.125));
  B(box(0.1, 0.1, 0.05, leatherM, -0.15, hip - 0.04, 0.05)).rotation.y = 0.5;
  // The guard: a mail coif over the shoulders, a tabard with the town's arms.
  if (L.role === 'guard') {
    B(lathe([[0.2, shoulder - 0.06], [0.2, shoulder + 0.01], [0.13, neck + 0.02], [0.11, headY - 0.02]], 10, mat('#ffffff', mail()), 0.85));
    B(box(0.24, 0.42, 0.012, mat('#ffffff', arms()), 0, chest - 0.15, 0.155));
    B(box(0.24, 0.42, 0.012, mat('#7a2a20'), 0, chest - 0.15, -0.155));
  }
  // The northern woman: a patterned shawl round the shoulders.
  if (L.role === 'north') {
    B(lathe([[0.215, chest - 0.08], [0.2, shoulder - 0.02], [0.12, shoulder + 0.05]], 10, cloth('#8a3a2c'), 0.8));
    for (let i = 0; i < 6; i++) B(box(0.03, 0.03, 0.01, mat('#d8c090'), -0.13 + i * 0.052, chest - 0.06, 0.16));
  }

  // --- Arms: shoulder pivots, sleeve, cuff, mitten with a thumb.
  const arm = (sx: number) => {
    const a = new THREE.Group();
    a.position.set(sx * 0.2, shoulder - 0.04 - hip, 0);
    const sleeve = L.coat === 'apron' ? cloth(shade(L.trousers, 1.25)) : coatM;
    a.add(cyl(0.052, 0.046, 0.28, 6, sleeve, 0, -0.14, 0));
    a.add(cyl(0.046, 0.042, 0.24, 6, sleeve, 0, -0.39, 0.0));
    a.add(cyl(0.05, 0.05, 0.04, 6, L.coat === 'apron' ? leatherM : mat(shade(L.cloak, 0.7)), 0, -0.5, 0));
    a.add(box(0.07, 0.09, 0.055, mitts, 0, -0.56, 0.005));
    a.add(box(0.025, 0.045, 0.03, mitts, -sx * 0.035, -0.54, 0.025));
    a.rotation.z = sx * 0.1;
    body.add(a);
    return a;
  };
  const armL = arm(-1), armR = arm(1);

  // --- Neck and head.
  B(cyl(0.045, 0.05, 0.08, 6, skinM, 0, neck + 0.02, 0.0));
  const head = new THREE.Group();
  head.position.set(0, headY - hip, 0.01);
  body.add(head);
  const spec: FaceSpec = {
    skin: L.skin,
    hair: L.hair,
    beard: L.beard,
    female: L.female,
    hooded: L.hat === 'hood',
    goggles: L.role === 'smith',
    seed: seed % 16,
  };
  const faceM = lambert({ map: canvasTex(16, 16, (x) => paintFace(x, spec)) });
  const sideR = lambert({ map: canvasTex(16, 16, (x) => paintSide(x, spec, false)) });
  const sideL = lambert({ map: canvasTex(16, 16, (x) => paintSide(x, spec, true)) });
  const hairM = lambert({ map: canvasTex(16, 16, (x) => paintHair(x, spec)) });
  const jaw = mat(shade(L.skin, 0.75));
  // Box faces: +x, -x, +y, -y, +z (the face), -z.
  head.add(M(new THREE.BoxGeometry(HW, HH, HD), [sideR, sideL, hairM, jaw, faceM, hairM], 0, 0, 0));
  head.add(box(0.034, 0.05, 0.04, mat(shade(L.skin, 0.95)), 0, -0.012, HD / 2 + 0.015));
  for (const sx of [-1, 1]) head.add(box(0.02, 0.05, 0.035, mat(shade(L.skin, 0.85)), sx * (HW / 2 + 0.008), -0.01, -0.005));
  if (L.beard === 'long') head.add(box(0.15, 0.1, 0.07, mat(L.hair), 0, -HH / 2 - 0.035, 0.06)).rotation.x = 0.25;
  if (L.female && L.role === 'north') {
    // A long braid down the back.
    for (let i = 0; i < 5; i++) head.add(box(0.045, 0.06, 0.04, mat(shade(L.hair, i % 2 ? 0.85 : 1)), 0, -0.08 - i * 0.055, -HD / 2 - 0.02));
  }

  // --- What's on the head.
  if (L.hat === 'hood') {
    // A hood open at the front, the point hanging down the back, the cowl on the shoulders.
    const hm = cloth(L.hood);
    const hd = M(new THREE.SphereGeometry(0.14, 10, 8, Math.PI / 2 + 0.75, Math.PI * 2 - 1.5, 0, Math.PI * 0.66), hm, 0, 0.015, -0.005);
    (hm as THREE.MeshLambertMaterial).side = THREE.DoubleSide;
    hd.scale.set(1, 1.08, 1.05);
    head.add(hd);
    const tail = M(new THREE.ConeGeometry(0.05, 0.22, 5), hm, 0, -0.06, -0.15);
    tail.rotation.x = -2.6;
    head.add(tail);
    B(lathe([[0.2, shoulder - 0.04], [0.15, shoulder + 0.04], [0.11, neck + 0.04]], 10, hm, 0.85));
  } else if (L.hat === 'helmet') {
    // A kettle hat: a round crown and a wide brim, rivets.
    const st = mat('#6a6c70');
    head.add(M(new THREE.SphereGeometry(0.13, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), st, 0, HH / 2 - 0.04, 0));
    head.add(cyl(0.2, 0.2, 0.014, 12, st, 0, HH / 2 - 0.04, 0));
    head.add(cyl(0.135, 0.135, 0.03, 12, mat('#4a4c50'), 0, HH / 2 - 0.03, 0));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      head.add(box(0.012, 0.012, 0.012, brassM, Math.sin(a) * 0.137, HH / 2 - 0.02, Math.cos(a) * 0.137));
    }
  } else if (L.role === 'carter' || L.role === 'north') {
    // A fur hat with ear flaps.
    const fur = cloth(L.role === 'north' ? '#d8ccb8' : '#6a5440');
    head.add(cyl(0.12, 0.115, 0.1, 10, fur, 0, HH / 2 + 0.02, 0));
    head.add(cyl(0.1, 0.12, 0.03, 10, cloth(L.hood), 0, HH / 2 + 0.08, 0));
    for (const sx of [-1, 1]) head.add(box(0.03, 0.1, 0.09, fur, sx * (HW / 2 + 0.018), -0.01, 0));
  } else {
    // A felt cap with a short brim (the apprentice, the hands, the neighbour).
    const cap = cloth(L.hood);
    head.add(cyl(0.105, 0.1, 0.06, 10, cap, 0, HH / 2 + 0.01, -0.005));
    head.add(box(0.15, 0.012, 0.06, cap, 0, HH / 2 - 0.015, HD / 2 + 0.02));
  }

  // --- What they carry.
  if (L.role === 'guard' && L.pose === 'stand') {
    // The spear upright in the right hand.
    const sp = new THREE.Group();
    sp.add(cyl(0.013, 0.013, h * 1.2, 5, mat('#4a3424'), 0, h * 0.18, 0));
    sp.add(M(new THREE.ConeGeometry(0.028, 0.14, 4), mat('#8a8c90'), 0, h * 0.85, 0));
    sp.add(box(0.07, 0.012, 0.012, mat('#6a6c70'), 0, h * 0.77, 0));
    sp.position.set(0, -0.56, 0.02);
    armR.add(sp);
    armR.rotation.x = -0.25;
  }
  if (L.role === 'carter') {
    // A coiled whip on the belt.
    const wh = M(new THREE.TorusGeometry(0.06, 0.012, 4, 10), leatherM, 0.17, hip - 0.04 - hip, 0.04);
    wh.rotation.y = 1.2;
    body.add(wh);
    body.add(box(0.02, 0.2, 0.02, mat('#5a4028'), 0.19, -0.12, 0.07));
  }
  if (L.role === 'keeper') {
    // A bundle wrapped in cloth under the arm, something from the river glowing through it.
    const bundle = new THREE.Group();
    bundle.add(box(0.16, 0.12, 0.12, cloth('#5a5244'), 0, 0, 0));
    bundle.add(box(0.05, 0.04, 0.01, new THREE.MeshBasicMaterial({ color: '#5ad0e0' }), 0.02, 0.01, 0.062));
    bundle.position.set(0.05, -0.36, 0.1);
    armL.add(bundle);
    armL.rotation.x = -0.5;
    armL.rotation.z = -0.35;
    // A rope belt over the robe.
    body.add(box(0.02, 0.22, 0.02, mat('#a89070'), 0.08, -0.12, 0.13));
  }
  if (L.role === 'neighbour') body.add(box(0.26, 0.34, 0.012, cloth('#a89878'), 0, (hip + knee) / 2 - hip + 0.1, 0.14));

  g.userData.rig = { body, head, armL, armR, phase: (seed % 1000) / 160, hip, pose: L.pose, look: 0, lookT: (seed % 7) * 0.5 } as Rig;
  people.push(g);
  return g;
}

/**
 * Every frame: breathing, a slow look about now and then, a little sway; at a bench the arms are on the work
 * and the head bent over it, moving with the welding.
 */
export function animatePeople(dt: number, t: number): void {
  for (let i = people.length - 1; i >= 0; i--) {
    const g = people[i];
    if (!g.parent) {
      people.splice(i, 1);
      continue;
    }
    if (!g.visible) continue;
    const r = g.userData.rig as Rig;
    const p = r.phase;
    r.body.position.y = r.hip + Math.sin(t * 1.7 + p) * 0.004;
    r.body.rotation.z = Math.sin(t * 0.45 + p) * 0.015;
    if (r.pose === 'work') {
      r.body.rotation.x = 0.22;
      r.head.rotation.x = 0.35 + Math.sin(t * 3 + p) * 0.03;
      r.head.rotation.y = Math.sin(t * 0.7 + p) * 0.12;
      r.armR.rotation.x = -1.05 + Math.sin(t * 2.2 + p) * 0.06;
      r.armL.rotation.x = -0.85 + Math.sin(t * 1.3 + p) * 0.04;
      r.armR.rotation.z = 0.25;
      r.armL.rotation.z = -0.3;
      continue;
    }
    r.body.rotation.x *= 0.9;
    // Standing about: now and then the head turns to look at something, then back.
    r.lookT -= dt;
    if (r.lookT <= 0) {
      r.lookT = 2.5 + ((Math.sin(t * 13.7 + p * 7) + 1) * 2.5);
      r.look = Math.abs(r.look) > 0.05 ? 0 : Math.sin(t * 5.1 + p) * 0.6;
    }
    r.head.rotation.y += (r.look - r.head.rotation.y) * Math.min(1, dt * 3);
    r.head.rotation.x = Math.sin(t * 0.5 + p) * 0.04;
  }
}
