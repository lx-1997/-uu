import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { v4 as uuid } from 'uuid';
import crypto from 'node:crypto';
import type { ChatMessage, Device } from '../shared/types.js';
import { readDevices, writeDevices } from './storage.js';
import { runRemoteCommands, verifySshConnection, uploadFileSftp } from './ssh.js';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { Client } from 'ssh2';
import { WebSocketServer } from 'ws';
import * as net from 'net';
import { OpenClawDeploymentManager } from './managers/OpenClawDeploymentManager.js';
import * as path from 'path';
import { initEcosystem, createEcosystemRouter } from './ecosystem/index.js';
import { shellEscape, isSafeName } from './utils/shell-escape.js';
import {
  DEFAULT_VNC_PORT, OPENCLAW_GATEWAY_PORT,
  AI_REQUEST_TIMEOUT_MS,
  FLASH_TMP_IMAGE_XZ, FLASH_TMP_IMAGE_RAW, FLASH_DEFAULT_DEST,
  DIAGNOSTIC_COMMANDS, buildSystemPrompt,
} from './constants.js';
import { loadAllSkills, getSkillByName, getRawSkillMd, buildSkillContext, bridgeEcoSkill } from './skill-loader.js';
import { loadProviderConfig, saveProviderConfig, type ProviderConfig } from './agent/provider-setup.js';
import { RDKClawApp } from './rdkclaw/app.js';
import { FeishuChannelAdapter } from './rdkclaw/feishu-channel-adapter.js';
import { FeishuApiClient } from './rdkclaw/feishu-api-client.js';
import { FeishuAuthStore } from './rdkclaw/feishu-auth-store.js';
import { FeishuConfigStore } from './rdkclaw/feishu-config-store.js';
import { FeishuWebSocketChannel } from './agent/channels/feishu.js';
import { AutonomyScheduler } from './rdkclaw/autonomy-scheduler.js';
import { NotificationHub } from './rdkclaw/notification-hub.js';
import type { ApprovalDecisionMode, RDKClawExecutionMode } from './rdkclaw/types.js';

const app = express();
const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: { origin: '*' }
});

const wss = new WebSocketServer({ noServer: true });
httpServer.on('upgrade', (request, socket, head) => {
  if (request.url?.startsWith('/websockify')) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
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
const baseUrl = process.env.OPENAI_BASE_URL ?? 'https://coding.dashscope.aliyuncs.com/v1';
const apiKey = process.env.OPENAI_API_KEY ?? '';
const model = process.env.OPENAI_MODEL ?? 'qwen3.5-plus';
const defaultSshPassword = process.env.RDK_SSH_PASSWORD ?? '';
const devicePasswordCache = new Map<string, string>();
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

const WORKSPACE_HEALTH_SCRIPT = [
  'python_ready=$(command -v python3 >/dev/null 2>&1 && echo 1 || echo 0)',
  'git_ready=$(command -v git >/dev/null 2>&1 && echo 1 || echo 0)',
  'node_ready=$(command -v node >/dev/null 2>&1 && echo 1 || echo 0)',
  'npm_ready=$(command -v npm >/dev/null 2>&1 && echo 1 || echo 0)',
  'code_installed=$(command -v code-server >/dev/null 2>&1 && echo 1 || echo 0)',
  'code_running=$( (ss -lntp 2>/dev/null | grep -q ":13337" || pgrep -af "code-server.*13337" >/dev/null 2>&1) && echo 1 || echo 0 )',
  'vnc_installed=$( (command -v x11vnc >/dev/null 2>&1 || command -v vncserver >/dev/null 2>&1) && echo 1 || echo 0 )',
  'vnc_running=$( (ss -lntp 2>/dev/null | grep -q ":5900" || pgrep -af "x11vnc|Xtigervnc|vncserver" >/dev/null 2>&1) && echo 1 || echo 0 )',
  'ros2_ready=$(command -v ros2 >/dev/null 2>&1 && echo 1 || echo 0)',
  'rosbridge_installed=$(dpkg -l 2>/dev/null | grep -Eq "^ii[[:space:]]+.*rosbridge" && echo 1 || echo 0)',
  'rosbridge_running=$( (ss -lntp 2>/dev/null | grep -q ":9090" || pgrep -af "rosbridge_websocket|rosbridge_server" >/dev/null 2>&1) && echo 1 || echo 0 )',
  'tros_count=$(dpkg -l 2>/dev/null | grep -Ec "^ii[[:space:]]+(tros-|hobot)" || true)',
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
const feishuChannel = new FeishuWebSocketChannel({
  rdkclaw,
  authStore: feishuAuth,
  getConfig: () => feishuConfig,
  notificationHub,
});
const feishuEventSeen = new Map<string, number>();
let feishuLastEventAt: number | null = null;
let feishuLastAuthorizedAt: number | null = null;
const autonomyScheduler = new AutonomyScheduler(rdkclaw, notificationHub);
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
});
autonomyScheduler.start();
syncFeishuRuntime().catch((error) => {
  console.error('[Feishu] websocket 初始化失败:', error instanceof Error ? error.message : error);
});

const credentialCacheKey = (host: string, username: string, port = 22) => `${host}:${port}::${username}`;
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
  return /timed out|timeout|handshake|econnreset|socket closed|connection reset|connect failed/.test(message);
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

  const rosMissing = [
    ros2Ready ? '' : 'ROS2',
    rosbridgeInstalled ? '' : 'rosbridge_server',
  ].filter(Boolean);
  const ros = buildWorkspaceModuleStatus(
    ros2Ready && rosbridgeInstalled && rosbridgeRunning,
    ros2Ready || rosbridgeInstalled,
    !ros2Ready ? 'ROS2 未安装' : !rosbridgeInstalled ? '缺少 rosbridge_server' : rosbridgeRunning ? 'ROS2 与 rosbridge 已就绪' : 'rosbridge 已安装，但当前未运行',
    !ros2Ready || !rosbridgeInstalled ? '前往 ROS 页补齐依赖并启动 rosbridge' : rosbridgeRunning ? '打开 ROS 可视化' : '前往 ROS 页启动 rosbridge',
    rosMissing,
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
) {
  const device = await resolveDevice(request, response, id);
  if (!device) {
    return null;
  }

  const { password, key } = resolvePassword(request, device);
  const candidates = password ? [password] : passwordCandidates(device.username);
  let lastError: unknown = null;

  for (const pwd of candidates) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const output = await runRemoteCommands(
          {
            host: device.host,
            port: device.port ?? 22,
            username: device.username,
            password: pwd,
          },
          commands,
        );

        devicePasswordCache.set(key, pwd);
        return { device, output };
      } catch (error) {
        lastError = error;
        if (!(attempt === 0 && isTransientSshError(error))) {
          break;
        }
      }
    }
  }

  if (!password) {
    response.status(400).json({ error: '设备密码缺失或不正确，请在设备管理中重新连接并填写密码' });
    return null;
  }

  response.status(500).json({
    error: lastError instanceof Error ? `板端命令执行失败: ${lastError.message}` : '板端命令执行失败',
  });
  return null;
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use('/vnc', express.static(process.cwd() + '/public/vnc'));

// ─── Ecosystem Bridge ───
const ecosystem = initEcosystem();

async function ecoRunOnDevice(deviceId: string, commands: string[]): Promise<{ output: string } | null> {
  const devices = await readDevices();
  const device = devices.find((d) => d.id === deviceId);
  if (!device) return null;
  const key = credentialCacheKey(device.host, device.username, device.port ?? 22);
  const pwd = devicePasswordCache.get(key)
    || (device as Device & { password?: string }).password
    || defaultSshPassword
    || device.username;
  const candidates = [pwd, ...passwordCandidates(device.username)];
  for (const p of [...new Set(candidates)]) {
    try {
      const output = await runRemoteCommands(
        { host: device.host, port: device.port ?? 22, username: device.username, password: p },
        commands,
      );
      devicePasswordCache.set(key, p);
      return { output };
    } catch { /* try next */ }
  }
  return null;
}

app.use('/api/ecosystem', createEcosystemRouter(ecosystem, ecoRunOnDevice));

// ─── Skill System ───
const loadedSkills = loadAllSkills();

// Bridge ecosystem skills into the unified skill registry
try {
  const ecoSkills = ecosystem.registry.getAllSkills();
  for (const eco of ecoSkills) {
    const bridged = bridgeEcoSkill(eco as any);
    loadedSkills.push(bridged);
  }
  if (ecoSkills.length > 0) {
    console.log(`[SkillLoader] bridged ${ecoSkills.length} ecosystem skills`);
  }
} catch (e) {
  console.warn('[SkillLoader] ecosystem bridge skipped:', e);
}

app.get('/api/skills', (_request, response) => {
  response.json({
    ok: true,
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
  const skill = getSkillByName(loadedSkills, request.params.name);
  if (!skill) {
    response.status(404).json({ error: `Skill '${request.params.name}' not found` });
    return;
  }
  response.json({ ok: true, skill });
});

app.get('/api/skills/:name/md', (request, response) => {
  const md = getRawSkillMd(request.params.name);
  if (!md) {
    response.status(404).json({ error: `SKILL.md for '${request.params.name}' not found` });
    return;
  }
  response.type('text/markdown').send(md);
});

app.post('/api/skills/reload', (_request, response) => {
  const reloaded = loadAllSkills();
  loadedSkills.length = 0;
  loadedSkills.push(...reloaded);
  response.json({ ok: true, total: loadedSkills.length });
});

app.get('/api/health', (_request, response) => {
  response.json({ ok: true });
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
    response.status(400).json({ error: 'host、username、password 均为必填项' });
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

    devicePasswordCache.set(credentialCacheKey(host, username, normalizedPort), password);

    await writeDevices(nextDevices);
    response.json({ device: sanitizeDevice(nextDevice) });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? `SSH 连接失败: ${error.message}` : 'SSH 连接失败',
    });
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
    response.status(400).json({ error: 'host、username、password 均为必填项' });
    return;
  }

  try {
    await verifySshConnection({ host, port: Number(port ?? 22), username, password });
    response.json({ ok: true });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? `SSH 连接失败: ${error.message}` : 'SSH 连接失败',
    });
  }
});

app.get('/api/devices/:id/ping', async (request, response) => {
  const { id } = request.params;
  const device = await resolveDevice(request, response, id);
  if (!device) return;

  const { password } = resolvePassword(request, device);
  
  try {
    const client = new Client();
    await new Promise<void>((resolve, reject) => {
      client.on('ready', () => { client.end(); resolve(); })
            .on('error', (err) => { client.destroy(); reject(err); })
            .connect({ host: device.host, port: device.port ?? 22, username: device.username, password: password || 'blank', readyTimeout: 3000 });
    });
    response.json({ ok: true, status: 'connected' });
  } catch {
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
    response.status(400).json({ error: 'action 必须是 start/status/switch/install/logs' });
    return;
  }

  const devices = await readDevices();
  const target = host
    ? devices.find((d) => d.host === host && (username ? d.username === username : true))
    : devices[0];

  if (!target) {
    response.status(404).json({ error: '未找到可用设备，请先在设备管理中连接设备' });
    return;
  }

  const selectedUsername = username ?? target.username;
  const selectedPort = target.port ?? 22;
  const passKey = credentialCacheKey(target.host, selectedUsername, selectedPort);
  const cachedPassword = devicePasswordCache.get(passKey);
  const providedPassword = request.header('x-device-password') ?? '';
  const password = providedPassword || cachedPassword || defaultSshPassword;

  const targetModel = modelName?.trim() || 'qwen3.5-plus';
  if (!isSafeName(targetModel)) {
    response.status(400).json({ ok: false, error: 'Invalid model name' });
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
        const output = await runRemoteCommands(
          {
            host: target.host,
            port: selectedPort,
            username: selectedUsername,
            password: pwd,
          },
          [commandMap[action]],
        );

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
    response.status(400).json({ error: '设备密码缺失或不正确，请在设备管理中重新连接并填写密码' });
    return;
  }

  response.status(500).json({
    error: lastError instanceof Error ? `OpenClaw 板端执行失败: ${lastError.message}` : 'OpenClaw 板端执行失败',
  });
});

app.delete('/api/devices/:id', async (request, response) => {
  const { id } = request.params;
  const devices = await readDevices();

  if (!devices.some((device) => device.id === id)) {
    response.status(404).json({ error: '设备不存在' });
    return;
  }

  await writeDevices(devices.filter((device) => device.id !== id));
  response.json({ removedId: id });
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
    response.status(404).json({ error: '设备不存在' });
    return;
  }

  const sshPassword = providedPassword || resolveStoredDevicePassword(device);

  if (!sshPassword) {
    response.status(400).json({ error: '缺少设备密码，请补充当前设备密码后重试' });
    return;
  }

  if (!installCommand && !configureCommand) {
    response.status(400).json({ error: '至少提供一条 OpenClaw 命令' });
    return;
  }

  try {
    const output = await runRemoteCommands(
      {
        host: device.host,
        port: device.port ?? 22,
        username: device.username,
        password: sshPassword,
      },
      [installCommand ?? '', configureCommand ?? ''],
    );

    const nextDevice: Device = {
      ...device,
      status: 'connected',
      lastCheckedAt: new Date().toISOString(),
    };

    await writeDevices(devices.map((item) => (item.id === nextDevice.id ? nextDevice : item)));
    response.json({ output, device: sanitizeDevice(nextDevice as Device & { password?: string }) });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? `OpenClaw 执行失败: ${error.message}` : 'OpenClaw 执行失败',
    });
  }
});

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
    response.status(400).json({ error: 'provider 和 apiKey 为必填项' });
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
    response.status(400).json({ error: '缺少配置数据' });
    return;
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
      response.status(500).json({ error: '读取配置失败' });
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

app.post('/api/devices/:id/openclaw/pairing/list', async (request, response) => {
  const { id } = request.params;
  const { channel } = request.body as { channel?: string };
  const pairingChannel = String(channel || 'feishu').trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(pairingChannel)) {
    response.status(400).json({ error: 'channel 格式非法' });
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
    response.status(400).json({ error: 'channel 格式非法' });
    return;
  }
  if (!/^[A-Za-z0-9]{4,16}$/.test(pairingCode)) {
    response.status(400).json({ error: 'code 格式非法（4-16 位字母数字）' });
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
    response.status(400).json({ error: 'channel 格式非法' });
    return;
  }
  if (!/^[A-Za-z0-9]{4,16}$/.test(pairingCode)) {
    response.status(400).json({ error: 'code 格式非法（4-16 位字母数字）' });
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
    response.status(400).json({ error: 'wifiName 为必填项' });
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
    response.json({ ok: false, output: '', error: '空命令已忽略' });
    return;
  }

  const executed = await runOnDevice(request, response, id, [command]);
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
    response.json({ ok: false, output: '', error: '空命令批次已忽略' });
    return;
  }

  const filtered = commands.map((item) => item?.trim()).filter(Boolean) as string[];
  if (filtered.length === 0) {
    response.json({ ok: false, output: '', error: '空命令批次已忽略' });
    return;
  }

  const executed = await runOnDevice(request, response, id, filtered);
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
    response.status(400).json({ error: '缺少镜像下载地址 imageUrl' });
    return;
  }
  const dest = targetPath?.trim() || FLASH_DEFAULT_DEST;
  // 在设备上下载镜像
  const executed = await runOnDevice(request, response, id, [
    `bash -lc "echo 'Downloading image...'; wget -q --show-progress -O ${shEscape(dest)} ${shEscape(imageUrl)} 2>&1 || curl -fSL -o ${shEscape(dest)} ${shEscape(imageUrl)} 2>&1; echo DONE; ls -lh ${shEscape(dest)}"`,
  ]);
  if (!executed) return;
  response.json({ ok: true, output: executed.output, path: dest });
});

app.post('/api/devices/:id/flash/write', async (request, response) => {
  const { id } = request.params;
  const { imagePath, target } = request.body as { imagePath?: string; target?: string };
  if (!imagePath?.trim()) {
    response.status(400).json({ error: '缺少镜像路径 imagePath' });
    return;
  }
  // target: emmc (/dev/mmcblk0), sd (/dev/mmcblk1), 或自定义路径
  const targetDev = target === 'emmc' ? '/dev/mmcblk0' : target === 'sd' ? '/dev/mmcblk1' : (target || '/dev/mmcblk0');
  // 使用 hbupdate 或 dd 写入
  const executed = await runOnDevice(request, response, id, [
    `bash -lc "if command -v hbupdate >/dev/null 2>&1; then echo 'Using hbupdate...'; hbupdate ${shEscape(imagePath)} 2>&1; else echo 'Using dd...'; dd if=${shEscape(imagePath)} of=${shEscape(targetDev)} bs=4M status=progress 2>&1; sync; fi; echo FLASH_COMPLETE"`,
  ]);
  if (!executed) return;
  response.json({ ok: true, output: executed.output });
});

app.post('/api/devices/:id/flash/verify', async (request, response) => {
  const { id } = request.params;
  // 验证烧录后的系统状态
  const executed = await runOnDevice(request, response, id, [
    'bash -lc "echo ===POST_FLASH===; cat /etc/version 2>/dev/null || echo no-version; uname -a; echo ===BOOT===; systemctl is-system-running 2>/dev/null || echo unknown; echo ===BPU===; hrut_smi 2>/dev/null | head -5 || echo bpu-check-unavailable"',
  ]);
  if (!executed) return;
  response.json({ ok: true, output: executed.output });
});

app.post('/api/devices/:id/flash/backup/check', async (request, response) => {
  const { id } = request.params;
  const executed = await runOnDevice(request, response, id, [
    'bash -lc "if command -v rdk-backup >/dev/null 2>&1; then echo RDK_BACKUP_AVAILABLE; rdk-backup --help 2>&1 | head -60; else echo RDK_BACKUP_NOT_FOUND; fi"',
  ]);
  if (!executed) return;
  const available = /RDK_BACKUP_AVAILABLE/.test(executed.output);
  response.json({ ok: true, available, output: executed.output });
});

app.post('/api/devices/:id/flash/backup/start', async (request, response) => {
  const { id } = request.params;
  const { outputPath, sourceDevice } = request.body as { outputPath?: string; sourceDevice?: string };
  const jobId = uuid();
  const outPath = outputPath?.trim() || `/userdata/rdk-backup-${Date.now()}.img`;
  flashBackupJobs.set(jobId, {
    id: jobId,
    deviceId: id,
    status: 'running',
    outputPath: outPath,
    startedAt: Date.now(),
  });

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

  const executed = await runOnDevice(request, response, id, [command]);
  if (!executed) {
    const job = flashBackupJobs.get(jobId);
    if (job) {
      job.status = 'error';
      job.error = '板端命令执行失败';
      job.finishedAt = Date.now();
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
  if (!jobId?.trim()) {
    response.status(400).json({ error: '缺少 jobId' });
    return;
  }
  const job = flashBackupJobs.get(jobId.trim());
  if (!job || job.deviceId !== id) {
    response.status(404).json({ error: '备份任务不存在' });
    return;
  }
  response.json({ ok: true, job });
});

app.post('/api/devices/:id/flash/backup/download', async (request, response) => {
  const { id } = request.params;
  const { outputPath } = request.body as { outputPath?: string };
  const targetPath = outputPath?.trim();
  if (!targetPath) {
    response.status(400).json({ error: '缺少 outputPath' });
    return;
  }

  const executed = await runOnDevice(
    request,
    response,
    id,
    [`sudo bash -lc "if [ -f ${shEscape(targetPath)} ]; then base64 ${shEscape(targetPath)} | tr -d '\\n'; else echo NOT_FOUND; fi"`],
  );
  if (!executed) return;
  if (executed.output.trim() === 'NOT_FOUND') {
    response.status(404).json({ error: '备份文件不存在' });
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
    response.status(400).json({ error: '缺少镜像地址 imageUrl' });
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
fi

echo "===FLASH_DONE==="
'`;

  const executed = await runOnDevice(request, response, id, [command]);
  if (!executed) return;

  response.json({ ok: true, output: executed.output, strategy: 'network-direct', targetDevice });
});

app.get('/api/devices/:id/ros/topics', async (request, response) => {
  const { id } = request.params;
  const executed = await runOnDevice(request, response, id, ['bash -lc "(command -v ros2 >/dev/null 2>&1 && ros2 topic list) || echo ROS2_NOT_INSTALLED"']);
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

  const active = /active|node-red/i.test(executed.output);
  response.json({ ok: true, active, output: executed.output });
});

app.get('/api/devices/:id/services/vnc', async (request, response) => {
  const { id } = request.params;
  const executed = await runOnDevice(
    request,
    response,
    id,
    ['bash -lc "(systemctl is-active vncserver || systemctl is-active x11vnc || pgrep -af \'x11vnc|Xtigervnc|vncserver\' || echo inactive)"'],
  );
  if (!executed) return;

  const active = /active|vnc/i.test(executed.output);
  response.json({ ok: true, active, output: executed.output });
});

// ─── Service Start/Stop ───

app.post('/api/devices/:id/services/vnc/start', async (request, response) => {
  const { id } = request.params;
  const executed = await runOnDevice(request, response, id, [
    'bash -lc "if command -v x11vnc >/dev/null 2>&1; then nohup x11vnc -display :0 -rfbport 5900 -passwd 88888888 -shared -forever -bg 2>/dev/null; echo VNC_STARTED_X11VNC; elif command -v vncserver >/dev/null 2>&1; then vncserver :0 2>&1; echo VNC_STARTED_VNCSERVER; else echo VNC_NOT_INSTALLED; fi"',
  ]);
  if (!executed) return;
  const started = /VNC_STARTED/i.test(executed.output);
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
    const scanPromises: Promise<void>[] = [];

    for (const subnet of uniqueSubnets) {
      for (let i = 1; i <= 254; i++) {
        const ip = `${subnet}.${i}`;
        scanPromises.push(
          new Promise<void>((resolve) => {
            const sock = net.connect({ host: ip, port: 22, timeout: 800 });
            sock.on('connect', () => {
              found.push({ ip, port: 22 });
              sock.destroy();
              resolve();
            });
            sock.on('error', () => { sock.destroy(); resolve(); });
            sock.on('timeout', () => { sock.destroy(); resolve(); });
          }),
        );
      }
    }

    await Promise.all(scanPromises);
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
  );
  if (!executed) return;
  response.json({ ok: true, output: executed.output, path: targetPath });
});

app.get('/api/devices/:id/files/read', async (request, response) => {
  const { id } = request.params;
  const targetPath = String(request.query.path ?? '');
  const lines = Number(request.query.lines ?? 200);

  if (!targetPath.trim()) {
    response.status(400).json({ error: 'path 不能为空' });
    return;
  }

  // Use base64 to avoid JSON encoding issues with weird characters
  const executed = await runOnDevice(
    request,
    response,
    id,
    [`sudo bash -lc "if [ -f ${shEscape(targetPath)} ]; then head -n ${Number.isFinite(lines) && lines > 0 ? Math.min(lines, 2000) : 200} ${shEscape(targetPath)} 2>/dev/null | base64 | tr -d '\\n'; else echo 'NOT_A_FILE'; fi || true"`],
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
    response.status(400).json({ error: 'path 不能为空' });
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
        await runRemoteCommands({ host: device.host, port: device.port ?? 22, username: device.username, password: pwd }, [`mkdir -p $(dirname ${shEscape(targetPath)}) || true`]);
        await uploadFileSftp({ host: device.host, port: device.port ?? 22, username: device.username, password: pwd }, targetPath, Buffer.from(content ?? '', 'utf-8'));
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
  );
  if (!executed) return;
  response.json({ ok: true, output: executed.output || '写入完成', path: targetPath });
});

app.post('/api/devices/:id/files/upload', async (request, response) => {
  const { id } = request.params;
  const { path: targetPath, contentBase64 } = request.body as { path?: string; contentBase64?: string };

  if (!targetPath?.trim() || !contentBase64) {
    response.status(400).json({ error: 'path 和 contentBase64 不能为空' });
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
      await runRemoteCommands(
        { host: device.host, port: device.port ?? 22, username: device.username, password: pwd },
        [`mkdir -p $(dirname ${shEscape(targetPath)}) || true`]
      );
      
      const buffer = Buffer.from(contentBase64, 'base64');
      await uploadFileSftp(
        { host: device.host, port: device.port ?? 22, username: device.username, password: pwd },
        targetPath,
        buffer
      );
      
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
    response.status(400).json({ error: 'path 不能为空' });
    return;
  }

  // Support both file and directory download (tar.gz for directory).
  const executed = await runOnDevice(
    request,
    response,
    id,
    [`sudo bash -lc "if [ -d ${shEscape(targetPath)} ]; then tar czf - ${shEscape(targetPath)} 2>/dev/null | base64 | tr -d '\\n'; elif [ -f ${shEscape(targetPath)} ]; then base64 ${shEscape(targetPath)} | tr -d '\\n'; else echo 'NOT_FOUND'; fi || true"`],
  );
  
  if (!executed) return;
  if (executed.output.trim() === 'NOT_FOUND') {
    response.status(404).json({ error: '文件或目录不存在' });
    return;
  }
  
  response.json({ ok: true, path: targetPath, contentBase64: executed.output.trim(), isDir: true /* Frontend will check extension */ });
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
  const config = loadProviderConfig();
  if (!config) {
    response.json({ configured: false });
    return;
  }
  response.json({
    configured: true,
    provider: config.provider,
    model: config.model,
    hasApiKey: !!config.apiKey,
    baseUrl: config.baseUrl,
  });
});

app.post('/api/agent/config', (request, response) => {
  const { provider, model, apiKey: key, baseUrl } = request.body as Partial<ProviderConfig>;
  if (!provider) {
    response.status(400).json({ error: '缺少 provider' });
    return;
  }
  const existing = loadProviderConfig();
  if (!key && !existing?.apiKey) {
    response.status(400).json({ error: '缺少 apiKey' });
    return;
  }
  const config: ProviderConfig = {
    provider: provider as ProviderConfig['provider'],
    model: model || '',
    apiKey: key || existing?.apiKey || '',
    baseUrl,
  };
  saveProviderConfig(config);
  response.json({ ok: true });
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
  });
  response.json({ ok: true, user });
});

app.get('/api/rdkclaw/skills', (_request, response) => {
  response.json({ ok: true, skills: rdkclaw.listSkills() });
});

app.post('/api/rdkclaw/skills/reload', (_request, response) => {
  response.json({ ok: true, skills: rdkclaw.reloadSkills() });
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

    const eventId = String(body?.header?.event_id || body?.event_id || body?.event?.message?.message_id || '');
    if (markFeishuSeen(eventId)) {
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
      console.log(`[Feishu] unbound user=${maskOpenId(openId)} event=${eventId} issued_code`);
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
    console.log(`[Feishu] bound user=${maskOpenId(openId)} event=${eventId} cost_ms=${Date.now() - startedAt}`);
    response.json({ ok: true, reply: result.text, authorized: true });
  } catch (error) {
    console.error('[Feishu webhook] failed:', error instanceof Error ? error.message : error);
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Feishu webhook 处理失败',
    });
  }
});

// ─── Agent Chat (SSE) ───

app.post('/api/agent/chat', async (request, response) => {
  const { message, deviceId, sessionId, userId, mode, attachments } = request.body as {
    message?: string;
    deviceId?: string;
    sessionId?: string;
    userId?: string;
    mode?: RDKClawExecutionMode;
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

    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Run-Id': runId,
      'X-Session-Key': sessionId || '',
    });

    const sendEvent = (event: string, data: unknown) => {
      response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    for await (const event of rdkclaw.streamChat({
      message: String(message || '').trim(),
      deviceId,
      sessionId,
      userId,
      mode,
      attachments,
    })) {
      sendEvent(event.type, event.data);
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
          if (!success) {
            const raw = (streamed || '').trim();
            let msg = raw || 'OpenClaw 会话执行失败，请检查设备连接、密码或 Gateway 状态';
            if (/__OPENCLAW_HTTP_FAILED__/i.test(raw)) {
              msg = raw
                .replace(/__OPENCLAW_HTTP_FAILED__/gi, '')
                .trim() || `OpenClaw Gateway HTTP 接口不可用，请检查 ${OPENCLAW_GATEWAY_PORT} 端口与网关配置`;
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
      
      const pwd = password || devicePasswordCache.get(credentialCacheKey(device.host, device.username, device.port ?? 22)) || defaultSshPassword;

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
    sshStream?.end();
    sshClient?.end();
  });
});

httpServer.listen(port, '0.0.0.0', () => {
  console.log(`RDK Studio server running on http://0.0.0.0:${port}`);
});