/**
 * RDKClaw 系统提示 — 严格分层 + 静/动边界（对齐 Claude Code prompt cache 思路）
 *
 * - **stablePrefix**：宜作为 API 前缀缓存候选——在同一会话、同一设备与策略下尽量保持稳定；
 *   顺序：工具契约 → 论坛上下文 → find_skills 策略 → 记忆提示 → 人格 → 推理规范 → 设备平台
 *   → 设备研究/无设备守卫 → 板端插件列表。
 * - **dynamicSuffix**：高波动会话态——Studio UI 快照、附件列表、协作/板端技能枚举等；置于末尾，
 *   避免稀释前缀缓存命中（pi-ai 仍用单段 systemPrompt 时，稳定字节前置仍有利于未来扩展多段 system）。
 *
 * `combined ===` stablePrefix 与 dynamicSuffix 的非空拼接（双换行分隔）。
 * RDKClaw 将 stable/dynamic 传入 `Agent` 的 `systemPromptSplit`，经 pi-ai 以两段 `system` 发往 Anthropic，
 * 便于 stable 前缀在动态后缀变化时仍命中 prompt cache。
 */

import type { StudioUiHints } from "../../shared/types.js";
import type { RdkPlatform } from "../../shared/board-types.js";
import type { PersonaProfile, RDKClawPolicy } from "./types.js";
import type { DeviceProfile } from "../board/device-profiles.js";
import { getResearchSeeds } from "../board/device-profiles.js";
import {
  buildPersonaPrompt,
  buildReasoningGuidancePrompt,
  buildWebSearchTriggerPrompt,
  buildCollaborationPrompt,
  buildStudioUiHintsPrompt,
  type BoardSnapshot,
  type ModelTier,
} from "./system-prompt-builder.js";
import { buildForumAuthContextPrompt } from "./forum-context-prompt.js";
import { buildProductEcosystemPrompt, buildProductEcosystemPromptQuick } from "./product-ecosystem-prompt.js";
import {
  buildToolContractOverviewPrompt,
  buildToolContractQuickOverviewPrompt,
} from "./tool-contract-prompt.js";
import { buildOpenWebRouteHintBlock, detectOpenWebUserIntent } from "./open-web-intent.js";
import { buildRdkDocFirstUserMessageHintBlock, detectRdkDocFirstIntent } from "./rdk-doc-first-intent.js";
import type { DelegateDecision } from "./delegation.js";
import { buildDelegationRuntimePrompt } from "./delegation.js";

/** 动态段 layer id（勿并入 stable；修改此列表需谨慎） */
export const SYSTEM_PROMPT_DYNAMIC_LAYER_IDS: readonly SystemPromptLayerId[] = [
  "open_web_route",
  "rdk_doc_route",
  "knowledge_context",
  "delegation_runtime",
  "device_connectivity",
  "studio_ui_hints",
  "attachments",
  "collaboration",
];

export type SystemPromptLayerId =
  | "persona"
  | "reasoning"
  | "quick_session_policy"
  | "tool_contracts"
  | "device_platform"
  | "device_research_ros"
  | "no_device_guard"
  | "board_plugins"
  | "open_web_route"
  | "rdk_doc_route"
  | "knowledge_context"
  | "delegation_runtime"
  | "device_connectivity"
  | "studio_ui_hints"
  | "attachments"
  | "collaboration"
  | "memory_hint"
  | "find_skills_policy"
  | "forum"
  | "product_ecosystem"
  | "web_search_triggers";

export type SystemPromptLayerStability = "stable" | "dynamic";

export interface SystemPromptLayer {
  id: SystemPromptLayerId;
  content: string;
  stability: SystemPromptLayerStability;
}

export interface BuiltRdkclawSystemPrompt {
  /** 发送给模型的最终串（stable + dynamic） */
  combined: string;
  /** 前缀：缓存友好、低波动 */
  stablePrefix: string;
  /** 后缀：会话/UI/附件/协作快照 */
  dynamicSuffix: string;
  /** 分层快照（stable 段在前，dynamic 在后） */
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
  /** 工作台 Dock「快速」：极简提示 + 跳过重章节，优先 TTFT */
  studioQuickAnswer?: boolean;
  /** 本轮用户消息（节选）；用于「打开网页」路由提示等动态层 */
  latestUserMessage?: string;
  /** 与 meta 事件一致的委派决策，注入「本轮编排期望」避免模型只跑 SSH */
  delegateDecision?: DelegateDecision;
  /** 每轮开局设备连通性快照（与 /api/devices/:id/ping 同源） */
  deviceConnectivity?: {
    reachable: boolean;
    status: string;
    detail: string;
    publicNetworkReady?: boolean | null;
  };
  /** 由 KnowledgeRouter 预构建的知识上下文块（@bot / @docs / @url） */
  knowledgeContextBlock?: string;
}

function appendOpenWebRouteDynamic(
  input: SystemPromptLayerBuildInput,
  pushDynamic: (id: SystemPromptLayerId, content: string) => void,
): void {
  const msg = String(input.latestUserMessage ?? "").trim();
  if (msg && detectOpenWebUserIntent(msg)) {
    pushDynamic("open_web_route", buildOpenWebRouteHintBlock());
  }
}

/** 用户消息像 RDK 官方例程/算法任务时，强制先读 rdk_doc 再盲试 shell */
function appendRdkDocFirstDynamic(
  input: SystemPromptLayerBuildInput,
  pushDynamic: (id: SystemPromptLayerId, content: string) => void,
): void {
  const msg = String(input.latestUserMessage ?? "").trim();
  if (msg && detectRdkDocFirstIntent(msg)) {
    pushDynamic("rdk_doc_route", buildRdkDocFirstUserMessageHintBlock(msg));
  }
}

/**
 * 「快速回答」专用 bundle：显著缩短 stable 段，通常比对完整 bundle 少数千～上万字符预填。
 */
function buildRdkclawSystemPromptBundleQuick(input: SystemPromptLayerBuildInput): BuiltRdkclawSystemPrompt {
  const stableLayers: SystemPromptLayer[] = [];
  const dynamicLayers: SystemPromptLayer[] = [];

  const pushStable = (id: SystemPromptLayerId, content: string) => {
    const c = content.trim();
    if (!c) return;
    stableLayers.push({ id, content: c, stability: "stable" });
  };
  const pushDynamic = (id: SystemPromptLayerId, content: string) => {
    const c = content.trim();
    if (!c) return;
    dynamicLayers.push({ id, content: c, stability: "dynamic" });
  };

  pushStable("tool_contracts", buildToolContractQuickOverviewPrompt());
  pushStable(
    "quick_session_policy",
    [
      "## 快速模式（延迟敏感）",
      "下方「## 上下文文件 (已注入)」已含 AGENTS/SOUL/USER/HEARTBEAT、memory 日记等要点。",
      "**默认禁止**再用 `read`/`list` 打开上述同名路径或 `memory/` 下文件（系统已注入，重复拉取浪费一整轮推理）。",
      "仅当用户**明确**要查看磁盘上未展示的片段、或你要改工作区文件时，再 `read`/`write`。",
      "普通问答与闲聊：**零工具**，直接答。",
      "涉及设备执行时，先给 2-4 步短计划；再尽量合并为一次 `device_exec` 在同一 SSH 终端连续执行，避免碎片化多次试探。",
    ].join("\n"),
  );
  pushStable(
    "memory_hint",
    "偏好与结论以 memory_save / memory_search 的结构化记忆为准；daily memory 是轨迹，MEMORY.generated.md 是投影。",
  );
  pushStable("persona", buildPersonaPrompt(input.persona));
  pushStable("product_ecosystem", buildProductEcosystemPromptQuick());

  if (input.policy.network.enabled) {
    pushStable(
      "find_skills_policy",
      "非必要不检索技能；用户明确要跑板端流程或缺步骤时再 `find_skills`。",
    );
  } else {
    pushStable("find_skills_policy", "联网关：非必要不 `find_skills`；简短直接答。");
  }

  if (input.deviceProfile) {
    const dp = input.deviceProfile;
    pushStable(
      "device_platform",
      `平台: ${dp.displayName}（${dp.bpuTops}TOPS · ${dp.cpu} · ${dp.ramGb}GB）。`,
    );
  }

  if (!input.deviceId) {
    pushStable(
      "no_device_guard",
      "未选设备时无 device_*；仅能用本机工作区工具。",
    );
  }

  if (input.deviceId && input.boardSnapshot.plugins.length > 0) {
    pushStable("board_plugins", `板端插件: ${input.boardSnapshot.plugins.slice(0, 12).join(", ")}`);
  }

  appendOpenWebRouteDynamic(input, pushDynamic);
  appendRdkDocFirstDynamic(input, pushDynamic);

  // 知识上下文注入（快速模式同样支持）
  if (input.knowledgeContextBlock?.trim()) {
    pushDynamic("knowledge_context", input.knowledgeContextBlock);
  }

  if (input.deviceId && input.delegateDecision) {
    const dr = buildDelegationRuntimePrompt(input.delegateDecision, input.boardSnapshot.skills.length);
    pushDynamic("delegation_runtime", dr.length > 1600 ? `${dr.slice(0, 1600)}\n\n…(速览已截断)` : dr);
  }

  if (input.deviceId && input.deviceConnectivity) {
    const c = input.deviceConnectivity;
    const netReady = c.publicNetworkReady;
    pushDynamic(
      "device_connectivity",
      !c.reachable
        ? `## 设备连通性（本轮实时）\n当前设备 SSH 不可达（${c.status}：${c.detail}）。本轮**禁止**直接执行 board_openclaw_*、device_exec、update/install 等板端命令；先引导用户恢复连接（检查电源/网线/Wi-Fi、重新连接设备、校验密码）再继续。`
        : netReady === false
          ? `## 设备连通性（本轮实时）\n当前设备 SSH 可达，但公网不可达（${c.detail}）。本轮**禁止** openclaw、update/install、在线拉包；优先离线命令与本地方案。`
          : `## 设备连通性（本轮实时）\n当前设备 SSH 可达且公网可达（${c.status}）。可按需执行 board_openclaw_* / device_exec。`,
    );
  }

  if (input.deviceId) {
    const hintsBlock = buildStudioUiHintsPrompt(input.studioUiHints, input.persona.delegationBias);
    if (hintsBlock) {
      const cap = 1400;
      pushDynamic(
        "studio_ui_hints",
        hintsBlock.length > cap ? `${hintsBlock.slice(0, cap)}\n\n…(速览已截断)` : hintsBlock,
      );
    }
  }

  if (input.allAttachments.length > 0) {
    const hasImage = input.allAttachments.some((a) => a.type === "image");
    pushDynamic(
      "attachments",
      hasImage
        ? `附件 ${input.allAttachments.length} 个（含图）；述图前先 attachment_describe_image。`
        : `附件 ${input.allAttachments.length} 个；需要时用 attachment_*。`,
    );
  }

  if (input.deviceId) {
    const names = input.boardSnapshot.skillDetails.map((s) => s.name).slice(0, 24);
    const skillLine =
      names.length > 0
        ? `板端技能(最多列24): ${names.join(", ")}`
        : "板端技能快照空（快速模式未 SSH 拉取时可忽略）。";
    pushDynamic("collaboration", `## 协作（速览）\n${skillLine}\nOpenClaw 多步再 assess→delegate；否则 SSH。`);
  }

  const stablePrefix = stableLayers.map((l) => l.content).join("\n\n");
  const dynamicSuffix = dynamicLayers.map((l) => l.content).join("\n\n");
  const combined = [stablePrefix, dynamicSuffix].filter((s) => s.length > 0).join("\n\n");
  return { combined, stablePrefix, dynamicSuffix, layers: [...stableLayers, ...dynamicLayers] };
}

export function buildRdkclawSystemPromptBundle(input: SystemPromptLayerBuildInput): BuiltRdkclawSystemPrompt {
  if (input.studioQuickAnswer) {
    return buildRdkclawSystemPromptBundleQuick(input);
  }
  const stableLayers: SystemPromptLayer[] = [];
  const dynamicLayers: SystemPromptLayer[] = [];

  const pushStable = (id: SystemPromptLayerId, content: string) => {
    const c = content.trim();
    if (!c) return;
    stableLayers.push({ id, content: c, stability: "stable" });
  };
  const pushDynamic = (id: SystemPromptLayerId, content: string) => {
    const c = content.trim();
    if (!c) return;
    dynamicLayers.push({ id, content: c, stability: "dynamic" });
  };

  pushStable("tool_contracts", buildToolContractOverviewPrompt());
  pushStable("forum", buildForumAuthContextPrompt());
  pushStable("product_ecosystem", buildProductEcosystemPrompt());

  if (input.policy.network.enabled) {
    pushStable(
      "find_skills_policy",
      [
        "## 内置 find-skills（腾讯 SkillHub）",
        "RDK Studio **默认内置** `find_skills`：优先腾讯 SkillHub，零命中或失败再兜底 **官方 ClawHub**（默认 https://clawhub.ai）。`find_skills` **仅写审计** `.rdkstudio/find-skills-log.jsonl`，**不**因「搜过」就写入长期记忆。" +
          "若本轮**实际采用**了某 SkillHub 技能且任务**验收成功**，再调用 **`skill_mark_validated`**（填 `skill_slugs` + `task_summary`）：**下载** SKILL.md 到本机 `skills/<id>/`，已连接设备时**同步**到板端 `~/.openclaw/workspace/skills/<id>/`，并写记忆与 `.rdkstudio/validated-skills.jsonl`；纯本地采用填 `local_skill_refs`（不拉远端、不推板端）。失败、仅浏览、未采用则**禁止**调用。",
        "**强制**：能力缺口时**必须先 `find_skills`**，再 `read` / 安装 / 执行；不得未检索可复用技能就宣称无法完成（用户明确禁止联网且本地无命中除外）。",
        "**例外（勿检索技能）**：仅「打开 URL / 在用户桌面显示网页」→ 只用 **`studio_open_url`**；需登录态正文 → **`studio_embedded_browser_capture`**。这是宿主工具，**不要**为此 `find_skills` 或装远端「浏览器」技能。",
        "仅需与 `CLAWHUB_REGISTRY` 换源一致时，再用 `skillhub_search`。",
      ].join("\n"),
    );
  } else {
    pushStable(
      "find_skills_policy",
      [
        "## 内置 find-skills（仅本地）",
        "联网关闭时无远程 SkillHub；缺流程时用 `find_skills` 匹配本地并 `read` SKILL.md。仅**任务成功**且采用了本地/板端技能后，可用 `skill_mark_validated`（local_skill_refs）内化，勿仅因检索而调用。",
      ].join("\n"),
    );
  }

  pushStable(
    "memory_hint",
    input.modelTier === "small"
      ? "记住：长期结论进 memory_save；daily memory 只是轨迹，MEMORY.generated.md 只是投影；重复场景→创建技能。"
      : "## 用户理解\n对话中注意捕捉用户偏好和习惯，用 memory_save 保存重要信息，用 memory_search 回顾历史。daily memory 只记录会话轨迹，MEMORY.generated.md 只是结构化记忆投影。发现反复出现的操作模式时主动创建技能。",
  );

  pushStable("persona", buildPersonaPrompt(input.persona));
  pushStable("reasoning", buildReasoningGuidancePrompt(input.modelTier, input.persona.delegationBias));
  pushStable(
    "quick_session_policy",
    [
      "## 执行编排纪律",
      "涉及设备命令时先给计划再执行：先列 2-4 步可验证计划，再开始落命令。",
      "默认优先单次 `device_exec`（同一持久 SSH 终端）连续完成相关命令，避免无计划地分散成多轮小命令。",
      "执行结束必须给出验收结论（成功/失败、下一步）。",
    ].join("\n"),
  );
  pushStable(
    "web_search_triggers",
    buildWebSearchTriggerPrompt(input.policy.network.enabled, input.persona.delegationBias),
  );

  if (input.deviceProfile) {
    const dp = input.deviceProfile;
    pushStable(
      "device_platform",
      `当前平台: ${dp.displayName} (${dp.bpuTops}TOPS, ${dp.cpu}, ${dp.ramGb}GB RAM)。${dp.capabilityNotes?.length ? "能力: " + dp.capabilityNotes.join("；") : ""}${dp.limitations.length ? "。限制: " + dp.limitations.join("；") : ""}`,
    );
  }

  if (input.deviceId) {
    const deviceRosCloseLine =
      input.persona.delegationBias === "local-first"
        ? "确认命令后再 device_exec；**Studio 优先**：原子问题用 SSH；多步/技能/多轮试错应收束到 `board_openclaw_assess` → `delegate`，勿长串 shell 包办。"
        : "确认命令后再 device_exec；板端多步编排用 board_openclaw_assess / delegate。";
    pushStable(
      "device_research_ros",
      [
        "## 资料与命令来源（无本地生态注册表）",
        "需要官方安装步骤、示例或硬件说明时：先 `rdk_doc_search_local` 查本地 RDK 文档缓存；命中后对返回 URL 用 `web_fetch`。只有本地未命中、或需 GitHub/社区最新信息时，再 `web_search` / `forum_drobotics_*`。",
        input.platform
          ? "当前板型已识别，建议 web_fetch 入口：" + getResearchSeeds(input.platform).join(" | ")
          : "若尚未识别板型：请先 device_diagnose 或让用户执行 POST /api/devices/:id/board/detect?persist=1。",
        "## RDK 板端 ROS 环境（易误判）",
        "TROS 指 TogetheROS.Bot（通常在 /opt/tros/<发行版>/），与 ROS2 CLI 兼容；**不要**把缩写理解成 Tuya/涂鸦 IoT 的 TuyaROS2。",
        "判断是否有 ROS2 工作区前：应用 device_exec 查看 `ls /opt/tros` 或 `ls /opt/tros/*/setup.bash`，必要时 `source` 后再运行 ros2；**禁止**仅因未 source 时 `which ros2` 为空就声称「未安装 ROS2」。",
        "## ROS2 工程习惯（主动读盘 · 路径怀疑）",
        "板端文件系统**区分大小写**；`package.xml`、launch 文件名、`share/<pkg>/` 路径须以 **`ls` / `find` / `ros2 pkg prefix <pkg>`** 实测为准，勿凭记忆拼写。",
        "在改 launch、设 remap、指模型路径**之前**：优先 `device_file_read` 或 `grep` 看现有内容；断言「包不存在」前应先 `ros2 pkg list` / `dpkg -l | grep` 交叉验证。",
        "## AI / 机器人链路",
        "视觉与推理任务：明确 **相机/传感器节点 → 预处理 → 推理 → 后处理** 各步 topic 与帧率；模型与配置以板上 `find` + 文档为准，忌混用占位路径。",
        "陷入重复错误时：换假设（依赖、权限、设备占用、模型版本），并把本轮**已证实**的事实写进回复或记忆，减少无意义重试。",
        "ROS/节点/话题类任务可 `read` 工作区 skills 中的 RDK ROS（rdk-ros）与 RDK Board Knowledge（rdk-board-knowledge）的 SKILL.md。",
        deviceRosCloseLine,
      ].join("\n"),
    );
  } else {
    pushStable(
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
    pushStable("board_plugins", `当前板端允许插件: ${input.boardSnapshot.plugins.join(", ")}`);
  }

  appendOpenWebRouteDynamic(input, pushDynamic);
  appendRdkDocFirstDynamic(input, pushDynamic);

  // 知识上下文注入（@bot / @docs / @url 由 KnowledgeRouter 预构建）
  if (input.knowledgeContextBlock?.trim()) {
    pushDynamic("knowledge_context", input.knowledgeContextBlock);
  }

  if (input.deviceId && input.delegateDecision) {
    pushDynamic(
      "delegation_runtime",
      buildDelegationRuntimePrompt(input.delegateDecision, input.boardSnapshot.skills.length),
    );
  }

  if (input.deviceId && input.deviceConnectivity) {
    const c = input.deviceConnectivity;
    const netReady = c.publicNetworkReady;
    pushDynamic(
      "device_connectivity",
      !c.reachable
        ? `## 设备连通性（本轮实时）\n当前设备 SSH 不可达（${c.status}：${c.detail}）。本轮**禁止**直接执行 board_openclaw_*、device_exec、update/install 等板端命令；先引导用户恢复连接（检查电源/网线/Wi-Fi、重新连接设备、校验密码）再继续。`
        : netReady === false
          ? `## 设备连通性（本轮实时）\n当前设备 SSH 可达，但公网不可达（${c.detail}）。本轮**禁止** openclaw、update/install、在线拉包；优先离线命令与本地方案。`
          : `## 设备连通性（本轮实时）\n当前设备 SSH 可达且公网可达（${c.status}）。可按需执行 board_openclaw_* / device_exec。`,
    );
  }

  if (input.deviceId) {
    pushDynamic(
      "studio_ui_hints",
      buildStudioUiHintsPrompt(input.studioUiHints, input.persona.delegationBias),
    );
  }

  if (input.allAttachments.length > 0) {
    const hasImage = input.allAttachments.some((a) => a.type === "image");
    pushDynamic(
      "attachments",
      hasImage
        ? `当前会话已有 ${input.allAttachments.length} 个附件（含图片: ${input.allAttachments.filter((a) => a.type === "image").map((a) => `[${a.id}] ${a.name}`).join("、")}）。用户提及图片/照片时，请先调用 attachment_describe_image 分析后再回复。`
        : `当前会话已有 ${input.allAttachments.length} 个附件可供使用；如需深入读取，请调用 attachment_* 工具。`,
    );
  }

  if (input.deviceId) {
    pushDynamic(
      "collaboration",
      buildCollaborationPrompt(input.boardSnapshot, input.modelTier, input.persona.delegationBias),
    );
  }

  const stablePrefix = stableLayers.map((l) => l.content).join("\n\n");
  const dynamicSuffix = dynamicLayers.map((l) => l.content).join("\n\n");
  const combined = [stablePrefix, dynamicSuffix].filter((s) => s.length > 0).join("\n\n");
  const layers = [...stableLayers, ...dynamicLayers];

  return { combined, stablePrefix, dynamicSuffix, layers };
}
