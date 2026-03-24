/**
 * OpenClaw 部署管理器 - TypeScript 版本
 * 移植自 rdkstudio_frontend-master
 */
import { Client } from 'ssh2';
import * as fs from 'fs';
import * as path from 'path';

export interface Device {
  ip: string;
  userName: string;
  password?: string;
  id?: string;
  name?: string;
  deviceType?: string;
}

export interface GatewayStatus {
  running: boolean;
  version: string;
  feishuConnected: boolean;
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

export interface PluginSkillStatus {
  installedPlugins: string[];
  enabledPlugins: string[];
  installedSkills: string[];
  skillEnabled: Record<string, boolean>;
  skillDependencySatisfied: Record<string, boolean>;
}

export interface ConfigData {
  modelGateway?: {
    baseUrl: string;
    apiKey: string;
    api: string;
    modelId: string;
    modelName: string;
  };
  feishu?: {
    appId: string;
    appSecret: string;
    connectionMode?: 'websocket' | 'webhook';
    domain?: 'feishu' | 'lark';
    dmPolicy?: 'pairing' | 'allowlist' | 'open' | 'disabled';
    verificationToken?: string;
    encryptKey?: string;
  };
  runtimeModel?: {
    provider: string;
    modelId: string;
    apiKey: string;
  };
  primaryModel?: string;
  configuredProviders?: Array<{
    provider: string;
    modelId: string;
    label: string;
    hasKey: boolean;
  }>;
  pluginsAllow?: string[];
  allProviders?: Record<string, any>;
}

// 常量定义
const NPM_NVM_CLEANUP = 'echo "[OpenClaw] 清理 .npmrc 中与 nvm 冲突的配置" && (npm config delete prefix 2>/dev/null || true) && (npm config delete globalconfig 2>/dev/null || true)';
const CLAWHUB_TOKEN = process.env.CLAWHUB_TOKEN ?? '';
const CLAWHUB_AUTO_LOGIN_CMD = [
  'echo "[OpenClaw] 正在自动登录 ClawHub..."',
  `clawhub login --token ${CLAWHUB_TOKEN} 2>&1 || echo "[OpenClaw] ClawHub 自动登录失败"`
].join(' && ');
const BOARD_ENV_EXPORT = 'export NPM_CONFIG_PREFIX="$HOME/.npm-global" && export PATH="$HOME/.npm-global/bin:$PATH"';
const RESTART_GATEWAY_FALLBACK = '(systemctl --user restart openclaw-gateway 2>/dev/null || openclaw gateway restart || clawctl gateway restart || true)';
const START_GATEWAY_FALLBACK = '(openclaw gateway start 2>&1 || openclaw start 2>&1 || clawctl start 2>&1 || true)';
const ENSURE_GATEWAY_LOCAL_MODE_SCRIPT_B64 = Buffer.from(`
import json
import os

p = os.path.expanduser("~/.openclaw/openclaw.json")
os.makedirs(os.path.dirname(p), exist_ok=True)

try:
    with open(p, "r", encoding="utf-8") as f:
        d = json.load(f)
except Exception:
    d = {}

g = d.get("gateway") if isinstance(d.get("gateway"), dict) else {}
g["mode"] = "local"
g["bind"] = "loopback"
d["gateway"] = g

with open(p, "w", encoding="utf-8") as f:
    json.dump(d, f, indent=2, ensure_ascii=False)

print("[OpenClaw] gateway.mode=local, gateway.bind=loopback")
`.trim(), 'utf8').toString('base64');

const ENSURE_GATEWAY_LOCAL_MODE = [
  'echo "[OpenClaw] 确保 gateway.mode=local 与 bind=loopback"',
  `echo '${ENSURE_GATEWAY_LOCAL_MODE_SCRIPT_B64}' | base64 -d > /tmp/oc_fix_gateway_mode.py`,
  'python3 /tmp/oc_fix_gateway_mode.py 2>&1 || echo "[OpenClaw] gateway mode 修复失败"',
].join(' && ');
const RUN_DOCTOR = '(openclaw doctor --fix --yes 2>&1 || openclaw doctor --fix 2>&1 || openclaw doctor 2>&1 || echo "[OpenClaw] doctor 执行失败，请手动检查")';
const RUN_HEALTH = '(openclaw health --json 2>&1 || openclaw status --all 2>&1 || openclaw status 2>&1 || echo "[OpenClaw] health 检查失败")';
const SUPPORTED_OPENCLAW_APIS = new Set([
  'openai-completions',
  'anthropic-messages',
]);

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

/**
 * Shared Node.js preamble for OpenClaw Gateway v3 WebSocket connections.
 * Generates an Ed25519 keypair, reads the gateway token, signs the challenge nonce,
 * and completes the connect handshake. Scripts append their own logic via
 * onConnected / onConnectFailed / onFrame callbacks.
 */
const OPENCLAW_WS_CONNECT_HELPER = `
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

if (typeof WebSocket === 'undefined') {
  console.error('WebSocket runtime unavailable (requires Node >= 22)');
  process.exit(1);
}

let token = '';
try {
  const cfgPath = process.env.HOME + '/.openclaw/openclaw.json';
  if (fs.existsSync(cfgPath)) {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    token = (((cfg.gateway || {}).auth || {}).token || '').trim();
  }
} catch {}

const IDENTITY_PATH = process.env.HOME + '/.openclaw/.rdkstudio-device.json';
let deviceIdentity;
try {
  if (fs.existsSync(IDENTITY_PATH)) {
    deviceIdentity = JSON.parse(fs.readFileSync(IDENTITY_PATH, 'utf8'));
  }
} catch {}
if (!deviceIdentity || !deviceIdentity.publicKey || !deviceIdentity.privateKey) {
  const kp = crypto.generateKeyPairSync('ed25519');
  const pubRaw = kp.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  const pubB64 = Buffer.from(pubRaw).toString('base64url');
  const devId = crypto.createHash('sha256').update(pubRaw).digest('hex');
  const privPem = kp.privateKey.export({ type: 'pkcs8', format: 'pem' });
  deviceIdentity = { id: devId, publicKey: pubB64, privateKey: privPem };
  try { fs.mkdirSync(os.path.dirname ? require('path').dirname(IDENTITY_PATH) : (process.env.HOME + '/.openclaw'), { recursive: true }); } catch {}
  try { fs.writeFileSync(IDENTITY_PATH, JSON.stringify(deviceIdentity), 'utf8'); } catch {}
}

const CLIENT_ID = 'cli';
const CLIENT_MODE = 'cli';
const ROLE = 'operator';
const SCOPES = ['operator.read', 'operator.write', 'operator.admin', 'operator.approvals', 'operator.pairing'];

function signChallenge(nonce, ts) {
  const signingToken = token || '';
  const payload = ['v2', deviceIdentity.id, CLIENT_ID, CLIENT_MODE, ROLE, SCOPES.join(','), String(ts), signingToken, nonce].join('|');
  const privKey = crypto.createPrivateKey(deviceIdentity.privateKey);
  const sig = crypto.sign(null, Buffer.from(payload), privKey);
  return {
    id: deviceIdentity.id,
    publicKey: deviceIdentity.publicKey,
    signature: Buffer.from(sig).toString('base64url'),
    signedAt: ts,
    nonce: nonce,
  };
}

function buildConnectParams(nonce, ts) {
  const params = {
    minProtocol: 3,
    maxProtocol: 3,
    client: { id: CLIENT_ID, version: '1.0.0', platform: os.platform(), mode: CLIENT_MODE },
    role: ROLE,
    scopes: SCOPES,
    device: signChallenge(nonce, ts),
    locale: 'zh-CN',
    userAgent: 'rdkstudio/1.0.0',
    caps: ['agent-events', 'tool-events'],
  };
  if (token) params.auth = { token };
  return params;
}

let onConnected = () => {};
let onConnectFailed = (msg) => { console.error(msg); process.exit(1); };
let onFrame = () => {};
let wsConnected = false;

const WS_URL = 'ws://127.0.0.1:18789';
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;
let wsRetries = 0;
let ws;

let wsOnClose = null;

function connectWs() {
  const sock = new WebSocket(WS_URL);
  const connectId = 'connect-' + Math.random().toString(16).slice(2);
  sock.onmessage = (ev) => {
    let frame;
    try { frame = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8')); } catch { return; }
    if (!frame) return;
    if (frame.type === 'event' && frame.event === 'connect.challenge') {
      const nonce = (frame.payload && frame.payload.nonce) ? String(frame.payload.nonce) : '';
      const ts = (frame.payload && frame.payload.ts) ? Number(frame.payload.ts) : Date.now();
      sock.send(JSON.stringify({ type: 'req', id: connectId, method: 'connect', params: buildConnectParams(nonce, ts) }));
      return;
    }
    if (frame.type === 'res' && frame.id === connectId) {
      if (!frame.ok) { onConnectFailed((frame.error && frame.error.message) || 'connect failed'); return; }
      wsConnected = true;
      onConnected();
      return;
    }
    onFrame(frame);
  };
  sock.onerror = () => {
    if (wsConnected) return;
    if (wsRetries < MAX_RETRIES) {
      wsRetries++;
      console.error('[WS] connect failed, retry ' + wsRetries + '/' + MAX_RETRIES + '...');
      setTimeout(() => { ws = connectWs(); }, RETRY_DELAY);
    } else {
      onConnectFailed('websocket connect failed after ' + MAX_RETRIES + ' retries (gateway may not be running on 127.0.0.1:18789)');
    }
  };
  sock.onclose = () => { if (wsOnClose) wsOnClose(); };
  return sock;
}
ws = connectWs();
`;

const NPM_INSTALL_CMD = [
  BOARD_ENV_EXPORT,
  'echo "[OpenClaw] 开始安装（官方推荐流程）..."',
  // 优先官方安装脚本，失败回退 npm latest
  '(curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-onboard 2>&1 || (echo "[OpenClaw] 官方脚本失败，尝试 npm 安装..." && for i in 1 2 3; do if CI=1 npm install -g openclaw@latest --loglevel info --prefer-offline=false --fetch-timeout=120000 --fetch-retries=5 2>&1; then break; fi; echo "[OpenClaw] 官方源失败，尝试国内镜像..."; if CI=1 npm install -g openclaw@latest --loglevel info --registry=https://registry.npmmirror.com --prefer-offline=false --fetch-timeout=120000 --fetch-retries=5 2>&1; then break; fi; [ "$i" = 3 ] && exit 1; echo "[OpenClaw] 安装失败，重试 $i/3..."; sleep 10; done))',
  CLAWHUB_AUTO_LOGIN_CMD,
  ENSURE_GATEWAY_LOCAL_MODE,
  NPM_NVM_CLEANUP,
  RUN_DOCTOR,
  RESTART_GATEWAY_FALLBACK,
  RUN_HEALTH,
  'echo "[OpenClaw] 安装流程完成"'
].join(' && ');

const GATEWAY_RESTART_CMD = `${BOARD_ENV_EXPORT} && ${RESTART_GATEWAY_FALLBACK} && echo "[OpenClaw] Gateway 已重启"`;
const GATEWAY_PORT_CHECK = `python3 -c 'import socket; s=socket.socket(socket.AF_INET,socket.SOCK_STREAM); s.settimeout(1.0); ok=(s.connect_ex(("127.0.0.1",18789))==0); s.close(); print("OPEN" if ok else "CLOSED")'`;
const GATEWAY_DIAG_LOGS = [
  'echo "--- openclaw logs ---"',
  '(openclaw logs --limit 200 2>&1 || true)',
  'echo "--- journalctl (user/openclaw-gateway) ---"',
  '(journalctl --user -u openclaw-gateway --no-pager -n 120 2>&1 || true)',
  'echo "--- /tmp/openclaw log files ---"',
  '(ls -1t /tmp/openclaw/openclaw-*.log 2>/dev/null | head -n 3 | while read f; do echo "=== $f ==="; tail -n 120 "$f" 2>/dev/null || true; done || true)',
].join(' ; ');

const NPM_UPGRADE_CMD = [
  BOARD_ENV_EXPORT,
  'echo "[OpenClaw] 开始升级（官方推荐流程）..."',
  // 优先 CLI update，失败回退 npm latest
  '(openclaw update --no-restart 2>&1 || openclaw update 2>&1 || (echo "[OpenClaw] update 命令失败，回退 npm 升级..." && for i in 1 2 3; do if CI=1 npm install -g openclaw@latest --loglevel info --prefer-offline=false --fetch-timeout=120000 --fetch-retries=5 2>&1; then break; fi; echo "[OpenClaw] 官方源失败，尝试国内镜像..."; if CI=1 npm install -g openclaw@latest --loglevel info --registry=https://registry.npmmirror.com --prefer-offline=false --fetch-timeout=120000 --fetch-retries=5 2>&1; then break; fi; [ "$i" = 3 ] && exit 1; echo "[OpenClaw] 升级失败，重试 $i/3..."; sleep 10; done))',
  ENSURE_GATEWAY_LOCAL_MODE,
  NPM_NVM_CLEANUP,
  RUN_DOCTOR,
  RESTART_GATEWAY_FALLBACK,
  RUN_HEALTH,
  'echo "[OpenClaw] 升级流程完成"'
].join(' && ');

export class OpenClawDeploymentManager {
  private sshPool: Map<string, Promise<Client>> = new Map();
  private resourcesPath: string;

  constructor(resourcesPath: string) {
    this.resourcesPath = resourcesPath;
  }

  private getScriptPath(name: string): string {
    return path.join(this.resourcesPath, 'openclaw', name);
  }

  private async getClient(device: Device): Promise<Client> {
    const ip = device.ip;
    const cached = this.sshPool.get(ip);
    if (cached) {
      try {
        const client = await cached;
        const socket = (client as any)?._sock;
        if (socket && !socket.destroyed && socket.writable) {
          return client;
        }
      } catch (_) {
        // stale cached promise, recreate below
      }
      this.sshPool.delete(ip);
    }

    const promise = new Promise<Client>((resolve, reject) => {
      const client = new Client();
      client
        .on('ready', () => resolve(client))
        .on('error', (err) => {
          this.sshPool.delete(ip);
          reject(err);
        })
        .on('close', () => this.sshPool.delete(ip))
        .connect({
          host: device.ip,
          port: 22,
          username: device.userName,
          password: device.password || device.userName,
          readyTimeout: 15000,
          keepaliveInterval: 30000,
          keepaliveCountMax: 3,
        });
    });

    this.sshPool.set(ip, promise);
    promise.catch(() => this.sshPool.delete(ip));
    return promise;
  }

  destroyConnection(ip: string): void {
    const p = this.sshPool.get(ip);
    if (!p) return;
    this.sshPool.delete(ip);
    p.then((client) => { try { client.end(); } catch (_) {} }).catch(() => {});
  }

  destroyAllConnections(): void {
    for (const [ip] of this.sshPool) {
      this.destroyConnection(ip);
    }
  }

  execCommand(
    device: Device,
    command: string,
    onOutput: (chunk: string) => void,
    onComplete: (success: boolean, code?: number) => void,
    execOpts: { pty?: boolean | any; timeout?: number } = {}
  ): { abort: () => void } {
    let finished = false;
    let activeStream: any = null;
    const finish = (success: boolean, code?: number) => {
      if (finished) return;
      finished = true;
      activeStream = null;
      if (timer) clearTimeout(timer);
      onComplete(success, code);
    };

    const timeoutMs = execOpts.timeout;
    const useTimeout = (timeoutMs === undefined || timeoutMs === null) ? true : (timeoutMs > 0);
    const effectiveTimeout = (timeoutMs === undefined || timeoutMs === null) ? 600000 : timeoutMs;
    const timer = useTimeout
      ? setTimeout(() => {
          if (!finished) {
            onOutput(`[TIMEOUT] 命令执行超时 (${effectiveTimeout / 1000}s)，已中断\n`);
            this.destroyConnection(device.ip);
            finish(false, -1);
          }
        }, effectiveTimeout)
      : undefined;

    const handle = {
      abort: () => {
        if (finished) return;
        if (activeStream) {
          try { activeStream.close(); } catch (_) {}
          try { activeStream.signal('KILL'); } catch (_) {}
        }
        finish(false, -1);
      },
    };

    const opts = { ...execOpts };
    if (opts.pty === true) {
      opts.pty = { cols: 120, rows: 30, term: 'xterm-256color' };
    }

    this.getClient(device).then((client) => {
      client.exec(command, opts, (err, stream) => {
        if (err) {
          onOutput(`[ERROR] ${err.message}\n`);
          this.destroyConnection(device.ip);
          finish(false);
          return;
        }
        activeStream = stream;
        stream.on('data', (data: Buffer) => { if (!finished) onOutput(data.toString()); });
        stream.stderr?.on('data', (data: Buffer) => { if (!finished) onOutput(data.toString()); });
        stream.on('close', (code: number) => finish(code === 0, code));
      });
    }).catch((err: any) => {
      onOutput(`[SSH Error] ${err.message}\n`);
      finish(false);
    });

    return handle;
  }

  runCheck(device: Device, onOutput: (chunk: string) => void, onComplete: (success: boolean) => void): void {
    const cmd = [
      BOARD_ENV_EXPORT,
      'echo "=== OpenClaw 诊断 ==="',
      'echo "--- 版本 ---"',
      'openclaw --version 2>&1 || echo "openclaw 未安装"',
      'echo ""',
      'echo "--- Gateway 状态 ---"',
      `${GATEWAY_PORT_CHECK} 2>/dev/null || echo "CLOSED"`,
      '(systemctl --user status openclaw-gateway --no-pager -n 20 2>&1 || true)',
      'echo ""',
      'echo "--- Health ---"',
      'openclaw health 2>&1 || echo "health 不可用"',
      'echo ""',
      'echo "--- Doctor ---"',
      'openclaw doctor 2>&1 || echo "doctor 不可用"',
      'echo ""',
      'echo "--- Node/NPM ---"',
      'node --version 2>&1 || echo "node 未安装"',
      'npm --version 2>&1 || echo "npm 未安装"',
      'echo "=== 诊断完成 ==="',
    ].join(' ; ');
    this.execCommand(device, cmd, onOutput, onComplete, { timeout: 60000 });
  }

  runPrepare(device: Device, onOutput: (chunk: string) => void, onComplete: (success: boolean) => void): void {
    const cmd = [
      BOARD_ENV_EXPORT,
      'echo "=== 环境准备 ==="',
      'echo "--- 检查 Node.js ---"',
      'node --version 2>&1 || echo "node 未安装，请先安装 Node.js 18+"',
      'echo "--- 检查 npm ---"',
      'npm --version 2>&1 || echo "npm 未安装"',
      'echo "--- 创建目录 ---"',
      'mkdir -p "$HOME/.openclaw" "$HOME/.npm-global" 2>&1 && echo "目录已就绪"',
      'echo "--- 配置 npm ---"',
      'npm config set prefix "$HOME/.npm-global" 2>/dev/null ; npm config set fund false 2>/dev/null ; npm config set update-notifier false 2>/dev/null ; echo "npm 配置完成"',
      'echo "--- 检查 openclaw ---"',
      'openclaw --version 2>&1 || echo "openclaw 尚未安装（可点击安装按钮）"',
      'echo "--- 修复网关模式 ---"',
      ENSURE_GATEWAY_LOCAL_MODE,
      'echo "=== 准备完成 ==="',
    ].join(' ; ');
    this.execCommand(device, cmd, onOutput, onComplete, { timeout: 120000 });
  }

  runInstall(device: Device, onOutput: (chunk: string) => void, onComplete: (success: boolean) => void): void {
    this.execCommand(device, NPM_INSTALL_CMD, onOutput, onComplete, { pty: true, timeout: 600000 });
  }

  runUpgrade(device: Device, onOutput: (chunk: string) => void, onComplete: (success: boolean) => void): void {
    this.execCommand(device, NPM_UPGRADE_CMD, onOutput, onComplete, { pty: true, timeout: 600000 });
  }

  runUninstall(device: Device, onOutput: (chunk: string) => void, onComplete: (success: boolean) => void): void {
    const cmd = [
      BOARD_ENV_EXPORT,
      'echo "[OpenClaw] 开始卸载..."',

      'echo "[1/6] 停止 gateway 服务..."',
      '(openclaw gateway stop 2>/dev/null || true)',
      '(systemctl --user stop openclaw-gateway 2>/dev/null || true)',

      'echo "[2/6] 执行官方卸载..."',
      '(openclaw uninstall --all --yes --non-interactive 2>&1 || true)',

      'echo "[3/6] 卸载 systemd 服务..."',
      '(openclaw gateway uninstall 2>/dev/null || true)',
      '(systemctl --user disable openclaw-gateway 2>/dev/null || true)',
      '(rm -f ~/.config/systemd/user/openclaw-gateway.service 2>/dev/null || true)',
      '(systemctl --user daemon-reload 2>/dev/null || true)',

      'echo "[4/6] 清除 ClawHub 登录态..."',
      '(clawhub logout 2>/dev/null || true)',

      'echo "[5/6] 清理配置、日志和临时文件..."',
      '(rm -rf ~/.openclaw 2>/dev/null || true)',
      '(rm -rf /tmp/openclaw-* /tmp/clawhub-* 2>/dev/null || true)',
      '(rm -rf ~/.cache/openclaw 2>/dev/null || true)',
      '(rm -rf ~/.local/share/openclaw 2>/dev/null || true)',

      'echo "[6/6] 移除全局 npm 包..."',
      '(npm rm -g openclaw 2>/dev/null || npm uninstall -g openclaw 2>/dev/null || true)',
      '(npm rm -g clawhub 2>/dev/null || true)',

      'echo "[OpenClaw] 卸载完成，已彻底清理"',
    ].join(' && ');
    this.execCommand(device, cmd, onOutput, onComplete, { pty: true, timeout: 0 });
  }

  getGatewayStatus(device: Device, onResult: (status: GatewayStatus) => void, onOutput?: (chunk: string) => void): void {
    const pyScript = `import json, os, subprocess
result = {"running": False, "version": "", "feishuConnected": False}
try:
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(2)
    r = s.connect_ex(("127.0.0.1", 18789))
    s.close()
    result["running"] = (r == 0)
except:
    pass
try:
    env = os.environ.copy()
    env["PATH"] = os.path.expanduser("~/.npm-global/bin") + ":" + env.get("PATH", "")
    out = subprocess.check_output(["openclaw", "--version"], env=env, stderr=subprocess.DEVNULL, timeout=5).decode().strip()
    result["version"] = out
except:
    pass
try:
    p = os.path.expanduser("~/.openclaw/openclaw.json")
    if os.path.exists(p):
        d = json.load(open(p))
        feishu = (d.get("channels") or {}).get("feishu") or {}
        result["feishuConnected"] = bool(feishu.get("enabled") and feishu.get("appId"))
except:
    pass
print(json.dumps(result))`;
    const b64 = Buffer.from(pyScript, 'utf8').toString('base64');
    const cmd = `echo '${b64}' | base64 -d > /tmp/oc_status.py && python3 /tmp/oc_status.py 2>/dev/null`;
    let output = '';
    this.execCommand(device, cmd, (chunk) => {
      output += chunk;
      if (onOutput) onOutput(chunk);
    }, () => {
      const jsonLine = (output || '').split('\n').map(l => l.trim()).find(l => l.startsWith('{'));
      if (jsonLine) {
        try {
          onResult(JSON.parse(jsonLine));
          return;
        } catch (_) {}
      }
      onResult({ running: false, version: '', feishuConnected: false });
    });
  }

  getHealthStatus(device: Device, onResult: (status: OpenClawHealthStatus) => void): void {
    const pyScript = `import json, os, socket, subprocess, urllib.request, urllib.error
result = {
  "installed": False,
  "gatewayRunning": False,
  "version": "",
  "hasToken": False,
  "tokenStatus": "unknown",
  "aiReady": False,
  "summary": ""
}

def check_port(host, port):
  s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
  s.settimeout(2)
  try:
    return s.connect_ex((host, port)) == 0
  finally:
    s.close()

try:
  env = os.environ.copy()
  env["PATH"] = os.path.expanduser("~/.npm-global/bin") + ":" + env.get("PATH", "")
  out = subprocess.check_output(["openclaw", "--version"], env=env, stderr=subprocess.DEVNULL, timeout=6).decode().strip()
  result["installed"] = True
  result["version"] = out
except Exception:
  pass

result["gatewayRunning"] = check_port("127.0.0.1", 18789)

token = ""
try:
  p = os.path.expanduser("~/.openclaw/openclaw.json")
  if os.path.exists(p):
    d = json.load(open(p, "r", encoding="utf-8"))
    token = (((d.get("gateway") or {}).get("auth") or {}).get("token") or "").strip()
except Exception:
  token = ""

result["hasToken"] = bool(token)

if not result["installed"]:
  result["tokenStatus"] = "unknown"
elif not result["hasToken"]:
  result["tokenStatus"] = "missing"
elif not result["gatewayRunning"]:
  result["tokenStatus"] = "unknown"
else:
  try:
    req = urllib.request.Request(
      "http://127.0.0.1:18789/v1/models",
      headers={"Authorization": "Bearer " + token},
      method="GET",
    )
    with urllib.request.urlopen(req, timeout=6) as resp:
      code = int(resp.getcode())
      result["tokenStatus"] = "ok" if 200 <= code < 300 else "invalid"
  except urllib.error.HTTPError as e:
    result["tokenStatus"] = "invalid" if e.code in (401, 403) else "unknown"
  except Exception:
    result["tokenStatus"] = "unknown"

result["aiReady"] = bool(result["installed"] and result["gatewayRunning"] and result["tokenStatus"] == "ok")

if not result["installed"]:
  result["summary"] = "未安装 OpenClaw"
elif not result["gatewayRunning"]:
  result["summary"] = "OpenClaw 已安装，但网关未运行"
elif result["tokenStatus"] == "missing":
  result["summary"] = "OpenClaw 已安装，但缺少 token"
elif result["tokenStatus"] == "invalid":
  result["summary"] = "OpenClaw token 无效"
elif result["tokenStatus"] == "ok":
  result["summary"] = "OpenClaw 已就绪，可用 AI 能力"
else:
  result["summary"] = "OpenClaw 状态待确认"

print(json.dumps(result, ensure_ascii=False))`;
    const b64 = Buffer.from(pyScript, 'utf8').toString('base64');
    const cmd = `echo '${b64}' | base64 -d > /tmp/oc_health.py && python3 /tmp/oc_health.py`;
    let output = '';
    this.execCommand(device, cmd, (chunk) => { output += chunk; }, () => {
      const jsonLine = (output || '').split('\n').map(l => l.trim()).find((l) => l.startsWith('{'));
      if (!jsonLine) {
        onResult({
          installed: false,
          gatewayRunning: false,
          version: '',
          hasToken: false,
          tokenStatus: 'unknown',
          aiReady: false,
          summary: '状态检测失败',
        });
        return;
      }
      try {
        onResult(JSON.parse(jsonLine) as OpenClawHealthStatus);
      } catch {
        onResult({
          installed: false,
          gatewayRunning: false,
          version: '',
          hasToken: false,
          tokenStatus: 'unknown',
          aiReady: false,
          summary: '状态解析失败',
        });
      }
    }, { timeout: 12000 });
  }

  getCurrentConfig(device: Device, onResult: (config: ConfigData | null, success: boolean) => void): void {
    const pyScript = `import json,os
p=os.path.expanduser('~/.openclaw/openclaw.json')
result={"modelGateway":{"baseUrl":"","apiKey":"","api":"openai-completions","modelId":"qwen3.5-plus","modelName":"Custom Model"},"feishu":{"appId":"","appSecret":"","connectionMode":"websocket","domain":"feishu","dmPolicy":"pairing","verificationToken":"","encryptKey":""},"runtimeModel":{"provider":"","modelId":"","apiKey":""},"primaryModel":"","configuredProviders":[],"pluginsAllow":[],"allProviders":{}}
if os.path.exists(p):
  d=json.load(open(p))
  provider=((d.get('models') or {}).get('providers') or {}).get('custom-gateway') or {}
  models=provider.get('models') or []
  model=models[0] if isinstance(models,list) and len(models)>0 and isinstance(models[0],dict) else {}
  feishu=((d.get('channels') or {}).get('feishu')) or {}
  primary=((((d.get('agents') or {}).get('defaults') or {}).get('model')) or {}).get('primary','')
  runtime_provider=''
  runtime_model_id=''
  if isinstance(primary,str) and '/' in primary:
    runtime_provider,runtime_model_id=primary.split('/',1)
  runtime_api_key=''
  runtime_provider_cfg=((d.get('models') or {}).get('providers') or {}).get(runtime_provider) or {}
  if isinstance(runtime_provider_cfg,dict):
    runtime_api_key=runtime_provider_cfg.get('apiKey','') or ''
  api_value=(provider.get('api','openai-completions') or 'openai-completions')
  if api_value=='openai-chat':
    api_value='openai-completions'
  elif api_value=='google-genai':
    api_value='google-generative-ai'
  result["modelGateway"].update({"baseUrl":provider.get('baseUrl','') or '',"apiKey":provider.get('apiKey','') or '',"api":api_value,"modelId":model.get('id','qwen3.5-plus') or 'qwen3.5-plus',"modelName":model.get('name','Custom Model') or 'Custom Model'})
  result["feishu"].update({
    "appId":feishu.get('appId','') or '',
    "appSecret":feishu.get('appSecret','') or '',
    "connectionMode":feishu.get('connectionMode','websocket') or 'websocket',
    "domain":feishu.get('domain','feishu') or 'feishu',
    "dmPolicy":feishu.get('dmPolicy','pairing') or 'pairing',
    "verificationToken":feishu.get('verificationToken','') or '',
    "encryptKey":feishu.get('encryptKey','') or ''
  })
  result["runtimeModel"].update({"provider":runtime_provider or '',"modelId":runtime_model_id or '',"apiKey":runtime_api_key or ''})
  result["primaryModel"]=primary or ''
  plugins=((d.get('plugins') or {}).get('allow') or [])
  if isinstance(plugins,list):
    result["pluginsAllow"]=[str(x) for x in plugins if isinstance(x,(str,int,float)) and str(x).strip()]
print(json.dumps(result,ensure_ascii=False))`;
    const b64 = Buffer.from(pyScript, 'utf8').toString('base64');
    const cmd = `echo '${b64}' | base64 -d > /tmp/oc_read_config.py && python3 /tmp/oc_read_config.py`;
    let output = '';
    this.execCommand(device, cmd, (chunk) => { output += chunk; }, (success) => {
      if (!success) {
        onResult(null, false);
        return;
      }
      try {
        onResult(JSON.parse((output || '').trim()), true);
      } catch (_) {
        onResult(null, false);
      }
    });
  }

  runOnboard(
    device: Device,
    provider: string,
    apiKey: string,
    modelId: string | undefined,
    onOutput: (chunk: string) => void,
    onComplete: (success: boolean) => void
  ): void {
    const escapedKey = apiKey.replace(/'/g, "'\"'\"'");
    const acceptRisk = '--accept-risk';
    const skipHealth = '--skip-health';
    const gatewayBind = '--gateway-bind loopback';
    
    const cmd = [
      'export PATH="$HOME/.npm-global/bin:$PATH"',
      'echo "[OpenClaw] 开始初始化配置..."',
      `openclaw onboard --non-interactive ${acceptRisk} ${skipHealth} ${gatewayBind} --auth-choice ${provider} --${provider} '${escapedKey}' --install-daemon 2>&1`,
      'echo "[OpenClaw] 初始化完成"'
    ].join(' && ');
    this.execCommand(device, cmd, onOutput, onComplete, { pty: true });
  }

  updateConfig(
    device: Device,
    config: { modelGateway?: any; feishu?: any; pluginsAllow?: string[] },
    onOutput: (chunk: string) => void,
    onComplete: (success: boolean) => void
  ): void {
    const patch: any = {};
    if (config.modelGateway?.baseUrl && config.modelGateway?.apiKey) {
      const modelId = config.modelGateway.modelId || 'default-model';
      const modelName = config.modelGateway.modelName || modelId;
      patch.models = {
        mode: 'merge',
        providers: {
          'custom-gateway': {
            baseUrl: config.modelGateway.baseUrl,
            apiKey: config.modelGateway.apiKey,
            api: normalizeOpenClawApi(config.modelGateway.api),
            models: [{
              id: modelId,
              name: modelName,
            }],
          },
        },
      };
      patch.agents = { defaults: { model: { primary: 'custom-gateway/' + modelId } } };
    }
    if (config.feishu?.appId && config.feishu?.appSecret) {
      const feishuPatch: Record<string, any> = {
        appId: config.feishu.appId,
        appSecret: config.feishu.appSecret,
        enabled: true,
      };
      if (config.feishu.connectionMode) feishuPatch.connectionMode = config.feishu.connectionMode;
      if (config.feishu.domain) feishuPatch.domain = config.feishu.domain;
      if (config.feishu.dmPolicy) feishuPatch.dmPolicy = config.feishu.dmPolicy;
      if (config.feishu.connectionMode === 'webhook') {
        if (config.feishu.verificationToken) feishuPatch.verificationToken = config.feishu.verificationToken;
        if (config.feishu.encryptKey) feishuPatch.encryptKey = config.feishu.encryptKey;
      }
      patch.channels = {
        feishu: feishuPatch,
      };
    }
    if (Array.isArray(config.pluginsAllow)) {
      const allow = config.pluginsAllow
        .map((item) => String(item ?? '').trim())
        .filter(Boolean);
      patch.plugins = {
        allow: Array.from(new Set(allow)),
      };
    }
    if (Object.keys(patch).length === 0) {
      onOutput('[OpenClaw] 无有效配置项，跳过更新\n');
      onComplete(true);
      return;
    }
    const patchB64 = Buffer.from(JSON.stringify(patch), 'utf8').toString('base64');
    const pyScript = `import json,os,sys,base64,traceback
try:
 p=os.path.expanduser('~/.openclaw/openclaw.json')
 os.makedirs(os.path.dirname(p),exist_ok=True)
 d=json.load(open(p)) if os.path.exists(p) else {}
 pat=json.loads(base64.b64decode(sys.argv[1]).decode())
 def merge(a,b):
  for k,v in b.items():
   if k in a and isinstance(a.get(k),dict) and isinstance(v,dict):merge(a[k],v)
   else:a[k]=v
 merge(d,pat)
 if 'channels' in pat and 'feishu' in pat['channels']:
  d.setdefault('channels',{})['feishu']=pat['channels']['feishu']
 json.dump(d,open(p,'w'),indent=2,ensure_ascii=False)
 v=json.load(open(p))
 mp=((v.get('models') or {}).get('providers') or {}).get('custom-gateway')
 ap=((v.get('agents') or {}).get('defaults') or {}).get('model',{}).get('primary','')
 print('[OpenClaw] 配置已更新 | model-provider:',('ok' if mp else 'missing'),'| primary:',ap or 'none')
except Exception as e:
 traceback.print_exc()
 print('[OpenClaw] 配置写入失败:',str(e))
 sys.exit(1)`;
    const base64Script = Buffer.from(pyScript, 'utf8').toString('base64');
    const cmd = [
      'export PATH="$HOME/.npm-global/bin:$PATH"',
      `echo '${base64Script}' | base64 -d > /tmp/oc_merge.py && python3 /tmp/oc_merge.py '${patchB64}'`,
      ENSURE_GATEWAY_LOCAL_MODE,
      '(systemctl --user restart openclaw-gateway 2>/dev/null || openclaw gateway restart)',
      'echo "[OpenClaw] 配置已保存，Gateway 已重启"',
    ].join(' && ');
    this.execCommand(device, cmd, onOutput, onComplete);
  }

  runRestartGateway(device: Device, onOutput: (chunk: string) => void, onComplete: (success: boolean) => void): void {
    const cmd = [
      'export PATH="$HOME/.npm-global/bin:$PATH"',
      ENSURE_GATEWAY_LOCAL_MODE,
      '(systemctl --user restart openclaw-gateway 2>/dev/null || openclaw gateway restart || clawctl gateway restart || true)',
      'echo "[OpenClaw] Gateway 重启命令已执行，等待端口就绪..."',
      `ok=0; for i in 1 2 3 4 5 6; do st="$(${GATEWAY_PORT_CHECK} 2>/dev/null | tr -d '\\r\\n')"; if [ "$st" = "OPEN" ]; then ok=1; break; fi; sleep 1; done`,
      `if [ "$ok" != "1" ]; then echo "[OpenClaw] 端口仍未就绪，尝试主动启动..."; ${START_GATEWAY_FALLBACK}; fi`,
      `if [ "$ok" != "1" ]; then for i in 1 2 3 4 5 6 7 8 9 10 11 12; do st="$(${GATEWAY_PORT_CHECK} 2>/dev/null | tr -d '\\r\\n')"; if [ "$st" = "OPEN" ]; then ok=1; break; fi; sleep 1; done; fi`,
      `if [ "$ok" = "1" ]; then echo "[OpenClaw] Gateway 已就绪并监听 127.0.0.1:18789"; else echo "[OpenClaw] Gateway 端口未就绪（127.0.0.1:18789）"; ${GATEWAY_DIAG_LOGS}; exit 1; fi`,
    ].join(' && ');
    this.execCommand(device, cmd, onOutput, onComplete);
  }

  runGetVersion(device: Device, onOutput: (chunk: string) => void, onComplete: (success: boolean) => void): void {
    const cmd = 'export PATH="$HOME/.npm-global/bin:$PATH" && (openclaw --version 2>/dev/null || echo "未安装")';
    this.execCommand(device, cmd, onOutput, onComplete);
  }

  runDoctor(device: Device, onOutput: (chunk: string) => void, onComplete: (success: boolean) => void): void {
    const cmd = `export PATH="$HOME/.npm-global/bin:$PATH" && ${ENSURE_GATEWAY_LOCAL_MODE} && (openclaw doctor --fix 2>&1 || openclaw doctor 2>&1 || echo "[OpenClaw] doctor 命令不可用，可能未安装")`;
    this.execCommand(device, cmd, onOutput, onComplete, { timeout: 180000 });
  }

  runModelTest(device: Device, onOutput: (chunk: string) => void, onComplete: (success: boolean) => void): void {
    const jsScript = OPENCLAW_WS_CONNECT_HELPER + `

const sessionKey = 'model-test-' + Date.now();
const prompt = '请只回复一个词：OK';
let text = '';
let done = false;
const sendId = 'send-' + Math.random().toString(16).slice(2);

function finish(ok, payload) {
  if (done) return;
  done = true;
  try { ws.close(); } catch {}
  if (ok) {
    process.stdout.write('MODEL_TEST_OK\\n');
    process.stdout.write(String(payload || '').trim() + '\\n');
    process.exit(0);
  }
  process.stderr.write('MODEL_TEST_FAIL: ' + String(payload || 'unknown') + '\\n');
  process.exit(1);
}

const timer = setTimeout(() => finish(false, 'timeout waiting gateway response'), 90000);

onConnected = () => {
  ws.send(JSON.stringify({
    type: 'req', id: sendId, method: 'chat.send',
    params: { sessionKey, message: prompt, idempotencyKey: 'mt-' + Date.now() + '-' + Math.random().toString(36).slice(2) },
  }));
};
onConnectFailed = (msg) => { clearTimeout(timer); finish(false, msg); };

onFrame = (frame) => {
  if (frame.type === 'res') {
    if (frame.id === sendId && !frame.ok) return finish(false, (frame.error && frame.error.message) || 'chat.send failed');
    return;
  }
  if (frame.type !== 'event') return;
  const p = frame.payload || {};
  const stream = p.stream;
  const d = p.data || {};

  if (stream === 'assistant') {
    const chunk = d.delta || d.text || p.delta || p.text || '';
    if (chunk) text += chunk;
    return;
  }
  if (stream === 'thinking') return;
  if (stream === 'tool') return;
  if (stream === 'lifecycle') {
    if (d.phase === 'end' || d.phase === 'complete') { clearTimeout(timer); return finish(true, text || '(done)'); }
    if (d.phase === 'error') { clearTimeout(timer); return finish(false, d.error || d.message || 'lifecycle error'); }
    return;
  }
  if (stream) return;

  // legacy fallback
  if (p.state === 'delta' && typeof p.text === 'string') { text += p.text; return; }
  if (p.state === 'final') { clearTimeout(timer); return finish(!!(p.text || text).trim(), p.text || text || 'empty final'); }
  if (p.state === 'error') { clearTimeout(timer); return finish(false, p.error || 'chat error'); }
  if (p.type === 'message_delta' && typeof p.delta === 'string') { text += p.delta; return; }
  if (p.type === 'message_end') { clearTimeout(timer); return finish(!!(p.text || text).trim(), p.text || text || 'empty'); }
  if (p.type === 'agent_error') { clearTimeout(timer); return finish(false, p.error || 'agent error'); }
};

wsOnClose = () => { if (!done) { clearTimeout(timer); finish(true, text || '(connection closed)'); } };
`;
    const jsB64 = Buffer.from(jsScript, 'utf8').toString('base64');
    const cmd = [
      'export PATH="$HOME/.npm-global/bin:$PATH"',
      `echo '${jsB64}' | base64 -d > /tmp/oc_model_test.js`,
      'node /tmp/oc_model_test.js',
    ].join(' && ');
    this.execCommand(device, cmd, onOutput, onComplete, { timeout: 120000, pty: false });
  }

  runScriptInstall(device: Device, onOutput: (chunk: string) => void, onComplete: (success: boolean) => void): void {
    const cmd = [
      'echo "[OpenClaw] 使用官方安装脚本..."',
      'curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-onboard 2>&1 || (echo "[OpenClaw] 官方脚本失败，尝试 npm 安装..." && export NPM_CONFIG_PREFIX="$HOME/.npm-global" && export PATH="$HOME/.npm-global/bin:$PATH" && npm install -g openclaw@latest --loglevel info 2>&1)',
      'echo "[OpenClaw] 安装完成"',
    ].join(' && ');
    this.execCommand(device, cmd, onOutput, onComplete, { pty: true, timeout: 0 });
  }

  runLogs(
    device: Device,
    limit: number,
    onOutput: (chunk: string) => void,
    onComplete: (success: boolean) => void
  ): void {
    const maxLines = Number.isFinite(limit) ? Math.max(20, Math.min(1000, Math.floor(limit))) : 200;
    const cmd = [
      BOARD_ENV_EXPORT,
      `echo "--- openclaw logs ---" ; (openclaw logs --limit ${maxLines} 2>&1 || true) ; echo "--- journalctl ---" ; (journalctl --user -u openclaw-gateway --no-pager -n ${maxLines} 2>&1 || true) ; echo "--- /tmp/openclaw ---" ; (ls -1t /tmp/openclaw/openclaw-*.log 2>/dev/null | head -n 3 | while read f; do echo "=== $f ==="; tail -n ${Math.max(40, Math.min(300, Math.floor(maxLines / 2)))} "$f" 2>/dev/null || true; done || true)`,
    ].join(' && ');
    this.execCommand(device, cmd, onOutput, onComplete, { timeout: 60000, pty: false });
  }

  getInstalledSkills(
    device: Device,
    onOutput: (chunk: string) => void,
    onComplete: (success: boolean) => void
  ): void {
    const cmd = [
      BOARD_ENV_EXPORT,
      'echo "===SKILLS==="',
      '(for d in /opt/openclaw/skills /root/.openclaw/workspace/skills; do [ -d "$d" ] && ls -1 "$d"; done | sed \'/^\\s*$/d\' | sort -u || true)',
      '[ -d /opt/openclaw/skills ] || [ -d /root/.openclaw/workspace/skills ] || echo "无已安装技能"',
      'echo "===PLUGINS==="',
      '(cat ~/.openclaw/openclaw.json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(chr(10).join(d.get(\'plugins\',{}).get(\'allow\',[])))" 2>/dev/null || echo "")',
    ].join(' ; ');
    this.execCommand(device, cmd, onOutput, onComplete, { timeout: 15000 });
  }

  runPairingList(
    device: Device,
    channel: string,
    onOutput: (chunk: string) => void,
    onComplete: (success: boolean) => void
  ): void {
    const cmd = `${BOARD_ENV_EXPORT} && (openclaw pairing list ${channel} 2>&1 || echo "[OpenClaw] pairing list 失败")`;
    this.execCommand(device, cmd, onOutput, onComplete, { timeout: 20000, pty: false });
  }

  runPairingApprove(
    device: Device,
    channel: string,
    code: string,
    onOutput: (chunk: string) => void,
    onComplete: (success: boolean) => void
  ): void {
    const cmd = `${BOARD_ENV_EXPORT} && (openclaw pairing approve ${channel} ${code} 2>&1 || echo "[OpenClaw] pairing approve 失败")`;
    this.execCommand(device, cmd, onOutput, onComplete, { timeout: 20000, pty: false });
  }

  runPairingReject(
    device: Device,
    channel: string,
    code: string,
    onOutput: (chunk: string) => void,
    onComplete: (success: boolean) => void
  ): void {
    const cmd = `${BOARD_ENV_EXPORT} && (openclaw pairing reject ${channel} ${code} 2>&1 || echo "[OpenClaw] 当前版本可能不支持 pairing reject")`;
    this.execCommand(device, cmd, onOutput, onComplete, { timeout: 20000, pty: false });
  }

  getWifiList(device: Device, onResult: (wifiNames: string[], success: boolean) => void): void {
    const cmd = 'sudo nmcli device wifi rescan 2>/dev/null; sleep 2; nmcli -f "SSID" device wifi list 2>/dev/null | awk \'NR>1 {gsub(/^[[:space:]]+|[[:space:]]+$/,""); if($0!="") print $0}\' | sort -u';
    let output = '';
    this.execCommand(device, cmd, (chunk) => { output += chunk; }, (success) => {
      if (!success) {
        onResult([], false);
        return;
      }
      const names = (output || '')
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s && s !== 'SSID');
      onResult([...new Set(names)], true);
    }, { timeout: 30000 });
  }

  setWifiConnection(
    device: Device,
    wifiName: string,
    wifiPassword: string,
    onOutput: (chunk: string) => void,
    onComplete: (success: boolean) => void
  ): void {
    const nameB64 = Buffer.from(wifiName || '').toString('base64');
    const pwdB64 = Buffer.from(wifiPassword || '').toString('base64');

    // WIFI_SSID / WIFI_KEY avoid clashing with bash built-in $PWD
    // Delete ALL matching connections (loop) to prevent "Secrets" reuse bug
    // Use nmcli connection add with security inline (no separate modify step)
    const script = [
      `WIFI_SSID=$(echo '${nameB64}' | base64 -d)`,
      `WIFI_KEY=$(echo '${pwdB64}' | base64 -d)`,
      `echo "[WiFi] 清理所有同名旧连接..."`,
      `while sudo nmcli con delete "$WIFI_SSID" 2>/dev/null; do true; done`,
      `echo "[WiFi] 扫描网络..."`,
      `sudo nmcli device wifi rescan 2>/dev/null; sleep 2`,
      `echo "[WiFi] 正在连接 $WIFI_SSID ..."`,
      `if command -v wifi_connect >/dev/null 2>&1; then sudo wifi_connect "$WIFI_SSID" "$WIFI_KEY" 2>&1; else sudo nmcli device wifi connect "$WIFI_SSID" password "$WIFI_KEY" ifname wlan0 2>&1; fi`,
      `sleep 3`,
      `NEW_IP=$(ip -4 addr show wlan0 2>/dev/null | grep -oP "inet \\\\K[\\\\d.]+" || true)`,
      `if [ -n "$NEW_IP" ]; then echo "[WiFi] OK IP=$NEW_IP"; else echo "[WiFi] FAIL"; fi`,
    ].join(' ; ');

    let output = '';
    const collectOutput = (chunk: string) => { output += chunk; onOutput(chunk); };
    const wrapComplete = () => { onComplete(/\[WiFi\] OK IP=/.test(output)); };
    this.execCommand(device, script, collectOutput, wrapComplete, { timeout: 90000 });
  }

  // OpenClaw 对话方法
  startInteractiveChat(
    device: Device,
    onData: (data: any, err?: string) => void,
    onClose: () => void,
    sessionId: string
  ): void {
    this.getClient(device)
      .then(() => {
        onData({ status: 'ready' });
      })
      .catch((error: any) => {
        onData(null, error?.message || 'SSH connection failed');
        onClose();
      });
  }

  sendAgentMessage(
    message: string,
    onChunk: (chunk: string) => void,
    onComplete: (success: boolean) => void,
    sessionId: string,
    device: Device
  ): { abort: () => void } {
    const messageB64 = Buffer.from(message, 'utf8').toString('base64');
    const sessionB64 = Buffer.from(sessionId || 'main', 'utf8').toString('base64');
    const wsScript = OPENCLAW_WS_CONNECT_HELPER + `

const message = Buffer.from('${messageB64}', 'base64').toString('utf8').trim();
const sessionKey = Buffer.from('${sessionB64}', 'base64').toString('utf8') || 'main';
if (!message) { console.error('__OPENCLAW_WS_FAILED__'); console.error('empty message'); process.exit(1); }

let done = false;
let collected = '';
let lastActivity = Date.now();
const sendId = 'send-' + Math.random().toString(16).slice(2);

const finish = (ok, reason) => {
  if (done) return;
  done = true;
  try { ws.close(); } catch {}
  if (ok) { process.exit(0); }
  else { console.error('__OPENCLAW_WS_FAILED__'); console.error(String(reason || 'unknown error')); process.exit(1); }
};
const IDLE_TIMEOUT = 300000;
const timer = setInterval(() => {
  if (done) return;
  if (Date.now() - lastActivity > IDLE_TIMEOUT) {
    clearInterval(timer);
    if (collected.trim()) finish(true);
    else finish(false, 'timeout waiting chat response (' + (IDLE_TIMEOUT / 1000) + 's idle)');
  }
}, 5000);

onConnected = () => {
  ws.send(JSON.stringify({ type: 'req', id: sendId, method: 'chat.send', params: { sessionKey, message, idempotencyKey: 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2) } }));
};
onConnectFailed = (msg) => { clearInterval(timer); finish(false, msg); };

onFrame = (frame) => {
  lastActivity = Date.now();
  if (frame.type === 'res') {
    if (frame.id === sendId && !frame.ok) return finish(false, (frame.error && frame.error.message) || 'chat.send failed');
    return;
  }
  if (frame.type !== 'event') return;
  const p = frame.payload || {};
  const stream = p.stream;
  const d = p.data || {};

  // v3: stream-based events (event name can be "agent", "chat", or anything)
  if (stream === 'assistant') {
    const chunk = d.delta || d.text || p.delta || p.text || '';
    if (chunk) { collected += chunk; process.stdout.write(chunk); }
    return;
  }
  if (stream === 'thinking') return;
  if (stream === 'tool') return;
  if (stream === 'lifecycle') {
    if (d.phase === 'end' || d.phase === 'complete') return finish(true, collected || '(done)');
    if (d.phase === 'error') return finish(false, d.error || d.message || 'lifecycle error');
    return;
  }
  if (stream) return;

  // legacy fallback (no stream field)
  if (p.state === 'delta' && typeof p.text === 'string') { collected += p.text; process.stdout.write(p.text); return; }
  if (p.state === 'final') {
    const t = (typeof p.text === 'string' && p.text.trim()) ? p.text : collected;
    if (typeof p.text === 'string' && p.text.trim() && !collected.trim()) process.stdout.write(p.text);
    return finish(!!t.trim(), t || 'empty final');
  }
  if (p.state === 'error') return finish(false, p.error || 'chat error');
  if (p.type === 'message_delta' && typeof p.delta === 'string') { collected += p.delta; process.stdout.write(p.delta); return; }
  if (p.type === 'message_end') {
    const t = (typeof p.text === 'string' && p.text.trim()) ? p.text : collected;
    if (typeof p.text === 'string' && p.text.trim() && !collected.trim()) process.stdout.write(p.text);
    return finish(!!t.trim(), t || 'empty');
  }
  if (p.type === 'agent_error') return finish(false, p.error || 'agent error');
};

wsOnClose = () => { if (!done) { finish(!!collected.trim(), collected || 'websocket closed before response'); } };
`;
    const scriptBase64 = Buffer.from(wsScript, 'utf8').toString('base64');
    const cmd = [
      'export PATH="$HOME/.npm-global/bin:$PATH"',
      `echo '${scriptBase64}' | base64 -d > /tmp/oc_chat_ws.js`,
      'chmod 700 /tmp/oc_chat_ws.js 2>/dev/null || true',
      'node /tmp/oc_chat_ws.js',
    ].join(' && ');

    return this.execCommand(device, cmd, (chunk) => {
      onChunk(chunk);
    }, onComplete, { pty: false, timeout: 600000 });
  }

  stopInteractiveChat(sessionId: string, device: Device | null): void {
    // 会话级 stop 不销毁共享 SSH 连接，避免多个页面/面板互相踢下线
    // 连接由 close/error 事件或应用生命周期统一回收
  }
}
