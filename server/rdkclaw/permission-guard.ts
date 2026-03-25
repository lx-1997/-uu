import * as path from 'node:path';
import type { ChannelSource, RiskLevel } from './types.js';

type GuardInput = {
  toolName: string;
  args: unknown;
  workspaceDir: string;
  channel: ChannelSource;
  permission: {
    workspaceBoundaryEnabled: boolean;
    devicePathBoundaryEnabled: boolean;
    hostMutationGuardEnabled: boolean;
    commandDangerGuardEnabled: boolean;
  };
};

export type PermissionGuardResult = {
  blocked: boolean;
  reason?: string;
  risk: RiskLevel;
};

const LOCAL_PROTECTED_SEGMENTS = [
  '/.git/',
  '/.cursor/',
  '/node_modules/',
  '/.ssh/',
  '/.gnupg/',
  '/.aws/',
];

const DEVICE_ALLOWED_WRITE_PREFIXES = [
  '/userdata',
  '/tmp',
  '/home',
  '/root/openclaw',
  '/root/.openclaw',
  '/etc/openclaw',
  '/opt/openclaw',
];

const DEVICE_BLOCKED_PREFIXES = [
  '/etc/shadow',
  '/etc/passwd',
  '/etc/sudoers',
  '/boot',
  '/root/.ssh',
  '/root/.gnupg',
];

const DANGEROUS_COMMAND_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s+([/~]|\/)/i, reason: '禁止递归删除根目录或用户目录' },
  { pattern: /\bmkfs\b|\bfdisk\b|\bdd\s+.*of=\/dev\//i, reason: '禁止磁盘破坏类命令' },
  { pattern: /\b(shutdown|reboot|halt|poweroff)\b/i, reason: '禁止关机/重启命令' },
  { pattern: /\bgit\s+push\s+.*--force\b/i, reason: '禁止强制推送' },
  { pattern: /\bcurl\b.*\|\s*(sh|bash)\b/i, reason: '禁止远程脚本直管道执行' },
  { pattern: /\bwget\b.*\|\s*(sh|bash)\b/i, reason: '禁止远程脚本直管道执行' },
];

const LOCAL_HOST_POLLUTION_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\b(sudo|doas)\b/i, reason: 'RDKClaw 不允许提权修改宿主机' },
  { pattern: /\b(apt|apt-get|yum|dnf|pacman|brew|winget|choco)\b/i, reason: 'RDKClaw 不允许修改宿主机包管理状态' },
  { pattern: /\b(systemctl|service|sc)\b/i, reason: 'RDKClaw 不允许管理宿主机系统服务' },
];

function normalizePathLike(inputPath: string): string {
  const normalized = inputPath.replace(/\\/g, '/');
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function extractString(input: unknown, key: string): string | null {
  if (!input || typeof input !== 'object') return null;
  const value = (input as Record<string, unknown>)[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isProtectedLocalPath(targetPath: string, workspaceDir: string): boolean {
  const normalized = normalizePathLike(path.resolve(workspaceDir, targetPath)).toLowerCase();
  return LOCAL_PROTECTED_SEGMENTS.some((segment) => normalized.includes(segment));
}

function isBlockedDevicePath(targetPath: string): boolean {
  const normalized = normalizePathLike(targetPath).toLowerCase();
  return DEVICE_BLOCKED_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

function isAllowedDeviceWritePath(targetPath: string): boolean {
  const normalized = normalizePathLike(targetPath).toLowerCase();
  return DEVICE_ALLOWED_WRITE_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

function getCommandRisk(command: string): RiskLevel {
  const trimmed = command.trim();
  if (!trimmed) return 'low';
  if (/\b(rm|mv|cp)\b/i.test(trimmed) || /\b(install|upgrade|restart|reconfigure)\b/i.test(trimmed)) {
    return 'high';
  }
  return 'medium';
}

function checkDangerousCommand(command: string): string | null {
  for (const entry of DANGEROUS_COMMAND_PATTERNS) {
    if (entry.pattern.test(command)) {
      return entry.reason;
    }
  }
  return null;
}

function checkLocalHostPollution(command: string): string | null {
  for (const entry of LOCAL_HOST_POLLUTION_PATTERNS) {
    if (entry.pattern.test(command)) {
      return entry.reason;
    }
  }
  return null;
}

export function evaluatePermissionGuard(input: GuardInput): PermissionGuardResult {
  const { toolName, args, workspaceDir, channel, permission } = input;
  const command = extractString(args, 'command');
  if (command) {
    if (permission.commandDangerGuardEnabled) {
      const dangerous = checkDangerousCommand(command);
      if (dangerous) {
        return { blocked: true, reason: dangerous, risk: 'high' };
      }
    }
    if (toolName === 'exec' && permission.hostMutationGuardEnabled) {
      const pollution = checkLocalHostPollution(command);
      if (pollution) {
        return { blocked: true, reason: pollution, risk: 'high' };
      }
    }
  }

  if ((toolName === 'write' || toolName === 'edit') && permission.workspaceBoundaryEnabled) {
    const targetPath = extractString(args, 'file_path');
    if (targetPath && isProtectedLocalPath(targetPath, workspaceDir)) {
      return { blocked: true, reason: '禁止改写受保护的本地目录（.git/.cursor/node_modules 等）', risk: 'high' };
    }
  }

  if (toolName === 'device_file_write' && permission.devicePathBoundaryEnabled) {
    const targetPath = extractString(args, 'path');
    if (targetPath && isBlockedDevicePath(targetPath)) {
      return { blocked: true, reason: '禁止写入板端敏感系统路径', risk: 'high' };
    }
    if (targetPath && !isAllowedDeviceWritePath(targetPath)) {
      return { blocked: true, reason: '仅允许写入板端开发目录（/userdata,/tmp,/home,/root/.openclaw 等）', risk: 'high' };
    }
  }

  if (toolName === 'device_file_upload_from_local' && permission.devicePathBoundaryEnabled) {
    const remotePath = extractString(args, 'remotePath');
    if (remotePath && isBlockedDevicePath(remotePath)) {
      return { blocked: true, reason: '禁止上传到板端敏感系统路径', risk: 'high' };
    }
    if (remotePath && !isAllowedDeviceWritePath(remotePath)) {
      return { blocked: true, reason: '上传目标必须位于板端开发目录', risk: 'high' };
    }
  }

  if (toolName === 'exec' || toolName === 'device_exec') {
    return { blocked: false, risk: command ? getCommandRisk(command) : 'medium' };
  }
  if (/write|upload|install|upgrade|restart|switch|remove|delete|flash|doctor|pairing_approve|pairing_reject|uninstall/i.test(toolName)) {
    return { blocked: false, risk: 'high' };
  }
  if (/read|list|status|health|check|topics|nodes|diagnose|search|memory_/.test(toolName)) {
    return { blocked: false, risk: 'low' };
  }
  return { blocked: false, risk: 'medium' };
}
