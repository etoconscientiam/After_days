import { en, StrKey } from './en';
import { ru } from './ru';

export type Lang = 'en' | 'ru';
const tables = { en, ru };
let lang: Lang = 'en';

export function setLang(l: Lang): void {
  lang = l;
}
export function getLang(): Lang {
  return lang;
}

/** Translate a key, filling {placeholders}. Unknown keys come back as the key itself. */
export function t(key: string, params?: Record<string, string | number>): string {
  let s: string = (tables[lang] as Record<string, string>)[key] ?? (en as Record<string, string>)[key] ?? key;
  if (params) for (const k in params) s = s.split('{' + k + '}').join(String(params[k]));
  return s;
}

export type { StrKey };
