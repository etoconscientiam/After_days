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
import { settings, onSettings } from './settings';

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
    const intro = new Intro({ chapters: told, onDone: (fromWhite) => begin(fromWhite) });
    (window as unknown as { welderIntro: Intro }).welderIntro = intro;
    intro.start();
  }
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
    if (game.started) {
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
  (window as unknown as { welder: unknown }).welder = { game, view, demo: (o: Parameters<typeof demoWeld>[1]) => demoWeld(game, o) };
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
