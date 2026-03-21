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
