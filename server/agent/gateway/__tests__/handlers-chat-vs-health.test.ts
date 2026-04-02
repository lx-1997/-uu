/**
 * 实证：网关 `health` 与 `chat.send` 参数校验独立——服务可 healthy，
 * 但缺少 message 的 chat.send 仍会 INVALID_REQUEST（与板端 CLI health 正交）。
 */
import { describe, it, expect, vi } from 'vitest';
import { handlers } from '../handlers.js';
import type { GwClient, HandlerContext } from '../handlers.js';

function minimalContext(): HandlerContext {
  return {
    agent: {
      subscribe: () => () => {},
      run: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn(),
      getHistory: () => [],
      listSessions: async () => [],
      reset: async () => {},
    } as unknown as HandlerContext['agent'],
    broadcast: vi.fn(),
    clients: new Set(),
    nonces: new Map(),
    startedAt: Date.now(),
  };
}

const client: GwClient = {
  id: 'c1',
  socket: { send: () => {}, close: () => {}, bufferedAmount: 0 },
  authed: true,
};

describe('gateway handlers: health vs chat.send', () => {
  it('health 无需参数即可 ok', async () => {
    const ctx = minimalContext();
    const r = await handlers.health(undefined, client, ctx);
    expect(r.ok).toBe(true);
    expect(r.payload).toMatchObject({ uptimeMs: expect.any(Number) });
  });

  it('chat.send 缺 message 时拒绝（与 health 无关）', async () => {
    const ctx = minimalContext();
    const r = await handlers['chat.send']({}, client, ctx);
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('INVALID_REQUEST');
    expect(r.error?.message).toContain('message');
    expect((ctx.agent as { run: ReturnType<typeof vi.fn> }).run).not.toHaveBeenCalled();
  });

  it('chat.send 有 message 时 ACK，并会触发 agent.run', async () => {
    const ctx = minimalContext();
    const r = await handlers['chat.send'](
      { sessionKey: 'main', message: 'hi', idempotencyKey: 'k1' },
      client,
      ctx,
    );
    expect(r.ok).toBe(true);
    expect((ctx.agent as { run: ReturnType<typeof vi.fn> }).run).toHaveBeenCalledWith('main', 'hi');
  });
});
