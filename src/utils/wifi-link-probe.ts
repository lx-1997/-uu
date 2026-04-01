import { executeDeviceCommand } from '../api';

/**
 * 板端：nmcli WiFi 已连接优先；否则 wlan* 有全局 IPv4 视为已连无线（有线-only 时多为 DOWN）。
 * 与顶栏 WiFi 状态一致。
 */
export const WIFI_LINK_PROBE_CMD =
  'bash -lc "command -v nmcli >/dev/null 2>&1 && nmcli -t -f STATE dev wifi 2>/dev/null | grep -q connected && echo UP || (ip -br -4 addr show scope global 2>/dev/null | grep -qE \'^wlan[0-9]+.*[0-9]+\\.[0-9]+\' && echo UP || echo DOWN)"';

export function parseWifiProbeOutput(output: string): 'up' | 'down' | null {
  const line = output.trim().split(/\r?\n/).find(Boolean) ?? '';
  const u = line.toUpperCase();
  if (u.startsWith('UP') || u === 'UP') return 'up';
  if (u.startsWith('DOWN') || u === 'DOWN') return 'down';
  return null;
}

export async function fetchWifiLinkState(deviceId: string): Promise<'up' | 'down' | null> {
  try {
    const res = await executeDeviceCommand(deviceId, WIFI_LINK_PROBE_CMD);
    return parseWifiProbeOutput(res.output || '');
  } catch {
    return null;
  }
}
