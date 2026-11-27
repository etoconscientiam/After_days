/**
 * The estate: a plan of the land round the workshop. In the middle the house with the workshop; the river
 * down the west side, the road out east to the market; plots round the house to buy and build on.
 * Coordinates are in the plan's own pixels (320×200).
 */

export type ShopKind = 'wheel' | 'pots' | 'arms' | 'relic';
export type PlotKind = 'river' | 'road' | 'plain';

export interface ShopKindDef {
  /** What building it costs. */
  cost: number;
  /** Seconds to make one thing, at the first level. */
  cycle: number;
  /** What one thing fetches at the market, made well. */
  base: number;
  /** What it costs to keep going, every pay day, per level. */
  upkeep: number;
  /** The parts of its trade: welding one of these at your bench shows its hands how. */
  parts: string[];
}

export const SHOP_KINDS: Record<ShopKind, ShopKindDef> = {
  wheel: { cost: 40, cycle: 14, base: 9, upkeep: 1, parts: ['wheel', 'spade'] },
  pots: { cost: 80, cycle: 18, base: 15, upkeep: 2, parts: ['kettle', 'pan', 'bucket', 'cauldron'] },
  arms: { cost: 150, cycle: 26, base: 28, upkeep: 3, parts: ['spear', 'helmet', 'grate'] },
  relic: { cost: 260, cycle: 40, base: 52, upkeep: 4, parts: ['relic'] },
};
export const SHOP_ORDER: ShopKind[] = ['wheel', 'pots', 'arms', 'relic'];

export interface PlotDef {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: PlotKind;
  price: number;
}

export const ESTATE = {
  W: 320,
  H: 200,
  home: { x: 136, y: 80, w: 48, h: 40 },
  /** Where things are sold (the courier walks there). */
  market: { x: 296, y: 100 },
  plots: [
    { id: 'nw', x: 58, y: 18, w: 54, h: 40, kind: 'river', price: 50 },
    { id: 'n', x: 133, y: 14, w: 54, h: 40, kind: 'plain', price: 35 },
    { id: 'ne', x: 208, y: 18, w: 54, h: 40, kind: 'road', price: 60 },
    { id: 'w', x: 58, y: 80, w: 54, h: 40, kind: 'river', price: 50 },
    { id: 'e', x: 208, y: 120, w: 54, h: 40, kind: 'road', price: 60 },
    { id: 'sw', x: 58, y: 142, w: 54, h: 40, kind: 'river', price: 50 },
    { id: 's', x: 133, y: 146, w: 54, h: 40, kind: 'plain', price: 35 },
  ] as PlotDef[],
};

/** Which trade a part belongs to. */
export function kindOfPart(part: string): ShopKind | null {
  for (const k of SHOP_ORDER) if (SHOP_KINDS[k].parts.includes(part)) return k;
  return null;
}
