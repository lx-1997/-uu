/**
 * Per-device execution scheduler（可并发）.
 *
 * 每个 SSH `runRemoteCommands` 使用独立 ssh2 Client，板端通常可并行多条 exec；
 * 旧版为彻底串行，易使长任务阻塞同设备其它探测。现支持每设备 **多路并发**（默认 8，
 * 可用环境变量 `RDK_DEVICE_EXEC_MAX_CONCURRENT` 覆盖，至少为 1）。
 */

type QueueTask<T> = {
  enqueuedAt: number;
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

type DeviceLane = {
  /** 当前正在执行的 task 数 */
  active: number;
  maxConcurrent: number;
  queue: Array<QueueTask<unknown>>;
};

const lanes = new Map<string, DeviceLane>();

function resolveMaxConcurrent(): number {
  const raw = Number(process.env.RDK_DEVICE_EXEC_MAX_CONCURRENT);
  if (Number.isFinite(raw) && raw >= 1) {
    return Math.min(64, Math.floor(raw));
  }
  return 8;
}

function getLane(deviceId: string): DeviceLane {
  const key = String(deviceId || '').trim() || 'unknown';
  const existing = lanes.get(key);
  if (existing) return existing;
  const maxConcurrent = resolveMaxConcurrent();
  const created: DeviceLane = { active: 0, maxConcurrent, queue: [] };
  lanes.set(key, created);
  return created;
}

function cleanupLaneIfIdle(deviceId: string) {
  const lane = lanes.get(deviceId);
  if (!lane) return;
  if (lane.active > 0 || lane.queue.length > 0) return;
  lanes.delete(deviceId);
}

function drain(deviceId: string) {
  const lane = getLane(deviceId);
  while (lane.active < lane.maxConcurrent && lane.queue.length > 0) {
    const next = lane.queue.shift();
    if (!next) break;
    lane.active += 1;
    void (async () => {
      try {
        const result = await next.run();
        next.resolve(result);
      } catch (error) {
        next.reject(error);
      } finally {
        lane.active -= 1;
        drain(deviceId);
        cleanupLaneIfIdle(deviceId);
      }
    })();
  }
}

export function runInDeviceLane<T>(deviceId: string, task: () => Promise<T>) {
  const key = String(deviceId || '').trim() || 'unknown';
  const lane = getLane(key);
  return new Promise<T>((resolve, reject) => {
    lane.queue.push({
      enqueuedAt: Date.now(),
      run: () => task(),
      resolve: (value) => resolve(value as T),
      reject,
    });
    drain(key);
  });
}

export function getDeviceLaneStats() {
  const items = Array.from(lanes.entries()).map(([deviceId, lane]) => ({
    deviceId,
    active: lane.active,
    maxConcurrent: lane.maxConcurrent,
    queued: lane.queue.length,
    oldestQueuedMs: lane.queue.length > 0 ? Date.now() - lane.queue[0]!.enqueuedAt : 0,
  }));
  const active = items.reduce((sum, item) => sum + item.active, 0);
  const queued = items.reduce((sum, item) => sum + item.queued, 0);
  return { lanes: items, active, queued };
}
