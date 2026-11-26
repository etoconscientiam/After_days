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
 * The bead's skin: lit metal with vertex colours, hot glow per vertex, and the ripples drawn as arcs bowed
 * toward the travel direction (aRip: mm along the seam, mm across the bead, travel sign).
 */
function beadMaterial(glowK: { value: number }) {
  const m = new THREE.MeshLambertMaterial({ color: '#ffffff', vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uGlowK = glowK;
    sh.vertexShader =
      'attribute float aGlow;\nattribute vec3 aRip;\nvarying float vGlow;\nvarying vec3 vRip;\n' +
      sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;\nvRip = aRip;');
    sh.fragmentShader =
      'varying float vGlow;\nvarying vec3 vRip;\nuniform float uGlowK;\n' +
      GLOW_GLSL +
      sh.fragmentShader
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
  // Each ripple: a bright crest that falls away into a narrow dark trough behind it. Faded out as the
  // ripples get finer than a screen pixel, so the bead reads the same at any distance instead of breaking
  // into dark blocks and light flecks (aliasing) that change with the zoom.
  float ph = (vRip.x * vRip.z + vRip.y * vRip.y * 0.2) / 1.7;
  float saw = fract(ph);
  float aa = 1.0 - smoothstep(0.25, 0.5, fwidth(ph));
  diffuseColor.rgb *= 1.0 + aa * (0.28 * smoothstep(0.0, 0.75, saw) - 0.22 * smoothstep(0.8, 1.0, saw) - 0.2);`,
        )
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += glowRamp(vGlow) * uGlowK;');
  };
  m.customProgramCacheKey = () => 'bead';
  return m;
}

/** Rows of the bead's skin: every ROW mm along the seam, COLS points across. */
const ROW = 0.6;
const COLS = 9;
/** How far each ripple's metal is smoothed along the seam (mm): the bead flows, the hand's lumps stay. */
const SIG = 1.1;

interface Strip {
  mesh: THREE.Mesh;
  R: number;
  step: number;
  /** Per row: summed weight, and weighted width, height, offset, travel; the nearest ripple (global index). */
  kS: Float32Array;
  kW: Float32Array;
  kH: Float32Array;
  kD: Float32Array;
  kT: Float32Array;
  best: Float32Array;
  near: Int32Array;
  prof: Float32Array;
  /**
   * The part's real surface around the joint, measured once: for every SURF_EVERY-th row, its height along
   * the joint's normal at SURF_N offsets across (from -SURF_HALF to +SURF_HALF mm). The bead is laid on this,
   * so on curved work and in corners it hugs the metal instead of cutting into it or floating off it.
   */
  surf: Float32Array | null;
  /** The dark line of the joint, and its vertices as built: it closes up where metal has covered it. */
  groove: THREE.Mesh | null;
  gBase: Float32Array | null;
}
const SURF_N = 9;
const SURF_HALF = 8;
const SURF_EVERY = 3;

/**
 * Builds the weld bead from the sim's ripple points: every ripple is a flattened half-ellipsoid laid along the
 * joint. Even tempo gives even overlapping scales; jerky hands and wrong arc length show up as lumps, gaps,
 * pores and spatter. Hot metal glows from the seam's heat field and cools smoothly.
 */
export class BeadView {
  readonly group = new THREE.Group();
  /** One continuous bead skin per seam, reshaped from the ripples whenever the sim lays more. */
  private strips: Strip[] = [];
  private beadMat: THREE.MeshLambertMaterial;
  /** Current colour of each ripple's metal (crust, slag, sheen) and its fresh-laid glow. */
  private rCol = new Float32Array(CAP * 3);
  private rFresh = new Float32Array(CAP);
  private holes: THREE.InstancedMesh;
  private hGlow: THREE.InstancedBufferAttribute;
  private dots: THREE.InstancedMesh;
  private pores: THREE.InstancedMesh;
  private grooves: THREE.Mesh[] = [];
  private grooveMat: THREE.MeshBasicMaterial;
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
  private shimmer = new THREE.Color('#b07038');
  /** The molten pool under the arc, its glowing tail, and the aim mark on the joint. */
  readonly pool: THREE.Mesh;
  readonly tail: THREE.Mesh;
  readonly mark: THREE.Group;
  private markMat: THREE.MeshBasicMaterial;
  private markFill: THREE.Mesh;
  /** Chalk dashes either side of each joint, drawn when the job comes in. */
  private chalk: THREE.Mesh[] = [];
  private chalkMat = new THREE.MeshLambertMaterial({ color: '#b4ae9e', polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  /** While chipping: a warm pulsing band over every stretch that still has slag on it. */
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
  /** Index ranges of each seam's ripples in the per-ripple colour arrays. */
  private ranges: [number, number][] = [];

  constructor() {
    this.beadMat = beadMaterial(this.glowK);

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
    this.group.add(this.holes, this.dots, this.pores);

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
    this.group.add(this.pool, this.tail, this.mark, this.glint);
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
   * faces away. `k` (0..1) fills the ring while the strike is coming. Drawn where the hand really is (`d` mm
   * across the joint), not pulled onto it: the ring is honest, the aim is yours.
   */
  setMark(state: '' | 'ok' | 'near' | 'away' | 'chip', seam = -1, s = 0, k = 0, d = 0, pxMM = 0): void {
    this.mark.visible = state !== '' && this.at(seam, s);
    if (!this.mark.visible) return;
    const p = this.pt;
    this.mark.position.set((p.x + p.bx * d + p.nx * 1.2) * MM, (p.y + p.by * d + p.ny * 1.2) * MM, (p.z + p.bz * d + p.nz * 1.2) * MM);
    this.frame(1, this.mark.quaternion);
    // Never smaller than a few screen pixels, however far the camera is.
    const r = Math.max(state === 'ok' ? 6 : 8, pxMM * 3.5);
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
    for (const g of this.chalk) {
      this.group.remove(g);
      g.geometry.dispose();
    }
    for (const st of this.strips) {
      this.group.remove(st.mesh);
      st.mesh.geometry.dispose();
    }
    this.strips = [];
    this.chalk = [];
    this.grooves = [];
    this.src = src;
    this.snap = snap;
    this.rev = -1;
    // Ripples already there (the gate kept for the end card) are cold; new ones are stamped as they appear.
    this.born = src ? src.seams.map((sr) => new Float32Array(sr.cap).fill(Number.NaN).fill(-1e9, 0, sr.count)) : [];
    this.pool.visible = this.tail.visible = this.mark.visible = false;
    this.holes.count = this.dots.count = this.pores.count = 0;
    if (!src) return;
    for (const sr of src.seams) {
      const g = new THREE.Mesh(this.ribbon(sr, 2.2, 0.5), this.grooveMat);
      g.renderOrder = 1;
      this.grooves.push(g);
      this.group.add(g);
      const st = this.makeStrip(sr);
      st.groove = g;
      st.gBase = (g.geometry.attributes.position.array as Float32Array).slice();
      this.strips.push(st);
      this.group.add(st.mesh);
      const c = new THREE.Mesh(this.chalkFor(sr), this.chalkMat);
      c.receiveShadow = true;
      this.chalk.push(c);
      this.group.add(c);
    }
  }

  private makeStrip(sr: SeamRun): Strip {
    const R = Math.max(2, Math.ceil(sr.len / ROW) + 1);
    const n = R * COLS;
    const g = new THREE.BufferGeometry();
    const dyn = (a: Float32Array, k: number) => new THREE.BufferAttribute(a, k).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', dyn(new Float32Array(n * 3), 3));
    g.setAttribute('normal', dyn(new Float32Array(n * 3), 3));
    g.setAttribute('color', dyn(new Float32Array(n * 3), 3));
    g.setAttribute('aGlow', dyn(new Float32Array(n), 1));
    g.setAttribute('aRip', dyn(new Float32Array(n * 3), 3));
    const idx: number[] = [];
    for (let r = 0; r < R - 1; r++)
      for (let c = 0; c < COLS - 1; c++) {
        const a = r * COLS + c, b = a + COLS;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    g.setIndex(idx);
    const mesh = new THREE.Mesh(g, this.beadMat);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.visible = false;
    const f = () => new Float32Array(R);
    return { mesh, R, step: sr.len / (R - 1), kS: f(), kW: f(), kH: f(), kD: f(), kT: f(), best: f(), near: new Int32Array(R), prof: f(), surf: null, groove: null, gBase: null };
  }

  /** Measure the surface across the joint (see Strip.surf). Rays only, once per seam, the first time it's needed. */
  private measure(st: Strip, sr: SeamRun): Float32Array {
    const rows = Math.ceil((st.R - 1) / SURF_EVERY) + 1;
    const out = new Float32Array(rows * SURF_N);
    const p = this.pt, P = this.tmpP, N = this.nv;
    for (let k = 0; k < rows; k++) {
      const s = Math.min(sr.len - 0.001, Math.min(st.R - 1, k * SURF_EVERY) * st.step);
      sr.pointAt(s, p);
      for (let j = 0; j < SURF_N; j++) {
        const x = -SURF_HALF + (2 * SURF_HALF * j) / (SURF_N - 1);
        P.set(p.x + p.bx * x, p.y + p.by * x, p.z + p.bz * x);
        N.set(p.nx, p.ny, p.nz);
        const bx = P.x, by = P.y, bz = P.z;
        this.snap(P, N);
        const h = (P.x - bx) * p.nx + (P.y - by) * p.ny + (P.z - bz) * p.nz;
        // A miss (off the edge of the work) or a wild hit keeps the joint's own plane.
        out[k * SURF_N + j] = Math.abs(h) < 12 ? h : 0;
      }
    }
    return out;
  }

  /** Height of the measured surface at row r, offset x mm across. */
  private surfAt(st: Strip, r: number, x: number): number {
    const S = st.surf!;
    const fr = r / SURF_EVERY, k0 = Math.floor(fr), t = fr - k0;
    const rows = S.length / SURF_N;
    const k1 = Math.min(rows - 1, k0 + 1);
    const fx = Math.min(SURF_N - 1.001, Math.max(0, ((x + SURF_HALF) / (2 * SURF_HALF)) * (SURF_N - 1)));
    const j0 = Math.floor(fx), u = fx - j0;
    const a = S[k0 * SURF_N + j0] * (1 - u) + S[k0 * SURF_N + j0 + 1] * u;
    const b = S[k1 * SURF_N + j0] * (1 - u) + S[k1 * SURF_N + j0 + 1] * u;
    return a * (1 - t) + b * t;
  }

  /**
   * Reshape one seam's bead from its ripples: each row takes the smoothed width, height and offset of the
   * metal laid near it, so the bead runs as one body; where nothing was laid it thins to nothing.
   */
  private shapeStrip(st: Strip, sr: SeamRun, start: number, welding: boolean): void {
    const { R, step, kS, kW, kH, kD, kT, best, near } = st;
    kS.fill(0); kW.fill(0); kH.fill(0); kD.fill(0); kT.fill(0); best.fill(0); near.fill(-1);
    for (let i = 0; i < sr.count; i++) {
      const si = sr.rS[i];
      const r0 = Math.max(0, Math.ceil((si - 3 * SIG) / step)), r1 = Math.min(R - 1, Math.floor((si + 3 * SIG) / step));
      const dir = sr.rF[i] & F_BACK ? -1 : 1;
      for (let r = r0; r <= r1; r++) {
        const ds = r * step - si;
        const K = Math.exp((-ds * ds) / (2 * SIG * SIG));
        kS[r] += K;
        kW[r] += K * sr.rW[i];
        kH[r] += K * sr.rH[i];
        kD[r] += K * sr.rD[i];
        kT[r] += K * dir;
        if (K > best[r]) {
          best[r] = K;
          near[r] = start + i;
        }
      }
    }
    if (sr.count > 0 && !st.surf) st.surf = this.measure(st, sr);
    const g = st.mesh.geometry;
    const pos = g.attributes.position.array as Float32Array;
    const rip = g.attributes.aRip.array as Float32Array;
    const p = this.pt;
    let any = false;
    for (let r = 0; r < R; r++) {
      const s = Math.min(sr.len - 0.001, r * step);
      sr.pointAt(s, p);
      const k = kS[r];
      // Present where metal was laid: crisp at the running end (the nearest ripple decides), so the bead
      // grows right under the arc; smoothed between ripples so it never breaks into beads on a string.
      const pres = Math.min(1, Math.max(0, (best[r] - 0.3) / 0.35, (k - 0.25) / 0.6));
      const e = pres * pres * (3 - 2 * pres);
      if (e > 0) any = true;
      const W = k > 1e-4 ? kW[r] / k : 0, H = k > 1e-4 ? kH[r] / k : 0, D = k > 1e-4 ? kD[r] / k : 0;
      const slag = !welding && sr.slag[sr.cellAt(s)] > 0 ? 1.15 : 1;
      // A little fuller than the sim's millimetres so it reads at this resolution; low and wide like a real bead.
      const hw = W * 0.5 * 1.25 * e, hh = H * 1.5 * slag * e;
      const tr = kT[r] < 0 ? -1 : 1;
      for (let c = 0; c < COLS; c++) {
        const u = -1 + (2 * c) / (COLS - 1);
        const pr = Math.pow(1 - u * u, 0.55);
        // The toes sink a hair into the plate so the bead wets into it rather than sitting on it.
        const x = D + u * hw;
        const y = (st.surf ? this.surfAt(st, r, x) : 0) + hh * pr - 0.3 * (1 - pr) - (e < 1 ? 0.5 * (1 - e) : 0);
        const j = (r * COLS + c) * 3;
        pos[j] = (p.x + p.bx * x + p.nx * y) * MM;
        pos[j + 1] = (p.y + p.by * x + p.ny * y) * MM;
        pos[j + 2] = (p.z + p.bz * x + p.nz * y) * MM;
        rip[j] = s;
        rip[j + 1] = u * hw;
        rip[j + 2] = tr;
        if (c === 0) st.prof[r] = e;
      }
    }
    st.mesh.visible = any;
    this.closeGroove(st, sr);
    g.attributes.position.needsUpdate = true;
    g.attributes.aRip.needsUpdate = true;
    g.computeVertexNormals();
  }

  /** Where the bead covers the joint, its dark line closes to nothing (it would show through at the toes). */
  private closeGroove(st: Strip, sr: SeamRun): void {
    if (!st.groove || !st.gBase) return;
    const ga = st.groove.geometry.attributes.position as THREE.BufferAttribute;
    const pos = ga.array as Float32Array, base = st.gBase;
    const rows = pos.length / 6;
    for (let i = 0; i < rows; i++) {
      const s = (sr.len * i) / (rows - 1);
      const r = Math.min(st.R - 1, Math.round(s / st.step));
      const covered = Math.max(st.prof[r], st.prof[Math.max(0, r - 1)], st.prof[Math.min(st.R - 1, r + 1)]) > 0.2;
      for (let k = 0; k < 3; k++) {
        const a = base[i * 6 + k], b = base[i * 6 + 3 + k];
        if (covered) pos[i * 6 + k] = pos[i * 6 + 3 + k] = (a + b) / 2;
        else {
          pos[i * 6 + k] = a;
          pos[i * 6 + 3 + k] = b;
        }
      }
    }
    ga.needsUpdate = true;
  }

  /** Colours and glow of one seam's bead from its ripples' current colours and the heat field. */
  private paintStrip(st: Strip, sr: SeamRun): void {
    const g = st.mesh.geometry;
    const col = g.attributes.color.array as Float32Array;
    const glow = g.attributes.aGlow.array as Float32Array;
    const hot = sr.maxHeat > 0.03;
    const C = this.tmpC;
    for (let r = 0; r < st.R; r++) {
      const k = st.near[r];
      if (k < 0) C.copy(this.metal);
      else C.fromArray(this.rCol, k * 3);
      const s = Math.min(sr.len - 0.001, r * st.step);
      const h = Math.max(hot ? sr.heat[sr.cellAt(s)] : 0, k >= 0 ? this.rFresh[k] : 0);
      for (let c = 0; c < COLS; c++) {
        const u = -1 + (2 * c) / (COLS - 1);
        // Toes a little darker: thinner metal, scale, the shadow of the crown.
        const t = 0.78 + 0.22 * (1 - u * u * u * u);
        const j = r * COLS + c;
        col[j * 3] = C.r * t;
        col[j * 3 + 1] = C.g * t;
        col[j * 3 + 2] = C.b * t;
        glow[j] = h * (0.75 + 0.25 * (1 - u * u));
      }
    }
    g.attributes.color.needsUpdate = true;
    g.attributes.aGlow.needsUpdate = true;
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


  update(dt = 0): void {
    this.clock += dt;
    const src = this.src;
    if (!src) return;
    if (src.rev !== this.rev || src.stage !== this.stage) {
      this.rev = src.rev;
      this.stage = src.stage;
      this.rebuild();
    }
    this.updateGlow();
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
        void dir;
        // Colour: slag crust, or bare metal tinted by how it was laid.
        if (slag > 0 && !welding) C.copy(this.slag).multiplyScalar(0.92 + 0.14 * hash(i, 1));
        else {
          C.copy(this.metal);
          if (f & F_COLD) C.lerp(this.dull, 0.55);
          if (f & F_HOT) C.lerp(this.blue, 0.45);
          else if (sr.rQ[i] > 1.5) C.lerp(this.straw, 0.25);
          if (f & F_LONG) C.lerp(this.dull, 0.3);
          C.multiplyScalar(0.92 + 0.14 * hash(i, 2));
        }
        C.toArray(this.baseCol, k * 3);
        // While welding, the bead crusts over with scale as it cools.
        if (welding) this.crust(C, this.clock - (born ? born[i] : -1e9), i);
        C.toArray(this.rCol, k * 3);
        if (f & F_PORE && slag === 0 && kp < 400) {
          const dd = d + (hash(i, 3) - 0.5) * w * 0.4;
          const up = h * 1.1;
          P.set((p.x + p.bx * dd + p.nx * up) * MM, (p.y + p.by * dd + p.ny * up) * MM, (p.z + p.bz * dd + p.nz * up) * MM);
          const r = 0.5 + 0.5 * hash(i, 4);
          S.set(r * MM, 1, r * MM);
          M.compose(P, this.frame(1, this.tmpQ2), S);
          this.pores.setMatrixAt(kp++, M);
        }
        void (f & F_OFF);
      }
      this.ranges.push([start, k]);
      this.shapeStrip(this.strips[si], sr, start, welding);
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
    // Chalk marks a joint still to weld: gone from each seam once it is closed.
    this.chalk.forEach((c, i) => (c.visible = src.stage === 'weld' && !src.seams[i]?.filled));
    this.holes.count = kh;
    this.dots.count = kd;
    this.pores.count = kp;
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
    const chipping = src.stage === 'chip';
    let kh = 0;
    for (let s = 0; s < src.seams.length; s++) {
      const sr = src.seams[s];
      const rg = this.ranges[s];
      const st = this.strips[s];
      const born = this.born[s];
      if (!rg || !st) continue;
      for (let k = rg[0], i = 0; k < rg[1]; k++, i++) {
        const age = born ? this.clock - born[i] : 1e9;
        this.rFresh[k] = age < 10 ? 2.2 * Math.exp(-age / 1.7) : 0;
        if (welding && age < 3.2) {
          this.tmpC.fromArray(this.baseCol, k * 3);
          this.crust(this.tmpC, age, i);
          this.tmpC.toArray(this.rCol, k * 3);
        } else if (chipping) {
          // Slag still on: the dark glassy crust, with a dull warm sheen running slowly along it, so the seam
          // itself shows what is left to knock off; chipped metal comes out bright, its own colour.
          this.tmpC.fromArray(this.baseCol, k * 3);
          if (sr.slag[sr.cellAt(sr.rS[i])] > 0) {
            this.crust(this.tmpC, 1e9, i);
            const w = 0.5 + 0.5 * Math.sin(this.clock * 2.4 - sr.rS[i] * 0.08);
            this.tmpC.lerp(this.shimmer, 0.02 + 0.12 * w ** 6);
          }
          this.tmpC.toArray(this.rCol, k * 3);
        }
      }
      if (st.mesh.visible) this.paintStrip(st, sr);
      for (let c = 0; c < sr.n && kh < 256; c++) if (sr.hole[c]) (this.hGlow.array as Float32Array)[kh++] = sr.heat[c] * 1.3;
    }
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
