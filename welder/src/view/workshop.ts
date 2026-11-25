import * as THREE from 'three';
import { SKIN } from '../skin/default';
import { lambert } from './ps1';
import { Textures, priceTag, signTex } from './textures';
import type { GameData, CustomerLook } from '../data/types';

/** Layout of the workshop, in metres. The bench top is at y = TABLE; parts sit at BENCH. */
export const TABLE = 0.86;
export const BENCH = new THREE.Vector3(0, TABLE, -0.6);
const WALL_Z = -1.1;
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
  anchors: Record<string, THREE.Vector3>;
  pickables: THREE.Object3D[];
  hiMats: Record<string, THREE.MeshLambertMaterial[]>;
  /** Repaint in-world lettering (after a language change). */
  relabel: (sign: string) => void;
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, shadow = false): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = shadow;
  o.receiveShadow = true;
  return o;
}

function boxAt(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, shadow = false): THREE.Mesh {
  return mesh(new THREE.BoxGeometry(w, h, d), m, x, y, z, shadow);
}

/** Box whose texture repeats by size, so planks and stones keep their scale on any face. */
function texBox(w: number, h: number, d: number, m: THREE.MeshLambertMaterial, x: number, y: number, z: number, tile: number, shadow = false): THREE.Mesh {
  const g = new THREE.BoxGeometry(w, h, d);
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

function tag(o: THREE.Object3D, pick: string): THREE.Object3D {
  o.traverse((c) => (c.userData.pick = pick));
  return o;
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
  // A bundle under the arm: they all bring something to mend.
  g.add(mesh(new THREE.BoxGeometry(0.16, 0.12, 0.14), lambert({ color: '#2e2c2a' }), 0.2, h * 0.45, 0.06));
  return g;
}

export function buildWorkshop(tx: Textures, data: GameData, signText: string): Workshop {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#000000');
  const pick: THREE.Object3D[] = [];

  const stone = lambert({ map: tx.stone, color: '#b8bcc4' });
  const stoneSide = lambert({ map: tx.stone, color: '#9ea2aa' });
  const floorM = lambert({ map: tx.floor, color: '#a09890' });
  tx.floor.repeat.set(5, 4);
  const wood = lambert({ map: tx.wood, color: '#d0c0ac' });
  const woodD = lambert({ map: tx.woodDark, color: '#c0b0a0' });
  const plate = lambert({ map: tx.plate, color: '#b8b0a8' });
  const iron = lambert({ map: tx.iron, color: '#a8a4a0' });
  const dark = lambert({ color: '#1a1918' });
  const copper = lambert({ color: P.copper });
  const skinM = lambert({ color: '#6a5446' });
  const paper = lambert({ map: tx.paper, color: '#e0d4b8' });

  // --- Room ---------------------------------------------------------------
  const floor = mesh(new THREE.PlaneGeometry(4.6, 4), floorM, 0, 0, 0.9);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const ceil = mesh(new THREE.PlaneGeometry(4.6, 4), woodD, 0, 2.7, 0.9);
  ceil.rotation.x = Math.PI / 2;
  scene.add(ceil);
  for (let i = -2; i <= 2; i++) scene.add(texBox(0.16, 0.18, 4, woodD, i * 1.0, 2.6, 0.9, 0.5));

  // Back wall with a window (x 0..0.7, y 1.2..1.8) and a door (x 1.35..2.05, y 0..1.95).
  const wz = WALL_Z - 0.12;
  const wall = (x0: number, x1: number, y0: number, y1: number) => scene.add(texBox(x1 - x0, y1 - y0, 0.24, stone, (x0 + x1) / 2, (y0 + y1) / 2, wz, 1.1));
  wall(-2.3, 0, 0, 2.7);
  wall(0, 0.7, 0, 1.2);
  wall(0, 0.7, 1.8, 2.7);
  wall(0.7, 1.35, 0, 2.7);
  wall(1.35, 2.05, 1.95, 2.7);
  wall(2.05, 2.3, 0, 2.7);
  scene.add(texBox(0.24, 2.7, 4, stoneSide, -2.42, 1.35, 0.9, 1.1));
  scene.add(texBox(0.24, 2.7, 4, stoneSide, 2.42, 1.35, 0.9, 1.1));
  // Timber frame: posts and a lintel beam, as in an old stone workshop.
  for (const x of [-2.2, 2.2]) scene.add(texBox(0.15, 2.7, 0.15, woodD, x, 1.35, WALL_Z + 0.05, 0.6));
  scene.add(texBox(4.5, 0.16, 0.16, woodD, 0, 2.05, WALL_Z + 0.06, 0.6));
  // Window frame and cross bars.
  scene.add(texBox(0.8, 0.07, 0.3, woodD, 0.35, 1.17, wz + 0.03, 0.4));
  scene.add(texBox(0.8, 0.07, 0.3, woodD, 0.35, 1.83, wz, 0.4));
  scene.add(texBox(0.07, 0.66, 0.3, woodD, -0.01, 1.5, wz, 0.4));
  scene.add(texBox(0.07, 0.66, 0.3, woodD, 0.71, 1.5, wz, 0.4));
  scene.add(boxAt(0.035, 0.6, 0.05, woodD, 0.35, 1.5, wz));
  scene.add(boxAt(0.7, 0.035, 0.05, woodD, 0.35, 1.5, wz));
  // Snow on the sill.
  scene.add(boxAt(0.66, 0.02, 0.12, lambert({ color: '#4c5668' }), 0.35, 1.215, wz - 0.06));
  // Door frame and the open leaf.
  scene.add(texBox(0.09, 1.95, 0.3, woodD, 1.35, 0.975, wz, 0.5));
  scene.add(texBox(0.09, 1.95, 0.3, woodD, 2.05, 0.975, wz, 0.5));
  scene.add(texBox(0.8, 0.12, 0.3, woodD, 1.7, 1.96, wz, 0.5));
  const leaf = new THREE.Group();
  leaf.add(texBox(0.7, 1.9, 0.05, wood, 0.36, 0.95, 0, 0.5));
  for (const y of [0.4, 1.5]) leaf.add(boxAt(0.66, 0.08, 0.02, woodD, 0.36, y, 0.035));
  leaf.position.set(1.36, 0, WALL_Z + 0.02);
  leaf.rotation.y = 1.3;
  scene.add(leaf);

  // --- Outside --------------------------------------------------------------
  const skyM = new THREE.MeshBasicMaterial({ map: tx.sky, depthWrite: false });
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(90, 40), skyM);
  sky.position.set(0, 12, -40);
  scene.add(sky);
  const far: THREE.MeshBasicMaterial[] = [];
  const silo = (color: string) => {
    const m = new THREE.MeshBasicMaterial({ color });
    m.userData.base = m.color.clone();
    far.push(m);
    return m;
  };
  const hills = silo(P.hills);
  for (let i = 0; i < 9; i++) scene.add(mesh(new THREE.ConeGeometry(4 + (i % 3) * 2, 2.5 + (i % 4), 5), hills, -20 + i * 5.5, 0.6, -30 + (i % 2) * 3));
  const cw = silo(P.cityWall);
  scene.add(boxAt(60, 3.2, 1, cw, 0, 1.4, -15));
  for (let i = -6; i <= 6; i++) {
    scene.add(boxAt(0.5, 0.5, 1, cw, i * 2.1, 3.2, -15));
    if (i % 3 === 0) {
      scene.add(boxAt(1.8, 5.2, 1.8, cw, i * 2.1 + 0.4, 2.6, -15.4));
      scene.add(mesh(new THREE.ConeGeometry(1.4, 1.6, 4), cw, i * 2.1 + 0.4, 6, -15.4));
    }
  }
  // A few warm windows in the town, very faint.
  const ember = silo('#4a2a14');
  for (let i = 0; i < 6; i++) scene.add(boxAt(0.25, 0.3, 0.05, ember, -8 + i * 3.1, 2.2 + (i % 2) * 1.2, -14.4));
  const temple = silo('#121620');
  scene.add(boxAt(3, 4, 3, temple, -5, 2, -20));
  scene.add(mesh(new THREE.ConeGeometry(2.4, 2.4, 4), temple, -5, 5.2, -20));
  const ground = mesh(new THREE.PlaneGeometry(80, 40), lambert({ color: '#5a6478' }), 0, -0.02, -21);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const river = mesh(new THREE.PlaneGeometry(80, 2.4), new THREE.MeshLambertMaterial({ color: P.water }), 0, -0.18, -3.4);
  river.rotation.x = -Math.PI / 2;
  scene.add(river);
  scene.add(boxAt(80, 0.3, 2.4, dark, 0, -0.36, -3.4));

  // Water wheels with dynamos on the hub. The second one appears when bought.
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
    g.add(boxAt(0.1, r + 0.4, 0.1, woodD, 0.25, -r / 2, 0.15));
    g.userData.rot = rot;
    return g;
  };
  const w1 = makeWheel(0.72);
  w1.position.set(0.35, 0.85, -2.55);
  scene.add(w1);
  const w2 = makeWheel(0.62);
  w2.position.set(1.05, 0.78, -3.25);
  w2.visible = false;
  scene.add(w2);
  scene.add(boxAt(0.02, 0.02, 1.3, copper, 0.62, 1.25, -1.85));

  // Snow outside.
  const NS = 800;
  const sp = new Float32Array(NS * 3);
  const sv = new Float32Array(NS);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < NS; i++) {
    sp[i * 3] = -3 + rnd() * 9;
    sp[i * 3 + 1] = rnd() * 3.6;
    sp[i * 3 + 2] = -1.4 - rnd() * 7;
    sv[i] = 0.25 + rnd() * 0.35;
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3).setUsage(THREE.DynamicDrawUsage));
  const snow = new THREE.Points(sg, new THREE.PointsMaterial({ color: P.snow, size: 1.5, sizeAttenuation: false }));
  snow.frustumCulled = false;
  scene.add(snow);

  // The queue outside the door, receding into the snow.
  const looks = Object.values(data.customers);
  const queue: THREE.Group[] = [];
  for (let k = 0; k < 7; k++) {
    const f = figure(looks[(k * 3 + 1) % looks.length].look, { skin: skinM });
    f.position.set(2.1 + 0.95 * k, 0, -1.6 - 0.6 * k);
    f.rotation.y = 2.4 + (k % 2) * 0.3;
    f.visible = false;
    scene.add(f);
    queue.push(f);
  }
  const customer = figure(looks[0].look, { skin: skinM });
  customer.position.set(1.7, 0, -0.9);
  customer.rotation.y = 2.3;
  customer.visible = false;
  tag(customer, 'door');
  scene.add(customer);
  pick.push(customer);

  // --- Workbench ------------------------------------------------------------
  const bench = new THREE.Group();
  bench.add(texBox(1.5, 0.06, 0.75, woodD, 0, TABLE - 0.04, BENCH.z, 0.5));
  bench.add(texBox(0.78, 0.01, 0.52, plate, 0, TABLE - 0.004, BENCH.z, 0.22));
  for (const x of [-0.68, 0.68]) for (const z of [BENCH.z - 0.3, BENCH.z + 0.3]) bench.add(texBox(0.09, TABLE - 0.07, 0.09, woodD, x, (TABLE - 0.07) / 2, z, 0.5));
  bench.add(texBox(1.4, 0.04, 0.6, woodD, 0, 0.22, BENCH.z, 0.5));
  bench.add(texBox(1.5, 0.1, 0.05, woodD, 0, TABLE - 0.11, BENCH.z + 0.36, 0.5));
  // Clutter: clamp near the work (its shadow jumps with the arc), old stubs, a file.
  bench.add(boxAt(0.03, 0.09, 0.03, iron, -0.22, TABLE + 0.045, BENCH.z - 0.17, true));
  bench.add(boxAt(0.1, 0.02, 0.03, iron, -0.18, TABLE + 0.09, BENCH.z - 0.17, true));
  bench.add(boxAt(0.05, 0.06, 0.12, iron, -0.55, TABLE + 0.03, BENCH.z - 0.2, true));
  bench.add(boxAt(0.2, 0.012, 0.025, dark, -0.48, TABLE + 0.006, BENCH.z + 0.25, true));
  for (let i = 0; i < 5; i++) {
    const stub = boxAt(0.04, 0.004, 0.004, lambert({ color: '#4a4844' }), 0.42 + i * 0.012, TABLE + 0.002, BENCH.z + 0.2 + (i % 2) * 0.01);
    stub.rotation.y = i * 0.7;
    bench.add(stub);
  }
  tag(bench, 'bench');
  scene.add(bench);
  pick.push(bench);

  // Electrode can on the bench, rods sticking up.
  const ebox = new THREE.Group();
  ebox.add(mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.13, 8, 1, true), iron, 0, 0.065, 0, true));
  ebox.add(mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.01, 8), dark, 0, 0.005, 0));
  for (let i = 0; i < 10; i++) {
    const rod = boxAt(0.005, 0.32, 0.005, i % 3 ? lambert({ color: '#6c6458' }) : iron, Math.cos(i * 2.4) * 0.025, 0.16, Math.sin(i * 2.4) * 0.025, true);
    rod.rotation.set(Math.sin(i) * 0.12, 0, Math.cos(i * 1.3) * 0.12);
    ebox.add(rod);
  }
  ebox.position.set(0.5, TABLE, BENCH.z - 0.26);
  tag(ebox, 'electrodes');
  scene.add(ebox);
  pick.push(ebox);
  scene.add(mesh(new THREE.CylinderGeometry(0.1, 0.09, 0.22, 7), iron, -0.95, 0.11, -0.15));

  // Crate by the bench where the next job is put down.
  const heap = new THREE.Group();
  heap.add(texBox(0.44, 0.3, 0.38, woodD, 0, 0.55, 0, 0.3));
  for (const y of [0.42, 0.66]) heap.add(boxAt(0.46, 0.04, 0.4, wood, 0, y, 0));
  for (const x of [-0.18, 0.18]) for (const z of [-0.15, 0.15]) heap.add(boxAt(0.05, 0.4, 0.05, woodD, x, 0.2, z));
  let ss = 99;
  const sr = () => (ss = (ss * 48271) % 2147483647) / 2147483647;
  for (let i = 0; i < 6; i++) {
    const b = boxAt(0.05 + sr() * 0.12, 0.02 + sr() * 0.03, 0.03 + sr() * 0.08, i % 2 ? iron : dark, (sr() - 0.5) * 0.5, 0.02, (sr() - 0.5) * 0.4);
    b.rotation.y = sr() * 3;
    heap.add(b);
  }
  heap.position.set(0.98, 0, -0.62);
  heap.rotation.y = -0.15;
  tag(heap, 'pile');
  scene.add(heap);
  pick.push(heap);
  const pileSlot = new THREE.Group();
  pileSlot.position.set(0.98, 0.72, -0.62);
  pileSlot.rotation.y = 0.4;
  scene.add(pileSlot);

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

  // --- Shelf with things for sale, a sign and paper price tags --------------
  scene.add(texBox(1.0, 0.035, 0.22, wood, -0.72, 1.46, WALL_Z + 0.11, 0.4));
  for (const x of [-1.15, -0.3]) scene.add(texBox(0.035, 0.14, 0.18, woodD, x, 1.39, WALL_Z + 0.09, 0.3));
  const signMat = new THREE.MeshLambertMaterial({ map: signTex(signText), color: '#c8c0b0' });
  const sign = mesh(new THREE.PlaneGeometry(0.42, 0.1), signMat, -0.72, 1.75, WALL_Z + 0.02);
  sign.rotation.z = -0.02;
  scene.add(sign);
  scene.add(boxAt(0.005, 0.14, 0.005, dark, -0.86, 1.86, WALL_Z + 0.02));
  scene.add(boxAt(0.005, 0.14, 0.005, dark, -0.58, 1.86, WALL_Z + 0.02));

  const shelfItems: Record<string, THREE.Object3D> = {};
  const ownedItems: Record<string, THREE.Object3D> = {};
  const glassM = lambert({ color: P.glassGreen });
  const acidLive = lambert({ color: P.acid, emissive: '#1a2a14' });
  const acidDead = lambert({ color: '#4a5444' });
  const leather = lambert({ map: tx.leather, color: '#c8b8a0' });
  const jar = (liq: THREE.Material, s = 1) => {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.045 * s, 0.045 * s, 0.11 * s, 7), liq, 0, 0.055 * s, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.03 * s, 0.03 * s, 0.03 * s, 7), lambert({ color: '#6a5a44' }), 0, 0.125 * s, 0));
    g.add(boxAt(0.008, 0.03, 0.008, copper, -0.015 * s, 0.15 * s, 0));
    g.add(boxAt(0.008, 0.03, 0.008, copper, 0.015 * s, 0.15 * s, 0));
    return g;
  };
  const models: Record<string, () => THREE.Object3D> = {
    rods: () => {
      const g = new THREE.Group();
      for (let i = 0; i < 9; i++) g.add(boxAt(0.007, 0.007, 0.16, lambert({ color: '#7a6a50' }), (i % 4) * 0.009 - 0.014, 0.004 + Math.floor(i / 4) * 0.008, 0));
      g.add(boxAt(0.045, 0.014, 0.014, copper, 0, 0.012, 0));
      g.rotation.y = 0.6;
      return g;
    },
    glass: () => {
      const g = new THREE.Group();
      const gl = boxAt(0.1, 0.06, 0.008, glassM, 0, 0.04, 0);
      gl.rotation.x = -0.25;
      g.add(gl);
      g.add(boxAt(0.11, 0.008, 0.012, dark, 0, 0.072, 0.005));
      return g;
    },
    jar: () => jar(acidLive),
    cable: () => {
      const g = new THREE.Group();
      const t = mesh(new THREE.TorusGeometry(0.045, 0.013, 4, 9), copper, 0, 0.02, 0);
      t.rotation.x = Math.PI / 2;
      g.add(t);
      return g;
    },
    apron: () => {
      const g = new THREE.Group();
      const a = boxAt(0.1, 0.12, 0.01, leather, 0, 0.07, 0);
      a.rotation.x = -0.15;
      g.add(a);
      return g;
    },
    wheel: () => {
      const g = new THREE.Group();
      g.add(mesh(new THREE.TorusGeometry(0.05, 0.007, 4, 10), wood, 0, 0.06, 0));
      for (let i = 0; i < 4; i++) {
        const s = boxAt(0.004, 0.1, 0.004, woodD, 0, 0.06, 0);
        s.rotation.z = (i * Math.PI) / 4;
        g.add(s);
      }
      g.add(boxAt(0.03, 0.03, 0.03, copper, 0, 0.06, 0.012));
      return g;
    },
  };
  for (const u of data.upgrades) {
    const o = (models[u.model] ?? models.rods)();
    const x = -1.11 + u.slot * 0.16;
    o.position.set(x, 1.478, WALL_Z + 0.11);
    o.scale.setScalar(1.35);
    // Paper tag on a string under the shelf, with the price.
    const tagG = new THREE.Group();
    const t = mesh(new THREE.PlaneGeometry(0.06, 0.035), new THREE.MeshLambertMaterial({ map: priceTag(u.cost), color: '#e8dcc0' }), 0, -0.07, 0.11);
    t.rotation.z = (u.slot % 2 ? 1 : -1) * 0.08;
    tagG.add(t);
    tagG.add(boxAt(0.002, 0.05, 0.002, lambert({ color: '#8a7a5a' }), 0, -0.03, 0.11));
    tagG.scale.setScalar(1 / 1.35);
    o.add(tagG);
    tag(o, 'shelf:' + u.id);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.2, 0.17), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 0.04;
    hit.userData.pick = 'shelf:' + u.id;
    o.add(hit);
    o.visible = false;
    scene.add(o);
    shelfItems[u.id] = o;
    pick.push(o);
    glowable('shelf:' + u.id, o);
  }

  // Jar shelves to the left of the bench: old dead cells, and the one you buy.
  for (const y of [0.55, 0.95]) scene.add(texBox(0.62, 0.03, 0.2, wood, -1.0, y, WALL_Z + 0.1, 0.4));
  for (const x of [-1.29, -0.71]) scene.add(texBox(0.03, 1.0, 0.2, woodD, x, 0.5, WALL_Z + 0.1, 0.4));
  for (let i = 0; i < 5; i++) {
    const j = jar(acidDead, 1.1);
    j.position.set(-1.22 + i * 0.12, 0.565, WALL_Z + 0.1);
    scene.add(j);
  }
  for (let i = 0; i < 3; i++) {
    const j = jar(acidDead, 1.1);
    j.position.set(-1.22 + i * 0.12, 0.965, WALL_Z + 0.1);
    scene.add(j);
  }
  const ownedJar = jar(acidLive, 1.25);
  ownedJar.position.set(-0.86, 0.965, WALL_Z + 0.1);
  ownedJar.visible = false;
  scene.add(ownedJar);
  ownedItems.jar = ownedJar;
  const ownedCable = new THREE.Group();
  ownedCable.add(boxAt(0.025, 0.025, 0.5, copper, 0.62, TABLE - 0.02, BENCH.z - 0.1));
  ownedCable.add(boxAt(0.025, 0.4, 0.025, copper, 0.95, TABLE + 0.2, WALL_Z + 0.06));
  ownedCable.visible = false;
  scene.add(ownedCable);
  ownedItems.cable = ownedCable;

  // Copper wiring: window → knife switch → jars and bench, and up to the lamp.
  const wire = (x0: number, y0: number, x1: number, y1: number) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const w = boxAt(len, 0.012, 0.012, copper, (x0 + x1) / 2, (y0 + y1) / 2, WALL_Z + 0.015);
    w.rotation.z = Math.atan2(y1 - y0, x1 - x0);
    scene.add(w);
  };
  wire(0.74, 1.95, 1.27, 1.95);
  wire(1.27, 1.95, 1.27, 1.1);
  wire(1.27, 1.1, 1.05, 1.1);
  wire(0.98, 0.98, 0.98, TABLE + 0.02);
  wire(-0.05, 1.95, 0.74, 1.95);
  wire(0.74, 1.95, 0.74, 1.7);
  wire(-0.05, 1.95, -0.72, 1.12);
  wire(-0.72, 1.12, -0.72, 1.0);
  // Sagging cords between the old jars, as in any acid room.
  for (let i = 0; i < 4; i++) {
    const c = boxAt(0.12, 0.006, 0.006, copper, -1.16 + i * 0.12, 0.69 - (i % 2) * 0.01, WALL_Z + 0.08);
    c.rotation.z = (i % 2 ? -1 : 1) * 0.2;
    scene.add(c);
  }
  // Knife switch.
  scene.add(boxAt(0.13, 0.2, 0.03, woodD, 0.98, 1.1, WALL_Z + 0.02));
  scene.add(boxAt(0.015, 0.11, 0.015, copper, 0.98, 1.13, WALL_Z + 0.05));

  // Chalkboard for orders with paper tags pinned on it.
  const board = new THREE.Group();
  board.add(texBox(0.5, 0.44, 0.03, woodD, 0, 0, 0, 0.3));
  board.add(mesh(new THREE.PlaneGeometry(0.44, 0.38), lambert({ map: tx.chalk, color: '#c0c4c0' }), 0, 0, 0.016));
  board.position.set(1.0, 1.5, WALL_Z + 0.03);
  const boardTags: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i++) {
    const t = mesh(new THREE.PlaneGeometry(0.1, 0.12), paper, -0.14 + (i % 3) * 0.14, 0.08 - Math.floor(i / 3) * 0.17, 0.019);
    t.rotation.z = ((i * 37) % 7 - 3) * 0.04;
    t.visible = false;
    board.add(t);
    boardTags.push(t);
  }
  board.visible = false;
  tag(board, 'board');
  scene.add(board);
  pick.push(board);
  glowable('board', board);
  glowable('pile', heap);
  glowable('electrodes', ebox);

  // Apprentice corner along the left wall.
  const appBench = new THREE.Group();
  appBench.add(texBox(0.7, 0.04, 0.5, wood, 0, 0.8, 0, 0.4));
  for (const x of [-0.3, 0.3]) appBench.add(texBox(0.06, 0.78, 0.4, woodD, x, 0.39, 0, 0.4));
  appBench.add(boxAt(0.2, 0.02, 0.14, iron, 0.05, 0.83, 0));
  appBench.position.set(-2.02, 0, -0.15);
  appBench.rotation.y = Math.PI / 2;
  scene.add(appBench);
  const apprentice = figure({ cloak: '#3a3028', hood: '#4a3a2c', hat: 'cap', height: 1.5 }, { skin: skinM });
  apprentice.add(boxAt(0.2, 0.16, 0.06, glassM, 0, 1.3, -0.1));
  apprentice.position.set(-1.62, 0, -0.15);
  apprentice.rotation.y = Math.PI / 2;
  apprentice.visible = false;
  scene.add(apprentice);

  // Lamp: a crude carbon bulb in a tin shade; brightness follows the dynamo.
  const bulbM = new THREE.MeshBasicMaterial({ color: '#ffb070' });
  scene.add(mesh(new THREE.SphereGeometry(0.03, 6, 4), bulbM, 0.1, 1.98, -0.5));
  scene.add(mesh(new THREE.ConeGeometry(0.11, 0.08, 8, 1, true), iron, 0.1, 2.04, -0.5));
  scene.add(boxAt(0.006, 0.6, 0.006, dark, 0.1, 2.36, -0.5));

  // Stove in the corner for warmth.
  scene.add(boxAt(0.42, 0.45, 0.5, iron, -2.0, 0.225, 0.4));
  scene.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.3, 6), iron, -2.05, 1.6, 0.4));
  scene.add(boxAt(0.02, 0.05, 0.25, new THREE.MeshBasicMaterial({ color: '#ff5a18' }), -1.785, 0.2, 0.4));

  // --- Lights ----------------------------------------------------------------
  const L = SKIN.light;
  const hemi = new THREE.HemisphereLight(L.ambient.sky, L.ambient.ground, L.ambient.intensity);
  scene.add(hemi);
  const win = new THREE.SpotLight(L.window.color, L.window.intensity, 0, 0.8, 0.6, 1.5);
  win.position.set(0.35, 1.75, -1.7);
  win.target.position.set(0.0, 0.7, 0.3);
  scene.add(win, win.target);
  const door = new THREE.SpotLight(L.window.color, L.window.intensity * 0.8, 0, 0.65, 0.7, 1.5);
  door.position.set(1.75, 1.6, -2.0);
  door.target.position.set(1.1, 0.0, 0.3);
  scene.add(door, door.target);
  const lamp = new THREE.PointLight(L.lamp.color, L.lamp.intensity, 0, 2);
  lamp.position.set(0.1, 1.93, -0.5);
  scene.add(lamp);
  const stove = new THREE.PointLight(L.stove.color, L.stove.intensity, 0, 1.8);
  stove.position.set(-1.65, 0.3, 0.45);
  scene.add(stove);
  const arc = new THREE.PointLight(L.arc.color, 0, 0, 2);
  arc.castShadow = true;
  arc.shadow.mapSize.set(256, 256);
  arc.shadow.camera.near = 0.004;
  arc.shadow.camera.far = 1.2;
  arc.shadow.bias = -0.002;
  arc.position.copy(BENCH).add(new THREE.Vector3(0, 0.01, 0));
  scene.add(arc);
  const appArc = new THREE.PointLight(L.appArc.color, 0, 0, 2);
  appArc.position.set(-1.98, 0.88, -0.15);
  scene.add(appArc);

  const anchors: Record<string, THREE.Vector3> = {
    pile: new THREE.Vector3(0.98, 0.86, -0.62),
    board: new THREE.Vector3(1.0, 1.77, WALL_Z),
    shelf: new THREE.Vector3(-0.72, 1.86, WALL_Z),
    electrodes: new THREE.Vector3(0.52, TABLE + 0.36, BENCH.z - 0.24),
    door: new THREE.Vector3(1.7, 1.85, -0.9),
    apprentice: new THREE.Vector3(-1.62, 1.62, -0.15),
  };

  const relabel = (s: string) => {
    signMat.map?.dispose();
    signMat.map = signTex(s);
    signMat.needsUpdate = true;
  };

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
    anchors,
    pickables: pick,
    hiMats,
    relabel,
  };
}
