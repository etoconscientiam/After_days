import type { Game } from './sim/game';
import { emptyTorch, snapFace } from './sim/weld';
import { seamPoint } from './sim/seam';
import { idealSpeed } from './sim/quality';

/**
 * Console helpers for tuning the look of the bead: weld a part synchronously with a scripted hand,
 * then chip it, so different tempos and arc lengths can be compared side by side.
 *   welder.demo({ part: 'spade', speed: 1, arc: 2.5, wobble: 0.5 })
 */
export function demoWeld(game: Game, o: { part?: string; speed?: number; arc?: number; wobble?: number; jerk?: number; chip?: boolean; cool?: number; current?: boolean } = {}): { q: number; grade: string } {
  const part = o.part ?? 'spade';
  const speed = o.speed ?? 1;
  const L = o.arc ?? 2.5;
  const wob = o.wobble ?? 0.4;
  const jerk = o.jerk ?? 0;
  if (!game.started) game.queue({ type: 'start' });
  game.step({ torch: emptyTorch() });
  const b = game.player;
  if (!o.current || !b.part) {
    b.clear();
    const order = { uid: 9000 + Math.floor(game.t), part, customer: 'neighbour', reward: 1, req: {}, simple: false, urgent: false };
    b.load(order, game.data.parts[part]);
    game.bus.emit('orderTaken', { bench: 'player', uid: order.uid, part });
  }
  const partId = b.part!.id;
  const tr = emptyTorch();
  const pt = seamPoint();
  tr.has = true;
  let t = 0;
  for (let si = 0; si < b.seams.length; si++) {
    const sr = b.seams[si];
    let s = -2;
    let guard = 0;
    while (s < sr.len + 1 && guard++ < 60 * 90) {
      t += 1 / 60;
      const v = idealSpeed(game.data.parts[partId].thick, game.power.I) * speed * (1 + jerk * Math.sin(t * 2.3) * Math.sin(t * 0.7 + 1));
      if (b.arc.lit) s += v / 60;
      const sc = Math.max(0, Math.min(sr.len, s));
      if (game.t % 0.25 < 1 / 60 || !b.arc.lit) snapFace(b, si, sc);
      sr.pointAt(sc, pt);
      const lat = wob * Math.sin(t * 5.1) + wob * 0.5 * Math.sin(t * 13.7);
      const scr = b.arc.lit ? 0 : Math.sin(t * 60) * 5;
      tr.x = pt.x + pt.bx * lat + pt.tx * scr;
      tr.y = pt.y + pt.by * lat + pt.ty * scr;
      tr.z = pt.z + pt.bz * lat + pt.tz * scr;
      tr.press = true;
      tr.forceL = L;
      if (b.electrode < 0.05) b.electrode = 1;
      game.step({ torch: tr });
    }
    tr.press = false;
    game.step({ torch: tr });
  }
  tr.forceL = NaN;
  if (b.stage === 'chip' && o.chip !== false) {
    for (let k = 0; k < 200 && b.stage === 'chip'; k++) {
      let found = false;
      for (const sr of b.seams) {
        for (let c = 0; c < sr.n; c++)
          if (sr.slag[c] > 0) {
            sr.pointAt((c + 0.5) * sr.cell + 3, pt);
            tr.x = pt.x;
            tr.y = pt.y;
            tr.z = pt.z;
            found = true;
            break;
          }
        if (found) break;
      }
      tr.press = true;
      game.step({ torch: tr });
      tr.press = false;
      for (let i = 0; i < 8; i++) game.step({ torch: tr });
    }
  }
  for (let i = 0; i < 60 * (o.cool ?? 4); i++) game.step({ torch: tr });
  return { q: Math.round(b.quality * 100) / 100, grade: b.grade };
}
