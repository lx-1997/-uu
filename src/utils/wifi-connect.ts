import { fetchApi } from './apiBase';

/** 与后端 WiFi 连接保护超时对齐并留余量，避免界面先断而后端仍在重试 */
export const WIFI_CONNECT_FETCH_TIMEOUT_MS = 185_000;

export type WifiConnectResult = { ok: boolean; output?: string; error?: string };

export async function postDeviceWifiConnect(
  deviceId: string,
  wifiName: string,
  wifiPassword: string,
): Promise<WifiConnectResult> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), WIFI_CONNECT_FETCH_TIMEOUT_MS);
  try {
    const res = await fetchApi(`/api/devices/${deviceId}/openclaw/wifi-connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wifiName, wifiPassword }),
      signal: ac.signal,
    });
    let data: WifiConnectResult = { ok: false };
    try {
      data = (await res.json()) as WifiConnectResult;
    } catch {
      return { ok: false, error: `HTTP ${res.status}（响应非 JSON）` };
    }
    if (!res.ok) {
      return { ok: false, error: data.error || `HTTP ${res.status}`, output: data.output };
    }
    return data;
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      return {
        ok: false,
        error:
          'WiFi 配置等待超时（已超过 ' +
          Math.round(WIFI_CONNECT_FETCH_TIMEOUT_MS / 1000) +
          ' 秒）。若设备 SSH 已断开，请插网线或串口恢复后再试。',
      };
    }
    return { ok: false, error: e instanceof Error ? e.message : '请求失败' };
  } finally {
    clearTimeout(timer);
  }
}
