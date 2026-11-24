import * as THREE from 'three';
import { lambert } from './ps1';
import { SKIN } from '../skin/default';

/** The electrode holder with its rod and a gloved hand, the chipping hammer, and the arc itself. */
export class Tools {
  readonly group = new THREE.Group();
  readonly holder = new THREE.Group();
  readonly rod: THREE.Mesh;
  readonly hammer = new THREE.Group();
  private hammerHead = new THREE.Group();
  readonly arcGlow: THREE.Mesh;
  readonly arcGlowMat: THREE.MeshBasicMaterial;
  readonly bolt: THREE.Line;
  private boltPos: Float32Array;
  readonly pool: THREE.Mesh;
  readonly poolMat: THREE.MeshBasicMaterial;
  private swing = 0;
  /** Rod length when new (m). */
  readonly rodLen = 0.2;

  constructor() {
    const dark = lambert({ color: '#151311' });
    const glove = lambert({ color: '#5a4030' });
    const rodM = lambert({ color: '#4c4a46' });
    // Holder: the rod sticks out of the jaws; the tip is at the group's origin.
    this.rod = new THREE.Mesh(new THREE.BoxGeometry(0.0028, 1, 0.0028), rodM);
    this.rod.castShadow = true;
    this.holder.add(this.rod);
    const jaws = new THREE.Group();
    jaws.add(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.045, 0.02), dark));
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.12, 6), dark);
    handle.position.y = 0.08;
    jaws.add(handle);
    const g1 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.05), glove);
    g1.position.set(0.0, 0.1, 0.02);
    jaws.add(g1);
    const g2 = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.11, 0.07), glove);
    g2.position.set(0.01, 0.18, 0.04);
    jaws.add(g2);
    jaws.traverse((o) => (o.castShadow = true));
    jaws.name = 'jaws';
    this.holder.add(jaws);
    this.group.add(this.holder);

    // Chipping hammer, built around its pointed tip (the origin) so the tip lands where the player clicks.
    const metal = lambert({ color: '#4a4a4e' });
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.016, 0.016), metal);
    head.position.set(0.055, 0, 0);
    const tipG = new THREE.ConeGeometry(0.008, 0.022, 4);
    tipG.rotateZ(Math.PI / 2);
    const tip = new THREE.Mesh(tipG, metal);
    tip.position.set(0.011, 0, 0);
    const hh = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.2, 0.012), lambert({ color: '#5a4630' }));
    hh.position.set(0.075, 0.1, 0);
    this.hammerHead.add(head, tip, hh);
    this.hammerHead.traverse((o) => (o.castShadow = true));
    this.hammer.add(this.hammerHead);
    this.hammer.scale.setScalar(0.55);
    this.hammer.visible = false;
    this.group.add(this.hammer);

    // Arc: a bright core billboard and a jagged bolt between rod and pool.
    this.arcGlowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(SKIN.light.arc.color).multiplyScalar(60), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.arcGlow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 8), this.arcGlowMat);
    this.arcGlow.visible = false;
    this.group.add(this.arcGlow);
    this.boltPos = new Float32Array(6 * 3);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(this.boltPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.bolt = new THREE.Line(bg, new THREE.LineBasicMaterial({ color: new THREE.Color(0.9, 0.95, 1).multiplyScalar(80) }));
    this.bolt.frustumCulled = false;
    this.bolt.visible = false;
    this.group.add(this.bolt);
    this.poolMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.85, 0.5).multiplyScalar(8), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const pg = new THREE.CircleGeometry(1, 8);
    pg.rotateX(-Math.PI / 2);
    this.pool = new THREE.Mesh(pg, this.poolMat);
    this.pool.visible = false;
    this.group.add(this.pool);
  }

  /**
   * Place the holder: tip at `tip`, leaning back from the travel direction and toward the welder.
   * `remain` is 0..1 of the rod left.
   */
  placeHolder(tip: THREE.Vector3, yaw: number, remain: number): void {
    const len = 0.03 + this.rodLen * Math.max(0, remain);
    this.rod.scale.y = len;
    this.rod.position.y = len / 2;
    const jaws = this.holder.getObjectByName('jaws')!;
    jaws.position.y = len + 0.01;
    this.holder.position.copy(tip);
    this.holder.rotation.set(-0.55, yaw, -0.45, 'YXZ');
  }

  /** Lay the holder down on the bench when not in hand. */
  rest(pos: THREE.Vector3): void {
    this.rod.scale.y = 0.2;
    this.rod.position.y = 0.1;
    this.holder.getObjectByName('jaws')!.position.y = 0.21;
    this.holder.position.copy(pos);
    this.holder.rotation.set(Math.PI / 2 - 0.05, 0.4, 0, 'YXZ');
  }

  placeHammer(at: THREE.Vector3, dt: number): void {
    this.hammer.position.copy(at);
    this.swing = Math.max(0, this.swing - dt * 7);
    const lift = Math.sin(Math.min(1, this.swing) * Math.PI);
    this.hammerHead.rotation.set(-0.5, -0.5, 0.55 + lift * 0.7);
    this.hammerHead.position.set(0, 0.002 + lift * 0.025, 0);
  }

  strike(): void {
    this.swing = 1;
  }

  /** Jagged arc between rod tip (top) and pool (bottom); `jit` is random -1..1 values. */
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
