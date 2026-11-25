import * as THREE from 'three';
import type { Game } from '../sim/game';
import type { TorchIn } from '../sim/weld';
import { emptyTorch, nearestSeam, canReach } from '../sim/weld';
import type { Proj } from '../sim/seam';
import { BALANCE } from '../data/balance';
import { SKIN } from '../skin/default';
import { LowRes } from './renderer';
import { makeTextures, Textures } from './textures';
import { buildWorkshop, Workshop, BENCH, TABLE, PART_ROT, PART_SPAN, figure, KEY_K, LAMP_K } from './workshop';
import { buildPart, PartMesh } from './partMesh';
import { BeadView, BeadSource } from './bead';
import { Effects } from './particles';
import { Tools } from './tools';
import { CameraRig } from './camera';
import { UI } from './ui';
import { Rng } from '../core/rng';
import { t } from '../i18n';
import { seamPoint } from '../sim/seam';

/** Part-local units are millimetres; inside partRoot one unit of geometry is a metre. */
const MM = 0.001;
/** Things you click instead of welding on them. */
const TOOLS_OF_THE_ROOM = new Set(['pile', 'board', 'electrodes', 'door', 'done']);
const Y_UP = new THREE.Vector3(0, 1, 0);
/** Room on the bench for a job turned any way (m): clear of the scrap crate and the finished stack. */
const FREE_R = 0.4;
/** How far the head leans toward the arc while welding (fraction of the way). */
const LEAN = 0.38;

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
  /** Keys held down, by code. */
  private held = new Set<string>();
  /** Turning the job by right-drag, radians accumulated since the last sim step. */
  private turn = { x: 0, y: 0 };
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
  private lastSurf = new THREE.Vector3();
  /** Middle of the job's footprint (part-local mm), the point it turns about on the bench. */
  private mid = new THREE.Vector3();
  private aimProj: Proj = { s: 0, d: 0, dist: 0, seam: -1 };
  private strikeAcc = 0;
  private leanT = 0;
  private leanAt = new THREE.Vector3();
  private whyT = 0;
  private v3q = new THREE.Quaternion();
  private v3 = new THREE.Vector3();
  private v3b = new THREE.Vector3();
  private v3c = new THREE.Vector3();
  private v3d = new THREE.Vector3();
  private pt = seamPoint();
  /** Where the cursor lands on the job (world) and the surface normal there. */
  private surfW = new THREE.Vector3();
  private normW = new THREE.Vector3(0, 1, 0);
  /** Last turn of the job applied to partRoot, and what was worked out from it. */
  private rotKey = '';
  private rotStill = 0;
  private lift = 0;
  private hmap = { ok: false, x0: 0, z0: 0, dx: 1, dz: 1, h: new Float32Array(16 * 16) };
  private grip = new THREE.Vector3();
  private box = new THREE.Box3();
  private q3 = new THREE.Quaternion();
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
  private restTip = new THREE.Vector3(0.2, TABLE + 0.04, -0.62);
  private restLeft = new THREE.Vector3(-0.24, TABLE + 0.02, -0.62);
  started = false;

  /** Where particles land: the job, the bench top, or the floor. */
  private floorAt = (x: number, z: number): number => {
    const m = this.hmap;
    if (this.part && m.ok) {
      const i = Math.floor((x - m.x0) / m.dx), j = Math.floor((z - m.z0) / m.dz);
      if (i >= 0 && i < 16 && j >= 0 && j < 16) {
        const h = m.h[j * 16 + i];
        if (h > -1) return h;
      }
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
      // At the bench: right-drag turns the job in the hands.
      if (this.rig.mode !== 'walk' && e.buttons & 2 && this.part) {
        this.turn.y += e.movementX * 0.012;
        this.turn.x += e.movementY * 0.012;
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
      if (e.button === 1) {
        e.preventDefault();
        this.game.queue({ type: 'faceNext' });
        return;
      }
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
      } else if (e.code === 'Tab') {
        e.preventDefault();
        if (!e.repeat && this.rig.mode !== 'walk') this.game.queue({ type: 'faceNext' });
      } else if (/^(Key[WASD]|Arrow)/.test(e.code)) {
        this.held.add(e.code);
        if (e.code.startsWith('Arrow')) e.preventDefault();
      } else if (e.code === 'KeyR') this.game.queue({ type: 'newElectrode' });
      else if (e.code === 'KeyE' && !e.repeat) {
        if (this.ui.boardOpen) this.ui.closeBoard();
        else if (this.rig.mode === 'station' || this.rig.mode === 'inspect') this.leaveBench();
        else if (this.rig.mode === 'walk') this.interact();
      } else if (e.code === 'Escape' && this.ui.boardOpen) this.ui.closeBoard();
    });
    addEventListener('keyup', (e) => {
      this.held.delete(e.code);
    });
    addEventListener('blur', () => this.held.clear());
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
    if (!id || id === 'bench') {
      if (this.nearBench()) this.toBench();
      return;
    }
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

  /**
   * Mouse → part-local millimetres on the job's surface. Off the metal (a thin rod, an edge), the joint nearest
   * on screen catches the cursor in the plane it faces, so thin seams can still be followed.
   */
  private aimOnPart(out: TorchIn): void {
    out.has = false;
    if (!this.part || !this.mouse.in) return;
    this.setRay();
    this.hits.length = 0;
    const hits = this.ray.intersectObjects(this.part.meshes, false, this.hits);
    if (hits.length) {
      const h = hits[0];
      this.surfW.copy(h.point);
      if (h.face) this.normW.copy(h.face.normal).transformDirection(h.object.matrixWorld);
      if (this.normW.dot(this.ray.ray.direction) > 0) this.normW.negate();
      this.w2p(h.point, this.v3b);
      out.has = true;
      out.x = this.v3b.x;
      out.y = this.v3b.y;
      out.z = this.v3b.z;
      return;
    }
    const b = this.game.player;
    let best = 0.07, bs = -1, bseam = -1;
    const cam = this.rig.cam;
    for (let i = 0; i < b.seams.length; i++) {
      const sr = b.seams[i];
      for (let s = 0; s <= sr.len; s += 3) {
        sr.pointAt(s, this.pt);
        this.p2w(this.pt.x, this.pt.y, this.pt.z, this.v3).project(cam);
        const d = Math.hypot(this.v3.x - this.ndc.x, (this.v3.y - this.ndc.y) * 0.56);
        if (d < best) {
          best = d;
          bs = s;
          bseam = i;
        }
      }
    }
    if (bseam < 0) return;
    const p = b.seams[bseam].pointAt(bs, this.pt);
    this.p2w(p.x, p.y, p.z, this.v3);
    this.normW.set(p.nx, p.ny, p.nz).transformDirection(this.partRoot.matrixWorld);
    this.plane.setFromNormalAndCoplanarPoint(this.normW, this.v3);
    if (!this.ray.ray.intersectPlane(this.plane, this.surfW)) return;
    this.w2p(this.surfW, this.v3b);
    out.has = true;
    out.x = this.v3b.x;
    out.y = this.v3b.y;
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
    const k = (c: string) => (this.held.has(c) ? 1 : 0);
    tr.dL = this.dL + (active ? (k('ArrowUp') - k('ArrowDown')) * kr : 0);
    this.dL = 0;
    // Turning the job: right-drag, A/D (also ←/→) about the vertical, W/S toward or away from you.
    const kt = BALANCE.weld.keyTurn * dt;
    tr.turnY = active && this.part ? this.turn.y + (k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft')) * kt : 0;
    tr.turnX = active && this.part ? this.turn.x + (k('KeyS') - k('KeyW')) * kt : 0;
    this.turn.x = this.turn.y = 0;
    tr.forceL = NaN;
    return tr;
  }

  /** After the first sim step of a frame the one-shot part of the input is spent. */
  consumeOneShot(): void {
    this.torch.dL = 0;
    this.torch.turnX = this.torch.turnY = 0;
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
      this.bead.attach(g.player, this.snapToPart);
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
      this.p2w(e.x, e.y, e.z, this.v3).addScaledVector(this.normW, 2 * MM * this.S);
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
      this.p2w(e.x, e.y, e.z, this.v3);
      this.fx.burst(this.v3.x, this.v3.y, this.v3.z);
    });
    b.on('arcStrike', (e) => {
      if (e.bench !== 'player') return;
      this.p2w(e.x, e.y, e.z, this.v3);
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
      this.bead.attach(this.endSrc, this.snapToPart);
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
    this.p2w(this.pt.x, this.pt.y, this.pt.z, this.v3);
    this.rig.inspect(this.v3, 22);
    this.inspectT = BALANCE.chip.inspectTime;
  }

  private setPart(id: string): void {
    this.clearPart();
    const def = this.game.data.parts[id];
    this.part = buildPart(def, this.tx);
    // Every job is drawn to fill the middle of the view.
    // Turn about the middle of the job, and keep it small enough that, turned any way, it stays clear of
    // the scrap crate and the finished stack on either side.
    const h = this.part.hull;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < h.length; i += 3) {
      x0 = Math.min(x0, h[i]);
      x1 = Math.max(x1, h[i]);
      z0 = Math.min(z0, h[i + 2]);
      z1 = Math.max(z1, h[i + 2]);
    }
    this.mid.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
    let rmax = 1;
    for (let i = 0; i < h.length; i += 3) rmax = Math.max(rmax, Math.hypot(h[i] - this.mid.x, h[i + 1], h[i + 2] - this.mid.z));
    this.S = Math.min(PART_SPAN / (def.frame * MM), FREE_R / (rmax * MM));
    this.partRoot.scale.setScalar(this.S);
    this.partRoot.add(this.part.group);
    this.rotKey = '';
    this.placePart(0);
  }

  /**
   * Follow the sim's turn of the job: orient partRoot, rest the lowest point on the bench, and once it has
   * stopped turning, work out where sparks land on it and where the tongs grip it.
   */
  private placePart(dt: number): void {
    if (!this.part) return;
    const q = this.game.player.rot;
    const key = q.map((v) => v.toFixed(4)).join();
    if (key !== this.rotKey) {
      this.rotKey = key;
      this.rotStill = 0;
      this.hmap.ok = false;
      this.q3.set(q[0], q[1], q[2], q[3]);
      const h = this.part.hull;
      let minY = Infinity;
      for (let i = 0; i < h.length; i += 3) {
        const y = this.v3.set(h[i], h[i + 1], h[i + 2]).applyQuaternion(this.q3).y;
        if (y < minY) minY = y;
      }
      this.lift = -minY + 0.5;
      this.partRoot.quaternion.copy(this.q3);
      if (PART_ROT) this.partRoot.quaternion.premultiply(this.v3q.setFromAxisAngle(Y_UP, PART_ROT));
      // Keep the middle of the job over the middle of the bench whichever way it's turned.
      const c = this.v3.copy(this.mid).applyQuaternion(this.partRoot.quaternion);
      const k = MM * this.S;
      this.partRoot.position.copy(BENCH).add(this.v3.set(-c.x * k, this.lift * k, -c.z * k));
      this.partRoot.updateMatrixWorld(true);
      this.box.setFromObject(this.part.group);
      this.grip.set(Math.max(this.box.min.x, BENCH.x - 0.34), (this.box.min.y + this.box.max.y) / 2, Math.min(this.box.max.z, BENCH.z + 0.06));
      return;
    }
    this.rotStill += dt;
    if (!this.hmap.ok && this.rotStill > 0.2) this.buildHeightMap();
  }

  private buildHeightMap(): void {
    const m = this.hmap, b = this.box;
    m.x0 = b.min.x;
    m.z0 = b.min.z;
    m.dx = Math.max(1e-4, (b.max.x - b.min.x) / 16);
    m.dz = Math.max(1e-4, (b.max.z - b.min.z) / 16);
    const rc = this.ray;
    const far = rc.far;
    rc.far = Infinity;
    for (let j = 0; j < 16; j++)
      for (let i = 0; i < 16; i++) {
        rc.ray.origin.set(m.x0 + (i + 0.5) * m.dx, b.max.y + 0.05, m.z0 + (j + 0.5) * m.dz);
        rc.ray.direction.set(0, -1, 0);
        this.hits.length = 0;
        const hit = rc.intersectObjects(this.part!.meshes, false, this.hits);
        m.h[j * 16 + i] = hit.length ? hit[0].point.y : -2;
      }
    rc.far = far;
    m.ok = true;
    // Tongs: grip the leftmost metal at middle height.
    rc.ray.origin.set(BENCH.x - 0.5, (b.min.y + b.max.y) / 2, BENCH.z + 0.02);
    rc.ray.direction.set(1, 0, 0);
    this.hits.length = 0;
    const g = rc.intersectObjects(this.part!.meshes, false, this.hits);
    if (g.length && g[0].point.x < BENCH.x) this.grip.copy(g[0].point);
  }

  /** Bead helper: slide a point (part-local mm) along -n onto the job's surface. */
  private snapToPart = (p: THREE.Vector3, n: THREE.Vector3): void => {
    if (!this.part) return;
    const o = this.p2w(p.x + n.x * 20, p.y + n.y * 20, p.z + n.z * 20, this.v3d);
    const d = this.v3c.set(n.x, n.y, n.z).transformDirection(this.partRoot.matrixWorld).negate();
    const rc = this.ray;
    rc.ray.origin.copy(o);
    rc.ray.direction.copy(d);
    const far = rc.far;
    rc.far = 60 * MM * this.S;
    this.hits.length = 0;
    const h = rc.intersectObjects(this.part.meshes, false, this.hits);
    rc.far = far;
    if (h.length) this.w2p(h[0].point, p);
  };


  private clearPart(): void {
    if (this.part) this.partRoot.remove(this.part.group);
    this.part = null;
    this.hmap.ok = false;
    this.bead.attach(null);
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
    const def = this.game.data.parts[o.part];
    const pm = buildPart(def, this.tx);
    pm.group.traverse((c) => (c.userData.pick = 'pile'));
    const r = def.rest ?? [0, 0, 0];
    const k = Math.PI / 180;
    pm.group.rotation.set(r[0] * k, r[1] * k, r[2] * k);
    pm.group.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(pm.group);
    const size = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z, 1e-3);
    const sc = 0.3 / size;
    pm.group.scale.setScalar(sc);
    pm.group.position.y = -bb.min.y * sc;
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
    if (this.rig.mode === 'walk') hint = f.target ? t('hint.toBench') : '';
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
      const k = (c: string) => (this.held.has(c) ? 1 : 0);
      const moved = this.rig.move(
        Math.min(1, k('KeyW') + k('ArrowUp')) - Math.min(1, k('KeyS') + k('ArrowDown')),
        Math.min(1, k('KeyD') + k('ArrowRight')) - Math.min(1, k('KeyA') + k('ArrowLeft')),
        dt,
        this.ws.blocked,
      );
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
      } else if (this.rig.mode === 'walk') this.ui.setPrompt(this.promptFor(id));
    } else if (!canHover && this.hover) {
      this.hover = '';
      this.ui.hideTip();
    }

    // Lights and the world outside.
    const I = g.power.I;
    const dark = g.clock.dark;
    const lampK = L.lamp.intensity * Math.min(1.6, I * I);
    this.ws.lights.lamp.intensity = lampK * LAMP_K;
    this.ws.lights.key.intensity = lampK * KEY_K;
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
    this.placePart(dt);
    this.bead.update(dt);
    const tip = this.v3c;
    if (this.part && this.torch.has) {
      const hover = b.stage === 'weld' ? (a.lit ? a.L * 1.4 : this.lmb ? 0.4 : 7) : 0;
      tip.copy(this.surfW).addScaledVector(this.normW, hover * MM * S);
      this.lastPartTip.copy(tip);
      this.lastSurf.copy(this.surfW);
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
    if (this.part) this.tools.placeLeft(this.grip, this.rig.cam);
    else this.tools.placeLeft(this.restLeft, this.rig.cam);

    const lit = a.lit && !!this.part && stage === 'weld';
    this.tools.arcGlow.visible = lit;
    this.tools.arcStar.visible = lit;
    this.tools.bolt.visible = lit;
    this.tools.pool.visible = false;
    this.bead.setPool(lit && a.onSeam, a.seam, a.s, a.d, a.pool, a.dir, 0.85 + 0.3 * r.next());
    // Lean in over the work while the arc burns; straighten up a moment after it goes out.
    if (lit && this.rig.mode === 'station') {
      if (this.leanT <= 0) this.leanAt.copy(this.lastSurf);
      this.leanT = 1.4;
      this.rig.lean(this.leanAt, LEAN);
    } else if (this.leanT > 0) {
      this.leanT -= dt;
      if (this.leanT <= 0 && this.rig.mode === 'station') this.rig.lean(null, 0);
    }
    this.updateAim(dt);
    const arcLight = this.ws.lights.arc;
    let arcOn = 0;
    if (lit) {
      const surf = this.lastSurf;
      const flick = 0.75 + 0.5 * r.next();
      const longK = Math.max(0, a.L - 3.4);
      let k = flick * Math.pow(Math.min(1.5, I), 1.5) * (1 + longK * 0.4 * (r.next() - 0.3));
      if (a.unstable > 0 && r.chance(a.unstable * 0.5)) k *= 0.2;
      const jit = SKIN.light.arc.jitterMM * MM * S;
      const mid = this.v3b.copy(tip).add(surf).multiplyScalar(0.5);
      arcLight.position.set(mid.x + r.signed() * jit, mid.y + 0.006, mid.z + r.signed() * jit);
      arcLight.intensity = L.arc.intensity * k;
      arcOn = k;
      this.tools.arcGlow.position.copy(mid);
      this.tools.arcGlow.quaternion.copy(this.rig.cam.quaternion);
      const sz = (3 + a.L * 1.2) * MM * S * (0.8 + 0.4 * r.next());
      this.tools.arcGlow.scale.set(sz, sz, sz);
      this.tools.arcStar.position.copy(this.tools.arcGlow.position);
      this.tools.arcStar.quaternion.copy(this.rig.cam.quaternion);
      const ss = (0.08 + 0.04 * r.next()) * k;
      this.tools.arcStar.scale.set(ss, ss, ss);
      this.tools.setBolt(tip, surf, (0.4 + a.L * 0.35) * MM * S, r);
      if (this.tools.pool.visible) {
        const ps = (2 + Math.min(4, a.pool * 2)) * MM * S;
        this.tools.pool.position.copy(surf).addScaledVector(this.normW, 0.0004);
        this.tools.pool.quaternion.setFromUnitVectors(Y_UP, this.normW);
        this.tools.pool.scale.set(ps, 1, ps * 0.8);
      }
      if (a.onSeam) this.fx.fumes(surf.x, surf.y, surf.z, dt, 10);
      this.sparkAcc += a.spatterRate * dt * 2.2;
      const n = Math.min(16, Math.floor(this.sparkAcc));
      this.sparkAcc -= n;
      if (n > 0) this.fx.spatter(surf.x, surf.y + 0.002, surf.z, n, longK * 0.5 + a.unstable);
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
   * Before the arc burns: a mark on the joint where the rod would land, and, while the button is held, why
   * nothing happens (off the joint, facing away, no rod...). Striking throws a few sparks as it catches.
   */
  private updateAim(dt: number): void {
    const g = this.game, b = g.player, a = b.arc;
    const atBench = this.rig.mode !== 'walk' && !this.ui.boardOpen && !this.ui.endOpen && this.started;
    let state: '' | 'ok' | 'near' | 'away' = '';
    const P = this.aimProj;
    if (atBench && this.part && b.stage === 'weld' && !a.lit && this.torch.has && b.swap <= 0) {
      nearestSeam(b, this.torch.x, this.torch.y, this.torch.z, -1, P);
      const R = BALANCE.weld.strikeRadius;
      if (P.seam >= 0 && P.dist < R * 2.6) state = !canReach(b, P.seam, P.s) ? 'away' : P.dist <= R ? 'ok' : 'near';
    }
    this.bead.setMark(state, P.seam, P.s, a.why === 'strike' ? a.strikeK : 0);
    // Sputter while the strike is coming.
    if (a.why === 'strike' && this.lmb && this.part) {
      this.strikeAcc += dt * (6 + 30 * a.strikeK);
      const n = Math.floor(this.strikeAcc);
      this.strikeAcc -= n;
      if (n) this.fx.spatter(this.lastSurf.x, this.lastSurf.y + 0.002, this.lastSurf.z, n, 0.2);
    }
    // Explain a held button that isn't welding, after a beat.
    const why = atBench && this.lmb && !this.suppress && a.why && a.why !== 'strike' ? a.why : '';
    this.whyT = why ? this.whyT + dt : 0;
    this.ui.setWhy(this.whyT > 0.2 ? why : '', this.mouse.x, this.mouse.y);
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
    // Walking: the prompt under the crosshair already says it; don't repeat it over the bench.
    this.ui.muteHint(this.rig.mode === 'walk' && this.ui.promptShown);
    if (!this.ui.hintVisible) return;
    let w: THREE.Vector3 | null = null;
    if (this.rig.mode === 'walk') {
      w = this.v3.copy(this.ws.anchors.bench);
    } else if (f.target === 'mask') {
      this.ui.hintEdge('');
      this.ui.placeHint(this.cssW / 2, this.cssH * 0.14);
      return;
    } else if ((f.target === 'seam' || f.target === 'bead') && this.part) w = this.p2w(f.x, f.y, f.z, this.v3).add(this.v3b.set(0, 0.012, 0));
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

  /** Standing in front of the bench, roughly facing it. */
  private nearBench(): boolean {
    const r = this.rig;
    return r.body.z < 1.25 && Math.abs(r.body.x) < 1.4 && Math.cos(r.walkYaw) > 0.3;
  }

  private promptFor(id: string): string {
    const g = this.game;
    if (!id || id === 'bench') return this.nearBench() ? t('act.bench') : '';
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
