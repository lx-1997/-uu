/**
 * RDK Studio Agent — Provider 配置
 *
 * 基于 pi-ai 的 OpenAI 兼容接口，支持通义千问/DeepSeek/OpenAI 等。
 * 配置持久化到 ~/.rdkstudio/agent-config.json
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { streamSimple, streamSimpleAnthropic, registerBuiltInApiProviders } from '@mariozechner/pi-ai';
import type { Model, StreamFunction } from '@mariozechner/pi-ai';
import { lookupModelCapabilities, fetchModelCapabilitiesFromProvider, registerModelCapabilities } from './model-registry.js';

registerBuiltInApiProviders();

export interface ProviderConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

export interface ProviderConfigEntry extends ProviderConfig {
  id: string;
  label: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderConfigRegistry {
  activeId: string | null;
  entries: ProviderConfigEntry[];
}

const CONFIG_DIR = path.join(os.homedir(), '.rdkstudio');
const CONFIG_FILE = path.join(CONFIG_DIR, 'agent-config.json');
const DEFAULT_ENTRY_ID = 'default';

type ProviderProtocol = 'openai' | 'anthropic';

interface ProviderDefault {
  baseUrl: string;
  model: string;
  protocol?: ProviderProtocol;
}

const PROVIDER_DEFAULTS: Record<string, ProviderDefault> = {
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
  anthropic: {
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-20250514',
    protocol: 'anthropic',
  },
  doubao: {
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-1.5-pro-256k',
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
  },
  stepfun: {
    baseUrl: 'https://api.stepfun.com/v1',
    model: 'step-2-16k',
  },
  minimax: {
    baseUrl: 'https://api.minimax.chat/v1',
    model: 'MiniMax-Text-01',
  },
  yi: {
    baseUrl: 'https://api.lingyiwanwu.com/v1',
    model: 'yi-lightning',
  },
  baichuan: {
    baseUrl: 'https://api.baichuan-ai.com/v1',
    model: 'Baichuan4-Air',
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
  siliconflow: {
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V3',
  },
  'openai-compatible': {
    baseUrl: '',
    model: 'gpt-4o-mini',
  },
  'anthropic-compatible': {
    baseUrl: '',
    model: 'claude-sonnet-4-20250514',
    protocol: 'anthropic',
  },
};

function resolveProtocol(config: ProviderConfig): ProviderProtocol {
  const defaults = PROVIDER_DEFAULTS[config.provider];
  return defaults?.protocol || 'openai';
}

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
  const registry = loadProviderRegistry();
  const active = getActiveProviderEntry(registry);
  if (!active) return null;
  return {
    provider: active.provider,
    model: active.model,
    apiKey: active.apiKey,
    baseUrl: active.baseUrl,
  };
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function ensureRegistryShape(input: unknown): ProviderConfigRegistry {
  if (!input || typeof input !== 'object') {
    return { activeId: null, entries: [] };
  }
  const maybe = input as Partial<ProviderConfigRegistry>;
  const entriesRaw = Array.isArray(maybe.entries) ? maybe.entries : [];
  const entries: ProviderConfigEntry[] = [];
  for (const entry of entriesRaw) {
    const item = entry as Partial<ProviderConfigEntry>;
    const provider = normalizeText(item.provider);
    const model = normalizeText(item.model);
    if (!provider || !model) continue;
    const now = Date.now();
    const storedLabel = normalizeText(item.label);
    const canonical = `${provider}/${model}`;
    const labelMatchesContent = storedLabel && (storedLabel.includes(model) || storedLabel === canonical);
    entries.push({
      id: normalizeText(item.id) || `cfg-${Math.random().toString(36).slice(2, 10)}`,
      label: labelMatchesContent ? storedLabel : canonical,
      provider,
      model,
      apiKey: normalizeText(item.apiKey),
      baseUrl: normalizeText(item.baseUrl) || undefined,
      createdAt: Number.isFinite(item.createdAt) ? Number(item.createdAt) : now,
      updatedAt: Number.isFinite(item.updatedAt) ? Number(item.updatedAt) : now,
    });
  }
  const activeId = normalizeText(maybe.activeId) || null;
  return {
    activeId: entries.some((e) => e.id === activeId) ? activeId : (entries[0]?.id || null),
    entries,
  };
}

export function loadProviderRegistry(): ProviderConfigRegistry {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return { activeId: null, entries: [] };
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;

    // 兼容旧格式（单配置对象）
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && !('entries' in (parsed as Record<string, unknown>))) {
      const legacy = parsed as Partial<ProviderConfig>;
      const provider = normalizeText(legacy.provider);
      const model = normalizeText(legacy.model);
      const apiKey = normalizeText(legacy.apiKey);
      if (!provider || !model) {
        return { activeId: null, entries: [] };
      }
      const now = Date.now();
      return {
        activeId: DEFAULT_ENTRY_ID,
        entries: [{
          id: DEFAULT_ENTRY_ID,
          label: `${provider}/${model}`,
          provider,
          model,
          apiKey,
          baseUrl: normalizeText(legacy.baseUrl) || undefined,
          createdAt: now,
          updatedAt: now,
        }],
      };
    }

    return ensureRegistryShape(parsed);
  } catch {
    return { activeId: null, entries: [] };
  }
}

export function saveProviderRegistry(registry: ProviderConfigRegistry): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(registry, null, 2), 'utf-8');
}

export function getActiveProviderEntry(registry?: ProviderConfigRegistry): ProviderConfigEntry | null {
  const store = registry || loadProviderRegistry();
  if (store.entries.length === 0) return null;
  const activeId = store.activeId || store.entries[0].id;
  return store.entries.find((e) => e.id === activeId) || store.entries[0] || null;
}

export function saveProviderConfig(config: ProviderConfig): void {
  const now = Date.now();
  const registry = loadProviderRegistry();
  const active = getActiveProviderEntry(registry);
  const id = active?.id || DEFAULT_ENTRY_ID;
  const normalized: ProviderConfigEntry = {
    id,
    label: active?.label || `${config.provider}/${config.model}`,
    provider: config.provider,
    model: config.model,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    createdAt: active?.createdAt || now,
    updatedAt: now,
  };
  const others = registry.entries.filter((entry) => entry.id !== id);
  saveProviderRegistry({
    activeId: id,
    entries: [normalized, ...others],
  });
}

export function upsertProviderConfigEntry(input: {
  id?: string;
  label?: string;
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  setActive?: boolean;
}): ProviderConfigEntry {
  const registry = loadProviderRegistry();
  const now = Date.now();
  const existing = input.id ? registry.entries.find((entry) => entry.id === input.id) : null;
  const active = getActiveProviderEntry(registry);
  const id = input.id?.trim() || `cfg-${Math.random().toString(36).slice(2, 10)}`;
  const resolvedApiKey = normalizeText(input.apiKey) || existing?.apiKey || active?.apiKey || '';
  const next: ProviderConfigEntry = {
    id,
    label: normalizeText(input.label) || existing?.label || `${input.provider}/${input.model}`,
    provider: input.provider,
    model: input.model,
    apiKey: resolvedApiKey,
    baseUrl: normalizeText(input.baseUrl) || existing?.baseUrl || undefined,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  const entries = [next, ...registry.entries.filter((entry) => entry.id !== id)];
  const activeId = input.setActive === false ? (registry.activeId || next.id) : next.id;
  saveProviderRegistry({ activeId, entries });
  return next;
}

export function switchActiveProviderConfig(id: string): boolean {
  const registry = loadProviderRegistry();
  if (!registry.entries.some((entry) => entry.id === id)) return false;
  saveProviderRegistry({ ...registry, activeId: id });
  return true;
}

export function deleteProviderConfigEntry(id: string): boolean {
  const registry = loadProviderRegistry();
  if (!registry.entries.some((entry) => entry.id === id)) return false;
  const entries = registry.entries.filter((entry) => entry.id !== id);
  const activeId = registry.activeId === id ? (entries[0]?.id || null) : registry.activeId;
  saveProviderRegistry({ activeId, entries });
  return true;
}

/**
 * 构建 pi-ai Model 定义
 *
 * 根据 provider 协议自动选择 openai-completions 或 anthropic-messages。
 * Qwen coding endpoint 特殊处理 stream_options 兼容性。
 */
export function buildModelDef(config: ProviderConfig): Model<any> {
  const baseUrl = resolveProviderBaseUrl(config);
  const defaults = PROVIDER_DEFAULTS[config.provider];
  const modelId = config.model || defaults?.model || 'gpt-4o-mini';
  const protocol = resolveProtocol(config);
  const isQwenCodingEndpoint = config.provider === 'qwen' && baseUrl.includes('coding.dashscope.aliyuncs.com');

  const caps = lookupModelCapabilities(config.provider, modelId);

  if (protocol === 'anthropic') {
    return {
      api: 'anthropic-messages',
      provider: config.provider,
      id: modelId,
      name: modelId,
      baseUrl,
      reasoning: false,
      input: ['text'] as const,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: caps.contextWindow,
      maxTokens: caps.maxOutputTokens,
    } as any;
  }

  return {
    api: 'openai-completions',
    provider: config.provider,
    id: modelId,
    name: modelId,
    baseUrl,
    reasoning: false,
    input: ['text'] as const,
    ...(isQwenCodingEndpoint ? { compat: { supportsUsageInStreaming: false } } : {}),
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: caps.contextWindow,
    maxTokens: caps.maxOutputTokens,
  } as any;
}

/**
 * 启动时尝试从 Provider API 获取模型能力并更新注册表。
 * 静默失败，不影响主流程。
 */
export async function warmupModelCapabilities(config: ProviderConfig): Promise<void> {
  try {
    const baseUrl = resolveProviderBaseUrl(config);
    const caps = await fetchModelCapabilitiesFromProvider({
      baseUrl,
      apiKey: config.apiKey,
      model: config.model,
    });
    if (caps) {
      registerModelCapabilities(config.model, caps);
    }
  } catch {
    // 静默失败
  }
}

export function buildStreamFn(config: ProviderConfig): StreamFunction {
  const protocol = resolveProtocol(config);
  if (protocol === 'anthropic') {
    return streamSimpleAnthropic as unknown as StreamFunction;
  }
  return streamSimple;
}

export function getApiKey(config: ProviderConfig): string {
  return config.apiKey;
}

export function getBaseUrl(config: ProviderConfig): string {
  return resolveProviderBaseUrl(config);
}
