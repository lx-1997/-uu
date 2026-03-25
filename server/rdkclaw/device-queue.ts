/**
 * 设备级串行队列
 *
 * 在 command-queue.ts 的两层 lane 之上新增一层 "device lane"：
 *   DeviceLane(max=1) → SessionLane(max=1) → GlobalLane(max=N)
 *
 * 同一设备上来自 AI Dock / 飞书 / 微信的消息严格串行，
 * 不同设备之间可以并行（受 global lane 限制）。
 */

import { enqueueInLane, type EnqueueOpts } from "../agent/command-queue.js";
import type { ChannelSource } from "./types.js";

export interface DeviceRunInfo {
  channel: ChannelSource;
  messageSummary: string;
  startedAt: number;
}

export interface DeviceQueueStatus {
  running: DeviceRunInfo | null;
  pendingCount: number;
}

export interface DeviceEnqueueMeta {
  channel: ChannelSource;
  messageSummary: string;
}

const activeRuns = new Map<string, DeviceRunInfo>();
const pendingCounts = new Map<string, number>();

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function summarize(msg: string, maxLen = 30): string {
  const clean = msg.replace(/\s+/g, " ").trim();
  return clean.length > maxLen ? clean.slice(0, maxLen) + "..." : clean;
}

export class DeviceQueue {
  getLane(deviceId: string | undefined): string {
    const id = deviceId?.trim() || "local";
    return `device:${id}`;
  }

  getStatus(deviceLane: string): DeviceQueueStatus {
    return {
      running: activeRuns.get(deviceLane) ?? null,
      pendingCount: pendingCounts.get(deviceLane) ?? 0,
    };
  }

  /**
   * Acquire exclusive access to a device lane.
   * Resolves once it's our turn; the caller MUST call release() when done.
   * This is designed for async generators that need to yield events
   * while holding the queue slot.
   */
  async acquireSlot(
    deviceLane: string,
    meta: DeviceEnqueueMeta,
  ): Promise<{ release: () => void }> {
    const slotAcquired = deferred<void>();
    const slotReleased = deferred<void>();

    pendingCounts.set(deviceLane, (pendingCounts.get(deviceLane) ?? 0) + 1);

    void enqueueInLane<void>(
      deviceLane,
      async () => {
        pendingCounts.set(
          deviceLane,
          Math.max(0, (pendingCounts.get(deviceLane) ?? 1) - 1),
        );
        activeRuns.set(deviceLane, {
          channel: meta.channel,
          messageSummary: summarize(meta.messageSummary),
          startedAt: Date.now(),
        });
        slotAcquired.resolve();
        await slotReleased.promise;
        activeRuns.delete(deviceLane);
        if ((pendingCounts.get(deviceLane) ?? 0) <= 0) {
          pendingCounts.delete(deviceLane);
        }
      },
    ).catch(() => {
      slotAcquired.resolve();
    });

    await slotAcquired.promise;
    return { release: () => slotReleased.resolve() };
  }
}
