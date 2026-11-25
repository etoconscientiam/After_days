import './style.css';
import { Game } from './sim/game';
import { DATA } from './data';
import { BALANCE } from './data/balance';
import { View } from './view/view';
import { Sound } from './audio/audio';
import { serialize, restore, SaveData } from './sim/save';
import { setLang, getLang, Lang } from './i18n';
import { demoWeld } from './dev';

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
  try {
    const l = localStorage.getItem(LANG_KEY);
    if (l === 'ru' || l === 'en') setLang(l as Lang);
  } catch {
    /* storage may be blocked */
  }
  const params = new URLSearchParams(location.search);
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
  const prev = { x: 0, z: 0, has: false };
  const input = { torch: view.frameInput(0) };
  const frame = (now: number) => {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    acc += dt;
    const torch = view.frameInput(dt);
    // Spread the mouse motion of this frame over its sim steps so a slow frame doesn't bunch the bead up.
    const n = Math.floor(acc / STEP);
    const tx = torch.x, tz = torch.z;
    const jump = !prev.has || !torch.has || Math.hypot(tx - prev.x, tz - prev.z) > 60;
    for (let k = 0; k < n; k++) {
      const f = jump ? 1 : (k + 1) / n;
      torch.x = prev.x + (tx - prev.x) * f;
      torch.z = prev.z + (tz - prev.z) * f;
      game.step(input);
      if (k === 0) view.consumeOneShot();
      acc -= STEP;
    }
    torch.x = tx;
    torch.z = tz;
    prev.x = tx;
    prev.z = tz;
    prev.has = torch.has;
    view.render(dt);
    sound.update(game);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Handy in the console while tuning.
  (window as unknown as { welder: unknown }).welder = { game, view, demo: (o: Parameters<typeof demoWeld>[1]) => demoWeld(game, o) };
}

boot();
