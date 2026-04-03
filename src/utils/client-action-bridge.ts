/**
 * 识别助手回复中的「客户端动作」标签，在 RDK Studio 桌面端触发主进程能力。
 *
 * 支持示例（与部分模型/文档中的协议对齐）：
 *   <client-action name="openBrowser" payload="https://www.baidu.com" />
 *   <client-action name="closeBrowser" />
 */
import { dispatchStudioAgentWebClose, dispatchStudioAgentWebOpen } from './studio-agent-web';

const CLIENT_ACTION_BLOCK_RE = /<client-action\b([^>]*)\s*(?:\/>|>[\s\S]*?<\/client-action\s*>)/gi;

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

/** 与 studio_open_url 一致：优先独立可缩放窗口，失败再内嵌 */
async function openBrowserForClientAction(url: string): Promise<void> {
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
  if (rdk?.openUrl) {
    rdk.openUrl(url);
    rdk.setActiveUrl?.(url);
    dispatchStudioAgentWebOpen(url);
  }
}

/**
 * 执行文本中的 client-action，并从展示用正文里移除这些标签。
 */
export function applyClientActionsFromAssistantText(raw: string): string {
  if (!raw || !/<client-action\b/i.test(raw)) return raw;

  const out = raw.replace(CLIENT_ACTION_BLOCK_RE, (_full, attrs: string) => {
    const name = readAttr(attrs, 'name').toLowerCase();
    if (name === 'closebrowser') {
      dispatchStudioAgentWebClose();
      return '';
    }
    if (name !== 'openbrowser') return '';

    const payload = readAttr(attrs, 'payload') || readAttr(attrs, 'href') || readAttr(attrs, 'url');
    const safe = coerceHttpPageUrl(payload);
    if (safe) void openBrowserForClientAction(safe);
    return '';
  });

  return out.replace(/\n{3,}/g, '\n\n').trim();
}
