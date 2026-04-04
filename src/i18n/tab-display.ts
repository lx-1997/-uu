import type { Tab } from '../app-types';

/** 与 `App.tsx` 顶栏、`tabs.*` 中文回退一致 */
export const TAB_TITLE_ZH: Record<Tab, string> = {
  dashboard: '工作台',
  'ai-chat-hub': 'AI 对话',
  flasher: '烧录工具',
  terminal: '终端',
  files: '文件',
  vnc: '远程桌面',
  ide: 'IDE',
  openclaw: 'OpenClaw',
  hardware: '硬件监控',
  skills: '技能工坊',
  'dr-embed': '生态网页',
  'local-models': '本地模型',
};

/** 使用与 `useI18n().t` 相同的 `translate` 封装 */
export function tabDisplayTitle(t: (key: string, zh: string) => string, tab: Tab | string): string {
  const zh = TAB_TITLE_ZH[tab as Tab] ?? String(tab);
  return t(`tabs.${tab}`, zh);
}
