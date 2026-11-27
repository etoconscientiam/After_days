import { BALANCE } from '../data/balance';
import type { Game } from './game';
import { TorchIn, canReach, faceSeam } from './weld';
import { seamPoint } from './seam';

/**
 * A master's hand for the showcase: welds every joint of the job on the player's bench at the right speed
 * and arc length, turning the work as it goes, then knocks the slag off. One call per sim step; it fills the
 * torch input and the welding direction at the rod (part-local) for the view.
 */
export class Autopilot {
  private phase: 'face' | 'strike' | 'run' | 'chip' = 'face';
  private seam = -1;
  private s = 0;
  private t = 0;
  private wait = 0;
  private turnT = 0;
  private hitT = 0;
  private pt = seamPoint();
  /** Welding direction at the rod tip (part-local), for drawing the holder. */
  readonly nrm = { x: 0, y: 1, z: 0 };

  step(g: Game, tr: TorchIn): void {
    const dt = BALANCE.dt;
    const b = g.player;
    this.t += dt;
    tr.dL = 0;
    tr.turnX = tr.turnY = 0;
    tr.press = false;
    if (b.electrode < 0.2) b.electrode = 1;
    if (this.wait > 0) {
      this.wait -= dt;
      return;
    }
    if (b.stage === 'weld') {
      if (this.phase === 'chip') this.phase = 'face';
      const fill = BALANCE.weld.fillMin;
      if (this.phase === 'face') {
        this.seam = b.seams.findIndex((sr) => sr.firstGap(fill) >= 0);
        if (this.seam < 0) return;
        const sr = b.seams[this.seam];
        this.s = Math.max(0, sr.firstGap(fill) - 2);
        if (!canReach(b, this.seam, this.s + 4)) {
          faceSeam(b, this.seam, Math.min(sr.len, this.s + 8));
          if (b.rotT) return;
        }
        if (b.rotT) return;
        this.phase = 'strike';
      }
      const sr = b.seams[this.seam];
      if (!sr) {
        this.phase = 'face';
        return;
      }
      const p = sr.pointAt(Math.min(this.s, sr.len), this.pt);
      let lat = 0;
      if (this.phase === 'strike') {
        // A quick scratch across the joint until it catches; the mask comes down with the arc.
        lat = Math.sin(this.t * 50) * 3;
        if (b.arc.lit) {
          this.phase = 'run';
          g.queue({ type: 'mask', down: true });
        }
      } else {
        const v = g.idealSpeed(b);
        if (b.arc.lit) this.s += v * dt;
        tr.forceL = BALANCE.arc.idealL;
        // Round a ring the hands keep the work turning just ahead of the rod.
        this.turnT -= dt;
        if (this.turnT <= 0) {
          this.turnT = 0.12;
          const ahead = sr.closed ? (this.s + 10) % sr.len : Math.min(sr.len, this.s + 10);
          if (sr.def.pts.length > 2) faceSeam(b, this.seam, ahead);
        }
        if (this.s >= sr.len + 0.5 || sr.filled || (!b.arc.lit && !b.arc.stuck)) {
          this.phase = 'face';
          this.wait = 0.08;
          return;
        }
      }
      tr.has = true;
      tr.x = p.x + p.tx * lat;
      tr.y = p.y + p.ty * lat;
      tr.z = p.z + p.tz * lat;
      tr.press = true;
      this.nrm.x = p.nx;
      this.nrm.y = p.ny;
      this.nrm.z = p.nz;
      return;
    }
    tr.forceL = NaN;
    if (b.stage === 'chip') {
      if (this.phase !== 'chip') {
        this.phase = 'chip';
        g.queue({ type: 'mask', down: false });
        this.wait = 0.15;
        return;
      }
      // The hammer goes along the bead, a knock at each piece of slag.
      for (let i = 0; i < b.seams.length; i++) {
        const sr = b.seams[i];
        for (let c = 0; c < sr.n; c++)
          if (sr.slag[c] > 0) {
            const p = sr.pointAt(Math.min(sr.len, (c + 0.5) * sr.cell + 4), this.pt);
            if (!canReach(b, i, (c + 0.5) * sr.cell)) {
              faceSeam(b, i, (c + 0.5) * sr.cell);
              if (b.rotT) return;
            }
            tr.has = true;
            tr.x = p.x;
            tr.y = p.y;
            tr.z = p.z;
            this.nrm.x = p.nx;
            this.nrm.y = p.ny;
            this.nrm.z = p.nz;
            this.hitT -= dt;
            if (this.hitT <= 0) {
              this.hitT = 0.11;
              tr.press = true;
            }
            return;
          }
      }
    }
  }
}
