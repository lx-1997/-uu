import type { StudioUiHints } from "../../shared/types.js";

export type RDKClawExecutionMode =
  | "auto"
  | "local"
  | "board"
  | "board-preferred";

export interface RDKClawAttachment {
  id: string;
  type: "image" | "file" | "audio" | "video";
  name: string;
  mimeType?: string;
  size?: number;
  contentBase64?: string;
  transcript?: string;
  textContent?: string;
  source?: "studio" | "feishu" | "weixin";
}

export type ChannelSource = "studio" | "weixin" | "feishu" | "autonomy";

/** 工作台 Studio：思考模式沿用户模型配置；快速模式降低扩展思考与推理展示并略抬高温度 */
export type StudioResponseMode = "quick" | "thinking";

export interface RDKClawChatRequest {
  message: string;
  deviceId?: string;
  sessionId?: string;
  userId?: string;
  /**
   * 归档用「用户名」：Studio 为 SSO 展示名；飞书/微信为 `飞书·ou_12***34` 等形式；定时任务为任务名等。
   */
  ssoUserName?: string;
  mode?: RDKClawExecutionMode;
  attachments?: RDKClawAttachment[];
  channel?: ChannelSource;
  /** 保留字段；客户端不再展示相关开关，应视为未勾选 */
  trainingDataOptIn?: boolean;
  /** Studio 界面已校验的设备/OpenClaw 快照（可选） */
  studioUiHints?: StudioUiHints;
  /** Studio 工作台：快速 / 思考（影响本轮模型采样与思考档位，默认 thinking） */
  studioResponseMode?: StudioResponseMode;
  /**
   * Studio Dock「重试」：先截断会话尾部 assistant，再复用同一条 user（不重复 append），对齐 Gemini 类「重新生成」语义。
   * 仅应在 channel=studio 且用户显式重试时置 true。
   */
  studioRegenerate?: boolean;
  // 服务端内部字段：用于在 SSE 断连时中止当前 run
  abortSignal?: AbortSignal;
}

export type RDKClawEventType =
  | "text"
  /** pi-ai extended thinking → Agent thinking_delta，流式推送到客户端 */
  | "thinking_delta"
  | "tool_start"
  | "tool_progress"
  | "tool_result"
  | "approval_required"
  | "approval_decision"
  | "recommendation"
  | "recommendation_choice"
  | "soul_update_proposal"
  | "soul_update_applied"
  | "turn_start"
  | "turn_end"
  | "message_end"
  | "run_progress"
  | "run_complete"
  | "done"
  | "error"
  | "retry"
  | "meta"
  | "queue_status"
  | "no_device";

export interface RecommendationOption {
  id: string;
  label: string;
  description: string;
  recommended?: boolean;
}

export interface RecommendationEventData {
  runId: string;
  sessionId: string;
  recommendationId: string;
  question: string;
  options: RecommendationOption[];
  allowAutoExecute: boolean;
}

export interface RDKClawEvent {
  type: RDKClawEventType;
  data: Record<string, unknown>;
}

export type ApprovalMode = "always" | "risk-based" | "auto";
export type RiskLevel = "low" | "medium" | "high";

/** 对话引擎：thinking=沿用 AI 模型页配置（推荐长任务）；fast=低延迟短答覆盖 */
export type EnginePreset = "thinking" | "fast";
export type ApprovalDecisionMode =
  | "allow_once"
  | "allow_session_auto"
  | "allow_global_auto"
  | "deny";

export interface RDKClawPolicy {
  /** 缺省 thinking，与旧版 rdkclaw-policy.json 兼容 */
  enginePreset?: EnginePreset;
  approval: {
    mode: ApprovalMode;
    riskThreshold: RiskLevel;
  };
  permission: {
    workspaceBoundaryEnabled: boolean;
    devicePathBoundaryEnabled: boolean;
    hostMutationGuardEnabled: boolean;
    commandDangerGuardEnabled: boolean;
    auditLogEnabled: boolean;
  };
  memory: {
    mainSessionReadsMemory: boolean;
    sharedSessionBlocksMemory: boolean;
    dailyMemoryDays: number;
  };
  network: {
    enabled: boolean;
    maxFetchChars: number;
    requireApproval: boolean;
  };
  context: {
    contextTokens: number;
    maxHistoryShare: number;
    softTrimRatio: number;
    hardClearRatio: number;
    keepLastAssistants: number;
  };
}

export interface ExecutorSelection {
  executor: "local" | "board";
  reason: string;
}

export interface PersonaProfile {
  name: string;
  extraInstructions: string;
  riskLevel: "conservative" | "balanced" | "aggressive";
  delegationBias: "local-first" | "balanced" | "board-first";
  autonomyLevel: "manual" | "assisted" | "autonomous";
}

export interface SoulUpdateProposal {
  proposalId: string;
  section: string;
  action: "add" | "modify" | "remove";
  content: string;
  reason: string;
  currentSnippet?: string;
}

export interface UserProfile {
  userId: string;
  preferredExecutor: "auto" | "local" | "board";
  preferredLanguage: string;
  notes: string;
  workspaceProfileId?: string;
  workspaceRoot?: string;
}

export interface SkillPermission {
  workspaceRead?: boolean;
  workspaceWrite?: boolean;
  deviceExec?: boolean;
  network?: boolean;
}

export interface SkillRuntimePolicy {
  delegatePreference?: "local" | "board" | "hybrid" | "collaborative";
  requiresBoard?: boolean;
  approvalLevel?: "none" | "confirm" | "strict";
  cooldownSeconds?: number;
  schedulerTemplate?: string;
}

export interface RDKClawSkillMeta {
  name: string;
  description: string;
  sourcePath: string;
  version: string;
  tags: string[];
  trigger: string[];
  risk: "low" | "medium" | "high";
  permissions: SkillPermission;
  runtimePolicy?: SkillRuntimePolicy;
  enabled: boolean;
  updatedAt: number;
}

