// Entry: loads the save, runs offline progress, wires core <-> render/ui/audio through the event bus, runs the frame loop.
import './ui/style.css';
import { CFG } from './config';
import THEME from './config/theme.json';
import { Game } from './core/game';
import { newGameState } from './core/state';
import { runOffline, OfflineReport } from './core/offline';
import { Renderer } from './render/renderer';
import { WW, WH } from './render/common';
import { CAP } from './world/World';
import { Hud } from './ui/hud';
import { Drawer } from './ui/drawer';
import { Input } from './ui/input';
import { Modals, DevPanel } from './ui/modals';
import { $ } from './ui/dom';
import { t, setLang, onLangChange } from './ui/i18n';
import { rockIcon, energyIcon, exhibit } from './ui/icons';
import { audio } from './audio/audio';
import { saveLocal, loadLocal, clearLocal, exportString, importString } from './save/save';

const DEV = import.meta.env.DEV || new URLSearchParams(location.search).has('dev');
/** Touch screen without hover (phones, tablets). */
const TOUCH = window.matchMedia('(hover: none)').matches;
document.documentElement.classList.toggle('touch', TOUCH);
// colour tokens from config/theme.json → CSS variables
for (const [k, v] of Object.entries(THEME)) if (!k.startsWith('_')) document.documentElement.style.setProperty('--' + k, v as string);

let game: Game;
const loaded = loadLocal();
game = loaded ? new Game(loaded.state, loaded.world) : new Game(newGameState());
setLang(game.state.settings.lang);

const canvas = $('#world') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const hud = new Hud(() => game);
const drawer = new Drawer(() => game);
const input = new Input(() => game, renderer);
const modals = new Modals(() => game);
const dev = new DevPanel(() => game, () => resetAll());
if (!DEV) dev.el.remove();

// ---------- layout / scaling ----------
const column = $('#column');
const ui = $('#ui');
const ambi = $('#ambi') as HTMLCanvasElement;
let uiScale = 1;
function fit(): void {
  const s = game.state.settings;
  const vv = window.visualViewport;
  const W = vv ? vv.width : window.innerWidth, H = vv ? vv.height : window.innerHeight;
  // the world is 180×320 pixels; integer scaling keeps every pixel the same size,
  // but only when that wastes little of the screen (on phones it would shrink the game to a stamp)
  const fill = Math.min(W / WW, H / WH);
  let k = fill;
  if (s.integerScale && Math.floor(fill) >= 2 && (fill - Math.floor(fill)) / fill < 0.25) k = Math.floor(fill);
  $('#rotate').hidden = !(TOUCH && W > H && H < 520);
  uiScale = k / 2; // UI is laid out in 360×640 units
  column.style.width = WW * k + 'px';
  column.style.height = WH * k + 'px';
  ui.style.transform = `scale(${uiScale})`;
  input.scale = uiScale;
  // ambilight only where there is space around the column
  ambi.style.opacity = W - WW * k > 40 || H - WH * k > 40 ? '' : '0';
}
window.addEventListener('resize', fit);
window.visualViewport?.addEventListener('resize', fit);
window.addEventListener('orientationchange', () => setTimeout(fit, 200));

// ambilight: the world's colours, tiny and blurred, behind the column
ambi.width = 18; ambi.height = 32;
const ambiCtx = ambi.getContext('2d')!;
let ambiAcc = 0;
function updateAmbi(dt: number): void {
  ambiAcc += dt;
  if (ambiAcc < 0.5) return;
  ambiAcc = 0;
  ambiCtx.globalAlpha = 0.35; // slow blend towards the current frame
  ambiCtx.drawImage(canvas, 0, 0, 18, 32);
  ambiCtx.globalAlpha = 1;
}

// ---------- fly-to effects (DOM, in UI units) ----------
function uiPoint(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect(), u = ui.getBoundingClientRect();
  return { x: (r.left + r.width / 2 - u.left) / uiScale, y: (r.top + r.height / 2 - u.top) / uiScale };
}
function flyDom(node: HTMLElement, from: { x: number; y: number }, to: Element, done?: () => void): void {
  const p = uiPoint(to);
  node.classList.add('flyer');
  node.style.left = from.x + 'px';
  node.style.top = from.y + 'px';
  node.style.transform = 'translate(-50%,-50%) scale(1.4)';
  ui.append(node);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    node.style.transform = `translate(calc(-50% + ${p.x - from.x}px), calc(-50% + ${p.y - from.y}px)) scale(0.7)`;
  }));
  setTimeout(() => { node.style.opacity = '0'; done?.(); }, 720);
  setTimeout(() => node.remove(), 1500);
}
const worldToUi = (x: number, y: number) => ({ x: x * (360 / WW), y: y * (640 / WH) });

renderer.sparkTarget = () => hud.energyPoint(canvas.getBoundingClientRect());
renderer.onSparkArrive = () => hud.bump();

// ---------- era title, slow motion, the "0" ----------
let slowmo = 0;
function eraTitle(era: number): void {
  const el = $('#era-title');
  (el.firstChild as HTMLElement).textContent = t('era.' + era);
  el.hidden = false;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  setTimeout(() => { el.hidden = true; el.classList.remove('show'); }, 3100);
}
let findingShown = '';
function updateFinding(): void {
  const ph = game.state.phase;
  const el = $('#finding-title');
  const key = ph === 'newWorld' || ph === 'end' ? ph + game.legacy.playthrough : '';
  if (key === findingShown) return;
  findingShown = key;
  if (!key) { el.hidden = true; return; }
  el.className = 'zero';
  el.textContent = '0';
  el.hidden = false;
  setTimeout(() => {
    renderer.flash = 1;
    audio.fossil(false);
    el.className = 'year';
    el.textContent = t('finale.after');
  }, 1800);
}

// ---------- wiring ----------
function applySettings(): void {
  const s = game.state.settings;
  audio.volumes = { music: s.music, sfx: s.sfx, muted: s.muted };
  audio.applyVolumes();
  renderer.quality = s.quality;
  fit();
}

const plural = (key: string) => (n: number) => t('toastN.' + key, { n });

function bind(g: Game): void {
  const bus = g.bus;
  bus.on('click', (e) => { audio.click(e.boost); });
  bus.on('rockDiscovered', (e) => {
    hud.notify('rock', t('toast.rock', { rock: t('rocks.' + e.rock) }), '#F2B54A', plural('rock'));
    audio.chime(e.rock);
    const y = renderer.lay.sectionTop + Math.max(10, renderer.section.strataH * 0.6);
    renderer.burst(WW / 2, y, '#fff2c0', 8);
    flyDom(rockIcon(e.rock, 26), worldToUi(WW / 2, y), $('#rocks'));
  });
  bus.on('fossilFound', (e) => {
    const s = t('species.' + e.species + '.name');
    if (e.fragment && !e.complete) {
      const m = g.legacy.museum[e.species];
      hud.notify('fragment', t('toast.fragment', { s, n: m?.fragments ?? 1 }), '#d8ccb0', plural('fragment'));
      audio.fossil(true);
      return;
    }
    hud.notify('fossil', t(e.rare ? 'toast.rare' : 'toast.fossil', { s }), e.rare ? '#fff4c8' : '#e8dcc0', plural('fossil'));
    audio.fossil(false);
    const w = g.world;
    const i = Math.max(0, w.len[e.x] - 1 - e.depth);
    const y = renderer.lay.sectionTop + renderer.section.yAt(e.x, w.birth[e.x * CAP + i]);
    renderer.burst(e.x, y, '#fff4c8', 10);
    const ex = exhibit('fossil', e.species, e.rare, 2);
    const tab = document.querySelectorAll('#tabbar .tab')[4];
    if (tab) flyDom(ex, worldToUi(e.x, y), tab);
  });
  bus.on('extinction', (e) => {
    if (e.killed >= 3) hud.notify('extinction', t('toast.extinction', { n: e.killed }), '#B5523B', plural('extinction'));
    renderer.onExtinction(); audio.rumble(1.2);
  });
  bus.on('eraChanged', (e) => {
    hud.notify('era', t('toast.era', { era: t('era.' + e.era) }), '#F2B54A', plural('era'));
    audio.setEra(e.era); renderer.onEra(e.era);
    if (game.state.phase === 'play') { slowmo = 1; eraTitle(e.era); }
  });
  bus.on('noteFound', () => hud.notify('note', t('toast.note'), '#EDE3D0', plural('note')));
  bus.on('prestigeStart', () => { drawer.close(); renderer.beginShift(); });
  bus.on('prestige', (e) => { hud.notify('prestige', t('toast.prestige', { n: e.gain }), '#B9A6E8'); audio.whoosh(); audio.rumble(2.5); save(); });
  bus.on('echo', (e) => {
    const def = CFG.echoes.echoes.find((x) => x.id === e.id);
    if (!def) return;
    renderer.showEcho(def.picture, e.alpha);
    audio.echo(def.sound, e.alpha);
  });
  bus.on('relicFound', () => { hud.notify('relic', '⟡', '#F2B54A'); audio.fossil(false); });
  bus.on('itemChosen', () => { audio.whoosh(); });
  bus.on('element', (e) => {
    if (e.id === 'earthquake') { renderer.onQuake(); audio.rumble(1.8); }
    else if (e.id === 'volcano' || e.id === 'meteor') audio.rumble(2.2);
    else audio.whoosh();
  });
  bus.on('temple', () => save());
}

function save(): void { if (saveLocal(game)) game.state.savedAt = Date.now(); }

function swapGame(g: Game): void {
  game = g;
  bind(game);
  setLang(game.state.settings.lang);
  applySettings();
  drawer.relabel();
  drawer.close();
  modals.close();
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

hud.onRocks = () => drawer.toggleView('rocks');
$('#gear').addEventListener('click', () => { audio.unlock(); drawer.toggleView('settings'); });
let reopen: string | null = null;
drawer.onTarget = (el) => { reopen = drawer.open; drawer.close(); input.startTarget(el); };
input.onTargetEnd = () => { if (reopen) drawer.toggleView(reopen as any); reopen = null; };
drawer.onBought = (btn, zi) => {
  btn.classList.add('sink');
  setTimeout(() => btn.classList.remove('sink'), 140);
  // the price flies as a spark from the button into the world, a creature rises with a soft flash
  const c = canvas.getBoundingClientRect(), r = btn.getBoundingClientRect();
  const x0 = ((r.left + r.width / 2 - c.left) / c.width) * WW, y0 = ((r.top - c.top) / c.height) * WH;
  const x1 = [30, 80, 140][zi] ?? 90, y1 = renderer.lay.surfaceTop + 20;
  renderer.fly(x0, y0, x1, y1, '#F2B54A', () => renderer.spawnFlash(zi, game));
  audio.click(0);
};
drawer.onExhibit = (kind, id) => modals.exhibitView(kind, id);
drawer.onSettingsChange = () => { applySettings(); drawer.relabel(); };
drawer.onExport = () => exportString(game);
drawer.onImport = (s) => {
  try {
    const { state, world } = importString(s);
    swapGame(new Game(state, world));
    save();
    return true;
  } catch { return false; }
};
drawer.onReset = () => resetAll();
drawer.onToast = (s) => hud.notify('sys', s, '#EDE3D0');
input.onArtifact = (shard) => { audio.unlock(); game.click(shard); renderer.onClick(game.mods.shards ? game.shardXs()[shard] : WW / 2); };
input.onCast = (x, y) => renderer.burst(x, y, '#9fd0ff', 8);
input.onWorldTap = () => { if (!drawer.open) return false; drawer.close(); return true; };
input.onChoose = (i) => {
  audio.unlock();
  const items = game.availableItems();
  const id = items[i];
  if (id && game.chooseItem(id)) { renderer.beginSink(id, i, items.length); save(); }
};
modals.onNewWorld = () => { game.startNewWorld(); renderer.reveal = 0; save(); };
onLangChange(() => drawer.relabel());
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modals.isOpen) modals.close();
  else if (e.key === 'Escape' && drawer.open && !input.targeting) drawer.close();
  if (DEV && (e.key === '`' || e.key === '~' || e.key === 'ё')) dev.toggle();
});
window.addEventListener('pointerdown', () => audio.unlock(), { once: true });
// touch has no hover: things with a tooltip explain themselves on tap
{
  const pop = $('#hint-pop');
  pop.classList.add('label');
  let popTimer = 0;
  document.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest('[data-tip]') as HTMLElement | null;
    if (!el || !el.dataset.tip || !(TOUCH || e.detail === 0)) return;
    const r = el.getBoundingClientRect(), u = ui.getBoundingClientRect();
    pop.textContent = el.dataset.tip;
    pop.hidden = false;
    pop.style.left = Math.max(6, Math.min(360 - 216, (r.left - u.left) / uiScale - 40)) + 'px';
    pop.style.top = ((r.bottom - u.top) / uiScale + 6) + 'px';
    clearTimeout(popTimer);
    popTimer = window.setTimeout(() => (pop.hidden = true), 3000);
  });
}

bind(game);
applySettings();

// ---------- offline progress: a short timelapse, then the summary ----------
let pendingAway: { rep: OfflineReport; t: number } | null = null;
function offline(sinceMs: number): void {
  const away = (Date.now() - sinceMs) / 1000;
  const rep = runOffline(game, away);
  if (rep && rep.years > 1) {
    const sec = Math.min(5, 3 + Math.log10(1 + rep.years) * 0.4);
    renderer.startTimelapse(sec);
    pendingAway = { rep, t: sec };
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
  // an era change: time almost stops for a second
  let dtGame = dtReal;
  if (slowmo > 0) { slowmo -= dtReal; dtGame = dtReal * 0.08; }
  const steps = dev.timeScale;
  for (let i = 0; i < Math.min(steps, 100); i++) game.update(dtGame);
  renderer.lay.update(drawer.heightPx());
  renderer.draw(game, dtReal, now);
  hud.update(game, dtReal);
  drawer.update(dtReal);
  input.update(dtReal);
  modals.update(dtReal);
  updateFinding();
  updateAmbi(dtReal);
  if (pendingAway) { pendingAway.t -= dtReal; if (pendingAway.t <= 0) { modals.away(pendingAway.rep); pendingAway = null; } }
  const ph = game.state.phase;
  ui.classList.toggle('choosing', ph === 'choose');
  ui.classList.toggle('finale', ph === 'finale' || ph === 'temple' || ph === 'newWorld' || ph === 'end');
  ui.classList.toggle('detailed', !!game.state.settings.detailed);
  if (ph !== 'play' && drawer.open) drawer.close();
  dev.update(dtReal);
  if (ph === 'temple') audio.choirLevel(Math.min(1, game.state.templeProgress * 1.5));
  else if (ph === 'play') audio.choirLevel(0);
  audio.setEra(game.run.era);
  requestAnimationFrame(frame);
}
fit();
requestAnimationFrame(frame);
void energyIcon;
(window as any).__strata = { get game() { return game; }, renderer, save, dev, drawer, input, modals, away: (sec: number) => offline(Date.now() - sec * 1000),
  lang: (l: 'en' | 'ru') => { game.state.settings.lang = l; setLang(l); drawer.relabel(); } };
