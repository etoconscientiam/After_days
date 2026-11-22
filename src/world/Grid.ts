// The visible strata as a grid of particles. One particle = 2×2 world pixels; row 0 is the top of the world.
// The bottom rows are bedrock (and the foundation of past epochs on top of it); the thing lies on them. Everything
// else is either empty (sky, water) or a particle that keeps its look from birth: only an event — a transformation,
// a marker bed — changes its material, so nothing on screen ever flickers.
//
// Particles move only in core/sand.ts, change material only in core/pressure.ts and core/beds.ts, and leave the
// grid only through the conveyor (core/pressure.ts sinkStep → world/Archive.ts).
import { CFG, M, NMAT } from '../config';

const S = CFG.B.sand;
export const GW = S.gridW;
export const GH = S.gridH;

// particle flags (bones and resin) — the same bits as the old cells (World.ts F_*), so saves and the archive's
// bones (Strata.ts B_*) carry them over unchanged
export const P_FOSSIL = 1;
export const P_ROLLED = 2;     // the fossil roll was made
export const P_INSECT = 4;     // resin with an insect inside
export const P_RARE = 8;
export const P_FRAGMENT = 16;
export const P_GLOW = 32;      // living world: glowing organic matter
export const P_FAST = 64;      // buried fast (flood, ash): better odds to fossilise
export const P_OLD = 128;      // the old ground a world starts on: it turns to rock, but pays nothing (it is not this run's work)

// behaviour per material
export const K_NONE = 0, K_LOOSE = 1, K_ROCK = 2, K_MARKER = 3, K_SOLID = 4;
const KIND_ID: Record<string, number> = { none: K_NONE, loose: K_LOOSE, rock: K_ROCK, marker: K_MARKER, solid: K_SOLID };
export const KIND = new Uint8Array(NMAT);
export const SLIP = new Float32Array(NMAT);
export const DENS = new Float32Array(NMAT);
export const MARKER = new Uint8Array(NMAT);
for (const m of CFG.materials) {
  KIND[m.idx] = KIND_ID[m.kind] ?? K_ROCK;
  SLIP[m.idx] = m.slip ?? 0;
  DENS[m.idx] = m.density;
  MARKER[m.idx] = m.marker ? 1 : 0;
}
KIND[0] = K_NONE;

export class Grid {
  readonly W = GW;
  readonly H = GH;
  readonly N = GW * GH;
  mat = new Uint8Array(this.N);
  /** the particle's own pattern (shade, accent pixel), set at birth */
  look = new Uint8Array(this.N);
  /** 1 = the grain lies still (friction holds it on a slope), 0 = it is moving (falling or rolling).
   *  Not saved: everything loaded lies still. */
  still = new Uint8Array(this.N).fill(1);
  flags = new Uint8Array(this.N);
  /** species index + 1 for bones */
  spec = new Uint8Array(this.N);
  /** 0..255 preservation loss of bones */
  decay = new Uint8Array(this.N);
  /** calendar year of birth */
  birth = new Float32Array(this.N);
  /** progress of the running transformation, game years */
  prog = new Float32Array(this.N);
  /** first occupied row per column (floor if the column is empty), particles in the air included */
  tops = new Int16Array(GW);
  /** the settled surface per column: the top of the unbroken column that stands on the floor (particles in the air
   *  do not count). The ground line, the load of the conveyor, marker beds and depths all use it. */
  surf = new Int16Array(GW);
  /** first solid row (top of the foundation / bedrock) */
  floor = GH - S.bedRows;
  /** the row right above the thing: the oldest rock here sinks into the archive */
  sinkRow = GH - S.bedRows - S.artifactH - 1;
  /** left column of each artifact */
  artifacts: number[] = [];
  // sleeping blocks: a block is processed by the physics only while something can move in it
  readonly BS = S.blockSize;
  readonly bw = Math.ceil(GW / S.blockSize);
  readonly bh = Math.ceil(GH / S.blockSize);
  awake = new Uint8Array(this.bw * this.bh);
  awakeNext = new Uint8Array(this.bw * this.bh);
  /** bumped on every change the renderer must see */
  version = 0;

  /** Empty world: bedrock, `foundationRows` of foundation on it, the thing(s) on top, centred at `centers`. */
  reset(centers: number[] = [GW >> 1], foundationRows = 0): void {
    this.mat.fill(0); this.look.fill(0); this.flags.fill(0); this.spec.fill(0); this.decay.fill(0);
    this.birth.fill(0); this.prog.fill(0); this.still.fill(1);
    const bed = GH - S.bedRows;
    const fr = Math.max(0, Math.min(Math.floor(S.bedRows / 2), Math.round(foundationRows)));
    this.floor = bed - fr;
    this.sinkRow = this.floor - S.artifactH - 1;
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) >>> 24);
    for (let y = this.floor; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        const i = y * GW + x;
        this.mat[i] = y < bed ? M.foundation : M.bedrock;
        this.look[i] = rnd();
      }
    }
    this.artifacts = centers.map((c) => Math.max(0, Math.min(GW - S.artifactW, Math.round(c - S.artifactW / 2))));
    for (const ax of this.artifacts) {
      for (let y = this.floor - S.artifactH; y < this.floor; y++) {
        for (let x = ax; x < ax + S.artifactW; x++) {
          const i = y * GW + x;
          this.mat[i] = M.artifact;
          this.look[i] = (x - ax) + (y - this.floor + S.artifactH) * S.artifactW;
        }
      }
    }
    this.computeTops();
    this.awakeNext.fill(1);
    this.version++;
  }

  idx(x: number, y: number): number { return y * GW + x; }

  /** Put a particle into an empty cell. Returns its index, or -1 if the cell is outside or taken. */
  put(x: number, y: number, m: number, look: number, birth: number, flags = 0, spec = 0, decay = 0): number {
    if (x < 0 || x >= GW || y < 0 || y >= this.floor) return -1;
    const i = y * GW + x;
    if (this.mat[i]) return -1;
    this.mat[i] = m; this.look[i] = look; this.birth[i] = birth;
    this.flags[i] = flags; this.spec[i] = spec; this.decay[i] = decay; this.prog[i] = 0; this.still[i] = 0;
    if (y < this.tops[x]) this.tops[x] = y;
    if (y === this.surf[x] - 1) { let t = y; while (t > 0 && this.mat[(t - 1) * GW + x]) t--; this.surf[x] = t; }
    this.wake(x, y);
    this.version++;
    return i;
  }

  /** Remove a particle (crater, excavation). Things above it will fall. */
  clear(i: number): void {
    if (KIND[this.mat[i]] === K_SOLID) return;
    this.mat[i] = 0; this.prog[i] = 0; this.flags[i] = 0; this.spec[i] = 0; this.decay[i] = 0;
    const x = i % GW, y = (i / GW) | 0;
    if (this.tops[x] === y) { let t = y; while (t < this.floor && !this.mat[t * GW + x]) t++; this.tops[x] = t; }
    if (y >= this.surf[x]) this.surf[x] = y + 1;
    this.wake(x, y);
    this.version++;
  }

  /** Move a particle from cell a to the empty cell b (physics only). */
  move(a: number, b: number): void {
    this.mat[b] = this.mat[a]; this.look[b] = this.look[a]; this.birth[b] = this.birth[a];
    this.flags[b] = this.flags[a]; this.spec[b] = this.spec[a]; this.decay[b] = this.decay[a]; this.prog[b] = this.prog[a];
    this.still[b] = 0; this.still[a] = 1;
    this.mat[a] = 0; this.prog[a] = 0; this.flags[a] = 0; this.spec[a] = 0; this.decay[a] = 0;
    this.wake(a % GW, (a / GW) | 0);
    this.wake(b % GW, (b / GW) | 0);
  }

  /** Mark the block of (x, y) and its neighbours to be processed on the next physics step. */
  wake(x: number, y: number): void {
    const bx = Math.floor(x / this.BS), by = Math.floor(y / this.BS);
    for (let dy = -1; dy <= 1; dy++) {
      const yy = by + dy;
      if (yy < 0 || yy >= this.bh) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = bx + dx;
        if (xx >= 0 && xx < this.bw) this.awakeNext[yy * this.bw + xx] = 1;
      }
    }
  }

  wakeAll(): void { this.awakeNext.fill(1); }
  /** How many blocks are awake this step (debug). */
  awakeBlocks(): number { let n = 0; for (let i = 0; i < this.awake.length; i++) n += this.awake[i]; return n; }

  /** Swap the sleeping masks at the start of a physics step. */
  beginStep(): void {
    const t = this.awake; this.awake = this.awakeNext; this.awakeNext = t;
    this.awakeNext.fill(0);
  }

  blockAwake(x: number, y: number): boolean {
    return this.awake[Math.floor(y / this.BS) * this.bw + Math.floor(x / this.BS)] === 1;
  }

  computeTops(): void {
    for (let x = 0; x < GW; x++) {
      let y = 0;
      while (y < this.floor && !this.mat[y * GW + x]) y++;
      this.tops[x] = y;
      let s = this.floor;
      while (s > 0 && this.mat[(s - 1) * GW + x]) s--;
      this.surf[x] = s;
    }
  }

  /** Particles that can move or sink (not bedrock, foundation or the thing). */
  particles(): number {
    let n = 0;
    for (let i = 0; i < this.floor * GW; i++) { const k = KIND[this.mat[i]]; if (k !== K_NONE && k !== K_SOLID) n++; }
    return n;
  }

  /** Is column x part of an artifact? */
  isArtifactCol(x: number): boolean {
    for (const ax of this.artifacts) if (x >= ax && x < ax + S.artifactW) return true;
    return false;
  }
}
