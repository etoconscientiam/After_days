import * as THREE from 'three';
import type { SeamRun, SeamPoint } from '../sim/seam';
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
  private heightAt: (x: number, z: number) => number = () => 0;
  private rev = -1;
  private stage = '';
  readonly glowK = { value: SKIN.glow.k };
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpQ2 = new THREE.Quaternion();
  private tmpP = new THREE.Vector3();
  private tmpS = new THREE.Vector3();
  private tmpC = new THREE.Color();
  private up = new THREE.Vector3(0, 1, 0);
  private side = new THREE.Vector3(0, 0, 1);
  private pt: SeamPoint = { x: 0, z: 0, tx: 1, tz: 0 };
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

    this.grooveMat = new THREE.MeshBasicMaterial({ color: '#050403' });
    this.hiMat = new THREE.MeshBasicMaterial({ color: '#c89a70', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    this.group.add(this.ripples, this.holes, this.dots, this.pores);
  }

  attach(src: BeadSource | null, heightAt: (x: number, z: number) => number): void {
    for (const g of this.grooves) {
      this.group.remove(g);
      g.geometry.dispose();
    }
    for (const g of this.hi) {
      this.group.remove(g);
      g.geometry.dispose();
    }
    this.grooves = [];
    this.hi = [];
    this.src = src;
    this.heightAt = heightAt;
    this.rev = -1;
    this.ripples.count = this.holes.count = this.dots.count = this.pores.count = 0;
    if (!src) return;
    for (const sr of src.seams) {
      const g = new THREE.Mesh(this.ribbon(sr, 1.3, 0.12), this.grooveMat);
      g.renderOrder = 1;
      this.grooves.push(g);
      this.group.add(g);
      const h = new THREE.Mesh(this.ribbon(sr, 5, 0.25), this.hiMat);
      h.renderOrder = 2;
      this.hi.push(h);
      this.group.add(h);
    }
  }

  /** Thin strip along the joint (the crack or gap to be welded). */
  private ribbon(sr: SeamRun, width: number, lift: number): THREE.BufferGeometry {
    const n = Math.max(2, Math.ceil(sr.len / 2));
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= n; i++) {
      sr.pointAt((sr.len * i) / n, this.pt);
      const nx = -this.pt.tz, nz = this.pt.tx;
      for (const s of [-1, 1]) {
        const x = this.pt.x + nx * s * width * 0.5, z = this.pt.z + nz * s * width * 0.5;
        pos.push(x * MM, (this.heightAt(x, z) + lift) * MM, z * MM);
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
    this.hiMat.opacity = k * 0.09;
    for (let i = 0; i < this.hi.length; i++) this.hi[i].visible = i === seam && k > 0;
  }

  update(): void {
    const src = this.src;
    if (!src) return;
    if (src.rev !== this.rev || src.stage !== this.stage) {
      this.rev = src.rev;
      this.stage = src.stage;
      this.rebuild();
    }
    this.updateGlow();
  }

  private rebuild(): void {
    const src = this.src!;
    let k = 0, kh = 0, kd = 0, kp = 0;
    const M = this.tmpM, P = this.tmpP, S = this.tmpS, Q = this.tmpQ, C = this.tmpC;
    this.ranges.length = 0;
    for (const sr of src.seams) {
      const start = k;
      for (let i = 0; i < sr.count && k < CAP; i++, k++) {
        sr.pointAt(sr.rS[i], this.pt);
        const tx = this.pt.tx, tz = this.pt.tz;
        const d = sr.rD[i];
        const f = sr.rF[i];
        const dir = f & F_BACK ? -1 : 1;
        const w = sr.rW[i], h = sr.rH[i];
        const c = sr.cellAt(sr.rS[i]);
        const slag = sr.slag[c];
        const len = Math.max(1.4, Math.min(w * 0.5, 2.2 + sr.rV[i] * 0.09));
        const x = this.pt.x - tz * d - tx * dir * len * 0.35;
        const z = this.pt.z + tx * d - tz * dir * len * 0.35;
        P.set(x * MM, (this.heightAt(x, z) - h * 0.15) * MM, z * MM);
        Q.setFromAxisAngle(this.up, Math.atan2(-tz * dir, tx * dir));
        this.tmpQ2.setFromAxisAngle(this.side, 0.22);
        Q.multiply(this.tmpQ2);
        const hs = slag > 0 ? 1.25 : 1;
        S.set(len * MM, h * hs * MM, w * 0.5 * MM);
        M.compose(P, Q, S);
        this.ripples.setMatrixAt(k, M);
        // Colour: slag crust, or bare metal tinted by how it was laid.
        if (slag > 0) C.copy(this.slag).multiplyScalar(0.85 + 0.3 * hash(i, 1));
        else {
          C.copy(this.metal);
          if (f & F_COLD) C.lerp(this.dull, 0.55);
          if (f & F_HOT) C.lerp(this.blue, 0.45);
          else if (sr.rQ[i] > 1.5) C.lerp(this.straw, 0.25);
          if (f & F_LONG) C.lerp(this.dull, 0.3);
          C.multiplyScalar(0.8 + 0.35 * hash(i, 2));
        }
        this.ripples.setColorAt(k, C);
        if (f & F_PORE && slag === 0 && kp < 400) {
          const px = this.pt.x - tz * (d + (hash(i, 3) - 0.5) * w * 0.4);
          const pz = this.pt.z + tx * (d + (hash(i, 3) - 0.5) * w * 0.4);
          P.set(px * MM, (this.heightAt(px, pz) + h * 0.75) * MM, pz * MM);
          const r = 0.5 + 0.5 * hash(i, 4);
          S.set(r * MM, 1, r * MM);
          M.compose(P, this.tmpQ.identity(), S);
          this.pores.setMatrixAt(kp++, M);
        }
        void (f & F_OFF);
      }
      this.ranges.push([start, k]);
      for (let c = 0; c < sr.n && kh < 256; c++) {
        if (!sr.hole[c]) continue;
        sr.pointAt((c + 0.5) * sr.cell, this.pt);
        P.set(this.pt.x * MM, (this.heightAt(this.pt.x, this.pt.z) + 2.2) * MM, this.pt.z * MM);
        const r = 2.2 + 1.4 * hash(c, 5);
        S.set(r * MM, 1, r * MM * 0.8);
        M.compose(P, this.tmpQ.setFromAxisAngle(this.up, Math.atan2(-this.pt.tz, this.pt.tx)), S);
        this.holes.setMatrixAt(kh++, M);
      }
      for (let i = 0; i < sr.spN && kd < 400; i++) {
        const x = sr.spX[i], z = sr.spZ[i];
        P.set(x * MM, (this.heightAt(x, z) + 0.4) * MM, z * MM);
        const r = 0.5 + 0.7 * hash(i, 6);
        S.set(r * MM, r * 0.7 * MM, r * MM);
        M.compose(P, this.tmpQ.identity(), S);
        this.dots.setMatrixAt(kd++, M);
      }
    }
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

  private updateGlow(): void {
    const src = this.src!;
    let any = false;
    let kh = 0;
    for (let s = 0; s < src.seams.length; s++) {
      const sr = src.seams[s];
      const rg = this.ranges[s];
      if (!rg) continue;
      const hot = sr.maxHeat > 0.03;
      for (let k = rg[0], i = 0; k < rg[1]; k++, i++) {
        const g = hot ? sr.heat[sr.cellAt(sr.rS[i])] : 0;
        if (this.rGlow.array[k] !== g) {
          (this.rGlow.array as Float32Array)[k] = g;
          any = true;
        }
      }
      for (let c = 0; c < sr.n && kh < 256; c++) if (sr.hole[c]) (this.hGlow.array as Float32Array)[kh++] = sr.heat[c] * 1.3;
    }
    if (any) this.rGlow.needsUpdate = true;
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
