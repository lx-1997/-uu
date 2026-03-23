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
        model: { type: 'string', description: '模型名，如 qwen3.5-plus' },
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
  }) => AutonomyTask;
  pauseTask: (taskId: string) => void;
  stopTask: (taskId: string) => void;
  resumeTask: (taskId: string) => void;
  approveTask: (taskId: string) => void;
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
}> {
  return {
    name: 'rdkclaw_task_create',
    description: '创建 RDKClaw 定时任务。支持秒级、分钟级或 cron。用于无需用户触发的自治消息与巡检任务。',
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
        mode: input.mode || 'local',
        requiresApproval: !!input.requiresApproval,
      });
      return `已创建定时任务: ${task.id}\n${JSON.stringify(task, null, 2)}`;
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
      if (key.startsWith('feishu-') || key.startsWith('feishu:') || key.startsWith('autonomy-') || key.startsWith('auto:') || key.startsWith('channel:')) {
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
  }
  return tools;
}

