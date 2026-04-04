import type { Device, DevicePayload } from './types';
import type { AgentPlan } from './app-types';
import { readStudioUiHintsForDevice } from './studio-ui-hints';
import { applySsoMirrorToHeaders, fetchApi, resolveApiUrl } from './utils/apiBase';
import { appendStudioLog } from './utils/console-log-capture';

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

/** 防止「后端不可达」时 fetch 长期挂起、界面一直转圈 */
function apiTimeoutSignal(ms: number): AbortSignal | undefined {
  try {
    if (typeof AbortSignal !== 'undefined' && typeof (AbortSignal as { timeout?: (n: number) => AbortSignal }).timeout === 'function') {
      return AbortSignal.timeout(ms);
    }
  } catch {
    /* ignore */
  }
  return undefined;
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
  applySsoMirrorToHeaders(headers);

  const deviceId = extractDeviceId(input);
  if (deviceId && !headers.has('x-device-password')) {
    const remembered = getRememberedDevicePassword(deviceId);
    if (remembered) {
      headers.set('x-device-password', remembered);
    }
  }

  const method = (init?.method ?? 'GET').toUpperCase();
  const maxAttempts = method === 'GET' || method === 'HEAD' || method === 'DELETE' ? 2 : 1;
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const response = await fetch(input, {
        ...init,
        headers,
        credentials: init?.credentials ?? 'include',
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

// ─── TypeC 闪连 API ───

export interface NetworkInterface {
  name: string;
  mac: string;
  addresses: string[];
  portType?: string;
}

export async function fetchTypecInterfaces() {
  appendStudioLog('info', '[TypeC] 请求网卡列表 GET /api/typec/interfaces');
  try {
    const r = await request<{ ok: boolean; interfaces: NetworkInterface[] }>('/api/typec/interfaces');
    const names = (r.interfaces ?? []).map((i) => `${i.name}${i.portType ? ` (${i.portType})` : ''}`).join(', ');
    appendStudioLog(
      'info',
      `[TypeC] 网卡 ${r.interfaces?.length ?? 0} 个${names ? `：${names}` : '（空）'}`,
    );
    return r;
  } catch (e) {
    appendStudioLog(
      'error',
      `[TypeC] 获取网卡失败：${e instanceof Error ? e.message : String(e)}`,
    );
    throw e;
  }
}

export async function configureTypecInterface(interfaceName: string, pcIp: string, netmask?: string) {
  const mask = netmask || '255.255.255.0';
  appendStudioLog(
    'info',
    `[TypeC] 配置网卡 POST /api/typec/configure iface=${interfaceName} pcIp=${pcIp} netmask=${mask}`,
  );
  try {
    const r = await request<{ ok: boolean; verified: boolean; output: string }>('/api/typec/configure', {
      method: 'POST',
      body: JSON.stringify({ interfaceName, pcIp, netmask: mask }),
    });
    const out = (r.output ?? '').trim().slice(0, 800);
    appendStudioLog(
      r.verified ? 'info' : 'warn',
      `[TypeC] 配置完成 verified=${String(r.verified)}${out ? ` · ${out}` : ''}`,
    );
    return r;
  } catch (e) {
    appendStudioLog(
      'error',
      `[TypeC] 配置失败：${e instanceof Error ? e.message : String(e)}`,
    );
    throw e;
  }
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
  const chatHeaders = new Headers({ 'Content-Type': 'application/json' });
  applySsoMirrorToHeaders(chatHeaders);
  return fetch(resolveUrl('/api/chat'), {
    method: 'POST',
    headers: chatHeaders,
    body: JSON.stringify({ messages, deviceName, deviceIp }),
    signal: controller.signal,
    credentials: 'include',
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
    | 'thinking_delta'
    | 'tool_start'
    | 'tool_progress'
    | 'tool_result'
    | 'approval_required'
    | 'approval_decision'
    | 'recommendation'
    | 'recommendation_choice'
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

export interface RdkclawDebugExportPayload {
  sessionId: string;
  deviceId?: string;
  userId?: string;
  /** 默认 true；为 false 时跳过 SSH 拉取板端 openclaw logs */
  includeBoardLogs?: boolean;
  uiSnapshot?: unknown;
}

/** 下载 RDKClaw 排查 zip（Agent JSONL、Dock 快照、可选板端日志、安全审计） */
export async function downloadRdkclawDebugBundle(payload: RdkclawDebugExportPayload): Promise<void> {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  applySsoMirrorToHeaders(headers);
  const res = await fetch(resolveUrl('/api/rdkclaw/export-debug-bundle'), {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || `导出失败 (${res.status})`);
  }
  const cd = res.headers.get('Content-Disposition');
  let filename = `rdkclaw-debug-${Date.now()}.zip`;
  const m = cd?.match(/filename="([^"]+)"/);
  if (m?.[1]) filename = m[1];
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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

/**
 * 解析单个 SSE 事件块（以空行分隔）。支持多行 data: 拼接、忽略注释行、去除 CRLF。
 */
function parseSseEventBlock(raw: string): { type: string; data: string } | null {
  const lines = raw.split('\n').map((line) => line.replace(/\r$/, ''));
  let eventType = 'message';
  const dataLines: string[] = [];
  for (const line of lines) {
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      eventType = line.slice(6).trim() || 'message';
      continue;
    }
    if (line.startsWith('data:')) {
      const payload = line.slice(5).startsWith(' ') ? line.slice(6) : line.slice(5);
      dataLines.push(payload);
    }
  }
  if (dataLines.length === 0) return null;
  return { type: eventType, data: dataLines.join('\n') };
}

function dispatchSseBlock(raw: string, onEvent?: AgentEventCallback) {
  const parsed = parseSseEventBlock(raw);
  if (!parsed) return;
  try {
    const data = JSON.parse(parsed.data) as Record<string, unknown>;
    onEvent?.({ type: parsed.type as AgentSSEEvent['type'], data });
  } catch {
    /* skip malformed JSON */
  }
}

export type StudioResponseMode = 'quick' | 'thinking';

/** 避免可选参数错位导致 attachments/onEvent 传错 */
export interface StreamAgentChatOptions {
  attachments?: AgentAttachmentPayload[];
  studioResponseMode?: StudioResponseMode;
  /** 与 Dock「重试」对齐：服务端截断尾部 assistant 并复用同一条 user */
  studioRegenerate?: boolean;
}

/** 等待 HTTP 响应头（含网关排队） */
const AGENT_CHAT_FETCH_HEADERS_TIMEOUT_MS = 120_000;
/** 首段 SSE 数据：模型冷启动 + 长思考可能较慢 */
const AGENT_CHAT_SSE_FIRST_CHUNK_TIMEOUT_MS = 180_000;
/** 相邻数据块之间：长输出时偶尔停顿 */
const AGENT_CHAT_SSE_CHUNK_IDLE_TIMEOUT_MS = 300_000;

class SseIdleError extends Error {
  override name = 'SseIdleError';
  constructor(message: string) {
    super(message);
  }
}

function readSseChunkWithIdleTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  idleMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new SseIdleError('idle')), idleMs);
    reader.read().then(
      (r) => {
        clearTimeout(t);
        resolve(r);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export function streamAgentChat(
  message: string,
  deviceId?: string,
  sessionId?: string,
  userId?: string,
  options?: StreamAgentChatOptions,
  onEvent?: AgentEventCallback,
): { abort: () => void; done: Promise<void> } {
  const controller = new AbortController();
  const attachments = options?.attachments;
  const studioResponseMode = options?.studioResponseMode;
  const studioRegenerate = Boolean(options?.studioRegenerate);
  let abortKind: 'user' | 'headers' | 'sse_meaningful_idle' | null = null;

  const done = (async () => {
    const headersTimer = setTimeout(() => {
      abortKind = 'headers';
      controller.abort();
    }, AGENT_CHAT_FETCH_HEADERS_TIMEOUT_MS);
    let sseMeaningfulWatchdog: ReturnType<typeof setInterval> | undefined;
    try {
      const studioUiHints = readStudioUiHintsForDevice(deviceId);
      const agentHeaders = new Headers({ 'Content-Type': 'application/json' });
      applySsoMirrorToHeaders(agentHeaders);
      const res = await fetch(resolveUrl('/api/agent/chat'), {
        method: 'POST',
        headers: agentHeaders,
        body: JSON.stringify({
          message,
          deviceId,
          sessionId,
          userId,
          studioResponseMode,
          attachments,
          ...(studioRegenerate ? { studioRegenerate: true } : {}),
          ...(studioUiHints ? { studioUiHints } : {}),
        }),
        signal: controller.signal,
        credentials: 'include',
      });

      clearTimeout(headersTimer);

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

      /**
       * 服务端 SSE 会写 `: keepalive`，每次 read 都有数据，原「相邻块空闲」计时几乎永不触发。
       * 用「有效 JSON 事件」时间做看门狗，避免排队/卡住时界面永久「正在组织回答」。
       */
      const streamBodyStartedAt = Date.now();
      let lastMeaningfulEventAt = 0;
      let awaitingFirstMeaningfulChunk = true;
      let closedBySseMeaningfulIdle = false;
      const FIRST_MEANINGFUL_WALL_MS = 900_000;
      const MEANINGFUL_GAP_MS = 600_000;

      const emit: AgentEventCallback = (e) => {
        lastMeaningfulEventAt = Date.now();
        awaitingFirstMeaningfulChunk = false;
        onEvent?.(e);
      };

      sseMeaningfulWatchdog = setInterval(() => {
        if (closedBySseMeaningfulIdle) return;
        const now = Date.now();
        if (lastMeaningfulEventAt === 0) {
          if (now - streamBodyStartedAt > FIRST_MEANINGFUL_WALL_MS) {
            closedBySseMeaningfulIdle = true;
            abortKind = 'sse_meaningful_idle';
            emit({
              type: 'error',
              data: {
                error:
                  '长时间只收到连接心跳、未收到有效对话事件（常见于在设备队列中久候或链路异常）。请点「结束当前」后重试，或检查后端与网络。',
              },
            });
            controller.abort();
          }
        } else if (now - lastMeaningfulEventAt > MEANINGFUL_GAP_MS) {
          closedBySseMeaningfulIdle = true;
          abortKind = 'sse_meaningful_idle';
          emit({
            type: 'error',
            data: {
              error:
                '长时间未收到新的有效流式事件。若板端仍在执行可再等待；否则请点「结束当前」或稍后重试。',
            },
          });
          controller.abort();
        }
      }, 4000);

      const decoder = new TextDecoder();
      let buffer = '';

      const flushCompleteBlocks = () => {
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        for (const block of parts) {
          if (block.trim()) dispatchSseBlock(block, emit);
        }
      };

      while (true) {
        const idleMs = awaitingFirstMeaningfulChunk
          ? AGENT_CHAT_SSE_FIRST_CHUNK_TIMEOUT_MS
          : AGENT_CHAT_SSE_CHUNK_IDLE_TIMEOUT_MS;
        let readerDone: boolean;
        let value: Uint8Array | undefined;
        try {
          const r = await readSseChunkWithIdleTimeout(reader, idleMs);
          readerDone = r.done;
          value = r.value;
        } catch (e) {
          if (e instanceof SseIdleError) {
            emit({
              type: 'error',
              data: {
                error: awaitingFirstMeaningfulChunk
                  ? '等待服务端首包超时（长时间无数据）。请确认本机网络与 RDK Studio 后端未卡住，或稍后重试。'
                  : '长时间未收到新的流式数据，已断开。若推理时间过长可改用「快捷回答」或缩短问题后重试。',
              },
            });
            try {
              await reader.cancel();
            } catch {
              /* noop */
            }
            return;
          }
          throw e;
        }
        if (readerDone) break;

        buffer += decoder.decode(value!, { stream: true });
        flushCompleteBlocks();
      }

      buffer += decoder.decode();
      if (buffer.trim()) {
        for (const block of buffer.split('\n\n')) {
          if (block.trim()) dispatchSseBlock(block, emit);
        }
      }
      /**
       * 服务端在 headers 之后立刻结束、且正文里没有任何可解析的 JSON SSE 时，此前逻辑会「正常结束」但从未 emit，
       * 前端只剩「未收到可见回复」兜底（用户误以为是我们改坏了流）。这里显式给 error，便于对照后端日志。
       */
      if (lastMeaningfulEventAt === 0 && !closedBySseMeaningfulIdle) {
        emit({
          type: 'error',
          data: {
            error:
              '连接已关闭，但未收到任何有效对话事件（常见于后端在首包前异常退出、会话被中止或代理剥掉了 SSE 正文）。请查看 RDK Studio 后端终端日志并重试；若刚点了「结束当前」，可忽略本条。',
          },
        });
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        if (abortKind === 'headers') {
          onEvent?.({
            type: 'error',
            data: { error: '等待接口响应超时。请检查后端是否在运行、网络与 VPN/代理是否正常。' },
          });
        }
        return;
      }
      onEvent?.({ type: 'error', data: { error: (err as Error).message } });
    } finally {
      clearTimeout(headersTimer);
      if (sseMeaningfulWatchdog) clearInterval(sseMeaningfulWatchdog);
    }
  })();

  return {
    abort: () => {
      abortKind = 'user';
      controller.abort();
    },
    done,
  };
}

export function fetchAgentConfig() {
  return request<{
    configured: boolean;
    provider?: string;
    model?: string;
    hasApiKey?: boolean;
    baseUrl?: string;
    thinkingDefault?: string;
    reasoningVisibility?: string;
    samplingTemperature?: string;
    samplingTopP?: string;
    activeModelId?: string | null;
    /** Dock「快速回答」绑定的模型条目 id（加载配置时会尽量补全为内置快速条目） */
    quickActiveModelId?: string | null;
    envApiKeyAvailable?: boolean;
    /** 安装包内置默认模型（bootstrap），用于「恢复默认」 */
    studioDefaultPreset?: {
      id: string;
      label: string;
      inRegistry: boolean;
      isActive: boolean;
    } | null;
    /** 安装包内置「快速回答」默认条目（来自 rdkclaw-provider.defaults.json） */
    studioQuickDefaultPreset?: {
      id: string;
      label: string;
      inRegistry: boolean;
      isQuickLane: boolean;
    } | null;
    models?: Array<{
      id: string;
      label: string;
      provider: string;
      model: string;
      hasApiKey: boolean;
      baseUrl?: string;
      isActive: boolean;
      isQuickLane?: boolean;
      thinkingDefault?: string;
      reasoningVisibility?: string;
      samplingTemperature?: string;
      samplingTopP?: string;
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
    signal: apiTimeoutSignal(20_000),
  });
}

export function fetchRDKClawPolicy() {
  return request<{ ok: boolean; policy: RDKClawPolicy }>('/api/rdkclaw/policy');
}

export function saveRDKClawPolicy(patch: Partial<RDKClawPolicy>) {
  return request<{ ok: boolean; policy: RDKClawPolicy }>('/api/rdkclaw/policy', {
    method: 'POST',
    body: JSON.stringify(patch),
    signal: apiTimeoutSignal(20_000),
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
  /** 本地已保存主应用 access_token（供服务端换论坛会话，前端不可见内容） */
  hasAppSsoAccessTokenSaved: boolean;
  /** 论坛 Cookie 是否由主应用 SSO 登录自动写入 */
  linkedFromAppSso: boolean;
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

export function cancelRDKClawRun(runId: string) {
  return request<{ ok: boolean; alreadyEnded?: boolean }>(`/api/rdkclaw/runs/${runId}/cancel`, {
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

export function cancelAllRDKClawRuns() {
  return request<{ ok: boolean; cancelled: number; cancelledAutonomyRuns?: number; pausedAutonomyTasks?: number }>('/api/rdkclaw/runs/cancel-all', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function getActiveRDKClawRuns() {
  return request<{ ok: boolean; runs: string[] }>('/api/rdkclaw/runs/active', {
    method: 'GET',
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
  const id = encodeURIComponent(accountId);
  return request<{ ok: boolean; message?: string }>(`/api/rdkclaw/weixin/accounts/${id}`, {
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
  action?: 'upsert' | 'switch' | 'switch_quick' | 'duplicate_for_quick' | 'delete' | 'restore_bootstrap_preset';
  /** duplicate_for_quick：源配置 id，省略则用当前深度思考 active */
  sourceId?: string;
  id?: string;
  label?: string;
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  setActive?: boolean;
  thinkingDefault?: string;
  reasoningVisibility?: string;
  samplingTemperature?: string;
  samplingTopP?: string;
}) {
  return request<{
    ok: boolean;
    /** action 为 upsert 时返回的条目 id（新建或更新后） */
    savedId?: string;
    quickActiveModelId?: string | null;
    createdId?: string;
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
  quickActiveId?: string | null;
  entries: Array<{
    id: string;
    label: string;
    provider: string;
    model: string;
    apiKey: string;
    hasApiKey: boolean;
    baseUrl?: string;
    thinkingDefault?: string;
    reasoningVisibility?: string;
    samplingTemperature?: string;
    samplingTopP?: string;
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
  const planHeaders = new Headers({ 'Content-Type': 'application/json' });
  applySsoMirrorToHeaders(planHeaders);
  return fetch(resolveUrl('/api/agent/plan'), {
    method: 'POST',
    headers: planHeaders,
    body: JSON.stringify({ goal, deviceName, deviceIp }),
    signal: controller.signal,
    credentials: 'include',
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
  const ocHeaders = new Headers({ 'Content-Type': 'application/json' });
  applySsoMirrorToHeaders(ocHeaders);
  return fetch(resolveUrl('/api/openclaw/agent-action'), {
    method: 'POST',
    headers: ocHeaders,
    body: JSON.stringify({ action, ...params }),
    signal: controller.signal,
    credentials: 'include',
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

/** 将内置「同伴商量」技能同步到板端 ~/.openclaw/workspace/skills/（已一致则跳过） */
export interface EnsurePartnerAdvisorySkillResult {
  ok: boolean;
  action?: 'skipped' | 'deployed' | 'error';
  cached?: boolean;
  version?: string;
  verified?: boolean;
  reason?: string;
  message?: string;
  remoteSha256?: string;
  previous?: unknown;
}

export function ensurePartnerAdvisorySkill(deviceId: string, password?: string) {
  return request<EnsurePartnerAdvisorySkillResult>(`/api/devices/${deviceId}/openclaw/ensure-partner-advisory-skill`, {
    method: 'POST',
    headers: password ? { 'x-device-password': password } : undefined,
    body: JSON.stringify({}),
  });
}

/** 按板型将内置技能包同步到板端（X5→rdkx5_skills；X3/S100/Ultra→文档与指南类 skills） */
export interface EnsureBoardSkillBundleResult {
  ok: boolean;
  platform?: string;
  bundleRoot?: string;
  deployed?: string[];
  skipped?: { id: string; reason: string }[];
  errors?: { id: string; message: string }[];
  message?: string;
  code?: string;
}

export function ensureBoardSkillBundle(deviceId: string, password?: string) {
  return request<EnsureBoardSkillBundleResult>(`/api/devices/${deviceId}/openclaw/ensure-board-skill-bundle`, {
    method: 'POST',
    headers: password ? { 'x-device-password': password } : undefined,
    body: JSON.stringify({}),
  });
}

/**
 * 探测本机 RDK Studio 服务是否存活（含 RDKClaw 等 API）。
 * 使用 fetchApi 而非 request()，避免失败时触发全局 rdk-api-error 弹窗。
 */
export async function fetchStudioHealth(): Promise<{ ok: boolean }> {
  try {
    const r = await fetchApi('/api/health');
    if (!r.ok) return { ok: false };
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean };
    return { ok: j.ok === true };
  } catch {
    return { ok: false };
  }
}

export function installDeviceOpenClaw(deviceId: string, password?: string) {
  return request<{ ok: boolean; output: string }>(`/api/devices/${deviceId}/openclaw/install`, {
    method: 'POST',
    headers: password ? { 'x-device-password': password } : undefined,
    body: JSON.stringify({}),
  });
}

/**
 * 设备可达性探测（后台轮询用）。不得走 request()：服务端在 ID 不存在时返回 404，
 * 否则会触发全局 rdk-api-error，每十几秒弹一次「设备不存在」。
 * 须与 request() 一致附带 x-device-password（sessionStorage）及 SSO 镜像头，否则服务端无凭据会恒为 offline，
 * 而 diagnostics 等走 request() 仍能成功，造成「有指标却显示设备离线」。
 */
/** ping 不可判定：网关/网络波动，勿当作设备 SSH 离线 */
const PING_TRANSIENT_HTTP = new Set([408, 429, 502, 503, 504]);

export async function checkDevicePing(deviceId: string): Promise<{ ok: boolean; status: string }> {
  const id = String(deviceId || '').trim();
  if (!id) return { ok: false, status: 'offline' };
  try {
    const url = resolveUrl(`/api/devices/${encodeURIComponent(id)}/ping`);
    const headers = new Headers();
    const remembered = getRememberedDevicePassword(id);
    if (remembered) {
      headers.set('x-device-password', remembered);
    }
    applySsoMirrorToHeaders(headers);
    const response = await fetch(url, { method: 'GET', headers, credentials: 'include' });
    const data = (await response.json().catch(() => ({}))) as { ok?: boolean; status?: string };
    if (!response.ok) {
      if (PING_TRANSIENT_HTTP.has(response.status)) {
        return { ok: false, status: 'transient' };
      }
      return { ok: false, status: 'offline' };
    }
    return {
      ok: Boolean(data.ok),
      status: typeof data.status === 'string' ? data.status : (data.ok ? 'connected' : 'offline'),
    };
  } catch {
    return { ok: false, status: 'transient' };
  }
}

export function executeDeviceCommand(deviceId: string, command: string, password?: string) {
  return request<DeviceExecResult>(`/api/devices/${deviceId}/exec`, {
    method: 'POST',
    headers: password ? { 'x-device-password': password } : undefined,
    body: JSON.stringify({ command }),
  });
}

export function fetchDeviceWifiList(deviceId: string) {
  return request<{ ok: boolean; wifiNames: string[]; errorHint?: string }>(
    `/api/devices/${deviceId}/openclaw/wifi-list`,
  );
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
