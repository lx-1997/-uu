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

export function createRdkTools(deviceId: string): Tool[] {
  const tools: Tool[] = [
    deviceExecTool(deviceId),
    deviceFileReadTool(deviceId),
    deviceFileWriteTool(deviceId),
    deviceFileListTool(deviceId),
    deviceFileDownloadToLocalTool(deviceId),
    deviceFileUploadFromLocalTool(deviceId),
    boardOpenClawStatusTool(deviceId),
    boardOpenClawReadConfigTool(deviceId),
    boardOpenClawInstallTool(deviceId),
    boardOpenClawUpgradeTool(deviceId),
    boardOpenClawUninstallTool(deviceId),
    boardOpenClawModelSwitchTool(deviceId),
    boardOpenClawFeishuConfigTool(deviceId),
    boardOpenClawPairingListTool(deviceId),
    boardOpenClawPairingApproveTool(deviceId),
    boardOpenClawPairingRejectTool(deviceId),
    boardOpenClawLogsTool(deviceId),
    boardOpenClawRestartGatewayTool(deviceId),
    deviceDiagnoseTool(deviceId),
    rosTopicsTool(deviceId),
    rosNodesTool(deviceId),
    vncStartTool(deviceId),
    vncStopTool(deviceId),
    vncStatusTool(deviceId),
    flashCheckTool(deviceId),
  ];
  return tools;
}

function deviceFileDownloadToLocalTool(deviceId: string): Tool<{ remotePath: string; localPath?: string }> {
  return {
    name: 'device_file_download_to_local',
    description: '把设备上的文件下载到本机（RDK Studio 所在电脑）。可选 localPath，不填则下载到 workspace/downloads/。',
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
    description: '在 RDK 设备上执行 shell 命令。用于运行任意命令、安装软件、查看系统状态、编译代码等。',
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
    description: '查看板端 OpenClaw 状态（进程/服务/版本摘要）。',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    async execute() {
      return execOnDevice(deviceId, [
        'bash -lc "(openclaw status || clawctl status || systemctl --user status openclaw-gateway --no-pager || ps -ef | grep -E \'openclaw|claw\' | grep -v grep || echo OpenClaw_NOT_FOUND)"',
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
        '(curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-onboard 2>&1 || npm install -g openclaw@latest 2>&1);',
        '(openclaw doctor --yes 2>&1 || openclaw doctor 2>&1 || true);',
        '(systemctl --user restart openclaw-gateway 2>/dev/null || openclaw gateway restart || true);',
        '(openclaw health --json 2>&1 || openclaw status --all 2>&1 || openclaw status 2>&1 || true)"',
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
        '(openclaw update --no-restart 2>&1 || openclaw update 2>&1 || npm install -g openclaw@latest 2>&1);',
        '(openclaw doctor --yes 2>&1 || openclaw doctor 2>&1 || true);',
        '(systemctl --user restart openclaw-gateway 2>/dev/null || openclaw gateway restart || true);',
        '(openclaw health --json 2>&1 || openclaw status --all 2>&1 || openclaw status 2>&1 || true)"',
      ].join(' ');
      return execOnDevice(deviceId, [cmd]);
    },
  };
}

function boardOpenClawUninstallTool(deviceId: string): Tool<Record<string, never>> {
  return {
    name: 'board_openclaw_uninstall',
    description: '卸载板端 OpenClaw（官方 uninstall 优先，失败回退手动清理）。高风险操作，建议先确认。',
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      const cmd = [
        'bash -lc',
        '"export NPM_CONFIG_PREFIX=\\"$HOME/.npm-global\\";',
        'export PATH=\\"$HOME/.npm-global/bin:$PATH\\";',
        '(openclaw uninstall --all --yes --non-interactive 2>&1 || ((openclaw gateway stop 2>/dev/null || true) && (openclaw gateway uninstall 2>/dev/null || true) && (systemctl --user stop openclaw-gateway 2>/dev/null || true) && (systemctl --user disable openclaw-gateway 2>/dev/null || true) && rm -rf ~/.openclaw 2>/dev/null || true));',
        '(npm rm -g openclaw 2>/dev/null || npm uninstall -g openclaw 2>/dev/null || true);"',
      ].join(' ');
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
        modelId: { type: 'string', description: '目标模型 ID，例如 qwen3.5-plus' },
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
      const cmd = `bash -lc "echo '${pyB64}' | base64 -d >/tmp/rdk_oc_switch_model.py && python3 /tmp/rdk_oc_switch_model.py '${payload}' && (systemctl --user restart openclaw-gateway 2>/dev/null || openclaw gateway restart || true) && (openclaw status 2>&1 || true)"`;
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
      const cmd = `bash -lc "echo '${pyB64}' | base64 -d >/tmp/rdk_oc_feishu_cfg.py && python3 /tmp/rdk_oc_feishu_cfg.py '${payload}' && (systemctl --user restart openclaw-gateway 2>/dev/null || openclaw gateway restart || true) && (openclaw gateway status 2>&1 || openclaw status 2>&1 || true)"`;
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
      const channel = (input.channel || 'feishu').trim();
      return execOnDevice(deviceId, [`bash -lc "openclaw pairing list ${channel} 2>&1 || echo pairing_list_failed"`]);
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
      const channel = (input.channel || 'feishu').trim();
      const code = input.code.trim();
      return execOnDevice(deviceId, [`bash -lc "openclaw pairing approve ${channel} ${code} 2>&1"`]);
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
      const channel = (input.channel || 'feishu').trim();
      const code = input.code.trim();
      return execOnDevice(deviceId, [`bash -lc "openclaw pairing reject ${channel} ${code} 2>&1"`]);
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
      return execOnDevice(deviceId, [`bash -lc "openclaw logs --limit ${limit} 2>&1 || journalctl --user -u openclaw-gateway --no-pager -n ${limit} 2>&1 || echo no_logs"`]);
    },
  };
}

function boardOpenClawRestartGatewayTool(deviceId: string): Tool<Record<string, never>> {
  return {
    name: 'board_openclaw_restart_gateway',
    description: '重启板端 OpenClaw gateway 服务。',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    async execute() {
      return execOnDevice(deviceId, [
        'bash -lc "(systemctl --user restart openclaw-gateway 2>/dev/null || openclaw gateway restart || clawctl gateway restart || true) && (openclaw status || clawctl status || echo restarted)"',
      ]);
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
        'bash -lc "(command -v ros2 >/dev/null 2>&1 && ros2 topic list) || echo ROS2_NOT_INSTALLED"',
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
        'bash -lc "(command -v ros2 >/dev/null 2>&1 && ros2 node list) || echo ROS2_NOT_INSTALLED"',
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
