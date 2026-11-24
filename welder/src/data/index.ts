import type { GameData } from './types';
import { PARTS } from './parts';
import { CUSTOMERS } from './customers';
import { INTRO, WALKIN, BOARD, FINALE } from './orders';
import { UPGRADES } from './upgrades';
import { STORY } from './story';

export const DATA: GameData = {
  parts: PARTS,
  customers: CUSTOMERS,
  intro: INTRO,
  pools: { walkin: WALKIN, board: BOARD },
  finale: FINALE,
  upgrades: UPGRADES,
  story: STORY,
};

export { BALANCE } from './balance';
export type * from './types';
