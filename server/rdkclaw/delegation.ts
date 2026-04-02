import type { PersonaProfile, RDKClawChatRequest, RDKClawSkillMeta } from "./types.js";
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
  if (decision.path === "board_primary") return "板端主执行（本地兜底）";
  if (decision.path === "collaborative") return "本地 + 板端协同";
  return "本地独立完成";
}

export function resolveDelegationExpectationText(decision: DelegateDecision) {
  if (decision.path === "board_primary") return "先板端评估与委派，若失败再本地兜底补完";
  if (decision.path === "collaborative") return "本地负责编排，涉及板端能力时并行调用 OpenClaw";
  return "由 RDKClaw 本地工具链直接完成，不依赖板端委派";
}

export function selectDelegateDecision(
  req: RDKClawChatRequest,
  matchedSkills: RDKClawSkillMeta[],
  boardSnapshot: BoardSnapshot,
  delegationBias: PersonaProfile["delegationBias"] = "balanced",
): DelegateDecision {
  if (!req.deviceId) {
    return {
      path: "local_only",
      canLocalComplete: true,
      needsBoardCollaboration: false,
      source: "default",
      reason: "未绑定设备上下文，任务按本地链路执行",
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
  if (req.mode === "board-preferred") {
    return {
      path: "collaborative",
      canLocalComplete: true,
      needsBoardCollaboration: true,
      source: "user_mode",
      reason: "用户要求优先尝试板端协同",
      confidence: 0.85,
    };
  }

  const requiresBoardSkill = matchedSkills.find((s) => s.runtimePolicy?.requiresBoard);
  if (requiresBoardSkill) {
    return {
      path: "board_primary",
      canLocalComplete: false,
      needsBoardCollaboration: true,
      source: "skill_policy",
      reason: `Skill(${requiresBoardSkill.name}) 要求板端执行`,
      confidence: 0.95,
    };
  }

  const hasBoardSkills = boardSnapshot.skills.length > 0;

  if (delegationBias === "local-first") {
    return {
      path: "local_only",
      canLocalComplete: true,
      needsBoardCollaboration: false,
      source: "persona",
      reason: hasBoardSkills
        ? `委派倾向为 Studio 优先：默认用 device_* / 本地工具链；仅在技能强制、用户指定 board 模式或本地多次失败且确需板端技能链时再使用 OpenClaw（assess/delegate）`
        : "委派倾向为 Studio 优先：默认本地与 SSH 工具链完成；确需板端 OpenClaw 时再评估",
      confidence: 0.88,
    };
  }

  if (delegationBias === "board-first" && hasBoardSkills) {
    return {
      path: "board_primary",
      canLocalComplete: false,
      needsBoardCollaboration: true,
      source: "persona",
      reason: `委派倾向为板端优先且板端已有技能：复杂板端任务优先走 OpenClaw（assess→delegate），本地作兜底`,
      confidence: 0.82,
    };
  }

  return {
    path: "collaborative",
    canLocalComplete: true,
    needsBoardCollaboration: true,
    source: "default",
    reason: hasBoardSkills
      ? `设备已连接，板端有 ${boardSnapshot.skills.length} 个技能可用，Agent 根据能力分布自主决策`
      : "设备已连接但板端无已安装技能，Agent 自主决策执行路径",
    confidence: hasBoardSkills ? 0.85 : 0.75,
  };
}
