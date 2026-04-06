/**
 * 识别助手回复中的「客户端动作」标签，在 RDK Studio 桌面端触发主进程能力。
 *
 * 支持示例（与部分模型/文档中的协议对齐）：
 *   <client-action name="openBrowser" payload="https://www.baidu.com" />
 *   <client-action name="closeBrowser" />
 *   <client-action name="navigateTab" tab="ide" />
 *   <client-action name="embedFloat" target="ide" enabled="true" />
 *
 * 以及 RDKClaw 约定（纯文本，由服务端提示词引导）：
 *   [[action:navigate|ide]]
 *   [[action:embedFloat|ide]]  /  [[action:embedFloat|ide:false]]
 */
import type { Tab } from '../app-types';
import { dispatchStudioAgentWebClose } from './studio-agent-web';
import { tryConsumeStudioOpenSlot } from './studio-open-url-dedup';

const CLIENT_ACTION_BLOCK_RE = /<client-action\b([^>]*)\s*(?:\/>|>[\s\S]*?<\/client-action\s*>)/gi;

const VALID_TABS = new Set<string>([
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

/** 兼容模型偶发全角竖线 ｜ */
const LEGACY_NAV_RE = /\[\[action:navigate[|｜]([^\]]+)\]\]/gi;
const LEGACY_EMBED_RE = /\[\[action:embedFloat[|｜]([^\]]+)\]\]/gi;

export type StudioClientActionHandlers = {
  /** 切换主导航 Tab（与左侧栏一致） */
  navigateTab?: (tab: Tab) => void;
  /** IDE/VNC 嵌入区浮出或贴回；仅在对应页已挂载 showIframe 时有效 */
  setEmbedFloat?: (target: 'ide' | 'vnc', enabled: boolean) => void;
};

let studioHandlers: StudioClientActionHandlers = {};

export function registerStudioClientActionHandlers(h: StudioClientActionHandlers) {
  studioHandlers = h;
}

function readAttr(attrs: string, key: string): string {
  const re = new RegExp(`\\b${key}\\s*=\\s*(["'])((?:\\\\.|[^\\\\])*?)\\1`, 'i');
  const m = attrs.match(re);
  return m ? String(m[2] || '').trim() : '';
}

function coerceHttpPageUrl(raw: string): string | null {
  let u = String(raw || '').trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) {
    if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(\/.*)?$/i.test(u)) u = `https://${u}`;
    else return null;
  }
  try {
    const p = new URL(u);
    if (p.protocol !== 'http:' && p.protocol !== 'https:') return null;
    return p.toString();
  } catch {
    return null;
  }
}

/** 与 studio_open_url 一致：优先独立可缩放弹窗；失败则用系统浏览器新标签 */
async function openBrowserForClientAction(url: string): Promise<void> {
  if (!tryConsumeStudioOpenSlot(url)) return;
  const rdk =
    typeof window !== 'undefined'
      ? (window as unknown as {
          rdkDesktop?: {
            openUrl?: (t: string | object) => void;
            setActiveUrl?: (u: string) => void;
            openAgentBrowserPopup?: (u: string) => Promise<{ ok?: boolean }>;
          };
        }).rdkDesktop
      : undefined;
  if (rdk?.openAgentBrowserPopup) {
    const r = await rdk.openAgentBrowserPopup(url);
    if (r?.ok) return;
  }
  try {
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch {
    /* ignore */
  }
}

function scheduleEmbedFloat(target: 'ide' | 'vnc', enabled: boolean) {
  window.setTimeout(() => {
    studioHandlers.setEmbedFloat?.(target, enabled);
  }, 480);
}

function applyNavigateTab(tabRaw: string) {
  const t = String(tabRaw || '').trim().toLowerCase();
  if (!VALID_TABS.has(t)) return;
  studioHandlers.navigateTab?.(t as Tab);
}

function parseLegacyEmbedBody(body: string): { target: 'ide' | 'vnc'; enabled: boolean } | null {
  const s = String(body || '').trim().toLowerCase();
  const [a, b] = s.split(':').map((x) => x.trim());
  if (a !== 'ide' && a !== 'vnc') return null;
  if (b === undefined || b === '' || b === 'true' || b === '1') return { target: a, enabled: true };
  if (b === 'false' || b === '0') return { target: a, enabled: false };
  return { target: a, enabled: true };
}

/**
 * 执行文本中的 client-action 与 [[action:...]]，并从展示用正文里移除这些标签。
 */
export function applyClientActionsFromAssistantText(raw: string): string {
  if (!raw) return raw;

  let out = raw;

  out = out.replace(LEGACY_NAV_RE, (_, tab: string) => {
    applyNavigateTab(tab);
    return '';
  });

  out = out.replace(LEGACY_EMBED_RE, (_, rest: string) => {
    const parsed = parseLegacyEmbedBody(rest);
    if (parsed) scheduleEmbedFloat(parsed.target, parsed.enabled);
    return '';
  });

  if (!/<client-action\b/i.test(out)) {
    return out.replace(/\n{3,}/g, '\n\n').trim();
  }

  out = out.replace(CLIENT_ACTION_BLOCK_RE, (_full, attrs: string) => {
    const name = readAttr(attrs, 'name').toLowerCase();
    if (name === 'closebrowser') {
      dispatchStudioAgentWebClose();
      return '';
    }
    if (name === 'openbrowser') {
      const payload = readAttr(attrs, 'payload') || readAttr(attrs, 'href') || readAttr(attrs, 'url');
      const safe = coerceHttpPageUrl(payload);
      if (safe) void openBrowserForClientAction(safe);
      return '';
    }
    if (name === 'navigatetab') {
      const tab = readAttr(attrs, 'tab') || readAttr(attrs, 'payload');
      applyNavigateTab(tab);
      return '';
    }
    if (name === 'embedfloat') {
      const target = (readAttr(attrs, 'target') || 'ide').toLowerCase();
      const en = (readAttr(attrs, 'enabled') || 'true').toLowerCase();
      if (target !== 'ide' && target !== 'vnc') return '';
      const enabled = en !== 'false' && en !== '0';
      scheduleEmbedFloat(target, enabled);
      return '';
    }
    return '';
  });

  return out.replace(/\n{3,}/g, '\n\n').trim();
}
