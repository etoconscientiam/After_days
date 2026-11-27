/**
 * The estate: a plan of the land round the workshop. In the middle the house with the workshop; the river
 * down the west side, the road out east to the market; plots round the house to buy and build on.
 * Coordinates are in the plan's own pixels (360×220).
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
  W: 360,
  H: 220,
  /** The house's yard (the house stands in it, its door at the bottom). */
  home: { x: 136, y: 66, w: 72, h: 58 },
  /** Where things are sold: the market before the town gate. */
  market: { x: 300, y: 114 },
  /** The town wall's west face and the gate in it. */
  wallX: 326,
  gateY: 110,
  /** The bridge over the river (its y), for walking to the west bank. */
  bridgeY: 140,
  plots: [
    { id: 'nw', x: 16, y: 18, w: 62, h: 46, kind: 'river', price: 50 },
    { id: 'n', x: 146, y: 8, w: 62, h: 46, kind: 'plain', price: 35 },
    { id: 'ne', x: 232, y: 24, w: 62, h: 46, kind: 'road', price: 60 },
    { id: 'w', x: 16, y: 86, w: 62, h: 46, kind: 'river', price: 50 },
    { id: 'e', x: 232, y: 148, w: 62, h: 46, kind: 'road', price: 60 },
    { id: 'sw', x: 16, y: 156, w: 62, h: 46, kind: 'river', price: 50 },
    { id: 's', x: 146, y: 164, w: 62, h: 46, kind: 'plain', price: 35 },
  ] as PlotDef[],
};

/** The river's middle at height y (it winds down the west of the house). */
export function riverX(y: number): number {
  return 104 + 9 * Math.sin(y * 0.028) + 3 * Math.sin(y * 0.085);
}
export const RIVER_W = 22;

/** Which trade a part belongs to. */
export function kindOfPart(part: string): ShopKind | null {
  for (const k of SHOP_ORDER) if (SHOP_KINDS[k].parts.includes(part)) return k;
  return null;
}
