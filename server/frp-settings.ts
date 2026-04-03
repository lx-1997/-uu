import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveDataDir } from './storage.js';

export interface FrpStudioSettings {
  /** frps 公网地址（板端 frpc 的 serverAddr） */
  serverAddr: string;
  /** frps 监听端口，默认 7000 */
  serverPort: number;
  /** 与 frps.toml / frpc 一致 */
  token: string;
  /**
   * 经 frp 映射后，Studio 连接设备 SSH 时使用的公网地址（通常与 serverAddr 相同）
   */
  publicSshHost: string;
}

const DEFAULTS: FrpStudioSettings = {
  serverAddr: '',
  serverPort: 7000,
  token: '',
  publicSshHost: '',
};

export function getFrpSettingsPath(): string {
  return path.join(resolveDataDir(), 'frp-studio-settings.json');
}

export async function readFrpSettings(): Promise<FrpStudioSettings> {
  const p = getFrpSettingsPath();
  const raw = await fs.readFile(p, 'utf8').catch(() => '');
  if (!raw.trim()) {
    return { ...DEFAULTS };
  }
  try {
    const o = JSON.parse(raw) as Partial<FrpStudioSettings>;
    const serverPort = Number(o.serverPort);
    return {
      ...DEFAULTS,
      ...o,
      serverPort: Number.isFinite(serverPort) && serverPort > 0 ? serverPort : DEFAULTS.serverPort,
      serverAddr: String(o.serverAddr ?? '').trim(),
      token: String(o.token ?? '').trim(),
      publicSshHost: String(o.publicSshHost ?? '').trim(),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function writeFrpSettings(s: FrpStudioSettings): Promise<void> {
  const p = getFrpSettingsPath();
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(s, null, 2), 'utf8');
}

export function generateFrpToken(): string {
  return `rdk_${crypto.randomBytes(24).toString('hex')}`;
}
