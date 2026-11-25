import * as THREE from 'three';
import { lambert } from './ps1';
import { SKIN } from '../skin/default';
import { Textures, dialTex, counterTex } from './textures';

const Y = new THREE.Vector3(0, 1, 0);

/** A chunky leather gauntlet around a handle that runs along +y; the sleeve continues past it. */
function gauntlet(tx: Textures, mirror = false): THREE.Group {
  const g = new THREE.Group();
  const leather = lambert({ map: tx.leather, color: '#ffffff' });
  const leatherD = lambert({ map: tx.leather, color: '#b0a090' });
  const wool = lambert({ map: tx.wool, color: '#ffffff' });
  const s = mirror ? -1 : 1;
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    o.position.set(x * s, y, z);
    o.castShadow = true;
    g.add(o);
    return o;
  };
  // Back of the hand over the handle, a block of curled fingers, a thumb, a stitched band, a wide cuff.
  box(0.062, 0.088, 0.048, leather, 0.0, 0.04, 0.022);
  box(0.03, 0.082, 0.05, leatherD, -0.03, 0.04, -0.012);
  box(0.032, 0.006, 0.052, leatherD, -0.03, 0.02, -0.012);
  box(0.032, 0.006, 0.052, leatherD, -0.03, 0.06, -0.012);
  const th = box(0.022, 0.05, 0.022, leather, 0.03, 0.0, -0.02);
  th.rotation.z = 0.45 * s;
  box(0.066, 0.012, 0.052, leatherD, 0.0, 0.088, 0.022);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.042, 0.075, 6), leather);
  cuff.position.set(0, 0.13, 0.014);
  cuff.castShadow = true;
  g.add(cuff);
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.06, 0.7, 6), wool);
  sleeve.position.set(0, 0.52, 0.014);
  g.add(sleeve);
  return g;
}

/**
 * Hands and tools. The right hand holds the electrode holder (or the chipping hammer) and always reaches
 * in from the lower right of the view; the left hand holds pliers. A small ammeter sits in the corner of the view.
 */
export class Tools {
  readonly group = new THREE.Group();
  /** Holder: tip at the origin, rod along +y toward the hand. */
  readonly holder = new THREE.Group();
  readonly rod: THREE.Mesh;
  private grip = new THREE.Group();
  readonly hammer = new THREE.Group();
  readonly leftHand = new THREE.Group();
  readonly hud = new THREE.Group();
  private needle = new THREE.Group();
  private counter = counterTex();
  private shownAmps = -1;
  readonly arcGlow: THREE.Mesh;
  readonly arcStar: THREE.Mesh;
  readonly bolt: THREE.Line;
  private boltPos: Float32Array;
  readonly pool: THREE.Mesh;
  private swing = 0;
  /** Visible rod length when new (m). */
  readonly rodLen = 0.13;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private restTip = new THREE.Vector3();

  constructor(tx: Textures) {
    const dark = lambert({ color: '#161514' });
    // Holder.
    this.rod = new THREE.Mesh(new THREE.BoxGeometry(0.003, 1, 0.003), lambert({ color: '#5c5852' }));
    this.rod.castShadow = true;
    this.holder.add(this.rod);
    const jaws = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.05, 0.026), dark);
    jaws.position.y = 0.02;
    jaws.castShadow = true;
    this.grip.add(jaws);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.12, 6), lambert({ color: '#2a2420' }));
    handle.position.y = 0.1;
    this.grip.add(handle);
    const hand = gauntlet(tx);
    hand.position.y = 0.075;
    this.grip.add(hand);
    // Welding cable trailing off with the sleeve.
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.6, 5), dark);
    cable.position.set(0.035, 0.45, -0.03);
    this.grip.add(cable);
    this.holder.add(this.grip);
    this.group.add(this.holder);

    // Chipping hammer: the point is at the origin, the handle runs along +y to the hand.
    const metal = lambert({ map: tx.iron, color: '#d0d0d0' });
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.016, 0.016), metal);
    head.position.set(0.04, 0.012, 0);
    const tipG = new THREE.ConeGeometry(0.008, 0.02, 4);
    tipG.rotateZ(Math.PI / 2 + 0.6);
    const tip = new THREE.Mesh(tipG, metal);
    tip.position.set(0.004, 0.008, 0);
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.011, 0.24, 0.011), lambert({ map: tx.wood, color: '#d8c8b0' }));
    shaft.position.set(0.04, 0.13, 0);
    const hh = gauntlet(tx);
    hh.position.set(0.04, 0.17, 0);
    this.hammer.add(head, tip, shaft, hh);
    this.hammer.traverse((o) => (o.castShadow = true));
    this.hammer.visible = false;
    this.group.add(this.hammer);

    // Left hand with pliers, carried with the camera: the sleeve runs off the lower left, the pliers point in.
    this.leftHand.add(gauntlet(tx, true));
    const plM = lambert({ map: tx.iron, color: '#b0b0b0' });
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.009, 0.17, 0.006), plM);
      arm.position.set(s * 0.007, -0.05, -0.02);
      arm.rotation.z = s * 0.05;
      this.leftHand.add(arm);
    }
    const pivot = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.014, 6), plM);
    pivot.rotation.x = Math.PI / 2;
    pivot.position.set(0, -0.09, -0.02);
    this.leftHand.add(pivot);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.045, 0.008), plM);
    jaw.position.set(0, -0.155, -0.02);
    this.leftHand.add(jaw);
    this.leftHand.quaternion.setFromUnitVectors(Y, new THREE.Vector3(-0.5, -0.6, 0.62).normalize());

    // Ammeter in the corner of the view.
    const plate = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.4, 0.05), new THREE.MeshBasicMaterial({ map: tx.plate, color: '#8a8480' }));
    plate.position.y = -0.12;
    this.hud.add(plate);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.95), new THREE.MeshBasicMaterial({ map: dialTex(0.84, 1.5), color: '#d8d0c0' }));
    face.position.z = 0.03;
    this.hud.add(face);
    const nd = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.36, 0.01), new THREE.MeshBasicMaterial({ color: '#2a1e14' }));
    nd.position.y = 0.16;
    this.needle.add(nd);
    this.needle.position.z = 0.04;
    this.hud.add(this.needle);
    const cnt = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.26), new THREE.MeshBasicMaterial({ map: this.counter.tex, color: '#ffffff' }));
    cnt.position.set(0, -0.64, 0.03);
    this.hud.add(cnt);
    for (const [x, y] of [[-0.48, 0.47], [0.48, 0.47], [-0.48, -0.72], [0.48, -0.72]]) {
      const bolt = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.02), dark);
      bolt.position.set(x, y, 0.035);
      this.hud.add(bolt);
    }

    // The arc: bright core, a star of rays, and a jagged bolt between rod and pool.
    const arcCol = new THREE.Color(SKIN.light.arc.color);
    this.arcGlow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 8), new THREE.MeshBasicMaterial({ color: arcCol.clone().multiplyScalar(60), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.arcGlow.visible = false;
    this.group.add(this.arcGlow);
    this.arcStar = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: starTex(), color: arcCol.clone().multiplyScalar(6), transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
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

  /** Carry the left hand and the gauge with the camera. */
  attach(cam: THREE.PerspectiveCamera): void {
    cam.add(this.leftHand, this.hud);
    const fill = new THREE.PointLight('#ffd8b0', 0.22, 0.7, 2);
    fill.position.set(0, 0.1, 0.05);
    cam.add(fill);
  }

  /** Point from `tip` toward where the right arm comes from (below and right of the eye). */
  private aim(tip: THREE.Vector3, cam: THREE.Camera, out: THREE.Quaternion): number {
    // The arm comes in from below and to the right, toward the eye.
    const d = this.tmp2.set(0.5, -0.55, 0.65).normalize().applyQuaternion(cam.quaternion);
    out.setFromUnitVectors(Y, d);
    // Seen from close up the hand is drawn smaller, so it stays in the corner of the view.
    return Math.max(0.42, Math.min(1, cam.position.distanceTo(tip) / 0.5));
  }

  /** Electrode holder with its tip at `tip`. `remain` is 0..1 of the rod left. */
  placeHolder(tip: THREE.Vector3, cam: THREE.Camera, remain: number): void {
    const len = 0.025 + this.rodLen * Math.max(0, remain);
    this.rod.scale.y = len;
    this.rod.position.y = len / 2;
    this.grip.position.y = len;
    this.holder.position.copy(tip);
    this.holder.scale.setScalar(this.aim(tip, cam, this.q));
    this.holder.quaternion.copy(this.q);
  }

  /** Holder resting in the hand at the lower right of the view. */
  rest(cam: THREE.Camera): void {
    const tip = this.restTip.set(0.1, -0.05, -0.4);
    cam.localToWorld(tip);
    this.placeHolder(tip, cam, 0.6);
  }

  placeHammer(tip: THREE.Vector3, cam: THREE.Camera, dt: number): void {
    this.swing = Math.max(0, this.swing - dt * 7);
    const lift = Math.sin(Math.min(1, this.swing) * Math.PI);
    this.hammer.position.copy(tip);
    this.hammer.position.y += 0.002 + lift * 0.03;
    this.hammer.scale.setScalar(this.aim(tip, cam, this.q) * 0.8);
    this.hammer.quaternion.copy(this.q);
  }

  strike(): void {
    this.swing = 1;
  }

  /** Keep the left hand and the gauge in the corners whatever the field of view. */
  placeHud(cam: THREE.PerspectiveCamera, I: number, show: boolean): void {
    const D = 0.3;
    const hh = D * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const hw = hh * cam.aspect;
    const s = hh * 0.26;
    this.hud.visible = show;
    this.hud.position.set(hw - s * 0.8, hh - s * 0.95, -D);
    this.hud.scale.setScalar(s);
    const f = Math.max(0, Math.min(1.5, I)) / 1.5;
    this.needle.rotation.z = (2 / 3) * Math.PI - f * (4 / 3) * Math.PI;
    const amps = Math.round(I * 110);
    if (amps !== this.shownAmps) {
      this.shownAmps = amps;
      this.counter.redraw(String(amps).padStart(3, '0'));
    }
    const k = hh / D;
    this.leftHand.position.set(-0.42 * k * 0.25 * cam.aspect, -0.5 * k * 0.25, -0.25);
    this.leftHand.scale.setScalar(k * 0.9);
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
      const rays = Math.pow(Math.abs(Math.cos(a * 2)), 40) * 1.0 + Math.pow(Math.abs(Math.cos(a * 2 + Math.PI / 4)), 60) * 0.4;
      let k = rays * Math.max(0, 1 - r * 2.1) + Math.max(0, 0.6 - r * 4) * 1.4;
      k = Math.min(1, k);
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
