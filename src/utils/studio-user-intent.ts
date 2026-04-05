/**
 * 用户自然语言 → 切换 IDE/VNC 并尝试浮出嵌入区（与 RDKClaw 回复中的 [[action:...]] 互补）。
 * 「了解 RoboGo / RDK Studio」→ 打开飞书介绍页（与 studio_open_url 弹窗行为一致）。
 */

import {
  DEFAULT_ROBOGO_DOC_FEISHU_URL,
  DEFAULT_RDK_DEVELOPER_PORTAL_DOC_URL,
  DEFAULT_RDK_STUDIO_DOC_FEISHU_URL,
} from '../../shared/product-doc-urls';
import { tryConsumeStudioOpenSlot } from './studio-open-url-dedup';

const MAX_LEN = 2400;

function getRobogoDocUrl(): string {
  const v = import.meta.env.VITE_ROBOGO_DOC_URL;
  return (typeof v === 'string' && v.trim()) || DEFAULT_ROBOGO_DOC_FEISHU_URL;
}

function getRdkStudioDocUrl(): string {
  const v = import.meta.env.VITE_RDK_STUDIO_DOC_URL;
  return (typeof v === 'string' && v.trim()) || DEFAULT_RDK_STUDIO_DOC_FEISHU_URL;
}

function getDeveloperPortalDocUrl(): string {
  const v = import.meta.env.VITE_RDK_DEVELOPER_DOC_URL;
  return (typeof v === 'string' && v.trim()) || DEFAULT_RDK_DEVELOPER_PORTAL_DOC_URL;
}

function isNegativeDocIntent(text: string): boolean {
  const t = text.trim();
  if (/不要|别|勿|取消|不用/.test(t) && /(飞书|链接|文档|弹窗|打开)/.test(t)) return true;
  return false;
}

function wantsRdkStudioDoc(text: string): boolean {
  if (isNegativeDocIntent(text)) return false;
  return (
    /(了解|介绍|查看|说明|文档|什么是|看看|搜|资料|科普).{0,40}(rdk\s*studio|rdk工作室)/i.test(text) ||
    /(rdk\s*studio|rdk工作室).{0,28}(是什么|干嘛|介绍|文档|了解)/i.test(text) ||
    /^(什么是|介绍下)\s*(rdk\s*studio|rdk工作室)/i.test(text) ||
    /(了解|介绍).{0,20}(rdk\s*工作室|这款\s*studio|本\s*软件|本\s*工具|客户端\s*studio)/i.test(text)
  );
}

function wantsRobogoDoc(text: string): boolean {
  if (isNegativeDocIntent(text)) return false;
  return (
    /(了解|介绍|查看|说明|文档|什么是|看看|搜|资料|科普).{0,40}robogo/i.test(text) ||
    /robogo.{0,28}(是什么|干嘛|介绍|文档|了解)/i.test(text) ||
    /^(什么是|介绍下)\s*robogo/i.test(text)
  );
}

/** 开发者手册 / 地瓜官网（RDK 文档站） */
function wantsDeveloperPortalDoc(text: string): boolean {
  if (isNegativeDocIntent(text)) return false;
  if (!/(了解|介绍|查看|打开|去|看看|搜|资料|跳转|什么|手册|官网|文档)/i.test(text)) return false;

  const mentionsRdkStudio = /rdk\s*studio/i.test(text);
  const mentionsDevPortal =
    /开发者手册|官方手册/.test(text) ||
    /(地瓜|开发者社区|d-robotics|robotics).{0,12}官网|官网.{0,16}(地瓜|开发者|RDK)/i.test(text) ||
    (/^(打开|去|跳转).{0,12}官网/i.test(text) && /(地瓜|developer|rdk|robotics)/i.test(text)) ||
    /developer\.d-robotics\.cc\/rdk_doc/i.test(text) ||
    /RDK\s*(?:官方|开发)文档|RDK\s*文档(?:首页|入口)/i.test(text) ||
    /(想看|了解|介绍).{0,8}(地瓜|开发者).{0,8}官网/i.test(text);

  if (mentionsRdkStudio && !mentionsDevPortal) return false;
  return mentionsDevPortal;
}

function collectProductDocUrls(text: string): string[] {
  const raw = text.trim();
  if (!raw || raw.length > MAX_LEN) return [];
  const out: string[] = [];
  if (wantsRdkStudioDoc(raw)) out.push(getRdkStudioDocUrl());
  if (wantsRobogoDoc(raw)) out.push(getRobogoDocUrl());
  if (wantsDeveloperPortalDoc(raw)) out.push(getDeveloperPortalDocUrl());
  const seen = new Set<string>();
  return out.filter((u) => {
    if (seen.has(u)) return false;
    seen.add(u);
    return true;
  });
}

async function openStudioBrowsePopup(url: string): Promise<boolean> {
  if (!tryConsumeStudioOpenSlot(url)) return false;
  const rdk = window.rdkDesktop;
  if (rdk?.openAgentBrowserPopup) {
    const r = await rdk.openAgentBrowserPopup(url);
    if (r?.ok) return true;
  }
  try {
    window.open(url, '_blank', 'noopener,noreferrer');
    return true;
  } catch {
    return false;
  }
}

async function openProductDocUrlsSequentially(urls: string[]): Promise<number> {
  let opened = 0;
  for (let i = 0; i < urls.length; i++) {
    if (i > 0) await new Promise<void>((r) => setTimeout(r, 400));
    if (await openStudioBrowsePopup(urls[i])) opened += 1;
  }
  return opened;
}

/**
 * 若用户想「了解 RoboGo / RDK Studio / 开发者手册或官网」，打开对应页面（桌面端与 studio_open_url 同为可缩放弹窗）。
 * @returns 是否至少成功打开一个窗口（去重后可能为 0）
 */
export async function tryOpenProductDocFromUserMessage(text: string): Promise<boolean> {
  const urls = collectProductDocUrls(text);
  if (urls.length === 0) return false;
  const opened = await openProductDocUrlsSequentially(urls);
  return opened > 0;
}

function isNegativeOpenIntent(text: string): boolean {
  const t = text.trim();
  if (/不要打开|别打开|无需打开|不用打开|关闭.*(vnc|远程|ide|编辑器)|不要.*(vnc|远程桌面|ide)/i.test(t)) return true;
  if (/不要|别$/.test(t) && /打开/.test(t)) return true;
  return false;
}

export type OpenEmbedTarget = 'vnc' | 'ide';

/**
 * 从用户输入判断是否希望「打开 VNC/远程桌面」或「打开 IDE」并浮窗展示。
 */
export function detectOpenEmbedIntent(text: string): OpenEmbedTarget | null {
  const raw = text.trim();
  if (!raw || raw.length > MAX_LEN) return null;
  if (isNegativeOpenIntent(raw)) return null;

  const lower = raw.toLowerCase();

  const wantsVnc =
    /打开\s*(vnc|novnc|no\s*vnc)/i.test(raw) ||
    /打开.*远程桌面|打开.*远程\b|连接.*远程桌面|查看.*远程桌面|进入.*远程桌面/i.test(raw) ||
    /\bvnc\b/i.test(lower) && /打开|启动|进入|切到|切换|看|连/i.test(raw) ||
    /open\s*(vnc|remote\s*desktop|novnc)/i.test(lower) ||
    /show\s*(vnc|remote)/i.test(lower);

  const wantsIde =
    /打开\s*(ide|代码编辑器|编辑器\b|vscode|code-?server)/i.test(raw) ||
    /打开.*(代码编辑|编程)/i.test(raw) ||
    /\b(ide|vscode|code-?server)\b/i.test(lower) && /打开|启动|进入|切到|切换|看/i.test(raw) ||
    /open\s*(ide|vscode|code-?server|editor)/i.test(lower);

  if (wantsVnc && wantsIde) {
    const vi = lower.search(/\bvnc|远程桌面|remote\s*desktop|novnc/);
    const ii = lower.search(/\bide|vscode|code-?server|代码编辑/);
    if (vi >= 0 && ii >= 0) return vi <= ii ? 'vnc' : 'ide';
    return wantsVnc ? 'vnc' : 'ide';
  }
  if (wantsVnc) return 'vnc';
  if (wantsIde) return 'ide';
  return null;
}

/** 派发由 App 层监听：切 Tab + 就绪后浮窗 */
export function dispatchOpenEmbedIntentFromUserMessage(text: string): void {
  const target = detectOpenEmbedIntent(text);
  if (!target) return;
  const kind = target === 'vnc' ? 'open-vnc-float' : 'open-ide-float';
  window.dispatchEvent(new CustomEvent('rdk-studio-user-intent', { detail: { kind } }));
}
