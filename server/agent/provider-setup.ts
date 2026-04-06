/**
 * RDK Studio Agent — Provider 配置
 *
 * 基于 pi-ai 的 OpenAI 兼容接口，支持通义千问/DeepSeek/OpenAI 等。
 * 配置持久化到 ~/.rdkstudio/agent-config.json
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import { streamSimple, streamSimpleAnthropic, registerBuiltInApiProviders } from '@mariozechner/pi-ai';
import type { Model, StreamFunction, ThinkingLevel } from '@mariozechner/pi-ai';
import { lookupModelCapabilities, fetchModelCapabilitiesFromProvider, registerModelCapabilities } from './model-registry.js';
import type { StudioResponseMode } from '../rdkclaw/types.js';

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
  /** 模型采样温度（字符串便于表单与 JSON）；留空则不传给上游，使用其默认 */
  samplingTemperature?: string;
  /** nucleus top_p，0–1；留空则不传 */
  samplingTopP?: string;
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

/** 解析为请求级 temperature；无效或留空返回 undefined */
export function resolveSamplingTemperature(cfg: ProviderConfig): number | undefined {
  const raw = normalizeText(cfg.samplingTemperature);
  if (!raw) return undefined;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(2, Math.max(0, n));
}

/** 解析 top_p；无效或留空返回 undefined（经 onPayload 注入，因 pi-ai 类型未声明该字段） */
export function resolveSamplingTopP(cfg: ProviderConfig): number | undefined {
  const raw = normalizeText(cfg.samplingTopP);
  if (!raw) return undefined;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(1, Math.max(0, n));
}

export interface ProviderConfigRegistry {
  /** Dock「深度思考」与各非聊天链路默认使用的条目 */
  activeId: string | null;
  /** Dock「快速回答」专用条目；应与深度条目区分（安装包内置快速 id 会在加载配置时自动补全） */
  quickActiveId?: string | null;
  /**
   * 套件端 OpenClaw 委派预检在「套件端未配置网关」时写入所用的 Studio 模型条目。
   * 未设置或与条目无效时，回退为当前「深度思考」主模型（activeId）。
   */
  openclawDelegateProviderId?: string | null;
  entries: ProviderConfigEntry[];
}

const CONFIG_DIR = path.join(os.homedir(), '.rdkstudio');
const CONFIG_FILE = path.join(CONFIG_DIR, 'agent-config.json');
const DEFAULT_ENTRY_ID = 'default';
/** Studio 推荐默认：偏稳、适合长任务；配置文件中可留空，解析时用此缺省 */
export const STUDIO_DEFAULT_SAMPLING_TEMPERATURE = '0.1';
export const STUDIO_DEFAULT_SAMPLING_TOP_P = '1';

const BOOTSTRAP_PROVIDER_FILE_ENV = 'RDK_PROVIDER_BOOTSTRAP_FILE';
const BOOTSTRAP_FILENAME = 'rdkclaw-provider.defaults.json';

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
  /** 与仓库 config/rdkclaw-provider.defaults.json、RDKClaw DEFAULT_CONFIG 对齐（火山方舟 OpenAI 兼容） */
  'openai-compatible': {
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
    model: 'doubao-seed-2.0-pro',
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

/** quickActiveId 为空时：优先绑定内置快速条目，其次仅一条配置时用该条，否则回退到当前 active（兼容旧数据） */
export function getStudioLaneProviderEntry(
  registry: ProviderConfigRegistry,
  lane: "thinking" | "quick",
): ProviderConfigEntry | null {
  if (registry.entries.length === 0) return null;
  if (lane === "thinking") {
    return getActiveProviderEntry(registry);
  }
  const qid = registry.quickActiveId?.trim();
  if (qid && registry.entries.some((e) => e.id === qid)) {
    return registry.entries.find((e) => e.id === qid) || null;
  }
  const presets = getBootstrapStudioDefaultPresetsMeta();
  const bid = presets?.quick?.id?.trim();
  if (bid && registry.entries.some((e) => e.id === bid)) {
    return registry.entries.find((e) => e.id === bid) || null;
  }
  if (registry.entries.length === 1) {
    return registry.entries[0];
  }
  return getActiveProviderEntry(registry);
}

export function loadProviderConfigForStudioLane(lane: "thinking" | "quick"): ProviderConfig | null {
  const registry = loadProviderRegistry();
  const active = getStudioLaneProviderEntry(registry, lane);
  if (!active) return null;
  return {
    provider: active.provider,
    model: active.model,
    apiKey: active.apiKey,
    baseUrl: active.baseUrl,
    thinkingDefault: active.thinkingDefault,
    reasoningVisibility: active.reasoningVisibility,
    samplingTemperature: effectiveSamplingTemperature(active.samplingTemperature),
    samplingTopP: effectiveSamplingTopP(active.samplingTopP),
  };
}

export function loadProviderConfig(): ProviderConfig | null {
  return loadProviderConfigForStudioLane("thinking");
}

/**
 * 将指定 Studio 已保存模型条目转为 OpenClaw `custom-gateway` 字段（写入套件端 openclaw 配置）。
 */
export function buildOpenClawModelGatewayFromStudioEntryId(entryId: string): {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  modelName: string;
  api: string;
} | null {
  const registry = loadProviderRegistry();
  const id = entryId.trim();
  if (!id || !registry.entries.some((e) => e.id === id)) return null;
  const entry = registry.entries.find((e) => e.id === id)!;
  const cfg: ProviderConfig = {
    provider: entry.provider,
    model: entry.model,
    apiKey: entry.apiKey,
    baseUrl: entry.baseUrl,
    thinkingDefault: entry.thinkingDefault,
    reasoningVisibility: entry.reasoningVisibility,
    samplingTemperature: effectiveSamplingTemperature(entry.samplingTemperature),
    samplingTopP: effectiveSamplingTopP(entry.samplingTopP),
  };
  if (!cfg?.model?.trim()) return null;
  const apiKey = cfg.apiKey?.trim() || String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) return null;
  const merged: ProviderConfig = { ...cfg, apiKey };
  const baseUrl = resolveProviderBaseUrl(merged);
  const protocol = resolveProtocol(merged);
  const api = protocol === 'anthropic' ? 'anthropic-messages' : 'openai-completions';
  const modelId = cfg.model.trim();
  return {
    baseUrl,
    apiKey,
    modelId,
    modelName: (entry.label || '').trim() || modelId,
    api,
  };
}

/**
 * 将 Studio 中**为套件端委派预选**的模型条目（或回退为「深度思考」主模型）转为 OpenClaw `custom-gateway` 所需字段，
 * 供套件端缺少模型网关时由 RDKClaw 写入 `openclaw.json`。
 * 无有效模型名或 API Key（含 `OPENAI_API_KEY` 环境变量兜底）时返回 null。
 */
export function buildOpenClawModelGatewayFromStudioThinking(): {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  modelName: string;
  api: string;
} | null {
  const registry = loadProviderRegistry();
  const delegateId = registry.openclawDelegateProviderId?.trim();
  if (delegateId && registry.entries.some((e) => e.id === delegateId)) {
    return buildOpenClawModelGatewayFromStudioEntryId(delegateId);
  }
  const cfg = loadProviderConfigForStudioLane("thinking");
  if (!cfg?.model?.trim()) return null;
  const apiKey = cfg.apiKey?.trim() || String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) return null;
  const merged: ProviderConfig = { ...cfg, apiKey };
  const baseUrl = resolveProviderBaseUrl(merged);
  const protocol = resolveProtocol(merged);
  const api = protocol === 'anthropic' ? 'anthropic-messages' : 'openai-completions';
  const modelId = cfg.model.trim();
  return {
    baseUrl,
    apiKey,
    modelId,
    modelName: modelId,
    api,
  };
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function effectiveSamplingTemperature(stored: string | undefined): string {
  return normalizeText(stored) || STUDIO_DEFAULT_SAMPLING_TEMPERATURE;
}

export function effectiveSamplingTopP(stored: string | undefined): string {
  return normalizeText(stored) || STUDIO_DEFAULT_SAMPLING_TOP_P;
}

/**
 * 历史兼容：此前 Dock 快速模式曾在「与 active 同条目」时强行覆盖思考/采样。
 * 现 Studio 流式对话已改为完全使用对应条目的持久化字段；此函数仅为潜在调用方保留语义参考。
 */
export function mergeStudioResponseMode(
  cfg: ProviderConfig,
  mode: StudioResponseMode | undefined,
): ProviderConfig {
  if (!mode || mode === "thinking") {
    return { ...cfg };
  }
  return {
    ...cfg,
    thinkingDefault: "off",
    reasoningVisibility: "off",
    samplingTemperature: "0",
    samplingTopP: "1",
  };
}

/**
 * 执行策略中的「引擎模式」：`thinking` 完全沿用 AI 模型页（含缺省 0.1 / 1 / high）。
 * `fast` 在运行时覆盖为低延迟、短答取向（不修改磁盘上的 agent-config）。
 */
export function applyEnginePresetToProviderConfig(
  cfg: ProviderConfig,
  preset: "thinking" | "fast" | undefined,
): ProviderConfig {
  if (!preset || preset === "thinking") {
    return { ...cfg };
  }
  return {
    ...cfg,
    thinkingDefault: "minimal",
    reasoningVisibility: "off",
    samplingTemperature: "0",
    samplingTopP: "1",
  };
}

function expandEnvVars(template: string): string {
  return template.replace(/\$\{([A-Z0-9_]+)\}/g, (_full, name: string) => {
    const value = process.env[name];
    return typeof value === 'string' ? value : '';
  });
}

function findBootstrapFileWalkingUp(fromDir: string, maxUp: number): string | null {
  let cur = path.resolve(fromDir);
  for (let i = 0; i <= maxUp; i++) {
    const candidate = path.join(cur, 'config', BOOTSTRAP_FILENAME);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

function resolveBootstrapProviderConfigPath(): string | null {
  const envPath = normalizeText(process.env[BOOTSTRAP_PROVIDER_FILE_ENV]);
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates: string[] = [];
  if (envPath && fs.existsSync(envPath)) {
    candidates.push(path.normalize(envPath));
  }
  candidates.push(path.join(process.cwd(), 'config', BOOTSTRAP_FILENAME));
  /**
   * 自本文件向上若干层直接拼 config/（不依赖仅靠 cwd）：兼容
   * - 源码 server/agent、编译产物 dist-server/server/agent、更深 monorepo 路径
   */
  for (let up = 2; up <= 8; up++) {
    candidates.push(path.join(moduleDir, ...Array.from({ length: up }, () => '..'), 'config', BOOTSTRAP_FILENAME));
  }
  /** 自本文件目录向上探测，兼容任意深度的 dist/monorepo 布局（固定 ../.. 不够用时不致丢预设） */
  const walkedFromModule = findBootstrapFileWalkingUp(moduleDir, 14);
  if (walkedFromModule) candidates.push(walkedFromModule);
  candidates.push(
    path.join(moduleDir, '..', '..', 'config', BOOTSTRAP_FILENAME),
    path.join(moduleDir, '..', '..', '..', 'config', BOOTSTRAP_FILENAME),
  );
  const walked = findBootstrapFileWalkingUp(process.cwd(), 6);
  if (walked) candidates.push(walked);
  const seen = new Set<string>();
  for (const p of candidates) {
    const resolved = path.normalize(p);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    if (fs.existsSync(resolved)) return resolved;
  }
  return null;
}

function ensureRegistryShape(input: unknown): ProviderConfigRegistry {
  if (!input || typeof input !== 'object') {
    return { activeId: null, quickActiveId: null, openclawDelegateProviderId: null, entries: [] };
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
    const samplingTemperature = normalizeText(item.samplingTemperature) || undefined;
    const samplingTopP = normalizeText(item.samplingTopP) || undefined;
    entries.push({
      id: normalizeText(item.id) || `cfg-${Math.random().toString(36).slice(2, 10)}`,
      label: labelMatchesContent ? storedLabel : canonical,
      provider,
      model,
      apiKey: normalizeText(item.apiKey),
      baseUrl: normalizeText(item.baseUrl) || undefined,
      ...(thinkingDefault ? { thinkingDefault } : {}),
      ...(reasoningVisibility ? { reasoningVisibility } : {}),
      ...(samplingTemperature ? { samplingTemperature } : {}),
      ...(samplingTopP ? { samplingTopP } : {}),
      createdAt: Number.isFinite(item.createdAt) ? Number(item.createdAt) : now,
      updatedAt: Number.isFinite(item.updatedAt) ? Number(item.updatedAt) : now,
    });
  }
  const activeId = normalizeText(maybe.activeId) || null;
  const resolvedActive = entries.some((e) => e.id === activeId) ? activeId : entries[0]?.id || null;
  const quickRaw = normalizeText((maybe as { quickActiveId?: unknown }).quickActiveId as string | undefined);
  const quickActiveId =
    quickRaw && entries.some((e) => e.id === quickRaw) ? quickRaw : null;
  const ocidRaw = normalizeText((maybe as { openclawDelegateProviderId?: unknown }).openclawDelegateProviderId);
  const openclawDelegateProviderId =
    ocidRaw && entries.some((e) => e.id === ocidRaw) ? ocidRaw : null;
  return {
    activeId: resolvedActive,
    quickActiveId,
    openclawDelegateProviderId,
    entries,
  };
}

function loadBootstrapProviderRegistry(): ProviderConfigRegistry | null {
  const bootstrapPath = resolveBootstrapProviderConfigPath();
  if (!bootstrapPath) return null;
  try {
    const raw = fs.readFileSync(bootstrapPath, 'utf-8').replace(/^\uFEFF/, '');
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
    const quickActiveId =
      normalized.quickActiveId && entries.some((e) => e.id === normalized.quickActiveId)
        ? normalized.quickActiveId
        : null;
    const ocid = normalized.openclawDelegateProviderId?.trim();
    const openclawDelegateProviderId =
      ocid && entries.some((e) => e.id === ocid) ? ocid : null;
    return { activeId, quickActiveId, openclawDelegateProviderId, entries };
  } catch {
    return null;
  }
}

/**
 * 内置预设条目曾用 `doubao-seed-*` 作为 provider 键，与设置页「OpenAI 兼容协议」(`openai-compatible`) 对齐。
 */
function migrateStudioBootstrapPresetProviders(
  registry: ProviderConfigRegistry,
): { registry: ProviderConfigRegistry; changed: boolean } {
  let changed = false;
  const entries = registry.entries.map((e) => {
    if (e.id === 'preset-doubao-seed-2.0-pro' && e.provider === 'doubao-seed-2.0-pro') {
      changed = true;
      return { ...e, provider: 'openai-compatible', updatedAt: Date.now() };
    }
    if (e.id === 'preset-doubao-seed-2.0-lite-quick' && e.provider === 'doubao-seed-2.0-lite') {
      changed = true;
      return { ...e, provider: 'openai-compatible', updatedAt: Date.now() };
    }
    return e;
  });
  return { registry: changed ? { ...registry, entries } : registry, changed };
}

/** quickActiveId 未设置时：写入内置快速条目 id，或仅一条配置时绑定该条（便于与深度剥离，无需「与深度相同」） */
export function applyQuickLaneDefaultIfUnset(registry: ProviderConfigRegistry): ProviderConfigRegistry {
  const q = registry.quickActiveId?.trim() || '';
  if (q && registry.entries.some((e) => e.id === q)) {
    return registry;
  }
  const bootstrap = loadBootstrapProviderRegistry();
  const bid = bootstrap?.quickActiveId?.trim();
  if (bid && registry.entries.some((e) => e.id === bid)) {
    return { ...registry, quickActiveId: bid };
  }
  if (registry.entries.length === 1) {
    return { ...registry, quickActiveId: registry.entries[0].id };
  }
  return registry;
}

export function loadProviderRegistry(): ProviderConfigRegistry {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      const boot = loadBootstrapProviderRegistry();
      if (!boot) return { activeId: null, quickActiveId: null, entries: [] };
      return applyQuickLaneDefaultIfUnset(boot);
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
      const legacyReg: ProviderConfigRegistry = {
        activeId: DEFAULT_ENTRY_ID,
        quickActiveId: null,
        openclawDelegateProviderId: null,
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
          ...(normalizeText((legacy as ProviderConfig).samplingTemperature)
            ? { samplingTemperature: normalizeText((legacy as ProviderConfig).samplingTemperature) }
            : {}),
          ...(normalizeText((legacy as ProviderConfig).samplingTopP)
            ? { samplingTopP: normalizeText((legacy as ProviderConfig).samplingTopP) }
            : {}),
          createdAt: now,
          updatedAt: now,
        }],
      };
      return applyQuickLaneDefaultIfUnset(legacyReg);
    }

    const reg = ensureRegistryShape(parsed);
    const { registry: regM, changed: presetMigrated } = migrateStudioBootstrapPresetProviders(reg);
    /** agent-config 存在但条目被清空/损坏时，与无文件冷启动一致：回滚到安装包/仓库 bootstrap，避免设置页只剩「新建」。 */
    if (regM.entries.length === 0) {
      const boot = loadBootstrapProviderRegistry();
      if (boot && boot.entries.length > 0) {
        const recovered = applyQuickLaneDefaultIfUnset(boot);
        saveProviderRegistry(recovered);
        return recovered;
      }
      return { activeId: null, quickActiveId: null, openclawDelegateProviderId: null, entries: [] };
    }
    const next = applyQuickLaneDefaultIfUnset(regM);
    if (presetMigrated || next.quickActiveId !== regM.quickActiveId) {
      saveProviderRegistry(next);
      return next;
    }
    return regM;
  } catch {
    const boot = loadBootstrapProviderRegistry();
    if (!boot) return { activeId: null, quickActiveId: null, openclawDelegateProviderId: null, entries: [] };
    return applyQuickLaneDefaultIfUnset(boot);
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
    samplingTemperature: config.samplingTemperature ?? active?.samplingTemperature,
    samplingTopP: config.samplingTopP ?? active?.samplingTopP,
    createdAt: active?.createdAt || now,
    updatedAt: now,
  };
  const others = registry.entries.filter((entry) => entry.id !== id);
  saveProviderRegistry({
    ...registry,
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
  samplingTemperature?: string;
  samplingTopP?: string;
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
  const nextSamplingTemp =
    input.samplingTemperature !== undefined
      ? (normalizeText(input.samplingTemperature) || undefined)
      : existing?.samplingTemperature ?? active?.samplingTemperature;
  const nextSamplingTopP =
    input.samplingTopP !== undefined
      ? (normalizeText(input.samplingTopP) || undefined)
      : existing?.samplingTopP ?? active?.samplingTopP;
  const next: ProviderConfigEntry = {
    id,
    label: normalizeText(input.label) || existing?.label || `${input.provider}/${input.model}`,
    provider: input.provider,
    model: input.model,
    apiKey: resolvedApiKey,
    baseUrl: normalizeText(input.baseUrl) || existing?.baseUrl || undefined,
    ...(nextThinking ? { thinkingDefault: nextThinking } : {}),
    ...(nextReasoningVis ? { reasoningVisibility: nextReasoningVis } : {}),
    ...(nextSamplingTemp ? { samplingTemperature: nextSamplingTemp } : {}),
    ...(nextSamplingTopP ? { samplingTopP: nextSamplingTopP } : {}),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  const entries = [next, ...registry.entries.filter((entry) => entry.id !== id)];
  const activeId = input.setActive === false ? (registry.activeId || next.id) : next.id;
  saveProviderRegistry({
    ...registry,
    activeId,
    entries,
  });
  return next;
}

export function switchActiveProviderConfig(id: string): boolean {
  const registry = loadProviderRegistry();
  if (!registry.entries.some((entry) => entry.id === id)) return false;
  saveProviderRegistry({ ...registry, activeId: id });
  return true;
}

/** Dock「快速回答」绑定条目；传空 id 时回退为安装包内置快速条目（若已在 registry 中） */
export function switchQuickActiveProviderConfig(id: string | null | undefined): boolean {
  const registry = loadProviderRegistry();
  let next = id?.trim() || null;
  if (next && !registry.entries.some((entry) => entry.id === next)) {
    return false;
  }
  if (!next) {
    const presets = getBootstrapStudioDefaultPresetsMeta();
    const bid = presets?.quick?.id?.trim();
    if (bid && registry.entries.some((e) => e.id === bid)) {
      next = bid;
    } else {
      return false;
    }
  }
  saveProviderRegistry({ ...registry, quickActiveId: next });
  return true;
}

/**
 * 复制指定条目为「快速回答」专用（新 id），默认参数偏延迟敏感；不改变当前深度思考 activeId。
 */
export function duplicateProviderEntryForQuickLane(sourceId?: string | null): {
  ok: boolean;
  error?: string;
  newId?: string;
} {
  const registry = loadProviderRegistry();
  const sid = normalizeText(sourceId) || normalizeText(registry.activeId || '');
  const src = registry.entries.find((e) => e.id === sid);
  if (!src) return { ok: false, error: '源配置不存在' };
  const effectiveKey = src.apiKey?.trim() || String(process.env.OPENAI_API_KEY || '').trim();
  if (!effectiveKey) return { ok: false, error: '源模型未配置 API Key' };
  const now = Date.now();
  const newId = `cfg-${Math.random().toString(36).slice(2, 10)}`;
  const baseLabel = normalizeText(src.label) || `${src.provider}/${src.model}`;
  const clone: ProviderConfigEntry = {
    id: newId,
    label: `${baseLabel} (快速)`.slice(0, 200),
    provider: src.provider,
    model: src.model,
    apiKey: src.apiKey,
    baseUrl: src.baseUrl,
    thinkingDefault: 'off',
    reasoningVisibility: 'off',
    samplingTemperature: '0',
    samplingTopP: '1',
    createdAt: now,
    updatedAt: now,
  };
  saveProviderRegistry({
    ...registry,
    quickActiveId: newId,
    entries: [clone, ...registry.entries],
  });
  return { ok: true, newId };
}

export function deleteProviderConfigEntry(id: string): boolean {
  const registry = loadProviderRegistry();
  if (!registry.entries.some((entry) => entry.id === id)) return false;
  const entries = registry.entries.filter((entry) => entry.id !== id);
  const activeId = registry.activeId === id ? (entries[0]?.id || null) : registry.activeId;
  let quickActiveId = registry.quickActiveId ?? null;
  if (quickActiveId === id) quickActiveId = null;
  let openclawDelegateProviderId = registry.openclawDelegateProviderId ?? null;
  if (openclawDelegateProviderId === id) openclawDelegateProviderId = null;
  let next: ProviderConfigRegistry = { ...registry, activeId, entries, quickActiveId, openclawDelegateProviderId };
  next = applyQuickLaneDefaultIfUnset(next);
  saveProviderRegistry(next);
  return true;
}

/** 设置套件端 OpenClaw 委派预检使用的模型条目；传空则与当前「深度思考」主模型一致 */
export function setOpenclawDelegateProviderConfig(id: string | null | undefined): boolean {
  const registry = loadProviderRegistry();
  const next = id?.trim() || null;
  if (next && !registry.entries.some((e) => e.id === next)) {
    return false;
  }
  saveProviderRegistry({ ...registry, openclawDelegateProviderId: next });
  return true;
}

/** 安装包内置的「深度思考」与「快速回答」默认条目元信息（无文件或无条目时返回 null） */
export function getBootstrapStudioDefaultPresetsMeta(): {
  thinking: { id: string; label: string; model: string; provider: string };
  quick: { id: string; label: string; model: string; provider: string } | null;
} | null {
  const bootstrap = loadBootstrapProviderRegistry();
  if (!bootstrap || bootstrap.entries.length === 0) return null;
  const thinkingId =
    bootstrap.activeId && bootstrap.entries.some((e) => e.id === bootstrap.activeId)
      ? bootstrap.activeId
      : bootstrap.entries[0].id;
  const thinkingEntry = bootstrap.entries.find((e) => e.id === thinkingId) || bootstrap.entries[0];
  const qid = bootstrap.quickActiveId?.trim();
  const quickEntry =
    qid && bootstrap.entries.some((e) => e.id === qid)
      ? bootstrap.entries.find((e) => e.id === qid)!
      : null;
  return {
    thinking: {
      id: thinkingEntry.id,
      label: thinkingEntry.label,
      model: thinkingEntry.model,
      provider: thinkingEntry.provider,
    },
    quick: quickEntry
      ? {
          id: quickEntry.id,
          label: quickEntry.label,
          model: quickEntry.model,
          provider: quickEntry.provider,
        }
      : null,
  };
}

/**
 * 将 bootstrap 中的内置预设写回 registry：同 id 以安装包为准刷新（保留用户已保存的 apiKey）；缺失的预设追加入库。
 */
export function syncBootstrapPresetEntriesIntoRegistry(registry: ProviderConfigRegistry): ProviderConfigRegistry {
  const bootstrap = loadBootstrapProviderRegistry();
  if (!bootstrap || bootstrap.entries.length === 0) return registry;
  const bootById = new Map(bootstrap.entries.map((e) => [e.id, e]));
  const mergedEntries: ProviderConfigEntry[] = registry.entries.map((e) => {
    const b = bootById.get(e.id);
    if (!b) return e;
    const keepKey = e.apiKey?.trim();
    return {
      ...b,
      apiKey: keepKey || b.apiKey,
      createdAt: e.createdAt,
      updatedAt: Date.now(),
    };
  });
  const have = new Set(mergedEntries.map((e) => e.id));
  for (const b of bootstrap.entries) {
    if (!have.has(b.id)) {
      mergedEntries.push({ ...b });
      have.add(b.id);
    }
  }
  return { ...registry, entries: mergedEntries };
}

/** 若 entryId 对应安装包内置预设，则从 bootstrap 文件刷新该条（及同批预设），再落盘 */
export function resyncBootstrapPresetEntryIfNeeded(entryId: string): void {
  const id = entryId?.trim();
  if (!id) return;
  const bootstrap = loadBootstrapProviderRegistry();
  if (!bootstrap?.entries.some((e) => e.id === id)) return;
  const next = syncBootstrapPresetEntriesIntoRegistry(loadProviderRegistry());
  saveProviderRegistry(next);
}

/** 仅返回深度思考内置条目的 id/label（兼容旧调用方） */
export function getBootstrapStudioDefaultPresetMeta(): { id: string; label: string } | null {
  const m = getBootstrapStudioDefaultPresetsMeta();
  return m?.thinking ?? null;
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
  let registry = syncBootstrapPresetEntriesIntoRegistry(loadProviderRegistry());
  saveProviderRegistry(registry);
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
  registry = loadProviderRegistry();
  const quickId = bootstrap.quickActiveId?.trim();
  if (quickId && registry.entries.some((e) => e.id === quickId)) {
    switchQuickActiveProviderConfig(quickId);
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
