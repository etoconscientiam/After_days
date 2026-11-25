import * as THREE from 'three';
import type { SeamRun } from '../sim/seam';
import { seamPoint } from '../sim/seam';
import { F_COLD, F_HOT, F_LONG, F_PORE, F_BACK, F_OFF } from '../sim/seam';
import { SKIN } from '../skin/default';

/** Anything that owns seams: a bench, or the finished gate kept for the end card. */
export interface BeadSource {
  seams: SeamRun[];
  rev: number;
  stage: string;
}

const MM = 0.001;
const CAP = 3200;

/** GLSL ramp of hot steel: dark → cherry → orange → yellow → white. Shared by the bead and the holes. */
export const GLOW_GLSL = `
vec3 glowRamp(float h) {
  vec3 c = vec3(0.0);
  c = mix(c, vec3(0.20, 0.010, 0.0), smoothstep(0.06, 0.28, h));
  c = mix(c, vec3(0.85, 0.10, 0.0), smoothstep(0.28, 0.65, h));
  c = mix(c, vec3(1.0, 0.45, 0.06), smoothstep(0.65, 1.1, h));
  c = mix(c, vec3(1.0, 0.85, 0.45), smoothstep(1.1, 1.6, h));
  c = mix(c, vec3(1.0, 0.98, 0.9), smoothstep(1.6, 2.4, h));
  return c * (0.25 + 2.2 * h * h);
}
`;

function glowMaterial(params: THREE.MeshLambertMaterialParameters, glowK: { value: number }) {
  const m = new THREE.MeshLambertMaterial(params);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uGlowK = glowK;
    sh.vertexShader = 'attribute float aGlow;\nvarying float vGlow;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    sh.fragmentShader =
      'varying float vGlow;\nuniform float uGlowK;\n' +
      GLOW_GLSL +
      sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += glowRamp(vGlow) * uGlowK;');
  };
  m.customProgramCacheKey = () => 'glow';
  return m;
}

/**
 * Builds the weld bead from the sim's ripple points: every ripple is a flattened half-ellipsoid laid along the
 * joint. Even tempo gives even overlapping scales; jerky hands and wrong arc length show up as lumps, gaps,
 * pores and spatter. Hot metal glows from the seam's heat field and cools smoothly.
 */
export class BeadView {
  readonly group = new THREE.Group();
  private ripples: THREE.InstancedMesh;
  private rGlow: THREE.InstancedBufferAttribute;
  private holes: THREE.InstancedMesh;
  private hGlow: THREE.InstancedBufferAttribute;
  private dots: THREE.InstancedMesh;
  private pores: THREE.InstancedMesh;
  private grooves: THREE.Mesh[] = [];
  private grooveMat: THREE.MeshBasicMaterial;
  private hiMat: THREE.MeshBasicMaterial;
  private hi: THREE.Mesh[] = [];
  private src: BeadSource | null = null;
  /** Moves a point (part-local mm) along -n onto the part's surface; used for spatter on curved parts. */
  private snap: (p: THREE.Vector3, n: THREE.Vector3) => void = () => {};
  private rev = -1;
  private stage = '';
  /** View clock (s), and when each ripple of each seam first appeared, so the bead cools and crusts over. */
  private clock = 0;
  private born: Float32Array[] = [];
  /** Bare-metal colour of each ripple instance (before crust). */
  private baseCol = new Float32Array(CAP * 3);
  /** The molten pool under the arc, its glowing tail, and the aim mark on the joint. */
  readonly pool: THREE.Mesh;
  readonly tail: THREE.Mesh;
  readonly mark: THREE.Group;
  private markMat: THREE.MeshBasicMaterial;
  private markFill: THREE.Mesh;
  /** Chalk dashes either side of each joint, drawn when the job comes in. */
  private chalk: THREE.Mesh[] = [];
  private chalkMat = new THREE.MeshLambertMaterial({ color: '#ece6d6', polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  /** While chipping: a warm pulsing band over every stretch that still has slag on it. */
  private slagBand: THREE.Mesh;
  private slagMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb040').multiplyScalar(1.4), transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  /** A glint that runs along the joint to weld next. */
  readonly glint: THREE.Mesh;
  private glintT = 0;
  readonly glowK = { value: SKIN.glow.k };
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpQ2 = new THREE.Quaternion();
  private tmpP = new THREE.Vector3();
  private tmpS = new THREE.Vector3();
  private tmpC = new THREE.Color();
  private tmpC2 = new THREE.Color();
  private side = new THREE.Vector3(0, 0, 1);
  private pt = seamPoint();
  private ax = new THREE.Vector3();
  private ay = new THREE.Vector3();
  private az = new THREE.Vector3();
  private nv = new THREE.Vector3();
  private metal = new THREE.Color(SKIN.palette.bead);
  private slag = new THREE.Color(SKIN.palette.slag);
  private straw = new THREE.Color('#9a7a4a');
  private blue = new THREE.Color('#4a5a7a');
  private dull = new THREE.Color('#4c4a48');
  /** Index ranges of each seam's ripples inside the instanced mesh. */
  private ranges: [number, number][] = [];

  constructor() {
    const half = new THREE.SphereGeometry(1, 12, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    // Bake light fronts and dark backs into each ripple: overlapped, they read as fish scales.
    const hp = half.attributes.position as THREE.BufferAttribute;
    const vc = new Float32Array(hp.count * 3);
    for (let i = 0; i < hp.count; i++) {
      const x = hp.getX(i), z = hp.getZ(i);
      const f = Math.min(1, Math.max(0, (x + 0.9) / 1.6));
      const k = (0.45 + 0.55 * f * f) * (0.8 + 0.2 * (1 - Math.abs(z)));
      vc[i * 3] = vc[i * 3 + 1] = vc[i * 3 + 2] = k;
    }
    half.setAttribute('color', new THREE.BufferAttribute(vc, 3));
    this.rGlow = new THREE.InstancedBufferAttribute(new Float32Array(CAP), 1);
    half.setAttribute('aGlow', this.rGlow);
    this.ripples = new THREE.InstancedMesh(half, glowMaterial({ color: '#ffffff', vertexColors: true }, this.glowK), CAP);
    this.ripples.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
    this.ripples.count = 0;
    this.ripples.castShadow = false;
    this.ripples.receiveShadow = true;
    this.ripples.frustumCulled = false;

    const disc = new THREE.CircleGeometry(1, 7);
    disc.rotateX(-Math.PI / 2);
    this.hGlow = new THREE.InstancedBufferAttribute(new Float32Array(256), 1);
    disc.setAttribute('aGlow', this.hGlow);
    this.holes = new THREE.InstancedMesh(disc, glowMaterial({ color: '#050302' }, this.glowK), 256);
    this.holes.count = 0;
    this.holes.frustumCulled = false;

    this.dots = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: '#56514c', flatShading: true }), 400);
    this.dots.count = 0;
    this.dots.frustumCulled = false;
    const pdisc = new THREE.CircleGeometry(1, 5);
    pdisc.rotateX(-Math.PI / 2);
    this.pores = new THREE.InstancedMesh(pdisc, new THREE.MeshBasicMaterial({ color: '#070605' }), 400);
    this.pores.count = 0;
    this.pores.frustumCulled = false;

    this.grooveMat = new THREE.MeshBasicMaterial({ color: '#050403', side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.hiMat = new THREE.MeshBasicMaterial({ color: '#c89a70', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.group.add(this.ripples, this.holes, this.dots, this.pores);

    // Molten pool: a white-hot lens of metal with an orange tail where it is freezing behind the arc.
    const lens = new THREE.SphereGeometry(1, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2);
    this.pool = new THREE.Mesh(lens, new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.88, 0.62).multiplyScalar(9) }));
    this.tail = new THREE.Mesh(lens, new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.38, 0.06).multiplyScalar(4) }));
    this.pool.visible = this.tail.visible = false;
    this.pool.frustumCulled = this.tail.frustumCulled = false;
    // Aim mark: a ring on the joint where the rod would strike.
    const ring = new THREE.RingGeometry(0.78, 1, 20);
    ring.rotateX(-Math.PI / 2);
    this.markMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    const fill = new THREE.CircleGeometry(1, 20);
    fill.rotateX(-Math.PI / 2);
    this.markFill = new THREE.Mesh(fill, this.markMat);
    this.mark = new THREE.Group();
    this.mark.add(new THREE.Mesh(ring, this.markMat), this.markFill);
    this.mark.traverse((o) => (o.renderOrder = 20));
    this.mark.visible = false;
    this.glint = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.9, 0.7).multiplyScalar(3), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.glint.visible = false;
    this.slagBand = new THREE.Mesh(new THREE.BufferGeometry(), this.slagMat);
    this.slagBand.renderOrder = 3;
    this.slagBand.visible = false;
    this.group.add(this.pool, this.tail, this.mark, this.glint, this.slagBand);
  }

  /** Chalk: short dashes along both sides of the joint, laid onto the surface. */
  private chalkFor(sr: SeamRun): THREE.BufferGeometry {
    const pos: number[] = [];
    const p = this.pt;
    const A = new THREE.Vector3(), N = new THREE.Vector3(), T = new THREE.Vector3(), B = new THREE.Vector3();
    const step = 7, dash = 4, half = 0.8;
    const n = Math.max(1, Math.floor(sr.len / step));
    const pitch = sr.len / n;
    for (let i = 0; i < n; i++) {
      const s = (i + 0.5) * pitch;
      sr.pointAt(s, p);
      for (const side of [-1, 1]) {
        const off = side * 6.5;
        A.set(p.x + p.bx * off, p.y + p.by * off, p.z + p.bz * off);
        N.set(p.nx, p.ny, p.nz);
        this.snap(A, N);
        A.addScaledVector(N, 0.35);
        T.set(p.tx, p.ty, p.tz).multiplyScalar(dash / 2);
        B.set(p.bx, p.by, p.bz).multiplyScalar(half);
        const q = [
          [A.x - T.x - B.x, A.y - T.y - B.y, A.z - T.z - B.z],
          [A.x + T.x - B.x, A.y + T.y - B.y, A.z + T.z - B.z],
          [A.x + T.x + B.x, A.y + T.y + B.y, A.z + T.z + B.z],
          [A.x - T.x + B.x, A.y - T.y + B.y, A.z - T.z + B.z],
        ];
        for (const k of [0, 1, 2, 0, 2, 3]) pos.push(q[k][0] * MM, q[k][1] * MM, q[k][2] * MM);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  }

  /** Run a glint along the joint to weld next (seam -1 hides it). */
  setGlint(seam: number, dt: number): void {
    const sr = seam >= 0 ? this.src?.seams[seam] : undefined;
    if (!sr) {
      this.glint.visible = false;
      this.glintT = 0;
      return;
    }
    this.glintT += dt;
    const speed = 110;
    const cycle = sr.len / speed + 1.2;
    const t = this.glintT % cycle;
    const s = t * speed;
    this.glint.visible = s <= sr.len;
    if (!this.glint.visible) return;
    sr.pointAt(s, this.pt);
    const p = this.pt;
    this.glint.position.set((p.x + p.nx * 1.5) * MM, (p.y + p.ny * 1.5) * MM, (p.z + p.nz * 1.5) * MM);
    this.glint.scale.setScalar(2.6 * MM);
  }

  /** Put a point of seam `seam` at (s, d) and its frame into this.pt; returns false if there's no such seam. */
  private at(seam: number, s: number): boolean {
    const sr = this.src?.seams[seam];
    if (!sr) return false;
    sr.pointAt(s, this.pt);
    return true;
  }

  /** The molten pool under the arc: size from the heat at the pool, stretched back along the run. */
  setPool(on: boolean, seam = -1, s = 0, d = 0, heat = 0, dir = 1, flick = 1): void {
    this.pool.visible = this.tail.visible = on && this.at(seam, s);
    if (!this.pool.visible) return;
    const p = this.pt;
    const r = (3.4 + 1.8 * Math.min(2, heat)) * flick;
    const M = this.tmpM, P = this.tmpP, S = this.tmpS;
    this.frame(dir, this.tmpQ);
    P.set((p.x + p.bx * d + p.nx * 0.4) * MM, (p.y + p.by * d + p.ny * 0.4) * MM, (p.z + p.bz * d + p.nz * 0.4) * MM);
    S.set(r * 1.15 * MM, r * 0.45 * MM, r * MM);
    M.compose(P, this.tmpQ, S);
    this.pool.matrixAutoUpdate = false;
    this.pool.matrix.copy(M);
    const back = -dir * r * 1.6;
    P.set((p.x + p.bx * d + p.tx * back + p.nx * 0.3) * MM, (p.y + p.by * d + p.ty * back + p.ny * 0.3) * MM, (p.z + p.bz * d + p.tz * back + p.nz * 0.3) * MM);
    S.set(r * 2.2 * MM, r * 0.38 * MM, r * 0.85 * MM);
    M.compose(P, this.tmpQ, S);
    this.tail.matrixAutoUpdate = false;
    this.tail.matrix.copy(M);
  }

  /**
   * Where the rod would land: green on a joint it can strike, amber when close but off it, red when the joint
   * faces away. `k` (0..1) fills the ring while the strike is coming.
   */
  setMark(state: '' | 'ok' | 'near' | 'away' | 'chip', seam = -1, s = 0, k = 0): void {
    this.mark.visible = state !== '' && this.at(seam, s);
    if (!this.mark.visible) return;
    const p = this.pt;
    this.mark.position.set((p.x + p.nx * 1.2) * MM, (p.y + p.ny * 1.2) * MM, (p.z + p.nz * 1.2) * MM);
    this.frame(1, this.mark.quaternion);
    const r = state === 'ok' ? 6 : 8;
    this.mark.scale.setScalar(r * MM);
    this.markMat.color.set(state === 'ok' ? '#9cff7a' : state === 'chip' ? '#ffb040' : state === 'near' ? '#ffc24a' : '#ff5a3a').multiplyScalar(state === 'ok' ? 2.5 : 2);
    this.markFill.visible = state === 'ok' && k > 0;
    this.markFill.scale.setScalar(Math.max(0.05, k) * 0.7);
  }

  attach(src: BeadSource | null, snap: (p: THREE.Vector3, n: THREE.Vector3) => void = () => {}): void {
    for (const g of this.grooves) {
      this.group.remove(g);
      g.geometry.dispose();
    }
    for (const g of this.hi) {
      this.group.remove(g);
      g.geometry.dispose();
    }
    for (const g of this.chalk) {
      this.group.remove(g);
      g.geometry.dispose();
    }
    this.chalk = [];
    this.grooves = [];
    this.hi = [];
    this.src = src;
    this.snap = snap;
    this.rev = -1;
    // Ripples already there (the gate kept for the end card) are cold; new ones are stamped as they appear.
    this.born = src ? src.seams.map((sr) => new Float32Array(sr.cap).fill(Number.NaN).fill(-1e9, 0, sr.count)) : [];
    this.pool.visible = this.tail.visible = this.mark.visible = false;
    this.ripples.count = this.holes.count = this.dots.count = this.pores.count = 0;
    if (!src) return;
    for (const sr of src.seams) {
      const g = new THREE.Mesh(this.ribbon(sr, 2.2, 0.5), this.grooveMat);
      g.renderOrder = 1;
      this.grooves.push(g);
      this.group.add(g);
      const h = new THREE.Mesh(this.ribbon(sr, 5, 0.8), this.hiMat);
      h.renderOrder = 2;
      this.hi.push(h);
      this.group.add(h);
      const c = new THREE.Mesh(this.chalkFor(sr), this.chalkMat);
      c.receiveShadow = true;
      this.chalk.push(c);
      this.group.add(c);
    }
  }

  /** Thin strip along the joint (the crack or gap to be welded), lifted off the surface along its normal. */
  private ribbon(sr: SeamRun, width: number, lift: number): THREE.BufferGeometry {
    const n = Math.max(2, Math.ceil(sr.len / 2));
    const pos: number[] = [];
    const idx: number[] = [];
    const p = this.pt;
    for (let i = 0; i <= n; i++) {
      sr.pointAt((sr.len * i) / n - (sr.closed && i === n ? 0.001 : 0), p);
      for (const k of [-1, 1]) {
        const w = k * width * 0.5;
        pos.push((p.x + p.bx * w + p.nx * lift) * MM, (p.y + p.by * w + p.ny * lift) * MM, (p.z + p.bz * w + p.nz * lift) * MM);
      }
      if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
  }

  /** Which seam to highlight (-1 none) and how strongly. Steady, no pulsing. */
  highlight(seam: number, k: number): void {
    this.hiMat.opacity = k * 0.16;
    for (let i = 0; i < this.hi.length; i++) this.hi[i].visible = i === seam && k > 0;
  }

  update(dt = 0): void {
    this.clock += dt;
    if (this.slagBand.visible) this.slagMat.opacity = 0.22 + 0.16 * Math.sin(this.clock * 5);
    const src = this.src;
    if (!src) return;
    if (src.rev !== this.rev || src.stage !== this.stage) {
      this.rev = src.rev;
      this.stage = src.stage;
      this.rebuild();
    }
    this.updateGlow();
  }

  /** The band over the slag still to knock off (rebuilt with the bead). */
  private buildSlagBand(src: BeadSource): void {
    const g = this.slagBand.geometry;
    if (src.stage !== 'chip') {
      this.slagBand.visible = false;
      return;
    }
    const pos: number[] = [];
    const p = this.pt;
    const half = 5, lift = 3.2;
    for (const sr of src.seams) {
      for (let c = 0; c < sr.n; c++) {
        if (sr.slag[c] <= 0) continue;
        const s0 = c * sr.cell, s1 = (c + 1) * sr.cell;
        const quad: number[][] = [];
        for (const s of [s0, s1]) {
          sr.pointAt(Math.min(sr.len, s), p);
          for (const k of [-1, 1]) quad.push([(p.x + p.bx * half * k + p.nx * lift) * MM, (p.y + p.by * half * k + p.ny * lift) * MM, (p.z + p.bz * half * k + p.nz * lift) * MM]);
        }
        for (const i of [0, 1, 2, 1, 3, 2]) pos.push(...quad[i]);
      }
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeBoundingSphere();
    this.slagBand.visible = pos.length > 0;
  }

  /** Orientation of a ripple: x along travel, y out of the joint, z across. */
  private frame(dir: number, Q: THREE.Quaternion): THREE.Quaternion {
    const p = this.pt;
    this.ax.set(p.tx * dir, p.ty * dir, p.tz * dir);
    this.ay.set(p.nx, p.ny, p.nz);
    this.az.crossVectors(this.ax, this.ay);
    this.tmpM.makeBasis(this.ax, this.ay, this.az);
    return Q.setFromRotationMatrix(this.tmpM);
  }

  private rebuild(): void {
    const src = this.src!;
    const welding = src.stage === 'weld';
    let k = 0, kh = 0, kd = 0, kp = 0;
    let si = -1;
    const M = this.tmpM, P = this.tmpP, S = this.tmpS, Q = this.tmpQ, C = this.tmpC;
    const p = this.pt;
    this.ranges.length = 0;
    for (const sr of src.seams) {
      si++;
      const born = this.born[si];
      const start = k;
      for (let i = 0; i < sr.count && k < CAP; i++, k++) {
        if (born && Number.isNaN(born[i])) born[i] = this.clock;
        sr.pointAt(sr.rS[i], p);
        const d = sr.rD[i];
        const f = sr.rF[i];
        const dir = f & F_BACK ? -1 : 1;
        const w = sr.rW[i], h = sr.rH[i];
        const c = sr.cellAt(sr.rS[i]);
        const slag = sr.slag[c];
        const len = Math.max(1.4, Math.min(w * 0.5, 2.2 + sr.rV[i] * 0.09));
        const back = -dir * len * 0.35, sink = -h * 0.15;
        P.set(
          (p.x + p.bx * d + p.tx * back + p.nx * sink) * MM,
          (p.y + p.by * d + p.ty * back + p.ny * sink) * MM,
          (p.z + p.bz * d + p.tz * back + p.nz * sink) * MM,
        );
        this.frame(dir, Q);
        this.tmpQ2.setFromAxisAngle(this.side, 0.22);
        Q.multiply(this.tmpQ2);
        const hs = slag > 0 ? 1.25 : 1;
        // Drawn a little fuller than the sim's millimetres so the bead reads at this resolution.
        S.set(len * 1.25 * MM, h * hs * 1.9 * MM, w * 0.5 * 1.45 * MM);
        M.compose(P, Q, S);
        this.ripples.setMatrixAt(k, M);
        // Colour: slag crust, or bare metal tinted by how it was laid.
        if (slag > 0 && !welding) C.copy(this.slag).multiplyScalar(0.85 + 0.3 * hash(i, 1));
        else {
          C.copy(this.metal);
          if (f & F_COLD) C.lerp(this.dull, 0.55);
          if (f & F_HOT) C.lerp(this.blue, 0.45);
          else if (sr.rQ[i] > 1.5) C.lerp(this.straw, 0.25);
          if (f & F_LONG) C.lerp(this.dull, 0.3);
          C.multiplyScalar(0.8 + 0.35 * hash(i, 2));
        }
        C.toArray(this.baseCol, k * 3);
        // While welding, the bead crusts over with scale as it cools.
        if (welding) this.crust(C, this.clock - (born ? born[i] : -1e9), i);
        this.ripples.setColorAt(k, C);
        if (f & F_PORE && slag === 0 && kp < 400) {
          const dd = d + (hash(i, 3) - 0.5) * w * 0.4;
          const up = h * 0.75;
          P.set((p.x + p.bx * dd + p.nx * up) * MM, (p.y + p.by * dd + p.ny * up) * MM, (p.z + p.bz * dd + p.nz * up) * MM);
          const r = 0.5 + 0.5 * hash(i, 4);
          S.set(r * MM, 1, r * MM);
          M.compose(P, this.frame(1, this.tmpQ2), S);
          this.pores.setMatrixAt(kp++, M);
        }
        void (f & F_OFF);
      }
      this.ranges.push([start, k]);
      for (let c = 0; c < sr.n && kh < 256; c++) {
        if (!sr.hole[c]) continue;
        sr.pointAt((c + 0.5) * sr.cell, p);
        P.set((p.x + p.nx * 2.2) * MM, (p.y + p.ny * 2.2) * MM, (p.z + p.nz * 2.2) * MM);
        const r = 2.2 + 1.4 * hash(c, 5);
        S.set(r * MM, 1, r * MM * 0.8);
        M.compose(P, this.frame(1, this.tmpQ2), S);
        this.holes.setMatrixAt(kh++, M);
      }
      for (let i = 0; i < sr.spN && kd < 400; i++) {
        sr.pointAt(sr.spS[i], p);
        const d = sr.spD[i];
        P.set(p.x + p.bx * d, p.y + p.by * d, p.z + p.bz * d);
        this.nv.set(p.nx, p.ny, p.nz);
        this.snap(P, this.nv);
        P.addScaledVector(this.nv, 0.4).multiplyScalar(MM);
        const r = 0.5 + 0.7 * hash(i, 6);
        S.set(r * MM, r * 0.7 * MM, r * MM);
        M.compose(P, this.tmpQ.identity(), S);
        this.dots.setMatrixAt(kd++, M);
      }
    }
    for (const c of this.chalk) c.visible = src.stage === 'weld' || src.stage === 'chip';
    this.buildSlagBand(src);
    this.ripples.count = k;
    this.holes.count = kh;
    this.dots.count = kd;
    this.pores.count = kp;
    this.ripples.instanceMatrix.needsUpdate = true;
    if (this.ripples.instanceColor) this.ripples.instanceColor.needsUpdate = true;
    this.holes.instanceMatrix.needsUpdate = true;
    this.dots.instanceMatrix.needsUpdate = true;
    this.pores.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < this.grooves.length; i++) this.grooves[i].visible = true;
  }

  /** Fresh metal → dark scale over the first seconds after it's laid. */
  private crust(C: THREE.Color, age: number, i: number): void {
    const t = Math.min(1, Math.max(0, (age - 0.6) / 2.4));
    if (t > 0) C.lerp(this.tmpC2.copy(this.slag).multiplyScalar(0.85 + 0.3 * hash(i, 1)), t * t * (3 - 2 * t));
  }

  /**
   * Each frame: how hot each ripple glows. The sim's heat field, or the cooling of freshly laid metal, whichever
   * is hotter, so the bead behind the arc goes white → yellow → orange → cherry → dark over a few seconds.
   * While welding, the colour follows the crust forming on it.
   */
  private updateGlow(): void {
    const src = this.src!;
    const welding = src.stage === 'weld';
    let any = false, anyC = false;
    let kh = 0;
    const col = this.ripples.instanceColor!.array as Float32Array;
    for (let s = 0; s < src.seams.length; s++) {
      const sr = src.seams[s];
      const rg = this.ranges[s];
      const born = this.born[s];
      if (!rg) continue;
      const hot = sr.maxHeat > 0.03;
      for (let k = rg[0], i = 0; k < rg[1]; k++, i++) {
        const age = born ? this.clock - born[i] : 1e9;
        const fresh = age < 10 ? 2.2 * Math.exp(-age / 1.7) : 0;
        const g = Math.max(hot ? sr.heat[sr.cellAt(sr.rS[i])] : 0, fresh);
        if (this.rGlow.array[k] !== g) {
          (this.rGlow.array as Float32Array)[k] = g;
          any = true;
        }
        if (welding && age < 3.2) {
          this.tmpC.fromArray(this.baseCol, k * 3);
          this.crust(this.tmpC, age, i);
          this.tmpC.toArray(col, k * 3);
          anyC = true;
        }
      }
      for (let c = 0; c < sr.n && kh < 256; c++) if (sr.hole[c]) (this.hGlow.array as Float32Array)[kh++] = sr.heat[c] * 1.3;
    }
    if (any) this.rGlow.needsUpdate = true;
    if (anyC) this.ripples.instanceColor!.needsUpdate = true;
    if (kh) this.hGlow.needsUpdate = true;
  }

  /** Hottest point of the bead (for the pool light). */
  heatAt(seam: number, s: number): number {
    const sr = this.src?.seams[seam];
    return sr ? sr.heat[sr.cellAt(s)] : 0;
  }
}

function hash(i: number, k: number): number {
  let h = Math.imul(i * 374761393 + k * 668265263, 0x27d4eb2d);
  h = (h ^ (h >>> 15)) >>> 0;
  return (h % 1000) / 1000;
}
