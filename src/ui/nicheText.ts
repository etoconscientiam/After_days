// What a species needs from the surface, in words (the Life tab, the lever of the era goal).
import { CFG, SpeciesDef } from '../config';
import type { Game } from '../core/game';
import { needs } from '../core/niche';
import { t, fmt } from './i18n';

export const shortName = (s: string) => (s.includes('—') ? s.split('—')[1].trim() : s);

/** What a species needs from the surface, as one line: every need with what there is now (missing only: the
 *  needs not met at least halfway). */
export function needText(g: Game, sp: SpeciesDef, missingOnly: boolean, bare = false): string {
  const parts: string[] = [];
  for (const n of needs(g, sp)) {
    if (missingOnly && n.ok >= CFG.B.niche.openAt) continue;
    if (n.kind === 'mix') parts.push(t('niche.mixItem', { g: t('niche.g.' + n.key), have: fmt(n.have * 100, 0), need: fmt(n.need * 100, 0) }));
    else if (n.kind === 'deep') parts.push(t('niche.deepItem', { have: fmt(n.have, 1), need: fmt(n.need, 0) }));
    else parts.push(t('niche.foodItem', { list: (n.foods ?? []).map((f) => shortName(t('species.' + f + '.name'))).join(t('niche.or')) }));
  }
  if (!parts.length) return '';
  return bare ? parts.join('; ') : t('niche.need', { list: parts.join('; ') });
}
