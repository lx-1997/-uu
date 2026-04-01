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
import type { Model, StreamFunction, ThinkingLevel } from '@mariozechner/pi-ai';
import { lookupModelCapabilities, fetchModelCapabilitiesFromProvider, registerModelCapabilities } from './model-registry.js';

registerBuiltInApiProviders();

export interface ProviderConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  /** 扩展思考档位：off / minimal / low / medium / high / xhigh；adaptive 在 UI 可选但发往 API 时会映射为 high */
  thinkingDefault?: string;
  /** 是否在 Studio 流式展示 thinking_delta：off / on / stream；空视为 stream */
  reasoningVisibility?: string;
}

export interface ProviderConfigEntry extends ProviderConfig {
  id: string;
  label: string;
  createdAt: number;
  updatedAt: number;
}

/** RDKClaw：null 表示关闭扩展思考；缺省配置视为 high */
export function resolveRdkclawAgentReasoning(cfg: ProviderConfig): ThinkingLevel | null {
  const raw = normalizeText(cfg.thinkingDefault).toLowerCase();
  if (!raw) return 'high';
  if (raw === 'off') return null;
  // UI 保留 adaptive；OpenAI 兼容 API 的 reasoning_effort 不认该取值，pi-ai 会原样发给上游 → 400
  if (raw === 'adaptive') return 'high';
  const allowed = new Set(['minimal', 'low', 'medium', 'high', 'xhigh']);
  if (allowed.has(raw)) return raw as ThinkingLevel;
  return 'high';
}

export function rdkclawShouldStreamThinking(cfg: ProviderConfig): boolean {
  const v = normalizeText(cfg.reasoningVisibility).toLowerCase();
  if (!v) return true;
  return v !== 'off';
}

export interface ProviderConfigRegistry {
  activeId: string | null;
  entries: ProviderConfigEntry[];
}

const CONFIG_DIR = path.join(os.homedir(), '.rdkstudio');
const CONFIG_FILE = path.join(CONFIG_DIR, 'agent-config.json');
const DEFAULT_ENTRY_ID = 'default';
const BOOTSTRAP_PROVIDER_FILE_ENV = 'RDK_PROVIDER_BOOTSTRAP_FILE';
const BOOTSTRAP_PROVIDER_FALLBACK = path.join(process.cwd(), 'config', 'rdkclaw-provider.defaults.json');

type ProviderProtocol = 'openai' | 'anthropic';

interface ProviderDefault {
  baseUrl: string;
  model: string;
  protocol?: ProviderProtocol;
}

const PROVIDER_DEFAULTS: Record<string, ProviderDefault> = {
  qwen: {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
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
    thinkingDefault: active.thinkingDefault,
    reasoningVisibility: active.reasoningVisibility,
  };
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function expandEnvVars(template: string): string {
  return template.replace(/\$\{([A-Z0-9_]+)\}/g, (_full, name: string) => {
    const value = process.env[name];
    return typeof value === 'string' ? value : '';
  });
}

function resolveBootstrapProviderConfigPath(): string | null {
  const envPath = normalizeText(process.env[BOOTSTRAP_PROVIDER_FILE_ENV]);
  if (envPath) return envPath;
  return fs.existsSync(BOOTSTRAP_PROVIDER_FALLBACK) ? BOOTSTRAP_PROVIDER_FALLBACK : null;
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
    const thinkingDefault = normalizeText(item.thinkingDefault) || undefined;
    const reasoningVisibility = normalizeText(item.reasoningVisibility) || undefined;
    entries.push({
      id: normalizeText(item.id) || `cfg-${Math.random().toString(36).slice(2, 10)}`,
      label: labelMatchesContent ? storedLabel : canonical,
      provider,
      model,
      apiKey: normalizeText(item.apiKey),
      baseUrl: normalizeText(item.baseUrl) || undefined,
      ...(thinkingDefault ? { thinkingDefault } : {}),
      ...(reasoningVisibility ? { reasoningVisibility } : {}),
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

function loadBootstrapProviderRegistry(): ProviderConfigRegistry | null {
  const bootstrapPath = resolveBootstrapProviderConfigPath();
  if (!bootstrapPath) return null;
  try {
    const raw = fs.readFileSync(bootstrapPath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    const normalized = ensureRegistryShape(parsed);
    if (normalized.entries.length === 0) return null;
    const entries = normalized.entries.map((entry) => {
      const apiKey = expandEnvVars(normalizeText(entry.apiKey));
      const baseUrlExpanded = expandEnvVars(normalizeText(entry.baseUrl));
      const modelExpanded = expandEnvVars(normalizeText(entry.model));
      return {
        ...entry,
        apiKey,
        baseUrl: baseUrlExpanded || entry.baseUrl,
        model: modelExpanded || entry.model,
      };
    });
    const activeId = entries.some((entry) => entry.id === normalized.activeId)
      ? normalized.activeId
      : entries[0]?.id || null;
    return { activeId, entries };
  } catch {
    return null;
  }
}

export function loadProviderRegistry(): ProviderConfigRegistry {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      return loadBootstrapProviderRegistry() || { activeId: null, entries: [] };
    }
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
          ...(normalizeText((legacy as ProviderConfig).thinkingDefault)
            ? { thinkingDefault: normalizeText((legacy as ProviderConfig).thinkingDefault) }
            : {}),
          ...(normalizeText((legacy as ProviderConfig).reasoningVisibility)
            ? { reasoningVisibility: normalizeText((legacy as ProviderConfig).reasoningVisibility) }
            : {}),
          createdAt: now,
          updatedAt: now,
        }],
      };
    }

    return ensureRegistryShape(parsed);
  } catch {
    return loadBootstrapProviderRegistry() || { activeId: null, entries: [] };
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
    thinkingDefault: config.thinkingDefault ?? active?.thinkingDefault,
    reasoningVisibility: config.reasoningVisibility ?? active?.reasoningVisibility,
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
  thinkingDefault?: string;
  reasoningVisibility?: string;
}): ProviderConfigEntry {
  const registry = loadProviderRegistry();
  const now = Date.now();
  const existing = input.id ? registry.entries.find((entry) => entry.id === input.id) : null;
  const active = getActiveProviderEntry(registry);
  const id = input.id?.trim() || `cfg-${Math.random().toString(36).slice(2, 10)}`;
  const resolvedApiKey = normalizeText(input.apiKey) || existing?.apiKey || active?.apiKey || '';
  const nextThinking =
    input.thinkingDefault !== undefined
      ? (normalizeText(input.thinkingDefault) || undefined)
      : existing?.thinkingDefault ?? active?.thinkingDefault;
  const nextReasoningVis =
    input.reasoningVisibility !== undefined
      ? (normalizeText(input.reasoningVisibility) || undefined)
      : existing?.reasoningVisibility ?? active?.reasoningVisibility;
  const next: ProviderConfigEntry = {
    id,
    label: normalizeText(input.label) || existing?.label || `${input.provider}/${input.model}`,
    provider: input.provider,
    model: input.model,
    apiKey: resolvedApiKey,
    baseUrl: normalizeText(input.baseUrl) || existing?.baseUrl || undefined,
    ...(nextThinking ? { thinkingDefault: nextThinking } : {}),
    ...(nextReasoningVis ? { reasoningVisibility: nextReasoningVis } : {}),
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

/** 安装包/仓库 `config/rdkclaw-provider.defaults.json` 中的内置模型元信息（无文件时返回 null） */
export function getBootstrapStudioDefaultPresetMeta(): { id: string; label: string } | null {
  const bootstrap = loadBootstrapProviderRegistry();
  if (!bootstrap || bootstrap.entries.length === 0) return null;
  const targetId = bootstrap.activeId && bootstrap.entries.some((e) => e.id === bootstrap.activeId)
    ? bootstrap.activeId
    : bootstrap.entries[0].id;
  const entry = bootstrap.entries.find((e) => e.id === targetId) || bootstrap.entries[0];
  return { id: entry.id, label: entry.label };
}

/**
 * 将 bootstrap 中的预设条目合并进用户 registry（缺失时补全），并切换 active 到内置默认模型。
 * 用于用户改用自有 Key 后一键切回安装包自带的 Doubao 端点。
 */
export function restoreStudioDefaultPresetFromBootstrap(): { ok: boolean; error?: string } {
  const bootstrap = loadBootstrapProviderRegistry();
  if (!bootstrap || bootstrap.entries.length === 0) {
    return { ok: false, error: '未找到内置模型配置（bootstrap 文件缺失）' };
  }
  let registry = loadProviderRegistry();
  const ids = new Set(registry.entries.map((e) => e.id));
  let merged = [...registry.entries];
  for (const entry of bootstrap.entries) {
    if (!ids.has(entry.id)) {
      merged.push({ ...entry });
      ids.add(entry.id);
    }
  }
  if (merged.length !== registry.entries.length) {
    saveProviderRegistry({ activeId: registry.activeId, entries: merged });
    registry = loadProviderRegistry();
  }
  const targetId =
    bootstrap.activeId && registry.entries.some((e) => e.id === bootstrap.activeId)
      ? bootstrap.activeId
      : bootstrap.entries[0].id;
  const entry = registry.entries.find((e) => e.id === targetId);
  if (!entry) {
    return { ok: false, error: '内置模型条目合并失败' };
  }
  const effectiveKey = entry.apiKey?.trim() || String(process.env.OPENAI_API_KEY || '').trim();
  if (!effectiveKey) {
    return { ok: false, error: '内置模型未配置 API Key，且未设置环境变量 OPENAI_API_KEY' };
  }
  if (!switchActiveProviderConfig(targetId)) {
    return { ok: false, error: '切换内置模型失败' };
  }
  return { ok: true };
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

  /**
   * pi-ai 在 reasoning 模型上默认可能用 `developer` 角色承载系统提示；多数 OpenAI 兼容网关
   *（豆包、通义、DeepSeek 等）只接受 system/user/assistant/tool，会 400。
   * @see https://github.com/badlogic/pi-mono — OpenAICompletionsCompat.supportsDeveloperRole
   */
  const openaiCompat = {
    supportsDeveloperRole: false as const,
    ...(isQwenCodingEndpoint ? { supportsUsageInStreaming: false as const } : {}),
  };

  if (protocol === 'anthropic') {
    return {
      api: 'anthropic-messages',
      provider: config.provider,
      id: modelId,
      name: modelId,
      baseUrl,
      /** true：允许 agent-loop 的 reasoning 级别生效；不支持的机型由 pi-ai/上游静默降级 */
      reasoning: true,
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
    reasoning: true,
    input: ['text'] as const,
    compat: openaiCompat,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: caps.contextWindow,
    maxTokens: caps.maxOutputTokens,
  } as any;
}

const _warmupCache = new Map<string, Promise<void>>();

/**
 * 启动时尝试从 Provider API 获取模型能力并更新注册表。
 * 同一 provider+model 只请求一次，静默失败不影响主流程。
 */
export async function warmupModelCapabilities(config: ProviderConfig): Promise<void> {
  const key = `${config.provider}:${config.model}`;
  const existing = _warmupCache.get(key);
  if (existing) return existing;
  const promise = (async () => {
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
  })();
  _warmupCache.set(key, promise);
  return promise;
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
