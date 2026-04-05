/**
 * 从设备类工具输出中解析 http(s) URL，经 SSRF 放行与设备 IP 修正后通知桌面端打开。
 * 供 device_exec（在 ros2VerifyTopics 等耗时步骤之前尽早打开）与 rdkclaw-tool-hooks 共用。
 */

import { assertStudioClientOpenUrlAllowed } from './agent/tools/browser-tools.js';
import { emitStudioOpenUrlToClients } from './studio-browser-capture.js';
import { rewriteUrlForStudioDevice } from './device-url-rewrite.js';

/** 与 rdkclaw-tool-hooks 追加文案一致，用于去重（避免验收结束后钩子再开一遍） */
export const DEVICE_DASHBOARD_AUTO_OPEN_NOTE_PREFIX = '[会话 · 已为你打开监控/页面]';

const URL_IN_TEXT = /https?:\/\/[^\s\)\]\"'<>]+/gi;

/**
 * 扫描文本中的 URL，最多打开 2 个；返回实际打开的 URL 列表（已 rewrite）。
 */
export async function emitDeviceDashboardUrlsFromText(
  text: string,
  studioDeviceId?: string,
): Promise<string[]> {
  const matches = text.match(URL_IN_TEXT);
  if (!matches?.length) return [];
  const seen = new Set<string>();
  const opened: string[] = [];
  for (const raw of matches) {
    const candidate = raw.replace(/[.,;]+$/, '');
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    try {
      const safe = assertStudioClientOpenUrlAllowed(candidate);
      const url = safe.toString();
      const forStudio = await rewriteUrlForStudioDevice(url, studioDeviceId);
      emitStudioOpenUrlToClients(forStudio);
      opened.push(forStudio);
      if (opened.length >= 2) break;
    } catch {
      /* 跳过不可放行 URL */
    }
  }
  return opened;
}

export function formatDeviceDashboardAutoOpenNote(opened: string[]): string {
  if (opened.length === 0) return '';
  return `${DEVICE_DASHBOARD_AUTO_OPEN_NOTE_PREFIX} ${opened.join(' ｜ ')}`;
}
