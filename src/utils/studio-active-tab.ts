import type { Tab } from '../app-types';
import { normalizeTabForFeatures } from '../constants/studio-features';

const STORAGE_KEY = 'rdk-studio-active-tab';

const KNOWN: ReadonlySet<Tab> = new Set([
  'dashboard',
  'ai-chat-hub',
  'flasher',
  'terminal',
  'files',
  'vnc',
  'ide',
  'openclaw',
  'hardware',
  'skills',
  'dr-embed',
  'local-models',
]);

/**
 * 恢复上次停留的 Tab（经特性开关归一化）。
 * 无效或缺失时回到工作台。
 */
export function readStoredActiveTab(): Tab {
  if (typeof window === 'undefined') return 'dashboard';
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return 'dashboard';
    const tab = raw as Tab;
    if (!KNOWN.has(tab)) return 'dashboard';
    /** 内嵌门户依赖桌面端本次 `openUrl` 会话，刷新后无法还原，勿从存储恢复 */
    if (tab === 'dr-embed') return 'dashboard';
    return normalizeTabForFeatures(tab);
  } catch {
    return 'dashboard';
  }
}

export function persistActiveTab(tab: Tab): void {
  if (typeof window === 'undefined') return;
  try {
    const normalized = normalizeTabForFeatures(tab);
    localStorage.setItem(STORAGE_KEY, normalized);
  } catch {
    /* quota */
  }
}
