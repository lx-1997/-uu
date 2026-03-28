/**
 * 委派 board_openclaw_* 前的健康检测较重（SSH + 板端 Python）。
 * 在短时间内若已确认 aiReady，可跳过重复检测以加速协作回合。
 * 失败或超时后应 invalidate，避免误判。
 */
const TTL_MS = 45_000;
const cache = new Map<string, { at: number; aiReady: boolean }>();

export function getCachedOpenClawAiReady(deviceId: string): boolean | null {
  const id = String(deviceId || '').trim();
  if (!id) return null;
  const e = cache.get(id);
  if (!e || Date.now() - e.at > TTL_MS) return null;
  return e.aiReady;
}

export function setCachedOpenClawAiReady(deviceId: string, aiReady: boolean): void {
  const id = String(deviceId || '').trim();
  if (!id) return;
  cache.set(id, { at: Date.now(), aiReady });
}

export function invalidateOpenClawHealthCache(deviceId: string): void {
  const id = String(deviceId || '').trim();
  if (!id) return;
  cache.delete(id);
}
