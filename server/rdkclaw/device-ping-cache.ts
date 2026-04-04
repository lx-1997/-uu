/** 仅缓存 ping「不可达」结果，与 `device-ping-probe` 共用；成功路径不入缓存。 */

export const DEVICE_PING_FAIL_CACHE_TTL_MS = 4000;

const store = new Map<string, { status: string; expiresAt: number }>();

export function getDevicePingFailCache(deviceId: string) {
  return store.get(deviceId);
}

export function setDevicePingOfflineCache(deviceId: string): void {
  store.set(deviceId, { status: 'offline', expiresAt: Date.now() + DEVICE_PING_FAIL_CACHE_TTL_MS });
}

export function deleteDevicePingFailCache(deviceId: string): void {
  store.delete(deviceId);
}
