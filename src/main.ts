// Entry: loads the save, runs offline progress, wires core <-> render/ui/audio through the event bus, runs the frame loop.
import '@fontsource/press-start-2p/400.css';
import '@fontsource/pixelify-sans/400.css';
import './ui/style.css';
import { CFG } from './config';
import { Game } from './core/game';
import { newGameState } from './core/state';
import { runOffline } from './core/offline';
import { Renderer } from './render/renderer';
import { Hud } from './ui/hud';
import { Drawer } from './ui/drawer';
import { Input } from './ui/input';
import { Modals, DevPanel } from './ui/modals';
import { $ } from './ui/dom';
import { t, setLang, onLangChange, fmt } from './ui/i18n';
import { audio } from './audio/audio';
import { saveLocal, loadLocal, clearLocal, exportString, importString } from './save/save';
import { rockColor } from './ui/dom';

const DEV = import.meta.env.DEV || new URLSearchParams(location.search).has('dev');

let game: Game;
const loaded = loadLocal();
game = loaded ? new Game(loaded.state, loaded.world) : new Game(newGameState());
setLang(game.state.settings.lang);

const renderer = new Renderer($('#world') as HTMLCanvasElement);
const hud = new Hud();
const drawer = new Drawer(() => game);
const input = new Input(() => game, renderer);
const modals = new Modals(() => game);
const dev = new DevPanel(() => game, () => resetAll());
if (!DEV) dev.el.remove();

// ---------- layout / scaling ----------
const column = $('#column');
const ui = $('#ui');
function fit(): void {
  const s = game.state.settings;
  const W = window.innerWidth, H = window.innerHeight;
  let scale = Math.min(W / 360, H / 640);
  if (s.integerScale && scale >= 1) scale = Math.floor(scale);
  column.style.width = 360 * scale + 'px';
  column.style.height = 640 * scale + 'px';
  ui.style.transform = `scale(${scale})`;
  input.scale = scale;
}
window.addEventListener('resize', fit);

// ---------- wiring ----------
function applySettings(): void {
  const s = game.state.settings;
  audio.volumes = { music: s.music, sfx: s.sfx, muted: s.muted };
  audio.applyVolumes();
  renderer.quality = s.quality;
  fit();
}

function bind(g: Game): void {
  const bus = g.bus;
  bus.on('click', (e) => { audio.click(e.boost); });
  bus.on('rockDiscovered', (e) => { hud.toast(t('toast.rock', { rock: t('rocks.' + e.rock) }), rockColor(e.rock)); audio.chime(e.rock); });
  let chimeAcc = 0;
  bus.on('rockTransformed', () => { chimeAcc++; });
  bus.on('fossilFound', (e) => {
    const s = t('species.' + e.species + '.name');
    if (e.fragment && !e.complete) {
      const m = g.legacy.museum[e.species];
      hud.toast(t('toast.fragment', { s, n: m?.fragments ?? 1 }), '#d8ccb0');
      audio.fossil(true);
    } else {
      hud.toast(t(e.rare ? 'toast.rare' : 'toast.fossil', { s }), e.rare ? '#fff4c8' : '#e8dcc0');
      audio.fossil(false);
      renderer.burst(e.x, renderer.lay.sectionTop + renderer.lay.vToY(e.depth), '#fff4c8', 10);
    }
  });
  bus.on('extinction', (e) => { if (e.killed >= 3) hud.toast(t('toast.extinction', { n: e.killed }), '#c86a5a'); renderer.onExtinction(); audio.rumble(1.2); });
  bus.on('eraChanged', (e) => { hud.toast(t('toast.era', { era: t('era.' + e.era) }), '#f2c14e'); audio.setEra(e.era); });
  bus.on('noteFound', (e) => hud.toast(t('toast.note', { title: t('notes.' + e.id + '.title') }), '#f2c14e'));
  bus.on('prestige', (e) => { hud.toast(t('toast.prestige', { n: e.gain }), '#c8b8ff'); audio.whoosh(); renderer.reveal = 0; save(); });
  bus.on('memory', (e) => hud.memoryLine(e.id));
  bus.on('element', (e) => {
    if (e.id === 'earthquake') { renderer.onQuake(); audio.rumble(1.8); }
    else if (e.id === 'volcano' || e.id === 'meteor') audio.rumble(2.2);
    else audio.whoosh();
  });
  bus.on('temple', () => save());
  void chimeAcc;
}

function save(): void { if (saveLocal(game)) game.state.savedAt = Date.now(); }

function swapGame(g: Game): void {
  game = g;
  bind(game);
  setLang(game.state.settings.lang);
  applySettings();
  drawer.relabel();
  drawer.close();
  renderer.reveal = 0;
}

function resetAll(): void {
  clearLocal();
  const s = game.state.settings;
  const g = new Game(newGameState());
  g.state.settings = s;
  swapGame(g);
  save();
}

drawer.onTarget = (el) => { input.startTarget(el); };
drawer.onConfirm = (text, yes) => modals.confirm(text, yes);
drawer.onBuy = () => {};
input.onArtifact = (shard) => { audio.unlock(); game.click(shard); renderer.onClick(game.mods.shards ? game.shardXs()[shard] : 180); };
input.onCast = () => {};
modals.onSettingsChange = () => { applySettings(); drawer.relabel(); };
modals.onExport = () => exportString(game);
modals.onImport = (s) => {
  try {
    const { state, world } = importString(s);
    swapGame(new Game(state, world));
    save();
    return true;
  } catch { return false; }
};
modals.onReset = () => resetAll();
modals.onNewWorld = () => { game.startNewWorld(); renderer.reveal = 0; save(); };
modals.onToast = (s) => hud.toast(s);
onLangChange(() => drawer.relabel());
$('#gear').addEventListener('click', () => { audio.unlock(); modals.settings(); });
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modals.isOpen) modals.close();
  else if (e.key === 'Escape' && drawer.open && !input.targeting) drawer.close();
  if (DEV && (e.key === '`' || e.key === '~' || e.key === 'ё')) dev.toggle();
});
window.addEventListener('pointerdown', () => audio.unlock(), { once: true });

bind(game);
applySettings();

// ---------- offline progress ----------
function offline(sinceMs: number): void {
  const away = (Date.now() - sinceMs) / 1000;
  const rep = runOffline(game, away);
  if (rep && rep.years > 1) {
    modals.away(rep);
    renderer.reveal = 0;
  }
}
if (loaded) offline(game.state.savedAt);
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); save(); }
  else if (hiddenAt && Date.now() - hiddenAt > 60000) offline(hiddenAt);
});
window.addEventListener('beforeunload', () => save());
setInterval(save, CFG.B.save.autosave * 1000);

// ---------- loop ----------
let last = performance.now();
function frame(now: number): void {
  const dtReal = Math.min(0.1, (now - last) / 1000);
  last = now;
  const steps = dev.timeScale;
  for (let i = 0; i < Math.min(steps, 100); i++) game.update(dtReal);
  renderer.lay.update(drawer.heightPx());
  renderer.draw(game, dtReal, now);
  hud.update(game, dtReal);
  drawer.update(dtReal);
  input.update(dtReal);
  modals.updateFinale();
  dev.update(dtReal);
  if (game.state.phase === 'temple') audio.choirLevel(Math.min(1, game.state.templeProgress * 1.5));
  else if (game.state.phase === 'play') audio.choirLevel(0);
  audio.setEra(game.run.era);
  requestAnimationFrame(frame);
}
fit();
requestAnimationFrame(frame);
void fmt;
(window as any).__strata = { get game() { return game; }, renderer, save, dev, drawer, input };
