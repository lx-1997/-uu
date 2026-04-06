import type { Tab } from '../app-types';

const PARAM_EMBED = 'rdkEmbed';
const PARAM_DOCK_CTX = 'dockCtx';

export type RdkEmbedPanel = 'ai-dock' | 'openclaw';

const TAB_SET: ReadonlySet<string> = new Set<Tab>([
  'dashboard',
  'flasher',
  'terminal',
  'files',
  'vnc',
  'ide',
  'openclaw',
  'hardware',
  'skills',
]);

/** 解析 ?rdkEmbed=ai-dock | openclaw */
export function getRdkEmbedPanel(): RdkEmbedPanel | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = new URLSearchParams(window.location.search).get(PARAM_EMBED)?.trim().toLowerCase();
    if (!raw) return null;
    if (raw === 'ai-dock' || raw === 'claw' || raw === 'dock' || raw === 'chat') return 'ai-dock';
    if (raw === 'openclaw' || raw === 'oc') return 'openclaw';
    return null;
  } catch {
    return null;
  }
}

/** 副屏对话里用于快捷指令/语境的 Tab（不改变主窗口路由，仅影响 Dock 提示条） */
export function getRdkEmbedDockCtx(): Tab | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = new URLSearchParams(window.location.search).get(PARAM_DOCK_CTX)?.trim();
    if (!raw || !TAB_SET.has(raw)) return null;
    return raw as Tab;
  } catch {
    return null;
  }
}

export function buildRdkEmbedUrl(panel: RdkEmbedPanel, opts?: { dockCtx?: Tab }): string {
  const u = new URL(typeof window !== 'undefined' ? window.location.href : 'http://localhost:5173/');
  u.searchParams.set(PARAM_EMBED, panel === 'ai-dock' ? 'ai-dock' : 'openclaw');
  if (opts?.dockCtx) u.searchParams.set(PARAM_DOCK_CTX, opts.dockCtx);
  return u.toString();
}

/** 在独立浏览器窗口中打开 RDKClaw 对话副屏 */
export function openRdkClawChatPopout(opts?: { dockCtx?: Tab }) {
  const url = buildRdkEmbedUrl('ai-dock', opts);
  const w = Math.min(520, typeof window !== 'undefined' ? window.screen.availWidth - 80 : 520);
  const h = Math.min(720, typeof window !== 'undefined' ? window.screen.availHeight - 80 : 720);
  const feats = `popup=yes,width=${w},height=${h},noopener,noreferrer`;
  window.open(url, 'rdkstudio-rdkclaw-chat', feats);
}

/** OpenClaw 整页副屏（可与主窗口并排查看套件端效果） */
export function openOpenClawPopout() {
  const url = buildRdkEmbedUrl('openclaw');
  const w = Math.min(900, typeof window !== 'undefined' ? window.screen.availWidth - 48 : 900);
  const h = Math.min(800, typeof window !== 'undefined' ? window.screen.availHeight - 48 : 800);
  const feats = `popup=yes,width=${w},height=${h},noopener,noreferrer`;
  window.open(url, 'rdkstudio-openclaw-panel', feats);
}
