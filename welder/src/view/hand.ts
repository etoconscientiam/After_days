import * as THREE from 'three';
import { lambert } from './ps1';

/**
 * A puppet hand: rigid low-poly pieces on a skeleton of joints with human ranges of motion.
 *
 * Hand frame (metres, right hand): origin at the wrist joint, +Y distal (toward the fingertips), +X radial
 * (thumb side), +Z palmar (X × Y). Flexion turns a finger toward +Z. The left hand is the mirror image.
 *
 * Bones: forearm → wrist (flexion, deviation) → palm (metacarpals as one block, as they move little) →
 * per finger MCP (flexion, spread) → PIP → DIP; thumb CMC (flexion, abduction, roll) → MCP → IP.
 * DIP follows PIP (two thirds of it, as the tendons couple them), on top of its own small range.
 *
 * Grip is solved, not posed: each finger closes joint by joint (MCP, then PIP with DIP coupled, then DIP)
 * until that phalanx meets the handle, so the fist fits whatever it holds.
 */
const D2R = Math.PI / 180;

/** A hinge with limits; `set` clamps. Rotation order of the group is XZY: flexion (X), spread (Z), roll (Y). */
class Joint {
  readonly g = new THREE.Group();
  constructor(
    readonly flex: [number, number],
    readonly spread: [number, number] = [0, 0],
    readonly roll: [number, number] = [0, 0],
  ) {
    this.g.rotation.order = 'XZY';
  }
  set(flexDeg: number, spreadDeg = 0, rollDeg = 0): void {
    const c = (v: number, r: [number, number]) => Math.min(r[1], Math.max(r[0], v)) * D2R;
    // + spread turns toward the thumb (+x), which is a negative turn about z.
    this.g.rotation.set(c(flexDeg, this.flex), c(rollDeg, this.roll), -c(spreadDeg, this.spread));
  }
  get flexDeg(): number {
    return this.g.rotation.x / D2R;
  }
}

interface FingerDef {
  name: string;
  /** MCP position on the knuckle line (x across, y along). */
  x: number;
  y: number;
  /** Phalanx lengths: proximal, middle, distal. */
  len: [number, number, number];
  /** Width and thickness at the base of the proximal phalanx. */
  w: number;
  t: number;
  /** Natural spread at the MCP (degrees, + toward the thumb). */
  spread: number;
}

// A gloved working hand: real proportions, a touch fuller for the leather.
const FINGERS: FingerDef[] = [
  { name: 'index', x: 0.03, y: 0.092, len: [0.046, 0.027, 0.022], w: 0.02, t: 0.018, spread: 4 },
  { name: 'middle', x: 0.0095, y: 0.096, len: [0.05, 0.031, 0.024], w: 0.021, t: 0.019, spread: 0 },
  { name: 'ring', x: -0.0105, y: 0.093, len: [0.047, 0.029, 0.023], w: 0.0195, t: 0.018, spread: -4 },
  { name: 'little', x: -0.029, y: 0.084, len: [0.037, 0.022, 0.02], w: 0.017, t: 0.016, spread: -9 },
];

/**
 * A faceted limb segment along +Y from 0 to len: eight sides, width (x) and thickness (z) tapering from
 * base to end, `round` pinches the far end into a blunt tip. Starts a little behind the joint so a bent
 * joint never opens a gap.
 */
function segment(len: number, w0: number, w1: number, t0: number, t1: number, round = 0, back = 0.35): THREE.BufferGeometry {
  const start = -Math.min(w0, t0) * back;
  const total = len - start;
  const g = new THREE.CylinderGeometry(0.5, 0.5, total, 8, 4, false);
  g.translate(0, total / 2 + start, 0);
  g.rotateY(Math.PI / 8);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const k = Math.max(0, Math.min(1, (y - start) / total));
    let sw = w0 + (w1 - w0) * k, st = t0 + (t1 - t0) * k;
    // Rounded ends: the last and first rings close in.
    const e = Math.max(0, (k - 0.75) / 0.25);
    const pinch = 1 - round * e * e;
    const b = Math.max(0, (0.25 - k) / 0.25);
    const pinchB = 1 - 0.25 * b * b;
    sw *= pinch * pinchB;
    st *= pinch * pinchB;
    p.setX(i, p.getX(i) * sw);
    p.setZ(i, p.getZ(i) * st);
  }
  g.computeVertexNormals();
  return g;
}

export interface HandMats {
  glove: THREE.Material;
  gloveD: THREE.Material;
  palm: THREE.Material;
  cuff: THREE.Material;
  band: THREE.Material;
  sleeve: THREE.Material;
}

let shared: HandMats | null = null;
export function handMats(): HandMats {
  return (shared ??= {
    // Fingers a shade lighter than the back of the hand, the tips darker (worn, sooty): the fist reads as fingers.
    glove: lambert({ color: '#5e4430', flatShading: true }),
    gloveD: lambert({ color: '#46301e', flatShading: true }),
    palm: lambert({ color: '#3a281a', flatShading: true }),
    cuff: lambert({ color: '#3a281a', flatShading: true }),
    band: lambert({ color: '#7a2418', flatShading: true }),
    sleeve: lambert({ color: '#3e3430', flatShading: true }),
  });
}

class Finger {
  readonly mcp = new Joint([-25, 95], [-22, 22]);
  readonly pip = new Joint([0, 110]);
  readonly dip = new Joint([-5, 85]);
  constructor(readonly def: FingerDef, m: HandMats) {
    const [l1, l2, l3] = def.len;
    const { w, t } = def;
    this.mcp.g.position.set(def.x, def.y, 0);
    const add = (j: Joint, geo: THREE.BufferGeometry, mat: THREE.Material) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      j.g.add(mesh);
    };
    add(this.mcp, segment(l1, w * 0.9, w * 0.85, t, t * 0.92), m.glove);
    this.pip.g.position.y = l1;
    this.mcp.g.add(this.pip.g);
    add(this.pip, segment(l2, w * 0.85, w * 0.8, t * 0.92, t * 0.85), m.glove);
    this.dip.g.position.y = l2;
    this.pip.g.add(this.dip.g);
    add(this.dip, segment(l3, w * 0.8, w * 0.72, t * 0.85, t * 0.75, 0.55), m.gloveD);
  }

  /** Flexion of all three joints, DIP coupled to PIP. */
  pose(mcp: number, pip: number, dipExtra = 0): void {
    this.mcp.set(mcp, this.def.spread);
    this.pip.set(pip);
    this.dip.set(pip * 0.66 + dipExtra);
  }

  /**
   * Close round a handle: a circle in this finger's plane (hand y, z) of radius `r` (handle radius plus half
   * the finger's thickness), centred at (cy, cz). Each joint bends until its phalanx touches, or to its limit.
   */
  grip(cy: number, cz: number, r: number, squeeze: number): void {
    const [l1, l2, l3] = this.def.len;
    const y0 = this.def.y, z0 = 0;
    const touches = (ay: number, az: number, ang: number, len: number) => {
      // Distance from the circle centre to the segment from (ay, az) at flexion angle `ang`.
      const dy = Math.cos(ang), dz = Math.sin(ang);
      const u = Math.max(0, Math.min(len, (cy - ay) * dy + (cz - az) * dz));
      return Math.hypot(ay + dy * u - cy, az + dz * u - cz) <= r;
    };
    const step = 1;
    let a1 = -10;
    while (a1 < this.mcp.flex[1] && !touches(y0, z0, a1 * D2R, l1)) a1 += step;
    const p1y = y0 + Math.cos(a1 * D2R) * l1, p1z = z0 + Math.sin(a1 * D2R) * l1;
    let a2 = 0;
    const seg2 = (a: number) => (a1 + a) * D2R;
    while (a2 < this.pip.flex[1] && !touches(p1y, p1z, seg2(a2), l2)) a2 += step;
    const p2y = p1y + Math.cos(seg2(a2)) * l2, p2z = p1z + Math.sin(seg2(a2)) * l2;
    let a3 = 0;
    const base3 = a2 * 0.66;
    while (base3 + a3 < this.dip.flex[1] && !touches(p2y, p2z, (a1 + a2 + base3 + a3) * D2R, l3)) a3 += step;
    // A firmer squeeze presses each joint a few degrees further into the (padded) handle.
    const k = squeeze * 6;
    this.pose(a1 + k, a2 + k, a3);
  }
}

class Thumb {
  readonly cmc = new Joint([-20, 60], [-25, 70], [-95, 40]);
  readonly mcp = new Joint([-10, 65]);
  readonly ip = new Joint([-15, 85]);
  constructor(m: HandMats) {
    // The thumb's base sits low on the radial side of the palm, turned to face the fingers.
    this.cmc.g.position.set(0.026, 0.022, 0.012);
    const add = (j: Joint, geo: THREE.BufferGeometry, mat: THREE.Material) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      j.g.add(mesh);
    };
    add(this.cmc, segment(0.046, 0.03, 0.024, 0.026, 0.021, 0, 0.2), m.glove);
    this.mcp.g.position.y = 0.046;
    this.cmc.g.add(this.mcp.g);
    add(this.mcp, segment(0.032, 0.023, 0.021, 0.02, 0.019), m.glove);
    this.ip.g.position.y = 0.032;
    this.mcp.g.add(this.ip.g);
    add(this.ip, segment(0.027, 0.021, 0.018, 0.019, 0.015, 0.55), m.gloveD);
  }
}

/** Faceted solid of revolution about +Y from [radius, y] pairs (for the gauntlet and the sleeve). */
function shell(prof: [number, number][], mat: THREE.Material, sides = 8): THREE.Mesh {
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), sides);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

export class Hand {
  /** Place this at the wrist; the forearm hangs off it along −Y. */
  readonly root = new THREE.Group();
  readonly wrist = new Joint([-70, 75], [-25, 35]);
  readonly palm = new THREE.Group();
  readonly forearm = new THREE.Group();
  readonly fingers: Finger[];
  readonly thumb: Thumb;

  constructor(left = false) {
    const m = handMats();
    // The forearm is fixed to the root; the wrist joint turns the hand on it.
    this.root.add(this.forearm, this.wrist.g);
    this.wrist.g.add(this.palm);
    // Palm: the metacarpal block, wider and thinner at the knuckles than at the wrist.
    const palm = new THREE.Mesh(segment(0.088, 0.07, 0.084, 0.034, 0.03, 0, 0.1), m.palm);
    palm.castShadow = true;
    this.palm.add(palm);
    this.fingers = FINGERS.map((f) => {
      const fg = new Finger(f, m);
      this.palm.add(fg.mcp.g);
      // The knuckle: the head of the metacarpal, standing up on the back of the fist.
      const kn = new THREE.Mesh(new THREE.IcosahedronGeometry(f.w * 0.5, 1), m.palm);
      kn.scale.set(1, 0.8, 0.55);
      kn.position.set(f.x, f.y - 0.006, -0.009);
      kn.castShadow = true;
      this.palm.add(kn);
      return fg;
    });
    this.thumb = new Thumb(m);
    this.palm.add(this.thumb.cmc.g);
    // Forearm: gauntlet flaring back from the wrist, a red band, then the sleeve, all along −Y.
    const cuff = shell([[0, 0.012], [0.036, 0.012], [0.04, -0.03], [0.05, -0.08], [0.058, -0.115], [0, -0.115]], m.cuff);
    cuff.scale.set(1, 1, 0.82);
    const band = shell([[0.0595, -0.088], [0.061, -0.1], [0.06, -0.112], [0.058, -0.112], [0.0575, -0.088]], m.band);
    band.scale.set(1, 1, 0.82);
    const sleeve = shell([[0, -0.1], [0.056, -0.1], [0.066, -0.14], [0.063, -0.18], [0.07, -0.22], [0.074, -0.5], [0.078, -0.9], [0, -0.9]], m.sleeve);
    sleeve.scale.set(1, 1, 0.85);
    this.forearm.add(cuff, band, sleeve);
    if (left) this.root.scale.x = -1;
    this.relax();
  }

  /** An open, resting hand (fingers gently curled). */
  relax(): void {
    const curl = [12, 16, 20, 26];
    this.fingers.forEach((f, i) => f.pose(curl[i], curl[i] * 1.4));
    this.thumb.cmc.set(10, 25, 10);
    this.thumb.mcp.set(10);
    this.thumb.ip.set(10);
    this.wrist.set(0, 0);
  }

  /**
   * Power grip round a handle of radius `r` lying across the palm at (cy, cz) where it crosses the middle
   * finger. `oblique` (degrees): how far the handle runs diagonally, from the base of the index finger down
   * to the heel of the hand by the little finger (a real power grip is oblique, 0 = straight across).
   * `squeeze` 0..1 tightens it. The thumb wraps the other way, over the index and middle fingers.
   */
  grip(r: number, cy: number, cz: number, squeeze = 0, oblique = 0): void {
    const t = Math.tan(oblique * D2R), c = Math.cos(oblique * D2R);
    // Each finger meets the slanted handle a little higher (index) or lower (little finger); its section
    // through the handle is a little longer than round.
    for (const f of this.fingers) f.grip(cy + (f.def.x - 0.0095) * t, cz, (r + f.def.t * 0.5) / Math.sqrt(c), squeeze);
    const k = squeeze * 5;
    this.thumb.cmc.set(40 + k, -15, -85);
    this.thumb.mcp.set(40 + k);
    this.thumb.ip.set(50 + k);
  }
}

/**
 * A hand gripping a tool, in the tool's frame (handle along +y, working end below, forearm leaving along +x
 * toward the elbow, back of the hand toward +z for the right hand). `r`: handle radius; `y`: where along
 * the handle the fist sits; `x`: the handle axis's offset in the tool. The left hand is the mirror image.
 */
export function holdingHand(r: number, y: number, x = 0, left = false, oblique = 0): { group: THREE.Group; hand: Hand } {
  const hand = new Hand();
  // Across the palm, in the hollow under the knuckles, resting on the palm.
  const cy = 0.068, cz = 0.017 + r;
  hand.grip(r, cy, cz, 0, oblique);
  // The handle in the hand: from the index side (the working end) toward the little finger, slanting down
  // toward the wrist by `oblique`. It becomes the tool's +y; across it in the palm plane becomes +x (toward
  // the elbow when straight); palmar becomes −z.
  const o = oblique * D2R;
  const hDir = new THREE.Vector3(-Math.cos(o), -Math.sin(o), 0);
  const pDir = new THREE.Vector3(Math.sin(o), -Math.cos(o), 0);
  const H = new THREE.Matrix4().makeBasis(pDir, hDir, new THREE.Vector3(0, 0, 1));
  const T = new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1));
  const M = T.multiply(H.transpose());
  hand.root.quaternion.setFromRotationMatrix(M);
  // The point where the handle crosses the middle finger's line goes onto the handle axis.
  const c0 = new THREE.Vector3(0.0095, cy, cz).applyQuaternion(hand.root.quaternion);
  hand.root.position.set(x - c0.x, y - c0.y, -c0.z);
  const group = new THREE.Group();
  group.add(hand.root);
  if (left) group.scale.z = -1;
  return { group, hand };
}

/**
 * Orientation for a tool held in the hand: the handle along `handle` (unit, from the working end toward the
 * hand) and the forearm leaving toward `elbow` (any direction not along the handle).
 */
export function gripFrame(handle: THREE.Vector3, elbow: THREE.Vector3, out: THREE.Quaternion): void {
  const x = tmpX.copy(elbow).addScaledVector(handle, -elbow.dot(handle));
  if (x.lengthSq() < 1e-8) x.set(1, 0, 0).addScaledVector(handle, -handle.x);
  x.normalize();
  const z = tmpZ.crossVectors(x, handle);
  out.setFromRotationMatrix(tmpM.makeBasis(x, handle, z));
}
const tmpX = new THREE.Vector3();
const tmpZ = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
