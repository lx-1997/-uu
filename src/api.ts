import type { Device, DevicePayload } from './types';
import type { AgentPlan } from './app-types';
import { resolveApiUrl } from './utils/apiBase';

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

export interface OneShotGeneratedAppResult {
  ok: boolean;
  app: {
    name: string;
    summary: string;
    rootDir: string;
    files: string[];
    runCommand: string;
    testCommand?: string;
    usedFallback?: boolean;
  };
}

export interface OneShotValidationResponse {
  ok: boolean;
  validation: {
    ok: boolean;
    checks: Array<{ name: string; ok: boolean; detail: string }>;
  };
}

export interface OneShotRunResponse {
  ok: boolean;
  run: {
    runner: string;
    output: string;
    timedOut: boolean;
  };
}

export interface OneShotDeployResponse {
  ok: boolean;
  deploy: {
    deviceId: string;
    remoteDir: string;
    fileCount: number;
    totalBytes: number;
    runCommand: string;
    run?: {
      ok: boolean;
      output: string;
      suggestions?: Array<{
        title: string;
        detail: string;
        command?: string;
      }>;
    };
  };
}

interface ApiErrorPayload {
  error?: string;
  message?: string;
  code?: string;
  retryable?: boolean;
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
  return resolveApiUrl(path);
}

function isTransientRequestError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const name = (error.name || '').toLowerCase();
  const message = (error.message || '').toLowerCase();
  if (name === 'aborterror') return false;
  return (
    message.includes('networkerror')
    || message.includes('failed to fetch')
    || message.includes('timeout')
    || message.includes('econnreset')
    || message.includes('connection reset')
  );
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

  const method = (init?.method ?? 'GET').toUpperCase();
  const maxAttempts = method === 'GET' || method === 'HEAD' ? 2 : 1;
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const response = await fetch(input, {
        ...init,
        headers,
      });

      if (!response.ok) {
        if (response.status >= 500 && attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
          continue;
        }
        const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload;
        const url = typeof input === 'string' ? input : input.url;
        const message = payload.message ?? payload.error ?? 'Request failed';
        const code = payload.code ?? '';
        const retryable = Boolean(payload.retryable);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('rdk-api-error', {
            detail: {
              status: response.status,
              url,
              message,
              code,
              retryable,
            },
          }));
        }
        const codePart = code ? `[${code}] ` : '';
        throw new Error(`HTTP ${response.status} · ${codePart}${message} · ${url}`);
      }

      return (await response.json()) as T;
    } catch (error) {
      if (attempt < maxAttempts && isTransientRequestError(error)) {
        await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
        continue;
      }
      throw error;
    }
  }

  throw new Error('Request failed after retry');
}

export function fetchDevices() {
  return request<{ devices: Device[] }>('/api/devices');
}

export function generateOneShotApp(prompt: string) {
  return request<OneShotGeneratedAppResult>('/api/apps/one-shot-generate', {
    method: 'POST',
    body: JSON.stringify({ prompt }),
  });
}

export function validateOneShotApp(appDir: string) {
  return request<OneShotValidationResponse>('/api/apps/one-shot-validate', {
    method: 'POST',
    body: JSON.stringify({ appDir }),
  });
}

export function runOneShotApp(appDir: string, runCommand?: string) {
  return request<OneShotRunResponse>('/api/apps/one-shot-run', {
    method: 'POST',
    body: JSON.stringify({ appDir, ...(runCommand ? { runCommand } : {}) }),
  });
}

export function deployOneShotApp(payload: {
  appDir: string;
  deviceId: string;
  remoteDir?: string;
  runAfterDeploy?: boolean;
  runCommand?: string;
}) {
  return request<OneShotDeployResponse>('/api/apps/one-shot-deploy', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
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
    | 'recommendation'
    | 'recommendation_choice'
    | 'soul_update_proposal'
    | 'soul_update_applied'
    | 'turn_start'
    | 'turn_end'
    | 'message_end'
    | 'run_progress'
    | 'run_complete'
    | 'done'
    | 'error'
    | 'retry'
    | 'meta'
    | 'queue_status'
    | 'no_device';
  data: Record<string, unknown>;
}

export interface RDKClawPolicy {
  approval: {
    mode: 'always' | 'risk-based' | 'auto';
    riskThreshold: 'low' | 'medium' | 'high';
  };
  permission: {
    workspaceBoundaryEnabled: boolean;
    devicePathBoundaryEnabled: boolean;
    hostMutationGuardEnabled: boolean;
    commandDangerGuardEnabled: boolean;
    auditLogEnabled: boolean;
  };
  memory: {
    mainSessionReadsMemory: boolean;
    sharedSessionBlocksMemory: boolean;
    dailyMemoryDays: number;
  };
  network: {
    enabled: boolean;
    maxFetchChars: number;
    requireApproval: boolean;
  };
  context: {
    contextTokens: number;
    maxHistoryShare: number;
    softTrimRatio: number;
    hardClearRatio: number;
    keepLastAssistants: number;
  };
}

export interface SecurityAuditLogEntry {
  id: string;
  timestamp: number;
  channel: 'studio' | 'weixin' | 'feishu';
  toolName: string;
  risk: 'low' | 'medium' | 'high';
  action: 'blocked' | 'auto_allow' | 'approval_required' | 'approval_decision';
  reason?: string;
  decision?: string;
  sessionId?: string;
  runId?: string;
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
  storedPath?: string;
  transcript?: string;
  textContent?: string;
  source?: 'studio' | 'feishu' | 'weixin';
}

export type AgentEventCallback = (event: AgentSSEEvent) => void;

export function streamAgentChat(
  message: string,
  deviceId?: string,
  sessionId?: string,
  userId?: string,
  attachments?: AgentAttachmentPayload[],
  onEvent?: AgentEventCallback,
): { abort: () => void; done: Promise<void> } {
  const controller = new AbortController();

  const done = (async () => {
    try {
      const res = await fetch(resolveUrl('/api/agent/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, deviceId, sessionId, userId, attachments }),
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
    activeModelId?: string | null;
    envApiKeyAvailable?: boolean;
    models?: Array<{
      id: string;
      label: string;
      provider: string;
      model: string;
      hasApiKey: boolean;
      baseUrl?: string;
      isActive: boolean;
    }>;
  }>('/api/agent/config');
}

export interface PersonaProfile {
  name: string;
  extraInstructions: string;
  riskLevel: 'conservative' | 'balanced' | 'aggressive';
  delegationBias: 'local-first' | 'balanced' | 'board-first';
  autonomyLevel: 'manual' | 'assisted' | 'autonomous';
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

export function fetchRDKClawSecurityAudit(limit = 30) {
  const qp = new URLSearchParams({ limit: String(limit) }).toString();
  return request<{ ok: boolean; items: SecurityAuditLogEntry[] }>(`/api/rdkclaw/security-audit?${qp}`);
}

export function clearRDKClawSecurityAudit() {
  return request<{ ok: boolean }>('/api/rdkclaw/security-audit/clear', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export interface ForumAuthView {
  username: string;
  hasPassword: boolean;
  hasCookie: boolean;
  hasApiKey: boolean;
  hasApiUsername: boolean;
  lastVerified: number | null;
  lastVerifyResult: 'ok' | 'failed' | null;
}

export function fetchRDKClawForumAuth() {
  return request<{ ok: boolean; auth: ForumAuthView }>('/api/rdkclaw/forum/auth');
}

export function saveRDKClawForumCredential(input: { username: string; password: string }) {
  return request<{
    ok: boolean; verified: boolean; verifyDetail: string;
    message: string; auth: ForumAuthView;
  }>('/api/rdkclaw/forum/auth', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function clearRDKClawForumAuth() {
  return request<{ ok: boolean; message: string }>('/api/rdkclaw/forum/auth/clear', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function decideRDKClawApproval(approvalId: string, decision: 'allow_once' | 'allow_session_auto' | 'allow_global_auto' | 'deny') {
  return request<{ ok: boolean }>(`/api/rdkclaw/approvals/${approvalId}/decision`, {
    method: 'POST',
    body: JSON.stringify({ decision }),
  });
}

export function sendRecommendationChoice(recommendationId: string, choiceId: string, autoExecute: boolean) {
  return request<{ ok: boolean }>(`/api/rdkclaw/recommendations/${recommendationId}/choice`, {
    method: 'POST',
    body: JSON.stringify({ choiceId, autoExecute }),
  });
}

export function sendSoulUpdateDecision(proposalId: string, accepted: boolean) {
  return request<{ ok: boolean; applied: boolean }>(`/api/rdkclaw/soul-updates/${proposalId}/decision`, {
    method: 'POST',
    body: JSON.stringify({ accepted }),
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

// ─── WeChat ClawBot API ───

export interface WeixinRuntimeStatus {
  running: boolean;
  accountCount: number;
  lastPollAt: number | null;
  lastError: string | null;
  enabled: boolean;
}

export interface WeixinConfigView {
  enabled: boolean;
  syncWithStudio: boolean;
  mirrorToStudioChat: boolean;
  ackOnReceive: boolean;
  ackStyle: 'text' | 'emoji' | 'off';
}

export interface WeixinAccountView {
  accountId: string;
  nickname: string;
  boundAt: number;
}

export function fetchWeixinStatus() {
  return request<{ ok: boolean } & WeixinRuntimeStatus>('/api/rdkclaw/weixin/status');
}

export function fetchWeixinConfig() {
  return request<{ ok: boolean; config: WeixinConfigView }>('/api/rdkclaw/weixin/config');
}

export function saveWeixinConfig(patch: Partial<WeixinConfigView>) {
  return request<{ ok: boolean; config: WeixinConfigView }>('/api/rdkclaw/weixin/config', {
    method: 'POST',
    body: JSON.stringify(patch),
  });
}

export function fetchWeixinAccounts() {
  return request<{ ok: boolean; accounts: WeixinAccountView[] }>('/api/rdkclaw/weixin/accounts');
}

export function addWeixinAccount(accountId: string, token: string, nickname?: string) {
  return request<{ ok: boolean }>('/api/rdkclaw/weixin/accounts', {
    method: 'POST',
    body: JSON.stringify({ accountId, token, nickname }),
  });
}

export function removeWeixinAccount(accountId: string) {
  return request<{ ok: boolean }>(`/api/rdkclaw/weixin/accounts/${accountId}`, {
    method: 'DELETE',
  });
}

export function restartWeixinChannel() {
  return request<{ ok: boolean }>('/api/rdkclaw/weixin/restart', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function saveAgentConfig(config: {
  action?: 'upsert' | 'switch' | 'delete';
  id?: string;
  label?: string;
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  setActive?: boolean;
}) {
  return request<{
    ok: boolean;
    active?: {
      id: string;
      provider: string;
      model: string;
      baseUrl?: string;
      hasApiKey: boolean;
    };
  }>('/api/agent/config', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

export interface AgentConfigExportPayload {
  version: number;
  exportedAt: number;
  activeId: string | null;
  entries: Array<{
    id: string;
    label: string;
    provider: string;
    model: string;
    apiKey: string;
    hasApiKey: boolean;
    baseUrl?: string;
    createdAt: number;
    updatedAt: number;
  }>;
}

export function exportAgentConfig(includeSecrets = true) {
  const qp = new URLSearchParams({ includeSecrets: includeSecrets ? '1' : '0' }).toString();
  return request<{ ok: boolean; includeSecrets: boolean; registry: AgentConfigExportPayload }>(`/api/agent/config/export?${qp}`);
}

export function importAgentConfig(payload: {
  registry: AgentConfigExportPayload;
  setActiveId?: string;
  merge?: boolean;
}) {
  return request<{ ok: boolean; imported: number; total: number; activeId: string | null; merged: boolean }>('/api/agent/config/import', {
    method: 'POST',
    body: JSON.stringify(payload),
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