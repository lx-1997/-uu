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
const RUN_DOCTOR = '(openclaw doctor --yes 2>&1 || openclaw doctor 2>&1 || echo "[OpenClaw] doctor 执行失败，请手动检查")';
const RUN_HEALTH = '(openclaw health --json 2>&1 || openclaw status --all 2>&1 || openclaw status 2>&1 || true)';

const NPM_INSTALL_CMD = [
  BOARD_ENV_EXPORT,
  'echo "[OpenClaw] 开始安装（官方推荐流程）..."',
  // 优先官方安装脚本，失败回退 npm latest
  '(curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-onboard 2>&1 || (echo "[OpenClaw] 官方脚本失败，尝试 npm 安装..." && for i in 1 2 3; do if CI=1 npm install -g openclaw@latest --loglevel info --prefer-offline=false --fetch-timeout=120000 --fetch-retries=5 2>&1; then break; fi; echo "[OpenClaw] 官方源失败，尝试国内镜像..."; if CI=1 npm install -g openclaw@latest --loglevel info --registry=https://registry.npmmirror.com --prefer-offline=false --fetch-timeout=120000 --fetch-retries=5 2>&1; then break; fi; [ "$i" = 3 ] && exit 1; echo "[OpenClaw] 安装失败，重试 $i/3..."; sleep 10; done))',
  CLAWHUB_AUTO_LOGIN_CMD,
  NPM_NVM_CLEANUP,
  RUN_DOCTOR,
  RESTART_GATEWAY_FALLBACK,
  RUN_HEALTH,
  'echo "[OpenClaw] 安装流程完成"'
].join(' && ');

const GATEWAY_RESTART_CMD = `${BOARD_ENV_EXPORT} && ${RESTART_GATEWAY_FALLBACK} && echo "[OpenClaw] Gateway 已重启"`;

const NPM_UPGRADE_CMD = [
  BOARD_ENV_EXPORT,
  'echo "[OpenClaw] 开始升级（官方推荐流程）..."',
  // 优先 CLI update，失败回退 npm latest
  '(openclaw update --no-restart 2>&1 || openclaw update 2>&1 || (echo "[OpenClaw] update 命令失败，回退 npm 升级..." && for i in 1 2 3; do if CI=1 npm install -g openclaw@latest --loglevel info --prefer-offline=false --fetch-timeout=120000 --fetch-retries=5 2>&1; then break; fi; echo "[OpenClaw] 官方源失败，尝试国内镜像..."; if CI=1 npm install -g openclaw@latest --loglevel info --registry=https://registry.npmmirror.com --prefer-offline=false --fetch-timeout=120000 --fetch-retries=5 2>&1; then break; fi; [ "$i" = 3 ] && exit 1; echo "[OpenClaw] 升级失败，重试 $i/3..."; sleep 10; done))',
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
      'openclaw gateway status 2>&1 || echo "gateway status 不可用"',
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
      'echo "=== 准备完成 ==="',
    ].join(' ; ');
    this.execCommand(device, cmd, onOutput, onComplete, { timeout: 60000 });
  }

  runInstall(device: Device, onOutput: (chunk: string) => void, onComplete: (success: boolean) => void): void {
    this.execCommand(device, NPM_INSTALL_CMD, onOutput, onComplete, { pty: true, timeout: 0 });
  }

  runUpgrade(device: Device, onOutput: (chunk: string) => void, onComplete: (success: boolean) => void): void {
    this.execCommand(device, NPM_UPGRADE_CMD, onOutput, onComplete, { pty: true, timeout: 0 });
  }

  runUninstall(device: Device, onOutput: (chunk: string) => void, onComplete: (success: boolean) => void): void {
    const cmd = [
      BOARD_ENV_EXPORT,
      'echo "[OpenClaw] 开始卸载..."',
      // 优先官方卸载流程，失败回退手动清理。
      '(openclaw uninstall --all --yes --non-interactive 2>&1 || (openclaw gateway stop 2>/dev/null || true) && (openclaw gateway uninstall 2>/dev/null || true) && (systemctl --user stop openclaw-gateway 2>/dev/null || true) && (systemctl --user disable openclaw-gateway 2>/dev/null || true) && rm -rf ~/.openclaw 2>/dev/null || true)',
      '(npm rm -g openclaw 2>/dev/null || npm uninstall -g openclaw 2>/dev/null || true)',
      'echo "[OpenClaw] 卸载完成"'
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
    }, { timeout: 20000 });
  }

  getCurrentConfig(device: Device, onResult: (config: ConfigData | null, success: boolean) => void): void {
    const pyScript = `import json,os
p=os.path.expanduser('~/.openclaw/openclaw.json')
result={"modelGateway":{"baseUrl":"","apiKey":"","api":"anthropic-messages","modelId":"qwen3.5-plus","modelName":"Custom Model"},"feishu":{"appId":"","appSecret":"","connectionMode":"websocket","domain":"feishu","dmPolicy":"pairing","verificationToken":"","encryptKey":""},"runtimeModel":{"provider":"","modelId":"","apiKey":""},"primaryModel":"","configuredProviders":[],"pluginsAllow":[],"allProviders":{}}
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
  result["modelGateway"].update({"baseUrl":provider.get('baseUrl','') or '',"apiKey":provider.get('apiKey','') or '',"api":provider.get('api','anthropic-messages') or 'anthropic-messages',"modelId":model.get('id','qwen3.5-plus') or 'qwen3.5-plus',"modelName":model.get('name','Custom Model') or 'Custom Model'})
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
      patch.models = {
        providers: {
          'custom-gateway': {
            baseUrl: config.modelGateway.baseUrl,
            apiKey: config.modelGateway.apiKey,
            api: config.modelGateway.api || 'anthropic-messages',
            models: [{
              id: config.modelGateway.modelId || 'qwen3.5-plus',
              name: config.modelGateway.modelName || 'Custom Model',
            }],
          },
        },
      };
      patch.agents = { defaults: { model: { primary: 'custom-gateway/' + (config.modelGateway.modelId || 'qwen3.5-plus') } } };
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
    const pyScript = `import json,os,sys,base64
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
print('[OpenClaw] 配置已更新')`;
    const base64Script = Buffer.from(pyScript, 'utf8').toString('base64');
    const cmd = [
      'export PATH="$HOME/.npm-global/bin:$PATH"',
      `echo '${base64Script}' | base64 -d > /tmp/oc_merge.py && python3 /tmp/oc_merge.py '${patchB64}'`,
      '(systemctl --user restart openclaw-gateway 2>/dev/null || openclaw gateway restart)',
      'echo "[OpenClaw] 配置已保存，Gateway 已重启"',
    ].join(' && ');
    this.execCommand(device, cmd, onOutput, onComplete);
  }

  runRestartGateway(device: Device, onOutput: (chunk: string) => void, onComplete: (success: boolean) => void): void {
    const cmd = 'export PATH="$HOME/.npm-global/bin:$PATH" && (systemctl --user restart openclaw-gateway 2>/dev/null || openclaw gateway restart) && echo "[OpenClaw] Gateway 已重启"';
    this.execCommand(device, cmd, onOutput, onComplete);
  }

  runGetVersion(device: Device, onOutput: (chunk: string) => void, onComplete: (success: boolean) => void): void {
    const cmd = 'export PATH="$HOME/.npm-global/bin:$PATH" && (openclaw --version 2>/dev/null || echo "未安装")';
    this.execCommand(device, cmd, onOutput, onComplete);
  }

  runDoctor(device: Device, onOutput: (chunk: string) => void, onComplete: (success: boolean) => void): void {
    const cmd = 'export PATH="$HOME/.npm-global/bin:$PATH" && (openclaw doctor 2>&1 || echo "[OpenClaw] doctor 命令不可用，可能未安装")';
    this.execCommand(device, cmd, onOutput, onComplete, { timeout: 30000 });
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
      `(openclaw logs --limit ${maxLines} 2>&1 || journalctl --user -u openclaw-gateway --no-pager -n ${maxLines} 2>&1 || echo "[OpenClaw] 暂无日志")`,
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
      '(clawhub list 2>/dev/null || ls -1 /opt/openclaw/skills 2>/dev/null || echo "无已安装技能")',
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
    const escapedName = (wifiName || '').replace(/"/g, '\\"');
    const escapedPwd = (wifiPassword || '').replace(/"/g, '\\"');
    const cmd = `sudo wifi_connect "${escapedName}" "${escapedPwd}" 2>&1`;
    let output = '';
    const collectOutput = (chunk: string) => {
      output += chunk;
      onOutput(chunk);
    };
    const wrapComplete = (exitSuccess: boolean) => {
      const hasErrorInOutput = /error|failed|secrets were required|connection activation failed|invalid|denied|refused|authentication failed|wrong password/i.test(output);
      const success = exitSuccess && !hasErrorInOutput;
      onComplete(success);
    };
    this.execCommand(device, cmd, collectOutput, wrapComplete, { timeout: 60000 });
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
    const messageBase64 = Buffer.from(message, 'utf8').toString('base64');
    const sessionBase64 = Buffer.from(sessionId || 'main', 'utf8').toString('base64');
    const pyScript = `import base64, json, os, sys, urllib.request, urllib.error, subprocess

msg = base64.b64decode(sys.argv[1]).decode('utf-8', 'ignore')
session = base64.b64decode(sys.argv[2]).decode('utf-8', 'ignore') or 'main'

cfg = {}
try:
  p = os.path.expanduser('~/.openclaw/openclaw.json')
  if os.path.exists(p):
    with open(p, 'r', encoding='utf-8') as f:
      cfg = json.load(f)
except Exception:
  cfg = {}

token = ((cfg.get('gateway') or {}).get('auth') or {}).get('token') or ''
headers = {
  'Content-Type': 'application/json',
  'x-openclaw-agent-id': 'main',
  'x-openclaw-session-key': session,
}
if token:
  headers['Authorization'] = f'Bearer {token}'

def discover_local_plugin_ids():
  ids = []
  ext = os.path.expanduser('~/.openclaw/extensions')
  if os.path.isdir(ext):
    for name in os.listdir(ext):
      full = os.path.join(ext, name)
      if os.path.isdir(full):
        ids.append(name)
  return ids

def patch_plugins_allow_and_restart():
  p = os.path.expanduser('~/.openclaw/openclaw.json')
  data = {}
  if os.path.exists(p):
    with open(p, 'r', encoding='utf-8') as f:
      data = json.load(f)
  plugins = data.setdefault('plugins', {})
  allow = plugins.get('allow')
  if not isinstance(allow, list):
    allow = []
  changed = False
  for pid in discover_local_plugin_ids():
    if pid not in allow:
      allow.append(pid)
      changed = True
  plugins['allow'] = allow
  if changed:
    with open(p, 'w', encoding='utf-8') as f:
      json.dump(data, f, indent=2, ensure_ascii=False)
    subprocess.run('systemctl --user restart openclaw-gateway 2>/dev/null || openclaw gateway restart >/dev/null 2>&1 || true', shell=True)
  return changed, allow

def post(path, payload):
  req = urllib.request.Request(
    'http://127.0.0.1:18789' + path,
    data=json.dumps(payload).encode('utf-8'),
    headers=headers,
    method='POST',
  )
  with urllib.request.urlopen(req, timeout=120) as resp:
    return resp.getcode(), resp.read().decode('utf-8', 'ignore')

errors = []
text = ''

def request_once():
  local_errors = []
  local_text = ''
  try:
    _, body = post('/v1/chat/completions', {
      'model': 'openclaw',
      'stream': False,
      'user': session,
      'messages': [{'role': 'user', 'content': msg}],
    })
    payload = json.loads(body or '{}')
    local_text = ((payload.get('choices') or [{}])[0].get('message') or {}).get('content') or ((payload.get('choices') or [{}])[0].get('text') or '')
  except Exception as e:
    local_errors.append(f'chat/completions failed: {e}')

  if not local_text:
    try:
      _, body = post('/v1/responses', {
        'model': 'openclaw',
        'stream': False,
        'user': session,
        'input': msg,
      })
      payload = json.loads(body or '{}')
      local_text = payload.get('output_text') or ''
      if not local_text:
        output = payload.get('output') or []
        if isinstance(output, list) and output:
          first = output[0] or {}
          local_text = first.get('text') or ''
    except Exception as e:
      local_errors.append(f'responses failed: {e}')

  return local_text, local_errors

text, errors = request_once()

if (not text) and any('plugins.allow is empty' in str(err) for err in errors):
  changed, allow = patch_plugins_allow_and_restart()
  if changed:
    errors.append('plugins.allow auto-fixed: ' + ','.join(allow))
  text, retry_errors = request_once()
  errors.extend(retry_errors)

if text:
  print(text)
  sys.exit(0)

print('__OPENCLAW_HTTP_FAILED__')
for err in errors:
  print(err)
sys.exit(1)
`;
    const scriptBase64 = Buffer.from(pyScript, 'utf8').toString('base64');
    const cmd = [
      'export PATH="$HOME/.npm-global/bin:$PATH"',
      `echo '${scriptBase64}' | base64 -d > /tmp/oc_chat_http.py`,
      `python3 /tmp/oc_chat_http.py '${messageBase64}' '${sessionBase64}'`,
    ].join(' && ');

    return this.execCommand(device, cmd, (chunk) => {
      onChunk(chunk);
    }, onComplete, { pty: false, timeout: 120000 });
  }

  stopInteractiveChat(sessionId: string, device: Device | null): void {
    // 会话级 stop 不销毁共享 SSH 连接，避免多个页面/面板互相踢下线
    // 连接由 close/error 事件或应用生命周期统一回收
  }
}
