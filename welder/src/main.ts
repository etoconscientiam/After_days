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
  view.onStep = () => sound.step();
  view.onSfx = (k, v) => sound.sfx(k, v ?? 0);
  // RU / EN switch in the corner, at any time.
  view.ui.onLang = () => {
    const next: Lang = getLang() === 'en' ? 'ru' : 'en';
    setLang(next);
    view.relabel();
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
        sound.init(game);
        sound.resume();
        game.queue({ type: 'start' });
        view.start();
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
    );
  showStart();
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
    // Hit-stop: hold the frame on a strong moment (the picture stays, the sim waits).
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
