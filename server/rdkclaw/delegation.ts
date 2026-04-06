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
  const boardExecutionIntent = /(在套件端执行|套件端运行|上板|部署到板|委派|openclaw|board_openclaw|device_exec|ssh|launch|启动服务|安装依赖|跑demo|运行命令)/i.test(text);
  return docsIntent && !boardExecutionIntent;
}

function isRoboticsExecutionTask(message: string): boolean {
  const text = String(message || "").trim();
  if (!text) return false;
  return /(ros2|tros|launch|topic|node|rviz|slam|nav2|moveit|camera|相机|检测|识别|部署|上板|板端|device_exec|ssh|openclaw|编译|colcon|模型|推理|机器人|机械臂|巡线|避障)/i.test(text);
}

function isBoardConsultativeTask(message: string): boolean {
  const text = String(message || "").trim();
  if (!text) return false;
  return /(方案|思路|架构|可行性|评估|trade[- ]?off|讨论|对齐|review|审查|先聊|先评估|assess|咨询|建议|排障思路|板端资源|网关状态|技能清单|运行态|现场状态)/i.test(text);
}

function isLongRunningBoardTask(message: string): boolean {
  const text = String(message || "").trim();
  if (!text) return false;
  return /(长程|长期|持续|后台常驻|7x24|守护|watchdog|daemon|service|systemd|持续推理|持续采集|长时间监控|巡检|压测|soak|burn[- ]?in|连续运行|闭环运行)/i.test(text);
}

export function resolveDelegationModeText(decision: DelegateDecision) {
  if (decision.path === "board_primary") return "套件端主执行（本地兜底）";
  if (decision.path === "collaborative") return "本地 + 套件端协同";
  return "本地独立完成";
}

export function resolveDelegationExpectationText(decision: DelegateDecision) {
  if (decision.path === "board_primary")
    return "双伙伴共探：RDKClaw 与套件端 OpenClaw **一起摸路**，谁在当前约束下更快收敛谁牵头；不是「一方专职规划、一方专职执行」";
  if (decision.path === "collaborative")
    return "共同探索同一目标：联网/文档/SSH 与套件端会话并行试探，按速度与成功率动态换道，而非固定主从分工";
  return "本轮以 RDKClaw 本地工具链为主；若后续出现多步套件端或技能依赖，再与 OpenClaw 并线";
}

/**
 * 注入 system 动态段：让模型每轮看到「本轮编排期望」，避免只跑 SSH 而忽略套件端 OpenClaw。
 */
export function buildDelegationRuntimePrompt(decision: DelegateDecision, boardSkillCount: number): string {
  const mode = resolveDelegationModeText(decision);
  const exp = resolveDelegationExpectationText(decision);
  const forcedBoardByUser = decision.source === "user_mode" && decision.path === "board_primary";
  const skillHint =
    boardSkillCount > 0
      ? `套件端已登记 **${boardSkillCount}** 个技能：与 OpenClaw **对齐谁更适合先动手**（你已确认的可直跑命令 vs 套件端技能链/多轮试错）。**assess→delegate** 是共探里的「换道」手段，不是「Studio 下工单、套件端照单演」。`
      : "套件端技能快照为空或未定：可先 SSH 探底或 \`find_skills\`，再与 OpenClaw 并线评估。";

  const ocLine = decision.needsBoardCollaboration
    ? forcedBoardByUser
      ? [
          "**套件端 OpenClaw 参与**：用户已明确选择套件端优先，本回合应以套件端为主执行；必要时本地仅做补充验证。",
          "若走 delegate，仍需先 assess 并在 guidance 中写清验收标准与关键上下文。",
          skillHint,
        ].join("\n")
      : [
          "**套件端 OpenClaw 参与**：本回合是**双伙伴共探**。**assess 通过不等于必须 delegate**——比较的是「谁更快把事办成」，不是谁有排程权。RDKClaw 已握有可直跑证据时可先 SSH；套件端在技能链/现场迭代上更快时再 delegate。",
          "若走 delegate：guidance 仍是**共享上下文包**（用户目标、已执行命令与结果、失败模式、验收标准、限制条件），方便双方对齐与换道，而非单方面派活。",
          skillHint,
        ].join("\n")
    : [
        "**套件端 OpenClaw 参与**：本回合为本地优先（RDKClaw 先自证可完成）。",
        "在未出现明确触发条件前（本地受阻/需板端技能链/用户明确要求）**不得**首轮调用 `board_openclaw_assess` 或 `board_openclaw_delegate`。",
        "若后续确需委派，必须先汇总已知上下文（目标、已执行命令与结果、失败模式、约束、验收标准）再进入 assess→delegate，并在 strict 门禁下通过 `board_openclaw_chat` 完成对齐放行。",
      ].join("\n");

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
      reason: "用户要求优先尝试套件端协同",
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
      reason: `Skill(${requiresBoardSkill.name}) 要求套件端执行`,
      confidence: 0.95,
    };
  }

  const hasBoardSkills = boardSnapshot.skills.length > 0;
  const consultative = isBoardConsultativeTask(req.message);
  const longRunning = isLongRunningBoardTask(req.message);
  const roboticsExecution = isRoboticsExecutionTask(req.message);

  if (delegationBias === "local-first") {
    if (consultative) {
      return {
        path: "collaborative",
        canLocalComplete: true,
        needsBoardCollaboration: true,
        source: "task_analysis",
        reason:
          "识别为方案探讨/评估类请求：RDKClaw 负责主编排，OpenClaw 作为板端协作伙伴提供现场信息与可行性判断，再决定是否执行",
        confidence: 0.9,
      };
    }

    if (longRunning) {
      return {
        path: "collaborative",
        canLocalComplete: true,
        needsBoardCollaboration: true,
        source: "task_analysis",
        reason:
          "识别为长程/持续运行任务：需板端会话保持与过程可见性，建议与 OpenClaw 协作以承接长时执行与状态回传",
        confidence: 0.9,
      };
    }

    if (hasBoardSkills && roboticsExecution) {
      return {
        path: "collaborative",
        canLocalComplete: true,
        needsBoardCollaboration: true,
        source: "task_analysis",
        reason:
          "识别为机器人执行任务且套件端已有可用技能：先由 RDKClaw 快速落地，遇到多步试错或技能链时及时并线 OpenClaw",
        confidence: 0.83,
      };
    }

    return {
      path: "local_only",
      canLocalComplete: true,
      needsBoardCollaboration: false,
      source: "persona",
      reason:
        "委派倾向为 Studio 优先：默认由 RDKClaw 本地/SSH 闭环执行；仅在方案探讨、板端资源协作、长程任务或明确技能链需求时再并线 OpenClaw",
      confidence: 0.9,
    };
  }

  if (delegationBias === "board-first" && hasBoardSkills) {
    return {
      path: "board_primary",
      canLocalComplete: false,
      needsBoardCollaboration: true,
      source: "persona",
      reason: `委派倾向为套件端优先且套件端已有技能：复杂套件端任务优先走 OpenClaw（assess→delegate），本地作兜底`,
      confidence: 0.82,
    };
  }

  if (consultative || longRunning || (hasBoardSkills && roboticsExecution)) {
    return {
      path: "collaborative",
      canLocalComplete: true,
      needsBoardCollaboration: true,
      source: "task_analysis",
      reason: consultative
        ? "识别为方案评估类请求：先由 RDKClaw 组织文档/上下文，再按需与 OpenClaw 协同"
        : longRunning
          ? "识别为长程任务：建议让套件端会话参与持续执行与状态回传"
          : "识别为机器人执行任务且套件端有技能：先本地快收敛，必要时并线 OpenClaw",
      confidence: consultative || longRunning ? 0.86 : 0.8,
    };
  }

  return {
    path: "local_only",
    canLocalComplete: true,
    needsBoardCollaboration: false,
    source: "default",
    reason: hasBoardSkills
      ? `默认先由 RDKClaw 本地/SSH 闭环，若出现多步试错或技能链需求再协同套件端（当前可用技能数：${boardSnapshot.skills.length}）`
      : "默认先由 RDKClaw 本地/SSH 闭环，暂无明确套件端协同触发条件",
    confidence: hasBoardSkills ? 0.82 : 0.88,
  };
}
