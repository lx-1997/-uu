import type { RDKClawChatRequest, RDKClawSkillMeta } from "./types.js";
import type { BoardSnapshot } from "./system-prompt-builder.js";

export interface DelegateDecision {
  path: "local_only" | "collaborative" | "board_primary";
  canLocalComplete: boolean;
  needsBoardCollaboration: boolean;
  source: "user_mode" | "skill_policy" | "task_analysis" | "default" | "persona";
  reason: string;
  confidence: number;
}

export function resolveDelegationModeText(decision: DelegateDecision) {
  if (decision.path === "board_primary") return "套件端主执行（本地兜底）";
  if (decision.path === "collaborative") return "RDKClaw 主导 + 套件端协同";
  return "本地独立完成";
}

export function resolveDelegationExpectationText(decision: DelegateDecision) {
  if (decision.path === "board_primary")
    return "RDKClaw（师傅）指导套件端 OpenClaw（徒弟）执行，持续教学与经验积累";
  if (decision.path === "collaborative")
    return "RDKClaw 主导决策，按需将子任务委派给套件端 OpenClaw 执行并教学";
  return "RDKClaw 本地完成；如遇多步板端任务可随时委派给 OpenClaw";
}

/**
 * 简化的委派决策：不再用启发式预判任务类型。
 * 仅保留用户显式模式和 skill 策略两种硬规则；
 * 其余一律返回 collaborative，由 LLM 自然选择工具（delegate / device_exec / chat）。
 */
export function selectDelegateDecision(
  req: RDKClawChatRequest,
  matchedSkills: RDKClawSkillMeta[],
  _boardSnapshot: BoardSnapshot,
): DelegateDecision {
  if (!req.deviceId) {
    return {
      path: "local_only",
      canLocalComplete: true,
      needsBoardCollaboration: false,
      source: "default",
      reason: "未绑定设备，本地链路执行",
      confidence: 0.95,
    };
  }

  if (req.mode === "board") {
    return {
      path: "board_primary",
      canLocalComplete: false,
      needsBoardCollaboration: true,
      source: "user_mode",
      reason: "用户指定 board 模式",
      confidence: 1,
    };
  }
  if (req.mode === "local") {
    return {
      path: "local_only",
      canLocalComplete: true,
      needsBoardCollaboration: false,
      source: "user_mode",
      reason: "用户指定 local 模式",
      confidence: 1,
    };
  }

  const requiresBoardSkill = matchedSkills.find((s) => s.runtimePolicy?.requiresBoard);
  if (requiresBoardSkill) {
    return {
      path: "board_primary",
      canLocalComplete: false,
      needsBoardCollaboration: true,
      source: "skill_policy",
      reason: `Skill(${requiresBoardSkill.name}) 要求套件端执行`,
      confidence: 0.95,
    };
  }

  // 设备已连接：一律 collaborative，让 LLM 自然决定用 delegate 还是 device_exec
  return {
    path: "collaborative",
    canLocalComplete: true,
    needsBoardCollaboration: true,
    source: "default",
    reason: "设备已连接，RDKClaw 主导决策并按需委派套件端 OpenClaw",
    confidence: 0.9,
  };
}

/**
 * 生成委派运行时提示段，注入 system prompt 让 LLM 了解当前委派模式。
 */
export function buildDelegationRuntimePrompt(
  decision: DelegateDecision,
  boardSkillCount: number,
): string {
  const modeLabel =
    decision.path === "board_primary"
      ? "套件端主执行"
      : decision.path === "collaborative"
        ? "本地 + 套件端协同"
        : "本地独立完成";
  const lines: string[] = [
    `## 委派运行模式（本轮实时）`,
    `- **模式**：${modeLabel}`,
    `- **判据**：${decision.reason}（置信度 ${decision.confidence}）`,
  ];
  if (decision.needsBoardCollaboration) {
    lines.push(
      `- **套件端技能数**：${boardSkillCount}`,
      `- **双伙伴共探**：RDKClaw（师傅）+ 套件端 OpenClaw（徒弟），assess→delegate→chat 循环`,
    );
  }
  return lines.join("\n");
}
