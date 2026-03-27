import { translate } from './translate';

/** 与 `useUIStore` 持久化语言键一致（`rdk-ui-locale`），勿改 */
const UI_LOCALE_STORAGE_KEY = 'rdk-ui-locale';

/** SSO 全屏页在 AppProvider 外渲染，与 useUIStore 使用同一 locale 键 */
export function ssoTranslate(key: string, zh: string): string {
  try {
    const isEn =
      typeof localStorage !== 'undefined' && localStorage.getItem(UI_LOCALE_STORAGE_KEY) === 'en';
    return translate(isEn, key, zh);
  } catch {
    return zh;
  }
}
