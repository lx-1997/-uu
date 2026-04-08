import * as path from 'node:path';
import type { ChannelSource, RiskLevel } from './types.js';
import { stripShellPrefixBeforeHeredoc } from './channel-safety.js';
import { resolveSandboxPath } from '../agent/sandbox-paths.js';

export type SandboxGuardContext = {
  /** RDK Studio 安装 / 源码根目录（与 Agent.workspaceDir 一致） */
  studioInstallRoot: string;
  /** 用户工作台根（与 Agent.bootstrapDir / read·write 的 cwd 一致） */
  bootstrapDir: string;
  extraAllowedRoots?: string[];
};

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
  /** 传入时按真实沙箱解析路径，禁止读写落入安装目录（防绝对路径与 bootstrap 误指向仓库） */
  sandbox?: SandboxGuardContext;
  /**
   * 桌面包安装（Electron `RDK_PACKAGED_DESKTOP=1`）时为 true：**不**对安装目录做强沙箱（仅 SOUL/.git 等基线防护）。
   * 开发态（未设该变量）为 false：**启用**安装目录沙箱，防止 Agent 改本机上的 Studio 源码/工程目录。
   * 未传 `isPackagedDesktop` 且未传 `sandbox` 时走 legacy（单测）。
   */
  isPackagedDesktop?: boolean;
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
  '/.env',
];

const STUDIO_SOURCE_SEGMENTS = [
  '/server/',
  '/src/',
  '/shared/',
  '/package.json',
  '/package-lock.json',
  '/tsconfig',
  '/vite.config',
  '/tailwind.config',
  '/postcss.config',
  '/eslint',
  '/.prettierrc',
  '/Dockerfile',
  '/docker-compose',
];

const SENSITIVE_READ_PATTERNS = [
  '/.env',
  '/credentials',
  '/.netrc',
  '/api-key',
  '/apikey',
  '/secret',
  '/token.json',
  '/auth.json',
  '/oauth',
];

/**
 * 系统隐藏文件：Agent 工作区人格/配置文件，对用户不可见。
 * 这些文件已通过 ContextLoader 注入系统上下文，Agent 无需通过 read 工具读取。
 * 用户不应通过 Agent 的工具调用获取到这些文件的内容。
 */
const SYSTEM_HIDDEN_FILENAMES = [
  'soul.md',
  'agents.md',
  'bootstrap.md',
  'heartbeat.md',
  'identity.md',
  'memory.md',
  'tools.md',
  'user.md',
];

/**
 * 系统写入保护文件：必须通过专用工具（如 propose_soul_update）修改，不允许 write/edit 直接改。
 */
const SYSTEM_WRITE_LOCKED_FILENAMES = [
  'soul.md',
];

const DEVICE_ALLOWED_WRITE_PREFIXES = [
  '/userdata',
  '/tmp',
  '/home',
  /**
   * root 家目录下用户脚本/配置（如 /root/ws2812b.py）。
   * 敏感子路径仍由 DEVICE_BLOCKED_PREFIXES 拦截（如 /root/.ssh）。
   */
  '/root',
  '/root/openclaw',
  '/root/.openclaw',
  /** ROS/colcon 常见工作区（此前仅放行 /root/.openclaw，导致 /root/ros2_ws 等写入被误拦） */
  '/root/ros2_ws',
  '/root/ws',
  '/root/colcon_ws',
  '/root/catkin_ws',
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
  '/usr/lib/openclaw',
  '/usr/bin/openclaw',
  '/usr/local/lib/openclaw',
];

const DEVICE_DANGEROUS_DELETE_PATTERNS = [
  /\brm\s+.*\/opt\/openclaw\b/i,
  /\brm\s+.*\/etc\/openclaw\b/i,
  /\brm\s+.*\/root\/\.openclaw\b/i,
  /\brm\s+.*openclaw\.json\b/i,
  /\bsystemctl\s+(stop|disable)\s+openclaw/i,
  /\bnpm\s+uninstall\s+-g\s+.*openclaw/i,
  /\bkill\s+.*openclaw/i,
  /\bkillall\s+.*openclaw/i,
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

function isStudioSourcePath(targetPath: string, workspaceDir: string): boolean {
  const resolved = path.resolve(workspaceDir, targetPath);
  const normalized = normalizePathLike(resolved).toLowerCase();
  const workspaceNorm = normalizePathLike(workspaceDir).toLowerCase();
  if (!normalized.startsWith(workspaceNorm)) return false;
  const relative = normalized.slice(workspaceNorm.length);
  return STUDIO_SOURCE_SEGMENTS.some((seg) => relative.startsWith(seg) || relative === seg);
}

function isSensitiveReadPath(targetPath: string, workspaceDir: string): boolean {
  const resolved = path.resolve(workspaceDir, targetPath);
  const normalized = normalizePathLike(resolved).toLowerCase();
  return SENSITIVE_READ_PATTERNS.some((pat) => normalized.includes(pat));
}

function isPathUnderDir(filePath: string, dirPath: string): boolean {
  const absFile = path.resolve(filePath);
  const absDir = path.resolve(dirPath);
  if (absFile === absDir) return true;
  const rel = path.relative(absDir, absFile);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

function resolvedPathHasProtectedSegment(absPath: string): boolean {
  const normalized = normalizePathLike(absPath).toLowerCase();
  return LOCAL_PROTECTED_SEGMENTS.some((segment) => normalized.includes(segment));
}

function resolvedPathHasSensitiveReadSegment(absPath: string): boolean {
  const normalized = normalizePathLike(absPath).toLowerCase();
  return SENSITIVE_READ_PATTERNS.some((pat) => normalized.includes(pat));
}

/** 与 read/write 工具一致的路径解析；失败表示逃逸到未授权根，不在此拦截（交由工具报错） */
function tryResolveSandboxTarget(filePath: string, sandbox: SandboxGuardContext): string | null {
  try {
    const { resolved } = resolveSandboxPath({
      filePath,
      cwd: sandbox.bootstrapDir,
      root: sandbox.studioInstallRoot,
      extraRoots: sandbox.extraAllowedRoots,
    });
    return resolved;
  } catch {
    return null;
  }
}

function isSystemManagedPath(targetPath: string): boolean {
  const normalized = normalizePathLike(targetPath).toLowerCase();
  const baseName = path.posix.basename(normalized);
  return SYSTEM_HIDDEN_FILENAMES.includes(baseName);
}

function isSystemWriteLockedPath(targetPath: string): boolean {
  const normalized = normalizePathLike(targetPath).toLowerCase();
  const baseName = path.posix.basename(normalized);
  return SYSTEM_WRITE_LOCKED_FILENAMES.includes(baseName);
}

function normalizeDevicePath(devicePath: string): string {
  const posixNorm = path.posix.normalize(normalizePathLike(devicePath));
  return posixNorm.toLowerCase();
}

function isBlockedDevicePath(targetPath: string): boolean {
  const normalized = normalizeDevicePath(targetPath);
  return DEVICE_BLOCKED_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

function isAllowedDeviceWritePath(targetPath: string): boolean {
  const normalized = normalizeDevicePath(targetPath);
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
  const shellOnly = stripShellPrefixBeforeHeredoc(command);
  for (const entry of DANGEROUS_COMMAND_PATTERNS) {
    if (entry.pattern.test(shellOnly)) {
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
  const { toolName, args, workspaceDir, channel, permission, sandbox, isPackagedDesktop } = input;
  if (
    toolName === 'studio_open_url' ||
    toolName === 'studio_embedded_browser_capture' ||
    toolName === 'studio_open_local_preview'
  ) {
    return { blocked: false, risk: 'low' };
  }
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
    if (targetPath) {
      const strictInstallSandbox = isPackagedDesktop !== true && Boolean(sandbox);
      const relaxedPackagedApp = isPackagedDesktop === true;

      if (strictInstallSandbox && sandbox) {
        const resolvedTarget = tryResolveSandboxTarget(targetPath, sandbox);
        if (
          resolvedTarget &&
          isPathUnderDir(resolvedTarget, sandbox.studioInstallRoot)
        ) {
          return {
            blocked: true,
            reason:
              '开发模式下禁止修改 RDK Studio 工程/安装目录。请只改用户工作台（如 ~/.rdkstudio/rdkclaw-workspaces）；桌面包内不做此项整目录拦截。',
            risk: 'high',
          };
        }
        if (resolvedTarget) {
          if (isSystemWriteLockedPath(targetPath)) {
            return { blocked: true, reason: '该文件为系统托管文件，请使用 propose_soul_update 工具修改', risk: 'high' };
          }
          if (resolvedPathHasProtectedSegment(resolvedTarget)) {
            return {
              blocked: true,
              reason: '禁止改写受保护的本地目录（.git/.cursor/node_modules/.env 等）',
              risk: 'high',
            };
          }
        }
      } else if (relaxedPackagedApp) {
        if (isSystemWriteLockedPath(targetPath)) {
          return { blocked: true, reason: '该文件为系统托管文件，请使用 propose_soul_update 工具修改', risk: 'high' };
        }
        if (isProtectedLocalPath(targetPath, workspaceDir)) {
          return {
            blocked: true,
            reason: '禁止改写受保护的本地目录（.git/.cursor/node_modules/.env 等）',
            risk: 'high',
          };
        }
      } else {
        if (isSystemWriteLockedPath(targetPath)) {
          return { blocked: true, reason: '该文件为系统托管文件，请使用 propose_soul_update 工具修改', risk: 'high' };
        }
        if (isProtectedLocalPath(targetPath, workspaceDir)) {
          return { blocked: true, reason: '禁止改写受保护的本地目录（.git/.cursor/node_modules/.env 等）', risk: 'high' };
        }
        if (isStudioSourcePath(targetPath, workspaceDir)) {
          return { blocked: true, reason: '禁止修改 RDK Studio 源代码文件（server/src/package.json 等）', risk: 'high' };
        }
      }
    }
  }

  if (toolName === 'read' && permission.workspaceBoundaryEnabled) {
    const targetPath = extractString(args, 'file_path');
    if (targetPath) {
      const strictInstallSandbox = isPackagedDesktop !== true && Boolean(sandbox);
      const relaxedPackagedApp = isPackagedDesktop === true;

      if (strictInstallSandbox && sandbox) {
        const resolvedTarget = tryResolveSandboxTarget(targetPath, sandbox);
        if (
          resolvedTarget &&
          isPathUnderDir(resolvedTarget, sandbox.studioInstallRoot)
        ) {
          return {
            blocked: true,
            reason: '开发模式下禁止读取 RDK Studio 工程/安装目录（请使用用户工作台中的文件）',
            risk: 'high',
          };
        }
        if (resolvedTarget) {
          if (isSystemManagedPath(targetPath)) {
            return { blocked: true, reason: '该文件为系统托管文件，对用户不可见', risk: 'high' };
          }
          if (resolvedPathHasSensitiveReadSegment(resolvedTarget)) {
            return {
              blocked: true,
              reason: '禁止读取含敏感凭据的文件（.env/credentials/token 等）',
              risk: 'high',
            };
          }
        }
      } else if (relaxedPackagedApp) {
        if (isSystemManagedPath(targetPath)) {
          return { blocked: true, reason: '该文件为系统托管文件，对用户不可见', risk: 'high' };
        }
        if (isSensitiveReadPath(targetPath, workspaceDir)) {
          return { blocked: true, reason: '禁止读取含敏感凭据的文件（.env/credentials/token 等）', risk: 'high' };
        }
      } else {
        if (isSystemManagedPath(targetPath)) {
          return { blocked: true, reason: '该文件为系统托管文件，对用户不可见', risk: 'high' };
        }
        if (isSensitiveReadPath(targetPath, workspaceDir)) {
          return { blocked: true, reason: '禁止读取含敏感凭据的文件（.env/credentials/token 等）', risk: 'high' };
        }
      }
    }
  }

  if (toolName === 'device_file_write' && permission.devicePathBoundaryEnabled) {
    const targetPath = extractString(args, 'path');
    if (targetPath && isBlockedDevicePath(targetPath)) {
      return { blocked: true, reason: '禁止写入套件端敏感系统路径', risk: 'high' };
    }
    if (targetPath && !isAllowedDeviceWritePath(targetPath)) {
      return { blocked: true, reason: '仅允许写入套件端开发目录（/userdata,/tmp,/home,/root/.openclaw 等）', risk: 'high' };
    }
  }

  if (toolName === 'device_exec' && permission.commandDangerGuardEnabled) {
    if (command) {
      const shellOnly = stripShellPrefixBeforeHeredoc(command);
      for (const pat of DEVICE_DANGEROUS_DELETE_PATTERNS) {
        if (pat.test(shellOnly)) {
          return { blocked: true, reason: '禁止在套件端破坏 OpenClaw 核心文件或服务', risk: 'high' };
        }
      }
    }
  }

  if (toolName === 'device_file_upload_from_local' && permission.devicePathBoundaryEnabled) {
    const remotePath = extractString(args, 'remotePath');
    if (remotePath && isBlockedDevicePath(remotePath)) {
      return { blocked: true, reason: '禁止上传到套件端敏感系统路径', risk: 'high' };
    }
    if (remotePath && !isAllowedDeviceWritePath(remotePath)) {
      return { blocked: true, reason: '上传目标必须位于套件端开发目录', risk: 'high' };
    }
  }

  if (toolName === 'exec' || toolName === 'device_exec') {
    return { blocked: false, risk: command ? getCommandRisk(command) : 'medium' };
  }
  if (/write|upload|install|upgrade|restart|switch|remove|delete|flash|doctor|pairing_approve|pairing_reject|uninstall|ensure_find/i.test(toolName)) {
    return { blocked: false, risk: 'high' };
  }
  if (
    toolName === 'find_skills' ||
    toolName === 'skill_mark_validated' ||
    /read|list|status|health|check|topics|nodes|diagnose|search|memory_/.test(toolName)
  ) {
    return { blocked: false, risk: 'low' };
  }
  return { blocked: false, risk: 'medium' };
}
