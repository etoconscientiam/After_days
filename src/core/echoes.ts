// Echoes: wordless pictures of the old world. Triggered ones show once per playthrough;
// random ones come from a timer that slows down (and fades) with each era, as if memory were wearing thin.
import { CFG, EchoDef } from '../config';
import type { Game } from './game';

const E = () => CFG.echoes;

export function echoAlpha(era: number): number {
  const a = E().alpha;
  return Math.max(a.min, a.base - a.perEra * era);
}

export function echoInterval(g: Game): number {
  const iv = E().interval;
  const base = iv.base + iv.perEra * g.run.era;
  const jit = 1 + (g.rng.next() * 2 - 1) * iv.jitter;
  return (base * jit) / (1 + g.stats.memory);
}

function show(g: Game, e: EchoDef): void {
  g.bus.emit('echo', { id: e.id, alpha: echoAlpha(g.run.era) });
}

/** Fire the common echo bound to this trigger, once per playthrough. */
export function triggerEcho(g: Game, trigger: string): void {
  const e = E().echoes.find((x) => x.trigger === trigger);
  if (!e) return;
  const seen = g.legacy.echoSeen;
  if (seen.includes(e.id)) return;
  seen.push(e.id);
  show(g, e);
}

/** The thing chosen in this playthrough, or null before the choice. */
export function currentItem(g: Game): string | null {
  return g.legacy.items[g.legacy.playthrough - 1] ?? null;
}

/** Random echo: about a third are personal (bound to the chosen thing), the rest common ones allowed in this era. */
export function randomEcho(g: Game): void {
  const item = CFG.items.find((i) => i.id === currentItem(g));
  const era = g.run.era;
  const personal = item ? E().echoes.filter((e) => e.group === item.echoGroup) : [];
  const common = E().echoes.filter((e) => e.group === 'common' && e.trigger === 'random' && e.eras && era >= e.eras[0] && era <= e.eras[1]);
  let pool: EchoDef[];
  if (personal.length && (g.rng.next() < E().personalShare || !common.length)) pool = personal;
  else pool = common;
  if (!pool.length) return;
  show(g, g.rng.pick(pool));
}
