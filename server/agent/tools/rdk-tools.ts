/**
 * RDK Studio Agent — 设备工具集
 *
 * 遵循 openclaw-mini 的 Tool 接口，每个工具定义：
 * - name: LLM 调用时使用的名称
 * - description: 告诉 LLM 什么时候用
 * - inputSchema: JSON Schema 参数定义
 * - execute: 实际执行函数
 */

import type { Tool } from './types.js';
import {
  execOnDevice,
  readDeviceFile,
  writeDeviceFile,
  listDeviceFiles,
  downloadDeviceFileToLocal,
  uploadLocalFileToDevice,
} from './rdk-ssh-helper.js';
import * as path from 'node:path';

export interface RdkToolsCallbacks {
  onMediaDownloaded?: (info: { localPath: string; fileName: string; bytes?: number; mediaType: 'image' | 'video' }) => void;
}

export function createRdkTools(deviceId: string, callbacks?: RdkToolsCallbacks): Tool[] {
  const tools: Tool[] = [
    deviceExecTool(deviceId),
    deviceFileReadTool(deviceId),
    deviceFileWriteTool(deviceId),
    deviceFileListTool(deviceId),
    deviceFileDownloadToLocalTool(deviceId, callbacks?.onMediaDownloaded),
    deviceFileUploadFromLocalTool(deviceId),
    boardOpenClawStatusTool(deviceId),
    boardOpenClawReadConfigTool(deviceId),
    boardOpenClawInstallTool(deviceId),
    boardOpenClawUpgradeTool(deviceId),
    boardOpenClawUninstallTool(deviceId),
    boardOpenClawModelSwitchTool(deviceId),
    boardOpenClawFeishuConfigTool(deviceId),
    boardOpenClawWeixinConfigTool(deviceId),
    boardOpenClawPairingListTool(deviceId),
    boardOpenClawPairingApproveTool(deviceId),
    boardOpenClawPairingRejectTool(deviceId),
    boardOpenClawLogsTool(deviceId),
    boardOpenClawRestartGatewayTool(deviceId),
    boardOpenClawDoctorTool(deviceId),
    boardOpenClawModelTestTool(deviceId),
    boardOpenClawCheckTool(deviceId),
    boardOpenClawHealthTool(deviceId),
    boardOpenClawSkillsListTool(deviceId),
    boardOpenClawSkillInstallTool(deviceId),
    boardOpenClawWriteSkillTool(deviceId),
    deviceDiagnoseTool(deviceId),
    rosTopicsTool(deviceId),
    rosNodesTool(deviceId),
    vncStartTool(deviceId),
    vncStopTool(deviceId),
    vncStatusTool(deviceId),
    flashCheckTool(deviceId),
    ttsTextToSpeechTool(deviceId),
    sttSpeechToTextTool(deviceId),
    sherpaSetupTool(deviceId),
    sherpaOfflineTtsTool(deviceId),
    sherpaOfflineSttTool(deviceId),
  ];
  return tools;
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.avi', '.mov', '.mkv']);
const DOC_EXTENSIONS = new Set(['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.pdf', '.csv', '.txt', '.md', '.zip', '.rar', '.7z']);
const OPENCLAW_RESOLVE_SNIPPET = 'export NPM_CONFIG_PREFIX="$HOME/.npm-global"; export PATH="$HOME/.npm-global/bin:$PATH"; OPENCLAW_CMD="$(command -v openclaw 2>/dev/null || true)"; if [ -z "$OPENCLAW_CMD" ] && [ -x "$HOME/.local/bin/openclaw" ]; then OPENCLAW_CMD="$HOME/.local/bin/openclaw"; fi; if [ -z "$OPENCLAW_CMD" ] && [ -x "$(npm prefix -g 2>/dev/null)/bin/openclaw" ]; then OPENCLAW_CMD="$(npm prefix -g 2>/dev/null)/bin/openclaw"; fi; if [ ! -x "$OPENCLAW_CMD" ]; then OPENCLAW_CMD=""; fi';
const OPENCLAW_FAST_REGISTRY_SNIPPET = 'if curl -fsS --connect-timeout 2 --max-time 3 https://registry.npmmirror.com/-/ping >/dev/null 2>&1; then NPM_FAST_REG=https://registry.npmmirror.com; ALT_REG=https://registry.npmjs.org; else NPM_FAST_REG=https://registry.npmjs.org; ALT_REG=https://registry.npmmirror.com; fi; echo [OpenClaw]\ npm\ registry\ first\ try:\ $NPM_FAST_REG';
const OPENCLAW_NPM_FAST_INSTALL_SNIPPET = '(for i in 1 2 3; do if CI=1 npm install -g openclaw@latest --loglevel info --registry=$NPM_FAST_REG --prefer-offline=false --fetch-timeout=120000 --fetch-retries=5 --fetch-retry-mintimeout=2000 --fetch-retry-maxtimeout=15000 --maxsockets=20 2>&1; then break; fi; echo [OpenClaw]\ 主\ registry\ 失败，尝试备用:\ $ALT_REG; if CI=1 npm install -g openclaw@latest --loglevel info --registry=$ALT_REG --prefer-offline=false --fetch-timeout=120000 --fetch-retries=5 --fetch-retry-mintimeout=2000 --fetch-retry-maxtimeout=15000 --maxsockets=20 2>&1; then break; fi; [ $i = 3 ] && exit 1; echo [OpenClaw]\ 安装失败，重试\ $i/3...; sleep 3; done)';

function assertShellSafeToken(name: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed || !/^[A-Za-z0-9._:-]+$/.test(trimmed)) {
    throw new Error(`${name} 包含非法字符`);
  }
  return trimmed;
}

function deviceFileDownloadToLocalTool(
  deviceId: string,
  onMediaDownloaded?: RdkToolsCallbacks['onMediaDownloaded'],
): Tool<{ remotePath: string; localPath?: string }> {
  return {
    name: 'device_file_download_to_local',
    description: '把设备上的文件下载到本机（RDK Studio 所在电脑）。可选 localPath，不填则下载到 workspace/downloads/。下载图片、视频或文档后会返回可预览/可下载的 URL。',
    inputSchema: {
      type: 'object',
      properties: {
        remotePath: { type: 'string', description: '设备文件绝对路径，如 /userdata/a.txt' },
        localPath: { type: 'string', description: '本机保存路径（可选，相对路径基于 workspace）' },
      },
      required: ['remotePath'],
    },
    async execute(input, ctx) {
      const fileName = path.basename(input.remotePath);
      const target = input.localPath
        ? path.resolve(ctx.workspaceDir, input.localPath)
        : path.resolve(ctx.workspaceDir, 'downloads', fileName);
      const result = await downloadDeviceFileToLocal(deviceId, input.remotePath, target);

      const ext = path.extname(fileName).toLowerCase();
      const savedName = path.basename(result.localPath);
      const mediaUrl = `/api/local-files/${encodeURIComponent(savedName)}`;
      if (IMAGE_EXTENSIONS.has(ext)) {
        onMediaDownloaded?.({ localPath: result.localPath, fileName: savedName, bytes: result.bytes, mediaType: 'image' });
        return JSON.stringify({
          __type: 'image_download',
          localPath: result.localPath,
          bytes: result.bytes,
          imageUrl: mediaUrl,
          fileName: savedName,
        });
      }
      if (VIDEO_EXTENSIONS.has(ext)) {
        onMediaDownloaded?.({ localPath: result.localPath, fileName: savedName, bytes: result.bytes, mediaType: 'video' });
        return JSON.stringify({
          __type: 'video_download',
          localPath: result.localPath,
          bytes: result.bytes,
          videoUrl: mediaUrl,
          fileName: savedName,
        });
      }
      if (DOC_EXTENSIONS.has(ext)) {
        return JSON.stringify({
          __type: 'file_download',
          localPath: result.localPath,
          bytes: result.bytes,
          fileUrl: mediaUrl,
          fileName: savedName,
        });
      }
      return `已下载到本机: ${result.localPath} (${result.bytes} bytes)`;
    },
  };
}

function deviceFileUploadFromLocalTool(deviceId: string): Tool<{ localPath: string; remotePath: string }> {
  return {
    name: 'device_file_upload_from_local',
    description: '把本机文件上传到设备。localPath 基于 RDK Studio workspace。',
    inputSchema: {
      type: 'object',
      properties: {
        localPath: { type: 'string', description: '本机文件路径（相对 workspace 或绝对路径）' },
        remotePath: { type: 'string', description: '设备目标绝对路径，如 /userdata/a.txt' },
      },
      required: ['localPath', 'remotePath'],
    },
    async execute(input, ctx) {
      const localAbs = path.resolve(ctx.workspaceDir, input.localPath);
      const result = await uploadLocalFileToDevice(deviceId, localAbs, input.remotePath);
      return `已上传到设备: ${result.remotePath} (${result.bytes} bytes)`;
    },
  };
}

function deviceExecTool(deviceId: string): Tool<{ command: string }> {
  return {
    name: 'device_exec',
    description: '在 RDK 设备上执行 shell 命令。用于运行任意命令、安装软件、查看系统状态、编译代码等。长时间命令加 timeout 30；避免交互式命令（vim/top）；复杂任务用 && 串联。执行后检查输出确认是否成功。',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的 shell 命令' },
      },
      required: ['command'],
    },
    async execute(input) {
      const output = await execOnDevice(deviceId, [input.command]);
      return output || '(命令执行成功，无输出)';
    },
  };
}

function deviceFileReadTool(deviceId: string): Tool<{ path: string }> {
  return {
    name: 'device_file_read',
    description: '读取 RDK 设备上的文件内容。用于查看配置文件、日志、代码等。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件绝对路径' },
      },
      required: ['path'],
    },
    async execute(input) {
      return readDeviceFile(deviceId, input.path);
    },
  };
}

function deviceFileWriteTool(deviceId: string): Tool<{ path: string; content: string }> {
  return {
    name: 'device_file_write',
    description: '写入文件到 RDK 设备。用于创建脚本、配置文件、代码文件等。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件绝对路径' },
        content: { type: 'string', description: '文件内容' },
      },
      required: ['path', 'content'],
    },
    async execute(input) {
      await writeDeviceFile(deviceId, input.path, input.content);
      return `文件已写入: ${input.path} (${input.content.length} 字符)`;
    },
  };
}

function deviceFileListTool(deviceId: string): Tool<{ path?: string }> {
  return {
    name: 'device_file_list',
    description: '列出 RDK 设备上的目录内容。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目录路径，默认 ~' },
      },
    },
    async execute(input) {
      return listDeviceFiles(deviceId, input.path || '~');
    },
  };
}

function deviceDiagnoseTool(deviceId: string): Tool<Record<string, never>> {
  return {
    name: 'device_diagnose',
    description: '获取 RDK 设备硬件诊断信息：CPU 温度、BPU 负载、内存使用、磁盘空间。',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    async execute() {
      const commands = [
        'echo "=== CPU Temperature ===" && cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo "N/A"',
        'echo "=== Memory ===" && free -h',
        'echo "=== Disk ===" && df -h /',
        'echo "=== BPU ===" && cat /sys/devices/system/bpu/bpu0/ratio 2>/dev/null || echo "N/A"',
        'echo "=== Uptime ===" && uptime',
      ].join(' && ');
      return execOnDevice(deviceId, [commands]);
    },
  };
}

function boardOpenClawStatusTool(deviceId: string): Tool<Record<string, never>> {
  return {
    name: 'board_openclaw_status',
    description: '快速查看板端 OpenClaw 运行状态（进程/服务/版本摘要）。普通对话优先用这个；Studio UI 已显示 OpenClaw 正常时不要为闲聊重复 SSH 检查。' +
      '需要结构化 JSON 或排障、装/升/重启后验收时再用 board_openclaw_health；全面体检用 board_openclaw_check。',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    async execute() {
      return execOnDevice(deviceId, [
        `bash -lc '${OPENCLAW_RESOLVE_SNIPPET}; (if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" status; else false; fi) || clawctl status || systemctl --user status openclaw-gateway --no-pager || ps -ef | grep -E "openclaw|claw" | grep -v grep || echo OpenClaw_NOT_FOUND'`,
      ]);
    },
  };
}

function boardOpenClawReadConfigTool(deviceId: string): Tool<{ path?: string }> {
  return {
    name: 'board_openclaw_read_config',
    description: '读取板端 OpenClaw 配置文件（默认 ~/.openclaw/openclaw.json）。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '可选配置路径，默认 /root/.openclaw/openclaw.json' },
      },
    },
    async execute(input) {
      const configPath = input.path || '/root/.openclaw/openclaw.json';
      return readDeviceFile(deviceId, configPath);
    },
  };
}

function boardOpenClawInstallTool(deviceId: string): Tool<Record<string, never>> {
  return {
    name: 'board_openclaw_install',
    description: '一键安装板端 OpenClaw（官方 install.sh + doctor + restart + health）。',
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      const cmd = [
        'bash -lc',
        '"export NPM_CONFIG_PREFIX=\\"$HOME/.npm-global\\";',
        'export PATH=\\"$HOME/.npm-global/bin:$PATH\\";',
        OPENCLAW_FAST_REGISTRY_SNIPPET,
        'OPENCLAW_CMD=\\"$(command -v openclaw 2>/dev/null || true)\\"; if [ -z \\\"$OPENCLAW_CMD\\\" ] && [ -x \\\"$HOME/.local/bin/openclaw\\\" ]; then OPENCLAW_CMD=\\"$HOME/.local/bin/openclaw\\"; fi; if [ -z \\\"$OPENCLAW_CMD\\\" ] && [ -x \\\"$(npm prefix -g 2>/dev/null)/bin/openclaw\\\" ]; then OPENCLAW_CMD=\\"$(npm prefix -g 2>/dev/null)/bin/openclaw\\"; fi;',
        `(curl -fsSL --connect-timeout 8 --max-time 45 --retry 2 --retry-delay 2 https://openclaw.ai/install.sh | bash -s -- --no-onboard 2>&1 || ${OPENCLAW_NPM_FAST_INSTALL_SNIPPET});`,
        'OPENCLAW_CMD=\\"$(command -v openclaw 2>/dev/null || true)\\"; if [ -z \\\"$OPENCLAW_CMD\\\" ] && [ -x \\\"$HOME/.local/bin/openclaw\\\" ]; then OPENCLAW_CMD=\\"$HOME/.local/bin/openclaw\\"; fi; if [ -z \\\"$OPENCLAW_CMD\\\" ] && [ -x \\\"$(npm prefix -g 2>/dev/null)/bin/openclaw\\\" ]; then OPENCLAW_CMD=\\"$(npm prefix -g 2>/dev/null)/bin/openclaw\\"; fi;',
        '(if [ -n \\\"$OPENCLAW_CMD\\\" ]; then \\\"$OPENCLAW_CMD\\\" doctor --yes 2>&1 || \\\"$OPENCLAW_CMD\\\" doctor 2>&1 || true; else true; fi);',
        '(systemctl --user restart openclaw-gateway 2>/dev/null || (if [ -n \\\"$OPENCLAW_CMD\\\" ]; then \\\"$OPENCLAW_CMD\\\" gateway restart || true; else false; fi) || true);',
        '(if [ -n \\\"$OPENCLAW_CMD\\\" ]; then \\\"$OPENCLAW_CMD\\\" health --json 2>&1 || \\\"$OPENCLAW_CMD\\\" status --all 2>&1 || \\\"$OPENCLAW_CMD\\\" status 2>&1 || true; else true; fi)"',
      ].join(' ');
      return execOnDevice(deviceId, [cmd]);
    },
  };
}

function boardOpenClawUpgradeTool(deviceId: string): Tool<Record<string, never>> {
  return {
    name: 'board_openclaw_upgrade',
    description: '升级板端 OpenClaw（优先 openclaw update，失败回退 npm latest），并执行健康检查。',
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      const cmd = [
        'bash -lc',
        '"export NPM_CONFIG_PREFIX=\\"$HOME/.npm-global\\";',
        'export PATH=\\"$HOME/.npm-global/bin:$PATH\\";',
        OPENCLAW_FAST_REGISTRY_SNIPPET,
        'OPENCLAW_CMD=\\"$(command -v openclaw 2>/dev/null || true)\\"; if [ -z \\\"$OPENCLAW_CMD\\\" ] && [ -x \\\"$HOME/.local/bin/openclaw\\\" ]; then OPENCLAW_CMD=\\"$HOME/.local/bin/openclaw\\"; fi; if [ -z \\\"$OPENCLAW_CMD\\\" ] && [ -x \\\"$(npm prefix -g 2>/dev/null)/bin/openclaw\\\" ]; then OPENCLAW_CMD=\\"$(npm prefix -g 2>/dev/null)/bin/openclaw\\"; fi;',
        `(if [ -n \\\"$OPENCLAW_CMD\\\" ]; then \\\"$OPENCLAW_CMD\\\" update --no-restart 2>&1 || \\\"$OPENCLAW_CMD\\\" update 2>&1; else false; fi) || ${OPENCLAW_NPM_FAST_INSTALL_SNIPPET});`,
        '(if [ -n \\\"$OPENCLAW_CMD\\\" ]; then \\\"$OPENCLAW_CMD\\\" doctor --yes 2>&1 || \\\"$OPENCLAW_CMD\\\" doctor 2>&1 || true; else true; fi);',
        '(systemctl --user restart openclaw-gateway 2>/dev/null || (if [ -n \\\"$OPENCLAW_CMD\\\" ]; then \\\"$OPENCLAW_CMD\\\" gateway restart || true; else false; fi) || true);',
        '(if [ -n \\\"$OPENCLAW_CMD\\\" ]; then \\\"$OPENCLAW_CMD\\\" health --json 2>&1 || \\\"$OPENCLAW_CMD\\\" status --all 2>&1 || \\\"$OPENCLAW_CMD\\\" status 2>&1 || true; else true; fi)"',
      ].join(' ');
      return execOnDevice(deviceId, [cmd]);
    },
  };
}

function boardOpenClawUninstallTool(deviceId: string): Tool<Record<string, never>> {
  return {
    name: 'board_openclaw_uninstall',
    description: '彻底卸载板端 OpenClaw：停止服务 → 官方卸载 → 清理 systemd → 清除 ClawHub 登录态 → 删除配置/日志/缓存/临时文件 → 移除 npm 包。高风险操作，建议先确认。',
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      const steps = [
        'export NPM_CONFIG_PREFIX=\\"$HOME/.npm-global\\"; export PATH=\\"$HOME/.npm-global/bin:$PATH\\"',
        'OPENCLAW_CMD=\\"$(command -v openclaw 2>/dev/null || true)\\"; if [ -z \\\"$OPENCLAW_CMD\\\" ] && [ -x \\\"$HOME/.local/bin/openclaw\\\" ]; then OPENCLAW_CMD=\\"$HOME/.local/bin/openclaw\\"; fi; if [ -z \\\"$OPENCLAW_CMD\\\" ] && [ -x \\\"$(npm prefix -g 2>/dev/null)/bin/openclaw\\\" ]; then OPENCLAW_CMD=\\"$(npm prefix -g 2>/dev/null)/bin/openclaw\\"; fi',
        'echo \\"[1/6] 停止 gateway...\\"; (if [ -n \\\"$OPENCLAW_CMD\\\" ]; then \\\"$OPENCLAW_CMD\\\" gateway stop 2>/dev/null || true; fi); (systemctl --user stop openclaw-gateway 2>/dev/null || true)',
        'echo \\"[2/6] 官方卸载...\\"; (if [ -n \\\"$OPENCLAW_CMD\\\" ]; then \\\"$OPENCLAW_CMD\\\" uninstall --all --yes --non-interactive 2>&1 || true; else echo \\\"[OpenClaw] 未找到 openclaw CLI，跳过官方卸载（继续兜底清理）\\\"; fi)',
        'echo \\"[3/6] 清理 systemd...\\"; (if [ -n \\\"$OPENCLAW_CMD\\\" ]; then \\\"$OPENCLAW_CMD\\\" gateway uninstall 2>/dev/null || true; fi); (systemctl --user disable openclaw-gateway 2>/dev/null || true); (rm -f ~/.config/systemd/user/openclaw-gateway.service 2>/dev/null || true); (systemctl --user daemon-reload 2>/dev/null || true)',
        'echo \\"[4/6] 清除 ClawHub 登录态...\\"; (clawhub logout 2>/dev/null || true)',
        'echo \\"[5/6] 清理配置/日志/缓存...\\"; (rm -rf ~/.openclaw /tmp/openclaw-* /tmp/clawhub-* ~/.cache/openclaw ~/.local/share/openclaw 2>/dev/null || true)',
        'echo \\"[6/6] 移除 npm 包...\\"; (npm rm -g openclaw 2>/dev/null || true); (npm rm -g clawhub 2>/dev/null || true)',
        'echo \\"[OpenClaw] 卸载完成，已彻底清理\\"',
      ];
      const cmd = `bash -lc "${steps.join(' && ')}"`;
      return execOnDevice(deviceId, [cmd]);
    },
  };
}

function boardOpenClawModelSwitchTool(deviceId: string): Tool<{ provider?: string; modelId: string }> {
  return {
    name: 'board_openclaw_model_switch',
    description: '切换板端 OpenClaw 主模型（修改 openclaw.json 并重启 gateway）。',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', description: '可选 provider，默认 custom-gateway' },
        modelId: { type: 'string', description: '目标模型 ID，例如 qwen-plus' },
      },
      required: ['modelId'],
    },
    async execute(input) {
      const provider = (input.provider || 'custom-gateway').trim();
      const modelId = input.modelId.trim();
      if (!provider || !modelId) throw new Error('provider/modelId 不能为空');
      const payload = Buffer.from(JSON.stringify({ provider, modelId }), 'utf8').toString('base64');
      const py = `import base64,json,os,sys
args=json.loads(base64.b64decode(sys.argv[1]).decode("utf-8"))
p=os.path.expanduser("~/.openclaw/openclaw.json")
os.makedirs(os.path.dirname(p),exist_ok=True)
d={}
if os.path.exists(p):
  try:
    d=json.load(open(p,"r",encoding="utf-8"))
  except Exception:
    d={}
agents=d.setdefault("agents",{})
defaults=agents.setdefault("defaults",{})
model=defaults.setdefault("model",{})
model["primary"]=f"{args['provider']}/{args['modelId']}"
json.dump(d,open(p,"w",encoding="utf-8"),ensure_ascii=False,indent=2)
print(model["primary"])`;
      const pyB64 = Buffer.from(py, 'utf8').toString('base64');
      const cmd = `bash -lc '${OPENCLAW_RESOLVE_SNIPPET}; echo ${pyB64} | base64 -d >/tmp/rdk_oc_switch_model.py && python3 /tmp/rdk_oc_switch_model.py ${payload} && (systemctl --user restart openclaw-gateway 2>/dev/null || (if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" gateway restart || "$OPENCLAW_CMD" restart || true; else false; fi) || true) && (if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" status 2>&1 || true; fi) || true'`;
      return execOnDevice(deviceId, [cmd]);
    },
  };
}

function boardOpenClawFeishuConfigTool(deviceId: string): Tool<{
  appId: string;
  appSecret: string;
  connectionMode?: 'websocket' | 'webhook';
  domain?: 'feishu' | 'lark';
  dmPolicy?: 'pairing' | 'allowlist' | 'open' | 'disabled';
  verificationToken?: string;
  encryptKey?: string;
}> {
  return {
    name: 'board_openclaw_feishu_config',
    description: '配置板端 OpenClaw 的 Feishu 通道参数，并重启 gateway。',
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string' },
        appSecret: { type: 'string' },
        connectionMode: { type: 'string', description: 'websocket 或 webhook' },
        domain: { type: 'string', description: 'feishu 或 lark' },
        dmPolicy: { type: 'string', description: 'pairing/allowlist/open/disabled' },
        verificationToken: { type: 'string' },
        encryptKey: { type: 'string' },
      },
      required: ['appId', 'appSecret'],
    },
    async execute(input) {
      const connectionMode = input.connectionMode || 'websocket';
      if (connectionMode === 'webhook' && (!input.verificationToken || !input.encryptKey)) {
        throw new Error('webhook 模式必须同时提供 verificationToken 与 encryptKey');
      }
      const payload = Buffer.from(JSON.stringify({
        appId: input.appId.trim(),
        appSecret: input.appSecret.trim(),
        connectionMode,
        domain: (input.domain || 'feishu').trim(),
        dmPolicy: (input.dmPolicy || 'pairing').trim(),
        verificationToken: (input.verificationToken || '').trim(),
        encryptKey: (input.encryptKey || '').trim(),
      }), 'utf8').toString('base64');
      const py = `import base64,json,os,sys
cfg=json.loads(base64.b64decode(sys.argv[1]).decode("utf-8"))
p=os.path.expanduser("~/.openclaw/openclaw.json")
os.makedirs(os.path.dirname(p),exist_ok=True)
d={}
if os.path.exists(p):
  try:
    d=json.load(open(p,"r",encoding="utf-8"))
  except Exception:
    d={}
channels=d.setdefault("channels",{})
feishu=channels.setdefault("feishu",{})
feishu["enabled"]=True
feishu["appId"]=cfg["appId"]
feishu["appSecret"]=cfg["appSecret"]
feishu["connectionMode"]=cfg["connectionMode"]
feishu["domain"]=cfg["domain"]
feishu["dmPolicy"]=cfg["dmPolicy"]
if cfg["connectionMode"]=="webhook":
  feishu["verificationToken"]=cfg["verificationToken"]
  feishu["encryptKey"]=cfg["encryptKey"]
json.dump(d,open(p,"w",encoding="utf-8"),ensure_ascii=False,indent=2)
print(json.dumps({"ok":True,"mode":feishu["connectionMode"],"domain":feishu["domain"],"dmPolicy":feishu["dmPolicy"]},ensure_ascii=False))`;
      const pyB64 = Buffer.from(py, 'utf8').toString('base64');
      const cmd = `bash -lc '${OPENCLAW_RESOLVE_SNIPPET}; echo ${pyB64} | base64 -d >/tmp/rdk_oc_feishu_cfg.py && python3 /tmp/rdk_oc_feishu_cfg.py ${payload} && (systemctl --user restart openclaw-gateway 2>/dev/null || (if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" gateway restart || "$OPENCLAW_CMD" restart || true; else false; fi) || true) && (if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" gateway status 2>&1 || "$OPENCLAW_CMD" status 2>&1 || true; fi) || true'`;
      return execOnDevice(deviceId, [cmd]);
    },
  };
}

function boardOpenClawWeixinConfigTool(deviceId: string): Tool<{
  enabled?: boolean;
}> {
  return {
    name: 'board_openclaw_weixin_config',
    description: '在板端 OpenClaw 启用微信 ClawBot 插件并重启 gateway。用户需要通过 openclaw channels login --channel openclaw-weixin 在板端完成扫码绑定。',
    inputSchema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', description: '是否启用微信插件，默认 true' },
      },
    },
    async execute(input) {
      const enabled = input.enabled !== false;
      const py = `import json,os
p=os.path.expanduser("~/.openclaw/openclaw.json")
os.makedirs(os.path.dirname(p),exist_ok=True)
d={}
if os.path.exists(p):
  try:
    d=json.load(open(p,"r",encoding="utf-8"))
  except Exception:
    d={}
plugins=d.setdefault("plugins",{})
entries=plugins.setdefault("entries",{})
entries["openclaw-weixin"]={"enabled":${enabled ? 'True' : 'False'}}
json.dump(d,open(p,"w",encoding="utf-8"),ensure_ascii=False,indent=2)
print(json.dumps({"ok":True,"enabled":${enabled ? 'true' : 'false'}},ensure_ascii=False))`;
      const pyB64 = Buffer.from(py, 'utf8').toString('base64');
      const cmd = `bash -lc '${OPENCLAW_RESOLVE_SNIPPET}; echo ${pyB64} | base64 -d >/tmp/rdk_oc_wx_cfg.py && python3 /tmp/rdk_oc_wx_cfg.py && (systemctl --user restart openclaw-gateway 2>/dev/null || (if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" gateway restart || "$OPENCLAW_CMD" restart || true; else false; fi) || true) && (if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" gateway status 2>&1 || "$OPENCLAW_CMD" status 2>&1 || true; fi) || true'`;
      return execOnDevice(deviceId, [cmd]);
    },
  };
}

function boardOpenClawPairingListTool(deviceId: string): Tool<{ channel?: string }> {
  return {
    name: 'board_openclaw_pairing_list',
    description: '查看板端 OpenClaw 某渠道的待配对请求，默认 feishu。',
    inputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: '渠道名，默认 feishu' },
      },
    },
    async execute(input) {
      const channel = assertShellSafeToken('channel', input.channel || 'feishu');
      return execOnDevice(deviceId, [`bash -lc '${OPENCLAW_RESOLVE_SNIPPET}; (if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" pairing list ${channel} 2>&1 || echo pairing_list_failed; else echo pairing_list_failed; fi)'`]);
    },
  };
}

function boardOpenClawPairingApproveTool(deviceId: string): Tool<{ code: string; channel?: string }> {
  return {
    name: 'board_openclaw_pairing_approve',
    description: '批准板端 OpenClaw 配对码（默认 feishu）。',
    inputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: '渠道名，默认 feishu' },
        code: { type: 'string', description: '配对码' },
      },
      required: ['code'],
    },
    async execute(input) {
      const channel = assertShellSafeToken('channel', input.channel || 'feishu');
      const code = assertShellSafeToken('code', input.code);
      return execOnDevice(deviceId, [`bash -lc '${OPENCLAW_RESOLVE_SNIPPET}; if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" pairing approve ${channel} ${code} 2>&1; else echo pairing_approve_failed:openclaw_not_found; fi'`]);
    },
  };
}

function boardOpenClawPairingRejectTool(deviceId: string): Tool<{ code: string; channel?: string }> {
  return {
    name: 'board_openclaw_pairing_reject',
    description: '拒绝板端 OpenClaw 配对码（默认 feishu）。',
    inputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: '渠道名，默认 feishu' },
        code: { type: 'string', description: '配对码' },
      },
      required: ['code'],
    },
    async execute(input) {
      const channel = assertShellSafeToken('channel', input.channel || 'feishu');
      const code = assertShellSafeToken('code', input.code);
      return execOnDevice(deviceId, [`bash -lc '${OPENCLAW_RESOLVE_SNIPPET}; if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" pairing reject ${channel} ${code} 2>&1; else echo pairing_reject_failed:openclaw_not_found; fi'`]);
    },
  };
}

function boardOpenClawLogsTool(deviceId: string): Tool<{ limit?: number }> {
  return {
    name: 'board_openclaw_logs',
    description: '查看板端 OpenClaw 网关日志（非跟随模式），默认最近 200 行。',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '日志行数，默认 200，最大 1000' },
      },
    },
    async execute(input) {
      const limit = Math.max(20, Math.min(1000, Number.isFinite(input.limit) ? Number(input.limit) : 200));
      return execOnDevice(deviceId, [`bash -lc '${OPENCLAW_RESOLVE_SNIPPET}; (if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" logs --limit ${limit} 2>&1 || true; else false; fi) || journalctl --user -u openclaw-gateway --no-pager -n ${limit} 2>&1 || echo no_logs'`]);
    },
  };
}

function boardOpenClawRestartGatewayTool(deviceId: string): Tool<Record<string, never>> {
  return {
    name: 'board_openclaw_restart_gateway',
    description: '重启板端 OpenClaw gateway 服务。重启后应调用 board_openclaw_health 验证服务是否恢复正常。',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    async execute() {
      return execOnDevice(deviceId, [
        `bash -lc '${OPENCLAW_RESOLVE_SNIPPET}; (systemctl --user restart openclaw-gateway 2>/dev/null || (if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" gateway restart || "$OPENCLAW_CMD" restart || true; else false; fi) || clawctl gateway restart || true) && (if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" status; else false; fi) || clawctl status || echo restarted'`,
      ]);
    },
  };
}

function boardOpenClawDoctorTool(deviceId: string): Tool<Record<string, never>> {
  return {
    name: 'board_openclaw_doctor',
    description: '在板端执行 openclaw doctor --fix，自动诊断并修复常见问题（配置、权限、daemon 等）。修复后应调用 board_openclaw_restart_gateway + board_openclaw_health 完成验证闭环。',
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      return execOnDevice(deviceId, [
        `bash -lc '${OPENCLAW_RESOLVE_SNIPPET}; (if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" doctor --fix --yes 2>&1 || "$OPENCLAW_CMD" doctor --fix 2>&1 || "$OPENCLAW_CMD" doctor 2>&1 || echo doctor_not_available; else echo doctor_not_available; fi)'`,
      ]);
    },
  };
}

function boardOpenClawModelTestTool(deviceId: string): Tool<Record<string, never>> {
  return {
    name: 'board_openclaw_model_test',
    description: '测试板端 OpenClaw 当前配置的模型是否可用（发送一条简单消息并检查是否有回复）。',
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      return execOnDevice(deviceId, [
        `bash -lc '${OPENCLAW_RESOLVE_SNIPPET}; (if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" message --message "reply OK" --timeout 30 2>&1 || "$OPENCLAW_CMD" message "reply OK" 2>&1 || echo MODEL_TEST_UNAVAILABLE; else echo MODEL_TEST_UNAVAILABLE; fi)'`,
      ]);
    },
  };
}

function boardOpenClawCheckTool(deviceId: string): Tool<Record<string, never>> {
  return {
    name: 'board_openclaw_check',
    description: '完整诊断板端 OpenClaw 环境：Node/npm 版本、安装状态、网关端口、配置（敏感字段已脱敏）、health。适合首次排查或全面体检；轻量检查用 board_openclaw_health。',
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      const maskPy = `import json,os,sys;p=os.path.expanduser("~/.openclaw/openclaw.json");d=json.load(open(p));
def mask(o):
 if isinstance(o,dict):
  return{k:("***" if any(s in k.lower() for s in ["key","token","secret","password"]) and isinstance(v,str) else mask(v)) for k,v in o.items()}
 if isinstance(o,list):return[mask(i) for i in o]
 return o
print(json.dumps(mask(d),indent=2))`.replace(/\n/g, ';');
      const cmds = [
        OPENCLAW_RESOLVE_SNIPPET,
        'echo "--- node ---"; node --version 2>&1 || echo not_installed',
        'echo "--- npm ---"; npm --version 2>&1 || echo not_installed',
        'echo "--- openclaw ---"; (if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" --version 2>&1; else echo not_installed; fi)',
        'echo "--- gateway port ---"; (ss -lntp 2>/dev/null || netstat -tlnp 2>/dev/null) | grep 18789 || echo port_not_listening',
        'echo "--- health ---"; (if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" health --json 2>&1 || "$OPENCLAW_CMD" status --all 2>&1 || true; else false; fi) || echo no_health',
        `echo "--- config (keys masked) ---"; python3 -c "${maskPy}" 2>/dev/null || (if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" config get 2>&1 || true; else false; fi) || echo no_config`,
      ].join('; ');
      return execOnDevice(deviceId, [`bash -lc '${cmds}'`]);
    },
  };
}

function boardOpenClawHealthTool(deviceId: string): Tool<Record<string, never>> {
  return {
    name: 'board_openclaw_health',
    description: '获取板端 OpenClaw 结构化健康状态（JSON：installed、gatewayRunning、version、hasToken、aiReady 等）。较慢（SSH + 板端 CLI）。' +
      '不要在每轮对话中例行调用；若 Studio 已显示 OpenClaw 在线则默认跳过。仅在用户报障、安装/升级/重启后需验收、delegate/chat 失败、或 UI 异常时再调用。',
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      return execOnDevice(deviceId, [
        `bash -lc '${OPENCLAW_RESOLVE_SNIPPET}; (if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" health --json 2>&1 || "$OPENCLAW_CMD" status --all --json 2>&1 || true; else false; fi) || echo "{\\"installed\\":false}"'`,
      ]);
    },
  };
}

function boardOpenClawSkillsListTool(deviceId: string): Tool<Record<string, never>> {
  return {
    name: 'board_openclaw_skills_list',
    description: '列出板端 OpenClaw 已安装的技能（clawhub list）和 plugins.allow 配置。',
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      const cmds = [
        OPENCLAW_RESOLVE_SNIPPET,
        'echo "--- installed skills ---"; (clawhub list 2>&1 || (if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" skills list 2>&1 || true; else false; fi)) || echo no_skills',
        'echo "--- plugins.allow ---"; cat ~/.openclaw/openclaw.json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d.get(\'plugins\',{}).get(\'allow\',[]),indent=2))" 2>/dev/null || echo no_plugins_config',
      ].join('; ');
      return execOnDevice(deviceId, [`bash -lc '${cmds}'`]);
    },
  };
}

function boardOpenClawSkillInstallTool(deviceId: string): Tool<{ skillId: string }> {
  return {
    name: 'board_openclaw_skill_install',
    description: '在板端安装 OpenClaw 技能/插件（通过 clawhub install）。安装后自动添加到 plugins.allow 并重启 gateway。',
    inputSchema: {
      type: 'object',
      properties: {
        skillId: { type: 'string', description: '要安装的技能 ID，如 @anthropic/memory 或 github-user/skill-name' },
      },
      required: ['skillId'],
    },
    async execute(input) {
      const id = input.skillId.replace(/[;&|`$()'"\\]/g, '');
      const pyAdd = `import json,os;p=os.path.expanduser('~/.openclaw/openclaw.json');d=json.load(open(p)) if os.path.exists(p) else {};a=d.setdefault('plugins',{}).setdefault('allow',[]);x='${id}';a.append(x) if x not in a else None;json.dump(d,open(p,'w'),indent=2);print('added',x)`;
      const cmds = [
        OPENCLAW_RESOLVE_SNIPPET,
        `echo "[OpenClaw] 安装技能 ${id}..."`,
        `(clawhub install ${id} 2>&1 || echo install_failed)`,
        'echo "[OpenClaw] 添加到 plugins.allow..."',
        `python3 -c "${pyAdd}" 2>&1`,
        '(systemctl --user restart openclaw-gateway 2>/dev/null || (if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" gateway restart || "$OPENCLAW_CMD" restart || true; else false; fi) || true)',
        'echo "[OpenClaw] 技能安装完成"',
      ].join('; ');
      return execOnDevice(deviceId, [`bash -lc '${cmds}'`]);
    },
  };
}

/** 与 Studio POST /api/devices/:id/openclaw/skill-write 等价；需用户已明确同意后再写入 */
function boardOpenClawWriteSkillTool(deviceId: string): Tool<{ skillId: string; content: string }> {
  return {
    name: 'board_openclaw_write_skill',
    description:
      '将自定义 SKILL.md 写入板端 OpenClaw 工作区（/root/.openclaw/workspace/skills/<skillId>/SKILL.md），与 RDK Studio「技能工坊」写入 API 一致。' +
      '仅在用户已明确确认要部署到板端后调用；skillId 为目录名（kebab-case），只能包含字母、数字、下划线、横线。',
    inputSchema: {
      type: 'object',
      properties: {
        skillId: {
          type: 'string',
          description: '技能目录名，如 my-nodehub-app（与 SKILL frontmatter 的 name 一致为佳）',
        },
        content: { type: 'string', description: '完整 SKILL.md 文本' },
      },
      required: ['skillId', 'content'],
    },
    async execute(input) {
      const id = String(input.skillId || '').trim();
      if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
        throw new Error('skillId 只能包含字母、数字、下划线和横线');
      }
      const remotePath = `/root/.openclaw/workspace/skills/${id}/SKILL.md`;
      await writeDeviceFile(deviceId, remotePath, input.content);
      return JSON.stringify({
        ok: true,
        path: remotePath,
        message: `已写入 ${remotePath}（${input.content.length} 字符）`,
      });
    },
  };
}

function rosTopicsTool(deviceId: string): Tool<Record<string, never>> {
  return {
    name: 'ros_topics',
    description: '获取 RDK 设备上的 ROS2 topic 列表。',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    async execute() {
      return execOnDevice(deviceId, [
        'bash -lc "source /opt/tros/humble/setup.bash 2>/dev/null; (command -v ros2 >/dev/null 2>&1 && ros2 topic list) || echo ROS2_NOT_INSTALLED"',
      ]);
    },
  };
}

function rosNodesTool(deviceId: string): Tool<Record<string, never>> {
  return {
    name: 'ros_nodes',
    description: '获取 RDK 设备上的 ROS2 节点列表。',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    async execute() {
      return execOnDevice(deviceId, [
        'bash -lc "source /opt/tros/humble/setup.bash 2>/dev/null; (command -v ros2 >/dev/null 2>&1 && ros2 node list) || echo ROS2_NOT_INSTALLED"',
      ]);
    },
  };
}

function vncStartTool(deviceId: string): Tool<Record<string, never>> {
  return {
    name: 'vnc_start',
    description: '启动 RDK 设备的 VNC 远程桌面服务。',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    async execute() {
      return execOnDevice(deviceId, [
        'sudo systemctl start vncserver@1.service 2>/dev/null || x11vnc -display :0 -forever -bg -nopw 2>/dev/null || echo "VNC 启动失败"',
      ]);
    },
  };
}

function vncStopTool(deviceId: string): Tool<Record<string, never>> {
  return {
    name: 'vnc_stop',
    description: '停止 RDK 设备的 VNC 远程桌面服务。',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    async execute() {
      return execOnDevice(deviceId, [
        'sudo systemctl stop vncserver@1.service 2>/dev/null; killall x11vnc 2>/dev/null; echo "VNC 已停止"',
      ]);
    },
  };
}

function vncStatusTool(deviceId: string): Tool<Record<string, never>> {
  return {
    name: 'vnc_status',
    description: '检查 RDK 设备的 VNC 远程桌面服务状态。',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    async execute() {
      return execOnDevice(deviceId, [
        'systemctl is-active vncserver@1.service 2>/dev/null || (pgrep x11vnc >/dev/null && echo "active" || echo "inactive")',
      ]);
    },
  };
}

function flashCheckTool(deviceId: string): Tool<Record<string, never>> {
  return {
    name: 'flash_check',
    description: '检查 RDK 设备的系统版本和烧录条件。',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    async execute() {
      const commands = [
        'echo "=== System Version ===" && cat /etc/version 2>/dev/null || echo "unknown"',
        'echo "=== Storage ===" && lsblk -o NAME,SIZE,TYPE,MOUNTPOINT 2>/dev/null || df -h',
        'echo "=== Board Info ===" && cat /sys/class/socinfo/board_id 2>/dev/null || echo "unknown"',
      ].join(' && ');
      return execOnDevice(deviceId, [commands]);
    },
  };
}

function ttsTextToSpeechTool(deviceId: string): Tool<{ text: string; voice?: string; speed?: string }> {
  return {
    name: 'text_to_speech',
    description:
      '将文字转换为语音音频文件（MP3）。支持中英文。' +
      '用于需要语音播报、TTS、朗读、文字转语音等场景。' +
      '需要设备联网（使用 edge-tts 在线合成）。' +
      '返回可播放的音频文件 URL。',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要合成为语音的文字内容' },
        voice: {
          type: 'string',
          description:
            '语音音色。中文推荐: zh-CN-XiaoxiaoNeural(女)、zh-CN-YunxiNeural(男)、' +
            'zh-CN-XiaoyiNeural(女温柔)、zh-CN-YunjianNeural(男沉稳)。' +
            '英文推荐: en-US-JennyNeural(女)、en-US-GuyNeural(男)。默认 zh-CN-XiaoxiaoNeural',
        },
        speed: {
          type: 'string',
          description: '语速调节，如 "+20%" 加速、"-10%" 减速。默认 "+0%"',
        },
      },
      required: ['text'],
    },
    async execute(input, ctx) {
      const voice = input.voice || 'zh-CN-XiaoxiaoNeural';
      const speed = input.speed || '+0%';
      const ts = Date.now();
      const remoteOut = `/tmp/tts_${ts}.mp3`;
      const localFileName = `tts_${ts}.mp3`;

      const pyScript = `
import asyncio, sys
try:
    import edge_tts
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'edge-tts', '-q'])
    import edge_tts

async def main():
    communicate = edge_tts.Communicate(
        text="""${input.text.replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"')}""",
        voice="${voice}",
        rate="${speed}",
    )
    await communicate.save("${remoteOut}")
    print("TTS_OK")

asyncio.run(main())
`.trim();

      const b64 = Buffer.from(pyScript, 'utf8').toString('base64');
      const cmd = `echo '${b64}' | base64 -d > /tmp/rdk_tts_${ts}.py && python3 /tmp/rdk_tts_${ts}.py 2>&1`;

      const output = await execOnDevice(deviceId, [cmd]);

      if (!output.includes('TTS_OK')) {
        return `TTS 合成失败:\n${output}\n\n提示: 请确保设备已联网且可访问 Microsoft Edge TTS 服务。`;
      }

      const localPath = path.resolve(ctx.workspaceDir, 'downloads', localFileName);
      const result = await downloadDeviceFileToLocal(deviceId, remoteOut, localPath);
      const audioUrl = `/api/local-files/${encodeURIComponent(localFileName)}`;

      await execOnDevice(deviceId, [`rm -f /tmp/rdk_tts_${ts}.py ${remoteOut}`]);

      return JSON.stringify({
        __type: 'audio_tts',
        text: input.text.slice(0, 100) + (input.text.length > 100 ? '...' : ''),
        voice,
        speed,
        audioUrl,
        localPath: result.localPath,
        bytes: result.bytes,
        message: `语音合成完成 (${(result.bytes / 1024).toFixed(1)} KB)，音频文件: [${localFileName}](${audioUrl})`,
      });
    },
  };
}

function sttSpeechToTextTool(deviceId: string): Tool<{ audio_path: string; language?: string }> {
  return {
    name: 'speech_to_text',
    description:
      '将设备上的音频文件转换为文字（语音识别/STT）。支持中英文。' +
      '用于语音识别、音频转文字、听写等场景。' +
      '需要设备联网（使用 Google Speech Recognition 在线识别）。' +
      '支持 wav/mp3/flac/ogg 等常见音频格式。',
    inputSchema: {
      type: 'object',
      properties: {
        audio_path: { type: 'string', description: '设备上的音频文件绝对路径，如 /tmp/recording.wav' },
        language: {
          type: 'string',
          description: '识别语言。zh-CN=中文（默认），en-US=英文，ja=日语。默认 zh-CN',
        },
      },
      required: ['audio_path'],
    },
    async execute(input) {
      const lang = input.language || 'zh-CN';
      const ts = Date.now();

      const pyScript = `
import sys, json

for mod in ['speech_recognition', 'pydub']:
    try:
        __import__(mod)
    except ImportError:
        import subprocess
        pkg = 'SpeechRecognition' if mod == 'speech_recognition' else mod
        subprocess.check_call([sys.executable, '-m', 'pip', 'install', pkg, '-q'])

import speech_recognition as sr
from pydub import AudioSegment
import os, tempfile

audio_path = "${input.audio_path.replace(/"/g, '\\"')}"
lang = "${lang}"

if not os.path.isfile(audio_path):
    print(json.dumps({"ok": False, "error": f"文件不存在: {audio_path}"}))
    sys.exit(0)

wav_path = audio_path
tmp_wav = None
ext = os.path.splitext(audio_path)[1].lower()
if ext not in ('.wav',):
    try:
        seg = AudioSegment.from_file(audio_path)
        tmp_wav = tempfile.mktemp(suffix='.wav')
        seg.export(tmp_wav, format='wav')
        wav_path = tmp_wav
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"音频格式转换失败: {e}"}))
        sys.exit(0)

recognizer = sr.Recognizer()
try:
    with sr.AudioFile(wav_path) as source:
        audio = recognizer.record(source)
    text = recognizer.recognize_google(audio, language=lang)
    print(json.dumps({"ok": True, "text": text, "language": lang}))
except sr.UnknownValueError:
    print(json.dumps({"ok": False, "error": "无法识别语音内容，音频可能太短、太安静或不清晰"}))
except sr.RequestError as e:
    print(json.dumps({"ok": False, "error": f"语音识别服务请求失败: {e}"}))
except Exception as e:
    print(json.dumps({"ok": False, "error": str(e)}))
finally:
    if tmp_wav and os.path.exists(tmp_wav):
        os.remove(tmp_wav)
`.trim();

      const b64 = Buffer.from(pyScript, 'utf8').toString('base64');
      const cmd = `echo '${b64}' | base64 -d > /tmp/rdk_stt_${ts}.py && python3 /tmp/rdk_stt_${ts}.py 2>&1; rm -f /tmp/rdk_stt_${ts}.py`;

      const output = await execOnDevice(deviceId, [cmd]);
      const jsonLine = output.split('\n').map(l => l.trim()).find(l => l.startsWith('{'));

      if (!jsonLine) {
        return `语音识别执行失败:\n${output}\n\n提示: 请确保设备已联网并安装了 ffmpeg（用于非 WAV 格式转换）。`;
      }

      try {
        const result = JSON.parse(jsonLine) as { ok: boolean; text?: string; error?: string; language?: string };
        if (result.ok && result.text) {
          return JSON.stringify({
            __type: 'stt_result',
            text: result.text,
            language: result.language || lang,
            audioPath: input.audio_path,
            message: `语音识别完成:\n\n"${result.text}"`,
          });
        }
        return `语音识别失败: ${result.error || '未知错误'}`;
      } catch {
        return `语音识别输出解析失败:\n${output}`;
      }
    },
  };
}

// ── sherpa-onnx 离线语音工具 ────────────────────────────────────

const SHERPA_MODEL_DIR = '/opt/sherpa-models';
const SHERPA_ASR_DIR = `${SHERPA_MODEL_DIR}/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17`;
const SHERPA_TTS_DIR = `${SHERPA_MODEL_DIR}/matcha-icefall-zh-baker`;
const SHERPA_VOCODER = `${SHERPA_MODEL_DIR}/vocos-22khz-univ.onnx`;
const SHERPA_VAD = `${SHERPA_MODEL_DIR}/silero_vad.onnx`;

function sherpaSetupTool(deviceId: string): Tool<Record<string, never>> {
  return {
    name: 'sherpa_setup',
    description:
      '一键安装 sherpa-onnx 离线语音环境（STT + TTS）。' +
      '安装 Python 包并下载 ASR（SenseVoice ~228MB）、TTS（Matcha ~72MB）、声码器（~51MB）、VAD（~2MB）模型。' +
      '幂等执行：已安装的部分会自动跳过。首次安装需联网下载约 350MB。',
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      const steps = [
        `echo "[1/6] 检查 & 安装 sherpa-onnx..."`,
        `python3 -c "import sherpa_onnx; print('sherpa-onnx already installed:', sherpa_onnx.__version__)" 2>/dev/null || pip3 install sherpa-onnx -q 2>&1`,
        `echo "[2/6] 创建模型目录..."`,
        `mkdir -p ${SHERPA_MODEL_DIR}`,

        `echo "[3/6] 检查 ASR 模型 (SenseVoice INT8)..."`,
        `if [ -f ${SHERPA_ASR_DIR}/model.int8.onnx ]; then echo "ASR model exists, skipping"; else ` +
          `echo "Downloading ASR model (~228MB)..." && ` +
          `cd ${SHERPA_MODEL_DIR} && ` +
          `wget -q --show-progress -O sensevoice.tar.bz2 https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2 && ` +
          `tar xjf sensevoice.tar.bz2 && rm -f sensevoice.tar.bz2 && ` +
          `echo "ASR model downloaded"; fi`,

        `echo "[4/6] 检查 TTS 模型 (Matcha-ICEFALL zh-baker)..."`,
        `if [ -f ${SHERPA_TTS_DIR}/model-steps-3.onnx ]; then echo "TTS model exists, skipping"; else ` +
          `echo "Downloading TTS model (~72MB)..." && ` +
          `cd ${SHERPA_MODEL_DIR} && ` +
          `wget -q --show-progress -O matcha-tts.tar.bz2 https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/matcha-icefall-zh-baker.tar.bz2 && ` +
          `tar xjf matcha-tts.tar.bz2 && rm -f matcha-tts.tar.bz2 && ` +
          `echo "TTS model downloaded"; fi`,

        `echo "[5/6] 检查声码器 (Vocos)..."`,
        `if [ -f ${SHERPA_VOCODER} ]; then echo "Vocoder exists, skipping"; else ` +
          `echo "Downloading vocoder (~51MB)..." && ` +
          `wget -q --show-progress -O ${SHERPA_VOCODER} https://github.com/k2-fsa/sherpa-onnx/releases/download/vocoder-models/vocos-22khz-univ.onnx && ` +
          `echo "Vocoder downloaded"; fi`,

        `echo "[6/6] 检查 VAD 模型 (Silero)..."`,
        `if [ -f ${SHERPA_VAD} ]; then echo "VAD model exists, skipping"; else ` +
          `echo "Downloading VAD model (~2MB)..." && ` +
          `wget -q --show-progress -O ${SHERPA_VAD} https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx && ` +
          `echo "VAD model downloaded"; fi`,

        `echo "=== 验证安装 ==="`,
        `python3 -c "import sherpa_onnx; print('sherpa-onnx version:', sherpa_onnx.__version__)"`,
        `ls -lh ${SHERPA_ASR_DIR}/model.int8.onnx ${SHERPA_TTS_DIR}/model-steps-3.onnx ${SHERPA_VOCODER} ${SHERPA_VAD} 2>&1`,
        `echo "[sherpa-onnx] 安装完成"`,
      ];
      const cmd = `bash -lc "${steps.join(' && ')}"`;
      return execOnDevice(deviceId, [cmd]);
    },
  };
}

function sherpaOfflineTtsTool(deviceId: string): Tool<{ text: string; speed?: number }> {
  return {
    name: 'sherpa_tts',
    description:
      '离线文字转语音（TTS）。使用 sherpa-onnx + Matcha-ICEFALL 中文模型在设备端本地合成语音，无需联网。' +
      '需先通过 sherpa_setup 安装环境。返回可播放的音频文件 URL。' +
      '如果失败，必须询问用户是否改用在线方案 text_to_speech（需联网）。',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要合成为语音的文字内容（支持中文和数字）' },
        speed: { type: 'number', description: '语速，1.0 为正常，>1 加速，<1 减速。默认 1.0' },
      },
      required: ['text'],
    },
    async execute(input, ctx) {
      const speed = input.speed ?? 1.0;
      const ts = Date.now();
      const remoteOut = `/tmp/sherpa_tts_${ts}.wav`;
      const localFileName = `sherpa_tts_${ts}.wav`;
      const textB64 = Buffer.from(input.text, 'utf8').toString('base64');

      const pyScript = `
import sys, json, os, base64

text = base64.b64decode("${textB64}").decode("utf-8")
speed = ${speed}
output_path = "${remoteOut}"

TTS_DIR = "${SHERPA_TTS_DIR}"
VOCODER = "${SHERPA_VOCODER}"

for f in [f"{TTS_DIR}/model-steps-3.onnx", VOCODER]:
    if not os.path.isfile(f):
        print(json.dumps({"ok": False, "error": f"文件不存在: {f}，请先运行 sherpa_setup"}))
        sys.exit(0)

try:
    import sherpa_onnx
except ImportError:
    print(json.dumps({"ok": False, "error": "sherpa-onnx 未安装，请先运行 sherpa_setup"}))
    sys.exit(0)

import numpy as np
import wave as wave_mod

try:
    tts_config = sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            matcha=sherpa_onnx.OfflineTtsMatchaModelConfig(
                acoustic_model=f"{TTS_DIR}/model-steps-3.onnx",
                vocoder=VOCODER,
                lexicon=f"{TTS_DIR}/lexicon.txt",
                tokens=f"{TTS_DIR}/tokens.txt",
                dict_dir=f"{TTS_DIR}/dict",
            ),
            num_threads=2,
            debug=False,
        ),
        rule_fsts=",".join(f"{TTS_DIR}/{n}" for n in ["phone.fst", "date.fst", "number.fst"]),
    )
    tts = sherpa_onnx.OfflineTts(tts_config)
    audio = tts.generate(text, sid=0, speed=speed)

    samples = np.array(audio.samples)
    samples = (samples * 32767).astype(np.int16)
    with wave_mod.open(output_path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(audio.sample_rate)
        wf.writeframes(samples.tobytes())

    duration = round(len(audio.samples) / audio.sample_rate, 2)
    file_size = os.path.getsize(output_path)
    print(json.dumps({"ok": True, "path": output_path, "duration": duration, "bytes": file_size}))
except Exception as e:
    print(json.dumps({"ok": False, "error": str(e)}))
`.trim();

      const b64 = Buffer.from(pyScript, 'utf8').toString('base64');
      const cmd = `echo '${b64}' | base64 -d > /tmp/rdk_sherpa_tts_${ts}.py && python3 /tmp/rdk_sherpa_tts_${ts}.py 2>&1`;

      const output = await execOnDevice(deviceId, [cmd]);
      const jsonLine = output.split('\n').map(l => l.trim()).find(l => l.startsWith('{'));

      await execOnDevice(deviceId, [`rm -f /tmp/rdk_sherpa_tts_${ts}.py`]);

      const offlineFallbackHint =
        '\n\n[离线方案失败] 请询问用户：是否改用在线方案（text_to_speech，需要设备联网）来完成语音合成？';

      if (!jsonLine) {
        return `离线 TTS 合成失败:\n${output}` + offlineFallbackHint;
      }

      try {
        const result = JSON.parse(jsonLine) as { ok: boolean; error?: string; duration?: number; bytes?: number };
        if (!result.ok) {
          return `离线 TTS 合成失败: ${result.error}` + offlineFallbackHint;
        }

        const localPath = path.resolve(ctx.workspaceDir, 'downloads', localFileName);
        const dlResult = await downloadDeviceFileToLocal(deviceId, remoteOut, localPath);
        const audioUrl = `/api/local-files/${encodeURIComponent(localFileName)}`;

        await execOnDevice(deviceId, [`rm -f ${remoteOut}`]);

        return JSON.stringify({
          __type: 'audio_tts',
          text: input.text.slice(0, 100) + (input.text.length > 100 ? '...' : ''),
          speed,
          audioUrl,
          localPath: dlResult.localPath,
          bytes: dlResult.bytes,
          duration: result.duration,
          offline: true,
          message: `离线语音合成完成 (${(dlResult.bytes / 1024).toFixed(1)} KB, ${result.duration}s)，音频文件: [${localFileName}](${audioUrl})`,
        });
      } catch {
        return `离线 TTS 输出解析失败:\n${output}` + offlineFallbackHint;
      }
    },
  };
}

function sherpaOfflineSttTool(deviceId: string): Tool<{ audio_path: string; language?: string }> {
  return {
    name: 'sherpa_stt',
    description:
      '离线语音转文字（STT）。使用 sherpa-onnx + SenseVoice 在设备端本地识别语音，无需联网。' +
      '支持中/英/日/韩/粤五种语言自动检测。需先通过 sherpa_setup 安装环境。' +
      '支持 wav/mp3/flac/ogg 等音频格式（非 wav 需 ffmpeg）。' +
      '如果失败，必须询问用户是否改用在线方案 speech_to_text（需联网）。',
    inputSchema: {
      type: 'object',
      properties: {
        audio_path: { type: 'string', description: '设备上的音频文件绝对路径，如 /tmp/recording.wav' },
        language: {
          type: 'string',
          description: '识别语言: auto=自动检测(默认), zh=中文, en=英文, ja=日语, ko=韩语, yue=粤语',
        },
      },
      required: ['audio_path'],
    },
    async execute(input) {
      const language = input.language || 'auto';
      const ts = Date.now();

      const pyScript = `
import sys, json, os, subprocess

audio_path = "${input.audio_path.replace(/"/g, '\\"')}"
language = "${language}"

ASR_DIR = "${SHERPA_ASR_DIR}"

if not os.path.isfile(audio_path):
    print(json.dumps({"ok": False, "error": f"文件不存在: {audio_path}"}))
    sys.exit(0)

if not os.path.isfile(f"{ASR_DIR}/model.int8.onnx"):
    print(json.dumps({"ok": False, "error": "ASR 模型未安装，请先运行 sherpa_setup"}))
    sys.exit(0)

try:
    import sherpa_onnx
except ImportError:
    print(json.dumps({"ok": False, "error": "sherpa-onnx 未安装，请先运行 sherpa_setup"}))
    sys.exit(0)

wav_path = audio_path
tmp_wav = None
ext = os.path.splitext(audio_path)[1].lower()
if ext not in ('.wav',):
    tmp_wav = f"/tmp/sherpa_stt_cvt_{os.getpid()}.wav"
    try:
        subprocess.check_call(
            ['ffmpeg', '-y', '-i', audio_path, '-ar', '16000', '-ac', '1', '-sample_fmt', 's16', tmp_wav],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        wav_path = tmp_wav
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"音频转换失败 (需要 ffmpeg): {e}"}))
        sys.exit(0)

try:
    recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=f"{ASR_DIR}/model.int8.onnx",
        tokens=f"{ASR_DIR}/tokens.txt",
        language=language,
        use_itn=True,
        num_threads=2,
        debug=False,
    )
    samples, sample_rate = sherpa_onnx.read_wave(wav_path)
    stream = recognizer.create_stream()
    stream.accept_waveform(sample_rate, samples)
    recognizer.decode(stream)

    text = stream.result.text.strip()
    duration = round(len(samples) / sample_rate, 2)
    print(json.dumps({"ok": True, "text": text, "language": language, "duration": duration}))
except Exception as e:
    print(json.dumps({"ok": False, "error": str(e)}))
finally:
    if tmp_wav and os.path.exists(tmp_wav):
        os.remove(tmp_wav)
`.trim();

      const b64 = Buffer.from(pyScript, 'utf8').toString('base64');
      const cmd = `echo '${b64}' | base64 -d > /tmp/rdk_sherpa_stt_${ts}.py && python3 /tmp/rdk_sherpa_stt_${ts}.py 2>&1; rm -f /tmp/rdk_sherpa_stt_${ts}.py`;

      const output = await execOnDevice(deviceId, [cmd]);
      const jsonLine = output.split('\n').map(l => l.trim()).find(l => l.startsWith('{'));

      const offlineFallbackHint =
        '\n\n[离线方案失败] 请询问用户：是否改用在线方案（speech_to_text，需要设备联网）来完成语音识别？';

      if (!jsonLine) {
        return `离线语音识别执行失败:\n${output}` + offlineFallbackHint;
      }

      try {
        const result = JSON.parse(jsonLine) as { ok: boolean; text?: string; error?: string; language?: string; duration?: number };
        if (result.ok && result.text) {
          return JSON.stringify({
            __type: 'stt_result',
            text: result.text,
            language: result.language || language,
            audioPath: input.audio_path,
            duration: result.duration,
            offline: true,
            message: `离线语音识别完成:\n\n"${result.text}"`,
          });
        }
        return `离线语音识别失败: ${result.error || '未知错误'}` + offlineFallbackHint;
      } catch {
        return `离线语音识别输出解析失败:\n${output}` + offlineFallbackHint;
      }
    },
  };
}
