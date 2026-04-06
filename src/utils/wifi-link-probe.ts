import { executeDeviceCommand } from '../api';

/**
 * 套件端 WiFi：先判链路（单行、与历史版本一致），再单独取 SSID。
 * 两段命令均避免复杂嵌套引号与 `$()` 与 `grep -E ":wifi$"` 等易被远端/展示层拆坏的写法。
 */

/** 仅 UP/DOWN，与早期 wifi-link-probe 一致 */
export const WIFI_LINK_STATE_CMD =
  'bash -lc "command -v nmcli >/dev/null 2>&1 && nmcli -t -f STATE dev wifi 2>/dev/null | grep -q connected && echo UP || (ip -br -4 addr show scope global 2>/dev/null | grep -qE \'^wlan[0-9]+.*[0-9]+\\.[0-9]+\' && echo UP || echo DOWN)"';

/** 取当前 SSID：iwgetid 优先，否则 nmcli show 首行并去 SSID: 前缀 */
const WIFI_LINK_SSID_INNER =
  "iwgetid -r 2>/dev/null || nmcli -t -f SSID dev wifi show 2>/dev/null | head -1 | sed -e 's/^SSID://'";

export const WIFI_LINK_SSID_CMD = `bash -lc ${JSON.stringify(WIFI_LINK_SSID_INNER)}`;

/** @deprecated 请用 WIFI_LINK_STATE_CMD；保留别名以免外部引用报错 */
export const WIFI_LINK_PROBE_CMD = WIFI_LINK_STATE_CMD;

export type WifiLinkProbeResult = {
  state: 'up' | 'down' | null;
  connectedSsid?: string;
};

function parseStateLine(output: string): 'up' | 'down' | null {
  const line = output.trim().split(/\r?\n/).find((l) => l.length > 0) ?? '';
  const u = line.toUpperCase();
  if (u.startsWith('UP') || u === 'UP') return 'up';
  if (u.startsWith('DOWN') || u === 'DOWN') return 'down';
  return null;
}

function normalizeSsid(raw: string): string | undefined {
  const line = raw.trim().split(/\r?\n/).find((l) => l.length > 0) ?? '';
  if (!line) return undefined;
  const s = line.startsWith('SSID:') ? line.slice(5).trim() : line.trim();
  return s || undefined;
}

/** 供测试或组合输出解析 */
export function parseWifiProbeOutput(output: string): WifiLinkProbeResult {
  const lines = output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  let state: 'up' | 'down' | null = null;
  let connectedSsid: string | undefined;
  for (const line of lines) {
    if (line.startsWith('STATE:')) {
      const v = line.slice(6).toLowerCase();
      if (v === 'up') state = 'up';
      else if (v === 'down') state = 'down';
      continue;
    }
    if (line.startsWith('SSID:')) {
      connectedSsid = line.slice(5).trim() || undefined;
      continue;
    }
  }
  if (state === 'up') return { state: 'up', connectedSsid };
  if (state === 'down') return { state: 'down' };
  return { state: null };
}

export async function fetchWifiLinkState(deviceId: string): Promise<WifiLinkProbeResult> {
  try {
    const res = await executeDeviceCommand(deviceId, WIFI_LINK_STATE_CMD);
    const state = parseStateLine(res.output || '');
    if (state !== 'up') {
      return state === 'down' ? { state: 'down' } : { state: null };
    }
    try {
      const resSsid = await executeDeviceCommand(deviceId, WIFI_LINK_SSID_CMD);
      const ssid = normalizeSsid(resSsid.output || '');
      return { state: 'up', connectedSsid: ssid };
    } catch {
      return { state: 'up' };
    }
  } catch {
    return { state: null };
  }
}
