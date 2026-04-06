/**
 * OpenClaw 部署管理器 - TypeScript 版本
 * 移植自 rdkstudio_frontend-master
 */
import { Client } from 'ssh2';
import { createHash } from 'crypto';
import { SSH_READY_TIMEOUT_MS, SSH_KEEPALIVE_INTERVAL_MS, SSH_KEEPALIVE_COUNT_MAX } from '../ssh.js';
import * as fs from 'fs';
import * as path from 'path';
import { startOcBridgeRemote, type OcBridgeTransport } from './oc-bridge-transport.js';
import {
  OPENCLAW_BOARD_INSTALL_ENV_PRELUDE,
  OPENCLAW_ENSURE_NODE_MIN_VERSION_SNIPPET,
  OPENCLAW_ENSURE_NPM_SNIPPET,
  OPENCLAW_FAST_REGISTRY_SNIPPET,
  OPENCLAW_INSTALL_OPENCLAW_STEP,
  OPENCLAW_NPM_FAST_INSTALL_SNIPPET,
  OPENCLAW_PREPARE_NPM_SPEED,
  OPENCLAW_ENSURE_SHELL_PATH_SNIPPET,
  OPENCLAW_RESOLVE_CLI_SNIPPET,
} from './openclaw-board-install-sh.js';
import {
  boardOpenclawRemoteSkillsDir,
  syncBuiltinStudioSkillsOverSftp,
} from './board-openclaw-builtin-skills-sync.js';

/** 套件端一键安装/升级 SSH 超时（毫秒）。默认 45 分钟；环境变量 OPENCLAW_INSTALL_TIMEOUT_MS 覆盖（≥120000）。嵌入式弱网下 npm 全局装包可能显著超过 30 分钟。 */
export const OPENCLAW_INSTALL_TIMEOUT_MS = (() => {
  const raw = process.env.OPENCLAW_INSTALL_TIMEOUT_MS;
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n >= 120000) return Math.floor(n);
  return 2_700_000;
})();

/**
 * 所有持有该设备 OpenClaw 长连的 Socket 断开后，延迟多久若无新连接则关闭 oc-bridge + 池化 SSH。
 * 可由环境变量 RDK_OC_BRIDGE_IDLE_TEARDOWN_MS 覆盖（≥5000；未设置或非法则默认 60s）。
 */
export const OC_BRIDGE_IDLE_TEARDOWN_MS = (() => {
  const raw = process.env.RDK_OC_BRIDGE_IDLE_TEARDOWN_MS;
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n >= 5000) return Math.floor(n);
  return 60_000;
})();

export interface Device {
  ip: string;
  /** SSH 端口；缺省 22。经 frp 映射时多为 6000 等非 22，必须与设备档案一致 */
  port?: number;
  userName: string;
  password?: string;
  id?: string;
  name?: string;
  deviceType?: string;
  /** Normalized platform from board detect, e.g. rdk-x5 */
  boardPlatform?: string | null;
}

function isBoardRdkX5(device: Device): boolean {
  const platform = String(device.boardPlatform || '').toLowerCase();
  if (platform === 'rdk-x5' || platform === 'x5') return true;
  const type = String(device.deviceType || '').toLowerCase();
  if (/\brdk\s*-?\s*x5\b|\bx5\b/.test(type)) return true;
  const name = String(device.name || '').toLowerCase();
  if (/\brdk\s*-?\s*x5\b|\bx5\b/.test(name)) return true;
  return false;
}

/** SSH 连接池 / oc-bridge 缓存 key；同一公网 IP 下不同映射端口必须区分 */
export function sshEndpointKey(device: { ip: string; port?: number }): string {
  const raw = device.port;
  const p =
    typeof raw === 'number' && Number.isFinite(raw) && raw > 0 && raw <= 65535
      ? Math.floor(raw)
      : 22;
  return `${device.ip}:${p}`;
}

export interface GatewayStatus {
  running: boolean;
  version: string;
  /** true when `openclaw --version` succeeds（与网关进程是否监听 18789 无关） */
  installed: boolean;
  feishuConnected: boolean;
  weixinConnected: boolean;
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
  /**
   * 对齐 OpenClaw `agents.defaults`：思考档位与推理可见性。
   * 保存时按套件端 `openclaw --version` 写入 `reasoningDefault`（新）或 `reasoning`（旧），并迁移另一侧键以免启动失败。
   */
  agentDefaults?: {
    thinkingDefault?: string;
    /** 推理可见性（UI）；落盘键名由服务端根据套件端版本决定 */
    reasoning?: string;
  };
}

/** OpenClaw 文档常见取值；非常规值仍允许写入以兼容新版本 */
const OPENCLAW_THINKING_DEFAULTS_KNOWN = new Set([
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'adaptive',
]);
/** 与 OpenClaw runtime-schema `agents.defaults.reasoningDefault` 一致 */
const OPENCLAW_REASONING_DEFAULT_KNOWN = new Set(['off', 'on', 'stream']);

/** 从 stdout 中取首段 x.y 或 x.y.z；用于 `openclaw --version` */
function parseOpenClawVersionTuple(text: string): number[] | null {
  const lines = text.split(/[\r\n]+/);
  for (const line of lines) {
    const s = line.trim();
    if (!s) continue;
    const m = s.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
    if (m) {
      return [parseInt(m[1], 10), parseInt(m[2], 10), m[3] !== undefined ? parseInt(m[3], 10) : 0];
    }
  }
  return null;
}

function versionTupleAtLeast(a: number[], b: number[]): boolean {
  for (let i = 0; i < 3; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return true;
}

/**
 * true：向 openclaw.json 写入 `agents.defaults.reasoningDefault`（新 schema）；
 * false：写入 `reasoning` 并迁移/移除 `reasoningDefault`（旧版 CLI 常因未知键启动失败）。
 *
 * - `OPENCLAW_FORCE_LEGACY_AGENT_REASONING=1`：强制旧键
 * - `OPENCLAW_FORCE_REASONING_DEFAULT_KEY=1`：强制新键
 * - `OPENCLAW_REASONING_DEFAULT_MIN_VERSION`：日历版本年(≥2026)时与套件端版本比较；默认 2026.1.0
 * - 非日历主版本号（如 1.x）且主版本小于 2026：视为 semver≥1.0.0 即使用新键（可与 MIN_VERSION 并用调参）
 * - 探测失败：保守走旧键，避免再写入新键导致启动失败
 */
function openclawShouldUseReasoningDefaultKey(versionStdout: string, versionCmdOk: boolean): boolean {
  if (process.env.OPENCLAW_FORCE_LEGACY_AGENT_REASONING === '1' || process.env.OPENCLAW_FORCE_LEGACY_AGENT_REASONING === 'true') {
    return false;
  }
  if (process.env.OPENCLAW_FORCE_REASONING_DEFAULT_KEY === '1' || process.env.OPENCLAW_FORCE_REASONING_DEFAULT_KEY === 'true') {
    return true;
  }
  const minRaw = process.env.OPENCLAW_REASONING_DEFAULT_MIN_VERSION?.trim() || '2026.1.0';
  const minParts = parseOpenClawVersionTuple(minRaw) ?? [2026, 1, 0];

  if (!versionCmdOk) return false;

  const parts = parseOpenClawVersionTuple(versionStdout);
  if (!parts) return false;

  if (parts[0] >= 2026) {
    return versionTupleAtLeast(parts, minParts);
  }
  return versionTupleAtLeast(parts, [1, 0, 0]);
}

/** 套件端合并 openclaw.json：argv1=patch b64，argv2=1 使用 reasoningDefault / 0 使用 reasoning 并自愈旧配置 */
const OPENCLAW_MERGE_PY =
  `import json,os,sys,base64,traceback
def _strip(v):
  if v is None:
    return ''
  return str(v).strip()
try:
 p=os.path.expanduser('~/.openclaw/openclaw.json')
 os.makedirs(os.path.dirname(p),exist_ok=True)
 d=json.load(open(p)) if os.path.exists(p) else {}
 pat=json.loads(base64.b64decode(sys.argv[1]).decode())
 USE_RD=len(sys.argv)>2 and str(sys.argv[2]).strip()=='1'
 def merge(a,b):
  for k,v in b.items():
   if k in a and isinstance(a.get(k),dict) and isinstance(v,dict):merge(a[k],v)
   else:a[k]=v
 merge(d,pat)
 # models.mode（如 "merge"）为 CLI/内部合并提示，写盘时若保留可能触发运行时不认识键导致网关拒绝启动
 _md=d.get('models')
 if isinstance(_md,dict):
  _md.pop('mode',None)
 if 'channels' in pat and 'feishu' in pat['channels']:
  d.setdefault('channels',{})['feishu']=pat['channels']['feishu']
 _ag=d.get('agents')
 if isinstance(_ag,dict):
  _defs=_ag.get('defaults')
  if isinstance(_defs,dict):
   if USE_RD:
    if not _strip(_defs.get('reasoningDefault')) and _strip(_defs.get('reasoning')):
     _defs['reasoningDefault']=_defs.get('reasoning')
    if 'reasoning' in _defs:
     del _defs['reasoning']
   else:
    if not _strip(_defs.get('reasoning')) and _strip(_defs.get('reasoningDefault')):
     _defs['reasoning']=_defs.get('reasoningDefault')
    if 'reasoningDefault' in _defs:
     del _defs['reasoningDefault']
 _tw=d.setdefault('tools',{})
 _w=_tw.setdefault('web',{})
 _s=_w.setdefault('search',{})
 _pv=_s.get('provider')
 if _pv is None or (isinstance(_pv,str) and str(_pv).strip()==''):
  _s['provider']='duckduckgo'
  if _s.get('enabled') is None:
   _s['enabled']=True
  if _s.get('maxResults') is None:
   _s['maxResults']=5
 _rdk_ag=d.setdefault('agents',{})
 _rdk_df=_rdk_ag.setdefault('defaults',{})
 _rdk_ms=_rdk_df.get('memorySearch')
 if not isinstance(_rdk_ms,dict):
  _rdk_ms={}
 else:
  _rdk_ms=dict(_rdk_ms)
 _rdk_ms['enabled']=False
 _rdk_df['memorySearch']=_rdk_ms
 _rdk_ag['defaults']=_rdk_df
 d['agents']=_rdk_ag
 json.dump(d,open(p,'w'),indent=2,ensure_ascii=False)
 v=json.load(open(p))
 mp=((v.get('models') or {}).get('providers') or {}).get('custom-gateway')
 ap=((v.get('agents') or {}).get('defaults') or {}).get('model',{}).get('primary','')
 ag=((v.get('agents') or {}).get('defaults') or {})
 td=ag.get('thinkingDefault') or ''
 rv=_strip(ag.get('reasoningDefault')) or _strip(ag.get('reasoning'))
 _ag_ms=ag.get('memorySearch') if isinstance(ag.get('memorySearch'),dict) else {}
 _ag_mse=_ag_ms.get('enabled')
 ws=((v.get('tools') or {}).get('web') or {}).get('search') or {}
 wsp=str(ws.get('provider','') or '—')
 rk='reasoningDefault' if USE_RD else 'reasoning'
 print('[OpenClaw] 配置已更新 | model-provider:',('ok' if mp else 'missing'),'| primary:',ap or 'none','| thinkingDefault:',td or '—','|',rk+':',rv or '—','| web_search:',wsp,'| memorySearch.enabled:',_ag_mse)
except Exception as e:
 traceback.print_exc()
 print('[OpenClaw] 配置写入失败:',str(e))
 sys.exit(1)`;

const OPENCLAW_MERGE_PY_B64 = Buffer.from(OPENCLAW_MERGE_PY, 'utf8').toString('base64');
/** 空 patch：仅触发 oc_merge.py 侧默认策略（含关闭 memorySearch） */
const OPENCLAW_EMPTY_MERGE_PATCH_B64 = Buffer.from('{}', 'utf8').toString('base64');

/** oc_merge 失败不阻断安装/onboard（无 python、磁盘只读等时常见） */
const OPENCLAW_MERGE_EMPTY_LENIENT_SHELL = `( echo '${OPENCLAW_MERGE_PY_B64}' | base64 -d > /tmp/oc_merge.py && python3 /tmp/oc_merge.py '${OPENCLAW_EMPTY_MERGE_PATCH_B64}' '1' ) 2>&1 || echo "[OpenClaw] oc_merge 失败（已跳过，可稍后同步配置）" >&2`;

// 常量定义
const NPM_NVM_CLEANUP =
  '(npm config delete prefix 2>/dev/null || true) && (npm config delete globalconfig 2>/dev/null || true)';
const CLAWHUB_TOKEN = process.env.CLAWHUB_TOKEN ?? '';
/** 禁止在「then …;」与「else」之间插 &&——会生成 `; && else` 导致 bash 语法错误，后续安装步骤可能被跳过或整段异常 */
const CLAWHUB_AUTO_LOGIN_CMD = [
  'CLAWHUB_CMD="$(command -v clawhub 2>/dev/null || true)"',
  'if [ -z "$CLAWHUB_CMD" ] && [ -x "$HOME/.npm-global/bin/clawhub" ]; then CLAWHUB_CMD="$HOME/.npm-global/bin/clawhub"; fi',
  `if [ -n "$CLAWHUB_CMD" ]; then "$CLAWHUB_CMD" login --token ${CLAWHUB_TOKEN} 2>&1 || echo "[OpenClaw] ClawHub 登录失败" >&2; else true; fi`,
].join(' && ');
/** NO_COLOR/FORCE_COLOR：减少安装脚本与 npm 的 ANSI，Web 端日志仍经 strip-ansi 兜底 */
const BOARD_ENV_EXPORT = 'export NPM_CONFIG_PREFIX="$HOME/.npm-global" && export PATH="$HOME/.npm-global/bin:$PATH" && export NO_COLOR=1 FORCE_COLOR=0';
/**
 * SSH 非登录会话下常见：未设置 XDG_RUNTIME_DIR → systemctl --user 报 “Failed to connect to bus”。
 * 在 Linux 上尽量补全用户态 systemd 与 dbus 套接字（与 openclaw 上游 systemd 探测一致）。
 */
export const GATEWAY_SSH_USER_SYSTEMD_ENV = [
  'if [ -z "${XDG_RUNTIME_DIR:-}" ] && [ -d "/run/user/$(id -u)" ]; then export XDG_RUNTIME_DIR="/run/user/$(id -u)"; fi',
  'if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ] && [ -n "${XDG_RUNTIME_DIR:-}" ] && [ -S "${XDG_RUNTIME_DIR}/bus" ]; then export DBUS_SESSION_BUS_ADDRESS="unix:path=${XDG_RUNTIME_DIR}/bus"; fi',
].join(' && ');
/** systemd 优先；restart 失败时再 try start（避免服务已停时 restart 无进程可重启） */
export const RESTART_GATEWAY_FALLBACK =
  '(' +
  GATEWAY_SSH_USER_SYSTEMD_ENV +
  '; systemctl --user restart openclaw-gateway 2>/dev/null || systemctl --user start openclaw-gateway 2>/dev/null || (if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" gateway restart 2>/dev/null || "$OPENCLAW_CMD" daemon restart 2>/dev/null || "$OPENCLAW_CMD" restart 2>/dev/null; else false; fi) || (command -v clawctl >/dev/null 2>&1 && (clawctl gateway restart 2>/dev/null || clawctl restart 2>/dev/null || clawctl gateway start 2>/dev/null || clawctl start 2>/dev/null)) || true)';
/** 嵌入 `bash -lc "..."` 双引号参数时，对子 shell 内双引号转义 */
export const RESTART_GATEWAY_FALLBACK_BASH_LC_DQ = RESTART_GATEWAY_FALLBACK.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
/** 与 RESTART_GATEWAY_FALLBACK 一致：单重 ( ) 子 shell，禁止 (( ))——否则 bash 按算术解析会失败 */
export const START_GATEWAY_FALLBACK =
  '(if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" gateway start 2>&1 || "$OPENCLAW_CMD" daemon start 2>&1 || "$OPENCLAW_CMD" start 2>&1; else false; fi) || (command -v clawctl >/dev/null 2>&1 && (clawctl gateway start 2>&1 || clawctl start 2>&1)) || true';
/**
 * 当 user systemd 与 gateway install 守护进程均不可用（常见于无 linger 的 SSH）时，
 * 后台启动 openclaw gateway run（foreground 进程），使 127.0.0.1:18789 仍可探活。
 */
export const NOHUP_GATEWAY_RUN_FALLBACK =
  '(if [ -n "$OPENCLAW_CMD" ]; then ' +
  'echo "[OpenClaw] 尝试 nohup 后台: gateway run --port 18789 --bind loopback --force（见 /tmp/openclaw-gateway-studio.log）" >&2; ' +
  'nohup "$OPENCLAW_CMD" gateway run --port 18789 --bind loopback --force >> /tmp/openclaw-gateway-studio.log 2>&1 & ' +
  'disown 2>/dev/null || true; ' +
  'sleep 2; ' +
  'else echo "[OpenClaw] 无 OPENCLAW_CMD，跳过 nohup gateway run" >&2; fi) || true';
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
# Studio 探活固定 18789；仅修正缺省/空/历史模板 8080，保留用户显式其它端口
try:
    _p = int(g.get("port")) if g.get("port") not in (None, "") else None
except (TypeError, ValueError):
    _p = None
if _p is None or _p == 8080:
    g["port"] = 18789
d["gateway"] = g

with open(p, "w", encoding="utf-8") as f:
    json.dump(d, f, indent=2, ensure_ascii=False)
`.trim(), 'utf8').toString('base64');

const ENSURE_GATEWAY_AUTH_TOKEN_SCRIPT_B64 = Buffer.from(`
import json
import os
import secrets

p = os.path.expanduser("~/.openclaw/openclaw.json")
os.makedirs(os.path.dirname(p), exist_ok=True)

try:
  with open(p, "r", encoding="utf-8") as f:
    d = json.load(f)
except Exception:
  d = {}

g = d.get("gateway") if isinstance(d.get("gateway"), dict) else {}
auth = g.get("auth") if isinstance(g.get("auth"), dict) else {}
token = str(auth.get("token") or "").strip()

if not token:
  token = secrets.token_urlsafe(32)
  auth["token"] = token
  g["auth"] = auth
  d["gateway"] = g
  with open(p, "w", encoding="utf-8") as f:
    json.dump(d, f, indent=2, ensure_ascii=False)
`.trim(), 'utf8').toString('base64');

/** base64/ python 任一失败均不阻断安装链（与 `&&` 串联时避免 silent skip：此前 decode 失败会导致根本未执行 python） */
const ENSURE_GATEWAY_LOCAL_MODE = `( echo '${ENSURE_GATEWAY_LOCAL_MODE_SCRIPT_B64}' | base64 -d > /tmp/oc_fix_gateway_mode.py && python3 /tmp/oc_fix_gateway_mode.py ) 2>&1 || echo "[OpenClaw] gateway mode 脚本失败（已跳过）" >&2`;
const ENSURE_GATEWAY_AUTH_TOKEN = `( echo '${ENSURE_GATEWAY_AUTH_TOKEN_SCRIPT_B64}' | base64 -d > /tmp/oc_fix_gateway_token.py && python3 /tmp/oc_fix_gateway_token.py ) 2>&1 || echo "[OpenClaw] gateway token 脚本失败（已跳过）" >&2`;
const RUN_DOCTOR =
  '(if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" doctor --fix --yes 2>&1 || "$OPENCLAW_CMD" doctor --fix 2>&1 || "$OPENCLAW_CMD" doctor 2>&1 || echo "[OpenClaw] doctor 失败" >&2; else true; fi)';
const RUN_HEALTH =
  '(if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" health --json 2>&1 || "$OPENCLAW_CMD" status --all 2>&1 || "$OPENCLAW_CMD" status 2>&1 || echo "[OpenClaw] health 失败" >&2; else true; fi)';
/** 与 board 安装脚本共用，避免 npm prefix 空 → /bin/openclaw */
const RESOLVE_OPENCLAW_CMD = OPENCLAW_RESOLVE_CLI_SNIPPET;

const OPENCLAW_VERSION_PROBE_CMD = [
  'export PATH="$HOME/.npm-global/bin:$PATH"',
  RESOLVE_OPENCLAW_CMD,
  '(if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" --version 2>&1; fi)',
].join(' && ');

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
    client: { id: CLIENT_ID, version: '1.0.1', platform: os.platform(), mode: CLIENT_MODE },
    role: ROLE,
    scopes: SCOPES,
    device: signChallenge(nonce, ts),
    locale: 'zh-CN',
    userAgent: 'rdkstudio/1.0.1',
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
const WS_BACKOFF_MIN_MS = 1000;
const WS_BACKOFF_MAX_MS = 30000;
const MAX_WS_CONNECT_ATTEMPTS = 12;
let wsReconnectBackoffMs = WS_BACKOFF_MIN_MS;
let wsReconnectTimer = null;
let wsConnectFailCount = 0;
let ws;

let wsOnClose = null;

function clearWsReconnectTimer() {
  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = null;
  }
}

function scheduleWsReconnect() {
  clearWsReconnectTimer();
  wsConnectFailCount++;
  if (wsConnectFailCount > MAX_WS_CONNECT_ATTEMPTS) {
    onConnectFailed('websocket connect failed after ' + MAX_WS_CONNECT_ATTEMPTS + ' attempts (127.0.0.1:18789)');
    return;
  }
  const delay = wsReconnectBackoffMs;
  wsReconnectBackoffMs = Math.min(wsReconnectBackoffMs * 2, WS_BACKOFF_MAX_MS);
  console.error('[WS] connect retry ' + wsConnectFailCount + '/' + MAX_WS_CONNECT_ATTEMPTS + ' in ' + delay + 'ms');
  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = null;
    ws = connectWs();
  }, delay);
}

function connectWs() {
  clearWsReconnectTimer();
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
      wsConnectFailCount = 0;
      wsReconnectBackoffMs = WS_BACKOFF_MIN_MS;
      onConnected();
      return;
    }
    onFrame(frame);
  };
  sock.onerror = () => {};
  sock.onclose = () => {
    if (wsConnected) {
      wsConnected = false;
      if (wsOnClose) wsOnClose();
      return;
    }
    scheduleWsReconnect();
  };
  return sock;
}
ws = connectWs();
`;

/**
 * 套件端一次性 shell：通过 127.0.0.1:18789 WebSocket + `chat.send` 验证模型链路。
 * 新版 OpenClaw CLI 的 `openclaw message` 为渠道子命令（send/poll/…），不再用于网关对话；
 * Agent 工具 board_openclaw_model_test 必须走此路径，与 UI 一键「模型测试」一致。
 */
export function buildBoardOpenClawModelTestRemoteShell(): string {
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

  if (p.state === 'delta' && typeof p.text === 'string') { text += p.text; return; }
  if (p.state === 'final') { clearTimeout(timer); return finish(!!(p.text || text).trim(), p.text || text || 'empty final'); }
  if (p.state === 'error') { clearTimeout(timer); return finish(false, p.error || 'chat error'); }
  if (p.type === 'message_delta' && typeof p.delta === 'string') { text += p.delta; return; }
  if (p.type === 'message_end') { clearTimeout(timer); return finish(!!(p.text || text).trim(), p.text || text || 'empty'); }
  if (p.type === 'agent_error') { clearTimeout(timer); return finish(false, p.error || 'agent error'); }
};

wsOnClose = () => { if (!done) { clearTimeout(timer); finish(false, 'websocket closed unexpectedly'); } };
`;
  const jsB64 = Buffer.from(jsScript, 'utf8').toString('base64');
  return [
    'export PATH="$HOME/.npm-global/bin:$PATH"',
    `echo '${jsB64}' | base64 -d > /tmp/oc_model_test.js`,
    'node /tmp/oc_model_test.js',
  ].join(' && ');
}

/** 一键部署日志：分段横线（与前端步骤条「依赖 / 安装」对应） */
const STUDIO_DEPLOY_LOG_DIV = 'echo "────────────────────────────────────────────────────────"';

const GATEWAY_PORT_CHECK = `python3 -c 'import socket; s=socket.socket(socket.AF_INET,socket.SOCK_STREAM); s.settimeout(1.0); ok=(s.connect_ex(("127.0.0.1",18789))==0); s.close(); print("OPEN" if ok else "CLOSED")'`;
const GATEWAY_DIAG_LOGS = [
  'echo "--- openclaw logs ---"',
  '(if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" logs --limit 200 2>&1 || true; else echo "openclaw CLI 未找到，跳过 openclaw logs"; fi)',
  'echo "--- journalctl (user/openclaw-gateway) ---"',
  '(journalctl --user -u openclaw-gateway --no-pager -n 120 2>&1 || true)',
  'echo "--- /tmp/openclaw log files ---"',
  '(ls -1t /tmp/openclaw/openclaw-*.log 2>/dev/null | head -n 3 | while read f; do echo "=== $f ==="; tail -n 120 "$f" 2>/dev/null || true; done || true)',
].join(' ; ');

/**
 * `devices approve --latest` 在无待审批时常打印 “No pending…” 却以非零退出；网关已就绪时通常表示 CLI 已信任，不应阻断整段安装。
 */
const RDK_OC_GATEWAY_PAIR_APPROVE_BENIGN_RE =
  'no pending|nothing to approve|no[[:space:]]+pending|no .*requests to approve|already paired|already approved|nothing pending|not pending|no devices?[[:space:]]+to approve';

/**
 * 套件端 shell：与本机 Gateway 建立设备信任（与 UI gateway-pair 一致）。
 * - 新版 OpenClaw：`openclaw devices approve --latest`（`pair` 子命令已移除）
 * - 旧版：回退 `openclaw pair --force` / `pair --reset`
 * - 对 “no pending” 类输出：最多重试 3 次（网关刚就绪时的竞态），仍失败则视为可继续。
 */
const RDK_OC_GATEWAY_PAIR_APPROVE_INLINE =
  'rdk_pe=1; rdk_po=""; ' +
  'for rdk_attempt in 1 2 3; do ' +
  'rdk_po="$("$OPENCLAW_CMD" devices approve --latest 2>&1)"; rdk_pe=$?; ' +
  '[ "$rdk_pe" -eq 0 ] && break; ' +
  `echo "$rdk_po" | grep -qiE "${RDK_OC_GATEWAY_PAIR_APPROVE_BENIGN_RE}" && { rdk_pe=0; break; }; ` +
  '[ "$rdk_attempt" -lt 3 ] && sleep 2; ' +
  'done; ' +
  'if [ "$rdk_pe" -ne 0 ] && echo "$rdk_po" | grep -qiE "unknown command.*devices"; then rdk_po="$("$OPENCLAW_CMD" pair --force 2>&1)"; rdk_pe=$?; fi; ' +
  `if [ "$rdk_pe" -ne 0 ] && echo "$rdk_po" | grep -qiE "${RDK_OC_GATEWAY_PAIR_APPROVE_BENIGN_RE}"; then rdk_pe=0; fi; ` +
  'echo "$rdk_po"; ' +
  `if [ "$rdk_pe" -eq 0 ] && echo "$rdk_po" | grep -qiE "${RDK_OC_GATEWAY_PAIR_APPROVE_BENIGN_RE}"; then echo "[OpenClaw] CLI↔Gateway：无待审批设备（视为已信任），继续部署" >&2; fi; ` +
  'if [ "${OPENCLAW_STRICT_GATEWAY_TRUST:-0}" = "1" ] && [ "$rdk_pe" -ne 0 ]; then exit "$rdk_pe"; fi; ' +
  'if [ "${RDK_OC_PAIR_LENIENT:-0}" = "1" ] && [ "$rdk_pe" -ne 0 ]; then echo "[OpenClaw] 警告: CLI↔Gateway 信任未完成（见上文）；流程仍继续。若报 pairing required 请使用面板「一键配对」。" >&2; rdk_pe=0; fi; ' +
  'exit "$rdk_pe"';

/** 必须包在子 shell 中，避免外层 `prev && …` 与后续 `; for` 被 bash 拆成无条件执行 */
const RDK_OC_GATEWAY_PAIR_APPROVE_SUBSHELL = '( ' + RDK_OC_GATEWAY_PAIR_APPROVE_INLINE + ' )';
const RDK_OC_GATEWAY_PAIR_APPROVE_SNIPPET = RDK_OC_GATEWAY_PAIR_APPROVE_SUBSHELL;

/**
 * 安装 / 升级 / 重启 Gateway 之后：等待 127.0.0.1:18789 再建立 CLI↔Gateway 信任。
 * 默认宽容：端口暂不可用、`devices approve` 失败等不阻断整段安装（套件端设 `OPENCLAW_STRICT_GATEWAY_TRUST=1` 可恢复遇错即停）。
 * 面板「一键配对 / 重置并配对」走 `buildBoardOpenClawGatewayPairRemoteShell`，不设置 RDK_OC_PAIR_LENIENT。
 */
const ENSURE_GATEWAY_CLI_TRUST_AFTER_RESTART = [
  BOARD_ENV_EXPORT,
  RESOLVE_OPENCLAW_CMD,
  'if [ -z "$OPENCLAW_CMD" ]; then echo "[OpenClaw] 跳过 CLI↔Gateway 信任：未找到 openclaw CLI"; else ' +
    'export RDK_OC_PAIR_LENIENT=1; ' +
    'echo "[OpenClaw] 等待 127.0.0.1:18789 后建立网关信任（devices approve / pair）..." && ' +
    'ok=0 && ' +
    `for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do st="$(${GATEWAY_PORT_CHECK} 2>/dev/null | tr -d '\\r\\n')"; if [ "$st" = "OPEN" ]; then ok=1; break; fi; sleep 1; done && ` +
    'if [ "$ok" = "1" ]; then ' +
    RDK_OC_GATEWAY_PAIR_APPROVE_SUBSHELL +
    '; else echo "[OpenClaw] Gateway 端口未就绪，跳过 CLI 信任（安装/同步仍继续）。可稍后 restart 网关或面板「一键配对」。" >&2; ' +
    GATEWAY_DIAG_LOGS +
    '; fi; fi',
].join(' && ');

const ENSURE_GATEWAY_READY_AND_TRUST = [
  ENSURE_GATEWAY_AUTH_TOKEN,
  RESTART_GATEWAY_FALLBACK,
  'echo "[OpenClaw] Gateway 重启命令已执行，等待端口就绪..."',
  `ok=0; for i in 1 2 3 4 5 6 7 8 9 10 11 12; do st="$(${GATEWAY_PORT_CHECK} 2>/dev/null | tr -d '\\r\\n')"; if [ "$st" = "OPEN" ]; then ok=1; break; fi; sleep 1; done`,
  `if [ "$ok" != "1" ]; then echo "[OpenClaw] 端口仍未就绪，尝试主动启动..."; ${GATEWAY_SSH_USER_SYSTEMD_ENV} && ${START_GATEWAY_FALLBACK}; fi`,
  `if [ "$ok" != "1" ]; then for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24; do st="$(${GATEWAY_PORT_CHECK} 2>/dev/null | tr -d '\\r\\n')"; if [ "$st" = "OPEN" ]; then ok=1; break; fi; sleep 1; done; fi`,
  `if [ "$ok" != "1" ]; then echo "[OpenClaw] 仍无监听，尝试 nohup gateway run（SSH 无 user systemd 时）..."; ${NOHUP_GATEWAY_RUN_FALLBACK}; fi`,
  `if [ "$ok" != "1" ]; then for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24; do st="$(${GATEWAY_PORT_CHECK} 2>/dev/null | tr -d '\\r\\n')"; if [ "$st" = "OPEN" ]; then ok=1; break; fi; sleep 1; done; fi`,
  `if [ "$ok" = "1" ]; then echo "[OpenClaw] Gateway 已就绪并监听 127.0.0.1:18789"; ` +
    `if [ -n "$OPENCLAW_CMD" ]; then export RDK_OC_PAIR_LENIENT=1; echo "[OpenClaw] 建立 CLI↔Gateway 信任（devices approve / pair）..."; ${RDK_OC_GATEWAY_PAIR_APPROVE_SUBSHELL} || true; else true; fi; ` +
    `else echo "[OpenClaw] Gateway 端口未就绪（127.0.0.1:18789）"; ${GATEWAY_DIAG_LOGS}; exit 1; fi`,
].join(' && ');

const GATEWAY_RESTART_CMD =
  `${BOARD_ENV_EXPORT} && ${RESOLVE_OPENCLAW_CMD} && ${RESTART_GATEWAY_FALLBACK} && ${ENSURE_GATEWAY_CLI_TRUST_AFTER_RESTART} && echo "[OpenClaw] Gateway 已重启"`;

/**
 * Studio 一键安装后默认安装元技能 find-skills。
 * ClawHub CLI：`clawhub install <技能短名>`（文档示例：`clawhub install summarize`）；与 `clawhub clone owner/skill` 不同。
 * `RDK_SKIP_BOARD_FIND_SKILLS=1` 可跳过。
 *
 * 安装完成后由 TypeScript 侧将 Studio 仓库 `skills/` + `rdkx5_skills/` SFTP 到套件端 `~/.openclaw/workspace/skills/`（见 syncBuiltinStudioSkills / RDK_SKIP_BOARD_BUILTIN_SKILLS_SYNC）。
 */
const BOARD_FIND_SKILLS_INSTALL =
  process.env.RDK_SKIP_BOARD_FIND_SKILLS === '1' || process.env.RDK_SKIP_BOARD_FIND_SKILLS === 'true'
    ? 'echo "[OpenClaw] RDK_SKIP_BOARD_FIND_SKILLS 已设置，跳过 find-skills"'
    : [
        STUDIO_DEPLOY_LOG_DIV,
        'echo "[Studio] 默认安装 SkillHub 元技能 find-skills（失败不阻断安装流程）"',
        STUDIO_DEPLOY_LOG_DIV,
        'CLAWHUB_CMD="$(command -v clawhub 2>/dev/null || true)"',
        'if [ -z "$CLAWHUB_CMD" ] && [ -x "$HOME/.npm-global/bin/clawhub" ]; then CLAWHUB_CMD="$HOME/.npm-global/bin/clawhub"; fi',
        'if [ -n "$CLAWHUB_CMD" ]; then "$CLAWHUB_CMD" install find-skills 2>&1 || echo "[OpenClaw] find-skills 跳过（已存在或安装失败）" >&2; else echo "[OpenClaw] 无 clawhub，跳过 find-skills" >&2; fi',
      ].join(' && ');

export const NPM_INSTALL_CMD = [
  STUDIO_DEPLOY_LOG_DIV,
  'echo "[Studio] 安装 OpenClaw（npm / ClawHub / 网关）"',
  STUDIO_DEPLOY_LOG_DIV,
  BOARD_ENV_EXPORT,
  OPENCLAW_BOARD_INSTALL_ENV_PRELUDE,
  OPENCLAW_ENSURE_NODE_MIN_VERSION_SNIPPET,
  OPENCLAW_ENSURE_NPM_SNIPPET,
  OPENCLAW_INSTALL_OPENCLAW_STEP,
  OPENCLAW_ENSURE_SHELL_PATH_SNIPPET,
  RESOLVE_OPENCLAW_CMD,
  CLAWHUB_AUTO_LOGIN_CMD,
  BOARD_FIND_SKILLS_INSTALL,
  ENSURE_GATEWAY_LOCAL_MODE,
  ENSURE_GATEWAY_AUTH_TOKEN,
  NPM_NVM_CLEANUP,
  RUN_DOCTOR,
  RESTART_GATEWAY_FALLBACK,
  ENSURE_GATEWAY_CLI_TRUST_AFTER_RESTART,
  RUN_HEALTH,
  'echo "[OpenClaw] 安装完成"',
].join(' && ');

/** 与 runPrepare() 相同；单独 API 与一键部署合并路径共用 */
export const OPENCLAW_PREPARE_CMD = [
  [BOARD_ENV_EXPORT, OPENCLAW_ENSURE_NODE_MIN_VERSION_SNIPPET, OPENCLAW_ENSURE_NPM_SNIPPET, RESOLVE_OPENCLAW_CMD].join(' && '),
  STUDIO_DEPLOY_LOG_DIV,
  'echo "[Studio] 环境准备（Node / npm / 目录）"',
  STUDIO_DEPLOY_LOG_DIV,
  'node --version 2>&1 || true',
  'npm --version 2>&1 || true',
  'mkdir -p "$HOME/.openclaw" "$HOME/.npm-global"',
  'npm config set prefix "$HOME/.npm-global" 2>/dev/null ; npm config set fund false 2>/dev/null ; npm config set update-notifier false 2>/dev/null',
  OPENCLAW_PREPARE_NPM_SPEED,
  '(if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" --version 2>&1; else echo "openclaw: 未安装"; fi)',
  ENSURE_GATEWAY_LOCAL_MODE,
  ENSURE_GATEWAY_AUTH_TOKEN,
  'command -v npm >/dev/null 2>&1',
].join(' ; ');

/** 仍需单次 SSH 合并时：准备子 shell 成功后衔接 NPM_INSTALL_CMD（安装段首已有分割线） */
export const OPENCLAW_DEPLOY_PREPARE_AND_INSTALL_CMD = `( ${OPENCLAW_PREPARE_CMD} ) && ${NPM_INSTALL_CMD}`;

export function buildBoardOpenClawGatewayPairRemoteShell(mode: 'force' | 'full'): string {
  const pairForce = [
    BOARD_ENV_EXPORT,
    RESOLVE_OPENCLAW_CMD,
    'if [ -z "$OPENCLAW_CMD" ]; then echo "[OpenClaw] gateway pair 失败：未找到 openclaw CLI"; exit 1; fi',
    RDK_OC_GATEWAY_PAIR_APPROVE_SNIPPET,
  ].join(' && ');
  const pairFull = [
    BOARD_ENV_EXPORT,
    RESOLVE_OPENCLAW_CMD,
    'if [ -z "$OPENCLAW_CMD" ]; then echo "[OpenClaw] gateway pair 失败：未找到 openclaw CLI"; exit 1; fi',
    'echo "[OpenClaw] 停止 Gateway..."',
    '"$OPENCLAW_CMD" gateway stop 2>/dev/null || true',
    `(${GATEWAY_SSH_USER_SYSTEMD_ENV}; systemctl --user stop openclaw-gateway 2>/dev/null || true)`,
    'echo "[OpenClaw] 清理待处理设备配对请求..."',
    '("$OPENCLAW_CMD" devices clear --yes --pending 2>&1) || true',
    'echo "[OpenClaw] 旧版 CLI: pair --reset（若不存在则跳过）..."',
    '("$OPENCLAW_CMD" pair --reset 2>&1) || true',
    'echo "[OpenClaw] 启动 Gateway..."',
    ENSURE_GATEWAY_LOCAL_MODE,
    `${GATEWAY_SSH_USER_SYSTEMD_ENV} && ${START_GATEWAY_FALLBACK}`,
    'echo "[OpenClaw] 等待 127.0.0.1:18789..."',
    `ok=0; for i in 1 2 3 4 5 6 7 8 9 10 11 12; do st="$(${GATEWAY_PORT_CHECK} 2>/dev/null | tr -d '\\r\\n')"; if [ "$st" = "OPEN" ]; then ok=1; break; fi; sleep 1; done`,
    `if [ "$ok" != "1" ]; then echo "[OpenClaw] 端口仍未就绪，尝试 nohup gateway run..."; ${NOHUP_GATEWAY_RUN_FALLBACK}; fi`,
    `if [ "$ok" != "1" ]; then for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do st="$(${GATEWAY_PORT_CHECK} 2>/dev/null | tr -d '\\r\\n')"; if [ "$st" = "OPEN" ]; then ok=1; break; fi; sleep 1; done; fi`,
    `if [ "$ok" != "1" ]; then echo "[OpenClaw] Gateway 端口未就绪"; ${GATEWAY_DIAG_LOGS}; exit 1; fi`,
    'echo "[OpenClaw] Gateway 已就绪 127.0.0.1:18789"',
    RDK_OC_GATEWAY_PAIR_APPROVE_SNIPPET,
  ].join(' && ');
  return mode === 'full' ? pairFull : pairForce;
}

const NPM_UPGRADE_CMD = [
  BOARD_ENV_EXPORT,
  OPENCLAW_BOARD_INSTALL_ENV_PRELUDE,
  OPENCLAW_ENSURE_NODE_MIN_VERSION_SNIPPET,
  OPENCLAW_ENSURE_NPM_SNIPPET,
  RESOLVE_OPENCLAW_CMD,
  // 优先 CLI update，失败回退 npm 双源重试
  '(if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" update --no-restart 2>&1 || "$OPENCLAW_CMD" update 2>&1; else false; fi) || (echo "[OpenClaw] update 失败，改 npm" >&2 && ' +
    OPENCLAW_NPM_FAST_INSTALL_SNIPPET +
    ')',
  OPENCLAW_ENSURE_SHELL_PATH_SNIPPET,
  BOARD_FIND_SKILLS_INSTALL,
  ENSURE_GATEWAY_LOCAL_MODE,
  ENSURE_GATEWAY_AUTH_TOKEN,
  NPM_NVM_CLEANUP,
  RUN_DOCTOR,
  RESTART_GATEWAY_FALLBACK,
  ENSURE_GATEWAY_CLI_TRUST_AFTER_RESTART,
  RUN_HEALTH,
  'echo "[OpenClaw] 升级完成"',
].join(' && ');

/**
 * 解析 `nmcli -t -f SSID device wifi list`：每行一个 SSID，或 `SSID:名称`。
 * 排除表头、隐藏网占位「--」。
 */
function parseWifiSsidsTerse(output: string): string[] {
  const names = (output || '')
    .split(/\r?\n/)
    .map((s) => {
      let t = s.trim();
      if (t.startsWith('SSID:')) t = t.slice(5).trim();
      return t;
    })
    .filter((s) => s && s !== 'SSID' && s !== '--');
  return [...new Set(names)];
}

/** 匹配 BSSID（MAC），用于在表格行中定位 SSID 列（避免 IN-USE 为空时按列分割错位） */
const NMCLI_WIFI_MAC_RE = /\b([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}\b/;

/**
 * 解析 `nmcli device wifi list` 表格（与终端一致）：在 BSSID 之后、MODE 等之前取 SSID。
 */
function parseWifiSsidsFromNmcliTable(output: string): string[] {
  const lines = (output || '').split(/\r?\n/).map((l) => l.replace(/\x1b\[[0-9;]*m/g, ''));
  const names: string[] = [];
  let sawHeader = false;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (/\bSSID\b/.test(line) && /\bBSSID\b/.test(line)) {
      sawHeader = true;
      continue;
    }
    if (!sawHeader) continue;
    const m = line.match(NMCLI_WIFI_MAC_RE);
    if (!m || m.index === undefined) continue;
    const afterMac = line.slice(m.index + m[0].length).trim();
    const parts = afterMac.split(/\s{2,}/);
    const ssid = parts[0]?.trim();
    if (ssid && ssid !== '--') names.push(ssid);
  }
  return [...new Set(names)];
}

/**
 * 含 IN-USE/BSSID/SSID 表头时必须先走表格解析；若先走 terse 会把整行误当成 SSID。
 */
function parseWifiSsidsFromNmcliOutput(output: string): string[] {
  const text = output || '';
  if (/\bSSID\b/.test(text) && /\bBSSID\b/.test(text)) {
    return parseWifiSsidsFromNmcliTable(text);
  }
  return parseWifiSsidsTerse(text);
}

export class OpenClawDeploymentManager {
  /** oc-bridge 可安全重试一轮（仅在无 assistant/tool 输出时由 Studio 再建桥重试一次） */
  private static readonly OC_BRIDGE_TRANSIENT_CODES = new Set([
    'WS_CLOSED',
    'WS_SEND_EXCEPTION',
    'WS_CONNECT_RETRY_EXHAUSTED',
    'CONNECT_FAILED',
  ]);

  private static readonly OC_BRIDGE_TRANSPORT_RETRY_MS = 400;

  private static isTransientBridgeTurnFailure(
    doneReason: string | undefined,
    sawTransientCode: boolean,
    receivedAnyOutput: boolean,
  ): boolean {
    if (receivedAnyOutput) return false;
    if (sawTransientCode) return true;
    const r = String(doneReason ?? '').toLowerCase();
    return /ws closed|websocket closed|not connected|econnrefused|socket hang up|broken pipe/.test(r);
  }

  private sshPool: Map<string, Promise<Client>> = new Map();
  private resourcesPath: string;

  /** 套件端 ~/.rdk-studio/oc-bridge.mjs 已同步（按 IP 缓存） */
  private ocBridgeScriptOk = new Set<string>();
  /** 已同步脚本内容签名（按 endpoint 缓存），本地脚本变更时自动重新下发 */
  private ocBridgeScriptSigByIp = new Map<string, string>();
  /** 常驻 NDJSON 桥（每设备一条 exec 流） */
  private ocBridgeTransportByIp = new Map<string, OcBridgeTransport>();
  /** 同一设备串行发送，避免交错 reqId */
  private ocBridgeSendChain = new Map<string, Promise<void>>();
  /** 仍有 Socket 挂着该板卡 OpenClaw UI 时的租约；归零后经 idle 再 destroyConnection */
  private ocBridgeSocketLeaseByIp = new Map<string, number>();
  private ocBridgeIdleTeardownTimerByIp = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(resourcesPath: string) {
    this.resourcesPath = resourcesPath;
  }

  /** 浏览器 Socket 与该板卡建立 OpenClaw 会话时调用；disconnect 时须 release */
  acquireOpenClawBridgeLease(ip: string): void {
    const trimmed = String(ip || '').trim();
    if (!trimmed) return;
    this.clearOcBridgeIdleTeardownTimer(trimmed);
    this.ocBridgeSocketLeaseByIp.set(trimmed, (this.ocBridgeSocketLeaseByIp.get(trimmed) ?? 0) + 1);
  }

  /** Socket 断开时调用；最后一支释放后延迟回收桥接 */
  releaseOpenClawBridgeLease(ip: string): void {
    const trimmed = String(ip || '').trim();
    if (!trimmed) return;
    const cur = this.ocBridgeSocketLeaseByIp.get(trimmed) ?? 0;
    if (cur <= 1) {
      this.ocBridgeSocketLeaseByIp.delete(trimmed);
      if (cur >= 1) {
        this.scheduleOcBridgeIdleTeardown(trimmed);
      }
      return;
    }
    this.ocBridgeSocketLeaseByIp.set(trimmed, cur - 1);
  }

  private clearOcBridgeIdleTeardownTimer(ip: string): void {
    const t = this.ocBridgeIdleTeardownTimerByIp.get(ip);
    if (t) {
      clearTimeout(t);
      this.ocBridgeIdleTeardownTimerByIp.delete(ip);
    }
  }

  private scheduleOcBridgeIdleTeardown(ip: string): void {
    this.clearOcBridgeIdleTeardownTimer(ip);
    this.ocBridgeIdleTeardownTimerByIp.set(
      ip,
      setTimeout(() => {
        this.ocBridgeIdleTeardownTimerByIp.delete(ip);
        if (!this.ocBridgeSocketLeaseByIp.has(ip)) {
          this.destroyConnection(ip);
        }
      }, OC_BRIDGE_IDLE_TEARDOWN_MS),
    );
  }

  private getScriptPath(name: string): string {
    return path.join(this.resourcesPath, 'openclaw', name);
  }

  /** 开发态：cwd/server/resources；打包：build-resources/openclaw */
  private getOcBridgeSourcePath(): string {
    const candidates = [
      path.join(this.resourcesPath, 'openclaw', 'oc-bridge.mjs'),
      path.join(process.cwd(), 'server/resources/openclaw/oc-bridge.mjs'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    throw new Error('oc-bridge.mjs not found (server/resources/openclaw/oc-bridge.mjs)');
  }

  private ensureOcBridgeScriptOnDevice(device: Device): Promise<boolean> {
    const key = sshEndpointKey(device);
    let src: string;
    try {
      src = fs.readFileSync(this.getOcBridgeSourcePath(), 'utf8');
    } catch {
      return Promise.resolve(false);
    }
    const localSig = createHash('sha256').update(src).digest('hex');
    if (this.ocBridgeScriptOk.has(key) && this.ocBridgeScriptSigByIp.get(key) === localSig) {
      return Promise.resolve(true);
    }
    const b64 = Buffer.from(src, 'utf8').toString('base64');
    const cmd = [
      'mkdir -p ~/.rdk-studio',
      `echo '${b64}' | base64 -d > ~/.rdk-studio/oc-bridge.mjs`,
      'chmod 700 ~/.rdk-studio/oc-bridge.mjs',
      'test -s ~/.rdk-studio/oc-bridge.mjs',
    ].join(' && ');
    return new Promise((resolve) => {
      this.execCommand(
        device,
        cmd,
        () => {},
        (ok) => {
          if (ok) {
            this.ocBridgeScriptOk.add(key);
            this.ocBridgeScriptSigByIp.set(key, localSig);
          }
          resolve(ok);
        },
        { timeout: 120000 },
      );
    });
  }

  private async getOrCreateBridgeTransport(device: Device): Promise<OcBridgeTransport | null> {
    const key = sshEndpointKey(device);
    const existing = this.ocBridgeTransportByIp.get(key);
    if (existing) return existing;
    const scriptOk = await this.ensureOcBridgeScriptOnDevice(device);
    if (!scriptOk) return null;
    const client = await this.getClient(device);
    const remoteCmd =
      'bash -lc \'export PATH="$HOME/.npm-global/bin:$PATH" && exec node ~/.rdk-studio/oc-bridge.mjs\'';
    const transport = await startOcBridgeRemote(client, remoteCmd, () => {
      this.ocBridgeTransportByIp.delete(key);
    });
    if (!transport) return null;
    try {
      await transport.waitForBridgeReady(45000);
    } catch (e) {
      try {
        transport.destroy();
      } catch {
        /* ignore */
      }
      this.ocBridgeTransportByIp.delete(key);
      return null;
    }
    this.ocBridgeTransportByIp.set(key, transport);
    return transport;
  }

  /** 同一设备上 oc-bridge 对话串行（套件端桥内部也有队列，Studio 侧再串行避免 reqId 乱序） */
  private runOcBridgeSerial<T>(endpointKey: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.ocBridgeSendChain.get(endpointKey) ?? Promise.resolve();
    const p = prev.then(() => fn());
    this.ocBridgeSendChain.set(endpointKey, p.then(() => {}).catch(() => {}));
    return p;
  }

  /** noVNC / IDE 等经 SSH 隧道访问套件端服务时复用与 OpenClaw 相同的连接池与端口配置 */
  getSshClientForDevice(device: Device): Promise<Client> {
    return this.getClient(device);
  }

  private async getClient(device: Device): Promise<Client> {
    const key = sshEndpointKey(device);
    const sshPort =
      typeof device.port === 'number' && Number.isFinite(device.port) && device.port > 0 && device.port <= 65535
        ? Math.floor(device.port)
        : 22;
    const cached = this.sshPool.get(key);
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
      this.sshPool.delete(key);
    }

    const promise = new Promise<Client>((resolve, reject) => {
      const client = new Client();
      client
        .on('ready', () => resolve(client))
        .on('error', (err) => {
          this.sshPool.delete(key);
          reject(err);
        })
        .on('close', () => this.sshPool.delete(key))
        .connect({
          host: device.ip,
          port: sshPort,
          username: device.userName,
          password: device.password || device.userName,
          readyTimeout: SSH_READY_TIMEOUT_MS,
          keepaliveInterval: SSH_KEEPALIVE_INTERVAL_MS,
          keepaliveCountMax: SSH_KEEPALIVE_COUNT_MAX,
        });
    });

    this.sshPool.set(key, promise);
    promise.catch(() => this.sshPool.delete(key));
    return promise;
  }

  /** 关掉套件端桥 SSH 流并从缓存移除；下次 getOrCreate 会新建（用于断线后安全重试） */
  private invalidateOcBridgeTransport(device: Device): void {
    const key = sshEndpointKey(device);
    const br = this.ocBridgeTransportByIp.get(key);
    if (br) {
      try {
        br.destroy();
      } catch {
        /* ignore */
      }
      this.ocBridgeTransportByIp.delete(key);
    }
  }

  destroyConnection(endpointKey: string): void {
    this.clearOcBridgeIdleTeardownTimer(endpointKey);
    const br = this.ocBridgeTransportByIp.get(endpointKey);
    if (br) {
      try {
        br.destroy();
      } catch {
        /* ignore */
      }
      this.ocBridgeTransportByIp.delete(endpointKey);
    }
    this.ocBridgeSendChain.delete(endpointKey);
    this.ocBridgeScriptOk.delete(endpointKey);
    this.ocBridgeScriptSigByIp.delete(endpointKey);
    const p = this.sshPool.get(endpointKey);
    if (!p) return;
    this.sshPool.delete(endpointKey);
    p.then((client) => { try { client.end(); } catch (_) {} }).catch(() => {});
  }

  destroyAllConnections(): void {
    for (const [ip] of this.sshPool) {
      this.destroyConnection(ip);
    }
  }

  private static isTransientSshError(error: unknown): boolean {
    const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    return /timed out|timeout|handshake|econnreset|econnrefused|socket closed|connection reset|connect failed|broken pipe|network|epipe/.test(msg);
  }

  private static SSH_RETRY_DELAY_MS = 1500;
  private static SSH_MAX_RETRIES = 2;

  execCommand(
    device: Device,
    command: string,
    onOutput: (chunk: string) => void,
    onComplete: (success: boolean, code?: number) => void,
    execOpts: { pty?: boolean | any; timeout?: number } = {}
  ): { abort: () => void } {
    let finished = false;
    let activeStream: any = null;
    let aborted = false;
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
            this.destroyConnection(sshEndpointKey(device));
            finish(false, -1);
          }
        }, effectiveTimeout)
      : undefined;

    const handle = {
      abort: () => {
        if (finished) return;
        aborted = true;
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

    const attemptExec = (retriesLeft: number) => {
      if (finished || aborted) return;
      this.getClient(device).then((client) => {
        if (finished || aborted) return;
        client.exec(command, opts, (err, stream) => {
          if (err) {
            this.destroyConnection(sshEndpointKey(device));
            if (retriesLeft > 0 && !aborted && OpenClawDeploymentManager.isTransientSshError(err)) {
              console.warn(`[OCM] exec transient error on ${sshEndpointKey(device)}, retrying (${retriesLeft} left): ${err.message}`);
              setTimeout(() => attemptExec(retriesLeft - 1), OpenClawDeploymentManager.SSH_RETRY_DELAY_MS);
              return;
            }
            onOutput(`[ERROR] ${err.message}\n`);
            finish(false);
            return;
          }
          activeStream = stream;
          stream.on('data', (data: Buffer) => { if (!finished) onOutput(data.toString()); });
          stream.stderr?.on('data', (data: Buffer) => { if (!finished) onOutput(data.toString()); });
          stream.on('close', (code: number) => finish(code === 0, code));
        });
      }).catch((err: any) => {
        this.destroyConnection(sshEndpointKey(device));
        if (retriesLeft > 0 && !aborted && OpenClawDeploymentManager.isTransientSshError(err)) {
          console.warn(`[OCM] connection error on ${sshEndpointKey(device)}, retrying (${retriesLeft} left): ${err.message}`);
          setTimeout(() => attemptExec(retriesLeft - 1), OpenClawDeploymentManager.SSH_RETRY_DELAY_MS);
          return;
        }
        onOutput(`[SSH Error] ${err.message}\n`);
        finish(false);
      });
    };

    attemptExec(OpenClawDeploymentManager.SSH_MAX_RETRIES);
    return handle;
  }

  runCheck(device: Device, onOutput: (chunk: string) => void, onComplete: (success: boolean) => void): { abort: () => void } {
    const cmd = [
      BOARD_ENV_EXPORT,
      RESOLVE_OPENCLAW_CMD,
      'echo "=== OpenClaw 诊断 ==="',
      'echo "--- 版本 ---"',
      '(if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" --version 2>&1; else echo "openclaw 未安装"; fi)',
      'echo ""',
      'echo "--- Gateway 状态 ---"',
      `${GATEWAY_PORT_CHECK} 2>/dev/null || echo "CLOSED"`,
      '(systemctl --user status openclaw-gateway --no-pager -n 20 2>&1 || true)',
      'echo ""',
      'echo "--- Health ---"',
      '(if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" status --all 2>&1 || "$OPENCLAW_CMD" status 2>&1 || echo "status 不可用"; else echo "status 不可用"; fi)',
      'echo ""',
      'echo "--- Doctor ---"',
      '(if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" doctor 2>&1 || echo "doctor 不可用"; else echo "doctor 不可用"; fi)',
      'echo ""',
      'echo "--- Node/NPM ---"',
      'node --version 2>&1 || echo "node 未安装"',
      'npm --version 2>&1 || echo "npm 未安装"',
      'echo "=== 诊断完成 ==="',
    ].join(' ; ');
    return this.execCommand(device, cmd, onOutput, onComplete, { timeout: 60000 });
  }

  runCheckLight(device: Device, onOutput: (chunk: string) => void, onComplete: (success: boolean) => void): { abort: () => void } {
    const cmd = [
      BOARD_ENV_EXPORT,
      RESOLVE_OPENCLAW_CMD,
      'echo "=== OpenClaw 快速检查 ==="',
      'echo "--- 版本 ---"',
      '(if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" --version 2>&1; else echo "openclaw 未安装"; fi)',
      'echo ""',
      'echo "--- Gateway 端口 ---"',
      `${GATEWAY_PORT_CHECK} 2>/dev/null || echo "CLOSED"`,
      'echo ""',
      'echo "--- 状态 ---"',
      '(if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" status --all 2>&1 || "$OPENCLAW_CMD" status 2>&1 || echo "status 不可用"; else echo "status 不可用"; fi)',
      'echo ""',
      'echo "--- Node/NPM ---"',
      'node --version 2>&1 || echo "node 未安装"',
      'npm --version 2>&1 || echo "npm 未安装"',
      'echo "=== 快速检查完成 ==="',
    ].join(' ; ');
    return this.execCommand(device, cmd, onOutput, onComplete, { timeout: 25000 });
  }

  runPrepare(device: Device, onOutput: (chunk: string) => void, onComplete: (success: boolean) => void): { abort: () => void } {
    // 与 runInstall 一致：准备阶段可能 apt / NodeSource，嵌入式上常 >2 分钟；pty 便于实时刷日志
    return this.execCommand(device, OPENCLAW_PREPARE_CMD, onOutput, onComplete, {
      pty: true,
      timeout: OPENCLAW_INSTALL_TIMEOUT_MS,
    });
  }

  /** 单次 SSH：环境准备 + 安装（等同 runPrepare 后接 runInstall；一键部署默认已拆成两步） */
  runDeployPrepareAndInstall(
    device: Device,
    onOutput: (chunk: string) => void,
    onComplete: (success: boolean) => void,
  ): { abort: () => void } {
    return this.execCommand(device, OPENCLAW_DEPLOY_PREPARE_AND_INSTALL_CMD, onOutput, (success) => {
      if (!success) {
        onComplete(false);
        return;
      }
      void this.runBuiltinSkillsSyncAfterInstall(device, onOutput).finally(() => onComplete(true));
    }, {
      pty: true,
      timeout: OPENCLAW_INSTALL_TIMEOUT_MS,
    });
  }

  runNetworkCheck(device: Device, onOutput: (chunk: string) => void, onComplete: (success: boolean) => void): { abort: () => void } {
    // 注意：必须用 if/( ) 子shell，不能用 (( ))——后者在 bash 中是算术扩展，无法执行 ping/curl，会导致误判 NETWORK_OFFLINE
    const cmd = [
      BOARD_ENV_EXPORT,
      'echo "=== 网络连通性检查 ==="',
      '(ip route 2>/dev/null | head -n 5 || true)',
      'net_ok=0',
      'if ping -c 1 -W 2 223.5.5.5 >/dev/null 2>&1 || ping -c 1 -W 2 8.8.8.8 >/dev/null 2>&1; then net_ok=1; fi',
      'if [ "$net_ok" != "1" ]; then if curl -sI --connect-timeout 3 --max-time 6 https://registry.npmjs.org >/dev/null 2>&1 || wget -q --spider --timeout=6 https://registry.npmjs.org >/dev/null 2>&1; then net_ok=1; fi; fi',
      'if [ "$net_ok" = "1" ]; then echo "NETWORK_READY"; else echo "NETWORK_OFFLINE"; exit 1; fi',
    ].join(' ; ');
    return this.execCommand(device, cmd, onOutput, onComplete, { timeout: 25000 });
  }

  runInstall(device: Device, onOutput: (chunk: string) => void, onComplete: (success: boolean) => void): { abort: () => void } {
    return this.execCommand(device, NPM_INSTALL_CMD, onOutput, (success) => {
      if (!success) {
        onComplete(false);
        return;
      }
      void this.runBuiltinSkillsSyncAfterInstall(device, onOutput).finally(() => onComplete(true));
    }, { pty: true, timeout: OPENCLAW_INSTALL_TIMEOUT_MS });
  }

  /**
   * 将 Studio 当前工作目录下内置的 `skills/`、`rdkx5_skills/` 同步到套件端 OpenClaw workspace（SFTP）。
   * 安装流程结束后会自动调用；亦可被 Agent `board_openclaw_install` 或手工补救使用。
   * 设 `RDK_SKIP_BOARD_BUILTIN_SKILLS_SYNC=1` 可跳过。
   */
  async syncBuiltinStudioSkillsToBoard(device: Device, onOutput: (chunk: string) => void): Promise<boolean> {
    if (process.env.RDK_SKIP_BOARD_BUILTIN_SKILLS_SYNC === '1' || process.env.RDK_SKIP_BOARD_BUILTIN_SKILLS_SYNC === 'true') {
      onOutput('[Studio] RDK_SKIP_BOARD_BUILTIN_SKILLS_SYNC 已设置，跳过内置 skill 同步\n');
      return true;
    }
    try {
      const client = await this.getClient(device);
      const remote = boardOpenclawRemoteSkillsDir(device.userName);
      const includeRdkx5Skills = isBoardRdkX5(device);
      onOutput(
        `[Studio] 板型判定：${
          includeRdkx5Skills
            ? 'RDK X5（同步 rdkx5_skills 全量）'
            : '非 X5（不同步 rdkx5_skills；S100/Ultra/X3 走文档类 skills，套件端能力包见 ensure-board-skill-bundle）'
        }\n`,
      );
      const r = await syncBuiltinStudioSkillsOverSftp(client, remote, process.cwd(), onOutput, {
        includeRdkx5Skills,
      });
      return r.ok;
    } catch (e) {
      onOutput(`[Studio] WARN 内置 skill 同步异常: ${e instanceof Error ? e.message : String(e)}\n`);
      return false;
    }
  }

  private async runBuiltinSkillsSyncAfterInstall(device: Device, onOutput: (chunk: string) => void): Promise<void> {
    if (process.env.RDK_SKIP_BOARD_BUILTIN_SKILLS_SYNC === '1' || process.env.RDK_SKIP_BOARD_BUILTIN_SKILLS_SYNC === 'true') {
      onOutput('[Studio] RDK_SKIP_BOARD_BUILTIN_SKILLS_SYNC 已设置，跳过内置 skill 同步\n');
      return;
    }
    try {
      const client = await this.getClient(device);
      const remote = boardOpenclawRemoteSkillsDir(device.userName);
      const includeRdkx5Skills = isBoardRdkX5(device);
      onOutput(
        `[Studio] 板型判定：${
          includeRdkx5Skills
            ? 'RDK X5（同步 rdkx5_skills 全量）'
            : '非 X5（不同步 rdkx5_skills；S100/Ultra/X3 走文档类 skills，套件端能力包见 ensure-board-skill-bundle）'
        }\n`,
      );
      await syncBuiltinStudioSkillsOverSftp(client, remote, process.cwd(), onOutput, {
        includeRdkx5Skills,
      });
    } catch (e) {
      onOutput(
        `[Studio] WARN 内置 skill 同步失败（OpenClaw 已安装，可稍后重试或调 API ensure-board-skill-bundle）: ` +
          `${e instanceof Error ? e.message : String(e)}\n`,
      );
    }
  }

  runUpgrade(device: Device, onOutput: (chunk: string) => void, onComplete: (success: boolean) => void): void {
    this.execCommand(device, NPM_UPGRADE_CMD, onOutput, onComplete, { pty: true, timeout: OPENCLAW_INSTALL_TIMEOUT_MS });
  }

  runUninstall(device: Device, onOutput: (chunk: string) => void, onComplete: (success: boolean) => void): void {
    const cmd = [
      BOARD_ENV_EXPORT,
      RESOLVE_OPENCLAW_CMD,
      'echo "[OpenClaw] 开始卸载..."',

      'echo "[1/6] 停止 gateway 服务..."',
      '(if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" gateway stop 2>/dev/null || true; fi)',
      '(systemctl --user stop openclaw-gateway 2>/dev/null || true)',

      'echo "[2/6] 执行官方卸载..."',
      '(if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" uninstall --all --yes --non-interactive 2>&1 || true; else echo "[OpenClaw] 未找到 openclaw CLI，跳过官方卸载（继续执行兜底清理）"; fi)',

      'echo "[3/6] 卸载 systemd 服务..."',
      '(if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" gateway uninstall 2>/dev/null || true; fi)',
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
    this.execCommand(device, cmd, onOutput, onComplete, { pty: true, timeout: 300000 });
  }

  getGatewayStatus(device: Device, onResult: (status: GatewayStatus) => void, onOutput?: (chunk: string) => void): void {
    const pyScript = `import json, os, subprocess
result = {"running": False, "version": "", "installed": False, "feishuConnected": False, "weixinConnected": False}
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
    env["PATH"] = os.path.expanduser("~/.npm-global/bin") + ":" + os.path.expanduser("~/.local/bin") + ":" + env.get("PATH", "")
    out = subprocess.check_output(["openclaw", "--version"], env=env, stderr=subprocess.DEVNULL, timeout=5).decode().strip()
    result["version"] = out
    result["installed"] = bool(out)
except:
    pass
try:
    p = os.path.expanduser("~/.openclaw/openclaw.json")
    if os.path.exists(p):
        d = json.load(open(p))
        feishu = (d.get("channels") or {}).get("feishu") or {}
        result["feishuConnected"] = bool(feishu.get("enabled") and feishu.get("appId"))
        plugins = (d.get("plugins") or {}).get("entries") or {}
        wx = plugins.get("openclaw-weixin") or {}
        result["weixinConnected"] = bool(wx.get("enabled"))
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
      onResult({ running: false, version: '', installed: false, feishuConnected: false, weixinConnected: false });
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
  env["PATH"] = os.path.expanduser("~/.npm-global/bin") + ":" + os.path.expanduser("~/.local/bin") + ":" + env.get("PATH", "")
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
result={"modelGateway":{"baseUrl":"","apiKey":"","api":"openai-completions","modelId":"doubao-1.5-pro-256k","modelName":"豆包 (Doubao)"},"feishu":{"appId":"","appSecret":"","connectionMode":"websocket","domain":"feishu","dmPolicy":"pairing","verificationToken":"","encryptKey":""},"runtimeModel":{"provider":"","modelId":"","apiKey":""},"primaryModel":"","configuredProviders":[],"pluginsAllow":[],"allProviders":{},"agentDefaults":{"thinkingDefault":"","reasoning":""}}
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
  result["modelGateway"].update({"baseUrl":provider.get('baseUrl','') or '',"apiKey":provider.get('apiKey','') or '',"api":api_value,"modelId":model.get('id','doubao-1.5-pro-256k') or 'doubao-1.5-pro-256k',"modelName":model.get('name','豆包 (Doubao)') or '豆包 (Doubao)'})
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
  agdef=((d.get('agents') or {}).get('defaults')) or {}
  _td=agdef.get('thinkingDefault')
  _rv=agdef.get('reasoningDefault')
  if _rv is None or (isinstance(_rv,str) and str(_rv).strip()==''):
    _rv=agdef.get('reasoning')
  result['agentDefaults']={
    'thinkingDefault': str(_td).strip() if isinstance(_td,(str,int,float)) else '',
    'reasoning': str(_rv).strip() if isinstance(_rv,(str,int,float)) else '',
  }
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
    }, { timeout: 30000 });
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
      RESOLVE_OPENCLAW_CMD,
      'echo "[OpenClaw] 开始初始化配置..."',
      `openclaw onboard --non-interactive ${acceptRisk} ${skipHealth} ${gatewayBind} --auth-choice ${provider} --${provider} '${escapedKey}' --install-daemon 2>&1`,
      'echo "[OpenClaw] 初始化完成"',
      'echo "[RDK Studio] 套件端默认关闭 memorySearch（无 embedding 时避免 memory_search 失败；记忆请用桌面或读文件）"',
      OPENCLAW_MERGE_EMPTY_LENIENT_SHELL,
      ENSURE_GATEWAY_LOCAL_MODE,
      RESTART_GATEWAY_FALLBACK,
      ENSURE_GATEWAY_CLI_TRUST_AFTER_RESTART,
    ].join(' && ');
    this.execCommand(device, cmd, onOutput, onComplete, { pty: true, timeout: 300000 });
  }

  updateConfig(
    device: Device,
    config: {
      modelGateway?: {
        baseUrl?: string;
        apiKey?: string;
        modelId?: string;
        modelName?: string;
        api?: string;
        /**
         * `replace_primary`：写入 `custom-gateway` 并设为主模型（默认）。
         * `preset_only`：写入独立 `rdk-studio-default`，不修改主模型，供用户在套件端设置中自行切换启用。
         */
        placement?: 'replace_primary' | 'preset_only';
      };
      feishu?: any;
      pluginsAllow?: string[];
      agentDefaults?: { thinkingDefault?: string; reasoning?: string };
    },
    onOutput: (chunk: string) => void,
    onComplete: (success: boolean) => void
  ): { abort: () => void } {
    const patch: any = {};
    if (config.modelGateway?.baseUrl && config.modelGateway?.apiKey) {
      const modelId = config.modelGateway.modelId || 'default-model';
      const modelName = config.modelGateway.modelName || modelId;
      const placement = config.modelGateway.placement === 'preset_only' ? 'preset_only' : 'replace_primary';
      const providerKey = placement === 'preset_only' ? 'rdk-studio-default' : 'custom-gateway';
      // 勿写 models.mode：磁盘 schema 通常不包含该键，严格校验时可能导致网关无法启动；深度合并由 oc_merge.py 完成
      patch.models = {
        providers: {
          [providerKey]: {
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
      if (placement === 'replace_primary') {
        patch.agents = { defaults: { model: { primary: `${providerKey}/${modelId}` } } };
      } else {
        onOutput(
          '[OpenClaw] 已写入 Studio 建议模型到 models.providers.rdk-studio-default（未改主模型）；可在套件端 OpenClaw 设置中将主模型切换为 rdk-studio-default/' +
            modelId +
            ' 以启用。\n',
        );
      }
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
    let pendingReasoningVisibility = '';
    if (config.agentDefaults) {
      const td = String(config.agentDefaults.thinkingDefault ?? '').trim();
      pendingReasoningVisibility = String(config.agentDefaults.reasoning ?? '').trim();
      if (td) {
        if (!OPENCLAW_THINKING_DEFAULTS_KNOWN.has(td)) {
          onOutput(
            `[OpenClaw] 提示: thinkingDefault="${td}" 不在常见列表内，仍将写入（请确认当前 openclaw 版本支持）\n`,
          );
        }
        patch.agents = patch.agents || { defaults: {} };
        patch.agents.defaults = { ...(patch.agents.defaults || {}), thinkingDefault: td };
      }
      if (pendingReasoningVisibility) {
        if (!OPENCLAW_REASONING_DEFAULT_KNOWN.has(pendingReasoningVisibility)) {
          onOutput(
            `[OpenClaw] 提示: 推理可见性="${pendingReasoningVisibility}" 不在常见列表 off/on/stream 内，仍将按套件端兼容键写入\n`,
          );
        }
      }
    }
    if (Object.keys(patch).length === 0 && !pendingReasoningVisibility) {
      onOutput('[OpenClaw] 无有效配置项，跳过更新\n');
      onComplete(true);
      return { abort: () => {} };
    }

    let versionProbeHandle: { abort: () => void } | undefined;
    let mergeHandle: { abort: () => void } | undefined;
    let cancelled = false;

    const runMerge = (useReasoningDefaultKey: boolean) => {
      if (cancelled) return;
      const finalPatch = JSON.parse(JSON.stringify(patch)) as Record<string, unknown>;
      if (pendingReasoningVisibility) {
        const agents = (finalPatch.agents as Record<string, unknown> | undefined) || {};
        const defs = (agents.defaults as Record<string, unknown> | undefined) || {};
        const reasoningKey = useReasoningDefaultKey ? 'reasoningDefault' : 'reasoning';
        agents.defaults = { ...defs, [reasoningKey]: pendingReasoningVisibility };
        finalPatch.agents = agents;
      }
      const flag = useReasoningDefaultKey ? '1' : '0';
      const patchB64 = Buffer.from(JSON.stringify(finalPatch), 'utf8').toString('base64');
      const cmd = [
        'export PATH="$HOME/.npm-global/bin:$PATH"',
        RESOLVE_OPENCLAW_CMD,
        `( echo '${OPENCLAW_MERGE_PY_B64}' | base64 -d > /tmp/oc_merge.py && python3 /tmp/oc_merge.py '${patchB64}' '${flag}' ) 2>&1 || echo "[OpenClaw] oc_merge 失败（已跳过写入，可稍后重试保存配置）" >&2`,
        ENSURE_GATEWAY_LOCAL_MODE,
        ENSURE_GATEWAY_READY_AND_TRUST,
        'echo "[OpenClaw] 保存与 Gateway 重启流程已结束（若曾提示 oc_merge 失败请稍后在设置中重试保存）"',
      ].join(' && ');
      mergeHandle = this.execCommand(device, cmd, onOutput, onComplete, { timeout: 180000 });
    };

    let versionOutput = '';
    versionProbeHandle = this.execCommand(
      device,
      OPENCLAW_VERSION_PROBE_CMD,
      (chunk) => {
        versionOutput += chunk;
        if (pendingReasoningVisibility) onOutput(chunk);
      },
      (probeOk) => {
        const useRD = openclawShouldUseReasoningDefaultKey(versionOutput, probeOk);
        const firstLine = versionOutput
          .split(/[\r\n]+/)
          .map((s) => s.trim())
          .find(Boolean);
        if (pendingReasoningVisibility) {
          onOutput(
            `[OpenClaw] 推理可见性 → agents.defaults.${useRD ? 'reasoningDefault' : 'reasoning'}${firstLine ? ` | ${firstLine}` : ''}\n`,
          );
        }
        runMerge(useRD);
      },
      { timeout: 15000 },
    );

    return {
      abort: () => {
        cancelled = true;
        versionProbeHandle?.abort();
        mergeHandle?.abort();
      },
    };
  }

  runRestartGateway(device: Device, onOutput: (chunk: string) => void, onComplete: (success: boolean) => void): void {
    const cmd = [
      'export PATH="$HOME/.npm-global/bin:$PATH"',
      RESOLVE_OPENCLAW_CMD,
      ENSURE_GATEWAY_LOCAL_MODE,
      ENSURE_GATEWAY_READY_AND_TRUST,
    ].join(' && ');
    this.execCommand(device, cmd, onOutput, onComplete, { timeout: 180000 });
  }

  runGetVersion(device: Device, onOutput: (chunk: string) => void, onComplete: (success: boolean) => void): void {
    const cmd = `export PATH="$HOME/.npm-global/bin:$PATH" && ${RESOLVE_OPENCLAW_CMD} && (if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" --version 2>/dev/null; else echo "未安装"; fi)`;
    this.execCommand(device, cmd, onOutput, onComplete, { timeout: 15000 });
  }

  runDoctor(device: Device, onOutput: (chunk: string) => void, onComplete: (success: boolean) => void): void {
    const cmd = `export PATH="$HOME/.npm-global/bin:$PATH" && ${RESOLVE_OPENCLAW_CMD} && ${ENSURE_GATEWAY_LOCAL_MODE} && (if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" doctor --fix 2>&1 || "$OPENCLAW_CMD" doctor 2>&1 || echo "[OpenClaw] doctor 命令不可用，可能未安装"; else echo "[OpenClaw] doctor 命令不可用，可能未安装"; fi)`;
    this.execCommand(device, cmd, onOutput, onComplete, { timeout: 180000 });
  }

  runModelTest(device: Device, onOutput: (chunk: string) => void, onComplete: (success: boolean) => void): void {
    this.execCommand(device, buildBoardOpenClawModelTestRemoteShell(), onOutput, onComplete, { timeout: 120000, pty: false });
  }

  runScriptInstall(device: Device, onOutput: (chunk: string) => void, onComplete: (success: boolean) => void): void {
    const cmd = [
      BOARD_ENV_EXPORT,
      OPENCLAW_BOARD_INSTALL_ENV_PRELUDE,
      OPENCLAW_ENSURE_NODE_MIN_VERSION_SNIPPET,
      OPENCLAW_ENSURE_NPM_SNIPPET,
      OPENCLAW_INSTALL_OPENCLAW_STEP,
      OPENCLAW_ENSURE_SHELL_PATH_SNIPPET,
      BOARD_FIND_SKILLS_INSTALL,
      'echo "[RDK Studio] 套件端默认关闭 memorySearch（避免未配置 embedding 时失败）"',
      OPENCLAW_MERGE_EMPTY_LENIENT_SHELL,
      ENSURE_GATEWAY_LOCAL_MODE,
      RESTART_GATEWAY_FALLBACK,
      ENSURE_GATEWAY_CLI_TRUST_AFTER_RESTART,
    ].join(' && ');
    this.execCommand(device, cmd, onOutput, onComplete, { pty: true, timeout: OPENCLAW_INSTALL_TIMEOUT_MS });
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
      RESOLVE_OPENCLAW_CMD,
      `echo "--- openclaw logs ---" ; (if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" logs --limit ${maxLines} 2>&1 || true; else echo "openclaw CLI 未找到"; fi) ; echo "--- journalctl ---" ; (journalctl --user -u openclaw-gateway --no-pager -n ${maxLines} 2>&1 || true) ; echo "--- /tmp/openclaw ---" ; (ls -1t /tmp/openclaw/openclaw-*.log 2>/dev/null | head -n 3 | while read f; do echo "=== $f ==="; tail -n ${Math.max(40, Math.min(300, Math.floor(maxLines / 2)))} "$f" 2>/dev/null || true; done || true)`,
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
      // List skill dirs and read SKILL.md frontmatter (name, description, trigger) for each.
      // 含：Studio 写入的 workspace/skills；clawhub 在 workdir=HOME 时的 ~/skills；/root 下常见路径。
      '(for d in /opt/openclaw/skills "$HOME/.openclaw/workspace/skills" "$HOME/skills" /root/.openclaw/workspace/skills /root/skills; do' +
      '  [ -d "$d" ] && for s in "$d"/*/; do' +
      '    [ -d "$s" ] || continue;' +
      '    sn=$(basename "$s");' +
      '    sm="$s/SKILL.md";' +
      '    if [ -f "$sm" ]; then' +
      '      desc=$(sed -n "/^---$/,/^---$/{ /^description:/{ s/^description: *//; p; q; } }" "$sm" 2>/dev/null);' +
      '      trigger=$(sed -n "/^---$/,/^---$/{ /^trigger:/{ s/^trigger: *//; p; q; } }" "$sm" 2>/dev/null);' +
      '      echo "$sn|$d/$sn|${desc:-无描述}|${trigger:-}";' +
      '    else' +
      '      echo "$sn|$d/$sn|无 SKILL.md|";' +
      '    fi;' +
      '  done;' +
      'done | sort -t"|" -k1,1 -u || true)',
      '[ -d /opt/openclaw/skills ] || [ -d "$HOME/.openclaw/workspace/skills" ] || [ -d "$HOME/skills" ] || [ -d /root/.openclaw/workspace/skills ] || [ -d /root/skills ] || echo "无已安装技能"',
      'echo "===CLAWHUB==="',
      '(command -v clawhub >/dev/null 2>&1 && clawhub list 2>/dev/null || true)',
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
    const cmd = `${BOARD_ENV_EXPORT} && ${RESOLVE_OPENCLAW_CMD} && (if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" pairing list ${channel} 2>&1 || echo "[OpenClaw] pairing list 失败"; else echo "[OpenClaw] pairing list 失败：未找到 openclaw CLI"; fi)`;
    this.execCommand(device, cmd, onOutput, onComplete, { timeout: 20000, pty: false });
  }

  runPairingApprove(
    device: Device,
    channel: string,
    code: string,
    onOutput: (chunk: string) => void,
    onComplete: (success: boolean) => void
  ): void {
    const cmd = `${BOARD_ENV_EXPORT} && ${RESOLVE_OPENCLAW_CMD} && (if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" pairing approve ${channel} ${code} 2>&1 || echo "[OpenClaw] pairing approve 失败"; else echo "[OpenClaw] pairing approve 失败：未找到 openclaw CLI"; fi)`;
    this.execCommand(device, cmd, onOutput, onComplete, { timeout: 20000, pty: false });
  }

  runPairingReject(
    device: Device,
    channel: string,
    code: string,
    onOutput: (chunk: string) => void,
    onComplete: (success: boolean) => void
  ): void {
    const cmd = `${BOARD_ENV_EXPORT} && ${RESOLVE_OPENCLAW_CMD} && (if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" pairing reject ${channel} ${code} 2>&1 || echo "[OpenClaw] 当前版本可能不支持 pairing reject"; else echo "[OpenClaw] pairing reject 失败：未找到 openclaw CLI"; fi)`;
    this.execCommand(device, cmd, onOutput, onComplete, { timeout: 20000, pty: false });
  }

  /**
   * 套件端建立本机 CLI ↔ Gateway 设备信任（与飞书 `pairing approve` 不同）。
   * 新版：`devices approve --latest`；旧版回退 `pair --force`；full：停网关 → clear pending → 旧版 `pair --reset`（可缺省）→ 重启等待 18789。
   */
  runGatewayPair(
    device: Device,
    mode: 'force' | 'full',
    onOutput: (chunk: string) => void,
    onComplete: (success: boolean) => void,
  ): void {
    const cmd = buildBoardOpenClawGatewayPairRemoteShell(mode);
    this.execCommand(device, cmd, onOutput, onComplete, { timeout: 180000, pty: true });
  }

  getWifiList(
    device: Device,
    onResult: (wifiNames: string[], success: boolean, errorHint?: string) => void,
  ): void {
    /**
     * 与用户在终端执行的一致：`nmcli device wifi list`（LANG=C 保证表头为 SSID/BSSID，便于解析）。
     * 不用 awk 管道；优先当前用户 nmcli，失败再 `sudo -n`。
     */
    const cmd =
      'bash --noprofile --norc -c ' +
      JSON.stringify(
        'LANG=C LC_ALL=C; (nmcli device wifi rescan 2>/dev/null || sudo -n nmcli device wifi rescan 2>/dev/null || true); sleep 3; ' +
          'nmcli device wifi list 2>/dev/null || sudo -n nmcli device wifi list 2>/dev/null',
      );
    let output = '';
    this.execCommand(device, cmd, (chunk) => { output += chunk; }, (success) => {
      const names = parseWifiSsidsFromNmcliOutput(output);
      if (names.length > 0) {
        onResult(names, true);
        return;
      }
      if (!success) {
        const sshAuthFail = /SSH Error|\[ERROR\]|All configured authentication methods failed/i.test(output);
        const hint = sshAuthFail
          ? `SSH 未连上套件端（当前使用端口 ${device.port ?? 22}）。经 frp 时请确认设备档案里 SSH 端口为映射端口（如 6000），并已重启 Studio 后端使修复生效。`
          : '套件端 WiFi 扫描失败：请确认已安装 NetworkManager、当前 SSH 用户可执行 nmcli（或已配置免密 sudo），并可在板上手动执行 nmcli device wifi list 对比。';
        onResult([], false, hint);
        return;
      }
      onResult([], true);
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

    // WIFI_SSID / WIFI_KEY：printf+base64 解码。必须用分号单行串联远程命令，勿用 bash -c "$(JSON 多行)"：
    // 经 SSH exec 时引号/反斜杠会被剥坏，导致 awk 报错、变量为空（用户见 \\n 字面量与空 SSID）。
    // 连接策略：已连目标 SSID 直接成功 -> 直连重试 -> 复用 profile -> 最后重建 profile。
    const script = [
      `set +e`,
      `WIFI_SSID=$(printf '%s' '${nameB64}' | base64 -d)`,
      `WIFI_KEY=$(printf '%s' '${pwdB64}' | base64 -d)`,
      `if [ -z "$WIFI_SSID" ]; then echo "[WiFi] FAIL"; exit 2; fi`,
      `nmcmd(){ nmcli "$@" 2>&1 || sudo -n nmcli "$@" 2>&1; }`,
      `WIFI_IF=$(nmcli -t -f DEVICE,TYPE device status 2>/dev/null | grep ':wifi$' | head -n1 | cut -d: -f1)`,
      `[ -z "$WIFI_IF" ] && WIFI_IF=wlan0`,
      `echo "[WiFi] 目标网络: $WIFI_SSID 接口: $WIFI_IF"`,
      `ACTIVE_CONN=$(nmcmd -t -f GENERAL.CONNECTION device show "$WIFI_IF" | sed -n 's/^GENERAL.CONNECTION://p' | head -n1)`,
      `if [ "$ACTIVE_CONN" = "$WIFI_SSID" ]; then CUR_IP=$(ip -4 addr show "$WIFI_IF" 2>/dev/null | awk '/inet /{print $2}' | cut -d/ -f1 | head -n1); if [ -n "$CUR_IP" ]; then echo "[WiFi] 已连接目标网络，跳过重连"; echo "[WiFi] OK IP=$CUR_IP"; exit 0; fi; fi`,
      `nmcmd radio wifi on >/dev/null || true`,
      `nmcmd device wifi rescan ifname "$WIFI_IF" >/dev/null || nmcmd device wifi rescan >/dev/null || true`,
      `sleep 2`,
      `OK=0`,
      `for i in 1 2 3; do echo "[WiFi] 直连尝试 $i/3..."; if [ -n "$WIFI_KEY" ]; then nmcmd device wifi connect "$WIFI_SSID" password "$WIFI_KEY" ifname "$WIFI_IF" && OK=1 && break; else nmcmd device wifi connect "$WIFI_SSID" ifname "$WIFI_IF" && OK=1 && break; fi; ACTIVE_CONN=$(nmcmd -t -f GENERAL.CONNECTION device show "$WIFI_IF" | sed -n 's/^GENERAL.CONNECTION://p' | head -n1); if [ "$ACTIVE_CONN" = "$WIFI_SSID" ]; then OK=1; break; fi; nmcmd device wifi rescan ifname "$WIFI_IF" >/dev/null || nmcmd device wifi rescan >/dev/null || true; sleep 2; done`,
      `if [ "$OK" != "1" ]; then echo "[WiFi] 直连未成功，尝试复用已有连接..."; if nmcmd -t -f NAME connection show | grep -Fx -- "$WIFI_SSID" >/dev/null; then if [ -n "$WIFI_KEY" ]; then nmcmd connection modify "$WIFI_SSID" 802-11-wireless-security.key-mgmt wpa-psk 802-11-wireless-security.psk "$WIFI_KEY" >/dev/null || true; NM_PWFILE=$(mktemp /tmp/nm-wifi-XXXXXX.pass); chmod 600 "$NM_PWFILE"; printf '802-11-wireless-security.psk:%s\\n' "$WIFI_KEY" > "$NM_PWFILE"; nmcmd connection up "$WIFI_SSID" ifname "$WIFI_IF" passwd-file "$NM_PWFILE" && OK=1; rm -f "$NM_PWFILE"; else nmcmd connection up "$WIFI_SSID" ifname "$WIFI_IF" && OK=1; fi; fi; fi`,
      `if [ "$OK" != "1" ]; then echo "[WiFi] 复用失败，重建连接配置..."; nmcmd connection delete "$WIFI_SSID" >/dev/null || true; if [ -n "$WIFI_KEY" ]; then nmcmd connection add type wifi con-name "$WIFI_SSID" ifname "$WIFI_IF" ssid "$WIFI_SSID" 802-11-wireless-security.key-mgmt wpa-psk 802-11-wireless-security.psk "$WIFI_KEY" ipv4.method auto ipv6.method auto >/dev/null || true; NM_PWFILE=$(mktemp /tmp/nm-wifi-XXXXXX.pass); chmod 600 "$NM_PWFILE"; printf '802-11-wireless-security.psk:%s\\n' "$WIFI_KEY" > "$NM_PWFILE"; nmcmd connection up "$WIFI_SSID" ifname "$WIFI_IF" passwd-file "$NM_PWFILE" && OK=1; rm -f "$NM_PWFILE"; else nmcmd connection add type wifi con-name "$WIFI_SSID" ifname "$WIFI_IF" ssid "$WIFI_SSID" ipv4.method auto ipv6.method auto >/dev/null || true; nmcmd connection modify "$WIFI_SSID" 802-11-wireless-security.key-mgmt none >/dev/null || true; nmcmd connection up "$WIFI_SSID" ifname "$WIFI_IF" && OK=1; fi; fi`,
      `NEW_IP=""`,
      `for i in 1 2 3 4 5 6; do NEW_IP=$(ip -4 addr show "$WIFI_IF" 2>/dev/null | awk '/inet /{print $2}' | cut -d/ -f1 | head -n1); [ -n "$NEW_IP" ] && break; sleep 1; done`,
      `if [ "$OK" = "1" ] && [ -n "$NEW_IP" ]; then echo "[WiFi] OK IP=$NEW_IP"; else echo "[WiFi] FAIL"; fi`,
    ].join(' ; ');

    let output = '';
    const collectOutput = (chunk: string) => { output += chunk; onOutput(chunk); };
    /** exec 的 exit code 与 nmcli 成败对齐；再要求输出中含 [WiFi] OK IP= 以免误判 */
    const wrapComplete = (sshOk: boolean) => {
      const lineOk = /\[WiFi\] OK IP=/.test(output);
      onComplete(Boolean(sshOk && lineOk));
    };
    this.execCommand(device, script, collectOutput, wrapComplete, { timeout: 170000 });
  }

  // OpenClaw 对话方法（仅建立 SSH 客户端；成功与否应与套件端 openclaw/status 结合展示，勿单独当作「Agent 已连接」）
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

  /**
   * 优先走套件端常驻 oc-bridge（单 WS + 多轮 chat），失败或未启用时回退到单次 /tmp/oc_chat_ws.js。
   * 环境变量 RDK_OPENCLAW_BRIDGE=0 可强制仅用旧路径（排障）。
   */
  sendAgentMessage(
    message: string,
    onChunk: (chunk: string) => void,
    onComplete: (success: boolean) => void,
    sessionId: string,
    device: Device,
    meta?: {
      correlationId?: string;
      studioRunId?: string;
      studioSessionKey?: string;
    },
  ): { abort: () => void } {
    if (process.env.RDK_OPENCLAW_BRIDGE === '0') {
      return this.sendAgentMessageOneShot(message, onChunk, onComplete, sessionId, device, meta);
    }
    type BridgeTurnEnd = 'success' | 'retry' | 'fail_user' | 'fail_silent';
    const abortCtl = { aborted: false };
    /** 结束 executeBridgeTurn 内挂起的 Promise，避免取消后 runOcBridgeSerial 链死锁 */
    const bridgeTurnHook: { complete: ((end: BridgeTurnEnd) => void) | null } = { complete: null };
    let legacyAbort: (() => void) | null = null;
    let unsub: (() => void) | null = null;
    let activeReqId = '';
    let turnTimer: ReturnType<typeof setTimeout> | null = null;

    const abort = () => {
      abortCtl.aborted = true;
      if (turnTimer) {
        clearTimeout(turnTimer);
        turnTimer = null;
      }
      try {
        unsub?.();
      } catch {
        /* ignore */
      }
      bridgeTurnHook.complete?.('fail_user');
      bridgeTurnHook.complete = null;
      if (activeReqId) {
        try {
          this.ocBridgeTransportByIp.get(sshEndpointKey(device))?.send({
            op: 'abort',
            reqId: activeReqId,
            correlationId: meta?.correlationId,
            studioRunId: meta?.studioRunId,
          });
        } catch {
          /* ignore */
        }
      }
      try {
        legacyAbort?.();
      } catch {
        /* ignore */
      }
    };

    void this.runOcBridgeSerial(sshEndpointKey(device), async () => {
      let turnEnd: BridgeTurnEnd = 'fail_user';

      const executeBridgeTurn = async (allowRetryAfterTransient: boolean): Promise<BridgeTurnEnd> => {
        if (abortCtl.aborted) return 'fail_user';
        const transport = await this.getOrCreateBridgeTransport(device);
        if (abortCtl.aborted) return 'fail_user';
        if (!transport) {
          return allowRetryAfterTransient ? 'retry' : 'fail_silent';
        }

        activeReqId = `r-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
        let receivedAnyOutput = false;
        let sawTransientError = false;

        return await new Promise<BridgeTurnEnd>((resolve) => {
          let settled = false;
          const cleanup = () => {
            if (turnTimer) {
              clearTimeout(turnTimer);
              turnTimer = null;
            }
            try {
              unsub?.();
            } catch {
              /* ignore */
            }
            unsub = null;
          };
          const finishTurn = (end: BridgeTurnEnd) => {
            if (settled) return;
            settled = true;
            bridgeTurnHook.complete = null;
            cleanup();
            resolve(end);
          };
          bridgeTurnHook.complete = finishTurn;

          turnTimer = setTimeout(() => {
            if (!abortCtl.aborted) onComplete(false);
            finishTurn('fail_user');
          }, 600000);

          unsub = transport.onLine((line) => {
            if (abortCtl.aborted) return;
            const rid = line.reqId != null ? String(line.reqId) : '';
            if (rid && rid !== activeReqId) return;
            if (line.type === 'assistant' && typeof line.text === 'string') {
              receivedAnyOutput = true;
              onChunk(line.text);
            }
            if (line.type === 'tool') {
              receivedAnyOutput = true;
              const tn = String(line.name || '');
              const tp = String(line.phase || '');
              const det = String(line.detail || '').slice(0, 600);
              onChunk(`\n[TOOL:${tp}] ${tn}${det ? ` -> ${det}` : ''}\n`);
            }
            if (line.type === 'error' && (!rid || rid === activeReqId)) {
              const rawCode = line.code;
              const ocCode = typeof rawCode === 'string' ? rawCode.trim() : '';
              if (ocCode && OpenClawDeploymentManager.OC_BRIDGE_TRANSIENT_CODES.has(ocCode)) {
                sawTransientError = true;
              }
              const ocMsg = String(line.message || 'gateway error');
              const payload = ocCode
                ? JSON.stringify({ ocCode, message: ocMsg, correlationId: meta?.correlationId ?? null })
                : ocMsg;
              onChunk(`__OPENCLAW_WS_FAILED__${payload}`);
            }
            if (line.type === 'done' && (!rid || rid === activeReqId)) {
              const ok = !!line.ok;
              const reason = line.reason != null ? String(line.reason) : '';
              if (ok) {
                if (!abortCtl.aborted) onComplete(true);
                finishTurn('success');
                return;
              }
              const transient = OpenClawDeploymentManager.isTransientBridgeTurnFailure(
                reason,
                sawTransientError,
                receivedAnyOutput,
              );
              if (transient && allowRetryAfterTransient) {
                finishTurn('retry');
                return;
              }
              if (!abortCtl.aborted) onComplete(false);
              finishTurn('fail_user');
            }
          });
          try {
            transport.send({
              op: 'chat.send',
              reqId: activeReqId,
              sessionKey: sessionId || 'main',
              message,
              idempotencyKey: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              correlationId: meta?.correlationId,
              runId: meta?.studioRunId,
              studioSessionKey: meta?.studioSessionKey,
            });
          } catch {
            if (abortCtl.aborted) {
              finishTurn('fail_user');
            } else {
              finishTurn(allowRetryAfterTransient ? 'retry' : 'fail_silent');
            }
          }
        });
      };

      try {
        turnEnd = await executeBridgeTurn(true);
        if (turnEnd === 'retry' && !abortCtl.aborted) {
          this.invalidateOcBridgeTransport(device);
          await new Promise((r) => setTimeout(r, OpenClawDeploymentManager.OC_BRIDGE_TRANSPORT_RETRY_MS));
          turnEnd = await executeBridgeTurn(false);
        }
        if (!abortCtl.aborted && (turnEnd === 'fail_silent' || turnEnd === 'retry')) {
          legacyAbort = this.sendAgentMessageOneShot(message, onChunk, onComplete, sessionId, device, meta).abort;
        }
      } catch {
        if (!abortCtl.aborted) {
          legacyAbort = this.sendAgentMessageOneShot(message, onChunk, onComplete, sessionId, device, meta).abort;
        }
      }
      if (abortCtl.aborted && turnEnd !== 'success') {
        try {
          onComplete(false);
        } catch {
          /* ignore */
        }
      }
    }).catch(() => {
      if (!abortCtl.aborted) {
        legacyAbort = this.sendAgentMessageOneShot(message, onChunk, onComplete, sessionId, device, meta).abort;
      }
    });

    return { abort };
  }

  private sendAgentMessageOneShot(
    message: string,
    onChunk: (chunk: string) => void,
    onComplete: (success: boolean) => void,
    sessionId: string,
    device: Device,
    meta?: {
      correlationId?: string;
      studioRunId?: string;
      studioSessionKey?: string;
    },
  ): { abort: () => void } {
    void meta;
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
  else {
    let m = String(reason || 'unknown error');
    if (reason && typeof reason === 'object' && reason.code) {
      m = JSON.stringify({ ocCode: String(reason.code), message: String(reason.message || reason) });
    }
    console.error('__OPENCLAW_WS_FAILED__');
    console.error(m);
    process.exit(1);
  }
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
  const params = { sessionKey, message, idempotencyKey: 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2) };
  ws.send(JSON.stringify({ type: 'req', id: sendId, method: 'chat.send', params }));
};
onConnectFailed = (msg) => { clearInterval(timer); finish(false, msg); };

onFrame = (frame) => {
  lastActivity = Date.now();
  if (frame.type === 'res') {
    if (frame.id === sendId && !frame.ok) {
      const er = frame.error || {};
      return finish(false, { code: er.code || 'CHAT_SEND_FAILED', message: er.message || 'chat.send failed' });
    }
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
  if (stream === 'tool') {
    const tn = d.name || d.tool || '';
    const tp = d.phase || d.status || 'call';
    const pickText = (v) => {
      if (v == null) return '';
      if (typeof v === 'string') return v;
      try { return JSON.stringify(v); } catch { return String(v); }
    };
    const compact = (s, max = 400) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
    const tr = compact(
      pickText(d.result)
      || pickText(d.detail)
      || pickText(d.message)
      || pickText(d.args)
      || pickText(d.input)
      || pickText(d.params)
    );
    process.stdout.write('\\n[TOOL:' + tp + '] ' + tn + (tr ? ' -> ' + tr : '') + '\\n');
    return;
  }
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

wsOnClose = () => { if (!done) { finish(false, 'websocket closed unexpectedly'); } };
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
