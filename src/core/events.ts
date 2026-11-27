// Tiny typed event bus between core and render/ui/audio.
export interface GameEvents {
  layerDeposited: { count: number };
  rockTransformed: { rock: string; amount: number; x: number; depth: number };
  rockDiscovered: { rock: string };
  fossilFound: { species: string; rare: boolean; fragment: boolean; complete: boolean; x: number; depth: number };
  extinction: { cause: string; killed: number };
  eraChanged: { era: number };
  noteFound: { id: string };
  prestigeStart: {};
  prestige: { gain: number };
  temple: { ritual: string };
  click: { energy: number; boost: number };
  /** the thing absorbed a line of the strata (core/absorb.ts) */
  /** the thing absorbed a line of the strata (its particles, for the animation) */
  absorb: { energy: number; mat: string; value: number; mats: Uint8Array; looks: Uint8Array; gains: Record<string, number> };
  /** a tapped pile buried rooted life (n units of species id), its organics sealed under it */
  lifeBuried: { id: string; n: number; x: number };
  bell: { x: number };
  /** a unit of a species arose on its own (first: the species was not there before) */
  wildBorn: { id: string; zi: number; first: boolean };
  /** a wild unit died as its niche shrank (last: the species is gone) */
  wildDied: { id: string; zi: number; last: boolean };
  /** gas or oil seeped out at the surface (particle column x, row y) */
  seep: { x: number; y: number; oil: boolean };
  /** a buried lens of water broke out: vent column x, the lens's top row y0 and the vent's row y1, n particles */
  geyser: { x: number; y0: number; y1: number; n: number };
  element: { id: string; x?: number; depth?: number };
  echo: { id: string; alpha: number };
  relicFound: { id: string };
  displaced: { id: string; of: string; n: number };
  itemChosen: { id: string };
  speciesUnlocked: { id: string };
  toast: { key: string; vars?: Record<string, string | number>; color?: string };
  excavationDone: {};
  bedLaid: { mat: string; n: number };
  rareSpawn: { id: string; x: number };
  rareClaimed: { id: string; x: number };
  burialWindow: { x: number };
  burial: { id: string; x: number };
  orderDone: { id: string };
  offline: { years: number; layers: number; rocks: Record<string, number>; fossils: number; notes: string[]; seconds: number };
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private handlers: { [K in keyof GameEvents]?: Handler<GameEvents[K]>[] } = {};
  muted = false;
  on<K extends keyof GameEvents>(type: K, h: Handler<GameEvents[K]>): () => void {
    (this.handlers[type] ??= [] as any).push(h);
    return () => {
      const arr = this.handlers[type] as Handler<GameEvents[K]>[];
      const i = arr.indexOf(h);
      if (i >= 0) arr.splice(i, 1);
    };
  }
  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    if (this.muted) return;
    const arr = this.handlers[type] as Handler<GameEvents[K]>[] | undefined;
    if (arr) for (const h of arr) h(payload);
  }
}
