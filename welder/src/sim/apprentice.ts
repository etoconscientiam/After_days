import { BALANCE } from '../data/balance';
import type { Bench, TorchIn } from './weld';
import { canReach, faceSeam, facing } from './weld';
import { seamPoint } from './seam';

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
  private pt = seamPoint();

  /** Where the current stretch started, and the scratching clock. */
  from = 0;
  scr = 0;

  reset(): void {
    this.t = 0;
    this.seam = 0;
    this.s = 0;
    this.pause = 0;
    this.from = 0;
    this.scr = 0;
  }

  /** `steady` < 1 keeps the hand closer to the joint than the habit had it (a better bench). */
  drive(b: Bench, h: Habit, dt: number, out: TorchIn, steady = 1): void {
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
    const ahead = (k: number) => (sr!.closed ? this.s + k : Math.min(sr!.len, this.s + k));
    if (this.pause > 0) {
      this.pause -= dt;
      out.press = false;
    } else if (!canReach(b, this.seam, ahead(3))) {
      // The joint ahead faces away: stop and turn the work.
      if (!b.rotT) faceSeam(b, this.seam, ahead(8));
      this.pause = 0.15;
      out.press = false;
    } else {
      out.press = h.p[i] === 1;
      // Scratch on the spot until the arc catches, then travel at the learned pace.
      if (out.press && b.arc.lit) this.s += Math.max(1.5, h.v[i]) * dt;
      else if (out.press) this.scr += dt;
      // Round a ring he keeps the rod going and turns the work under it.
      if (!b.rotT && facing(b, this.seam, ahead(8)) < 0.5) faceSeam(b, this.seam, ahead(16));
    }
    // Ran into metal laid earlier (going back for a missed stretch): this stretch is done.
    const filledAhead = b.arc.lit && this.s > this.from + 6 && sr.metal[sr.cellAt(ahead(3))] >= W.fillMin && sr.metal[sr.cellAt(ahead(7))] >= W.fillMin;
    if (this.s >= sr.len - 0.5 || filledAhead) {
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
        this.s = Math.max(0, gap - 3);
        this.from = this.s;
        this.pause = 0.4;
        out.press = false;
        sr = b.seams[next];
      } else {
        this.s = sr.len;
        out.press = false;
      }
    }
    const p = sr.pointAt(this.s, this.pt);
    const d = h.d[i] * steady;
    const sc = b.arc.lit ? 0 : Math.sin(this.scr * 38) * 4;
    out.x = p.x + p.bx * d + p.tx * sc;
    out.y = p.y + p.by * d + p.ty * sc;
    out.z = p.z + p.bz * d + p.tz * sc;
    out.forceL = h.L[i];
  }
}
