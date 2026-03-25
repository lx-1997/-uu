/**
 * RDK SSH Helper — Agent 工具的 SSH 执行层
 *
 * 从 server/index.ts 中提取的设备执行逻辑，
 * 供 Agent 工具直接调用，不依赖 Express request/response。
 */

import { readDevices } from '../../storage.js';
import { runRemoteCommands, uploadFileSftp } from '../../ssh.js';
import type { Device } from '../../../shared/types.js';
import { runInDeviceLane } from '../../device-exec-scheduler.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const defaultSshPassword = process.env.RDK_SSH_PASSWORD ?? '';
const devicePasswordCache = new Map<string, string>();

function credentialCacheKey(host: string, username: string, port = 22) {
  return `${host}:${port}::${username}`;
}

function passwordCandidates(username: string): string[] {
  const candidates = [username, 'root', 'sunrise'].filter(Boolean);
  return Array.from(new Set(candidates));
}

function isTransientSshError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return /timed out|timeout|handshake|econnreset|econnrefused|socket closed|connection reset|connect failed|broken pipe|network|epipe/.test(msg);
}

function isSshAuthError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return /all configured authentication methods failed|permission denied|authentication failure|auth fail/.test(msg);
}

const TRANSIENT_RETRY_DELAY_MS = 1500;
const MAX_TRANSIENT_RETRIES = 2;

export async function getDevice(deviceId: string): Promise<Device | null> {
  const devices = await readDevices();
  return devices.find((d) => d.id === deviceId) ?? null;
}

export async function getDevicePassword(device: Device): Promise<string> {
  const key = credentialCacheKey(device.host, device.username, device.port ?? 22);
  const cached = devicePasswordCache.get(key);
  const persisted = (device as Device & { password?: string }).password ?? '';
  return cached || persisted || defaultSshPassword || device.username;
}

/**
 * 在设备上执行命令，返回输出文本。
 * 自动尝试多个密码候选。
 */
export async function execOnDevice(deviceId: string, commands: string[]): Promise<string> {
  const device = await getDevice(deviceId);
  if (!device) throw new Error(`设备 ${deviceId} 不存在`);
  return runInDeviceLane(device.id, async () => {
    const key = credentialCacheKey(device.host, device.username, device.port ?? 22);
    const pwd = await getDevicePassword(device);
    const candidates = [...new Set([pwd, ...passwordCandidates(device.username)])];
    let lastError: unknown = null;
    for (const p of candidates) {
      for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
        try {
          const output = await runRemoteCommands(
            { host: device.host, port: device.port ?? 22, username: device.username, password: p },
            commands,
          );
          devicePasswordCache.set(key, p);
          return output;
        } catch (err) {
          lastError = err;
          if (isSshAuthError(err)) break;
          if (attempt < MAX_TRANSIENT_RETRIES && isTransientSshError(err)) {
            console.warn(`[SSH] transient error on ${device.host}, retry ${attempt + 1}/${MAX_TRANSIENT_RETRIES}: ${err instanceof Error ? err.message : err}`);
            await new Promise((r) => setTimeout(r, TRANSIENT_RETRY_DELAY_MS * (attempt + 1)));
            continue;
          }
          break;
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error('SSH 命令执行失败');
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
  const device = await getDevice(deviceId);
  if (!device) throw new Error(`设备 ${deviceId} 不存在`);
  await runInDeviceLane(device.id, async () => {
    const key = credentialCacheKey(device.host, device.username, device.port ?? 22);
    const pwd = await getDevicePassword(device);
    const candidates = [...new Set([pwd, ...passwordCandidates(device.username)])];
    let lastError: unknown = null;
    for (const p of candidates) {
      for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
        try {
          await uploadFileSftp(
            { host: device.host, port: device.port ?? 22, username: device.username, password: p },
            filePath,
            Buffer.from(content, 'utf-8'),
          );
          devicePasswordCache.set(key, p);
          return;
        } catch (err) {
          lastError = err;
          if (isSshAuthError(err)) break;
          if (attempt < MAX_TRANSIENT_RETRIES && isTransientSshError(err)) {
            await new Promise((r) => setTimeout(r, TRANSIENT_RETRY_DELAY_MS * (attempt + 1)));
            continue;
          }
          break;
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error('设备文件写入失败');
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
  const encoded = await execOnDevice(deviceId, [
    `bash -lc "if [ -f ${shEscape(remotePath)} ]; then base64 -w 0 ${shEscape(remotePath)}; else echo __RDK_NOT_FOUND__; fi"`,
  ]);
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
  const device = await getDevice(deviceId);
  if (!device) throw new Error(`设备 ${deviceId} 不存在`);
  const buffer = await fs.readFile(localPath);
  return runInDeviceLane(device.id, async () => {
    const key = credentialCacheKey(device.host, device.username, device.port ?? 22);
    const pwd = await getDevicePassword(device);
    const candidates = [...new Set([pwd, ...passwordCandidates(device.username)])];
    let lastError: unknown = null;
    for (const p of candidates) {
      for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
        try {
          await uploadFileSftp(
            { host: device.host, port: device.port ?? 22, username: device.username, password: p },
            remotePath,
            buffer,
          );
          devicePasswordCache.set(key, p);
          return { bytes: buffer.length, remotePath };
        } catch (err) {
          lastError = err;
          if (isSshAuthError(err)) break;
          if (attempt < MAX_TRANSIENT_RETRIES && isTransientSshError(err)) {
            await new Promise((r) => setTimeout(r, TRANSIENT_RETRY_DELAY_MS * (attempt + 1)));
            continue;
          }
          break;
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error('本地文件上传到设备失败');
  });
}

function shEscape(raw: string) {
  return `'${raw.replace(/'/g, `'"'"'`)}'`;
}
