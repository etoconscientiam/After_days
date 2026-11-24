/** Typed event bus. Systems talk through it; payloads are small and events are sparse (never per frame). */
export class Bus<E extends { [K in keyof E]: unknown }> {
  private map = new Map<keyof E, Array<(p: never) => void>>();

  on<K extends keyof E>(type: K, fn: (p: E[K]) => void): () => void {
    let list = this.map.get(type);
    if (!list) this.map.set(type, (list = []));
    list.push(fn as (p: never) => void);
    return () => {
      const l = this.map.get(type);
      if (l) l.splice(l.indexOf(fn as (p: never) => void), 1);
    };
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const list = this.map.get(type);
    if (!list) return;
    for (let i = 0; i < list.length; i++) (list[i] as (p: E[K]) => void)(payload);
  }
}
