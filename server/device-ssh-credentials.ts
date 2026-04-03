/**
 * Studio 全站 SSH 口令候选（单处维护，避免 HTTP / Agent / ping 行为分叉）。
 */
import type { Device } from '../shared/types.js';
import { DEFAULT_SSH_PASSWORD } from './constants.js';
import { credentialCacheKey, devicePasswordCache } from './device-password-cache.js';
import { sshPasswordCandidates } from './ssh.js';

const defaultSshPassword = process.env.RDK_SSH_PASSWORD?.trim() || DEFAULT_SSH_PASSWORD;

/**
 * 候选顺序（去重保序）：
 * 1. 请求头 X-Device-Password（显式覆盖）
 * 2. devices.json 落盘 password（用户「测试连接/保存」后的权威来源）
 * 3. 进程内缓存（上次 SSH 成功的口令，加速）
 * 4. RDK_SSH_PASSWORD（未设置则为产品默认 root）
 * 5. ssh.js 内置常见默认口令
 *
 * 落盘优先于内存缓存，避免：设备管理已更新 JSON，但缓存里仍是旧口令时，HTTP 只试一次且先试错。
 */
export function buildSshPasswordCandidatesForDevice(
  device: Device,
  options?: { requestHeaderPassword?: string },
): string[] {
  const key = credentialCacheKey(device.host, device.username, device.port ?? 22);
  const cached = devicePasswordCache.get(key) ?? '';
  const persisted = (device as Device & { password?: string }).password ?? '';
  const header = options?.requestHeaderPassword?.trim() ?? '';
  const ordered: string[] = [];
  const push = (p: string) => {
    const t = p.trim();
    if (t && !ordered.includes(t)) ordered.push(t);
  };
  push(header);
  push(persisted);
  push(cached);
  push(defaultSshPassword);
  for (const p of sshPasswordCandidates(device.username)) {
    push(p);
  }
  return ordered;
}

/** 单一首选口令（仅试一次的调用方）；与候选列表首项一致 */
export function resolvePrimarySshPassword(
  device: Device,
  options?: { requestHeaderPassword?: string },
): string {
  return buildSshPasswordCandidatesForDevice(device, options)[0] ?? '';
}

/** 设备 JSON 落盘密码 → RDK_SSH_PASSWORD → 产品默认 root */
export function resolvePersistedOrDefaultSshPassword(device: Device): string {
  const persisted = String((device as Device & { password?: string }).password ?? '').trim();
  return persisted || process.env.RDK_SSH_PASSWORD?.trim() || DEFAULT_SSH_PASSWORD;
}
