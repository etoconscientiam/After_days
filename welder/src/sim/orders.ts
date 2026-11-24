import type { GameData, OrderTemplate, Requirement } from '../data/types';
import type { Rng } from '../core/rng';

export interface Order {
  uid: number;
  part: string;
  customer: string;
  reward: number;
  req: Requirement;
  simple: boolean;
  urgent: boolean;
}

export function makeOrder(data: GameData, t: OrderTemplate, uid: number, rng: Rng, urgent = false): Order {
  return {
    uid,
    part: t.part,
    customer: t.customer,
    reward: rng.int(t.reward[0], t.reward[1]),
    req: { ...(t.req ?? {}) },
    simple: data.parts[t.part].simple,
    urgent,
  };
}

/** Pick a board order from the pool, avoiding too many repeats of what is already pinned. */
export function rollBoardOrder(data: GameData, board: Order[], uid: number, rng: Rng): Order {
  const pool = data.pools.board;
  const t = rng.weighted(pool, (o) => {
    const same = board.filter((b) => b.part === o.part).length;
    return (o.weight ?? 1) / (1 + same * 2);
  });
  return makeOrder(data, t, uid, rng);
}
