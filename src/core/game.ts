// The Game: owns state + world, advances time, exposes player actions. No DOM access (runs in Node for the sim).
import { CFG, M, ZONES, ZoneId, SpeciesDef, ElementDef, SX } from '../config';
import { Grid, GW, P_OLD } from '../world/Grid';
import { Archive } from '../world/Archive';
import { stepFull, Water } from './sand';
import { sinkStep } from './pressure';
import { fingerPush } from './finger';
import { BandLine, captureRow, pushBand } from './absorb';
import { fluidStep } from './fluids';
import { Surface, newSurface, readSurface, wildStep, nicheOpen, wildOf } from './niche';
import { coat } from './beds';
import { drizzle, reliefRow, tapPile, zoneSourcesBase } from './sources';
import { geoTickGame } from './geology';
import type { GeoReport } from './pressure';
import { EventBus } from './events';
import { RNG, hash2 } from './rng';
import { GameState, newGameState, newRun, newMeta, TargetZone } from './state';
import { computeStats, Stats, upgradePrice, densityPrice } from './stats';
import { lifeStep, killShare, addCarcass, totalPop, speciesAlive } from './life';
import { castElement, elementUnlocked } from './elements';
import { prestigeGain, doPrestige } from './prestige';
import { nextRareIn, spawnRare, claimRare, RareEvent } from './rare';
import { drawOrders, checkOrders } from './orders';
import { triggerEcho, randomEcho, echoInterval, currentItem } from './echoes';

export interface WorldMods {
  hot: boolean; living: boolean; shards: boolean;
  geoGradientMul: number;
}

/** A sparkle of a new rock (world pixels). */
export interface Glint { x: number; y: number; t: number; color: string }

const W = CFG.B.world.width;
const SAND = CFG.B.sand;

export class Game {
  state: GameState;
  /** the visible strata: falling particles (world/Grid.ts) */
  grid: Grid;
  /** the depth below them: layers the conveyor took (world/Archive.ts) */
  archive: Archive;
  /** sea columns and the water line, for the physics */
  water: Water = { col: new Uint8Array(GW), level: 0 };
  /** per particle column: the drizzle of sediment waiting to fall (fractions of a particle) */
  dripAcc = new Float32Array(GW);
  /** the last geology report (heat glow, pressure) */
  geoReport: GeoReport | null = null;
  /** particles that moved on the last physics step (marker beds wait for the air to clear) */
  moving = 0;
  private physAcc = 0;
  private physTick = 0;
  bus = new EventBus();
  rng: RNG;
  stats!: Stats;
  mods!: WorldMods;
  zoneMap = new Uint8Array(W);          // 0 water, 1 shore, 2 land
  basinMap = new Uint8Array(W);         // shard world basin index
  zoneWidth = [0, 0, 0];
  zoneMix = new Float32Array(W * 3);   // per column: share of water/shore/land in a ±18 px window (smooth borders)
  colNoise = new Float32Array(W);
  glints: Glint[] = [];
  /** particles that turned into rock under a press or a glowing-layer event: they flash (world pixels) */
  pressFlashes: { x: number; y: number; t: number; color: string }[] = [];
  /** transformations under heat running now, per particle column: strength 0..1 and the row of the hottest one */
  hotNow = new Float32Array(GW);
  hotY = new Int16Array(GW);
  /** debug panel switches (not saved) */
  cheats = { capMul: 1, freeElements: false, infiniteEnergy: false };
  /** the rare surface event on screen, if any (brief 5, В1) */
  rare: RareEvent | null = null;
  rareTimer = 90;
  private shepherdAcc = 0;
  geoAcc = 0;
  geoYears = 0;
  statsDirty = true;
  headless = false;
  lastShard = 1;
  echoTimer = 25;
  zoneGlow = [0, 0, 0];                 // mean glow of the technogenic horizon under each zone
  glow = new Float32Array(W);           // horizon glow profile (energy source)

  constructor(state?: GameState, grid?: Grid, archive?: Archive) {
    this.state = state ?? newGameState();
    this.rng = new RNG(this.state.seed);
    this.grid = grid ?? new Grid();
    this.archive = archive ?? new Archive();
    for (let x = 0; x < W; x++) this.colNoise[x] = 0.85 + 0.3 * (0.5 + 0.5 * Math.sin((x / SX) * 0.071) * Math.cos((x / SX) * 0.023 + 1.3));
    this.refreshMods();
    this.recomputeZones();
    if (!grid) this.resetStrata();
    this.refreshStats();
  }

  /** An empty world: bedrock, the foundation of past epochs, the thing(s) on it; no archive. */
  resetStrata(): void {
    const centers = this.mods.shards ? this.shardXs().map((x) => x / 2) : [GW / 2];
    this.grid.reset(centers, this.meta.foundation / 2);
    this.archive.reset();
    this.dripAcc.fill(0);
    this.run.sink = { acc: 0, rows: 0 };
    this.run.beds = [];
    this.band = [];
    // a world starts bare: the foundation and the thing on it, nothing else — taps bury it (sand.startEmpty)
    if (!SAND.startEmpty) this.prefill();
  }

  /** A world starts on the ground of the old one: the strata filled up to just under the line (the sea floor lower),
   *  of what each zone lays down — dust (or soil, once land life has been), sand on the shore, silt under the sea. */
  prefill(): void {
    const g = this.grid;
    const line = this.lineRow() + SAND.startBelowLine;
    const base = zoneSourcesBase(this);
    // the old ground has strata of its own: one sequence of wavy beds across the whole world (so they run on
    // under every zone), beds of uneven thickness; the even beds are the zone's own rock, with a ragged border
    // between zones, the odd ones are thin partings shared by all
    const M2 = CFG.matIndex;
    const partings = [M2.clay, M2.silt, M2.sand, M2.clay, this.run.era < CFG.B.zones.landAltBeforeEra ? M2.silt : M2.dust];
    let seed = this.state.seed >>> 0;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) >>> 24);
    const ph = (rnd() / 255) * 6;
    // bed boundaries (depth from the top line): a thick bed of the zone's rock, then a thin parting
    const bedOf = new Int16Array(g.floor + 16);
    for (let d = 0, k = 0; d < bedOf.length; k++) {
      const h = k % 2 === 0 ? 5 + (rnd() % 7) : 2 + (rnd() % 3);
      for (let j = 0; j < h && d < bedOf.length; j++) bedOf[d++] = k;
    }
    for (let x = 0; x < GW; x++) {
      const wave = Math.round(Math.sin(x * 0.11 + 1.3) * 0.8 + Math.sin(x * 0.037) * 0.8);
      // the old ground already has the relief the sediment keeps: a sea floor under the water, dry land
      const top = Math.round(reliefRow(this, x)) + SAND.startBelowLine + wave;
      const bottom = g.isArtifactCol(x) ? g.sinkRow : g.floor - 1;
      const bend = 2.2 * Math.sin(x * 0.09 + ph) + 1.4 * Math.sin(x * 0.23 + ph * 2);
      for (let y = Math.max(0, top); y <= bottom; y++) {
        const d = Math.max(0, Math.min(bedOf.length - 1, Math.floor(y - line + 4 + bend)));
        const k = bedOf[d];
        let m: number;
        if (k % 2) m = partings[(k >> 1) % partings.length];
        else {
          // the zone of this cell: the border wanders with depth (tongues of one rock into the next)
          const jx = Math.round(x + 3 * Math.sin(y * 0.35 + ph) + 2 * Math.sin(y * 0.9));
          m = base[this.zoneMap[Math.max(0, Math.min(GW - 1, jx)) * 2 + 1]];
        }
        g.put(x, y, m, rnd(), this.run.year - 1, P_OLD);
      }
    }
    g.computeTops();
    g.still.fill(1);
  }

  /** Mean of the relief shape (rows below the water), set with the zones. */
  reliefMean = 0;
  /** The row of the water line. */
  seaRow(): number {
    return Math.round(this.lineRow() - SAND.seaAboveLine - this.reliefMean);
  }

  /** The row of the line where the strata settle (the conveyor holds them there). */
  lineRow(): number {
    return this.grid.sinkRow + 1 - Math.round(SAND.sinkLine * SAND.refRows);
  }

  /** The sea: its columns and every column whose ground lies under the water line. The water does not drain:
   *  a hollow cut off from the sea by a pile that rose above it stays a lagoon (it used to turn to a dark void,
   *  being no longer joined to the sea). */
  updateWater(): void {
    const g = this.grid, col = this.water.col;
    const level = this.seaRow();
    this.water.level = level;
    col.fill(0);
    for (let x = 0; x < GW; x++) if (this.zoneMap[x * 2 + 1] === 0 || g.surf[x] > level) col[x] = 1;
    readSurface(this);
  }

  // ---------- derived ----------
  refreshMods(): void {
    const r = this.state.legacy.rituals;
    this.mods = {
      hot: r.includes('bury'),
      living: r.includes('eat'),
      shards: r.includes('shatter'),
      geoGradientMul: r.includes('bury') ? CFG.B.hotWorld.gradientMul : 1,
    };
  }

  refreshStats(): void {
    this.stats = computeStats(this.state);
    this.statsDirty = false;
  }

  get run() { return this.state.run; }
  get meta() { return this.state.meta; }
  get legacy() { return this.state.legacy; }

  recomputeZones(): void {
    const r = this.run;
    if (this.mods.shards) {
      // three basins: sea | forest | steppe, separated by ridges
      for (let x = 0; x < W; x++) {
        const u = x / SX;
        const b = u < 120 ? 0 : u < 240 ? 1 : 2;
        this.basinMap[x] = b;
        let z = 2;
        if (b === 0) z = u < 84 ? 0 : 1;
        else if (b === 1) z = u < 132 || u >= 228 ? 1 : 2;
        this.zoneMap[x] = z;
      }
    } else {
      for (let x = 0; x < W; x++) this.zoneMap[x] = x < r.waterEnd ? 0 : x < r.shoreEnd ? 1 : 2;
    }
    this.zoneWidth = [0, 0, 0];
    for (let x = 0; x < W; x++) this.zoneWidth[this.zoneMap[x]]++;
    const R = Math.round(18 * SX);
    for (let x = 0; x < W; x++) {
      const m = [0, 0, 0];
      let n = 0;
      for (let d = -R; d <= R; d++) {
        const xx = x + d;
        if (xx < 0 || xx >= W) continue;
        const w = 1 - Math.abs(d) / (R + 1);
        m[this.zoneMap[xx]] += w; n += w;
      }
      for (let z = 0; z < 3; z++) this.zoneMix[x * 3 + z] = m[z] / n;
    }
    // the relief the sediment keeps has its mean on the line where the conveyor holds the strata: the water stands
    // that much above the line, so the sea floor is under it and the land above it, whatever the zones' widths
    const RL = SAND.relief;
    let off = 0;
    for (let x = 0; x < W; x++) off += this.zoneMix[x * 3] * RL.sea + this.zoneMix[x * 3 + 1] * RL.shore + this.zoneMix[x * 3 + 2] * RL.land;
    this.reliefMean = off / W;
    // the technogenic horizon glows around the thing; creatures above bright ground earn a little more
    const H = CFG.story.horizon;
    const centers = this.mods.shards ? this.shardXs() : [W / 2];
    const sum = [0, 0, 0];
    for (let x = 0; x < W; x++) {
      let b = 0.12;
      for (const c of centers) b += 0.88 * Math.exp(-(((x - c) / H.glowWidth) ** 2));
      if (hash2(Math.floor(x / (8 * SX)), 913) > 0.86) b += 0.25;
      this.glow[x] = Math.min(1, b);
      sum[this.zoneMap[x]] += this.glow[x];
    }
    for (let z = 0; z < 3; z++) this.zoneGlow[z] = this.zoneWidth[z] ? sum[z] / this.zoneWidth[z] : 0;
    this.updateWater();
  }

  zoneIndex(z: ZoneId): number { return ZONES.indexOf(z); }

  /** Capacity of a zone in population units. */
  capacity(zi: number): number {
    const st = this.stats;
    let c = (this.zoneWidth[zi] / CFG.B.world.ref640) * CFG.B.zones.capacityPerPx640 * this.cheats.capMul;
    if (zi === 0) c *= 1 + st.seaCapacity;
    if (zi === 2) c *= 1 + st.landCapacity + this.run.fertility;
    return Math.floor(c);
  }

  /** Space one unit of a species takes (mutations can shrink it). */
  unitSize(sp: SpeciesDef): number {
    const mu = this.run.mutations[sp.id];
    if (mu === 'swarm') return 1 / 1.5;
    return 1;
  }

  used(zi: number): number {
    let u = 0;
    for (const sp of CFG.species) u += this.run.pop[sp.id][zi] * this.unitSize(sp);
    return u;
  }

  habitatZones(sp: SpeciesDef): number[] {
    switch (sp.zone) {
      case 'water': return [0];
      case 'shore': return [1];
      case 'land': return [2];
      case 'shoreLand': return [1, 2];
      default: return [0, 1, 2];
    }
  }

  /** First zone of the habitat (in preference order) with room for one more unit, or -1. */
  freeZoneFor(sp: SpeciesDef): number {
    for (const zi of this.habitatZones(sp)) {
      const free = this.capacity(zi) - this.used(zi);
      if (free >= this.unitSize(sp) - 1e-9) return zi;
    }
    return -1;
  }

  /**
   * Where one unit of sp can go when bought: a zone with free room, or — when its zones are full — a zone where
   * simpler (cheaper) life gives way to it: the most numerous of them die off to make room (never the last of a
   * kind). Returns the zone and who gives way, or null. (Natural regrowth never displaces: it uses freeZoneFor.)
   */
  placeFor(sp: SpeciesDef): { zi: number; take: [string, number][] } | null {
    const zi0 = this.freeZoneFor(sp);
    if (zi0 >= 0) return { zi: zi0, take: [] };
    const need = this.unitSize(sp);
    for (const zi of this.habitatZones(sp)) {
      let lack = need - (this.capacity(zi) - this.used(zi));
      const others = CFG.species.filter((o) => o.id !== sp.id && o.cost < sp.cost && this.run.pop[o.id][zi] > 1)
        .sort((a, b) => this.run.pop[b.id][zi] * this.unitSize(b) - this.run.pop[a.id][zi] * this.unitSize(a));
      const take: [string, number][] = [];
      for (const o of others) {
        if (lack <= 1e-9) break;
        const size = this.unitSize(o);
        const n = Math.min(this.run.pop[o.id][zi] - 1, Math.ceil(lack / size - 1e-9));
        if (n > 0) { take.push([o.id, n]); lack -= n * size; }
      }
      if (lack <= 1e-9) return { zi, take };
    }
    return null;
  }

  /** How many units of sp could still be bought (free room plus what simpler life would give up). */
  roomUnits(sp: SpeciesDef): number {
    const size = this.unitSize(sp);
    let n = 0;
    for (const zi of this.habitatZones(sp)) {
      let room = Math.max(0, this.capacity(zi) - this.used(zi));
      for (const o of CFG.species) if (o.id !== sp.id && o.cost < sp.cost) room += Math.max(0, this.run.pop[o.id][zi] - 1) * this.unitSize(o);
      n += Math.floor(room / size + 1e-9);
    }
    return n;
  }

  // ---------- time ----------
  eraDef() { return CFG.eras[this.run.era]; }

  lifeMultiplier(): number {
    return 1 + CFG.B.time.lifeSpeedPerSpecies * speciesAlive(this);
  }

  yps(withBoost = true): number {
    const st = this.stats;
    let v = this.eraDef().yps * (1 + st.timeSpeed) * (1 + st.timeSpeedDensity) * (1 + st.traitTime) * this.lifeMultiplier();
    if (withBoost && this.run.boost > 0) v *= CFG.B.energy.boostMul;
    if (withBoost && this.run.buffs.timeT > 0) v *= this.run.buffs.timeMul;
    if (this.hurrying()) v *= CFG.B.time.hurryMul;
    return v;
  }

  /** The era's condition is met before its end: time hurries to the end (nothing left to wait for). */
  hurrying(): boolean {
    const r = this.run;
    return this.state.phase === 'play' && r.era < 7 && r.year < this.eraDef().end && this.eraConditionMet();
  }

  lifeIncome(): number {
    const st = this.stats;
    let e = 0;
    for (const sp of CFG.species) {
      const p = this.run.pop[sp.id];
      const n = p[0] + p[1] + p[2];
      if (!n) continue;
      let eps = sp.eps;
      if (this.run.mutations[sp.id] === 'vigor') eps *= 1.5;
      const gb = CFG.story.horizon.glowBonus;
      let v = eps * (p[0] * (1 + gb * this.zoneGlow[0]) + p[1] * (1 + gb * this.zoneGlow[1]) + p[2] * (1 + gb * this.zoneGlow[2]));
      if (st.seaEnergy && sp.zone === 'water') v *= 1 + st.seaEnergy;
      e += v;
    }
    return e * (1 + st.lifeEnergy);
  }

  incomePerSec(withBoost = true): number {
    const st = this.stats;
    let e = (CFG.B.energy.passive + st.passiveAdd + this.lifeIncome()) * st.energyMul;
    if (withBoost && this.run.boost > 0) e *= CFG.B.energy.boostMul;
    if (withBoost && this.run.buffs.energyT > 0) e *= this.run.buffs.energyMul;
    return e;
  }

  clickValue(): number {
    const st = this.stats;
    let e = (CFG.B.energy.click + st.clickAdd) * st.clickMul * st.energyMul;
    // clicks scale gently with passive income so they never become worthless (most of a tap's energy comes later,
    // when its pile reaches the thing and is absorbed: core/absorb.ts)
    e += this.incomePerSec(false) * CFG.B.energy.clickIncomeShare;
    if (this.run.boost > 0) e *= CFG.B.energy.boostMul;
    return e;
  }

  boostMax(): number { return CFG.B.energy.boostMax + this.stats.boostMax; }

  // ---------- main loop ----------
  update(dt: number): void {
    const s = this.state;
    if (this.statsDirty) this.refreshStats();
    const r = s.run;
    r.realTime += dt;
    s.meta.realTime += dt;
    s.legacy.totalRealTime += dt;

    if (s.phase === 'temple') {
      s.templeProgress = Math.min(1, s.templeProgress + (dt / 24) * (1 + this.stats.temple));
      if (s.templeProgress >= 1) this.finishTemple();
      return;
    }
    if (s.phase !== 'play') return;

    r.boost = Math.max(0, r.boost - dt);
    for (let b = 0; b < 3; b++) r.shardBoost[b] = Math.max(0, r.shardBoost[b] - dt);
    for (const k in r.cooldowns) r.cooldowns[k] = Math.max(0, r.cooldowns[k] - dt);
    r.buffs.energyT = Math.max(0, r.buffs.energyT - dt);
    r.buffs.timeT = Math.max(0, r.buffs.timeT - dt);
    r.burialWindow = Math.max(0, r.burialWindow - dt);
    r.burialCooldown = Math.max(0, r.burialCooldown - dt);
    // press: costs 2% of the income per second; short of Energy it weakens instead of stopping
    if (r.press) {
      const cost = CFG.B.press.costShare * this.incomePerSec(false) * dt;
      let strength = 1;
      if (cost > 0) {
        if (r.energy >= cost) r.energy -= cost;
        else { strength = Math.max(0.15, r.energy / cost); r.energy = 0; }
      }
      r.press.power = strength * (1 + this.stats.pressPower);
    }
    for (let i = this.pressFlashes.length - 1; i >= 0; i--) { this.pressFlashes[i].t -= dt; if (this.pressFlashes[i].t <= 0) this.pressFlashes.splice(i, 1); }
    // rare surface events: only for a watching player
    if (!this.headless) {
      if (this.rare) { this.rare.t -= dt; if (this.rare.t <= 0) this.rare = null; }
      else if ((this.rareTimer -= dt) <= 0) {
        this.rare = spawnRare(this);
        this.rareTimer = nextRareIn(this);
        if (this.rare) this.bus.emit('rareSpawn', { id: this.rare.def.id, x: this.rare.x });
      }
    }
    // Shepherd: chosen species buy themselves, one each half second
    this.shepherdAcc += dt;
    if (this.shepherdAcc >= 0.5) {
      this.shepherdAcc = 0;
      let slots = this.stats.shepherdSlots;
      for (const id in r.shepherd) {
        if (!r.shepherd[id]) continue;
        if (slots-- <= 0) { r.shepherd[id] = false; continue; }
        const sp = CFG.speciesById[id];
        if (sp && this.speciesUnlocked(sp) && r.energy >= this.speciesCost(sp) && this.placeFor(sp)) this.buySpecies(id);
      }
    }
    drawOrders(this);
    checkOrders(this);

    const inc = this.incomePerSec() * dt;
    r.energy += inc;
    r.energyEarned += inc;

    // the calendar waits at an era's end until its condition is met; the world does not: life, oxygen, deposits
    // and compaction keep going (otherwise an unmet condition such as oxygen could never be reached)
    const want = this.yps() * dt;
    const cal = this.advanceYears(want);
    const dy = Math.max(cal, want);
    r.clock += dy;
    this.simulate(dy);

    this.geoAcc += dt;
    this.geoYears += dy;
    if (this.geoAcc >= CFG.B.time.geoTick) {
      this.updateWater();
      geoTickGame(this, this.geoYears);
      this.geoAcc = 0;
      this.geoYears = 0;
    }
    // the sea: every frame (cheap): a new world, a pile above the water, a hollow cut off — the water follows at once
    // (it used to wait for the geology tick, and a new world showed half its sea for a while)
    this.updateWater();
    this.strataStep(dt);
    wildStep(this, dt);
    // the absorbed energy a second, eased over a few seconds (the lines come in bursts)
    if (dt > 0) { this.absorbRate += (this.absorbAcc / dt - this.absorbRate) * Math.min(1, dt / 4); this.absorbAcc = 0; }
    this.autoElements(dt);
    this.checkEra();
    if (this.meta.prestiges === 0 && r.year >= CFG.story.traces.endYear) triggerEcho(this, 'tracesErased');
    if (!this.headless) {
      this.echoTimer -= dt;
      if (this.echoTimer <= 0) {
        this.echoTimer = echoInterval(this);
        randomEcho(this);
      }
    }
    for (let i = this.glints.length - 1; i >= 0; i--) {
      this.glints[i].t -= dt;
      if (this.glints[i].t <= 0) this.glints.splice(i, 1);
    }
  }

  /** Particles fall (full mode, a fixed number of steps a second), the conveyor sinks the oldest rows, waiting marker beds
   *  are laid. dt = real seconds. In the balance run and offline (headless) particles settle at once, no steps. */
  /** The band of squeezed lines above the thing (newest first): it absorbs the lowest one (core/absorb.ts). */
  band: BandLine[] = [];
  /** Energy absorbed since the last update, and its rate a second (eased) for the counter. */
  absorbAcc = 0;
  absorbRate = 0;
  /** Weak phones (quality «low»): fewer physics steps a second. */
  lowPhysics = false;
  /** Particles that turned to rock so far (the screen ticks a quiet sound on new ones). */
  transforms = 0;
  /** Milliseconds of physics a frame (eased), for the debug panel. */
  physMs = 0;
  /** migration ticks owed (core/fluids.ts) */
  fluidAcc = 0;
  /** what the surface of the zones is made of (core/niche.ts) */
  surface: Surface = newSurface();
  /** seconds to the next lens of buried water; seconds since the last eruption check (core/fluids.ts) */
  lensT = 8;
  eruptT = 0;

  /** grains of a pile that found their cell taken (a quick run of taps): poured in from the top as room frees */
  spill: { x: number; m: number; birth: number }[] = [];
  private spillStep(): void {
    if (!this.spill.length) return;
    const grid = this.grid;
    let left = 40;
    for (let k = 0; k < this.spill.length && left > 0; k++) {
      const s = this.spill[k];
      // the first free cell in the top rows of its column or a neighbour
      for (const dx of [0, -1, 1, -2, 2]) {
        const x = Math.max(0, Math.min(GW - 1, s.x + dx));
        let done = false;
        for (let y = 0; y < 6; y++) {
          if (grid.mat[y * GW + x]) continue;
          if (grid.put(x, y, s.m, (this.rng.next() * 256) | 0, s.birth) >= 0) { this.run.layers++; done = true; }
          break;
        }
        if (done) { this.spill.splice(k, 1); k--; left--; break; }
      }
    }
  }

  strataStep(dt: number): void {
    const r = this.run;
    if (!this.headless) {
      const step = 1 / (this.lowPhysics ? SAND.stepsPerSecondLow : SAND.stepsPerSecond);
      this.physAcc = Math.min(this.physAcc + dt, step * 6);
      const t0 = performance.now();
      fingerPush(this);
      this.spillStep();
      while (this.physAcc >= step) {
        this.physAcc -= step;
        this.moving = stepFull(this.grid, this.rng, this.water, this.physTick++);
      }
      // for the debug panel: physics time a frame, eased
      this.physMs += (performance.now() - t0 - this.physMs) * 0.1;
    } else this.moving = 0;
    fluidStep(this, dt);
    sinkStep(this.grid, r.sink, dt, (g, y) => { pushBand(this, captureRow(g, y)); this.archive.addRow(g, y); });
    this.layBeds(dt);
    r.bedT = Math.max(0, r.bedT - dt);
  }

  /** Lay the first waiting marker bed once nothing is falling (or it has waited long enough). */
  private layBeds(dt: number): void {
    const b = this.run.beds[0];
    if (!b) return;
    b.wait += dt;
    if (this.moving > 6 && b.wait < SAND.coatWait) return;
    this.run.beds.shift();
    let shown = 0;
    const n = coat(this.grid, b.m, b.x0, b.x1, (i) => {
      if (shown++ % 9 === 0 && this.glints.length < 120) this.glints.push({ x: (i % GW) * 2 + 1, y: Math.floor(i / GW) * 2 + 1, t: 0.7, color: CFG.materials[b.m].palette[4] });
    });
    if (n) this.bus.emit('bedLaid', { mat: CFG.materials[b.m].id, n });
  }

  /** Ask for a marker bed of material m over particle columns x0..x1. */
  queueBed(m: number, x0 = 0, x1 = GW - 1): void {
    this.run.beds.push({ m, x0, x1, wait: 0 });
  }

  /** The «Bed» button: a thin bed of ochre over the whole surface. */
  layBed(): boolean {
    if (this.state.phase !== 'play' || this.run.bedT > 0) return false;
    this.run.bedT = SAND.bedCooldown;
    this.queueBed(M.ochre);
    return true;
  }

  /** A tap in the world: Energy as before, and a pile falls into that column. */
  /** Particles in a tapped pile. */
  pileSize(): number { return Math.round(SAND.pile.base + SAND.pile.perLevel * this.stats.pileSize); }

  tap(X: number, shard = -1): number {
    const e = this.click(shard);
    if (this.state.phase === 'play') tapPile(this, X, this.pileSize());
    return e;
  }

  /** Life, deposition, effect expiry and excavation for dy game years. */
  simulate(dy: number): void {
    if (dy <= 0) return;
    const r = this.run;
    lifeStep(this, dy);
    drizzle(this, dy);
    // expire effects
    for (let i = r.active.length - 1; i >= 0; i--) {
      const a = r.active[i];
      if (a.id === 'glacier') r.glacierLoad = CFG.elements.find((e) => e.id === 'glacier')!.params.load;
      if (r.clock >= a.until) {
        if (a.id === 'glacier') r.glacierLoad = 0;
        r.active.splice(i, 1);
      }
    }
    for (let i = r.targets.length - 1; i >= 0; i--) if (r.clock >= r.targets[i].until) { r.targets.splice(i, 1); this.grid.version++; }
    for (const z of ZONES) r.pools[z].fast = Math.max(0, r.pools[z].fast - dy);
    // excavation (era 7)
    if (r.era === 7) {
      const tribe = this.groupPop('tribe') + this.groupPop('hominid') * 0.25;
      const ex = CFG.B.excavation;
      const fossorBonus = 1 + this.stats.excavation;
      const v = ex.rowsPerYear * (tribe / ex.perPop) * fossorBonus * dy;
      if (this.mods.shards) {
        for (let b = 0; b < 3; b++) r.excavationShards[b] += v;
        r.excavation = Math.min(...r.excavationShards);
      } else r.excavation += v;
    }
  }

  /** Advance the year, clamping at an era boundary whose condition is not met. Returns years actually advanced. */
  advanceYears(dy: number): number {
    const r = this.run;
    const end = this.eraDef().end;
    const before = r.year;
    if (r.year + dy >= end) {
      if (r.era < 7 && this.eraConditionMet()) {
        r.year = Math.min(r.year + dy, CFG.eras[Math.min(7, r.era + 1)].end);
      } else r.year = end;
    } else r.year += dy;
    return r.year - before;
  }

  groupPop(group: string): number {
    let n = 0;
    for (const sp of CFG.species) if (sp.groups.includes(group)) n += totalPop(this, sp.id);
    return n;
  }

  groupCount(group: string): number {
    let n = 0;
    for (const sp of CFG.species) if (sp.groups.includes(group) && totalPop(this, sp.id) > 0) n++;
    return n;
  }

  forestCover(): number {
    return totalPop(this, 'trees') / Math.max(1, this.capacity(2));
  }

  settlePop(): number {
    const r = this.run;
    const W2 = W / 2;
    const artifactDry = this.mods.shards ? true : this.zoneMap[W2] !== 0;
    if (!artifactDry) return 0;
    return totalPop(this, 'tribe') * (CFG.B.tribe.settleWeight + this.stats.tribeAttract) + this.groupPop('hominid') * 0.05;
  }

  eraConditionMet(): boolean {
    const r = this.run;
    const c = this.eraDef().cond;
    switch (c.type) {
      case 'energyEarned': return r.energyEarned >= c.value!;
      case 'oxygen': return r.oxygen >= c.value!;
      case 'speciesCount': return this.groupCount(c.group!) >= c.value!;
      case 'forest': return this.forestCover() >= c.value!;
      case 'animals': return this.groupCount('animal') >= c.value! && (!c.predator || totalPop(this, 'predators') > 0);
      case 'settled': return this.settlePop() >= c.value!;
      case 'excavation': return r.excavationNeed > 0 && r.excavation >= r.excavationNeed;
    }
    return false;
  }

  /** 0..1 progress of the current era condition (for the UI). */
  eraConditionProgress(): number {
    const r = this.run;
    const c = this.eraDef().cond;
    const f = (a: number, b: number) => Math.max(0, Math.min(1, a / b));
    switch (c.type) {
      case 'energyEarned': return f(r.energyEarned, c.value!);
      case 'oxygen': return f(r.oxygen, c.value!);
      case 'speciesCount': return f(this.groupCount(c.group!), c.value!);
      case 'forest': return f(this.forestCover(), c.value!);
      case 'animals': return f(this.groupCount('animal') + (totalPop(this, 'predators') > 0 ? 0 : -1), c.value!);
      case 'settled': return f(this.settlePop(), c.value!);
      case 'excavation': return r.excavationNeed > 0 ? f(r.excavation, r.excavationNeed) : 0;
    }
    return 0;
  }

  checkEra(): void {
    const r = this.run;
    if (r.era === 7) {
      if (this.eraConditionMet() && this.state.phase === 'play') {
        this.state.phase = 'finale';
        this.bus.emit('excavationDone', {});
        triggerEcho(this, 'finale');
      }
      return;
    }
    while (r.era < 7 && r.year >= this.eraDef().end && this.eraConditionMet()) this.enterEra(r.era + 1);
  }

  enterEra(era: number): void {
    const r = this.run;
    r.era = era;
    r.timeAtEra[era] = r.realTime;
    if (era > this.meta.maxEra) this.meta.maxEra = era;
    if (r.year < CFG.eras[era].start) r.year = CFG.eras[era].start;
    this.statsDirty = true;
    this.bus.emit('eraChanged', { era });
    triggerEcho(this, 'era:' + era);
    // the last high satellite goes out as era 0 ends (first run of a world only)
    if (era >= 1 && this.meta.prestiges === 0) triggerEcho(this, 'lastSatellite');
    // a golden bed marks the boundary of the epochs in the strata
    this.queueBed(M.boundary);
    if (this.mods.living && era >= 1) this.offerMutations();
  }

  triggerEcho(trigger: string): void { triggerEcho(this, trigger); }

  currentItem(): string | null { return currentItem(this); }

  availableItems(): string[] {
    return CFG.items.map((i) => i.id).filter((id) => !this.legacy.items.includes(id));
  }

  /** The opening choice: the thing goes into the ground and era 0 begins. */
  chooseItem(id: string): boolean {
    if (this.state.phase !== 'choose' || !this.availableItems().includes(id)) return false;
    this.legacy.items[this.legacy.playthrough - 1] = id;
    this.state.phase = 'play';
    this.bus.emit('itemChosen', { id });
    triggerEcho(this, 'era:0');
    return true;
  }

  firstTime(key: string): boolean {
    if (this.legacy.firsts[key]) return false;
    this.legacy.firsts[key] = true;
    return true;
  }

  // ---------- actions ----------
  click(shard = -1): number {
    if (this.state.phase !== 'play') return 0;
    const r = this.run;
    const e = this.clickValue();
    r.energy += e;
    r.energyEarned += e;
    r.boost = Math.min(this.boostMax(), r.boost + CFG.B.energy.boostPerClick);
    triggerEcho(this, 'firstClick');
    if (this.mods.shards && shard >= 0) {
      r.shardBoost[shard] = Math.min(this.boostMax(), r.shardBoost[shard] + 1);
      this.lastShard = shard;
    }
    this.bus.emit('click', { energy: e, boost: r.boost });
    return e;
  }

  /** Can sp live at all now (its epoch, oxygen, forerunners)? Whether it fits the surface is core/niche.ts. */
  speciesGate(sp: SpeciesDef): boolean {
    const r = this.run;
    if (r.era < sp.era) return false;
    if (sp.needsOxygen && r.oxygen < sp.needsOxygen) return false;
    if (sp.unlockAfter) {
      const prev = this.run.peak[sp.unlockAfter] ?? 0;
      if (prev < CFG.unlockAfterPop) return false;
    }
    return true;
  }

  /** Can sp be strengthened (bought) now: it lives, or its niche is open. */
  speciesUnlocked(sp: SpeciesDef): boolean {
    return this.speciesGate(sp) && (totalPop(this, sp.id) > 0 || nicheOpen(this, sp));
  }

  /** The price of strengthening sp by one unit: only the bought units raise it, not the wild ones. */
  speciesCost(sp: SpeciesDef): number {
    return sp.cost * CFG.costGrowth ** Math.max(0, totalPop(this, sp.id) - wildOf(this, sp.id));
  }

  buySpecies(id: string): boolean {
    const sp = CFG.speciesById[id];
    if (!sp || !this.speciesUnlocked(sp)) return false;
    const cost = this.speciesCost(sp);
    if (this.run.energy < cost) return false;
    const place = this.placeFor(sp);
    if (!place) return false;
    const zi = place.zi;
    this.run.energy -= cost;
    // simpler life gives way: it dies (and goes to the carcass pool — future fossils)
    for (const [oid, n] of place.take) {
      this.run.pop[oid][zi] -= n;
      addCarcass(this, zi, CFG.speciesById[oid], n);
      this.bus.emit('displaced', { id, of: oid, n });
    }
    this.run.pop[id][zi]++;
    const t = totalPop(this, id);
    if (t > (this.run.peak[id] ?? 0)) this.run.peak[id] = t;
    this.statsDirty = true;
    triggerEcho(this, 'firstLife');
    const landish = sp.zone === 'land' || sp.zone === 'shoreLand';
    if (landish && sp.groups.includes('animal')) triggerEcho(this, 'firstLandAnimal');
    if (landish && sp.groups.includes('plant')) triggerEcho(this, 'firstLandPlant');
    return true;
  }

  /** Release one unit: it dies and goes to the carcass pool (deliberate burial). */
  releaseSpecies(id: string): boolean {
    const sp = CFG.speciesById[id];
    const p = this.run.pop[id];
    let zi = -1, best = 0;
    for (let z = 0; z < 3; z++) if (p[z] > best) { best = p[z]; zi = z; }
    if (zi < 0) return false;
    p[zi]--;
    addCarcass(this, zi, sp, 1);
    this.run.peak[id] = totalPop(this, id);
    this.statsDirty = true;
    return true;
  }

  /** The composition of the piles, as in the prototype: the share of each bought material (the «pile composition»
   *  branch, energy) and of the zone's own matter. All bought shares together are at most sand.pileShareMax. */
  pileShares(): { own: number; mats: [string, number][] } {
    const mats: [string, number][] = [];
    let tot = 0;
    for (const u of CFG.upgrades) {
      if (!u.pileMat) continue;
      const p = this.stats.pile[u.pileMat] ?? 0;
      if (p > 0) { mats.push([u.pileMat, p]); tot += p; }
    }
    const k = tot > SAND.pileShareMax ? SAND.pileShareMax / tot : 1;
    for (const m of mats) m[1] *= k;
    return { own: 1 - tot * k, mats };
  }

  upgradeLevel(id: string): number { return this.run.upgrades[id] ?? 0; }

  upgradeCost(id: string): number {
    const u = CFG.upgrades.find((x) => x.id === id)!;
    return upgradePrice(u.base, this.upgradeLevel(id), u.growth);
  }

  currency(c: string): number {
    return c === 'energy' ? this.run.energy : this.run.rocks[c] ?? 0;
  }

  buyUpgrade(id: string): boolean {
    const u = CFG.upgrades.find((x) => x.id === id);
    if (!u) return false;
    if (u.era && this.run.era < u.era) return false;
    const cost = this.upgradeCost(id);
    if (this.currency(u.currency) < cost) return false;
    if (u.currency === 'energy') this.run.energy -= cost;
    else this.run.rocks[u.currency] -= cost;
    this.run.upgrades[id] = this.upgradeLevel(id) + 1;
    this.statsDirty = true;
    return true;
  }

  densityCost(id: string): number {
    const n = CFG.density.find((x) => x.id === id)!;
    return densityPrice(n.base, n.mult, this.meta.tree[id] ?? 0);
  }

  buyDensity(id: string): boolean {
    const n = CFG.density.find((x) => x.id === id);
    if (!n) return false;
    const lvl = this.meta.tree[id] ?? 0;
    if (lvl >= n.max) return false;
    if ((n.requires ?? 0) > this.meta.prestiges) return false;
    const cost = this.densityCost(id);
    if (this.meta.density < cost) return false;
    this.meta.density -= cost;
    this.meta.densitySpent += cost;
    this.meta.tree[id] = lvl + 1;
    this.statsDirty = true;
    return true;
  }

  elementCost(el: ElementDef): number {
    if (this.cheats.freeElements) return 0;
    return Math.max(CFG.elementMinCost, el.cost * this.incomePerSec(false));
  }

  elementAvailable(el: ElementDef): boolean {
    return elementUnlocked(this, el);
  }

  canCast(el: ElementDef): boolean {
    return this.state.phase === 'play' && elementUnlocked(this, el) && (this.run.cooldowns[el.id] ?? 0) <= 0 && this.run.energy >= this.elementCost(el);
  }

  cast(id: string, target?: { x: number; v: number; b0?: number; b1?: number }): boolean {
    const el = CFG.elements.find((e) => e.id === id);
    if (!el || !this.canCast(el)) return false;
    if (el.kind === 'section' && !target) return false;
    this.run.energy -= this.elementCost(el);
    this.run.cooldowns[el.id] = el.cooldown;
    castElement(this, el, target);
    this.bus.emit('element', { id, x: target?.x, depth: target?.v });
    // the burial window: a flood or a volcano right after a mass death buries the dead fast and well
    const r = this.run;
    if (r.burialWindow > 0 && (id === 'flood' || id === 'volcano')) {
      const B = CFG.B.burial;
      r.burials.push(r.year - B.before, r.year + B.after, B.fossilMul);
      if (r.burials.length > 30) r.burials.splice(0, 3);
      r.burialWindow = 0;
      this.bus.emit('burial', { id, x: this.lowlandX() });
    }
    return true;
  }

  /** The lowest ground (where the dead wash together): just landward of the water line. */
  lowlandX(): number { return Math.round(Math.max(8, Math.min(W - 8, this.run.waterEnd * (W / 360) - 6))); }

  /** Violent deaths (catastrophes, lost habitat) feed the burial window: >= 20 within 10 game years opens it. */
  noteKills(n: number): void {
    const r = this.run;
    const B = CFG.B.burial;
    r.recentKills.push(r.clock, n);
    while (r.recentKills.length && r.recentKills[0] < r.clock - B.windowYears) r.recentKills.splice(0, 2);
    let sum = 0;
    for (let i = 1; i < r.recentKills.length; i += 2) sum += r.recentKills[i];
    if (sum >= B.killed && r.burialWindow <= 0 && r.burialCooldown <= 0) {
      r.burialWindow = B.seconds;
      r.burialCooldown = B.cooldown;
      r.recentKills.length = 0;
      this.bus.emit('burialWindow', { x: this.lowlandX() });
    }
  }

  /** Collect the rare event on screen. */
  claimRare(): string | null {
    if (!this.rare) return null;
    const ev = this.rare;
    this.rare = null;
    return claimRare(this, ev);
  }

  /** "Buy the best": the species with the most income per Energy, again and again while there is room and money. */
  buyBest(): number {
    let n = 0;
    for (let guard = 0; guard < 500; guard++) {
      let best: SpeciesDef | null = null, score = 0;
      for (const sp of CFG.species) {
        if (!this.speciesUnlocked(sp) || !this.placeFor(sp)) continue;
        const cost = this.speciesCost(sp);
        if (cost > this.run.energy) continue;
        const v = sp.eps / cost;
        if (v > score) { score = v; best = sp; }
      }
      if (!best || !this.buySpecies(best.id)) break;
      n++;
    }
    return n;
  }

  autoElements(dt: number): void {
    const r = this.run;
    const slots = this.stats.autoSlots;
    let used = 0;
    for (const id in r.auto) {
      if (!r.auto[id]) continue;
      if (used >= slots) { r.auto[id] = false; continue; }
      used++;
      const el = CFG.elements.find((e) => e.id === id);
      if (el && el.kind === 'surface' && this.canCast(el)) this.cast(id);
    }
    if (this.mods.hot) {
      r.autoVolcanoTimer += dt;
      if (r.autoVolcanoTimer >= CFG.B.hotWorld.volcanoEvery) {
        r.autoVolcanoTimer = 0;
        const el = CFG.elements.find((e) => e.id === 'volcano')!;
        castElement(this, el);
        this.bus.emit('element', { id: 'volcano' });
      }
    }
  }

  setAuto(id: string, on: boolean): boolean {
    const r = this.run;
    const count = Object.values(r.auto).filter(Boolean).length;
    if (on && count >= this.stats.autoSlots) return false;
    r.auto[id] = on;
    return true;
  }

  // ---------- rocks and the special materials ----------
  /** A rock formed in the strata: it is found (the Book, a note) and counted for the orders — not a currency. */
  formRock(rock: string, amount: number, x = -1): void {
    if (!rock || amount <= 0) return;
    const r = this.run;
    const f = (r.formed ??= {});
    f[rock] = (f[rock] ?? 0) + amount;
    if (this.mods.shards && x >= 0) {
      const b = this.basinMap[x];
      r.basinRocks[b][rock] = (r.basinRocks[b][rock] ?? 0) + amount;
    }
    if (!this.legacy.discovered.includes(rock)) {
      this.legacy.discovered.push(rock);
      this.bus.emit('rockDiscovered', { rock });
    }
  }

  /** A special material got (absorbed by the thing, or a reward): into the hand. */
  addSpecial(id: string, amount: number): void {
    if (!id || amount <= 0) return;
    const r = this.run;
    const v = amount * (this.mods.living ? 1 + 0.25 * (r.rockRanks[id] ?? 0) : 1);
    r.rocks[id] = (r.rocks[id] ?? 0) + v;
    r.rocksEarned[id] = (r.rocksEarned[id] ?? 0) + v;
  }

  /** The known special material with the least in hand (rewards fill the gap), or null if none is known yet. */
  leastSpecial(): string | null {
    let best: string | null = null;
    for (const id of CFG.B.sand.specials.order) if (this.specialKnown(id) && (best === null || (this.run.rocks[id] ?? 0) / this.specialUnit(id) < (this.run.rocks[best] ?? 0) / this.specialUnit(best))) best = id;
    return best;
  }

  /** How much one «unit» of a reward is in a special material (a diamond is worth many coals). */
  specialUnit(id: string): number { return (CFG.B.sand.specials.unit as Record<string, number>)[id] ?? 1; }

  /** A special material is known: got once, or one of its rocks has formed in the strata. */
  specialKnown(id: string): boolean {
    if ((this.run.rocksEarned[id] ?? 0) > 0 || (this.run.rocks[id] ?? 0) > 0) return true;
    const mats = (CFG.B.sand.specials.mats as Record<string, Record<string, number>>)[id] ?? {};
    return Object.keys(mats).some((m) => { const rk = CFG.materials[CFG.matIndex[m]]?.rock; return !!rk && this.legacy.discovered.includes(rk); });
  }

  rankCost(rock: string): number {
    return 25 * 3 ** (this.run.rockRanks[rock] ?? 0);
  }

  rankUp(rock: string): boolean {
    const lvl = this.run.rockRanks[rock] ?? 0;
    if (lvl >= 5) return false;
    const c = this.rankCost(rock);
    if ((this.run.rocks[rock] ?? 0) < c) return false;
    this.run.rocks[rock] -= c;
    this.run.rockRanks[rock] = lvl + 1;
    return true;
  }

  diversityBonus(): number {
    if (!this.mods.shards) return 0;
    const br = this.run.basinRocks;
    let unique = 0;
    const all = new Set<string>();
    br.forEach((b) => Object.keys(b).forEach((k) => all.add(k)));
    for (const k of all) {
      const n = br.filter((b) => (b[k] ?? 0) > 0).length;
      if (n === 1) unique++;
    }
    return unique * CFG.B.shards.diversityBonus;
  }

  // ---------- living world ----------
  offerMutations(): void {
    const r = this.run;
    if (r.mutationEraOffered === r.era) return;
    const cands = CFG.species.filter((s) => s.era <= Math.max(1, r.era) && !r.mutations[s.id]);
    if (!cands.length) return;
    const offer: { species: string; mutation: string }[] = [];
    for (let i = 0; i < 3; i++) {
      const sp = this.rng.pick(cands);
      const mu = this.rng.pick(CFG.story.mutations).id;
      offer.push({ species: sp.id, mutation: mu });
    }
    r.mutationOffer = offer;
    r.mutationEraOffered = r.era;
  }

  chooseMutation(i: number): void {
    const r = this.run;
    if (!r.mutationOffer) return;
    const o = r.mutationOffer[i];
    if (o) r.mutations[o.species] = o.mutation;
    r.mutationOffer = null;
    this.statsDirty = true;
  }

  rerollMutations(): boolean {
    const r = this.run;
    if ((r.rocks.amber ?? 0) < 5 || !r.mutationOffer) return false;
    r.rocks.amber -= 5;
    r.mutationEraOffered = -1;
    this.offerMutations();
    return true;
  }

  // ---------- prestige / temple ----------
  prestigeGain(): number { return prestigeGain(this); }

  prestige(): boolean {
    if (this.prestigeGain() < 1 || this.state.phase !== 'play') return false;
    this.bus.emit('prestigeStart', {});
    doPrestige(this);
    return true;
  }

  chooseRitual(id: string): void {
    if (this.state.phase !== 'finale') return;
    if (this.legacy.rituals.includes(id)) return;
    this.state.ritualChoice = id;
    this.state.phase = 'temple';
    this.state.templeProgress = 0;
  }

  finishTemple(): void {
    const id = this.state.ritualChoice!;
    if (!this.legacy.rituals.includes(id)) this.legacy.rituals.push(id);
    this.state.phase = this.legacy.rituals.length >= CFG.rituals.length ? 'end' : 'newWorld';
    if (this.state.phase === 'end') this.legacy.finished = true;
    this.bus.emit('temple', { ritual: id });
  }

  startNewWorld(): void {
    const s = this.state;
    s.legacy.playthrough++;
    s.meta = newMeta();
    s.run = newRun(0);
    s.phase = 'choose';
    s.legacy.echoSeen = [];
    s.ritualChoice = null;
    s.templeProgress = 0;
    this.refreshMods();
    this.recomputeZones();
    this.resetStrata();
    this.statsDirty = true;
    this.refreshStats();
  }

  // ---------- strata queries ----------
  /** The birth years of the particles at depth `v` (old rows, 2 per particle) ± ry around world column X: the target
   *  zone of an underground element. */
  targetFromSection(X: number, v: number, rx: number, ry: number): TargetZone | null {
    const g = this.grid;
    const cx = Math.max(0, Math.min(GW - 1, Math.floor(X / 2)));
    const yc = g.surf[cx] + Math.round(v / 2), half = Math.max(1, Math.round(ry / 2));
    let b0 = Infinity, b1 = -Infinity;
    for (let y = Math.max(g.surf[cx], yc - half); y <= Math.min(g.sinkRow, yc + half); y++) {
      const m = g.mat[y * GW + cx];
      if (!m) continue;
      const b = g.birth[y * GW + cx];
      if (b < b0) b0 = b;
      if (b > b1) b1 = b;
    }
    if (b0 > b1) { b0 = -1e9; b1 = this.run.year; }
    return { kind: 'water', x0: Math.max(0, X - rx), x1: Math.min(W - 1, X + rx), b0, b1, until: 0, heat: 0 };
  }

  /** Rows above the thing at world column X (old rows: 2 per particle), with the archive and the foundation:
   *  what the tribe has to dig through. */
  artifactDepth(X = W / 2): number {
    const g = this.grid;
    const x = Math.max(0, Math.min(GW - 1, Math.floor(X / 2)));
    let n = 0;
    for (let y = g.surf[x]; y < g.floor; y++) { const m = g.mat[y * GW + x]; if (m && m !== M.artifact) n++; }
    let arc = 0;
    for (const L of this.archive.layers) arc += this.archive.meanRows(L) / Math.max(1, L.k);
    return n * 2 + arc * SAND.archiveDigShare + this.meta.foundation;
  }

  shardXs(): number[] {
    return CFG.B.shards.x640.map((v) => Math.round(v * CFG.B.world.ref640));
  }


  // re-exported helpers for other modules
  kill = (shares: number[], cause: string) => killShare(this, shares, cause);
}

export { M, W };
