import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { prepareWeChatQrPreviewBuffer } from './rdkclaw/ilink-qrcode.js';
import { getWeixinIlinkCommonHeaders } from './rdkclaw/weixin-ilink-headers.js';
import { putWeixinQrPreview, getWeixinQrPreview } from './rdkclaw/weixin-qr-preview.js';
import { v4 as uuid } from 'uuid';
import crypto from 'node:crypto';
import { promises as fs, existsSync } from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import iconv from 'iconv-lite';
import type { ChatMessage, Device, StudioUiHints } from '../shared/types.js';
import {
  readDevices,
  writeDevices,
  serializedWriteDevices,
  invalidateDevicesReadCache,
  resolveDataDir,
} from './storage.js';
import { buildSshPasswordCandidatesForDevice, resolvePrimarySshPassword } from './device-ssh-credentials.js';
import {
  devicePasswordCache,
  credentialCacheKey,
  setDevicePasswordCache,
  deleteDevicePasswordCache,
} from './device-password-cache.js';
import {
  runRemoteCommands,
  verifySshConnection,
  forwardOutRemoteTcp,
  uploadFileSftp,
  SSH_READY_TIMEOUT_MS,
  SSH_KEEPALIVE_INTERVAL_MS,
  SSH_KEEPALIVE_COUNT_MAX,
  SSH_DEFAULT_REMOTE_COMMAND_TIMEOUT_MS,
} from './ssh.js';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import WebSocket, { WebSocketServer } from 'ws';
import * as net from 'net';
import { OpenClawDeploymentManager, sshEndpointKey } from './managers/OpenClawDeploymentManager.js';
import { OPENCLAW_BOARD_NPM_SPEC } from './managers/openclaw-board-install-sh.js';
import { pingVendorModel } from './openclaw-vendor-model-ping.js';
import * as path from 'path';
import { ensureAgentMediaDownloadDir, getLocalFilesServeDirs } from './local-files-roots.js';
import {
  buildBoardDetectionCommand,
  parseBoardDetection,
  getDeviceProfile,
  getResearchSeeds,
} from './board/device-profiles.js';
import type { RdkPlatform } from '../shared/board-types.js';
import { shellEscape, isSafeName } from './utils/shell-escape.js';
import { stripAnsi } from './utils/strip-ansi.js';
import {
  DEFAULT_SSH_PASSWORD,
  DEFAULT_VNC_PORT,
  CODE_SERVER_HTTP_PORT,
  OPENCLAW_GATEWAY_PORT,
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
  switchQuickActiveProviderConfig,
  duplicateProviderEntryForQuickLane,
  applyQuickLaneDefaultIfUnset,
  deleteProviderConfigEntry,
  getBootstrapStudioDefaultPresetsMeta,
  getActiveProviderEntry,
  restoreStudioDefaultPresetFromBootstrap,
  effectiveSamplingTemperature,
  effectiveSamplingTopP,
  type ProviderConfigRegistry,
} from './agent/provider-setup.js';
import { SshTunnelHttpAgent } from './code-server-tunnel-agent.js';
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
import type { ApprovalDecisionMode, RDKClawExecutionMode, StudioResponseMode } from './rdkclaw/types.js';
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
import { describeError } from './agent/provider/errors.js';
import { registerAnalyticsRoutes } from './analytics-routes.js';
import { registerClawhubRoutes } from './clawhub-routes.js';
import { getTokenUsageReport, recordTokenUsage, resetTokenUsage, removeTokenUsageByDevice } from './monitoring/token-usage.js';
import { getDeviceLaneStats, runInDeviceLane } from './device-exec-scheduler.js';
import { handleEnsurePartnerAdvisorySkill } from './rdkclaw/partner-advisory-skill-deploy.js';
import { handleEnsureBoardSkillBundle } from './rdkclaw/board-skill-bundle-deploy.js';
import {
  registerStudioBrowserCaptureSocket,
  submitStudioBrowserCapture,
  cancelStudioBrowserCapture,
  cancelAllPendingStudioBrowserCaptures,
} from './studio-browser-capture.js';
import { registerSocketIoHandlers } from './socket-io-handlers.js';
import { registerFrpRoutes } from './frp-routes.js';

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

/** noVNC websockify：在 openClawManager 初始化后注册（见下方 registerNovncWebsockify） */

const port = Number(process.env.PORT ?? 8787);
/** 与仓库 `config/rdkclaw-provider.defaults.json` 对齐；RDKClaw 主链路以 ~/.rdkstudio/agent-config.json 为准 */
const baseUrl = process.env.OPENAI_BASE_URL ?? 'https://ark.cn-beijing.volces.com/api/coding/v3';
const apiKey = process.env.OPENAI_API_KEY ?? '';
const model = process.env.OPENAI_MODEL ?? 'doubao-seed-2.0-pro';
/** 与 device_connect_ssh / 设备扫描说明一致：未设置环境变量时回退常见出厂口令 */
const defaultSshPassword = process.env.RDK_SSH_PASSWORD?.trim() || 'root';
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
/** 与前端步骤条一致，用于部署日志分段 */
const OPENCLAW_DEPLOY_LOG_DIVIDER = '────────────────────────────────────────────────────────';
const OPENCLAW_DEPLOY_STEP_TITLE: Record<OpenClawDeployStepName, string> = {
  check: '诊断',
  prepare: '依赖',
  install: '安装',
  config: '配置',
};
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
  // Source first available TROS overlay so ros2 CLI is discoverable (not only humble)
  'for _tros_setup in /opt/tros/*/setup.bash; do [ -f "$_tros_setup" ] && . "$_tros_setup" 2>/dev/null && break; done; true',
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

/** noVNC：局域网直连 target=私网:5900；经 frp 时用 deviceId + SSH forwardOut 到板端 127.0.0.1:5900 */
(function registerNovncWebsockify() {
  const NOVNC_PROXY_IDLE_MS = 30 * 60 * 1000;

  function isPrivateIpLocal(ip: string): boolean {
    return /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|localhost$)/.test(ip);
  }

  function pipeNovncStreamToWs(ws: WebSocket, tcp: NodeJS.ReadWriteStream | net.Socket) {
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const clearIdle = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
    };
    const bumpIdle = () => {
      clearIdle();
      idleTimer = setTimeout(() => {
        try {
          ws.close();
        } catch {
          /* noop */
        }
        try {
          (tcp as net.Socket).destroy?.();
        } catch {
          /* noop */
        }
      }, NOVNC_PROXY_IDLE_MS);
    };
    bumpIdle();
    tcp.on('data', (data: Buffer) => {
      bumpIdle();
      if (ws.readyState === ws.OPEN) ws.send(data);
    });
    ws.on('message', (msg: Buffer) => {
      bumpIdle();
      try {
        (tcp as NodeJS.WritableStream).write(msg);
      } catch {
        /* noop */
      }
    });
    tcp.on('close', () => {
      clearIdle();
      ws.close();
    });
    tcp.on('error', () => {
      clearIdle();
      ws.close();
    });
    ws.on('close', () => {
      clearIdle();
      try {
        (tcp as net.Socket).destroy?.();
      } catch {
        /* noop */
      }
    });
    ws.on('error', () => {
      clearIdle();
      try {
        (tcp as net.Socket).destroy?.();
      } catch {
        /* noop */
      }
    });
  }

  async function handleNovncWebSocket(ws: WebSocket, req: http.IncomingMessage) {
    const urlParams = new URLSearchParams(req.url?.split('?')[1] || '');
    const deviceId = urlParams.get('deviceId')?.trim();
    const remotePortRaw = urlParams.get('remotePort') || urlParams.get('rport');
    const remotePort = Number(remotePortRaw || DEFAULT_VNC_PORT) || DEFAULT_VNC_PORT;

    if (deviceId) {
      if (isSSORequired()) {
        const user = getSessionSsoUserFromIncomingMessage(req);
        if (!user) {
          ws.close();
          return;
        }
      }
      let devices: Device[];
      try {
        devices = await readDevices();
      } catch {
        ws.close();
        return;
      }
      const device = devices.find((d) => d.id === deviceId);
      if (!device) {
        ws.close();
        return;
      }
      const pwd = resolvePrimarySshPassword(device, {
        requestHeaderPassword: String(req.headers['x-device-password'] ?? ''),
      });
      const deviceObj = toOpenClawDevice(device, pwd);
      let stream: NodeJS.ReadWriteStream;
      try {
        const client = await openClawManager.getSshClientForDevice(deviceObj);
        stream = await forwardOutRemoteTcp(client, '127.0.0.1', remotePort);
      } catch (e) {
        console.warn('[noVNC] ssh tunnel failed:', e instanceof Error ? e.message : e);
        ws.close();
        return;
      }
      console.log(
        `[noVNC] ssh tunnel → board 127.0.0.1:${remotePort} (ssh ${device.host}:${device.port ?? 22})`,
      );
      pipeNovncStreamToWs(ws, stream);
      return;
    }

    const target = urlParams.get('target');
    if (!target) {
      ws.close();
      return;
    }

    const [host, portStr] = target.split(':');
    const targetPort = Number(portStr || DEFAULT_VNC_PORT);
    if (!isPrivateIpLocal(host) || targetPort < 1 || targetPort > 65535) {
      console.warn(`[noVNC] rejected proxy to non-private target: ${target}`);
      ws.close();
      return;
    }

    const tcpSocket = net.connect(targetPort, host, () => {
      console.log(`[noVNC] proxied to ${host}:${targetPort}`);
    });
    pipeNovncStreamToWs(ws, tcpSocket);
  }

  wss.on('connection', (ws, req) => {
    void handleNovncWebSocket(ws, req).catch((err) => {
      console.warn('[noVNC] handler error:', err instanceof Error ? err.message : err);
      try {
        ws.close();
      } catch {
        /* noop */
      }
    });
  });
})();

/** code-server 代理路径：/api/devices/:id/code-server-proxy/... → 板端 127.0.0.1:CODE_SERVER_HTTP_PORT/... */
const CODE_SERVER_PROXY_PATH = /^\/api\/devices\/([^/]+)\/code-server-proxy(\/.*)?$/;

function matchCodeServerProxyPath(pathname: string): { deviceId: string; remainder: string } | null {
  const m = pathname.match(CODE_SERVER_PROXY_PATH);
  if (!m) return null;
  const remainder = m[2] && m[2].length > 0 ? m[2] : '/';
  return { deviceId: m[1], remainder };
}

function buildRawHttpRequestForCodeServerUpstream(req: http.IncomingMessage, upstreamPath: string): string {
  const ver = req.httpVersion || '1.1';
  const lines: string[] = [`${req.method || 'GET'} ${upstreamPath} HTTP/${ver}`];
  lines.push(`Host: 127.0.0.1:${CODE_SERVER_HTTP_PORT}`);
  for (const key of Object.keys(req.headers)) {
    const low = key.toLowerCase();
    if (low === 'host') continue;
    const val = req.headers[key];
    if (val === undefined) continue;
    if (Array.isArray(val)) {
      for (const v of val) lines.push(`${key}: ${v}`);
    } else {
      lines.push(`${key}: ${val}`);
    }
  }
  return `${lines.join('\r\n')}\r\n\r\n`;
}

/**
 * code-server 依赖 WebSocket；仅 Express pipe HTTP 不够。经 SSH forwardOut 把升级请求与双向数据转到板端。
 */
function registerCodeServerProxyUpgradeHandler() {
  httpServer.prependListener('upgrade', (request, socket, head) => {
    let urlStr = request.url || '';
    try {
      const u = new URL(urlStr, 'http://localhost');
      const matched = matchCodeServerProxyPath(u.pathname);
      if (!matched) return;

      void (async () => {
        try {
          if (isSSORequired()) {
            const user = getSessionSsoUserFromIncomingMessage(request);
            if (!user) {
              socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
              socket.destroy();
              return;
            }
          }
          const devices = await readDevices();
          const device = devices.find((d) => d.id === matched.deviceId);
          if (!device) {
            socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
          }
          const pwd = resolvePrimarySshPassword(device, {
            requestHeaderPassword: String(request.headers['x-device-password'] ?? ''),
          });
          const deviceObj = toOpenClawDevice(device, pwd);
          const client = await openClawManager.getSshClientForDevice(deviceObj);
          const stream = await forwardOutRemoteTcp(client, '127.0.0.1', CODE_SERVER_HTTP_PORT);
          const upstreamPath = `${matched.remainder}${u.search}`;
          const raw = buildRawHttpRequestForCodeServerUpstream(request, upstreamPath);
          const headBuf = head && head.length > 0 ? head : Buffer.alloc(0);
          const cleanup = () => {
            try {
              socket.destroy();
            } catch {
              /* noop */
            }
            try {
              (stream as net.Socket).destroy?.();
            } catch {
              /* noop */
            }
          };
          stream.on('error', (err) => {
            console.warn('[code-server-proxy] upstream stream error:', err instanceof Error ? err.message : err);
            cleanup();
          });
          socket.on('error', cleanup);
          const startDuplex = () => {
            socket.pipe(stream);
            stream.pipe(socket);
          };
          stream.write(raw, (err) => {
            if (err) {
              console.warn('[code-server-proxy] write request failed:', err instanceof Error ? err.message : err);
              cleanup();
              return;
            }
            if (headBuf.length) {
              stream.write(headBuf, (err2) => {
                if (err2) {
                  cleanup();
                  return;
                }
                startDuplex();
              });
            } else {
              startDuplex();
            }
          });
        } catch (e) {
          console.warn('[code-server-proxy] upgrade failed:', e instanceof Error ? e.message : e);
          try {
            socket.write('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
          } catch {
            /* noop */
          }
          socket.destroy();
        }
      })();
    } catch (err) {
      console.warn('[code-server-proxy] upgrade parse failed:', err instanceof Error ? err.message : err);
      try {
        socket.destroy();
      } catch {
        /* noop */
      }
    }
  });
}

registerCodeServerProxyUpgradeHandler();

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
/** 渠道需在「尚无账号」时也 start，否则 started=false 时首次扫码绑定不会启动轮询，RDKClaw 无法通过微信连通 */
if (weixinConfigStore.getConfig().enabled) {
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
  const password = resolvePrimarySshPassword(device, {
    requestHeaderPassword: request.header('x-device-password') ?? '',
  });
  return { password, key };
}

function resolveStoredDevicePassword(device: Device) {
  return resolvePrimarySshPassword(device);
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
    port: device.port ?? 22,
    userName: device.username,
    id: device.id,
    password: password || resolveStoredDevicePassword(device),
  };
}

registerSocketIoHandlers(io, {
  readDevices,
  credentialCacheKey,
  defaultSshPassword,
  devicePasswordCache,
  toOpenClawDevice,
  openClawManager,
});

/** 默认口令候选见 `./ssh.js` 的 sshPasswordCandidates */

function isTransientSshError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    /timed out|timeout|handshake|econnreset|econnrefused|socket closed|connection reset|connect failed|broken pipe|network|epipe/.test(message) ||
    /channel closed|connection lost|disconnect|not connected|write econnreset|write epipe|read econnreset|unexpected packet|no response|ssh_exchange/.test(message) ||
    /connection closed|closed by remote|kex_exchange|mac error|bad packet/.test(message)
  );
}

/** 与 rdk-ssh-helper.execOnDevice 对齐 */
const SSH_DEVICE_LANE_TRANSIENT_RETRIES = 3;
const SSH_DEVICE_LANE_RETRY_DELAY_MS = 1500;
const SSH_AUTH_SHAPED_EXTRA_ATTEMPTS_PER_PASSWORD = 1;

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

registerFrpRoutes(app, {
  sendApiError,
  readDevices,
  writeDevices,
  serializedWriteDevices,
  invalidateDevicesReadCache,
  sanitizeDevice,
});

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
/** 一键部署当前 SSH 步骤的 abort（用于用户取消） */
const deployJobActiveAbort = new Map<string, () => void>();
const openClawDeployUserCancelled = new Set<string>();

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
  const text = stripAnsi(chunk);
  job.output += text;
  if (job.output.length > 250_000) {
    job.output = job.output.slice(job.output.length - 250_000);
  }
  schedulePersistRuntimeJobs();
  deploySseBroadcast(job.id, { type: 'log', text });
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
  invalidateDevicesReadCache();
  const device = await resolveDevice(request, response, id);
  if (!device) {
    return null;
  }

  const candidates = buildSshPasswordCandidatesForDevice(device, {
    requestHeaderPassword: request.header('x-device-password') ?? '',
  });
  if (candidates.length === 0) {
    sendApiError(
      response,
      400,
      'DEVICE_AUTH_REQUIRED',
      '设备密码缺失，请在设备管理中重新连接并填写密码，或通过请求头 X-Device-Password 传入',
      { retryable: false },
    );
    return null;
  }
  const timeoutMs = Math.max(5_000, Number(options?.timeoutMs ?? SSH_DEFAULT_REMOTE_COMMAND_TIMEOUT_MS));
  let lastError: unknown = null;
  const output = await runInDeviceLane(device.id, async () => {
    for (const pwd of candidates) {
      for (let attempt = 0; attempt <= SSH_DEVICE_LANE_TRANSIENT_RETRIES; attempt += 1) {
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
          setDevicePasswordCache(device.host, device.username, device.port ?? 22, pwd);
          return result;
        } catch (error) {
          lastError = error;
          if (isSshAuthError(error)) {
            if (attempt < SSH_AUTH_SHAPED_EXTRA_ATTEMPTS_PER_PASSWORD) {
              await new Promise((r) => setTimeout(r, SSH_DEVICE_LANE_RETRY_DELAY_MS * (attempt + 1)));
              continue;
            }
            break;
          }
          if (attempt < SSH_DEVICE_LANE_TRANSIENT_RETRIES && isTransientSshError(error)) {
            await new Promise((r) => setTimeout(r, SSH_DEVICE_LANE_RETRY_DELAY_MS * (attempt + 1)));
            continue;
          }
          break;
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error('设备命令执行失败');
  }).catch((error) => {
    lastError = error;
    return null;
  });
  if (output !== null) {
    return { device, output };
  }

  if (isSshAuthError(lastError)) {
    sendApiError(
      response,
      401,
      'SSH_AUTH_FAILED',
      'SSH 认证失败（已尝试当前保存的多种口令候选）。请在设备管理中「测试连接」并保存正确密码，或通过请求头 X-Device-Password 传入',
      { retryable: false },
    );
    return null;
  }

  if (isSshTimeoutError(lastError)) {
    sendApiError(
      response,
      504,
      'DEVICE_COMMAND_TIMEOUT',
      lastError instanceof Error
        ? `设备命令执行超时（${lastError.message}）。请检查设备是否在线、网络是否通畅后重试`
        : '设备命令执行超时。请检查设备是否在线、网络是否通畅后重试',
      { retryable: true },
    );
    return null;
  }

  sendApiError(
    response,
    500,
    'DEVICE_COMMAND_FAILED',
    lastError instanceof Error
      ? `设备命令执行失败（${lastError.message}）。如果反复出现，请尝试重启设备或检查 SSH 服务`
      : '设备命令执行失败。如果反复出现，请尝试重启设备或检查 SSH 服务',
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
/**
 * 经 frp 时浏览器无法直连板端 code-server；通过 SSH forwardOut 到 127.0.0.1:CODE_SERVER_HTTP_PORT。
 * 必须挂在 express.json 之前，否则 POST/PUT 等请求体会被解析，无法 pipe 到上游。
 * SSO：本路由在 ssoAuthMiddleware 之前，内部自行校验会话（与 rosbridge 等一致）。
 */
app.use('/api/devices/:deviceId/code-server-proxy', (req, res, next) => {
  void (async () => {
    try {
      const { deviceId } = req.params;
      if (isSSORequired()) {
        const user = getSessionSsoUserFromIncomingMessage(req);
        if (!user) {
          res.status(401).send('unauthorized');
          return;
        }
      }
      const devices = await readDevices();
      const device = devices.find((d) => d.id === deviceId);
      if (!device) {
        res.status(404).send('device not found');
        return;
      }
      const pwd = resolvePrimarySshPassword(device, {
        requestHeaderPassword: String(req.headers['x-device-password'] ?? ''),
      });
      const deviceObj = toOpenClawDevice(device, pwd);
      const agent = new SshTunnelHttpAgent(
        () => openClawManager.getSshClientForDevice(deviceObj),
        CODE_SERVER_HTTP_PORT,
      );
      const targetPath = req.url || '/';
      const proxyReq = http.request(
        {
          hostname: '127.0.0.1',
          port: CODE_SERVER_HTTP_PORT,
          path: targetPath,
          method: req.method,
          headers: {
            ...req.headers,
            host: `127.0.0.1:${CODE_SERVER_HTTP_PORT}`,
          },
          agent,
        },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
          proxyRes.pipe(res);
        },
      );
      proxyReq.on('error', (err) => {
        if (!res.headersSent) {
          res.status(502).send(`code-server proxy: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
      req.pipe(proxyReq);
    } catch (e) {
      next(e);
    }
  })();
});
/** 全局 JSON 不宜过大，避免并发大请求 OOM；大文件请走专用上传路由 */
app.use(express.json({ limit: '10mb' }));

// SSO auth — register routes first (before middleware blocks unauthenticated requests)
registerSSORoutes(app);
registerAnalyticsRoutes(app);
registerClawhubRoutes(app);

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
app.get('/api/local-files/:filename', (req, res) => {
  const filename = path.basename(decodeURIComponent(req.params.filename));
  for (const dir of getLocalFilesServeDirs()) {
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
  invalidateDevicesReadCache();
  const devices = await readDevices();
  const device = devices.find((d) => d.id === deviceId);
  if (!device) return null;
  const candidates = buildSshPasswordCandidatesForDevice(device);
  if (candidates.length === 0) return null;
  const output = await runInDeviceLane(device.id, async () => {
    for (const p of candidates) {
      try {
        const result = await runRemoteCommands(
          { host: device.host, port: device.port ?? 22, username: device.username, password: p },
          commands,
        );
        setDevicePasswordCache(device.host, device.username, device.port ?? 22, p);
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
    message:
      'Studio skills/ 扫描结果；技能工坊「本地清单」与 /md 预览均按 folder（目录名）索引。',
    skills: loadedSkills.map((s) => ({
      /** skills/<folder>/SKILL.md，与 getRawSkillMd、板端 skills 目录一致 */
      folder: path.basename(path.dirname(s.filePath)),
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
  response.json({
    ok: true,
    rdkStudioApi: true,
    /** 仅桌面包嵌入子进程设置，用于 Electron 检测「可安全复用的内置服务」，避免误连 npm run dev */
    packagedDesktop: process.env.RDK_PACKAGED_DESKTOP === '1',
  });
});

/** 全局进行中任务（OpenClaw 一键部署、烧录镜像备份等），供顶栏队列展示 */
function resolveOpenClawDeployActiveStep(
  steps: Record<OpenClawDeployStepName, OpenClawDeployStepState>,
): OpenClawDeployStepName {
  const order: OpenClawDeployStepName[] = ['check', 'prepare', 'install', 'config'];
  for (const key of order) {
    if (steps[key] === 'running') return key;
  }
  for (const key of order) {
    if (steps[key] === 'pending') return key;
  }
  return 'config';
}

app.get('/api/runtime/active-tasks', async (_request, response) => {
  cleanupOpenClawDeployJobs();
  cleanupFlashBackupJobs();
  let devices: Device[] = [];
  try {
    devices = await readDevices();
  } catch {
    devices = [];
  }
  const deviceLabel = (deviceId: string) => {
    const d = devices.find((x) => x.id === deviceId);
    return d ? `${d.username}@${d.host}` : deviceId.slice(0, 8);
  };

  const openclawDeploy = Array.from(openClawDeployJobs.values())
    .filter((j) => j.status === 'running')
    .map((j) => ({
      kind: 'openclaw_deploy' as const,
      id: j.id,
      deviceId: j.deviceId,
      deviceLabel: deviceLabel(j.deviceId),
      step: resolveOpenClawDeployActiveStep(j.steps),
      startedAt: j.startedAt,
    }));

  const flashBackup = Array.from(flashBackupJobs.values())
    .filter((j) => j.status === 'running')
    .map((j) => ({
      kind: 'flash_backup' as const,
      id: j.id,
      deviceId: j.deviceId,
      deviceLabel: deviceLabel(j.deviceId),
      startedAt: j.startedAt,
    }));

  const tasks = [...openclawDeploy, ...flashBackup].sort((a, b) => a.startedAt - b.startedAt);
  response.json({ ok: true, tasks });
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

  const candidates = buildSshPasswordCandidatesForDevice(device, {
    requestHeaderPassword: request.header('x-device-password') ?? '',
  });
  if (candidates.length === 0) {
    sendApiError(
      response,
      400,
      'DEVICE_AUTH_REQUIRED',
      '部署需要设备 SSH 密码：请在设备管理中重新连接并保存，或设置环境变量 RDK_SSH_PASSWORD',
      { retryable: false },
    );
    return;
  }
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

      setDevicePasswordCache(device.host, device.username, device.port ?? 22, pwd);
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
    sendApiError(response, 401, 'SSH_AUTH_FAILED', 'SSH 认证失败，用户名或密码不正确。请在设备管理中确认账号信息后重试', { retryable: false });
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

    let nextDevice: Device & { password?: string };
    await serializedWriteDevices(async () => {
      const devices = await readDevices();
      const now = new Date().toISOString();
      nextDevice = {
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

      await writeDevices(nextDevices);
    });

    setDevicePasswordCache(host, username, normalizedPort, password);
    response.json({ device: sanitizeDevice(nextDevice!) });
  } catch (error) {
    if (isSshTimeoutError(error)) {
      sendApiError(
        response,
        504,
        'SSH_CONNECT_TIMEOUT',
        'SSH 连接超时（握手未完成）：请确认设备已开机、IP/端口正确且网络可达；若本机正在大量写盘（如烧录镜像），请稍后再试。',
        { retryable: true },
      );
      return;
    }
    if (isSshAuthError(error)) {
      sendApiError(response, 401, 'SSH_AUTH_FAILED', 'SSH 认证失败，用户名或密码不正确。请在设备管理中确认账号信息后重试', { retryable: false });
      return;
    }
    sendApiError(response, 500, 'SSH_CONNECT_FAILED', error instanceof Error ? `SSH 连接失败（${error.message}）。请检查设备 IP 和端口是否正确` : 'SSH 连接失败。请检查设备 IP 和端口是否正确', { retryable: true });
  }
});

// ─── TypeC 闪连 API ───
// 安全要点：configure 入口对 interfaceName / pcIp 做格式校验；Windows 网卡名禁止 shell 元字符；
// 实际改 IP 使用 netsh / ifconfig / ip 参数化调用，勿拼接未校验的用户输入。

/** 中文等本地化 Windows 下 netsh/cmd 多为系统 ANSI（GBK）；按 UTF-8 读取会乱码且解析失败 */
function decodeWindowsConsoleBytes(buf: Buffer): string {
  if (buf.length === 0) return '';
  return iconv.decode(buf, 'gbk');
}

function isWindowsNetshInterfaceConnected(state: string): boolean {
  const lc = state.toLowerCase();
  if (lc.includes('disconnected') || lc.includes('disconnecting')) return false;
  if (lc === 'connecting' || lc.startsWith('connecting ')) return false;
  if (/断开|未连接|禁用/i.test(state)) return false;
  return lc.includes('connected') || /已连接/i.test(state);
}

/** 解析 `netsh interface ipv4 show interfaces` 表格行（与系统语言无关：按列拆分） */
function parseNetshIpv4ShowInterfacesLines(raw: string): Array<{ name: string }> {
  const EXCLUDED_WIN_NIC_KEYWORDS = [
    'wlan', 'loopback', 'bluetooth', 'vpn', 'teredo', 'isatap', '6to4', 'wi-fi', 'wi fi',
    '无线', '蓝牙', 'hyper-v', 'vethernet', 'virtualbox', 'vmware',
  ];
  const out: Array<{ name: string }> = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!/^\d/.test(trimmed)) continue;
    const parts = trimmed.split(/\s{2,}/).filter(Boolean);
    if (parts.length < 5) continue;
    const state = parts[3];
    const name = parts.slice(4).join(' ').trim();
    if (!name || !isWindowsNetshInterfaceConnected(state)) continue;
    const low = `${name}\n${state}`.toLowerCase();
    if (EXCLUDED_WIN_NIC_KEYWORDS.some(kw => low.includes(kw))) continue;
    out.push({ name });
  }
  return out;
}

/**
 * 跨平台枚举闪连候选网卡（与 old-studio ConnectionBehaviorEtherList 一致的前缀过滤，
 * 并在 macOS 上进一步排除 Wi-Fi / Thunderbolt 等无关接口）。
 *
 * 必须用系统命令而非 os.networkInterfaces()，因为后者只返回已分配地址的接口，
 * 而 TypeC 虚拟网卡在配置 IP 之前可能还没有地址。
 */

/** macOS: 解析 networksetup -listallhardwareports，返回 { device, port } 映射 */
async function parseMacHardwarePorts(): Promise<Map<string, string>> {
  const raw = await new Promise<string>((resolve, reject) => {
    const child = spawn('sh', ['-c', 'networksetup -listallhardwareports'], { timeout: 5000 });
    let out = '';
    child.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
    child.on('close', (code) => code === 0 ? resolve(out) : reject(new Error(`networksetup exit ${code}`)));
    child.on('error', reject);
  });
  const map = new Map<string, string>();
  let currentPort = '';
  for (const line of raw.split('\n')) {
    const portMatch = line.match(/^Hardware Port:\s*(.+)/);
    if (portMatch) { currentPort = portMatch[1].trim(); continue; }
    const devMatch = line.match(/^Device:\s*(\S+)/);
    if (devMatch && currentPort) { map.set(devMatch[1], currentPort); }
  }
  return map;
}

/** macOS 上需要排除的硬件端口类型关键词 */
const MAC_EXCLUDED_PORT_KEYWORDS = ['wi-fi', 'thunderbolt', 'ethernet adapter'];

async function listTypecCandidateNics(): Promise<Array<{ name: string; portType?: string }>> {
  const platform = os.platform();

  if (platform === 'darwin') {
    // macOS: 用 networksetup 获取硬件端口类型，排除 Wi-Fi / Thunderbolt
    const portMap = await parseMacHardwarePorts();
    const allNics = await new Promise<string>((resolve, reject) => {
      const child = spawn('sh', ['-c', 'ifconfig -l'], { timeout: 5000 });
      let out = '';
      child.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
      child.on('close', (code) => code === 0 ? resolve(out) : reject(new Error(`ifconfig -l exit ${code}`)));
      child.on('error', reject);
    });
    return allNics.trim().split(/\s+/)
      .filter(n => {
        if (!n.startsWith('e')) return false;
        const port = portMap.get(n)?.toLowerCase() ?? '';
        // 排除 Wi-Fi 和 Thunderbolt 相关接口
        return !MAC_EXCLUDED_PORT_KEYWORDS.some(kw => port.includes(kw));
      })
      .sort()
      .reverse()
      .map(name => ({ name, portType: portMap.get(name) }));
  }

  if (platform === 'linux') {
    // Linux: ls /sys/class/net，只保留 'e' 或 'u' 开头
    const raw = await new Promise<string>((resolve, reject) => {
      const child = spawn('sh', ['-c', 'ls /sys/class/net'], { timeout: 5000 });
      let out = '';
      child.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
      child.on('close', (code) => code === 0 ? resolve(out) : reject(new Error(`ls exit ${code}`)));
      child.on('error', reject);
    });
    return raw.trim().split(/\s+/)
      .filter(n => n.startsWith('e') || n.startsWith('u'))
      .sort()
      .reverse()
      .map(name => ({ name }));
  }

  // Windows: netsh 在中文系统上为 GBK 输出，且「已连接」不等同于英文 connected，需按列解析
  const buf = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const child = spawn('cmd', ['/c', 'netsh interface ipv4 show interfaces'], { timeout: 5000 });
    child.stdout?.on('data', (d: Buffer) => { chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)); });
    child.on('close', (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`netsh exit ${code}`))));
    child.on('error', reject);
  });
  const raw = decodeWindowsConsoleBytes(buf);
  return parseNetshIpv4ShowInterfacesLines(raw);
}

function isValidTypecInterfaceName(name: string): boolean {
  return name.length > 0 && name.length <= 32 && /^[a-zA-Z][a-zA-Z0-9._@-]*$/.test(name);
}

function isIpv4DottedQuad(s: string): boolean {
  const parts = s.split('.');
  if (parts.length !== 4) return false;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return false;
    const n = Number(p);
    if (n < 0 || n > 255) return false;
  }
  return true;
}

/** 将点分 IPv4 掩码转为 CIDR 前缀长度（非典型连续掩码时回退 24） */
function ipv4NetmaskPrefixBits(mask: string): number {
  const parts = mask.split('.').map(p => Number(p));
  if (parts.length !== 4 || parts.some(p => Number.isNaN(p) || p < 0 || p > 255)) return 24;
  const v = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  let c = 0;
  for (let i = 31; i >= 0; i--) {
    if ((v >>> i) & 1) c++;
    else break;
  }
  const expected = c === 0 ? 0 : (c === 32 ? 0xffffffff : (0xffffffff << (32 - c)) >>> 0);
  if (v !== expected) return 24;
  return c;
}

function isIfconfigPermissionDenied(msg: string): boolean {
  const m = (msg || '').trim();
  if (!m) return false;
  return (
    /permission denied|operation not permitted|not authorized|must be root|super-user|EPERM/i.test(m)
    // macOS 常见：ifconfig: ioctl (SIOCAIFADDR): Operation not permitted
    || /\bSIOC[A-Z]+\b.*not permitted/i.test(m)
  );
}

async function execFileWithTimeout(
  file: string,
  args: string[],
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { timeout: timeoutMs });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const done = (result: { code: number | null; stdout: string; stderr: string }) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        done({ code: 127, stdout: '', stderr: err.message });
      } else if (!settled) {
        settled = true;
        reject(err);
      }
    });
    child.on('close', (code) => done({ code, stdout, stderr }));
  });
}

/**
 * macOS：`ifconfig up` 需 root。先直接调用 /sbin/ifconfig，若遇 permission denied，
 * 再用 osascript 弹出系统密码框提权（与桌面端常见做法一致）。
 *
 * 与 Windows netsh 逻辑对齐：若 pcIp 已挂在**其它**网卡上（例如先前选过 en9 再改选 en10），
 * 会先从那些接口 `inet <addr> delete`，再在所选接口上设置 IP。否则本机可能把去往 192.168.128.0/24
 * 的流量从未接板子的接口发出，导致 ping / SSH 全失败。
 */
async function configureDarwinTypecNic(
  interfaceName: string,
  pcIp: string,
  mask: string,
): Promise<string> {
  const ifaces = os.networkInterfaces();
  const deleteParts: string[] = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (name === interfaceName) continue;
    if (!addrs?.some(a => a.family === 'IPv4' && a.address === pcIp)) continue;
    deleteParts.push(`/sbin/ifconfig ${name} inet ${pcIp} delete`);
  }
  const setPart = `/sbin/ifconfig ${interfaceName} ${pcIp} netmask ${mask} up`;
  const shellCmd = [...deleteParts, setPart].join('; ');

  const first = await execFileWithTimeout('sh', ['-c', shellCmd], 25000);
  if (first.code === 0) return [first.stdout, first.stderr].filter(Boolean).join('\n').trim();
  // ifconfig 在部分系统/语言环境下把错误打在 stdout，仅用 stderr 会误判为「非权限问题」从而跳过 osascript，用户看不到系统密码框
  const firstCombined = `${first.stderr}\n${first.stdout}`.trim();
  const errLine = firstCombined || `exit code ${first.code}`;
  if (!isIfconfigPermissionDenied(firstCombined)) {
    throw new Error(errLine);
  }
  const escaped = shellCmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const appleScript = `do shell script "${escaped}" with administrator privileges`;
  const second = await execFileWithTimeout('osascript', ['-e', appleScript], 120000);
  if (second.code === 0) return second.stdout;
  const combined = `${second.stderr}\n${second.stdout}`.trim();
  if (/user canceled|用户已取消|-128|错误代码：-128/i.test(combined)) {
    throw new Error('已取消管理员授权，无法为本机网卡设置 IP');
  }
  throw new Error(combined || `osascript exit ${second.code}`);
}

/**
 * Linux 闪连：与 Windows netsh / macOS ifconfig 一致，先从**其它**网卡删除与 pcIp 相同的地址，
 * 避免多接口同 IP 导致去往板子网段的流量走错 dev（ip 命令需与本机 `ifconfig up` 同源权限）。
 */
async function configureLinuxTypecNic(
  interfaceName: string,
  pcIp: string,
  mask: string,
): Promise<string> {
  const cidr = ipv4NetmaskPrefixBits(mask);
  const ifacesNow = os.networkInterfaces();
  const ipBins = ['/sbin/ip', '/usr/sbin/ip'];
  for (const [name, addrs] of Object.entries(ifacesNow)) {
    if (name === interfaceName) continue;
    if (!addrs?.some(a => a.family === 'IPv4' && a.address === pcIp)) continue;
    for (const ipBin of ipBins) {
      const r = await execFileWithTimeout(ipBin, ['addr', 'del', `${pcIp}/${cidr}`, 'dev', name], 12000);
      if (r.code === 0) break;
      if (r.code === 127) continue;
      const combined = `${r.stderr}\n${r.stdout}`.trim();
      if (/cannot assign|no such address|nodev|not found|does not exist/i.test(combined)) break;
      if (isIfconfigPermissionDenied(combined)) {
        throw new Error(
          `${combined} · 需 root 从其它网卡删除冲突 IP，例如：sudo ${ipBin} addr del ${pcIp}/${cidr} dev ${name}`,
        );
      }
      break;
    }
  }

  const bins = ['/sbin/ifconfig', '/usr/sbin/ifconfig'];
  let lastErr = '';
  for (const bin of bins) {
    const r = await execFileWithTimeout(bin, [interfaceName, pcIp, 'netmask', mask, 'up'], 15000);
    if (r.code === 0) return r.stdout;
    lastErr = r.stderr || `exit code ${r.code}`;
    if (r.code === 127) continue;
    if (isIfconfigPermissionDenied(r.stderr)) {
      throw new Error(
        `${lastErr.trim()} · Linux 下需 root 权限，请用 sudo 启动本服务或手动执行：sudo ${bin} ${interfaceName} ${pcIp} netmask ${mask} up`,
      );
    }
    throw new Error(lastErr);
  }
  throw new Error(lastErr || '未找到 ifconfig（/sbin 与 /usr/sbin）');
}

/** 列举本机闪连候选网卡（系统命令枚举 + 平台过滤） */
app.get('/api/typec/interfaces', async (_request, response) => {
  try {
    const nics = await listTypecCandidateNics();
    // 补充 IP 和 MAC 信息（从 os.networkInterfaces 获取，可能为空）
    const osIfaces = os.networkInterfaces();
    const result = nics.map(nic => {
      const addrs = osIfaces[nic.name];
      const ipv4 = addrs?.filter(a => a.family === 'IPv4').map(a => a.address) ?? [];
      const mac = addrs?.find(a => a.mac && a.mac !== '00:00:00:00:00:00')?.mac ?? '';
      return { name: nic.name, mac, addresses: ipv4, portType: nic.portType ?? '' };
    });
    response.json({ ok: true, interfaces: result });
  } catch (error) {
    sendApiError(response, 500, 'INTERFACE_LIST_FAILED', error instanceof Error ? error.message : '获取网卡列表失败');
  }
});

/**
 * 闪连：配置 TypeC 虚拟网卡本机 IP（需管理员 / root）。
 * 三端一致：若 pcIp 已占用在其它接口上，会先删除再写到所选网卡（避免路由走错、ping/SSH 失败）。
 */
app.post('/api/typec/configure', async (request, response) => {
  const { interfaceName, pcIp, netmask } = request.body as {
    interfaceName?: string;
    pcIp?: string;
    netmask?: string;
  };

  if (!interfaceName || !pcIp) {
    sendApiError(response, 400, 'INVALID_PARAMS', '请提供 interfaceName 和 pcIp');
    return;
  }

  const mask = netmask || '255.255.255.0';
  if (!isIpv4DottedQuad(pcIp) || !isIpv4DottedQuad(mask)) {
    sendApiError(response, 400, 'INVALID_PARAMS', 'pcIp / netmask 须为点分 IPv4');
    return;
  }

  const platform = os.platform();
  if (platform === 'win32') {
    // Windows 网卡名可含空格和中文，但不应包含引号、分号等注入字符
    if (!interfaceName || interfaceName.length > 128 || /[";|&<>]/.test(interfaceName)) {
      sendApiError(response, 400, 'INVALID_PARAMS', 'interfaceName 格式非法');
      return;
    }
  } else if (!isValidTypecInterfaceName(interfaceName)) {
    sendApiError(response, 400, 'INVALID_PARAMS', 'interfaceName 格式非法');
    return;
  }

  try {
    let result: string;
    if (platform === 'win32') {
      // Windows: 使用 netsh 配置静态 IP（需要管理员权限）
      //
      // 关键发现（实测）：
      //   1. Windows 不允许同一个 IP 出现在两个接口上，否则报"对象已存在"
      //   2. 如果目标网卡已有静态 IP，set address 也会报"对象已存在"
      //   3. 169.254.x.x (APIPA) 地址是 Windows 自动分配的，delete 后会重新出现
      //
      // 策略：
      //   a. 先检查目标 IP 是否已在目标接口上 → 跳过
      //   b. 检查目标 IP 是否被其他接口占用 → 先从其他接口删除
      //   c. 从目标接口删除旧 IP → set address static
      const spawnNetsh = (args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> =>
        new Promise((resolve, reject) => {
          const child = spawn('netsh', args, { timeout: 15000, windowsHide: true });
          const outChunks: Buffer[] = [];
          const errChunks: Buffer[] = [];
          child.stdout?.on('data', (d: Buffer) => { outChunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)); });
          child.stderr?.on('data', (d: Buffer) => { errChunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)); });
          child.on('close', (code) =>
            resolve({
              code,
              stdout: decodeWindowsConsoleBytes(Buffer.concat(outChunks)),
              stderr: decodeWindowsConsoleBytes(Buffer.concat(errChunks)),
            }));
          child.on('error', reject);
        });

      // (a) 检查目标 IP 是否已在目标接口上
      const allIfaces = os.networkInterfaces();
      const currentAddrs = allIfaces[interfaceName];
      if (currentAddrs?.some(a => a.family === 'IPv4' && a.address === pcIp)) {
        result = `IP ${pcIp} 已配置在 ${interfaceName} 上，无需重复设置`;
      } else {
        // (b) 检查目标 IP 是否被其他接口占用，如果是则先删除
        for (const [otherName, otherAddrs] of Object.entries(allIfaces)) {
          if (otherName === interfaceName) continue;
          if (otherAddrs?.some(a => a.family === 'IPv4' && a.address === pcIp)) {
            await spawnNetsh([
              'interface', 'ipv4', 'delete', 'address', otherName, pcIp,
            ]).catch(() => {});
          }
        }

        // (c) 从目标接口删除旧 IPv4 地址（忽略错误）
        for (const addr of (currentAddrs ?? []).filter(a => a.family === 'IPv4')) {
          await spawnNetsh([
            'interface', 'ipv4', 'delete', 'address', interfaceName, addr.address,
          ]).catch(() => {});
        }

        // 设置新的静态 IP（使用位置参数格式，实测更可靠）
        const setResult = await spawnNetsh([
          'interface', 'ipv4', 'set', 'address', interfaceName, 'static', pcIp, mask,
        ]);
        if (setResult.code === 0) {
          result = setResult.stdout;
        } else {
          throw new Error(setResult.stderr || setResult.stdout || `netsh exit code ${setResult.code}`);
        }
      }
    } else if (platform === 'darwin') {
      result = await configureDarwinTypecNic(interfaceName, pcIp, mask);
    } else {
      result = await configureLinuxTypecNic(interfaceName, pcIp, mask);
    }

    // 轮询验证 IP 是否生效（最多 5 次，每次 500ms）
    let verified = false;
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 500));
      const ifaces = os.networkInterfaces();
      const target = ifaces[interfaceName];
      if (target?.some(a => a.family === 'IPv4' && a.address === pcIp)) {
        verified = true;
        break;
      }
    }

    response.json({ ok: true, verified, output: result });
  } catch (error) {
    sendApiError(
      response,
      500,
      'TYPEC_CONFIGURE_FAILED',
      error instanceof Error ? `网卡配置失败: ${error.message}` : '网卡配置失败',
      { retryable: true },
    );
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
      sendApiError(
        response,
        504,
        'SSH_CONNECT_TIMEOUT',
        'SSH 连接超时（握手未完成）：请确认设备已开机、IP/端口正确且网络可达；若本机正在大量写盘（如烧录镜像），请稍后再试。',
        { retryable: true },
      );
      return;
    }
    if (isSshAuthError(error)) {
      sendApiError(response, 401, 'SSH_AUTH_FAILED', 'SSH 认证失败，用户名或密码不正确。请在设备管理中确认账号信息后重试', { retryable: false });
      return;
    }
    sendApiError(response, 500, 'SSH_CONNECT_FAILED', error instanceof Error ? `SSH 连接失败（${error.message}）。请检查设备 IP 和端口是否正确` : 'SSH 连接失败。请检查设备 IP 和端口是否正确', { retryable: true });
  }
});

const devicePingCache = new Map<string, { status: string; expiresAt: number }>();
/** 仅缓存「不可达」结果，减轻对关机设备的重复 TCP/SSH；成功不缓存，避免关机后仍返回已连接 */
const PING_FAIL_CACHE_TTL_MS = 4000;

/** UI 轮询用：较短握手超时，关机后尽快失败（verifySshConnection 默认 30s 会导致长时间误判在线） */
const PING_SSH_READY_TIMEOUT_MS = 8000;

/**
 * 与 UI「设备在线」一致：须能使用当前可用凭据完成 SSH 认证（verifySshConnection）。
 * 凭据来自 x-device-password 头、内存缓存、持久化设备记录或 RDK_SSH_PASSWORD；皆无时无法探测，视为 offline。
 */
app.get('/api/devices/:id/ping', async (request, response) => {
  const { id } = request.params;
  invalidateDevicesReadCache();
  const device = await resolveDevice(request, response, id);
  if (!device) return;

  const cached = devicePingCache.get(id);
  if (cached && cached.expiresAt > Date.now() && cached.status === 'offline') {
    response.json({ ok: false, status: 'offline' });
    return;
  }

  const candidates = buildSshPasswordCandidatesForDevice(device, {
    requestHeaderPassword: request.header('x-device-password') ?? '',
  });
  if (candidates.length === 0) {
    devicePingCache.set(id, { status: 'offline', expiresAt: Date.now() + PING_FAIL_CACHE_TTL_MS });
    response.json({ ok: false, status: 'offline' });
    return;
  }

  let ok = false;
  for (const pwd of candidates) {
    try {
      await verifySshConnection(
        {
          host: device.host,
          port: device.port ?? 22,
          username: device.username,
          password: pwd,
        },
        { readyTimeoutMs: PING_SSH_READY_TIMEOUT_MS },
      );
      setDevicePasswordCache(device.host, device.username, device.port ?? 22, pwd);
      ok = true;
      break;
    } catch {
      /* try next candidate */
    }
  }
  if (ok) {
    response.json({ ok: true, status: 'connected' });
    return;
  }
  devicePingCache.set(id, { status: 'offline', expiresAt: Date.now() + PING_FAIL_CACHE_TTL_MS });
  response.json({ ok: false, status: 'offline' });
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
  const deviceForCreds: Device = { ...target, username: selectedUsername, port: selectedPort };
  const candidates = buildSshPasswordCandidatesForDevice(deviceForCreds, {
    requestHeaderPassword: request.header('x-device-password') ?? '',
  });
  if (candidates.length === 0) {
    sendApiError(
      response,
      400,
      'DEVICE_AUTH_REQUIRED',
      '设备密码缺失，请在设备管理中重新连接并填写密码，或通过请求头 X-Device-Password 传入',
      { retryable: false },
    );
    return;
  }

  const targetModel = modelName?.trim() || 'doubao-seed-2.0-lite';
  if (!isSafeName(targetModel)) {
    sendApiError(response, 400, 'INVALID_MODEL_NAME', '模型名称不合法', { retryable: false });
    return;
  }
  const safeModel = shellEscape(targetModel);
  const commandMap: Record<'start' | 'status' | 'switch' | 'install' | 'logs', string> = {
    install: `bash -lc '(command -v npm >/dev/null 2>&1 && CI= npm install -g openclaw@${OPENCLAW_BOARD_NPM_SPEC} --no-audit --no-fund) || (curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-onboard || curl -fsSL https://code-server.dev/install.sh | sh || true); (openclaw --version || clawctl --version || echo "openclaw install command finished")'`,
    start: `bash -lc '(openclaw gateway start --port ${OPENCLAW_GATEWAY_PORT} || openclaw start || clawctl start || true); (openclaw status || clawctl status || ps -ef | grep -E "openclaw|claw" | grep -v grep || true)'`,
    status: `bash -lc '(openclaw status || clawctl status || ps -ef | grep -E "openclaw|claw" | grep -v grep || true)'`,
    switch: `bash -lc '(openclaw model use ${safeModel} || clawctl model use ${safeModel} || echo "switch command unavailable"); (openclaw status || clawctl status || true)'`,
    logs: `bash -lc '(journalctl -u openclaw --no-pager -n 120 || tail -n 120 /var/log/openclaw.log || echo "no openclaw logs found")'`,
  };
  let lastError: unknown = null;

  for (const pwd of candidates) {
    for (let attempt = 0; attempt <= SSH_DEVICE_LANE_TRANSIENT_RETRIES; attempt += 1) {
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

        setDevicePasswordCache(target.host, selectedUsername, selectedPort, pwd);

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
        if (isSshAuthError(error)) {
          if (attempt < SSH_AUTH_SHAPED_EXTRA_ATTEMPTS_PER_PASSWORD) {
            await new Promise((r) => setTimeout(r, SSH_DEVICE_LANE_RETRY_DELAY_MS * (attempt + 1)));
            continue;
          }
          break;
        }
        if (attempt < SSH_DEVICE_LANE_TRANSIENT_RETRIES && isTransientSshError(error)) {
          await new Promise((r) => setTimeout(r, SSH_DEVICE_LANE_RETRY_DELAY_MS * (attempt + 1)));
          continue;
        }
        break;
      }
    }
  }

  if (isSshAuthError(lastError)) {
    sendApiError(response, 401, 'SSH_AUTH_FAILED', 'SSH 认证失败，用户名或密码不正确。请在设备管理中确认账号信息后重试', { retryable: false });
    return;
  }
  if (isSshTimeoutError(lastError)) {
    sendApiError(response, 504, 'DEVICE_COMMAND_TIMEOUT', 'OpenClaw 执行超时，设备可能负载较高或网络不稳定，请稍后重试', { retryable: true });
    return;
  }
  sendApiError(
    response,
    500,
    'OPENCLAW_ACTION_FAILED',
    lastError instanceof Error ? `OpenClaw 执行失败（${lastError.message}）` : 'OpenClaw 执行失败',
    { retryable: true },
  );
});

app.delete('/api/devices/:id', async (request, response) => {
  const { id } = request.params;
  try {
    await serializedWriteDevices(async () => {
      const devices = await readDevices();
      const target = devices.find((device) => device.id === id);

      if (!target) {
        if (!response.headersSent) {
          response.status(404).json({ error: '设备不存在' });
        }
        return;
      }

      deleteDevicePasswordCache(target.host, target.username, target.port ?? 22);
      await writeDevices(devices.filter((device) => device.id !== id));
      const cleanup = purgeDeviceSoftwareState(target);
      if (!response.headersSent) {
        response.json({ removedId: id, cleanup });
      }
    });
  } catch (error) {
    if (!response.headersSent) {
      sendApiError(
        response,
        500,
        'DEVICE_PERSIST_FAILED',
        error instanceof Error ? `保存设备列表失败：${error.message}` : '保存设备列表失败',
        { retryable: true },
      );
    }
  }
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
    sendApiError(response, 404, 'DEVICE_NOT_FOUND', '设备不存在或已被移除。请在左侧设备列表中重新添加设备', { retryable: false });
    return;
  }

  const sshPassword = providedPassword || resolveStoredDevicePassword(device);

  if (!sshPassword) {
    sendApiError(response, 400, 'DEVICE_PASSWORD_MISSING', '设备密码缺失。请在左侧设备列表中点击该设备，重新输入 SSH 密码后再试', { retryable: false });
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

    let nextDevice: Device = {
      ...device,
      status: 'connected',
      lastCheckedAt: new Date().toISOString(),
    };

    await serializedWriteDevices(async () => {
      const fresh = await readDevices();
      const still = fresh.find((item) => item.id === id);
      if (!still) return;
      nextDevice = {
        ...still,
        status: 'connected',
        lastCheckedAt: new Date().toISOString(),
      };
      await writeDevices(fresh.map((item) => (item.id === nextDevice.id ? nextDevice : item)));
    });
    response.json({ output, device: sanitizeDevice(nextDevice as Device & { password?: string }) });
  } catch (error) {
    if (isSshAuthError(error)) {
      sendApiError(response, 401, 'SSH_AUTH_FAILED', 'SSH 认证失败，用户名或密码不正确。请在设备管理中确认账号信息后重试', { retryable: false });
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
  invoke: (
    onOutput: (chunk: string) => void,
    onComplete: (success: boolean) => void,
  ) => { abort: () => void },
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    let output = '';
    const handle = invoke(
      (chunk) => {
        output += chunk;
        appendDeployOutput(job, chunk);
      },
      (success) => {
        deployJobActiveAbort.delete(job.id);
        resolve({ ok: success, output });
      },
    );
    deployJobActiveAbort.set(job.id, handle.abort);
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
    appendDeployOutput(
      job,
      `\n${OPENCLAW_DEPLOY_LOG_DIVIDER}\n ${OPENCLAW_DEPLOY_STEP_TITLE[step]}\n${OPENCLAW_DEPLOY_LOG_DIVIDER}\n`,
    );
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
      const diagnostic = await runOpenClawManagerStepForDeploy(job, (onOutput, onComplete) =>
        openClawManager.runCheck(deviceObj, onOutput, onComplete),
      );
      const network = await runOpenClawManagerStepForDeploy(job, (onOutput, onComplete) =>
        openClawManager.runNetworkCheck(deviceObj, onOutput, onComplete),
      );
      return {
        ok: network.ok,
        output: `${diagnostic.output || ''}\n${OPENCLAW_DEPLOY_LOG_DIVIDER}\n · 网络连通性\n${OPENCLAW_DEPLOY_LOG_DIVIDER}\n${network.output || ''}`,
      };
    }, true);
    const deployLongRunHeartbeat = () => {
      const heartbeatMs = 120_000;
      return {
        start: () =>
          setInterval(() => {
            appendDeployOutput(
              job,
              '\n[Studio] 约 2 分钟无新终端输出：apt/下载大包时板端可能长时间不刷行（属常见）。npm 安装已用 --loglevel info，正常应陆续有解析/下载日志；若仍仅有本提示，请检查板端网络与磁盘。超时请在「启动 Studio 后端」的环境变量中增大 OPENCLAW_INSTALL_TIMEOUT_MS（毫秒，默认 1800000≈30 分钟）。\n',
            );
          }, heartbeatMs),
        stop: (h: ReturnType<typeof setInterval>) => clearInterval(h),
      };
    };
    await runStep('prepare', async () => {
      const hb = deployLongRunHeartbeat();
      const t = hb.start();
      try {
        return await runOpenClawManagerStepForDeploy(job, (onOutput, onComplete) =>
          openClawManager.runPrepare(deviceObj, onOutput, onComplete),
        );
      } finally {
        hb.stop(t);
      }
    }, true);
    await runStep('install', async () => {
      const hb = deployLongRunHeartbeat();
      const t = hb.start();
      try {
        return await runOpenClawManagerStepForDeploy(job, (onOutput, onComplete) =>
          openClawManager.runInstall(deviceObj, onOutput, onComplete),
        );
      } finally {
        hb.stop(t);
      }
    }, true);
    await runStep('config', () => runOpenClawManagerStepForDeploy(job, (onOutput, onComplete) =>
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
      ),
    ), true);

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
    job.error = openClawDeployUserCancelled.has(job.id)
      ? '用户已取消部署'
      : (error instanceof Error ? error.message : '部署失败');
    openClawDeployUserCancelled.delete(job.id);
    job.finishedAt = Date.now();
    schedulePersistRuntimeJobs();
    deploySseSendFinalAndClose(job);
  } finally {
    deployJobActiveAbort.delete(job.id);
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
  openClawManager.runInstall(deviceObj, (chunk) => { output += stripAnsi(chunk); }, (success) => {
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
      response.write(`data: ${JSON.stringify({ type: 'log', text: stripAnsi(chunk) })}\n\n`);
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

app.post('/api/devices/:id/openclaw/deploy/cancel', async (request, response) => {
  const { id } = request.params;
  const jobId = String((request.body as { jobId?: string })?.jobId ?? '').trim();
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
  if (job.status !== 'running') {
    sendApiError(response, 400, 'OPENCLAW_DEPLOY_NOT_RUNNING', '任务未在运行中', { retryable: false });
    return;
  }
  const device = await resolveDevice(request, response, id);
  if (!device) return;

  openClawDeployUserCancelled.add(jobId);
  appendDeployOutput(job, '\n[Studio] 用户取消部署：正在中断板端 SSH 会话…\n');
  broadcastDeployJobToSse(job);
  schedulePersistRuntimeJobs();

  const aborter = deployJobActiveAbort.get(jobId);
  if (aborter) {
    try {
      aborter();
    } catch {
      /* ignore */
    }
  }
  const { password: cancelPwd } = resolvePassword(request, device);
  openClawManager.destroyConnection(sshEndpointKey(toOpenClawDevice(device, cancelPwd)));
  response.json({ ok: true });
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

/** 从 Studio 服务端直连厂商 HTTP API（不经板端 Gateway） */
app.post('/api/openclaw/vendor-model-ping', async (request, response) => {
  const body = request.body as {
    baseUrl?: string;
    apiKey?: string;
    modelId?: string;
    api?: string;
  };
  const result = await pingVendorModel(body);
  if (result.ok) {
    response.json({ ok: true, latencyMs: result.latencyMs });
    return;
  }
  response.json({
    ok: false,
    error: result.error,
    detail: result.detail,
    status: result.status,
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
    const fsRows: string[] = [];
    const clawhubRows: string[] = [];
    const plugins: string[] = [];
    let section = '';
    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '===SKILLS===') {
        section = 'skills';
        continue;
      }
      if (trimmed === '===CLAWHUB===') {
        section = 'clawhub';
        continue;
      }
      if (trimmed === '===PLUGINS===') {
        section = 'plugins';
        continue;
      }
      if (!trimmed || trimmed.startsWith('无已安装')) continue;
      if (section === 'skills') {
        fsRows.push(trimmed);
      } else if (section === 'clawhub') {
        if (/no installed skills/i.test(trimmed)) continue;
        const slug = trimmed.split(/\s+/)[0]?.trim() ?? '';
        if (!slug || !/^[\w.-]+$/.test(slug)) continue;
        const rest = trimmed.slice(slug.length).trim();
        const verLabel = rest || 'latest';
        clawhubRows.push(`${slug}|clawhub|ClawHub 已安装 (${verLabel})|`);
      } else if (section === 'plugins') {
        plugins.push(trimmed);
      }
    }
    const seen = new Set<string>();
    const skills: string[] = [];
    /** 目录扫描优先，其次 ClawHub lockfile（去重同名） */
    for (const row of [...fsRows, ...clawhubRows]) {
      const name = row.split('|')[0]?.trim() ?? '';
      if (!name || seen.has(name)) continue;
      seen.add(name);
      skills.push(row);
    }
    const ok = success || skills.length > 0;
    response.json({ ok, skills, plugins, raw: output });
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
    `bash -lc "python3 -c \\"import base64,sys,os,json;raw=base64.b64decode(sys.argv[1]).decode('utf-8','ignore').strip();_b=['/opt/openclaw/skills',os.path.expanduser('~/.openclaw/workspace/skills'),os.path.expanduser('~/skills'),'/root/.openclaw/workspace/skills','/root/skills'];bases=[];[bases.append(x) for x in _b if x not in bases];c=[raw,raw.split()[0] if raw else '',raw.replace('openclaw.','',1), (raw.split()[0] if raw else '').replace('openclaw.','',1)];cand=[];[cand.append(x) for x in c if x and x not in cand];found='';\nfor base in bases:\n  if not os.path.isdir(base):\n    continue\n  paths=[]\n  [paths.extend([f'{base}/{x}/SKILL.md',f'{base}/{x}/skill.md']) for x in cand]\n  for p in paths:\n    if os.path.isfile(p):\n      found=p\n      break\n  if found:\n    break\n  dirs=sorted(os.listdir(base))\n  for x in cand:\n    m=''\n    for d in dirs:\n      if d==x or d.startswith(x):\n        m=d\n        break\n    if m:\n      for p in (f'{base}/{m}/SKILL.md',f'{base}/{m}/skill.md'):\n        if os.path.isfile(p):\n          found=p\n          break\n    if found:\n      break\n  if found:\n    break\ncontent=''\nif found:\n  try:\n    content=open(found,'r',encoding='utf-8',errors='ignore').read()\n  except Exception:\n    content=''\nprint(json.dumps({'ok':bool(found),'path':found,'content':content}, ensure_ascii=False))\\" '${Buffer.from(skillIdRaw).toString('base64')}'"`,
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
 * - ~/.openclaw/workspace/skills、~/skills、/root 下同名路径、/opt/openclaw/skills
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
  const run = await runOnDevice(request, response, id, [
    `bash -lc "out=NOT_FOUND; for d in \\"\\$HOME/.openclaw/workspace/skills/${name}\\" \\"\\$HOME/skills/${name}\\" /root/.openclaw/workspace/skills/${name} /root/skills/${name} /opt/openclaw/skills/${name}; do [ -d \\"\\$d\\" ] && rm -rf \\"\\$d\\" && out=OK; done; echo \\$out"`,
  ]);
  if (!run) return;
  const out = String(run.output || '').trim();
  if (out.endsWith('OK')) {
    response.json({
      ok: true,
      message: `已删除板端技能 ${name}（上述扫描路径中存在的目录均已移除）`,
    });
    return;
  }
  if (out.includes('NOT_FOUND')) {
    sendApiError(
      response,
      404,
      'SKILL_NOT_FOUND_ON_DEVICE',
      '板端未找到该技能目录（已检查 ~/.openclaw/workspace/skills、~/skills、/opt/openclaw/skills 等）。请刷新列表后重试，或在设备上确认路径。',
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

/** 按板型批量同步内置技能（X5→rdkx5_skills 全量；X3/S100/Ultra→文档与指南类 skills） */
app.post('/api/devices/:id/openclaw/ensure-board-skill-bundle', async (request, response) => {
  const { id } = request.params;
  try {
    await handleEnsureBoardSkillBundle(runOnDevice, readDevices, request, response, id);
  } catch (error) {
    if (!response.headersSent) {
      sendApiError(
        response,
        500,
        'ENSURE_BOARD_SKILL_BUNDLE_FAILED',
        error instanceof Error ? error.message : '同步板型技能包失败',
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

/** 板端网关设备信任：`devices approve --latest`（新版）或 `pair --force`（旧版）；非飞书渠道 pairing */
app.post('/api/devices/:id/openclaw/gateway-pair', async (request, response) => {
  const { id } = request.params;
  const { mode } = request.body as { mode?: string };
  const m = mode === 'full' ? 'full' : 'force';
  const device = await resolveDevice(request, response, id);
  if (!device) return;
  const { password } = resolvePassword(request, device);
  const deviceObj = toOpenClawDevice(device, password);
  let output = '';
  openClawManager.runGatewayPair(deviceObj, m, (chunk) => { output += chunk; }, (success) => {
    response.json({ ok: success, output });
  });
});

app.get('/api/devices/:id/openclaw/wifi-list', async (request, response) => {
  const { id } = request.params;
  const device = await resolveDevice(request, response, id);
  if (!device) return;

  const { password } = resolvePassword(request, device);
  const deviceObj = toOpenClawDevice(device, password);
  openClawManager.getWifiList(deviceObj, (wifiNames, success, errorHint) => {
    response.json({ ok: success, wifiNames, ...(errorHint ? { errorHint } : {}) });
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
    await serializedWriteDevices(async () => {
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
    });
    const after = await readDevices();
    const refreshed = after.find((d) => d.id === id);
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
      job.error = '设备命令执行失败，请检查设备连接状态';
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
    job.error = failed ? '设备上未安装 rdk-backup 工具，请先安装后重试' : undefined;
    job.finishedAt = Date.now();
    schedulePersistRuntimeJobs();
  }

  response.json({
    ok: !failed,
    jobId,
    outputPath: outPath,
    output: executed.output,
    error: failed ? '设备上未安装 rdk-backup 工具，请先安装后重试' : undefined,
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
    if (!password) {
      sendApiError(
        response,
        400,
        'DEVICE_AUTH_REQUIRED',
        '设备密码缺失，请在设备管理中重新连接并填写密码，或通过请求头 X-Device-Password 传入',
        { retryable: false },
      );
      return;
    }
    const pwd = password;
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
    } catch (e) {
      response.status(500).json({ error: e instanceof Error ? e.message : '写入失败' });
    }
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
  if (!password) {
    sendApiError(
      response,
      400,
      'DEVICE_AUTH_REQUIRED',
      '设备密码缺失，请在设备管理中重新连接并填写密码，或通过请求头 X-Device-Password 传入',
      { retryable: false },
    );
    return;
  }
  const pwd = password;
  try {
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
  } catch (e) {
    response.status(500).json({
      error: e instanceof Error ? `长传失败: ${e.message}` : '文件上传失败',
    });
  }
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
  const bootstrapPresets = getBootstrapStudioDefaultPresetsMeta();
  const studioDefaultPreset = bootstrapPresets
    ? {
        id: bootstrapPresets.thinking.id,
        label: bootstrapPresets.thinking.label,
        inRegistry: registry.entries.some((e) => e.id === bootstrapPresets.thinking.id),
        isActive: registry.activeId === bootstrapPresets.thinking.id,
      }
    : null;
  const quickBootstrap = bootstrapPresets?.quick ?? null;
  const studioQuickDefaultPreset = quickBootstrap
    ? {
        id: quickBootstrap.id,
        label: quickBootstrap.label,
        inRegistry: registry.entries.some((e) => e.id === quickBootstrap.id),
        isQuickLane: (registry.quickActiveId?.trim() || null) === quickBootstrap.id,
      }
    : null;
  const quickAid = registry.quickActiveId?.trim() || null;
  const models = registry.entries.map((entry) => ({
    id: entry.id,
    label: entry.label,
    provider: entry.provider,
    model: entry.model,
    hasApiKey: !!entry.apiKey,
    baseUrl: entry.baseUrl,
    isActive: entry.id === registry.activeId,
    isQuickLane: Boolean(quickAid && entry.id === quickAid),
    thinkingDefault: entry.thinkingDefault ?? '',
    reasoningVisibility: entry.reasoningVisibility ?? '',
    samplingTemperature: effectiveSamplingTemperature(entry.samplingTemperature),
    samplingTopP: effectiveSamplingTopP(entry.samplingTopP),
  }));
  if (!config) {
    response.json({
      configured: false,
      models,
      activeModelId: registry.activeId || null,
      quickActiveModelId: quickAid,
      envApiKeyAvailable,
      studioDefaultPreset,
      studioQuickDefaultPreset,
    });
    return;
  }
  response.json({
    configured: true,
    provider: config.provider,
    model: config.model,
    hasApiKey: !!config.apiKey,
    baseUrl: config.baseUrl,
    thinkingDefault: config.thinkingDefault ?? '',
    reasoningVisibility: config.reasoningVisibility ?? '',
    samplingTemperature: effectiveSamplingTemperature(config.samplingTemperature),
    samplingTopP: effectiveSamplingTopP(config.samplingTopP),
    models,
    activeModelId: registry.activeId || null,
    quickActiveModelId: quickAid,
    envApiKeyAvailable,
    studioDefaultPreset,
    studioQuickDefaultPreset,
  });
});

/**
 * 本机直连厂商 HTTP，复用 OpenClaw「测试 API」逻辑；Key 可从表单、已保存条目或 OPENAI_API_KEY 解析。
 */
app.post('/api/agent/config/vendor-ping', async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  const body = (request.body ?? {}) as {
    entryId?: string;
    baseUrl?: string;
    model?: string;
    provider?: string;
    apiKey?: string;
  };
  const entryId = typeof body.entryId === 'string' ? body.entryId.trim() : '';
  const registry = loadProviderRegistry();
  const entry = entryId ? registry.entries.find((e) => e.id === entryId) : undefined;

  let baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
  let modelId = typeof body.model === 'string' ? body.model.trim() : '';
  let provider = typeof body.provider === 'string' ? body.provider.trim() : '';
  if (entry) {
    if (!baseUrl) baseUrl = String(entry.baseUrl || '').trim();
    if (!modelId) modelId = String(entry.model || '').trim();
    if (!provider) provider = String(entry.provider || '').trim();
  }

  let apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  if (!apiKey && entry?.apiKey) apiKey = String(entry.apiKey || '').trim();
  if (!apiKey) apiKey = String(process.env.OPENAI_API_KEY || '').trim();

  if (!baseUrl || !modelId) {
    response.json({
      ok: false,
      error: 'MISSING_FIELDS',
      detail: '缺少 Base URL 或模型名称',
    });
    return;
  }
  if (!apiKey) {
    response.json({
      ok: false,
      error: 'MISSING_KEY',
      detail: '缺少 API Key（表单留空且无已保存密钥 / 环境变量）',
    });
    return;
  }

  const api =
    provider === 'anthropic' || provider === 'anthropic-compatible'
      ? 'anthropic-messages'
      : 'openai-completions';

  const result = await pingVendorModel({ baseUrl, apiKey, modelId, api });
  if (result.ok) {
    response.json({ ok: true, latencyMs: result.latencyMs });
    return;
  }
  response.json({
    ok: false,
    error: result.error,
    detail: result.detail,
    status: result.status,
  });
});

app.post('/api/agent/config', (request, response) => {
  const body = (request.body ?? {}) as {
    action?: 'upsert' | 'switch' | 'switch_quick' | 'duplicate_for_quick' | 'delete' | 'restore_bootstrap_preset';
    /** duplicate_for_quick：源条目 id，缺省为当前 active */
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

  if (action === 'switch_quick') {
    const rawId = body.id !== undefined && body.id !== null ? String(body.id).trim() : '';
    let id = rawId;
    const registry = loadProviderRegistry();
    if (!id) {
      const presets = getBootstrapStudioDefaultPresetsMeta();
      const bid = presets?.quick?.id?.trim();
      if (bid && registry.entries.some((e) => e.id === bid)) {
        id = bid;
      } else {
        response.status(400).json({ error: '请选择快速回答模型，或先合并安装包内置预设' });
        return;
      }
    } else {
      const entry = registry.entries.find((item) => item.id === id);
      if (!entry) {
        response.status(404).json({ error: '模型不存在' });
        return;
      }
      const effectiveKey = entry.apiKey?.trim() || String(process.env.OPENAI_API_KEY || '').trim();
      if (!effectiveKey) {
        response.status(400).json({ error: '目标模型未配置 API Key' });
        return;
      }
    }
    if (!switchQuickActiveProviderConfig(id)) {
      response.status(404).json({ error: '快速回答模型设置失败' });
      return;
    }
    const regAfter = loadProviderRegistry();
    response.json({ ok: true, quickActiveModelId: regAfter.quickActiveId?.trim() || id });
    return;
  }

  if (action === 'duplicate_for_quick') {
    const rawSource =
      body.sourceId !== undefined && body.sourceId !== null ? String(body.sourceId).trim() : '';
    const result = duplicateProviderEntryForQuickLane(rawSource || undefined);
    if (!result.ok || !result.newId) {
      response.status(400).json({ error: result.error || '复制快速配置失败' });
      return;
    }
    response.json({ ok: true, quickActiveModelId: result.newId, createdId: result.newId });
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
  const envApiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!key?.trim() && !existing?.apiKey?.trim() && !envApiKey) {
    response.status(400).json({ error: '缺少 apiKey' });
    return;
  }

  const saved = upsertProviderConfigEntry({
    id: legacyMode ? undefined : body.id,
    label: body.label,
    provider,
    model,
    apiKey: key,
    baseUrl: body.baseUrl,
    setActive: body.setActive ?? true,
    ...(body.thinkingDefault !== undefined ? { thinkingDefault: body.thinkingDefault } : {}),
    ...(body.reasoningVisibility !== undefined ? { reasoningVisibility: body.reasoningVisibility } : {}),
    ...(body.samplingTemperature !== undefined ? { samplingTemperature: body.samplingTemperature } : {}),
    ...(body.samplingTopP !== undefined ? { samplingTopP: body.samplingTopP } : {}),
  });
  response.json({ ok: true, savedId: saved.id });
});

app.get('/api/agent/config/export', (request, response) => {
  const includeSecrets = String(request.query.includeSecrets || '1') !== '0';
  const registry = loadProviderRegistry();
  const exported = {
    version: 1,
    exportedAt: Date.now(),
    activeId: registry.activeId || null,
    quickActiveId: registry.quickActiveId ?? null,
    entries: registry.entries.map((entry) => ({
      id: entry.id,
      label: entry.label,
      provider: entry.provider,
      model: entry.model,
      apiKey: includeSecrets ? entry.apiKey : '',
      hasApiKey: !!entry.apiKey,
      baseUrl: entry.baseUrl,
      thinkingDefault: entry.thinkingDefault,
      reasoningVisibility: entry.reasoningVisibility,
      samplingTemperature: entry.samplingTemperature,
      samplingTopP: entry.samplingTopP,
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
      quickActiveId?: string | null;
      entries?: Array<{
        id?: string;
        label?: string;
        provider?: string;
        model?: string;
        apiKey?: string;
        baseUrl?: string;
        thinkingDefault?: string;
        reasoningVisibility?: string;
        samplingTemperature?: string;
        samplingTopP?: string;
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
      const thinkingDefault = String(entry.thinkingDefault || '').trim() || undefined;
      const reasoningVisibility = String(entry.reasoningVisibility || '').trim() || undefined;
      const samplingTemperature = String(entry.samplingTemperature || '').trim() || undefined;
      const samplingTopP = String(entry.samplingTopP || '').trim() || undefined;
      const createdAt = Number.isFinite(entry.createdAt) ? Number(entry.createdAt) : now;
      const updatedAt = Number.isFinite(entry.updatedAt) ? Number(entry.updatedAt) : now;
      return {
        id,
        label,
        provider,
        model,
        apiKey,
        baseUrl,
        ...(thinkingDefault ? { thinkingDefault } : {}),
        ...(reasoningVisibility ? { reasoningVisibility } : {}),
        ...(samplingTemperature ? { samplingTemperature } : {}),
        ...(samplingTopP ? { samplingTopP } : {}),
        createdAt,
        updatedAt,
      };
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
    quickActiveId:
      incoming.quickActiveId !== undefined
        ? typeof incoming.quickActiveId === 'string' && incoming.quickActiveId.trim()
          ? incoming.quickActiveId.trim()
          : null
        : merge
          ? current.quickActiveId ?? null
          : null,
    entries,
  };
  if (nextRegistry.quickActiveId && !entries.some((e) => e.id === nextRegistry.quickActiveId)) {
    nextRegistry.quickActiveId = null;
  }
  const finalizedRegistry = applyQuickLaneDefaultIfUnset(nextRegistry);
  saveProviderRegistry(finalizedRegistry);
  response.json({
    ok: true,
    imported: normalizedEntries.length,
    total: entries.length,
    activeId: finalizedRegistry.activeId,
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

/** Skill 工坊：将 SkillHub 等来源的 SKILL.md 写入本机 RDKClaw 用户工作区 skills/（与对话侧 userId 一致） */
app.post('/api/rdkclaw/local-skill-write', async (request, response) => {
  const { userId, skillId, content } = request.body as { userId?: string; skillId?: string; content?: string };
  try {
    const uid = String(userId || '').trim() || undefined;
    const result = await rdkclaw.writeLocalSkill(uid, String(skillId || '').trim(), String(content || ''));
    rdkclaw.reloadSkills();
    response.json({ ok: true, path: result.path, message: `已写入 ${result.path}` });
  } catch (e) {
    sendApiError(
      response,
      400,
      'LOCAL_SKILL_WRITE_FAILED',
      e instanceof Error ? e.message : '写入失败',
      { retryable: false },
    );
  }
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

/** AI Dock：导出当前会话排查包（zip：Agent JSONL、Dock 快照、可选板端 OpenClaw 日志、安全审计） */
app.post('/api/rdkclaw/export-debug-bundle', async (request, response) => {
  try {
    const body = request.body as {
      sessionId?: string;
      deviceId?: string;
      userId?: string;
      includeBoardLogs?: boolean;
      uiSnapshot?: unknown;
    };
    const sessionId = String(body?.sessionId || '').trim();
    if (!sessionId) {
      response.status(400).json({ error: '缺少 sessionId' });
      return;
    }
    const deviceId = String(body?.deviceId || '').trim() || undefined;
    const userId = String(body?.userId || '').trim() || undefined;
    const includeBoardLogs = body?.includeBoardLogs !== false;
    const buf = await rdkclaw.exportDebugSessionBundle({
      userId,
      sessionId,
      deviceId,
      includeBoardLogs,
      uiSnapshot: body?.uiSnapshot,
    });
    const safeTs = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `rdkclaw-debug-${safeTs}.zip`;
    response.setHeader('Content-Type', 'application/zip');
    response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    response.send(buf);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!response.headersSent) {
      response.status(500).json({ error: msg });
    }
  }
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

/** 与 Cursor / VS Code 等一致：停止为幂等操作；无活跃 run 时仍 200，避免前端误报「失败」 */
app.post('/api/rdkclaw/runs/:runId/cancel', (request, response) => {
  const runId = String(request.params.runId || '').trim();
  const stopped = rdkclaw.cancelRun(runId);
  response.json({ ok: true, alreadyEnded: !stopped });
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
    const qrRes = await fetch(`${ILINK_BASE}/ilink/bot/get_bot_qrcode?bot_type=${BOT_TYPE}`, {
      headers: getWeixinIlinkCommonHeaders(),
    });
    if (!qrRes.ok) {
      sendSSE('weixin_login_fail', { message: `获取二维码失败: HTTP ${qrRes.status}` });
      response.end();
      return;
    }
    const qrData = await qrRes.json() as { qrcode?: string; qrcode_img_content?: string };
    if (!qrData.qrcode?.trim()) {
      sendSSE('weixin_login_fail', { message: '获取二维码失败: 响应中缺少 qrcode' });
      response.end();
      return;
    }

    const { buf, mime } = await prepareWeChatQrPreviewBuffer({
      qrcode: qrData.qrcode,
      qrcodeImgContent: qrData.qrcode_img_content || '',
    });
    const previewId = putWeixinQrPreview(buf, mime);
    /** 相对路径：由前端 resolveApiUrl 拼到当前页 / Electron apiBase，避免 Host/HTTPS 与 publicApiBaseUrl 不一致导致 img 404 或非图片响应 */
    const qrPreviewUrl = `/api/rdkclaw/weixin/qr-preview?id=${encodeURIComponent(previewId)}`;
    sendSSE('qrcode', { qrcode: qrPreviewUrl });
    sendSSE('log', { message: '请用微信扫描二维码' });

    const deadline = Date.now() + MAX_WAIT_MS;
    let qrcode = qrData.qrcode;
    /** 与 @tencent-weixin/openclaw-weixin login-qr.ts 一致：扫码后可能要求切到就近 IDC 节点再轮询 */
    let pollBaseUrl = ILINK_BASE;

    while (!aborted && Date.now() < deadline) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), QR_POLL_TIMEOUT + 5_000);
      try {
        const statusRes = await fetch(
          `${pollBaseUrl}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
          { headers: getWeixinIlinkCommonHeaders(), signal: controller.signal },
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
          redirect_host?: string;
        };

        if (status.status === 'scaned_but_redirect') {
          const host = String(status.redirect_host || '').trim();
          if (host) {
            const hostClean = host.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
            pollBaseUrl = `https://${hostClean}`;
            sendSSE('log', { message: '正在切换至就近节点…' });
          }
          continue;
        }

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
            const refreshRes = await fetch(`${ILINK_BASE}/ilink/bot/get_bot_qrcode?bot_type=${BOT_TYPE}`, {
              headers: getWeixinIlinkCommonHeaders(),
            });
            const refreshData = await refreshRes.json() as { qrcode?: string; qrcode_img_content?: string };
            if (refreshData.qrcode) {
              qrcode = refreshData.qrcode;
              const rBuf = await prepareWeChatQrPreviewBuffer({
                qrcode: refreshData.qrcode,
                qrcodeImgContent: refreshData.qrcode_img_content || '',
              });
              const rId = putWeixinQrPreview(rBuf.buf, rBuf.mime);
              const refreshPreviewUrl = `/api/rdkclaw/weixin/qr-preview?id=${encodeURIComponent(rId)}`;
              sendSSE('qrcode', { qrcode: refreshPreviewUrl });
              sendSSE('log', { message: '新二维码已生成，请重新扫描' });
            } else {
              sendSSE('weixin_login_fail', { message: '刷新二维码失败' });
              response.end();
              return;
            }
          } catch (refreshErr: any) {
            sendSSE('weixin_login_fail', { message: `刷新二维码失败: ${refreshErr.message || ''}` });
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
      sendSSE('weixin_login_fail', { message: '登录超时，请重试' });
      response.end();
    }
  } catch (err: any) {
    sendSSE('weixin_login_fail', { message: err.message || '启动登录流程失败' });
    response.end();
  }
});

app.post('/api/rdkclaw/weixin/bind-start', async (request, response) => {
  const ILINK_BASE = 'https://ilinkai.weixin.qq.com';
  const BOT_TYPE = '3';
  try {
    const qrRes = await fetch(`${ILINK_BASE}/ilink/bot/get_bot_qrcode?bot_type=${BOT_TYPE}`, {
      headers: getWeixinIlinkCommonHeaders(),
    });
    if (!qrRes.ok) {
      response.status(502).json({ ok: false, error: `获取二维码失败: HTTP ${qrRes.status}` });
      return;
    }
    const qrData = await qrRes.json() as { qrcode?: string; qrcode_img_content?: string };
    if (!qrData.qrcode?.trim()) {
      response.status(502).json({ ok: false, error: '获取二维码失败: 响应缺少 qrcode' });
      return;
    }
    const b = await prepareWeChatQrPreviewBuffer({
      qrcode: qrData.qrcode,
      qrcodeImgContent: qrData.qrcode_img_content || '',
    });
    const bindPreviewId = putWeixinQrPreview(b.buf, b.mime);
    const qrDataUrl = `/api/rdkclaw/weixin/qr-preview?id=${encodeURIComponent(bindPreviewId)}`;
    response.json({ ok: true, qrcode: qrData.qrcode, qrDataUrl });

    const pollForBind = async () => {
      const deadline = Date.now() + 5 * 60_000;
      let currentQr = qrData.qrcode!;
      let pollBaseUrl = ILINK_BASE;
      while (Date.now() < deadline) {
        try {
          const statusRes = await fetch(
            `${pollBaseUrl}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(currentQr)}`,
            { headers: getWeixinIlinkCommonHeaders(), signal: AbortSignal.timeout(40_000) },
          );
          if (!statusRes.ok) { await new Promise(r => setTimeout(r, 2000)); continue; }
          const status = await statusRes.json() as {
            status?: string; bot_token?: string; ilink_bot_id?: string; baseurl?: string; redirect_host?: string;
          };
          if (status.status === 'scaned_but_redirect') {
            const host = String(status.redirect_host || '').trim();
            if (host) {
              const hostClean = host.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
              pollBaseUrl = `https://${hostClean}`;
            }
            continue;
          }
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
  const {
    message,
    deviceId,
    sessionId,
    userId,
    mode,
    attachments,
    studioUiHints: studioUiHintsRaw,
    studioResponseMode: studioResponseModeRaw,
    studioRegenerate: studioRegenerateRaw,
  } = request.body as {
  message?: string;
  deviceId?: string;
  sessionId?: string;
  userId?: string;
  mode?: RDKClawExecutionMode;
  studioResponseMode?: string;
    studioUiHints?: unknown;
    studioRegenerate?: boolean;
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

    /**
     * 勿对 POST 的 `request` 监听 `close`：Express 已用 body-parser 读完 JSON 正文后，
     * IncomingMessage 常会视为「请求消息已结束」而触发 `close`，与「客户端断开」无关。
     * 若在此 abort，会在首条 SSE 事件前就掐断 streamChat，前端表现为「无任何有效对话事件」（~100ms 内结束）。
     */
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
      const studioResponseMode: StudioResponseMode | undefined =
        studioResponseModeRaw === 'quick' || studioResponseModeRaw === 'thinking'
          ? studioResponseModeRaw
          : undefined;

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
        studioResponseMode,
        studioRegenerate: Boolean(studioRegenerateRaw),
        abortSignal: requestAbortController.signal,
      })) {
        sendEvent(event.type, event.data);
      }
    } finally {
      clearInterval(keepAlive);
      request.off('aborted', handleDisconnect);
      response.off('close', handleDisconnect);
    }

    response.end();
  } catch (err) {
    const errorMsg = describeError(err) || 'Agent 执行失败';
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

async function startServer() {
  ensureAgentMediaDownloadDir();
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
    const dataDir = resolveDataDir();
    console.log(`[server] 设备数据目录 (RDK_DATA_DIR): ${dataDir}`);
    if (
      typeof process.getuid === 'function' &&
      process.getuid() === 0 &&
      !String(process.env.RDK_DATA_DIR ?? '').trim()
    ) {
      const su = String(process.env.SUDO_USER ?? '').trim();
      if (su) {
        console.log(
          `[server] 检测到 sudo（SUDO_USER=${su}）：设备数据目录已对齐到该用户主目录下的 .rdk-studio/data（与直接登录该用户时使用同一份 devices.json）。`,
        );
      } else {
        console.warn(
          '[server] 当前以 root 运行且未设置 RDK_DATA_DIR、也无 SUDO_USER；设备库在 root 的 ~/.rdk-studio/data。',
          '若曾在普通用户下保存过设备凭据，与当前进程读的不是同一份，可能导致 SSH 反复认证失败。',
          '建议：不使用 sudo 启动；或设置 RDK_DATA_DIR；或使用 `sudo -E` 保留 SUDO_USER 以便自动对齐数据目录。',
        );
      }
    }
  });
}

startServer().catch((err) => {
  console.error('[server] 启动失败:', err instanceof Error ? err.message : err);
  process.exit(1);
});