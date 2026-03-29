import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { prepareWeChatQrPreviewBuffer } from './rdkclaw/ilink-qrcode.js';
import { putWeixinQrPreview, getWeixinQrPreview } from './rdkclaw/weixin-qr-preview.js';
import { v4 as uuid } from 'uuid';
import crypto from 'node:crypto';
import { promises as fs, existsSync } from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import type { ChatMessage, Device, StudioUiHints } from '../shared/types.js';
import { readDevices, writeDevices } from './storage.js';
import {
  devicePasswordCache,
  credentialCacheKey,
  setDevicePasswordCache,
  deleteDevicePasswordCache,
} from './device-password-cache.js';
import { runRemoteCommands, verifySshConnection, uploadFileSftp } from './ssh.js';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { Client } from 'ssh2';
import WebSocket, { WebSocketServer } from 'ws';
import * as net from 'net';
import { OpenClawDeploymentManager } from './managers/OpenClawDeploymentManager.js';
import * as path from 'path';
import {
  buildBoardDetectionCommand,
  parseBoardDetection,
  getDeviceProfile,
  getResearchSeeds,
} from './board/device-profiles.js';
import type { RdkPlatform } from '../shared/board-types.js';
import { shellEscape, isSafeName } from './utils/shell-escape.js';
import {
  DEFAULT_VNC_PORT, OPENCLAW_GATEWAY_PORT,
  AI_REQUEST_TIMEOUT_MS,
  FLASH_TMP_IMAGE_XZ, FLASH_TMP_IMAGE_RAW, FLASH_DEFAULT_DEST,
  DIAGNOSTIC_COMMANDS, buildSystemPrompt,
} from './constants.js';
import { loadAllSkills, getSkillByName, getRawSkillMd, buildSkillContext } from './skill-loader.js';
import {
  loadProviderConfig,
  loadProviderRegistry,
  saveProviderRegistry,
  upsertProviderConfigEntry,
  switchActiveProviderConfig,
  deleteProviderConfigEntry,
  getBootstrapStudioDefaultPresetMeta,
  getActiveProviderEntry,
  restoreStudioDefaultPresetFromBootstrap,
  type ProviderConfigRegistry,
} from './agent/provider-setup.js';
import { RDKClawApp } from './rdkclaw/app.js';
import { FeishuChannelAdapter } from './rdkclaw/feishu-channel-adapter.js';
import { FeishuApiClient } from './rdkclaw/feishu-api-client.js';
import { FeishuAuthStore } from './rdkclaw/feishu-auth-store.js';
import { FeishuConfigStore } from './rdkclaw/feishu-config-store.js';
import { FeishuWebSocketChannel } from './agent/channels/feishu.js';
import { WeixinConfigStore } from './rdkclaw/weixin-config-store.js';
import { WeixinAccountStore } from './rdkclaw/weixin-account-store.js';
import { ForumAuthStore } from './rdkclaw/forum-auth-store.js';
import { verifyForumSsoLogin } from './agent/tools/forum-tools.js';
import { WeixinPollingChannel } from './agent/channels/weixin.js';
import { AutonomyScheduler } from './rdkclaw/autonomy-scheduler.js';
import { NotificationHub } from './rdkclaw/notification-hub.js';
import type { ApprovalDecisionMode, RDKClawExecutionMode } from './rdkclaw/types.js';
import { clearSecurityAuditLogs, listSecurityAuditLogs } from './rdkclaw/security-audit-store.js';
import {
  isSSOEnabled,
  isSSORequired,
  ssoAuthMiddleware,
  registerSSORoutes,
  restoreSsoSessionsFromDisk,
  formatConversationArchiveUserName,
  getSessionSsoUserFromIncomingMessage,
  type SSOUser,
} from './sso.js';
import { registerAnalyticsRoutes } from './analytics-routes.js';
import { getTokenUsageReport, recordTokenUsage, resetTokenUsage, removeTokenUsageByDevice } from './monitoring/token-usage.js';
import { getDeviceLaneStats, runInDeviceLane } from './device-exec-scheduler.js';
import { handleEnsurePartnerAdvisorySkill } from './rdkclaw/partner-advisory-skill-deploy.js';
import {
  registerStudioBrowserCaptureSocket,
  submitStudioBrowserCapture,
  cancelStudioBrowserCapture,
  cancelAllPendingStudioBrowserCaptures,
} from './studio-browser-capture.js';

const app = express();
const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer, {
  // 与 Express cors({ credentials: true, origin: true }) 对齐，便于浏览器携带 SSO Cookie
  cors: { origin: true, credentials: true },
});
registerStudioBrowserCaptureSocket(io);

const wss = new WebSocketServer({ noServer: true });
const rosbridgeWss = new WebSocketServer({ noServer: true });
const ROSBRIDGE_DEVICE_PORT = 9090;

async function handleRosbridgeProxy(clientWs: WebSocket, req: http.IncomingMessage) {
  if (isSSORequired()) {
    const user = getSessionSsoUserFromIncomingMessage(req);
    if (!user) {
      clientWs.close(1008, 'unauthorized');
      return;
    }
  }
  const u = new URL(req.url || '', 'http://localhost');
  const deviceId = u.searchParams.get('deviceId')?.trim();
  if (!deviceId) {
    clientWs.close(1008, 'missing deviceId');
    return;
  }
  let devices: Device[];
  try {
    devices = await readDevices();
  } catch (err) {
    console.warn('[rosbridge-ws] readDevices failed:', err instanceof Error ? err.message : err);
    clientWs.close(1011, 'server error');
    return;
  }
  const device = devices.find(d => d.id === deviceId);
  if (!device) {
    clientWs.close(1008, 'device not found');
    return;
  }
  const host = device.host;
  const targetUrl = `ws://${host}:${ROSBRIDGE_DEVICE_PORT}/`;
  const upstream = new WebSocket(targetUrl);

  const pending: Buffer[] = [];
  const pendingBinary: boolean[] = [];

  clientWs.on('message', (data, isBinary) => {
    const bin = !!isBinary;
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data, { binary: bin });
    } else if (upstream.readyState === WebSocket.CONNECTING) {
      pending.push(Buffer.from(data as Buffer));
      pendingBinary.push(bin);
    }
  });

  upstream.on('open', () => {
    for (let i = 0; i < pending.length; i++) {
      upstream.send(pending[i], { binary: pendingBinary[i] });
    }
    pending.length = 0;
    pendingBinary.length = 0;
  });

  upstream.on('message', (data, isBinary) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data, { binary: !!isBinary });
    }
  });

  upstream.on('error', (err) => {
    console.warn('[rosbridge-ws] upstream error:', err instanceof Error ? err.message : err);
    try { clientWs.close(); } catch { /* noop */ }
    try { upstream.close(); } catch { /* noop */ }
  });
  clientWs.on('error', () => {
    try { upstream.close(); } catch { /* noop */ }
  });
  upstream.on('close', () => {
    try { clientWs.close(); } catch { /* noop */ }
  });
  clientWs.on('close', () => {
    try { upstream.close(); } catch { /* noop */ }
  });
}

/**
 * 必须在 Engine.IO 的 upgrade 监听之前处理自定义路径，否则 engine 会先对非 /socket.io 路径
 * 安排 destroyUpgrade 定时器，与后续 handleUpgrade 竞态可能导致异常或连接被 RST。
 * prependListener 保证先于 socket.io 已注册的监听器执行。
 */
httpServer.prependListener('upgrade', (request, socket, head) => {
  const url = request.url || '';
  try {
    if (url.startsWith('/api/rosbridge-ws')) {
      rosbridgeWss.handleUpgrade(request, socket, head, (ws) => {
        void handleRosbridgeProxy(ws, request).catch((err) => {
          console.warn('[rosbridge-ws] proxy error:', err instanceof Error ? err.message : err);
          try { ws.close(); } catch { /* noop */ }
        });
      });
    } else if (url.startsWith('/websockify')) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  } catch (err) {
    console.warn('[upgrade] custom path failed:', err instanceof Error ? err.message : err);
    try { socket.destroy(); } catch { /* noop */ }
  }
});

function isPrivateIp(ip: string): boolean {
  return /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|localhost$)/.test(ip);
}

wss.on('connection', (ws, req) => {
  const urlParams = new URLSearchParams(req.url?.split('?')[1] || '');
  const target = urlParams.get('target');
  if (!target) { ws.close(); return; }

  const [host, portStr] = target.split(':');
  const targetPort = Number(portStr || DEFAULT_VNC_PORT);
  if (!isPrivateIp(host) || targetPort < 1 || targetPort > 65535) {
    console.warn(`[noVNC] rejected proxy to non-private target: ${target}`);
    ws.close();
    return;
  }

  const tcpSocket = net.connect(targetPort, host, () => {
    console.log(`[noVNC] proxied to ${host}:${targetPort}`);
  });

  tcpSocket.on('data', (data) => {
    if (ws.readyState === ws.OPEN) ws.send(data);
  });
  
  ws.on('message', (msg: Buffer) => {
    if (!tcpSocket.destroyed) tcpSocket.write(msg);
  });
  
  tcpSocket.on('close', () => ws.close());
  tcpSocket.on('error', () => ws.close());
  ws.on('close', () => tcpSocket.destroy());
  ws.on('error', () => tcpSocket.destroy());
});

const port = Number(process.env.PORT ?? 8787);
/** 与仓库 `config/rdkclaw-provider.defaults.json` 对齐；RDKClaw 主链路以 ~/.rdkstudio/agent-config.json 为准 */
const baseUrl = process.env.OPENAI_BASE_URL ?? 'https://ark.cn-beijing.volces.com/api/coding/v3';
const apiKey = process.env.OPENAI_API_KEY ?? '';
const model = process.env.OPENAI_MODEL ?? 'doubao-seed-2.0-lite';
const defaultSshPassword = process.env.RDK_SSH_PASSWORD ?? '';
const SUPPORTED_OPENCLAW_APIS = new Set([
  'openai-completions',
  'anthropic-messages',
]);
type FlashBackupJob = {
  id: string;
  deviceId: string;
  status: 'running' | 'done' | 'error';
  outputPath?: string;
  output?: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
};
const flashBackupJobs = new Map<string, FlashBackupJob>();
type OpenClawDeployStepName = 'check' | 'prepare' | 'install' | 'config';
type OpenClawDeployStepState = 'pending' | 'running' | 'done' | 'error';
type OpenClawDeployJob = {
  id: string;
  deviceId: string;
  status: 'running' | 'done' | 'error';
  steps: Record<OpenClawDeployStepName, OpenClawDeployStepState>;
  output: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
};
const openClawDeployJobs = new Map<string, OpenClawDeployJob>();
const OPENCLAW_DEPLOY_JOB_TTL_MS = 6 * 60 * 60 * 1000;
const FLASH_BACKUP_JOB_TTL_MS = 24 * 60 * 60 * 1000;
const RUNTIME_JOBS_STATE_FILE = 'runtime-jobs.json';
const EXEC_COMMAND_MAX_LENGTH = 4000;
const BATCH_EXEC_MAX_COMMANDS = 30;
const ONE_SHOT_PROMPT_MAX_CHARS = 600;
const ONE_SHOT_MAX_FILES = 24;
const ONE_SHOT_MAX_FILE_CHARS = 120_000;
const ONE_SHOT_MAX_TOTAL_CHARS = 400_000;
const ONE_SHOT_DEPLOY_MAX_FILES = 80;
const ONE_SHOT_DEPLOY_MAX_BYTES = 2 * 1024 * 1024;
let runtimeJobsPersistTimer: ReturnType<typeof setTimeout> | null = null;

type WorkspaceModuleHealth = {
  ready: boolean;
  installed: boolean;
  running?: boolean;
  summary: string;
  recommendedAction: string;
  missing?: string[];
};

type DeviceWorkspaceHealth = {
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
};

type OneShotGeneratedFile = {
  path: string;
  content: string;
};

type OneShotAppPlan = {
  appName: string;
  summary: string;
  files: OneShotGeneratedFile[];
  runCommand: string;
  testCommand?: string;
};

type OneShotValidationResult = {
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
};

type OneShotFixSuggestion = {
  title: string;
  detail: string;
  command?: string;
};

const WORKSPACE_HEALTH_SCRIPT = [
  // Cache expensive system queries upfront (each runs once instead of 3×)
  '_dpkg=$(dpkg -l 2>/dev/null | awk "/^ii/{print \\$2}")',
  '_ss=$(ss -lntp 2>/dev/null)',
  '_ps=$(ps -eo args --no-headers 2>/dev/null)',
  // Source TROS so ros2 CLI is discoverable even when not in default PATH
  'test -f /opt/tros/humble/setup.bash && . /opt/tros/humble/setup.bash 2>/dev/null || true',
  'python_ready=$(command -v python3 >/dev/null 2>&1 && echo 1 || echo 0)',
  'git_ready=$(command -v git >/dev/null 2>&1 && echo 1 || echo 0)',
  'node_ready=$(command -v node >/dev/null 2>&1 && echo 1 || echo 0)',
  'npm_ready=$(command -v npm >/dev/null 2>&1 && echo 1 || echo 0)',
  'code_installed=$(command -v code-server >/dev/null 2>&1 && echo 1 || echo 0)',
  'code_running=$( (echo "$_ss" | grep -q ":13337" || echo "$_ps" | grep -q "code-server.*13337") && echo 1 || echo 0 )',
  'vnc_installed=$( (command -v x11vnc >/dev/null 2>&1 || command -v vncserver >/dev/null 2>&1) && echo 1 || echo 0 )',
  'vnc_running=$( (echo "$_ss" | grep -q ":5900" || echo "$_ps" | grep -qE "x11vnc|Xtigervnc|vncserver") && echo 1 || echo 0 )',
  'ros2_ready=$(command -v ros2 >/dev/null 2>&1 && echo 1 || echo 0)',
  'rosbridge_installed=$(echo "$_dpkg" | grep -q "rosbridge" && echo 1 || echo 0)',
  'rosbridge_running=$( (echo "$_ss" | grep -q ":9090" || echo "$_ps" | grep -qE "rosbridge_websocket|rosbridge_server") && echo 1 || echo 0 )',
  'tros_count=$(echo "$_dpkg" | grep -Ec "^(tros-|hobot)" || true)',
  'ros_distro=$(printenv ROS_DISTRO 2>/dev/null || ls -1 /opt/tros/ 2>/dev/null | head -1 || ls -1 /opt/ros/ 2>/dev/null | head -1 || echo humble)',
  'modelzoo_dir=$(test -d /opt/rdk_model_zoo && echo 1 || echo 0)',
  'hrt_ready=$(command -v hrt_model_exec >/dev/null 2>&1 && echo 1 || echo 0)',
  'bpu_ready=$(if [ "$python_ready" = "1" ]; then python3 -c "import importlib.util; mods=(\'hobot_dnn\',\'hobot_dnn_rdkx5\',\'bpu_infer_lib_x5\',\'bpu_infer_lib_x3\'); print(1 if any(importlib.util.find_spec(name) is not None for name in mods) else 0)" 2>/dev/null || echo 0; else echo 0; fi)',
  'printf "checked_at=%s\\n" "$(date +%s)"',
  'printf "python_ready=%s\\n" "$python_ready"',
  'printf "git_ready=%s\\n" "$git_ready"',
  'printf "node_ready=%s\\n" "$node_ready"',
  'printf "npm_ready=%s\\n" "$npm_ready"',
  'printf "code_installed=%s\\n" "$code_installed"',
  'printf "code_running=%s\\n" "$code_running"',
  'printf "vnc_installed=%s\\n" "$vnc_installed"',
  'printf "vnc_running=%s\\n" "$vnc_running"',
  'printf "ros2_ready=%s\\n" "$ros2_ready"',
  'printf "rosbridge_installed=%s\\n" "$rosbridge_installed"',
  'printf "rosbridge_running=%s\\n" "$rosbridge_running"',
  'printf "tros_count=%s\\n" "$tros_count"',
  'printf "ros_distro=%s\\n" "$ros_distro"',
  'printf "modelzoo_dir=%s\\n" "$modelzoo_dir"',
  'printf "hrt_ready=%s\\n" "$hrt_ready"',
  'printf "bpu_ready=%s\\n" "$bpu_ready"',
].join('; ');
const WORKSPACE_HEALTH_COMMAND = `bash -lc ${shellEscape(WORKSPACE_HEALTH_SCRIPT)}`;

// OpenClaw Manager
const resourcesPath = path.join(process.cwd(), 'build-resources');
const openClawManager = new OpenClawDeploymentManager(resourcesPath);
const rdkclaw = new RDKClawApp(process.cwd(), openClawManager);
const notificationHub = new NotificationHub(io);
const feishuAdapter = new FeishuChannelAdapter(rdkclaw);
const feishuConfigStore = new FeishuConfigStore();
let feishuConfig = feishuConfigStore.getConfig();
let feishuApi = new FeishuApiClient(feishuConfig.appId, feishuConfig.appSecret);
const feishuAuth = new FeishuAuthStore();
rdkclaw.setSwitchDeviceCallback((deviceId) => {
  feishuAuth.setLatestUiDevice(deviceId);
});
const feishuChannel = new FeishuWebSocketChannel({
  rdkclaw,
  authStore: feishuAuth,
  getConfig: () => feishuConfig,
  notificationHub,
});
const feishuEventSeen = new Map<string, number>();
let feishuLastEventAt: number | null = null;
let feishuLastAuthorizedAt: number | null = null;

const forumAuthStore = new ForumAuthStore();
forumAuthStore.load();

const weixinConfigStore = new WeixinConfigStore();
const weixinAccountStore = new WeixinAccountStore();
weixinAccountStore.importFromOpenClawDir();
const weixinChannel = new WeixinPollingChannel({
  rdkclaw,
  accountStore: weixinAccountStore,
  getConfig: () => weixinConfigStore.getConfig(),
  notificationHub,
  feishuAuthStore: feishuAuth,
});
if (weixinConfigStore.getConfig().enabled && weixinAccountStore.listAccounts().length > 0) {
  weixinChannel.start();
  console.log('[Weixin] 微信 ClawBot 渠道已启动');
}

const autonomyScheduler = new AutonomyScheduler(rdkclaw, notificationHub, {
  notifyWeixin: (userId, text) => weixinChannel.sendToUser(userId, text),
  notifyFeishu: (chatId, text) => feishuChannel.sendOutboundChat(chatId, text, true),
});
if (!feishuApi.isConfigured()) {
  console.warn('[Feishu] FEISHU_APP_ID / FEISHU_APP_SECRET 未配置，Webhook 将无法主动回消息。');
}
rdkclaw.setAutonomyRuntime({
  listTasks: () => autonomyScheduler.list(),
  createTask: (input) => autonomyScheduler.create(input),
  pauseTask: (taskId) => autonomyScheduler.pause(taskId),
  stopTask: (taskId) => autonomyScheduler.stop(taskId),
  resumeTask: (taskId) => autonomyScheduler.resume(taskId),
  approveTask: (taskId) => autonomyScheduler.approve(taskId),
  weixinOutbound: {
    listRecentUsers: () => weixinChannel.getRecentUsers().map((u) => ({
      userId: u.userId,
      maskedId: u.maskedId,
      lastMessageText: u.lastMessageText,
      lastSeenAt: u.lastSeenAt,
      accountId: u.accountId,
    })),
    sendText: (userId, text) => weixinChannel.sendToUser(userId, text),
  },
  feishuOutbound: {
    listRecentChats: () => feishuChannel.getRecentChats(),
    sendText: (chatId, text, allowUnknown) => feishuChannel.sendOutboundChat(chatId, text, allowUnknown ?? false),
  },
});
autonomyScheduler.start();
syncFeishuRuntime().catch((error) => {
  console.error('[Feishu] websocket 初始化失败:', error instanceof Error ? error.message : error);
});

const shEscape = (raw: string) => `'${raw.replace(/'/g, `'"'"'`)}'`;
const sanitizeDevice = (device: Device & { password?: string }) => {
  const { password: _password, ...safe } = device;
  return safe;
};

async function resolveDevice(request: express.Request, response: express.Response, id: string) {
  const devices = await readDevices();
  const device = devices.find((item) => item.id === id);
  if (!device) {
    response.status(404).json({ error: '设备不存在' });
    return null;
  }
  return device;
}

function resolvePassword(request: express.Request, device: Device) {
  const key = credentialCacheKey(device.host, device.username, device.port ?? 22);
  const cachedPassword = devicePasswordCache.get(key);
  const providedPassword = request.header('x-device-password') ?? '';
  const persistedPassword = (device as Device & { password?: string }).password ?? '';
  const password = providedPassword || cachedPassword || persistedPassword || defaultSshPassword;
  return { password, key };
}

function resolveStoredDevicePassword(device: Device) {
  const key = credentialCacheKey(device.host, device.username, device.port ?? 22);
  const cachedPassword = devicePasswordCache.get(key);
  const persistedPassword = (device as Device & { password?: string }).password ?? '';
  return cachedPassword || persistedPassword || defaultSshPassword || device.username;
}

function purgeDeviceSoftwareState(device: Device) {
  const key = credentialCacheKey(device.host, device.username, device.port ?? 22);
  devicePasswordCache.delete(key);
  bgProvisionActive.delete(device.id);

  let removedDeployJobs = 0;
  for (const [jobId, job] of openClawDeployJobs.entries()) {
    if (job.deviceId === device.id) {
      openClawDeployJobs.delete(jobId);
      removedDeployJobs += 1;
    }
  }

  let removedFlashJobs = 0;
  for (const [jobId, job] of flashBackupJobs.entries()) {
    if (job.deviceId === device.id) {
      flashBackupJobs.delete(jobId);
      removedFlashJobs += 1;
    }
  }

  if (removedDeployJobs > 0 || removedFlashJobs > 0) {
    schedulePersistRuntimeJobs();
  }

  feishuAuth.clearLatestUiDeviceIfMatch(device.id);
  const tokenCleanup = removeTokenUsageByDevice(device.id);

  return {
    removedDeployJobs,
    removedFlashJobs,
    removedTokenUsageEntries: tokenCleanup.removed,
  };
}

function toOpenClawDevice(device: Device, password?: string) {
  return {
    ip: device.host,
    userName: device.username,
    id: device.id,
    password: password || resolveStoredDevicePassword(device),
  };
}

function passwordCandidates(username: string) {
  const candidates = [
    username,
    username === 'root' ? 'root' : '',
    username === 'sunrise' ? 'sunrise' : '',
    'root',
    'sunrise',
  ].filter(Boolean);
  return Array.from(new Set(candidates));
}

function isTransientSshError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return /timed out|timeout|handshake|econnreset|econnrefused|socket closed|connection reset|connect failed|broken pipe|network|epipe/.test(message);
}

function isSshTimeoutError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return /timed out|timeout|超时/.test(message);
}

function isSshAuthError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return /all configured authentication methods failed|permission denied|authentication failure|auth fail/.test(message);
}

type ApiErrorPayload = {
  code: string;
  message: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
};

function sendApiError(
  response: express.Response,
  status: number,
  code: string,
  message: string,
  options?: { retryable?: boolean; details?: Record<string, unknown> },
) {
  const payload: ApiErrorPayload = {
    code,
    message,
    ...(typeof options?.retryable === 'boolean' ? { retryable: options.retryable } : {}),
    ...(options?.details ? { details: options.details } : {}),
  };
  response.status(status).json(payload);
}

function normalizeOpenClawApi(raw: unknown): string {
  const value = String(raw || '').trim();
  if (!value) return 'openai-completions';
  if (value === 'openai-chat') return 'openai-completions';
  if (value === 'openai-responses' || value === 'openai-codex-responses') return 'openai-completions';
  if (value === 'google-genai' || value === 'google-generative-ai') return 'openai-completions';
  if (value === 'anthropic-messages') return 'anthropic-messages';
  if (SUPPORTED_OPENCLAW_APIS.has(value)) return value;
  return 'openai-completions';
}

function cleanupOpenClawDeployJobs(now = Date.now()) {
  let changed = false;
  for (const [jobId, job] of openClawDeployJobs.entries()) {
    const doneAt = job.finishedAt ?? job.startedAt;
    if (now - doneAt > OPENCLAW_DEPLOY_JOB_TTL_MS) {
      openClawDeployJobs.delete(jobId);
      changed = true;
    }
  }
  if (changed) schedulePersistRuntimeJobs();
}

function cleanupFlashBackupJobs(now = Date.now()) {
  let changed = false;
  for (const [jobId, job] of flashBackupJobs.entries()) {
    const doneAt = job.finishedAt ?? job.startedAt;
    if (now - doneAt > FLASH_BACKUP_JOB_TTL_MS) {
      flashBackupJobs.delete(jobId);
      changed = true;
    }
  }
  if (changed) schedulePersistRuntimeJobs();
}

function runtimeJobsStatePath() {
  const dataDir = process.env.RDK_DATA_DIR ?? path.resolve(process.cwd(), 'data');
  return path.join(dataDir, RUNTIME_JOBS_STATE_FILE);
}

function schedulePersistRuntimeJobs() {
  if (runtimeJobsPersistTimer) return;
  runtimeJobsPersistTimer = setTimeout(() => {
    runtimeJobsPersistTimer = null;
    void persistRuntimeJobsState();
  }, 200);
}

async function persistRuntimeJobsState() {
  cleanupOpenClawDeployJobs();
  cleanupFlashBackupJobs();
  const snapshot = {
    updatedAt: Date.now(),
    openClawDeployJobs: Array.from(openClawDeployJobs.values()),
    flashBackupJobs: Array.from(flashBackupJobs.values()),
  };
  try {
    const target = runtimeJobsStatePath();
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, JSON.stringify(snapshot, null, 2), 'utf-8');
  } catch (error) {
    console.warn('[jobs] persist state failed:', error instanceof Error ? error.message : error);
  }
}

async function restoreRuntimeJobsState() {
  try {
    const target = runtimeJobsStatePath();
    const raw = await fs.readFile(target, 'utf-8');
    const parsed = JSON.parse(raw) as {
      openClawDeployJobs?: OpenClawDeployJob[];
      flashBackupJobs?: FlashBackupJob[];
    };
    const now = Date.now();

    for (const item of parsed.openClawDeployJobs ?? []) {
      if (!item?.id || !item.deviceId) continue;
      const normalized: OpenClawDeployJob = {
        ...item,
        status: item.status === 'running' ? 'error' : item.status,
        error: item.status === 'running'
          ? '服务重启后任务中断，请重新发起部署'
          : item.error,
        finishedAt: item.status === 'running' ? now : item.finishedAt,
      };
      openClawDeployJobs.set(normalized.id, normalized);
    }

    for (const item of parsed.flashBackupJobs ?? []) {
      if (!item?.id || !item.deviceId) continue;
      const normalized: FlashBackupJob = {
        ...item,
        status: item.status === 'running' ? 'error' : item.status,
        error: item.status === 'running'
          ? '服务重启后任务中断，请重新发起备份'
          : item.error,
        finishedAt: item.status === 'running' ? now : item.finishedAt,
      };
      flashBackupJobs.set(normalized.id, normalized);
    }

    cleanupOpenClawDeployJobs(now);
    cleanupFlashBackupJobs(now);
    console.log(`[jobs] restored deploy=${openClawDeployJobs.size} backup=${flashBackupJobs.size}`);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') {
      console.warn('[jobs] restore state failed:', error instanceof Error ? error.message : error);
    }
  }
}

const deploySSEClients = new Map<string, Set<Response>>();

function deploySseBroadcast(jobId: string, payload: unknown) {
  const set = deploySSEClients.get(jobId);
  if (!set?.size) return;
  let line: string;
  try {
    line = `data: ${JSON.stringify(payload)}\n\n`;
  } catch {
    return;
  }
  for (const res of set) {
    if (res.writableEnded) continue;
    try {
      res.write(line);
    } catch {
      set.delete(res);
    }
  }
}

function broadcastDeployJobToSse(job: OpenClawDeployJob) {
  deploySseBroadcast(job.id, { type: 'job', job });
}

/** 任务结束：推送最终快照并关闭连接，释放服务端资源 */
function deploySseSendFinalAndClose(job: OpenClawDeployJob) {
  deploySseBroadcast(job.id, { type: 'job', job });
  const set = deploySSEClients.get(job.id);
  if (!set) return;
  for (const res of [...set]) {
    if (!res.writableEnded) {
      try {
        res.end();
      } catch {
        /* ignore */
      }
    }
  }
  deploySSEClients.delete(job.id);
}

function appendDeployOutput(job: OpenClawDeployJob, chunk: string) {
  job.output += chunk;
  if (job.output.length > 250_000) {
    job.output = job.output.slice(job.output.length - 250_000);
  }
  schedulePersistRuntimeJobs();
  deploySseBroadcast(job.id, { type: 'log', text: chunk });
}

function gcFeishuSeen() {
  const ttl = 10 * 60 * 1000;
  const nowTs = Date.now();
  for (const [k, v] of feishuEventSeen.entries()) {
    if (nowTs - v > ttl) feishuEventSeen.delete(k);
  }
}

function markFeishuSeen(eventId: string) {
  gcFeishuSeen();
  if (!eventId) return false;
  if (feishuEventSeen.has(eventId)) return true;
  feishuEventSeen.set(eventId, Date.now());
  return false;
}

function deriveFeishuEventKey(body: any): string {
  const eventId = String(body?.header?.event_id || body?.event_id || '');
  if (eventId) return eventId;
  const msgId = String(body?.event?.message?.message_id || '');
  if (msgId) return `msg:${msgId}`;
  return '';
}

function maskOpenId(openId: string) {
  if (!openId) return '';
  if (openId.length <= 8) return `${openId.slice(0, 2)}***${openId.slice(-2)}`;
  return `${openId.slice(0, 4)}***${openId.slice(-4)}`;
}

function maskSecret(raw: string) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (value.length <= 8) return `${value.slice(0, 2)}***${value.slice(-2)}`;
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

function auditKey(input: string) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const digest = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 8);
  return `${raw.slice(0, 6)}***#${digest}`;
}

function parseWorkspaceHealthPairs(output: string) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, line) => {
      const idx = line.indexOf('=');
      if (idx <= 0) return acc;
      acc[line.slice(0, idx)] = line.slice(idx + 1);
      return acc;
    }, {});
}

function readHealthBool(values: Record<string, string>, key: string) {
  return values[key] === '1';
}

function readHealthInt(values: Record<string, string>, key: string) {
  const value = Number.parseInt(values[key] || '0', 10);
  return Number.isFinite(value) ? value : 0;
}

function slugifyName(input: string) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'rdk-app';
}

function safeRelativeFilePath(input: string) {
  const normalized = String(input || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .trim();
  if (!normalized || normalized.includes('..')) return '';
  if (normalized.includes('\0')) return '';
  if (/^[a-zA-Z]:/.test(normalized)) return '';
  if (normalized.startsWith('.')) return '';
  return normalized;
}

function resolveGeneratedAppsRootDir() {
  return path.join(process.cwd(), 'workspace', 'generated-apps');
}

function isSubPath(child: string, parent: string) {
  const resolvedChild = path.resolve(child);
  const resolvedParent = path.resolve(parent);
  return resolvedChild === resolvedParent || resolvedChild.startsWith(`${resolvedParent}${path.sep}`);
}

function runProcess(command: string, args: string[], cwd: string, timeoutMs = 15_000) {
  return new Promise<{ ok: boolean; output: string; timedOut: boolean; exitCode: number | null }>((resolve) => {
    let settled = false;
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      resolve({ ok: false, output: `timeout after ${timeoutMs}ms`, timedOut: true, exitCode: null });
    }, timeoutMs);

    const OUTPUT_LIMIT = 512_000;
    child.stdout.on('data', (chunk) => { if (output.length < OUTPUT_LIMIT) output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { if (output.length < OUTPUT_LIMIT) output += chunk.toString(); });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, output: error.message, timedOut: false, exitCode: null });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, output: output.trim(), timedOut: false, exitCode: code });
    });
  });
}

async function validateOneShotApp(appDir: string): Promise<OneShotValidationResult> {
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
  const requiredFiles = ['README.md', 'main.py', 'requirements.txt'];

  for (const file of requiredFiles) {
    const target = path.join(appDir, file);
    try {
      await fs.access(target);
      checks.push({ name: `exists:${file}`, ok: true, detail: 'ok' });
    } catch {
      checks.push({ name: `exists:${file}`, ok: false, detail: 'missing' });
    }
  }

  const hasMain = checks.find((c) => c.name === 'exists:main.py')?.ok;
  if (hasMain) {
    const candidates: Array<{ cmd: string; args: string[] }> = [
      { cmd: 'python', args: ['-m', 'py_compile', 'main.py'] },
      { cmd: 'python3', args: ['-m', 'py_compile', 'main.py'] },
      { cmd: 'py', args: ['-3', '-m', 'py_compile', 'main.py'] },
    ];
    let syntaxChecked = false;
    for (const candidate of candidates) {
      const result = await runProcess(candidate.cmd, candidate.args, appDir, 20_000);
      if (result.ok) {
        checks.push({ name: 'python:syntax', ok: true, detail: `${candidate.cmd} ok` });
        syntaxChecked = true;
        break;
      }
      if (!/not found|enoent/i.test(result.output)) {
        checks.push({ name: 'python:syntax', ok: false, detail: result.output || `${candidate.cmd} failed` });
        syntaxChecked = true;
        break;
      }
    }
    if (!syntaxChecked) {
      checks.push({ name: 'python:syntax', ok: false, detail: 'python runtime not found' });
    }
  }

  const ok = checks.every((item) => item.ok);
  return { ok, checks };
}

async function collectOneShotFiles(appDir: string) {
  const files: Array<{ relativePath: string; content: Buffer }> = [];
  let totalBytes = 0;

  const walk = async (currentDir: string) => {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(currentDir, entry.name);
      const rel = path.relative(appDir, abs).replace(/\\/g, '/');
      if (!rel || rel.startsWith('..')) continue;
      if (entry.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (files.length >= ONE_SHOT_DEPLOY_MAX_FILES) {
        throw new Error(`文件数量超限（最多 ${ONE_SHOT_DEPLOY_MAX_FILES} 个）`);
      }
      const content = await fs.readFile(abs);
      totalBytes += content.length;
      if (totalBytes > ONE_SHOT_DEPLOY_MAX_BYTES) {
        throw new Error(`文件体积超限（最多 ${Math.floor(ONE_SHOT_DEPLOY_MAX_BYTES / 1024)}KB）`);
      }
      files.push({ relativePath: rel, content });
    }
  };

  await walk(appDir);
  return { files, totalBytes };
}

function normalizeOneShotRunCommand(raw: unknown): string {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (value.length > 200) return '';
  if (/[\r\n]/.test(value)) return '';
  // Keep one-shot runner constrained to Python entry commands.
  if (!/^(python|python3|py)\b/i.test(value)) return '';
  // Block shell control separators to reduce command-injection risk.
  if (/[`;&|<>]/.test(value)) return '';
  return value;
}

async function runOneShotAppSmoke(appDir: string, runCommandRaw?: string) {
  const requestedCommand = normalizeOneShotRunCommand(runCommandRaw);
  if (requestedCommand) {
    const shellRunner = process.platform === 'win32'
      ? { cmd: 'cmd', args: ['/d', '/s', '/c', requestedCommand] }
      : { cmd: 'bash', args: ['-lc', requestedCommand] };
    const customResult = await runProcess(shellRunner.cmd, shellRunner.args, appDir, 20_000);
    if (customResult.ok) {
      return { ok: true, runner: requestedCommand, output: customResult.output, timedOut: false };
    }
    if (customResult.timedOut) {
      return {
        ok: true,
        runner: requestedCommand,
        output: customResult.output || '运行超时，可能是常驻服务应用',
        timedOut: true,
      };
    }
    if (!/not found|enoent/i.test(customResult.output)) {
      return { ok: false, runner: requestedCommand, output: customResult.output, timedOut: false };
    }
  }

  const candidates: Array<{ cmd: string; args: string[] }> = [
    { cmd: 'python', args: ['main.py'] },
    { cmd: 'python3', args: ['main.py'] },
    { cmd: 'py', args: ['-3', 'main.py'] },
  ];
  let last = '';
  for (const candidate of candidates) {
    const result = await runProcess(candidate.cmd, candidate.args, appDir, 20_000);
    if (result.ok) {
      return {
        ok: true,
        runner: `${candidate.cmd} ${candidate.args.join(' ')}`,
        output: result.output,
        timedOut: false,
      };
    }
    if (result.timedOut) {
      return {
        ok: true,
        runner: `${candidate.cmd} ${candidate.args.join(' ')}`,
        output: result.output || '运行超时，可能是常驻服务应用',
        timedOut: true,
      };
    }
    if (!/not found|enoent/i.test(result.output)) {
      last = result.output;
      break;
    }
    last = result.output;
  }

  return {
    ok: false,
    runner: requestedCommand || 'python main.py',
    output: last || '未找到可用的 Python 运行时',
    timedOut: false,
  };
}

function suggestFixesFromRunOutput(output: string): OneShotFixSuggestion[] {
  const text = String(output || '').toLowerCase();
  const suggestions: OneShotFixSuggestion[] = [];
  if (text.includes('no module named')) {
    suggestions.push({
      title: '安装依赖',
      detail: '检测到依赖缺失，建议先安装 requirements.txt',
      command: 'pip install -r requirements.txt',
    });
  }
  if (text.includes('permission denied')) {
    suggestions.push({
      title: '修复权限',
      detail: '检测到权限不足，建议修复目标目录权限',
      command: 'chmod -R u+rwX .',
    });
  }
  if (text.includes('syntaxerror')) {
    suggestions.push({
      title: '语法检查',
      detail: '检测到语法错误，建议先做语法检查定位问题',
      command: 'python -m py_compile main.py',
    });
  }
  if (text.includes('python runtime not found') || text.includes('python: not found') || text.includes('python3: not found')) {
    suggestions.push({
      title: '安装 Python',
      detail: '设备缺少 Python 运行时，请先安装 python3',
      command: 'apt-get update && apt-get install -y python3',
    });
  }
  if (suggestions.length === 0) {
    suggestions.push({
      title: '排查入口',
      detail: '建议先查看完整运行日志，再检查 requirements.txt 与 main.py 入口是否匹配',
      command: 'python main.py',
    });
  }
  return suggestions.slice(0, 3);
}

function fallbackOneShotPlan(prompt: string): OneShotAppPlan {
  const appName = `rdk-${slugifyName(prompt.split(/\s+/).slice(0, 4).join('-') || 'app')}`;
  const summary = `由一句话需求生成的最小可运行 RDK 应用骨架：${prompt}`;
  return {
    appName,
    summary,
    runCommand: 'python main.py',
    testCommand: 'python -m py_compile main.py',
    files: [
      {
        path: 'README.md',
        content: `# ${appName}

${summary}

## 快速开始

\`\`\`bash
python main.py
\`\`\`

## 下一步建议

- 将设备指令封装到 \`app/rdk_client.py\`
- 把业务流程补充到 \`app/pipeline.py\`
- 根据场景添加依赖到 \`requirements.txt\`
`,
      },
      {
        path: 'requirements.txt',
        content: 'requests>=2.31.0\n',
      },
      {
        path: 'main.py',
        content: `from app.pipeline import run

def main():
    result = run()
    print(result)

if __name__ == "__main__":
    main()
`,
      },
      {
        path: 'app/pipeline.py',
        content: `def run():
    # TODO: 按需求补充设备调用与业务逻辑
    return "RDK app bootstrap is ready."
`,
      },
      {
        path: 'app/rdk_client.py',
        content: `class RdkClient:
    def __init__(self, host: str = "127.0.0.1", port: int = 22):
        self.host = host
        self.port = port

    def ping(self) -> bool:
        # TODO: 替换为真实设备连接检测
        return True
`,
      },
    ],
  };
}

function tryParseJsonObject(raw: string) {
  const text = String(raw || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function generateOneShotPlan(prompt: string): Promise<{ plan: OneShotAppPlan; usedFallback: boolean }> {
  const fallback = fallbackOneShotPlan(prompt);
  if (!apiKey) return { plan: fallback, usedFallback: true };

  const plannerPrompt = `你是 RDK 应用脚手架生成器。用户会给你一句话需求。

请只返回严格 JSON（不要 markdown，不要注释，不要代码块）：
{
  "appName": "仅小写字母数字和中划线",
  "summary": "一句话说明",
  "runCommand": "运行命令",
  "testCommand": "可选测试命令",
  "files": [
    { "path": "相对路径", "content": "文件内容字符串" }
  ]
}

要求：
1) files 至少包含：README.md, main.py, requirements.txt
2) 不得出现绝对路径，不得出现 .. 路径跳转
3) 输出应为可直接保存的源码内容
4) 以 Python 项目为默认栈，适配 RDK 设备应用开发`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    const upstreamResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: plannerPrompt },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 1800,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const payload = (await upstreamResponse.json().catch(() => ({}))) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = payload.choices?.[0]?.message?.content ?? '';
    const parsed = tryParseJsonObject(text);
    if (!parsed) return { plan: fallback, usedFallback: true };

    const appName = slugifyName(String(parsed.appName || fallback.appName));
    const summary = String(parsed.summary || fallback.summary);
    const runCommand = normalizeOneShotRunCommand(parsed.runCommand) || fallback.runCommand;
    const testCommand = String(parsed.testCommand || fallback.testCommand || '');
    const rawFiles = Array.isArray(parsed.files) ? parsed.files.slice(0, ONE_SHOT_MAX_FILES) : [];
    const files: OneShotGeneratedFile[] = rawFiles
      .map((item) => {
        const obj = (item ?? {}) as Record<string, unknown>;
        const p = safeRelativeFilePath(String(obj.path || ''));
        const c = String(obj.content || '').slice(0, ONE_SHOT_MAX_FILE_CHARS);
        return { path: p, content: c };
      })
      .filter((f) => Boolean(f.path));

    const totalChars = files.reduce((sum, f) => sum + f.content.length, 0);
    if (totalChars > ONE_SHOT_MAX_TOTAL_CHARS) {
      return { plan: fallback, usedFallback: true };
    }

    const hasReadme = files.some((f) => f.path === 'README.md');
    const hasMain = files.some((f) => f.path === 'main.py');
    const hasReq = files.some((f) => f.path === 'requirements.txt');
    if (!hasReadme || !hasMain || !hasReq || files.length < 3) {
      return { plan: fallback, usedFallback: true };
    }

    return {
      plan: {
        appName,
        summary,
        runCommand,
        ...(testCommand ? { testCommand } : {}),
        files,
      },
      usedFallback: false,
    };
  } catch {
    return { plan: fallback, usedFallback: true };
  }
}

function buildWorkspaceModuleStatus(
  ready: boolean,
  installed: boolean,
  summary: string,
  recommendedAction: string,
  missing: string[] = [],
  running?: boolean,
): WorkspaceModuleHealth {
  return {
    ready,
    installed,
    ...(typeof running === 'boolean' ? { running } : {}),
    summary,
    recommendedAction,
    ...(missing.length > 0 ? { missing } : {}),
  };
}

function buildWorkspaceHealth(output: string): DeviceWorkspaceHealth {
  const values = parseWorkspaceHealthPairs(output);
  const pythonReady = readHealthBool(values, 'python_ready');
  const gitReady = readHealthBool(values, 'git_ready');
  const nodeReady = readHealthBool(values, 'node_ready');
  const npmReady = readHealthBool(values, 'npm_ready');
  const codeInstalled = readHealthBool(values, 'code_installed');
  const codeRunning = readHealthBool(values, 'code_running');
  const vncInstalled = readHealthBool(values, 'vnc_installed');
  const vncRunning = readHealthBool(values, 'vnc_running');
  const ros2Ready = readHealthBool(values, 'ros2_ready');
  const rosbridgeInstalled = readHealthBool(values, 'rosbridge_installed');
  const rosbridgeRunning = readHealthBool(values, 'rosbridge_running');
  const trosCount = readHealthInt(values, 'tros_count');
  const modelZooDir = readHealthBool(values, 'modelzoo_dir');
  const hrtReady = readHealthBool(values, 'hrt_ready');
  const bpuReady = readHealthBool(values, 'bpu_ready');

  const developmentMissing = [
    pythonReady ? '' : 'Python3',
    gitReady ? '' : 'Git',
    nodeReady ? '' : 'Node.js',
    npmReady ? '' : 'npm',
  ].filter(Boolean);
  const developmentReady = developmentMissing.length === 0;
  const development = buildWorkspaceModuleStatus(
    developmentReady,
    developmentReady,
    developmentReady ? 'Python / Git / Node / npm 已就绪' : `缺少 ${developmentMissing.join(' / ')}`,
    developmentReady ? '可以直接开始一句话开发' : '让 RDKClaw 先补齐缺失开发环境',
    developmentMissing,
  );

  const codeServer = buildWorkspaceModuleStatus(
    codeInstalled && codeRunning,
    codeInstalled,
    !codeInstalled ? '未安装 code-server' : codeRunning ? 'code-server 已安装并正在监听 13337 端口' : 'code-server 已安装，但当前未启动',
    !codeInstalled ? '前往 IDE 页安装 code-server' : codeRunning ? '打开 IDE 继续开发' : '前往 IDE 页启动 code-server',
    !codeInstalled ? ['code-server'] : [],
    codeRunning,
  );

  const vnc = buildWorkspaceModuleStatus(
    vncInstalled && vncRunning,
    vncInstalled,
    !vncInstalled ? '未检测到 VNC 组件' : vncRunning ? 'VNC 服务已运行，可直接连接桌面' : 'VNC 组件已安装，但当前未运行',
    !vncInstalled ? '前往 VNC 页尝试安装 / 启动服务' : vncRunning ? '打开远程桌面' : '前往 VNC 页启动桌面服务',
    !vncInstalled ? ['x11vnc / vncserver'] : [],
    vncRunning,
  );

  const ros = buildWorkspaceModuleStatus(
    ros2Ready,
    ros2Ready,
    !ros2Ready
      ? 'ROS2/TROS 未安装'
      : rosbridgeRunning
        ? 'TROS 与 rosbridge 均就绪'
        : rosbridgeInstalled
          ? 'TROS 已就绪，rosbridge 未运行'
          : trosCount > 0
            ? `TROS 已就绪（${trosCount} 个组件）`
            : 'ROS2 已就绪',
    !ros2Ready
      ? '安装 TROS: sudo apt install tros-humble-ros-base'
      : !rosbridgeRunning
        ? '前往 ROS 页可启动 rosbridge 进行可视化'
        : '打开 ROS 可视化',
    ros2Ready ? [] : ['ROS2/TROS'],
    rosbridgeRunning,
  );

  const nodeHubMissing = [
    ros2Ready ? '' : 'ROS2',
    trosCount > 0 ? '' : 'tros / hobot 生态包',
  ].filter(Boolean);
  const nodeHub = buildWorkspaceModuleStatus(
    ros2Ready && trosCount > 0,
    trosCount > 0,
    ros2Ready && trosCount > 0 ? `已检测到 ${trosCount} 个 tros / hobot 组件` : `缺少 ${nodeHubMissing.join(' / ')}`,
    ros2Ready && trosCount > 0 ? '打开 NodeHub 同步板端能力' : '先补齐 RDK 官方生态包，再同步 NodeHub',
    nodeHubMissing,
  );

  const modelZooMissing = [
    modelZooDir ? '' : 'ModelZoo 仓库目录',
    hrtReady ? '' : 'hrt_model_exec',
    bpuReady ? '' : 'BPU Python 运行时',
  ].filter(Boolean);
  const modelZoo = buildWorkspaceModuleStatus(
    modelZooDir && hrtReady && bpuReady,
    modelZooDir,
    modelZooDir && hrtReady && bpuReady ? 'ModelZoo 仓库与 BPU 运行时已就绪' : `缺少 ${modelZooMissing.join(' / ')}`,
    modelZooDir && hrtReady && bpuReady ? '打开 ModelZoo 管理模型' : '先补齐 ModelZoo 仓库与 BPU 运行环境',
    modelZooMissing,
  );

  const modules = {
    development,
    codeServer,
    vnc,
    ros,
    nodeHub,
    modelZoo,
  };
  const checkedAtSeconds = readHealthInt(values, 'checked_at');
  return {
    checkedAt: checkedAtSeconds > 0 ? checkedAtSeconds * 1000 : Date.now(),
    readyModules: Object.values(modules).filter((item) => item.ready).length,
    totalModules: Object.keys(modules).length,
    modules,
  };
}

function applyFeishuConfig(next: ReturnType<FeishuConfigStore['getConfig']>) {
  feishuConfig = next;
  feishuApi = new FeishuApiClient(feishuConfig.appId, feishuConfig.appSecret);
}

async function syncFeishuRuntime() {
  const cfg = feishuConfigStore.getConfig();
  applyFeishuConfig(cfg);
  if (!cfg.enabled || cfg.connectionMode !== 'websocket') {
    await feishuChannel.stop();
    return;
  }
  await feishuChannel.restart();
}

function decodeFeishuEncrypt(encrypt: string, encryptKey: string) {
  const key = crypto.createHash('sha256').update(encryptKey, 'utf8').digest();
  const iv = key.subarray(0, 16);
  const encrypted = Buffer.from(encrypt, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  return JSON.parse(plain) as Record<string, unknown>;
}

async function runOnDevice(
  request: express.Request,
  response: express.Response,
  id: string,
  commands: string[],
  options?: { timeoutMs?: number },
) {
  const device = await resolveDevice(request, response, id);
  if (!device) {
    return null;
  }

  const { password, key } = resolvePassword(request, device);
  const candidates = password ? [password] : passwordCandidates(device.username);
  const timeoutMs = Math.max(5_000, Number(options?.timeoutMs ?? 120_000));
  let lastError: unknown = null;
  const output = await runInDeviceLane(device.id, async () => {
    for (const pwd of candidates) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const result = await runRemoteCommands(
            {
              host: device.host,
              port: device.port ?? 22,
              username: device.username,
              password: pwd,
            },
            commands,
            { timeoutMs },
          );
          devicePasswordCache.set(key, pwd);
          return result;
        } catch (error) {
          lastError = error;
          if (!(attempt === 0 && isTransientSshError(error))) {
            break;
          }
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error('板端命令执行失败');
  }).catch((error) => {
    lastError = error;
    return null;
  });
  if (output !== null) {
    return { device, output };
  }

  if (!password) {
    sendApiError(
      response,
      400,
      'DEVICE_AUTH_REQUIRED',
      '设备密码缺失或不正确，请在设备管理中重新连接并填写密码',
      { retryable: false },
    );
    return null;
  }

  if (isSshTimeoutError(lastError)) {
    sendApiError(
      response,
      504,
      'DEVICE_COMMAND_TIMEOUT',
      lastError instanceof Error ? `板端命令执行超时: ${lastError.message}` : '板端命令执行超时',
      { retryable: true },
    );
    return null;
  }

  sendApiError(
    response,
    500,
    'DEVICE_COMMAND_FAILED',
    lastError instanceof Error ? `板端命令执行失败: ${lastError.message}` : '板端命令执行失败',
    { retryable: false },
  );
  return null;
}

app.use(
  cors({
    credentials: true,
    origin: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Password', 'X-RDK-Sso-Session', 'X-Requested-With'],
  }),
);
app.use(express.json({ limit: '50mb' }));

// SSO auth — register routes first (before middleware blocks unauthenticated requests)
registerSSORoutes(app);
registerAnalyticsRoutes(app);

/** Studio 桌面端：用户在内嵌浏览器提交页面正文，完成 Agent 工具 studio_embedded_browser_capture */
app.post('/api/studio/browser-capture/submit', (req, res) => {
  const captureId = String(req.body?.captureId ?? '').trim();
  const text = String(req.body?.text ?? '');
  const r = submitStudioBrowserCapture(captureId, text);
  if (r.ok) {
    res.json({ ok: true });
    return;
  }
  res.status(400).json({ ok: false, error: r.error });
});

app.post('/api/studio/browser-capture/cancel', (req, res) => {
  const captureId = String(req.body?.captureId ?? '').trim();
  const r = cancelStudioBrowserCapture(captureId, '用户取消');
  if (r.ok) {
    res.json({ ok: true });
    return;
  }
  res.status(400).json({ ok: false, error: r.error });
});

/** 微信扫码：短时图片预览（免检，凭不可猜测 id + TTL；避免 SSE 内嵌超长 data URL 导致裂图） */
app.get('/api/rdkclaw/weixin/qr-preview', (req, res) => {
  const id = String(req.query.id || '').trim();
  const hit = getWeixinQrPreview(id);
  if (!hit) {
    res.status(404).json({ ok: false, error: 'not_found' });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', hit.mime);
  res.end(hit.buf);
});

if (isSSOEnabled() || isSSORequired()) {
  app.use(ssoAuthMiddleware);
  if (isSSOEnabled()) {
    console.log('[SSO] D-Robotics OAuth client configured (authorize + callback)');
  } else {
    console.warn(
      '[SSO] OAuth client not set: browser code flow unavailable; Electron redirectUrl + /api/sso/bootstrap still works',
    );
  }
} else {
  console.log('[SSO] SSO not configured (set SSO_CLIENT_ID & SSO_CLIENT_SECRET to enable)');
}

app.use('/vnc', express.static(process.cwd() + '/public/vnc'));

app.get('/quick-connect', (_req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'quick-connect.html'));
});

// Serve agent-downloaded files — search multiple directories for the requested file
const localFilesDirs = [
  path.join(process.cwd(), 'workspace', 'downloads'),
  path.join(process.cwd(), 'downloads'),
];
app.get('/api/local-files/:filename', (req, res) => {
  const filename = path.basename(decodeURIComponent(req.params.filename));
  for (const dir of localFilesDirs) {
    const filePath = path.join(dir, filename);
    if (existsSync(filePath)) {
      const ext = path.extname(filename).toLowerCase();
      const mediaExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.mp4', '.webm', '.mov', '.avi', '.mkv']);
      const docExts = new Set(['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.pdf', '.csv', '.zip', '.rar', '.7z']);
      if (mediaExts.has(ext)) {
        res.setHeader('Cache-Control', 'public, max-age=3600');
      }
      if (docExts.has(ext)) {
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      }
      return res.sendFile(filePath);
    }
  }
  res.status(404).json({ error: 'File not found' });
});

// ─── Ecosystem Bridge ───

async function sshRunOnDevice(deviceId: string, commands: string[]): Promise<{ output: string } | null> {
  const devices = await readDevices();
  const device = devices.find((d) => d.id === deviceId);
  if (!device) return null;
  const key = credentialCacheKey(device.host, device.username, device.port ?? 22);
  const pwd = devicePasswordCache.get(key)
    || (device as Device & { password?: string }).password
    || defaultSshPassword
    || device.username;
  const candidates = [pwd, ...passwordCandidates(device.username)];
  const output = await runInDeviceLane(device.id, async () => {
    for (const p of [...new Set(candidates)]) {
      try {
        const result = await runRemoteCommands(
          { host: device.host, port: device.port ?? 22, username: device.username, password: p },
          commands,
        );
        devicePasswordCache.set(key, p);
        return result;
      } catch {
        // try next candidate
      }
    }
    return null;
  });
  if (output !== null) {
    return { output };
  }
  return null;
}

// ─── Background Auto-Provision ───
// Silently installs missing optional components (rosbridge, vnc, code-server)
// after a health check detects they are absent. Uses nohup so SSH returns
// immediately; actual install continues on the device in the background.

const bgProvisionActive = new Map<string, Set<string>>();

function triggerBackgroundProvision(deviceId: string, values: Record<string, string>) {
  if (!bgProvisionActive.has(deviceId)) bgProvisionActive.set(deviceId, new Set());
  const active = bgProvisionActive.get(deviceId)!;

  const ros2Ready = readHealthBool(values, 'ros2_ready');
  const rosbridgeInstalled = readHealthBool(values, 'rosbridge_installed');
  const vncInstalled = readHealthBool(values, 'vnc_installed');
  const codeInstalled = readHealthBool(values, 'code_installed');
  const distro = (values.ros_distro ?? 'humble').trim() || 'humble';

  const tasks: Array<{ key: string; cmd: string }> = [];

  if (ros2Ready && !rosbridgeInstalled && !active.has('rosbridge')) {
    tasks.push({
      key: 'rosbridge',
      cmd: `bash -lc 'test -f /tmp/.rdkstudio-bg-rosbridge && exit 0; touch /tmp/.rdkstudio-bg-rosbridge; nohup bash -c "source /opt/tros/humble/setup.bash 2>/dev/null; apt-get update -qq 2>/dev/null; apt-get install -y -qq ros-${distro}-rosbridge-server 2>&1 || apt-get install -y -qq tros-rosbridge-server 2>&1; rm -f /tmp/.rdkstudio-bg-rosbridge" > /tmp/.rdkstudio-bg-rosbridge.log 2>&1 &'`,
    });
  }

  if (!vncInstalled && !active.has('vnc')) {
    tasks.push({
      key: 'vnc',
      cmd: 'bash -lc \'test -f /tmp/.rdkstudio-bg-vnc && exit 0; touch /tmp/.rdkstudio-bg-vnc; nohup bash -c "apt-get update -qq 2>/dev/null; apt-get install -y -qq x11vnc 2>&1 || apt-get install -y -qq tigervnc-standalone-server 2>&1; rm -f /tmp/.rdkstudio-bg-vnc" > /tmp/.rdkstudio-bg-vnc.log 2>&1 &\'',
    });
  }

  if (!codeInstalled && !active.has('code-server')) {
    tasks.push({
      key: 'code-server',
      cmd: 'bash -lc \'test -f /tmp/.rdkstudio-bg-codeserver && exit 0; touch /tmp/.rdkstudio-bg-codeserver; nohup bash -c "curl -fsSL https://code-server.dev/install.sh | sh 2>&1; rm -f /tmp/.rdkstudio-bg-codeserver" > /tmp/.rdkstudio-bg-codeserver.log 2>&1 &\'',
    });
  }

  for (const task of tasks) {
    active.add(task.key);
    sshRunOnDevice(deviceId, [task.cmd])
      .then((r) => console.log(`[bg-provision] ${deviceId}/${task.key}: ${r ? 'triggered' : 'device unreachable'}`))
      .catch((e: unknown) => console.log(`[bg-provision] ${deviceId}/${task.key}: error`, e instanceof Error ? e.message : e))
      .finally(() => active.delete(task.key));
  }
}

// ─── Skill System ───
const loadedSkills = loadAllSkills();

app.get('/api/skills', (_request, response) => {
  response.setHeader('x-rdk-internal-api', 'true');
  response.json({
    ok: true,
    internalOnly: true,
    message: '兼容接口：仅供内部调试或历史功能使用，不作为技能工坊数据源。',
    skills: loadedSkills.map(s => ({
      name: s.name,
      description: s.description,
      version: s.version,
      metadata: s.metadata,
      apis: s.apis,
      clientActions: s.clientActions,
    })),
    total: loadedSkills.length,
  });
});

app.get('/api/skills/:name', (request, response) => {
  response.setHeader('x-rdk-internal-api', 'true');
  const skill = getSkillByName(loadedSkills, request.params.name);
  if (!skill) {
    response.status(404).json({ error: `Skill '${request.params.name}' not found` });
    return;
  }
  response.json({ ok: true, skill });
});

app.get('/api/skills/:name/md', (request, response) => {
  response.setHeader('x-rdk-internal-api', 'true');
  const md = getRawSkillMd(request.params.name);
  if (!md) {
    response.status(404).json({ error: `SKILL.md for '${request.params.name}' not found` });
    return;
  }
  response.type('text/markdown').send(md);
});

app.post('/api/skills/reload', (_request, response) => {
  response.setHeader('x-rdk-internal-api', 'true');
  const reloaded = loadAllSkills();
  loadedSkills.length = 0;
  loadedSkills.push(...reloaded);
  response.json({
    ok: true,
    internalOnly: true,
    message: '仅重载本地技能文档，不包含生态技能桥接。',
    total: loadedSkills.length,
  });
});

app.get('/api/health', (_request, response) => {
  response.json({ ok: true });
});

app.get('/api/devices/scheduler/stats', (_request, response) => {
  response.json({
    ok: true,
    ...getDeviceLaneStats(),
  });
});

app.post('/api/apps/one-shot-generate', async (request, response) => {
  const { prompt } = request.body as { prompt?: string };
  const input = String(prompt || '').trim();
  if (!input) {
    sendApiError(response, 400, 'INVALID_PROMPT', 'prompt 不能为空', { retryable: false });
    return;
  }
  if (input.length > ONE_SHOT_PROMPT_MAX_CHARS) {
    sendApiError(
      response,
      400,
      'INVALID_PROMPT',
      `prompt 过长，请控制在 ${ONE_SHOT_PROMPT_MAX_CHARS} 字以内`,
      { retryable: false },
    );
    return;
  }

  const generatedRoot = resolveGeneratedAppsRootDir();
  const { plan, usedFallback } = await generateOneShotPlan(input);
  const appSlug = slugifyName(plan.appName);
  const folderName = `${appSlug}-${Date.now()}`;
  const appDir = path.join(generatedRoot, folderName);

  try {
    await fs.mkdir(appDir, { recursive: true });
    const writtenFiles: string[] = [];
    for (const file of plan.files) {
      const relativePath = safeRelativeFilePath(file.path);
      if (!relativePath) continue;
      const absPath = path.join(appDir, relativePath);
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, file.content ?? '', 'utf-8');
      writtenFiles.push(relativePath);
    }
    if (writtenFiles.length === 0) {
      sendApiError(response, 500, 'APP_GENERATE_EMPTY', '未生成有效应用文件', { retryable: true });
      return;
    }

    response.json({
      ok: true,
      app: {
        name: appSlug,
        summary: plan.summary,
        rootDir: appDir,
        files: writtenFiles,
        runCommand: plan.runCommand,
        testCommand: plan.testCommand ?? '',
        usedFallback,
      },
    });
  } catch (error) {
    sendApiError(
      response,
      500,
      'APP_GENERATE_WRITE_FAILED',
      error instanceof Error ? `应用文件写入失败: ${error.message}` : '应用文件写入失败',
      { retryable: true },
    );
  }
});

app.get('/api/token-usage/report', (request, response) => {
  const hours = Number(request.query.hours || 24);
  const source = String(request.query.source || 'all') as 'all' | 'rdkclaw' | 'openclaw';
  const deviceId = String(request.query.deviceId || '').trim();
  const limit = Number(request.query.limit || 50);
  const report = getTokenUsageReport({ hours, source, deviceId, limit });
  response.json(report);
});

app.post('/api/apps/one-shot-validate', async (request, response) => {
  const { appDir } = request.body as { appDir?: string };
  const targetDir = String(appDir || '').trim();
  if (!targetDir) {
    sendApiError(response, 400, 'INVALID_APP_DIR', 'appDir 不能为空', { retryable: false });
    return;
  }

  const generatedRoot = resolveGeneratedAppsRootDir();
  if (!isSubPath(targetDir, generatedRoot)) {
    sendApiError(response, 400, 'INVALID_APP_DIR', 'appDir 非法，不在生成目录范围内', { retryable: false });
    return;
  }

  try {
    const stat = await fs.stat(targetDir);
    if (!stat.isDirectory()) {
      sendApiError(response, 400, 'INVALID_APP_DIR', 'appDir 不是有效目录', { retryable: false });
      return;
    }
    const validation = await validateOneShotApp(targetDir);
    response.json({ ok: true, validation });
  } catch (error) {
    sendApiError(
      response,
      500,
      'APP_VALIDATE_FAILED',
      error instanceof Error ? `应用校验失败: ${error.message}` : '应用校验失败',
      { retryable: true },
    );
  }
});

app.post('/api/apps/one-shot-run', async (request, response) => {
  const { appDir, runCommand } = request.body as { appDir?: string; runCommand?: string };
  const targetDir = String(appDir || '').trim();
  const normalizedRunCommand = normalizeOneShotRunCommand(runCommand);
  if (!targetDir) {
    sendApiError(response, 400, 'INVALID_APP_DIR', 'appDir 不能为空', { retryable: false });
    return;
  }
  if (String(runCommand || '').trim() && !normalizedRunCommand) {
    sendApiError(response, 400, 'INVALID_RUN_COMMAND', 'runCommand 非法，仅支持 Python 启动命令', { retryable: false });
    return;
  }

  const generatedRoot = resolveGeneratedAppsRootDir();
  if (!isSubPath(targetDir, generatedRoot)) {
    sendApiError(response, 400, 'INVALID_APP_DIR', 'appDir 非法，不在生成目录范围内', { retryable: false });
    return;
  }

  try {
    const stat = await fs.stat(targetDir);
    if (!stat.isDirectory()) {
      sendApiError(response, 400, 'INVALID_APP_DIR', 'appDir 不是有效目录', { retryable: false });
      return;
    }
    const runResult = await runOneShotAppSmoke(targetDir, normalizedRunCommand);
    response.json({
      ok: runResult.ok,
      run: {
        runner: runResult.runner,
        output: runResult.output,
        timedOut: runResult.timedOut,
      },
    });
  } catch (error) {
    sendApiError(
      response,
      500,
      'APP_RUN_FAILED',
      error instanceof Error ? `应用运行失败: ${error.message}` : '应用运行失败',
      { retryable: true },
    );
  }
});

app.post('/api/apps/one-shot-deploy', async (request, response) => {
  const {
    appDir,
    deviceId,
    remoteDir,
    runAfterDeploy,
    runCommand,
  } = request.body as {
    appDir?: string;
    deviceId?: string;
    remoteDir?: string;
    runAfterDeploy?: boolean;
    runCommand?: string;
  };

  const targetDir = String(appDir || '').trim();
  const targetDeviceId = String(deviceId || '').trim();
  const normalizedRunCommand = normalizeOneShotRunCommand(runCommand);
  if (!targetDir || !targetDeviceId) {
    sendApiError(response, 400, 'INVALID_DEPLOY_PAYLOAD', 'appDir 与 deviceId 为必填项', { retryable: false });
    return;
  }
  if (String(runCommand || '').trim() && !normalizedRunCommand) {
    sendApiError(response, 400, 'INVALID_RUN_COMMAND', 'runCommand 非法，仅支持 Python 启动命令', { retryable: false });
    return;
  }

  const generatedRoot = resolveGeneratedAppsRootDir();
  if (!isSubPath(targetDir, generatedRoot)) {
    sendApiError(response, 400, 'INVALID_APP_DIR', 'appDir 非法，不在生成目录范围内', { retryable: false });
    return;
  }

  const normalizedRemoteDir = String(remoteDir || '').trim();
  const defaultRemoteDir = `/userdata/apps/${slugifyName(path.basename(targetDir))}`;
  const finalRemoteDir = normalizedRemoteDir || defaultRemoteDir;
  if (!finalRemoteDir.startsWith('/') || finalRemoteDir.includes('..')) {
    sendApiError(response, 400, 'INVALID_REMOTE_DIR', 'remoteDir 非法，仅支持绝对路径且不得包含 ..', { retryable: false });
    return;
  }

  const device = await resolveDevice(request, response, targetDeviceId);
  if (!device) return;

  try {
    const stat = await fs.stat(targetDir);
    if (!stat.isDirectory()) {
      sendApiError(response, 400, 'INVALID_APP_DIR', 'appDir 不是有效目录', { retryable: false });
      return;
    }
  } catch {
    sendApiError(response, 400, 'INVALID_APP_DIR', 'appDir 不存在', { retryable: false });
    return;
  }

  let fileBundle: { files: Array<{ relativePath: string; content: Buffer }>; totalBytes: number };
  try {
    fileBundle = await collectOneShotFiles(targetDir);
  } catch (error) {
    sendApiError(
      response,
      400,
      'INVALID_APP_FILES',
      error instanceof Error ? error.message : '应用文件不符合部署要求',
      { retryable: false },
    );
    return;
  }

  if (fileBundle.files.length === 0) {
    sendApiError(response, 400, 'INVALID_APP_FILES', '应用目录为空，无法部署', { retryable: false });
    return;
  }
  const hasRequirements = fileBundle.files.some(
    (file) => file.relativePath.replace(/\\/g, '/').toLowerCase() === 'requirements.txt',
  );

  const key = credentialCacheKey(device.host, device.username, device.port ?? 22);
  const cached = devicePasswordCache.get(key);
  const persistedPassword = (device as Device & { password?: string }).password ?? '';
  const seedPassword = cached || persistedPassword || defaultSshPassword || device.username;
  const candidates = Array.from(new Set([seedPassword, ...passwordCandidates(device.username)].filter(Boolean)));
  let lastError: unknown = null;

  for (const pwd of candidates) {
    try {
      const precheckRaw = await runInDeviceLane(device.id, () => runRemoteCommands(
        { host: device.host, port: device.port ?? 22, username: device.username, password: pwd },
        ['bash -lc "PY=$(command -v python || command -v python3 || command -v py || true); PIP=$(command -v pip || command -v pip3 || true); AVAIL=$(df -Pk /userdata 2>/dev/null | tail -1 | awk \'{print $4}\' || echo 0); NET=unknown; if command -v curl >/dev/null 2>&1; then curl -Is --max-time 5 https://pypi.org/simple/ >/dev/null 2>&1 && NET=ok || NET=fail; elif command -v wget >/dev/null 2>&1; then wget -q --spider -T 5 https://pypi.org/simple/ >/dev/null 2>&1 && NET=ok || NET=fail; elif [ -n \"$PY\" ]; then $PY -c \"import urllib.request; urllib.request.urlopen(\'https://pypi.org/simple/\', timeout=5)\" >/dev/null 2>&1 && NET=ok || NET=fail; fi; echo PY=$PY; echo PIP=$PIP; echo AVAIL_KB=$AVAIL; echo NET=$NET"'],
        { timeoutMs: 20_000 },
      ));
      const pyLine = precheckRaw.split(/\r?\n/).find((line) => line.startsWith('PY=')) || 'PY=';
      const pipLine = precheckRaw.split(/\r?\n/).find((line) => line.startsWith('PIP=')) || 'PIP=';
      const availLine = precheckRaw.split(/\r?\n/).find((line) => line.startsWith('AVAIL_KB=')) || 'AVAIL_KB=0';
      const netLine = precheckRaw.split(/\r?\n/).find((line) => line.startsWith('NET=')) || 'NET=unknown';
      const pyCmd = pyLine.slice(3).trim();
      const pipCmd = pipLine.slice(4).trim();
      const availKb = Number.parseInt(availLine.slice('AVAIL_KB='.length).trim(), 10) || 0;
      const netState = netLine.slice(4).trim().toLowerCase();
      if (!pyCmd) {
        sendApiError(response, 400, 'DEPLOY_PRECHECK_FAILED', '目标设备缺少 Python 运行时，无法直接运行应用', {
          retryable: false,
          details: {
            suggestions: ['请先在设备安装 python3', '安装完成后重新执行部署'],
          },
        });
        return;
      }
      if (availKb > 0 && availKb < 20 * 1024) {
        sendApiError(response, 400, 'DEPLOY_PRECHECK_FAILED', '设备可用空间不足，建议先清理 /userdata 空间', {
          retryable: false,
          details: {
            availableKB: availKb,
            suggestions: ['清理旧日志/旧应用目录', '保证至少 20MB 可用空间后重试'],
          },
        });
        return;
      }
      if (hasRequirements && !pipCmd) {
        sendApiError(response, 400, 'DEPLOY_PRECHECK_FAILED', '应用包含 requirements.txt，但目标设备缺少 pip，无法安装依赖', {
          retryable: false,
          details: {
            suggestions: ['请先在设备安装 pip/pip3', '安装完成后重新执行部署'],
          },
        });
        return;
      }
      if (hasRequirements && netState === 'fail') {
        sendApiError(response, 400, 'DEPLOY_PRECHECK_FAILED', '设备当前无法访问依赖源（pypi.org），依赖安装可能失败', {
          retryable: true,
          details: {
            suggestions: ['确认设备网络可访问外网', '或改用内网镜像源后重试'],
          },
        });
        return;
      }

      const uniqueDirs = Array.from(new Set([
        finalRemoteDir,
        ...fileBundle.files.map((f) => path.posix.dirname(path.posix.join(finalRemoteDir, f.relativePath)).replace(/\\/g, '/')),
      ]));
      const mkdirCmd = uniqueDirs.map((dir) => `mkdir -p ${shEscape(dir)}`).join(' && ');
      await runInDeviceLane(device.id, () => runRemoteCommands(
        { host: device.host, port: device.port ?? 22, username: device.username, password: pwd },
        [mkdirCmd],
        { timeoutMs: 60_000 },
      ));

      for (const file of fileBundle.files) {
        const remotePath = path.posix.join(finalRemoteDir, file.relativePath).replace(/\\/g, '/');
        await runInDeviceLane(device.id, () => uploadFileSftp(
          { host: device.host, port: device.port ?? 22, username: device.username, password: pwd },
          remotePath,
          file.content,
        ));
      }

      devicePasswordCache.set(key, pwd);
      let run: { ok: boolean; output: string } | null = null;
      if (runAfterDeploy !== false) {
        const runEntryCommand = normalizedRunCommand || 'python main.py';
        const runScript = `cd ${shEscape(finalRemoteDir)} && (${runEntryCommand})`;
        const runResult = await runInDeviceLane(device.id, () => runRemoteCommands(
          { host: device.host, port: device.port ?? 22, username: device.username, password: pwd },
          [`bash -lc ${shellEscape(runScript)}`],
          { timeoutMs: 60_000 },
        )).then((output) => ({ ok: true, output })).catch((error) => ({ ok: false, output: error instanceof Error ? error.message : String(error) }));
        run = runResult;
      }

      response.json({
        ok: true,
        deploy: {
          deviceId: targetDeviceId,
          remoteDir: finalRemoteDir,
          fileCount: fileBundle.files.length,
          totalBytes: fileBundle.totalBytes,
          runCommand: normalizedRunCommand || 'python main.py',
          ...(run ? {
            run: {
              ...run,
              ...(run.ok ? {} : { suggestions: suggestFixesFromRunOutput(run.output) }),
            },
          } : {}),
        },
      });
      return;
    } catch (error) {
      lastError = error;
      continue;
    }
  }

  if (isSshAuthError(lastError)) {
    sendApiError(response, 401, 'SSH_AUTH_FAILED', '部署认证失败，请检查设备账号密码', { retryable: false });
    return;
  }
  if (isSshTimeoutError(lastError)) {
    sendApiError(response, 504, 'DEPLOY_TIMEOUT', '部署超时，请检查网络和设备状态', { retryable: true });
    return;
  }
  sendApiError(
    response,
    500,
    'DEPLOY_FAILED',
    lastError instanceof Error ? `部署失败: ${lastError.message}` : '部署失败',
    { retryable: true },
  );
});

app.post('/api/token-usage/reset', (_request, response) => {
  response.json(resetTokenUsage());
});

app.get('/api/devices', async (_request, response) => {
  const devices = await readDevices();
  response.json({ devices: devices.map((item) => sanitizeDevice(item as Device & { password?: string })) });
});

app.post('/api/devices/connect', async (request, response) => {
  const { host, port, username, password } = request.body as {
    host?: string;
    port?: number;
    username?: string;
    password?: string;
  };

  if (!host || !username || !password) {
    sendApiError(response, 400, 'INVALID_DEVICE_CREDENTIALS', 'host、username、password 均为必填项', { retryable: false });
    return;
  }

  try {
    const normalizedPort = Number(port ?? 22);
    await verifySshConnection({ host, port: normalizedPort, username, password });

    const devices = await readDevices();
    const now = new Date().toISOString();
    const nextDevice: Device & { password?: string } = {
      id: devices.find((device) => device.host === host && (device.port ?? 22) === normalizedPort && device.username === username)?.id ?? uuid(),
      host,
      port: normalizedPort,
      username,
      password,
      status: 'connected',
      lastCheckedAt: now,
    };

    const nextDevices = [
      nextDevice,
      ...devices.filter((device) => !(device.host === host && (device.port ?? 22) === normalizedPort && device.username === username)),
    ];

    setDevicePasswordCache(host, username, normalizedPort, password);

    await writeDevices(nextDevices);
    response.json({ device: sanitizeDevice(nextDevice) });
  } catch (error) {
    if (isSshTimeoutError(error)) {
      sendApiError(response, 504, 'SSH_CONNECT_TIMEOUT', error instanceof Error ? `SSH 连接超时: ${error.message}` : 'SSH 连接超时', { retryable: true });
      return;
    }
    if (isSshAuthError(error)) {
      sendApiError(response, 401, 'SSH_AUTH_FAILED', 'SSH 认证失败，请检查用户名或密码', { retryable: false });
      return;
    }
    sendApiError(response, 500, 'SSH_CONNECT_FAILED', error instanceof Error ? `SSH 连接失败: ${error.message}` : 'SSH 连接失败', { retryable: true });
  }
});

app.post('/api/devices/verify', async (request, response) => {
  const { host, port, username, password } = request.body as {
    host?: string;
    port?: number;
    username?: string;
    password?: string;
  };

  if (!host || !username || !password) {
    sendApiError(response, 400, 'INVALID_DEVICE_CREDENTIALS', 'host、username、password 均为必填项', { retryable: false });
    return;
  }

  try {
    await verifySshConnection({ host, port: Number(port ?? 22), username, password });
    response.json({ ok: true });
  } catch (error) {
    if (isSshTimeoutError(error)) {
      sendApiError(response, 504, 'SSH_CONNECT_TIMEOUT', error instanceof Error ? `SSH 连接超时: ${error.message}` : 'SSH 连接超时', { retryable: true });
      return;
    }
    if (isSshAuthError(error)) {
      sendApiError(response, 401, 'SSH_AUTH_FAILED', 'SSH 认证失败，请检查用户名或密码', { retryable: false });
      return;
    }
    sendApiError(response, 500, 'SSH_CONNECT_FAILED', error instanceof Error ? `SSH 连接失败: ${error.message}` : 'SSH 连接失败', { retryable: true });
  }
});

const devicePingCache = new Map<string, { status: string; expiresAt: number }>();
const PING_CACHE_TTL_MS = 3000;

app.get('/api/devices/:id/ping', async (request, response) => {
  const { id } = request.params;
  const device = await resolveDevice(request, response, id);
  if (!device) return;

  const cached = devicePingCache.get(id);
  if (cached && cached.expiresAt > Date.now()) {
    response.json({ ok: cached.status === 'connected', status: cached.status });
    return;
  }

  const port = device.port ?? 22;
  /* 与 SSH/诊断握手相比，过短的 TCP 超时易误判「离线」，导致顶栏红点与工作台指标不一致 */
  const tcpProbeMs = 5000;
  try {
    await new Promise<void>((resolve, reject) => {
      const socket = net.connect({ host: device.host, port, timeout: tcpProbeMs }, () => {
        socket.destroy();
        resolve();
      });
      socket.on('error', reject);
      socket.on('timeout', () => { socket.destroy(); reject(new Error('timeout')); });
    });
    devicePingCache.set(id, { status: 'connected', expiresAt: Date.now() + PING_CACHE_TTL_MS });
    response.json({ ok: true, status: 'connected' });
  } catch {
    devicePingCache.set(id, { status: 'offline', expiresAt: Date.now() + PING_CACHE_TTL_MS });
    response.json({ ok: false, status: 'offline' });
  }
});

app.post('/api/openclaw/agent-action', async (request, response) => {
  const { action, modelName, host, username } = request.body as {
    action?: 'start' | 'status' | 'switch' | 'install' | 'logs';
    modelName?: string;
    host?: string;
    username?: string;
  };

  if (!action || !['start', 'status', 'switch', 'install', 'logs'].includes(action)) {
    sendApiError(response, 400, 'INVALID_OPENCLAW_ACTION', 'action 必须是 start/status/switch/install/logs', { retryable: false });
    return;
  }

  const devices = await readDevices();
  const target = host
    ? devices.find((d) => d.host === host && (username ? d.username === username : true))
    : devices[0];

  if (!target) {
    sendApiError(response, 404, 'DEVICE_NOT_FOUND', '未找到可用设备，请先在设备管理中连接设备', { retryable: false });
    return;
  }

  const selectedUsername = username ?? target.username;
  const selectedPort = target.port ?? 22;
  const passKey = credentialCacheKey(target.host, selectedUsername, selectedPort);
  const cachedPassword = devicePasswordCache.get(passKey);
  const providedPassword = request.header('x-device-password') ?? '';
  const persistedPassword = (target as Device & { password?: string }).password ?? '';
  const password = providedPassword || cachedPassword || persistedPassword || defaultSshPassword;

  const targetModel = modelName?.trim() || 'doubao-seed-2.0-lite';
  if (!isSafeName(targetModel)) {
    sendApiError(response, 400, 'INVALID_MODEL_NAME', '模型名称不合法', { retryable: false });
    return;
  }
  const safeModel = shellEscape(targetModel);
  const commandMap: Record<'start' | 'status' | 'switch' | 'install' | 'logs', string> = {
    install: `bash -lc '(curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-onboard || curl -fsSL https://code-server.dev/install.sh | sh || true); (openclaw --version || clawctl --version || echo "openclaw install command finished")'`,
    start: `bash -lc '(openclaw gateway start --port ${OPENCLAW_GATEWAY_PORT} || openclaw start || clawctl start || true); (openclaw status || clawctl status || ps -ef | grep -E "openclaw|claw" | grep -v grep || true)'`,
    status: `bash -lc '(openclaw status || clawctl status || ps -ef | grep -E "openclaw|claw" | grep -v grep || true)'`,
    switch: `bash -lc '(openclaw model use ${safeModel} || clawctl model use ${safeModel} || echo "switch command unavailable"); (openclaw status || clawctl status || true)'`,
    logs: `bash -lc '(journalctl -u openclaw --no-pager -n 120 || tail -n 120 /var/log/openclaw.log || echo "no openclaw logs found")'`,
  };

  const candidates = password ? [password] : passwordCandidates(selectedUsername);
  let lastError: unknown = null;

  for (const pwd of candidates) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const output = await runInDeviceLane(target.id, () => runRemoteCommands(
          {
            host: target.host,
            port: selectedPort,
            username: selectedUsername,
            password: pwd,
          },
          [commandMap[action]],
        ));

        devicePasswordCache.set(passKey, pwd);

        response.json({
          ok: true,
          action,
          host: target.host,
          username: selectedUsername,
          output,
        });
        return;
      } catch (error) {
        lastError = error;
        if (!(attempt === 0 && isTransientSshError(error))) {
          break;
        }
      }
    }
  }

  if (!password) {
    sendApiError(response, 400, 'DEVICE_PASSWORD_MISSING', '设备密码缺失或不正确，请在设备管理中重新连接并填写密码', { retryable: false });
    return;
  }

  if (isSshAuthError(lastError)) {
    sendApiError(response, 401, 'SSH_AUTH_FAILED', 'OpenClaw 板端认证失败，请检查设备账号密码', { retryable: false });
    return;
  }
  if (isSshTimeoutError(lastError)) {
    sendApiError(response, 504, 'DEVICE_COMMAND_TIMEOUT', 'OpenClaw 板端执行超时，请稍后重试', { retryable: true });
    return;
  }
  sendApiError(
    response,
    500,
    'OPENCLAW_ACTION_FAILED',
    lastError instanceof Error ? `OpenClaw 板端执行失败: ${lastError.message}` : 'OpenClaw 板端执行失败',
    { retryable: true },
  );
});

app.delete('/api/devices/:id', async (request, response) => {
  const { id } = request.params;
  const devices = await readDevices();
  const target = devices.find((device) => device.id === id);

  if (!target) {
    response.status(404).json({ error: '设备不存在' });
    return;
  }

  deleteDevicePasswordCache(target.host, target.username, target.port ?? 22);
  await writeDevices(devices.filter((device) => device.id !== id));
  const cleanup = purgeDeviceSoftwareState(target);
  response.json({ removedId: id, cleanup });
});

app.post('/api/devices/:id/openclaw', async (request, response) => {
  const { id } = request.params;
  const { installCommand, configureCommand } = request.body as {
    installCommand?: string;
    configureCommand?: string;
  };
  const providedPassword = request.header('x-device-password');
  const devices = await readDevices();
  const device = devices.find((item) => item.id === id);

  if (!device) {
    sendApiError(response, 404, 'DEVICE_NOT_FOUND', '设备不存在', { retryable: false });
    return;
  }

  const sshPassword = providedPassword || resolveStoredDevicePassword(device);

  if (!sshPassword) {
    sendApiError(response, 400, 'DEVICE_PASSWORD_MISSING', '缺少设备密码，请补充当前设备密码后重试', { retryable: false });
    return;
  }

  if (!installCommand && !configureCommand) {
    sendApiError(response, 400, 'INVALID_OPENCLAW_COMMANDS', '至少提供一条 OpenClaw 命令', { retryable: false });
    return;
  }

  try {
    const output = await runInDeviceLane(device.id, () => runRemoteCommands(
      {
        host: device.host,
        port: device.port ?? 22,
        username: device.username,
        password: sshPassword,
      },
      [installCommand ?? '', configureCommand ?? ''],
    ));

    const nextDevice: Device = {
      ...device,
      status: 'connected',
      lastCheckedAt: new Date().toISOString(),
    };

    await writeDevices(devices.map((item) => (item.id === nextDevice.id ? nextDevice : item)));
    response.json({ output, device: sanitizeDevice(nextDevice as Device & { password?: string }) });
  } catch (error) {
    if (isSshAuthError(error)) {
      sendApiError(response, 401, 'SSH_AUTH_FAILED', 'OpenClaw 认证失败，请检查设备账号密码', { retryable: false });
      return;
    }
    if (isSshTimeoutError(error)) {
      sendApiError(response, 504, 'DEVICE_COMMAND_TIMEOUT', 'OpenClaw 执行超时，请稍后重试', { retryable: true });
      return;
    }
    sendApiError(
      response,
      500,
      'OPENCLAW_COMMAND_FAILED',
      error instanceof Error ? `OpenClaw 执行失败: ${error.message}` : 'OpenClaw 执行失败',
      { retryable: true },
    );
  }
});

function runOpenClawManagerStep(
  invoke: (onOutput: (chunk: string) => void, onComplete: (success: boolean) => void) => void,
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    let output = '';
    invoke(
      (chunk) => {
        output += chunk;
      },
      (success) => {
        resolve({ ok: success, output });
      },
    );
  });
}

/** 一键部署：将 SSH 流式输出同步写入 job，避免前端轮询到空日志误以为卡住 */
function runOpenClawManagerStepForDeploy(
  job: OpenClawDeployJob,
  invoke: (onOutput: (chunk: string) => void, onComplete: (success: boolean) => void) => void,
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    let output = '';
    invoke(
      (chunk) => {
        output += chunk;
        appendDeployOutput(job, chunk);
      },
      (success) => {
        resolve({ ok: success, output });
      },
    );
  });
}

async function executeOpenClawDeployJob(
  job: OpenClawDeployJob,
  deviceObj: ReturnType<typeof toOpenClawDevice>,
  deployConfig: {
    provider: string;
    baseUrl: string;
    apiKey: string;
    modelId: string;
    api: string;
  },
) {
  const readHealthStatus = () => new Promise<import('./managers/OpenClawDeploymentManager.js').OpenClawHealthStatus>((resolve) => {
    openClawManager.getHealthStatus(deviceObj, (status) => resolve(status));
  });

  const runStep = async (
    step: OpenClawDeployStepName,
    runner: () => Promise<{ ok: boolean; output: string }>,
    required: boolean,
  ) => {
    job.steps[step] = 'running';
    schedulePersistRuntimeJobs();
    broadcastDeployJobToSse(job);
    appendDeployOutput(job, `\n>>> ${step}\n`);
    const result = await runner();
    if (!result.ok) {
      job.steps[step] = 'error';
      schedulePersistRuntimeJobs();
      broadcastDeployJobToSse(job);
      if (required) {
        throw new Error(`${step} 步骤执行失败`);
      }
      return;
    }
    job.steps[step] = 'done';
    schedulePersistRuntimeJobs();
    broadcastDeployJobToSse(job);
  };

  try {
    await runStep('check', async () => {
      const diagnostic = await runOpenClawManagerStepForDeploy(job, (onOutput, onComplete) => {
        openClawManager.runCheck(deviceObj, onOutput, onComplete);
      });
      const network = await runOpenClawManagerStepForDeploy(job, (onOutput, onComplete) => {
        openClawManager.runNetworkCheck(deviceObj, onOutput, onComplete);
      });
      return {
        ok: network.ok,
        output: `${diagnostic.output || ''}\n${network.output || ''}`,
      };
    }, true);
    await runStep('prepare', () => runOpenClawManagerStepForDeploy(job, (onOutput, onComplete) => {
      openClawManager.runPrepare(deviceObj, onOutput, onComplete);
    }), true);
    await runStep('install', () => runOpenClawManagerStepForDeploy(job, (onOutput, onComplete) => {
      openClawManager.runInstall(deviceObj, onOutput, onComplete);
    }), true);
    await runStep('config', () => runOpenClawManagerStepForDeploy(job, (onOutput, onComplete) => {
      openClawManager.updateConfig(
        deviceObj,
        {
          modelGateway: {
            baseUrl: deployConfig.baseUrl,
            apiKey: deployConfig.apiKey,
            api: normalizeOpenClawApi(deployConfig.api),
            modelId: deployConfig.modelId,
            modelName: deployConfig.provider || 'custom',
          },
        },
        onOutput,
        onComplete,
      );
    }), true);

    const healthStatus = await readHealthStatus();
    if (!healthStatus.installed) {
      throw new Error(`部署后健康检查未通过：${healthStatus.summary || 'OpenClaw 未安装成功'}`);
    }
    if (!healthStatus.gatewayRunning || !healthStatus.aiReady) {
      appendDeployOutput(
        job,
        `\n[WARN] OpenClaw 已安装，但尚未完全就绪：${healthStatus.summary || '网关或 AI 能力未就绪'}\n` +
        '如仅需预下载/预安装可忽略该提示；如需立即可用，请继续执行网关启动与模型配置。\n',
      );
    }

    job.status = 'done';
    job.finishedAt = Date.now();
    schedulePersistRuntimeJobs();
    deploySseSendFinalAndClose(job);
  } catch (error) {
    job.status = 'error';
    job.error = error instanceof Error ? error.message : '部署失败';
    job.finishedAt = Date.now();
    schedulePersistRuntimeJobs();
    deploySseSendFinalAndClose(job);
  }
}

// OpenClaw 部署 API
app.post('/api/devices/:id/openclaw/check', async (request, response) => {
  const { id } = request.params;
  const device = await resolveDevice(request, response, id);
  if (!device) return;
  const { password } = resolvePassword(request, device);
  const deviceObj = toOpenClawDevice(device, password);
  let output = '';
  openClawManager.runCheck(deviceObj, (chunk) => { output += chunk; }, (success) => {
    response.json({ ok: success, output });
  });
});

app.post('/api/devices/:id/openclaw/prepare', async (request, response) => {
  const { id } = request.params;
  const device = await resolveDevice(request, response, id);
  if (!device) return;

  const { password } = resolvePassword(request, device);
  const deviceObj = toOpenClawDevice(device, password);
  let output = '';
  openClawManager.runPrepare(deviceObj, (chunk) => { output += chunk; }, (success) => {
    response.json({ ok: success, output });
  });
});

app.post('/api/devices/:id/openclaw/install', async (request, response) => {
  const { id } = request.params;
  const device = await resolveDevice(request, response, id);
  if (!device) return;

  const { password } = resolvePassword(request, device);
  const deviceObj = toOpenClawDevice(device, password);
  let output = '';
  openClawManager.runInstall(deviceObj, (chunk) => { output += chunk; }, (success) => {
    response.json({ ok: success, output });
  });
});

app.post('/api/devices/:id/openclaw/install-stream', async (request, response) => {
  const { id } = request.params;
  const device = await resolveDevice(request, response, id);
  if (!device) return;

  const { password } = resolvePassword(request, device);
  const deviceObj = toOpenClawDevice(device, password);

  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('Cache-Control', 'no-cache');
  response.setHeader('Connection', 'keep-alive');
  response.flushHeaders();

  request.on('close', () => { response.end(); });

  openClawManager.runInstall(deviceObj, (chunk) => {
    if (!response.writableEnded) {
      response.write(`data: ${JSON.stringify({ type: 'log', text: chunk })}\n\n`);
    }
  }, (success) => {
    if (!response.writableEnded) {
      response.write(`data: ${JSON.stringify({ type: 'done', ok: success })}\n\n`);
      response.end();
    }
  });
});

app.post('/api/devices/:id/openclaw/deploy/start', async (request, response) => {
  const { id } = request.params;
  const { provider, baseUrl, apiKey, modelId, api } = request.body as {
    provider?: string;
    baseUrl?: string;
    apiKey?: string;
    modelId?: string;
    api?: string;
  };
  const activeConfig = loadProviderConfig();
  const resolvedApiKey = String(apiKey || '').trim() || String(activeConfig?.apiKey || '').trim();
  const resolvedModelId = String(modelId || '').trim() || String(activeConfig?.model || '').trim();
  const resolvedProvider = String(provider || '').trim() || String(activeConfig?.provider || '').trim() || 'custom';
  const resolvedBaseUrl = String(baseUrl || '').trim() || String(activeConfig?.baseUrl || '').trim();
  if (!resolvedApiKey || !resolvedModelId) {
    sendApiError(response, 400, 'INVALID_DEPLOY_CONFIG', 'apiKey 和 modelId 为必填项（可先在 AI 模型设置中保存）', { retryable: false });
    return;
  }

  cleanupOpenClawDeployJobs();
  const existingRunning = Array.from(openClawDeployJobs.values()).find((job) => job.deviceId === id && job.status === 'running');
  if (existingRunning) {
    response.json({ ok: true, jobId: existingRunning.id, alreadyRunning: true });
    return;
  }

  const device = await resolveDevice(request, response, id);
  if (!device) return;
  const { password } = resolvePassword(request, device);
  const deviceObj = toOpenClawDevice(device, password);

  const jobId = uuid();
  const job: OpenClawDeployJob = {
    id: jobId,
    deviceId: id,
    status: 'running',
    steps: {
      check: 'pending',
      prepare: 'pending',
      install: 'pending',
      config: 'pending',
    },
    output: '',
    startedAt: Date.now(),
  };
  openClawDeployJobs.set(jobId, job);
  schedulePersistRuntimeJobs();
  response.json({ ok: true, jobId, status: job.status });

  void executeOpenClawDeployJob(job, deviceObj, {
    provider: resolvedProvider,
    baseUrl: resolvedBaseUrl,
    apiKey: resolvedApiKey,
    modelId: resolvedModelId,
    api: normalizeOpenClawApi(api),
  });
});

app.get('/api/devices/:id/openclaw/deploy/status', async (request, response) => {
  const { id } = request.params;
  const jobId = String(request.query.jobId || '').trim();
  if (!jobId) {
    sendApiError(response, 400, 'INVALID_JOB_ID', '缺少 jobId', { retryable: false });
    return;
  }
  cleanupOpenClawDeployJobs();
  const job = openClawDeployJobs.get(jobId);
  if (!job || job.deviceId !== id) {
    sendApiError(response, 404, 'OPENCLAW_DEPLOY_JOB_NOT_FOUND', '部署任务不存在', { retryable: false });
    return;
  }
  response.json({ ok: true, job });
});

/** 一键部署日志实时推送（SSE）；与轮询并行，前端以本通道为主 */
app.get('/api/devices/:id/openclaw/deploy/stream', (request, response) => {
  const { id } = request.params;
  const jobId = String(request.query.jobId || '').trim();
  if (!jobId) {
    sendApiError(response, 400, 'INVALID_JOB_ID', '缺少 jobId', { retryable: false });
    return;
  }
  cleanupOpenClawDeployJobs();
  const job = openClawDeployJobs.get(jobId);
  if (!job || job.deviceId !== id) {
    sendApiError(response, 404, 'OPENCLAW_DEPLOY_JOB_NOT_FOUND', '部署任务不存在', { retryable: false });
    return;
  }
  response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');
  response.flushHeaders();

  if (!deploySSEClients.has(jobId)) deploySSEClients.set(jobId, new Set());
  deploySSEClients.get(jobId)!.add(response);

  try {
    response.write(`data: ${JSON.stringify({ type: 'job', job })}\n\n`);
  } catch {
    deploySSEClients.get(jobId)!.delete(response);
    return;
  }

  request.on('close', () => {
    const set = deploySSEClients.get(jobId);
    if (!set) return;
    set.delete(response);
    if (set.size === 0) deploySSEClients.delete(jobId);
  });
});

app.post('/api/devices/:id/openclaw/upgrade', async (request, response) => {
  const { id } = request.params;
  const device = await resolveDevice(request, response, id);
  if (!device) return;

  const { password } = resolvePassword(request, device);
  const deviceObj = toOpenClawDevice(device, password);
  let output = '';
  openClawManager.runUpgrade(deviceObj, (chunk) => { output += chunk; }, (success) => {
    response.json({ ok: success, output });
  });
});

app.post('/api/devices/:id/openclaw/uninstall', async (request, response) => {
  const { id } = request.params;
  const device = await resolveDevice(request, response, id);
  if (!device) return;

  const { password } = resolvePassword(request, device);
  const deviceObj = toOpenClawDevice(device, password);
  let output = '';
  openClawManager.runUninstall(deviceObj, (chunk) => { output += chunk; }, (success) => {
    response.json({ ok: success, output });
  });
});

app.post('/api/devices/:id/openclaw/onboard', async (request, response) => {
  const { id } = request.params;
  const { provider, apiKey, modelId } = request.body as { provider?: string; apiKey?: string; modelId?: string };
  
  if (!provider || !apiKey) {
    sendApiError(response, 400, 'INVALID_ONBOARD_CONFIG', 'provider 和 apiKey 为必填项', { retryable: false });
    return;
  }

  const device = await resolveDevice(request, response, id);
  if (!device) return;

  const { password } = resolvePassword(request, device);
  const deviceObj = toOpenClawDevice(device, password);
  let output = '';
  openClawManager.runOnboard(deviceObj, provider, apiKey, modelId, (chunk) => { output += chunk; }, (success) => {
    response.json({ ok: success, output });
  });
});

app.post('/api/devices/:id/openclaw/config', async (request, response) => {
  const { id } = request.params;
  const { config } = request.body as { config?: any };

  if (!config) {
    sendApiError(response, 400, 'INVALID_OPENCLAW_CONFIG', '缺少配置数据', { retryable: false });
    return;
  }
  if (config?.modelGateway) {
    config.modelGateway.api = normalizeOpenClawApi(config.modelGateway.api);
  }

  const device = await resolveDevice(request, response, id);
  if (!device) return;

  const { password } = resolvePassword(request, device);
  const deviceObj = toOpenClawDevice(device, password);
  let output = '';
  openClawManager.updateConfig(deviceObj, config, (chunk) => { output += chunk; }, (success) => {
    response.json({ ok: success, output });
  });
});

app.get('/api/devices/:id/openclaw/status', async (request, response) => {
  const { id } = request.params;
  const device = await resolveDevice(request, response, id);
  if (!device) return;

  const { password } = resolvePassword(request, device);
  const deviceObj = toOpenClawDevice(device, password);
  openClawManager.getGatewayStatus(deviceObj, (status) => {
    response.json(status);
  });
});

app.get('/api/devices/:id/openclaw/health', async (request, response) => {
  const { id } = request.params;
  const device = await resolveDevice(request, response, id);
  if (!device) return;

  const { password } = resolvePassword(request, device);
  const deviceObj = toOpenClawDevice(device, password);
  openClawManager.getHealthStatus(deviceObj, (status) => {
    response.json({ ok: true, status });
  });
});

app.get('/api/devices/:id/openclaw/config', async (request, response) => {
  const { id } = request.params;
  const device = await resolveDevice(request, response, id);
  if (!device) return;

  const { password } = resolvePassword(request, device);
  const deviceObj = toOpenClawDevice(device, password);
  openClawManager.getCurrentConfig(deviceObj, (config, success) => {
    if (success && config) {
      response.json(config);
    } else {
      sendApiError(response, 500, 'OPENCLAW_CONFIG_READ_FAILED', '读取配置失败', { retryable: true });
    }
  });
});

app.post('/api/devices/:id/openclaw/restart-gateway', async (request, response) => {
  const { id } = request.params;
  const device = await resolveDevice(request, response, id);
  if (!device) return;

  const { password } = resolvePassword(request, device);
  const deviceObj = toOpenClawDevice(device, password);
  let output = '';
  openClawManager.runRestartGateway(deviceObj, (chunk) => { output += chunk; }, (success) => {
    response.json({ ok: success, output });
  });
});

app.get('/api/devices/:id/openclaw/version', async (request, response) => {
  const { id } = request.params;
  const device = await resolveDevice(request, response, id);
  if (!device) return;

  const { password } = resolvePassword(request, device);
  const deviceObj = toOpenClawDevice(device, password);
  let output = '';
  openClawManager.runGetVersion(deviceObj, (chunk) => { output += chunk; }, (success) => {
    response.json({ ok: success, version: output.trim() });
  });
});

app.post('/api/devices/:id/openclaw/doctor', async (request, response) => {
  const { id } = request.params;
  const device = await resolveDevice(request, response, id);
  if (!device) return;

  const { password } = resolvePassword(request, device);
  const deviceObj = toOpenClawDevice(device, password);
  let output = '';
  openClawManager.runDoctor(deviceObj, (chunk) => { output += chunk; }, (success) => {
    response.json({ ok: success, output });
  });
});

app.post('/api/devices/:id/openclaw/model-test', async (request, response) => {
  const { id } = request.params;
  const device = await resolveDevice(request, response, id);
  if (!device) return;
  const { password } = resolvePassword(request, device);
  const deviceObj = toOpenClawDevice(device, password);
  let output = '';
  openClawManager.runModelTest(deviceObj, (chunk) => { output += chunk; }, (success) => {
    const text = output.trim();
    const ok = success && /MODEL_TEST_OK/.test(text);
    const pairingRequired = /pairing required/i.test(text);
    response.json({ ok, output: text, pairingRequired });
  });
});

app.post('/api/devices/:id/openclaw/script-install', async (request, response) => {
  const { id } = request.params;
  const device = await resolveDevice(request, response, id);
  if (!device) return;

  const { password } = resolvePassword(request, device);
  const deviceObj = toOpenClawDevice(device, password);
  let output = '';
  openClawManager.runScriptInstall(deviceObj, (chunk) => { output += chunk; }, (success) => {
    response.json({ ok: success, output });
  });
});

app.post('/api/devices/:id/openclaw/logs', async (request, response) => {
  const { id } = request.params;
  const { limit } = request.body as { limit?: number };
  const device = await resolveDevice(request, response, id);
  if (!device) return;

  const { password } = resolvePassword(request, device);
  const deviceObj = toOpenClawDevice(device, password);
  let output = '';
  openClawManager.runLogs(deviceObj, Number(limit ?? 200), (chunk) => { output += chunk; }, (success) => {
    response.json({ ok: success, output });
  });
});

app.get('/api/devices/:id/openclaw/skills', async (request, response) => {
  const { id } = request.params;
  const device = await resolveDevice(request, response, id);
  if (!device) return;
  const { password } = resolvePassword(request, device);
  const deviceObj = toOpenClawDevice(device, password);
  let output = '';
  openClawManager.getInstalledSkills(deviceObj, (chunk) => { output += chunk; }, (success) => {
    const skills: string[] = [];
    const plugins: string[] = [];
    let section = '';
    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '===SKILLS===') { section = 'skills'; continue; }
      if (trimmed === '===PLUGINS===') { section = 'plugins'; continue; }
      if (!trimmed || trimmed.startsWith('无已安装')) continue;
      if (section === 'skills') skills.push(trimmed);
      else if (section === 'plugins') plugins.push(trimmed);
    }
    response.json({ ok: success, skills, plugins, raw: output });
  });
});

app.get('/api/devices/:id/openclaw/skill-content', async (request, response) => {
  const { id } = request.params;
  const skillIdRaw = String(request.query.skillId || '').trim();
  if (!skillIdRaw) {
    sendApiError(response, 400, 'INVALID_SKILL_ID', 'skillId 不能为空', { retryable: false });
    return;
  }

  const run = await runOnDevice(request, response, id, [
    `bash -lc "python3 -c \\"import base64,sys,os,json;raw=base64.b64decode(sys.argv[1]).decode('utf-8','ignore').strip();bases=['/opt/openclaw/skills','/root/.openclaw/workspace/skills'];c=[raw,raw.split()[0] if raw else '',raw.replace('openclaw.','',1), (raw.split()[0] if raw else '').replace('openclaw.','',1)];cand=[];[cand.append(x) for x in c if x and x not in cand];found='';\nfor base in bases:\n  if not os.path.isdir(base):\n    continue\n  paths=[]\n  [paths.extend([f'{base}/{x}/SKILL.md',f'{base}/{x}/skill.md']) for x in cand]\n  for p in paths:\n    if os.path.isfile(p):\n      found=p\n      break\n  if found:\n    break\n  dirs=sorted(os.listdir(base))\n  for x in cand:\n    m=''\n    for d in dirs:\n      if d==x or d.startswith(x):\n        m=d\n        break\n    if m:\n      for p in (f'{base}/{m}/SKILL.md',f'{base}/{m}/skill.md'):\n        if os.path.isfile(p):\n          found=p\n          break\n    if found:\n      break\n  if found:\n    break\ncontent=''\nif found:\n  try:\n    content=open(found,'r',encoding='utf-8',errors='ignore').read()\n  except Exception:\n    content=''\nprint(json.dumps({'ok':bool(found),'path':found,'content':content}, ensure_ascii=False))\\" '${Buffer.from(skillIdRaw).toString('base64')}'"`,
  ]);
  if (!run) return;

  const text = String(run.output || '').trim();
  try {
    const parsed = JSON.parse(text) as { ok?: boolean; path?: string; content?: string };
    if (!parsed.ok) {
      sendApiError(response, 404, 'SKILL_CONTENT_NOT_FOUND', `未找到 skill 内容: ${skillIdRaw}`, { retryable: false });
      return;
    }
    response.json({ ok: true, path: parsed.path || '', content: parsed.content || '' });
  } catch {
    sendApiError(response, 500, 'SKILL_CONTENT_PARSE_FAILED', 'skill 内容解析失败', {
      retryable: true,
      details: { raw: text },
    });
  }
});

app.post('/api/devices/:id/openclaw/skill-write', async (request, response) => {
  const { id } = request.params;
  const { skillId, content } = request.body as { skillId?: string; content?: string };
  const name = String(skillId || '').trim();
  const md = String(content || '').trim();
  if (!name || !md) {
    sendApiError(response, 400, 'INVALID_SKILL_WRITE', 'skillId 和 content 不能为空', { retryable: false });
    return;
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    sendApiError(response, 400, 'INVALID_SKILL_ID', 'skillId 只能包含字母、数字、下划线和横线', { retryable: false });
    return;
  }
  const skillDir = `/root/.openclaw/workspace/skills/${name}`;
  const b64 = Buffer.from(md, 'utf-8').toString('base64');
  const run = await runOnDevice(request, response, id, [
    `bash -lc "mkdir -p '${skillDir}' && echo '${b64}' | base64 -d > '${skillDir}/SKILL.md' && echo OK"`,
  ]);
  if (!run) return;
  const ok = String(run.output || '').trim().endsWith('OK');
  if (ok) {
    response.json({ ok: true, path: `${skillDir}/SKILL.md`, message: `技能 ${name} 已写入板端` });
  } else {
    sendApiError(response, 500, 'SKILL_WRITE_FAILED', '写入失败', { retryable: true, details: { output: run.output } });
  }
});

/**
 * 删除板端技能目录：同时尝试
 * - /root/.openclaw/workspace/skills/<id>（用户/Studio 部署）
 * - /opt/openclaw/skills/<id>（系统或预装）
 * 与列表 API 扫描范围一致，避免「能读到、删不掉」。
 */
app.post('/api/devices/:id/openclaw/skill-delete', async (request, response) => {
  const { id } = request.params;
  const { skillId } = request.body as { skillId?: string };
  const name = String(skillId || '').trim();
  if (!name) {
    sendApiError(response, 400, 'INVALID_SKILL_DELETE', 'skillId 不能为空', { retryable: false });
    return;
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    sendApiError(response, 400, 'INVALID_SKILL_ID', 'skillId 只能包含字母、数字、下划线和横线', { retryable: false });
    return;
  }
  const wsDir = `/root/.openclaw/workspace/skills/${name}`;
  const optDir = `/opt/openclaw/skills/${name}`;
  const run = await runOnDevice(request, response, id, [
    `bash -lc "out=NOT_FOUND; [ -d '${wsDir}' ] && rm -rf '${wsDir}' && out=OK; [ -d '${optDir}' ] && rm -rf '${optDir}' && out=OK; echo \\$out"`,
  ]);
  if (!run) return;
  const out = String(run.output || '').trim();
  if (out.endsWith('OK')) {
    response.json({
      ok: true,
      message: `已删除板端技能 ${name}（若存在于工作区与 /opt/openclaw/skills 均已移除）`,
    });
    return;
  }
  if (out.includes('NOT_FOUND')) {
    sendApiError(
      response,
      404,
      'SKILL_NOT_FOUND_ON_DEVICE',
      '板端未找到该技能目录（已检查 ~/.openclaw/workspace/skills 与 /opt/openclaw/skills）。请刷新列表后重试，或在设备上确认路径。',
      { retryable: false },
    );
    return;
  }
  sendApiError(response, 500, 'SKILL_DELETE_FAILED', '删除失败', { retryable: true, details: { output: run.output } });
});

/** 若板端尚无或版本/内容与 Studio 内置不一致，则部署 rdk-rdkclaw-partner-advisory 并校验 sha256 */
app.post('/api/devices/:id/openclaw/ensure-partner-advisory-skill', async (request, response) => {
  const { id } = request.params;
  try {
    await handleEnsurePartnerAdvisorySkill(runOnDevice, request, response, id);
  } catch (error) {
    if (!response.headersSent) {
      sendApiError(
        response,
        500,
        'ENSURE_PARTNER_SKILL_FAILED',
        error instanceof Error ? error.message : '同步内置同伴商量技能失败',
        { retryable: true },
      );
    }
  }
});

app.post('/api/devices/:id/openclaw/pairing/list', async (request, response) => {
  const { id } = request.params;
  const { channel } = request.body as { channel?: string };
  const pairingChannel = String(channel || 'feishu').trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(pairingChannel)) {
    sendApiError(response, 400, 'INVALID_PAIRING_CHANNEL', 'channel 格式非法', { retryable: false });
    return;
  }
  const device = await resolveDevice(request, response, id);
  if (!device) return;
  const { password } = resolvePassword(request, device);
  const deviceObj = toOpenClawDevice(device, password);
  let output = '';
  openClawManager.runPairingList(deviceObj, pairingChannel, (chunk) => { output += chunk; }, (success) => {
    response.json({ ok: success, output });
  });
});

app.post('/api/devices/:id/openclaw/pairing/approve', async (request, response) => {
  const { id } = request.params;
  const { channel, code } = request.body as { channel?: string; code?: string };
  const pairingChannel = String(channel || 'feishu').trim();
  const pairingCode = String(code || '').trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(pairingChannel)) {
    sendApiError(response, 400, 'INVALID_PAIRING_CHANNEL', 'channel 格式非法', { retryable: false });
    return;
  }
  if (!/^[A-Za-z0-9]{4,16}$/.test(pairingCode)) {
    sendApiError(response, 400, 'INVALID_PAIRING_CODE', 'code 格式非法（4-16 位字母数字）', { retryable: false });
    return;
  }
  const device = await resolveDevice(request, response, id);
  if (!device) return;
  const { password } = resolvePassword(request, device);
  const deviceObj = toOpenClawDevice(device, password);
  let output = '';
  openClawManager.runPairingApprove(deviceObj, pairingChannel, pairingCode, (chunk) => { output += chunk; }, (success) => {
    response.json({ ok: success, output });
  });
});

app.post('/api/devices/:id/openclaw/pairing/reject', async (request, response) => {
  const { id } = request.params;
  const { channel, code } = request.body as { channel?: string; code?: string };
  const pairingChannel = String(channel || 'feishu').trim();
  const pairingCode = String(code || '').trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(pairingChannel)) {
    sendApiError(response, 400, 'INVALID_PAIRING_CHANNEL', 'channel 格式非法', { retryable: false });
    return;
  }
  if (!/^[A-Za-z0-9]{4,16}$/.test(pairingCode)) {
    sendApiError(response, 400, 'INVALID_PAIRING_CODE', 'code 格式非法（4-16 位字母数字）', { retryable: false });
    return;
  }
  const device = await resolveDevice(request, response, id);
  if (!device) return;
  const { password } = resolvePassword(request, device);
  const deviceObj = toOpenClawDevice(device, password);
  let output = '';
  openClawManager.runPairingReject(deviceObj, pairingChannel, pairingCode, (chunk) => { output += chunk; }, (success) => {
    response.json({ ok: success, output });
  });
});

app.get('/api/devices/:id/openclaw/wifi-list', async (request, response) => {
  const { id } = request.params;
  const device = await resolveDevice(request, response, id);
  if (!device) return;

  const { password } = resolvePassword(request, device);
  const deviceObj = toOpenClawDevice(device, password);
  openClawManager.getWifiList(deviceObj, (wifiNames, success) => {
    response.json({ ok: success, wifiNames });
  });
});

app.post('/api/devices/:id/openclaw/wifi-connect', async (request, response) => {
  const { id } = request.params;
  const { wifiName, wifiPassword } = request.body as { wifiName?: string; wifiPassword?: string };

  if (!wifiName) {
    sendApiError(response, 400, 'INVALID_WIFI_NAME', 'wifiName 为必填项', { retryable: false });
    return;
  }

  const device = await resolveDevice(request, response, id);
  if (!device) return;

  const { password } = resolvePassword(request, device);
  const deviceObj = toOpenClawDevice(device, password);
  let output = '';
  openClawManager.setWifiConnection(deviceObj, wifiName, wifiPassword || '', (chunk) => { output += chunk; }, (success) => {
    response.json({ ok: success, output });
  });
});

app.post('/api/devices/:id/exec', async (request, response) => {
  const { id } = request.params;
  const { command } = request.body as { command?: string };

  if (!command?.trim()) {
    sendApiError(response, 400, 'INVALID_COMMAND', '空命令已忽略', { retryable: false });
    return;
  }
  if (command.length > EXEC_COMMAND_MAX_LENGTH) {
    sendApiError(response, 400, 'INVALID_COMMAND', `命令过长，最大 ${EXEC_COMMAND_MAX_LENGTH} 字符`, { retryable: false });
    return;
  }

  const executed = await runOnDevice(request, response, id, [command], { timeoutMs: 60_000 });
  if (!executed) return;

  response.json({
    ok: true,
    output: executed.output,
    device: sanitizeDevice(executed.device as Device & { password?: string }),
    command,
  });
});

app.post('/api/devices/:id/batch-exec', async (request, response) => {
  const { id } = request.params;
  const { commands } = request.body as { commands?: string[] };

  if (!Array.isArray(commands) || commands.length === 0) {
    sendApiError(response, 400, 'INVALID_BATCH_COMMANDS', '空命令批次已忽略', { retryable: false });
    return;
  }
  if (commands.length > BATCH_EXEC_MAX_COMMANDS) {
    sendApiError(response, 400, 'INVALID_BATCH_COMMANDS', `批量命令数量过多，最大 ${BATCH_EXEC_MAX_COMMANDS} 条`, { retryable: false });
    return;
  }

  const filtered = commands.map((item) => item?.trim()).filter(Boolean) as string[];
  if (filtered.length === 0) {
    sendApiError(response, 400, 'INVALID_BATCH_COMMANDS', '空命令批次已忽略', { retryable: false });
    return;
  }
  if (filtered.some((item) => item.length > EXEC_COMMAND_MAX_LENGTH)) {
    sendApiError(response, 400, 'INVALID_BATCH_COMMANDS', `存在过长命令，单条最大 ${EXEC_COMMAND_MAX_LENGTH} 字符`, { retryable: false });
    return;
  }

  const executed = await runOnDevice(request, response, id, filtered, { timeoutMs: 60_000 });
  if (!executed) return;

  response.json({
    ok: true,
    output: executed.output,
    device: sanitizeDevice(executed.device as Device & { password?: string }),
    commandCount: filtered.length,
  });
});

app.get('/api/devices/:id/diagnostics', async (request, response) => {
  const { id } = request.params;

  const executed = await runOnDevice(request, response, id, DIAGNOSTIC_COMMANDS);
  if (!executed) return;

  response.json({
    ok: true,
    output: executed.output,
    device: sanitizeDevice(executed.device as Device & { password?: string }),
  });
});


/** SSH board detect; ?persist=1 writes board* + researchSeeds to devices.json */
app.post('/api/devices/:id/board/detect', async (request, response) => {
  const { id } = request.params;
  const persistRaw = String(request.query.persist ?? '').toLowerCase();
  const persist = persistRaw === '1' || persistRaw === 'true';

  const detectCmd = buildBoardDetectionCommand();
  const executed = await runOnDevice(request, response, id, [`bash -lc ${shEscape(detectCmd)}`], { timeoutMs: 45_000 });
  if (!executed) return;

  const parsed = parseBoardDetection(executed.output);
  const platform = parsed.platform;
  const researchSeeds = getResearchSeeds(platform);

  let deviceJson = sanitizeDevice(executed.device as Device & { password?: string });

  if (persist) {
    const devices = await readDevices();
    const nextDevices = devices.map((d) => {
      if (d.id !== id) return d;
      return {
        ...d,
        boardPlatform: platform ?? null,
        boardModel: parsed.model || undefined,
        boardOsVersion: parsed.osVersion || undefined,
        boardDetectedAt: new Date().toISOString(),
        researchSeeds,
      };
    });
    await writeDevices(nextDevices);
    const refreshed = nextDevices.find((d) => d.id === id);
    if (refreshed) {
      deviceJson = sanitizeDevice(refreshed as Device & { password?: string });
    }
  }

  response.json({
    ok: true,
    platform,
    model: parsed.model,
    osVersion: parsed.osVersion,
    researchSeeds,
    output: executed.output,
    device: deviceJson,
    persisted: persist,
  });
});

app.get('/api/devices/:id/workspace/health', async (request, response) => {
  const { id } = request.params;

  const executed = await runOnDevice(request, response, id, [WORKSPACE_HEALTH_COMMAND]);
  if (!executed) return;

  response.json({
    ok: true,
    status: buildWorkspaceHealth(executed.output),
    output: executed.output,
    device: sanitizeDevice(executed.device as Device & { password?: string }),
  });

  triggerBackgroundProvision(id, parseWorkspaceHealthPairs(executed.output));
});

/* ── Flash / System Update API ── */
app.post('/api/devices/:id/flash/check', async (request, response) => {
  const { id } = request.params;
  // 检查设备当前系统版本、存储空间、可用介质
  const executed = await runOnDevice(request, response, id, [
    'bash -lc "echo ===VERSION===; cat /etc/version 2>/dev/null || cat /etc/os-release 2>/dev/null | head -5 || echo unknown; echo ===STORAGE===; df -h / /userdata 2>/dev/null || df -h; echo ===EMMC===; ls -la /dev/mmcblk* 2>/dev/null || echo no-emmc; echo ===BOARD===; cat /sys/class/socinfo/board_id 2>/dev/null || cat /proc/device-tree/model 2>/dev/null || echo unknown-board; echo ===HBUPDATE===; which hbupdate 2>/dev/null && echo hbupdate-available || echo no-hbupdate"',
  ]);
  if (!executed) return;
  response.json({ ok: true, output: executed.output });
});

app.post('/api/devices/:id/flash/download', async (request, response) => {
  const { id } = request.params;
  const { imageUrl, targetPath } = request.body as { imageUrl?: string; targetPath?: string };
  if (!imageUrl?.trim()) {
    sendApiError(response, 400, 'INVALID_FLASH_DOWNLOAD_PAYLOAD', '缺少镜像下载地址 imageUrl', { retryable: false });
    return;
  }
  const dest = targetPath?.trim() || FLASH_DEFAULT_DEST;
  // 在设备上下载镜像
  const executed = await runOnDevice(request, response, id, [
    `bash -lc "echo 'Downloading image...'; wget -q --show-progress -O ${shEscape(dest)} ${shEscape(imageUrl)} 2>&1 || curl -fSL -o ${shEscape(dest)} ${shEscape(imageUrl)} 2>&1; echo DONE; ls -lh ${shEscape(dest)}"`,
  ], { timeoutMs: 30 * 60 * 1000 });
  if (!executed) return;
  response.json({ ok: true, output: executed.output, path: dest });
});

app.post('/api/devices/:id/flash/write', async (request, response) => {
  const { id } = request.params;
  const { imagePath, target } = request.body as { imagePath?: string; target?: string };
  if (!imagePath?.trim()) {
    sendApiError(response, 400, 'INVALID_FLASH_WRITE_PAYLOAD', '缺少镜像路径 imagePath', { retryable: false });
    return;
  }
  // target: emmc (/dev/mmcblk0), sd (/dev/mmcblk1), 或自定义路径
  const targetDev = target === 'emmc' ? '/dev/mmcblk0' : target === 'sd' ? '/dev/mmcblk1' : (target || '/dev/mmcblk0');
  // 使用 hbupdate 或 dd 写入
  const executed = await runOnDevice(request, response, id, [
    `bash -lc "if command -v hbupdate >/dev/null 2>&1; then echo 'Using hbupdate...'; hbupdate ${shEscape(imagePath)} 2>&1; else echo 'Using dd...'; dd if=${shEscape(imagePath)} of=${shEscape(targetDev)} bs=4M status=progress 2>&1; sync; fi; echo FLASH_COMPLETE"`,
  ], { timeoutMs: 30 * 60 * 1000 });
  if (!executed) return;
  response.json({ ok: true, output: executed.output });
});

app.post('/api/devices/:id/flash/verify', async (request, response) => {
  const { id } = request.params;
  const { targetDevice } = request.body as { targetDevice?: string };
  const dev = targetDevice?.trim() || '/dev/mmcblk1';
  const verifyCmd = `bash -lc '
echo "===POST_FLASH==="
cat /etc/version 2>/dev/null || echo no-version
uname -a

echo "===BOOT==="
systemctl is-system-running 2>/dev/null || echo unknown

echo "===BPU==="
hrut_smi 2>/dev/null | head -5 || echo bpu-check-unavailable

echo "===PARTITIONS==="
fdisk -l ${dev} 2>/dev/null | head -30 || echo partition-check-unavailable
lsblk ${dev} 2>/dev/null || echo lsblk-unavailable

echo "===MOUNT==="
mount | grep "${dev}" 2>/dev/null || echo no-active-mounts

echo "===DISK_HEALTH==="
df -h / /userdata /boot 2>/dev/null || echo df-unavailable

echo "===VERIFY_DONE==="
'`;
  const executed = await runOnDevice(request, response, id, [verifyCmd], { timeoutMs: 60_000 });
  if (!executed) return;

  const output = executed.output;
  const checks = {
    version: /===POST_FLASH===[\s\S]*?(?:no-version|(\S+))/.exec(output)?.[1] || null,
    bootStatus: /===BOOT===\s*(\S+)/.exec(output)?.[1] || 'unknown',
    bpuAvailable: !/bpu-check-unavailable/.test(output),
    partitionsOk: /===PARTITIONS===/.test(output) && !/partition-check-unavailable/.test(output),
    mountsOk: /===MOUNT===/.test(output) && !/no-active-mounts/.test(output),
    diskHealthOk: /===DISK_HEALTH===/.test(output) && !/df-unavailable/.test(output),
  };
  const healthy = checks.bootStatus === 'running' && checks.partitionsOk;
  response.json({ ok: true, healthy, checks, output });
});

app.post('/api/devices/:id/flash/backup/check', async (request, response) => {
  const { id } = request.params;
  const executed = await runOnDevice(request, response, id, [
    'bash -lc "if command -v rdk-backup >/dev/null 2>&1; then echo RDK_BACKUP_AVAILABLE; (rdk-backup --version 2>/dev/null || true); else echo RDK_BACKUP_NOT_FOUND; fi"',
  ], { timeoutMs: 20_000 });
  if (!executed) return;
  const available = /RDK_BACKUP_AVAILABLE/.test(executed.output);
  response.json({ ok: true, available, output: executed.output });
});

app.post('/api/devices/:id/flash/backup/start', async (request, response) => {
  const { id } = request.params;
  const { outputPath, sourceDevice } = request.body as { outputPath?: string; sourceDevice?: string };
  cleanupFlashBackupJobs();
  const jobId = uuid();
  const outPath = outputPath?.trim() || `/userdata/rdk-backup-${Date.now()}.img`;
  flashBackupJobs.set(jobId, {
    id: jobId,
    deviceId: id,
    status: 'running',
    outputPath: outPath,
    startedAt: Date.now(),
  });
  schedulePersistRuntimeJobs();

  const sourceArg = sourceDevice?.trim() ? ` --device ${shEscape(sourceDevice.trim())}` : '';
  const command = `bash -lc '
set -e
if ! command -v rdk-backup >/dev/null 2>&1; then
  echo "RDK_BACKUP_NOT_FOUND"
  exit 127
fi
HELP="$(rdk-backup --help 2>&1 || true)"
echo "$HELP" | head -60
if echo "$HELP" | grep -q -- "--output"; then
  rdk-backup --output ${shEscape(outPath)}${sourceArg}
elif echo "$HELP" | grep -q "backup"; then
  rdk-backup backup ${shEscape(outPath)}${sourceArg}
else
  rdk-backup ${shEscape(outPath)}${sourceArg}
fi
ls -lh ${shEscape(outPath)} 2>/dev/null || true
'`;

  const executed = await runOnDevice(request, response, id, [command], { timeoutMs: 30 * 60 * 1000 });
  if (!executed) {
    const job = flashBackupJobs.get(jobId);
    if (job) {
      job.status = 'error';
      job.error = '板端命令执行失败';
      job.finishedAt = Date.now();
      schedulePersistRuntimeJobs();
    }
    return;
  }

  const failed = /RDK_BACKUP_NOT_FOUND/.test(executed.output);
  const job = flashBackupJobs.get(jobId);
  if (job) {
    job.status = failed ? 'error' : 'done';
    job.output = executed.output;
    job.error = failed ? '板端缺少 rdk-backup 命令' : undefined;
    job.finishedAt = Date.now();
    schedulePersistRuntimeJobs();
  }

  response.json({
    ok: !failed,
    jobId,
    outputPath: outPath,
    output: executed.output,
    error: failed ? '板端缺少 rdk-backup 命令' : undefined,
  });
});

app.get('/api/devices/:id/flash/backup/status', async (request, response) => {
  const { id } = request.params;
  const { jobId } = request.query as { jobId?: string };
  cleanupFlashBackupJobs();
  if (!jobId?.trim()) {
    sendApiError(response, 400, 'INVALID_JOB_ID', '缺少 jobId', { retryable: false });
    return;
  }
  const job = flashBackupJobs.get(jobId.trim());
  if (!job || job.deviceId !== id) {
    sendApiError(response, 404, 'FLASH_BACKUP_JOB_NOT_FOUND', '备份任务不存在', { retryable: false });
    return;
  }
  response.json({ ok: true, job });
});

app.post('/api/devices/:id/flash/backup/download', async (request, response) => {
  const { id } = request.params;
  const { outputPath } = request.body as { outputPath?: string };
  const targetPath = outputPath?.trim();
  if (!targetPath) {
    sendApiError(response, 400, 'INVALID_OUTPUT_PATH', '缺少 outputPath', { retryable: false });
    return;
  }

  const executed = await runOnDevice(
    request,
    response,
    id,
    [`sudo bash -lc "if [ -f ${shEscape(targetPath)} ]; then base64 ${shEscape(targetPath)} | tr -d '\\n'; else echo NOT_FOUND; fi"`],
    { timeoutMs: 10 * 60 * 1000 },
  );
  if (!executed) return;
  if (executed.output.trim() === 'NOT_FOUND') {
    sendApiError(response, 404, 'FLASH_BACKUP_FILE_NOT_FOUND', '备份文件不存在', { retryable: false });
    return;
  }
  response.json({ ok: true, path: targetPath, contentBase64: executed.output.trim() });
});

app.post('/api/devices/:id/flash/execute', async (request, response) => {
  const { id } = request.params;
  const {
    imageUrl,
    target,
    board,
    mode,
    wifiName,
    wifiPass,
    skipVerify,
  } = request.body as {
    imageUrl?: string;
    target?: string;
    board?: string;
    mode?: 'network' | 'local';
    wifiName?: string;
    wifiPass?: string;
    skipVerify?: boolean;
  };

  if (!imageUrl?.trim()) {
    sendApiError(response, 400, 'INVALID_FLASH_EXECUTE_PAYLOAD', '缺少镜像地址 imageUrl', { retryable: false });
    return;
  }

  const targetMap: Record<string, string> = {
    emmc: '/dev/mmcblk0',
    sd: '/dev/mmcblk1',
    usb: '/dev/sda',
  };
  const targetDevice = targetMap[target ?? ''] ?? (target?.trim() || '/dev/mmcblk1');

  if (mode === 'local') {
    response.json({
      ok: true,
      strategy: 'local-guide',
      targetDevice,
      output: [
        `BOARD=${board ?? 'unknown'}`,
        `IMAGE=${imageUrl}`,
        `TARGET=${targetDevice}`,
        `WIFI=${wifiName ? `${wifiName}${wifiPass ? ' (已设置密码)' : ''}` : '未预配'}`,
        '请在本机使用 balenaEtcher / Raspberry Pi Imager / dd 执行写盘。',
      ].join('\n'),
    });
    return;
  }

  const imagePath = FLASH_TMP_IMAGE_XZ;
  const rawImagePath = FLASH_TMP_IMAGE_RAW;
  const wifiScript = wifiName?.trim()
    ? `mkdir -p /tmp/rdk_netplan && cat >/tmp/rdk_netplan/01-rdk-studio.yaml <<'NETCFG'\nnetwork:\n  version: 2\n  wifis:\n    wlan0:\n      dhcp4: true\n      access-points:\n        \"${wifiName.replace(/"/g, '\\"')}\":\n          password: \"${(wifiPass ?? '').replace(/"/g, '\\"')}\"\nNETCFG\n`
    : 'echo "skip wifi pre-config"';

  const command = `bash -lc '
set -e
echo "===FLASH_PLAN==="
echo "board=${board ?? 'unknown'}"
echo "image=${imageUrl}"
echo "target=${targetDevice}"
echo "mode=network"

echo "===DOWNLOAD==="
(wget -O ${shEscape(imagePath)} ${shEscape(imageUrl)} 2>&1 || curl -fL ${shEscape(imageUrl)} -o ${shEscape(imagePath)} 2>&1)
ls -lh ${shEscape(imagePath)}

echo "===PREPARE==="
if file ${shEscape(imagePath)} | grep -qi "XZ compressed"; then
  xz -dc ${shEscape(imagePath)} > ${shEscape(rawImagePath)}
else
  cp ${shEscape(imagePath)} ${shEscape(rawImagePath)}
fi
ls -lh ${shEscape(rawImagePath)}

echo "===WRITE==="
if command -v pv >/dev/null 2>&1; then
  pv ${shEscape(rawImagePath)} | dd of=${shEscape(targetDevice)} bs=8M conv=fsync status=none
else
  dd if=${shEscape(rawImagePath)} of=${shEscape(targetDevice)} bs=8M conv=fsync status=progress
fi
sync

echo "===WIFI==="
${wifiScript}

echo "===VERIFY==="
if [ ${skipVerify ? '1' : '0'} -eq 1 ]; then
  echo "skip verify"
else
  fdisk -l ${shEscape(targetDevice)} 2>/dev/null | head -20 || true
  lsblk ${shEscape(targetDevice)} 2>/dev/null || true
  sync && echo "sync ok"
fi

echo "===FLASH_DONE==="
'`;

  const executed = await runOnDevice(request, response, id, [command], { timeoutMs: 45 * 60 * 1000 });
  if (!executed) return;

  response.json({ ok: true, output: executed.output, strategy: 'network-direct', targetDevice });
});

app.get('/api/devices/:id/ros/topics', async (request, response) => {
  const { id } = request.params;
  const executed = await runOnDevice(request, response, id, ['bash -lc "source /opt/tros/humble/setup.bash 2>/dev/null; (command -v ros2 >/dev/null 2>&1 && ros2 topic list) || echo ROS2_NOT_INSTALLED"']);
  if (!executed) return;

  const topics = executed.output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('/'));

  response.json({
    ok: true,
    topics,
    output: executed.output,
  });
});

app.post('/api/devices/:id/models/deploy', async (request, response) => {
  const { id } = request.params;
  const { command } = request.body as { command?: string };

  if (!command?.trim()) {
    response.status(400).json({ error: '缺少部署命令 command' });
    return;
  }

  const executed = await runOnDevice(request, response, id, [command]);
  if (!executed) return;

  response.json({ ok: true, output: executed.output });
});

app.post('/api/devices/:id/examples/run', async (request, response) => {
  const { id } = request.params;
  const { command } = request.body as { command?: string };

  if (!command?.trim()) {
    response.status(400).json({ error: '缺少示例启动命令 command' });
    return;
  }

  const executed = await runOnDevice(request, response, id, [command]);
  if (!executed) return;

  response.json({ ok: true, output: executed.output });
});

app.get('/api/devices/:id/services/node-red', async (request, response) => {
  const { id } = request.params;
  const executed = await runOnDevice(
    request,
    response,
    id,
    ['bash -lc "(systemctl is-active nodered || pgrep -af node-red || echo inactive)"'],
  );
  if (!executed) return;

  const active = /\bactive\b|node-red/i.test(executed.output);
  response.json({ ok: true, active, output: executed.output });
});

app.get('/api/devices/:id/services/vnc', async (request, response) => {
  const { id } = request.params;
  const executed = await runOnDevice(
    request,
    response,
    id,
    ['bash -lc "_ss=\"$(ss -lntp 2>/dev/null || true)\"; _ns=\"$(netstat -lnt 2>/dev/null || true)\"; _ps=\"$(pgrep -af \'x11vnc|Xtigervnc|vncserver\' 2>/dev/null || true)\"; if (echo \"$_ss\" | grep -q \":5900\\|:5901\") || (echo \"$_ns\" | grep -q \":5900\\|:5901\") || [ -n \"$_ps\" ]; then echo VNC_ACTIVE; else echo VNC_INACTIVE; fi; systemctl is-active x11vnc 2>/dev/null || true; systemctl is-active vncserver 2>/dev/null || true; echo \"$_ps\""'],
  );
  if (!executed) return;

  const active = /\bVNC_ACTIVE\b/.test(executed.output);
  response.json({ ok: true, active, output: executed.output });
});

// ─── Service Start/Stop ───

app.post('/api/devices/:id/services/vnc/start', async (request, response) => {
  const { id } = request.params;
  const executed = await runOnDevice(request, response, id, [
    'bash -lc "probe_port(){ for p in 5900 5901; do if ss -lnt 2>/dev/null | grep -q \":$p\"; then echo $p; return 0; fi; if netstat -lnt 2>/dev/null | grep -q \":$p\"; then echo $p; return 0; fi; done; return 1; }; PORT=\"$(probe_port || true)\"; if [ -z \"$PORT\" ] && command -v x11vnc >/dev/null 2>&1; then for d in \"${DISPLAY:-:0}\" :0 :1 :2; do nohup x11vnc -display \"$d\" -rfbport 5900 -passwd 88888888 -shared -forever -bg >/tmp/x11vnc.log 2>&1 || true; sleep 1; PORT=\"$(probe_port || true)\"; [ -n \"$PORT\" ] && break; done; fi; if [ -z \"$PORT\" ] && command -v vncserver >/dev/null 2>&1; then (vncserver :0 >/tmp/vncserver.log 2>&1 || vncserver :1 >/tmp/vncserver.log 2>&1 || true); sleep 1; PORT=\"$(probe_port || true)\"; fi; if [ -n \"$PORT\" ]; then echo VNC_STARTED; echo VNC_PORT=$PORT; else echo VNC_START_FAILED; fi"',
  ]);
  if (!executed) return;
  const started = /\bVNC_STARTED\b/.test(executed.output);
  response.json({ ok: started, output: executed.output });
});

app.post('/api/devices/:id/services/vnc/stop', async (request, response) => {
  const { id } = request.params;
  const executed = await runOnDevice(request, response, id, [
    'bash -lc "(pkill x11vnc 2>/dev/null; vncserver -kill :0 2>/dev/null; echo VNC_STOPPED) || echo VNC_STOP_FAILED"',
  ]);
  if (!executed) return;
  response.json({ ok: true, output: executed.output });
});

app.post('/api/devices/:id/services/node-red/start', async (request, response) => {
  const { id } = request.params;
  const executed = await runOnDevice(request, response, id, [
    'bash -lc "(systemctl start nodered 2>/dev/null || node-red -D 2>/dev/null &) && echo NODERED_STARTED || echo NODERED_START_FAILED"',
  ]);
  if (!executed) return;
  const started = /NODERED_STARTED/i.test(executed.output);
  response.json({ ok: started, output: executed.output });
});

app.post('/api/devices/:id/services/node-red/stop', async (request, response) => {
  const { id } = request.params;
  const executed = await runOnDevice(request, response, id, [
    'bash -lc "(systemctl stop nodered 2>/dev/null; pkill -f node-red 2>/dev/null; echo NODERED_STOPPED) || echo NODERED_STOP_FAILED"',
  ]);
  if (!executed) return;
  response.json({ ok: true, output: executed.output });
});

// ─── ROS Extended ───

app.get('/api/devices/:id/ros/nodes', async (request, response) => {
  const { id } = request.params;
  const executed = await runOnDevice(request, response, id, [
    'bash -lc "source /opt/tros/humble/setup.bash 2>/dev/null; (command -v ros2 >/dev/null 2>&1 && ros2 node list 2>/dev/null) || echo ROS2_NOT_INSTALLED"',
  ]);
  if (!executed) return;
  const nodes = executed.output.split(/\r?\n/).map(l => l.trim()).filter(l => l.startsWith('/'));
  response.json({ ok: true, nodes, output: executed.output });
});

app.post('/api/devices/:id/ros/record/start', async (request, response) => {
  const { id } = request.params;
  const { topics, outputPath } = request.body as { topics?: string[]; outputPath?: string };
  const dest = outputPath?.trim() || '/tmp/rosbag_recording';
  const topicArgs = topics?.length ? topics.map(t => shEscape(t)).join(' ') : '-a';
  const executed = await runOnDevice(request, response, id, [
    `bash -lc "source /opt/tros/humble/setup.bash 2>/dev/null; nohup ros2 bag record ${topicArgs} -o ${shEscape(dest)} > /tmp/rosbag_record.log 2>&1 & echo ROSBAG_PID=\\$!; echo RECORDING_STARTED"`,
  ]);
  if (!executed) return;
  response.json({ ok: true, output: executed.output, path: dest });
});

app.post('/api/devices/:id/ros/record/stop', async (request, response) => {
  const { id } = request.params;
  const executed = await runOnDevice(request, response, id, [
    'bash -lc "pkill -INT -f \'ros2 bag record\' 2>/dev/null && echo RECORDING_STOPPED || echo NO_RECORDING_FOUND"',
  ]);
  if (!executed) return;
  response.json({ ok: true, output: executed.output });
});

// ─── Models Extended ───

app.get('/api/devices/:id/models/list', async (request, response) => {
  const { id } = request.params;
  const executed = await runOnDevice(request, response, id, [
    'bash -lc "echo ===MODEL_ZOO===; ls -1 /opt/rdk_model_zoo/models/ 2>/dev/null || echo NO_MODEL_ZOO; echo ===BIN_MODELS===; find /userdata -name \'*.bin\' -o -name \'*.onnx\' 2>/dev/null | head -30 || echo NONE; echo ===RUNNING===; ps -eo args | grep -E \'python3.*demo|dnn_node\' | grep -v grep || echo NONE"',
  ]);
  if (!executed) return;
  response.json({ ok: true, output: executed.output });
});

// ─── Device Scan ───

app.post('/api/devices/scan', async (_request, response) => {
  try {
    const { networkInterfaces } = await import('os');
    const nets = networkInterfaces();
    const subnets: string[] = [];
    for (const ifaces of Object.values(nets)) {
      for (const iface of ifaces ?? []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          const parts = iface.address.split('.');
          subnets.push(`${parts[0]}.${parts[1]}.${parts[2]}`);
        }
      }
    }
    const uniqueSubnets = [...new Set(subnets)];
    const found: Array<{ ip: string; port: number }> = [];
    const targets: string[] = [];
    for (const subnet of uniqueSubnets) {
      for (let i = 1; i <= 254; i++) {
        targets.push(`${subnet}.${i}`);
      }
    }

    const scanIp = (ip: string) => new Promise<void>((resolve) => {
      const sock = net.connect({ host: ip, port: 22, timeout: 800 });
      sock.on('connect', () => {
        found.push({ ip, port: 22 });
        sock.destroy();
        resolve();
      });
      sock.on('error', () => { sock.destroy(); resolve(); });
      sock.on('timeout', () => { sock.destroy(); resolve(); });
    });

    let cursor = 0;
    const concurrency = Math.min(64, targets.length || 1);
    const workers = Array.from({ length: concurrency }, async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= targets.length) break;
        await scanIp(targets[index]);
      }
    });

    await Promise.all(workers);
    response.json({ ok: true, devices: found, subnets: uniqueSubnets });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Scan failed' });
  }
});

// ─── Terminal Session (REST wrapper) ───

app.post('/api/devices/:id/terminal/create', async (request, response) => {
  const device = await resolveDevice(request, response, request.params.id);
  if (!device) return;
  const sessionId = `term-${uuid()}`;
  response.json({ ok: true, sessionId, device: sanitizeDevice(device as Device & { password?: string }) });
});

app.get('/api/devices/:id/files/list', async (request, response) => {
  const { id } = request.params;
  const targetPath = String(request.query.path ?? '/userdata');
  const executed = await runOnDevice(
    request,
    response,
    id,
    [`sudo bash -lc "ls -al ${shEscape(targetPath)} || true"`],
    { timeoutMs: 60_000 },
  );
  if (!executed) return;
  response.json({ ok: true, output: executed.output, path: targetPath });
});

app.get('/api/devices/:id/files/read', async (request, response) => {
  const { id } = request.params;
  const targetPath = String(request.query.path ?? '');
  const lines = Number(request.query.lines ?? 200);

  if (!targetPath.trim()) {
    sendApiError(response, 400, 'INVALID_PATH', 'path 不能为空', { retryable: false });
    return;
  }

  // Use base64 to avoid JSON encoding issues with weird characters
  const executed = await runOnDevice(
    request,
    response,
    id,
    [`sudo bash -lc "if [ -f ${shEscape(targetPath)} ]; then head -n ${Number.isFinite(lines) && lines > 0 ? Math.min(lines, 2000) : 200} ${shEscape(targetPath)} 2>/dev/null | base64 | tr -d '\\n'; else echo 'NOT_A_FILE'; fi || true"`],
    { timeoutMs: 180_000 },
  );
  if (!executed) return;
  
  if (executed.output.trim() === 'NOT_A_FILE') {
    response.json({ ok: true, output: 'NOT_A_FILE', path: targetPath });
    return;
  }

  const base64Str = executed.output.trim();
  const decoded = Buffer.from(base64Str, 'base64').toString('utf-8');
  response.json({ ok: true, output: decoded, contentBase64: base64Str, path: targetPath });
});

app.post('/api/devices/:id/files/write', async (request, response) => {
  const { id } = request.params;
  const { path: targetPath, content, append } = request.body as { path?: string; content?: string; append?: boolean };

  if (!targetPath?.trim()) {
    sendApiError(response, 400, 'INVALID_PATH', 'path 不能为空', { retryable: false });
    return;
  }

  // If appending, use bash base64. If overriding, use SFTP to support larger files.
  if (!append) {
    const device = await resolveDevice(request, response, id);
    if (!device) return;
    const { password } = resolvePassword(request, device);
    const candidates = password ? [password] : passwordCandidates(device.username);
    let lastError: unknown = null;
    
    for (const pwd of candidates) {
      try {
        await runInDeviceLane(device.id, async () => {
          await runRemoteCommands(
            { host: device.host, port: device.port ?? 22, username: device.username, password: pwd },
            [`mkdir -p $(dirname ${shEscape(targetPath)}) || true`],
            { timeoutMs: 30_000 },
          );
          await uploadFileSftp(
            { host: device.host, port: device.port ?? 22, username: device.username, password: pwd },
            targetPath,
            Buffer.from(content ?? '', 'utf-8'),
          );
        });
        response.json({ ok: true, output: '写入完成', path: targetPath });
        return;
      } catch (e) {
        lastError = e;
      }
    }
    response.status(500).json({ error: lastError instanceof Error ? lastError.message : '写入失败' });
    return;
  }

  const base64Content = Buffer.from(content ?? '', 'utf-8').toString('base64');
  const redirect = append ? '>>' : '>';
  const executed = await runOnDevice(
    request,
    response,
    id,
    [`bash -lc "mkdir -p $(dirname ${shEscape(targetPath)}); echo ${shEscape(base64Content)} | base64 -d ${redirect} ${shEscape(targetPath)}"`],
    { timeoutMs: 180_000 },
  );
  if (!executed) return;
  response.json({ ok: true, output: executed.output || '写入完成', path: targetPath });
});

app.post('/api/devices/:id/files/upload', async (request, response) => {
  const { id } = request.params;
  const { path: targetPath, contentBase64 } = request.body as { path?: string; contentBase64?: string };

  if (!targetPath?.trim() || !contentBase64) {
    sendApiError(response, 400, 'INVALID_UPLOAD_PAYLOAD', 'path 和 contentBase64 不能为空', { retryable: false });
    return;
  }

  const device = await resolveDevice(request, response, id);
  if (!device) return;

  const { password } = resolvePassword(request, device);
  const candidates = password ? [password] : passwordCandidates(device.username);
  let lastError: unknown = null;

  for (const pwd of candidates) {
    try {
      // Create folder if needed via exec first
      await runInDeviceLane(device.id, async () => {
        await runRemoteCommands(
          { host: device.host, port: device.port ?? 22, username: device.username, password: pwd },
          [`mkdir -p $(dirname ${shEscape(targetPath)}) || true`],
          { timeoutMs: 30_000 },
        );
        const buffer = Buffer.from(contentBase64, 'base64');
        await uploadFileSftp(
          { host: device.host, port: device.port ?? 22, username: device.username, password: pwd },
          targetPath,
          buffer,
        );
      });
      
      response.json({ ok: true, path: targetPath });
      return;
    } catch (e) {
      lastError = e;
    }
  }

  response.status(500).json({
    error: lastError instanceof Error ? `长传失败: ${lastError.message}` : '文件上传失败'
  });
});

app.get('/api/devices/:id/files/download', async (request, response) => {
  const { id } = request.params;
  const targetPath = String(request.query.path ?? '');

  if (!targetPath.trim()) {
    sendApiError(response, 400, 'INVALID_PATH', 'path 不能为空', { retryable: false });
    return;
  }

  // Support both file and directory download (tar.gz for directory).
  const executed = await runOnDevice(
    request,
    response,
    id,
    [`sudo bash -lc "if [ -d ${shEscape(targetPath)} ]; then echo '__TYPE__:dir'; tar czf - ${shEscape(targetPath)} 2>/dev/null | base64 | tr -d '\\n'; elif [ -f ${shEscape(targetPath)} ]; then echo '__TYPE__:file'; base64 ${shEscape(targetPath)} | tr -d '\\n'; else echo 'NOT_FOUND'; fi || true"`],
    { timeoutMs: 10 * 60 * 1000 },
  );
  
  if (!executed) return;
  const output = executed.output.trim();
  if (output === 'NOT_FOUND') {
    sendApiError(response, 404, 'FILE_NOT_FOUND', '文件或目录不存在', { retryable: false });
    return;
  }

  const typeMatch = output.match(/^__TYPE__:(dir|file)\r?\n/);
  const isDir = typeMatch?.[1] === 'dir';
  const contentBase64 = typeMatch ? output.slice(typeMatch[0].length).trim() : output;
  response.json({ ok: true, path: targetPath, contentBase64, isDir });
});

app.post('/api/agent/plan', async (request, response) => {
  if (!apiKey) {
    response.status(500).json({ error: '缺少 OPENAI_API_KEY，请先配置后端环境变量' });
    return;
  }

  const { goal, deviceName, deviceIp } = request.body as {
    goal?: string;
    deviceName?: string;
    deviceIp?: string;
  };

  if (!goal?.trim()) {
    response.status(400).json({ error: 'goal 不能为空' });
    return;
  }

  const plannerPrompt = `你是 RDK Studio 的任务规划 Agent。你只输出可执行计划 JSON，不要输出任何其它文本。

上下文：
- 设备名称: ${deviceName ?? '未知设备'}
- 设备 IP: ${deviceIp ?? '未知'}
- 用户目标: ${goal}

输出要求：
1) 返回严格 JSON 对象，结构：
{
  "summary": "一句话计划摘要",
  "steps": [
    {
      "title": "步骤名称",
      "intent": "intent id",
      "param": "可选参数",
      "reason": "为什么做这步"
    }
  ],
  "risk": "主要风险",
  "done": "完成判定"
}
2) steps 最少 1 步，最多 5 步。
3) intent 只能是以下之一：flash, terminal, terminal_cmd, file_upload, file_download, vnc, openclaw_start, openclaw_status, openclaw_switch, hardware_check, ros_scan, ros_record_start, ros_record_stop, model_deploy, model_list, example_run, workflow, device_scan, nav, settings, general
4) param 仅在 terminal_cmd / openclaw_switch / nav / file_download 场景填写。下载文件时填写需要下载的具体文件名。
5) 如果用户目标不需要实际操作，使用 general。
6) 不要使用 markdown，不要代码块，只返回 JSON。
7) 当目标涉及“板端 OpenClaw + 软件内能力联动”时，steps 必须同时包含 openclaw_* 与软件能力（如 hardware_check/terminal/model_* 等）步骤。`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    const upstreamResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: plannerPrompt }],
        temperature: 0.2,
        max_tokens: 600,
        enable_thinking: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const payload = (await upstreamResponse.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };

    if (!upstreamResponse.ok) {
      response.status(500).json({ error: payload.error?.message ?? 'Agent 规划失败' });
      return;
    }

    const content = payload.choices?.[0]?.message?.content?.trim() ?? '';
    const cleaned = content
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .trim();

    const parsed = JSON.parse(cleaned) as {
      summary?: string;
      steps?: Array<{ title?: string; intent?: string; param?: string; reason?: string }>;
      risk?: string;
      done?: string;
    };

    const allowed = new Set([
      'flash', 'terminal', 'terminal_cmd', 'file_upload', 'file_download', 'vnc',
      'openclaw_start', 'openclaw_status', 'openclaw_switch', 'hardware_check',
      'ros_scan', 'ros_record_start', 'ros_record_stop', 'model_deploy', 'model_list',
      'example_run', 'workflow', 'device_scan', 'nav', 'settings', 'general',
    ]);

    const steps = (parsed.steps ?? [])
      .slice(0, 5)
      .map((step, idx) => ({
        title: step.title?.trim() || `步骤 ${idx + 1}`,
        intent: allowed.has(step.intent ?? '') ? step.intent! : 'general',
        param: step.param?.trim() || undefined,
        reason: step.reason?.trim() || '按目标自动规划',
      }));

    response.json({
      summary: parsed.summary?.trim() || '已生成执行计划',
      steps: steps.length > 0 ? steps : [{ title: '执行通用分析', intent: 'general', reason: '无法提取可执行动作' }],
      risk: parsed.risk?.trim() || '操作可能受设备在线状态影响',
      done: parsed.done?.trim() || '目标结果在任务反馈中出现',
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      response.status(504).json({ error: 'Agent 规划超时' });
      return;
    }

    response.status(500).json({
      error: error instanceof Error ? `Agent 规划失败: ${error.message}` : 'Agent 规划失败',
    });
  }
});

// ─── Agent Provider Config ───

app.get('/api/agent/config', (_request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  const config = loadProviderConfig();
  const registry = loadProviderRegistry();
  const envApiKeyAvailable = Boolean(String(process.env.OPENAI_API_KEY || '').trim());
  const bootstrapPreset = getBootstrapStudioDefaultPresetMeta();
  const studioDefaultPreset = bootstrapPreset
    ? {
        id: bootstrapPreset.id,
        label: bootstrapPreset.label,
        inRegistry: registry.entries.some((e) => e.id === bootstrapPreset.id),
        isActive: registry.activeId === bootstrapPreset.id,
      }
    : null;
  const models = registry.entries.map((entry) => ({
    id: entry.id,
    label: entry.label,
    provider: entry.provider,
    model: entry.model,
    hasApiKey: !!entry.apiKey,
    baseUrl: entry.baseUrl,
    isActive: entry.id === registry.activeId,
  }));
  if (!config) {
    response.json({
      configured: false,
      models,
      activeModelId: registry.activeId || null,
      envApiKeyAvailable,
      studioDefaultPreset,
    });
    return;
  }
  response.json({
    configured: true,
    provider: config.provider,
    model: config.model,
    hasApiKey: !!config.apiKey,
    baseUrl: config.baseUrl,
    models,
    activeModelId: registry.activeId || null,
    envApiKeyAvailable,
    studioDefaultPreset,
  });
});

app.post('/api/agent/config', (request, response) => {
  const body = (request.body ?? {}) as {
    action?: 'upsert' | 'switch' | 'delete' | 'restore_bootstrap_preset';
    id?: string;
    label?: string;
    provider?: string;
    model?: string;
    apiKey?: string;
    baseUrl?: string;
    setActive?: boolean;
  };

  const action = body.action || 'upsert';
  if (action === 'restore_bootstrap_preset') {
    const result = restoreStudioDefaultPresetFromBootstrap();
    if (!result.ok) {
      response.status(400).json({ error: result.error || '恢复内置模型失败' });
      return;
    }
    const next = loadProviderConfig();
    const reg = loadProviderRegistry();
    const activeEnt = getActiveProviderEntry(reg);
    response.json({
      ok: true,
      active: next && activeEnt
        ? {
            id: activeEnt.id,
            provider: next.provider,
            model: next.model,
            baseUrl: next.baseUrl,
            hasApiKey: Boolean(next.apiKey?.trim() || process.env.OPENAI_API_KEY?.trim()),
          }
        : undefined,
    });
    return;
  }
  if (action === 'switch') {
    const id = String(body.id || '').trim();
    if (!id) {
      response.status(400).json({ error: '缺少模型 ID' });
      return;
    }
    const registry = loadProviderRegistry();
    const entry = registry.entries.find((item) => item.id === id);
    if (!entry) {
      response.status(404).json({ error: '模型不存在' });
      return;
    }
    const effectiveKey = entry.apiKey?.trim() || String(process.env.OPENAI_API_KEY || '').trim();
    if (!effectiveKey) {
      response.status(400).json({ error: '目标模型未配置 API Key，请先编辑并保存或在环境变量中配置 OPENAI_API_KEY' });
      return;
    }
    const ok = switchActiveProviderConfig(id);
    if (!ok) {
      response.status(404).json({ error: '模型不存在' });
      return;
    }
    const next = loadProviderConfig();
    response.json({
      ok: true,
      active: next
        ? {
            id,
            provider: next.provider,
            model: next.model,
            baseUrl: next.baseUrl,
            hasApiKey: Boolean(next.apiKey?.trim() || process.env.OPENAI_API_KEY?.trim()),
          }
        : { id, provider: entry.provider, model: entry.model, baseUrl: entry.baseUrl, hasApiKey: Boolean(effectiveKey) },
    });
    return;
  }

  if (action === 'delete') {
    const id = String(body.id || '').trim();
    if (!id) {
      response.status(400).json({ error: '缺少模型 ID' });
      return;
    }
    const ok = deleteProviderConfigEntry(id);
    if (!ok) {
      response.status(404).json({ error: '模型不存在' });
      return;
    }
    response.json({ ok: true });
    return;
  }

  const provider = String(body.provider || '').trim();
  const model = String(body.model || '').trim();
  if (!provider) {
    response.status(400).json({ error: '缺少 provider' });
    return;
  }
  if (!model) {
    response.status(400).json({ error: '缺少 model' });
    return;
  }

  // 向后兼容：如果请求里不带 action/id，默认更新当前激活模型
  const legacyMode = !body.action;
  const existing = loadProviderConfig();
  const key = typeof body.apiKey === 'string' ? body.apiKey : undefined;
  if (!key?.trim() && !existing?.apiKey) {
    response.status(400).json({ error: '缺少 apiKey' });
    return;
  }

  upsertProviderConfigEntry({
    id: legacyMode ? undefined : body.id,
    label: body.label,
    provider,
    model,
    apiKey: key,
    baseUrl: body.baseUrl,
    setActive: body.setActive ?? true,
  });
  response.json({ ok: true });
});

app.get('/api/agent/config/export', (request, response) => {
  const includeSecrets = String(request.query.includeSecrets || '1') !== '0';
  const registry = loadProviderRegistry();
  const exported = {
    version: 1,
    exportedAt: Date.now(),
    activeId: registry.activeId || null,
    entries: registry.entries.map((entry) => ({
      id: entry.id,
      label: entry.label,
      provider: entry.provider,
      model: entry.model,
      apiKey: includeSecrets ? entry.apiKey : '',
      hasApiKey: !!entry.apiKey,
      baseUrl: entry.baseUrl,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    })),
  };
  response.json({ ok: true, includeSecrets, registry: exported });
});

app.post('/api/agent/config/import', (request, response) => {
  const body = (request.body ?? {}) as {
    registry?: {
      version?: number;
      activeId?: string | null;
      entries?: Array<{
        id?: string;
        label?: string;
        provider?: string;
        model?: string;
        apiKey?: string;
        baseUrl?: string;
        createdAt?: number;
        updatedAt?: number;
      }>;
    };
    setActiveId?: string;
    merge?: boolean;
  };
  const incoming = body.registry;
  if (!incoming || !Array.isArray(incoming.entries)) {
    sendApiError(response, 400, 'INVALID_AGENT_CONFIG_IMPORT', '导入失败：缺少 registry.entries', { retryable: false });
    return;
  }
  const merge = body.merge !== false;
  const current = loadProviderRegistry();
  const now = Date.now();
  const normalizedEntries = incoming.entries
    .map((entry) => {
      const provider = String(entry.provider || '').trim();
      const model = String(entry.model || '').trim();
      if (!provider || !model) return null;
      const id = String(entry.id || '').trim() || `cfg-${Math.random().toString(36).slice(2, 10)}`;
      const label = String(entry.label || '').trim() || `${provider}/${model}`;
      const apiKey = String(entry.apiKey || '').trim();
      const baseUrl = String(entry.baseUrl || '').trim() || undefined;
      const createdAt = Number.isFinite(entry.createdAt) ? Number(entry.createdAt) : now;
      const updatedAt = Number.isFinite(entry.updatedAt) ? Number(entry.updatedAt) : now;
      return { id, label, provider, model, apiKey, baseUrl, createdAt, updatedAt };
    })
    .filter((entry): entry is NonNullable<typeof entry> => !!entry);
  if (normalizedEntries.length === 0) {
    sendApiError(response, 400, 'EMPTY_AGENT_CONFIG_IMPORT', '导入失败：没有有效模型配置', { retryable: false });
    return;
  }
  const byId = new Map<string, ProviderConfigRegistry['entries'][number]>();
  if (merge) {
    for (const entry of current.entries) byId.set(entry.id, entry);
  }
  for (const entry of normalizedEntries) {
    byId.set(entry.id, entry);
  }
  const entries = Array.from(byId.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  const desiredActiveId = String(body.setActiveId || incoming.activeId || '').trim();
  const activeId = entries.some((entry) => entry.id === desiredActiveId)
    ? desiredActiveId
    : (entries[0]?.id || null);
  const nextRegistry: ProviderConfigRegistry = {
    activeId,
    entries,
  };
  saveProviderRegistry(nextRegistry);
  response.json({
    ok: true,
    imported: normalizedEntries.length,
    total: entries.length,
    activeId: nextRegistry.activeId,
    merged: merge,
  });
});

// ─── RDKClaw Core Config ───

app.get('/api/rdkclaw/persona', (_request, response) => {
  response.json({ ok: true, persona: rdkclaw.getPersona() });
});

app.post('/api/rdkclaw/persona', (request, response) => {
  const patch = request.body ?? {};
  const persona = rdkclaw.updatePersona(patch);
  response.json({ ok: true, persona });
});

app.get('/api/rdkclaw/policy', (_request, response) => {
  response.json({ ok: true, policy: rdkclaw.getPolicy() });
});

app.post('/api/rdkclaw/policy', (request, response) => {
  const patch = request.body ?? {};
  response.json({ ok: true, policy: rdkclaw.savePolicy(patch) });
});

app.get('/api/rdkclaw/security-audit', (request, response) => {
  const limitRaw = Number(request.query.limit ?? 30);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 30;
  response.json({ ok: true, items: listSecurityAuditLogs(limit) });
});

app.post('/api/rdkclaw/security-audit/clear', (_request, response) => {
  clearSecurityAuditLogs();
  response.json({ ok: true });
});

app.get('/api/rdkclaw/forum/auth', (_request, response) => {
  response.json({ ok: true, auth: forumAuthStore.getView() });
});

app.post('/api/rdkclaw/forum/auth', async (request, response) => {
  const username = String(request.body?.username || '').trim();
  const password = String(request.body?.password || '').trim();
  if (!username || !password) {
    response.status(400).json({ error: 'username 与 password 为必填项' });
    return;
  }
  forumAuthStore.saveCredentials(username, password);
  const verify = await verifyForumSsoLogin();
  forumAuthStore.markVerified(verify.ok ? 'ok' : 'failed');
  response.json({
    ok: true,
    verified: verify.ok,
    verifyDetail: verify.detail,
    message: verify.ok
      ? '论坛凭据已保存并验证成功'
      : `论坛凭据已保存，但 SSO 验证未通过: ${verify.detail}`,
    auth: forumAuthStore.getView(),
  });
});

app.post('/api/rdkclaw/forum/auth/clear', (_request, response) => {
  forumAuthStore.clear();
  response.json({ ok: true, message: '论坛认证信息已清除' });
});

app.post('/api/rdkclaw/approvals/:approvalId/decision', (request, response) => {
  const decision = String(request.body?.decision || '') as ApprovalDecisionMode;
  if (!decision) {
    response.status(400).json({ error: '缺少 decision' });
    return;
  }
  const ok = rdkclaw.decideApproval(request.params.approvalId, decision);
  if (!ok) {
    response.status(404).json({ error: '审批请求不存在或已结束' });
    return;
  }
  response.json({ ok: true });
});

app.post('/api/rdkclaw/recommendations/:recommendationId/choice', (request, response) => {
  const { recommendationId } = request.params;
  const { choiceId, autoExecute } = request.body as { choiceId?: string; autoExecute?: boolean };
  if (!choiceId) {
    response.status(400).json({ error: '缺少 choiceId' });
    return;
  }
  const ok = rdkclaw.submitRecommendationChoice(recommendationId, String(choiceId), !!autoExecute);
  if (!ok) {
    response.status(404).json({ error: '推荐请求不存在或已结束' });
    return;
  }
  response.json({ ok: true });
});

app.post('/api/rdkclaw/soul-updates/:proposalId/decision', async (request, response) => {
  const { applySoulUpdate, getPendingProposal, removePendingProposal } = await import('./rdkclaw/tools/soul-update.js');
  const { proposalId } = request.params;
  const accepted = Boolean(request.body?.accepted);

  const proposal = getPendingProposal(proposalId);
  if (!proposal) {
    response.status(404).json({ error: '提议不存在或已过期' });
    return;
  }

  if (!accepted) {
    removePendingProposal(proposalId);
    response.json({ ok: true, applied: false });
    return;
  }

  const result = await applySoulUpdate(proposalId);
  if (!result.ok) {
    response.status(500).json({ error: result.error || '写入 SOUL.md 失败' });
    return;
  }
  response.json({ ok: true, applied: true });
});

app.post('/api/rdkclaw/runs/cancel-all', (_request, response) => {
  cancelAllPendingStudioBrowserCaptures('任务已停止');
  const count = rdkclaw.cancelAllRuns();
  const auto = autonomyScheduler.stopAll();
  response.json({
    ok: true,
    cancelled: count,
    cancelledAutonomyRuns: auto.cancelledRuns,
    pausedAutonomyTasks: auto.pausedTasks,
  });
});

app.get('/api/rdkclaw/runs/active', (_request, response) => {
  const ids = rdkclaw.getActiveRunIds();
  response.json({ ok: true, runs: ids });
});

app.post('/api/rdkclaw/runs/:runId/cancel', (request, response) => {
  const ok = rdkclaw.cancelRun(request.params.runId);
  if (!ok) {
    response.status(404).json({ error: '运行不存在或已结束' });
    return;
  }
  response.json({ ok: true });
});

app.post('/api/rdkclaw/session/active', (request, response) => {
  const sessionId = String(request.body?.sessionId || '').trim();
  if (!sessionId) {
    response.status(400).json({ error: '缺少 sessionId' });
    return;
  }
  feishuAuth.setLatestUiSession(sessionId);
  console.log(`[RDKClaw] latest-ui-session updated: ${auditKey(sessionId)}`);
  response.json({ ok: true, sessionId });
});

app.post('/api/rdkclaw/device/active', (request, response) => {
  const deviceId = String(request.body?.deviceId || '').trim();
  if (!deviceId) {
    response.status(400).json({ error: '缺少 deviceId' });
    return;
  }
  feishuAuth.setLatestUiDevice(deviceId);
  console.log(`[RDKClaw] latest-ui-device updated: ${auditKey(deviceId)}`);
  response.json({ ok: true, deviceId });
});

app.post('/api/rdkclaw/feishu/auth/bind', (request, response) => {
  const code = String(request.body?.code || '').trim();
  const studioSessionId = String(request.body?.sessionId || '').trim();
  if (!/^\d{6}$/.test(code)) {
    response.status(400).json({ error: '授权码格式错误，应为 6 位数字' });
    return;
  }
  const result = feishuAuth.bindByCode(code);
  if (!result.ok) {
    response.status(400).json({ ok: false, error: result.reason || '绑定失败' });
    return;
  }
  if (studioSessionId && result.openId) {
    feishuAuth.linkStudioSession(result.openId, studioSessionId);
  }
  response.json({
    ok: true,
    openId: maskOpenId(result.openId || ''),
    message: '飞书账号绑定成功，已与当前 RDK Studio 会话上下文打通。',
  });
});

app.get('/api/rdkclaw/feishu/auth/bound', (_request, response) => {
  const users = feishuAuth.listBound().map((item) => ({
    openId: maskOpenId(item.openId),
    boundAt: item.boundAt,
  }));
  response.json({ ok: true, users, total: users.length });
});

app.get('/api/rdkclaw/feishu/pairing/requests', (_request, response) => {
  const requests = feishuAuth.listPending().map((item) => ({
    openId: maskOpenId(item.openId),
    rawOpenId: item.openId,
    chatId: item.chatId || '',
    code: item.code,
    expireAt: item.expireAt,
    createdAt: item.createdAt,
  }));
  response.json({ ok: true, requests, total: requests.length });
});

app.post('/api/rdkclaw/feishu/pairing/approve', (request, response) => {
  const code = String(request.body?.code || '').trim();
  if (!/^\d{6}$/.test(code)) {
    response.status(400).json({ error: '配对码格式错误，应为 6 位数字' });
    return;
  }
  const result = feishuAuth.approveByCode(code);
  if (!result.ok) {
    response.status(400).json({ ok: false, error: result.reason || '审批失败' });
    return;
  }
  response.json({ ok: true, openId: maskOpenId(result.openId || '') });
});

app.post('/api/rdkclaw/feishu/pairing/reject', (request, response) => {
  const code = String(request.body?.code || '').trim();
  if (!/^\d{6}$/.test(code)) {
    response.status(400).json({ error: '配对码格式错误，应为 6 位数字' });
    return;
  }
  const result = feishuAuth.rejectByCode(code);
  if (!result.ok) {
    response.status(400).json({ ok: false, error: result.reason || '拒绝失败' });
    return;
  }
  response.json({ ok: true });
});

// ─── WeChat ClawBot Channel Routes ───

app.get('/api/rdkclaw/weixin/status', (_request, response) => {
  const status = weixinChannel.getStatus();
  const cfg = weixinConfigStore.getConfig();
  response.json({
    ok: true,
    enabled: cfg.enabled,
    ...status,
  });
});

app.get('/api/rdkclaw/weixin/config', (_request, response) => {
  const cfg = weixinConfigStore.getConfig();
  response.json({ ok: true, config: cfg });
});

app.post('/api/rdkclaw/weixin/config', (request, response) => {
  const body = request.body || {};
  const next = weixinConfigStore.saveConfig(body);
  if (next.enabled && weixinAccountStore.listAccounts().length > 0) {
    weixinChannel.restart();
  } else if (!next.enabled) {
    weixinChannel.stop();
  }
  response.json({ ok: true, config: next });
});

app.get('/api/rdkclaw/weixin/accounts', (_request, response) => {
  const accounts = weixinAccountStore.listAccounts().map((a) => ({
    accountId: a.accountId,
    nickname: a.nickname || '',
    boundAt: a.boundAt,
  }));
  response.json({ ok: true, accounts });
});

app.post('/api/rdkclaw/weixin/accounts', (request, response) => {
  const { accountId, token, nickname } = request.body || {};
  if (!accountId || !token) {
    response.status(400).json({ ok: false, error: '缺少 accountId 或 token' });
    return;
  }
  const account = {
    accountId: String(accountId),
    token: String(token),
    nickname: nickname ? String(nickname) : undefined,
    boundAt: Date.now(),
  };
  weixinAccountStore.addAccount(account);
  weixinChannel.addAccount(account);
  response.json({ ok: true });
});

app.delete('/api/rdkclaw/weixin/accounts/:id', (request, response) => {
  const id = request.params.id;
  const removed = weixinAccountStore.removeAccount(id);
  if (removed) weixinChannel.removeAccount(id);
  response.json({ ok: removed, message: removed ? '已移除' : '账号不存在' });
});

app.post('/api/rdkclaw/weixin/restart', (_request, response) => {
  weixinAccountStore.reload();
  weixinChannel.restart();
  response.json({ ok: true, message: '微信渠道已重启' });
});

app.get('/api/rdkclaw/weixin/login', async (request, response) => {
  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('Cache-Control', 'no-cache');
  response.setHeader('Connection', 'keep-alive');

  let aborted = false;
  request.on('close', () => { aborted = true; });

  const sendSSE = (event: string, data: unknown) => {
    if (aborted) return;
    response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const ILINK_BASE = 'https://ilinkai.weixin.qq.com';
  const BOT_TYPE = '3';
  const QR_POLL_TIMEOUT = 35_000;
  const MAX_WAIT_MS = 5 * 60_000;

  try {
    sendSSE('log', { message: '正在获取二维码...' });
    const qrRes = await fetch(`${ILINK_BASE}/ilink/bot/get_bot_qrcode?bot_type=${BOT_TYPE}`);
    if (!qrRes.ok) {
      sendSSE('error', { message: `获取二维码失败: HTTP ${qrRes.status}` });
      response.end();
      return;
    }
    const qrData = await qrRes.json() as { qrcode?: string; qrcode_img_content?: string };
    if (!qrData.qrcode || !qrData.qrcode_img_content) {
      sendSSE('error', { message: '获取二维码失败: 响应中缺少 qrcode' });
      response.end();
      return;
    }

    const { buf, mime } = await prepareWeChatQrPreviewBuffer({
      qrcode: qrData.qrcode,
      qrcodeImgContent: qrData.qrcode_img_content,
    });
    const previewId = putWeixinQrPreview(buf, mime);
    /** 相对路径：由前端 resolveApiUrl 拼到当前页 / Electron apiBase，避免 Host/HTTPS 与 publicApiBaseUrl 不一致导致 img 404 或非图片响应 */
    const qrPreviewUrl = `/api/rdkclaw/weixin/qr-preview?id=${encodeURIComponent(previewId)}`;
    sendSSE('qrcode', { qrcode: qrPreviewUrl });
    sendSSE('log', { message: '请用微信扫描二维码' });

    const deadline = Date.now() + MAX_WAIT_MS;
    let qrcode = qrData.qrcode;

    while (!aborted && Date.now() < deadline) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), QR_POLL_TIMEOUT + 5_000);
      try {
        const statusRes = await fetch(
          `${ILINK_BASE}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
          { headers: { 'iLink-App-ClientVersion': '1' }, signal: controller.signal },
        );
        clearTimeout(timer);
        if (!statusRes.ok) {
          sendSSE('log', { message: `轮询状态异常: HTTP ${statusRes.status}` });
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        const status = await statusRes.json() as {
          status?: string;
          bot_token?: string;
          ilink_bot_id?: string;
          baseurl?: string;
          ilink_user_id?: string;
        };

        if (status.status === 'scaned') {
          sendSSE('scanned', { message: '已扫码，请在微信中确认' });
        } else if (status.status === 'confirmed' && status.ilink_bot_id) {
          const account = {
            accountId: status.ilink_bot_id,
            token: status.bot_token || '',
            baseUrl: status.baseurl || ILINK_BASE,
            nickname: '',
            boundAt: Date.now(),
          };
          weixinAccountStore.addAccount(account);
          weixinChannel.addAccount(account);
          sendSSE('bound', { accountId: account.accountId, nickname: '' });
          sendSSE('done', { code: 0 });
          response.end();
          return;
        } else if (status.status === 'expired') {
          sendSSE('log', { message: '二维码已过期，正在刷新...' });
          try {
            const refreshRes = await fetch(`${ILINK_BASE}/ilink/bot/get_bot_qrcode?bot_type=${BOT_TYPE}`);
            const refreshData = await refreshRes.json() as { qrcode?: string; qrcode_img_content?: string };
            if (refreshData.qrcode && refreshData.qrcode_img_content) {
              qrcode = refreshData.qrcode;
              const rBuf = await prepareWeChatQrPreviewBuffer({
                qrcode: refreshData.qrcode,
                qrcodeImgContent: refreshData.qrcode_img_content,
              });
              const rId = putWeixinQrPreview(rBuf.buf, rBuf.mime);
              const refreshPreviewUrl = `/api/rdkclaw/weixin/qr-preview?id=${encodeURIComponent(rId)}`;
              sendSSE('qrcode', { qrcode: refreshPreviewUrl });
              sendSSE('log', { message: '新二维码已生成，请重新扫描' });
            } else {
              sendSSE('error', { message: '刷新二维码失败' });
              response.end();
              return;
            }
          } catch (refreshErr: any) {
            sendSSE('error', { message: `刷新二维码失败: ${refreshErr.message || ''}` });
            response.end();
            return;
          }
        }
      } catch (pollErr: any) {
        clearTimeout(timer);
        if (pollErr.name === 'AbortError') continue;
        sendSSE('log', { message: `轮询出错: ${pollErr.message || ''}` });
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    if (!aborted) {
      sendSSE('error', { message: '登录超时，请重试' });
      response.end();
    }
  } catch (err: any) {
    sendSSE('error', { message: err.message || '启动登录流程失败' });
    response.end();
  }
});

app.post('/api/rdkclaw/weixin/bind-start', async (request, response) => {
  const ILINK_BASE = 'https://ilinkai.weixin.qq.com';
  const BOT_TYPE = '3';
  try {
    const qrRes = await fetch(`${ILINK_BASE}/ilink/bot/get_bot_qrcode?bot_type=${BOT_TYPE}`);
    if (!qrRes.ok) {
      response.status(502).json({ ok: false, error: `获取二维码失败: HTTP ${qrRes.status}` });
      return;
    }
    const qrData = await qrRes.json() as { qrcode?: string; qrcode_img_content?: string };
    if (!qrData.qrcode || !qrData.qrcode_img_content) {
      response.status(502).json({ ok: false, error: '获取二维码失败: 响应缺少 qrcode' });
      return;
    }
    const b = await prepareWeChatQrPreviewBuffer({
      qrcode: qrData.qrcode,
      qrcodeImgContent: qrData.qrcode_img_content,
    });
    const bindPreviewId = putWeixinQrPreview(b.buf, b.mime);
    const qrDataUrl = `/api/rdkclaw/weixin/qr-preview?id=${encodeURIComponent(bindPreviewId)}`;
    response.json({ ok: true, qrcode: qrData.qrcode, qrDataUrl });

    const pollForBind = async () => {
      const deadline = Date.now() + 5 * 60_000;
      let currentQr = qrData.qrcode!;
      while (Date.now() < deadline) {
        try {
          const statusRes = await fetch(
            `${ILINK_BASE}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(currentQr)}`,
            { headers: { 'iLink-App-ClientVersion': '1' }, signal: AbortSignal.timeout(40_000) },
          );
          if (!statusRes.ok) { await new Promise(r => setTimeout(r, 2000)); continue; }
          const status = await statusRes.json() as {
            status?: string; bot_token?: string; ilink_bot_id?: string; baseurl?: string;
          };
          if (status.status === 'confirmed' && status.ilink_bot_id) {
            const account = {
              accountId: status.ilink_bot_id,
              token: status.bot_token || '',
              baseUrl: status.baseurl || ILINK_BASE,
              nickname: '',
              boundAt: Date.now(),
            };
            weixinAccountStore.addAccount(account);
            weixinChannel.addAccount(account);
            console.log(`[WeixinBind] background poll: bound ${status.ilink_bot_id}`);
            return;
          }
          if (status.status === 'expired') {
            console.log('[WeixinBind] background poll: qrcode expired, stopping');
            return;
          }
        } catch { await new Promise(r => setTimeout(r, 2000)); }
      }
      console.log('[WeixinBind] background poll: timeout');
    };
    pollForBind().catch(() => {});
  } catch (err: any) {
    response.status(500).json({ ok: false, error: err.message || '启动绑定流程失败' });
  }
});

app.get('/api/rdkclaw/feishu/config', (_request, response) => {
  const cfg = feishuConfigStore.getConfig();
  response.json({
    ok: true,
    config: {
      enabled: cfg.enabled,
      connectionMode: cfg.connectionMode,
      domain: cfg.domain,
      dmPolicy: cfg.dmPolicy,
      syncWithStudio: cfg.syncWithStudio,
      mirrorToStudioChat: cfg.mirrorToStudioChat,
      ackOnReceive: cfg.ackOnReceive,
      ackOnRunning: cfg.ackOnRunning,
      ackStyle: cfg.ackStyle,
      appId: cfg.appId,
      appSecretMasked: maskSecret(cfg.appSecret),
      verificationTokenMasked: maskSecret(cfg.verificationToken),
      encryptKeyMasked: maskSecret(cfg.encryptKey),
      hasAppSecret: !!cfg.appSecret,
      hasVerificationToken: !!cfg.verificationToken,
      hasEncryptKey: !!cfg.encryptKey,
    },
  });
});

app.post('/api/rdkclaw/feishu/config', (request, response) => {
  const body = request.body ?? {};
  const connectionMode = body.connectionMode === 'webhook' || body.connectionMode === 'websocket'
    ? body.connectionMode
    : undefined;
  const domain = body.domain === 'lark' || body.domain === 'feishu'
    ? body.domain
    : undefined;
  const dmPolicy = body.dmPolicy === 'pairing' || body.dmPolicy === 'allowlist' || body.dmPolicy === 'open'
    ? body.dmPolicy
    : undefined;
  const ackStyle = body.ackStyle === 'text' || body.ackStyle === 'emoji' || body.ackStyle === 'off'
    ? body.ackStyle
    : undefined;
  const patch = {
    enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
    connectionMode,
    domain,
    dmPolicy,
    syncWithStudio: typeof body.syncWithStudio === 'boolean' ? body.syncWithStudio : undefined,
    mirrorToStudioChat: typeof body.mirrorToStudioChat === 'boolean' ? body.mirrorToStudioChat : undefined,
    ackOnReceive: typeof body.ackOnReceive === 'boolean' ? body.ackOnReceive : undefined,
    ackOnRunning: typeof body.ackOnRunning === 'boolean' ? body.ackOnRunning : undefined,
    ackStyle,
    appId: typeof body.appId === 'string' ? body.appId : undefined,
    appSecret: typeof body.appSecret === 'string' ? body.appSecret : undefined,
    verificationToken: typeof body.verificationToken === 'string' ? body.verificationToken : undefined,
    encryptKey: typeof body.encryptKey === 'string' ? body.encryptKey : undefined,
  };
  const next = feishuConfigStore.saveConfig(patch);
  syncFeishuRuntime()
    .then(() => {
      response.json({
        ok: true,
        configured: !!(next.appId && next.appSecret),
        hasVerificationToken: !!next.verificationToken,
        hasEncryptKey: !!next.encryptKey,
        connectionMode: next.connectionMode,
        enabled: next.enabled,
      });
    })
    .catch((error) => {
      response.status(500).json({ error: error instanceof Error ? error.message : '飞书配置应用失败' });
    });
});

app.get('/api/rdkclaw/feishu/status', (request, response) => {
  const proto = String(request.headers['x-forwarded-proto'] || request.protocol || 'https');
  const host = String(request.headers['x-forwarded-host'] || request.headers.host || 'your-public-host');
  const webhookPath = '/api/channels/feishu/webhook';
  const cfg = feishuConfigStore.getConfig();
  const hasAppId = !!cfg.appId;
  const hasAppSecret = !!cfg.appSecret;
  const configured = hasAppId && hasAppSecret;
  const latestUi = feishuAuth.getLatestUiMeta();
  response.json({
    ok: true,
    status: {
      configured,
      enabled: cfg.enabled,
      connectionMode: cfg.connectionMode,
      dmPolicy: cfg.dmPolicy,
      domain: cfg.domain,
      syncWithStudio: cfg.syncWithStudio,
      mirrorToStudioChat: cfg.mirrorToStudioChat,
      ackOnReceive: cfg.ackOnReceive,
      ackOnRunning: cfg.ackOnRunning,
      ackStyle: cfg.ackStyle,
      hasAppId,
      hasAppSecret,
      webhookPath,
      webhookUrlTemplate: `${proto}://${host}${webhookPath}`,
      boundUsers: feishuAuth.listBound().length,
      pendingPairings: feishuAuth.listPending().length,
      lastEventAt: feishuLastEventAt,
      lastAuthorizedAt: feishuLastAuthorizedAt,
      dedupCacheSize: feishuEventSeen.size,
      runtime: feishuChannel.getStatus(),
      latestUiSessionId: latestUi.latestUiSessionId || null,
      latestUiDeviceId: latestUi.latestUiDeviceId || null,
      latestUiSessionUpdatedAt: latestUi.latestUiSessionUpdatedAt,
      latestUiDeviceUpdatedAt: latestUi.latestUiDeviceUpdatedAt,
    },
  });
});

app.get('/api/rdkclaw/feishu/runtime', (_request, response) => {
  response.json({ ok: true, runtime: feishuChannel.getStatus() });
});

app.post('/api/rdkclaw/feishu/runtime/start', (_request, response) => {
  syncFeishuRuntime()
    .then(() => response.json({ ok: true, runtime: feishuChannel.getStatus() }))
    .catch((error) => response.status(500).json({ error: error instanceof Error ? error.message : '启动失败' }));
});

app.post('/api/rdkclaw/feishu/runtime/stop', (_request, response) => {
  feishuChannel.stop()
    .then(() => response.json({ ok: true, runtime: feishuChannel.getStatus() }))
    .catch((error) => response.status(500).json({ error: error instanceof Error ? error.message : '停止失败' }));
});

app.post('/api/rdkclaw/feishu/runtime/restart', (_request, response) => {
  syncFeishuRuntime()
    .then(() => response.json({ ok: true, runtime: feishuChannel.getStatus() }))
    .catch((error) => response.status(500).json({ error: error instanceof Error ? error.message : '重启失败' }));
});

app.get('/api/rdkclaw/users/:userId', (request, response) => {
  const user = rdkclaw.getUserProfile(request.params.userId);
  response.json({ ok: true, user });
});

app.post('/api/rdkclaw/users/:userId', (request, response) => {
  const body = request.body ?? {};
  const user = rdkclaw.saveUserProfile({
    userId: request.params.userId,
    preferredExecutor: body.preferredExecutor ?? 'auto',
    preferredLanguage: body.preferredLanguage ?? 'zh-CN',
    notes: body.notes ?? '',
    workspaceProfileId: typeof body.workspaceProfileId === 'string' ? body.workspaceProfileId : undefined,
    workspaceRoot: typeof body.workspaceRoot === 'string' ? body.workspaceRoot : undefined,
  });
  response.json({ ok: true, user });
});

app.get('/api/rdkclaw/skills', (_request, response) => {
  response.setHeader('x-rdk-internal-api', 'true');
  response.json({
    ok: true,
    internalOnly: true,
    message: '内部接口：用于 RDKClaw 调试，不用于技能工坊展示。',
    skills: rdkclaw.listSkills(),
  });
});

app.post('/api/rdkclaw/skills/reload', (_request, response) => {
  response.setHeader('x-rdk-internal-api', 'true');
  response.json({
    ok: true,
    internalOnly: true,
    message: '内部接口：用于 RDKClaw 调试，不用于技能工坊展示。',
    skills: rdkclaw.reloadSkills(),
  });
});

// ─── RDKClaw Autonomy Tasks ───

app.get('/api/rdkclaw/tasks', (_request, response) => {
  response.json({ ok: true, tasks: autonomyScheduler.list() });
});

app.post('/api/rdkclaw/tasks', (request, response) => {
  const {
    name,
    prompt,
    intervalMinutes,
    intervalSeconds,
    cron,
    timezone,
    mode,
    requiresApproval,
    notifyWeixinUserId,
    notifyFeishuChatId,
  } = request.body ?? {};
  if (!name || !prompt || (!intervalMinutes && !intervalSeconds && !cron)) {
    response.status(400).json({ error: 'name、prompt 及 intervalMinutes/intervalSeconds/cron 至少其一为必填项' });
    return;
  }
  const task = autonomyScheduler.create({
    name: String(name),
    prompt: String(prompt),
    intervalMinutes: intervalMinutes ? Number(intervalMinutes) : undefined,
    intervalSeconds: intervalSeconds ? Number(intervalSeconds) : undefined,
    cron: cron ? String(cron) : undefined,
    timezone: timezone ? String(timezone) : undefined,
    mode: (mode || 'board-preferred') as RDKClawExecutionMode,
    requiresApproval: !!requiresApproval,
    notifyWeixinUserId: notifyWeixinUserId ? String(notifyWeixinUserId) : undefined,
    notifyFeishuChatId: notifyFeishuChatId ? String(notifyFeishuChatId) : undefined,
  });
  response.json({ ok: true, task });
});

app.post('/api/rdkclaw/tasks/:id/approve', (request, response) => {
  autonomyScheduler.approve(request.params.id);
  response.json({ ok: true });
});

app.post('/api/rdkclaw/tasks/:id/pause', (request, response) => {
  autonomyScheduler.pause(request.params.id);
  response.json({ ok: true });
});

app.post('/api/rdkclaw/tasks/:id/stop', (request, response) => {
  autonomyScheduler.stop(request.params.id);
  response.json({ ok: true });
});

app.post('/api/rdkclaw/tasks/:id/resume', (request, response) => {
  autonomyScheduler.resume(request.params.id);
  response.json({ ok: true });
});

// ─── Channel Adapter: Feishu (MVP webhook bridge) ───

app.post('/api/channels/feishu/webhook', async (request, response) => {
  const startedAt = Date.now();
  feishuLastEventAt = startedAt;
  try {
    const modeCfg = feishuConfigStore.getConfig();
    if (modeCfg.connectionMode !== 'webhook') {
      response.status(409).json({
        ok: false,
        error: '当前飞书连接模式为 websocket，webhook 仅兼容模式可用',
      });
      return;
    }
    const rawBody = request.body ?? {};
    const cfg = modeCfg;
    const body = (rawBody?.encrypt && cfg.encryptKey)
      ? decodeFeishuEncrypt(String(rawBody.encrypt), cfg.encryptKey)
      : rawBody;
    if (rawBody?.encrypt && !cfg.encryptKey) {
      response.status(400).json({ error: '收到加密事件但未配置 FEISHU_ENCRYPT_KEY' });
      return;
    }
    if (cfg.verificationToken) {
      const incomingToken = String((body as Record<string, unknown>)?.token || '');
      if (!incomingToken || incomingToken !== cfg.verificationToken) {
        response.status(401).json({ error: '飞书 token 校验失败' });
        return;
      }
    }
    const challenge = body.challenge;
    if (challenge) {
      response.json({ challenge });
      return;
    }

    const eventKey = deriveFeishuEventKey(body);
    if (eventKey && markFeishuSeen(eventKey)) {
      response.json({ ok: true, deduped: true });
      return;
    }

    const text = body?.event?.message?.content
      ? (() => {
          try {
            const parsed = JSON.parse(body.event.message.content);
            return parsed.text || '';
          } catch {
            return '';
          }
        })()
      : (body.text ?? '');
    const userId = body?.event?.sender?.sender_id?.open_id
      || body?.userId
      || 'feishu-anonymous';
    const chatId = body?.event?.message?.chat_id;
    if (!text || !String(text).trim()) {
      response.status(400).json({ error: '消息为空' });
      return;
    }

    const openId = String(userId);
    const msgText = String(text).trim();
    if (!feishuAuth.isBound(openId)) {
      const code = feishuAuth.issueCode(openId, chatId);
      const authText = `RDKClaw 需要先绑定身份。\n授权码：${code}\n请在 RDK Studio 聊天框发送：绑定飞书 ${code}\n5 分钟内有效，仅可使用一次。`;
      if (chatId && feishuApi.isConfigured()) {
        await feishuApi.sendTextToChat(String(chatId), authText);
      }
      console.log(`[Feishu] unbound user=${maskOpenId(openId)} event=${eventKey} issued_code`);
      response.json({ ok: true, authorized: false, message: '已发送授权码' });
      return;
    }

    const result = await feishuAdapter.handleInbound({
      userId: openId,
      text: msgText,
      chatId,
    });
    feishuLastAuthorizedAt = Date.now();
    if (chatId && feishuApi.isConfigured()) {
      await feishuApi.sendTextToChat(String(chatId), result.text || 'RDKClaw 已处理完成。');
    }
    console.log(`[Feishu] bound user=${maskOpenId(openId)} event=${eventKey} cost_ms=${Date.now() - startedAt}`);
    response.json({ ok: true, reply: result.text, authorized: true });
  } catch (error) {
    console.error('[Feishu webhook] failed:', error instanceof Error ? error.message : error);
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Feishu webhook 处理失败',
    });
  }
});

// ─── Agent Attachment Upload (for large files like video) ───

app.post('/api/agent/upload-attachment', express.raw({ type: '*/*', limit: '50mb' }), async (request, response) => {
  try {
    const fileName = decodeURIComponent(String(request.headers['x-attachment-name'] || `upload-${Date.now()}`));
    const mimeType = String(request.headers['content-type'] || 'application/octet-stream');
    const sessionId = String(request.headers['x-session-id'] || `upload-${Date.now()}`);
    const fileType = String(request.headers['x-attachment-type'] || 'file') as 'image' | 'file' | 'audio' | 'video';

    const body = request.body as Buffer;
    if (!body || body.length === 0) {
      response.status(400).json({ error: '空文件' });
      return;
    }

    const attachmentDir = path.join(os.homedir(), '.rdkstudio', 'chat-attachments', sessionId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120) || 'default');
    await fs.mkdir(attachmentDir, { recursive: true });
    const safeFileName = `${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100)}`;
    const storedPath = path.join(attachmentDir, safeFileName);
    await fs.writeFile(storedPath, body);

    const attachmentId = `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    response.json({
      ok: true,
      attachment: {
        id: attachmentId,
        type: fileType,
        name: fileName,
        mimeType,
        size: body.length,
        storedPath,
      },
    });
  } catch (error) {
    console.error('[upload-attachment] failed:', error);
    response.status(500).json({ error: error instanceof Error ? error.message : '上传失败' });
  }
});

function parseStudioUiHintsPayload(raw: unknown): StudioUiHints | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.capturedAt !== 'number' || !Number.isFinite(o.capturedAt)) return undefined;
  const ocRaw = o.openclaw;
  const gwRaw = o.gateway;
  const openclaw =
    ocRaw && typeof ocRaw === 'object'
      ? {
          installed: typeof (ocRaw as { installed?: unknown }).installed === 'boolean'
            ? (ocRaw as { installed: boolean }).installed
            : undefined,
          gatewayRunning: typeof (ocRaw as { gatewayRunning?: unknown }).gatewayRunning === 'boolean'
            ? (ocRaw as { gatewayRunning: boolean }).gatewayRunning
            : undefined,
          aiReady: typeof (ocRaw as { aiReady?: unknown }).aiReady === 'boolean'
            ? (ocRaw as { aiReady: boolean }).aiReady
            : undefined,
          version:
            typeof (ocRaw as { version?: unknown }).version === 'string'
              ? (ocRaw as { version: string }).version.slice(0, 120)
              : undefined,
        }
      : undefined;
  const gateway =
    gwRaw && typeof gwRaw === 'object'
      ? {
          running: typeof (gwRaw as { running?: unknown }).running === 'boolean'
            ? (gwRaw as { running: boolean }).running
            : undefined,
          version:
            typeof (gwRaw as { version?: unknown }).version === 'string'
              ? (gwRaw as { version: string }).version.slice(0, 120)
              : undefined,
        }
      : undefined;
  const hints: StudioUiHints = {
    capturedAt: o.capturedAt,
    source: typeof o.source === 'string' ? o.source.slice(0, 64) : undefined,
    openclaw: openclaw && Object.values(openclaw).some((v) => v !== undefined) ? openclaw : undefined,
    gateway: gateway && Object.values(gateway).some((v) => v !== undefined) ? gateway : undefined,
    feishuConnected:
      typeof o.feishuConnected === 'boolean' ? o.feishuConnected : undefined,
  };
  return hints;
}

// ─── Agent Chat (SSE) ───

app.post('/api/agent/chat', async (request, response) => {
  const { message, deviceId, sessionId, userId, mode, attachments, studioUiHints: studioUiHintsRaw } = request.body as {
  message?: string;
  deviceId?: string;
  sessionId?: string;
  userId?: string;
  mode?: RDKClawExecutionMode;
  studioUiHints?: unknown;
  attachments?: Array<{
      id: string;
      type: 'image' | 'file' | 'audio' | 'video';
      name: string;
      mimeType?: string;
      size?: number;
      contentBase64?: string;
      transcript?: string;
      textContent?: string;
      source?: 'studio' | 'feishu';
    }>;
  };

  if (!message?.trim() && (!attachments || attachments.length === 0)) {
    response.status(400).json({ error: '消息或附件不能为空' });
    return;
  }

  // Studio 主聊天链路兜底回写：即使前端心跳偶发失败，也能以实际请求为准更新会话/设备。
  if (sessionId?.trim()) {
    feishuAuth.setLatestUiSession(sessionId.trim());
  }
  if (deviceId?.trim()) {
    feishuAuth.setLatestUiDevice(deviceId.trim());
  }

  try {
    const runId = uuid();
    const requestAbortController = new AbortController();
    let disconnected = false;
    const handleDisconnect = () => {
      if (disconnected) return;
      disconnected = true;
      requestAbortController.abort();
    };

    request.on('close', handleDisconnect);
    request.on('aborted', handleDisconnect);
    response.on('close', handleDisconnect);

    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      /** 禁用 nginx / 部分反向代理对 SSE 的响应缓冲，避免 Token 被攒批后才下发 */
      'X-Accel-Buffering': 'no',
      'X-Run-Id': runId,
      'X-Session-Key': sessionId || '',
    });

    const sendEvent = (event: string, data: unknown) => {
      if (!response.writableEnded) {
        response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      }
    };

    const keepAlive = setInterval(() => {
      if (!response.writableEnded) {
        response.write(': keepalive\n\n');
      }
    }, 15000);

    try {
      const ssoUser = (request as { ssoUser?: SSOUser }).ssoUser;
      const ssoUserName = formatConversationArchiveUserName(ssoUser, userId);
      const studioUiHints = parseStudioUiHintsPayload(studioUiHintsRaw);

      for await (const event of rdkclaw.streamChat({
        message: String(message || '').trim(),
        deviceId,
        sessionId,
        userId,
        ssoUserName,
        mode,
        attachments,
        channel: 'studio',
        trainingDataOptIn: false,
        studioUiHints,
        abortSignal: requestAbortController.signal,
      })) {
        sendEvent(event.type, event.data);
      }
    } finally {
      clearInterval(keepAlive);
      request.off('close', handleDisconnect);
      request.off('aborted', handleDisconnect);
      response.off('close', handleDisconnect);
    }

    response.end();
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Agent 执行失败';
    if (!response.headersSent) {
      response.status(500).json({ error: errorMsg });
    } else {
      response.write(`event: error\ndata: ${JSON.stringify({ error: errorMsg })}\n\n`);
      response.end();
    }
  }
});

// ─── Legacy Chat (kept as fallback) ───

app.post('/api/chat', async (request, response) => {
  if (!apiKey) {
    response.status(500).json({ error: '缺少 OPENAI_API_KEY，请先配置后端环境变量' });
    return;
  }

  const { messages, deviceName, deviceIp } = request.body as {
    messages?: Array<{ role: string; content: string }>;
    deviceName?: string;
    deviceIp?: string;
  };

  if (!messages?.length) {
    response.status(400).json({ error: '消息不能为空' });
    return;
  }

  if (loadedSkills.length === 0) {
    const reloaded = loadAllSkills();
    if (reloaded.length > 0) {
      loadedSkills.push(...reloaded);
      console.log(`[Chat] lazy-loaded ${reloaded.length} skills`);
    }
  }
  const systemPrompt = loadedSkills.length > 0
    ? buildSkillContext(loadedSkills, deviceName, deviceIp)
    : buildSystemPrompt(deviceName, deviceIp);

  try {
    const apiMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.slice(-8).map((m) => ({
        role: m.role === 'ai' ? 'assistant' : m.role,
        content: m.content,
      })),
    ];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);

    const upstreamResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: apiMessages,
        temperature: 0.7,
        max_tokens: 800,
        enable_thinking: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const payload = (await upstreamResponse.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };

    if (!upstreamResponse.ok) {
      response.status(500).json({ error: payload.error?.message ?? '模型调用失败' });
      return;
    }

    const content = payload.choices?.[0]?.message?.content?.trim() ?? '';
    const cleaned = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

    response.json({ reply: cleaned || '收到，请稍候。' });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      response.status(504).json({ error: '模型响应超时' });
      return;
    }
    response.status(500).json({
      error: error instanceof Error ? `模型调用失败: ${error.message}` : '模型调用失败',
    });
  }
});

io.on('connection', (socket) => {
  let sshClient: Client | null = null;
  let sshStream: any = null;
  let openclawChatSession: { abort: () => void } | null = null;

  // OpenClaw Chat Events
  socket.on('openclaw:start', async (config) => {
    const { deviceId } = config;
    try {
      const devices = await readDevices();
      const device = devices.find(d => d.id === deviceId);
      if (!device) {
        socket.emit('openclaw:error', { error: 'Device not found' });
        return;
      }

      const deviceObj = toOpenClawDevice(device);
      
      openClawManager.startInteractiveChat(
        deviceObj,
        (data, err) => {
          if (err) {
            socket.emit('openclaw:error', { error: err });
            return;
          }
          socket.emit('openclaw:ready', { status: 'connected' });
        },
        () => {
          socket.emit('openclaw:disconnected', {});
          openclawChatSession = null;
        },
        `session-${socket.id}`
      );
    } catch (e: any) {
      socket.emit('openclaw:error', { error: e.message });
    }
  });

  socket.on('openclaw:send', async (data) => {
    const { deviceId, message } = data;
    if (!message?.trim()) return;

    try {
      const devices = await readDevices();
      const device = devices.find(d => d.id === deviceId);
      if (!device) {
        socket.emit('openclaw:error', { error: 'Device not found' });
        return;
      }

      const deviceObj = toOpenClawDevice(device);
      let streamed = '';

      openclawChatSession = openClawManager.sendAgentMessage(
        message,
        (chunk) => {
          streamed += chunk;
          socket.emit('openclaw:data', { chunk });
        },
        (success) => {
          recordTokenUsage({
            source: 'openclaw',
            deviceId,
            sessionId: `session-${socket.id}`,
            model: 'openclaw-gateway',
            promptText: String(message || ''),
            completionText: streamed || '',
            success,
            estimated: true,
          });
          if (!success) {
            const raw = (streamed || '').trim();
            let msg = raw || 'OpenClaw 会话执行失败，请检查设备连接、密码或 Gateway 状态';
            if (/__OPENCLAW_HTTP_FAILED__/i.test(raw)) {
              msg = raw
                .replace(/__OPENCLAW_HTTP_FAILED__/gi, '')
                .trim() || `OpenClaw Gateway HTTP 接口不可用，请检查 ${OPENCLAW_GATEWAY_PORT} 端口与网关配置`;
            }
            if (/__OPENCLAW_WS_FAILED__/i.test(raw)) {
              msg = raw
                .replace(/__OPENCLAW_WS_FAILED__/gi, '')
                .trim() || `OpenClaw Gateway WS 调用失败，请检查 ${OPENCLAW_GATEWAY_PORT} 端口、token 与网关权限`;
            }
            if (/plugins\.allow is empty/i.test(raw)) {
              msg = 'OpenClaw 插件安全策略阻止加载本地插件（plugins.allow 为空）。请在 openclaw.json 中显式配置受信任插件 IDs，或移除未受信插件后重试。';
            }
            socket.emit('openclaw:error', { error: msg });
          }
          socket.emit('openclaw:complete', { success });
          openclawChatSession = null;
        },
        `session-${socket.id}`,
        deviceObj
      );
    } catch (e: any) {
      socket.emit('openclaw:error', { error: e.message });
    }
  });

  socket.on('openclaw:stop', async (data) => {
    const { deviceId } = data;
    if (openclawChatSession) {
      openclawChatSession.abort();
      openclawChatSession = null;
    }
    
    try {
      const devices = await readDevices();
      const device = devices.find(d => d.id === deviceId);
      if (device) {
        const deviceObj = toOpenClawDevice(device);
        openClawManager.stopInteractiveChat(`session-${socket.id}`, deviceObj);
      }
    } catch (e: any) {
      // Ignore errors on stop
    }
    
    socket.emit('openclaw:stopped', {});
  });

  socket.on('init', async (config) => {
    const { deviceId, password, cols, rows } = config;
    try {
      const devices = await readDevices();
      const device = devices.find(d => d.id === deviceId);
      if (!device) {
        socket.emit('data', '\r\n\x1b[31m[Error] Device not found.\x1b[0m\r\n');
        return;
      }
      
      const passKey = credentialCacheKey(device.host, device.username, device.port ?? 22);
      const persistedPassword = (device as Device & { password?: string }).password ?? '';
      const pwd =
        password
        || devicePasswordCache.get(passKey)
        || persistedPassword
        || defaultSshPassword;

      sshClient = new Client();
      sshClient.on('ready', () => {
        sshClient!.shell({ term: 'xterm-256color', cols: cols || 80, rows: rows || 24 }, (err, stream) => {
          if (err) {
            socket.emit('data', `\r\n\x1b[31m[Error] Shell error: ${err.message}\x1b[0m\r\n`);
            sshClient?.end();
            return;
          }
          sshStream = stream;
          stream.on('data', (d: any) => socket.emit('data', d.toString('utf-8')));
          stream.on('close', () => {
            socket.emit('data', '\r\n\x1b[33m[Session closed]\x1b[0m\r\n');
            sshClient?.end();
          });
        });
      }).on('error', (err) => {
        socket.emit('data', `\r\n\x1b[31m[SSH Error] ${err.message}\x1b[0m\r\n`);
      }).connect({
        host: device.host,
        port: device.port ?? 22,
        username: device.username,
        password: pwd,
        readyTimeout: 8000,
      });

    } catch (e: any) {
      socket.emit('data', `\r\n\x1b[31m[Internal Error] ${e.message}\x1b[0m\r\n`);
    }
  });

  socket.on('data', (d) => {
    if (sshStream) sshStream.write(d);
  });

  socket.on('resize', ({ cols, rows }) => {
    if (sshStream && sshStream.setWindow) {
      sshStream.setWindow(rows, cols, 0, 0);
    }
  });

  socket.on('disconnect', () => {
    if (openclawChatSession) {
      openclawChatSession.abort();
      openclawChatSession = null;
    }
    sshStream?.end();
    sshClient?.end();
  });
});

async function startServer() {
  await restoreSsoSessionsFromDisk();
  await restoreRuntimeJobsState();
  httpServer.once('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[server] 端口 ${port} 已被占用（EADDRINUSE）。请关闭占用该端口的程序（例如另一份 RDK Studio、或开发环境的 npm run dev），或设置环境变量 PORT 使用其它端口。`,
      );
    } else {
      console.error('[server] httpServer 监听失败:', err.message);
    }
    process.exit(1);
  });
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`RDK Studio server running on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('[server] 启动失败:', err instanceof Error ? err.message : err);
  process.exit(1);
});