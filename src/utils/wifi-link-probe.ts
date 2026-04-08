import { executeDeviceCommand } from '../api';

/**
 * 套件端 WiFi：先判链路（nmcli / ip / 默认路由，避免误用 dev wifi 的 STATE 列表字段），再单独取 SSID。
 *
 * 使用 `bash -c` 而非 `bash -lc`：非交互 SSH exec 无 TTY，登录 shell 若 source 了含 `resize` 的 profile，
 * 会在输出里混入 `resize: can't open terminal /dev/tty`，甚至被误解析为 SSID。
 */

/** 仅 UP/DOWN；取最后一行有效状态，避免 stderr 噪声混在 stdout 前导致误判 */
export const WIFI_LINK_STATE_CMD =
  'bash -c "command -v nmcli >/dev/null 2>&1 && nmcli -t -f TYPE,STATE device 2>/dev/null | grep -q \'^wifi:connected$\' && echo UP && exit 0; ' +
  'command -v nmcli >/dev/null 2>&1 && nmcli -t -f DEVICE,TYPE,STATE device 2>/dev/null | grep -E \':wifi:connected$\' >/dev/null && echo UP && exit 0; ' +
  'ip -br -4 addr show scope global 2>/dev/null | grep -qE \'^w(lan[0-9]+|lp[0-9]+s[0-9]+|lx[0-9a-fA-F]+)\\s+.*[0-9]+\\.[0-9]+\' && echo UP && exit 0; ' +
  'ip -4 route show default 2>/dev/null | grep -qE \'dev (wlan[0-9]+|wlp[0-9]+s[0-9]+|wlx[0-9a-fA-F]+)\\b\' && echo UP && exit 0; ' +
  'echo DOWN"';

/** 取当前 SSID：iwgetid 优先，否则 nmcli show 首行并去 SSID: 前缀（须 UTF-8 locale，勿用 LANG=C） */
const WIFI_LINK_SSID_INNER =
  "export LANG=C.UTF-8 LC_ALL=C.UTF-8; iwgetid -r 2>/dev/null || nmcli -t -f SSID dev wifi show 2>/dev/null | head -1 | sed -e 's/^SSID://'";

export const WIFI_LINK_SSID_CMD = `bash -c ${JSON.stringify(WIFI_LINK_SSID_INNER)}`;

/** @deprecated 请用 WIFI_LINK_STATE_CMD；保留别名以免外部引用报错 */
export const WIFI_LINK_PROBE_CMD = WIFI_LINK_STATE_CMD;

export type WifiLinkProbeResult = {
  state: 'up' | 'down' | null;
  connectedSsid?: string;
};

function parseStateLine(output: string): 'up' | 'down' | null {
  let last: 'up' | 'down' | null = null;
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const u = line.toUpperCase();
    if (u === 'UP' || u.startsWith('UP')) last = 'up';
    else if (u === 'DOWN' || u.startsWith('DOWN')) last = 'down';
  }
  return last;
}

/** 非 TTY 下 profile 里 resize/stty 等常见噪声，勿当作 SSID */
function isWifiSsidNoiseLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (/^resize:/i.test(t)) return true;
  if (/^stty:/i.test(t) && /Inappropriate ioctl/i.test(t)) return true;
  if (/can't open (?:ioctl for )?terminal/i.test(t) && /\/dev\/tty/.test(t)) return true;
  return false;
}

function normalizeSsid(raw: string): string | undefined {
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (isWifiSsidNoiseLine(line)) continue;
    const s = line.startsWith('SSID:') ? line.slice(5).trim() : line.trim();
    if (s && !isWifiSsidNoiseLine(s)) return s;
  }
  return undefined;
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
