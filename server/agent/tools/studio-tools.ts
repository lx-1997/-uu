import type { Tool } from './types.js';
import {
  loadProviderConfig,
  saveProviderConfig,
  type ProviderConfig,
} from '../provider-setup.js';

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

export function createStudioTools(): Tool[] {
  return [
    getStudioAgentConfigTool(),
    setStudioAgentConfigTool(),
  ];
}

