/**
 * 进程内 SSH 密码缓存（与 devices.json 落盘密码互补）。
 * /api/devices/connect 与 device_connect_ssh 成功时写入，供 HTTP/Socket 在未带 x-device-password 时快速复用。
 */
export const devicePasswordCache = new Map<string, string>();

export function credentialCacheKey(host: string, username: string, port = 22): string {
  return `${host}:${port}::${username}`;
}

export function setDevicePasswordCache(host: string, username: string, port: number, password: string): void {
  devicePasswordCache.set(credentialCacheKey(host, username, port), password);
}

export function deleteDevicePasswordCache(host: string, username: string, port: number): void {
  devicePasswordCache.delete(credentialCacheKey(host, username, port));
}
