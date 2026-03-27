import { EN } from './en';

/** 与 `useI18n().t` 一致：英文用 EN 表，缺省回退 zh 文案 */
export function translate(isEn: boolean, key: string, zh: string): string {
  if (!isEn) return zh;
  return EN[key] ?? zh;
}
