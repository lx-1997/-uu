import type { StudioUiHints } from "../../shared/types.js";
import type { PersonaProfile } from "./types.js";

export type ModelTier = 'large' | 'medium' | 'small';

export function classifyModelTier(contextWindow: number, maxOutputTokens: number): ModelTier {
  if (contextWindow >= 64_000 && maxOutputTokens >= 8_000) return 'large';
  if (contextWindow >= 16_000 && maxOutputTokens >= 2_000) return 'medium';
  return 'small';
}

export function buildPersonaPrompt(persona: PersonaProfile) {
  const lines = [
    `你是 ${persona.name}。`,
    `风险偏好: ${persona.riskLevel}，委派: ${persona.delegationBias}，自治: ${persona.autonomyLevel}。`,
  ];
  if (persona.extraInstructions?.trim()) {
    lines.push(`额外指令: ${persona.extraInstructions.trim()}`);
  }
  return lines.join("\n");
}

export interface BoardSkillDetail {
  name: string;
  path: string;
  description: string;
  trigger: string;
}

export interface BoardSnapshot {
  skills: string[];
  skillDetails: BoardSkillDetail[];
  plugins: string[];
}

function yn(v: boolean | undefined, yes: string, no: string) {
  if (v === true) return yes;
  if (v === false) return no;
  return "未知";
}

/**
 * 将 Studio 已展示的设备/OpenClaw 状态注入系统提示，避免「问一句状态」就重复 board_openclaw_health，
 * 并区分网关/AI 就绪/飞书插件等与联网检索失败之间的关系。
 */
export function buildStudioUiHintsPrompt(hints: StudioUiHints | undefined): string {
  if (!hints?.capturedAt || typeof hints.capturedAt !== "number") return "";
  const ageSec = Math.max(0, Math.round((Date.now() - hints.capturedAt) / 1000));
  const ageLabel = ageSec < 90 ? "约 1 分钟内" : `${Math.floor(ageSec / 60)} 分钟前`;

  const oc = hints.openclaw;
  const gw = hints.gateway;
  const lines: string[] = [
    "## Studio UI 已校验快照（优先采信）",
    `- 快照时间: ${ageLabel}（约 ${ageSec}s 前）`,
  ];

  if (oc) {
    lines.push(
      `- OpenClaw（health）: 已安装=${yn(oc.installed, "是", "否")} · 网关=${yn(oc.gatewayRunning, "运行中", "未运行")} · AI就绪=${yn(oc.aiReady, "是", "否")}${oc.version ? ` · 版本 ${oc.version}` : ""}`,
    );
  }
  if (gw && (gw.running !== undefined || gw.version)) {
    lines.push(
      `- 网关状态条: ${gw.running === undefined ? "未知" : gw.running ? "运行中" : "停止"}${gw.version ? ` · ${gw.version}` : ""}`,
    );
  }
  if (hints.feishuConnected !== undefined) {
    lines.push(
      `- 板端网关·飞书插件连接: ${hints.feishuConnected ? "已连接" : "未连接"}（指设备侧插件；与 Studio 设置里的飞书机器人通道不是同一概念）`,
    );
  }

  lines.push(
    "",
    "**约束**",
    "- 若用户仅询问「设备 / 板端兄弟 / OpenClaw 是否正常」类问题：优先用本段快照直接回答，**不要**再调用 `board_openclaw_health`，除非用户明确要求体检、排障或你刚完成安装/重启需验收。",
    "- 若本轮 `web_search` / 联网工具失败：不要为此去「补」一轮 `board_openclaw_health`；网络问题与板端 OpenClaw 进程是否启动是不同层面；可说明联网失败，并继续用本地工具或 RDKClaw 兜底。",
    "- 若快照显示网关运行中但 `AI就绪=否`：可说明板端网关已起但板端模型链路未就绪，需要推理或编排的任务优先由 **RDKClaw 本地**完成；仍可通过 SSH 做 `device_exec` 等。",
    "- 若板端或工具返回 `missing scope`、`operator.read` 等：属于 **Studio↔板端 Gateway 的鉴权/令牌权限**，不要笼统说成「网关坏了」或「网关没开」；若本段快照已写「网关=运行中」，你的解释必须与之一致。",
    "- 若需委派板端 OpenClaw 执行多步任务且快照与实际情况可能不一致时，再考虑 `board_openclaw_assess`，而不是例行 health。",
  );

  return lines.join("\n");
}

export function buildCollaborationPrompt(
  boardSnapshot: BoardSnapshot,
  tier: ModelTier,
): string {
  if (tier === 'small') {
    return [
      "## 协作（简版）",
      "你=主脑，板端 OpenClaw=执行者。",
      "- chat: 交流 | assess: 评估 | delegate: 委派",
      "先做能做的；需板端时先 assess 再 delegate。",
      boardSnapshot.skillDetails.length > 0
        ? `板端技能(${boardSnapshot.skillDetails.length}个): ${boardSnapshot.skillDetails.map((s) => s.name).join(', ')}`
        : "板端技能快照为空，需先生成技能再委派。",
      "常用: WiFi→nmcli | 摄像头→ls /dev/video* | 版本→rdkos_info | 进程→pkill -f | 温度→thermal_zone0",
    ].join("\n");
  }
  return [
    "## 双 Agent 协作",
    "你=RDKClaw（主脑），板端 OpenClaw=外脑。你先分析、能做就做；需板端能力时用三种工具协作：",
    "- **chat** (board_openclaw_chat)：轻量交流——了解能力、讨论方案、分享信息",
    "- **assess** (board_openclaw_assess)：评估——让 OpenClaw 判断某任务能否处理",
    "- **delegate** (board_openclaw_delegate)：委派——确认可行后交付执行，guidance 中注入你的知识",
    "三者共享会话，不必重复背景。委派后评估结果质量，失败时本地兜底。",
    "OpenClaw 擅长：板端多步操作、技能链、应用部署。不擅长：联网搜索、文档分析（你的专属能力）。",
    "若 OpenClaw 回复含 [NEED_RDKCLAW] 块：界面会单独展示「OpenClaw→RDKClaw」求助卡；你应提取 type/query/reason。type=web_search/documentation 等以检索为主；**type=advisory** 时板端需要你的**建议与取舍**（可辅以检索），在 chat 回传中写清推荐顺序与理由。再 board_openclaw_chat 发回板端。最多补给 2 轮。",
    "",
    "### 并行执行（重要）",
    "同一个 turn 中，以下工具可以并行调用（框架自动并行，你只需在同一轮同时发起）：",
    "web_search + web_fetch + board_openclaw_assess + device_diagnose + attachment_describe_image",
    "**典型并行模式**：收到复杂任务时，在同一轮同时调用 web_search（查资料）+ board_openclaw_assess（评估板端能力）+ web_fetch（拉取官方文档/GitHub）",
    "等三者结果都回来后再制定方案和委派，而不是一个一个串行调用。",
    "",
    "### 子 Agent（sessions_spawn）",
    "你有 sessions_spawn 工具，可以在后台启动子 agent 执行耗时任务，主线程不阻塞。",
    "适用场景：",
    "- 委派 OpenClaw 执行部署后，spawn 子 agent 做验证/监控",
    "- 长时间 web 研究可以 spawn 子 agent，主线程继续和用户交互",
    "子 agent 完成后会自动将摘要写入当前会话。",
    "",
    boardSnapshot.skillDetails.length > 0
      ? `当前板端已安装 OpenClaw 技能（${boardSnapshot.skillDetails.length} 个）:\n` +
        boardSnapshot.skillDetails.map((s) =>
          `- ${s.name}${s.description ? `: ${s.description}` : ""}${s.path ? ` [${s.path}]` : ""}`
        ).join("\n") +
        "\n委派任务时可在 guidance 中引用这些技能名称和路径，帮助 OpenClaw 更快定位。"
      : "当前板端技能快照为空（可能未安装或读取失败）。如任务匹配不到现有技能，请优先生成并下发新技能，再继续执行。",
    "",
    "### 你的本地能力速查",
    "图片→attachment_describe_image | 联网→web_search/web_fetch | 设备命令→device_exec | 文件→device_file_* | 诊断→device_diagnose",
    "",
    "### 用户常见问题快答（无需搜索，直接用 device_exec 执行）",
    "- WiFi: `nmcli dev wifi list` → `nmcli dev wifi connect \"SSID\" password \"密码\"`",
    "- 摄像头: `ls /dev/video*` + `v4l2-ctl --list-devices`",
    "- 系统版本: `rdkos_info` 或 `cat /etc/version`",
    "- 进程停止: `pkill -f \"关键字\"` 或 `kill -9 <PID>`",
    "- 端口占用: `ss -tlnp | grep :端口号`",
    "- BPU状态: `hrut_smi` 或 `bputop`",
    "- 温度: `cat /sys/class/thermal/thermal_zone0/temp`（除以1000=摄氏度）",
  ].join("\n");
}
