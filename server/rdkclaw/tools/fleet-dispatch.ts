/**
 * Multi-board fleet dispatch tools.
 *
 * Enables AI to coordinate tasks across multiple RDK boards by:
 * 1. Listing boards with hardware capability profiles (BPU TOPS, RAM, CPU)
 * 2. Delegating tasks to specific boards with role-based scheduling
 * 3. Broadcasting tasks to all unique boards and aggregating results
 *
 * Key design decisions:
 * - IP-based deduplication: multiple device entries sharing the same IP
 *   are treated as duplicates (common when boards are re-registered)
 * - Hardware-aware context injection: each delegation includes the target
 *   board's hardware profile so the remote OpenClaw agent can tailor its
 *   approach (e.g., use lighter models on X3 vs heavier ones on X5/Ultra)
 * - Conflict prevention: tasks are tracked globally to prevent concurrent
 *   commands to the same physical board
 */
import type { Tool } from '../../agent/tools/types.js';
import { readDevices } from '../../storage.js';
import { OpenClawDeploymentManager } from '../../managers/OpenClawDeploymentManager.js';
import type { Device } from '../../../shared/types.js';
import { DEVICE_PROFILES, type DeviceProfile } from '../../ecosystem/device-profiles.js';
import type { RdkPlatform } from '../../../shared/ecosystem-types.js';

function resolveDevicePassword(device: Device) {
  const persisted = (device as Device & { password?: string }).password ?? '';
  const envPwd = process.env.RDK_SSH_PASSWORD ?? '';
  return persisted || envPwd || device.username;
}

function toBoardDevice(device: Device) {
  return {
    ip: device.host,
    userName: device.username,
    id: device.id,
    password: resolveDevicePassword(device),
  };
}

// ─── Fleet Coordination State ───
// Tracks what each board is doing to prevent conflicts and share context.

interface FleetTaskRecord {
  deviceId: string;
  task: string;
  startedAt: number;
  status: 'running' | 'done' | 'failed';
  summary?: string;
}

const fleetTaskLog: FleetTaskRecord[] = [];
const MAX_TASK_LOG = 50;

function recordFleetTask(record: FleetTaskRecord) {
  fleetTaskLog.push(record);
  if (fleetTaskLog.length > MAX_TASK_LOG) fleetTaskLog.splice(0, fleetTaskLog.length - MAX_TASK_LOG);
}

function getActiveFleetTasks(): FleetTaskRecord[] {
  const cutoff = Date.now() - 120_000;
  return fleetTaskLog.filter((t) => t.status === 'running' && t.startedAt > cutoff);
}

function getRecentFleetHistory(limit = 10): FleetTaskRecord[] {
  return fleetTaskLog.slice(-limit);
}

function markFleetTaskDone(deviceId: string, status: 'done' | 'failed', summary?: string) {
  for (let i = fleetTaskLog.length - 1; i >= 0; i--) {
    if (fleetTaskLog[i].deviceId === deviceId && fleetTaskLog[i].status === 'running') {
      fleetTaskLog[i].status = status;
      fleetTaskLog[i].summary = summary;
      break;
    }
  }
}

// ─── IP Dedup Helpers ───

function detectDuplicateIps(devices: Device[]): Map<string, Device[]> {
  const byIp = new Map<string, Device[]>();
  for (const d of devices) {
    const key = `${d.host}:${d.port ?? 22}`;
    const list = byIp.get(key) || [];
    list.push(d);
    byIp.set(key, list);
  }
  const dupes = new Map<string, Device[]>();
  for (const [key, list] of byIp) {
    if (list.length > 1) dupes.set(key, list);
  }
  return dupes;
}

function deduplicateDevices(devices: Device[]): Device[] {
  const seen = new Set<string>();
  const result: Device[] = [];
  for (const d of devices) {
    const key = `${d.host}:${d.port ?? 22}:${d.username}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(d);
    }
  }
  return result;
}

function getDeviceCapability(device: Device): {
  platform: string | null;
  profile: { displayName: string; bpuTops: number; ramGb: number; cpu: string; capabilities: string[] } | null;
} {
  const platform = (device as any).platform as RdkPlatform | undefined;
  if (!platform) return { platform: null, profile: null };
  const p = DEVICE_PROFILES[platform];
  if (!p) return { platform, profile: null };
  return {
    platform,
    profile: {
      displayName: p.displayName,
      bpuTops: p.bpuTops,
      ramGb: p.ramGb,
      cpu: p.cpu,
      capabilities: p.capabilityNotes,
    },
  };
}

/**
 * Lists all connected devices with dedup warnings and coordination context.
 */
export function fleetBoardListTool(
  currentDeviceId: string,
  manager: OpenClawDeploymentManager,
): Tool<Record<string, never>> {
  return {
    name: 'fleet_board_list',
    description:
      '列出所有已注册的板卡设备，包含硬件能力画像、去重检测和协调状态。' +
      '返回每个板卡的型号/BPU算力/内存/CPU等信息，帮助智能调度。' +
      '自动检测同 IP 重复注册，展示各板卡当前任务状态。',
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      const devices = await readDevices();
      if (devices.length === 0) {
        return JSON.stringify({ boards: [], message: '没有已注册的设备' });
      }

      const duplicates = detectDuplicateIps(devices);
      const uniqueDevices = deduplicateDevices(devices);
      const activeTasks = getActiveFleetTasks();

      const boards = uniqueDevices.map((d) => {
        const ipKey = `${d.host}:${d.port ?? 22}`;
        const dupeGroup = duplicates.get(ipKey);
        const activeTask = activeTasks.find((t) => t.deviceId === d.id);
        const cap = getDeviceCapability(d);
        return {
          id: d.id,
          name: `${d.username}@${d.host}:${d.port ?? 22}`,
          host: d.host,
          isCurrent: d.id === currentDeviceId,
          busy: !!activeTask,
          currentTask: activeTask ? activeTask.task.slice(0, 60) : null,
          hardware: cap.profile ? {
            model: cap.profile.displayName,
            bpuTops: cap.profile.bpuTops,
            ramGb: cap.profile.ramGb,
            cpu: cap.profile.cpu,
            strengths: cap.profile.capabilities.slice(0, 3),
          } : (cap.platform ? { model: cap.platform } : null),
          duplicateWarning: dupeGroup && dupeGroup.length > 1
            ? `同 IP 注册了 ${dupeGroup.length} 次（IDs: ${dupeGroup.map((x) => x.id).join(', ')}），可能是同一设备`
            : null,
        };
      });

      const warnings: string[] = [];
      if (duplicates.size > 0) {
        for (const [ip, list] of duplicates) {
          warnings.push(
            `IP ${ip} 被注册了 ${list.length} 次（${list.map((d) => d.id).join(', ')}），` +
            '很可能是同一物理设备，向其中多个发送任务会导致冲突。建议只选择其中一个。',
          );
        }
      }

      return JSON.stringify({
        total: devices.length,
        uniqueBoards: uniqueDevices.length,
        currentDeviceId,
        boards,
        warnings: warnings.length ? warnings : undefined,
        coordination: {
          activeTasks: activeTasks.length,
          recentHistory: getRecentFleetHistory(5).map((t) => ({
            device: t.deviceId.slice(0, 8),
            task: t.task.slice(0, 40),
            status: t.status,
          })),
          hint: '多板卡智能调度原则：' +
            '1) 根据硬件能力分配任务：重计算任务优先分配给 bpuTops/ramGb 更大的板卡；' +
            '2) 模型格式注意兼容：X3(Bernoulli2) 和 X5/Ultra(Bayes) 和 S100(Nash) 模型不通用；' +
            '3) 同一板卡任务自动串行，busy 板卡建议等待；' +
            '4) 同 IP 设备只派其一，避免 SSH 冲突；' +
            '5) 角色分工：让高算力板卡做推理(executor)，低算力板卡做数据预处理或监控(advisor)。',
        },
      }, null, 2);
    },
  };
}

/**
 * Delegates a task to a specific board with coordination tracking.
 */
export function fleetBoardDelegateTool(
  currentDeviceId: string,
  manager: OpenClawDeploymentManager,
  onProgress?: (chunk: string) => void,
): Tool<{
  targetDeviceId: string;
  task: string;
  guidance?: string;
  role?: string;
  sessionId?: string;
}> {
  return {
    name: 'fleet_board_delegate',
    description:
      '向指定板卡的 OpenClaw 委派任务（跨板卡调度）。' +
      '支持 role 参数为板卡分配角色（如 executor/reviewer/advisor）。' +
      '自动检测目标板卡是否忙碌，追踪任务状态防止冲突。' +
      '适用：多板卡协作、负载分配、让不同板卡承担不同角色。先用 fleet_board_list 查看可用板卡。',
    inputSchema: {
      type: 'object',
      properties: {
        targetDeviceId: { type: 'string', description: '目标板卡的设备 ID' },
        task: { type: 'string', description: '要委派的任务描述' },
        guidance: { type: 'string', description: '给板端 OpenClaw 的执行建议和协作上下文' },
        role: {
          type: 'string',
          description: '板卡在本次协作中的角色：executor（执行者）、reviewer（审查者）、advisor（建议者）',
        },
        sessionId: { type: 'string', description: '可选会话 ID，用于连续对话' },
      },
      required: ['targetDeviceId', 'task'],
    },
    async execute(input, ctx) {
      const devices = await readDevices();
      const device = devices.find((d) => d.id === input.targetDeviceId);
      if (!device) {
        throw new Error(`设备 ${input.targetDeviceId} 不存在。请通过 fleet_board_list 获取可用设备列表。`);
      }

      // Check for duplicate IP conflict
      const sameIpDevices = devices.filter(
        (d) => d.host === device.host && (d.port ?? 22) === (device.port ?? 22) && d.id !== device.id,
      );
      const activeTasks = getActiveFleetTasks();
      const ipConflict = sameIpDevices.some((d) => activeTasks.some((t) => t.deviceId === d.id));
      if (ipConflict) {
        const conflictIds = sameIpDevices.filter((d) => activeTasks.some((t) => t.deviceId === d.id)).map((d) => d.id);
        return `[冲突警告] 设备 ${device.host} 上已有活跃任务（来自同 IP 的设备 ${conflictIds.join(', ')}）。` +
          '向同一物理设备并发任务会导致 SSH/OpenClaw 冲突，建议等待完成后再委派。';
      }

      const boardDevice = toBoardDevice(device);
      const deviceLabel = `${device.username}@${device.host}`;
      const role = input.role || 'executor';
      const cap = getDeviceCapability(device);

      recordFleetTask({
        deviceId: input.targetDeviceId,
        task: input.task,
        startedAt: Date.now(),
        status: 'running',
      });

      const otherBoardTasks = activeTasks
        .filter((t) => t.deviceId !== input.targetDeviceId)
        .map((t) => `  - ${t.deviceId.slice(0, 8)}: ${t.task.slice(0, 40)}`)
        .join('\n');

      const msgParts = [
        `[fleet dispatch] role: ${role}`,
        `from: ${currentDeviceId} (coordinator)`,
        `to: ${input.targetDeviceId} (${deviceLabel})`,
      ];
      if (cap.profile) {
        msgParts.push(
          `[your hardware] ${cap.profile.displayName} | ${cap.profile.bpuTops}TOPS BPU | ${cap.profile.ramGb}GB RAM | ${cap.profile.cpu}`,
        );
      }
      msgParts.push(`\ntask: ${input.task}`);
      if (input.guidance?.trim()) {
        msgParts.push(`\nguidance: ${input.guidance.trim()}`);
      }
      if (otherBoardTasks) {
        msgParts.push(
          `\n[fleet context] 其他板卡当前正在执行的任务：\n${otherBoardTasks}` +
          '\n请注意你的工作不要与其他板卡冲突，如果有需要协调的地方请在回复中说明。',
        );
      }
      if (role === 'reviewer' || role === 'advisor') {
        msgParts.push(
          `\n[role: ${role}] 你的角色是${role === 'reviewer' ? '审查者' : '建议者'}，` +
          '请评估方案的可行性并提出改进建议，而非直接执行。',
        );
      }
      msgParts.push(
        '\n[reverse_consultation] 如果你需要联网搜索、查文档等信息，' +
        '请用 [NEED_RDKCLAW]...[/NEED_RDKCLAW] 格式告诉我。',
      );
      const msg = msgParts.filter(Boolean).join('\n');
      const sessionId = input.sessionId?.trim() || `fleet-${currentDeviceId}-to-${input.targetDeviceId}-${Date.now()}`;

      return await new Promise<string>((resolve, reject) => {
        if (ctx.abortSignal?.aborted) {
          markFleetTaskDone(input.targetDeviceId, 'failed', 'aborted');
          reject(new Error('操作已中止'));
          return;
        }

        let output = '';
        let handle: { abort: () => void } | null = null;

        const onAbort = () => {
          try { handle?.abort(); } catch { /* ignore */ }
          markFleetTaskDone(input.targetDeviceId, 'failed', 'aborted');
          reject(new Error('操作已中止'));
        };
        ctx.abortSignal?.addEventListener('abort', onAbort, { once: true });

        handle = manager.sendAgentMessage(
          msg,
          (chunk) => {
            output += chunk;
            onProgress?.(`[${deviceLabel}] ${chunk}`);
          },
          (success) => {
            ctx.abortSignal?.removeEventListener('abort', onAbort);
            const trimmed = output.replace(/__OPENCLAW_WS_FAILED__/g, '').trim();
            if (success) {
              markFleetTaskDone(input.targetDeviceId, 'done', trimmed.slice(0, 80));
              resolve(
                `[板卡 ${deviceLabel} (${input.targetDeviceId}) | role: ${role}]\n\n` +
                (trimmed || '板端执行完成（无文本输出）'),
              );
            } else if (trimmed.length > 20) {
              markFleetTaskDone(input.targetDeviceId, 'failed', 'connection lost');
              resolve(`[板卡 ${deviceLabel} 部分结果（连接中断）]\n\n${trimmed}`);
            } else {
              markFleetTaskDone(input.targetDeviceId, 'failed', trimmed || 'no response');
              resolve(
                `[板卡 ${deviceLabel} 执行失败]\n` +
                (trimmed || '板端 OpenClaw 未返回结果，可能未安装或网关未运行。'),
              );
            }
          },
          sessionId,
          boardDevice,
        );
      });
    },
  };
}

/**
 * Broadcasts with smart dedup — skips same-IP duplicates automatically.
 */
export function fleetBoardBroadcastTool(
  currentDeviceId: string,
  manager: OpenClawDeploymentManager,
  onProgress?: (chunk: string) => void,
): Tool<{
  task: string;
  guidance?: string;
  targetDeviceIds?: string[];
  collectMode?: string;
}> {
  return {
    name: 'fleet_board_broadcast',
    description:
      '向多个板卡的 OpenClaw 同时广播任务并汇总结果。' +
      '自动去重同 IP 设备，防止向同一物理设备发送重复任务。' +
      'collectMode: "all"（等所有板卡回复）或 "fastest"（第一个回复即返回）。' +
      '适用：多板卡诊断、并行任务、多板卡投票/建议收集。',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: '要广播的任务描述' },
        guidance: { type: 'string', description: '给各板端 OpenClaw 的执行建议' },
        targetDeviceIds: {
          type: 'array',
          items: { type: 'string' },
          description: '可选：只广播到指定设备列表。不填则广播到所有去重后的设备。',
        },
        collectMode: {
          type: 'string',
          description: '"all"（默认）等所有回复 / "fastest" 第一个回复即返回',
        },
      },
      required: ['task'],
    },
    async execute(input, ctx) {
      const devices = await readDevices();
      let targets = input.targetDeviceIds?.length
        ? devices.filter((d) => input.targetDeviceIds!.includes(d.id))
        : devices;

      targets = deduplicateDevices(targets);

      if (targets.length === 0) {
        return JSON.stringify({ ok: false, message: '没有可用的目标设备' });
      }

      const skippedCount = (input.targetDeviceIds?.length || devices.length) - targets.length;
      if (skippedCount > 0) {
        onProgress?.(`[fleet] 去重后跳过 ${skippedCount} 个重复设备\n`);
      }
      onProgress?.(`[fleet] 正在向 ${targets.length} 个板卡广播任务...\n`);

      for (const t of targets) {
        recordFleetTask({ deviceId: t.id, task: input.task, startedAt: Date.now(), status: 'running' });
      }

      const mode = input.collectMode === 'fastest' ? 'fastest' : 'all';

      const taskPromises = targets.map((device) => {
        const boardDevice = toBoardDevice(device);
        const label = `${device.username}@${device.host}`;
        const msg = [
          `[fleet broadcast to ${targets.length} boards]`,
          `task: ${input.task}`,
          input.guidance?.trim() ? `\nguidance: ${input.guidance.trim()}` : '',
          `\n[collaboration hint] 你是多板卡协作中的一员（共 ${targets.length} 个板卡参与）。` +
          '请基于你的板端实际环境给出回答。如果某些任务更适合其他板卡，请说明原因。',
        ].filter(Boolean).join('\n');
        const sessionId = `fleet-broadcast-${device.id}-${Date.now()}`;

        return new Promise<{ deviceId: string; label: string; output: string; success: boolean }>((resolve) => {
          if (ctx.abortSignal?.aborted) {
            markFleetTaskDone(device.id, 'failed', 'aborted');
            resolve({ deviceId: device.id, label, output: '操作已中止', success: false });
            return;
          }

          const timeout = setTimeout(() => {
            markFleetTaskDone(device.id, 'failed', 'timeout');
            resolve({ deviceId: device.id, label, output: '响应超时（30s）', success: false });
          }, 30000);

          let output = '';
          manager.sendAgentMessage(
            msg,
            (chunk) => { output += chunk; },
            (success) => {
              clearTimeout(timeout);
              const clean = output.replace(/__OPENCLAW_WS_FAILED__/g, '').trim() || '(无输出)';
              markFleetTaskDone(device.id, success ? 'done' : 'failed', clean.slice(0, 80));
              resolve({ deviceId: device.id, label, output: clean, success });
            },
            sessionId,
            boardDevice,
          );
        });
      });

      let results: Array<{ deviceId: string; label: string; output: string; success: boolean }>;
      if (mode === 'fastest') {
        const first = await Promise.race(taskPromises);
        results = [first];
        onProgress?.(`[fleet] 最快响应来自 ${first.label}\n`);
      } else {
        const settled = await Promise.allSettled(taskPromises);
        results = settled.map((r) =>
          r.status === 'fulfilled'
            ? r.value
            : { deviceId: 'unknown', label: 'unknown', output: r.reason?.message || '未知错误', success: false },
        );
      }

      const summary = results.map((r) => ({
        deviceId: r.deviceId,
        device: r.label,
        success: r.success,
        response: r.output.length > 600 ? r.output.slice(0, 600) + '...(truncated)' : r.output,
      }));

      const succeeded = summary.filter((s) => s.success).length;
      onProgress?.(`[fleet] 广播完成: ${succeeded}/${targets.length} 成功\n`);

      return JSON.stringify({
        total: targets.length,
        succeeded,
        skippedDuplicates: skippedCount,
        collectMode: mode,
        results: summary,
        synthesis: {
          hint: '请综合分析各板卡的回复：' +
            '1) 找出共识 — 多个板卡一致同意的方案更可靠；' +
            '2) 发现差异 — 不同板卡可能因环境不同得出不同结论，这些差异值得关注；' +
            '3) 汇总建议 — 如果某板卡提出了更优方案，可以用 fleet_board_delegate 让它详细执行；' +
            '4) 记录经验 — 将多板卡协作的有效模式记入记忆，下次可复用。',
        },
      }, null, 2);
    },
  };
}
