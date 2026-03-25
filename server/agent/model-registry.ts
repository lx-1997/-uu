/**
 * 模型能力注册表
 *
 * 维护已知模型的上下文窗口和最大输出 token 数。
 * 解决 provider-setup.ts 中硬编码 contextWindow / maxTokens 导致
 * 输出被意外截断的问题。
 *
 * 策略:
 * 1. 精确匹配模型 ID → 2. 前缀匹配 → 3. Provider 默认值 → 4. 保守兜底
 */

export interface ModelCapabilities {
  contextWindow: number;
  maxOutputTokens: number;
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
 * 查找模型能力参数
 *
 * 优先级: 精确匹配 → 前缀匹配 → Provider 默认 → 保守兜底
 */
export function lookupModelCapabilities(
  provider: string,
  model: string,
): ModelCapabilities {
  const exact = MODEL_CAPABILITIES[model];
  if (exact) return exact;

  for (const [key, caps] of Object.entries(MODEL_CAPABILITIES)) {
    if (model.startsWith(key)) return caps;
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

/**
 * 尝试通过 Provider 的 /models 端点获取模型能力
 *
 * 各 Provider 的 models 响应格式不同，此函数尽力提取 context_length。
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

    const body = (await res.json()) as {
      data?: Array<{
        id?: string;
        context_length?: number;
        context_window?: number;
        max_tokens?: number;
        max_output_tokens?: number;
      }>;
    };

    const models = body?.data;
    if (!Array.isArray(models)) return null;

    const match = models.find(
      (m) => m.id === params.model || m.id?.endsWith(`/${params.model}`),
    );
    if (!match) return null;

    const contextWindow = match.context_length || match.context_window;
    const maxOutput = match.max_output_tokens || match.max_tokens;

    if (!contextWindow && !maxOutput) return null;

    return {
      contextWindow: contextWindow || FALLBACK_CAPABILITIES.contextWindow,
      maxOutputTokens: maxOutput || FALLBACK_CAPABILITIES.maxOutputTokens,
    };
  } catch {
    return null;
  }
}
