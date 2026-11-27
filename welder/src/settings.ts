/** The player's settings: kept in the browser, read by the game, the intro and the sound. */
export interface Settings {
  /** Master volume 0..1. */
  volume: number;
  /** Softer flashes, glare and shake. */
  soft: boolean;
  /** The intro's text types faster. */
  fastText: boolean;
  /** The work turns to its next joint by itself. */
  autoTurn: boolean;
  /** Version of the defaults the stored settings were made with. */
  v?: number;
}

const KEY = 'welder.settings';
const DEFAULTS: Settings = { volume: 0.8, soft: false, fastText: false, autoTurn: false, v: 2 };

function load(): Settings {
  try {
    const s = localStorage.getItem(KEY);
    if (s) {
      const got = JSON.parse(s) as Partial<Settings>;
      // Before v2 the work turned by itself unless told otherwise; now it doesn't unless asked.
      if ((got.v ?? 1) < 2) delete got.autoTurn;
      return { ...DEFAULTS, ...got, v: 2 };
    }
  } catch {
    /* storage may be blocked */
  }
  return { ...DEFAULTS };
}

export const settings: Settings = load();
const listeners: (() => void)[] = [];

/** Change some settings, keep them, and tell whoever listens. */
export function setSettings(p: Partial<Settings>): void {
  Object.assign(settings, p);
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
  for (const f of listeners) f();
}

export function onSettings(f: () => void): void {
  listeners.push(f);
}
