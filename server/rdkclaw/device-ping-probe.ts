import type { Device } from '../../shared/types.js';
import { verifySshConnection } from '../ssh.js';
import { buildSshPasswordCandidatesForDevice } from '../device-ssh-credentials.js';
import { setDevicePasswordCache } from '../device-password-cache.js';
import { getDevicePingFailCache, setDevicePingOfflineCache } from './device-ping-cache.js';

const PING_SSH_READY_TIMEOUT_MS = 8000;

export type DevicePingProbeResult = {
  ok: boolean;
  status: string;
  /** 是否在短期内复用了「离线」负缓存 */
  fromFailCache?: boolean;
};

/**
 * 与 `GET /api/devices/:id/ping` 同源：SSH 握手判定在线，失败时写入短 TTL 负缓存。
 */
export async function runDevicePingProbe(
  deviceId: string,
  device: Device,
  requestHeaderPassword: string,
): Promise<DevicePingProbeResult> {
  const cached = getDevicePingFailCache(deviceId);
  if (cached && cached.expiresAt > Date.now() && cached.status === 'offline') {
    return { ok: false, status: 'offline', fromFailCache: true };
  }

  const candidates = buildSshPasswordCandidatesForDevice(device, {
    requestHeaderPassword: requestHeaderPassword ?? '',
  });
  if (candidates.length === 0) {
    setDevicePingOfflineCache(deviceId);
    return { ok: false, status: 'offline' };
  }

  for (const pwd of candidates) {
    try {
      await verifySshConnection(
        {
          host: device.host,
          port: device.port ?? 22,
          username: device.username,
          password: pwd,
        },
        { readyTimeoutMs: PING_SSH_READY_TIMEOUT_MS },
      );
      setDevicePasswordCache(device.host, device.username, device.port ?? 22, pwd);
      return { ok: true, status: 'connected' };
    } catch {
      /* try next candidate */
    }
  }

  setDevicePingOfflineCache(deviceId);
  return { ok: false, status: 'offline' };
}
