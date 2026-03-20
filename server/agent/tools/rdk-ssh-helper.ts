/**
 * RDK SSH Helper — Agent 工具的 SSH 执行层
 *
 * 从 server/index.ts 中提取的设备执行逻辑，
 * 供 Agent 工具直接调用，不依赖 Express request/response。
 */

import { readDevices } from '../../storage.js';
import { runRemoteCommands, uploadFileSftp } from '../../ssh.js';
import type { Device } from '../../../shared/types.js';

const defaultSshPassword = process.env.RDK_SSH_PASSWORD ?? '';
const devicePasswordCache = new Map<string, string>();

function credentialCacheKey(host: string, username: string, port = 22) {
  return `${host}:${port}::${username}`;
}

function passwordCandidates(username: string): string[] {
  const candidates = [username, 'root', 'sunrise'].filter(Boolean);
  return Array.from(new Set(candidates));
}

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

  const key = credentialCacheKey(device.host, device.username, device.port ?? 22);
  const pwd = await getDevicePassword(device);
  const candidates = [pwd, ...passwordCandidates(device.username)];
  let lastError: unknown = null;

  for (const p of [...new Set(candidates)]) {
    try {
      const output = await runRemoteCommands(
        { host: device.host, port: device.port ?? 22, username: device.username, password: p },
        commands,
      );
      devicePasswordCache.set(key, p);
      return output;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('SSH 命令执行失败');
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

  const pwd = await getDevicePassword(device);
  await uploadFileSftp(
    { host: device.host, port: device.port ?? 22, username: device.username, password: pwd },
    filePath,
    Buffer.from(content, 'utf-8'),
  );
}

/**
 * 列出设备上的目录
 */
export async function listDeviceFiles(deviceId: string, dirPath: string): Promise<string> {
  return execOnDevice(deviceId, [`ls -la ${shEscape(dirPath)}`]);
}

function shEscape(raw: string) {
  return `'${raw.replace(/'/g, `'"'"'`)}'`;
}
