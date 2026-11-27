import { t, has } from '../i18n';
import type { Game } from '../sim/game';
import type { Order } from '../sim/orders';
import type { GradeId } from '../data/types';

/** What a customer says bringing this job: by how often they have come and how the last job turned out. */
export function bringLine(g: Game, o: Order): string {
  const c = o.customer;
  const own = (k: string) => (has(`say.${c}.${k}`) ? t(`say.${c}.${k}`) : '');
  if (o.urgent) return own('gate') || own('more') || t('say.any.more');
  if (o.ret) return own('back') || t('say.any.back');
  const n = g.visits[c] ?? 0;
  const last = g.lastGrade[c];
  if (own(String(n))) return (last === 'bad' || last === 'rough' ? own(n + 'b') : '') || own(String(n));
  return own('more') || t(n === 0 ? 'say.any.0' : 'say.any.more');
}

/** What they say taking it, by how it came out. */
export function replyLine(customer: string, grade: GradeId): string {
  const k = grade === 'clean' ? 'good' : grade === 'fair' ? 'ok' : 'bad';
  return has(`re.${customer}.${k}`) ? t(`re.${customer}.${k}`) : t(`re.any.${k}`);
}
