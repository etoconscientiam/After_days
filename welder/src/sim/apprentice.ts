import { BALANCE } from '../data/balance';
import type { Bench, TorchIn } from './weld';
import type { SeamPoint } from './seam';

const AP = BALANCE.apprentice;

/** What the apprentice learned from watching the player: tempo, hand wobble, arc length and pauses. */
export interface Habit {
  v: number[];
  d: number[];
  L: number[];
  p: number[];
  seconds: number;
}

/** Records the player's hand on simple jobs. */
export class Recorder {
  v = new Float32Array(AP.maxSamples);
  d = new Float32Array(AP.maxSamples);
  L = new Float32Array(AP.maxSamples);
  p = new Uint8Array(AP.maxSamples);
  n = 0;
  acc = 0;
  lit = 0;
  active = false;
  started = false;

  begin(): void {
    this.n = 0;
    this.acc = 0;
    this.lit = 0;
    this.active = true;
    this.started = false;
  }

  sample(b: Bench, press: boolean, cursorSpeed: number, dt: number): void {
    if (!this.active) return;
    if (!this.started) {
      if (!press) return;
      this.started = true;
    }
    if (b.arc.lit) this.lit += dt;
    this.acc += dt;
    if (this.acc < AP.sampleDt) return;
    this.acc -= AP.sampleDt;
    if (this.n >= AP.maxSamples) return;
    const i = this.n++;
    this.v[i] = b.arc.lit ? b.arc.v : Math.min(60, cursorSpeed);
    this.d[i] = b.arc.lit ? b.arc.d : 0;
    this.L[i] = b.arc.lit ? b.arc.L : BALANCE.arc.startL;
    this.p[i] = press ? 1 : 0;
  }

  /** Returns a habit if the take was long enough to learn from. */
  commit(): Habit | null {
    this.active = false;
    if (this.lit < AP.minLitSeconds || this.n < 10) return null;
    // Trim the trailing idle part (the walk to the hammer).
    let end = this.n;
    while (end > 1 && !this.p[end - 1]) end--;
    return {
      v: Array.from(this.v.subarray(0, end), (x) => Math.round(x * 100) / 100),
      d: Array.from(this.d.subarray(0, end), (x) => Math.round(x * 100) / 100),
      L: Array.from(this.L.subarray(0, end), (x) => Math.round(x * 100) / 100),
      p: Array.from(this.p.subarray(0, end)),
      seconds: Math.round(this.lit * 10) / 10,
    };
  }
}

/** Replays a habit on the apprentice's bench, moving forward along each joint. */
export class Replayer {
  t = 0;
  seam = 0;
  s = 0;
  pause = 0;
  private pt: SeamPoint = { x: 0, z: 0, tx: 1, tz: 0 };

  reset(): void {
    this.t = 0;
    this.seam = 0;
    this.s = 0;
    this.pause = 0;
  }

  drive(b: Bench, h: Habit, dt: number, out: TorchIn): void {
    const n = h.v.length;
    const i = Math.floor(this.t / AP.sampleDt) % n;
    this.t += dt;
    out.dL = 0;
    out.has = true;
    const W = BALANCE.weld;
    let sr = b.seams[this.seam];
    if (!sr) {
      out.press = false;
      return;
    }
    if (this.pause > 0) {
      this.pause -= dt;
      out.press = false;
    } else {
      out.press = h.p[i] === 1;
      if (out.press) this.s += Math.max(1.5, h.v[i]) * dt;
    }
    if (this.s >= sr.len - 0.5) {
      // End of this joint: move to the next gap anywhere on the part.
      let next = -1, gap = -1;
      for (let k = 0; k < b.seams.length; k++) {
        const g = b.seams[(this.seam + k) % b.seams.length].firstGap(W.fillMin);
        if (g >= 0) {
          next = (this.seam + k) % b.seams.length;
          gap = g;
          break;
        }
      }
      if (next >= 0) {
        this.seam = next;
        this.s = Math.max(0, gap - 4);
        this.pause = 0.4;
        out.press = false;
        sr = b.seams[next];
      } else {
        this.s = sr.len;
        out.press = false;
      }
    }
    sr.pointAt(this.s, this.pt);
    const d = h.d[i];
    out.x = this.pt.x - this.pt.tz * d;
    out.z = this.pt.z + this.pt.tx * d;
    out.forceL = h.L[i];
  }
}
