import type { ChatMessage, Device, DevicePayload, OpenClawPayload } from './types';
import type { AgentPlan } from './app-types';

export interface DeviceExecResult {
  ok: boolean;
  output: string;
  command?: string;
}

export interface DeviceServiceStatusResult {
  ok: boolean;
  active: boolean;
  output: string;
}

export interface DeviceRosTopicsResult {
  ok: boolean;
  topics: string[];
  output: string;
}

export interface DeviceFileOpResult {
  ok: boolean;
  output?: string;
  path?: string;
  contentBase64?: string;
}

const devicePasswordKey = (deviceId: string) => `rdk:device-password:${deviceId}`;

export function rememberDevicePassword(deviceId: string, password: string) {
  if (typeof window === 'undefined' || !password.trim()) return;
  window.sessionStorage.setItem(devicePasswordKey(deviceId), password);
}

export function forgetDevicePassword(deviceId: string) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(devicePasswordKey(deviceId));
}

export function getRememberedDevicePassword(deviceId: string) {
  if (typeof window === 'undefined') return '';
  return window.sessionStorage.getItem(devicePasswordKey(deviceId)) ?? '';
}

function extractDeviceId(input: RequestInfo) {
  const url = typeof input === 'string' ? input : input.url;
  const match = url.match(/\/api\/devices\/([^/]+)\//);
  return match?.[1] ?? '';
}

/* 桌面端（file:// 协议）下相对路径失效，需拼接绝对 URL */
function resolveUrl(path: string): string {
  const apiBase = (window as any).rdkDesktop?.apiBase;
  if (apiBase) return `${apiBase}${path}`;
  return path;
}

async function request<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  // 将相对路径转为绝对 URL（桌面端）
  if (typeof input === 'string' && input.startsWith('/')) {
    input = resolveUrl(input);
  }
  const headers = new Headers(init?.headers ?? {});
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const deviceId = extractDeviceId(input);
  if (deviceId && !headers.has('x-device-password')) {
    const remembered = getRememberedDevicePassword(deviceId);
    if (remembered) {
      headers.set('x-device-password', remembered);
    }
  }

  const response = await fetch(input, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    const url = typeof input === 'string' ? input : input.url;
    const message = payload.error ?? 'Request failed';
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('rdk-api-error', {
        detail: {
          status: response.status,
          url,
          message,
        },
      }));
    }
    throw new Error(`HTTP ${response.status} · ${message} · ${url}`);
  }

  return (await response.json()) as T;
}

export function fetchDevices() {
  return request<{ devices: Device[] }>('/api/devices');
}

export function connectDevice(payload: DevicePayload) {
  return request<{ device: Device }>('/api/devices/connect', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function verifyDeviceConnection(payload: DevicePayload) {
  return request<{ ok: boolean }>('/api/devices/verify', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function removeDevice(deviceId: string) {
  return request<{ removedId: string }>(`/api/devices/${deviceId}`, {
    method: 'DELETE',
  });
}

export function sendChat(messages: ChatMessage[]) {
  return request<{ message: ChatMessage }>('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ messages }),
  });
}

export function fetchAIReply(
  messages: Array<{ role: string; content: string }>,
  deviceName?: string,
  deviceIp?: string,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  return fetch(resolveUrl('/api/chat'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, deviceName, deviceIp }),
    signal: controller.signal,
  })
    .then(async (r) => {
      clearTimeout(timer);
      if (!r.ok) throw new Error('API error');
      const data = (await r.json()) as { reply: string };
      return data.reply;
    })
    .catch(() => {
      clearTimeout(timer);
      return null;
    });
}

export function fetchAgentPlan(goal: string, deviceName?: string, deviceIp?: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  return fetch(resolveUrl('/api/agent/plan'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ goal, deviceName, deviceIp }),
    signal: controller.signal,
  })
    .then(async (r) => {
      clearTimeout(timer);
      if (!r.ok) throw new Error('Agent plan API error');
      return (await r.json()) as AgentPlan;
    })
    .catch(() => {
      clearTimeout(timer);
      return null;
    });
}

export function runOpenClawAgentAction(
  action: 'start' | 'status' | 'switch' | 'install' | 'logs',
  params?: { modelName?: string; host?: string; username?: string },
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  return fetch(resolveUrl('/api/openclaw/agent-action'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...params }),
    signal: controller.signal,
  })
    .then(async (r) => {
      clearTimeout(timer);
      const payload = (await r.json().catch(() => ({}))) as { output?: string; error?: string; host?: string; username?: string };
      if (!r.ok) throw new Error(payload.error ?? 'OpenClaw action error');
      return payload;
    })
    .catch((err) => {
      clearTimeout(timer);
      return { error: err instanceof Error ? err.message : 'OpenClaw action error' };
    });
}

export function runOpenClaw(deviceId: string, payload: OpenClawPayload, password: string) {
  return request<{ output: string; device: Device }>(`/api/devices/${deviceId}/openclaw`, {
    method: 'POST',
    headers: {
      'x-device-password': password,
    },
    body: JSON.stringify(payload),
  });
}

export function checkDevicePing(deviceId: string) {
  return request<{ ok: boolean; status: string }>(`/api/devices/${deviceId}/ping`, { method: 'GET' }).catch(() => ({ ok: false, status: 'offline' }));
}

export function executeDeviceCommand(deviceId: string, command: string, password?: string) {
  return request<DeviceExecResult>(`/api/devices/${deviceId}/exec`, {
    method: 'POST',
    headers: password ? { 'x-device-password': password } : undefined,
    body: JSON.stringify({ command }),
  });
}

export function executeDeviceBatchCommands(deviceId: string, commands: string[], password?: string) {
  return request<DeviceExecResult>(`/api/devices/${deviceId}/batch-exec`, {
    method: 'POST',
    headers: password ? { 'x-device-password': password } : undefined,
    body: JSON.stringify({ commands }),
  });
}

export function fetchDeviceDiagnostics(deviceId: string, password?: string) {
  return request<{ ok: boolean; output: string }>(`/api/devices/${deviceId}/diagnostics`, {
    headers: password ? { 'x-device-password': password } : undefined,
  });
}

export function fetchRosTopics(deviceId: string, password?: string) {
  return request<DeviceRosTopicsResult>(`/api/devices/${deviceId}/ros/topics`, {
    headers: password ? { 'x-device-password': password } : undefined,
  });
}

export function deployModel(deviceId: string, command: string, password?: string) {
  return request<DeviceExecResult>(`/api/devices/${deviceId}/models/deploy`, {
    method: 'POST',
    headers: password ? { 'x-device-password': password } : undefined,
    body: JSON.stringify({ command }),
  });
}

export function runExample(deviceId: string, command: string, password?: string) {
  return request<DeviceExecResult>(`/api/devices/${deviceId}/examples/run`, {
    method: 'POST',
    headers: password ? { 'x-device-password': password } : undefined,
    body: JSON.stringify({ command }),
  });
}

export function fetchNodeRedStatus(deviceId: string, password?: string) {
  return request<DeviceServiceStatusResult>(`/api/devices/${deviceId}/services/node-red`, {
    headers: password ? { 'x-device-password': password } : undefined,
  });
}

export function fetchVncStatus(deviceId: string, password?: string) {
  return request<DeviceServiceStatusResult>(`/api/devices/${deviceId}/services/vnc`, {
    headers: password ? { 'x-device-password': password } : undefined,
  });
}

export function listDeviceFiles(deviceId: string, path: string, password?: string) {
  const qp = new URLSearchParams({ path }).toString();
  return request<DeviceFileOpResult>(`/api/devices/${deviceId}/files/list?${qp}`, {
    headers: password ? { 'x-device-password': password } : undefined,
  });
}

export function readDeviceFile(deviceId: string, path: string, lines = 200, password?: string) {
  const qp = new URLSearchParams({ path, lines: String(lines) }).toString();
  return request<DeviceFileOpResult>(`/api/devices/${deviceId}/files/read?${qp}`, {
    headers: password ? { 'x-device-password': password } : undefined,
  });
}

export function writeDeviceFile(deviceId: string, path: string, content: string, append = false, password?: string) {
  return request<DeviceFileOpResult>(`/api/devices/${deviceId}/files/write`, {
    method: 'POST',
    headers: password ? { 'x-device-password': password } : undefined,
    body: JSON.stringify({ path, content, append }),
  });
}

export function uploadDeviceFile(deviceId: string, path: string, contentBase64: string, password?: string) {
  return request<DeviceFileOpResult>(`/api/devices/${deviceId}/files/upload`, {
    method: 'POST',
    headers: password ? { 'x-device-password': password } : undefined,
    body: JSON.stringify({ path, contentBase64 }),
  });
}

// ── Flash / System Update APIs ──
export function flashCheck(deviceId: string, password?: string) {
  return request<{ ok: boolean; output: string }>(`/api/devices/${deviceId}/flash/check`, {
    method: 'POST',
    headers: password ? { 'x-device-password': password } : undefined,
  });
}

export function flashDownload(deviceId: string, imageUrl: string, targetPath?: string, password?: string) {
  return request<{ ok: boolean; output: string; path: string }>(`/api/devices/${deviceId}/flash/download`, {
    method: 'POST',
    headers: password ? { 'x-device-password': password } : undefined,
    body: JSON.stringify({ imageUrl, targetPath }),
  });
}

export function flashWrite(deviceId: string, imagePath: string, target: string, password?: string) {
  return request<{ ok: boolean; output: string }>(`/api/devices/${deviceId}/flash/write`, {
    method: 'POST',
    headers: password ? { 'x-device-password': password } : undefined,
    body: JSON.stringify({ imagePath, target }),
  });
}

export function flashVerify(deviceId: string, password?: string) {
  return request<{ ok: boolean; output: string }>(`/api/devices/${deviceId}/flash/verify`, {
    method: 'POST',
    headers: password ? { 'x-device-password': password } : undefined,
  });
}

export function flashExecute(
  deviceId: string,
  payload: {
    imageUrl: string;
    target: string;
    board?: string;
    mode?: 'network' | 'local';
    wifiName?: string;
    wifiPass?: string;
    skipVerify?: boolean;
  },
  password?: string,
) {
  return request<{ ok: boolean; output: string; strategy: string; targetDevice: string }>(`/api/devices/${deviceId}/flash/execute`, {
    method: 'POST',
    headers: password ? { 'x-device-password': password } : undefined,
    body: JSON.stringify(payload),
  });
}

export function downloadDeviceFile(deviceId: string, path: string, password?: string) {
  const qp = new URLSearchParams({ path }).toString();
  return request<DeviceFileOpResult>(`/api/devices/${deviceId}/files/download?${qp}`, {
    headers: password ? { 'x-device-password': password } : undefined,
  });
}