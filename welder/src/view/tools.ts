import * as THREE from 'three';
import { lambert } from './ps1';
import { SKIN } from '../skin/default';
import type { Textures } from './textures';
import { holdingHand, gripFrame, type Hand } from './hand';

const Y = new THREE.Vector3(0, 1, 0);
const D2R = Math.PI / 180;
/** How obliquely the left fist holds the tongs (degrees): the handles run out of it toward the job. */
const L_OBL = 60;

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
  // View space: which way each tool's handle runs from its working end, and where each elbow is.
  // The rod stands up off the work, leaning right; the forearm comes from the fist toward you, low on the right.
  private hR = new THREE.Vector3(0.35, 0.6, 0.72).normalize();
  private eR = new THREE.Vector3(0.75, -0.5, 0.45).normalize();
  // The electrode holder: the rod rises from the work up and toward you to the jaws; the handle runs off to
  // the right across the palm; the forearm comes from below, toward you.
  // The chipping hammer: the shaft rises from the head up and right into the fist.
  private hHammer = new THREE.Vector3(0.45, -0.25, 0.85).normalize();
  // A welder's hold: the fist on the right, the handle slanting through it (an oblique power grip) and out by
  // the thumb to the left, the head and rod going down into the work; the forearm down and to the right.
  private rodUp = new THREE.Vector3(0.55, -0.1, 0.83).normalize();
  private hHolder = new THREE.Vector3(0.82, -0.2, 0.54).normalize();
  private eHolder = new THREE.Vector3(0.45, -0.85, 0.25).normalize();
  private eHammer = new THREE.Vector3(0.35, -0.75, 0.55).normalize();
  private tE = new THREE.Vector3();
  readonly handR: Hand;
  readonly handH: Hand;
  readonly handL: Hand;
  /**
   * How much bigger than life the hands and tools are drawn, so the fists read at the game's few pixels the
   * way hands do in a first-person view (a stylised view model). Scaled about the working end: the tip of
   * the rod, the point of the hammer and the jaws of the tongs stay exactly where they work.
   */
  k = 1.8;
  lastD = 0;
  /** The enlargement at this distance from the eye: full far off, life size when the camera leans in close. */
  private kAt(cam: THREE.Camera, at: THREE.Vector3): number {
    const d = cam.position.distanceTo(at);
    this.lastD = d;
    // Full enlargement at the usual bench distance (~0.93 m), life size by the time the eye leans in (0.7 m).
    const t = Math.min(1, Math.max(0, (d - 0.7) / 0.22));
    return 1 + (this.k - 1) * t * t * (3 - 2 * t);
  }
  private tmp = new THREE.Vector3();
  private q = new THREE.Quaternion();

  constructor(tx: Textures) {
    const dark = lambert({ color: '#161514' });
    // The holder, in its own frame: the jaws at the origin, the insulated handle running along +y across
    // the palm, the forearm leaving the fist along +x. The rod is clamped in the jaws at an angle and points
    // down into the work (set each frame).
    this.rod = new THREE.Mesh(new THREE.BoxGeometry(0.004, 1, 0.004), lambert({ color: '#6c665c' }));
    this.rod.castShadow = true;
    this.holder.add(this.rod);
    // The holder: sprung jaws on a long insulated handle.
    // Head: an insulated sleeve tapering to two copper jaws that bite the rod.
    const sleeveH = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.011, 0.05, 6), dark);
    sleeveH.position.y = 0.03;
    sleeveH.castShadow = true;
    this.grip.add(sleeveH);
    const copper = lambert({ color: '#b06a38', flatShading: true });
    for (const sx of [-1, 1]) {
      const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.007, 0.016, 0.014), copper);
      jaw.position.set(sx * 0.005, 0.0, 0);
      this.grip.add(jaw);
    }
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.11, 0.012), lambert({ map: tx.iron, color: '#c0b8b0' }));
    lever.position.set(0.02, 0.08, -0.015);
    lever.rotation.z = -0.15;
    this.grip.add(lever);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.02, 0.14, 6), lambert({ color: '#2a2420' }));
    handle.position.y = 0.12;
    this.grip.add(handle);
    const hr = holdingHand(0.019, 0.12, 0, false, 25);
    this.handR = hr.hand;
    this.grip.add(hr.group);
    // The cable leaves the end of the handle and runs off behind the hand.
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.2, 5), dark);
    cable.geometry.translate(0, 0.1, 0);
    cable.rotation.z = -Math.atan2(1, -0.7);
    cable.position.set(0, 0.185, 0.012);
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
    const hh = holdingHand(0.0085, 0.2, 0.045);
    this.handH = hh.hand;
    this.hammer.add(head, tip, shaft, hh.group);
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
    const lh = holdingHand(0.016, 0.14, 0, true, L_OBL);
    this.handL = lh.hand;
    this.left.add(lh.group);
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

  /**
   * Orient a tool held in a fist: the handle runs from the working end along `handle` (view space), leaned out
   * of the surface it touches so it never sinks into the work, and the forearm leaves the fist toward `elbow`.
   */
  private aim(cam: THREE.Camera, handle: THREE.Vector3, elbow: THREE.Vector3, out: THREE.Quaternion, normal?: THREE.Vector3): void {
    const d = this.tmp.copy(handle).applyQuaternion(cam.quaternion);
    if (normal && d.dot(normal) < 0.35) d.addScaledVector(normal, 0.35 - d.dot(normal)).normalize();
    gripFrame(d, this.tE.copy(elbow).applyQuaternion(cam.quaternion), out);
  }

  /** Electrode holder with its tip at `tip`. `remain` is 0..1 of the rod left. */
  placeHolder(tip: THREE.Vector3, cam: THREE.Camera, remain: number, normal?: THREE.Vector3): void {
    const len = 0.03 + this.rodLen * Math.max(0, remain);
    // The rod, from the tip up to the jaws: down into the work from the hand, leaned out of the surface.
    const up = this.tmp.copy(this.rodUp).applyQuaternion(cam.quaternion);
    if (normal && up.dot(normal) < 0.4) up.addScaledVector(normal, 0.4 - up.dot(normal)).normalize();
    const k = this.kAt(cam, tip);
    this.holder.scale.setScalar(k);
    this.holder.position.copy(tip).addScaledVector(up, len * k);
    gripFrame(this.tH.copy(this.hHolder).applyQuaternion(cam.quaternion), this.tE.copy(this.eHolder).applyQuaternion(cam.quaternion), this.q);
    this.holder.quaternion.copy(this.q);
    // In the holder's frame the rod runs from the jaws (origin) back down to the tip.
    const d = up.negate().applyQuaternion(this.qi.copy(this.q).invert());
    this.rod.quaternion.setFromUnitVectors(Y, d);
    this.rod.scale.y = len;
    this.rod.position.copy(d).multiplyScalar(len / 2);
  }
  private tH = new THREE.Vector3();
  private tZ = new THREE.Vector3();
  /** The chipping hammer in view space: the arm (and head) toward the eye from the lower right; the shaft. */
  private hArm = new THREE.Vector3(0.3, -0.3, 0.9).normalize();
  private hShaft = new THREE.Vector3(0.8, 0.5, 0.3).normalize();
  private mB = new THREE.Matrix4();
  private qi = new THREE.Quaternion();

  placeHammer(tip: THREE.Vector3, cam: THREE.Camera, dt: number, normal?: THREE.Vector3): void {
    this.swing = Math.max(0, this.swing - dt * 7);
    const lift = Math.sin(Math.min(1, this.swing) * Math.PI);
    this.hammer.scale.setScalar(this.kAt(cam, tip));
    this.hammer.position.copy(tip);
    if (normal) this.hammer.position.addScaledVector(normal, 0.002 + lift * 0.04);
    else this.hammer.position.y += 0.002 + lift * 0.04;
    if (normal) {
      // The forearm leaves the fist along +x, the way the head points: toward the eye from the lower right,
      // and always out of the surface, so only the point touches the job. The shaft runs across, up and right.
      const x = this.tE.copy(this.hArm).applyQuaternion(cam.quaternion);
      if (x.dot(normal) < 0.3) x.addScaledVector(normal, 0.3 - x.dot(normal));
      x.normalize();
      const y = this.tH.copy(this.hShaft).applyQuaternion(cam.quaternion);
      y.addScaledVector(x, -y.dot(x)).normalize();
      this.q.setFromRotationMatrix(this.mB.makeBasis(x, y, this.tZ.crossVectors(x, y)));
    } else this.aim(cam, this.hHammer, this.eHammer, this.q);
    this.hammer.quaternion.copy(this.q);
  }

  /**
   * Tongs gripping the job at `at`; hidden when there is nothing to hold. Posed from the hand, not the tool,
   * the way one holds pliers out in front: the left fist stands thumb-up, its back turned out to the left and
   * a little up, the knuckles pointing ahead, down to the bench and a little right (reaching for the work),
   * the forearm running back to the lower left.
   * The tongs leave the fist by the thumb, where the oblique grip sends them: ahead and up to the job.
   */
  placeLeft(at: THREE.Vector3 | null, cam: THREE.Camera): void {
    this.left.visible = !!at;
    if (!at) return;
    // The left hand only steadies the job: a little smaller, so it never crowds the work.
    this.left.scale.setScalar(1 + (this.kAt(cam, at) - 1) * 0.6);
    this.left.position.copy(at);
    const distal = this.lDis.copy(this.lDist).normalize();
    const back = this.lRt.copy(this.lBack).addScaledVector(distal, -this.lBack.dot(distal)).normalize();
    // A left hand: back = radial × distal, so the thumb side is distal × back.
    const radial = this.lRad.crossVectors(distal, back);
    // In the tool's frame the hand's radial and distal axes are fixed by the grip (holdingHand); invert that.
    const co = Math.cos(L_OBL * D2R), so = Math.sin(L_OBL * D2R);
    const x = this.tH.copy(radial).multiplyScalar(so).addScaledVector(distal, -co);
    const y = this.tE.copy(radial).multiplyScalar(-co).addScaledVector(distal, -so);
    this.q.setFromRotationMatrix(this.mB.makeBasis(x, y, this.tZ.crossVectors(x, y)));
    this.left.quaternion.copy(cam.quaternion).multiply(this.q);
    // When the job is held right up to the eye (a flipped pan, leaning in) the fist and forearm would come
    // within a hand of it and fill the picture: then the left arm stays out of view, below the frame.
    // Two thresholds, so it does not flicker at the edge.
    this.left.updateMatrixWorld(true);
    cam.updateMatrixWorld();
    const near = Math.max(this.viewZ(cam, 0, 0.14), this.viewZ(cam, 0.25 * co, 0.14 + 0.25 * so));
    this.leftNear = near;
    if (this.leftOut ? near < -0.15 : near > -0.11) this.leftOut = !this.leftOut;
    this.left.visible = !this.leftOut;
  }
  private leftOut = false;
  leftNear = 0;
  /** View-space z of a point of the tongs' frame (negative is in front of the eye). */
  private viewZ(cam: THREE.Camera, x: number, y: number): number {
    return this.tmp.set(x, y, 0).applyMatrix4(this.left.matrixWorld).applyMatrix4(cam.matrixWorldInverse).z;
  }
  /** The left fist in view space: where its knuckles point, and where the back of the hand faces. */
  lDist = new THREE.Vector3(0.29, -0.3, -0.91);
  lBack = new THREE.Vector3(-0.86, 0.41, 0.31);
  private lRt = new THREE.Vector3();
  private lRad = new THREE.Vector3();
  private lDis = new THREE.Vector3();

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
