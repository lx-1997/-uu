import { deleteDiagnosticsCache } from './device-diagnostics-cache.js';
import { invalidateOpenClawHealthCache } from './openclaw-health-cache.js';
import { deleteDevicePingFailCache } from './device-ping-cache.js';

/** 与设备「展示状态」相关的缓存分项；各占独立 Map，经此统一失效。 */
export type DeviceDerivedCacheScope = 'diagnostics' | 'openclawAiReady' | 'pingFail';

/**
 * 统一失效入口：连接变更、删设备、用户显式刷新等场景调用。
 * - `diagnostics`：`device-diagnostics-cache`
 * - `openclawAiReady`：`openclaw-health-cache`（Agent 委派短缓存，非 REST health 响应体缓存）
 * - `pingFail`：ping 负缓存，避免长期误判离线
 */
export function invalidateDeviceDerivedCaches(
  deviceId: string,
  scope: DeviceDerivedCacheScope[] | 'all' = 'all',
): void {
  const id = String(deviceId || '').trim();
  if (!id) return;

  const all = scope === 'all';
  const pick = all ? null : new Set(scope);
  const want = (k: DeviceDerivedCacheScope) => all || pick!.has(k);

  if (want('diagnostics')) deleteDiagnosticsCache(id);
  if (want('openclawAiReady')) invalidateOpenClawHealthCache(id);
  if (want('pingFail')) deleteDevicePingFailCache(id);
}
