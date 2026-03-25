import { describe, it, expect, vi } from 'vitest';
import { createStudioTools, type StudioAutonomyRuntime } from '../studio-tools.js';

function mockRuntime(extra: Partial<StudioAutonomyRuntime> = {}): StudioAutonomyRuntime {
  return {
    listTasks: () => [],
    createTask: vi.fn(() => ({
      id: 'task-mock',
      name: 'n',
      prompt: 'p',
      scheduleType: 'interval' as const,
      intervalMinutes: 1,
      mode: 'local' as const,
      requiresApproval: false,
      approved: true,
      status: 'active' as const,
      failureCount: 0,
      nextRunAt: Date.now(),
    })),
    pauseTask: vi.fn(),
    stopTask: vi.fn(),
    resumeTask: vi.fn(),
    approveTask: vi.fn(),
    ...extra,
  };
}

describe('createStudioTools outbound', () => {
  it('registers weixin tools when weixinOutbound is set', () => {
    const tools = createStudioTools(
      mockRuntime({
        weixinOutbound: {
          listRecentUsers: () => [],
          sendText: vi.fn().mockResolvedValue(true),
        },
      }),
    );
    const names = tools.map((t) => t.name);
    expect(names).toContain('weixin_list_recent_users');
    expect(names).toContain('weixin_send_text_to_user');
  });

  it('weixin_send_text_to_user invokes sendText', async () => {
    const sendText = vi.fn().mockResolvedValue(true);
    const tools = createStudioTools(
      mockRuntime({
        weixinOutbound: {
          listRecentUsers: () => [],
          sendText,
        },
      }),
    );
    const tool = tools.find((t) => t.name === 'weixin_send_text_to_user');
    expect(tool).toBeDefined();
    const out = await tool!.execute({ userId: 'uid-1', text: 'hello' }, {} as never);
    expect(sendText).toHaveBeenCalledWith('uid-1', 'hello');
    expect(String(out)).toContain('已发送');
  });

  it('registers feishu tools when feishuOutbound is set', () => {
    const tools = createStudioTools(
      mockRuntime({
        feishuOutbound: {
          listRecentChats: () => [],
          sendText: vi.fn().mockResolvedValue(true),
        },
      }),
    );
    const names = tools.map((t) => t.name);
    expect(names).toContain('feishu_list_recent_chats');
    expect(names).toContain('feishu_send_text_to_chat');
  });

  it('feishu_send_text_to_chat uses allowUnknown false', async () => {
    const sendText = vi.fn().mockResolvedValue(true);
    const tools = createStudioTools(
      mockRuntime({
        feishuOutbound: {
          listRecentChats: () => [],
          sendText,
        },
      }),
    );
    const tool = tools.find((t) => t.name === 'feishu_send_text_to_chat');
    expect(tool).toBeDefined();
    await tool!.execute({ chatId: 'oc_xxx', text: 'hi' }, {} as never);
    expect(sendText).toHaveBeenCalledWith('oc_xxx', 'hi', false);
  });

  it('rdkclaw_task_create passes notify fields to createTask', async () => {
    const createTask = vi.fn(() => ({
      id: 't1',
      name: 'n',
      prompt: 'p',
      scheduleType: 'interval' as const,
      intervalMinutes: 1,
      mode: 'local' as const,
      requiresApproval: false,
      approved: true,
      status: 'active' as const,
      failureCount: 0,
      nextRunAt: Date.now(),
      notifyWeixinUserId: 'wx',
      notifyFeishuChatId: 'oc',
    }));
    const tools = createStudioTools(mockRuntime({ createTask }));
    const tool = tools.find((t) => t.name === 'rdkclaw_task_create');
    await tool!.execute(
      {
        name: 'job',
        intervalMinutes: 5,
        notifyWeixinUserId: 'wx-user',
        notifyFeishuChatId: 'oc-chat',
      },
      {} as never,
    );
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        notifyWeixinUserId: 'wx-user',
        notifyFeishuChatId: 'oc-chat',
      }),
    );
  });
});
