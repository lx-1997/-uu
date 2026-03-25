/**
 * 模型能力注册表
 *
 * 维护已知模型的上下文窗口和最大输出 token 数。
 * 解决 provider-setup.ts 中硬编码 contextWindow / maxTokens 导致
 * 输出被意外截断的问题。
 *
 * 查找优先级:
 * 0. 用户自定义覆盖（~/.rdkstudio/agent-config.json → modelOverrides）
 * 1. 精确匹配注册表
 * 2. 前缀匹配注册表
 * 3. 模型名启发式提取（如 "-128k"、"-long"）
 * 4. Provider 默认值
 * 5. /models API 动态发现（异步预热）
 * 6. 保守兜底 (128K context / 8K output)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface ModelCapabilities {
  contextWindow: number;
  maxOutputTokens: number;
}

// ─── 用户自定义覆盖（从配置文件加载） ───

const USER_OVERRIDES: Record<string, ModelCapabilities> = {};
let _userOverridesLoaded = false;

function loadUserModelOverrides(): void {
  if (_userOverridesLoaded) return;
  _userOverridesLoaded = true;
  try {
    const configPath = path.join(os.homedir(), '.rdkstudio', 'agent-config.json');
    if (!fs.existsSync(configPath)) return;
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const overrides = raw?.modelOverrides;
    if (!overrides || typeof overrides !== 'object') return;
    for (const [model, caps] of Object.entries(overrides)) {
      const c = caps as Partial<ModelCapabilities>;
      if (typeof c.contextWindow === 'number' || typeof c.maxOutputTokens === 'number') {
        USER_OVERRIDES[model] = {
          contextWindow: c.contextWindow ?? FALLBACK_CAPABILITIES.contextWindow,
          maxOutputTokens: c.maxOutputTokens ?? FALLBACK_CAPABILITIES.maxOutputTokens,
        };
      }
    }
  } catch {
    // 配置解析失败，静默跳过
  }
}

// ─── 已知模型精确注册表 ───

const MODEL_CAPABILITIES: Record<string, ModelCapabilities> = {
  // Qwen (通义千问)
  'qwen3.5-plus': { contextWindow: 131072, maxOutputTokens: 16384 },
  'qwen3-235b-a22b': { contextWindow: 131072, maxOutputTokens: 16384 },
  'qwen-max': { contextWindow: 131072, maxOutputTokens: 16384 },
  'qwen-max-latest': { contextWindow: 1048576, maxOutputTokens: 16384 },
  'qwen-plus': { contextWindow: 131072, maxOutputTokens: 16384 },
  'qwen-plus-latest': { contextWindow: 131072, maxOutputTokens: 16384 },
  'qwen-turbo': { contextWindow: 131072, maxOutputTokens: 8192 },
  'qwen-turbo-latest': { contextWindow: 131072, maxOutputTokens: 8192 },
  'qwen-long': { contextWindow: 1000000, maxOutputTokens: 6000 },
  'qwen2.5-72b-instruct': { contextWindow: 131072, maxOutputTokens: 8192 },
  'qwen2.5-32b-instruct': { contextWindow: 131072, maxOutputTokens: 8192 },
  'qwen2.5-14b-instruct': { contextWindow: 131072, maxOutputTokens: 8192 },
  'qwen2.5-7b-instruct': { contextWindow: 131072, maxOutputTokens: 8192 },
  'qwen2.5-coder-32b-instruct': { contextWindow: 131072, maxOutputTokens: 8192 },

  // DeepSeek
  'deepseek-chat': { contextWindow: 65536, maxOutputTokens: 8192 },
  'deepseek-reasoner': { contextWindow: 65536, maxOutputTokens: 16384 },

  // OpenAI
  'gpt-4o': { contextWindow: 128000, maxOutputTokens: 16384 },
  'gpt-4o-mini': { contextWindow: 128000, maxOutputTokens: 16384 },
  'gpt-4.1': { contextWindow: 1047576, maxOutputTokens: 32768 },
  'gpt-4.1-mini': { contextWindow: 1047576, maxOutputTokens: 32768 },
  'gpt-4.1-nano': { contextWindow: 1047576, maxOutputTokens: 32768 },
  'o1': { contextWindow: 200000, maxOutputTokens: 100000 },
  'o1-mini': { contextWindow: 128000, maxOutputTokens: 65536 },
  'o3': { contextWindow: 200000, maxOutputTokens: 100000 },
  'o3-mini': { contextWindow: 200000, maxOutputTokens: 100000 },
  'o4-mini': { contextWindow: 200000, maxOutputTokens: 100000 },

  // Anthropic
  'claude-sonnet-4-20250514': { contextWindow: 200000, maxOutputTokens: 16384 },
  'claude-3-7-sonnet-20250219': { contextWindow: 200000, maxOutputTokens: 16384 },
  'claude-3-5-sonnet-20241022': { contextWindow: 200000, maxOutputTokens: 8192 },
  'claude-3-5-haiku-20241022': { contextWindow: 200000, maxOutputTokens: 8192 },
  'claude-3-opus-20240229': { contextWindow: 200000, maxOutputTokens: 4096 },

  // Doubao (豆包)
  'doubao-1.5-pro-256k': { contextWindow: 256000, maxOutputTokens: 16384 },
  'doubao-1.5-pro-32k': { contextWindow: 32768, maxOutputTokens: 16384 },
  'doubao-pro-256k': { contextWindow: 256000, maxOutputTokens: 4096 },
  'doubao-pro-128k': { contextWindow: 128000, maxOutputTokens: 4096 },
  'doubao-pro-32k': { contextWindow: 32768, maxOutputTokens: 4096 },
  'doubao-lite-128k': { contextWindow: 128000, maxOutputTokens: 4096 },

  // Gemini
  'gemini-2.5-flash': { contextWindow: 1048576, maxOutputTokens: 65536 },
  'gemini-2.5-pro': { contextWindow: 1048576, maxOutputTokens: 65536 },
  'gemini-2.0-flash': { contextWindow: 1048576, maxOutputTokens: 8192 },
  'gemini-1.5-pro': { contextWindow: 2097152, maxOutputTokens: 8192 },
  'gemini-1.5-flash': { contextWindow: 1048576, maxOutputTokens: 8192 },

  // Moonshot (月之暗面)
  'moonshot-v1-8k': { contextWindow: 8000, maxOutputTokens: 4096 },
  'moonshot-v1-32k': { contextWindow: 32000, maxOutputTokens: 4096 },
  'moonshot-v1-128k': { contextWindow: 128000, maxOutputTokens: 4096 },

  // StepFun (阶跃星辰)
  'step-2-16k': { contextWindow: 16000, maxOutputTokens: 4096 },
  'step-1-256k': { contextWindow: 256000, maxOutputTokens: 8192 },

  // GLM (智谱)
  'glm-4': { contextWindow: 128000, maxOutputTokens: 4096 },
  'glm-4-plus': { contextWindow: 128000, maxOutputTokens: 4096 },
  'glm-4-flash': { contextWindow: 128000, maxOutputTokens: 4096 },
  'glm-4-long': { contextWindow: 1000000, maxOutputTokens: 4096 },

  // MiniMax
  'MiniMax-Text-01': { contextWindow: 1000000, maxOutputTokens: 16384 },

  // Yi (零一万物)
  'yi-lightning': { contextWindow: 16384, maxOutputTokens: 4096 },
  'yi-large': { contextWindow: 32768, maxOutputTokens: 4096 },

  // Baichuan (百川)
  'Baichuan4-Air': { contextWindow: 32000, maxOutputTokens: 4096 },
  'Baichuan4': { contextWindow: 32000, maxOutputTokens: 4096 },

  // SiliconFlow
  'deepseek-ai/DeepSeek-V3': { contextWindow: 65536, maxOutputTokens: 8192 },
  'Qwen/Qwen2.5-72B-Instruct': { contextWindow: 131072, maxOutputTokens: 8192 },

  // Groq
  'llama-3.3-70b-versatile': { contextWindow: 128000, maxOutputTokens: 32768 },
  'llama-3.1-8b-instant': { contextWindow: 131072, maxOutputTokens: 8192 },
  'mixtral-8x7b-32768': { contextWindow: 32768, maxOutputTokens: 4096 },

  // OpenRouter
  'openai/gpt-4o-mini': { contextWindow: 128000, maxOutputTokens: 16384 },

  // xAI
  'grok-2-latest': { contextWindow: 131072, maxOutputTokens: 8192 },
  'grok-3': { contextWindow: 131072, maxOutputTokens: 16384 },

  // Ollama 常用本地模型
  'qwen2.5:7b': { contextWindow: 32768, maxOutputTokens: 8192 },
  'qwen2.5:14b': { contextWindow: 32768, maxOutputTokens: 8192 },
  'qwen2.5:32b': { contextWindow: 32768, maxOutputTokens: 8192 },
  'llama3:8b': { contextWindow: 8192, maxOutputTokens: 4096 },
  'llama3.1:8b': { contextWindow: 131072, maxOutputTokens: 4096 },
  'deepseek-coder-v2:16b': { contextWindow: 65536, maxOutputTokens: 8192 },
};

// ─── Provider 级别默认值 ───

const PROVIDER_DEFAULTS: Record<string, ModelCapabilities> = {
  anthropic: { contextWindow: 200000, maxOutputTokens: 8192 },
  openai: { contextWindow: 128000, maxOutputTokens: 16384 },
  qwen: { contextWindow: 131072, maxOutputTokens: 16384 },
  deepseek: { contextWindow: 65536, maxOutputTokens: 8192 },
  doubao: { contextWindow: 256000, maxOutputTokens: 16384 },
  gemini: { contextWindow: 1048576, maxOutputTokens: 65536 },
  groq: { contextWindow: 128000, maxOutputTokens: 32768 },
  openrouter: { contextWindow: 128000, maxOutputTokens: 16384 },
  xai: { contextWindow: 131072, maxOutputTokens: 8192 },
  minimax: { contextWindow: 1000000, maxOutputTokens: 16384 },
  siliconflow: { contextWindow: 65536, maxOutputTokens: 8192 },
  moonshot: { contextWindow: 128000, maxOutputTokens: 4096 },
  zhipu: { contextWindow: 128000, maxOutputTokens: 4096 },
  stepfun: { contextWindow: 16000, maxOutputTokens: 4096 },
  yi: { contextWindow: 16384, maxOutputTokens: 4096 },
  baichuan: { contextWindow: 32000, maxOutputTokens: 4096 },
  ollama: { contextWindow: 32768, maxOutputTokens: 8192 },
  'openai-compatible': { contextWindow: 128000, maxOutputTokens: 8192 },
  'anthropic-compatible': { contextWindow: 200000, maxOutputTokens: 8192 },
};

const FALLBACK_CAPABILITIES: ModelCapabilities = {
  contextWindow: 128000,
  maxOutputTokens: 8192,
};

/**
 * 从模型名中提取上下文窗口大小的启发式规则
 *
 * 很多模型名自带上下文大小标识（如 "qwen-long", "doubao-pro-256k", "moonshot-v1-128k"）
 */
function inferContextWindowFromName(model: string): number | null {
  const lower = model.toLowerCase();
  const match = lower.match(/[-_](\d+)[km](?:[-_]|$)/);
  if (match) {
    const num = parseInt(match[1], 10);
    const unit = lower[match.index! + match[0].length - 1];
    if (unit === 'k') return num * 1024;
    if (unit === 'm') return num * 1024 * 1024;
  }
  const directMatch = lower.match(/(\d{3,})k/);
  if (directMatch) {
    return parseInt(directMatch[1], 10) * 1024;
  }
  if (lower.includes('-long') || lower.includes('_long')) return 1000000;
  return null;
}

/**
 * 查找模型能力参数
 *
 * 优先级:
 * 1. 精确匹配注册表
 * 2. 前缀匹配注册表
 * 3. 模型名启发式提取（如 "-128k"、"-long"）
 * 4. Provider 默认值
 * 5. 保守兜底 (128K context / 8K output)
 */
export function lookupModelCapabilities(
  provider: string,
  model: string,
): ModelCapabilities {
  loadUserModelOverrides();

  const userOverride = USER_OVERRIDES[model];
  if (userOverride) return userOverride;

  const exact = MODEL_CAPABILITIES[model];
  if (exact) return exact;

  for (const [key, caps] of Object.entries(MODEL_CAPABILITIES)) {
    if (model.startsWith(key)) return caps;
  }

  const inferred = inferContextWindowFromName(model);
  if (inferred) {
    const providerBase = PROVIDER_DEFAULTS[provider] ?? FALLBACK_CAPABILITIES;
    return {
      contextWindow: inferred,
      maxOutputTokens: providerBase.maxOutputTokens,
    };
  }

  const providerDefault = PROVIDER_DEFAULTS[provider];
  if (providerDefault) return providerDefault;

  return FALLBACK_CAPABILITIES;
}

/**
 * 运行时注册/更新模型能力（供 API 动态发现后写入）
 */
export function registerModelCapabilities(
  model: string,
  caps: ModelCapabilities,
): void {
  MODEL_CAPABILITIES[model] = caps;
}

interface RawModelEntry {
  id?: string;
  [key: string]: unknown;
}

function extractCapabilitiesFromRaw(raw: RawModelEntry): ModelCapabilities | null {
  const contextFields = [
    'context_length', 'context_window', 'contextLength', 'contextWindow',
    'max_context_length', 'max_model_len', 'model_max_length',
  ];
  const outputFields = [
    'max_output_tokens', 'max_completion_tokens', 'maxOutputTokens',
    'max_tokens', 'maxTokens',
  ];
  let contextWindow: number | null = null;
  let maxOutput: number | null = null;

  for (const field of contextFields) {
    const val = Number(raw[field]);
    if (val > 0 && Number.isFinite(val)) { contextWindow = val; break; }
  }
  for (const field of outputFields) {
    const val = Number(raw[field]);
    if (val > 0 && Number.isFinite(val)) { maxOutput = val; break; }
  }

  if (!contextWindow && !maxOutput) return null;
  return {
    contextWindow: contextWindow || FALLBACK_CAPABILITIES.contextWindow,
    maxOutputTokens: maxOutput || FALLBACK_CAPABILITIES.maxOutputTokens,
  };
}

/**
 * 尝试通过 Provider 的 /models 端点获取模型能力
 *
 * 各 Provider 的 models 响应格式不同，此函数尽力提取上下文窗口。
 * 匹配顺序：精确 ID → 尾部匹配 → 包含匹配。
 * 失败时静默返回 null，不影响主流程。
 */
export async function fetchModelCapabilitiesFromProvider(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
}): Promise<ModelCapabilities | null> {
  try {
    const url = `${params.baseUrl.replace(/\/+$/, '')}/models`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const body = (await res.json()) as { data?: RawModelEntry[] };
    const models = body?.data;
    if (!Array.isArray(models)) return null;

    const target = params.model.toLowerCase();
    const exact = models.find((m) => m.id === params.model);
    if (exact) return extractCapabilitiesFromRaw(exact);

    const tailMatch = models.find(
      (m) => typeof m.id === 'string' && m.id.toLowerCase().endsWith(`/${target}`),
    );
    if (tailMatch) return extractCapabilitiesFromRaw(tailMatch);

    const containsMatch = models.find(
      (m) => typeof m.id === 'string' && m.id.toLowerCase().includes(target),
    );
    if (containsMatch) return extractCapabilitiesFromRaw(containsMatch);

    return null;
  } catch {
    return null;
  }
}
