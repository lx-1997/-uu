import type { Tool } from './types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  loadProviderConfig,
  saveProviderConfig,
  type ProviderConfig,
} from '../provider-setup.js';
import type { RDKClawExecutionMode } from '../../rdkclaw/types.js';
import type { AutonomyTask } from '../../rdkclaw/autonomy-scheduler.js';
import { getTokenUsageReport } from '../../monitoring/token-usage.js';
import { createStudioEmbeddedBrowserCaptureTool } from '../../studio-browser-capture.js';

const ALLOWED_PROVIDERS = new Set<ProviderConfig['provider']>([
  'qwen',
  'deepseek',
  'openai',
  'custom',
]);

function prettyConfig(config: ProviderConfig | null): string {
  if (!config) return '当前未配置 AI 模型。';
  return JSON.stringify({
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl,
    hasApiKey: !!config.apiKey,
  }, null, 2);
}

function getStudioAgentConfigTool(): Tool<Record<string, never>> {
  return {
    name: 'studio_get_agent_config',
    description: '读取 RDK Studio Claw（软件端）的 AI 配置（provider/model/baseUrl/是否有 key）。',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    async execute() {
      return prettyConfig(loadProviderConfig());
    },
  };
}

function setStudioAgentConfigTool(): Tool<{
  provider: ProviderConfig['provider'];
  model: string;
  apiKey?: string;
  baseUrl?: string;
}> {
  return {
    name: 'studio_set_agent_config',
    description: '更新 RDK Studio Claw（软件端）AI 配置。可更新 provider/model/baseUrl，apiKey 可选（留空则保留旧值）。',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', description: 'qwen/deepseek/openai/custom' },
        model: { type: 'string', description: '模型名，如 qwen-plus' },
        apiKey: { type: 'string', description: '可选，API key（留空则不改）' },
        baseUrl: { type: 'string', description: '可选，自定义 base URL' },
      },
      required: ['provider', 'model'],
    },
    async execute(input) {
      if (!ALLOWED_PROVIDERS.has(input.provider)) {
        throw new Error(`不支持的 provider: ${input.provider}`);
      }
      const existing = loadProviderConfig();
      const next: ProviderConfig = {
        provider: input.provider,
        model: input.model,
        apiKey: input.apiKey?.trim() || existing?.apiKey || '',
        baseUrl: input.baseUrl?.trim() || undefined,
      };
      if (!next.apiKey) {
        throw new Error('缺少 apiKey：首次配置必须提供 API key');
      }
      saveProviderConfig(next);
      return `已更新软件端 AI 配置:\n${prettyConfig(next)}`;
    },
  };
}

export type StudioWeixinOutbound = {
  listRecentUsers(): Array<{
    userId: string;
    maskedId: string;
    lastMessageText: string;
    lastSeenAt: number;
    accountId: string;
  }>;
  sendText(userId: string, text: string): Promise<boolean>;
};

export type StudioFeishuOutbound = {
  listRecentChats(): Array<{
    chatId: string;
    openIdMasked: string;
    lastMessageText: string;
    lastSeenAt: number;
  }>;
  sendText(chatId: string, text: string, allowUnknown?: boolean): Promise<boolean>;
};

export interface StudioAutonomyRuntime {
  listTasks: () => AutonomyTask[];
  createTask: (input: {
    name: string;
    prompt: string;
    intervalMinutes?: number;
    intervalSeconds?: number;
    cron?: string;
    timezone?: string;
    mode?: RDKClawExecutionMode;
    requiresApproval?: boolean;
    notifyWeixinUserId?: string;
    notifyFeishuChatId?: string;
  }) => AutonomyTask;
  pauseTask: (taskId: string) => void;
  stopTask: (taskId: string) => void;
  resumeTask: (taskId: string) => void;
  approveTask: (taskId: string) => void;
  weixinOutbound?: StudioWeixinOutbound;
  feishuOutbound?: StudioFeishuOutbound;
}

function listAutonomyTasksTool(runtime: StudioAutonomyRuntime): Tool<Record<string, never>> {
  return {
    name: 'rdkclaw_task_list',
    description: '列出 RDKClaw 的定时任务，包括状态、调度类型和最近执行时间。',
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      return JSON.stringify(runtime.listTasks(), null, 2);
    },
  };
}

function createAutonomyTaskTool(runtime: StudioAutonomyRuntime): Tool<{
  name: string;
  prompt?: string;
  intervalMinutes?: number;
  intervalSeconds?: number;
  cron?: string;
  timezone?: string;
  mode?: RDKClawExecutionMode;
  requiresApproval?: boolean;
  notifyWeixinUserId?: string;
  notifyFeishuChatId?: string;
}> {
  return {
    name: 'rdkclaw_task_create',
    description:
      '创建 RDKClaw 定时任务。支持秒级、分钟级或 cron。用于无需用户触发的自治消息与巡检任务。'
      + '可选 notifyWeixinUserId / notifyFeishuChatId：任务每次执行结束后将摘要推送到对应微信用户或飞书会话（需先用 weixin_list_recent_users / feishu_list_recent_chats 取得 id）。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '任务名称' },
        prompt: { type: 'string', description: '执行提示词。不填时默认每次推送 hello。' },
        intervalMinutes: { type: 'number', description: '分钟级间隔' },
        intervalSeconds: { type: 'number', description: '秒级间隔（如 1 表示每秒）' },
        cron: { type: 'string', description: 'cron 表达式（5 段）' },
        timezone: { type: 'string', description: '时区，默认 local' },
        mode: { type: 'string', description: 'auto/local/board/board-preferred' },
        requiresApproval: { type: 'boolean', description: '是否需要审批' },
        notifyWeixinUserId: { type: 'string', description: '可选，完整微信 userId；执行结束后向其推送摘要（须近期有会话，见 weixin_list_recent_users）' },
        notifyFeishuChatId: { type: 'string', description: '可选，飞书 chat_id；执行结束后推送摘要' },
      },
      required: ['name'],
    },
    async execute(input) {
      const task = runtime.createTask({
        name: input.name,
        prompt: input.prompt?.trim() || '请只输出 hello',
        intervalMinutes: input.intervalMinutes,
        intervalSeconds: input.intervalSeconds,
        cron: input.cron?.trim(),
        timezone: input.timezone?.trim(),
        mode: input.mode || 'board-preferred',
        requiresApproval: !!input.requiresApproval,
        notifyWeixinUserId: input.notifyWeixinUserId?.trim(),
        notifyFeishuChatId: input.notifyFeishuChatId?.trim(),
      });
      return `已创建定时任务: ${task.id}\n${JSON.stringify(task, null, 2)}`;
    },
  };
}

function weixinListRecentUsersTool(port: StudioWeixinOutbound): Tool<Record<string, never>> {
  return {
    name: 'weixin_list_recent_users',
    description:
      '列出近期向微信 ClawBot 发过消息的微信用户（脱敏 id + 最近一条摘要）。'
      + '在 AI Dock 中要向「上一条发消息来的用户」发内容时，先调用本工具取得 userId，再调用 weixin_send_text_to_user。',
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      const rows = port.listRecentUsers();
      if (!rows.length) return '暂无近期微信会话（需用户先给机器人发过消息）。';
      return JSON.stringify(rows, null, 2);
    },
  };
}

function weixinSendTextToUserTool(port: StudioWeixinOutbound): Tool<{ userId: string; text: string }> {
  return {
    name: 'weixin_send_text_to_user',
    description:
      '向指定微信用户发送纯文本（须该用户近期与机器人有过会话，userId 来自 weixin_list_recent_users）。'
      + '用于在 AI Dock 中主动把某条说明发给某个微信联系人。',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: '完整微信用户 ID' },
        text: { type: 'string', description: '要发送的正文（过长会按微信接口分段）' },
      },
      required: ['userId', 'text'],
    },
    async execute(input) {
      const ok = await port.sendText(input.userId.trim(), input.text.trim());
      return ok ? '已发送微信消息。' : '发送失败：该 userId 不在近期会话中，或网络/接口错误。请让用户先给机器人发一条消息后再试。';
    },
  };
}

function feishuListRecentChatsTool(port: StudioFeishuOutbound): Tool<Record<string, never>> {
  return {
    name: 'feishu_list_recent_chats',
    description: '列出近期在飞书与机器人有过消息的会话（chat_id 与摘要）。用于主动向某会话发消息时取得 chatId。',
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      const rows = port.listRecentChats();
      if (!rows.length) return '暂无近期飞书会话。';
      return JSON.stringify(rows, null, 2);
    },
  };
}

function feishuSendChatTextTool(port: StudioFeishuOutbound): Tool<{ chatId: string; text: string }> {
  return {
    name: 'feishu_send_text_to_chat',
    description:
      '向近期有过消息的飞书会话发送文本。chatId 须来自 feishu_list_recent_chats（安全限制：不向任意陌生 chat 发信）。',
    inputSchema: {
      type: 'object',
      properties: {
        chatId: { type: 'string', description: '飞书 chat_id' },
        text: { type: 'string', description: '正文' },
      },
      required: ['chatId', 'text'],
    },
    async execute(input) {
      const ok = await port.sendText(input.chatId.trim(), input.text.trim(), false);
      return ok ? '已发送飞书消息。' : '发送失败：chatId 不在近期会话列表，或飞书未连接。';
    },
  };
}

function pauseAutonomyTaskTool(runtime: StudioAutonomyRuntime): Tool<{ taskId: string }> {
  return {
    name: 'rdkclaw_task_pause',
    description: '暂停指定定时任务。',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务 ID' },
      },
      required: ['taskId'],
    },
    async execute(input) {
      runtime.pauseTask(input.taskId);
      return `已暂停任务: ${input.taskId}`;
    },
  };
}

function resumeAutonomyTaskTool(runtime: StudioAutonomyRuntime): Tool<{ taskId: string }> {
  return {
    name: 'rdkclaw_task_resume',
    description: '恢复指定定时任务。',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务 ID' },
      },
      required: ['taskId'],
    },
    async execute(input) {
      runtime.resumeTask(input.taskId);
      return `已恢复任务: ${input.taskId}`;
    },
  };
}

function stopAutonomyTaskTool(runtime: StudioAutonomyRuntime): Tool<{ taskId: string }> {
  return {
    name: 'rdkclaw_task_stop',
    description: '立即停止指定定时任务：暂停后中断当前正在执行的一轮任务。',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务 ID' },
      },
      required: ['taskId'],
    },
    async execute(input) {
      runtime.stopTask(input.taskId);
      return `已停止任务: ${input.taskId}`;
    },
  };
}

function approveAutonomyTaskTool(runtime: StudioAutonomyRuntime): Tool<{ taskId: string }> {
  return {
    name: 'rdkclaw_task_approve',
    description: '审批指定定时任务。',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务 ID' },
      },
      required: ['taskId'],
    },
    async execute(input) {
      runtime.approveTask(input.taskId);
      return `已审批任务: ${input.taskId}`;
    },
  };
}

function resolveAgentRoot(workspaceDir?: string): string {
  if (workspaceDir && fs.existsSync(path.join(workspaceDir, 'AGENTS.md'))) {
    return workspaceDir;
  }
  const cwd = workspaceDir || process.cwd();
  const roots = [cwd, path.join(cwd, 'agent')];
  for (const base of roots) {
    if (fs.existsSync(path.join(base, 'AGENTS.md'))) return base;
  }
  return path.join(cwd, 'agent');
}

function appendDailyMemoryTool(): Tool<{ note: string; date?: string }> {
  return {
    name: 'rdkclaw_memory_append_daily',
    description: '将重要信息写入 daily memory（memory/YYYY-MM-DD.md）。用户说“记住这个”时使用。',
    inputSchema: {
      type: 'object',
      properties: {
        note: { type: 'string', description: '要记住的内容' },
        date: { type: 'string', description: '可选，YYYY-MM-DD' },
      },
      required: ['note'],
    },
    async execute(input, ctx) {
      const root = resolveAgentRoot(ctx.bootstrapDir || ctx.workspaceDir);
      const token = (input.date || new Date().toISOString().slice(0, 10)).trim();
      const memoryDir = path.join(root, 'memory');
      const file = path.join(memoryDir, `${token}.md`);
      if (!fs.existsSync(memoryDir)) fs.mkdirSync(memoryDir, { recursive: true });
      const row = `- ${new Date().toISOString()} ${input.note.trim()}\n`;
      fs.appendFileSync(file, row, 'utf-8');
      return `已写入 daily memory: ${file}`;
    },
  };
}

function promoteLongTermMemoryTool(): Tool<{ summary: string }> {
  return {
    name: 'rdkclaw_memory_promote_longterm',
    description: '将 daily memory 提炼结果写入 MEMORY.md（仅主会话）。',
    inputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: '提炼后的长期记忆内容' },
      },
      required: ['summary'],
    },
    async execute(input, ctx) {
      const key = String(ctx.sessionKey || '');
      if (key.startsWith('feishu-') || key.startsWith('feishu:') || key.startsWith('weixin-') || key.startsWith('weixin:') || key.startsWith('autonomy-') || key.startsWith('auto:') || key.startsWith('channel:')) {
        return '共享会话禁止写入 MEMORY.md，请改写入 daily memory。';
      }
      const root = resolveAgentRoot(ctx.bootstrapDir || ctx.workspaceDir);
      const file = path.join(root, 'MEMORY.md');
      const row = `\n## ${new Date().toISOString()}\n- ${input.summary.trim()}\n`;
      fs.appendFileSync(file, row, 'utf-8');
      return `已更新长期记忆: ${file}`;
    },
  };
}

function tokenUsageReportTool(): Tool<{
  hours?: number;
  source?: "all" | "rdkclaw" | "openclaw";
  deviceId?: string;
  limit?: number;
}> {
  return {
    name: 'rdkclaw_token_usage_report',
    description: '查看底层大模型 token 消耗统计（支持 RDKClaw、本地与板端 OpenClaw）。返回窗口期汇总与最近记录。',
    inputSchema: {
      type: 'object',
      properties: {
        hours: { type: 'number', description: '统计窗口小时数，默认 24' },
        source: { type: 'string', description: 'all/rdkclaw/openclaw' },
        deviceId: { type: 'string', description: '可选，按设备过滤' },
        limit: { type: 'number', description: '最近记录条数，默认 50' },
      },
    },
    async execute(input) {
      const report = getTokenUsageReport({
        hours: Number(input.hours ?? 24),
        source: (input.source as "all" | "rdkclaw" | "openclaw") || "all",
        deviceId: input.deviceId?.trim() || "",
        limit: Number(input.limit ?? 50),
      });
      return JSON.stringify(report, null, 2);
    },
  };
}

export function createStudioTools(runtime?: StudioAutonomyRuntime): Tool[] {
  const tools: Tool[] = [
    getStudioAgentConfigTool(),
    setStudioAgentConfigTool(),
    appendDailyMemoryTool(),
    promoteLongTermMemoryTool(),
    tokenUsageReportTool(),
    ...createStudioEmbeddedBrowserCaptureTool(),
  ];
  if (runtime) {
    tools.push(
      listAutonomyTasksTool(runtime),
      createAutonomyTaskTool(runtime),
      pauseAutonomyTaskTool(runtime),
      stopAutonomyTaskTool(runtime),
      resumeAutonomyTaskTool(runtime),
      approveAutonomyTaskTool(runtime),
    );
    if (runtime.weixinOutbound) {
      tools.push(
        weixinListRecentUsersTool(runtime.weixinOutbound),
        weixinSendTextToUserTool(runtime.weixinOutbound),
      );
    }
    if (runtime.feishuOutbound) {
      tools.push(
        feishuListRecentChatsTool(runtime.feishuOutbound),
        feishuSendChatTextTool(runtime.feishuOutbound),
      );
    }
  }
  return tools;
}

