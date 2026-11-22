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

/** Short number: 999, 1,2 тыс., 3,4 млн, 5,6 млрд, 7,8 трлн / 1.2K…; later 1.2e21. Never "1 000 млрд":
 *  the value is rounded first, then the tier is chosen. */
export function fmt(n: number, digits = 1): string {
  if (!isFinite(n)) return '∞';
  const sign = n < 0 ? -1 : 1;
  let a = Math.abs(n);
  const roundTo = (v: number, d: number) => { const p = 10 ** d; return Math.round(v * p) / p; };
  if (a < 1000) {
    const d = a < 10 ? digits : a < 100 ? Math.min(1, digits) : 0;
    const r = roundTo(a, d);
    if (r < 1000) return plain(sign * r, d);
    a = 1000;
  }
  let tier = Math.floor(Math.log10(a) / 3);
  let v = a / 10 ** (tier * 3);
  let d = v < 100 ? digits : 0;
  v = roundTo(v, d);
  if (v >= 1000) { tier++; v = roundTo(v / 1000, digits); d = digits; }
  if (tier >= SUFFIX.en.length) {
    const s = (sign * a).toExponential(2);
    return lang === 'ru' ? s.replace('.', ',') : s;
  }
  return plain(sign * v, d) + SUFFIX[lang][tier];
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
