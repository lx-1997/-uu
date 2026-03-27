/**
 * Client Action Dispatcher
 *
 * Handles UI-only actions that cannot be expressed as REST API calls.
 * These are dispatched by the Agent when it returns [[action:...]] tags.
 */

import type { Tab } from '../app-types';
import { fillTemplate } from '../i18n/en-extras';
import { translate } from '../i18n/translate';
import { tabDisplayTitle } from '../i18n/tab-display';
import type { ClientActionType } from './types';

export interface ActionDispatchContext {
  setActiveTab: (tab: Tab) => void;
  openWorkspace: (tab: Tab, message: string) => void;
  setShowSettings: (v: boolean) => void;
  startVncSession: () => void;
  createSession: () => void;
  setDiagnosticOpen: (v: boolean) => void;
  scanForDevices: () => void;
  runFlowValidation: () => void;
  addToast: (message: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
  /** 与 Studio 语言一致；缺省中文 */
  locale?: 'zh-CN' | 'en';
}

const TAB_ALIASES: Record<string, Tab> = {
  dashboard: 'dashboard',
  flasher: 'flasher',
  flash: 'flasher',
  terminal: 'terminal',
  files: 'files',
  vnc: 'vnc',
  ide: 'ide',
  lowcode: 'lowcode',
  workflow: 'lowcode',
  openclaw: 'openclaw',
  hardware: 'hardware',
  examples: 'examples',
  ros: 'ros',
  models: 'models',
  // Chinese aliases
  '仪表盘': 'dashboard',
  '首页': 'dashboard',
  '烧录': 'flasher',
  '终端': 'terminal',
  '文件': 'files',
  '桌面': 'vnc',
  '编辑': 'ide',
  '编排': 'lowcode',
  '硬件': 'hardware',
  '示例': 'examples',
  '模型': 'models',
};

export function resolveTab(input: string): Tab | null {
  return TAB_ALIASES[input.toLowerCase()] ?? null;
}

export function dispatchAction(action: ClientActionType, ctx: ActionDispatchContext): void {
  switch (action.type) {
    case 'navigate': {
      const isEn = ctx.locale === 'en';
      const t = (key: string, zh: string) => translate(isEn, key, zh);
      const msg = fillTemplate(translate(isEn, 'orc.workspace.opening', '正在打开 {{tab}}…'), {
        tab: tabDisplayTitle(t, action.tab),
      });
      ctx.openWorkspace(action.tab, msg);
      break;
    }
    case 'openSettings':
      ctx.setShowSettings(true);
      break;
    case 'openVnc':
      ctx.startVncSession();
      break;
    case 'createTerminal':
      ctx.createSession();
      ctx.setActiveTab('terminal');
      break;
    case 'startDiagnostic':
      ctx.setDiagnosticOpen(true);
      break;
    case 'scanDevices':
      ctx.scanForDevices();
      break;
    case 'runFlowValidation':
      ctx.runFlowValidation();
      break;
    case 'toast':
      ctx.addToast(action.message, action.level);
      break;
  }
}

/**
 * Parse a raw action string from SKILL.md Client Actions section.
 * e.g. "navigate:terminal" → { type: 'navigate', tab: 'terminal' }
 */
export function parseClientAction(raw: string): ClientActionType | null {
  const [type, target] = raw.split(':');
  if (!type) return null;

  switch (type.trim()) {
    case 'navigate': {
      const tab = resolveTab(target?.trim() || '');
      return tab ? { type: 'navigate', tab } : null;
    }
    case 'openSettings':
      return { type: 'openSettings' };
    case 'openVnc':
      return { type: 'openVnc' };
    case 'createTerminal':
      return { type: 'createTerminal' };
    case 'startDiagnostic':
      return { type: 'startDiagnostic' };
    case 'scanDevices':
      return { type: 'scanDevices' };
    case 'runFlowValidation':
      return { type: 'runFlowValidation' };
    default:
      return null;
  }
}
