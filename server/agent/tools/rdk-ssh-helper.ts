/**
 * RDK SSH Helper — Agent 工具的 SSH 执行层
 *
 * 从 server/index.ts 中提取的设备执行逻辑，
 * 供 Agent 工具直接调用，不依赖 Express request/response。
 */

import { readDevices, invalidateDevicesReadCache, resolveDataDir } from '../../storage.js';
import {
  runRemoteCommands,
  uploadFileSftp,
  SSH_DEFAULT_REMOTE_COMMAND_TIMEOUT_MS,
} from '../../ssh.js';
import type { Device } from '../../../shared/types.js';
import { runInDeviceLane } from '../../device-exec-scheduler.js';
import { setDevicePasswordCache } from '../../device-password-cache.js';
import { buildSshPasswordCandidatesForDevice } from '../../device-ssh-credentials.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

function isTransientSshError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    /timed out|timeout|handshake|econnreset|econnrefused|socket closed|connection reset|connect failed|broken pipe|network|epipe/.test(msg) ||
    /channel closed|connection lost|disconnect|not connected|write econnreset|write epipe|read econnreset|unexpected packet|no response|ssh_exchange/.test(msg) ||
    /connection closed|closed by remote|kex_exchange|mac error|bad packet/.test(msg)
  );
}

/** 供 device_exec 等向上返回更可读的失败说明（与 isTransientSshError 互补）。 */
export function isSshAuthError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return /all configured authentication methods failed|permission denied|authentication failure|auth fail/.test(msg);
}

const TRANSIENT_RETRY_DELAY_MS = 1500;
/** 弱网下多给一次重试（仍保持串行 lane，不放大并发） */
const MAX_TRANSIENT_RETRIES = 3;
/**
 * 握手/链路抖动时 ssh2 偶发报「authentication methods failed」，与真·错口令不易区分。
 * 对同一候选口令先额外重试 1 次再换下一口令，减少模型/用户手工 echo 探测。
 */
const AUTH_SHAPED_EXTRA_ATTEMPTS_PER_PASSWORD = 1;

/** SSH 认证失败时附带设备库路径，便于排查 sudo / 多用户导致的两份 devices.json */
function augmentAuthFailureError(err: unknown): Error {
  const base = err instanceof Error ? err : new Error(String(err));
  if (!isSshAuthError(base)) return base;
  const dataFile = path.join(resolveDataDir(), 'devices.json');
  let detail = `\n\nStudio 设备库: ${dataFile}`;
  if (
    typeof process.getuid === 'function' &&
    process.getuid() === 0 &&
    !String(process.env.RDK_DATA_DIR ?? '').trim() &&
    !String(process.env.SUDO_USER ?? '').trim()
  ) {
    detail +=
      '\n提示：进程以 **root** 运行且未设置 **RDK_DATA_DIR**、也无 **SUDO_USER** 时，设备数据在 root 的 ~/.rdk-studio/data，与普通用户下的 ~/.rdk-studio/data **不是同一份**。请避免无环境的 root 启动；或使用 `sudo npm run desktop`（保留 SUDO_USER）；或在 `.env` 中设置 `RDK_DATA_DIR` 统一路径。';
  }
  return new Error(`${base.message}${detail}`);
}

export type ExecOnDeviceOptions = {
  /** 覆盖 runRemoteCommands 默认（见 SSH_DEFAULT_REMOTE_COMMAND_TIMEOUT_MS，当前 30min） */
  timeoutMs?: number;
  /** 透传 SSH 流式输出（长任务进度） */
  onStreamChunk?: (text: string, stream: 'stdout' | 'stderr') => void;
};

export async function getDevice(deviceId: string): Promise<Device | null> {
  const devices = await readDevices();
  return devices.find((d) => d.id === deviceId) ?? null;
}

/** SSH/SFTP 前取设备：先失效读缓存，保证与 devices.json / 刚完成的 connect 一致 */
async function getDeviceFreshForExec(deviceId: string): Promise<Device | null> {
  invalidateDevicesReadCache();
  return getDevice(deviceId);
}

/** 当前优先使用的口令（首个候选），供仅需单值场景 */
export function getDevicePassword(device: Device): string {
  return buildSshPasswordCandidatesForDevice(device)[0] ?? '';
}

/**
 * 在设备上执行命令，返回输出文本。
 * 口令顺序：缓存 → 持久化 → RDK_SSH_PASSWORD → 出厂常见候选；认证失败时换下一候选。
 */
export async function execOnDevice(
  deviceId: string,
  commands: string[],
  options?: ExecOnDeviceOptions,
): Promise<string> {
  const device = await getDeviceFreshForExec(deviceId);
  if (!device) throw new Error(`设备 ${deviceId} 不存在`);
  const runOpts =
    options?.timeoutMs != null || options?.onStreamChunk
      ? {
          ...(options.timeoutMs != null ? { timeoutMs: options.timeoutMs } : {}),
          ...(options.onStreamChunk ? { onStreamChunk: options.onStreamChunk } : {}),
        }
      : undefined;
  return runInDeviceLane(device.id, async () => {
    const pwdList = buildSshPasswordCandidatesForDevice(device);
    if (pwdList.length === 0) {
      throw new Error('设备 SSH 密码未配置：请在设备管理中重新连接并保存密码，或设置环境变量 RDK_SSH_PASSWORD');
    }
    let lastError: unknown = null;
    for (const pwd of pwdList) {
      for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
        try {
          const output = await runRemoteCommands(
            { host: device.host, port: device.port ?? 22, username: device.username, password: pwd },
            commands,
            runOpts,
          );
          setDevicePasswordCache(device.host, device.username, device.port ?? 22, pwd);
          return output;
        } catch (err) {
          lastError = err;
          if (isSshAuthError(err)) {
            if (attempt < AUTH_SHAPED_EXTRA_ATTEMPTS_PER_PASSWORD) {
              console.warn(
                `[SSH] auth-shaped error on ${device.host}, retry same password (${attempt + 1}/${AUTH_SHAPED_EXTRA_ATTEMPTS_PER_PASSWORD + 1}): ${err instanceof Error ? err.message : err}`,
              );
              await new Promise((r) => setTimeout(r, TRANSIENT_RETRY_DELAY_MS * (attempt + 1)));
              continue;
            }
            break;
          }
          if (attempt < MAX_TRANSIENT_RETRIES && isTransientSshError(err)) {
            console.warn(
              `[SSH] transient error on ${device.host}, retry ${attempt + 1}/${MAX_TRANSIENT_RETRIES}: ${err instanceof Error ? err.message : err}`,
            );
            await new Promise((r) => setTimeout(r, TRANSIENT_RETRY_DELAY_MS * (attempt + 1)));
            continue;
          }
          break;
        }
      }
    }
    throw augmentAuthFailureError(lastError ?? new Error('SSH 命令执行失败'));
  });
}

/**
 * 读取设备上的文件内容
 */
export async function readDeviceFile(deviceId: string, filePath: string): Promise<string> {
  return execOnDevice(deviceId, [`cat ${shEscape(filePath)}`]);
}

/**
 * 写入文件到设备
 */
export async function writeDeviceFile(deviceId: string, filePath: string, content: string): Promise<void> {
  const device = await getDeviceFreshForExec(deviceId);
  if (!device) throw new Error(`设备 ${deviceId} 不存在`);
  await runInDeviceLane(device.id, async () => {
    const pwdList = buildSshPasswordCandidatesForDevice(device);
    if (pwdList.length === 0) {
      throw new Error('设备 SSH 密码未配置：请在设备管理中重新连接并保存密码，或设置环境变量 RDK_SSH_PASSWORD');
    }
    const buf = Buffer.from(content, 'utf-8');
    let lastError: unknown = null;
    for (const pwd of pwdList) {
      for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
        try {
          await uploadFileSftp(
            { host: device.host, port: device.port ?? 22, username: device.username, password: pwd },
            filePath,
            buf,
            {
              timeoutMs: Math.max(
                SSH_DEFAULT_REMOTE_COMMAND_TIMEOUT_MS,
                Math.min(600_000, buf.length / 10 + SSH_DEFAULT_REMOTE_COMMAND_TIMEOUT_MS),
              ),
            },
          );
          setDevicePasswordCache(device.host, device.username, device.port ?? 22, pwd);
          return;
        } catch (err) {
          lastError = err;
          if (isSshAuthError(err)) {
            if (attempt < AUTH_SHAPED_EXTRA_ATTEMPTS_PER_PASSWORD) {
              await new Promise((r) => setTimeout(r, TRANSIENT_RETRY_DELAY_MS * (attempt + 1)));
              continue;
            }
            break;
          }
          if (attempt < MAX_TRANSIENT_RETRIES && isTransientSshError(err)) {
            await new Promise((r) => setTimeout(r, TRANSIENT_RETRY_DELAY_MS * (attempt + 1)));
            continue;
          }
          break;
        }
      }
    }
    throw augmentAuthFailureError(lastError ?? new Error('设备文件写入失败'));
  });
}

/**
 * 列出设备上的目录
 */
export async function listDeviceFiles(deviceId: string, dirPath: string): Promise<string> {
  return execOnDevice(deviceId, [`ls -la ${shEscape(dirPath)}`]);
}

/**
 * 从设备下载文件到本地（当前机器）
 */
export async function downloadDeviceFileToLocal(
  deviceId: string,
  remotePath: string,
  localPath: string,
): Promise<{ bytes: number; localPath: string }> {
  const encoded = await execOnDevice(
    deviceId,
    [
      `bash -lc "if [ -f ${shEscape(remotePath)} ]; then base64 -w 0 ${shEscape(remotePath)}; else echo __RDK_NOT_FOUND__; fi"`,
    ],
    { timeoutMs: SSH_DEFAULT_REMOTE_COMMAND_TIMEOUT_MS },
  );
  const data = encoded.trim();
  if (!data || data === '__RDK_NOT_FOUND__') {
    throw new Error(`设备文件不存在: ${remotePath}`);
  }
  const buffer = Buffer.from(data, 'base64');
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, buffer);
  return { bytes: buffer.length, localPath };
}

/**
 * 从本地上传文件到设备
 */
export async function uploadLocalFileToDevice(
  deviceId: string,
  localPath: string,
  remotePath: string,
): Promise<{ bytes: number; remotePath: string }> {
  const device = await getDeviceFreshForExec(deviceId);
  if (!device) throw new Error(`设备 ${deviceId} 不存在`);
  const buffer = await fs.readFile(localPath);
  return runInDeviceLane(device.id, async () => {
    const pwdList = buildSshPasswordCandidatesForDevice(device);
    if (pwdList.length === 0) {
      throw new Error('设备 SSH 密码未配置：请在设备管理中重新连接并保存密码，或设置环境变量 RDK_SSH_PASSWORD');
    }
    const uploadTimeout = Math.max(
      SSH_DEFAULT_REMOTE_COMMAND_TIMEOUT_MS,
      Math.min(600_000, buffer.length / 10 + SSH_DEFAULT_REMOTE_COMMAND_TIMEOUT_MS),
    );
    let lastError: unknown = null;
    for (const pwd of pwdList) {
      for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
        try {
          await uploadFileSftp(
            { host: device.host, port: device.port ?? 22, username: device.username, password: pwd },
            remotePath,
            buffer,
            { timeoutMs: uploadTimeout },
          );
          setDevicePasswordCache(device.host, device.username, device.port ?? 22, pwd);
          return { bytes: buffer.length, remotePath };
        } catch (err) {
          lastError = err;
          if (isSshAuthError(err)) {
            if (attempt < AUTH_SHAPED_EXTRA_ATTEMPTS_PER_PASSWORD) {
              await new Promise((r) => setTimeout(r, TRANSIENT_RETRY_DELAY_MS * (attempt + 1)));
              continue;
            }
            break;
          }
          if (attempt < MAX_TRANSIENT_RETRIES && isTransientSshError(err)) {
            await new Promise((r) => setTimeout(r, TRANSIENT_RETRY_DELAY_MS * (attempt + 1)));
            continue;
          }
          break;
        }
      }
    }
    throw augmentAuthFailureError(lastError ?? new Error('本地文件上传到设备失败'));
  });
}

function shEscape(raw: string) {
  return `'${raw.replace(/'/g, `'"'"'`)}'`;
}
