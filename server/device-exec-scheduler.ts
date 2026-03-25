/**
 * Per-device serial execution scheduler.
 *
 * SSH connections to a single board cannot run commands concurrently
 * (each command occupies the SSH channel). This scheduler queues tasks
 * per device and drains them sequentially, preventing concurrent SSH
 * race conditions while allowing parallelism across different devices.
 *
 * Idle lanes are automatically garbage-collected to avoid Map growth
 * from transient devices.
 */

type QueueTask<T> = {
  enqueuedAt: number;
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

type DeviceLane = {
  active: boolean;
  queue: Array<QueueTask<unknown>>;
};

const lanes = new Map<string, DeviceLane>();

function getLane(deviceId: string): DeviceLane {
  const key = String(deviceId || '').trim() || 'unknown';
  const existing = lanes.get(key);
  if (existing) return existing;
  const created: DeviceLane = { active: false, queue: [] };
  lanes.set(key, created);
  return created;
}

function cleanupLaneIfIdle(deviceId: string) {
  const lane = lanes.get(deviceId);
  if (!lane) return;
  if (lane.active || lane.queue.length > 0) return;
  lanes.delete(deviceId);
}

function drain(deviceId: string) {
  const lane = getLane(deviceId);
  if (lane.active) return;
  const next = lane.queue.shift();
  if (!next) {
    cleanupLaneIfIdle(deviceId);
    return;
  }
  lane.active = true;
  void (async () => {
    try {
      const result = await next.run();
      next.resolve(result);
    } catch (error) {
      next.reject(error);
    } finally {
      lane.active = false;
      drain(deviceId);
    }
  })();
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
    queued: lane.queue.length,
    oldestQueuedMs: lane.queue.length > 0 ? Date.now() - lane.queue[0]!.enqueuedAt : 0,
  }));
  const active = items.filter((item) => item.active).length;
  const queued = items.reduce((sum, item) => sum + item.queued, 0);
  return { lanes: items, active, queued };
}
