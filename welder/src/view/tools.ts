import * as THREE from 'three';
import { lambert } from './ps1';
import { SKIN } from '../skin/default';
import type { Textures } from './textures';

const Y = new THREE.Vector3(0, 1, 0);

/** A capsule from a to b (radius r): fingers, thumb joints. */
function bone(a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material): THREE.Mesh {
  const d = new THREE.Vector3().subVectors(b, a);
  const o = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, d.length()), 3, 8), m);
  o.position.addVectors(a, b).multiplyScalar(0.5);
  o.quaternion.setFromUnitVectors(Y, d.normalize());
  return o;
}

/**
 * A gloved fist around a handle that runs along +y through the origin: four curled fingers (each a bent
 * ring around the handle with a rounded tip), a padded back of the hand, a two-joint thumb over the fingers,
 * a flared leather gauntlet with a stitched band, and a wool sleeve with a couple of folds running on past
 * the edge of the view. Rounded low-poly, so it reads as a hand at the game's pixel size.
 */
function arm(tx: Textures, mirror = false): THREE.Group {
  const g = new THREE.Group();
  const leather = lambert({ map: tx.leather, color: '#ffffff' });
  const leatherD = lambert({ map: tx.leather, color: '#b4a494' });
  const wool = lambert({ map: tx.wool, color: '#8c8078' });
  const band = lambert({ color: '#6a2a1c' });
  const add = (o: THREE.Mesh) => {
    o.castShadow = true;
    g.add(o);
    return o;
  };
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  // Fingers: index nearest the tool, little finger toward the wrist. Each wraps from the back of the hand
  // (+z) round the far side (−x) to the front (−z), where the tip tucks in.
  const fingers = [
    { y: 0.012, r: 0.0118 },
    { y: 0.036, r: 0.0124 },
    { y: 0.06, r: 0.012 },
    { y: 0.082, r: 0.0108 },
  ];
  const D2 = Math.PI / 180;
  for (const f of fingers) {
    const R = 0.021 + f.r;
    const from = 70, len = 215;
    const ring = new THREE.TorusGeometry(R, f.r, 6, 9, len * D2);
    ring.rotateX(Math.PI / 2);
    ring.rotateY(-from * D2);
    ring.translate(0, f.y, 0);
    add(new THREE.Mesh(ring, f.y < 0.02 ? leather : leatherD));
    const e = (from + len) * D2;
    const tip = add(new THREE.Mesh(new THREE.SphereGeometry(f.r * 1.02, 8, 6), leatherD));
    tip.position.set(R * Math.cos(e), f.y, R * Math.sin(e));
  }
  // The back of the hand: a padded, slightly domed slab over the knuckles.
  const back = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.06, 4, 10), leather));
  back.scale.set(1.25, 1, 0.62);
  back.position.set(0.006, 0.052, 0.034);
  // Heel of the palm on the near side, where the thumb grows from.
  const heel = add(new THREE.Mesh(new THREE.SphereGeometry(0.027, 10, 8), leather));
  heel.scale.set(1, 1.3, 0.9);
  heel.position.set(0.03, 0.086, 0.012);
  // Thumb: from the heel over the front of the fingers, pointing toward the tool.
  const t0 = V(0.036, 0.078, 0.004), t1 = V(0.03, 0.05, -0.028), t2 = V(0.008, 0.03, -0.04);
  add(bone(t0, t1, 0.0135, leather));
  add(bone(t1, t2, 0.012, leatherD));
  // Gauntlet: flares from the wrist; a stitched band round its top.
  const cuffProf = [V(0, 0.095, 0), V(0.03, 0.095, 0), V(0.032, 0.11, 0), V(0.042, 0.155, 0), V(0.05, 0.2, 0), V(0.046, 0.205, 0), V(0, 0.205, 0)].map((v) => new THREE.Vector2(v.x, v.y));
  const cuff = add(new THREE.Mesh(new THREE.LatheGeometry(cuffProf, 12), leather));
  cuff.position.z = 0.012;
  const stripe = add(new THREE.Mesh(new THREE.CylinderGeometry(0.0495, 0.0475, 0.016, 12, 1, true), band));
  stripe.position.set(0, 0.178, 0.012);
  // Sleeve: wool, thickening up the forearm, with two loose folds just above the gauntlet.
  const sleeveProf = [
    [0.0, 0.19], [0.044, 0.19], [0.056, 0.215], [0.054, 0.24], [0.064, 0.27], [0.06, 0.3], [0.068, 0.42], [0.074, 0.7], [0.078, 1.0], [0.0, 1.0],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const sleeve = add(new THREE.Mesh(new THREE.LatheGeometry(sleeveProf, 12), wool));
  sleeve.position.z = 0.016;
  sleeve.castShadow = true;
  if (mirror) {
    // Left hand: mirror across x (three.js flips the winding for a negative scale).
    const m = new THREE.Group();
    m.scale.x = -1;
    m.add(g);
    return m;
  }
  return g;
}

/**
 * Hands and tools. The right arm reaches in from the lower right with the electrode holder (or the chipping
 * hammer) and follows the cursor; the left arm comes in from the lower left and steadies the job with tongs.
 */
export class Tools {
  readonly group = new THREE.Group();
  /** Holder: tip at the origin, rod along +y toward the hand. */
  readonly holder = new THREE.Group();
  readonly rod: THREE.Mesh;
  private grip = new THREE.Group();
  readonly hammer = new THREE.Group();
  readonly left = new THREE.Group();
  readonly arcGlow: THREE.Mesh;
  readonly arcStar: THREE.Mesh;
  readonly bolt: THREE.Line;
  private boltPos: Float32Array;
  readonly pool: THREE.Mesh;
  private swing = 0;
  /** Visible rod length when new (m). */
  readonly rodLen = 0.16;
  private dR = new THREE.Vector3(0.55, -0.72, 0.42).normalize();
  private dL = new THREE.Vector3(-0.6, -0.72, 0.36).normalize();
  private tmp = new THREE.Vector3();
  private q = new THREE.Quaternion();

  constructor(tx: Textures) {
    const dark = lambert({ color: '#161514' });
    this.rod = new THREE.Mesh(new THREE.BoxGeometry(0.004, 1, 0.004), lambert({ color: '#6c665c' }));
    this.rod.castShadow = true;
    this.holder.add(this.rod);
    // The holder: sprung jaws on a long insulated handle.
    const jaws = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.06, 0.032), dark);
    jaws.position.y = 0.025;
    jaws.castShadow = true;
    this.grip.add(jaws);
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.11, 0.012), lambert({ map: tx.iron, color: '#c0b8b0' }));
    lever.position.set(0.02, 0.08, -0.015);
    lever.rotation.z = -0.15;
    this.grip.add(lever);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.02, 0.14, 6), lambert({ color: '#2a2420' }));
    handle.position.y = 0.12;
    this.grip.add(handle);
    const hand = arm(tx);
    hand.position.y = 0.09;
    this.grip.add(hand);
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.7, 5), dark);
    cable.position.set(0.045, 0.5, -0.035);
    this.grip.add(cable);
    this.holder.add(this.grip);
    this.group.add(this.holder);

    // Chipping hammer: the point at the origin, handle along +y to the hand.
    const metal = lambert({ map: tx.iron, color: '#d0d0d0' });
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.018, 0.018), metal);
    head.position.set(0.045, 0.014, 0);
    const tipG = new THREE.ConeGeometry(0.009, 0.024, 4);
    tipG.rotateZ(Math.PI / 2 + 0.6);
    const tip = new THREE.Mesh(tipG, metal);
    tip.position.set(0.004, 0.009, 0);
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.013, 0.26, 0.013), lambert({ map: tx.wood, color: '#d8c8b0' }));
    shaft.position.set(0.045, 0.14, 0);
    const hh = arm(tx);
    hh.position.set(0.045, 0.19, 0);
    this.hammer.add(head, tip, shaft, hh);
    this.hammer.traverse((o) => (o.castShadow = true));
    this.hammer.visible = false;
    this.group.add(this.hammer);

    // Left arm with tongs: the jaws at the origin, the handles along +y into the fist.
    const tongM = lambert({ map: tx.iron, color: '#b8b4b0' });
    for (const s of [-1, 1]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.18, 0.007), tongM);
      bar.position.set(s * 0.012, 0.09, 0);
      bar.rotation.z = s * 0.06;
      bar.castShadow = true;
      this.left.add(bar);
      const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.012, 0.03), tongM);
      jaw.position.set(s * 0.006, 0.004, 0.008);
      this.left.add(jaw);
    }
    const piv = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.02, 6), tongM);
    piv.rotation.x = Math.PI / 2;
    piv.position.y = 0.06;
    this.left.add(piv);
    const lh = arm(tx, true);
    lh.position.y = 0.13;
    this.left.add(lh);
    this.left.visible = false;
    this.group.add(this.left);

    // The arc: bright core, a star of rays, and a jagged bolt between rod and pool.
    const arcCol = new THREE.Color(SKIN.light.arc.color);
    this.arcGlow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 8), new THREE.MeshBasicMaterial({ color: arcCol.clone().multiplyScalar(60), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.arcGlow.visible = false;
    this.group.add(this.arcGlow);
    this.arcStar = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: starTex(), color: arcCol.clone().multiplyScalar(5), transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
    this.arcStar.visible = false;
    this.arcStar.renderOrder = 10;
    this.group.add(this.arcStar);
    this.boltPos = new Float32Array(6 * 3);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(this.boltPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.bolt = new THREE.Line(bg, new THREE.LineBasicMaterial({ color: new THREE.Color(0.9, 0.95, 1).multiplyScalar(80) }));
    this.bolt.frustumCulled = false;
    this.bolt.visible = false;
    this.group.add(this.bolt);
    const pg = new THREE.CircleGeometry(1, 8);
    pg.rotateX(-Math.PI / 2);
    this.pool = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.85, 0.5).multiplyScalar(8), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.pool.visible = false;
    this.group.add(this.pool);
  }

  /** Orient a tool so it runs from `tip` toward the arm's shoulder (a fixed direction in view space). */
  private aim(cam: THREE.Camera, dir: THREE.Vector3, out: THREE.Quaternion, normal?: THREE.Vector3, tip?: THREE.Vector3): void {
    const d = this.tmp.copy(dir).applyQuaternion(cam.quaternion);
    // Lean the tool out of the surface it touches, so the rod and the hammer never sink into the work.
    // Only as much as needed: the tool keeps coming from the hand, just never from inside the work.
    if (normal && d.dot(normal) < 0.3) d.addScaledVector(normal, 0.3 - d.dot(normal)).normalize();
    if (!tip) {
      out.setFromUnitVectors(Y, d);
      return;
    }
    // Turn the fist about the handle so the back of the hand (+z, knuckles and thumb) faces the eye,
    // the way you see your own hand: never the curled fingers from underneath.
    const z = this.tz.copy(cam.position).sub(tip);
    z.addScaledVector(d, -z.dot(d));
    if (z.lengthSq() < 1e-8) {
      out.setFromUnitVectors(Y, d);
      return;
    }
    z.normalize();
    const x = this.tx3.crossVectors(d, z);
    out.setFromRotationMatrix(this.m4.makeBasis(x, d, z));
  }
  private tz = new THREE.Vector3();
  private tx3 = new THREE.Vector3();
  private m4 = new THREE.Matrix4();

  /** Electrode holder with its tip at `tip`. `remain` is 0..1 of the rod left. */
  placeHolder(tip: THREE.Vector3, cam: THREE.Camera, remain: number, normal?: THREE.Vector3): void {
    const len = 0.03 + this.rodLen * Math.max(0, remain);
    this.rod.scale.y = len;
    this.rod.position.y = len / 2;
    this.grip.position.y = len;
    this.holder.position.copy(tip);
    this.aim(cam, this.dR, this.q, normal, tip);
    this.holder.quaternion.copy(this.q);
  }

  placeHammer(tip: THREE.Vector3, cam: THREE.Camera, dt: number, normal?: THREE.Vector3): void {
    this.swing = Math.max(0, this.swing - dt * 7);
    const lift = Math.sin(Math.min(1, this.swing) * Math.PI);
    this.hammer.position.copy(tip);
    if (normal) this.hammer.position.addScaledVector(normal, 0.002 + lift * 0.04);
    else this.hammer.position.y += 0.002 + lift * 0.04;
    this.aim(cam, this.dR, this.q, normal, tip);
    this.hammer.quaternion.copy(this.q);
  }

  /** Tongs gripping the job at `at`; hidden when there is nothing to hold. */
  placeLeft(at: THREE.Vector3 | null, cam: THREE.Camera): void {
    this.left.visible = !!at;
    if (!at) return;
    this.left.position.copy(at);
    this.aim(cam, this.dL, this.q, undefined, at);
    this.left.quaternion.copy(this.q);
  }

  strike(): void {
    this.swing = 1;
  }

  /** Jagged arc between rod tip (top) and pool (bottom). */
  setBolt(top: THREE.Vector3, bottom: THREE.Vector3, amp: number, rng: { signed(): number }): void {
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      const e = Math.sin(t * Math.PI) * amp;
      this.boltPos[i * 3] = bottom.x + (top.x - bottom.x) * t + rng.signed() * e;
      this.boltPos[i * 3 + 1] = bottom.y + (top.y - bottom.y) * t;
      this.boltPos[i * 3 + 2] = bottom.z + (top.z - bottom.z) * t + rng.signed() * e;
    }
    (this.bolt.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Four long rays and four short ones: how a bright arc smears in the eye and on cheap glass. */
function starTex(): THREE.CanvasTexture {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d')!;
  const img = x.createImageData(S, S);
  for (let j = 0; j < S; j++)
    for (let i = 0; i < S; i++) {
      const u = (i + 0.5) / S - 0.5, v = (j + 0.5) / S - 0.5;
      const r = Math.hypot(u, v);
      const a = Math.atan2(v, u);
      const rays = Math.pow(Math.abs(Math.cos(a * 2)), 40) + Math.pow(Math.abs(Math.cos(a * 2 + Math.PI / 4)), 60) * 0.4;
      const k = Math.min(1, rays * Math.max(0, 1 - r * 2.1) + Math.max(0, 0.6 - r * 4) * 1.4);
      const p = (j * S + i) * 4;
      img.data[p] = img.data[p + 1] = img.data[p + 2] = Math.round(k * 255);
      img.data[p + 3] = 255;
    }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}
