import * as THREE from 'three';
import type { Game } from '../sim/game';
import type { TorchIn } from '../sim/weld';
import { emptyTorch } from '../sim/weld';
import { BALANCE } from '../data/balance';
import { SKIN } from '../skin/default';
import { LowRes } from './renderer';
import { makeTextures, Textures } from './textures';
import { buildWorkshop, Workshop, BENCH, TABLE, PART_ROT, PART_SPAN, figure } from './workshop';
import { buildPart, PartMesh } from './partMesh';
import { BeadView, BeadSource } from './bead';
import { Effects } from './particles';
import { Tools } from './tools';
import { CameraRig } from './camera';
import { UI } from './ui';
import { Rng } from '../core/rng';
import { t } from '../i18n';
import type { SeamPoint } from '../sim/seam';

/** Part-local units are millimetres; inside partRoot one unit of geometry is a metre. */
const MM = 0.001;
/** Things you click instead of welding on them. */
const TOOLS_OF_THE_ROOM = new Set(['pile', 'board', 'electrodes', 'door', 'done']);
/** Guide targets that live on the bench: while walking, the hint just says to go back to it. */
const AT_BENCH = new Set(['seam', 'bead', 'arc', 'mask', 'electrodes', 'door']);

/**
 * Everything the player sees, from one station at the bench (Dish Pit style). Reads sim state each frame,
 * reacts to sim events, never writes sim state.
 */
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
  /** The job on the bench: position, turn and drawing scale, so the sim's millimetres map into the room. */
  private partRoot = new THREE.Group();
  private S = 1;
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private mouse = { x: 0, y: 0, in: false };
  private lmb = false;
  /** A click shorter than a frame still reaches the sim once. */
  private latch = false;
  private suppress = false;
  private wheelAcc = 0;
  private dL = 0;
  private keys = { up: false, down: false, left: false, right: false };
  /** Called on every footstep (for the sound). */
  onStep: () => void = () => {};
  private stepT = 0;
  private locked = false;
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
  private v3d = new THREE.Vector3();
  private pt: SeamPoint = { x: 0, z: 0, tx: 1, tz: 0 };
  private endSrc: BeadSource | null = null;
  private lastMask = false;
  private lastCam = '';
  private spotI = 0;
  private spotT = 0;
  private lastStage = '';
  private pickList: THREE.Object3D[] = [];
  private hits: THREE.Intersection[] = [];
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private mouseMoved = true;
  private restTip = new THREE.Vector3(0.3, TABLE + 0.02, -0.42);
  private restLeft = new THREE.Vector3(-0.42, TABLE + 0.01, -0.42);
  started = false;

  /** Where particles land: the job, the bench top, or the floor. */
  private floorAt = (x: number, z: number): number => {
    const part = this.part;
    if (part) {
      this.v3d.set(x, BENCH.y, z);
      this.w2p(this.v3d, this.v3d);
      if (Math.abs(this.v3d.x) < part.half[0] && Math.abs(this.v3d.z) < part.half[1]) return BENCH.y + part.heightAt(this.v3d.x, this.v3d.z) * MM * this.S;
    }
    return this.ws.floorAt(x, z);
  };

  constructor(private game: Game, private canvas: HTMLCanvasElement, uiRoot: HTMLElement, private stage: HTMLElement) {
    this.lr = new LowRes(canvas);
    this.tx = makeTextures();
    this.ws = buildWorkshop(this.tx, game.data, t('sign.shelf'));
    this.tools = new Tools(this.tx);
    this.rig = new CameraRig(this.lr.w / this.lr.h);
    this.partRoot.position.copy(BENCH);
    this.partRoot.rotation.y = PART_ROT;
    this.partRoot.add(this.bead.group);
    this.ws.scene.add(this.partRoot, this.fx.group, this.tools.group, this.rig.cam);
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

  // ------------------------------------------------------------------ coordinates

  /** Part-local millimetres → world. */
  private p2w(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    return this.partRoot.localToWorld(out.set(x * MM, y * MM, z * MM));
  }

  /** World → part-local millimetres. */
  private w2p(p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return this.partRoot.worldToLocal(out.copy(p)).multiplyScalar(1 / MM);
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
    c.addEventListener('pointermove', (e) => {
      // Walking: look around with the mouse (pointer lock, or right-drag where the lock is refused).
      if (this.rig.mode === 'walk' && (this.locked || e.buttons & 2)) {
        this.rig.turn(e.movementX, e.movementY);
        this.mouseMoved = true;
        return;
      }
      pos(e);
    });
    document.addEventListener('pointerlockchange', () => (this.locked = document.pointerLockElement === c));
    c.addEventListener('pointerleave', () => (this.mouse.in = false));
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      pos(e);
      if (!this.started) return;
      if (this.rig.mode === 'walk') {
        if (e.button === 0) {
          if (!this.locked) this.lockPointer();
          this.interact();
        }
        return;
      }
      c.setPointerCapture(e.pointerId);
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
      else if (e.code === 'KeyA' || e.code === 'ArrowLeft') this.keys.left = true;
      else if (e.code === 'KeyD' || e.code === 'ArrowRight') this.keys.right = true;
      else if (e.code === 'KeyR') this.game.queue({ type: 'newElectrode' });
      else if (e.code === 'KeyE' && !e.repeat) {
        if (this.ui.boardOpen) this.ui.closeBoard();
        else if (this.rig.mode === 'station' || this.rig.mode === 'inspect') this.leaveBench();
        else if (this.rig.mode === 'walk') this.interact();
      } else if (e.code === 'Escape' && this.ui.boardOpen) this.ui.closeBoard();
    });
    addEventListener('keyup', (e) => {
      if (e.code === 'KeyW' || e.code === 'ArrowUp') this.keys.up = false;
      if (e.code === 'KeyS' || e.code === 'ArrowDown') this.keys.down = false;
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') this.keys.left = false;
      if (e.code === 'KeyD' || e.code === 'ArrowRight') this.keys.right = false;
    });
    addEventListener('blur', () => (this.keys.up = this.keys.down = this.keys.left = this.keys.right = false));
  }

  private lockPointer(): void {
    try {
      const r = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      r?.catch?.(() => {});
    } catch {
      /* not allowed here: right-drag looks around instead */
    }
  }

  private unlockPointer(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Step back from the bench to walk around the workshop. */
  private leaveBench(): void {
    const a = this.game.player.arc;
    if (a.lit || this.lmb) return;
    this.rig.walk();
    this.ui.hideTip();
    this.hover = '';
    this.lockPointer();
    this.applyFocus();
  }

  private toBench(): void {
    this.unlockPointer();
    this.rig.station();
    this.suppress = true;
    this.ui.setPrompt('');
    this.applyFocus();
  }

  /** What E or a click does to the thing in the middle of the view while walking. */
  private interact(): void {
    const g = this.game;
    const id = this.pick();
    if (!id) return;
    if (id === 'pile') {
      if (g.pile && g.player.stage === 'empty') {
        g.queue({ type: 'takePile' });
        this.toBench();
      } else if (g.flags.board) {
        this.unlockPointer();
        this.ui.openBoard();
      } else this.toBench();
    } else if (id === 'board' && g.flags.board) {
      this.unlockPointer();
      this.ui.openBoard();
    } else if (id.startsWith('shelf:')) g.queue({ type: 'buy', id: id.slice(6) });
    else if (id === 'door') g.queue({ type: 'handOver' });
    else if (id === 'bench' || id === 'part' || id === 'done' || id === 'electrodes') this.toBench();
  }

  private onClick(): void {
    const g = this.game;
    if (this.ui.boardOpen || this.ui.endOpen) return;
    const id = this.pick();
    const b = g.player;
    if (TOOLS_OF_THE_ROOM.has(id) || id.startsWith('shelf:')) {
      this.suppress = true;
      if (id === 'pile') {
        if (g.pile) g.queue({ type: 'takePile' });
        else if (g.flags.board) this.ui.openBoard();
      } else if (id === 'board' && g.flags.board) {
        this.ui.openBoard();
        this.ui.hideTip();
      } else if (id.startsWith('shelf:')) g.queue({ type: 'buy', id: id.slice(6) });
      else if (id === 'electrodes') g.queue({ type: 'newElectrode' });
      else if (id === 'door' || id === 'done') g.queue({ type: 'handOver' });
      return;
    }
    // On the job or the bench: weld, chip, or the simple one-click steps.
    if (b.stage === 'weld' && b.electrode <= 0 && !b.arc.lit && b.swap <= 0) {
      g.queue({ type: 'newElectrode' });
      this.suppress = true;
    } else if (b.stage === 'ready') {
      g.queue({ type: 'handOver' });
      this.suppress = true;
    } else if (b.stage === 'empty' && g.pile) {
      g.queue({ type: 'takePile' });
      this.suppress = true;
    }
  }

  private setRay(): void {
    if (this.rig.mode === 'walk') this.ndc.set(0, 0);
    else this.ndc.set((this.mouse.x / this.cssW) * 2 - 1, -(this.mouse.y / this.cssH) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.rig.cam);
    this.ray.far = this.rig.mode === 'walk' ? 2.6 : Infinity;
  }

  /** What the mouse points at. */
  private pick(): string {
    if (!this.mouse.in && this.rig.mode !== 'walk') return '';
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
      if (o?.userData.pick) return o.userData.pick as string;
    }
    return '';
  }

  /** Mouse → part-local millimetres on the job's surface. */
  private aimOnPart(out: TorchIn): void {
    out.has = false;
    if (!this.part || !this.mouse.in) return;
    this.setRay();
    this.hits.length = 0;
    const hits = this.ray.intersectObject(this.part.group, true, this.hits);
    let p: THREE.Vector3 | null = hits.length ? hits[0].point : null;
    if (!p) {
      this.plane.constant = -(BENCH.y + this.part.top * 0.6 * MM * this.S);
      p = this.ray.ray.intersectPlane(this.plane, this.v3) ?? null;
    }
    if (!p) return;
    this.w2p(p, this.v3b);
    out.has = true;
    out.x = this.v3b.x;
    out.z = this.v3b.z;
  }

  /** Input for one frame; the arc-length request is handed to the first sim step only. */
  frameInput(dt: number): TorchIn {
    const tr = this.torch;
    const active = this.started && !this.ui.boardOpen && !this.ui.endOpen && (this.rig.mode === 'station' || this.rig.mode === 'inspect');
    if (active) this.aimOnPart(tr);
    else tr.has = false;
    tr.press = active && (this.lmb || this.latch) && !this.suppress && this.mouse.in;
    const kr = BALANCE.arc.keyRate * dt;
    const atBench = this.rig.mode !== 'walk';
    tr.dL = this.dL + (atBench && this.keys.up ? kr : 0) - (atBench && this.keys.down ? kr : 0);
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
    b.on('money', (e) => {
      this.ui.showMoney(e.money, e.delta > 0);
      this.ws.setMoney(e.money);
    });
    b.on('shopChanged', () => {
      this.syncWorld();
      this.ui.refreshTip();
      this.ui.renderBoard();
    });
    b.on('boardChanged', () => {
      this.syncWorld();
      this.ui.renderBoard();
    });
    b.on('pileChanged', () => {
      this.syncPile();
      this.syncWorld();
    });
    b.on('bought', () => this.syncWorld());
    b.on('beat', (e) => {
      this.syncWorld();
      this.ui.beat(t('beat.' + e.id));
    });
    b.on('electrodeNew', () => this.ws.setRods(12 - (g.log.electrodes % 12)));
    b.on('orderTaken', (e) => {
      if (e.bench !== 'player') return;
      this.setPart(e.part);
      this.bead.attach(g.player, this.part!.heightAt);
      this.setCustomer(g.player.order?.customer ?? 'neighbour');
      this.ui.closeBoard();
      this.syncWorld();
    });
    b.on('handedOver', (e) => {
      if (e.bench === 'player') {
        this.ui.toast(`+${e.pay} ◆  ${t('part.' + e.part)}` + (e.reqMet ? '' : ' · ' + t('pay.reqFail')));
        this.ws.customer.visible = false;
        if (!g.showEnd) {
          this.clearPart();
          this.rig.station();
        }
      } else this.ui.toast(`+${e.pay} ◆  ${t('app.done', { grade: t('grade.' + e.grade) })}`);
      this.syncWorld();
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
      this.p2w(e.x, (this.part?.heightAt(e.x, e.z) ?? 0) + 2, e.z, this.v3);
      this.fx.slag(this.v3.x, this.v3.y, this.v3.z, e.amount);
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
      this.p2w(e.x, (this.part?.heightAt(e.x, e.z) ?? 0) + 1, e.z, this.v3);
      this.fx.burst(this.v3.x, this.v3.y, this.v3.z);
    });
    b.on('arcStrike', (e) => {
      if (e.bench !== 'player') return;
      this.p2w(e.x, (this.part?.heightAt(e.x, e.z) ?? 0) + 1, e.z, this.v3);
      this.fx.spatter(this.v3.x, this.v3.y, this.v3.z, 16, 0.4);
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
      this.rig.end(this.v3.copy(BENCH));
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
          this.rig.station();
        },
      );
    });
  }

  /** Lean in for a moment over the middle of the longest seam. */
  private inspect(): void {
    const b = this.game.player;
    let best = b.seams[0];
    for (const s of b.seams) if (s.len > best.len) best = s;
    if (!best || !this.part) return;
    best.pointAt(best.len * 0.5, this.pt);
    this.p2w(this.pt.x, this.part.heightAt(this.pt.x, this.pt.z), this.pt.z, this.v3);
    this.rig.inspect(this.v3, 22);
    this.inspectT = BALANCE.chip.inspectTime;
  }

  private setPart(id: string): void {
    this.clearPart();
    const def = this.game.data.parts[id];
    this.part = buildPart(def, this.tx);
    // Every job is drawn to fill the middle of the view.
    this.S = PART_SPAN / (def.frame * MM);
    this.partRoot.scale.setScalar(this.S);
    this.partRoot.updateMatrixWorld(true);
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

  /** The next job lies on top of the heap. */
  private syncPile(): void {
    if (this.pileMesh) this.ws.pileSlot.remove(this.pileMesh);
    this.pileMesh = null;
    const o = this.game.pile;
    if (!o) return;
    const pm = buildPart(this.game.data.parts[o.part], this.tx);
    pm.group.traverse((c) => (c.userData.pick = 'pile'));
    pm.group.scale.setScalar(0.3 / (pm.half[0] * 2 * MM));
    pm.group.position.y = 0.2;
    this.pileMesh = pm.group;
    this.ws.pileSlot.add(pm.group);
  }

  /** World objects that mirror sim state: shelf, owned things, tally, piles, apprentice, second wheel. */
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
    const waiting = g.board.length + (g.pile ? 1 : 0);
    this.ws.setOrders(g.ordersDone, waiting);
    this.ws.setPiles(waiting, g.ordersDone);
    this.ws.setMoney(g.money);
    this.applyFocus();
  }

  private applyFocus(): void {
    const f = this.game.guide;
    const key = f.target === 'shelf' ? 'shelf:coated' : f.target === 'door' ? 'done' : f.target;
    for (const k in this.ws.hiMats) {
      const on = k === key || k === this.hover;
      for (const m of this.ws.hiMats[k]) m.emissive.set(on ? '#3a2a1a' : '#000000');
    }
    this.bead.highlight(f.target === 'seam' ? f.seam : -1, 1);
    let hint = f.hint ? t('hint.' + f.hint) : '';
    if (this.rig.mode === 'walk' && AT_BENCH.has(f.target)) hint = this.game.player.stage !== 'empty' ? t('hint.toBench') : '';
    this.ui.setHint(hint, f.target === 'mask' && this.rig.mode !== 'walk');
  }

  // ------------------------------------------------------------------ frame

  render(dt: number): void {
    const g = this.game;
    const b = g.player;
    const a = b.arc;
    const L = SKIN.light;
    const r = this.rng;
    const S = this.S;

    if (this.inspectT > 0) {
      this.inspectT -= dt;
      if (this.inspectT <= 0 && this.rig.mode === 'inspect') this.rig.station();
    }
    this.rig.turnable = !this.lmb && !a.lit && !this.ui.boardOpen;
    if (this.mouse.in && this.rig.mode !== 'walk') this.rig.setNudge((this.mouse.x / this.cssW) * 2 - 1);
    if (this.rig.mode === 'walk' && !this.ui.boardOpen) {
      const k = this.keys;
      const moved = this.rig.move((k.up ? 1 : 0) - (k.down ? 1 : 0), (k.right ? 1 : 0) - (k.left ? 1 : 0), dt, this.ws.blocked);
      if (moved) {
        this.mouseMoved = true;
        this.stepT -= dt;
        if (this.stepT <= 0) {
          this.stepT = 0.42;
          this.onStep();
        }
      } else this.stepT = 0.1;
    }
    this.rig.update(dt);
    if (this.lastMask !== g.mask.down || this.lastStage !== b.stage || this.lastCam !== this.rig.mode) {
      this.lastMask = g.mask.down;
      this.lastStage = b.stage;
      this.lastCam = this.rig.mode;
      this.applyFocus();
      this.ui.setCtrl(!this.started ? '' : this.rig.mode === 'walk' ? 'walk' : 'bench', g.mask.down);
    }

    // Hover: highlight and the shelf tooltip.
    const canHover = this.started && !this.ui.boardOpen && !this.ui.endOpen;
    if (canHover && (this.mouseMoved || !this.rig.settled())) {
      this.mouseMoved = false;
      const id = this.pick();
      if (id !== this.hover) {
        this.hover = id;
        this.applyFocus();
        const tx = this.rig.mode === 'walk' ? this.cssW / 2 : this.mouse.x;
        const ty = this.rig.mode === 'walk' ? this.cssH / 2 : this.mouse.y;
        if (id.startsWith('shelf:')) this.ui.showTip(id.slice(6), tx, ty + 10 * this.scale);
        else this.ui.hideTip();
        this.ui.setPrompt(this.rig.mode === 'walk' ? this.promptFor(id) : '');
      }
    } else if (!canHover && this.hover) {
      this.hover = '';
      this.ui.hideTip();
    }

    // Lights and the world outside.
    const I = g.power.I;
    const dark = g.clock.dark;
    this.ws.lights.lamp.intensity = L.lamp.intensity * Math.min(1.6, I * I);
    const wi = L.window.intensity * (1 - dark) + L.window.night * dark;
    this.ws.lights.window.intensity = wi;
    this.ws.lights.door.intensity = wi * 0.7;
    const skyK = 1 - 0.78 * dark;
    this.ws.sky.color.setScalar(skyK);
    for (const m of this.ws.far) m.color.copy(m.userData.base as THREE.Color).multiplyScalar(0.4 + 0.6 * skyK);
    this.ws.wheels[0].userData.rot.rotation.z = -g.power.angle;
    this.ws.wheels[1].userData.rot.rotation.z = -g.power.angle * 1.15 + 0.5;
    this.ws.setGauge(I);
    this.ws.snow.visible = SKIN.snow;
    if (SKIN.snow) this.updateSnow(dt, g.clock.snow);
    const qn = Math.min(7, Math.round(1 + g.t / 55 + g.board.length * 0.5 + (g.flags.finale ? 2 : 0)));
    for (let i = 0; i < this.ws.queue.length; i++) this.ws.queue[i].visible = g.started && i < qn;
    this.ws.customer.visible = b.stage !== 'empty';

    // The job, the hands and the arc.
    this.bead.update();
    const tip = this.v3c;
    if (this.part && this.torch.has) {
      const surf = this.part.heightAt(this.torch.x, this.torch.z);
      const hover = b.stage === 'weld' ? (a.lit ? a.L * 1.4 : this.lmb ? 0.4 : 7) : 0;
      this.p2w(this.torch.x, surf + hover, this.torch.z, tip);
      this.lastPartTip.copy(tip);
    } else tip.copy(this.lastPartTip);

    const stage = b.stage;
    const chipping = !!this.part && stage === 'chip';
    this.tools.hammer.visible = chipping;
    this.ws.restHammer.visible = !chipping;
    this.tools.holder.visible = !chipping;
    this.tools.group.visible = this.rig.mode !== 'walk';
    if (this.part && stage === 'weld') this.tools.placeHolder(tip, this.rig.cam, b.swap > 0 ? 0 : b.electrode);
    else this.tools.placeHolder(this.restTip, this.rig.cam, b.electrode);
    if (chipping) this.tools.placeHammer(tip, this.rig.cam, dt);
    if (this.part) this.tools.placeLeft(this.p2w(-this.part.half[0] * 0.92, this.part.heightAt(-this.part.half[0] * 0.92, 0) + 2, this.part.half[1] * 0.2, this.v3d), this.rig.cam);
    else this.tools.placeLeft(this.restLeft, this.rig.cam);

    const lit = a.lit && !!this.part && stage === 'weld';
    this.tools.arcGlow.visible = lit;
    this.tools.arcStar.visible = lit;
    this.tools.bolt.visible = lit;
    this.tools.pool.visible = lit && a.onSeam && a.pool > 0.8;
    const arcLight = this.ws.lights.arc;
    let arcOn = 0;
    if (lit) {
      const surfY = this.p2w(this.torch.x, this.part!.heightAt(this.torch.x, this.torch.z) + 0.3, this.torch.z, this.v3b).y;
      const flick = 0.75 + 0.5 * r.next();
      const longK = Math.max(0, a.L - 3.4);
      let k = flick * Math.pow(Math.min(1.5, I), 1.5) * (1 + longK * 0.4 * (r.next() - 0.3));
      if (a.unstable > 0 && r.chance(a.unstable * 0.5)) k *= 0.2;
      const jit = SKIN.light.arc.jitterMM * MM * S;
      const midY = (tip.y + surfY) / 2;
      arcLight.position.set(tip.x + r.signed() * jit, midY + 0.006, tip.z + r.signed() * jit);
      arcLight.intensity = L.arc.intensity * k;
      arcOn = k;
      this.tools.arcGlow.position.set(tip.x, midY, tip.z);
      this.tools.arcGlow.quaternion.copy(this.rig.cam.quaternion);
      const sz = (3 + a.L * 1.2) * MM * S * (0.8 + 0.4 * r.next());
      this.tools.arcGlow.scale.set(sz, sz, sz);
      this.tools.arcStar.position.copy(this.tools.arcGlow.position);
      this.tools.arcStar.quaternion.copy(this.rig.cam.quaternion);
      const ss = (0.08 + 0.04 * r.next()) * k;
      this.tools.arcStar.scale.set(ss, ss, ss);
      this.v3b.set(tip.x, surfY, tip.z);
      this.tools.setBolt(tip, this.v3b, (0.4 + a.L * 0.35) * MM * S, r);
      if (this.tools.pool.visible) {
        const ps = (2 + Math.min(4, a.pool * 2)) * MM * S;
        this.tools.pool.position.set(tip.x, surfY + 0.0004, tip.z);
        this.tools.pool.scale.set(ps, 1, ps * 0.8);
      }
      if (a.onSeam) this.fx.fumes(tip.x, surfY, tip.z, dt, 10);
      this.sparkAcc += a.spatterRate * dt * 2.2;
      const n = Math.min(16, Math.floor(this.sparkAcc));
      this.sparkAcc -= n;
      if (n > 0) this.fx.spatter(tip.x, surfY + 0.002, tip.z, n, longK * 0.5 + a.unstable);
    } else {
      arcLight.intensity = 0;
      this.sparkAcc = 0;
    }
    arcLight.castShadow = lit;
    // The hot bead lights the bench a little after the arc goes out.
    const hot = b.hot();
    if (!lit && hot > 0.5 && this.part) {
      arcLight.intensity = Math.min(0.12, (hot - 0.5) * 0.08);
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

    this.fx.update(dt, this.floorAt, arcOn);

    // Post: mask, glare, afterimage, shake.
    const u = this.lr.u;
    u.uMaskPos.value = g.mask.pos;
    u.uMaskT.value = g.stats.maskTransmission;
    u.uMaskWindow.value = g.stats.maskWindow;
    u.uGlare.value = g.glare;
    this.updateSpots(dt, lit && g.mask.pos < 0.5);
    u.uArcOn.value = arcOn;
    if (lit) {
      this.v3.copy(this.tools.arcGlow.position).project(this.rig.cam);
      u.uArcUv.value.set(this.v3.x * 0.5 + 0.5, this.v3.y * 0.5 + 0.5);
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

  /**
   * Bunnies in the eye: while the arc is watched without the mask, a stain is left every so often where it
   * burns on screen; each one fades by itself over a couple of seconds.
   */
  private updateSpots(dt: number, exposed: boolean): void {
    const spots = this.lr.u.uSpots.value as THREE.Vector3[];
    for (const s of spots) s.z *= Math.exp(-dt / 2.8);
    if (!exposed) {
      this.spotT = 0;
      return;
    }
    this.spotT -= dt;
    const uv = this.lr.u.uArcUv.value as THREE.Vector2;
    // Strengthen the newest stain while the eye stays on the same spot; start a new one when it moves.
    const cur = spots[this.spotI];
    const near = Math.hypot(cur.x - uv.x, (cur.y - uv.y) * 0.56) < 0.03;
    if (near && cur.z > 0.05) cur.z = Math.min(1, cur.z + dt * 1.2);
    else if (this.spotT <= 0) {
      this.spotT = 0.35;
      this.spotI = (this.spotI + 1) % spots.length;
      spots[this.spotI].set(uv.x, uv.y, 0.75);
    }
  }

  private updateSnow(dt: number, density: number): void {
    const p = this.ws.snow.geometry.attributes.position as THREE.BufferAttribute;
    const arr = p.array as Float32Array;
    const n = Math.floor((arr.length / 3) * Math.min(1, density));
    const wind = 0.15 + density * 0.5;
    for (let i = 0; i < n; i++) {
      arr[i * 3 + 1] -= this.ws.snowVel[i] * dt;
      arr[i * 3] += wind * dt * (0.6 + this.ws.snowVel[i]);
      if (arr[i * 3 + 1] < 0) arr[i * 3 + 1] += 3.6;
      if (arr[i * 3] > 2) arr[i * 3] -= 6;
    }
    this.ws.snow.geometry.setDrawRange(0, n);
    p.needsUpdate = true;
  }

  /** Move the hint label to its anchor and draw the cursor. */
  private placeOverlay(): void {
    const g = this.game;
    const f = g.guide;
    const overJob = !!this.part && this.torch.has && (this.hover === 'part' || this.hover === 'bench' || this.hover === '') && g.player.stage === 'weld';
    if (this.rig.mode === 'walk') this.ui.placeCursor(this.cssW / 2, this.cssH / 2, this.started && !this.ui.boardOpen);
    else this.ui.placeCursor(this.mouse.x, this.mouse.y, this.started && this.mouse.in && !this.ui.boardOpen && !overJob);
    this.ui.placePrompt(this.cssW / 2, this.cssH / 2 + 12 * this.scale);
    if (!this.ui.hintVisible) return;
    let w: THREE.Vector3 | null = null;
    if (this.rig.mode === 'walk' && AT_BENCH.has(f.target)) {
      w = this.v3.copy(this.ws.anchors.bench);
    } else if (f.target === 'mask') {
      this.ui.hintEdge('');
      this.ui.placeHint(this.cssW / 2, this.cssH * 0.14);
      return;
    } else if ((f.target === 'seam' || f.target === 'bead') && this.part) w = this.p2w(f.x, this.part.heightAt(f.x, f.z) + 3, f.z, this.v3);
    else if (f.target === 'arc' || (f.target === 'electrodes' && this.part)) w = this.v3.copy(this.lastPartTip).add(this.v3b.set(0, 0.02, 0));
    else if (this.ws.anchors[f.target]) w = this.v3.copy(this.ws.anchors[f.target]);
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

  private promptFor(id: string): string {
    const g = this.game;
    if (!id) return '';
    if (id === 'pile') return g.pile && g.player.stage === 'empty' ? t('act.take') : g.flags.board ? t('act.board') : t('act.bench');
    if (id === 'board') return g.flags.board ? t('act.board') : '';
    if (id.startsWith('shelf:')) return t('act.buy');
    if (id === 'door') return g.player.stage === 'ready' ? t('act.door') : '';
    if (id === 'bench' || id === 'part' || id === 'done' || id === 'electrodes') return t('act.bench');
    return '';
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
    this.ws.setRods(12 - (this.game.log.electrodes % 12));
    if (this.game.owned.apprentice) this.ui.setApprentice(t('app.' + this.game.appState));
  }
}
