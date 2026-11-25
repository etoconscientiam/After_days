import * as THREE from 'three';
import { SKIN } from '../skin/default';
import { lambert } from './ps1';
import {
  Textures,
  priceTag,
  dynTex,
  pixDigits,
  clayTex,
  barrelTex,
  doorTex,
  postTex,
  batteryTex,
  bigDialTex,
  counterTex,
  signTex,
} from './textures';
import type { GameData, CustomerLook } from '../data/types';

/**
 * The welding station, composed like a Dish Pit station: you stand at the bench, the job lies big in the
 * middle, both hands are in the picture, the bench is crowded, and the wall in front carries everything you
 * read at a glance (window, chalk tally, ammeter, shelf of things for sale with paper tags).
 * Units are metres; the eye is at (0, 1.5, 0) looking 30° down.
 */
export const TABLE = 0.9;
/** Centre of the job on the bench. */
export const BENCH = new THREE.Vector3(0, TABLE + 0.006, -0.68);
export const PART_ROT = 0;
/** How wide (m) a job is drawn: parts are scaled to fill the middle of the view. */
export const PART_SPAN = 0.62;

const BACK_Z = -1.15;
/** Largest polygon edge on textured surfaces, metres. */
const CELL = 0.3;
const P = SKIN.palette;

export interface Workshop {
  scene: THREE.Scene;
  lights: {
    hemi: THREE.HemisphereLight;
    window: THREE.SpotLight;
    door: THREE.SpotLight;
    lamp: THREE.PointLight;
    lampBulb: THREE.MeshBasicMaterial;
    stove: THREE.PointLight;
    arc: THREE.PointLight;
    appArc: THREE.PointLight;
  };
  wheels: THREE.Group[];
  wheel2: THREE.Group;
  sky: THREE.MeshBasicMaterial;
  far: THREE.MeshBasicMaterial[];
  snow: THREE.Points;
  snowVel: Float32Array;
  queue: THREE.Group[];
  customer: THREE.Group;
  apprentice: THREE.Group;
  appBench: THREE.Group;
  pileSlot: THREE.Group;
  boardTags: THREE.Mesh[];
  shelfItems: Record<string, THREE.Object3D>;
  ownedItems: Record<string, THREE.Object3D>;
  electrodeBox: THREE.Group;
  restHammer: THREE.Object3D;
  anchors: Record<string, THREE.Vector3>;
  pickables: THREE.Object3D[];
  hiMats: Record<string, THREE.MeshLambertMaterial[]>;
  relabel: (sign: string) => void;
  floorAt: (x: number, z: number) => number;
  setMoney: (n: number) => void;
  setRods: (n: number) => void;
  setOrders: (done: number, waiting: number) => void;
  setGauge: (I: number) => void;
  /** How many jobs wait in the heap and how many mended ones stand in the stack. */
  setPiles: (waiting: number, done: number) => void;
  /** Would a body of radius r standing at (x, z) be inside a wall or a piece of furniture? */
  blocked: (x: number, z: number, r: number) => boolean;
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0, shadow = false): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = shadow;
  o.receiveShadow = true;
  return o;
}

function boxAt(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, shadow = false): THREE.Mesh {
  return mesh(new THREE.BoxGeometry(w, h, d), m, x, y, z, shadow);
}

/** Box whose texture repeats by world size, so planks and stones keep their scale on every face. */
function texBox(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, tile: number, shadow = false): THREE.Mesh {
  // Cut big faces into ~30 cm cells: affine texture mapping (as on the PS1) only stays straight on small triangles.
  const seg = (v: number) => Math.min(16, Math.max(1, Math.ceil(v / CELL)));
  const g = new THREE.BoxGeometry(w, h, d, seg(w), seg(h), seg(d));
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nrm = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i));
    const px = pos.getX(i) + x, py = pos.getY(i) + y, pz = pos.getZ(i) + z;
    let u: number, v: number;
    if (nx > 0.5) [u, v] = [pz, py];
    else if (ny > 0.5) [u, v] = [px, pz];
    else [u, v] = [px, py];
    uv.setXY(i, u / tile, v / tile);
  }
  return mesh(g, m, x, y, z, shadow);
}

/** Stretch a plane's 0..1 UVs so its texture repeats every `tile` metres. */
function tileUV(g: THREE.BufferGeometry, w: number, h: number, tile: number): THREE.BufferGeometry {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / tile, (uv.getY(i) * h) / tile);
  return g;
}

function tag(o: THREE.Object3D, pick: string): THREE.Object3D {
  o.traverse((c) => (c.userData.pick = pick));
  return o;
}

/** Face an object toward the eye (around y only). */
function faceEye(o: THREE.Object3D): void {
  o.rotation.y = Math.atan2(-o.position.x, -o.position.z) + Math.PI;
}

/** A hooded figure: low poly, faceless, the way people look against the snow. */
export function figure(look: CustomerLook, mats: { skin: THREE.Material }): THREE.Group {
  const g = new THREE.Group();
  const cloak = lambert({ color: look.cloak });
  const hood = lambert({ color: look.hood });
  const h = look.height;
  g.add(mesh(new THREE.CylinderGeometry(0.13, 0.25, h * 0.82, 6), cloak, 0, h * 0.41, 0));
  g.add(mesh(new THREE.SphereGeometry(0.1, 6, 4), mats.skin, 0, h * 0.88, 0.0));
  if (look.hat === 'hood') g.add(mesh(new THREE.ConeGeometry(0.15, 0.32, 6), hood, 0, h * 0.92, -0.02));
  else if (look.hat === 'helmet') {
    g.add(mesh(new THREE.SphereGeometry(0.115, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2), hood, 0, h * 0.9, 0));
    g.add(mesh(new THREE.ConeGeometry(0.02, 0.08, 4), hood, 0, h * 0.97, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.015, 0.015, h * 1.1, 4), lambert({ color: '#2a2622' }), 0.22, h * 0.55, 0));
  } else g.add(mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.05, 6), hood, 0, h * 0.95, 0));
  g.add(mesh(new THREE.BoxGeometry(0.44, 0.12, 0.2), hood, 0, h * 0.74, 0));
  g.add(mesh(new THREE.BoxGeometry(0.16, 0.12, 0.14), lambert({ color: '#2e2c2a' }), 0.2, h * 0.45, 0.06));
  return g;
}

export function buildWorkshop(tx: Textures, data: GameData, signText: string): Workshop {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#000000');
  const pick: THREE.Object3D[] = [];

  const stone = lambert({ map: tx.stone, color: '#c4c8d0' });
  const floorM = lambert({ map: tx.floor, color: '#8a8682' });
  const wood = lambert({ map: tx.wood, color: '#c8b8a4' });
  const woodD = lambert({ map: tx.woodDark, color: '#b0a294' });
  const iron = lambert({ map: tx.iron, color: '#a8a4a0' });
  const rustM = lambert({ map: tx.plate, color: '#d0b8a8' });
  const dark = lambert({ color: '#1a1918' });
  const copper = lambert({ color: P.copper });
  const skinM = lambert({ color: '#6a5446' });
  const paper = lambert({ map: tx.paper, color: '#e0d4b8' });
  const snowM = lambert({ color: '#5a6478' });
  const glassM = lambert({ color: P.glassGreen });
  const leather = lambert({ map: tx.leather, color: '#c8b8a0' });

  // --- Room: a stone workshop about 4.4 x 3.6 m; the bench stands against the north wall ------
  const RX = 2.2; // inner faces of the side walls at x = ±RX
  const FZ = 2.4; // inner face of the wall behind the bench
  const FW = 2 * RX + 0.5, FD = FZ - BACK_Z + 0.5;
  const floor = mesh(tileUV(new THREE.PlaneGeometry(FW, FD, Math.ceil(FW / CELL), Math.ceil(FD / CELL)), FW, FD, 1.2), floorM, 0, 0, (FZ + BACK_Z) / 2);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const ceil = mesh(tileUV(new THREE.PlaneGeometry(FW, FD, Math.ceil(FW / CELL), Math.ceil(FD / CELL)), FW, FD, 0.6), woodD, 0, 2.5, (FZ + BACK_Z) / 2);
  ceil.rotation.x = Math.PI / 2;
  scene.add(ceil);
  // North wall (in front of the bench) with a window hole (x -1.02..-0.48, y 1.0..1.75).
  const wall = (x0: number, x1: number, y0: number, y1: number) => scene.add(texBox(x1 - x0, y1 - y0, 0.24, stone, (x0 + x1) / 2, (y0 + y1) / 2, BACK_Z - 0.12, 0.9));
  wall(-RX - 0.24, -1.02, 0, 2.5);
  wall(-1.02, -0.48, 0, 1.0);
  wall(-1.02, -0.48, 1.75, 2.5);
  wall(-0.48, RX + 0.24, 0, 2.5);
  // West wall with a window onto the river (z -0.62..0.02, y 1.0..1.7).
  const wwall = (z0: number, z1: number, y0: number, y1: number) => scene.add(texBox(0.24, y1 - y0, z1 - z0, stone, -RX - 0.12, (y0 + y1) / 2, (z0 + z1) / 2, 0.9));
  wwall(BACK_Z, -0.62, 0, 2.5);
  wwall(-0.62, 0.02, 0, 1.0);
  wwall(-0.62, 0.02, 1.7, 2.5);
  wwall(0.02, FZ, 0, 2.5);
  scene.add(texBox(0.3, 0.08, 0.7, woodD, -RX + 0.02, 0.97, -0.3, 0.4));
  scene.add(boxAt(0.05, 0.7, 0.035, woodD, -RX - 0.1, 1.35, -0.3));
  scene.add(boxAt(0.05, 0.035, 0.64, woodD, -RX - 0.1, 1.35, -0.3));
  // East wall with the door (z 0.25..1.1).
  const ewall = (z0: number, z1: number, y0: number, y1: number) => scene.add(texBox(0.24, y1 - y0, z1 - z0, stone, RX + 0.12, (y0 + y1) / 2, (z0 + z1) / 2, 0.9));
  ewall(BACK_Z, 0.25, 0, 2.5);
  ewall(0.25, 1.1, 1.95, 2.5);
  ewall(1.1, FZ, 0, 2.5);
  scene.add(texBox(0.3, 1.95, 0.08, woodD, RX, 0.975, 0.25, 0.4));
  scene.add(texBox(0.3, 1.95, 0.08, woodD, RX, 0.975, 1.1, 0.4));
  scene.add(texBox(0.3, 0.1, 0.93, woodD, RX, 1.98, 0.675, 0.4));
  // South wall behind you.
  scene.add(texBox(2 * RX + 0.48, 2.5, 0.24, stone, 0, 1.25, FZ + 0.12, 0.9));
  for (const x of [-RX + 0.06, RX - 0.06]) for (const z of [BACK_Z + 0.06, FZ - 0.06]) scene.add(texBox(0.14, 2.5, 0.14, woodD, x, 1.25, z, 0.5));
  // Timber: posts and a beam across the wall, ceiling joists.
  for (const x of [-1.1, -0.48, 1.3]) scene.add(texBox(0.12, 2.5, 0.12, woodD, x, 1.25, BACK_Z + 0.04, 0.5));
  scene.add(texBox(4.4, 0.14, 0.14, woodD, 0, 1.6, BACK_Z + 0.05, 0.5));
  for (const x of [-1.6, -0.5, 0.6, 1.7]) scene.add(texBox(0.14, 0.16, 3.6, woodD, x, 2.4, 0.62, 0.5));
  // Window frame, bars, snow on the sill.
  scene.add(texBox(0.64, 0.08, 0.3, woodD, -0.75, 0.97, BACK_Z - 0.05, 0.4));
  // Tool rail: what a welder keeps within reach.
  scene.add(texBox(0.24, 0.04, 0.03, woodD, -0.16, 1.24, BACK_Z + 0.03, 0.3));
  const hang = (o: THREE.Object3D, x: number) => {
    o.position.set(x, 1.22, BACK_Z + 0.05);
    scene.add(o);
    scene.add(boxAt(0.008, 0.008, 0.03, dark, x, 1.235, BACK_Z + 0.04));
  };
  {
    const tongs = new THREE.Group();
    for (const s of [-1, 1]) {
      const b = boxAt(0.007, 0.22, 0.006, iron, s * 0.008, -0.11, 0, true);
      b.rotation.z = s * 0.05;
      tongs.add(b);
    }
    hang(tongs, -0.25);
    const file = new THREE.Group();
    file.add(boxAt(0.012, 0.16, 0.004, iron, 0, -0.1, 0, true));
    file.add(boxAt(0.016, 0.06, 0.012, wood, 0, -0.01, 0, true));
    hang(file, -0.2);
    const ham = new THREE.Group();
    ham.add(boxAt(0.012, 0.2, 0.012, wood, 0, -0.1, 0, true));
    ham.add(boxAt(0.07, 0.022, 0.022, iron, 0.0, -0.2, 0, true));
    hang(ham, -0.145);
    const coil = new THREE.Group();
    const cc = mesh(new THREE.TorusGeometry(0.045, 0.01, 4, 10), copper, 0, -0.06, 0, true);
    coil.add(cc);
    hang(coil, -0.08);
    const brush = new THREE.Group();
    brush.add(boxAt(0.012, 0.15, 0.01, wood, 0, -0.075, 0, true));
    brush.add(boxAt(0.03, 0.045, 0.016, dark, 0, -0.17, 0.004, true));
  }
  // A notice nailed by the window, and a few hooks with scrap wire.
  scene.add(mesh(new THREE.PlaneGeometry(0.09, 0.12), paper, -0.41, 1.04, BACK_Z + 0.015));
  scene.add(texBox(0.64, 0.08, 0.3, woodD, -0.75, 1.78, BACK_Z - 0.08, 0.4));
  scene.add(boxAt(0.035, 0.75, 0.05, woodD, -0.75, 1.375, BACK_Z - 0.14));
  for (const y of [1.25, 1.5]) scene.add(boxAt(0.54, 0.035, 0.05, woodD, -0.75, y, BACK_Z - 0.14));
  scene.add(boxAt(0.54, 0.02, 0.12, snowM, -0.75, 1.02, BACK_Z - 0.18));
  // The door, swung inward against the wall, onto the snow.
  const doorLeaf = new THREE.Group();
  doorLeaf.add(mesh(new THREE.BoxGeometry(0.05, 1.92, 0.84), lambert({ map: doorTex(), color: '#b8a898' }), 0, 0.96, -0.42));
  doorLeaf.add(mesh(new THREE.TorusGeometry(0.05, 0.008, 4, 10), iron, -0.03, 1.0, -0.75));
  doorLeaf.position.set(RX + 0.12, 0, 1.08);
  doorLeaf.rotation.y = -1.3;
  tag(doorLeaf, 'door');
  scene.add(doorLeaf);
  pick.push(doorLeaf);

  // --- Outside ------------------------------------------------------------------------
  const skyM = new THREE.MeshBasicMaterial({ map: tx.sky, depthWrite: false });
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(90, 40), skyM);
  sky.position.set(0, 12, -40);
  scene.add(sky);
  const skyR = new THREE.Mesh(new THREE.PlaneGeometry(90, 40), skyM);
  skyR.position.set(40, 12, 0);
  skyR.rotation.y = -Math.PI / 2;
  scene.add(skyR);
  const skyL = new THREE.Mesh(new THREE.PlaneGeometry(90, 40), skyM);
  skyL.position.set(-40, 12, 0);
  skyL.rotation.y = Math.PI / 2;
  scene.add(skyL);
  const far: THREE.MeshBasicMaterial[] = [];
  const silo = (color: string) => {
    const m = new THREE.MeshBasicMaterial({ color });
    m.userData.base = m.color.clone();
    far.push(m);
    return m;
  };
  const hills = silo(P.hills);
  for (let i = 0; i < 9; i++) scene.add(mesh(new THREE.ConeGeometry(4 + (i % 3) * 2, 2.5 + (i % 4), 5), hills, -22 + i * 5.5, 0.6, -30 + (i % 2) * 3));
  const cw = silo(P.cityWall);
  scene.add(boxAt(60, 3.2, 1, cw, 0, 1.4, -15));
  for (let i = -6; i <= 6; i++) {
    scene.add(boxAt(0.5, 0.5, 1, cw, i * 2.1, 3.2, -15));
    if (i % 3 === 0) {
      scene.add(boxAt(1.8, 5.2, 1.8, cw, i * 2.1 + 0.4, 2.6, -15.4));
      scene.add(mesh(new THREE.ConeGeometry(1.4, 1.6, 4), cw, i * 2.1 + 0.4, 6, -15.4));
    }
  }
  const ember = silo('#4a2a14');
  for (let i = 0; i < 6; i++) scene.add(boxAt(0.25, 0.3, 0.05, ember, -8 + i * 3.1, 2.2 + (i % 2) * 1.2, -14.4));
  const ground = mesh(new THREE.PlaneGeometry(90, 60), snowM, 0, -0.02, -20);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const river = mesh(new THREE.PlaneGeometry(60, 1.6), new THREE.MeshLambertMaterial({ color: P.water }), 0, -0.15, -3.2);
  river.rotation.x = -Math.PI / 2;
  scene.add(river);
  const river2 = mesh(new THREE.PlaneGeometry(1.6, 12), new THREE.MeshLambertMaterial({ color: P.water }), -4.0, -0.15, 1.5);
  river2.rotation.x = -Math.PI / 2;
  scene.add(river2);
  // Water wheels with dynamos, seen through the window; the second one appears when bought.
  const makeWheel = (r: number) => {
    const g = new THREE.Group();
    const rot = new THREE.Group();
    rot.add(new THREE.Mesh(new THREE.TorusGeometry(r, 0.04, 4, 16), woodD));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const spoke = boxAt(0.05, r * 2, 0.05, woodD, 0, 0, 0);
      spoke.rotation.z = a;
      rot.add(spoke);
      const pad = boxAt(0.24, 0.05, 0.3, wood, Math.cos(a) * r, Math.sin(a) * r, 0);
      pad.rotation.z = a;
      rot.add(pad);
    }
    g.add(rot);
    g.add(boxAt(0.3, 0.3, 0.3, copper, 0, 0, 0.3));
    g.userData.rot = rot;
    return g;
  };
  const w1 = makeWheel(0.75);
  w1.position.set(-2.1, 0.55, -3.0);
  w1.rotation.y = 0.35;
  scene.add(w1);
  const w2 = makeWheel(0.62);
  w2.position.set(-0.5, 0.45, -3.4);
  w2.visible = false;
  scene.add(w2);
  const NS = 800;
  const sp = new Float32Array(NS * 3);
  const sv = new Float32Array(NS);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < NS; i++) {
    sp[i * 3] = -4 + rnd() * 6;
    sp[i * 3 + 1] = rnd() * 3.6;
    sp[i * 3 + 2] = -1.25 - rnd() * 5;
    sv[i] = 0.25 + rnd() * 0.35;
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3).setUsage(THREE.DynamicDrawUsage));
  const snow = new THREE.Points(sg, new THREE.PointsMaterial({ color: P.snow, size: 1.5, sizeAttenuation: false }));
  snow.frustumCulled = false;
  scene.add(snow);
  // People waiting in the snow beyond the window; the one whose job is on the bench stands close and looks in.
  const looks = Object.values(data.customers);
  const queue: THREE.Group[] = [];
  for (let k = 0; k < 7; k++) {
    const f = figure(looks[(k * 3 + 1) % looks.length].look, { skin: skinM });
    if (k < 4) {
      f.position.set(-1.0 - 0.32 * k, 0, -2.1 - 0.5 * k);
      f.rotation.y = 0.3 + (k % 2) * 0.4;
    } else {
      f.position.set(3.0 + (k - 4) * 0.55, 0, 0.5 + (k - 4) * 0.45);
      f.rotation.y = -Math.PI / 2 + (k % 2) * 0.3;
    }
    f.visible = false;
    scene.add(f);
    queue.push(f);
  }
  const customer = figure(looks[0].look, { skin: skinM });
  customer.position.set(-0.72, 0, -1.55);
  customer.visible = false;
  tag(customer, 'door');
  scene.add(customer);
  pick.push(customer);

  // --- Bench ------------------------------------------------------------------------
  const bench = new THREE.Group();
  bench.add(texBox(2.3, 0.07, 0.88, wood, 0, TABLE - 0.035, -0.72, 0.4));
  bench.add(texBox(2.3, 0.012, 0.045, rustM, 0, TABLE + 0.002, -0.305, 0.25, true));
  bench.add(texBox(2.3, 0.14, 0.05, woodD, 0, TABLE - 0.12, -0.3, 0.4));
  for (const x of [-1.05, 1.05]) bench.add(texBox(0.1, TABLE - 0.07, 0.1, woodD, x, (TABLE - 0.07) / 2, -0.4, 0.5));
  bench.add(texBox(0.8, 0.008, 0.54, lambert({ map: tx.steel, color: '#a8a4a0' }), 0, TABLE + 0.002, -0.68, 0.25));
  tag(bench, 'bench');
  scene.add(bench);
  pick.push(bench);
  const floorAt = (x: number, z: number) => (Math.abs(x) < 1.15 && z < -0.28 && z > -1.16 ? TABLE : 0);

  // C-clamp gripping the front edge on the right.
  const clamp = new THREE.Group();
  clamp.add(boxAt(0.03, 0.2, 0.028, rustM, 0, -0.06, 0.05, true));
  clamp.add(boxAt(0.03, 0.028, 0.1, rustM, 0, 0.03, 0.01, true));
  clamp.add(boxAt(0.03, 0.028, 0.1, rustM, 0, -0.15, 0.01, true));
  clamp.add(mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.11, 5), iron, 0, -0.1, -0.02, true));
  clamp.position.set(0.42, TABLE, -0.29);
  scene.add(clamp);

  // Clay pot of coins, the money painted on its belly.
  const pot = new THREE.Group();
  const prof = [[0.06, 0], [0.095, 0.025], [0.115, 0.085], [0.1, 0.155], [0.08, 0.185], [0.09, 0.2]].map(([r, y]) => new THREE.Vector2(r, y));
  pot.add(mesh(new THREE.LatheGeometry(prof, 9), lambert({ map: clayTex(), color: '#d0b8a8' }), 0, 0, 0, true));
  const gold = lambert({ color: '#c8a038', emissive: '#2a1a00' });
  pot.add(mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.025, 9), gold, 0, 0.19, 0));
  for (let i = 0; i < 7; i++) {
    const c = mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.007, 8), gold, Math.cos(i * 2.1) * 0.045, 0.208 + (i % 3) * 0.008, Math.sin(i * 2.1) * 0.045);
    c.rotation.set(Math.sin(i) * 0.5, 0, Math.cos(i * 1.7) * 0.5);
    pot.add(c);
  }
  const money = dynTex(48, 32);
  pot.add(mesh(new THREE.PlaneGeometry(0.17, 0.113), new THREE.MeshLambertMaterial({ map: money.tex, transparent: true, alphaTest: 0.5 }), 0, 0.09, 0.117));
  pot.position.set(-0.5, TABLE, -1.0);
  faceEye(pot);
  scene.add(pot);
  const setMoney = (n: number) => {
    const x = money.ctx;
    x.clearRect(0, 0, 48, 32);
    const s = n >= 1000 ? `${Math.floor(n / 1000)},${String(n % 1000).padStart(3, '0')}` : String(n);
    const digits = s.replace(',', '');
    const k = digits.length > 3 ? 2 : 3;
    const w = digits.length * 4 * k - k + (s.includes(',') ? 3 : 0);
    let x0 = 24 - w / 2;
    for (const ch of s) {
      if (ch === ',') {
        x.fillStyle = '#e8e0cc';
        x.fillRect(x0, 11 + 2 * k, 2, 3);
        x0 += 3;
        continue;
      }
      pixDigits(x, ch, x0 + 1.5 * k, 11, k, '#e8e0cc');
      x0 += 4 * k;
    }
    x.fillStyle = '#e8e0cc';
    x.fillRect(19, 22, 10, 1);
    x.fillRect(19, 30, 10, 1);
    x.fillRect(18, 23, 1, 7);
    x.fillRect(29, 23, 1, 7);
    x.fillRect(22, 25, 4, 1);
    x.fillRect(22, 28, 4, 1);
    x.fillRect(21, 25, 1, 4);
    money.flush();
  };

  // Tin can of rods, the count painted on it.
  const ebox = new THREE.Group();
  ebox.add(mesh(new THREE.CylinderGeometry(0.055, 0.052, 0.15, 9, 1, true), lambert({ map: tx.plate, color: '#c8c0b8', side: THREE.DoubleSide }), 0, 0.075, 0, true));
  ebox.add(mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.01, 9), dark, 0, 0.005, 0));
  for (let i = 0; i < 12; i++) {
    const rod = boxAt(0.005, 0.32, 0.005, i % 3 ? lambert({ color: '#8a8478' }) : iron, Math.cos(i * 2.4) * 0.03, 0.18, Math.sin(i * 2.4) * 0.03, true);
    rod.rotation.set(Math.sin(i) * 0.15, 0, Math.cos(i * 1.3) * 0.15);
    ebox.add(rod);
  }
  const rods = dynTex(24, 16);
  ebox.add(mesh(new THREE.PlaneGeometry(0.08, 0.053), new THREE.MeshLambertMaterial({ map: rods.tex, transparent: true, alphaTest: 0.5 }), 0, 0.075, 0.056));
  ebox.position.set(-0.12, TABLE, -1.06);
  faceEye(ebox);
  tag(ebox, 'electrodes');
  scene.add(ebox);
  pick.push(ebox);
  const setRods = (n: number) => {
    rods.ctx.clearRect(0, 0, 24, 16);
    pixDigits(rods.ctx, String(n), 12, 8, 3, '#e8e0cc');
    rods.flush();
  };

  // Welding mask on a painted post at the back corner: the arrow and the mask say SPACE lowers it.
  const maskG = new THREE.Group();
  maskG.add(mesh(new THREE.BoxGeometry(0.07, 0.34, 0.07), lambert({ map: postTex(), color: '#d8ccbc' }), 0, 0.17, 0));
  const helmet = new THREE.Group();
  const shell = lambert({ map: tx.plate, color: '#b89880' });
  helmet.add(mesh(new THREE.BoxGeometry(0.2, 0.24, 0.16), shell, 0, 0, 0, true));
  helmet.add(mesh(new THREE.BoxGeometry(0.17, 0.08, 0.08), shell, 0, 0.14, -0.02, true));
  helmet.add(mesh(new THREE.BoxGeometry(0.12, 0.045, 0.02), lambert({ color: '#0c140e' }), 0, 0.03, 0.085));
  helmet.add(mesh(new THREE.BoxGeometry(0.15, 0.08, 0.02), dark, 0, 0.03, 0.078));
  helmet.add(mesh(new THREE.BoxGeometry(0.23, 0.025, 0.025), iron, 0, 0.03, 0));
  helmet.position.set(0, 0.44, 0);
  helmet.rotation.x = -0.08;
  maskG.add(helmet);
  maskG.position.set(-0.86, TABLE, -0.98);
  faceEye(maskG);
  scene.add(maskG);

  // Heap of jobs waiting (left) and the stack of mended work (right), like dirty and clean plates.
  const heap = new THREE.Group();
  const scrap: THREE.Object3D[] = [];
  let ss = 99;
  const sr = () => (ss = (ss * 48271) % 2147483647) / 2147483647;
  for (let i = 0; i < 9; i++) {
    const kind = i % 3;
    const m = i % 2 ? iron : rustM;
    const o =
      kind === 0
        ? boxAt(0.18 + sr() * 0.08, 0.012, 0.12 + sr() * 0.06, m, 0, 0, 0, true)
        : kind === 1
          ? mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.22, 6), m, 0, 0, 0, true)
          : boxAt(0.2, 0.025, 0.025, m, 0, 0, 0, true);
    if (kind === 1) o.rotation.z = Math.PI / 2;
    o.position.set((sr() - 0.5) * 0.2, 0.1 + i * 0.018, (sr() - 0.5) * 0.14);
    o.rotation.set((sr() - 0.5) * 0.6, sr() * 3, (sr() - 0.5) * 0.6);
    heap.add(o);
    scrap.push(o);
  }
  // A low crate the scrap leans in.
  heap.add(texBox(0.36, 0.12, 0.28, wood, 0, 0.06, 0, 0.25, true));
  heap.add(texBox(0.38, 0.03, 0.03, woodD, 0, 0.11, 0.14, 0.25));
  heap.add(texBox(0.38, 0.03, 0.03, woodD, 0, 0.11, -0.14, 0.25));
  heap.position.set(-0.6, TABLE, -0.66);
  tag(heap, 'pile');
  scene.add(heap);
  pick.push(heap);
  const pileSlot = new THREE.Group();
  pileSlot.position.set(-0.6, TABLE + 0.14, -0.66);
  pileSlot.rotation.y = 0.25;
  scene.add(pileSlot);
  const doneStack = new THREE.Group();
  const done: THREE.Object3D[] = [];
  for (let i = 0; i < 12; i++) {
    const o = boxAt(0.22, 0.016, 0.16, i % 2 ? rustM : iron, (sr() - 0.5) * 0.02, 0.01 + i * 0.018, (sr() - 0.5) * 0.02, true);
    o.rotation.y = (sr() - 0.5) * 0.3;
    // A bright bead across each mended piece.
    o.add(boxAt(0.012, 0.006, 0.15, lambert({ color: '#8a8c92' }), 0.02, 0.011, 0));
    o.visible = false;
    doneStack.add(o);
    done.push(o);
  }
  doneStack.position.set(0.6, TABLE, -0.66);
  tag(doneStack, 'done');
  scene.add(doneStack);
  pick.push(doneStack);
  const setPiles = (waiting: number, nDone: number) => {
    scrap.forEach((o, i) => (o.visible = i < Math.min(scrap.length, waiting * 2 + 1)));
    done.forEach((o, i) => (o.visible = i < Math.min(done.length, nDone)));
  };
  // Chipping hammer lying on the bench when it isn't in the hand.
  const restHammer = new THREE.Group();
  restHammer.add(boxAt(0.065, 0.016, 0.016, iron, 0, 0.008, 0, true));
  restHammer.add(boxAt(0.012, 0.012, 0.2, lambert({ map: tx.wood, color: '#d8c8b0' }), 0.01, 0.006, 0.1, true));
  restHammer.position.set(0.36, TABLE, -0.42);
  restHammer.rotation.y = -0.6;
  scene.add(restHammer);
  // Bench vise bolted at the back right, an oil can beside it.
  const vise = new THREE.Group();
  vise.add(boxAt(0.14, 0.05, 0.1, rustM, 0, 0.025, 0, true));
  vise.add(boxAt(0.05, 0.09, 0.08, iron, -0.045, 0.095, 0, true));
  vise.add(boxAt(0.05, 0.09, 0.08, iron, 0.045, 0.095, 0, true));
  const screw = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 5), iron, 0.13, 0.09, 0, true);
  screw.rotation.z = Math.PI / 2;
  vise.add(screw);
  vise.add(boxAt(0.012, 0.012, 0.1, iron, 0.2, 0.09, 0, true));
  vise.position.set(0.6, TABLE, -1.0);
  vise.rotation.y = -0.3;
  scene.add(vise);
  const oil = new THREE.Group();
  oil.add(mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.06, 8), lambert({ color: '#5a4a2c' }), 0, 0.03, 0, true));
  const spout = mesh(new THREE.CylinderGeometry(0.004, 0.008, 0.12, 5), iron, 0.03, 0.1, 0, true);
  spout.rotation.z = -0.6;
  oil.add(spout);
  oil.position.set(0.82, TABLE, -0.92);
  scene.add(oil);
  // Nuts and bolts scattered by the job.
  for (let i = 0; i < 7; i++) {
    const n = mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.007, 6), iron, -0.35 + (i * 0.37) % 0.9, TABLE + 0.004, -0.36 - (i % 3) * 0.05, true);
    scene.add(n);
  }

  // Barrel by the door.
  const barrel = new THREE.Group();
  barrel.add(mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.9, 10), lambert({ map: barrelTex(), color: '#c0b0a0' }), 0, 0.45, 0, true));
  barrel.add(mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.02, 10), woodD, 0, 0.9, 0));
  barrel.position.set(1.85, 0, -0.72);
  scene.add(barrel);

  /** Interactables get their own copies of materials so they can glow faintly when they are the next step. */
  const hiMats: Record<string, THREE.MeshLambertMaterial[]> = {};
  const glowable = (id: string, o: THREE.Object3D) => {
    const list: THREE.MeshLambertMaterial[] = (hiMats[id] = []);
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh || !(m.material as THREE.MeshLambertMaterial).isMeshLambertMaterial) return;
      const cl = (m.material as THREE.MeshLambertMaterial).clone();
      m.material = cl;
      list.push(cl);
    });
  };

  // --- The wall in front: chalk tally, ammeter, shelf with tags ------------------------
  // Chalkboard hung on a rope: a part, an arrow, a stack of mended work, and done / waiting.
  const board = new THREE.Group();
  const chalk = dynTex(48, 64);
  board.add(texBox(0.25, 0.32, 0.02, woodD, 0, 0, 0, 0.3));
  board.add(mesh(new THREE.PlaneGeometry(0.22, 0.29), new THREE.MeshLambertMaterial({ map: chalk.tex, color: '#ffffff' }), 0, 0, 0.012));
  for (const s of [-1, 1]) {
    const rope = boxAt(0.005, 0.14, 0.005, lambert({ color: '#8a7a5a' }), s * 0.06, 0.21, 0.0);
    rope.rotation.z = -s * 0.6;
    board.add(rope);
  }
  const boardTags: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i++) {
    const t = mesh(new THREE.PlaneGeometry(0.036, 0.044), paper, -0.09 + i * 0.036, -0.15, 0.016);
    t.rotation.z = ((i * 37) % 7 - 3) * 0.05;
    t.visible = false;
    board.add(t);
    boardTags.push(t);
  }
  board.position.set(-0.34, 1.13, BACK_Z + 0.02);
  board.rotation.z = -0.03;
  tag(board, 'board');
  scene.add(board);
  pick.push(board);
  const setOrders = (nDone: number, waiting: number) => {
    const x = chalk.ctx;
    x.fillStyle = '#1e2422';
    x.fillRect(0, 0, 48, 64);
    x.globalAlpha = 0.18;
    x.fillStyle = '#c8ccc4';
    for (let i = 0; i < 12; i++) x.fillRect((i * 13) % 44, (i * 29) % 60, 6 + (i % 3) * 4, 1);
    x.globalAlpha = 1;
    const ink = '#d8dcd4';
    x.fillStyle = ink;
    x.fillRect(4, 8, 14, 1);
    x.fillRect(4, 22, 14, 1);
    x.fillRect(4, 8, 1, 15);
    x.fillRect(17, 8, 1, 15);
    x.fillRect(7, 15, 3, 1);
    x.fillRect(10, 13, 1, 3);
    x.fillRect(11, 13, 3, 1);
    x.fillRect(21, 15, 7, 1);
    x.fillRect(26, 13, 1, 5);
    x.fillRect(27, 14, 1, 3);
    for (let i = 0; i < 3; i++) {
      x.fillRect(31, 10 + i * 4, 12, 1);
      x.fillRect(31, 13 + i * 4, 12, 1);
      x.fillRect(31, 10 + i * 4, 1, 3);
      x.fillRect(42, 10 + i * 4, 1, 3);
    }
    pixDigits(x, String(nDone).padStart(2, '0'), 12, 40, 2, ink);
    x.fillRect(22, 36, 1, 9);
    pixDigits(x, String(waiting).padStart(2, '0'), 33, 40, 2, ink);
    x.fillRect(19, 52, 10, 1);
    x.fillRect(19, 61, 10, 1);
    x.fillRect(18, 53, 1, 8);
    x.fillRect(29, 53, 1, 8);
    chalk.flush();
  };

  // Ammeter on the wall: the needle and the number follow the river's current.
  const gauge = new THREE.Group();
  gauge.add(texBox(0.34, 0.27, 0.016, rustM, 0, 0, -0.012, 0.2));
  gauge.add(mesh(new THREE.PlaneGeometry(0.28, 0.175), new THREE.MeshLambertMaterial({ map: bigDialTex(), color: '#ffffff', emissive: '#141210' }), 0, 0.03, 0.022));
  const needle = new THREE.Group();
  needle.add(boxAt(0.007, 0.11, 0.005, dark, 0, 0.055, 0));
  needle.position.set(0, -0.05, 0.028);
  gauge.add(needle);
  const gCount = counterTex();
  gauge.add(mesh(new THREE.PlaneGeometry(0.2, 0.07), new THREE.MeshBasicMaterial({ map: gCount.tex, color: '#ffffff' }), 0, -0.1, 0.022));
  for (const [x, y] of [[-0.15, 0.115], [0.15, 0.115], [-0.15, -0.115], [0.15, -0.115]]) gauge.add(boxAt(0.016, 0.016, 0.01, dark, x, y, 0.024));
  gauge.position.set(0.12, 1.12, BACK_Z + 0.03);
  gauge.scale.setScalar(0.92);

  scene.add(gauge);
  let gShown = -1;
  const setGauge = (I: number) => {
    const f = Math.max(0, Math.min(1.5, I)) / 1.5;
    needle.rotation.z = Math.PI / 2 - f * Math.PI;
    const a = Math.round(I * 110);
    if (a !== gShown) {
      gShown = a;
      gCount.redraw(String(a).padStart(3, '0'));
    }
  };
  // Copper wiring: window → ammeter → shelf.
  const wire = (a: THREE.Vector3, b: THREE.Vector3) => {
    const len = a.distanceTo(b);
    const w = boxAt(0.01, len, 0.01, copper, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    w.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    scene.add(w);
  };
  const wz = BACK_Z + 0.015;
  wire(new THREE.Vector3(-0.46, 1.36, wz), new THREE.Vector3(0.07, 1.36, wz));
  wire(new THREE.Vector3(0.07, 1.36, wz), new THREE.Vector3(0.11, 1.24, wz));
  wire(new THREE.Vector3(0.28, 1.2, wz), new THREE.Vector3(0.37, 1.32, wz));
  wire(new THREE.Vector3(0.37, 1.32, wz), new THREE.Vector3(1.2, 1.32, wz));
  wire(new THREE.Vector3(0.26, 1.04, wz), new THREE.Vector3(0.28, 0.92, wz));

  // Shelf of things for sale; a paper tag with the price hangs under each one.
  const SHELF_Y = 1.03;
  scene.add(texBox(0.5, 0.03, 0.2, wood, 0.58, SHELF_Y, BACK_Z + 0.1, 0.3));
  for (const x of [0.35, 0.81]) scene.add(texBox(0.03, 0.1, 0.16, woodD, x, SHELF_Y - 0.06, BACK_Z + 0.08, 0.3));
  const signMat = new THREE.MeshLambertMaterial({ map: signTex(signText), color: '#d0c8b8' });
  const sign = mesh(new THREE.PlaneGeometry(0.3, 0.066), signMat, 0.58, 1.24, BACK_Z + 0.03);
  scene.add(sign);
  for (const x of [0.48, 0.68]) scene.add(boxAt(0.004, 0.08, 0.004, dark, x, 1.3, BACK_Z + 0.03));
  const shelfItems: Record<string, THREE.Object3D> = {};
  const ownedItems: Record<string, THREE.Object3D> = {};
  const battery = (lit: boolean) => {
    const g = new THREE.Group();
    const face = lambert({ map: batteryTex(), color: '#ffffff', emissive: lit ? '#0a0a04' : '#000000' });
    const body = lambert({ color: '#4a4c50' });
    g.add(mesh(new THREE.BoxGeometry(0.1, 0.065, 0.06), [body, body, body, body, face, body], 0, 0.0325, 0, true));
    for (const x of [-0.03, 0.03]) g.add(mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.012, 6), x < 0 ? copper : dark, x, 0.07, 0));
    return g;
  };
  const models: Record<string, () => THREE.Object3D> = {
    rods: () => {
      const g = new THREE.Group();
      for (let i = 0; i < 9; i++) g.add(boxAt(0.005, 0.005, 0.12, lambert({ color: '#8a7a5a' }), (i % 3) * 0.007 - 0.007, 0.003 + Math.floor(i / 3) * 0.006, 0));
      g.add(boxAt(0.03, 0.02, 0.012, copper, 0, 0.008, 0));
      g.rotation.y = 0.5;
      return g;
    },
    glass: () => {
      const g = new THREE.Group();
      const gl = boxAt(0.08, 0.05, 0.008, glassM, 0, 0.03, 0);
      gl.rotation.x = -0.2;
      g.add(gl);
      g.add(boxAt(0.085, 0.008, 0.012, dark, 0, 0.056, 0.005));
      return g;
    },
    jar: () => battery(true),
    cable: () => {
      const g = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const t = mesh(new THREE.TorusGeometry(0.035 - i * 0.004, 0.008, 4, 10), copper, 0, 0.02 + i * 0.008, 0);
        t.rotation.x = Math.PI / 2;
        g.add(t);
      }
      return g;
    },
    apron: () => {
      const g = new THREE.Group();
      const a = boxAt(0.08, 0.11, 0.008, leather, 0, 0.055, 0);
      a.rotation.x = -0.12;
      g.add(a);
      return g;
    },
    wheel: () => {
      const g = new THREE.Group();
      const drum = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.07, 8), copper, 0, 0.04, 0, true);
      drum.rotation.z = Math.PI / 2;
      g.add(drum);
      for (const x of [-0.04, 0.04]) g.add(boxAt(0.012, 0.07, 0.06, iron, x, 0.035, 0));
      const pul = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.012, 8), dark, 0.055, 0.04, 0);
      pul.rotation.z = Math.PI / 2;
      g.add(pul);
      g.add(boxAt(0.1, 0.008, 0.065, iron, 0, 0.004, 0));
      return g;
    },
  };
  for (const u of data.upgrades) {
    const o = (models[u.model] ?? models.rods)();
    o.position.set(0.37 + u.slot * 0.084, SHELF_Y + 0.016, BACK_Z + 0.11);
    o.scale.setScalar(0.8);
    const tg = new THREE.Group();
    const t = mesh(new THREE.PlaneGeometry(0.075, 0.044), new THREE.MeshLambertMaterial({ map: priceTag(u.cost), color: '#e8dcc0' }), 0, -0.085, 0.1);
    t.rotation.z = Math.PI / 2 + (u.slot % 2 ? 0.12 : -0.1);
    tg.add(t);
    tg.add(boxAt(0.0015, 0.045, 0.0015, lambert({ color: '#8a7a5a' }), 0, -0.04, 0.1));
    o.add(tg);
    tag(o, 'shelf:' + u.id);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.2), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(0, -0.01, 0.04);
    hit.userData.pick = 'shelf:' + u.id;
    o.add(hit);
    o.visible = false;
    scene.add(o);
    shelfItems[u.id] = o;
    pick.push(o);
    glowable('shelf:' + u.id, o);
  }
  // Bought things live on the bench: the battery by the can, the thick cable to the holder.
  const ownedJar = battery(true);
  ownedJar.position.set(0.3, TABLE, -1.04);
  ownedJar.scale.setScalar(1.3);
  ownedJar.visible = false;
  scene.add(ownedJar);
  ownedItems.jar = ownedJar;
  const ownedCable = new THREE.Group();
  ownedCable.add(boxAt(0.7, 0.018, 0.018, copper, 0.6, TABLE + 0.009, -0.95));
  ownedCable.add(boxAt(0.018, 0.018, 0.55, copper, 0.95, TABLE + 0.009, -0.7));
  ownedCable.visible = false;
  scene.add(ownedCable);
  ownedItems.cable = ownedCable;
  glowable('board', board);
  glowable('electrodes', ebox);
  glowable('pile', heap);
  glowable('done', doneStack);

  // Apprentice at a small bench by the left wall (turn your head to see him).
  const appBench = new THREE.Group();
  appBench.add(texBox(0.7, 0.04, 0.5, wood, 0, 0.8, 0, 0.4));
  for (const x of [-0.3, 0.3]) appBench.add(texBox(0.06, 0.78, 0.4, woodD, x, 0.39, 0, 0.4));
  appBench.add(boxAt(0.2, 0.02, 0.14, iron, 0.05, 0.83, 0));
  appBench.position.set(-1.92, 0, 0.62);
  appBench.rotation.y = Math.PI / 2;
  scene.add(appBench);
  const apprentice = figure({ cloak: '#3a3028', hood: '#4a3a2c', hat: 'cap', height: 1.5 }, { skin: skinM });
  apprentice.add(boxAt(0.2, 0.16, 0.06, glassM, 0, 1.3, -0.1));
  apprentice.position.set(-1.5, 0, 0.62);
  apprentice.rotation.y = Math.PI / 2;
  apprentice.visible = false;
  scene.add(apprentice);

  // --- Behind you: stove, coal, a cot, the switchboard; jars and the river window to the west -----
  const coal = lambert({ color: '#141414' });
  const stoveG = new THREE.Group();
  stoveG.add(texBox(0.62, 0.66, 0.5, iron, 0, 0.33, 0, 0.3, true));
  stoveG.add(texBox(0.66, 0.04, 0.54, iron, 0, 0.68, 0, 0.3));
  stoveG.add(boxAt(0.3, 0.06, 0.02, new THREE.MeshBasicMaterial({ color: '#ff6a20' }), 0, 0.3, -0.26));
  stoveG.add(boxAt(0.36, 0.2, 0.02, dark, 0, 0.42, -0.255));
  stoveG.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.85, 7), iron, 0.15, 1.6, 0.1));
  stoveG.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 7), iron, -0.15, 0.71, 0));
  // A kettle keeps warm on top.
  stoveG.add(mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.1, 8), lambert({ color: '#3a3430' }), -0.15, 0.78, 0, true));
  stoveG.position.set(-1.3, 0, 2.08);
  scene.add(stoveG);
  const bin = new THREE.Group();
  bin.add(texBox(0.5, 0.36, 0.4, woodD, 0, 0.18, 0, 0.3, true));
  for (let i = 0; i < 10; i++) bin.add(mesh(new THREE.IcosahedronGeometry(0.05, 0), coal, (i % 4) * 0.1 - 0.15, 0.34 + (i % 2) * 0.03, Math.floor(i / 4) * 0.1 - 0.1));
  bin.add(boxAt(0.04, 0.5, 0.04, wood, 0.28, 0.4, 0.05, true));
  bin.position.set(-0.55, 0, 2.12);
  scene.add(bin);
  // A cot where the welder sleeps between shifts.
  const cot = new THREE.Group();
  cot.add(texBox(1.8, 0.08, 0.75, wood, 0, 0.38, 0, 0.4, true));
  for (const x of [-0.85, 0.85]) for (const z of [-0.32, 0.32]) cot.add(texBox(0.07, 0.38, 0.07, woodD, x, 0.19, z, 0.4));
  cot.add(boxAt(1.55, 0.08, 0.66, lambert({ map: tx.wool, color: '#7a5a48' }), 0.08, 0.46, 0, true));
  cot.add(boxAt(0.32, 0.1, 0.5, lambert({ color: '#9a8c78' }), -0.7, 0.5, 0, true));
  cot.position.set(1.15, 0, 1.98);
  scene.add(cot);
  // Shelf over the cot: a cup, a candle, a folded letter from the north.
  scene.add(texBox(0.9, 0.03, 0.2, wood, 1.15, 1.3, FZ - 0.1, 0.3));
  scene.add(mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.08, 7), lambert({ color: '#6a5a4a' }), 0.85, 1.355, FZ - 0.1));
  scene.add(mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.07, 6), lambert({ color: '#d8ccb0' }), 1.1, 1.35, FZ - 0.1));
  scene.add(boxAt(0.12, 0.01, 0.08, paper, 1.35, 1.32, FZ - 0.1));
  // Switchboard: knife switches and fuses, copper running up into the ceiling.
  const board2 = new THREE.Group();
  board2.add(texBox(0.6, 0.5, 0.04, woodD, 0, 0, 0, 0.3));
  for (let i = 0; i < 3; i++) {
    const sw = new THREE.Group();
    sw.add(boxAt(0.06, 0.03, 0.03, dark, 0, -0.06, 0.03));
    const blade = boxAt(0.012, 0.13, 0.012, copper, 0, 0.0, 0.05);
    blade.rotation.x = i === 1 ? 0.5 : 0;
    sw.add(blade);
    sw.position.set(-0.18 + i * 0.18, 0.06, 0);
    board2.add(sw);
  }
  for (let i = 0; i < 4; i++) board2.add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.05, 6), lambert({ color: '#c8bca0' }), -0.18 + i * 0.12, -0.17, 0.03));
  for (let i = 0; i < 3; i++) board2.add(boxAt(0.012, 1.0, 0.012, copper, -0.18 + i * 0.18, 0.72, 0.0));
  board2.position.set(-0.05, 1.45, FZ - 0.03);
  board2.rotation.y = Math.PI;
  scene.add(board2);
  // A coat and a hat on pegs by the door.
  scene.add(boxAt(0.05, 0.75, 0.42, lambert({ map: tx.wool, color: '#6a5a4c' }), RX - 0.06, 1.25, 1.55, true));
  scene.add(mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.04, 8), lambert({ color: '#3a3028' }), RX - 0.1, 1.72, 1.95));
  // Rack of bar stock by the door.
  for (let i = 0; i < 6; i++) {
    const bar = boxAt(0.025, 1.3, 0.025, i % 2 ? iron : rustM, RX - 0.08, 0.65, -0.3 - i * 0.06, true);
    bar.rotation.x = 0.12;
    scene.add(bar);
  }
  // Acid cells on two shelves by the west wall, wired in a chain.
  const cellLive = lambert({ color: P.acid, emissive: '#0c140a' });
  const cellDead = lambert({ color: '#4a5444' });
  for (const y of [0.55, 1.0]) scene.add(texBox(0.24, 0.03, 0.9, wood, -RX + 0.12, y, 1.55, 0.3));
  for (let row = 0; row < 2; row++)
    for (let i = 0; i < 5; i++) {
      const j = new THREE.Group();
      j.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.16, 7), (i + row) % 3 ? cellDead : cellLive, 0, 0.08, 0, true));
      j.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 7), lambert({ color: '#6a5a44' }), 0, 0.175, 0));
      j.add(boxAt(0.008, 0.04, 0.008, copper, 0, 0.21, 0));
      j.position.set(-RX + 0.12, [0.565, 1.015][row], 1.2 + i * 0.17);
      scene.add(j);
    }
  scene.add(boxAt(0.012, 0.012, 0.75, copper, -RX + 0.12, 1.24, 1.55));
  scene.add(boxAt(0.012, 0.012, 0.75, copper, -RX + 0.12, 0.79, 1.55));

  // What you can't walk through (x0, z0, x1, z1).
  const solids: [number, number, number, number][] = [
    [-1.15, BACK_Z, 1.15, -0.28], // bench
    [-2.2, 0.3, -1.65, 0.95], // apprentice bench
    [-1.62, 1.8, -0.98, 2.4], // stove
    [-0.82, 1.9, -0.28, 2.4], // coal
    [0.22, 1.58, 2.2, 2.4], // cot
    [1.55, -1.0, 2.2, -0.42], // barrel
    [-2.2, 1.05, -1.95, 2.05], // cells
  ];
  const blocked = (x: number, z: number, r: number) => {
    if (x < -RX + r || x > RX - r || z < BACK_Z + r || z > FZ - r) return true;
    for (const [a, b, c, d] of solids) if (x > a - r && x < c + r && z > b - r && z < d + r) return true;
    return false;
  };

  // --- Lights: cold moonlight from the window and the door; warmth only from behind you ---------
  const L = SKIN.light;
  const hemi = new THREE.HemisphereLight(L.ambient.sky, L.ambient.ground, L.ambient.intensity);
  scene.add(hemi);
  const win = new THREE.SpotLight(L.window.color, L.window.intensity, 0, 0.8, 0.6, 1.5);
  win.position.set(-0.75, 1.8, -2.0);
  win.target.position.set(-0.4, 0.4, -0.2);
  scene.add(win, win.target);
  const door = new THREE.SpotLight(L.window.color, L.window.intensity * 0.7, 0, 0.7, 0.7, 1.5);
  door.position.set(2.6, 1.6, 0.3);
  door.target.position.set(0.6, 0.8, -0.6);
  scene.add(door, door.target);
  const bulbM0 = new THREE.MeshBasicMaterial({ color: '#ffb070' });
  const lamp = new THREE.PointLight(L.lamp.color, L.lamp.intensity, 0, 2);
  lamp.position.set(0.05, 1.5, -0.66);
  scene.add(mesh(new THREE.ConeGeometry(0.12, 0.09, 8, 1, true), iron, 0.05, 1.56, -0.66));
  scene.add(mesh(new THREE.SphereGeometry(0.025, 6, 4), bulbM0, 0.05, 1.53, -0.66));
  scene.add(lamp);
  const bulbM = bulbM0;
  // A lantern on a hook in the middle of the room, so the far half isn't black.
  const lantern = new THREE.PointLight('#ffb878', 1.4, 0, 1.6);
  lantern.position.set(0.3, 1.95, 1.2);
  scene.add(lantern);
  scene.add(mesh(new THREE.BoxGeometry(0.1, 0.14, 0.1), lambert({ color: '#2a2622', emissive: '#3a2008' }), 0.3, 2.02, 1.2));
  scene.add(mesh(new THREE.BoxGeometry(0.06, 0.08, 0.06), new THREE.MeshBasicMaterial({ color: '#ffc080' }), 0.3, 2.0, 1.2));
  scene.add(boxAt(0.006, 0.4, 0.006, dark, 0.3, 2.3, 1.2));
  const stove = new THREE.PointLight(L.stove.color, L.stove.intensity * 1.6, 0, 1.6);
  stove.position.set(-1.3, 0.4, 1.85);
  scene.add(stove);
  const arc = new THREE.PointLight(L.arc.color, 0, 0, 2);
  arc.castShadow = true;
  arc.shadow.mapSize.set(256, 256);
  arc.shadow.camera.near = 0.004;
  arc.shadow.camera.far = 2.0;
  arc.shadow.bias = -0.002;
  arc.position.copy(BENCH).add(new THREE.Vector3(0, 0.01, 0));
  scene.add(arc);
  const appArc = new THREE.PointLight(L.appArc.color, 0, 0, 2);
  appArc.position.set(-1.9, 0.9, 0.62);
  scene.add(appArc);

  const anchors: Record<string, THREE.Vector3> = {
    pile: new THREE.Vector3(-0.6, TABLE + 0.3, -0.66),
    board: new THREE.Vector3(-0.34, 1.32, BACK_Z),
    shelf: new THREE.Vector3(0.58, 1.3, BACK_Z),
    electrodes: new THREE.Vector3(-0.12, TABLE + 0.36, -1.06),
    door: new THREE.Vector3(0.6, TABLE + 0.3, -0.66),
    apprentice: new THREE.Vector3(-1.5, 1.62, 0.62),
    bench: new THREE.Vector3(0, TABLE + 0.35, -0.7),
  };

  setMoney(0);
  setRods(12);
  setOrders(0, 0);
  setGauge(1);
  setPiles(1, 0);

  return {
    scene,
    lights: { hemi, window: win, door, lamp, lampBulb: bulbM, stove, arc, appArc },
    wheels: [w1, w2],
    wheel2: w2,
    sky: skyM,
    far,
    snow,
    snowVel: sv,
    queue,
    customer,
    apprentice,
    appBench,
    pileSlot,
    boardTags,
    shelfItems,
    ownedItems,
    electrodeBox: ebox,
    restHammer,
    anchors,
    pickables: pick,
    hiMats,
    relabel: (s: string) => {
      signMat.map?.dispose();
      signMat.map = signTex(s);
      signMat.needsUpdate = true;
    },
    floorAt,
    setMoney,
    setRods,
    setOrders,
    setGauge,
    setPiles,
    blocked,
  };
}
