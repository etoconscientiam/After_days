import { BALANCE } from '../data/balance';
import type { Rng } from '../core/rng';
import type { Bus } from '../core/bus';
import type { SimEvents } from './events';
import type { Stats } from './stats';

const P = BALANCE.power;

/**
 * River → water wheel → dynamo → acid jars → the arc.
 * Cold slows the river; dips come at random and more often in the cold; jars smooth everything.
 */
export class Power {
  flow = 1;
  wheel = 1;
  /** Wheel angle for the view (radians). */
  angle = 0;
  raw = 1;
  I = 1;
  noise = 0;
  dipT = 0;
  dipLen = 0;
  dipDepth = 0;
  t = 0;

  step(dt: number, cold: number, stats: Stats, load: number, rng: Rng, bus: Bus<SimEvents>): void {
    this.t += dt;
    const t = this.t;
    const target = 1 - P.flowCold * cold + 0.035 * Math.sin(t * 0.31) + 0.025 * Math.sin(t * 0.97 + 1.3);
    this.flow += (target - this.flow) * (1 - Math.exp(-dt / P.flowTau));
    this.wheel += (this.flow - this.wheel) * (1 - Math.exp(-dt / P.wheelTau));
    this.angle += this.wheel * 0.9 * dt;

    if (this.dipT <= 0) {
      const rate = (P.dipRate + P.dipColdRate * cold) * stats.dipMul;
      if (rng.chance(rate * dt)) {
        this.dipLen = rng.range(P.dipLen[0], P.dipLen[1]);
        this.dipT = this.dipLen;
        this.dipDepth = rng.range(P.dipDepth[0], P.dipDepth[1]) * (0.6 + 0.6 * cold) * stats.dipMul;
        bus.emit('powerDip', { depth: this.dipDepth });
      }
    }
    let dip = 0;
    if (this.dipT > 0) {
      this.dipT -= dt;
      dip = this.dipDepth * Math.sin(Math.PI * Math.max(0, this.dipT) / this.dipLen);
    }
    this.noise += (rng.gauss() * P.ripple * (1 + 2 * cold) - this.noise) * Math.min(1, dt / 0.25);
    this.raw = this.wheel * stats.dynamoGain - dip - load * P.loadSag + this.noise;
    this.I += (this.raw - this.I) * (1 - Math.exp(-dt / stats.powerSmooth));
    if (this.I < 0.05) this.I = 0.05;
  }
}
