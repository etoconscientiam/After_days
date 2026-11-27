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
}

const KEY = 'welder.settings';
const DEFAULTS: Settings = { volume: 0.8, soft: false, fastText: false, autoTurn: true };

function load(): Settings {
  try {
    const s = localStorage.getItem(KEY);
    if (s) return { ...DEFAULTS, ...(JSON.parse(s) as Partial<Settings>) };
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
