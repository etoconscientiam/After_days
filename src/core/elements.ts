// Elements: surface catastrophes and underground interventions.
import { CFG, ElementDef, M, mat, SX } from '../config';
import type { Game } from './game';
import { W, CAP } from '../world/World';
import { giveNote } from './prestige';

export function elementUnlocked(g: Game, el: ElementDef): boolean {
  if (el.world === 'hot' && !g.mods.hot) return false;
  if (g.mods.shards && (el.id === 'seaAdvance' || el.id === 'seaRetreat')) return false;
  return g.run.era >= el.era;
}

const zoneShares = (water: number, shore: number, land: number) => [water, shore, land];

export function castElement(g: Game, el: ElementDef, target?: { x: number; v: number }): void {
  const r = g.run;
  const p = el.params;
  const w = g.world;
  switch (el.id) {
    case 'rain': {
      r.active.push({ id: 'rain', until: r.year + el.duration });
      // carry carcasses downhill: land -> shore, shore -> water
      const move = (from: 'land' | 'shore', to: 'shore' | 'water') => {
        const a = r.pools[from], b = r.pools[to];
        const s = p.transport;
        const mass = (a.orgL + a.orgM + a.bone) * s;
        const bm = b.orgL + b.orgM + b.bone;
        b.orgL += a.orgL * s; b.orgM += a.orgM * s; b.bone += a.bone * s;
        for (let i = 0; i < a.boneSpec.length; i++) { b.boneSpec[i] += a.boneSpec[i] * s; a.boneSpec[i] *= 1 - s; }
        a.orgL *= 1 - s; a.orgM *= 1 - s; a.bone *= 1 - s;
        b.age = mass + bm > 0 ? (b.age * bm + a.age * mass) / (mass + bm) : 0;
      };
      move('shore', 'water');
      move('land', 'shore');
      break;
    }
    case 'flood': {
      r.active.push({ id: 'flood', until: r.year + el.duration });
      r.pools.shore.fast = el.duration;
      r.pools.water.fast = el.duration;
      g.kill(zoneShares(0, p.kill.shore, 0), 'flood');
      break;
    }
    case 'drought': {
      r.active.push({ id: 'drought', until: r.year + el.duration });
      g.kill(zoneShares(0, 0, p.kill.land), 'drought');
      break;
    }
    case 'groundwater':
    case 'heat':
    case 'magma': {
      if (!target) return;
      const t = g.targetFromSection(target.x, target.v, p.radiusX, p.radiusY)!;
      t.kind = el.id === 'groundwater' ? 'water' : el.id === 'heat' ? 'heat' : 'magma';
      t.heat = p.heat ?? 0;
      t.until = r.year + el.duration;
      r.targets.push(t);
      if (el.id === 'magma') {
        // inject a pocket of magma into the chosen layers
        for (let x = t.x0; x <= t.x1; x++) {
          const dx = (x - target.x) / p.radiusX;
          for (let i = 0; i < w.len[x]; i++) {
            const j = x * CAP + i;
            const b = w.birth[j];
            if (b < t.b0 || b > t.b1) continue;
            const mid = (t.b0 + t.b1) / 2, half = Math.max(1, (t.b1 - t.b0) / 2);
            const dyv = (b - mid) / half;
            if (dx * dx + dyv * dyv <= 1) { w.mat[j] = M.magma; w.prog[j] = 0; }
          }
        }
      }
      w.version++;
      break;
    }
    case 'volcano': {
      let vent: number;
      if (g.mods.shards) vent = Math.round((g.lastShard * 120 + 30 + g.rng.next() * 60) * SX);
      else vent = Math.floor(r.waterEnd + g.rng.next() * Math.max(20, W - r.waterEnd - 10));
      vent = Math.max(2, Math.min(W - 3, vent));
      r.active.push({ id: 'volcanoFx', until: r.year + 30, x: vent });
      // burial ×5: ash takes the whole carcass pool
      for (let x = 0; x < W; x++) {
        const d = (x - vent) / p.radius;
        const rows = Math.round(p.ashRows * Math.exp(-d * d)) + (g.rng.next() < 0.3 ? 1 : 0);
        const zi = g.zoneMap[x];
        for (let k = 0; k < rows; k++) g.depositCell(x, M.ash, zi, k === 0 ? p.burial : 1);
        if (Math.abs(x - vent) < p.radius) {
          for (let i = 0; i < w.len[x]; i++) w.k[x * CAP + i] = Math.max(1, w.k[x * CAP + i] + p.kDelta);
        }
      }
      const vz = g.zoneMap[vent];
      const shares = [0.1, 0.1, 0.1];
      shares[vz] = p.kill;
      g.kill(shares, 'volcano');
      r.targets.push({ kind: 'heat', x0: Math.max(0, vent - Math.round(24 * SX)), x1: Math.min(W - 1, vent + Math.round(24 * SX)), b0: -1e9, b1: 1e9, until: r.year + p.heatYears, heat: p.heat });
      if (g.mods.hot) {
        // lava at the surface near the vent
        for (let x = vent - Math.round(10 * SX); x <= vent + Math.round(10 * SX); x++) if (x >= 0 && x < W) w.deposit(x, M.magma, r.year);
      }
      w.version++;
      break;
    }
    case 'seaAdvance':
    case 'seaRetreat': {
      const shift = Math.round(p.shift * CFG.B.world.ref640);
      const minW = Math.round(CFG.B.zones.minWidth640 * CFG.B.world.ref640);
      const shoreW = r.shoreEnd - r.waterEnd;
      if (el.id === 'seaAdvance') {
        const ne = Math.min(W - minW - shoreW, r.waterEnd + shift);
        // rows under the new water get compacted
        for (let x = r.waterEnd; x < ne; x++) for (let i = 0; i < w.len[x]; i++) w.k[x * CAP + i] += p.kDelta;
        r.waterEnd = ne;
      } else {
        r.waterEnd = Math.max(minW, r.waterEnd - shift);
      }
      r.shoreEnd = r.waterEnd + shoreW;
      g.recomputeZones();
      g.statsDirty = true;
      w.version++;
      break;
    }
    case 'earthquake': {
      const x0 = Math.floor((40 + g.rng.next() * 280) * SX);
      const rightUp = g.rng.next() < 0.5;
      const lift = g.rng.int(p.liftMin, p.liftMax);
      const A = g.rng.range(p.foldMin, p.foldMax);
      const lam = g.rng.range(120, 300) * CFG.B.world.ref640;
      for (let x = 0; x < W; x++) {
        const side = rightUp ? x > x0 : x < x0;
        const ramp = Math.min(1, Math.abs(x - x0) / 6);
        const fold = A * Math.sin((2 * Math.PI * (x - x0)) / lam) * Math.exp(-Math.abs(x - x0) / (200 * CFG.B.world.ref640));
        w.fold[x] += fold + (side ? lift * 0.25 * ramp : 0);
        if (side) {
          // uplift + erosion: the raised block loses its top, deeper rocks come closer to the surface
          const n = Math.round(lift * ramp * 0.5);
          w.removeTop(x, n);
        }
        if (Math.abs(x - x0) < p.faultWidth * CFG.B.world.ref640) {
          for (let i = 0; i < w.len[x]; i++) w.k[x * CAP + i] = Math.max(1, w.k[x * CAP + i] + p.kDelta);
        }
      }
      for (let i = 0; i < Math.min(12, w.packs.length); i++) if (g.rng.next() < p.noteChance) giveNote(g);
      // small things from the technogenic horizon come up with the fault
      if (g.rng.next() < CFG.story.relicChance) {
        const rel = g.rng.pick(CFG.relics).id;
        g.legacy.relics[rel] = (g.legacy.relics[rel] ?? 0) + 1;
        g.statsDirty = true;
        g.bus.emit('relicFound', { id: rel });
      }
      r.active.push({ id: 'quakeFx', until: r.year + 5, x: x0 });
      g.kill([0.03, 0.08, 0.08], 'earthquake');
      w.version++;
      break;
    }
    case 'glacier': {
      r.active.push({ id: 'glacier', until: r.year + el.duration });
      r.glacierLoad = p.load;
      for (let x = 0; x < W; x++) {
        const zi = g.zoneMap[x];
        if (zi === 0) continue;
        const rows = Math.round(p.moraineRows * (zi === 2 ? 1 : 0.5));
        for (let k = 0; k < rows; k++) g.depositCell(x, M.moraine, zi, 1);
      }
      g.kill(zoneShares(0, p.kill.shore, p.kill.land), 'glacier');
      w.version++;
      break;
    }
    case 'meteor': {
      const cx = Math.floor((30 + g.rng.next() * 300) * SX);
      const R = p.craterRadius;
      for (let x = 0; x < W; x++) {
        const d = Math.abs(x - cx);
        if (d < R) w.removeTop(x, Math.round(12 * (1 - (d / R) ** 2)));
        const zi = g.zoneMap[x];
        const rows = d < R ? 3 : 1;
        for (let k = 0; k < rows; k++) g.depositCell(x, M.meteor, zi, k === 0 ? 5 : 1);
        for (let i = 0; i < w.len[x]; i++) w.k[x * CAP + i] = Math.min(CFG.B.physics.kMax + g.stats.kMax, w.k[x * CAP + i] + p.kDelta);
      }
      for (const pk of w.packs) pk.k = Math.min(CFG.B.physics.kMax + g.stats.kMax, pk.k + p.kDelta);
      g.addRock('rare', p.rare, cx);
      g.kill([p.kill, p.kill, p.kill], 'meteor');
      r.active.push({ id: 'meteorFx', until: r.year + 60, x: cx });
      w.version++;
      break;
    }
  }
}

export { mat };
