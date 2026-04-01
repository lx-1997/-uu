/**
 * 上下文「窗口经济学」— 对齐 claude-code autoCompact.ts
 *
 * - 有效窗口 = 模型上下文窗 − min(max_output, 摘要输出上限)，避免把「留给模型输出」的额度算进可用历史
 * - 自动压缩触发线 = 有效窗口 − buffer（默认 13k），在「满之前」主动压历史
 */

/** 摘要/compact 调用预留输出上限（与 claude-code MAX_OUTPUT_TOKENS_FOR_SUMMARY 同量级） */
export const SUMMARY_OUTPUT_CAP_TOKENS = 20_000;

/** autocompact 缓冲带（claude-code AUTOCOMPACT_BUFFER_TOKENS = 13_000） */
export const AUTOCOMPACT_BUFFER_TOKENS = 13_000;

/** 预警带：距触发线再往前 20k（对齐 WARNING_THRESHOLD_BUFFER 思路，用于 UI/日志） */
export const WARNING_BAND_TOKENS = 20_000;

const MIN_EFFECTIVE_WINDOW = 4_000;

/**
 * 有效上下文 token 上限（历史+系统估算应控制在此以内，再留输出位）
 */
export function getEffectiveContextWindowTokens(
  contextWindowTokens: number,
  maxOutputTokens: number,
): number {
  const reserved = Math.min(Math.max(0, maxOutputTokens), SUMMARY_OUTPUT_CAP_TOKENS);
  return Math.max(MIN_EFFECTIVE_WINDOW, contextWindowTokens - reserved);
}

/**
 * 达到此估算 token 即应触发「主动压缩」判断（在 API 报 context overflow 之前）
 */
export function getProactiveCompactThreshold(effectiveContextWindowTokens: number): number {
  return Math.max(
    MIN_EFFECTIVE_WINDOW,
    effectiveContextWindowTokens - AUTOCOMPACT_BUFFER_TOKENS,
  );
}

/**
 * 预警阈值（仍低于 proactive 触发线）：用于遥测/后续 UI
 */
export function getContextWarningThreshold(effectiveContextWindowTokens: number): number {
  return Math.max(
    0,
    getProactiveCompactThreshold(effectiveContextWindowTokens) - WARNING_BAND_TOKENS,
  );
}

export function shouldProactiveCompactByWindowEconomics(params: {
  estimatedPromptTokens: number;
  effectiveContextWindowTokens: number;
}): boolean {
  return params.estimatedPromptTokens >= getProactiveCompactThreshold(params.effectiveContextWindowTokens);
}
