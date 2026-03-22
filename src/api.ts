import type { Device, DevicePayload } from './types';
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

// ─── Agent SSE Chat ───

export interface AgentSSEEvent {
  type:
    | 'text'
    | 'tool_start'
    | 'tool_progress'
    | 'tool_result'
    | 'approval_required'
    | 'approval_decision'
    | 'turn_start'
    | 'turn_end'
    | 'message_end'
    | 'done'
    | 'error'
    | 'retry'
    | 'meta';
  data: Record<string, unknown>;
}

export interface RDKClawPolicy {
  approval: {
    mode: 'always' | 'risk-based' | 'auto';
    riskThreshold: 'low' | 'medium' | 'high';
  };
  delegation: {
    strategy: 'local-first' | 'board-first' | 'hybrid';
    allowBoardAuto: boolean;
  };
  memory: {
    mainSessionReadsMemory: boolean;
    sharedSessionBlocksMemory: boolean;
    dailyMemoryDays: number;
  };
  scheduler: {
    defaultChannel: 'chat' | 'feishu';
    allowSecondInterval: boolean;
  };
  network: {
    enabled: boolean;
    maxFetchChars: number;
    requireApproval: boolean;
  };
}

export interface FeishuRuntimeStatus {
  configured: boolean;
  enabled: boolean;
  connectionMode: 'websocket' | 'webhook';
  dmPolicy: 'pairing' | 'allowlist' | 'open';
  syncWithStudio: boolean;
  mirrorToStudioChat: boolean;
  ackOnReceive: boolean;
  ackOnRunning: boolean;
  ackStyle: 'text' | 'emoji' | 'off';
  domain: 'feishu' | 'lark';
  hasAppId: boolean;
  hasAppSecret: boolean;
  webhookPath: string;
  webhookUrlTemplate: string;
  boundUsers: number;
  pendingPairings: number;
  lastEventAt: number | null;
  lastAuthorizedAt: number | null;
  dedupCacheSize: number;
  latestUiSessionId?: string | null;
  latestUiDeviceId?: string | null;
  latestUiSessionUpdatedAt?: number | null;
  latestUiDeviceUpdatedAt?: number | null;
  runtime?: {
    running: boolean;
    connected: boolean;
    lastError: string | null;
    lastEventAt: number | null;
    connectionMode: 'websocket' | 'webhook';
  };
}

export function setActiveRdkclawSession(sessionId: string) {
  return request<{ ok: boolean; sessionId: string }>('/api/rdkclaw/session/active', {
    method: 'POST',
    body: JSON.stringify({ sessionId }),
  });
}

export function setActiveRdkclawDevice(deviceId: string) {
  return request<{ ok: boolean; deviceId: string }>('/api/rdkclaw/device/active', {
    method: 'POST',
    body: JSON.stringify({ deviceId }),
  });
}

export interface FeishuConfigView {
  enabled: boolean;
  connectionMode: 'websocket' | 'webhook';
  domain: 'feishu' | 'lark';
  dmPolicy: 'pairing' | 'allowlist' | 'open';
  syncWithStudio: boolean;
  mirrorToStudioChat: boolean;
  ackOnReceive: boolean;
  ackOnRunning: boolean;
  ackStyle: 'text' | 'emoji' | 'off';
  appId: string;
  appSecretMasked: string;
  verificationTokenMasked: string;
  encryptKeyMasked: string;
  hasAppSecret: boolean;
  hasVerificationToken: boolean;
  hasEncryptKey: boolean;
}

export interface AgentAttachmentPayload {
  id: string;
  type: 'image' | 'file' | 'audio' | 'video';
  name: string;
  mimeType?: string;
  size?: number;
  contentBase64?: string;
  transcript?: string;
  textContent?: string;
  source?: 'studio' | 'feishu';
}

export type AgentEventCallback = (event: AgentSSEEvent) => void;

export function streamAgentChat(
  message: string,
  deviceId?: string,
  sessionId?: string,
  attachments?: AgentAttachmentPayload[],
  onEvent?: AgentEventCallback,
): { abort: () => void; done: Promise<void> } {
  const controller = new AbortController();

  const done = (async () => {
    try {
      const res = await fetch(resolveUrl('/api/agent/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, deviceId, sessionId, attachments }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Agent 请求失败' }));
        onEvent?.({ type: 'error', data: { error: (err as { error?: string }).error || 'Agent 请求失败' } });
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        onEvent?.({ type: 'error', data: { error: '无法读取响应流' } });
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done: readerDone, value } = await reader.read();
        if (readerDone) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentEventType = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEventType = line.slice(7).trim();
          } else if (line.startsWith('data: ') && currentEventType) {
            try {
              const data = JSON.parse(line.slice(6));
              onEvent?.({ type: currentEventType as AgentSSEEvent['type'], data });
            } catch { /* skip malformed JSON */ }
            currentEventType = '';
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        onEvent?.({ type: 'error', data: { error: (err as Error).message } });
      }
    }
  })();

  return { abort: () => controller.abort(), done };
}

export function fetchAgentConfig() {
  return request<{
    configured: boolean;
    provider?: string;
    model?: string;
    hasApiKey?: boolean;
    baseUrl?: string;
  }>('/api/agent/config');
}

export interface PersonaProfile {
  name: string;
  tone: 'professional' | 'friendly' | 'concise' | 'mentor';
  stylePrompt: string;
  riskLevel: 'conservative' | 'balanced' | 'aggressive';
  boardDelegationBias: 'low' | 'medium' | 'high';
  delegationBias: 'local-first' | 'balanced' | 'board-first';
  autonomyLevel: 'manual' | 'assisted' | 'autonomous';
  riskBoundary: 'strict' | 'moderate' | 'relaxed';
  notifyStyle: 'compact' | 'detailed';
}

export function fetchRDKClawPersona() {
  return request<{ ok: boolean; persona: PersonaProfile }>('/api/rdkclaw/persona');
}

export function saveRDKClawPersona(patch: Partial<PersonaProfile>) {
  return request<{ ok: boolean; persona: PersonaProfile }>('/api/rdkclaw/persona', {
    method: 'POST',
    body: JSON.stringify(patch),
  });
}

export function fetchRDKClawPolicy() {
  return request<{ ok: boolean; policy: RDKClawPolicy }>('/api/rdkclaw/policy');
}

export function saveRDKClawPolicy(patch: Partial<RDKClawPolicy>) {
  return request<{ ok: boolean; policy: RDKClawPolicy }>('/api/rdkclaw/policy', {
    method: 'POST',
    body: JSON.stringify(patch),
  });
}

export function decideRDKClawApproval(approvalId: string, decision: 'allow_once' | 'allow_session_auto' | 'allow_global_auto' | 'deny') {
  return request<{ ok: boolean }>(`/api/rdkclaw/approvals/${approvalId}/decision`, {
    method: 'POST',
    body: JSON.stringify({ decision }),
  });
}

export function cancelRDKClawRun(runId: string) {
  return request<{ ok: boolean }>(`/api/rdkclaw/runs/${runId}/cancel`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function stopRDKClawTask(taskId: string) {
  return request<{ ok: boolean }>(`/api/rdkclaw/tasks/${taskId}/stop`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function bindRDKClawFeishuCode(code: string, sessionId?: string) {
  return request<{ ok: boolean; openId?: string; message?: string }>('/api/rdkclaw/feishu/auth/bind', {
    method: 'POST',
    body: JSON.stringify({ code, sessionId }),
  });
}

export function fetchFeishuBoundUsers() {
  return request<{ ok: boolean; users: Array<{ openId: string; boundAt: number }>; total: number }>('/api/rdkclaw/feishu/auth/bound');
}

export function fetchFeishuRuntimeStatus() {
  return request<{ ok: boolean; status: FeishuRuntimeStatus }>('/api/rdkclaw/feishu/status');
}

export function fetchFeishuRuntime() {
  return request<{
    ok: boolean;
    runtime: {
      running: boolean;
      connected: boolean;
      lastError: string | null;
      lastEventAt: number | null;
      connectionMode: 'websocket' | 'webhook';
    };
  }>('/api/rdkclaw/feishu/runtime');
}

export function startFeishuRuntime() {
  return request<{ ok: boolean; runtime: FeishuRuntimeStatus['runtime'] }>('/api/rdkclaw/feishu/runtime/start', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function stopFeishuRuntime() {
  return request<{ ok: boolean; runtime: FeishuRuntimeStatus['runtime'] }>('/api/rdkclaw/feishu/runtime/stop', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function restartFeishuRuntime() {
  return request<{ ok: boolean; runtime: FeishuRuntimeStatus['runtime'] }>('/api/rdkclaw/feishu/runtime/restart', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function fetchFeishuConfig() {
  return request<{ ok: boolean; config: FeishuConfigView }>('/api/rdkclaw/feishu/config');
}

export function saveFeishuConfig(patch: {
  enabled?: boolean;
  connectionMode?: 'websocket' | 'webhook';
  domain?: 'feishu' | 'lark';
  dmPolicy?: 'pairing' | 'allowlist' | 'open';
  syncWithStudio?: boolean;
  mirrorToStudioChat?: boolean;
  ackOnReceive?: boolean;
  ackOnRunning?: boolean;
  ackStyle?: 'text' | 'emoji' | 'off';
  appId?: string;
  appSecret?: string;
  verificationToken?: string;
  encryptKey?: string;
}) {
  return request<{ ok: boolean; configured: boolean; hasVerificationToken: boolean; hasEncryptKey: boolean; connectionMode: 'websocket' | 'webhook'; enabled: boolean }>(
    '/api/rdkclaw/feishu/config',
    {
      method: 'POST',
      body: JSON.stringify(patch),
    },
  );
}

export function fetchFeishuPairingRequests() {
  return request<{
    ok: boolean;
    total: number;
    requests: Array<{
      openId: string;
      rawOpenId: string;
      chatId: string;
      code: string;
      expireAt: number;
      createdAt: number;
    }>;
  }>('/api/rdkclaw/feishu/pairing/requests');
}

export function approveFeishuPairing(code: string) {
  return request<{ ok: boolean; openId?: string }>('/api/rdkclaw/feishu/pairing/approve', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

export function rejectFeishuPairing(code: string) {
  return request<{ ok: boolean }>('/api/rdkclaw/feishu/pairing/reject', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

export function saveAgentConfig(config: {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}) {
  return request<{ ok: boolean }>('/api/agent/config', {
    method: 'POST',
    body: JSON.stringify(config),
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

export interface OpenClawHealthStatus {
  installed: boolean;
  gatewayRunning: boolean;
  version: string;
  hasToken: boolean;
  tokenStatus: 'ok' | 'missing' | 'invalid' | 'unknown';
  aiReady: boolean;
  summary: string;
}

export interface WorkspaceModuleHealth {
  ready: boolean;
  installed: boolean;
  running?: boolean;
  summary: string;
  recommendedAction: string;
  missing?: string[];
}

export interface DeviceWorkspaceHealth {
  checkedAt: number;
  readyModules: number;
  totalModules: number;
  modules: {
    development: WorkspaceModuleHealth;
    codeServer: WorkspaceModuleHealth;
    vnc: WorkspaceModuleHealth;
    ros: WorkspaceModuleHealth;
    nodeHub: WorkspaceModuleHealth;
    modelZoo: WorkspaceModuleHealth;
  };
}

export function fetchDeviceOpenClawHealth(deviceId: string, password?: string) {
  return request<{ ok: boolean; status: OpenClawHealthStatus }>(`/api/devices/${deviceId}/openclaw/health`, {
    headers: password ? { 'x-device-password': password } : undefined,
  });
}

export function fetchDeviceWorkspaceHealth(deviceId: string, password?: string) {
  return request<{ ok: boolean; status: DeviceWorkspaceHealth }>(`/api/devices/${deviceId}/workspace/health`, {
    headers: password ? { 'x-device-password': password } : undefined,
  });
}

export function installDeviceOpenClaw(deviceId: string, password?: string) {
  return request<{ ok: boolean; output: string }>(`/api/devices/${deviceId}/openclaw/install`, {
    method: 'POST',
    headers: password ? { 'x-device-password': password } : undefined,
    body: JSON.stringify({}),
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

export function fetchDeviceWifiList(deviceId: string) {
  return request<{ ok: boolean; wifiNames: string[] }>(`/api/devices/${deviceId}/openclaw/wifi-list`);
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

export function downloadDeviceFile(deviceId: string, path: string, password?: string) {
  const qp = new URLSearchParams({ path }).toString();
  return request<DeviceFileOpResult>(`/api/devices/${deviceId}/files/download?${qp}`, {
    headers: password ? { 'x-device-password': password } : undefined,
  });
}