/**
 * OpenClaw oc-bridge 重试 / 取消：不连真实 SSH，仅 mock getOrCreateBridgeTransport。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'node:path';
import { OpenClawDeploymentManager } from '../OpenClawDeploymentManager.js';
import type { Device } from '../OpenClawDeploymentManager.js';

const resourcesPath = path.join(process.cwd(), 'server/resources');

const device: Device = { ip: '192.0.2.1', userName: 'root', password: 'test' };

type Line = Record<string, unknown>;

function createMockTransport(opts: { hang: boolean }) {
  const handlers: Array<(line: Line) => void> = [];
  return {
    onLine(handler: (line: Line) => void) {
      handlers.push(handler);
      return () => {
        const i = handlers.indexOf(handler);
        if (i >= 0) handlers.splice(i, 1);
      };
    },
    send(obj: Record<string, unknown>) {
      const reqId = String(obj.reqId ?? '');
      if (opts.hang) return;
      queueMicrotask(() => {
        for (const h of handlers) {
          h({ type: 'assistant', text: 'x', reqId });
          h({ type: 'done', ok: true, reqId });
        }
      });
    },
    destroy() {},
  };
}

describe('OpenClawDeploymentManager / oc-bridge 路径', () => {
  function isTransient(reason: string | undefined, sawCode: boolean, gotOutput: boolean): boolean {
    const fn = (
      OpenClawDeploymentManager as unknown as {
        isTransientBridgeTurnFailure: (a: string | undefined, b: boolean, c: boolean) => boolean;
      }
    ).isTransientBridgeTurnFailure.bind(OpenClawDeploymentManager);
    return fn(reason, sawCode, gotOutput);
  }

  it('isTransientBridgeTurnFailure：有输出则不视为可安全重试', () => {
    expect(isTransient('ws closed', true, true)).toBe(false);
    expect(isTransient('ws closed', false, true)).toBe(false);
  });

  it('isTransientBridgeTurnFailure：无输出 + 瞬态码 → 可重试', () => {
    expect(isTransient('', true, false)).toBe(true);
  });

  it('isTransientBridgeTurnFailure：reason 匹配 ws closed', () => {
    expect(isTransient('ws closed', false, false)).toBe(true);
  });

  it('取消后串行链可继续（hang → abort → 下一轮 quick）', async () => {
    const mgr = new OpenClawDeploymentManager(resourcesPath);

    vi.spyOn(mgr as unknown as { sendAgentMessageOneShot: unknown }, 'sendAgentMessageOneShot').mockReturnValue({
      abort: () => {},
    });

    let n = 0;
    vi.spyOn(mgr as unknown as { getOrCreateBridgeTransport: (d: Device) => Promise<unknown> }, 'getOrCreateBridgeTransport').mockImplementation(
      async () => {
        n += 1;
        if (n === 1) return createMockTransport({ hang: true });
        return createMockTransport({ hang: false });
      },
    );

    let firstDone = false;
    let secondDone = false;
    const { abort } = mgr.sendAgentMessage('hello', () => {}, (ok) => {
      firstDone = true;
      expect(ok).toBe(false);
    }, 'main', device);

    await vi.waitFor(() => n === 1, { timeout: 2000 });
    /** 确保 await getOrCreate 之后的微任务已挂上 bridgeTurnHook，再 abort，避免竞态 */
    await Promise.resolve();
    await Promise.resolve();
    abort();
    await vi.waitFor(() => firstDone, { timeout: 3000 });

    await new Promise<void>((r) => {
      mgr.sendAgentMessage('hello2', () => {}, (ok) => {
        secondDone = true;
        expect(ok).toBe(true);
        r();
      }, 'main', device);
    });

    expect(secondDone).toBe(true);
    expect(n).toBe(2);

    vi.restoreAllMocks();
  });

  it('首轮 transport=null 时返回 retry 并在第二轮仍失败则走 one-shot 占位', async () => {
    const mgr = new OpenClawDeploymentManager(resourcesPath);
    const oneShot = vi.spyOn(mgr as unknown as { sendAgentMessageOneShot: unknown }, 'sendAgentMessageOneShot').mockImplementation(
      (_message, _onChunk, onComplete) => {
        queueMicrotask(() => onComplete(false));
        return { abort: () => {} };
      },
    );

    let n = 0;
    vi.spyOn(mgr as unknown as { getOrCreateBridgeTransport: (d: Device) => Promise<unknown> }, 'getOrCreateBridgeTransport').mockImplementation(
      async () => {
        n += 1;
        return null;
      },
    );

    await new Promise<void>((r) => {
      mgr.sendAgentMessage('hi', () => {}, () => r(), 'main', device);
    });

    expect(n).toBe(2);
    expect(oneShot).toHaveBeenCalledTimes(1);

    vi.restoreAllMocks();
  });
});
