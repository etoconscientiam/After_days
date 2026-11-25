import * as THREE from 'three';
import type { Game } from '../sim/game';
import type { TorchIn } from '../sim/weld';
import { emptyTorch } from '../sim/weld';
import { BALANCE } from '../data/balance';
import { SKIN } from '../skin/default';
import { LowRes } from './renderer';
import { makeTextures, Textures } from './textures';
import { buildWorkshop, Workshop, BENCH, TABLE, figure } from './workshop';
import { buildPart, PartMesh } from './partMesh';
import { BeadView, BeadSource } from './bead';
import { Effects } from './particles';
import { Tools } from './tools';
import { CameraRig } from './camera';
import { UI } from './ui';
import { Rng } from '../core/rng';
import { t } from '../i18n';
import type { SeamPoint } from '../sim/seam';

const MM = 0.001;

/** Everything the player sees. Reads sim state each frame, reacts to sim events, never writes sim state. */
export class View {
  readonly lr: LowRes;
  readonly tx: Textures;
  readonly ws: Workshop;
  readonly rig: CameraRig;
  readonly bead = new BeadView();
  readonly fx = new Effects();
  readonly tools: Tools;
  readonly ui: UI;
  private part: PartMesh | null = null;
  private pileMesh: THREE.Group | null = null;
  private partRoot = new THREE.Group();
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private mouse = { x: 0, y: 0, in: false };
  private lmb = false;
  /** A click shorter than a frame still reaches the sim once. */
  private latch = false;
  private suppress = false;
  private wheelAcc = 0;
  private dL = 0;
  private keys = { up: false, down: false };
  private hover = '';
  private torch: TorchIn = emptyTorch();
  private rng = new Rng(77);
  private shakeT = 0;
  private sparkAcc = 0;
  private appSparkAcc = 0;
  private inspectT = 0;
  private cssW = 1;
  private cssH = 1;
  private scale = 1;
  private lastPartTip = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private v3b = new THREE.Vector3();
  private v3c = new THREE.Vector3();
  private pt: SeamPoint = { x: 0, z: 0, tx: 1, tz: 0 };
  private endSrc: BeadSource | null = null;
  private time = 0;
  private lastMode = '';
  private lastMask = false;
  private pickList: THREE.Object3D[] = [];
  private hits: THREE.Intersection[] = [];
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private mouseMoved = true;
  /** Where particles land: the part, the bench top, or the floor. */
  private floorAt = (x: number, z: number): number => {
    const part = this.part;
    const lx = (x - BENCH.x) / MM, lz = (z - BENCH.z) / MM;
    if (part && Math.abs(lx) < part.half[0] && Math.abs(lz) < part.half[1]) return TABLE + part.heightAt(lx, lz) * MM;
    if (Math.abs(x) < 0.7 && Math.abs(z - BENCH.z) < 0.35) return TABLE;
    return 0;
  };
  started = false;

  constructor(private game: Game, private canvas: HTMLCanvasElement, uiRoot: HTMLElement, private stage: HTMLElement) {
    this.lr = new LowRes(canvas);
    this.tx = makeTextures();
    this.ws = buildWorkshop(this.tx, game.data, t('sign.shelf'));
    this.tools = new Tools(this.tx);
    this.rig = new CameraRig(this.lr.w / this.lr.h);
    this.partRoot.position.copy(BENCH);
    this.partRoot.add(this.bead.group);
    this.ws.scene.add(this.partRoot, this.fx.group, this.tools.group, this.rig.cam);
    this.tools.attach(this.rig.cam);
    this.lastPartTip.copy(BENCH);
    this.ui = new UI(uiRoot, game);
    this.ui.onTake = (uid) => game.queue({ type: 'takeOrder', uid });
    this.ui.onBoardClose = () => (this.suppress = true);
    this.bindInput();
    this.bindEvents();
    this.resize();
    addEventListener('resize', () => this.resize());
    this.syncWorld();
  }

  // ------------------------------------------------------------------ layout

  resize(): void {
    const W = innerWidth, H = innerHeight;
    let s = Math.min(W / this.lr.w, H / this.lr.h);
    if (s >= 2) s = Math.floor(s);
    this.scale = s;
    this.cssW = Math.round(this.lr.w * s);
    this.cssH = Math.round(this.lr.h * s);
    this.stage.style.width = this.cssW + 'px';
    this.stage.style.height = this.cssH + 'px';
    this.ui.setScale(Math.max(1, s * 0.62));
  }

  // ------------------------------------------------------------------ input

  private bindInput(): void {
    const c = this.canvas;
    const pos = (e: PointerEvent | MouseEvent) => {
      const r = c.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
      this.mouse.in = this.mouse.x >= 0 && this.mouse.y >= 0 && this.mouse.x <= r.width && this.mouse.y <= r.height;
      this.mouseMoved = true;
    };
    c.addEventListener('pointermove', pos);
    c.addEventListener('pointerleave', () => (this.mouse.in = false));
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      pos(e);
      if (!this.started) return;
      c.setPointerCapture(e.pointerId);
      if (e.button === 2) return this.toggleLook();
      if (e.button !== 0) return;
      this.lmb = true;
      this.latch = true;
      this.onClick();
    });
    addEventListener('pointerup', (e) => {
      if (e.button === 0) {
        this.lmb = false;
        this.suppress = false;
      }
    });
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const step = BALANCE.arc.wheelStep;
        if (e.deltaMode === 1 || Math.abs(e.deltaY) >= 50) this.dL += -Math.sign(e.deltaY) * step;
        else {
          this.wheelAcc += e.deltaY;
          while (Math.abs(this.wheelAcc) >= 40) {
            this.dL += -Math.sign(this.wheelAcc) * step;
            this.wheelAcc -= Math.sign(this.wheelAcc) * 40;
          }
        }
      },
      { passive: false },
    );
    addEventListener('keydown', (e) => {
      if (!this.started) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) this.game.queue({ type: 'mask' });
      } else if (e.code === 'KeyW' || e.code === 'ArrowUp') this.keys.up = true;
      else if (e.code === 'KeyS' || e.code === 'ArrowDown') this.keys.down = true;
      else if (e.code === 'KeyE' || e.code === 'KeyR') this.game.queue({ type: 'newElectrode' });
      else if (e.code === 'Escape') {
        if (this.ui.boardOpen) this.ui.closeBoard();
        else if (this.rig.mode === 'work') this.rig.room();
      }
    });
    addEventListener('keyup', (e) => {
      if (e.code === 'KeyW' || e.code === 'ArrowUp') this.keys.up = false;
      if (e.code === 'KeyS' || e.code === 'ArrowDown') this.keys.down = false;
    });
  }

  private toggleLook(): void {
    if (this.rig.mode === 'room') {
      if (this.part && this.game.player.stage !== 'empty') this.toWork();
    } else if (this.rig.mode === 'work') this.rig.room();
  }

  private toWork(): void {
    const p = this.game.player.part;
    if (!p) return;
    this.rig.work(BENCH, p.frame);
  }

  private onClick(): void {
    const g = this.game;
    if (this.ui.boardOpen || this.ui.endOpen) return;
    if (this.rig.mode === 'room') {
      this.suppress = true;
      const id = this.pick();
      if (!id) return;
      if (id === 'pile') g.queue({ type: 'takePile' });
      else if (id === 'board' && g.flags.board) {
        this.ui.openBoard();
        this.ui.hideTip();
      } else if (id.startsWith('shelf:')) g.queue({ type: 'buy', id: id.slice(6) });
      else if (id === 'electrodes') g.queue({ type: 'newElectrode' });
      else if (id === 'door') g.queue({ type: 'handOver' });
      else if ((id === 'part' || id === 'bench') && g.player.stage !== 'empty') {
        if (g.player.stage === 'ready') g.queue({ type: 'handOver' });
        else this.toWork();
      }
      return;
    }
    if (this.rig.mode === 'work') {
      const b = g.player;
      if (b.stage === 'weld' && b.electrode <= 0 && !b.arc.lit && b.swap <= 0) {
        g.queue({ type: 'newElectrode' });
        this.suppress = true;
      } else if (b.stage === 'ready') {
        g.queue({ type: 'handOver' });
        this.suppress = true;
      }
    }
  }

  private setRay(): void {
    this.ndc.set((this.mouse.x / this.cssW) * 2 - 1, -(this.mouse.y / this.cssH) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.rig.cam);
  }

  /** What the mouse points at in the room. */
  private pick(): string {
    if (!this.mouse.in) return '';
    this.setRay();
    const objs = this.pickList;
    objs.length = 0;
    for (const o of this.ws.pickables) if (o.visible) objs.push(o);
    if (this.part) objs.push(this.partRoot);
    if (this.pileMesh) objs.push(this.pileMesh);
    this.hits.length = 0;
    const hits = this.ray.intersectObjects(objs, true, this.hits);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.pick) o = o.parent;
      if (o?.userData.pick && o.visible !== false) return o.userData.pick as string;
    }
    return '';
  }

  /** Mouse → part-local millimetres on the part's surface. */
  private aimOnPart(out: TorchIn): void {
    out.has = false;
    if (!this.part || !this.mouse.in) return;
    this.setRay();
    this.hits.length = 0;
    const hits = this.ray.intersectObject(this.part.group, true, this.hits);
    let p: THREE.Vector3 | null = hits.length ? hits[0].point : null;
    if (!p) {
      this.plane.constant = -(TABLE + this.part.top * 0.6 * MM);
      p = this.ray.ray.intersectPlane(this.plane, this.v3) ?? null;
    }
    if (!p) return;
    out.has = true;
    out.x = (p.x - BENCH.x) / MM;
    out.z = (p.z - BENCH.z) / MM;
  }

  /** Input for one frame; the arc-length request is handed to the first sim step only. */
  frameInput(dt: number): TorchIn {
    const tr = this.torch;
    const working = this.rig.mode === 'work' && !this.ui.boardOpen;
    if (working) this.aimOnPart(tr);
    else tr.has = false;
    tr.press = working && (this.lmb || this.latch) && !this.suppress && this.mouse.in;
    const kr = BALANCE.arc.keyRate * dt;
    tr.dL = this.dL + (this.keys.up ? kr : 0) - (this.keys.down ? kr : 0);
    this.dL = 0;
    tr.forceL = NaN;
    return tr;
  }

  /** After the first sim step of a frame the one-shot part of the input is spent. */
  consumeOneShot(): void {
    this.torch.dL = 0;
    if (this.latch) {
      this.latch = false;
      this.torch.press = this.lmb && !this.suppress && this.torch.press;
    }
  }

  // ------------------------------------------------------------------ events

  private bindEvents(): void {
    const g = this.game;
    const b = g.bus;
    b.on('money', (e) => this.ui.showMoney(e.money, e.delta > 0));
    b.on('shopChanged', () => {
      this.syncWorld();
      this.ui.refreshTip();
      this.ui.renderBoard();
    });
    b.on('boardChanged', () => {
      this.syncWorld();
      this.ui.renderBoard();
    });
    b.on('pileChanged', () => this.syncPile());
    b.on('bought', () => this.syncWorld());
    b.on('beat', (e) => {
      this.syncWorld();
      this.ui.beat(t('beat.' + e.id));
    });
    b.on('orderTaken', (e) => {
      if (e.bench !== 'player') return;
      this.setPart(e.part);
      this.bead.attach(g.player, this.part!.heightAt);
      this.setCustomer(g.player.order?.customer ?? 'neighbour');
      this.ui.closeBoard();
      this.toWork();
    });
    b.on('handedOver', (e) => {
      if (e.bench === 'player') {
        this.ui.toast(`+${e.pay} ◆  ${t('part.' + e.part)}` + (e.reqMet ? '' : ' · ' + t('pay.reqFail')));
        this.ws.customer.visible = false;
        if (!g.showEnd) {
          this.clearPart();
          this.rig.room();
        }
      } else this.ui.toast(`+${e.pay} ◆  ${t('app.done', { grade: t('grade.' + e.grade) })}`);
    });
    b.on('revealed', (e) => {
      if (e.bench !== 'player') return;
      const line = [e.holes ? `${t('end.holes')}: ${e.holes}` : '', e.pores ? t('stamp.pores', { n: e.pores }) : ''].filter(Boolean).join(' · ');
      this.ui.stamp(e.grade, line);
      this.inspect();
    });
    b.on('slagChip', (e) => {
      if (e.bench !== 'player') return;
      this.tools.strike();
      this.shakeT = 0.09;
      const y = TABLE + ((this.part?.heightAt(e.x, e.z) ?? 0) + 2) * MM;
      this.fx.slag(BENCH.x + e.x * MM, y, BENCH.z + e.z * MM, e.amount);
    });
    b.on('hammerMiss', (e) => {
      if (e.bench === 'player') {
        this.tools.strike();
        this.shakeT = 0.05;
      }
    });
    b.on('burnThrough', (e) => {
      if (e.bench !== 'player') return;
      this.shakeT = 0.12;
      const y = TABLE + ((this.part?.heightAt(e.x, e.z) ?? 0) + 1) * MM;
      this.fx.burst(BENCH.x + e.x * MM, y, BENCH.z + e.z * MM);
    });
    b.on('arcStrike', (e) => {
      if (e.bench !== 'player') return;
      const y = TABLE + ((this.part?.heightAt(e.x, e.z) ?? 0) + 1) * MM;
      this.fx.spatter(BENCH.x + e.x * MM, y, BENCH.z + e.z * MM, 14, 0.4);
    });
    b.on('apprentice', (e) => {
      this.syncWorld();
      this.ui.setApprentice(g.owned.apprentice ? t('app.' + e.state) : '');
    });
    b.on('habitRecorded', () => {
      if (g.owned.apprentice) this.ui.toast(t('app.learned'));
    });
    b.on('focus', () => this.applyFocus());
    b.on('finaleStart', () => this.syncWorld());
    b.on('finaleEnd', () => {
      // Keep the gate on the bench and show it with the player's seams.
      this.endSrc = { seams: g.finaleSeams ?? [], rev: 1, stage: 'ready' };
      this.bead.attach(this.endSrc, this.part?.heightAt ?? (() => 0));
      this.rig.end(this.v3.copy(BENCH).add(this.v3b.set(0.09, 0, 0.0)), (g.data.parts[g.finalePart]?.frame ?? 430) * 1.15);
      const L = g.log;
      const avg = L.qualities.length ? L.qualities.reduce((a, q) => a + q, 0) / L.qualities.length : 0;
      const pct = (q: number) => Math.round(q * 100) + '%';
      const mm = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
      this.ui.showEnd(
        [
          [t('end.gate'), `${t('grade.' + g.finaleGrade)} · ${pct(g.finaleQuality)}`],
          [t('end.jobs'), String(g.ordersDone)],
          [t('end.earned'), '◆ ' + L.earned],
          [t('end.avg'), pct(avg)],
          [t('end.best'), pct(L.best)],
          [t('end.holes'), String(L.holes)],
          [t('end.blind'), String(Math.round(L.blinded))],
          [t('end.app'), String(L.apprenticeJobs)],
          [t('end.time'), mm(g.t)],
        ],
        () => {
          g.queue({ type: 'dismissEnd' });
          this.endSrc = null;
          this.clearPart();
          this.rig.room();
        },
      );
    });
  }

  private inspect(): void {
    const b = this.game.player;
    let best = b.seams[0];
    for (const s of b.seams) if (s.len > best.len) best = s;
    if (!best || !this.part) return;
    best.pointAt(best.len * 0.5, this.pt);
    this.v3.set(BENCH.x + this.pt.x * MM, TABLE + this.part.heightAt(this.pt.x, this.pt.z) * MM, BENCH.z + this.pt.z * MM);
    this.rig.inspect(this.v3, Math.min(90, b.part!.frame * 0.45));
    this.inspectT = BALANCE.chip.inspectTime;
  }

  private setPart(id: string): void {
    this.clearPart();
    this.part = buildPart(this.game.data.parts[id], this.tx);
    this.partRoot.add(this.part.group);
  }

  private clearPart(): void {
    if (this.part) this.partRoot.remove(this.part.group);
    this.part = null;
    this.bead.attach(null, () => 0);
  }

  private setCustomer(id: string): void {
    const look = this.game.data.customers[id]?.look;
    if (!look) return;
    const old = this.ws.customer;
    const f = figure(look, { skin: (old.children[1] as THREE.Mesh).material as THREE.Material });
    f.position.copy(old.position);
    f.rotation.copy(old.rotation);
    f.traverse((o) => (o.userData.pick = 'door'));
    this.ws.scene.remove(old);
    this.ws.scene.add(f);
    const i = this.ws.pickables.indexOf(old);
    if (i >= 0) this.ws.pickables[i] = f;
    this.ws.customer = f;
  }

  private syncPile(): void {
    if (this.pileMesh) this.ws.pileSlot.remove(this.pileMesh);
    this.pileMesh = null;
    const o = this.game.pile;
    if (!o) return;
    const pm = buildPart(this.game.data.parts[o.part], this.tx);
    pm.group.traverse((c) => (c.userData.pick = 'pile'));
    const s = Math.min(1, 0.32 / (pm.half[0] * 2 * MM));
    pm.group.scale.setScalar(s);
    this.pileMesh = pm.group;
    this.ws.pileSlot.add(pm.group);
  }

  /** World objects that mirror sim state: shelf, owned things, board tags, apprentice, second wheel. */
  syncWorld(): void {
    const g = this.game;
    for (const u of g.data.upgrades) {
      const owned = !!g.owned[u.id];
      this.ws.shelfItems[u.id].visible = !!g.flags.shelf && !owned;
      const o = this.ws.ownedItems[u.id];
      if (o) o.visible = owned;
    }
    this.ws.wheel2.visible = !!g.owned.wheel2;
    this.ws.apprentice.visible = !!g.owned.apprentice;
    const board = this.ws.boardTags[0].parent!;
    board.visible = !!g.flags.board;
    this.ws.boardTags.forEach((tg, i) => (tg.visible = i < g.board.length));
    this.applyFocus();
  }

  private applyFocus(): void {
    const f = this.game.guide;
    const key = f.target === 'shelf' ? 'shelf:coated' : f.target;
    for (const k in this.ws.hiMats) {
      const on = (k === key || k === this.hover) && this.rig.mode === 'room';
      for (const m of this.ws.hiMats[k]) m.emissive.set(on ? '#3a2a1a' : '#000000');
    }
    this.bead.highlight(f.target === 'seam' ? f.seam : -1, 1);
    const hint = f.hint ? t('hint.' + f.hint) : '';
    this.ui.setHint(hint, f.target === 'mask');
  }

  // ------------------------------------------------------------------ frame

  render(dt: number): void {
    this.time += dt;
    const g = this.game;
    const b = g.player;
    const a = b.arc;
    const L = SKIN.light;
    const r = this.rng;

    // Camera: inspection glide back to work once the bead has been looked at.
    if (this.inspectT > 0) {
      this.inspectT -= dt;
      if (this.inspectT <= 0 && this.rig.mode === 'inspect' && b.stage !== 'empty') this.toWork();
    }
    if (this.rig.mode === 'room' && this.mouse.in) this.rig.setNudge((this.mouse.x / this.cssW) * 2 - 1, -((this.mouse.y / this.cssH) * 2 - 1));
    this.rig.update(dt);
    if (this.rig.mode !== this.lastMode || this.lastMask !== this.game.mask.down) {
      this.lastMode = this.rig.mode;
      this.lastMask = this.game.mask.down;
      this.applyFocus();
      this.ui.setCtrl(this.started && this.rig.mode === 'work', this.game.mask.down);
    }

    // Hover in the room: highlight + shelf tooltip.
    const canHover = this.started && this.rig.mode === 'room' && !this.ui.boardOpen;
    if (canHover && !this.mouseMoved && this.rig.settled()) {
      // Nothing moved: keep whatever is hovered.
    } else if (canHover) {
      this.mouseMoved = false;
      const id = this.pick();
      if (id !== this.hover) {
        this.hover = id;
        this.applyFocus();
        if (id.startsWith('shelf:')) this.ui.showTip(id.slice(6), this.mouse.x, this.mouse.y + 10 * this.scale);
        else this.ui.hideTip();
      }
    } else if (this.hover) {
      this.hover = '';
      this.ui.hideTip();
    }

    // Lights that follow the river and the time of day.
    const I = g.power.I;
    const dark = g.clock.dark;
    this.ws.lights.lamp.intensity = L.lamp.intensity * Math.min(1.6, I * I);
    this.ws.lights.lampBulb.color.setRGB(1, 0.62, 0.35).multiplyScalar(0.4 + 1.4 * Math.min(1.5, I * I));
    const wi = L.window.intensity * (1 - dark) + L.window.night * dark;
    this.ws.lights.window.intensity = wi;
    this.ws.lights.door.intensity = wi * 0.8;
    const skyK = 1 - 0.78 * dark;
    this.ws.sky.color.setScalar(skyK);
    for (const m of this.ws.far) m.color.copy(m.userData.base as THREE.Color).multiplyScalar(0.4 + 0.6 * skyK);
    this.ws.wheels[0].userData.rot.rotation.z = -g.power.angle;
    this.ws.wheels[1].userData.rot.rotation.z = -g.power.angle * 1.15 + 0.5;
    this.updateSnow(dt, g.clock.snow);
    const qn = Math.min(7, Math.round(1 + g.t / 55 + g.board.length * 0.5 + (g.flags.finale ? 2 : 0)));
    for (let i = 0; i < this.ws.queue.length; i++) this.ws.queue[i].visible = g.started && i < qn;
    this.ws.customer.visible = b.stage !== 'empty' && !b.order?.urgent;

    // Bench, tools and the arc.
    this.bead.update();
    const working = this.rig.mode !== 'room' && !!this.part;
    const tip = this.v3c;
    let arcOn = 0;
    if (working && this.torch.has && this.part) {
      const sx = a.lit || b.stage !== 'weld' ? this.torch.x : this.torch.x;
      const sz = this.torch.z;
      const surf = this.part.heightAt(sx, sz);
      const hover = b.stage === 'weld' ? (a.lit ? a.L * 1.4 : this.lmb ? 0.4 : 7) : 0;
      tip.set(BENCH.x + sx * MM, TABLE + (surf + hover) * MM, BENCH.z + sz * MM);
      this.lastPartTip.copy(tip);
    } else tip.copy(this.lastPartTip);

    const stage = b.stage;
    const holding = working && stage === 'weld';
    this.tools.hammer.visible = working && stage === 'chip';
    this.tools.holder.visible = !this.tools.hammer.visible;
    if (holding) this.tools.placeHolder(tip, this.rig.cam, b.swap > 0 ? 0 : b.electrode);
    else this.tools.rest(this.rig.cam);
    if (this.tools.hammer.visible) this.tools.placeHammer(tip, this.rig.cam, dt);
    this.tools.placeHud(this.rig.cam, I, this.started && !g.showEnd);

    const lit = a.lit && holding;
    this.tools.arcGlow.visible = lit;
    this.tools.arcStar.visible = lit;
    this.tools.bolt.visible = lit;
    this.tools.pool.visible = lit && a.onSeam && a.pool > 0.8;
    const arcLight = this.ws.lights.arc;
    if (lit) {
      const surfY = TABLE + (this.part!.heightAt(this.torch.x, this.torch.z) + 0.3) * MM;
      const flick = 0.75 + 0.5 * r.next();
      const longK = Math.max(0, a.L - 3.4);
      let k = flick * Math.pow(Math.min(1.5, I), 1.5) * (1 + longK * 0.4 * (r.next() - 0.3));
      if (a.unstable > 0 && r.chance(a.unstable * 0.5)) k *= 0.2;
      const jit = SKIN.light.arc.jitterMM * MM;
      arcLight.position.set(tip.x + r.signed() * jit, (tip.y + surfY) / 2 + 0.004, tip.z + r.signed() * jit);
      arcLight.intensity = L.arc.intensity * k;
      arcOn = k;
      this.tools.arcGlow.position.set(tip.x, (tip.y + surfY) / 2, tip.z);
      this.tools.arcGlow.quaternion.copy(this.rig.cam.quaternion);
      const sz = (3 + a.L * 1.2) * MM * (0.8 + 0.4 * r.next());
      this.tools.arcGlow.scale.set(sz, sz, sz);
      this.tools.arcStar.position.copy(this.tools.arcGlow.position);
      this.tools.arcStar.quaternion.copy(this.rig.cam.quaternion);
      const ss = (0.035 + 0.02 * r.next()) * k;
      this.tools.arcStar.scale.set(ss, ss, ss);
      this.tools.arcStar.rotation.z = 0;
      if (a.onSeam) this.fx.fumes(tip.x, surfY, tip.z, dt, 10);
      this.v3b.set(tip.x, surfY, tip.z);
      this.tools.setBolt(tip, this.v3b, (0.4 + a.L * 0.35) * MM, r);
      if (this.tools.pool.visible) {
        const ps = (2 + Math.min(4, a.pool * 2)) * MM;
        this.tools.pool.position.set(tip.x, surfY + 0.0002, tip.z);
        this.tools.pool.scale.set(ps, 1, ps * 0.8);
      }
      // Spatter and sparks from the sim's rate.
      this.sparkAcc += a.spatterRate * dt * 1.6;
      const n = Math.min(12, Math.floor(this.sparkAcc));
      this.sparkAcc -= n;
      if (n > 0) this.fx.spatter(tip.x, surfY + 0.002, tip.z, n, longK * 0.5 + a.unstable);
    } else {
      arcLight.intensity = 0;
      this.sparkAcc = 0;
    }
    arcLight.castShadow = lit;

    // Glow of the hot bead lights the bench a little after the arc goes out.
    const hot = b.hot();
    if (!lit && hot > 0.5 && this.part) {
      arcLight.intensity = Math.min(0.06, (hot - 0.5) * 0.04);
      arcLight.color.setRGB(1, 0.45, 0.15);
    } else arcLight.color.set(L.arc.color);

    // Apprentice corner.
    const ap = this.ws.lights.appArc;
    if (g.app.arc.lit) {
      ap.intensity = L.appArc.intensity * (0.5 + r.next());
      this.appSparkAcc += dt * 18;
      const n = Math.floor(this.appSparkAcc);
      this.appSparkAcc -= n;
      if (n) this.fx.spatter(ap.position.x + r.signed() * 0.02, 0.83, ap.position.z, n, 0.2);
    } else ap.intensity = 0;

    // Particles: land on the part, the bench or the floor.
    this.fx.update(dt, this.floorAt, arcOn);

    // Post: mask, glare, afterimage, shake.
    const u = this.lr.u;
    u.uMaskPos.value = g.mask.pos;
    u.uMaskT.value = g.stats.maskTransmission;
    u.uMaskWindow.value = g.stats.maskWindow;
    u.uGlare.value = g.glare;
    u.uAfter.value = g.after;
    u.uArcOn.value = arcOn;
    if (lit) {
      this.v3.copy(this.tools.arcGlow.position).project(this.rig.cam);
      u.uArcUv.value.set(this.v3.x * 0.5 + 0.5, this.v3.y * 0.5 + 0.5);
      if (g.mask.pos < 0.5) u.uAfterUv.value.copy(u.uArcUv.value);
    }
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      u.uShake.value.set(r.int(-1, 1), r.int(-1, 1));
    } else u.uShake.value.set(0, 0);
    u.uFade.value = this.started ? Math.max(0, u.uFade.value - dt * 1.5) : 0.35;

    this.lr.render(this.ws.scene, this.rig.cam);
    this.placeOverlay();
    this.ui.update(dt);
  }

  private updateSnow(dt: number, density: number): void {
    const p = this.ws.snow.geometry.attributes.position as THREE.BufferAttribute;
    const a = p.array as Float32Array;
    const n = Math.floor((a.length / 3) * Math.min(1, density));
    const wind = 0.15 + density * 0.5;
    for (let i = 0; i < n; i++) {
      a[i * 3 + 1] -= this.ws.snowVel[i] * dt;
      a[i * 3] += wind * dt * (0.6 + this.ws.snowVel[i]);
      if (a[i * 3 + 1] < 0) a[i * 3 + 1] += 3.6;
      if (a[i * 3] > 5) a[i * 3] -= 8;
    }
    this.ws.snow.geometry.setDrawRange(0, n);
    p.needsUpdate = true;
  }

  /** Move the hint label to its anchor and draw the cursor. */
  private placeOverlay(): void {
    const g = this.game;
    const f = g.guide;
    const room = this.rig.mode === 'room';
    const showCursor = this.started && this.mouse.in && !this.ui.boardOpen && (room || g.player.stage === 'chip' || g.player.stage === 'ready' || g.player.stage === 'inspect');
    this.ui.placeCursor(this.mouse.x, this.mouse.y, showCursor);
    if (!this.ui.hintVisible) return;
    let w: THREE.Vector3 | null = null;
    if (f.target === 'mask') {
      this.ui.placeHint(this.cssW / 2, this.cssH * 0.14);
      return;
    }
    if ((f.target === 'seam' || f.target === 'bead') && this.part && !room) {
      w = this.v3.set(BENCH.x + f.x * MM, TABLE + (this.part.heightAt(f.x, f.z) + 3) * MM, BENCH.z + f.z * MM);
    } else if (f.target === 'arc' || (f.target === 'electrodes' && !room) || (f.target === 'door' && !room)) {
      w = this.v3.copy(this.lastPartTip).add(this.v3b.set(0, 0.012, 0));
    } else if (room && this.ws.anchors[f.target]) w = this.v3.copy(this.ws.anchors[f.target]);
    if (!w) {
      this.ui.placeHint(-999, -999);
      return;
    }
    w.project(this.rig.cam);
    // Off screen (the head is turned away): pin the hint to the edge with an arrow.
    let edge = '';
    if (w.z > 1) {
      w.x = -w.x;
      w.y = -w.y;
    }
    if (w.z > 1 || Math.abs(w.x) > 0.92) {
      edge = w.x < 0 ? 'l' : 'r';
      w.x = Math.sign(w.x) * 0.8;
    }
    w.y = Math.max(-0.85, Math.min(0.9, w.y));
    this.ui.hintEdge(edge);
    this.ui.placeHint((w.x * 0.5 + 0.5) * this.cssW, (-w.y * 0.5 + 0.5) * this.cssH - 4 * this.scale);
  }

  /** Repaint lettering that lives in the world (after a language change). */
  relabel(): void {
    this.ws.relabel(t('sign.shelf'));
    this.applyFocus();
  }

  start(): void {
    this.started = true;
    this.lr.u.uFade.value = 1;
    this.syncWorld();
    this.syncPile();
    this.ui.showMoney(this.game.money);
    if (this.game.owned.apprentice) this.ui.setApprentice(t('app.' + this.game.appState));
  }
}
