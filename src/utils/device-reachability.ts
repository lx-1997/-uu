import { checkDevicePing } from '../api';

const BETWEEN_MS = 420;
const MAX_ATTEMPTS = 6;
/** 在「准备标离线」前，需累计多少次明确的 offline（非 transient）才认定不可达 */
const OFFLINE_HITS_REQUIRED = 3;

/**
 * 在后台 ping 已多次失败、即将标离线前调用：额外多轮探测，避免瞬时网络抖动误判。
 * @returns true 表示多轮后仍不可达，可标离线并提示用户；false 表示至少一轮仍可达，应保持在线。
 */
export async function confirmDeviceUnreachable(deviceId: string): Promise<boolean> {
  const id = String(deviceId || '').trim();
  if (!id) return true;

  let offlineHits = 0;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, BETWEEN_MS));
    }
    const res = await checkDevicePing(id);
    if (res.status === 'connected') return false;
    if (res.status === 'transient') continue;
    if (res.status === 'offline') {
      offlineHits += 1;
      if (offlineHits >= OFFLINE_HITS_REQUIRED) return true;
    }
  }
  return offlineHits >= OFFLINE_HITS_REQUIRED;
}
