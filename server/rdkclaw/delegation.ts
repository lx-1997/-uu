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

function isDeveloperDocsTask(message: string): boolean {
  const text = String(message || "").toLowerCase();
  if (!text) return false;
  const docsIntent = /(开发者文档|官方文档|api\s*文档|接口文档|参考文档|rdk_doc|developer\.d-robotics|docs?|documentation|api reference|readme|教程|示例文档)/i.test(text);
  const boardExecutionIntent = /(在板端执行|板端运行|上板|部署到板|委派|openclaw|board_openclaw|device_exec|ssh|launch|启动服务|安装依赖|跑demo|运行命令)/i.test(text);
  return docsIntent && !boardExecutionIntent;
}

export function resolveDelegationModeText(decision: DelegateDecision) {
  if (decision.path === "board_primary") return "板端主执行（本地兜底）";
  if (decision.path === "collaborative") return "本地 + 板端协同";
  return "本地独立完成";
}

export function resolveDelegationExpectationText(decision: DelegateDecision) {
  if (decision.path === "board_primary") return "先由 RDKClaw 做本地速度/复杂度评估；仅在板端明显更优或强依赖板端技能时再委派";
  if (decision.path === "collaborative") return "本地负责编排，涉及板端能力时并行调用 OpenClaw";
  return "由 RDKClaw 本地工具链直接完成，不依赖板端委派";
}

/**
 * 注入 system 动态段：让模型每轮看到「本轮编排期望」，避免只跑 SSH 而忽略板端 OpenClaw。
 */
export function buildDelegationRuntimePrompt(decision: DelegateDecision, boardSkillCount: number): string {
  const mode = resolveDelegationModeText(decision);
  const exp = resolveDelegationExpectationText(decision);
  const forcedBoardByUser = decision.source === "user_mode" && decision.path === "board_primary";
  const skillHint =
    boardSkillCount > 0
      ? `板端已登记 **${boardSkillCount}** 个技能：先做 RDKClaw 快速自评（本地是否 1-2 步可收敛、是否已确认命令可直跑）。仅当存在板端技能依赖、板端会话延续价值，或本地预计会进入多轮试错，再走 **assess→delegate**。`
      : "板端技能快照为空或未定：可先 SSH 探底或 \`find_skills\`，再评估是否需 OpenClaw。";

  const ocLine = decision.needsBoardCollaboration
    ? forcedBoardByUser
      ? [
          "**板端 OpenClaw 参与**：用户已明确选择板端优先，本回合应以板端为主执行；必要时本地仅做补充验证。",
          "若走 delegate，仍需先 assess 并在 guidance 中写清验收标准与关键上下文。",
          skillHint,
        ].join("\n")
      : [
          "**板端 OpenClaw 参与**：本回合允许协同，但**assess 通过不等于必须 delegate**。先由 RDKClaw 判断本地是否更快完成（例如已确认命令、1-2 步可闭环）；仅在板端明显更优时再 delegate。",
          "若走 delegate：guidance 必须给出上下文包（用户目标、已执行命令与结果、失败模式、验收标准、限制条件），避免板端重复探测。",
          skillHint,
        ].join("\n")
    : "**板端 OpenClaw 参与**：本回合以 SSH/本地工具为主；若任务明显需要板端多步或技能，仍应主动 assess，勿机械回避。";

  return [
    "## 本轮编排期望（系统自动计算 · 须对齐）",
    `- **模式**：${mode}`,
    `- **期望**：${exp}`,
    `- **来源**：${decision.source}（置信度 ${decision.confidence.toFixed(2)}）`,
    ocLine,
    `- **策略说明**：${decision.reason}`,
  ].join("\n");
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

  if (isDeveloperDocsTask(req.message)) {
    return {
      path: "local_only",
      canLocalComplete: true,
      needsBoardCollaboration: false,
      source: "task_analysis",
      reason: "任务以开发者文档/API 资料梳理为主，优先由 RDKClaw 本地检索与归纳更快",
      confidence: 0.9,
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
    /** Studio 优先 ≠ 禁用 OpenClaw：板端有技能时仍标为可协同，避免模型与元数据「完全不需要板端」 */
    if (hasBoardSkills) {
      return {
        path: "collaborative",
        canLocalComplete: true,
        needsBoardCollaboration: true,
        source: "persona",
        reason:
          "委派倾向为 Studio 优先：单条/原子操作用 device_*；多步、技能链、或预计需多轮试错的板端任务应 assess→delegate，由板端 OpenClaw 迭代，避免主会话被长串 shell 淹没",
        confidence: 0.88,
      };
    }
    return {
      path: "local_only",
      canLocalComplete: true,
      needsBoardCollaboration: false,
      source: "persona",
      reason:
        "委派倾向为 Studio 优先且板端暂无已登记技能：默认 SSH/本地完成；装技能后或任务明显需板端 Agent 时再 assess",
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
