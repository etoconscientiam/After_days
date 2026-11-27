import { Game } from '../src/sim/game';
import { DATA } from '../src/data';
import { Autopilot } from '../src/sim/autopilot';
import { emptyTorch } from '../src/sim/weld';
for (const part of ['kettle', 'spear', 'pan', 'helmet', 'relic']) {
  const g = new Game(DATA, 1);
  g.showcase(part, 'keeper');
  const ap = new Autopilot();
  const tr = emptyTorch();
  const ev: string[] = [];
  g.bus.on('weldDone', () => ev.push('weld ' + g.t.toFixed(1)));
  g.bus.on('revealed', (e) => ev.push('rev ' + g.t.toFixed(1) + ' ' + e.grade + ' ' + e.quality.toFixed(2)));
  g.bus.on('arcOut', (e) => ev.push('out:' + e.reason));
  while (g.t < 12 && g.player.stage !== 'ready') { ap.step(g, tr); g.step({ torch: tr }); }
  console.log(part, 'I', g.power.I.toFixed(2), ev.join(' '));
  g.reset();
  console.log('  reset', g.started, Object.keys(g.owned).length, g.player.stage, g.t);
}
