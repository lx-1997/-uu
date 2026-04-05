/**
 * DeviceHealthMonitor — 代码级轻量设备健康检查
 *
 * 与 HeartbeatManager 配合：Heartbeat 触发 → 本模块执行检查 → 返回异常摘要给 Agent。
 * 设计原则：检查快速（<5s）、自愈有限（仅 gateway restart）、不打扰正常状态。
 */

import { execOnDevice, getDevice } from '../agent/tools/rdk-ssh-helper.js';
import { RESTART_GATEWAY_FALLBACK } from '../managers/OpenClawDeploymentManager.js';
import { OPENCLAW_RESOLVE_CLI_SNIPPET } from '../managers/openclaw-board-install-sh.js';

export interface HealthCheckResult {
  deviceId: string;
  timestamp: number;
  ok: boolean;
  anomalies: Anomaly[];
  selfHealed: string[];
}

export interface Anomaly {
  type: 'temperature' | 'disk' | 'memory' | 'gateway' | 'ssh';
  severity: 'warning' | 'critical';
  message: string;
  value?: string;
}

const TEMP_WARNING = 75;
const TEMP_CRITICAL = 85;
const DISK_WARNING = 85;
const DISK_CRITICAL = 95;
const MEMORY_WARNING = 85;

/**
 * Cap on cached health results to prevent unbounded Map growth
 * when many transient devices are registered over long uptimes.
 */
const MAX_CACHED_RESULTS = 200;

export class DeviceHealthMonitor {
  private lastCheck = new Map<string, HealthCheckResult>();

  async check(deviceId: string): Promise<HealthCheckResult> {
    const result: HealthCheckResult = {
      deviceId,
      timestamp: Date.now(),
      ok: true,
      anomalies: [],
      selfHealed: [],
    };

    const device = await getDevice(deviceId);
    if (!device) {
      result.ok = false;
      result.anomalies.push({
        type: 'ssh',
        severity: 'critical',
        message: `设备 ${deviceId} 未找到`,
      });
      this.lastCheck.set(deviceId, result);
      return result;
    }

    try {
      const output = await execOnDevice(deviceId, [
        [
          'cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo "N/A"',
          'df / --output=pcent 2>/dev/null | tail -1 || echo "N/A"',
          'free | awk \'/Mem:/{printf("%.0f", $3/$2*100)}\'  2>/dev/null || echo "N/A"',
          'ss -lntp 2>/dev/null | grep 18789 | wc -l || echo "0"',
        ].join(' && echo "---SEP---" && '),
      ]);

      const parts = output.split('---SEP---').map((s) => s.trim());

      this.checkTemperature(parts[0], result);
      this.checkDisk(parts[1], result);
      this.checkMemory(parts[2], result);
      await this.checkGateway(parts[3], deviceId, result);
    } catch (err) {
      result.ok = false;
      result.anomalies.push({
        type: 'ssh',
        severity: 'critical',
        message: `SSH 连接失败: ${(err as Error).message?.slice(0, 100)}`,
      });
    }

    result.ok = result.anomalies.every((a) => a.severity !== 'critical');
    this.lastCheck.set(deviceId, result);
    this.evictOldEntries();
    return result;
  }

  /**
   * Evict oldest entries when cache exceeds MAX_CACHED_RESULTS.
   * Map iteration order is insertion order, so we delete from the front.
   */
  private evictOldEntries() {
    if (this.lastCheck.size <= MAX_CACHED_RESULTS) return;
    const excess = this.lastCheck.size - MAX_CACHED_RESULTS;
    const iter = this.lastCheck.keys();
    for (let i = 0; i < excess; i++) {
      const key = iter.next().value;
      if (key !== undefined) this.lastCheck.delete(key);
    }
  }

  getLastResult(deviceId: string): HealthCheckResult | undefined {
    return this.lastCheck.get(deviceId);
  }

  formatForAgent(result: HealthCheckResult): string {
    if (result.ok && result.anomalies.length === 0) return '';

    const lines: string[] = [`[设备巡检] ${result.deviceId}`];
    for (const a of result.anomalies) {
      const icon = a.severity === 'critical' ? '[严重]' : '[警告]';
      lines.push(`${icon} ${a.message}`);
    }
    for (const h of result.selfHealed) {
      lines.push(`[自愈] ${h}`);
    }
    return lines.join('\n');
  }

  private checkTemperature(raw: string, result: HealthCheckResult) {
    if (!raw || raw === 'N/A') return;
    const tempMilliC = parseInt(raw, 10);
    if (isNaN(tempMilliC)) return;
    const tempC = tempMilliC / 1000;

    if (tempC >= TEMP_CRITICAL) {
      result.anomalies.push({
        type: 'temperature',
        severity: 'critical',
        message: `CPU 温度 ${tempC.toFixed(1)}°C 超过 ${TEMP_CRITICAL}°C 临界值`,
        value: `${tempC.toFixed(1)}°C`,
      });
    } else if (tempC >= TEMP_WARNING) {
      result.anomalies.push({
        type: 'temperature',
        severity: 'warning',
        message: `CPU 温度 ${tempC.toFixed(1)}°C 偏高`,
        value: `${tempC.toFixed(1)}°C`,
      });
    }
  }

  private checkDisk(raw: string, result: HealthCheckResult) {
    if (!raw || raw === 'N/A') return;
    const pct = parseInt(raw.replace('%', '').trim(), 10);
    if (isNaN(pct)) return;

    if (pct >= DISK_CRITICAL) {
      result.anomalies.push({
        type: 'disk',
        severity: 'critical',
        message: `磁盘使用率 ${pct}% 超过 ${DISK_CRITICAL}% 临界值`,
        value: `${pct}%`,
      });
    } else if (pct >= DISK_WARNING) {
      result.anomalies.push({
        type: 'disk',
        severity: 'warning',
        message: `磁盘使用率 ${pct}% 偏高`,
        value: `${pct}%`,
      });
    }
  }

  private checkMemory(raw: string, result: HealthCheckResult) {
    if (!raw || raw === 'N/A') return;
    const pct = parseInt(raw, 10);
    if (isNaN(pct)) return;

    if (pct >= MEMORY_WARNING) {
      result.anomalies.push({
        type: 'memory',
        severity: 'warning',
        message: `内存使用率 ${pct}% 偏高`,
        value: `${pct}%`,
      });
    }
  }

  private async checkGateway(raw: string, deviceId: string, result: HealthCheckResult) {
    if (!raw) return;
    const portListening = parseInt(raw.trim(), 10) > 0;

    if (!portListening) {
      result.anomalies.push({
        type: 'gateway',
        severity: 'warning',
        message: 'OpenClaw gateway 端口 18789 未监听，尝试自动重启',
      });

      try {
        await execOnDevice(deviceId, [
          `bash -lc 'export PATH="$HOME/.npm-global/bin:$PATH" && ${OPENCLAW_RESOLVE_CLI_SNIPPET} && ${RESTART_GATEWAY_FALLBACK}'`,
        ]);
        result.selfHealed.push('已尝试重启 OpenClaw gateway（与面板「重启网关」同一路径）');
      } catch {
        result.anomalies.push({
          type: 'gateway',
          severity: 'critical',
          message: 'OpenClaw gateway 自动重启失败',
        });
      }
    }
  }
}
