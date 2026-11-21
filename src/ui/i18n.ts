// i18n: all visible text comes from config/i18n/*.json. Numbers are formatted per language.
import en from '../config/i18n/en.json';
import ru from '../config/i18n/ru.json';

export type Lang = 'en' | 'ru';
const DICTS: Record<Lang, any> = { en, ru };
let lang: Lang = 'en';
const listeners: (() => void)[] = [];

export function setLang(l: Lang): void {
  lang = l;
  document.documentElement.lang = l;
  listeners.forEach((f) => f());
}
export function getLang(): Lang { return lang; }
export function onLangChange(f: () => void): void { listeners.push(f); }

function lookup(d: any, key: string): any {
  let v = d;
  for (const p of key.split('.')) { v = v?.[p]; if (v === undefined) return undefined; }
  return v;
}

export function t(key: string, vars?: Record<string, string | number>): string {
  let s = lookup(DICTS[lang], key);
  if (s === undefined) s = lookup(DICTS.en, key);
  if (typeof s !== 'string') return key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_: string, k: string) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`));
  return s;
}

export function has(key: string): boolean {
  return typeof lookup(DICTS[lang], key) === 'string';
}

const SUFFIX: Record<Lang, string[]> = {
  en: ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi'],
  ru: ['', ' тыс.', ' млн', ' млрд', ' трлн', ' квдр', ' квнт'],
};

function plain(n: number, digits: number): string {
  return n.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

/** Short number: 1.2K / 1,2 тыс., later 1.2e21. */
export function fmt(n: number, digits = 1): string {
  if (!isFinite(n)) return '∞';
  const a = Math.abs(n);
  if (a < 1000) return plain(n, a < 10 ? digits : a < 100 ? Math.min(1, digits) : 0);
  const tier = Math.floor(Math.log10(a) / 3);
  if (tier >= SUFFIX.en.length) {
    const s = n.toExponential(2);
    return lang === 'ru' ? s.replace('.', ',') : s;
  }
  const v = n / 10 ** (tier * 3);
  return plain(v, v < 100 ? digits : 0) + SUFFIX[lang][tier];
}

/** Integer with grouping: 98 000 / 98,000. */
export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US');
}

export function fmtTime(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  if (h > 0) return `${h}h ${m}m`.replace('h', lang === 'ru' ? 'ч' : 'h').replace('m', lang === 'ru' ? 'м' : 'm');
  return `${m}:${String(s).padStart(2, '0')}`;
}
