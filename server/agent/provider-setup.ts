/**
 * RDK Studio Agent — Provider 配置
 *
 * 基于 pi-ai 的 OpenAI 兼容接口，支持通义千问/DeepSeek/OpenAI 等。
 * 配置持久化到 ~/.rdkstudio/agent-config.json
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { streamSimple, registerBuiltInApiProviders } from '@mariozechner/pi-ai';
import type { Model, StreamFunction } from '@mariozechner/pi-ai';

registerBuiltInApiProviders();

export interface ProviderConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

const CONFIG_DIR = path.join(os.homedir(), '.rdkstudio');
const CONFIG_FILE = path.join(CONFIG_DIR, 'agent-config.json');

const PROVIDER_DEFAULTS: Record<string, { baseUrl: string; model: string }> = {
  qwen: {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3.5-plus',
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
  moonshot: {
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
  },
  zhipu: {
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
  },
  xai: {
    baseUrl: 'https://api.x.ai/v1',
    model: 'grok-2-latest',
  },
  ollama: {
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5:7b',
  },
  'openai-compatible': {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
};

/**
 * sk-sp- 前缀的通义千问 key 需要用 coding 端点
 */
function resolveProviderBaseUrl(config: ProviderConfig): string {
  if (config.baseUrl) return config.baseUrl;
  if (config.provider === 'qwen' && config.apiKey.startsWith('sk-sp-')) {
    return 'https://coding.dashscope.aliyuncs.com/v1';
  }
  return PROVIDER_DEFAULTS[config.provider]?.baseUrl || 'https://api.openai.com/v1';
}

export function loadProviderConfig(): ProviderConfig | null {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return null;
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(raw) as ProviderConfig;
  } catch {
    return null;
  }
}

export function saveProviderConfig(config: ProviderConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * 构建 pi-ai Model 定义
 *
 * 通义千问/DeepSeek 都走 OpenAI 兼容接口，pi-ai 原生支持。
 * 已知问题：通义千问不支持 developer role，需要 supportsDeveloperRole: false
 */
export function buildModelDef(config: ProviderConfig): Model<any> {
  const baseUrl = resolveProviderBaseUrl(config);
  const defaults = PROVIDER_DEFAULTS[config.provider];
  const modelId = config.model || defaults?.model || 'gpt-4o-mini';
  const isQwenCodingEndpoint = config.provider === 'qwen' && baseUrl.includes('coding.dashscope.aliyuncs.com');

  return {
    api: 'openai-completions',
    provider: config.provider,
    id: modelId,
    name: modelId,
    baseUrl,
    reasoning: false,
    input: ['text'] as const,
    // Qwen coding endpoint 在流式模式下不兼容 stream_options.include_usage
    // 关闭 usage-in-streaming，避免出现 Connection error / 挂起
    ...(isQwenCodingEndpoint ? { compat: { supportsUsageInStreaming: false } } : {}),
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
  } as any;
}

export function buildStreamFn(_config: ProviderConfig): StreamFunction {
  return streamSimple;
}

export function getApiKey(config: ProviderConfig): string {
  return config.apiKey;
}

export function getBaseUrl(config: ProviderConfig): string {
  return resolveProviderBaseUrl(config);
}
