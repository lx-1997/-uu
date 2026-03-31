/**
 * 共享 locale 工具函数。
 *
 * 统一 localStorage 中 UI 语言的读写逻辑，
 * 避免 useUIStore 和 useTerminalStore 各自维护一份重复实现。
 */

export const UI_LOCALE_KEY = 'rdk-ui-locale';

export type AppLocale = 'zh-CN' | 'en';

export function readStoredLocale(): AppLocale {
  if (typeof window === 'undefined') return 'zh-CN';
  return localStorage.getItem(UI_LOCALE_KEY) === 'en' ? 'en' : 'zh-CN';
}

export function writeStoredLocale(locale: AppLocale): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(UI_LOCALE_KEY, locale);
}
