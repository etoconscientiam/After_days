// Entry: loads the save, runs offline progress, wires core <-> render/ui/audio through the event bus, runs the frame loop.
import './ui/style.css';
import { CFG } from './config';
import { pileFeedsLever } from './core/niche';
import THEME from './config/theme.json';
import { Game } from './core/game';
import { newGameState } from './core/state';
import { runOffline, OfflineReport } from './core/offline';
import { Renderer } from './render/renderer';
import { WW, WH } from './render/common';
import { PileMix } from './ui/pileMix';
import { InfoPanel } from './ui/infoPanel';
import { Hud } from './ui/hud';
import { Drawer } from './ui/drawer';
import { Input } from './ui/input';
import { Modals } from './ui/modals';
import { DevPanel } from './ui/debug';
import { $, h, toggle } from './ui/dom';
import { t, fmt, setLang, onLangChange } from './ui/i18n';
import { rockIcon, energyIcon, exhibit, pixelSpark, pixelGlyph, GLYPH_ROTATE } from './ui/icons';
import { audio } from './audio/audio';
import { setWear, wearFrom } from './ui/wear';
import { Turmoil, SEVERITY } from './ui/turmoil';
import { Geologist } from './ui/geologist';
import { rockNeedsHeatOrDepth } from './core/forecast';
import { saveLocal, loadLocal, clearLocal, exportString, importString, loadSlot, deleteSlot, setActiveSlot, activeSlot } from './save/save';
import { loadAllSkins } from './render/assets';
import { Menu } from './ui/menu';

/** Touch screen without hover (phones, tablets). */
const TOUCH = window.matchMedia('(hover: none)').matches;
document.documentElement.classList.toggle('touch', TOUCH);
// colour tokens from config/theme.json → CSS variables
for (const [k, v] of Object.entries(THEME)) if (!k.startsWith('_')) document.documentElement.style.setProperty('--' + k, v as string);

/** The loader and the main menu open the game; an automated test (webdriver) goes straight in, unless it asks for the
 *  menu (?menu in the address). */
const INTRO = !(navigator.webdriver && !/[?&]menu\b/.test(location.search));
/** the game stands still while the menu is up (the world behind it still breathes: sky, water, light) */
$('#rotate span').append(pixelGlyph(GLYPH_ROTATE, '#f2b54a', 6));
let paused = INTRO;
// an automated test goes straight in: no loader over the world to catch its first taps
if (!INTRO) document.getElementById('boot')?.remove();

let game: Game;
const loaded = loadLocal();
game = loaded ? new Game(loaded.state, loaded.grid, loaded.archive) : new Game(newGameState());
setLang(game.state.settings.lang);

const canvas = $('#world') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
renderer.lightCanvas = $('#light') as HTMLCanvasElement;
const hud = new Hud(() => game);
const pileMix = new PileMix(() => game);
const deskLook = (new URLSearchParams(location.search).get('desk') ?? 'a') as 'a' | 'b' | 'c';
const info = new InfoPanel(() => game, hud, ['a', 'b', 'c'].includes(deskLook) ? deskLook : 'a');
const drawer = new Drawer(() => game);
pileMix.onOpen = () => drawer.openUpgradesAt('pile');
const input = new Input(() => game, renderer);
const modals = new Modals(() => game);
const dev = new DevPanel(() => game, renderer, () => resetAll());
const turmoil = new Turmoil();
const geo = new Geologist(() => game, renderer, input, () => uiScale);
// the matter the thing gives back flies to the pile extras' buttons and is counted as it arrives
renderer.matTarget = (id) => hud.specialPoint(id, canvas.getBoundingClientRect());
renderer.onMatSend = (id, n) => hud.specialSend(id, n);
renderer.onMatArrive = (id, n) => hud.specialArrive(id, n);
renderer.onSplash = (m) => audio.splash(m);

// ---------- layout / scaling ----------
const column = $('#column');
const ui = $('#ui');
const ambi = $('#ambi') as HTMLCanvasElement;
let uiScale = 1;
// ---------- the desktop layout: a wide screen with a mouse gets the world at full height between two panels —
// the info at the left, the drawer (Life, Elements, Upgrades…) pinned open at the right ----------
// the side panels are narrow (the world is what matters): they grow a little on wide screens
const SIDE_GAP = 12;
let SIDE_L = 250, SIDE_R = 300;
let desktop = false;
const sideL = $('#side-left'), sideR = $('#side-right');
function setDesktop(on: boolean): void {
  desktop = on;
  document.documentElement.classList.toggle('desktop', on);
  sideL.hidden = sideR.hidden = !on;
  const drawerEl0 = $('#drawer'), tabbar0 = $('#tabbar');
  if (on) {
    sideR.append(tabbar0, drawerEl0);
    drawer.pinned = true;
    if (!drawer.open) drawer.toggleView('upgrades');
  } else {
    ui.insertBefore(drawerEl0, $('#overlay'));
    ui.insertBefore(tabbar0, $('#overlay'));
    drawer.pinned = false;
    drawer.close();
  }
}
function fit(): void {
  const s = game.state.settings;
  const vv = window.visualViewport;
  const W0 = vv ? vv.width : window.innerWidth, H0 = vv ? vv.height : window.innerHeight;
  const wantDesk = !TOUCH && W0 >= 900 && W0 / H0 >= 1.2;
  if (wantDesk !== desktop) setDesktop(wantDesk);
  // in the desktop layout the world takes the height, the panels the sides
  if (desktop) {
    // narrow panels first (the world takes what it can), then the panels share whatever is left over
    const minL = 230, minR = 280;
    const colW = Math.min((H0 - SIDE_GAP * 2) * (WW / WH), W0 - minL - minR - SIDE_GAP * 4);
    const spare = Math.max(0, W0 - colW - minL - minR - SIDE_GAP * 4);
    SIDE_L = Math.round(Math.min(330, minL + spare * 0.45));
    SIDE_R = Math.round(Math.min(380, minR + spare * 0.55));
    sideL.style.width = SIDE_L + 'px'; sideR.style.width = SIDE_R + 'px';
  }
  const W = desktop ? W0 - SIDE_L - SIDE_R - SIDE_GAP * 4 : W0, H = desktop ? H0 - SIDE_GAP * 2 : H0;
  // the world is 180×320 pixels; integer scaling keeps every pixel the same size,
  // but only when that wastes little of the screen (on phones it would shrink the game to a stamp)
  const fill = Math.min(W / WW, H / WH);
  let k = fill;
  // (on a desktop the world takes the whole height instead: the panels frame it, a gap would read as a bug)
  if (s.integerScale && !desktop && Math.floor(fill) >= 2 && (fill - Math.floor(fill)) / fill < 0.25) k = Math.floor(fill);
  $('#rotate').hidden = !(TOUCH && W > H && H < 520);
  uiScale = k / 2; // UI is laid out in 360×640 units
  column.style.width = WW * k + 'px';
  column.style.height = WH * k + 'px';
  sideL.style.height = sideR.style.height = desktop ? WH * k + 'px' : '';
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

// ---------- an open drawer: the world re-lays itself into the space above it (full width, never a miniature) ----------
const drawerEl = $('#drawer');
const tabbarEl = $('#tabbar');
/** World pixels the drawer covers above the tab bar (follows the drawer as it slides). */
function drawerWorldPx(): number {
  if (desktop) return 0;
  const dr = drawerEl.getBoundingClientRect(), tb = tabbarEl.getBoundingClientRect();
  const k = canvas.getBoundingClientRect().height / WH;     // screen px per world px
  return k > 0 ? Math.max(0, (tb.top - dr.top) / k) : 0;
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
  const span = el.firstChild as HTMLElement;
  span.textContent = t('era.' + era);
  // the oldest eras are the most weathered (Strata Stone wear levels)
  span.classList.add('stone');
  setWear(span, wearFrom((7 - era) / 7, 1.4));
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
  renderer.section.lowQuality = s.quality === 'low';
  game.lowPhysics = s.quality === 'low';
  fit();
}

const plural = (key: string) => (n: number) => t('toastN.' + key, { n });

function bind(g: Game): void {
  const bus = g.bus;
  bus.on('click', (e) => { audio.click(e.boost); });
  // the thing absorbed a line of the strata: a glow in its colour, a spark to the counter, a soft low «gulp»
  bus.on('absorb', (e) => { renderer.onAbsorb(e.mat, e.value, e.mats, e.looks, e.gains); absorbGain += e.energy; audio.absorb(Math.min(1, e.value / 400)); });
  bus.on('seep', (e) => renderer.onSeep(e.x, e.y, e.oil));
  bus.on('geyser', (e) => { renderer.onGeyser(e.x, e.y0, e.y1, e.n); audio.geyser(Math.min(1, e.n / 50)); });
  bus.on('rockDiscovered', (e) => {
    // the first rock that needs heat or depth: the Geologist's lens lights up
    if (rockNeedsHeatOrDepth(e.rock) && !g.legacy.firsts.geoHint) { g.legacy.firsts.geoHint = true; geo.hint(); hud.notify('geo', t('geo.hint'), '#F2B54A'); }
    hud.notify('rock', t('toast.rock', { rock: t('rocks.' + e.rock) }), '#F2B54A', plural('rock'));
    audio.chime(e.rock);
    const y = renderer.lay.sectionTop + Math.max(10, renderer.section.strataH * 0.6);
    renderer.burst(WW / 2, y, '#fff2c0', 8);
    // a rock found goes to the Book's collection (it is no currency: the special materials come by absorption)
    const book = document.querySelectorAll('#tabbar .tab')[4];
    if (book) flyDom(rockIcon(e.rock, 26), worldToUi(WW / 2, y), book);
  });
  bus.on('fossilFound', (e) => {
    const s = t('species.' + e.species + '.name');
    if (e.fragment && !e.complete) {
      const m = g.legacy.museum[e.species];
      hud.notify('fragment', t('toast.fragment', { s, n: m?.fragments ?? 1 }), '#d8ccb0', plural('fragment'));
      audio.fossil(true);
      return;
    }
    if (e.rare) turmoil.hit(SEVERITY.rareFossil);
    hud.notify('fossil', t(e.rare ? 'toast.rare' : 'toast.fossil', { s }), e.rare ? '#fff4c8' : '#e8dcc0', plural('fossil'));
    audio.fossil(false);
    // the bone lies e.depth particles below the top of its column
    const y = renderer.lay.sectionTop + renderer.section.yOfRow(g.grid.surf[e.x >> 1] + e.depth) + 1;
    renderer.burst(e.x, y, '#fff4c8', 10);
    const ex = exhibit('fossil', e.species, e.rare, 2);
    const tab = document.querySelectorAll('#tabbar .tab')[4];
    if (tab) flyDom(ex, worldToUi(e.x, y), tab);
  });
  // life that arises or dies out on its own (core/niche.ts)
  bus.on('wildBorn', (e) => {
    renderer.spawnFlash(e.zi, game);
    if (e.first) hud.notify('wildBorn', t('toast.wildBorn', { s: t('species.' + e.id + '.name') }), '#9cc060', plural('wildBorn'));
  });
  // the first time a pile buries a forest (or mats): what it will become
  bus.on('lifeBuried', (e) => {
    const key = 'buried_' + e.id;
    if (game.legacy.firsts[key]) return;
    game.legacy.firsts[key] = true;
    hud.notify('lifeBuried', t('toast.buried.' + e.id), '#c8a060');
  });
  bus.on('wildDied', (e) => {
    if (e.last) hud.notify('wildDied', t('toast.wildDied', { s: t('species.' + e.id + '.name') }), '#B5523B', plural('wildDied'));
  });
  bus.on('extinction', (e) => {
    turmoil.hit(SEVERITY.extinction(e.killed));
    if (e.killed >= 3) hud.notify('extinction', t('toast.extinction', { n: e.killed }), '#B5523B', plural('extinction'));
    renderer.onExtinction(); audio.rumble(1.2);
  });
  bus.on('eraChanged', (e) => {
    turmoil.hit(SEVERITY.era);
    hud.notify('era', t('toast.era', { era: t('era.' + e.era) }), '#F2B54A', plural('era'));
    audio.setEra(e.era); renderer.onEra(e.era);
    if (game.state.phase === 'play') { slowmo = 1; eraTitle(e.era); }
  });
  bus.on('noteFound', () => { turmoil.hit(SEVERITY.note); hud.notify('note', t('toast.note'), '#EDE3D0', plural('note')); });
  bus.on('prestigeStart', () => { turmoil.hit(SEVERITY.epochShift); drawer.close(); renderer.beginShift(); });
  bus.on('prestige', (e) => { hud.notify('prestige', t('toast.prestige', { n: e.gain }), '#B9A6E8'); audio.whoosh(); audio.rumble(2.5); save(); });
  bus.on('echo', (e) => {
    // the echoes are off for now (config/echoes.json «on»): they come back later as an extra
    if (!(CFG.echoes as { on?: boolean }).on) return;
    const def = CFG.echoes.echoes.find((x) => x.id === e.id);
    if (!def) return;
    renderer.showEcho(def.picture, e.alpha);
    audio.echo(def.sound, e.alpha);
  });
  bus.on('displaced', (e) => hud.notify('displaced:' + e.id + ':' + e.of, t('toast.displaced', { a: t('species.' + e.id + '.name'), b: t('species.' + e.of + '.name') }), '#9cc8d8'));
  bus.on('relicFound', () => { hud.notify('relic', '⟡', '#F2B54A'); audio.fossil(false); });
  bus.on('itemChosen', () => { audio.whoosh(); });
  bus.on('element', (e) => {
    turmoil.hit(SEVERITY.element[e.id] ?? 0);
    if (e.id === 'earthquake') { renderer.onQuake(); audio.rumble(1.8); }
    else if (e.id === 'volcano' || e.id === 'meteor') audio.rumble(2.2);
    else audio.whoosh();
  });
  bus.on('temple', () => save());
  bus.on('burialWindow', () => { hud.notify('burial', t('burial.open'), '#F2B54A'); audio.chime('amber'); drawer.burialPulse = true; });
  bus.on('burial', () => {
    hud.notify('burialDone', t('burial.done'), '#F2B54A');
    audio.burial(); turmoil.hit(2);
    const p = renderer.burialPos(game);
    renderer.burst(p.x, p.y + 10, '#ffe2a0', 18); renderer.flash = 0.8;
  });
  bus.on('orderDone', (e) => { hud.notify('order', t('orders.done', { what: t('orders.' + e.id, { n: CFG.orders.pool.find((d) => d.id === e.id)?.n ?? 0 }) }), '#B9A6E8'); audio.reward(); });
  bus.on('excavationDone', () => turmoil.hit(SEVERITY.finding));
}

function save(): void {
  // nothing moves behind the menu; saving there would also lose the time the player was away
  if (paused) return;
  if (saveLocal(game)) game.state.savedAt = Date.now();
}

function swapGame(g: Game): void {
  game = g;
  bind(game);
  setLang(game.state.settings.lang);
  applySettings();
  drawer.relabel();
  drawer.close();
  modals.close();
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
hud.onRockJump = (rk) => drawer.openUpgradesAt(rk);
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
    const { state, grid, archive } = importString(s);
    swapGame(new Game(state, grid, archive));
    save();
    return true;
  } catch { return false; }
};
drawer.onReset = () => resetAll();
drawer.onDebug = () => { drawer.close(); dev.toggle(true); };
hud.onLever = (id) => drawer.openLifeAt(id);
drawer.onToast = (s) => hud.notify('sys', s, '#EDE3D0');
input.onArtifact = (shard) => { audio.unlock(); game.click(shard); renderer.onClick(game.mods.shards ? game.shardXs()[shard] : WW / 2); };
input.onCast = (x, y) => renderer.burst(x, y, '#9fd0ff', 8);
// a tap anywhere in the world: the thing answers with an impulse (the nearest shard in a shard world)
/** when the last tap counted (pile.minGapMs × Tempo between two) */
let lastPileAt = -1e9;
input.onImpulse = (x, y) => {
  audio.unlock();
  let shard = -1, ax = WW / 2;
  if (game.mods.shards) {
    const xs = game.shardXs();
    shard = xs.reduce((bi, sx, i) => (Math.abs(sx - x) < Math.abs(xs[bi] - x) ? i : bi), 0);
    ax = xs[shard];
  }
  // the thing answers with an impulse, and a pile falls into the column that was tapped
  // a tap sooner than the gap (Tempo shortens it) counts for nothing: no Energy, no pile
  const now = performance.now();
  if (now - lastPileAt < game.tapGapMs()) return;
  lastPileAt = now;
  const pile = true;
  game.tap(x, shard, pile);
  // the pile fed what the era goal needs (its lever's niche): a green flash over it
  if (pile && pileFeedsLever(game, x)) renderer.burst(x, y, '#9cc060', 10);
  renderer.onClick(ax);
  renderer.tapAt(x, y);
};
let pressStart = 0;
let lastTransforms = 0, lastTick = 0;
input.onPress = (on) => { pressStart = on ? performance.now() : 0; if (!on) audio.pressHum(0); };
input.onRare = () => {
  const p = renderer.rarePos(game);
  const id = game.claimRare();
  if (!id) return;
  audio.reward();
  if (p) renderer.burst(p.x, p.y, '#fff2c0', 14);
  hud.notify('rare', t('rare.' + id), '#F2B54A');
};
input.onBurial = () => { if (drawer.open !== 'elements') drawer.toggleView('elements'); };
input.onChoose = (i) => {
  audio.unlock();
  const items = game.availableItems();
  const id = items[i];
  if (id && game.chooseItem(id)) { renderer.beginSink(id, i, items.length); save(); }
};
modals.onNewWorld = () => { game.startNewWorld(); renderer.reveal = 0; save(); };
onLangChange(() => { drawer.relabel(); dev.build(); });
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modals.isOpen) modals.close();
  else if (e.key === 'Escape' && drawer.open && !input.targeting) drawer.close();
  if (e.key === '`' || e.key === '~' || e.key === 'ё') dev.toggle();
});
window.addEventListener('pointerdown', () => audio.unlock(), { once: true });
// Any pop-up closes when you tap anywhere outside it (the tap still does what it does there).
// Openers are left out so their own click can toggle the pop-up instead of reopening it at once.
{
  const pops: [string, string][] = [
    ['#cond-pop', '#goal, #era-name'],
    ['#rock-pop', '#rocks'],
    ['#hint-pop', '[data-tip]'],
    ['#fieldnote', ''],
    ['#tooltip', ''],
    ['#dev', '#dbg-btn'],
  ];
  document.addEventListener('pointerdown', (e) => {
    const tgt = e.target as HTMLElement;
    for (const [sel, openers] of pops) {
      const el = $(sel);
      if (el.hidden || el.contains(tgt)) continue;
      if (openers && tgt.closest(openers)) continue;
      el.hidden = true;
    }
    // the lens: taps on the world are handled by the input (another layer moves it, off the layers closes it)
    if (!tgt.closest('#lens, #geo-btn, #bed-btn, #world')) geo.closeLens();
  }, true);
}
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
if (loaded && !INTRO) offline(game.state.savedAt);
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); save(); }
  else if (hiddenAt && Date.now() - hiddenAt > 60000) offline(hiddenAt);
});
window.addEventListener('beforeunload', () => save());
setInterval(save, CFG.B.save.autosave * 1000);

// ---------- loop ----------
let last = performance.now();
/** A slow phone: if the frame rate stays under 40 for 8 s of play, quality drops to «low» once, with a note. */
let fpsAvg = 60, slowFor = 0, playFor = 0;
function watchFps(dt: number): void {
  const s = game.state.settings;
  if (dt <= 0 || game.state.phase !== 'play' || document.hidden) return;
  fpsAvg += (1 / dt - fpsAvg) * 0.05;
  playFor += dt;
  if (s.quality !== 'high' || s.autoLow || playFor < 10) return;
  slowFor = fpsAvg < 40 ? slowFor + dt : 0;
  if (slowFor < 8) return;
  s.quality = 'low';
  s.autoLow = true;
  applySettings();
  hud.notify('quality', t('settings.autoLow'), '#B9A6E8');
}

let pressHintT = 0;
/** energy absorbed since the last «+N» over the thing (one label for a few lines: the lines come in bursts) */
let absorbGain = 0, absorbLabelT = 0;
function absorbLabel(dt: number): void {
  absorbLabelT += dt;
  if (absorbLabelT < 0.8 || absorbGain <= 0 || game.state.phase !== 'play') return;
  // the thing is out of sight under an open drawer: no «+N» floating over the drawer's cards
  if (renderer.section.cut !== Infinity) { absorbGain = 0; return; }
  absorbLabelT = 0;
  const r = canvas.getBoundingClientRect();
  const x = r.left + (WW / 2 / WW) * r.width, y = r.top + ((renderer.lay.artifactY - 30) / WH) * r.height;
  const el = document.createElement('div');
  el.className = 'float-gain';
  el.append(h('span', {}, '+' + fmt(absorbGain)), pixelSpark(16));
  el.style.left = x + 'px'; el.style.top = y + 'px';
  document.body.append(el);
  setTimeout(() => el.remove(), 1400);
  absorbGain = 0;
}
function frame(now: number): void {
  const dtReal = Math.min(0.1, (now - last) / 1000);
  last = now;
  // an era change: time almost stops for a second
  let dtGame = dtReal;
  if (slowmo > 0) { slowmo -= dtReal; dtGame = dtReal * 0.08; }
  const steps = paused ? 0 : Math.min(dev.timeScale, 100);
  for (let i = 0; i < steps; i++) game.update(dtGame);
  renderer.timeMul = steps * (dtGame / Math.max(1e-6, dtReal));
  renderer.lay.update(drawerWorldPx());
  game.lowPhysics = renderer.quality === 'low';
  watchFps(dtReal);
  renderer.menuOpen = !!menu?.open;
  renderer.draw(game, dtReal, now);
  // the compaction line's label, until the strata first reach it in this world; then, at the same place, the
  // press is shown once: hold a finger on the strata to squeeze them (until the player presses, or 14 s)
  const pl = document.getElementById('pline');
  if (pl) {
    const f = game.legacy.firsts;
    if (game.run.press && !f.pressTaught) f.pressTaught = true;
    const below = game.state.phase === 'play' && game.run.sink.rows === 0;
    if (!below && game.state.phase === 'play' && !f.pressTaught) { pressHintT += dtReal; if (pressHintT > 14) f.pressTaught = true; }
    const hint = !below && game.state.phase === 'play' && !f.pressTaught;
    const show = (below || hint) && !menu.open && !renderer.geologist;   // not over the lens
    if (pl.hidden === show) pl.hidden = !show;
    toggle(pl, 'press-hint', hint);
    if (show) {
      pl.style.top = (renderer.compactLineY / WH) * 100 + '%';
      const txt = hint ? t('hud.pressHint') : t('hud.compactLine');
      if (pl.textContent !== txt) pl.textContent = txt;
    }
  }
  hud.update(game, dtReal);
  pileMix.update(dtReal);
  drawer.update(dtReal);
  input.update(dtReal);
  modals.update(dtReal);
  updateFinding();
  updateAmbi(dtReal);
  turmoil.update(dtReal);
  geo.update(dtReal);
  absorbLabel(dtReal);
  renderer.skyTop = (hud.bottomUI / 640) * WH;
  // grains on the move hiss softly; a grain turning to rock ticks (a few a second at most)
  audio.sand(game.state.phase === 'play' ? Math.min(1, game.moving / 350) : 0);
  if (game.transforms > lastTransforms) {
    if (now - lastTick > 260 + Math.random() * 200) { audio.tick(); lastTick = now; }
    lastTransforms = game.transforms;
  }
  if (pressStart) audio.pressHum(Math.min(1, (now - pressStart) / 3000) * Math.min(1.2, game.run.press?.power ?? 1));
  drawer.burialPulse = game.run.burialWindow > 0;
  if (pendingAway) { pendingAway.t -= dtReal; if (pendingAway.t <= 0) { modals.away(pendingAway.rep); pendingAway = null; } }
  const ph = game.state.phase;
  ui.classList.toggle('choosing', ph === 'choose');
  ui.classList.toggle('finale', ph === 'finale' || ph === 'temple' || ph === 'newWorld' || ph === 'end');
  ui.classList.toggle('detailed', !!game.state.settings.detailed);
  ui.classList.toggle('drawer-open', !!drawer.open && !desktop);
  document.documentElement.classList.toggle('menu-up', menu.open);
  if (!menu.open) document.documentElement.classList.remove('menu-settings');
  info.update(dtReal, desktop && !menu.open);
  if (ph !== 'play' && drawer.open && !menuSettings) drawer.close();
  // the settings opened from the menu: when the drawer closes, the menu comes back
  // a world waiting for its thing (a new one, or after the finale): the choice is made in the menu
  if (INTRO && bootDone && !menu.open && game.state.phase === 'choose') { paused = true; menu.show('thing'); }
  if (menuSettings && !drawer.open) { menuSettings = false; menu.conceal(false); ui.classList.remove('menu-settings'); menu.relabel(); }
  dev.update(dtReal);
  if (ph === 'temple') audio.choirLevel(Math.min(1, game.state.templeProgress * 1.5));
  else if (ph === 'play') audio.choirLevel(0);
  audio.setEra(game.run.era);
  requestAnimationFrame(frame);
}
fit();
requestAnimationFrame(frame);

// ---------- the loader, then the main menu ----------
const menu = new Menu();
// the skin of the menu: «c» (stone tiles, amber for the main action) is the game's; ?skin=a|b|none in the address to compare
const skinQ = new URLSearchParams(location.search).get('skin');
menu.setSkin(skinQ === 'none' ? '' : skinQ ?? 'c');
let menuSettings = false;
/** the loader has let go (the menu may open) */
let bootDone = !INTRO;
/** Leave the menu into the game; the time away is caught up (a short timelapse) if the world was already there. */
function enterGame(catchUp: boolean): void {
  menu.hide();
  paused = false;
  if (catchUp) offline(game.state.savedAt);
}
function freshGame(): Game {
  const g = new Game(newGameState());
  g.state.settings = game.state.settings;
  return g;
}
menu.onContinue = () => enterGame(true);
menu.onNew = (slot) => {
  setActiveSlot(slot);
  swapGame(freshGame());
  // the new world begins with the choice of the thing, in the menu (it is saved once chosen)
  menu.show('thing');
};
menu.things = () => game.availableItems();
menu.onThing = (id) => {
  audio.unlock();
  if (!game.chooseItem(id)) return;
  renderer.flash = 0.5;
  enterGame(false);
  save();
};
menu.onLoad = (slot) => {
  if (slot === activeSlot() && game.state.savedAt) { enterGame(true); return; }
  const l = loadSlot(slot);
  if (!l) return;
  setActiveSlot(slot);
  l.state.settings = game.state.settings;
  swapGame(new Game(l.state, l.grid, l.archive));
  enterGame(true);
};
menu.onDelete = (slot) => {
  deleteSlot(slot);
  // the world behind the menu was this one: an empty world takes its place (nothing is saved until played)
  if (slot === activeSlot()) swapGame(freshGame());
};
menu.onSettings = () => {
  // the desktop layout shows the settings in the side panel, beside the menu
  if (desktop) { drawer.toggleView('settings'); document.documentElement.classList.add('menu-settings'); return; }
  menuSettings = true;
  menu.conceal(true);
  ui.classList.add('menu-settings');
  drawer.toggleView('settings');
};
drawer.onMenu = () => {
  save();
  drawer.close();
  modals.close();
  paused = true;
  menu.show();
};
onLangChange(() => menu.relabel());
{
  const boot = (window as any).__boot as { progress(k: number): void; done(cb?: () => void): void } | undefined;
  // the weathered faces of the pixel font are used only by animations (notifications surfacing): load them now,
  // or the first animations would play before they arrive
  const fs = (document as any).fonts;
  const worn = fs ? Promise.all([1, 2, 3, 4].map((k) => fs.load(`16px 'Strata Pixel Worn ${k}'`).catch(() => null))) : Promise.resolve();
  const fonts = Promise.all([fs?.ready ?? Promise.resolve(), worn]);
  // every image of the world and the interface, and the fonts, before the loader lets go: the scene then appears
  // whole at once, not drawn in pieces
  let let_go = false;
  const finish = () => {
    if (let_go) return;
    let_go = true;
    const open = () => { bootDone = true; if (INTRO && !menu.open) menu.show(); };
    if (boot) boot.done(open); else open();
  };
  Promise.all([loadAllSkins((k) => boot?.progress(k * 0.95)), fonts]).then(() => new Promise((r) => setTimeout(r, 150))).then(finish, finish);
  // whatever happens to a file or a font, the loader lets go after a few seconds
  setTimeout(finish, 8000);
}
void energyIcon;
(window as any).__strata = { get game() { return game; }, get menu() { return menu; }, cfg: CFG, renderer, save, dev, drawer, input, modals, turmoil, away: (sec: number) => offline(Date.now() - sec * 1000),
  lang: (l: 'en' | 'ru') => { game.state.settings.lang = l; setLang(l); drawer.relabel(); } };
