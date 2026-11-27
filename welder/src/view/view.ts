import * as THREE from 'three';
import type { Game } from '../sim/game';
import type { TorchIn } from '../sim/weld';
import { emptyTorch, nearestSeam, canReach } from '../sim/weld';
import { payForSeams } from '../sim/quality';
import type { Proj } from '../sim/seam';
import { BALANCE } from '../data/balance';
import { SKIN } from '../skin/default';
import { LowRes } from './renderer';
import { makeTextures, Textures } from './textures';
import { buildWorkshop, Workshop, BENCH, TABLE, PART_ROT, PART_SPAN, figure, KEY_K, LAMP_K } from './workshop';
import { buildPart, PartMesh, HEAT_TINT, partMaterials } from './partMesh';
import { BeadView, BeadSource } from './bead';
import { Effects } from './particles';
import { Tools } from './tools';
import { CameraRig } from './camera';
import { UI } from './ui';
import { Rng } from '../core/rng';
import { t, getLang } from '../i18n';
import { seamPoint } from '../sim/seam';
import { bringLine, replyLine } from './talk';
import { settings } from '../settings';

/** Part-local units are millimetres; inside partRoot one unit of geometry is a metre. */
const MM = 0.001;
/** Things you click instead of welding on them. */
const TOOLS_OF_THE_ROOM = new Set(['pile', 'board', 'electrodes', 'door', 'done', 'craft']);
const Y_UP = new THREE.Vector3(0, 1, 0);
/** The guild master's walk round the workshop, right after joining: what each thing is, briefly. */
const TOUR: { key: string; at: [number, number, number]; glow: string }[] = [
  { key: 'bench', at: [0, TABLE + 0.1, -0.68], glow: 'bench' },
  { key: 'rods', at: [-0.12, TABLE + 0.2, -1.06], glow: 'electrodes' },
  { key: 'mask', at: [-0.86, TABLE + 0.25, -0.98], glow: '' },
  { key: 'gauge', at: [0.12, 1.12, -1.1], glow: '' },
  { key: 'jars', at: [-2.0, 0.85, 1.55], glow: '' },
  { key: 'pile', at: [-0.6, TABLE + 0.2, -0.66], glow: 'pile' },
  { key: 'craft', at: [0.58, 1.24, -1.12], glow: 'craft' },
];
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
  /** One-shot sounds the view asks for (coins landing, the ding of a clean stretch, a closed seam). */
  onSfx: (kind: 'coin' | 'ding' | 'seam' | 'stamp', v?: number, n?: number) => void = () => {};
  /** Clean chips in a row (each rings a step higher); a poor one breaks the run. */
  private chipStreak = 0;
  /** A spark that runs along a seam the moment it closes. */
  private sweeps: { seam: number; t: number; q: number }[] = [];
  /** Hit-stop: the whole game holds for a few frames on a strong moment. */
  private freezeT = 0;
  /** The customer stays at the door a moment after taking the job (to say their word), and nods or shakes their head. */
  private custLinger = 0;
  private custAnim = { t: -1, good: true };
  /** Coins flying from the bench into the pot after a hand-over; the counter rises as they land. */
  private coins: { m: THREE.Mesh; t: number; d: number; a: THREE.Vector3; b: THREE.Vector3; v: number }[] = [];
  private coinPool: THREE.Mesh[] = [];
  private moneyShown = 0;
  private moneyTarget = -1;
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
  /** Step of the workshop tour (-1 = none). */
  private tour = -1;
  private stagesT = 0;
  private modalCursor = false;
  private leanT = 0;
  private leanAt = new THREE.Vector3();
  private zoomP = new THREE.Vector3();
  private whyT = 0;
  private v3q = new THREE.Quaternion();
  private strayAcc = 0;
  private followK = 1;
  private strayP = new THREE.Vector3();
  private strayNrm = new THREE.Vector3();
  private strayQ = new THREE.Quaternion();
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
  private lastTurn = false;
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
    const coinGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.004, 10);
    const coinMat = new THREE.MeshLambertMaterial({ color: '#e8c060', emissive: '#7a5200' });
    for (let i = 0; i < 20; i++) {
      const m = new THREE.Mesh(coinGeo, coinMat);
      m.visible = false;
      this.ws.scene.add(m);
      this.coinPool.push(m);
    }
    this.moneyShown = game.money;
    this.ui = new UI(uiRoot, game);
    this.ui.onTake = (uid) => game.queue({ type: 'takeOrder', uid });
    this.ui.onBuy = (id) => game.queue({ type: 'buy', id });
    this.ui.onCraftBtn = () => this.toggleCraft();
    this.ui.onTourNext = () => this.tourNext();
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
        // Notches: a mouse wheel gives one per event, a touchpad many small deltas.
        let notches = 0;
        if (e.deltaMode === 1 || Math.abs(e.deltaY) >= 50) notches = -Math.sign(e.deltaY);
        else {
          this.wheelAcc += e.deltaY;
          while (Math.abs(this.wheelAcc) >= 40) {
            notches += -Math.sign(this.wheelAcc);
            this.wheelAcc -= Math.sign(this.wheelAcc) * 40;
          }
        }
        if (!notches) return;
        // While the arc burns the wheel feeds the rod; otherwise it zooms on the point under the cursor.
        if (this.game.player.arc.lit) this.dL += notches * BALANCE.arc.wheelStep;
        else if (this.rig.mode === 'station') this.rig.zoomAt(this.cursorPoint(), notches);
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
      } else if (this.tour >= 0 && (e.code === 'Enter' || e.code === 'KeyE') && !e.repeat) this.tourNext();
      else if (e.code === 'KeyR') this.game.queue({ type: 'newElectrode' });
      else if (e.code === 'KeyU' && !e.repeat) this.toggleCraft();
      else if (e.code === 'Backquote' && !e.repeat) this.ui.toggleDebug();
      else if (e.code === 'KeyE' && !e.repeat) {
        if (this.ui.craftOpen) this.ui.closeCraft();
        else if (this.ui.jobOpen) this.ui.closeJob();
        else if (this.ui.boardOpen) this.ui.closeBoard();
        else if (this.rig.mode === 'station' || this.rig.mode === 'inspect') this.leaveBench();
        else if (this.rig.mode === 'walk') this.interact();
      } else if (e.code === 'Escape' && this.ui.settingsOpen) this.ui.closeSettings();
      else if (e.code === 'Escape' && this.tour >= 0) this.endTour();
      else if (e.code === 'Escape' && this.ui.craftOpen) this.ui.closeCraft();
      else if (e.code === 'Escape' && this.ui.jobOpen) this.ui.closeJob();
      else if (e.code === 'Escape' && this.ui.boardOpen) this.ui.closeBoard();
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
        this.offerPile(() => this.toBench());
      } else if (g.flags.board) {
        this.unlockPointer();
        this.ui.openBoard();
      } else this.toBench();
    } else if (id === 'board' && g.flags.board) {
      this.unlockPointer();
      this.ui.openBoard();
    } else if (id.startsWith('shelf:') || id === 'craft') this.openCraft();
    else if (id === 'door') g.queue({ type: 'handOver' });
    else if (id === 'bench' || id === 'part' || id === 'done' || id === 'electrodes') this.toBench();
  }

  // ------------------------------------------------------------------ juice

  /** The showcase before the first shift: a master's hand at work, no hints, no words from the door. */
  showcase = false;

  /** Where the master's hand holds the rod this frame (part-local mm and the welding direction there). */
  showDrive(tr: TorchIn, n: { x: number; y: number; z: number }): void {
    const t = this.torch;
    t.has = tr.has && !!this.part;
    t.press = tr.press;
    if (!t.has) return;
    t.x = tr.x;
    t.y = tr.y;
    t.z = tr.z;
    this.partRoot.updateMatrixWorld();
    this.p2w(tr.x, tr.y, tr.z, this.surfW);
    this.normW.set(n.x, n.y, n.z).transformDirection(this.partRoot.matrixWorld);
  }

  /** The showcase is over: the bench cleared for the real shift (the sim has been reset under it). */
  endShowcase(): void {
    this.showcase = false;
    this.clearPart();
    this.ui.say('', 0);
    this.ui.clearStamp();
    this.ui.setGauges(null, null, 0, 0);
    this.chipStreak = 0;
    this.sweeps.length = 0;
    this.custLinger = 0;
    this.ws.customer.visible = false;
    this.torch.has = false;
    this.rig.station();
    this.ui.muteHint(false);
    this.ui.setApprentice('');
    this.ui.setWorkers('');
    this.syncWorld();
    this.syncPile();
    this.moneyShown = 0;
    this.ui.showMoney(0);
    this.ws.setMoney(0);
    this.ui.updateStages();
    this.ui.setRod(false, 1, false);
  }

  /** Nothing in hand and nothing open: a moment the story can take the screen without cutting anything off. */
  calm(): boolean {
    const g = this.game;
    return this.started && !g.player.arc.lit && !this.lmb && !this.ui.modal && !this.ui.endOpen && !this.coins.length && this.tour < 0 && this.freezeT <= 0;
  }

  /** Forget held keys and buttons (something else took the input for a while). */
  releaseInput(): void {
    this.held.clear();
    this.lmb = false;
    this.latch = false;
  }

  freeze(s: number): void {
    this.freezeT = Math.max(this.freezeT, s);
  }

  /** True while the game should hold still this frame (the main loop then skips the sim and the render). */
  consumeFreeze(dt: number): boolean {
    if (this.freezeT <= 0) return false;
    this.freezeT -= dt;
    return true;
  }

  private toScreen(w: THREE.Vector3): [number, number] | null {
    const p = this.v3b.copy(w).project(this.rig.cam);
    if (p.z > 1) return null;
    return [(p.x * 0.5 + 0.5) * this.cssW, (-p.y * 0.5 + 0.5) * this.cssH];
  }

  /** Pay flies from the bench into the pot, a coin at a time. */
  private flyCoins(pay: number): void {
    const n = Math.max(3, Math.min(this.coinPool.length, pay));
    const from = this.v3.copy(BENCH).add(this.v3b.set(0, 0.06, 0));
    const to = new THREE.Vector3(-0.5, BENCH.y + 0.1, -1.0);
    this.coins.length = 0;
    for (let i = 0; i < n; i++) {
      const m = this.coinPool[i];
      const a = from.clone().add(new THREE.Vector3(this.rng.signed() * 0.05, 0, this.rng.signed() * 0.03));
      this.coins.push({ m, t: -i * 0.06, d: 0.5 + this.rng.next() * 0.12, a, b: to.clone(), v: pay / n });
    }
    this.moneyTarget = -1;
  }

  private updateCoins(dt: number): void {
    if (!this.coins.length) return;
    let flying = 0;
    for (const c of this.coins) {
      if (c.t >= c.d) continue;
      c.t += dt;
      if (c.t < 0) {
        c.m.visible = false;
        flying++;
        continue;
      }
      const k = Math.min(1, c.t / c.d);
      c.m.visible = k < 1;
      c.m.position.copy(c.a).lerp(c.b, k);
      c.m.position.y += Math.sin(Math.PI * k) * 0.22;
      c.m.rotation.set(c.t * 14, c.t * 9, 0);
      if (k >= 1) {
        this.moneyShown += c.v;
        const shown = this.moneyTarget >= 0 ? Math.min(this.moneyTarget, Math.round(this.moneyShown)) : Math.round(this.moneyShown);
        this.ui.showMoney(shown, true);
        this.onSfx('coin');
      } else flying++;
    }
    if (!flying) {
      this.coins.length = 0;
      const target = this.moneyTarget >= 0 ? this.moneyTarget : this.game.money;
      this.moneyShown = target;
      this.moneyTarget = -1;
      this.ui.showMoney(target, true);
      this.ws.setMoney(target);
    }
  }

  // ------------------------------------------------------------------ craft book & tour

  private openCraft(): void {
    if (!this.game.flags.shelf) return;
    this.unlockPointer();
    this.ui.closeBoard();
    this.ui.closeJob();
    this.ui.openCraft();
  }

  private toggleCraft(): void {
    if (this.ui.craftOpen) this.ui.closeCraft();
    else if (this.tour < 0) this.openCraft();
  }

  private startTour(): void {
    if (this.rig.mode === 'walk') this.toBench();
    this.tour = 0;
    this.applyFocus();
  }

  private tourNext(): void {
    if (this.tour < 0) return;
    this.tour++;
    if (this.tour >= TOUR.length) this.endTour();
    else this.applyFocus();
  }

  private endTour(): void {
    this.tour = -1;
    this.ui.setTour('', 0, 0, false);
    this.rig.station();
    this.applyFocus();
  }

  /** While touring: the head turns to each thing in turn, and its label sits on it. */
  private updateTour(): void {
    if (this.tour < 0) return;
    const st = TOUR[this.tour];
    const p = this.v3.set(st.at[0], st.at[1], st.at[2]);
    this.rig.inspect(p, st.key === 'jars' ? 46 : 40);
    p.project(this.rig.cam);
    const x = Math.max(0.12, Math.min(0.88, p.x * 0.5 + 0.5)) * this.cssW;
    const y = Math.max(0.2, Math.min(0.9, -p.y * 0.5 + 0.5)) * this.cssH - 10 * this.scale;
    this.ui.setTour(t('tour.' + st.key), x, y, this.tour === TOUR.length - 1);
  }

  /** Show the job on top of the heap; taking it puts it on the bench. */
  private offerPile(after?: () => void): void {
    const g = this.game;
    if (!g.pile) return;
    // The very first job, before the guild: no paperwork, straight to the bench.
    if (!g.owned.guild) {
      g.queue({ type: 'takePile' });
      after?.();
      return;
    }
    this.unlockPointer();
    this.ui.hideTip();
    this.ui.showJob(g.pile, () => {
      g.queue({ type: 'takePile' });
      after?.();
    });
  }

  private onClick(): void {
    const g = this.game;
    if (this.tour >= 0) {
      this.suppress = true;
      this.tourNext();
      return;
    }
    if (this.ui.modal || this.ui.endOpen) return;
    const id = this.pick();
    const b = g.player;
    if (TOOLS_OF_THE_ROOM.has(id) || id.startsWith('shelf:')) {
      this.suppress = true;
      if (id === 'pile') {
        if (g.pile && b.stage === 'empty') this.offerPile();
        else if (g.flags.board) this.ui.openBoard();
      } else if (id === 'board' && g.flags.board) {
        this.ui.openBoard();
        this.ui.hideTip();
      } else if (id.startsWith('shelf:') || id === 'craft') this.openCraft();
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
      this.offerPile();
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

  /** The world point under the cursor at the bench (the job, or anything else in the room), for zooming. */
  private cursorPoint(): THREE.Vector3 | null {
    if (!this.mouse.in) return null;
    this.setRay();
    this.hits.length = 0;
    const objs = this.pickList;
    objs.length = 0;
    if (this.part) objs.push(...this.part.meshes);
    for (const o of this.ws.pickables) if (o.visible) objs.push(o);
    const h = this.ray.intersectObjects(objs, true, this.hits);
    if (h.length) return this.zoomP.copy(h[0].point);
    this.plane.set(Y_UP, -BENCH.y);
    return this.ray.ray.intersectPlane(this.plane, this.zoomP);
  }

  /** Input for one frame; the arc-length request is handed to the first sim step only. */
  frameInput(dt: number): TorchIn {
    const tr = this.torch;
    const active = this.started && !this.ui.modal && !this.ui.endOpen && this.tour < 0 && (this.rig.mode === 'station' || this.rig.mode === 'inspect');
    if (active) {
      this.aimOnPart(tr);
    } else tr.has = false;
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
      this.ui.renderCraft();
      // Pay for a job arrives with the coins; the counter catches up as they land in the pot.
      if (this.coins.length && e.delta > 0) {
        this.moneyTarget = e.money;
        return;
      }
      this.moneyShown = e.money;
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
    this.ui.onSkip = (seam) => this.game.queue({ type: 'skip', seam });
    this.ui.onUpWorker = (i) => this.game.queue({ type: 'upWorker', i });
    this.ui.onDebugMoney = (n) => {
      g.devMoney(n);
      this.ui.renderCraft();
    };
    this.ui.onDebugLevel = (lv) => {
      g.devLevel(lv);
      this.ui.showMoney(g.money);
      this.syncWorld();
      this.ui.renderCraft();
      this.ui.toast(t('dbg.done', { n: lv }));
    };
    b.on('bought', (e) => {
      this.syncWorld();
      this.ui.renderCraft();
      if (e.id === 'guild') {
        this.ui.closeCraft();
        this.startTour();
      }
    });
    b.on('beat', (e) => {
      this.syncWorld();
      this.ui.beat(t('beat.' + e.id));
    });
    b.on('electrodeNew', () => this.ws.setRods(12 - (g.log.electrodes % 12)));
    b.on('orderTaken', (e) => {
      if (e.bench !== 'player') return;
      this.setPart(e.part);
      this.bead.attach(g.player, this.snapToPart);
      this.chipStreak = 0;
      this.sweeps.length = 0;
      // The job lands on the bench: a thump and a puff of the bench's dust round its foot.
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        this.fx.slag(BENCH.x + Math.cos(a) * 0.12, BENCH.y + 0.01, BENCH.z + Math.sin(a) * 0.09, 1.5);
      }
      this.setCustomer(g.player.order?.customer ?? 'neighbour');
      if (g.player.order && !this.showcase) this.ui.say(bringLine(g, g.player.order), 5, t('cust.' + g.player.order.customer));
      this.custLinger = 0;
      this.ui.closeBoard();
      this.syncWorld();
    });
    b.on('handedOver', (e) => {
      if (e.bench === 'player') {
        this.flyCoins(e.pay);
        this.ui.toast(`+${e.pay} ◆  ${t('part.' + e.part)}` + (e.reqMet ? '' : ' · ' + t('pay.reqFail')));
        const o = g.player.order;
        if (o && !o.urgent) {
          this.ui.say(replyLine(o.customer, e.grade), 3.6, t('cust.' + o.customer));
          this.custLinger = 3.6;
          this.custAnim = { t: 0, good: e.grade === 'clean' || e.grade === 'fair' };
        } else this.ws.customer.visible = false;
        if (!g.showEnd) {
          this.clearPart();
          this.rig.station();
        }
      } else if (e.bench === 'worker') this.ui.toast(`+${e.pay} ◆  ${t('work.done', { part: t('part.' + e.part), grade: t('grade.' + e.grade) })}`);
      else this.ui.toast(`+${e.pay} ◆  ${t('app.done', { grade: t('grade.' + e.grade) })}`);
      this.syncWorld();
    });
    b.on('revealed', (e) => {
      if (e.bench !== 'player') return;
      const line = [e.holes ? `${t('end.holes')}: ${e.holes}` : '', e.pores ? t('stamp.pores', { n: e.pores }) : ''].filter(Boolean).join(' · ');
      const o = g.player.order;
      this.ui.stamp(e.grade, line, o ? payForSeams(g.player.seams, o.reward) : undefined, o?.reward);
      setTimeout(() => {
        this.onSfx('stamp', e.grade === 'clean' ? 1 : e.grade === 'fair' ? 0.6 : 0.2);
        if (!settings.soft) this.shakeT = Math.max(this.shakeT, 0.08);
      }, 140);
      this.inspect();
    });
    b.on('slagChip', (e) => {
      if (e.bench !== 'player') return;
      this.tools.strike();
      this.shakeT = 0.09;
      this.p2w(e.x, e.y, e.z, this.v3).addScaledVector(this.normW, 2 * MM * this.S);
      this.fx.slag(this.v3.x, this.v3.y, this.v3.z, e.amount);
      // The moment of truth: what this stretch of bead turned out to be, in money and in sound. Clean
      // stretches in a row ring higher and higher.
      this.chipStreak = e.q >= 0.8 ? this.chipStreak + 1 : 0;
      this.onSfx('ding', e.q, this.chipStreak);
      if (e.q >= 0.8) {
        this.freeze(0.04);
        this.fx.spatter(this.v3.x, this.v3.y + 0.004, this.v3.z, 6, 0.05);
      }
      const sp = this.toScreen(this.v3);
      if (sp && e.value >= 0.05) {
        const run = this.chipStreak >= 3 ? `  ×${this.chipStreak}` : '';
        this.ui.popup(`+${e.value.toFixed(1)} ◆${run}`, sp[0], sp[1], (e.q >= 0.8 ? '' : e.q >= 0.55 ? 'mid' : 'low') + (run ? ' streak' : ''));
      }
    });
    b.on('seamFilled', (e) => {
      if (e.bench !== 'player') return;
      // A seam closed: a beat of stillness, a chime, and its mark over the bead.
      this.freeze(0.08);
      this.onSfx('seam');
      const sr = g.player.seams[e.seam];
      if (!sr) return;
      this.sweeps.push({ seam: e.seam, t: 0, q: e.quality });
      sr.pointAt(sr.len / 2, this.pt);
      const sp = this.toScreen(this.p2w(this.pt.x, this.pt.y, this.pt.z, this.v3d));
      if (sp) this.ui.popup(`${t('pop.seam')} ${Math.round(e.quality * 100)}%`, sp[0], sp[1] - 8 * this.scale, 'big');
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
      this.freeze(0.045);
    });
    b.on('apprentice', (e) => {
      this.syncWorld();
      this.ui.setApprentice(g.owned.apprentice && !this.showcase ? t('app.' + e.state) : '');
    });
    b.on('worker', () => this.showWorkers());
    b.on('wages', (e) => {
      this.ui.toast(e.paid ? t('work.paid', { n: e.amount }) : t('work.unpaid', { n: e.amount }));
      this.showWorkers();
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
    this.rig.resetZoom();
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
  /**
   * Where the mask is drawn (0 up, 1 over the face). It falls like a hood flipped down off the forehead:
   * gathering speed, landing with a small bounce and a knock you feel in the picture; lifted, it swings up
   * quickly and slows at the top. The sim's own (faster) value is what protects the eyes.
   */
  private maskVisual(dt: number, down: boolean): number {
    if (down) {
      if (this.maskX < 1 || this.maskV !== 0) {
        if (this.maskX <= 0 && this.maskV <= 0) this.maskV = 1.6;
        this.maskV += 17 * dt;
        this.maskX += this.maskV * dt;
        if (this.maskX >= 1 && this.maskV > 0) {
          this.maskX = 1;
          if (this.maskV > 1) {
            if (!this.maskHit) this.shakeT = Math.max(this.shakeT, 0.07);
            this.maskHit = true;
            this.maskV = -this.maskV * 0.2;
          } else this.maskV = 0;
        }
      }
    } else {
      this.maskHit = false;
      this.maskV = 0;
      this.maskX = Math.max(0, this.maskX - dt * (2.2 + 6 * this.maskX));
    }
    return this.maskX;
  }
  private maskX = 0;
  private maskV = 0;
  private maskHit = false;

  /** Title and lines for the note on a thing at the bench, or null for things that have none. */
  private infoFor(id: string): [string, string[]] | null {
    const g = this.game, b = g.player;
    switch (id) {
      case 'part': {
        if (!b.order) return null;
        if (b.stage === 'ready') return [t('tip.ready'), [this.ui.readyLine()]];
        return null;
      }
      case 'electrodes':
        return [t(g.owned.coated ? 'info.rods.coated' : 'info.rods.bare'), [`${t('rod.label')} ${Math.round(b.electrode * 100)}%`]];
      case 'gauge': {
        const a = Math.round(g.power.I * 110);
        const low = g.power.I < g.stats.stableI;
        return [t('info.gauge'), [`${a} A${low ? ' · ' + t('info.gauge.low') : ''}`]];
      }
      case 'pile':
        return g.pile ? [t('part.' + g.pile.part), [`${t('cust.' + g.pile.customer)}`, `◆ ${g.pile.reward}`]] : null;
      case 'board':
        return g.flags.board ? [t('info.boardT'), [t('info.board', { n: g.board.length })]] : null;
      case 'done':
        return [t('info.done'), [t('info.doneN', { n: g.ordersDone })]];
      case 'craft':
        return g.flags.shelf ? [t('info.craftT'), [`◆ ${g.money}`]] : null;
      case 'own:jar':
        return [t('up.jar.name'), []];
      case 'own:cable':
        return [t('up.cable.name'), []];
    }
    return null;
  }

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
    const f = figure(look, { skin: old.userData.skin as THREE.Material });
    f.position.copy(old.position);
    f.rotation.copy(old.rotation);
    f.traverse((o) => (o.userData.pick = 'door'));
    this.ws.scene.remove(old);
    this.ws.scene.add(f);
    const i = this.ws.pickables.indexOf(old);
    if (i >= 0) this.ws.pickables[i] = f;
    this.ws.customer = f;
  }

  /** The closing spark runs the length of the seam in a blink, brighter on a good one. */
  private updateSweeps(dt: number): void {
    const b = this.game.player;
    for (let i = this.sweeps.length - 1; i >= 0; i--) {
      const w = this.sweeps[i];
      const sr = b.seams[w.seam];
      const t0 = w.t;
      w.t += dt;
      const T = 0.45;
      if (!sr || t0 >= T) {
        this.sweeps.splice(i, 1);
        continue;
      }
      const s = Math.min(1, w.t / T) * sr.len;
      sr.pointAt(s, this.pt);
      this.p2w(this.pt.x, this.pt.y, this.pt.z, this.v3).addScaledVector(this.normW, 2 * MM * this.S);
      const n = settings.soft ? 1 : w.q >= 0.8 ? 3 : 2;
      this.fx.spatter(this.v3.x, this.v3.y, this.v3.z, n, 0);
    }
  }

  /** The line under the corner buttons: the hired hands, what they cost a minute, whether they are paid. */
  private showWorkers(): void {
    const g = this.game;
    const n = g.workers.length;
    if (!n || this.showcase) return this.ui.setWorkers('');
    const busy = g.workers.filter((w) => w.state !== 'idle').length;
    this.ui.setWorkers(g.unpaid ? t('work.stopped', { n: g.wages() }) : t('work.status', { n, busy, w: g.wages() }));
  }

  /** A bow for good work, a slow shake of the head for bad; the slip with their words stays over their head. */
  private animateCustomer(dt: number): void {
    const c = this.ws.customer;
    const a = this.custAnim;
    c.rotation.x = 0;
    if (a.t >= 0) {
      a.t += dt;
      const k = a.t;
      if (a.good) c.rotation.x = k < 1.1 ? 0.16 * Math.max(0, Math.sin((k / 0.55) * Math.PI)) : 0;
      else c.rotation.y = (c.userData.ry ?? c.rotation.y) + (k < 1.4 ? 0.22 * Math.sin(k * 11) * (1 - k / 1.4) : 0);
      if (k > 1.6) a.t = -1;
    }
    c.userData.ry ??= c.rotation.y;
    if (!this.ui.saying) return;
    const head = this.v3d.copy(c.position);
    head.y += 1.95;
    const sp = c.visible ? this.toScreen(head) : null;
    // Over their head when they are in sight; otherwise from the door, at the top of the picture.
    const seen = !!sp && sp[0] > this.cssW * 0.25 && sp[0] < this.cssW * 0.75 && sp[1] > this.cssH * 0.12 && sp[1] < this.cssH * 0.7;
    const x = seen ? sp![0] : this.cssW / 2;
    const y = seen ? sp![1] : this.cssH * 0.14;
    this.ui.placeSay(x, y);
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
    // The craft button glows when there is something new to do in it: the guild at first, the first new bench after the gate.
    this.ui.setCraftButton(!!g.flags.shelf, (!!g.flags.shelf && !g.owned.guild) || (!!g.flags.season2 && !g.owned.hire1 && g.money >= 25));
    for (const u of g.data.upgrades) {
      const owned = !!g.owned[u.id];
      const si = this.ws.shelfItems[u.id];
      if (si) si.visible = !!g.flags.shelf && !!g.owned.guild && !owned;
      const o = this.ws.ownedItems[u.id];
      if (o) o.visible = owned;
    }
    this.ws.wheel2.visible = !!g.owned.wheel2;
    this.ws.apprentice.visible = !!g.owned.apprentice;
    // The annex grows a room with every hand hired; each bench shows what its level has put on it.
    this.ws.setAnnex(g.workers.length);
    this.ws.extra.forEach((e, i) => {
      const w = g.workers.find((x) => x.i === i);
      e.hand.visible = !!w;
      e.levels.forEach((o, k) => (o.visible = !!w && k < w.lvl));
    });
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
    const key = this.tour >= 0 ? TOUR[this.tour].glow : f.target === 'shelf' ? 'craft' : f.target === 'door' ? 'done' : f.target;
    for (const k in this.ws.hiMats) {
      const on = k === key || k === this.hover;
      for (const m of this.ws.hiMats[k]) m.emissive.set(on ? '#3a2a1a' : '#000000');
    }
    let hint = f.hint && this.tour < 0 ? t('hint.' + f.hint) : '';
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
    this.rig.turnable = !this.lmb && !a.lit && !this.ui.modal;
    if (this.mouse.in && this.rig.mode !== 'walk') {
      // The head drifts after the cursor, but holds still while the arc burns or the mask is down (aiming).
      const still = g.player.arc.lit || g.mask.down || this.lmb;
      this.followK += ((still ? 0 : 1) - this.followK) * Math.min(1, dt * 3);
      this.rig.setNudge((this.mouse.x / this.cssW) * 2 - 1, 1 - (this.mouse.y / this.cssH) * 2, this.followK);
    }
    if (this.rig.mode === 'walk' && !this.ui.modal) {
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
    if (this.lastMask !== g.mask.down || this.lastStage !== b.stage || this.lastCam !== this.rig.mode || this.lastTurn !== g.autoTurn) {
      this.lastTurn = g.autoTurn;
      this.lastMask = g.mask.down;
      this.lastStage = b.stage;
      this.lastCam = this.rig.mode;
      this.applyFocus();
      this.ui.setCtrl(!this.started ? '' : this.rig.mode === 'walk' ? 'walk' : 'bench', g.mask.down);
    }

    // Hover: highlight and the shelf tooltip.
    const canHover = this.started && !this.ui.modal && !this.ui.endOpen;
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
    // A finished job under the cursor says so.
    // A note on the thing under the cursor at the bench (not while the arc burns or the mask is down).
    const info = canHover && this.rig.mode !== 'walk' && !g.player.arc.lit && !g.mask.down ? this.infoFor(this.hover) : null;
    if (info) this.ui.showInfo(info[0], info[1], this.mouse.x, this.mouse.y + 10 * this.scale);
    else if (this.ui.infoShown) this.ui.hideTip();

    // Lights and the world outside.
    const I = g.power.I;
    const dark = g.clock.dark;
    // Air: dust drifting in the beams, steam off the kettle on the stove.
    this.ws.tickAir(g.t);
    this.fx.steam(-1.4, 0.96, 2.08, dt, 1.2);
    // The stove's fire breathes.
    {
      const tt = g.t;
      const fl = 0.82 + 0.12 * Math.sin(tt * 7.3) * Math.sin(tt * 3.1 + 1) + 0.08 * r.next();
      this.ws.lights.stove.intensity = L.stove.intensity * fl;
      this.ws.lights.fire.color.setRGB(3 * fl, 1.15 * fl * fl, 0.25 * fl);
    }
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
    // A made thing from before breathes a cold light of its own.
    const relic = partMaterials(this.tx).relic as THREE.MeshLambertMaterial;
    relic.emissiveIntensity = 0.55 + 0.3 * Math.sin(performance.now() / 1000 * 1.7) * Math.sin(performance.now() / 1000 * 0.53 + 1);
    this.updateSweeps(dt);
    this.custLinger = Math.max(0, this.custLinger - dt);
    this.ws.customer.visible = b.stage !== 'empty' || this.custLinger > 0;
    this.animateCustomer(dt);

    // The job, the hands and the arc.
    this.placePart(dt);
    this.bead.update(dt);
    // Heat tint on the work round the bead (drawn by the part's material).
    this.bead.group.updateMatrixWorld();
    HEAT_TINT.uTintN.value = this.part ? this.bead.heatPoints(HEAT_TINT.uTintP.value) : 0;
    HEAT_TINT.uTintR.value = 10 * MM * this.S;
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
    if (this.part && stage === 'weld') this.tools.placeHolder(tip, this.rig.cam, b.swap > 0 ? 0 : b.electrode, this.torch.has ? this.normW : undefined);
    else this.tools.placeHolder(this.restTip, this.rig.cam, b.electrode);
    if (chipping) this.tools.placeHammer(tip, this.rig.cam, dt, this.torch.has ? this.normW : undefined);
    if (this.part) this.tools.placeLeft(this.grip, this.rig.cam);
    // Nothing on the bench: the left hand rests on it, tongs in hand.
    else this.tools.placeLeft(this.restLeft, this.rig.cam);

    const lit = a.lit && !!this.part && stage === 'weld';
    this.tools.arcGlow.visible = lit;
    this.tools.arcStar.visible = lit;
    this.tools.bolt.visible = lit;
    this.tools.pool.visible = false;
    this.bead.setPool(lit && a.onSeam, a.seam, a.s, a.d, a.pool, a.dir, 0.85 + 0.3 * r.next());
    // The arc off the joint still melts the rod: drops fall where it burns, on any part of the work.
    if (lit && !a.onSeam && this.torch.has) {
      this.strayAcc += dt;
      if (this.strayAcc >= 0.07) {
        this.strayAcc = 0;
        const p = this.w2p(this.surfW, this.strayP);
        this.partRoot.getWorldQuaternion(this.strayQ);
        const n = this.strayNrm.copy(this.normW).applyQuaternion(this.strayQ.invert()).normalize();
        this.bead.addStray(p, n, 2.4 + 1.4 * r.next());
      }
    } else this.strayAcc = 0.07;
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
    // A glint runs along the joint to weld next while nothing is burning.
    const gf = g.guide;
    this.bead.setGlint(this.part && b.stage === 'weld' && !lit && gf.target === 'seam' && this.rig.mode !== 'walk' ? gf.seam : -1, dt);
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
      // Just off the surface along its normal, so it floods the part, the rod and the glove.
      arcLight.position.set(mid.x + r.signed() * jit, mid.y, mid.z + r.signed() * jit).addScaledVector(this.normW, 0.018);
      // Through the welding glass the light the arc throws on the work is cut far more than the arc and the
      // white-hot pool themselves (that is the glass's job): the lit plate stays dim, the pool reads.
      arcLight.intensity = L.arc.intensity * k * (1 - 0.85 * Math.min(1, this.maskX));
      arcOn = k;
      this.tools.arcGlow.position.copy(mid);
      this.tools.arcGlow.quaternion.copy(this.rig.cam.quaternion);
      const sz = (6 + a.L * 1.8) * MM * S * (0.8 + 0.4 * r.next());
      this.tools.arcGlow.scale.set(sz, sz, sz);
      this.tools.arcStar.position.copy(this.tools.arcGlow.position);
      this.tools.arcStar.quaternion.copy(this.rig.cam.quaternion);
      const ss = (0.14 + 0.07 * r.next()) * k;
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

    // Apprentice corner, with the bar over his bench.
    this.ws.appFill.scale.x = Math.max(0.001, g.appProgress());
    this.ws.appFill.parent!.lookAt(this.rig.cam.position);
    this.ws.appFill.parent!.visible = !!g.owned.apprentice && g.appState !== 'idle' && g.appState !== 'watching' && g.appState !== 'away';
    const ap = this.ws.lights.appArc;
    if (g.app.arc.lit) {
      ap.intensity = L.appArc.intensity * (0.5 + r.next());
      this.appSparkAcc += dt * 18;
      const n = Math.floor(this.appSparkAcc);
      this.appSparkAcc -= n;
      if (n) this.fx.spatter(ap.position.x + r.signed() * 0.02, 0.83, ap.position.z, n, 0.2);
    } else ap.intensity = 0;

    // The hired hands' benches: the arc, the job on the bench, the bar of how far it is.
    for (const w of g.workers) {
      const e = this.ws.extra[w.i];
      if (!e) continue;
      const part = w.bench.order?.part ?? '';
      if (e.slot.userData.part !== part) {
        e.slot.userData.part = part;
        e.slot.clear();
        if (part) {
          const def = g.data.parts[part];
          const pm = buildPart(def, this.tx);
          const k = 0.0009;
          pm.group.scale.setScalar(k);
          const rr = def.rest ?? [0, 0, 0];
          pm.group.rotation.set((rr[0] * Math.PI) / 180, (rr[1] * Math.PI) / 180, (rr[2] * Math.PI) / 180);
          e.slot.add(pm.group);
        }
      }
      const pg = g.workProgress(w);
      e.fill.scale.x = Math.max(0.001, pg);
      e.fill.visible = w.state !== 'idle';
      // The bar always turns its face to you.
      e.fill.parent!.lookAt(this.rig.cam.position);
      if (w.bench.arc.lit) {
        e.light.intensity = L.appArc.intensity * (0.5 + r.next());
        if (r.chance(dt * 16)) this.fx.spatter(e.spark.x, e.spark.y, e.spark.z + r.signed() * 0.03, 1 + r.int(0, 2), 0.2);
      } else e.light.intensity = 0;
    }

    this.fx.update(dt, this.floorAt, arcOn);

    // Post: mask, glare, afterimage, shake.
    const u = this.lr.u;
    u.uMaskPos.value = this.maskVisual(dt, g.mask.down);
    u.uMaskT.value = g.stats.maskTransmission;
    u.uMaskSee.value = g.stats.maskSee;
    u.uMaskWindow.value = g.stats.maskWindow;
    u.uMaskWear.value = g.stats.maskWear;
    // Softer flashes: the glare and the shake kept low (the settings).
    u.uGlare.value = g.glare * (settings.soft ? 0.4 : 1);
    u.uArcOn.value = arcOn;
    if (lit) {
      this.v3.copy(this.tools.arcGlow.position).project(this.rig.cam);
      u.uArcUv.value.set(this.v3.x * 0.5 + 0.5, this.v3.y * 0.5 + 0.5);
    }
    // After the arc's screen position is known, or the first stain lands in the middle of the screen.
    this.updateSpots(dt, lit && g.mask.pos < 0.5);
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      if (settings.soft) u.uShake.value.set(0, 0);
      else u.uShake.value.set(r.int(-1, 1), r.int(-1, 1));
    } else u.uShake.value.set(0, 0);
    u.uFade.value = this.started ? Math.max(0, u.uFade.value - dt * 1.5) : 0.35;

    this.lr.render(this.ws.scene, this.rig.cam);
    this.placeOverlay();
    this.updateTour();
    this.updateCoins(dt);
    // Gauges by the holder, for what you have learned to read.
    if (lit && this.rig.mode !== 'walk') {
      const A = BALANCE.arc;
      const arcK = g.stats.knowArc ? 0.33 + ((a.L - A.goodLo) / (A.goodHi - A.goodLo)) * 0.34 : null;
      const vI = g.idealSpeed(b);
      const spK = g.stats.knowTempo ? 0.33 + ((a.v / Math.max(0.1, vI) - 0.75) / 0.55) * 0.34 : null;
      // The gauges sit by the holder: at the cursor, or (the master's hand in the showcase) by the rod.
      const gp = this.showcase ? this.toScreen(this.lastPartTip) : null;
      this.ui.setGauges(arcK, spK, gp ? gp[0] + 40 * this.scale : this.mouse.x, gp ? gp[1] : this.mouse.y);
    } else this.ui.setGauges(null, null, 0, 0);
    this.stagesT -= dt;
    if (this.stagesT <= 0) {
      this.stagesT = 0.12;
      this.ui.updateStages();
      this.ui.setRod(this.started && !!this.part && (b.stage === 'weld'), b.electrode, b.swap > 0);
    }
    this.ui.update(dt);
  }

  /**
   * Before the arc burns: a mark on the joint where the rod would land, and, while the button is held, why
   * nothing happens (off the joint, facing away, no rod...). Striking throws a few sparks as it catches.
   */
  private updateAim(dt: number): void {
    const g = this.game, b = g.player, a = b.arc;
    const atBench = this.rig.mode !== 'walk' && !this.ui.modal && !this.ui.endOpen && this.started;
    let state: '' | 'ok' | 'near' | 'away' | 'chip' = '';
    const P = this.aimProj;
    if (atBench && this.part && b.stage === 'weld' && !a.lit && this.torch.has && b.swap <= 0) {
      nearestSeam(b, this.torch.x, this.torch.y, this.torch.z, -1, P, true);
      if (P.seam < 0 || P.dist > BALANCE.weld.strikeRadius * 2.6) nearestSeam(b, this.torch.x, this.torch.y, this.torch.z, -1, P);
      const R = BALANCE.weld.strikeRadius;
      if (P.seam >= 0 && P.dist < R * 2.6) state = !canReach(b, P.seam, P.s) ? 'away' : P.dist <= R ? 'ok' : 'near';
    }
    // Chipping: the hammer's mark sits on the nearest slag under the cursor.
    if (atBench && this.part && b.stage === 'chip' && this.torch.has) {
      nearestSeam(b, this.torch.x, this.torch.y, this.torch.z, -1, P);
      const sr = P.seam >= 0 ? b.seams[P.seam] : null;
      if (sr && P.dist <= BALANCE.chip.radius * 1.6 && sr.slag[sr.cellAt(P.s)] > 0) state = 'chip';
    }
    // One screen pixel of the low-res picture, in the part's millimetres, at the mark.
    let pxMM = 0;
    if (state && this.torch.has) {
      const cam = this.rig.cam;
      const dist = cam.position.distanceTo(this.surfW);
      pxMM = (dist * 2 * Math.tan((cam.fov * Math.PI) / 360)) / 240 / (0.001 * this.S);
    }
    this.bead.setMark(state, P.seam, P.s, a.why === 'strike' ? a.strikeK : 0, P.d, pxMM);
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
    const modal = !this.started || this.ui.modal || this.ui.endOpen;
    if (modal !== this.modalCursor) {
      this.modalCursor = modal;
      document.body.classList.toggle('ui-modal', modal);
    }
    const f = g.guide;
    const overJob = !!this.part && this.torch.has && (this.hover === 'part' || this.hover === 'bench' || this.hover === '') && g.player.stage === 'weld';
    if (this.rig.mode === 'walk') this.ui.placeCursor(this.cssW / 2, this.cssH / 2, this.started && !this.ui.modal);
    else this.ui.placeCursor(this.mouse.x, this.mouse.y, this.started && this.mouse.in && !this.ui.modal && !overJob);
    this.ui.placePrompt(this.cssW / 2, this.cssH / 2 + 12 * this.scale);
    // Walking: the prompt under the crosshair already says it; don't repeat it over the bench.
    this.ui.muteHint(this.rig.mode === 'walk' && this.ui.promptShown);
    if (!this.ui.hintVisible) return;
    let w: THREE.Vector3 | null = null;
    if (this.rig.mode === 'walk') {
      w = this.v3.copy(this.ws.anchors.bench);
    } else if (f.target === 'mask') {
      this.ui.hintEdge('');
      this.ui.hintBelow(false);
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
    // The label sits above its point; near the top edge it would leave the picture, so it hangs below,
    // clear of what it points at (things up there are signs and shelves, a hand wide).
    const below = w.y > 0.6;
    this.ui.hintBelow(below);
    this.ui.placeHint((w.x * 0.5 + 0.5) * this.cssW, (-w.y * 0.5 + 0.5) * this.cssH + (below ? 14 : -4) * this.scale);
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
    if (id.startsWith('shelf:') || id === 'craft') return t('act.craft');
    if (id === 'door') return g.player.stage === 'ready' ? t('act.door') : '';
    if (id === 'bench' || id === 'part' || id === 'done' || id === 'electrodes') return t('act.bench');
    return '';
  }

  /** Repaint lettering that lives in the world (after a language change). */
  relabel(): void {
    this.ws.relabel(t('sign.shelf'));
    this.ui.relabelAll();
    this.ui.setLangButton(getLang());
    this.lastCam = '';
    this.syncWorld();
    this.applyFocus();
    this.ui.updateStages();
  }

  /** Begin the shift. `fromWhite`: the intro's final flash covers the switch, so no fade in from black. */
  start(fromWhite = false): void {
    this.started = true;
    this.ui.hideStart();
    this.ui.setLangButton(getLang());
    this.lr.u.uFade.value = fromWhite ? 0 : 1;
    this.syncWorld();
    this.syncPile();
    this.ui.showMoney(this.game.money);
    this.ws.setRods(12 - (this.game.log.electrodes % 12));
    if (this.game.owned.apprentice && !this.showcase) this.ui.setApprentice(t('app.' + this.game.appState));
    this.showWorkers();
  }
}
