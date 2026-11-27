import { en, StrKey } from './en';
import { ru } from './ru';
import { talkEn, talkRu } from './talk';

export type Lang = 'en' | 'ru';
const tables = { en: { ...en, ...talkEn }, ru: { ...ru, ...talkRu } };
let lang: Lang = 'en';

export function setLang(l: Lang): void {
  lang = l;
}
export function getLang(): Lang {
  return lang;
}

/** Translate a key, filling {placeholders}. Unknown keys come back as the key itself. */
export function t(key: string, params?: Record<string, string | number>): string {
  let s: string = (tables[lang] as Record<string, string>)[key] ?? (tables.en as Record<string, string>)[key] ?? key;
  if (params) for (const k in params) s = s.split('{' + k + '}').join(String(params[k]));
  return s;
}

export type { StrKey };

/** Whether a key has words in some language (for lines that fall back to a general one). */
export function has(key: string): boolean {
  return key in tables.en || key in tables.ru;
}
