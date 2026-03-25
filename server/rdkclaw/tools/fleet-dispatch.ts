import type { Tool } from '../../agent/tools/types.js';
import { readDevices } from '../../storage.js';
import { OpenClawDeploymentManager } from '../../managers/OpenClawDeploymentManager.js';
import type { Device } from '../../../shared/types.js';

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

/**
 * Lists all connected devices and their OpenClaw readiness.
 * Helps the AI decide which board to delegate to.
 */
export function fleetBoardListTool(
  currentDeviceId: string,
  manager: OpenClawDeploymentManager,
): Tool<Record<string, never>> {
  return {
    name: 'fleet_board_list',
    description:
      '列出所有已注册的板卡设备及其 OpenClaw 状态。' +
      '用于多板卡协作场景：了解哪些板卡可用、是否有 OpenClaw、哪个板卡适合处理特定任务。' +
      '返回包含每个设备 id/name/host/status 的列表。当前会话绑定的设备会被标记。',
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      const devices = await readDevices();
      if (devices.length === 0) {
        return JSON.stringify({ boards: [], message: '没有已注册的设备' });
      }

      const boards = devices.map((d) => ({
        id: d.id,
        name: `${d.username}@${d.host}:${d.port ?? 22}`,
        host: d.host,
        isCurrent: d.id === currentDeviceId,
      }));

      return JSON.stringify({
        total: boards.length,
        currentDeviceId,
        boards,
        hint: '使用 fleet_board_delegate 可以向指定板卡的 OpenClaw 委派任务。' +
          '使用 fleet_board_broadcast 可以向所有板卡广播同一任务并汇总结果。',
      }, null, 2);
    },
  };
}

/**
 * Delegates a task to a *specific* board's OpenClaw (not necessarily the current one).
 * Core enabler for multi-board collaboration.
 */
export function fleetBoardDelegateTool(
  currentDeviceId: string,
  manager: OpenClawDeploymentManager,
  onProgress?: (chunk: string) => void,
): Tool<{
  targetDeviceId: string;
  task: string;
  guidance?: string;
  sessionId?: string;
}> {
  return {
    name: 'fleet_board_delegate',
    description:
      '向指定板卡的 OpenClaw 委派任务（跨板卡调度）。' +
      '与 board_openclaw_delegate 的区别：此工具可以指定任意已注册板卡，而非仅当前设备。' +
      '适用场景：多板卡协作、负载分配、让擅长特定任务的板卡来执行。' +
      '先使用 fleet_board_list 查看可用板卡。',
    inputSchema: {
      type: 'object',
      properties: {
        targetDeviceId: { type: 'string', description: '目标板卡的设备 ID（从 fleet_board_list 获取）' },
        task: { type: 'string', description: '要委派的任务描述' },
        guidance: { type: 'string', description: '给板端 OpenClaw 的执行建议' },
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

      const boardDevice = toBoardDevice(device);
      const deviceLabel = `${device.username}@${device.host}`;
      const msgParts = [
        `[fleet dispatch from ${currentDeviceId}]`,
        `task: ${input.task}`,
      ];
      if (input.guidance?.trim()) {
        msgParts.push(`\nrdkclaw_guidance: ${input.guidance.trim()}`);
      }
      msgParts.push(
        '\n[reverse_consultation] 如果你需要联网搜索、查文档等信息，' +
        '请用 [NEED_RDKCLAW]...[/NEED_RDKCLAW] 格式告诉我。',
      );
      const msg = msgParts.filter(Boolean).join('\n');
      const sessionId = input.sessionId?.trim() || `fleet-${currentDeviceId}-to-${input.targetDeviceId}-${Date.now()}`;

      return await new Promise<string>((resolve, reject) => {
        if (ctx.abortSignal?.aborted) {
          reject(new Error('操作已中止'));
          return;
        }

        let output = '';
        let handle: { abort: () => void } | null = null;

        const onAbort = () => {
          try { handle?.abort(); } catch { /* ignore */ }
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
            if (success) {
              resolve(
                `[板卡 ${deviceLabel} (${input.targetDeviceId}) 执行结果]\n\n` +
                (output.trim() || '板端执行完成（无文本输出）'),
              );
            } else {
              const clean = output.replace(/__OPENCLAW_WS_FAILED__/g, '').trim();
              if (clean.length > 20) {
                resolve(
                  `[板卡 ${deviceLabel} 部分结果（连接中断）]\n\n${clean}`,
                );
              } else {
                resolve(
                  `[板卡 ${deviceLabel} 执行失败]\n` +
                  (clean || '板端 OpenClaw 未返回结果，可能未安装或网关未运行。'),
                );
              }
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
 * Broadcasts the same task to multiple boards in parallel and collects results.
 */
export function fleetBoardBroadcastTool(
  currentDeviceId: string,
  manager: OpenClawDeploymentManager,
  onProgress?: (chunk: string) => void,
): Tool<{
  task: string;
  guidance?: string;
  targetDeviceIds?: string[];
}> {
  return {
    name: 'fleet_board_broadcast',
    description:
      '向多个板卡的 OpenClaw 同时广播任务并汇总结果。' +
      '默认广播到所有已注册板卡；可通过 targetDeviceIds 指定子集。' +
      '适用场景：收集多板卡的诊断信息、让多个板卡并行执行类似任务、多板卡投票决策。',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: '要广播的任务描述' },
        guidance: { type: 'string', description: '给各板端 OpenClaw 的执行建议' },
        targetDeviceIds: {
          type: 'array',
          items: { type: 'string' },
          description: '可选：只广播到指定设备列表。不填则广播到所有设备。',
        },
      },
      required: ['task'],
    },
    async execute(input, ctx) {
      const devices = await readDevices();
      const targets = input.targetDeviceIds?.length
        ? devices.filter((d) => input.targetDeviceIds!.includes(d.id))
        : devices;

      if (targets.length === 0) {
        return JSON.stringify({ ok: false, message: '没有可用的目标设备' });
      }

      onProgress?.(`[fleet] 正在向 ${targets.length} 个板卡广播任务...\n`);

      const results = await Promise.allSettled(
        targets.map((device) => {
          const boardDevice = toBoardDevice(device);
          const label = `${device.username}@${device.host}`;
          const msg = [
            `[fleet broadcast]`,
            `task: ${input.task}`,
            input.guidance?.trim() ? `\nguidance: ${input.guidance.trim()}` : '',
          ].filter(Boolean).join('\n');
          const sessionId = `fleet-broadcast-${device.id}-${Date.now()}`;

          return new Promise<{ deviceId: string; label: string; output: string; success: boolean }>((resolve) => {
            if (ctx.abortSignal?.aborted) {
              resolve({ deviceId: device.id, label, output: '操作已中止', success: false });
              return;
            }

            const timeout = setTimeout(() => {
              resolve({ deviceId: device.id, label, output: '响应超时（30s）', success: false });
            }, 30000);

            let output = '';
            manager.sendAgentMessage(
              msg,
              (chunk) => { output += chunk; },
              (success) => {
                clearTimeout(timeout);
                resolve({
                  deviceId: device.id,
                  label,
                  output: output.replace(/__OPENCLAW_WS_FAILED__/g, '').trim() || '(无输出)',
                  success,
                });
              },
              sessionId,
              boardDevice,
            );
          });
        }),
      );

      const summary = results.map((r) => {
        if (r.status === 'fulfilled') {
          return {
            deviceId: r.value.deviceId,
            device: r.value.label,
            success: r.value.success,
            response: r.value.output.length > 500
              ? r.value.output.slice(0, 500) + '...(truncated)'
              : r.value.output,
          };
        }
        return {
          deviceId: 'unknown',
          device: 'unknown',
          success: false,
          response: r.reason?.message || '未知错误',
        };
      });

      const succeeded = summary.filter((s) => s.success).length;
      onProgress?.(`[fleet] 广播完成: ${succeeded}/${targets.length} 成功\n`);

      return JSON.stringify({
        total: targets.length,
        succeeded,
        results: summary,
        hint: '你可以分析各板卡的回复，综合得出最佳方案，或对特定板卡用 fleet_board_delegate 继续对话。',
      }, null, 2);
    },
  };
}
