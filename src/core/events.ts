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
  element: { id: string; x?: number; depth?: number };
  echo: { id: string; alpha: number };
  relicFound: { id: string };
  itemChosen: { id: string };
  speciesUnlocked: { id: string };
  toast: { key: string; vars?: Record<string, string | number>; color?: string };
  excavationDone: {};
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
