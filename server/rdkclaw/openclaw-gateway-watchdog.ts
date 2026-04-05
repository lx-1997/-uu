/**
 * OpenClaw 网关后台看门狗（Studio 服务端）
 *
 * 周期性检查已注册设备：若 OpenClaw 已安装但网关未监听 18789，则触发与 UI「重启网关」一致的
 * runRestartGateway 智能链路（systemd user / CLI / nohup 兜底），并区分：
 * - Studio↔板 SSH 不可用 → 归类为连接/网络问题，不盲目重启进程
 * - 板端可连但网关停 → 自动修复并短时复检
 *
 * 环境变量：
 * - RDK_OC_GATEWAY_WATCHDOG=0 — 关闭看门狗
 * - RDK_OC_GATEWAY_WATCHDOG_MS — 轮询间隔（默认 120000）
 * - RDK_OC_GATEWAY_REPAIR_COOLDOWN_MS — 同一设备两次自动修复最小间隔（默认 300000）
 */

import type { OpenClawDeploymentManager, Device, OpenClawHealthStatus } from '../managers/OpenClawDeploymentManager.js';
import type { NotificationHub } from './notification-hub.js';
import type { Device as StudioDevice } from '../../shared/types.js';
import { invalidateOpenClawHealthCache } from './openclaw-health-cache.js';

export interface OpenClawGatewayWatchdogOptions {
  openClawManager: OpenClawDeploymentManager;
  readDevices: () => Promise<StudioDevice[]>;
  toOpenClawDevice: (d: StudioDevice) => Device;
  notificationHub?: NotificationHub;
}

type WatchReason =
  | 'skip_not_installed'
  | 'skip_ssh_unavailable'
  | 'skip_cooldown'
  | 'repaired'
  | 'repair_failed'
  | 'still_down_after_repair'
  | 'ok';

function healthPromise(
  mgr: OpenClawDeploymentManager,
  device: Device,
): Promise<OpenClawHealthStatus> {
  return new Promise((resolve) => {
    mgr.getHealthStatus(device, resolve);
  });
}

function classify(
  h: OpenClawHealthStatus,
): 'ssh_issue' | 'not_installed' | 'gateway_down' | 'other' {
  const sum = String(h.summary || '').trim();
  if (sum === '状态检测失败' || sum === '状态解析失败') return 'ssh_issue';
  if (!h.installed && sum === '未安装 OpenClaw') return 'not_installed';
  if (h.installed && !h.gatewayRunning) return 'gateway_down';
  return 'other';
}

function restartGatewayPromise(
  mgr: OpenClawDeploymentManager,
  device: Device,
): Promise<boolean> {
  return new Promise((resolve) => {
    mgr.runRestartGateway(
      device,
      () => {},
      (success) => resolve(success),
    );
  });
}

export function startOpenClawGatewayWatchdog(opts: OpenClawGatewayWatchdogOptions): () => void {
  if (process.env.RDK_OC_GATEWAY_WATCHDOG === '0' || process.env.RDK_OC_GATEWAY_WATCHDOG === 'false') {
    console.log('[OpenClawWatchdog] 已通过 RDK_OC_GATEWAY_WATCHDOG=0 禁用');
    return () => {};
  }

  const intervalMs = Math.max(
    60_000,
    Number.parseInt(process.env.RDK_OC_GATEWAY_WATCHDOG_MS || '120000', 10) || 120_000,
  );
  const repairCooldownMs = Math.max(
    60_000,
    Number.parseInt(process.env.RDK_OC_GATEWAY_REPAIR_COOLDOWN_MS || '300000', 10) || 300_000,
  );

  const lastRepairAt = new Map<string, number>();
  const lastSshWarnAt = new Map<string, number>();
  const consecutiveStillDown = new Map<string, number>();

  const tick = async () => {
    let devices: StudioDevice[];
    try {
      devices = await opts.readDevices();
    } catch {
      return;
    }

    for (const sd of devices) {
      const id = String(sd.id || '').trim();
      if (!id) continue;

      const ocDev = opts.toOpenClawDevice(sd);
      let h: OpenClawHealthStatus;
      try {
        h = await healthPromise(opts.openClawManager, ocDev);
      } catch {
        continue;
      }

      const kind = classify(h);
      if (kind === 'not_installed' || kind === 'other') {
        consecutiveStillDown.delete(id);
        continue;
      }

      if (kind === 'ssh_issue') {
        const now = Date.now();
        const last = lastSshWarnAt.get(id) ?? 0;
        if (now - last > 3_600_000 && opts.notificationHub) {
          lastSshWarnAt.set(id, now);
          opts.notificationHub.publish({
            type: 'openclaw_gateway_watchdog',
            title: 'OpenClaw 状态不可达',
            message: `设备 ${sd.name || id}：无法通过 SSH 完成健康检测（可能为本机与设备网络不通或 SSH 异常）。请检查网络与 SSH，而非板上网关进程本身。`,
            level: 'warning',
            ts: now,
            payload: { deviceId: id, reason: 'ssh_unavailable' },
          });
        }
        continue;
      }

      if (kind !== 'gateway_down') continue;

      const now = Date.now();
      const lastR = lastRepairAt.get(id) ?? 0;
      if (now - lastR < repairCooldownMs) {
        continue;
      }

      console.log(
        `[OpenClawWatchdog] ${id} OpenClaw 已安装但网关未运行，执行智能重启（${new Date().toISOString()}）`,
      );

      lastRepairAt.set(id, now);
      const repairOk = await restartGatewayPromise(opts.openClawManager, ocDev);
      invalidateOpenClawHealthCache(id);

      await new Promise((r) => setTimeout(r, 5000));
      let h2: OpenClawHealthStatus;
      try {
        h2 = await healthPromise(opts.openClawManager, ocDev);
      } catch {
        h2 = h;
      }

      const up = h2.gatewayRunning && h2.installed;
      if (up) {
        consecutiveStillDown.delete(id);
        if (opts.notificationHub) {
          opts.notificationHub.publish({
            type: 'openclaw_gateway_watchdog',
            title: 'OpenClaw 网关已恢复',
            message: `设备 ${sd.name || id}：后台已自动拉起网关（127.0.0.1:18789）。`,
            level: 'success',
            ts: Date.now(),
            payload: { deviceId: id, reason: 'repaired' as WatchReason },
          });
        }
        console.log(`[OpenClawWatchdog] ${id} 网关已恢复`);
        continue;
      }

      const n = (consecutiveStillDown.get(id) ?? 0) + 1;
      consecutiveStillDown.set(id, n);

      const detail =
        repairOk === false
          ? '重启命令未成功完成，请在本机 OpenClaw 面板查看日志或手动「诊断并修复」。'
          : '重启后端口仍不可用：可能是板端配置错误、资源不足或需执行 openclaw doctor --fix。';

      if (opts.notificationHub && n <= 3) {
        opts.notificationHub.publish({
          type: 'openclaw_gateway_watchdog',
          title: 'OpenClaw 网关仍异常',
          message: `设备 ${sd.name || id}：${detail}`,
          level: n >= 3 ? 'error' : 'warning',
          ts: Date.now(),
          payload: {
            deviceId: id,
            reason: 'still_down_after_repair' as WatchReason,
            consecutive: n,
          },
        });
      }

      console.warn(`[OpenClawWatchdog] ${id} 自动修复后网关仍未就绪 (第 ${n} 次)`);
    }
  };

  const handle = setInterval(() => {
    void tick();
  }, intervalMs);

  void tick();

  console.log(
    `[OpenClawWatchdog] 已启动：间隔 ${intervalMs}ms，修复冷却 ${repairCooldownMs}ms（RDK_OC_GATEWAY_WATCHDOG=0 可关闭）`,
  );

  return () => clearInterval(handle);
}
