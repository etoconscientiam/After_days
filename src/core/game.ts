// The Game: owns state + world, advances time, exposes player actions. No DOM access (runs in Node for the sim).
import { CFG, M, ZONES, ZoneId, SpeciesDef, ElementDef, SX } from '../config';
import { World, W, CAP, F_ROLLED } from '../world/World';
import { EventBus } from './events';
import { RNG, hash2 } from './rng';
import { GameState, newGameState, newRun, newMeta, TargetZone } from './state';
import { computeStats, Stats, upgradePrice, densityPrice } from './stats';
import { lifeStep, killShare, addCarcass, totalPop, speciesAlive } from './life';
import { depositionStep, depositCell } from './deposition';
import { geoTick, rollFossil } from './geology';
import { castElement, elementUnlocked } from './elements';
import { prestigeGain, doPrestige } from './prestige';
import { nextRareIn, spawnRare, claimRare, RareEvent } from './rare';
import { drawOrders, checkOrders } from './orders';
import { triggerEcho, randomEcho, echoInterval, currentItem } from './echoes';

export interface WorldMods {
  hot: boolean; living: boolean; shards: boolean;
  geoGradientMul: number;
}

export interface Glint { x: number; depth: number; t: number; color: string; birth?: number }

export class Game {
  state: GameState;
  world: World;
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
  /** pixels that turned into rock under a press or a glowing-layer event: they flash */
  pressFlashes: { x: number; birth: number; t: number; color: string }[] = [];
  /** transformations under heat or deep pressure running now, per column: strength 0..1 and the birth year of the hottest cell */
  hotNow = new Float32Array(W);
  hotB = new Float64Array(W);
  /** the same for deep packs: birth range, strength, column range */
  hotPacks: { b0: number; b1: number; v: number; x0: number; x1: number }[] = [];
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

  constructor(state?: GameState, world?: World) {
    this.state = state ?? newGameState();
    this.world = world ?? new World();
    if (!world) this.world.reset();
    this.rng = new RNG(this.state.seed);
    for (let x = 0; x < W; x++) this.colNoise[x] = 0.85 + 0.3 * (0.5 + 0.5 * Math.sin((x / SX) * 0.071) * Math.cos((x / SX) * 0.023 + 1.3));
    this.refreshMods();
    this.recomputeZones();
    this.refreshStats();
    // bones folded into deep packs before they were rolled get their one fossil roll now
    this.world.foldHook = (x, j) => {
      const w = this.world;
      if (w.mat[j] === M.bone && !(w.flags[j] & F_ROLLED)) rollFossil(this, x, j, 1, 1 + this.stats.fossilChance, w.len[x]);
    };
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
  }

  zoneIndex(z: ZoneId): number { return ZONES.indexOf(z); }

  /** Capacity of a zone in population units. */
  capacity(zi: number): number {
    const st = this.stats;
    let c = (this.zoneWidth[zi] / CFG.B.world.ref640) * CFG.B.zones.capacityPerPx640;
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
    return v;
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
    // clicks scale gently with passive income so they never become worthless
    e += this.incomePerSec(false) * 0.05;
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
        if (sp && this.speciesUnlocked(sp) && r.energy >= this.speciesCost(sp) && this.freeZoneFor(sp) >= 0) this.buySpecies(id);
      }
    }
    drawOrders(this);
    checkOrders(this);

    const inc = this.incomePerSec() * dt;
    r.energy += inc;
    r.energyEarned += inc;

    const dy = this.advanceYears(this.yps() * dt);
    this.simulate(dy);

    this.geoAcc += dt;
    this.geoYears += dy;
    if (this.geoAcc >= CFG.B.time.geoTick) {
      geoTick(this, this.geoYears);
      this.geoAcc = 0;
      this.geoYears = 0;
    }
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

  /** Life, deposition, effect expiry and excavation for dy game years. */
  simulate(dy: number): void {
    if (dy <= 0) return;
    const r = this.run;
    lifeStep(this, dy);
    depositionStep(this, dy);
    // expire effects
    for (let i = r.active.length - 1; i >= 0; i--) {
      const a = r.active[i];
      if (a.id === 'glacier') r.glacierLoad = CFG.elements.find((e) => e.id === 'glacier')!.params.load;
      if (r.year >= a.until) {
        if (a.id === 'glacier') r.glacierLoad = 0;
        r.active.splice(i, 1);
      }
    }
    for (let i = r.targets.length - 1; i >= 0; i--) if (r.year >= r.targets[i].until) { r.targets.splice(i, 1); this.world.version++; }
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

  speciesUnlocked(sp: SpeciesDef): boolean {
    const r = this.run;
    if (r.era < sp.era) return false;
    if (sp.needsOxygen && r.oxygen < sp.needsOxygen) return false;
    if (sp.unlockAfter) {
      const prev = this.run.peak[sp.unlockAfter] ?? 0;
      if (prev < CFG.unlockAfterPop) return false;
    }
    return true;
  }

  speciesCost(sp: SpeciesDef): number {
    return sp.cost * CFG.costGrowth ** totalPop(this, sp.id);
  }

  buySpecies(id: string): boolean {
    const sp = CFG.speciesById[id];
    if (!sp || !this.speciesUnlocked(sp)) return false;
    const cost = this.speciesCost(sp);
    if (this.run.energy < cost) return false;
    const zi = this.freeZoneFor(sp);
    if (zi < 0) return false;
    this.run.energy -= cost;
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
    r.recentKills.push(r.year, n);
    while (r.recentKills.length && r.recentKills[0] < r.year - B.windowYears) r.recentKills.splice(0, 2);
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
        if (!this.speciesUnlocked(sp) || this.freeZoneFor(sp) < 0) continue;
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

  // ---------- rocks ----------
  addRock(rock: string, amount: number, x = -1): void {
    if (!rock || amount <= 0) return;
    const r = this.run;
    let mul = 1;
    if (this.mods.living) mul *= 1 + 0.25 * (r.rockRanks[rock] ?? 0);
    const v = amount * mul;
    r.rocks[rock] = (r.rocks[rock] ?? 0) + v;
    r.rocksEarned[rock] = (r.rocksEarned[rock] ?? 0) + v;
    if (this.mods.shards && x >= 0) {
      const b = this.basinMap[x];
      r.basinRocks[b][rock] = (r.basinRocks[b][rock] ?? 0) + v;
    }
    if (!this.legacy.discovered.includes(rock)) {
      this.legacy.discovered.push(rock);
      this.bus.emit('rockDiscovered', { rock });

    }
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
    if ((r.rocks.glowstone ?? 0) < 5 || !r.mutationOffer) return false;
    r.rocks.glowstone -= 5;
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
    this.world.reset();
    this.refreshMods();
    this.recomputeZones();
    this.statsDirty = true;
    this.refreshStats();
  }

  // ---------- section queries ----------
  /** Which world-space target zone matches a click at (x, visual depth v). */
  targetFromSection(x: number, v: number, rx: number, ry: number): TargetZone | null {
    const w = this.world;
    const a = w.locate(x, Math.max(0, v - ry));
    const b = w.locate(x, v + ry);
    const birthOf = (l: ReturnType<World['locate']>, fallback: number) => {
      if (!l) return fallback;
      if (l.kind === 'cell') return w.birth[x * CAP + l.i];
      const p = w.packs[l.p];
      return p.ageMax - (p.ageMax - p.ageMin) * l.frac;
    };
    const top = birthOf(a, this.run.year);
    const bottom = birthOf(b, -1e9);
    return { kind: 'water', x0: Math.max(0, x - rx), x1: Math.min(W - 1, x + rx), b0: Math.min(top, bottom), b1: Math.max(top, bottom), until: 0, heat: 0 };
  }

  /** Visual rows above the artifact(s) (excavation depth). */
  artifactDepth(x = W / 2): number {
    return this.world.visualDepth(x) + this.meta.foundation;
  }

  shardXs(): number[] {
    return CFG.B.shards.x640.map((v) => Math.round(v * CFG.B.world.ref640));
  }


  // re-exported helpers for other modules
  depositCell = (x: number, m: number, zi: number, burialMul = 1) => depositCell(this, x, m, zi, burialMul);
  kill = (shares: number[], cause: string) => killShare(this, shares, cause);
}

export { M, W, CAP };
