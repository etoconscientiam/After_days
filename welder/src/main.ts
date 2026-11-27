import './style.css';
import { Game } from './sim/game';
import { DATA } from './data';
import { BALANCE } from './data/balance';
import { View } from './view/view';
import { Sound } from './audio/audio';
import { serialize, restore, SaveData } from './sim/save';
import { setLang, getLang, Lang } from './i18n';
import { demoWeld } from './dev';
import { installFrames, installCursors } from './view/frames';
import { Intro } from './intro/intro';
import { figure } from './view/workshop';
import { settings, onSettings } from './settings';
import { Autopilot } from './sim/autopilot';
import { emptyTorch } from './sim/weld';

const SAVE_KEY = 'welder.save';
const LANG_KEY = 'welder.lang';

function readSave(): SaveData | null {
  try {
    const s = localStorage.getItem(SAVE_KEY);
    return s ? (JSON.parse(s) as SaveData) : null;
  } catch {
    return null;
  }
}

function boot(): void {
  // Language: ?lang= in the address, else the last choice, else the browser's language.
  const params = new URLSearchParams(location.search);
  let chosen: string | null = params.get('lang');
  try {
    chosen ??= localStorage.getItem(LANG_KEY);
  } catch {
    /* storage may be blocked */
  }
  if (chosen === 'ru' || chosen === 'en') setLang(chosen);
  else if ((navigator.language || '').toLowerCase().startsWith('ru')) setLang('ru');
  const seed = Number(params.get('seed')) || 1;
  let game = new Game(DATA, seed);
  const saved = params.has('fresh') ? null : readSave();
  if (saved && !restore(game, saved)) game = new Game(DATA, seed);
  const resume = !!saved && game.t > 0;

  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const uiRoot = document.getElementById('ui')!;
  const stage = document.getElementById('stage')!;
  const view = new View(game, canvas, uiRoot, stage);
  const sound = new Sound();
  // Settings take effect at once: the volume, the hands that turn the work.
  const applySettings = () => {
    sound.setVolume(settings.volume);
    game.autoTurn = settings.autoTurn;
  };
  applySettings();
  onSettings(applySettings);
  view.onStep = () => sound.step();
  view.onSfx = (k, v, n) => sound.sfx(k, v ?? 0, n ?? 0);
  // RU / EN switch in the corner, at any time.
  view.ui.onLang = () => {
    const next: Lang = getLang() === 'en' ? 'ru' : 'en';
    setLang(next);
    view.relabel();
    if (!begun) showStart();
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch {
      /* ignore */
    }
  };

  game.bus.on('save', () => {
    if (pilot) return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(serialize(game)));
    } catch {
      /* ignore */
    }
  });

  // Start the shift: once, whether from the start screen or at the end of the intro.
  let begun = false;
  const begin = (fromWhite: boolean) => {
    if (begun) return;
    begun = true;
    paused = false;
    sound.init(game);
    sound.resume();
    game.queue({ type: 'start' });
    view.start(fromWhite);
  };
  // While the intro plays the game neither steps nor draws.
  let paused = false;

  const showStart = () =>
    view.ui.showStart(
      resume,
      (fresh) => {
        if (fresh) {
          try {
            localStorage.removeItem(SAVE_KEY);
          } catch {
            /* ignore */
          }
          location.reload();
          return;
        }
        begin(false);
      },
      () => {
        const next: Lang = getLang() === 'en' ? 'ru' : 'en';
        setLang(next);
        view.relabel();
        try {
          localStorage.setItem(LANG_KEY, next);
        } catch {
          /* ignore */
        }
        showStart();
      },
      playIntro,
    );
  // The intro, then the shift (from a new one, or from the start screen's link to see what has been told so far).
  function playIntro() {
    paused = true;
    const told = ['prologue', ...['years', 'winter', 'name'].filter((c) => game.flags['ch:' + c])];
    game.queue({ type: 'mark', flag: 'ch:prologue' });
    const fresh = !game.started && game.t === 0;
    const intro = new Intro({ chapters: told, onDone: (fromWhite) => (fresh ? showcase() : begin(fromWhite)) });
    (window as unknown as { welderIntro: Intro }).welderIntro = intro;
    intro.start();
  }
  // Between the prologue and the first shift: seven seconds of the craft at its height — everything learned
  // and bought, a master's hand welding a kettle on this bench — then the arc's white, and under it the
  // workshop is put back as it is on the first morning.
  const SHOW_PART = 'kettle';
  const SHOW_LEN = 11;
  /** The showcase runs slowed down (sim seconds per real second), so the eye can follow the hand. */
  const SHOW_SLOW = 0.6;
  let pilot: Autopilot | null = null;
  let showT = 0;
  const pilotTorch = emptyTorch();
  const veil = document.createElement('div');
  Object.assign(veil.style, { position: 'fixed', inset: '0', background: '#fff', opacity: '0', pointerEvents: 'none', zIndex: '999', transition: 'opacity 0.25s ease-in' });
  document.body.append(veil);
  // Nothing the player does reaches the game while the master works.
  const hold = (e: Event) => {
    if (!pilot) return;
    e.stopPropagation();
    if (e.type === 'keydown' || e.type === 'wheel' || e.type === 'contextmenu') e.preventDefault();
  };
  for (const ev of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'wheel', 'contextmenu'] as const) addEventListener(ev, hold, true);
  function showcase() {
    paused = false;
    sound.init(game);
    sound.resume();
    view.showcase = true;
    view.ui.muteHint(true);
    game.showcase(SHOW_PART, 'keeper');
    view.start(true);
    pilot = new Autopilot();
    showT = 0;
  }
  const stepShowcase = (dt: number) => {
    showT += dt;
    acc += dt * SHOW_SLOW;
    while (acc >= STEP) {
      pilot!.step(game, pilotTorch);
      game.step({ torch: pilotTorch });
      acc -= STEP;
    }
    view.showDrive(pilotTorch, pilot!.nrm);
    view.render(dt);
    sound.update(game);
    if (showT >= SHOW_LEN && veil.style.opacity === '0') {
      veil.style.transition = 'opacity 0.25s ease-in';
      veil.style.opacity = '1';
    }
    if (showT >= SHOW_LEN + 0.35) {
      // Under the white: the workshop back to its first morning, and the story goes on from the white
      // (the years, the winter, the name); its last flash opens the shift.
      pilot = null;
      game.reset();
      applySettings();
      view.endShowcase();
      acc = 0;
      paused = true;
      sound.suspend();
      view.releaseInput();
      const rest = ['years', 'winter', 'name'];
      for (const c of rest) game.queue({ type: 'mark', flag: 'ch:' + c });
      const intro = new Intro({ chapters: rest, onDone: (fromWhite) => begin(fromWhite) });
      (window as unknown as { welderIntro: Intro }).welderIntro = intro;
      intro.start();
      setTimeout(() => {
        veil.style.transition = 'none';
        veil.style.opacity = '0';
      }, 900);
    }
  };

  // The rest of the story comes in chapters as the shift goes: the years when the town starts coming (the
  // board opens), the winter when the gate is brought at night, the name when the gate goes on the bench.
  // Each waits for a calm moment (nothing burning, nothing open) and is told once.
  const pending: { id: string; at: number }[] = [];
  const want = (id: string, delay: number) => {
    if (game.flags['ch:' + id] || pending.some((p) => p.id === id)) return;
    pending.push({ id, at: performance.now() + delay * 1000 });
  };
  game.bus.on('beat', (e) => {
    if (e.id === 'board') want('years', 2.5);
  });
  game.bus.on('pileChanged', () => {
    if (game.pile?.urgent) want('winter', 1.5);
  });
  game.bus.on('orderTaken', (e) => {
    if (e.bench === 'player' && game.player.order?.urgent) want('name', 0.3);
  });
  const playChapter = (id: string) => {
    paused = true;
    view.releaseInput();
    sound.suspend();
    game.queue({ type: 'mark', flag: 'ch:' + id });
    const intro = new Intro({
      chapters: [id],
      onDone: () => {
        view.releaseInput();
        paused = false;
        sound.resume();
      },
    });
    (window as unknown as { welderIntro: Intro }).welderIntro = intro;
    intro.start();
  };
  const tellPending = (now: number) => {
    if (!pending.length || paused || !view.calm()) return;
    const p = pending[0];
    if (now < p.at) return;
    pending.shift();
    if (!game.flags['ch:' + p.id]) playChapter(p.id);
  };
  // A new shift opens with the intro (?nointro skips it, ?intro forces it); a saved one with the start screen.
  if ((!resume && !params.has('nointro')) || params.has('intro')) playIntro();
  else showStart();
  addEventListener('pointerdown', () => sound.resume());
  addEventListener('beforeunload', () => {
    if (game.started && !pilot) {
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(serialize(game)));
      } catch {
        /* ignore */
      }
    }
  });

  // Fixed 1/60 s simulation steps on wall-clock time; rendering once per animation frame.
  const STEP = BALANCE.dt;
  let last = performance.now();
  let acc = 0;
  const prev = { x: 0, y: 0, z: 0, has: false };
  const input = { torch: view.frameInput(0) };
  let errors = 0;
  const tick = (dt: number) => {
    acc += dt;
    const torch = view.frameInput(dt);
    // Spread the mouse motion of this frame over its sim steps so a slow frame doesn't bunch the bead up.
    const n = Math.floor(acc / STEP);
    const tx = torch.x, ty = torch.y, tz = torch.z;
    const jump = !prev.has || !torch.has || Math.hypot(tx - prev.x, ty - prev.y, tz - prev.z) > 60;
    for (let k = 0; k < n; k++) {
      const f = jump ? 1 : (k + 1) / n;
      torch.x = prev.x + (tx - prev.x) * f;
      torch.y = prev.y + (ty - prev.y) * f;
      torch.z = prev.z + (tz - prev.z) * f;
      game.step(input);
      if (k === 0) view.consumeOneShot();
      acc -= STEP;
    }
    torch.x = tx;
    torch.y = ty;
    torch.z = tz;
    prev.x = tx;
    prev.y = ty;
    prev.z = tz;
    prev.has = torch.has;
    view.render(dt);
    sound.update(game);
  };
  const frame = (now: number) => {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    if (paused) {
      requestAnimationFrame(frame);
      return;
    }
    if (pilot) {
      try {
        stepShowcase(dt);
      } catch (e) {
        console.error(e);
        pilot = null;
        game.reset();
        view.endShowcase();
        begin(true);
      }
      requestAnimationFrame(frame);
      return;
    }
    // Hit-stop: hold the frame on a strong moment (the picture stays, the sim waits).
    tellPending(now);
    if (paused) {
      requestAnimationFrame(frame);
      return;
    }
    if (view.consumeFreeze(dt)) {
      requestAnimationFrame(frame);
      return;
    }
    // One bad frame must not stop the game: report it and carry on with the next one.
    try {
      tick(dt);
    } catch (e) {
      acc = 0;
      if (errors++ < 5) console.error(e);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Handy in the console while tuning.
  (window as unknown as { welder: unknown }).welder = { game, view, figure, demo: (o: Parameters<typeof demoWeld>[1]) => demoWeld(game, o) };
}

// The pixel squircle frames, then the pixel font (in-world lettering is painted on canvases, so it must be
// loaded first), then the game. A missing font never blocks it for more than a moment.
installFrames();
installCursors();
const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
const ready = fonts
  ? Promise.all([fonts.load('16px "Strata Pixel"', 'АаZz09'), fonts.load('32px "Strata Stone"', 'АаZz09')]).catch(() => undefined)
  : Promise.resolve();
Promise.race([ready, new Promise((r) => setTimeout(r, 1500))]).then(() => boot());
