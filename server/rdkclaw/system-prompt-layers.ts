/**
 * RDKClaw 系统提示 — 严格分层与可组合（对齐 claude-code buildEffectiveSystemPrompt 思路）
 *
 * 优先级（本函数内拼接顺序即语义优先级，后者不覆盖安全/工具约束）：
 * persona → reasoning → tool_contracts → device_platform → device_research_ros → no_device_guard
 * → board_plugins → studio_ui_hints → attachments → collaboration → memory_hint
 * → find_skills_policy → forum
 */

import type { StudioUiHints } from "../../shared/types.js";
import type { RdkPlatform } from "../../shared/board-types.js";
import type { PersonaProfile, RDKClawPolicy } from "./types.js";
import type { DeviceProfile } from "../board/device-profiles.js";
import { getResearchSeeds } from "../board/device-profiles.js";
import {
  buildPersonaPrompt,
  buildReasoningGuidancePrompt,
  buildCollaborationPrompt,
  buildStudioUiHintsPrompt,
  type BoardSnapshot,
  type ModelTier,
} from "./system-prompt-builder.js";
import { buildForumAuthContextPrompt } from "./forum-context-prompt.js";
import { buildToolContractOverviewPrompt } from "./tool-contract-prompt.js";

export type SystemPromptLayerId =
  | "persona"
  | "reasoning"
  | "tool_contracts"
  | "device_platform"
  | "device_research_ros"
  | "no_device_guard"
  | "board_plugins"
  | "studio_ui_hints"
  | "attachments"
  | "collaboration"
  | "memory_hint"
  | "find_skills_policy"
  | "forum";

export interface SystemPromptLayer {
  id: SystemPromptLayerId;
  /** 非空才进入合并结果 */
  content: string;
}

export interface BuiltRdkclawSystemPrompt {
  /** 发送给模型的最终串 */
  combined: string;
  /** 分层快照（用于遥测 hash，不写入模型） */
  layers: SystemPromptLayer[];
}

type AttachmentLike = { type: string; name?: string; id: string };

export interface SystemPromptLayerBuildInput {
  persona: PersonaProfile;
  modelTier: ModelTier;
  deviceProfile: DeviceProfile | null;
  deviceId: string | undefined;
  platform: RdkPlatform | undefined;
  boardSnapshot: BoardSnapshot;
  studioUiHints: StudioUiHints | undefined;
  allAttachments: AttachmentLike[];
  policy: RDKClawPolicy;
}

export function buildRdkclawSystemPromptBundle(input: SystemPromptLayerBuildInput): BuiltRdkclawSystemPrompt {
  const layers: SystemPromptLayer[] = [];

  const add = (id: SystemPromptLayerId, content: string) => {
    const c = content.trim();
    if (!c) return;
    layers.push({ id, content: c });
  };

  add("persona", buildPersonaPrompt(input.persona));
  add("reasoning", buildReasoningGuidancePrompt(input.modelTier));
  add("tool_contracts", buildToolContractOverviewPrompt());

  if (input.deviceProfile) {
    const dp = input.deviceProfile;
    add(
      "device_platform",
      `当前平台: ${dp.displayName} (${dp.bpuTops}TOPS, ${dp.cpu}, ${dp.ramGb}GB RAM)。${dp.capabilityNotes?.length ? "能力: " + dp.capabilityNotes.join("；") : ""}${dp.limitations.length ? "。限制: " + dp.limitations.join("；") : ""}`,
    );
  }

  if (input.deviceId) {
    add(
      "device_research_ros",
      [
        "## 资料与命令来源（无本地生态注册表）",
        "需要官方安装步骤、示例或硬件说明时：用 web_search / web_fetch，优先 D-Robotics 文档与 GitHub（developer.d-robotics.cc/rdk_doc、github.com/D-Robotics），可检索 rdk_dock 等关键词。",
        input.platform
          ? "当前板型已识别，建议 web_fetch 入口：" + getResearchSeeds(input.platform).join(" | ")
          : "若尚未识别板型：请先 device_diagnose 或让用户执行 POST /api/devices/:id/board/detect?persist=1。",
        "## RDK 板端 ROS 环境（易误判）",
        "TROS 指 TogetheROS.Bot（通常在 /opt/tros/<发行版>/），与 ROS2 CLI 兼容；**不要**把缩写理解成 Tuya/涂鸦 IoT 的 TuyaROS2。",
        "判断是否有 ROS2 工作区前：应用 device_exec 查看 `ls /opt/tros` 或 `ls /opt/tros/*/setup.bash`，必要时 `source` 后再运行 ros2；**禁止**仅因未 source 时 `which ros2` 为空就声称「未安装 ROS2」。",
        "ROS/节点/话题类任务可 `read` 工作区 skills 中的 RDK ROS（rdk-ros）与 RDK Board Knowledge（rdk-board-knowledge）的 SKILL.md。",
        "确认命令后再 device_exec；板端多步编排用 board_openclaw_assess / delegate。",
      ].join("\n"),
    );
  } else {
    add(
      "no_device_guard",
      [
        "当前请求未携带 Studio 初始选中的设备 ID：在调用 device_connect_ssh / switch_device **成功之前**，可能没有 device_exec、device_diagnose、device_file_list 等板端工具。",
        "exec 与 list 仅在 **RDK Studio 服务端工作区**（代码目录，常见含 server/、src/、skills/）执行，**不是**开发板上的文件系统；禁止把它们的输出描述为「在设备上」「板端 /root」或 SSH 在板子上的结果。",
        "在 Studio 主会话中：连接或切换设备成功后会刷新**后续 LLM 回合**的工具列表；同一回合内若已出现 device_exec 等工具，即可在板端执行。若仍看不到板端工具，请再发一条短消息。",
        "若仅有 exec/list 的输出却声称已检查板端硬件或设备目录，属于错误回复。",
      ].join("\n"),
    );
  }

  if (input.deviceId && input.boardSnapshot.plugins.length > 0) {
    add("board_plugins", `当前板端允许插件: ${input.boardSnapshot.plugins.join(", ")}`);
  }

  if (input.deviceId) {
    add("studio_ui_hints", buildStudioUiHintsPrompt(input.studioUiHints));
  }

  if (input.allAttachments.length > 0) {
    const hasImage = input.allAttachments.some((a) => a.type === "image");
    add(
      "attachments",
      hasImage
        ? `当前会话已有 ${input.allAttachments.length} 个附件（含图片: ${input.allAttachments.filter((a) => a.type === "image").map((a) => `[${a.id}] ${a.name}`).join("、")}）。用户提及图片/照片时，请先调用 attachment_describe_image 分析后再回复。`
        : `当前会话已有 ${input.allAttachments.length} 个附件可供使用；如需深入读取，请调用 attachment_* 工具。`,
    );
  }

  if (input.deviceId) {
    add("collaboration", buildCollaborationPrompt(input.boardSnapshot, input.modelTier));
  }

  add(
    "memory_hint",
    input.modelTier === "small"
      ? "记住：发现用户偏好→memory_save；重复场景→创建技能。"
      : "## 用户理解\n对话中注意捕捉用户偏好和习惯，用 memory_save 保存重要信息，用 memory_search 回顾历史。发现反复出现的操作模式时主动创建技能。",
  );

  if (input.policy.network.enabled) {
    add(
      "find_skills_policy",
      [
        "## 内置 find-skills（腾讯 SkillHub）",
        "RDK Studio **默认内置** `find_skills`：优先腾讯 SkillHub，零命中或失败再兜底 **官方 ClawHub**（默认 https://clawhub.ai）。`find_skills` **仅写审计** `.rdkstudio/find-skills-log.jsonl`，**不**因「搜过」就写入长期记忆。" +
          "若本轮**实际采用**了某 SkillHub 技能且任务**验收成功**，再调用 **`skill_mark_validated`**（填 `skill_slugs` + `task_summary`）：**下载** SKILL.md 到本机 `skills/<id>/`，已连接设备时**同步**到板端 `~/.openclaw/workspace/skills/<id>/`，并写记忆与 `.rdkstudio/validated-skills.jsonl`；纯本地采用填 `local_skill_refs`（不拉远端、不推板端）。失败、仅浏览、未采用则**禁止**调用。",
        "**强制**：能力缺口时**必须先 `find_skills`**，再 `read` / 安装 / 执行；不得未检索可复用技能就宣称无法完成（用户明确禁止联网且本地无命中除外）。",
        "仅需与 `CLAWHUB_REGISTRY` 换源一致时，再用 `skillhub_search`。",
      ].join("\n"),
    );
  } else {
    add(
      "find_skills_policy",
      [
        "## 内置 find-skills（仅本地）",
        "联网关闭时无远程 SkillHub；缺流程时用 `find_skills` 匹配本地并 `read` SKILL.md。仅**任务成功**且采用了本地/板端技能后，可用 `skill_mark_validated`（local_skill_refs）内化，勿仅因检索而调用。",
      ].join("\n"),
    );
  }

  add("forum", buildForumAuthContextPrompt());

  const combined = layers.map((l) => l.content).join("\n\n");
  return { combined, layers };
}
