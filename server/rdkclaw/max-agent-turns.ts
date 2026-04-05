/**
 * 单条用户消息触发的 Agent 内层推理轮次上限（每次「模型调用」计 1 轮，常含多工具）。
 *
 * 与常见长程 agent 产品一致：默认给足步数，靠环境变量与硬封顶防止失控计费；
 * 真正超长任务仍应依赖会话内上下文压缩、拆多轮对话与子任务（本仓库 agent-loop 已有压缩链）。
 */
export const RDKCLAW_DEFAULT_MAX_AGENT_TURNS = 64;

/** 环境变量 RDKCLAW_MAX_AGENT_TURNS 允许的最大值（防抖） */
export const RDKCLAW_MAX_AGENT_TURNS_HARD_CAP = 256;

export function resolveRdkclawMaxAgentTurns(): number {
  const raw = process.env.RDKCLAW_MAX_AGENT_TURNS;
  if (raw) {
    const n = Number.parseInt(String(raw).trim(), 10);
    if (Number.isFinite(n) && n > 0) return Math.min(RDKCLAW_MAX_AGENT_TURNS_HARD_CAP, n);
  }
  return RDKCLAW_DEFAULT_MAX_AGENT_TURNS;
}

/**
 * 已达 maxTurns 后，若末尾仍有 tool_result 待模型消化，允许额外 LLM 次数上限。
 * 随 maxTurns 放大，避免长排查链在触顶后仍被「工具收尾 cap」截断；整体再封顶防止极端循环。
 */
export function resolveToolFollowupBypassCap(maxTurns: number): number {
  const scaled = maxTurns + Math.floor(maxTurns / 2) + 32;
  return Math.min(192, scaled);
}
