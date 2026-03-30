import type { StudioUiHints } from '../shared/types';

const key = (deviceId: string) => `rdk:studio-ui-hints:${deviceId}`;

function readRaw(deviceId: string): StudioUiHints | null {
  if (typeof window === 'undefined') return null;
  try {
    const s = sessionStorage.getItem(key(deviceId));
    if (!s) return null;
    const o = JSON.parse(s) as StudioUiHints;
    if (!o || typeof o.capturedAt !== 'number') return null;
    return o;
  } catch {
    return null;
  }
}

function writeMerged(deviceId: string, patch: Partial<StudioUiHints>) {
  if (typeof window === 'undefined') return;
  try {
    const prev = readRaw(deviceId) || { capturedAt: Date.now() };
    const next: StudioUiHints = {
      ...prev,
      ...patch,
      capturedAt: Date.now(),
      openclaw: { ...prev.openclaw, ...patch.openclaw },
      gateway: { ...prev.gateway, ...patch.gateway },
    };
    sessionStorage.setItem(key(deviceId), JSON.stringify(next));
  } catch {
    /* quota */
  }
}

/** Dashboard / 技能页 health 接口回调用 */
export function persistOpenClawHealthSnapshot(
  deviceId: string | undefined,
  status: { installed: boolean; gatewayRunning: boolean; aiReady: boolean; version: string },
) {
  if (!deviceId?.trim()) return;
  writeMerged(deviceId.trim(), {
    source: 'openclaw-health',
    openclaw: {
      installed: status.installed,
      gatewayRunning: status.gatewayRunning,
      aiReady: status.aiReady,
      version: status.version,
    },
  });
}

/** OpenClaw 页顶栏 /status 回调用 */
export function persistGatewayStatusSnapshot(
  deviceId: string | undefined,
  data: { running: boolean; version: string; installed?: boolean; feishuConnected: boolean },
) {
  if (!deviceId?.trim()) return;
  writeMerged(deviceId.trim(), {
    source: 'openclaw-status',
    gateway: {
      running: data.running,
      version: data.version,
      ...(typeof data.installed === 'boolean' ? { installed: data.installed } : {}),
    },
    feishuConnected: data.feishuConnected,
  });
}

/** 随 Agent 请求带给后端 */
export function readStudioUiHintsForDevice(deviceId: string | undefined): StudioUiHints | undefined {
  if (!deviceId?.trim()) return undefined;
  const h = readRaw(deviceId.trim());
  if (!h) return undefined;
  return h;
}
